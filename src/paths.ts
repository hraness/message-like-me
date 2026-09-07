import { createHash, randomBytes } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync, unlinkSync, type Stats } from "node:fs";
import { sha256 } from "./canonical-json.ts";
import { PrivatePublicationError, type PublicationCleanup } from "./private-publication.ts";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  stat,
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

type FileIdentity = Readonly<{ dev: number; ino: number }>;
type PublishedIdentity = FileIdentity & Readonly<{ size: number; mtimeMs: number; ctimeMs: number }>;
export type PrivatePublication = Readonly<{ pathSha256: string; bytesSha256: string }>;
type PublicationCustody = Readonly<{ path: string; parent: string; directory: FileIdentity; file: PublishedIdentity }>;
const publicationCustody = new WeakMap<PrivatePublication, PublicationCustody>();

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function ownedRegular(metadata: Stats, maximumLinks = 1): boolean {
  return metadata.isFile() && !metadata.isSymbolicLink() && metadata.nlink >= 1
    && metadata.nlink <= maximumLinks && (metadata.mode & 0o777) === 0o600
    && (typeof process.getuid !== "function" || metadata.uid === process.getuid());
}

function ownedDirectory(path: string, expected: FileIdentity): boolean {
  const metadata = lstatSync(path);
  return metadata.isDirectory() && !metadata.isSymbolicLink() && sameIdentity(metadata, expected)
    && (metadata.mode & 0o777) === 0o700 && realpathSync(path) === path
    && (typeof process.getuid !== "function" || metadata.uid === process.getuid());
}

function matchesPublishedBytes(descriptor: number, size: number, expectedSha256: string): boolean {
  if (!Number.isSafeInteger(size) || size < 0) return false;
  const buffer = Buffer.allocUnsafe(64 * 1024);
  const hash = createHash("sha256");
  let offset = 0;
  while (offset <= size) {
    // The captured size plus one is a hard I/O budget, even if another process
    // grows the file after fstat. Never allocate according to its new size.
    const bytes = readSync(descriptor, buffer, 0, Math.min(buffer.length, size - offset + 1), offset);
    if (bytes === 0) return offset === size && hash.digest("hex") === expectedSha256;
    offset += bytes;
    if (offset > size) return false;
    hash.update(buffer.subarray(0, bytes));
  }
  return false;
}

function removeOwnedFile(path: string, identity: FileIdentity, parent: string, directory: FileIdentity,
  publication?: Readonly<{ file: PublishedIdentity; bytesSha256: string }>): PublicationCleanup {
  let descriptor: number | undefined;
  const remove = (): PublicationCleanup => {
  try {
    if (!ownedDirectory(parent, directory)) return "retained-changed";
    const before = lstatSync(path);
    if (!ownedRegular(before, publication === undefined ? 2 : 1) || !sameIdentity(before, identity)) return "retained-changed";
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    if (!sameIdentity(before, opened)) return "retained-changed";
    if (publication !== undefined && (
      opened.size !== publication.file.size || opened.mtimeMs !== publication.file.mtimeMs
      || opened.ctimeMs !== publication.file.ctimeMs || !matchesPublishedBytes(descriptor, publication.file.size, publication.bytesSha256)
    )) return "retained-changed";
    const after = lstatSync(path);
    const afterHandle = fstatSync(descriptor);
    if (!ownedDirectory(parent, directory) || !ownedRegular(after, publication === undefined ? 2 : 1)
      || !sameIdentity(opened, after) || !ownedRegular(afterHandle, publication === undefined ? 2 : 1)
      || opened.size !== afterHandle.size || opened.mtimeMs !== afterHandle.mtimeMs
      || opened.ctimeMs !== afterHandle.ctimeMs || after.size !== afterHandle.size
      || after.mtimeMs !== afterHandle.mtimeMs || after.ctimeMs !== afterHandle.ctimeMs) return "retained-changed";
    // No asynchronous yield separates the final path proof from removal. This
    // refuses observed swaps; it is not a kernel compare-and-unlink primitive.
    unlinkSync(path);
    return "removed";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "retained-unproven";
  }
  };
  const result = remove();
  if (descriptor !== undefined) {
    try { closeSync(descriptor); }
    catch { return result === "removed" ? "removed-unconfirmed" : "retained-unproven"; }
  }
  return result;
}

