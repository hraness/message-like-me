import { readSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

export type ExtractedZipMember = Readonly<{ memberName: string; bytes: Uint8Array }>;

const EOCD = 0x06054b50;
const ZIP64_EOCD = 0x06064b50;
const ZIP64_LOCATOR = 0x07064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const DESCRIPTOR = 0x08074b50;
const ZIP64_EXTRA = 0x0001;
const STORED = 0;
const DEFLATE = 8;
const DESCRIPTOR_FLAG = 0x0008;
const UTF8_FLAG = 0x0800;
const ENCRYPTED_FLAG = 0x0001;
const STRONG_ENCRYPTION_FLAG = 0x0040;
const MASKED_HEADER_FLAG = 0x2000;
const DEFLATE_OPTION_FLAGS = 0x0006;
const UNIX_HOST = 3;
const MACOS_HOST = 19;
const UNIX_TYPE_MASK = 0o170000;
const UNIX_REGULAR = 0o100000;
const UNIX_DIRECTORY = 0o040000;
const DOS_DIRECTORY = 0x10;
const U16_MAX = 0xffff;
const U32_MAX = 0xffffffff;

export const MAX_X_ZIP_ARCHIVE_BYTES = 16 * 1024 * 1024 * 1024;
export const MAX_X_ZIP_MEMBER_BYTES = 256 * 1024 * 1024;
const MAX_X_COMPRESSED_MEMBER_BYTES = MAX_X_ZIP_MEMBER_BYTES;
const MAX_X_ENTRIES = 100_000;
const MAX_X_CENTRAL_BYTES = 64 * 1024 * 1024;
const MAX_X_TOTAL_SELECTED_BYTES = 512 * 1024 * 1024;
const MAX_X_TOTAL_DECLARED_BYTES = 64 * 1024 * 1024 * 1024;
const MAX_NAME_BYTES = 4 * 1024;
const MAX_RATIO = 1_000;

type Directory = Readonly<{ count: number; offset: number; end: number }>;
type Entry = Readonly<{
  name: string;
  nameBytes: Buffer;
  directory: boolean;
  selected: boolean;
  versionMadeBy: number;
  versionNeeded: number;
  flags: number;
  method: number;
  modifiedTime: number;
  modifiedDate: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  externalAttributes: number;
  localHeaderOffset: number;
}>;
type LocalRange = Readonly<{ dataOffset: number; dataEnd: number }>;

const X_POSTS = /(?:^|\/)data\/tweets(?:-part\d+)?\.js$/u;

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function updateCrc32(state: number, bytes: Uint8Array): number {
  let value = state;
  for (const byte of bytes) value = CRC32_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return value;
}
function checkedEnd(offset: number, length: number, label: string): number {
  const value = offset + length;
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || !Number.isSafeInteger(value) || value < offset) {
    throw new Error(`X ZIP ${label} has invalid bounds`);
  }
  return value;
}
function readExact(descriptor: number, offset: number, length: number, label: string): Buffer {
  checkedEnd(offset, length, label);
  const bytes = Buffer.allocUnsafe(length);
  let position = 0;
  while (position < length) {
    const count = readSync(descriptor, bytes, position, length - position, offset + position);
    if (count < 1) throw new Error(`X ZIP ${label} is truncated`);
    position += count;
  }
  return bytes;
}
function u64(bytes: Buffer, offset: number, label: string): number {
  if (offset < 0 || bytes.length - offset < 8) throw new Error(`X ZIP ${label} is truncated`);
  const value = bytes.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`X ZIP ${label} exceeds JavaScript's exact integer range`);
  return Number(value);
}
function fieldValue(legacy: number, resolved: number, sentinel: number, label: string): void {
  if (legacy !== sentinel && legacy !== resolved) throw new Error(`X ZIP legacy ${label} contradicts ZIP64 metadata`);
}

