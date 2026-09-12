import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createGhostgetCliInvoker } from "./cli";

const executable = fileURLToPath(new URL("../test-fixtures/ghostget-cli.ts", import.meta.url));
describe("private Ghostget process adapter with synthetic CLI", () => {
  test("verifies an artifact receipt and removes owned temporary files", async () => {
    const invoke = createGhostgetCliInvoker({ executable });
    const result = await invoke({ command: "messaging.context", input: {} }) as { synthetic: boolean; path: string };
    expect(result.synthetic).toBe(true);
    expect(existsSync(result.path)).toBe(false);
  });
  test("rejects mismatched artifact digests and nonprivate outputs", async () => {
    const invoke = createGhostgetCliInvoker({ executable });
    await expect(invoke({ command: "messaging.context", input: { fixtureMode: "tampered" } })).rejects.toThrow("receipt mismatch");
    await expect(invoke({ command: "messaging.context", input: { fixtureMode: "insecure" } })).rejects.toThrow("Invalid private");
  });
  test("preserves exact partial outcomes from Ghostget exit 3", async () => {
    const invoke = createGhostgetCliInvoker({ executable });
    const result = await invoke({ command: "confirm", planDigest: "a".repeat(64) });
    expect(result).toMatchObject({ state: "partial", provenPartCount: 1, partCount: 2 });
  });
  test("does not inherit ambient provider credentials", async () => {
    const previous = process.env.TEXTBUTLER_FIXTURE_SECRET;
    process.env.TEXTBUTLER_FIXTURE_SECRET = "synthetic-secret";
    try {
      const result = await createGhostgetCliInvoker({ executable })({ command: "capabilities", adapterId: "imessage-direct" });
      expect(result).toMatchObject({ ambientSecretPresent: false });
    } finally { if (previous === undefined) delete process.env.TEXTBUTLER_FIXTURE_SECRET; else process.env.TEXTBUTLER_FIXTURE_SECRET = previous; }
  });
});