function capturePublication(path: string, parent: string, directory: FileIdentity,
  identity: FileIdentity, bytesSha256: string, size: number): PrivatePublication {
  const file = lstatSync(path);
  if (!ownedDirectory(parent, directory) || !ownedRegular(file) || !sameIdentity(file, identity) || file.size !== size) {
    throw new CliError("unsafe-path", "Private output identity changed during publication");
  }
  const publication = Object.freeze({ pathSha256: sha256(path), bytesSha256 });
  publicationCustody.set(publication, { path, parent, directory, file });
  return publication;
}

/** Removes only the exact owned publication; changed or unprovable paths stay untouched. */
export async function discardPrivatePublication(publication: PrivatePublication): Promise<PublicationCleanup> {
  const custody = publicationCustody.get(publication);
  if (custody === undefined) return "retained-unproven";
  const result = removeOwnedFile(custody.path, custody.file, custody.parent, custody.directory,
    { file: custody.file, bytesSha256: publication.bytesSha256 });
  if (result === "removed") {
    try { await syncDirectory(custody.parent); }
    catch { return "removed-unconfirmed"; }
  }
  return result;
}

/** Publishes without overwriting and returns custody derived from the created inode. */
export async function publishPrivateArtifact(path: string, bytes: string | Uint8Array): Promise<PrivatePublication> {
  const parent = await privateOutputDirectory(dirname(resolve(path)));
  const directory = lstatSync(parent);
  const destination = join(parent, basename(path));
  const temporary = join(parent, `.${basename(path)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
  const bytesSha256 = sha256(bytes);
  const size = typeof bytes === "string" ? Buffer.byteLength(bytes) : bytes.byteLength;
  let created: FileIdentity | null = null;
  let linked = false;
  let publication: PrivatePublication | null = null;
  try {
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      created = await handle.stat();
      await handle.writeFile(bytes);
      await handle.chmod(0o600);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (!ownedDirectory(parent, directory)) throw new CliError("unsafe-path", "Private output directory changed during publication");
    await link(temporary, destination);
    linked = true;
    const temporaryCleanup = removeOwnedFile(temporary, created, parent, directory);
    if (temporaryCleanup !== "removed") throw new CliError("unsafe-path", "Private output staging identity changed during publication");
    publication = capturePublication(destination, parent, directory, created, bytesSha256, size);
    await syncDirectory(parent);
    return publication;
  } catch (error) {
    const temporaryCleanup = created === null ? "missing" : removeOwnedFile(temporary, created, parent, directory);
    const stagingReports = temporaryCleanup === "missing" || temporaryCleanup === "removed" ? [] : [{
      pathSha256: sha256(temporary), bytesSha256, receipt: "not-attempted" as const, cleanup: temporaryCleanup,
    }];
    if (linked && created !== null) {
      if (publication === null) {
        try { publication = capturePublication(destination, parent, directory, created, bytesSha256, size); }
        catch { /* An unproved destination must remain untouched. */ }
      }
      const cleanup = publication === null ? "retained-unproven" : await discardPrivatePublication(publication);
      throw new PrivatePublicationError(error, [...stagingReports, { pathSha256: sha256(destination), bytesSha256, receipt: "not-attempted", cleanup }]);
    }
    if (stagingReports.length > 0) throw new PrivatePublicationError(error, stagingReports);
    throw error;
  }
}

/** Compatibility boundary for existing callers that do not need deferred receipt ownership. */
export async function atomicWritePrivate(path: string, bytes: string | Uint8Array): Promise<void> {
  await publishPrivateArtifact(path, bytes);
}