function directoryFromEocd(descriptor: number, archiveSize: number): Directory {
  const tailLength = Math.min(archiveSize, 22 + U16_MAX + 20);
  const tailOffset = archiveSize - tailLength;
  const tail = readExact(descriptor, tailOffset, tailLength, "end records");
  const candidates: number[] = [];
  for (let offset = tail.length - 22; offset >= 0; offset -= 1) {
    if (tail.readUInt32LE(offset) === EOCD && tailOffset + offset + 22 + tail.readUInt16LE(offset + 20) === archiveSize) {
      candidates.push(tailOffset + offset);
    }
  }
  if (candidates.length !== 1) {
    throw new Error(candidates.length === 0 ? "X ZIP end-of-central-directory record is missing" : "X ZIP end-of-central-directory record is ambiguous");
  }
  const eocdOffset = candidates[0]!;
  const eocd = readExact(descriptor, eocdOffset, archiveSize - eocdOffset, "end-of-central-directory record");
  if (eocd.length !== 22 || eocd.readUInt16LE(20) !== 0) throw new Error("X ZIP archive comments are not supported");
  const legacyDisk = eocd.readUInt16LE(4);
  const legacyCentralDisk = eocd.readUInt16LE(6);
  const legacyOnDisk = eocd.readUInt16LE(8);
  const legacyCount = eocd.readUInt16LE(10);
  const legacySize = eocd.readUInt32LE(12);
  const legacyOffset = eocd.readUInt32LE(16);
  const locatorOffset = eocdOffset - 20;
  const hasZip64 = locatorOffset >= 0 && readExact(descriptor, locatorOffset, 4, "ZIP64 locator signature").readUInt32LE(0) === ZIP64_LOCATOR;
  if (!hasZip64) {
    if ([legacyDisk, legacyCentralDisk, legacyOnDisk, legacyCount].includes(U16_MAX)
      || [legacySize, legacyOffset].includes(U32_MAX)) throw new Error("X ZIP archive is missing required ZIP64 end metadata");
    if (legacyDisk !== 0 || legacyCentralDisk !== 0 || legacyOnDisk !== legacyCount) throw new Error("X ZIP multi-disk archives are not supported");
    if (legacyCount < 1 || legacyCount > MAX_X_ENTRIES || legacySize > MAX_X_CENTRAL_BYTES) throw new Error("X ZIP central directory exceeds its bounds");
    const end = checkedEnd(legacyOffset, legacySize, "central directory");
    if (end !== eocdOffset) throw new Error("X ZIP central directory has invalid bounds");
    return { count: legacyCount, offset: legacyOffset, end };
  }
  const locator = readExact(descriptor, locatorOffset, 20, "ZIP64 locator");
  if (locator.readUInt32LE(4) !== 0 || locator.readUInt32LE(16) !== 1) throw new Error("X ZIP multi-disk archives are not supported");
  const zip64Offset = u64(locator, 8, "ZIP64 end record offset");
  const zip64 = readExact(descriptor, zip64Offset, 56, "ZIP64 end record");
  if (zip64.readUInt32LE(0) !== ZIP64_EOCD || u64(zip64, 4, "ZIP64 end record size") !== 44) {
    throw new Error("X ZIP64 end record has an unsupported shape");
  }
  if (zip64Offset + zip64.length !== locatorOffset || zip64.readUInt32LE(16) !== 0 || zip64.readUInt32LE(20) !== 0) {
    throw new Error("X ZIP64 end record has invalid bounds or disk ownership");
  }
  const onDisk = u64(zip64, 24, "ZIP64 entries on disk");
  const count = u64(zip64, 32, "ZIP64 entry count");
  const size = u64(zip64, 40, "ZIP64 central directory size");
  const offset = u64(zip64, 48, "ZIP64 central directory offset");
  if (onDisk !== count) throw new Error("X ZIP multi-disk archives are not supported");
  if (count < 1 || count > MAX_X_ENTRIES || size > MAX_X_CENTRAL_BYTES) throw new Error("X ZIP central directory exceeds its bounds");
  const end = checkedEnd(offset, size, "ZIP64 central directory");
  if (end !== zip64Offset) throw new Error("X ZIP64 central directory has invalid bounds");
  fieldValue(legacyDisk, 0, U16_MAX, "disk number");
  fieldValue(legacyCentralDisk, 0, U16_MAX, "central disk number");
  fieldValue(legacyOnDisk, onDisk, U16_MAX, "entries-on-disk count");
  fieldValue(legacyCount, count, U16_MAX, "entry count");
  fieldValue(legacySize, size, U32_MAX, "central directory size");
  fieldValue(legacyOffset, offset, U32_MAX, "central directory offset");
  return { count, offset, end };
}

