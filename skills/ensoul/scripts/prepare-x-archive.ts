#!/usr/bin/env bun
/**
 * Prepare a bounded Ensoul source packet from account-authored X posts.
 *
 * Only allowlisted public-post members are opened. Direct messages, address
 * books, advertising data, media, and every other archive member remain unread.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fsyncSync,
  fstatSync,
  linkSync,
  lstatSync,
  openSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { ArchiveError, canonicalBytes, sha256Hex, type JsonObject, type JsonValue } from "./source-packet.ts";
import { extractXArchiveFile } from "./x-zip-file.ts";

export const SCHEMA_VERSION = "ensoul.source-packet.v1";
export const PAYLOAD_SCHEMA = "ensoul.x-authored-posts-source.v1";
export const MAX_POSTS = 2_000;
export const MAX_TEXT_CHARS = 50_000;
export const MAX_RECORD_CONTENT_BYTES = 32 * 1024;
export const MAX_TOTAL_CONTENT_BYTES = MAX_POSTS * MAX_RECORD_CONTENT_BYTES;
export const MAX_PACKET_BYTES = 128 * 1024 * 1024;

const POST_ID = /^[0-9]{1,20}$/u;
const JS_PREFIX = /^\s*(?:window\.)?YTD\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\s*=\s*/u;
const OFFSET_SUFFIX = /(?:Z|[+-][0-9]{2}:[0-9]{2})$/u;

type DateBound = Readonly<{ milliseconds: number; iso: string }>;
type PacketRecord = JsonObject & { id: string; occurredAt?: string; content: JsonObject; _member?: string };

function archiveError(error: unknown): ArchiveError {
  return error instanceof ArchiveError ? error : new ArchiveError(error instanceof Error ? error.message : String(error));
}

export function parseBound(value: string | undefined, flag: string): DateBound | undefined {
  if (value === undefined) return undefined;
  if (!OFFSET_SUFFIX.test(value)) throw new ArchiveError(`${flag} must include a timezone`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new ArchiveError(`${flag} must be an ISO-8601 timestamp`);
  return { milliseconds, iso: new Date(milliseconds).toISOString() };
}

export function parseCreatedAt(value: JsonValue | undefined): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const candidate = OFFSET_SUFFIX.test(value) || /(?:GMT|UTC|[+-][0-9]{4})/iu.test(value) ? value : `${value}Z`;
  const milliseconds = Date.parse(candidate);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : undefined;
}

export function parseJsArray(data: Uint8Array, memberName: string): JsonValue[] {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch (error) {
    throw new ArchiveError(`${memberName} is not UTF-8`, { cause: error });
  }
  const prefix = JS_PREFIX.exec(text);
  if (prefix === null) throw new ArchiveError(`${memberName} has an unsupported JavaScript wrapper`);
  let payload = text.slice(prefix[0].length).trim();
  if (payload.endsWith(";")) payload = payload.slice(0, -1).trimEnd();
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch (error) {
    throw new ArchiveError(`${memberName} does not contain valid JSON`, { cause: error });
  }
  if (!Array.isArray(value)) throw new ArchiveError(`${memberName} must contain an array`);
  return value as JsonValue[];
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function classifyPost(tweet: JsonObject, text: string): readonly [string, string] {
  if (text.startsWith("RT @")) return ["repost", "mixed"];
  if (tweet.in_reply_to_status_id || tweet.in_reply_to_status_id_str) return ["reply", "subject"];
  if (tweet.quoted_status_id || tweet.quoted_status_id_str) return ["quote_post", "subject"];
  return ["post", "subject"];
}

export function boundedContent(text: string): JsonObject {
  const points = Array.from(text);
  const candidate = points.slice(0, MAX_TEXT_CHARS);
  const initiallyTruncated = candidate.length !== points.length;
  const content = (length: number, truncated: boolean): JsonObject => ({
    text: candidate.slice(0, length).join(""),
    truncated,
  });
  const initial = content(candidate.length, initiallyTruncated);
  if (canonicalBytes(initial).byteLength <= MAX_RECORD_CONTENT_BYTES) return initial;
  let low = 0;
  let high = candidate.length;
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2);
    if (canonicalBytes(content(middle, true)).byteLength <= MAX_RECORD_CONTENT_BYTES) low = middle;
    else high = middle - 1;
  }
  return content(low, true);
}

