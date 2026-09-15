import { describe, expect, test } from "bun:test";
import { createLoopbackServer } from "../src/loopback-server.ts";

describe("loopback server port", () => {
  test("serves fetch-style requests with method, url, headers and body", async () => {
    let observed: { method: string; url: string; contentType: string | null; body: string } | null = null;
    const server = await createLoopbackServer({
      hostname: "127.0.0.1",
      fetch: async request => {
        observed = {
          method: request.method,
          url: request.url,
          contentType: request.headers.get("content-type"),
          body: await request.text(),
        };
        return Response.json({ ok: true }, { status: 201 });
      },
      error: () => new Response("failed", { status: 500 }),
    });
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/bound/path?q=1`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hello: "world" }),
      });
      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ ok: true });
      expect(observed!).toEqual({
        method: "POST",
        url: `http://127.0.0.1:${server.port}/bound/path?q=1`,
        contentType: "application/json",
        body: JSON.stringify({ hello: "world" }),
      });
    } finally {
      await server.stop();
    }
  });

  test("counts pending requests and joins them on immediate stop", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const server = await createLoopbackServer({
      hostname: "127.0.0.1",
      fetch: async () => { await gate; return new Response("done"); },
      error: () => new Response("failed", { status: 500 }),
    });
    const inflight = fetch(`http://127.0.0.1:${server.port}/slow`).then(response => response.text());
    const pending = () => server.pendingRequests;
    while (pending() !== 1) await Bun.sleep(1);
    release();
    expect(await inflight).toBe("done");
    while (pending() !== 0) await Bun.sleep(1);
    await server.stop(true);
    expect(pending()).toBe(0);
  });

  test("handler failures route to the error response", async () => {
    const server = await createLoopbackServer({
      hostname: "127.0.0.1",
      fetch: () => { throw new Error("boom"); },
      error: () => new Response("handled", { status: 503 }),
    });
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      expect(response.status).toBe(503);
      expect(await response.text()).toBe("handled");
    } finally {
      await server.stop();
    }
  });
});