function extraFields(bytes: Buffer, label: string): Map<number, Buffer> {
  const fields = new Map<number, Buffer>();
  let position = 0;
  while (position < bytes.length) {
    if (bytes.length - position < 4) throw new Error(`X ZIP ${label} contains a truncated extra field`);
    const id = bytes.readUInt16LE(position);
    const length = bytes.readUInt16LE(position + 2);
    const next = checkedEnd(position + 4, length, `${label} extra field`);
    if (next > bytes.length) throw new Error(`X ZIP ${label} contains a truncated extra field`);
    if (fields.has(id)) throw new Error(`X ZIP ${label} contains duplicate extra field ${id}`);
    fields.set(id, bytes.subarray(position + 4, next));
    position = next;
  }
  return fields;
}
function decodeName(nameBytes: Buffer, flags: number, selected: boolean): { name: string; directory: boolean } {
  if (nameBytes.length < 1 || nameBytes.length > MAX_NAME_BYTES) throw new Error("X ZIP member name exceeds its bounds");
  let decoded: string;
  if ((flags & UTF8_FLAG) !== 0) {
    try { decoded = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes); }
    catch (error) { throw new Error("X ZIP member name is not valid UTF-8", { cause: error }); }
  } else {
    if (nameBytes.some((byte) => byte > 0x7f)) throw new Error("X ZIP non-UTF-8 member names must be ASCII");
    decoded = nameBytes.toString("ascii");
  }
  if (decoded.normalize("NFC") !== decoded) throw new Error("X ZIP member name is not NFC-normalized");
  if (/^[A-Za-z]:\//u.test(decoded) || decoded.startsWith("/")) throw new Error("X ZIP member has an absolute name");
  if (decoded.includes("\\")) throw new Error("X ZIP member name contains a backslash");
  if (/[\u0000-\u001F\u007F-\u009F]/u.test(decoded)) throw new Error("X ZIP member name contains a control character");
  const directory = decoded.endsWith("/");
  const path = directory ? decoded.slice(0, -1) : decoded;
  const parts = path.split("/");
  if (parts.some((part) => part === "." || part === "..") || (selected && parts.some((part) => part === ""))) {
    throw new Error("X ZIP selected member has an unsafe path component");
  }
  return { name: decoded, directory };
}
function validateFlags(flags: number, method: number): void {
  if ((flags & (ENCRYPTED_FLAG | STRONG_ENCRYPTION_FLAG)) !== 0) throw new Error("X ZIP encrypted members are not supported");
  if ((flags & MASKED_HEADER_FLAG) !== 0) throw new Error("X ZIP members with masked local headers are not supported");
  const allowed = UTF8_FLAG | DESCRIPTOR_FLAG | (method === DEFLATE ? DEFLATE_OPTION_FLAGS : 0);
  if ((flags & ~allowed) !== 0) throw new Error("X ZIP member uses unsupported general-purpose flags");
}
function validateType(entry: Entry): void {
  const host = entry.versionMadeBy >>> 8;
  const unixType = host === UNIX_HOST || host === MACOS_HOST ? (entry.externalAttributes >>> 16) & UNIX_TYPE_MASK : 0;
  if (entry.directory) {
    if (entry.crc32 !== 0 || entry.uncompressedSize !== 0 || (entry.method === STORED && entry.compressedSize !== 0)) {
      throw new Error("X ZIP directory member must expand to empty data");
    }
    if (unixType !== 0 && unixType !== UNIX_DIRECTORY) throw new Error("X ZIP member is a symlink or another non-regular file");
  } else if ((entry.externalAttributes & DOS_DIRECTORY) !== 0 || (unixType !== 0 && unixType !== UNIX_REGULAR)) {
    throw new Error("X ZIP member is not a regular file");
  }
}
function selectedName(name: string): boolean {
  return X_POSTS.test(name);
}

