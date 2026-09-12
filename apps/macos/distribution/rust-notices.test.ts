import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { command, sha256 } from "./common.ts";
import { admitSupplement, rustNotices } from "./rust-notices.ts";

test("Rust notices retain original copyrighted bytes and exact Cargo package checksum", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "textbutler-crate-notice-"))), license = "Copyright Synthetic Contributors\nPermission is hereby granted.\n";
  try {
    mkdirSync(join(root, "synthetic-1.0.0")); writeFileSync(join(root, "synthetic-1.0.0/LICENSE-MIT"), license);
    const archive = command("/usr/bin/tar", ["-czf", "-", "-C", root, "synthetic-1.0.0"]), checksum = sha256(archive);
    const lock = Buffer.from(`version = 4\n[[package]]\nname = "synthetic"\nversion = "1.0.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "${checksum}"\n`);
    const metadata = { resolve: { nodes: [{ id: "synthetic@1.0.0" }] }, packages: [{ id: "synthetic@1.0.0", name: "synthetic", version: "1.0.0", source: "registry+https://github.com/rust-lang/crates.io-index", license: "MIT", manifest_path: join(root, "Cargo.toml") }] };
    const result = rustNotices(metadata, lock, () => archive); expect(result.markdown).toContain(license); expect(result.manifest).toContain(checksum); expect(result.manifest).not.toContain(root);
    expect(() => rustNotices(metadata, lock, () => Buffer.from("substituted crate"))).toThrow("checksum");
    const other = structuredClone(metadata); other.packages[0]!.version = "2.0.0"; expect(() => rustNotices(other, lock, () => archive)).toThrow("lock");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("license supplements bind the exact crate, historical grant, attribution and checked text", () => {
  const text = Buffer.from("Synthetic original license grant"), hash = sha256(text), checksum = "a".repeat(64), sha = "b".repeat(40);
  const pkg = { name: "synthetic", version: "1.0.0", repository: "https://github.com/synthetic/project", license: "MIT", authors: ["Synthetic Author"] }, vcs = { git: { sha1: sha }, path_in_vcs: "crate" };
  const source = { kind: "upstream-grant", url: `https://raw.githubusercontent.com/synthetic/project/${sha}/LICENSE`, file: `${hash}.txt`, sha256: hash, bytes: text.length };
  const row = { ...pkg, crateSha256: checksum, vcs, sources: [source] };
  expect(admitSupplement(row, pkg, checksum, vcs, () => text).files).toEqual([{ path: source.url, sha256: hash, origin: "upstream-grant" }]);
  for (const delta of [{ crateSha256: "c".repeat(64) }, { vcs: { git: { sha1: "c".repeat(40) } } }, { authors: ["Invented Copyright"] }, { extra: true }, { sources: [{ ...source, url: source.url.replace(sha, "main") }] }, { sources: [{ ...source, file: "../LICENSE" }] }, { sources: [{ ...source, kind: "standard-license", url: "https://raw.githubusercontent.com/spdx/license-list-data/v3.27.0/text/MIT.txt" }] }]) expect(() => admitSupplement({ ...row, ...delta }, pkg, checksum, vcs, () => text)).toThrow();
  expect(() => admitSupplement(row, pkg, checksum, vcs, () => Buffer.from("replacement"))).toThrow("bytes");
});
