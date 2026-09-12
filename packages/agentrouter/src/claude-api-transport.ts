import Anthropic from "@anthropic-ai/sdk";

const ORIGIN = "https://api.anthropic.com";
const LIMIT = 2 * 1024 * 1024;
export const CLAUDE_API_SDK_VERSION = "0.125.0";
export type ClaudeApiClient = Pick<Anthropic, "messages" | "models">;

/** Internal host transport. Public setup never accepts a custom endpoint or fetch. */
export function claudeApiClient(key: string, signal: AbortSignal,
  networkFetch: (input: string, init: RequestInit) => Promise<Response> = globalThis.fetch): ClaudeApiClient {
  if (!/^sk-ant-api03-[A-Za-z0-9_-]{16,512}$/u.test(key)) throw new Error("CLAUDE_API_KEY_REQUIRED");
  return new Anthropic({ apiKey: key, authToken: null, credentials: null, config: null, profile: null,
    webhookKey: null, baseURL: ORIGIN, maxRetries: 0, timeout: 30_000, logLevel: "off",
    logger: { debug() {}, info() {}, warn() {}, error() {} }, defaultHeaders: {}, defaultQuery: {},
    fetch: async (input, init) => {
      signal.throwIfAborted();
      for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) {
        if (process.env[name]) throw new Error("CLAUDE_API_PROXY_UNSUPPORTED");
      }
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const method = init?.method ?? "GET";
      const modelQuery = [...url.searchParams].every(([name, value]) =>
        name === "limit" ? value === "100" : name === "after_id" && /^[A-Za-z0-9_-]{1,160}$/u.test(value));
      if (url.origin !== ORIGIN || url.username || url.password || url.hash
        || !((url.pathname === "/v1/messages" && method === "POST" && !url.search)
          || (url.pathname === "/v1/models" && method === "GET" && modelQuery))) throw new Error("CLAUDE_API_ENDPOINT_DENIED");
      if (init?.body !== undefined && (typeof init.body !== "string" || Buffer.byteLength(init.body) > LIMIT)) throw new Error("CLAUDE_API_INPUT_LIMIT");
      const response = await networkFetch(url.href, { method, ...(init?.body === undefined ? {} : { body: init.body }),
        headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": key },
        signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]),
        redirect: "error", credentials: "omit", cache: "no-store" });
      const reader = response.body?.getReader();
      try {
        if (!response.ok || response.redirected || (response.url && new URL(response.url).origin !== ORIGIN)) throw new Error("CLAUDE_API_REQUEST_FAILED");
        if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json") || !reader) throw new Error("CLAUDE_API_RESPONSE_INVALID");
        const parts: Uint8Array[] = []; let size = 0;
        while (true) {
          signal.throwIfAborted();
          const result = await reader.read();
          if (result.done) break;
          size += result.value.byteLength;
          if (size > LIMIT) throw new Error("CLAUDE_API_OUTPUT_LIMIT");
          parts.push(result.value);
        }
        signal.throwIfAborted();
        return new Response(Buffer.concat(parts), { status: 200, headers: { "content-type": "application/json" } });
      } finally { await reader?.cancel().catch(() => {}); reader?.releaseLock(); }
    },
  });
}