function centralEntries(descriptor: number, directory: Directory, archiveSize: number): Entry[] {
  const bytes = readExact(descriptor, directory.offset, directory.end - directory.offset, "central directory");
  const entries: Entry[] = [];
  const names = new Set<string>();
  let declared = 0;
  let selectedTotal = 0;
  let position = 0;
  for (let index = 0; index < directory.count; index += 1) {
    if (bytes.length - position < 46 || bytes.readUInt32LE(position) !== CENTRAL) throw new Error("X ZIP central directory entry is invalid or truncated");
    const versionMadeBy = bytes.readUInt16LE(position + 4);
    const versionNeeded = bytes.readUInt16LE(position + 6);
    const flags = bytes.readUInt16LE(position + 8);
    const method = bytes.readUInt16LE(position + 10);
    const modifiedTime = bytes.readUInt16LE(position + 12);
    const modifiedDate = bytes.readUInt16LE(position + 14);
    const checksum = bytes.readUInt32LE(position + 16);
    const compressedLegacy = bytes.readUInt32LE(position + 20);
    const uncompressedLegacy = bytes.readUInt32LE(position + 24);
    const nameLength = bytes.readUInt16LE(position + 28);
    const extraLength = bytes.readUInt16LE(position + 30);
    const commentLength = bytes.readUInt16LE(position + 32);
    const diskLegacy = bytes.readUInt16LE(position + 34);
    const externalAttributes = bytes.readUInt32LE(position + 38);
    const offsetLegacy = bytes.readUInt32LE(position + 42);
    const next = checkedEnd(position + 46, nameLength + extraLength + commentLength, "central directory entry");
    if (next > bytes.length) throw new Error("X ZIP central directory entry is truncated");
    const nameBytes = Buffer.from(bytes.subarray(position + 46, position + 46 + nameLength));
    const extraStart = position + 46 + nameLength;
    const fields = extraFields(bytes.subarray(extraStart, extraStart + extraLength), `central directory entry ${index + 1}`);
    const zip64 = fields.get(ZIP64_EXTRA) ?? null;
    let zip64Position = 0;
    const nextZip64 = (label: string) => {
      if (zip64 === null) throw new Error(`X ZIP ${label} is missing ZIP64 metadata`);
      const value = u64(zip64, zip64Position, label); zip64Position += 8; return value;
    };
    const uncompressedSize = uncompressedLegacy === U32_MAX ? nextZip64("uncompressed size") : uncompressedLegacy;
    const compressedSize = compressedLegacy === U32_MAX ? nextZip64("compressed size") : compressedLegacy;
    const localHeaderOffset = offsetLegacy === U32_MAX ? nextZip64("local header offset") : offsetLegacy;
    let disk = diskLegacy;
    if (diskLegacy === U16_MAX) {
      if (zip64 === null || zip64.length - zip64Position < 4) throw new Error("X ZIP disk number is missing ZIP64 metadata");
      disk = zip64.readUInt32LE(zip64Position); zip64Position += 4;
    }
    if ((zip64 === null && zip64Position !== 0) || (zip64 !== null && zip64Position !== zip64.length)) {
      throw new Error("X ZIP central directory contains ambiguous ZIP64 metadata");
    }
    if (disk !== 0) throw new Error("X ZIP multi-disk archives are not supported");
    validateFlags(flags, method);
    if (method !== STORED && method !== DEFLATE) throw new Error(`X ZIP compression method ${method} is unsupported`);
    const provisionalName = decodeName(nameBytes, flags, false);
    const selected = !provisionalName.directory && selectedName(provisionalName.name);
    const decoded = selected ? decodeName(nameBytes, flags, true) : provisionalName;
    const entry: Entry = { name: decoded.name, nameBytes, directory: decoded.directory, selected, versionMadeBy, versionNeeded,
      flags, method, modifiedTime, modifiedDate, crc32: checksum, compressedSize, uncompressedSize,
      externalAttributes, localHeaderOffset };
    if (names.has(entry.name)) throw new Error("X ZIP archive contains duplicate member names");
    names.add(entry.name);
    if (![compressedSize, uncompressedSize, localHeaderOffset].every((value) => Number.isSafeInteger(value) && value >= 0)) {
      throw new Error("X ZIP member has an invalid size or offset");
    }
    if (compressedSize > archiveSize || localHeaderOffset >= directory.offset) throw new Error("X ZIP member exceeds archive bounds");
    if (method === STORED && compressedSize !== uncompressedSize) throw new Error("X ZIP stored member has inconsistent sizes");
    if (selected && (compressedSize < 1 || uncompressedSize < 1 || compressedSize > MAX_X_COMPRESSED_MEMBER_BYTES || uncompressedSize > MAX_X_ZIP_MEMBER_BYTES)) {
      throw new Error("selected X ZIP member exceeds its size bounds");
    }
    if (selected && uncompressedSize > compressedSize * MAX_RATIO) throw new Error("selected X ZIP member exceeds its compression-ratio limit");
    declared += uncompressedSize;
    if (!Number.isSafeInteger(declared) || declared > MAX_X_TOTAL_DECLARED_BYTES) throw new Error("X ZIP archive exceeds its declared uncompressed-size limit");
    if (selected) {
      selectedTotal += uncompressedSize;
      if (!Number.isSafeInteger(selectedTotal) || selectedTotal > MAX_X_TOTAL_SELECTED_BYTES) throw new Error("selected X ZIP members exceed their total size limit");
    }
    validateType(entry);
    entries.push(entry);
    position = next;
  }
  if (position !== bytes.length) throw new Error("X ZIP central directory contains unindexed data");
  return entries;
}

