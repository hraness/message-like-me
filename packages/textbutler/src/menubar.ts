import { chmod, copyFile, lstat, mkdir, realpath, rename, unlink } from "node:fs/promises";
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

async function executable(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    // Packaged app binaries are commonly 0755. Reject shared writes while
    // allowing the read/execute bits needed by an app bundle.
    if (!info.isFile() || info.isSymbolicLink() || info.uid !== (process.getuid?.() ?? -1) || (info.mode & 0o022) !== 0 || (info.mode & 0o111) === 0) return false;
    return await realpath(path) === path;
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
  if (!(await executable(source))) throw new Error("The prebuilt Textbutler menu-bar binary is missing or unsafe.");
  const target = installedMenuBarBinary(home);
  const directory = dirname(target);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryInfo = await lstat(directory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || directoryInfo.uid !== (process.getuid?.() ?? -1) || (directoryInfo.mode & 0o077) !== 0 || await realpath(directory) !== directory) throw new Error("The Textbutler menu-bar directory is unsafe.");
  if (source === target) return target;
  const staged = `${target}.staging-${process.pid}`;
  await copyFile(source, staged);
  try { await chmod(staged, 0o700); await rename(staged, target); } finally { await unlink(staged).catch(() => {}); }
  if (!(await executable(target))) throw new Error("The installed Textbutler menu-bar binary could not be verified.");
  return target;
}

export async function runMenuBar(binary?: string): Promise<number> {
  if (process.platform !== "darwin") throw new Error("The Textbutler menu bar is supported on macOS only.");
  binary ??= await resolveMenuBarBinary();
  if (!(await executable(binary))) throw new Error("The Textbutler menu-bar binary is missing or unsafe; install the verified macOS distribution first.");
  const child = Bun.spawn([binary], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  return await child.exited;
}

export function createMenuBarLaunchAgentLifecycle(binary: string, base = defaultLaunchAgentHost()): LaunchAgentLifecycle {
  return createLaunchAgentLifecycle(defaultMenuBarLaunchAgentHost(binary, base));
}
