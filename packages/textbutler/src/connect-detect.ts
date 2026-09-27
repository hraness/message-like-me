/** Finds an installed Ghostget, and the Bun that runs it, for the guided
 * connect step (T10), so the owner confirms a path instead of typing one.
 *
 * Detection only reads file metadata and at most the first 256 bytes of a
 * candidate. It never runs Ghostget, reads its sign-ins or touches the
 * keychain. Setup still checks the chosen paths itself before saving them. */
import { constants } from "node:fs";
import { access, lstat, open, realpath, stat } from "node:fs/promises";
import { basename, delimiter, isAbsolute, join } from "node:path";

export interface ConnectorEnvironment {
  home: string;
  /** The caller's PATH. The installed command runs with a minimal PATH, so the usual install folders are searched too. */
  path?: string;
  /** The runtime running this process, when it is Bun. */
  execPath?: string;
  uid?: number;
}

export interface DetectedConnector {
  /** Physical Ghostget executable or entrypoint. */
  ghostget?: string;
  /** Physical Bun, when Ghostget is a TypeScript or JavaScript entrypoint. */
  runtime?: string;
  /** Ghostget was found but needs Bun, and no usable Bun was found. */
  needsRuntime: boolean;
  /** A Ghostget that setup won't run because other users can change it. */
  unsafe?: string;
}

export function currentConnectorEnvironment(): ConnectorEnvironment {
  return { home: process.env.HOME ?? "", path: process.env.PATH ?? "", execPath: process.execPath, ...(process.getuid ? { uid: process.getuid() } : {}) };
}

/** The folders Ghostget and Bun are usually installed in, first match wins. */
function searchFolders(env: ConnectorEnvironment): string[] {
  const folders = [
    ...(env.path ?? "").split(delimiter),
    ...(isAbsolute(env.home) ? [join(env.home, ".bun", "bin"), join(env.home, ".local", "bin")] : []),
    "/opt/homebrew/bin", "/usr/local/bin",
  ].filter(folder => isAbsolute(folder));
  return [...new Set(folders)].slice(0, 64);
}

/** The physical file behind `candidate`. `safe` when setup would accept it: a
 * regular file owned by this user or root, not writable by group or others. */
async function physical(candidate: string, uid: number | undefined): Promise<{ path: string; safe: boolean } | undefined> {
  try {
    await lstat(candidate);
    const path = await realpath(candidate);
    const info = await stat(path);
    if (!info.isFile()) return undefined;
    return { path, safe: (info.mode & 0o022) === 0 && (uid === undefined || info.uid === uid || info.uid === 0) };
  } catch { return undefined; }
}

const SCRIPT = /\.(?:[cm]?[jt]s|tsx)$/u;

/** A script entrypoint (by extension or a Bun shebang) runs through Bun. */
export async function needsBun(path: string): Promise<boolean> {
  if (SCRIPT.test(path)) return true;
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const buffer = Buffer.alloc(256), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const first = buffer.subarray(0, bytesRead).toString("latin1").split("\n")[0] ?? "";
    return first.startsWith("#!") && /\bbun\b/u.test(first);
  } catch { return false; }
  finally { await handle?.close(); }
}

async function executable(path: string): Promise<boolean> {
  try { await access(path, constants.X_OK); return true; } catch { return false; }
}

export async function detectConnector(env: ConnectorEnvironment = currentConnectorEnvironment()): Promise<DetectedConnector> {
  const folders = searchFolders(env);
  let ghostget: string | undefined, unsafe: string | undefined;
  for (const folder of folders) {
    const found = await physical(join(folder, "ghostget"), env.uid);
    if (found?.safe) { ghostget = found.path; break; }
    unsafe ??= found?.path;
  }
  const none: DetectedConnector = { needsRuntime: false, ...(unsafe === undefined ? {} : { unsafe }) };
  if (ghostget === undefined) return none;
  if (!await needsBun(ghostget)) return await executable(ghostget) ? { ghostget, needsRuntime: false } : none;
  const runtime = await detectBun(env, folders);
  return runtime === undefined ? { ghostget, needsRuntime: true } : { ghostget, runtime, needsRuntime: false };
}

/** The Bun that runs this process, or the first usable one in the usual folders. */
export async function detectBun(env: ConnectorEnvironment = currentConnectorEnvironment(), folders = searchFolders(env)): Promise<string | undefined> {
  const candidates = [...(env.execPath && basename(env.execPath) === "bun" ? [env.execPath] : []), ...folders.map(folder => join(folder, "bun"))];
  for (const candidate of candidates) {
    const found = await physical(candidate, env.uid);
    if (found?.safe && basename(found.path) === "bun" && await executable(found.path)) return found.path;
  }
  return undefined;
}