function localSizes(compressed: number, uncompressed: number, fields: Map<number, Buffer>, label: string): { compressed: number; uncompressed: number; zip64: boolean } {
  const zip64 = fields.get(ZIP64_EXTRA) ?? null;
  if (compressed !== U32_MAX && uncompressed !== U32_MAX) {
    if (zip64 !== null) throw new Error(`X ZIP ${label} contains redundant ZIP64 size metadata`);
    return { compressed, uncompressed, zip64: false };
  }
  if (zip64 === null) throw new Error(`X ZIP ${label} is missing ZIP64 size metadata`);
  let position = 0;
  let resolvedUncompressed = uncompressed;
  let resolvedCompressed = compressed;
  if (uncompressed === U32_MAX) { resolvedUncompressed = u64(zip64, position, `${label} uncompressed size`); position += 8; }
  if (compressed === U32_MAX) { resolvedCompressed = u64(zip64, position, `${label} compressed size`); position += 8; }
  if (position !== zip64.length) throw new Error(`X ZIP ${label} contains ambiguous ZIP64 size metadata`);
  return { compressed: resolvedCompressed, uncompressed: resolvedUncompressed, zip64: true };
}
function validateDescriptor(bytes: Buffer, entry: Entry): void {
  let position = 0;
  if (bytes.length === 16 || bytes.length === 24) {
    if (bytes.readUInt32LE(0) !== DESCRIPTOR) throw new Error("X ZIP data descriptor signature is invalid");
    position = 4;
  } else if (bytes.length !== 12 && bytes.length !== 20) throw new Error("X ZIP data descriptor has an invalid length");
  if (bytes.readUInt32LE(position) !== entry.crc32) throw new Error("X ZIP data descriptor checksum disagrees with the central directory");
  position += 4;
  const zip64 = bytes.length - position === 16;
  const compressed = zip64 ? u64(bytes, position, "descriptor compressed size") : bytes.readUInt32LE(position);
  position += zip64 ? 8 : 4;
  const uncompressed = zip64 ? u64(bytes, position, "descriptor uncompressed size") : bytes.readUInt32LE(position);
  if (compressed !== entry.compressedSize || uncompressed !== entry.uncompressedSize) throw new Error("X ZIP data descriptor sizes disagree with the central directory");
}