export function postRecord(raw: JsonValue, memberName: string): PacketRecord | undefined {
  if (!isObject(raw)) return undefined;
  const nested = raw.tweet;
  const candidate = isObject(nested) ? nested : raw;
  const postId = candidate.id_str ?? candidate.id;
  const text = candidate.full_text ?? candidate.text;
  if ((typeof postId !== "string" && typeof postId !== "number") || typeof text !== "string") return undefined;
  if (typeof postId === "number" && !Number.isSafeInteger(postId)) return undefined;
  const postIdText = String(postId).trim();
  if (!POST_ID.test(postIdText) || text.trim() === "") return undefined;
  const content = boundedContent(text);
  const boundedText = String(content.text);
  const [kind, authorRole] = classifyPost(candidate, boundedText);
  const occurredAt = parseCreatedAt(candidate.created_at);
  if (occurredAt === undefined) return undefined;
  const semantic: PacketRecord = {
    id: `x:${postIdText}`,
    kind,
    authorRole,
    contentRole: kind === "repost" ? "forwarded" : "original",
    authorshipConfidence: "strong",
    sentStatus: "published",
    visibility: "public",
    sourceClass: "polished_self_presentation",
    content,
    provenance: {
      provider: "x-archive",
      operation: "account-authored-public-post-export",
      sourceId: `x-post:${postIdText}`,
      policyVersion: PAYLOAD_SCHEMA,
      contentSha256: sha256Hex(canonicalBytes(content)),
    },
    occurredAt,
  };
  semantic.digest = `sha256:${sha256Hex(canonicalBytes(semantic))}`;
  semantic._member = memberName;
  return semantic;
}

function roundRatioHalfEven(numerator: number, denominator: number): number {
  const quotient = Math.floor(numerator / denominator);
  const remainder = numerator - quotient * denominator;
  const doubled = remainder * 2;
  if (doubled < denominator) return quotient;
  if (doubled > denominator) return quotient + 1;
  return quotient % 2 === 0 ? quotient : quotient + 1;
}

export function chooseEvenly<T>(records: readonly T[], limit: number): T[] {
  if (records.length <= limit) return [...records];
  if (limit === 1) return [records.at(-1)!];
  return Array.from({ length: limit }, (_, index) =>
    records[roundRatioHalfEven(index * (records.length - 1), limit - 1)]!,
  );
}

function withoutPrivateMember(record: PacketRecord): JsonObject {
  const copy: JsonObject = { ...record };
  delete copy._member;
  return copy;
}

function equalRecords(left: PacketRecord, right: PacketRecord): boolean {
  return Buffer.from(canonicalBytes(withoutPrivateMember(left))).equals(Buffer.from(canonicalBytes(withoutPrivateMember(right))));
}

