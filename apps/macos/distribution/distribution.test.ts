import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { BUN_ENTITLEMENTS, inventory, loadUnsigned, parseUnsigned, readPhysical, sha256, TAG, VERSION, type UnsignedReceipt } from "./common.ts";
import { entitlements, nativePaths } from "./native.ts";

const fixture = () => realpathSync(mkdtempSync(join(tmpdir(), "textbutler-distribution-")));
const receipt = (archive: Uint8Array): UnsignedReceipt => ({ schema: "textbutler.desktop-unsigned.v1", repository: "hraness/message-like-me", sourceSha: "a".repeat(40), sourceTree: "b".repeat(40), version: VERSION, tag: TAG, architecture: "arm64", minimumMacOS: "14.5", archive: { name: "unsigned.zip", bytes: archive.length, sha256: sha256(archive) }, bundleSha256: "c".repeat(64) });
describe("desktop artifact admission", () => {
  test("handoff binds exact source, receipt bytes, archive bytes and inventory", () => {
    const root = fixture();
    try {
      const archive = Buffer.from("synthetic-archive"), r = receipt(archive), bytes = JSON.stringify(r);
      writeFileSync(join(root, "unsigned.zip"), archive); writeFileSync(join(root, "unsigned-manifest.json"), bytes);
      expect(loadUnsigned(root, sha256(bytes), r.sourceSha)).toEqual(r);
      expect(() => loadUnsigned(root, "0".repeat(64), r.sourceSha)).toThrow();
      expect(() => loadUnsigned(root, sha256(bytes), "d".repeat(40))).toThrow();
      writeFileSync(join(root, "unsigned.zip"), "altered"); expect(() => loadUnsigned(root, sha256(bytes), r.sourceSha)).toThrow();
      writeFileSync(join(root, "unsigned.zip"), archive); writeFileSync(join(root, "unexpected"), "extra"); expect(() => loadUnsigned(root, sha256(bytes), r.sourceSha)).toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  test("release coordinate cannot be changed or extended", () => {
    const r = receipt(Buffer.from("x"));
    for (const delta of [{ version: "0.8.9" }, { tag: "v0.8.9" }, { repository: "other/repository" }, { architecture: "x64" }, { sourceSha: "main" }, { override: true }]) expect(() => parseUnsigned({ ...r, ...delta })).toThrow();
  });
  test("physical inventory rejects links, mutable modes and oversized reads", () => {
    const root = fixture();
    try {
      const file = join(root, "file"); writeFileSync(file, "x"); expect(readPhysical(file).toString()).toBe("x"); expect(() => readPhysical(file, 0)).toThrow();
      symlinkSync(file, join(root, "link")); expect(() => inventory(root)).toThrow(); rmSync(join(root, "link"));
      chmodSync(file, 0o666); expect(() => readPhysical(file)).toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  test("only bundled Bun gets JIT and unexpected Mach-O is rejected", () => {
    expect(entitlements("Contents/Resources/textbutler-runtime/textbutler-bun")).toEqual(BUN_ENTITLEMENTS);
    expect(entitlements("Contents/MacOS/textbutler-desktop")).toEqual({});
    const root = fixture();
    try {
      mkdirSync(join(root, "Contents/MacOS"), { recursive: true }); mkdirSync(join(root, "Contents/Resources/textbutler-runtime"), { recursive: true });
      for (const path of ["Contents/MacOS/textbutler-desktop", "Contents/Resources/textbutler-runtime/textbutler-bun"]) writeFileSync(join(root, path), Buffer.from("feedfacf", "hex"));
      expect(nativePaths(root)).toHaveLength(2); writeFileSync(join(root, "hidden"), Buffer.from("feedfacf", "hex")); expect(() => nativePaths(root)).toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  test("bounded archive roundtrip and hostile archives", () => {
    const result = spawnSync("python3", ["-I", "-B", join(import.meta.dir, "archive-tests.py")], { timeout: 30_000, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  });
});
