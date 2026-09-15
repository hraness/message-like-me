import { lstat, mkdir, mkdtemp, open, realpath, rename, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { createLaunchAgentLifecycle, defaultLaunchAgentHost, defaultMenuBarLaunchAgentHost, type LaunchAgentLifecycle } from "./launch-agent.ts";

const BINARY_NAME = "textbutler-menubar";

/** Fixed distribution locations only. This command never invokes swiftc, Bun,
 * a package manager, or a source checkout build as a fallback. */
export function menuBarBinaryCandidates(home = homedir()): readonly string[] {
  const candidates = [join(home, "Library/Application Support/Textbutler/bin", BINARY_NAME)];
  const developmentBinary = process.env.TEXTBUTLER_MENUBAR_DEV_BINARY;
  return developmentBinary === undefined ? candidates : [...candidates, developmentBinary];
}

export function installedMenuBarBinary(home = homedir()): string {
  return join(home, "Library/Application Support/Textbutler/bin", BINARY_NAME);
}

async function executable(path: string, allowRoot = false): Promise<boolean> {
  try {
    const info = await lstat(path);
    // Packaged app binaries are commonly 0755. Reject shared writes while
    // allowing the read/execute bits needed by an app bundle.
    if (!info.isFile() || info.isSymbolicLink() || ![process.getuid?.() ?? -1, ...(allowRoot ? [0] : [])].includes(info.uid) || (info.mode & 0o022) !== 0 || (info.mode & 0o111) === 0) return false;
    const parent = await lstat(dirname(path));
    return parent.isDirectory() && !parent.isSymbolicLink() && [0, process.getuid?.() ?? -1].includes(parent.uid)
      && (parent.mode & 0o022) === 0 && await realpath(path) === path;
  } catch { return false; }
}

export async function resolveMenuBarBinary(candidates = menuBarBinaryCandidates()): Promise<string> {
  for (const candidate of candidates) if (await executable(candidate)) return candidate;
  throw new Error("The Textbutler menu-bar binary is not installed. Install the prebuilt CLI companion before using `textbutler menubar`.");
}

/** Copy a reviewed prebuilt binary into the stable per-user location. The
 * caller must provide the source path explicitly; no compiler or package
 * manager is ever invoked. */
export async function installMenuBarBinary(source: string, home = homedir()): Promise<string> {
  if (!(await executable(source, true))) throw new Error("The prebuilt Textbutler menu-bar binary is missing or unsafe.");
  const target = installedMenuBarBinary(home);
  const directory = dirname(target);
  // Create only one component below each freshly verified physical owner path.
  let parent = home;
  for (const component of ["", "Library", "Application Support", "Textbutler", "bin"]) {
    if (component) {
      parent = join(parent, component);
      try { await mkdir(parent, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    }
    const info = await lstat(parent);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o022) !== 0
      || await realpath(parent) !== parent || ["Textbutler", "bin"].includes(component) && (info.mode & 0o077) !== 0) throw new Error("The Textbutler menu-bar directory is unsafe.");
  }
  if (source === target) {
    if (!(await executable(target))) throw new Error("The installed menu-bar binary must be user-owned.");
    return target;
  }
  const sourceHandle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let scratch: string | undefined;
  try {
    scratch = await mkdtemp(join(directory, ".menubar-stage-"));
    const before = await sourceHandle.stat(), named = await lstat(source);
    if (!before.isFile() || ![0, process.getuid?.() ?? -1].includes(before.uid) || before.nlink !== 1 || (before.mode & 0o022) !== 0 || (before.mode & 0o111) === 0
      || before.size > 64 * 1024 * 1024 || named.dev !== before.dev || named.ino !== before.ino) throw new Error("The prebuilt Textbutler menu-bar binary is unsafe.");
    const bytes = Buffer.alloc(before.size + 1);
    const { bytesRead } = await sourceHandle.read(bytes, 0, bytes.length, 0);
    const after = await sourceHandle.stat();
    if (bytesRead !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.mode !== after.mode) throw new Error("The prebuilt menu-bar binary changed while reading.");
    const staged = join(scratch, BINARY_NAME);
    const output = await open(staged, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o700);
    try { await output.writeFile(bytes.subarray(0, bytesRead)); await output.sync(); } finally { await output.close(); }
    await rename(staged, target);
  } finally { await sourceHandle.close(); if (scratch !== undefined) await rm(scratch, { recursive: true, force: true }); }
  if (!(await executable(target))) throw new Error("The installed Textbutler menu-bar binary could not be verified.");
  return target;
}

export async function runMenuBar(binary?: string, dataDir?: string): Promise<number> {
  if (process.platform !== "darwin") throw new Error("The Textbutler menu bar is supported on macOS only.");
  binary ??= await resolveMenuBarBinary();
  if (!(await executable(binary, true))) throw new Error("The Textbutler menu-bar binary is missing or unsafe; install the verified macOS distribution first.");
  const child = Bun.spawn([binary, ...(dataDir === undefined ? [] : ["--data-dir", dataDir])], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  return await child.exited;
}

export function createMenuBarLaunchAgentLifecycle(binary: string, base = defaultLaunchAgentHost()): LaunchAgentLifecycle {
  return createLaunchAgentLifecycle(defaultMenuBarLaunchAgentHost(binary, base));
}