export function buildPacket(
  descriptor: number,
  archiveSize: number,
  options: Readonly<{ limit: number; after?: DateBound; before?: DateBound }>,
): Readonly<{ packet: JsonObject; receipt: JsonObject }> {
  const selectedHash = createHash("sha256");
  const collected: PacketRecord[] = [];
  let malformed = 0;
  let duplicateIds = 0;
  let inputRecords = 0;
  const members = extractXArchiveFile(descriptor, archiveSize);
  for (const member of members) {
    selectedHash.update(member.memberName, "utf8");
    selectedHash.update(Uint8Array.of(0));
    selectedHash.update(member.bytes);
    const rawRecords = parseJsArray(member.bytes, member.memberName);
    inputRecords += rawRecords.length;
    for (const raw of rawRecords) {
      const record = postRecord(raw, member.memberName);
      if (record === undefined) malformed += 1;
      else collected.push(record);
    }
  }

  const byId = new Map<string, PacketRecord>();
  for (const record of collected) {
    const previous = byId.get(record.id);
    if (previous !== undefined) {
      if (!equalRecords(previous, record)) throw new ArchiveError("archive contains conflicting records for one post ID");
      duplicateIds += 1;
      continue;
    }
    byId.set(record.id, record);
  }
  let records = [...byId.values()].sort((left, right) =>
    (left.occurredAt ?? "").localeCompare(right.occurredAt ?? "") || left.id.localeCompare(right.id),
  );
  records = records.filter((record) => {
    const milliseconds = Date.parse(record.occurredAt ?? "");
    if (!Number.isFinite(milliseconds)) return options.after === undefined && options.before === undefined;
    if (options.after !== undefined && milliseconds < options.after.milliseconds) return false;
    return options.before === undefined || milliseconds < options.before.milliseconds;
  });
  const eligibleRecords = records.length;
  records = chooseEvenly(records, options.limit);
  const publicRecords = records.map(withoutPrivateMember);
  const contentBytes = publicRecords.reduce((total, record) => total + canonicalBytes(record.content!).byteLength, 0);
  if (contentBytes > MAX_TOTAL_CONTENT_BYTES) throw new ArchiveError("selected post content exceeds the aggregate safety limit");

  const revision = selectedHash.digest("hex");
  const generatedAt = new Date().toISOString();
  const latest = publicRecords
    .map((record) => record.occurredAt)
    .filter((value): value is string => typeof value === "string")
    .sort()
    .at(-1);
  if (latest !== undefined && Date.parse(latest) > Date.parse(generatedAt)) {
    throw new ArchiveError("selected posts contain an occurrence time later than packet generation");
  }
  const limits: JsonObject = {
    maxRecords: options.limit,
    eligibleRecords,
    selection: "chronological-even-sample",
    afterInclusive: options.after?.iso ?? null,
    beforeExclusive: options.before?.iso ?? null,
    contentBytes,
    maxContentBytes: MAX_TOTAL_CONTENT_BYTES,
    selectedMembers: members.length,
    inputRecords,
    malformedRecordsSkipped: malformed,
    exactDuplicateRecordsSkipped: duplicateIds,
  };
  const scope: JsonObject = {
    adapter: "x-archive",
    payloadSchema: PAYLOAD_SCHEMA,
    completeness: eligibleRecords > options.limit ? "sampled" : malformed > 0 || duplicateIds > 0 ? "bounded" : "complete",
    sourceRevision: `sha256:${revision}`,
    limits,
  };
  if (latest !== undefined) scope.sourceCutoff = latest;
  const packet: JsonObject = {
    schemaVersion: SCHEMA_VERSION,
    digestCanonicalization: "JCS-RFC8785",
    packetId: `ensoul_x_${revision.slice(0, 24)}`,
    generatedAt,
    subject: {
      localId: `x-archive-owner:${revision.slice(0, 16)}`,
      kind: "owner",
      identityBasis: "User-authorized official account archive; the user must confirm archive ownership.",
    },
    scope,
    records: publicRecords,
    limitations: [
      "Only allowlisted data/tweets*.js members were opened; direct messages, address books, advertising data, media, deleted posts, and community posts were not accessed.",
      "Archive membership supports account authorship but does not prove that every embedded or quoted phrase was written by the subject; reposts are marked mixed.",
      "Public visibility describes the original post context and is not permission to republish content that may since have been deleted or restricted.",
      "Selection is bounded and chronological; counts do not measure importance, motive, or stable personality.",
    ],
  };
  packet.packetDigest = `sha256:${sha256Hex(canonicalBytes(packet))}`;
  return {
    packet,
    receipt: {
      schemaVersion: SCHEMA_VERSION,
      packetDigest: packet.packetDigest!,
      records: publicRecords.length,
      eligibleRecords,
      malformedRecordsSkipped: malformed,
      duplicateIdsSkipped: duplicateIds,
      contentBytes,
      maxContentBytes: MAX_TOTAL_CONTENT_BYTES,
      selectedMembers: members.length,
      inputRecords,
      exactDuplicateRecordsSkipped: duplicateIds,
      sourceRevision: scope.sourceRevision!,
    },
  };
}

