import { describe, expect, test } from "bun:test";

import { registryVersionIntegrity, registryVersionUrl } from "./npm-release-policy";

describe("npm release publication policy", () => {
  test("builds only a normalized direct version endpoint", () => {
    expect(registryVersionUrl("@hraness/message-like-me", "0.8.1"))
      .toBe("https://registry.npmjs.org/%40hraness%2Fmessage-like-me/0.8.1");
    expect(() => registryVersionUrl("message-like-me", "0.8.1")).toThrow("scope coordinate");
    expect(() => registryVersionUrl("@hraness/message-like-me", "latest")).toThrow("semantic");
  });

  test("distinguishes an exact immutable release from a strict registry 404", async () => {
    await expect(registryVersionIntegrity(new Response(JSON.stringify({
      dist: { integrity: "sha512-QUJDRA==" },
      name: "@hraness/message-like-me",
      version: "0.8.1",
    }), {
      headers: { "content-type": "application/json" },
      status: 200,
    }), "@hraness/message-like-me", "0.8.1")).resolves.toBe("sha512-QUJDRA==");
    await expect(registryVersionIntegrity(new Response(JSON.stringify("Not Found"), {
      headers: { "content-type": "application/json" },
      status: 404,
    }), "@hraness/message-like-me", "0.8.1")).resolves.toBeNull();
    await expect(registryVersionIntegrity(new Response(JSON.stringify("version not found: 0.8.1"), {
      headers: { "content-type": "application/json" },
      status: 404,
    }), "@hraness/message-like-me", "0.8.1")).resolves.toBeNull();
    await expect(registryVersionIntegrity(new Response(JSON.stringify({ error: "Not Found" }), {
      headers: { "content-type": "application/json" },
      status: 404,
    }), "@hraness/message-like-me", "0.8.1")).resolves.toBeNull();
  });

  test("fails closed on wrong coordinates, malformed 404s, and other status codes", async () => {
    await expect(registryVersionIntegrity(new Response(JSON.stringify({
      dist: { integrity: "sha512-QUJDRA==" },
      name: "@hraness/other",
      version: "0.8.1",
    }), {
      headers: { "content-type": "application/json" },
      status: 200,
    }), "@hraness/message-like-me", "0.8.1")).rejects.toThrow("wrong package coordinate");
    await expect(registryVersionIntegrity(new Response(JSON.stringify({ error: "Not Found", extra: true }), {
      headers: { "content-type": "application/json" },
      status: 404,
    }), "@hraness/message-like-me", "0.8.1")).rejects.toThrow("invalid missing-version");
    await expect(registryVersionIntegrity(new Response("{}", {
      headers: { "content-type": "application/json" },
      status: 429,
    }), "@hraness/message-like-me", "0.8.1")).rejects.toThrow("HTTP 429");
  });
});
