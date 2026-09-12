import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

/** Fixed packaged host receipt. Owner/contact configuration cannot choose this
 * file. Distribution admission seals it with the outer app signature. */
export async function packagedProviderArtifact(entrypoint: string): Promise<Readonly<{ entrypoint: string; sha256: string }>> {
  if (!isAbsolute(entrypoint) || resolve(entrypoint) !== entrypoint || basename(entrypoint) !== "cli.ts" || await realpath(entrypoint) !== entrypoint) throw new Error("Invalid packaged runtime entrypoint");
  const root = dirname(entrypoint), directory = await lstat(root);
  if (!directory.isDirectory() || directory.isSymbolicLink() || ![0, process.getuid!()].includes(directory.uid) || (directory.mode & 0o022) !== 0 || await realpath(root) !== root) throw new Error("Invalid packaged runtime directory");
  const read = async (path: string, maximum: number): Promise<Buffer> => {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await file.stat();
      if (!before.isFile() || before.nlink !== 1 || ![0, process.getuid!()].includes(before.uid) || (before.mode & 0o022) !== 0 || before.size < 1 || before.size > maximum) throw new Error("Invalid packaged runtime file");
      const bytes = Buffer.alloc(before.size + 1); let size = 0;
      while (size < bytes.length) { const result = await file.read(bytes, size, bytes.length - size, size); if (!result.bytesRead) break; size += result.bytesRead; }
      const after = await file.stat(), current = await lstat(path), parent = await lstat(root);
      if (size !== before.size || after.dev !== before.dev || after.ino !== before.ino || after.nlink !== before.nlink || after.uid !== before.uid || after.mode !== before.mode || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || current.isSymbolicLink() || current.dev !== before.dev || current.ino !== before.ino || parent.dev !== directory.dev || parent.ino !== directory.ino || parent.mode !== directory.mode || parent.uid !== directory.uid || await realpath(root) !== root) throw new Error("Packaged runtime changed while reading");
      return bytes.subarray(0, size);
    } finally { await file.close(); }
  };
  const manifestBytes = await read(join(root, "runtime-manifest.json"), 65_536);
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes));
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join() !== "bunVersion,files,schema") throw new Error("Invalid packaged runtime receipt");
  const manifest = value as Record<string, unknown>;
  if (manifest.schema !== "textbutler.runtime.v1" || manifest.bunVersion !== "1.3.14" || Bun.version !== manifest.bunVersion || !Array.isArray(manifest.files) || manifest.files.length > 200) throw new Error("Packaged runtime version is not admitted");
  const entries = manifest.files.filter((entry: unknown) => entry && typeof entry === "object" && !Array.isArray(entry) && (entry as Record<string, unknown>).path === "cli.ts");
  if (entries.length !== 1) throw new Error("Packaged entrypoint receipt is missing or repeated");
  const entry = entries[0] as Record<string, unknown>;
  if (Object.keys(entry).sort().join() !== "bytes,macho,path,sha256" || entry.macho !== false || typeof entry.bytes !== "number" || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > 64 * 1024 * 1024 || typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(entry.sha256)) throw new Error("Invalid packaged entrypoint receipt");
  const bytes = await read(entrypoint, 64 * 1024 * 1024);
  if (bytes.length !== entry.bytes || createHash("sha256").update(bytes).digest("hex") !== entry.sha256) throw new Error("Packaged entrypoint differs from its receipt");
  return Object.freeze({ entrypoint, sha256: entry.sha256 });
}