export function writePrivateAtomic(path: string, data: Uint8Array): void {
  if (!isAbsolute(path)) throw new ArchiveError("--output must be an absolute path");
  const parent = dirname(path);
  const resolvedParent = resolve(parent);
  if (realpathSync.native(parent) !== resolvedParent) throw new ArchiveError("--output parent must not contain symbolic links");
  if (existsSync(path)) throw new ArchiveError("--output already exists");
  const temporary = join(parent, `.${path.slice(parent.length + 1)}.tmp-${randomUUID().replaceAll("-", "")}`);
  const noFollow = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow, 0o600);
    writeFileSync(descriptor, data);
    fsyncSync(descriptor);
    fchmodSync(descriptor, 0o600);
    closeSync(descriptor);
    descriptor = undefined;
    linkSync(temporary, path);
    const directoryDescriptor = openSync(parent, constants.O_RDONLY);
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try {
      unlinkSync(temporary);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
}

type CliArguments = Readonly<{
  archive: string;
  output: string;
  limit: number;
  after?: string;
  before?: string;
}>;

function usage(): string {
  return "usage: bun prepare-x-archive.ts <absolute-x-archive.zip> --output <absolute-new-packet.json> [--limit 2000] [--after ISO-8601] [--before ISO-8601]";
}

export function parseArguments(argv: readonly string[]): CliArguments {
  if (argv.includes("--help") || argv.includes("-h")) throw new ArchiveError(usage());
  const positional: string[] = [];
  let output: string | undefined;
  let limit = MAX_POSTS;
  let after: string | undefined;
  let before: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (!argument.startsWith("-")) {
      positional.push(argument);
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined) throw new ArchiveError(`missing value for ${argument}`);
    index += 1;
    if (argument === "--output") output = value;
    else if (argument === "--limit") {
      if (!/^[0-9]+$/u.test(value)) throw new ArchiveError("--limit must be an integer");
      limit = Number(value);
    } else if (argument === "--after") after = value;
    else if (argument === "--before") before = value;
    else throw new ArchiveError(`unknown option ${argument}`);
  }
  if (positional.length !== 1 || output === undefined) throw new ArchiveError(usage());
  return { archive: positional[0]!, output, limit, ...(after === undefined ? {} : { after }), ...(before === undefined ? {} : { before }) };
}

export function main(argv: readonly string[] = Bun.argv.slice(2)): number {
  let descriptor: number | undefined;
  try {
    const arguments_ = parseArguments(argv);
    if (!isAbsolute(arguments_.archive)) throw new ArchiveError("archive path must be absolute");
    const archiveInfo = lstatSync(arguments_.archive);
    if (!archiveInfo.isFile() || archiveInfo.isSymbolicLink()) throw new ArchiveError("archive path must be an existing regular non-symlink file");
    if (arguments_.limit < 1 || arguments_.limit > MAX_POSTS) {
      throw new ArchiveError(`--limit must be between 1 and ${MAX_POSTS}`);
    }
    const after = parseBound(arguments_.after, "--after");
    const before = parseBound(arguments_.before, "--before");
    if (after !== undefined && before !== undefined && after.milliseconds >= before.milliseconds) {
      throw new ArchiveError("--after must be earlier than --before");
    }
    const noFollow = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
    descriptor = openSync(arguments_.archive, constants.O_RDONLY | noFollow);
    const archiveSize = fstatSync(descriptor).size;
    const { packet, receipt } = buildPacket(descriptor, archiveSize, {
      limit: arguments_.limit,
      ...(after === undefined ? {} : { after }),
      ...(before === undefined ? {} : { before }),
    });
    closeSync(descriptor);
    descriptor = undefined;
    const payload = new TextEncoder().encode(`${JSON.stringify(packet, null, 2)}\n`);
    if (payload.byteLength > MAX_PACKET_BYTES) throw new ArchiveError("prepared packet exceeds the 128 MiB output safety limit");
    writePrivateAtomic(arguments_.output, payload);
    process.stdout.write(`${JSON.stringify({ ...receipt, output: arguments_.output })}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`error: ${archiveError(error).message}\n`);
    return 2;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

if (import.meta.main) process.exitCode = main();