function localRanges(descriptor: number, entries: readonly Entry[], centralOffset: number): Map<number, LocalRange> {
  const ordered = [...entries].sort((left, right) => left.localHeaderOffset - right.localHeaderOffset);
  const ranges = new Map<number, LocalRange>();
  let expected = 0;
  for (const [index, entry] of ordered.entries()) {
    const label = `local member ${index + 1}`;
    const offset = entry.localHeaderOffset;
    if (offset !== expected) throw new Error(offset < expected ? "X ZIP local member ranges overlap" : "X ZIP archive contains unindexed local data");
    const header = readExact(descriptor, offset, 30, `${label} header`);
    if (header.readUInt32LE(0) !== LOCAL) throw new Error("X ZIP local header signature is invalid");
    const version = header.readUInt16LE(4);
    const flags = header.readUInt16LE(6);
    const method = header.readUInt16LE(8);
    const modifiedTime = header.readUInt16LE(10);
    const modifiedDate = header.readUInt16LE(12);
    const checksum = header.readUInt32LE(14);
    const compressedLegacy = header.readUInt32LE(18);
    const uncompressedLegacy = header.readUInt32LE(22);
    const nameLength = header.readUInt16LE(26);
    const extraLength = header.readUInt16LE(28);
    if (version !== entry.versionNeeded || flags !== entry.flags || method !== entry.method
      || modifiedTime !== entry.modifiedTime || modifiedDate !== entry.modifiedDate) throw new Error("X ZIP local header disagrees with the central directory");
    const variable = readExact(descriptor, offset + 30, nameLength + extraLength, `${label} fields`);
    if (!variable.subarray(0, nameLength).equals(entry.nameBytes)) throw new Error("X ZIP local member name disagrees with the central directory");
    const fields = extraFields(variable.subarray(nameLength), `${label} header`);
    const sizes = localSizes(compressedLegacy, uncompressedLegacy, fields, `${label} header`);
    if ((flags & DESCRIPTOR_FLAG) === 0) {
      if (checksum !== entry.crc32 || sizes.compressed !== entry.compressedSize || sizes.uncompressed !== entry.uncompressedSize) {
        throw new Error("X ZIP local sizes or checksum disagree with the central directory");
      }
    } else if ((checksum !== 0 && checksum !== entry.crc32)
      || (sizes.compressed !== 0 && sizes.compressed !== entry.compressedSize)
      || (sizes.uncompressed !== 0 && sizes.uncompressed !== entry.uncompressedSize)) {
      throw new Error("X ZIP local descriptor placeholders disagree with the central directory");
    }
    const dataOffset = checkedEnd(offset + 30, nameLength + extraLength, "local member data offset");
    const dataEnd = checkedEnd(dataOffset, entry.compressedSize, "local member compressed data");
    const next = index + 1 < ordered.length ? ordered[index + 1]!.localHeaderOffset : centralOffset;
    if (dataEnd > next) throw new Error("X ZIP local member ranges overlap");
    if ((flags & DESCRIPTOR_FLAG) === 0) {
      if (dataEnd !== next) throw new Error("X ZIP archive contains unindexed local data");
    } else {
      const descriptorLength = next - dataEnd;
      const allowedLengths = sizes.zip64 ? [20, 24] : [12, 16];
      if (!allowedLengths.includes(descriptorLength)) throw new Error("X ZIP data descriptor has an invalid width");
      validateDescriptor(readExact(descriptor, dataEnd, descriptorLength, `${label} descriptor`), entry);
    }
    ranges.set(offset, { dataOffset, dataEnd });
    expected = next;
  }
  if (expected !== centralOffset) throw new Error("X ZIP archive contains unindexed local data");
  return ranges;
}

function readSelected(descriptor: number, entry: Entry, range: LocalRange): ExtractedZipMember {
  const compressed = readExact(descriptor, range.dataOffset, range.dataEnd - range.dataOffset, `selected member ${entry.name}`);
  let output: Buffer;
  try {
    output = entry.method === STORED ? Buffer.from(compressed) : inflateRawSync(compressed, {
      maxOutputLength: Math.min(MAX_X_ZIP_MEMBER_BYTES + 1, entry.uncompressedSize + 1),
    });
  } catch (error) {
    throw new Error(`selected X ZIP member is invalid: ${entry.name}`, { cause: error });
  }
  if (output.length !== entry.uncompressedSize) throw new Error("selected X ZIP member has an incorrect output size");
  if (((updateCrc32(0xffffffff, output) ^ 0xffffffff) >>> 0) !== entry.crc32) throw new Error("selected X ZIP member failed its CRC-32 check");
  return { memberName: entry.name, bytes: output };
}

/** Strictly validate a large official X ZIP and read only authored-post JS members. */
export function extractXArchiveFile(descriptor: number, archiveSize: number): readonly ExtractedZipMember[] {
  if (!Number.isSafeInteger(descriptor) || descriptor < 0) throw new Error("X ZIP descriptor is invalid");
  if (!Number.isSafeInteger(archiveSize) || archiveSize < 1 || archiveSize > MAX_X_ZIP_ARCHIVE_BYTES) throw new Error("X archive size is invalid");
  const directory = directoryFromEocd(descriptor, archiveSize);
  const entries = centralEntries(descriptor, directory, archiveSize);
  const ranges = localRanges(descriptor, entries, directory.offset);
  const selected: ExtractedZipMember[] = [];
  for (const entry of entries) {
    if (!entry.selected) continue;
    const range = ranges.get(entry.localHeaderOffset);
    if (range === undefined) throw new Error("X ZIP selected member has no validated local range");
    selected.push(readSelected(descriptor, entry, range));
  }
  if (selected.length === 0) throw new Error("archive contains no supported data/tweets*.js member");
  return selected.sort((left, right) => left.memberName.localeCompare(right.memberName, "en"));
}
