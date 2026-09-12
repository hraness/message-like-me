import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

export const CODEX_HOST_BUN_VERSION = "1.3.14";
const MAX_EXECUTABLE_BYTES = 256 * 1024 * 1024;
export type CodexParentRuntimeBinding = Readonly<{
  /** Supplied by an independently admitted distribution, never derived here or from contact/owner JSON. */
  expectedSha256: string;
}>;
export type CodexHostRuntime = Readonly<{
  executablePath: string; version: "1.3.14"; platform: "darwin"; arch: "arm64"; sha256: string;
}>;
type RuntimeFacts = Readonly<{
  version: string | undefined; reportedVersion: string | undefined; platform: string; arch: string;
  uid: number | undefined; effectiveUid: number | undefined;
}>;

function admittedDigest(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) throw new Error("CODEX_HOST_PIN_INVALID");
  return value;
}

function bindingDigest(value: CodexParentRuntimeBinding): string {
  if (value === null || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).length !== 1) throw new Error("CODEX_HOST_BINDING_INVALID");
  const descriptor = Object.getOwnPropertyDescriptor(value, "expectedSha256");
  if (!descriptor || !("value" in descriptor)) throw new Error("CODEX_HOST_BINDING_INVALID");
  return admittedDigest(descriptor.value);
}

/** Pure internal validation seam. The actual entrypoint supplies these facts itself. */
export function assertCodexHostRuntimeFacts(facts: RuntimeFacts): void {
  if (facts.version !== CODEX_HOST_BUN_VERSION || facts.reportedVersion !== CODEX_HOST_BUN_VERSION
    || facts.platform !== "darwin" || facts.arch !== "arm64"
    || !Number.isSafeInteger(facts.uid) || Number(facts.uid) < 0 || facts.uid !== facts.effectiveUid) {
    throw new Error("CODEX_HOST_RUNTIME_UNSUPPORTED");
  }
}

function executableMetadata(value: BigIntStats, uid: number): void {
  if (!value.isFile() || value.isSymbolicLink() || value.nlink !== 1n || ![0n, BigInt(uid)].includes(value.uid)
    || (value.mode & 0o022n) !== 0n || (value.mode & 0o111n) === 0n || (value.mode & 0o6000n) !== 0n
    || value.size < 1n || value.size > BigInt(MAX_EXECUTABLE_BYTES)) throw new Error("CODEX_HOST_EXECUTABLE_INVALID");
}

/** Internal file-race predicate; alone this never admits a runtime or a digest. */
export function assertCodexHostFileStable(before: BigIntStats, ...observed: readonly BigIntStats[]): void {
  const fields = ["dev", "ino", "size", "mode", "uid", "gid", "nlink", "mtimeNs", "ctimeNs"] as const;
  for (const value of observed) {
    if (!value.isFile() || value.isSymbolicLink()
      || fields.some(field => value[field] !== before[field])) throw new Error("CODEX_HOST_EXECUTABLE_CHANGED");
  }
}

/** File-only verification for synthetic fixtures; no runtime identity or qualification is asserted. */
export async function inspectCodexHostExecutable(executablePath: string, expectedSha256: string): Promise<Readonly<{ executablePath: string; sha256: string }>> {
  const pin = admittedDigest(expectedSha256), uid = process.getuid?.();
  if (typeof executablePath !== "string" || !isAbsolute(executablePath) || resolve(executablePath) !== executablePath
    || Buffer.byteLength(executablePath) > 4096 || /[\x00-\x1f\x7f]/u.test(executablePath)) throw new Error("CODEX_HOST_PATH_INVALID");
  if (!Number.isSafeInteger(uid) || Number(uid) < 0) throw new Error("CODEX_HOST_RUNTIME_UNSUPPORTED");
  try {
    if (await realpath(executablePath) !== executablePath) throw new Error("CODEX_HOST_PATH_INVALID");
    const initial = await lstat(executablePath, { bigint: true });
    executableMetadata(initial, uid!);
    const handle = await open(executablePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await handle.stat({ bigint: true });
      executableMetadata(before, uid!);
      assertCodexHostFileStable(initial, before);
      const digest = createHash("sha256"), buffer = Buffer.alloc(64 * 1024), size = Number(before.size);
      let readBytes = 0;
      // One extra byte detects growth; the fixed buffer avoids allocating from unchecked file metadata.
      while (readBytes <= size) {
        const limit = Math.min(buffer.length, size + 1 - readBytes);
        const read = await handle.read(buffer, 0, limit, readBytes);
        if (!Number.isSafeInteger(read.bytesRead) || read.bytesRead < 0 || read.bytesRead > limit) throw new Error("CODEX_HOST_EXECUTABLE_CHANGED");
        if (!read.bytesRead) break;
        readBytes += read.bytesRead;
        digest.update(buffer.subarray(0, read.bytesRead));
      }
      const after = await handle.stat({ bigint: true });
      if (await realpath(executablePath) !== executablePath) throw new Error("CODEX_HOST_EXECUTABLE_CHANGED");
      const current = await lstat(executablePath, { bigint: true }), final = await handle.stat({ bigint: true });
      assertCodexHostFileStable(before, after, current, final);
      if (readBytes !== size) throw new Error("CODEX_HOST_EXECUTABLE_CHANGED");
      const sha256 = digest.digest("hex");
      if (sha256 !== pin) throw new Error("CODEX_HOST_PIN_MISMATCH");
      return Object.freeze({ executablePath, sha256 });
    } finally { await handle.close(); }
  } catch (error) {
    // Do not copy platform errors containing local paths into bounded custody diagnostics.
    if (error instanceof Error && /^CODEX_HOST_(?:PATH_INVALID|EXECUTABLE_INVALID|EXECUTABLE_CHANGED|PIN_MISMATCH)$/u.test(error.message)) throw error;
    throw new Error("CODEX_HOST_FILE_IO_FAILED");
  }
}

/**
 * Match the actual parent Bun executable to a previously admitted artifact pin.
 * There is no executable/facts override, discovery, subprocess, or self-admission path.
 * This records filesystem/runtime identity at inspection time; it is not a provenance
 * proof, inspection of already loaded machine code, or a sandbox qualification.
 */
export async function inspectCodexHostRuntime(binding: CodexParentRuntimeBinding): Promise<CodexHostRuntime> {
  const expectedSha256 = bindingDigest(binding), executablePath = process.execPath;
  const facts = {
    version: typeof Bun === "undefined" ? undefined : Bun.version, reportedVersion: process.versions.bun,
    platform: process.platform, arch: process.arch, uid: process.getuid?.(), effectiveUid: process.geteuid?.(),
  };
  assertCodexHostRuntimeFacts(facts);
  const executable = await inspectCodexHostExecutable(executablePath, expectedSha256);
  return Object.freeze({ ...executable, version: CODEX_HOST_BUN_VERSION, platform: "darwin", arch: "arm64" });
}
