import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export const VERSION = "0.1.1";
export const IDENTIFIER = "app.textbutler.desktop";
export const ARCHIVE = `Textbutler-${VERSION}-macos-arm64.zip`;
export const TAG = `desktop-v${VERSION}-macos-arm64`;
export const BUN_VERSION = "1.3.14";
export const BUN_ENTITLEMENTS = Object.freeze({ "com.apple.security.cs.allow-jit": true });
export const requireValue: (value: unknown, message: string) => asserts value = (value, message) => { if (!value) throw new Error(message); };
export const sha256 = (value: Uint8Array | string): string => createHash("sha256").update(value).digest("hex");
export function object(value: unknown): Record<string, unknown> { requireValue(!!value && typeof value === "object" && !Array.isArray(value), "Expected an object"); return value as Record<string, unknown>; }
export function digest(value: unknown, length = 64): string { requireValue(typeof value === "string" && new RegExp(`^[a-f0-9]{${length}}$`, "u").test(value), "Invalid content digest"); return value; }
export function command(program: string, args: readonly string[], options: { cwd?: string; environment?: Record<string, string>; timeout?: number; maximum?: number; input?: string | Buffer } = {}): Buffer {
  const result = spawnSync(program, args, { cwd: options.cwd, env: options.environment ?? { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" }, input: options.input, stdio: ["pipe", "pipe", "pipe"], timeout: options.timeout ?? 30_000, killSignal: "SIGKILL", maxBuffer: options.maximum ?? 1024 * 1024 });
  // Never include argv or child output: signing commands can contain passwords.
  requireValue(result.error === undefined && result.status === 0 && result.signal === null, `Distribution command failed: ${program.split("/").at(-1)}`);
  return result.stdout;
}
export function readPhysical(path: string, maximum = 512 * 1024 * 1024): Buffer {
  requireValue(realpathSync(path) === resolve(path), "Resource path contains a link");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    requireValue(before.isFile() && before.nlink === 1 && before.size <= maximum && before.size >= 0 && (before.mode & 0o022) === 0, "Unsafe or oversized resource");
    const bytes = Buffer.alloc(before.size); let offset = 0;
    while (offset < bytes.length) { const count = readSync(fd, bytes, offset, bytes.length - offset, null); requireValue(count > 0, "Truncated resource"); offset += count; }
    requireValue(readSync(fd, Buffer.alloc(1), 0, 1, null) === 0, "Resource grew beyond its admitted size");
    const after = fstatSync(fd);
    requireValue(bytes.length === before.size && before.ino === after.ino && before.dev === after.dev && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs, "Resource changed while reading");
    return bytes;
  } finally { closeSync(fd); }
}
export type FileEntry = Readonly<{ path: string; bytes: number; sha256: string; macho: boolean }>;
export function isMachO(bytes: Uint8Array): boolean { return ["feedface", "feedfacf", "cefaedfe", "cffaedfe", "cafebabe", "bebafeca", "cafebabf", "bfbafeca"].includes(Buffer.from(bytes.subarray(0, 4)).toString("hex")); }
export function inventory(root: string): FileEntry[] {
  requireValue(realpathSync(root) === resolve(root) && lstatSync(root).isDirectory(), "Bundle root must be physical");
  let total = 0; const files: FileEntry[] = [];
  const walk = (directory: string, depth: number): void => {
    requireValue(depth <= 32, "Bundle tree exceeds depth bound");
    for (const name of readdirSync(directory).sort()) {
      requireValue(!/[\u0000-\u001f\u007f]/u.test(name), "Unsafe resource name");
      const path = join(directory, name), info = lstatSync(path);
      requireValue(!info.isSymbolicLink() && (info.mode & 0o022) === 0, "Linked or writable resource");
      if (info.isDirectory()) { walk(path, depth + 1); continue; }
      requireValue(files.length < 50_000, "Too many bundle resources");
      const bytes = readPhysical(path); total += bytes.length;
      requireValue(total <= 1024 * 1024 * 1024, "Bundle exceeds size bound");
      files.push({ path: relative(root, path), bytes: bytes.length, sha256: sha256(bytes), macho: isMachO(bytes) });
    }
  };
  walk(root, 0); return files;
}
export function assertRuntime(root: string): void {
  const manifest = object(JSON.parse(readPhysical(join(root, "runtime-manifest.json"), 1024 * 1024).toString("utf8")));
  requireValue(manifest.schema === "textbutler.runtime.v1" && manifest.bunVersion === BUN_VERSION && JSON.stringify(manifest.files) === JSON.stringify(inventory(root).filter(file => file.path !== "runtime-manifest.json")), "Runtime inventory mismatch");
  requireValue((manifest.files as FileEntry[]).some(file => file.path === "cli.ts") && (manifest.files as FileEntry[]).some(file => file.path === "textbutler-bun" && file.macho), "Packaged runtime is incomplete");
}
export type UnsignedReceipt = { schema: "textbutler.desktop-unsigned.v1"; repository: "hraness/message-like-me"; sourceSha: string; sourceTree: string; version: typeof VERSION; tag: typeof TAG; architecture: "arm64"; minimumMacOS: "14.5"; archive: { name: "unsigned.zip"; sha256: string; bytes: number }; bundleSha256: string };
export function parseUnsigned(value: unknown): UnsignedReceipt {
  const r = object(value), archive = object(r.archive);
  requireValue(Object.keys(r).sort().join(",") === "architecture,archive,bundleSha256,minimumMacOS,repository,schema,sourceSha,sourceTree,tag,version" && r.schema === "textbutler.desktop-unsigned.v1" && r.repository === "hraness/message-like-me" && r.version === VERSION && r.tag === TAG && r.architecture === "arm64" && r.minimumMacOS === "14.5", "Unsigned release coordinate mismatch");
  digest(r.sourceSha, 40); digest(r.sourceTree, 40); digest(r.bundleSha256);
  requireValue(Object.keys(archive).sort().join(",") === "bytes,name,sha256" && archive.name === "unsigned.zip" && Number.isSafeInteger(archive.bytes) && Number(archive.bytes) > 0 && Number(archive.bytes) <= 768 * 1024 * 1024, "Invalid unsigned archive"); digest(archive.sha256);
  return r as UnsignedReceipt;
}
export function loadUnsigned(directory: string, expectedReceipt: string, expectedSource: string): UnsignedReceipt {
  const raw = readPhysical(join(directory, "unsigned-manifest.json"), 1024 * 1024);
  requireValue(sha256(raw) === digest(expectedReceipt), "Unsigned handoff digest differs");
  const receipt = parseUnsigned(JSON.parse(raw.toString("utf8")));
  requireValue(receipt.sourceSha === digest(expectedSource, 40), "Unsigned source differs");
  const archive = readPhysical(join(directory, receipt.archive.name), 768 * 1024 * 1024);
  requireValue(archive.length === receipt.archive.bytes && sha256(archive) === receipt.archive.sha256 && readdirSync(directory).sort().join(",") === "unsigned-manifest.json,unsigned.zip", "Unsigned handoff inventory differs");
  return receipt;
}
