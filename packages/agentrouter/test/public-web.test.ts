import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicWeb, isPublicAddress, type PublicWebIO } from "../src/public-web.ts";

const publicAddress = { address: "93.184.216.34", family: 4 };
const signal = () => new AbortController().signal;

test("public unicast admission rejects private, mapped, metadata and special-use addresses", () => {
  for (const value of ["0.0.0.0", "10.1.2.3", "100.100.100.200", "127.0.0.1", "169.254.169.254", "172.20.1.2", "192.168.1.1", "192.0.2.1", "198.18.0.1", "224.1.2.3", "255.255.255.255", "::1", "::ffff:8.8.8.8", "fd00::1", "fe80::1", "2001:db8::1", "2002:7f00:1::", "2001::1", "3fff::1", "not-an-address"]) expect(isPublicAddress(value)).toBe(false);
  for (const value of ["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"]) expect(isPublicAddress(value)).toBe(true);
});

test("every redirect resolves and pins public DNS before another request", async () => {
  const hosts: string[] = [], gets: string[] = [];
  const web = createPublicWeb({
    async resolve(host) { hosts.push(host); return host === "metadata.example.com" ? [{ address: "169.254.169.254", family: 4 }] : [publicAddress]; },
    async get(url, pinned, limit) {
      gets.push(url.href); expect(pinned).toEqual(publicAddress); expect(limit).toBe(1024);
      return { status: 302, location: "https://metadata.example.com/latest/token" };
    },
  });
  await expect(web.fetchPublic("https://example.com/start", 1024, signal())).rejects.toThrow("ADDRESS_REJECTED");
  expect(hosts).toEqual(["example.com", "metadata.example.com"]);
  expect(gets).toEqual(["https://example.com/start"]);
});

test("mixed public/private DNS, IP URLs, credentials and unsafe redirects never reach their target", async () => {
  let gets = 0;
  const io: PublicWebIO = { resolve: async () => [publicAddress, { address: "::1", family: 6 }], get: async () => { gets++; return { status: 200, text: "unexpected" }; } };
  await expect(createPublicWeb(io).fetchPublic("https://example.com", 1024, signal())).rejects.toThrow("ADDRESS_REJECTED");
  for (const url of ["https://127.0.0.1/", "https://[::1]/", "https://owner:secret@example.com", "http://example.com/"]) await expect(createPublicWeb(io).fetchPublic(url, 1024, signal())).rejects.toThrow("PUBLIC_HTTPS_REQUIRED");
  expect(gets).toBe(0);
  const redirect = createPublicWeb({ resolve: async () => [publicAddress], get: async () => { gets++; return { status: 307, location: "https://owner:secret@example.com/" }; } });
  await expect(redirect.fetchPublic("https://example.com/start", 1024, signal())).rejects.toThrow("PUBLIC_HTTPS_REQUIRED");
  expect(gets).toBe(1);
});

test("public GET follows bounded relative redirects and validates bytes from the host port", async () => {
  let count = 0;
  const web = createPublicWeb({ resolve: async () => [publicAddress], get: async () => ++count === 1 ? { status: 302, location: "/final" } : { status: 200, text: "hello" } });
  expect(await web.fetchPublic("https://example.com/start", 5, signal())).toEqual({ text: "hello", url: "https://example.com/final" });
  await expect(web.fetchPublic("https://example.com/start", 4, signal())).rejects.toThrow("RESPONSE_REJECTED");
});

test("redirect loops and endless redirects are bounded", async () => {
  let count = 0;
  const loop = createPublicWeb({ resolve: async () => [publicAddress], get: async () => { count++; return { status: 302, location: "/" }; } });
  await expect(loop.fetchPublic("https://example.com/", 32, signal())).rejects.toThrow("REDIRECT_LOOP");
  expect(count).toBe(1);
  count = 0;
  const endless = createPublicWeb({ resolve: async () => [publicAddress], get: async () => ({ status: 302, location: `/step-${++count}` }) });
  await expect(endless.fetchPublic("https://example.com/", 32, signal())).rejects.toThrow("REDIRECT_LIMIT");
  expect(count).toBe(4);
});

