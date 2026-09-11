import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

export type GhostgetHostConfig = Readonly<{ executable: string; runtimeExecutable?: string; authId: string; stateHome?: string }>;
export type HostConfig = Readonly<{ schemaVersion: 1; ghostget?: GhostgetHostConfig }>;
function invalid(): never { throw new Error("Invalid private Textbutler host configuration"); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function path(value: unknown): string {
  if (typeof value !== "string" || !isAbsolute(value) || resolve(value) !== value || Buffer.byteLength(value) > 4096 || /[\u0000-\u001f\u007f]/u.test(value)) return invalid();
  return value;
}
export function parseHostConfig(value: unknown): HostConfig {
  const config = record(value);
  if (config.schemaVersion !== 1 || Object.keys(config).some(key => !["schemaVersion", "ghostget"].includes(key))) return invalid();
  if (config.ghostget === undefined) return Object.freeze({ schemaVersion: 1 });
  const ghostget = record(config.ghostget);
  if (Object.keys(ghostget).some(key => !["executable", "runtimeExecutable", "authId", "stateHome"].includes(key)) || typeof ghostget.authId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u.test(ghostget.authId)) return invalid();
  return Object.freeze({ schemaVersion: 1, ghostget: Object.freeze({ executable: path(ghostget.executable), authId: ghostget.authId,
    ...(ghostget.runtimeExecutable === undefined ? {} : { runtimeExecutable: path(ghostget.runtimeExecutable) }),
    ...(ghostget.stateHome === undefined ? {} : { stateHome: path(ghostget.stateHome) }),
  }) });
}
async function privateDirectory(directory: string): Promise<void> {
  const info = await lstat(directory);
  if (await realpath(directory) !== directory || !info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) invalid();
}
/** Reads only explicit owner configuration. It does not inspect accounts,
 * messages, contacts, credentials or provider permissions. Absence is disabled. */
export async function loadHostConfig(dataDirectory: string): Promise<HostConfig> {
  const root = resolve(dataDirectory), state = join(root, "state"), file = join(state, "host.json");
  await privateDirectory(root);
  try { await privateDirectory(state); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 1 }; throw error; }
  let handle;
  try { handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 1 }; throw error; }
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.uid !== process.getuid?.() || (before.mode & 0o077) !== 0 || before.size > 16_384) invalid();
    const bytes = Buffer.alloc(16_385); let size = 0;
    while (size < bytes.length) {
      const read = await handle.read(bytes, size, bytes.length - size, size);
      if (read.bytesRead === 0) break;
      size += read.bytesRead;
    }
    const after = await handle.stat(), current = await lstat(file);
    if (size > 16_384 || size !== before.size || before.dev !== current.dev || before.ino !== current.ino || current.isSymbolicLink() || after.nlink !== 1 || after.mode !== before.mode || after.uid !== before.uid || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) invalid();
    let input: unknown;
    try { input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size))); } catch { return invalid(); }
    return parseHostConfig(input);
  } finally { await handle.close(); }
}
