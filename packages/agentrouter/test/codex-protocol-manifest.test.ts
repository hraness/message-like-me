import { describe, expect, test } from "bun:test";
import { assertCodexProtocolManifest } from "../src/codex-protocol-manifest.ts";

const digest = (seed: string) => seed.repeat(64).slice(0, 64);
const runtime = { version: "0.154.0-alpha.6.2", sha256: digest("a"), schemaSha256: digest("b") };
const valid = { protocol: "codex-app-server-experimental" as const, protocolVersion: "v2", sourceVersion: runtime.version,
  executableSha256: runtime.sha256, schemaSha256: runtime.schemaSha256, manifestSha256: digest("c"), generatedAtUnixMs: 1_700_000_000_000 };

describe("Codex protocol manifest", () => {
  test("binds the complete manifest to the exact runtime", () => {
    const result = assertCodexProtocolManifest(valid, runtime);
    expect(result).toEqual(valid);
    expect(Object.isFrozen(result)).toBe(true);
  });
  test.each(["sourceVersion", "executableSha256", "schemaSha256"])("rejects runtime drift in %s", field => {
    const value = { ...valid, [field]: field === "sourceVersion" ? "other" : digest("d") };
    expect(() => assertCodexProtocolManifest(value, runtime)).toThrow("CODEX_PROTOCOL_RUNTIME_MISMATCH");
  });
  test("rejects unknown fields and malformed digests before binding", () => {
    expect(() => assertCodexProtocolManifest({ ...valid, extra: true }, runtime)).toThrow("CODEX_PROTOCOL_MANIFEST_INVALID");
    expect(() => assertCodexProtocolManifest({ ...valid, manifestSha256: "short" }, runtime)).toThrow("CODEX_PROTOCOL_MANIFEST_DIGEST_INVALID");
  });
});
