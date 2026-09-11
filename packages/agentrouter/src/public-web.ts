import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { publicHttpsUrl, type PublicWeb } from "./broker.ts";

const reserved = new BlockList();
for (const [address, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) reserved.addSubnet(address, bits, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
for (const [address, bits] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3ffe::", 16], ["3fff::", 20]] as const) reserved.addSubnet(address, bits, "ipv6");

/** Conservative public-unicast policy. Mapped IPv4, transition and special-use ranges fail closed. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !reserved.check(address, "ipv4")
    : family === 6 && globalV6.check(address, "ipv6") && !reserved.check(address, "ipv6");
}
type Address = Readonly<{ address: string; family: number }>;
type WebResponse = Readonly<{ status: number; location?: string; text?: string }>;
/** Trusted host IO seam, useful for deterministic DNS/redirect qualification. Never a model tool. */
export interface PublicWebIO {
  resolve(hostname: string): Promise<readonly Address[]>;
  get(url: URL, address: Address, maxBytes: number, signal: AbortSignal): Promise<WebResponse>;
}

export const nodePublicWebIO: PublicWebIO = {
  resolve: hostname => lookup(hostname, { all: true, verbatim: true }),
  get(url, address, maxBytes, signal) {
    // Bun's HTTPS implementation can inherit fetch proxy settings even with
    // agent:false. Refuse that configuration rather than route via an ambient
    // proxy or change process-wide environment while other requests run.
    if (["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "https_proxy", "http_proxy", "all_proxy"].some(name => process.env[name])) return Promise.reject(new Error("PUBLIC_WEB_PROXY_ENV_UNSUPPORTED"));
    return new Promise((resolve, reject) => {
      // No pooled socket, proxy, cookie jar, ambient headers, or second DNS lookup.
      // The URL hostname still controls TLS SNI and certificate verification.
      const outgoing = request(url, {
        method: "GET", agent: false, family: address.family, signal,
        // Never inherit NODE_TLS_REJECT_UNAUTHORIZED=0 from the host process.
        rejectUnauthorized: true, servername: url.hostname,
        maxHeaderSize: 16_384,
        // Bun 1.3 calls custom lookup with all:true even when family is fixed.
        // Supplying the single-record overload there fails before connecting.
        lookup: (_hostname, options, callback) => options.all
          ? callback(null, [{ address: address.address, family: address.family }])
          : callback(null, address.address, address.family),
        headers: { Accept: "text/*, application/json, application/xml", "Accept-Encoding": "identity", "User-Agent": "Agentrouter/0.1 public-web" },
      }, incoming => {
        // A truncated response may close without emitting end. Reject promptly;
        // returning the received prefix would turn incomplete data into success.
        let ended = false;
        incoming.once("error", () => reject(new Error("PUBLIC_WEB_RESPONSE_FAILED")));
        incoming.once("aborted", () => reject(new Error("PUBLIC_WEB_RESPONSE_FAILED")));
        incoming.once("close", () => { if (!ended) reject(new Error("PUBLIC_WEB_RESPONSE_FAILED")); });
        // Bun 1.3 does not apply request.maxHeaderSize to its fetch-backed
        // response parser. Enforce the accepted header limit here as well;
        // the underlying runtime still owns buffering before this callback.
        let headerBytes = Buffer.byteLength(incoming.statusMessage ?? "") + 16;
        for (const header of incoming.rawHeaders) {
          headerBytes += Buffer.byteLength(header) + 2;
          if (headerBytes > 16_384) { reject(new Error("PUBLIC_WEB_RESPONSE_REJECTED")); incoming.destroy(); return; }
        }
        const status = incoming.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          const location = incoming.headers.location;
          incoming.destroy();
          resolve({ status, ...(location === undefined ? {} : { location }) });
          return;
        }
        const type = incoming.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
        const encoding = incoming.headers["content-encoding"];
        const length = incoming.headers["content-length"];
        if (status < 200 || status >= 300 || !(type.startsWith("text/") || type === "application/json" || type === "application/xml" || type.endsWith("+json") || type.endsWith("+xml"))
          || encoding !== undefined && encoding !== "identity"
          || length !== undefined && (!/^\d+$/u.test(length) || Number(length) > maxBytes)) {
          incoming.destroy(); reject(new Error("PUBLIC_WEB_RESPONSE_REJECTED")); return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        incoming.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > maxBytes) { incoming.destroy(new Error("PUBLIC_WEB_RESPONSE_TOO_LARGE")); return; }
          chunks.push(chunk);
        });
        incoming.once("end", () => {
          ended = true;
          if (!incoming.complete) { reject(new Error("PUBLIC_WEB_RESPONSE_FAILED")); return; }
          try { resolve({ status, text: new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)) }); }
          catch { reject(new Error("PUBLIC_WEB_UTF8_REQUIRED")); }
        });
      });
      // Bun's failed lookup-candidate fallback can emit more than one error.
      // Keep the listener through cleanup so a refused connection cannot crash
      // the host after the promise has already rejected.
      outgoing.on("error", () => reject(new Error("PUBLIC_WEB_REQUEST_FAILED")));
      outgoing.end();
    });
  },
};

function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const aborted = () => reject(new Error("PUBLIC_WEB_CANCELLED"));
    signal.addEventListener("abort", aborted, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
  });
}

/** Bounded public HTTPS GETs. Every redirect repeats DNS admission and pins one approved address. */
export function createPublicWeb(io: PublicWebIO = nodePublicWebIO): PublicWeb {
  return {
    async fetchPublic(input, maxBytes, callerSignal) {
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 262_144) throw new Error("PUBLIC_WEB_INVALID_LIMIT");
      const signal = AbortSignal.any([callerSignal, AbortSignal.timeout(15_000)]);
      let url = new URL(publicHttpsUrl(input));
      const visited = new Set<string>();
      for (let redirect = 0; redirect <= 3; redirect++) {
        signal.throwIfAborted();
        if (visited.has(url.href)) throw new Error("PUBLIC_WEB_REDIRECT_LOOP");
        visited.add(url.href);
        const addresses = await untilAborted(io.resolve(url.hostname), signal);
        if (!addresses.length || addresses.length > 32 || addresses.some(address => ![4, 6].includes(address.family) || isIP(address.address) !== address.family || !isPublicAddress(address.address))) throw new Error("PUBLIC_WEB_ADDRESS_REJECTED");
        signal.throwIfAborted();
        const response = await untilAborted(io.get(url, addresses[0]!, maxBytes, signal), signal);
        signal.throwIfAborted();
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          if (!response.location || redirect === 3) throw new Error("PUBLIC_WEB_REDIRECT_LIMIT");
          url = new URL(publicHttpsUrl(new URL(response.location, url).href));
          continue;
        }
        if (response.status < 200 || response.status >= 300 || typeof response.text !== "string" || Buffer.byteLength(response.text) > maxBytes) throw new Error("PUBLIC_WEB_RESPONSE_REJECTED");
        return { text: response.text, url: url.href };
      }
      throw new Error("PUBLIC_WEB_REDIRECT_LIMIT");
    },
  };
}