test("cancellation during resolution never starts a request", async () => {
  const controller = new AbortController();
  let resolveDns!: (value: readonly { address: string; family: number }[]) => void;
  let gets = 0;
  const web = createPublicWeb({ resolve: () => new Promise(resolve => { resolveDns = resolve; }), get: async () => { gets++; return { status: 200, text: "too late" }; } });
  const pending = web.fetchPublic("https://example.com", 32, controller.signal);
  controller.abort();
  await expect(pending).rejects.toThrow("CANCELLED");
  resolveDns([publicAddress]);
  await Promise.resolve();
  expect(gets).toBe(0);
});

test("the real HTTPS client pins DNS, verifies TLS, and bounds incomplete or hostile responses", async () => {
  // This exercises Bun's actual node:https implementation, without public DNS or
  // public network access. The raw trusted IO port intentionally receives the
  // fixture's loopback address; fetchPublic above still rejects that address.
  const directory = await mkdtemp(join(tmpdir(), "agentrouter-web-"));
  const certificate = join(directory, "certificate.pem"), key = join(directory, "key.pem");
  const hostname = "agentrouter-web.invalid";
  const environment = { PATH: process.env.PATH ?? "/usr/bin:/bin", OPENSSL_CONF: "/dev/null" };
  let server: ReturnType<typeof createServer> | undefined;
  try {
    let generated: Bun.Subprocess<"ignore", "pipe", "pipe">;
    try {
      generated = Bun.spawn(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-keyout", key, "-out", certificate, "-days", "1", "-subj", `/CN=${hostname}`, "-addext", `subjectAltName=DNS:${hostname}`], {
        env: environment, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 5_000,
      });
    } catch { throw new Error("Public HTTPS security tests require OpenSSL to generate a temporary certificate"); }
    const generatedExit = await generated.exited;
    if (generatedExit !== 0) throw new Error(`Public HTTPS fixture generation failed: ${await new Response(generated.stderr).text()}`);
    const requests: string[] = [];
    const hosts: (string | undefined)[] = [];
    server = createServer({ key: await readFile(key), cert: await readFile(certificate) }, (request, response) => {
      requests.push(request.url ?? "");
      hosts.push(request.headers.host);
      response.setHeader("Content-Type", "text/plain");
      switch (request.url) {
        case "/oversize": response.end("x".repeat(1025)); break;
        case "/declared-oversize": response.setHeader("Content-Length", "2048"); response.end("x"); break;
        case "/truncated": response.setHeader("Content-Length", "10"); response.write("abc", () => response.destroy()); break;
        case "/binary": response.setHeader("Content-Type", "application/octet-stream"); response.end("binary"); break;
        case "/encoded": response.setHeader("Content-Encoding", "gzip"); response.end("not compressed"); break;
        case "/invalid-utf8": response.end(Buffer.from([0xc3, 0x28])); break;
        case "/large-header": response.setHeader("X-Synthetic", "x".repeat(20_000)); response.end("hello"); break;
        case "/redirect": response.writeHead(302, { Location: "/ok" }); response.end("x".repeat(2048)); break;
        case "/wait": response.write("prefix"); break;
        default: response.end("hello");
      }
    });
    await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(0, "127.0.0.1", resolve); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("HTTPS fixture did not bind a TCP port");
    const source = fileURLToPath(new URL("../src/public-web.ts", import.meta.url));
    const script = `
      import { nodePublicWebIO } from ${JSON.stringify(source)};
      const results = {};
      for (const path of ["/ok", "/oversize", "/declared-oversize", "/truncated", "/binary", "/encoded", "/invalid-utf8", "/large-header", "/redirect", "/wait", "/wrong-host"]) {
        const host = path === "/wrong-host" ? "wrong.agentrouter-web.invalid" : ${JSON.stringify(hostname)};
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), path === "/wait" ? 50 : 2000);
        try {
          results[path] = await nodePublicWebIO.get(new URL("https://" + host + ":${address.port}" + path), { address: "127.0.0.1", family: 4 }, 1024, controller.signal);
        } catch (error) { results[path] = error.message; }
        finally { results[path + "-aborted"] = controller.signal.aborted; clearTimeout(timeout); }
      }
      for (const key of ["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "https_proxy", "http_proxy", "all_proxy"]) {
        process.env[key] = "http://127.0.0.1:1";
        try {
          await nodePublicWebIO.get(new URL("https://${hostname}:${address.port}/proxy-env"), { address: "127.0.0.1", family: 4 }, 1024, AbortSignal.timeout(2000));
          results[key] = "accepted";
        } catch (error) { results[key] = error.message; }
        finally { delete process.env[key]; }
      }
      if (typeof results["/ok"] === "string") {
        const { request } = await import("node:https");
        results.diagnostic = await new Promise(resolve => {
          const options = [];
          const req = request(new URL("https://${hostname}:${address.port}/diagnostic"), {
            agent: false, family: 4, rejectUnauthorized: true, servername: ${JSON.stringify(hostname)}, signal: AbortSignal.timeout(2000),
            lookup(host, flags, callback) { options.push(flags); flags.all ? callback(null, [{ address: "127.0.0.1", family: 4 }]) : callback(null, "127.0.0.1", 4); },
          }, response => { response.resume(); resolve({ status: response.statusCode, options }); });
          req.on("error", error => resolve({ code: error.code, message: error.message, options }));
          req.end();
        });
      }
      process.stdout.write(JSON.stringify(results));
    `;
    const child = Bun.spawn([process.execPath, "--eval", script], {
      // Trust only this synthetic CA in the child, not in the application or
      // parent process. TLS must stay strict despite the ambient disable flag.
      env: { ...environment, NODE_EXTRA_CA_CERTS: certificate, NODE_TLS_REJECT_UNAUTHORIZED: "0" },
      stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 10_000,
    });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(stderr).not.toContain("Unhandled");
    expect(exit, stderr).toBe(0);
    const results = JSON.parse(stdout) as Record<string, unknown>;
    expect(results["/ok"], JSON.stringify(results.diagnostic)).toEqual({ status: 200, text: "hello" });
    expect(results["/redirect"]).toEqual({ status: 302, location: "/ok" });
    expect(results["/truncated"]).toMatch(/^PUBLIC_WEB_(?:REQUEST|RESPONSE)_FAILED$/u);
    expect(results["/truncated-aborted"]).toBe(false);
    expect(results["/wait-aborted"]).toBe(true);
    expect(results["/invalid-utf8"]).toBe("PUBLIC_WEB_UTF8_REQUIRED");
    for (const path of ["/oversize", "/declared-oversize", "/binary", "/encoded", "/large-header", "/wait", "/wrong-host"]) expect(results[path], path).toMatch(/^PUBLIC_WEB_.*(?:FAILED|REJECTED)$/u);
    for (const key of ["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "https_proxy", "http_proxy", "all_proxy"]) expect(results[key], key).toBe("PUBLIC_WEB_PROXY_ENV_UNSUPPORTED");
    expect(requests).not.toContain("/proxy-env");
    expect(requests).not.toContain("/wrong-host");
    expect(requests).toContain("/ok");
    expect(hosts.every(host => host === `${hostname}:${address.port}`)).toBe(true);
    const untrusted = Bun.spawn([process.execPath, "--eval", `
      import { nodePublicWebIO } from ${JSON.stringify(source)};
      try {
        await nodePublicWebIO.get(new URL("https://${hostname}:${address.port}/untrusted"), { address: "127.0.0.1", family: 4 }, 1024, AbortSignal.timeout(2000));
        process.stdout.write("accepted");
      } catch (error) { process.stdout.write(error.message); }
    `], { env: { ...environment, NODE_TLS_REJECT_UNAUTHORIZED: "0" }, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 3_000 });
    const [untrustedExit, untrustedResult] = await Promise.all([untrusted.exited, new Response(untrusted.stdout).text(), new Response(untrusted.stderr).text()]);
    expect(untrustedExit).toBe(0);
    expect(untrustedResult).toBe("PUBLIC_WEB_REQUEST_FAILED");
    expect(requests).not.toContain("/untrusted");
  } finally {
    server?.closeAllConnections();
    if (server?.listening) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);
