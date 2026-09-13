import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ARCHIVE, sha256, TAG, VERSION } from "./common.ts";

const root = join(import.meta.dir, "../../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("desktop release coordinate agrees across native manifests, workflow and instructions", () => {
  for (const path of ["apps/macos/package.json", "apps/macos/src-tauri/tauri.conf.json"]) {
    expect(JSON.parse(read(path)).version).toBe(VERSION);
  }
  expect(read("apps/macos/src-tauri/Cargo.toml").match(/^version = "([^"]+)"$/mu)?.[1]).toBe(VERSION);
  const lock = read("apps/macos/src-tauri/Cargo.lock");
  const app = lock.split("[[package]]").filter(block => /^name = "textbutler-desktop"$/mu.test(block));
  expect(app).toHaveLength(1);
  expect(app[0]!.match(/^version = "([^"]+)"$/mu)?.[1]).toBe(VERSION);
  expect(JSON.parse(read("apps/macos/distribution/notices/RUST-LICENSES.json")).cargoLockSha256).toBe(sha256(lock));
  for (const path of [".github/workflows/desktop-release.yml", "apps/macos/distribution/README.md"]) {
    const text = read(path);
    expect(text.match(/desktop-v[0-9]+\.[0-9]+\.[0-9]+-macos-arm64/gu)?.every(tag => tag === TAG)).toBe(true);
    expect(text.match(/Textbutler-[0-9]+\.[0-9]+\.[0-9]+-macos-arm64\.zip/gu)?.every(archive => archive === ARCHIVE)).toBe(true);
  }
});
