import { constants as fsConstants, type Stats } from "node:fs";
import { lstat, open } from "node:fs/promises";

import { CliError } from "./errors.ts";

function sameFile(
  left: Readonly<{ dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number }>,
  right: Readonly<{ dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number }>,
): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function assertPrivateMetadata(
  metadata: Stats,
  label: string,
  maximumBytes: number,
): void {
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1) {
    throw new CliError("unsafe-path", `${label} must be one physical regular file`);
  }
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
    throw new CliError("unsafe-path", `${label} must be owned by the current user`);
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new CliError("unsafe-path", `${label} must already have owner-only permissions`);
  }
  if (metadata.size < 1 || metadata.size > maximumBytes) {
    throw new CliError("invalid-data", `${label} must be within its private file-size bound`);
  }
}

/** Reads one owner-only file while proving its path and bytes remained stable. */
export async function readStablePrivateFile(
  path: string,
  label: string,
  maximumBytes: number,
): Promise<Uint8Array> {
  let before: Awaited<ReturnType<typeof lstat>>;
  try {
    before = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new CliError("not-found", `${label} does not exist`, { cause: error });
    }
    throw new CliError("permission", `${label} cannot be inspected safely`, { cause: error });
  }
  assertPrivateMetadata(before, label, maximumBytes);

  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    throw new CliError("unsafe-path", `${label} could not be opened without following links`, { cause: error });
  }
  try {
    const opened = await handle.stat();
    assertPrivateMetadata(opened, label, maximumBytes);
    if (!sameFile(before, opened)) {
      throw new CliError("unsafe-path", `${label} changed before it was read`);
    }
    const bytes = await handle.readFile();
    const afterHandle = await handle.stat();
    let afterPath: Awaited<ReturnType<typeof lstat>>;
    try {
      afterPath = await lstat(path);
    } catch (error) {
      throw new CliError("unsafe-path", `${label} changed while it was read`, { cause: error });
    }
    if (
      bytes.byteLength !== opened.size
      || !sameFile(opened, afterHandle)
      || !sameFile(opened, afterPath)
    ) throw new CliError("unsafe-path", `${label} changed while it was read`);
    return Uint8Array.from(bytes);
  } finally {
    await handle.close();
  }
}

export async function readStablePrivateJson(
  path: string,
  label: string,
  maximumBytes: number,
): Promise<unknown> {
  const bytes = await readStablePrivateFile(path, label, maximumBytes);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new CliError("invalid-data", `${label} must be canonical UTF-8 JSON`, { cause: error });
  }
  if (text.charCodeAt(0) === 0xfeff || text.includes("\r")) {
    throw new CliError("invalid-data", `${label} must be canonical UTF-8 JSON without BOM or CR bytes`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new CliError("invalid-data", `${label} is malformed JSON`, { cause: error });
  }
}
