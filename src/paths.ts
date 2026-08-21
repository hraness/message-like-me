import { randomBytes } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  stat,
  unlink,
} from "node:fs/promises";
import { homedir, platform } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { CliError } from "./errors.ts";

export type DataPaths = Readonly<{
  root: string;
  database: string;
  installKey: string;
  packets: string;
}>;

export function defaultDataDirectory(): string {
  const override = process.env.XDG_DATA_HOME;
  if (override !== undefined && override.trim() !== "") {
    if (!isAbsolute(override)) {
      throw new CliError("unsafe-path", "XDG_DATA_HOME must be absolute");
    }
    return join(resolve(override), "message-like-me");
  }
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "Message Like Me");
  }
  return join(homedir(), ".local", "share", "message-like-me");
}

export function dataPaths(explicit?: string): DataPaths {
  if (explicit !== undefined && !isAbsolute(explicit)) {
    throw new CliError("unsafe-path", "Data directory must be absolute");
  }
  const root = explicit === undefined ? defaultDataDirectory() : resolve(explicit);
  if (!isAbsolute(root)) throw new CliError("unsafe-path", "Data directory must be absolute");
  return {
    root,
    database: join(root, "message-like-me.sqlite3"),
    installKey: join(root, "install.key"),
    packets: join(root, "study-packets"),
  };
}

async function existingType(path: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function assertOwned(path: string): Promise<void> {
  if (typeof process.getuid !== "function") return;
  const metadata = await stat(path);
  if (metadata.uid !== process.getuid()) {
    throw new CliError("unsafe-path", `${path} is not owned by the current user`);
  }
}

export async function ensurePrivateDirectory(path: string): Promise<string> {
  const before = await existingType(path);
  if (before?.isSymbolicLink()) throw new CliError("unsafe-path", `${path} must not be a symbolic link`);
  if (before !== null && !before.isDirectory()) {
    throw new CliError("unsafe-path", `${path} must be a directory`);
  }
  await mkdir(path, { recursive: true, mode: 0o700 });
  const after = await lstat(path);
  if (after.isSymbolicLink() || !after.isDirectory()) {
    throw new CliError("unsafe-path", `${path} is not a physical directory`);
  }
  await assertOwned(path);
  await chmod(path, 0o700);
  return realpath(path);
}

export async function initializeDataPaths(paths: DataPaths): Promise<DataPaths> {
  const physicalRoot = await ensurePrivateDirectory(paths.root);
  const physicalPackets = await ensurePrivateDirectory(join(physicalRoot, "study-packets"));
  return {
    root: physicalRoot,
    database: join(physicalRoot, basename(paths.database)),
    installKey: join(physicalRoot, basename(paths.installKey)),
    packets: physicalPackets,
  };
}

export async function assertPrivateRegularFile(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new CliError("unsafe-path", `${path} must be a physical regular file`);
  }
  await assertOwned(path);
  await chmod(path, 0o600);
}

export async function loadOrCreateInstallKey(path: string): Promise<Uint8Array> {
  const current = await existingType(path);
  if (current !== null) {
    await assertPrivateRegularFile(path);
    const encoded = (await readFile(path, "utf8")).trim();
    if (!/^[a-f0-9]{64}$/u.test(encoded)) {
      throw new CliError("invalid-data", `${path} contains an invalid installation key`);
    }
    return Uint8Array.from(Buffer.from(encoded, "hex"));
  }

  const key = randomBytes(32);
  try {
    const handle = await open(path, "wx", 0o600);
    try {
      await handle.writeFile(`${key.toString("hex")}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await assertPrivateRegularFile(path);
    await syncDirectory(dirname(path));
    return Uint8Array.from(key);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return loadOrCreateInstallKey(path);
    throw error;
  }
}

async function privateOutputDirectory(path: string): Promise<string> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const requested = await lstat(path);
  if (requested.isSymbolicLink() || !requested.isDirectory()) {
    throw new CliError("unsafe-path", `${path} must be a physical directory`);
  }
  await assertOwned(path);
  if ((requested.mode & 0o077) !== 0) {
    throw new CliError(
      "unsafe-path",
      `${path} must already have private permissions; refusing to change a caller-owned directory`,
    );
  }
  return realpath(path);
}

async function syncDirectory(path: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(path, "r");
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EINVAL" && code !== "ENOTSUP" && code !== "EISDIR" && code !== "EPERM") {
      throw error;
    }
  } finally {
    await handle?.close();
  }
}

export async function atomicWritePrivate(path: string, bytes: string | Uint8Array): Promise<void> {
  const parent = await privateOutputDirectory(dirname(resolve(path)));
  const destination = join(parent, basename(path));
  const temporary = join(parent, `.${basename(path)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
  let published = false;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.chmod(0o600);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(temporary, destination);
    published = true;
    await unlink(temporary);
    await assertPrivateRegularFile(destination);
    await syncDirectory(parent);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    if (published) {
      await unlink(destination).catch(() => undefined);
      await syncDirectory(parent).catch(() => undefined);
    }
    throw error;
  }
}
