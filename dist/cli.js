#!/usr/bin/env bun
// @bun
import {
  CORPUS_SCHEMA_VERSION,
  METRICS_SCHEMA_VERSION,
  PROFILE_SCHEMA_VERSION,
  STUDY_PACKET_SCHEMA_VERSION,
  canonicalJson,
  prettyJson,
  sha256
} from "./cli-d7rc3h6r.js";

// src/commands.ts
import { lstat as lstat3 } from "fs/promises";
import { isAbsolute as isAbsolute3, resolve as resolve4 } from "path";

// src/errors.ts
var EXIT_CODES = {
  usage: 2,
  "not-found": 3,
  conflict: 4,
  permission: 5,
  "unsafe-path": 6,
  "invalid-data": 7,
  internal: 1
};

class CliError extends Error {
  exitCode;
  kind;
  constructor(kind, message, options) {
    super(message, options);
    this.name = "CliError";
    this.kind = kind;
    this.exitCode = EXIT_CODES[kind];
  }
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function exitCodeFor(error) {
  return error instanceof CliError ? error.exitCode : 1;
}

// src/args.ts
var VALUE_OPTIONS = new Set([
  "burst-gap",
  "data-dir",
  "database",
  "limit",
  "min-outgoing",
  "output",
  "project",
  "scope",
  "session-gap",
  "target"
]);
var FLAG_OPTIONS = new Set(["force", "help", "json", "private", "version"]);
function parseArguments(argv) {
  const positionals = [];
  const options = new Map;
  const flags = new Set;
  let positionalOnly = false;
  for (let index = 0;index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined)
      continue;
    if (positionalOnly || !argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }
    if (argument === "--") {
      positionalOnly = true;
      continue;
    }
    const separator = argument.indexOf("=");
    const key = argument.slice(2, separator < 0 ? undefined : separator);
    if (key.length === 0)
      throw new CliError("usage", "Empty option name");
    if (VALUE_OPTIONS.has(key)) {
      if (options.has(key))
        throw new CliError("usage", `--${key} may be provided only once`);
      const inline = separator < 0 ? undefined : argument.slice(separator + 1);
      const next = inline ?? argv[index + 1];
      if (next === undefined || next.startsWith("--") || next.length === 0) {
        throw new CliError("usage", `--${key} requires a value`);
      }
      options.set(key, next);
      if (inline === undefined)
        index += 1;
      continue;
    }
    if (FLAG_OPTIONS.has(key) && separator < 0) {
      if (flags.has(key))
        throw new CliError("usage", `--${key} may be provided only once`);
      flags.add(key);
      continue;
    }
    throw new CliError("usage", `Unknown option --${key}`);
  }
  return { positionals, options, flags };
}
function integerOption(parsed, key, fallback, minimum, maximum) {
  const value = parsed.options.get(key);
  if (value === undefined)
    return fallback;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new CliError("usage", `--${key} must be an integer`);
  }
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new CliError("usage", `--${key} must be between ${minimum} and ${maximum}`);
  }
  return result;
}
function rejectUnused(parsed, allowedOptions, allowedFlags) {
  const options = new Set(allowedOptions);
  const flags = new Set(allowedFlags);
  for (const key of parsed.options.keys()) {
    if (!options.has(key))
      throw new CliError("usage", `--${key} is not valid for this command`);
  }
  for (const key of parsed.flags) {
    if (!flags.has(key))
      throw new CliError("usage", `--${key} is not valid for this command`);
  }
}

// src/imessage.ts
import { Database } from "bun:sqlite";
import { createHash, createHmac } from "crypto";
import {
  chmodSync,
  constants as fsConstants,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync
} from "fs";
import { homedir, tmpdir } from "os";
import { basename, isAbsolute, join, resolve } from "path";
var DEFAULT_IMESSAGE_DATABASE = join(homedir(), "Library", "Messages", "chat.db");
var APPLE_EPOCH_MILLISECONDS = Date.UTC(2001, 0, 1);
var DEFAULT_MAX_DATABASE_BYTES = 16 * 1024 * 1024 * 1024;
var MAX_CONFIGURABLE_DATABASE_BYTES = 64 * 1024 * 1024 * 1024;
var DEFAULT_MAX_MESSAGES = 5000000;
var MAX_CONFIGURABLE_MESSAGES = 1e7;
var DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
var MAX_CONFIGURABLE_BODY_BYTES = 16 * 1024 * 1024;
var DEFAULT_MAX_ATTRIBUTED_BODY_BYTES = 8 * 1024 * 1024;
var MAX_CONFIGURABLE_ATTRIBUTED_BODY_BYTES = 32 * 1024 * 1024;
var DEFAULT_PAGE_SIZE = 5000;
var MAX_PAGE_SIZE = 20000;
var MAX_HANDLES = 1e6;
var MAX_CHATS = 1e6;
var MAX_CHAT_HANDLE_JOINS = 5000000;
var MAX_TEXT_IDENTITY_BYTES = 4096;
var MAX_SQLITE_SHM_BYTES = 64 * 1024 * 1024;
var SOURCE_SNAPSHOT_ATTEMPTS = 5;
var TYPEDSTREAM_MARKER = new TextEncoder().encode("streamtyped");
var NSSTRING_MARKER = new TextEncoder().encode("NSString");
var WARNING_LABELS = Object.freeze([
  { category: "spamOrCorrupt", label: "excluded spam or corrupt messages" },
  { category: "unsupportedTimestamp", label: "excluded messages with unsupported timestamps" },
  { category: "missingConversation", label: "excluded messages without conversations" },
  {
    category: "multipleConversations",
    label: "messages joined to multiple conversations (lowest chat ROWID selected)"
  },
  {
    category: "missingSenderHandle",
    label: "incoming messages referencing missing sender handles"
  },
  {
    category: "unsupportedAttributedBody",
    label: "unsupported or over-bound attributed bodies"
  }
]);
function fail(message) {
  throw new Error(`iMessage source ${message}`);
}
function stableJson(value) {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map(stableJson).join(",")}]`;
  const record = value;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}
function sha2562(value) {
  return createHash("sha256").update(value).digest("hex");
}
function hmac(key, namespace, value) {
  return createHmac("sha256", key).update(`message-like-me\x00${namespace}\x00`, "utf8").update(value, "utf8").digest("hex");
}
function hmacKey(value) {
  const key = typeof value === "string" ? new TextEncoder().encode(value) : value;
  if (!(key instanceof Uint8Array) || key.byteLength < 16 || key.byteLength > 1024) {
    throw new Error("iMessage HMAC key must contain 16 through 1024 bytes");
  }
  return Uint8Array.from(key);
}
function boundedInteger(value, fallback, minimum, maximum, label) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}`);
  }
  return result;
}
function ownedByCurrentUser(stats) {
  return typeof process.getuid !== "function" || stats.uid === BigInt(process.getuid());
}
function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}
function inspectSource(path, maximumBytes) {
  const requested = resolve(path);
  const requestedStats = lstatSync(requested, { bigint: true });
  if (!requestedStats.isFile() || requestedStats.isSymbolicLink() || requestedStats.nlink !== 1n || !ownedByCurrentUser(requestedStats) || requestedStats.size < 1n || requestedStats.size > BigInt(maximumBytes)) {
    return fail("must be one current-user-owned regular non-symlink file within the configured size bound");
  }
  const physicalPath = realpathSync(requested);
  const physicalStats = lstatSync(physicalPath, { bigint: true });
  if (!sameFile(requestedStats, physicalStats)) {
    return fail("changed identity while its path was resolved");
  }
  return Object.freeze({ path: physicalPath, stats: physicalStats });
}
function optionalStats(path) {
  try {
    return lstatSync(path, { bigint: true });
  } catch (error) {
    if (error.code === "ENOENT")
      return null;
    throw error;
  }
}
function validateSidecar(path, stats, maximumBytes) {
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1n || !ownedByCurrentUser(stats) || stats.size < 0n || stats.size > BigInt(maximumBytes)) {
    return fail(`sidecar ${basename(path)} must be one current-user-owned regular non-symlink file within its size bound`);
  }
}
function snapshotMembers(source, maximumBytes) {
  const current = inspectSource(source.path, maximumBytes);
  if (!sameFile(source.stats, current.stats))
    return fail("changed identity before its snapshot was isolated");
  const members = [{ suffix: "", path: current.path, stats: current.stats }];
  for (const suffix of ["-wal", "-journal"]) {
    const path = `${source.path}${suffix}`;
    const stats = optionalStats(path);
    if (stats === null)
      continue;
    validateSidecar(path, stats, maximumBytes);
    members.push(Object.freeze({ suffix, path, stats }));
  }
  const shmPath = `${source.path}-shm`;
  const shm = optionalStats(shmPath);
  if (shm !== null)
    validateSidecar(shmPath, shm, MAX_SQLITE_SHM_BYTES);
  const totalBytes = members.reduce((total, member) => total + member.stats.size, 0n);
  if (totalBytes > BigInt(maximumBytes) * 2n) {
    return fail("database and transactional sidecars exceed the configured snapshot size bound");
  }
  return Object.freeze(members);
}
function sameSnapshotMembers(left, right) {
  return left.length === right.length && left.every((member, index) => {
    const other = right[index];
    return other !== undefined && member.suffix === other.suffix && sameFile(member.stats, other.stats) && member.stats.size === other.stats.size && member.stats.mtimeNs === other.stats.mtimeNs && member.stats.ctimeNs === other.stats.ctimeNs;
  });
}
function isolateSource(source, maximumBytes) {
  const temporaryRoot = tmpdir();
  if (!isAbsolute(temporaryRoot))
    return fail("requires an absolute temporary directory");
  const temporaryDirectory = mkdtempSync(join(temporaryRoot, "message-like-me-source-"));
  chmodSync(temporaryDirectory, 448);
  try {
    for (let attempt = 0;attempt < SOURCE_SNAPSHOT_ATTEMPTS; attempt += 1) {
      const before = snapshotMembers(source, maximumBytes);
      const attemptDirectory = join(temporaryDirectory, `attempt-${attempt}`);
      mkdirSync(attemptDirectory, { mode: 448 });
      let copyFailedForRace = false;
      try {
        for (const member of before) {
          const destination = join(attemptDirectory, `${basename(source.path)}${member.suffix}`);
          copyFileSync(member.path, destination, fsConstants.COPYFILE_EXCL | fsConstants.COPYFILE_FICLONE);
          chmodSync(destination, 384);
        }
      } catch (error) {
        const code = error.code;
        if (code === "ENOENT" || code === "ESTALE")
          copyFailedForRace = true;
        else
          throw error;
      }
      const after = snapshotMembers(source, maximumBytes);
      if (!copyFailedForRace && sameSnapshotMembers(before, after)) {
        return Object.freeze({
          source: Object.freeze({ path: source.path, stats: before[0].stats }),
          path: join(attemptDirectory, basename(source.path)),
          temporaryDirectory
        });
      }
      rmSync(attemptDirectory, { recursive: true, force: true });
    }
    return fail(`changed during ${SOURCE_SNAPSHOT_ATTEMPTS} attempts to isolate a consistent snapshot`);
  } catch (error) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}
function allRows(database, sql, ...bindings) {
  return database.query(sql).all(...bindings);
}
function getRow(database, sql, ...bindings) {
  return database.query(sql).get(...bindings);
}
function safeInteger(value, label, nullable = false) {
  if (nullable && value === null)
    return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    return fail(`${label} must be a safe integer`);
  }
  return value;
}
function flag(value, label, fallback = 0) {
  if (value === null)
    return fallback;
  const parsed = safeInteger(value, label);
  if (parsed !== 0 && parsed !== 1)
    return fail(`${label} must be zero or one`);
  return parsed;
}
function privateText(value, label, nullable = false, allowEmpty = false) {
  if (nullable && value === null)
    return null;
  if (typeof value !== "string" || !allowEmpty && value.length === 0 || Buffer.byteLength(value, "utf8") > MAX_TEXT_IDENTITY_BYTES || value.includes("\x00"))
    return fail(`${label} must be bounded text`);
  return value;
}
function bodyText(value, label, maximumBytes) {
  if (value === null)
    return null;
  if (typeof value !== "string")
    return fail(`${label} must be text or null`);
  if (Buffer.byteLength(value, "utf8") > maximumBytes) {
    return fail(`${label} exceeds the configured body bound`);
  }
  return value;
}
function blob(value, label) {
  if (value === null)
    return null;
  if (value instanceof Uint8Array)
    return Uint8Array.from(value);
  return fail(`${label} must be binary data or null`);
}
function tableColumns(database, table) {
  return allRows(database, `SELECT cid,name,type,"notnull",dflt_value,pk FROM pragma_table_info('${table}') ORDER BY cid`).map((row) => Object.freeze({
    cid: safeInteger(row.cid, `${table} column ordinal`),
    name: privateText(row.name, `${table} column name`),
    type: privateText(row.type, `${table} column type`, false, true),
    notnull: safeInteger(row.notnull, `${table} column nullability`),
    dflt_value: row.dflt_value,
    pk: safeInteger(row.pk, `${table} column primary-key position`)
  }));
}
function tableNames(database) {
  return new Set(allRows(database, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map((row) => privateText(row.name, "table name")));
}
function inspectSchema(database) {
  const names = tableNames(database);
  const required = Object.freeze({
    message: ["ROWID", "guid", "service", "handle_id", "date", "is_from_me"],
    handle: ["ROWID", "id", "service"],
    chat: ["ROWID", "guid", "style"],
    chat_message_join: ["chat_id", "message_id"],
    chat_handle_join: ["chat_id", "handle_id"]
  });
  const inspected = new Map;
  const sets = new Map;
  for (const [table, columns] of Object.entries(required)) {
    if (!names.has(table))
      return fail(`is missing required table ${table}`);
    const shape = tableColumns(database, table);
    const set = new Set(shape.map((column) => column.name));
    for (const column of columns) {
      if (!set.has(column))
        return fail(`${table} is missing required column ${column}`);
    }
    inspected.set(table, shape);
    sets.set(table, set);
  }
  const messageColumns = sets.get("message");
  if (messageColumns === undefined || !messageColumns.has("text") && !messageColumns.has("attributedBody")) {
    return fail("message must expose text or attributedBody");
  }
  let hasAttachmentJoin = false;
  if (names.has("message_attachment_join")) {
    const shape = tableColumns(database, "message_attachment_join");
    const set = new Set(shape.map((column) => column.name));
    for (const column of ["message_id", "attachment_id"]) {
      if (!set.has(column))
        return fail(`message_attachment_join is missing required column ${column}`);
    }
    inspected.set("message_attachment_join", shape);
    sets.set("message_attachment_join", set);
    hasAttachmentJoin = true;
  }
  const serialized = [...inspected.entries()].sort(([left], [right]) => left.localeCompare(right, "en-US")).map(([table, columns]) => ({ table, columns }));
  return Object.freeze({ hash: sha2562(stableJson(serialized)), tables: sets, hasAttachmentJoin });
}
function boundedTableCount(database, table, maximum) {
  const row = getRow(database, `SELECT count(*) AS value FROM ${table}`);
  const count = safeInteger(row?.value, `${table} row count`);
  if (count === null || count < 0 || count > maximum) {
    return fail(`${table} exceeds its supported row bound`);
  }
  return count;
}
function indexOfBytes(haystack, needle, start) {
  const last = haystack.byteLength - needle.byteLength;
  for (let offset = Math.max(0, start);offset <= last; offset += 1) {
    let match = true;
    for (let index = 0;index < needle.byteLength; index += 1) {
      if (haystack[offset + index] !== needle[index]) {
        match = false;
        break;
      }
    }
    if (match)
      return offset;
  }
  return -1;
}
function typedstreamLength(bytes, offset, maximum) {
  const marker = bytes[offset];
  if (marker === undefined)
    return null;
  if (marker <= 127) {
    return marker <= maximum ? Object.freeze({ length: marker, next: offset + 1 }) : null;
  }
  const width = marker === 129 ? 2 : marker === 130 ? 4 : marker === 131 ? 8 : 0;
  if (width === 0 || offset + 1 + width > bytes.byteLength)
    return null;
  let length = 0n;
  for (let index = width - 1;index >= 0; index -= 1) {
    length = length << 8n | BigInt(bytes[offset + 1 + index]);
  }
  if (length > BigInt(maximum) || length > BigInt(Number.MAX_SAFE_INTEGER))
    return null;
  return Object.freeze({ length: Number(length), next: offset + 1 + width });
}
function decodeStringPayload(payload) {
  try {
    if (payload.byteLength >= 2 && payload[0] === 255 && payload[1] === 254) {
      return new TextDecoder("utf-16le", { fatal: true }).decode(payload.subarray(2));
    }
    if (payload.byteLength >= 2 && payload[0] === 254 && payload[1] === 255) {
      const swapped = new Uint8Array(payload.byteLength - 2);
      for (let index = 2;index + 1 < payload.byteLength; index += 2) {
        swapped[index - 2] = payload[index + 1];
        swapped[index - 1] = payload[index];
      }
      if (swapped.byteLength % 2 !== 0)
        return null;
      return new TextDecoder("utf-16le", { fatal: true }).decode(swapped);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(payload);
  } catch {
    return null;
  }
}
function decodeAttributedBody(value, maximumBlobBytes = DEFAULT_MAX_ATTRIBUTED_BODY_BYTES, maximumBodyBytes = DEFAULT_MAX_BODY_BYTES) {
  if (!(value instanceof Uint8Array) || !Number.isSafeInteger(maximumBlobBytes) || !Number.isSafeInteger(maximumBodyBytes) || maximumBlobBytes < 1 || maximumBodyBytes < 1 || value.byteLength < TYPEDSTREAM_MARKER.byteLength || value.byteLength > maximumBlobBytes || indexOfBytes(value, TYPEDSTREAM_MARKER, 0) < 0)
    return null;
  let searchFrom = 0;
  for (;; ) {
    const marker = indexOfBytes(value, NSSTRING_MARKER, searchFrom);
    if (marker < 0)
      return null;
    const markerEnd = marker + NSSTRING_MARKER.byteLength;
    const end = Math.min(value.byteLength - 1, markerEnd + 32);
    const preferredTag = markerEnd + 4;
    const tagOffsets = [
      ...preferredTag <= end ? [preferredTag] : [],
      ...Array.from({ length: Math.max(0, end - markerEnd + 1) }, (_unused, index) => markerEnd + index).filter((offset) => offset !== preferredTag)
    ];
    for (const tagOffset of tagOffsets) {
      if (value[tagOffset] !== 43)
        continue;
      const length = typedstreamLength(value, tagOffset + 1, maximumBodyBytes);
      if (length === null || length.next + length.length > value.byteLength)
        continue;
      const decoded = decodeStringPayload(value.subarray(length.next, length.next + length.length));
      if (decoded !== null && !decoded.includes("\x00") && Buffer.byteLength(decoded, "utf8") <= maximumBodyBytes)
        return decoded;
    }
    searchFrom = markerEnd;
  }
}
function appleTimestamp(value) {
  if (value === null || value === "" || value === "0")
    return null;
  let millisecondsSinceEpoch;
  if (/^[0-9]+$/u.test(value)) {
    const raw = BigInt(value);
    if (raw <= 0n || raw > 4000000000000000000n)
      return null;
    if (raw < 4000000000n)
      millisecondsSinceEpoch = Number(raw * 1000n);
    else if (raw < 4000000000000n)
      millisecondsSinceEpoch = Number(raw);
    else if (raw < 4000000000000000n)
      millisecondsSinceEpoch = Number(raw / 1000n);
    else
      millisecondsSinceEpoch = Number(raw / 1000000n);
  } else if (/^[0-9]+\.[0-9]+$/u.test(value)) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds >= 4000000000)
      return null;
    millisecondsSinceEpoch = Math.trunc(seconds * 1000);
  } else
    return null;
  if (!Number.isSafeInteger(millisecondsSinceEpoch))
    return null;
  const result = new Date(APPLE_EPOCH_MILLISECONDS + millisecondsSinceEpoch);
  const year = result.getUTCFullYear();
  return year >= 2001 && year <= 2200 ? result.toISOString() : null;
}
function columnExpression(columns, column, expression, alias) {
  return columns.has(column) ? `${expression} AS ${alias}` : `NULL AS ${alias}`;
}
function boundedTextExpression(columns, column, maximumBytes) {
  if (!columns.has(column))
    return "NULL AS message_text, 0 AS message_text_over_bound";
  return `CASE WHEN ${column} IS NULL OR length(CAST(${column} AS BLOB)) <= ${maximumBytes}
    THEN ${column} ELSE NULL END AS message_text,
    CASE WHEN ${column} IS NOT NULL AND length(CAST(${column} AS BLOB)) > ${maximumBytes}
    THEN 1 ELSE 0 END AS message_text_over_bound`;
}
function boundedBlobExpression(columns, column, maximumBytes) {
  if (!columns.has(column)) {
    return "NULL AS attributed_body, 0 AS attributed_body_over_bound";
  }
  return `CASE WHEN ${column} IS NULL OR length(${column}) <= ${maximumBytes}
    THEN ${column} ELSE NULL END AS attributed_body,
    CASE WHEN ${column} IS NOT NULL AND length(${column}) > ${maximumBytes}
    THEN 1 ELSE 0 END AS attributed_body_over_bound`;
}
function loadHandles(database, key) {
  boundedTableCount(database, "handle", MAX_HANDLES);
  const result = new Map;
  for (const row of allRows(database, "SELECT ROWID,id,service FROM handle ORDER BY ROWID")) {
    const rowId = safeInteger(row.ROWID, "handle ROWID");
    const id = privateText(row.id, "handle identity");
    const service = privateText(row.service, "handle service", true);
    if (result.has(rowId))
      return fail("contains duplicate handle ROWIDs");
    result.set(rowId, Object.freeze({
      rowId,
      id,
      service,
      participantId: hmac(key, "participant", `${service ?? ""}\x00${id}`)
    }));
  }
  return result;
}
function loadChats(database, schema, handles, key) {
  boundedTableCount(database, "chat", MAX_CHATS);
  boundedTableCount(database, "chat_handle_join", MAX_CHAT_HANDLE_JOINS);
  const handleIds = new Map;
  for (const row of allRows(database, "SELECT chat_id,handle_id FROM chat_handle_join ORDER BY chat_id,handle_id")) {
    const chatId = safeInteger(row.chat_id, "chat participant chat ID");
    const handleId = safeInteger(row.handle_id, "chat participant handle ID");
    if (!handles.has(handleId))
      return fail("chat participant references a missing handle");
    const set = handleIds.get(chatId) ?? new Set;
    set.add(handleId);
    handleIds.set(chatId, set);
  }
  const columns = schema.tables.get("chat");
  if (columns === undefined)
    return fail("chat schema disappeared");
  const rows = allRows(database, `SELECT ROWID,guid,style,
    ${columnExpression(columns, "display_name", "display_name", "display_name")},
    ${columnExpression(columns, "service_name", "service_name", "service_name")}
    FROM chat ORDER BY ROWID`);
  const result = new Map;
  const conversationIds = new Set;
  for (const row of rows) {
    const rowId = safeInteger(row.ROWID, "chat ROWID");
    const sourceKey = privateText(row.guid, "chat GUID");
    safeInteger(row.style, "chat style", true);
    const privateLabel = privateText(row.display_name, "chat display name", true, true);
    const declaredService = privateText(row.service_name, "chat service", true, true);
    const participants = [...handleIds.get(rowId) ?? new Set].sort((left, right) => left - right).map((handleId) => handles.get(handleId)).filter((handle) => handle !== undefined);
    const services = [...new Set(participants.map((participant) => participant.service).filter((service) => service !== null))].sort();
    const conversation = Object.freeze({
      id: hmac(key, "conversation", sourceKey),
      sourceKey,
      privateLabel,
      service: declaredService === null || declaredService === "" ? services.length === 1 ? services[0] : null : declaredService,
      participantCount: participants.length,
      participantIds: Object.freeze(participants.map((participant) => participant.participantId)),
      privateParticipants: Object.freeze(participants.map((participant) => participant.id)),
      group: participants.length > 1
    });
    if (result.has(rowId) || conversationIds.has(conversation.id)) {
      return fail("contains duplicate chat identities");
    }
    result.set(rowId, Object.freeze({ rowId, conversation }));
    conversationIds.add(conversation.id);
  }
  return result;
}
function loadChatJoins(database, first, last) {
  const grouped = new Map;
  for (const row of allRows(database, `SELECT message_id,chat_id
    FROM chat_message_join WHERE message_id BETWEEN ? AND ? ORDER BY message_id,chat_id`, first, last)) {
    const messageId = safeInteger(row.message_id, "chat-message message ID");
    const chatId = safeInteger(row.chat_id, "chat-message chat ID");
    const values = grouped.get(messageId) ?? new Set;
    values.add(chatId);
    grouped.set(messageId, values);
  }
  return new Map([...grouped.entries()].map(([messageId, values]) => [
    messageId,
    Object.freeze([...values].sort((left, right) => left - right))
  ]));
}
function loadAttachmentCounts(database, schema, first, last) {
  if (!schema.hasAttachmentJoin)
    return new Map;
  const result = new Map;
  for (const row of allRows(database, `SELECT message_id,
    count(DISTINCT attachment_id) AS value FROM message_attachment_join
    WHERE message_id BETWEEN ? AND ? GROUP BY message_id ORDER BY message_id`, first, last)) {
    const messageId = safeInteger(row.message_id, "attachment message ID");
    const count = safeInteger(row.value, "message attachment count");
    if (count < 0)
      return fail("contains a negative attachment count");
    result.set(messageId, count);
  }
  return result;
}
function messageRows(database, schema, afterRowId, pageSize, maximumBodyBytes, maximumAttributedBodyBytes) {
  const columns = schema.tables.get("message");
  if (columns === undefined)
    return fail("message schema disappeared");
  const rows = allRows(database, `SELECT
    ROWID AS source_rowid,guid,service,handle_id,CAST(date AS TEXT) AS date_text,is_from_me,
    ${boundedTextExpression(columns, "text", maximumBodyBytes)},
    ${boundedBlobExpression(columns, "attributedBody", maximumAttributedBodyBytes)},
    ${columnExpression(columns, "item_type", "item_type", "item_type")},
    ${columnExpression(columns, "associated_message_type", "associated_message_type", "associated_message_type")},
    ${columnExpression(columns, "associated_message_guid", "associated_message_guid", "associated_message_guid")},
    ${columnExpression(columns, "thread_originator_guid", "thread_originator_guid", "thread_originator_guid")},
    ${columnExpression(columns, "reply_to_guid", "reply_to_guid", "reply_to_guid")},
    ${columnExpression(columns, "is_system_message", "is_system_message", "is_system_message")},
    ${columnExpression(columns, "is_service_message", "is_service_message", "is_service_message")},
    ${columnExpression(columns, "is_spam", "is_spam", "is_spam")},
    ${columnExpression(columns, "is_corrupt", "is_corrupt", "is_corrupt")},
    ${columnExpression(columns, "date_edited", "CAST(date_edited AS TEXT)", "date_edited_text")},
    ${columnExpression(columns, "date_retracted", "CAST(date_retracted AS TEXT)", "date_retracted_text")},
    ${columnExpression(columns, "cache_has_attachments", "cache_has_attachments", "cache_has_attachments")}
    FROM message WHERE ROWID>? ORDER BY ROWID LIMIT ?`, afterRowId, pageSize);
  return rows.map((row) => Object.freeze({
    sourceRowId: safeInteger(row.source_rowid, "message ROWID"),
    sourceGuid: privateText(row.guid, "message GUID"),
    service: privateText(row.service, "message service", true, true),
    handleId: safeInteger(row.handle_id, "message sender handle ID", true),
    dateText: privateText(row.date_text, "message date", true, true),
    isFromMe: flag(row.is_from_me, "message direction"),
    text: bodyText(row.message_text, "message text", maximumBodyBytes),
    textOverBound: flag(row.message_text_over_bound, "message text bound flag"),
    attributedBody: blob(row.attributed_body, "message attributed body"),
    attributedBodyOverBound: flag(row.attributed_body_over_bound, "message attributed-body bound flag"),
    itemType: row.item_type === null ? 0 : safeInteger(row.item_type, "message item type"),
    associatedMessageType: row.associated_message_type === null ? 0 : safeInteger(row.associated_message_type, "message associated-message type"),
    associatedMessageGuid: privateText(row.associated_message_guid, "associated message GUID", true, true),
    threadOriginatorGuid: privateText(row.thread_originator_guid, "thread originator GUID", true, true),
    replyToGuid: privateText(row.reply_to_guid, "reply-to GUID", true, true),
    isSystemMessage: flag(row.is_system_message, "message system flag"),
    isServiceMessage: flag(row.is_service_message, "message service flag"),
    isSpam: flag(row.is_spam, "message spam flag"),
    isCorrupt: flag(row.is_corrupt, "message corrupt flag"),
    editedDateText: privateText(row.date_edited_text, "message edited date", true, true),
    retractedDateText: privateText(row.date_retracted_text, "message retracted date", true, true),
    cacheHasAttachments: flag(row.cache_has_attachments, "message attachment cache flag")
  }));
}
function messageBody(row, maximumAttributedBodyBytes, maximumBodyBytes) {
  if (row.text !== null)
    return Object.freeze({ body: row.text, bodySource: "text" });
  if (row.attributedBody !== null) {
    const decoded = decodeAttributedBody(row.attributedBody, maximumAttributedBodyBytes, maximumBodyBytes);
    if (decoded !== null)
      return Object.freeze({ body: decoded, bodySource: "attributed-body" });
  }
  return Object.freeze({ body: null, bodySource: "unavailable" });
}
function messageKind(row, body, attachmentCount) {
  if (row.associatedMessageType !== 0 || (row.associatedMessageGuid ?? "") !== "")
    return "reaction";
  if (row.itemType !== 0 || row.isSystemMessage !== 0 || row.isServiceMessage !== 0)
    return "system";
  if (body !== null)
    return "text";
  if (attachmentCount > 0 || row.cacheHasAttachments === 1)
    return "attachment";
  return "unknown";
}
function sourceModifiedAt(stats) {
  const milliseconds = Number(stats.mtimeMs);
  if (!Number.isFinite(milliseconds))
    return fail("has an invalid modification time");
  return new Date(milliseconds).toISOString();
}
function aggregateWarnings(counts, hasAttachmentJoin) {
  const warnings = [];
  if (!hasAttachmentJoin) {
    warnings.push("message_attachment_join is unavailable; attachment counts are presence lower bounds");
  }
  for (const { category, label } of WARNING_LABELS) {
    const count = counts[category];
    if (count > 0)
      warnings.push(`${label}: ${count}`);
  }
  return Object.freeze(warnings);
}
function readIMessageDatabase(path, options) {
  const key = hmacKey(options.hmacKey);
  const maximumDatabaseBytes = boundedInteger(options.maxDatabaseBytes, DEFAULT_MAX_DATABASE_BYTES, 1, MAX_CONFIGURABLE_DATABASE_BYTES, "maxDatabaseBytes");
  const maximumMessages = boundedInteger(options.maxMessages, DEFAULT_MAX_MESSAGES, 1, MAX_CONFIGURABLE_MESSAGES, "maxMessages");
  const maximumBodyBytes = boundedInteger(options.maxBodyBytes, DEFAULT_MAX_BODY_BYTES, 1, MAX_CONFIGURABLE_BODY_BYTES, "maxBodyBytes");
  const maximumAttributedBodyBytes = boundedInteger(options.maxAttributedBodyBytes, DEFAULT_MAX_ATTRIBUTED_BODY_BYTES, 1, MAX_CONFIGURABLE_ATTRIBUTED_BODY_BYTES, "maxAttributedBodyBytes");
  const pageSize = boundedInteger(options.pageSize, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE, "pageSize");
  const requestedSource = inspectSource(path, maximumDatabaseBytes);
  const isolated = isolateSource(requestedSource, maximumDatabaseBytes);
  const source = isolated.source;
  let database = null;
  let transactionOpen = false;
  try {
    database = new Database(isolated.path, { strict: true });
    database.exec("PRAGMA query_only=ON");
    const queryOnly = getRow(database, "PRAGMA query_only");
    if (queryOnly?.query_only !== 1)
      return fail("could not enable query-only mode");
    database.exec("BEGIN");
    transactionOpen = true;
    const schema = inspectSchema(database);
    boundedTableCount(database, "message", maximumMessages);
    const handles = loadHandles(database, key);
    const chats = loadChats(database, schema, handles, key);
    const warningCounts = {
      spamOrCorrupt: 0,
      unsupportedTimestamp: 0,
      missingConversation: 0,
      multipleConversations: 0,
      missingSenderHandle: 0,
      unsupportedAttributedBody: 0
    };
    const messages = [];
    const messageIds = new Set;
    let afterRowId = 0;
    for (;; ) {
      const page = messageRows(database, schema, afterRowId, pageSize, maximumBodyBytes, maximumAttributedBodyBytes);
      if (page.length === 0)
        break;
      const first = page[0]?.sourceRowId;
      const last = page.at(-1)?.sourceRowId;
      if (first === undefined || last === undefined || first <= afterRowId || last < first) {
        return fail("message paging order is inconsistent");
      }
      const joins = loadChatJoins(database, first, last);
      const attachments = loadAttachmentCounts(database, schema, first, last);
      for (const row of page) {
        const id = hmac(key, "message", row.sourceGuid);
        if (messageIds.has(id))
          return fail("contains duplicate message GUIDs");
        if (row.isSpam === 1 || row.isCorrupt === 1) {
          warningCounts.spamOrCorrupt += 1;
          continue;
        }
        if (row.textOverBound === 1) {
          return fail(`message text ${id} exceeds the configured body bound`);
        }
        if (row.attributedBodyOverBound === 1) {
          return fail(`attributed body ${id} exceeds the configured attributed-body bound`);
        }
        const sentAt = appleTimestamp(row.dateText);
        if (sentAt === null) {
          warningCounts.unsupportedTimestamp += 1;
          continue;
        }
        const chatIds = joins.get(row.sourceRowId) ?? [];
        const chatId = chatIds[0];
        if (chatId === undefined) {
          warningCounts.missingConversation += 1;
          continue;
        }
        if (chatIds.length > 1) {
          warningCounts.multipleConversations += 1;
        }
        const chat = chats.get(chatId);
        if (chat === undefined)
          return fail("message references a missing chat");
        if (row.isFromMe === 0 && row.handleId !== null && !handles.has(row.handleId)) {
          warningCounts.missingSenderHandle += 1;
        }
        const body = messageBody(row, maximumAttributedBodyBytes, maximumBodyBytes);
        if (row.text === null && row.attributedBody !== null && body.body === null) {
          warningCounts.unsupportedAttributedBody += 1;
        }
        const attachmentCount = attachments.get(row.sourceRowId) ?? (row.cacheHasAttachments === 1 ? 1 : 0);
        messages.push(Object.freeze({
          id,
          sourceRowId: row.sourceRowId,
          sourceGuid: row.sourceGuid,
          conversationId: chat.conversation.id,
          sentAt,
          direction: row.isFromMe === 1 ? "outgoing" : "incoming",
          body: body.body,
          bodySource: body.bodySource,
          kind: messageKind(row, body.body, attachmentCount),
          replyToSourceGuid: (row.threadOriginatorGuid || row.replyToGuid) ?? null,
          editedAt: appleTimestamp(row.editedDateText),
          retractedAt: appleTimestamp(row.retractedDateText),
          service: row.service === "" ? null : row.service,
          attachmentCount
        }));
        messageIds.add(id);
      }
      afterRowId = last;
    }
    messages.sort((left, right) => {
      const time = left.sentAt.localeCompare(right.sentAt, "en-US");
      return time !== 0 ? time : left.sourceRowId - right.sourceRowId || left.id.localeCompare(right.id, "en-US");
    });
    const conversations = [...chats.values()].map((chat) => chat.conversation).sort((left, right) => left.id.localeCompare(right.id, "en-US"));
    database.exec("COMMIT");
    transactionOpen = false;
    const snapshotSha256 = sha2562(stableJson({
      schemaVersion: CORPUS_SCHEMA_VERSION,
      schemaSha256: schema.hash,
      conversations,
      messages
    }));
    return Object.freeze({
      schemaVersion: CORPUS_SCHEMA_VERSION,
      source: Object.freeze({
        physicalPath: source.path,
        device: source.stats.dev.toString(),
        inode: source.stats.ino.toString(),
        bytes: Number(source.stats.size),
        modifiedAt: sourceModifiedAt(source.stats),
        schemaSha256: schema.hash,
        snapshotSha256
      }),
      conversations: Object.freeze(conversations),
      messages: Object.freeze(messages),
      warnings: aggregateWarnings(warningCounts, schema.hasAttachmentJoin)
    });
  } finally {
    if (transactionOpen && database !== null) {
      try {
        database.exec("ROLLBACK");
      } catch {}
    }
    try {
      database?.close();
    } finally {
      rmSync(isolated.temporaryDirectory, { recursive: true, force: true });
    }
  }
}

// src/metrics.ts
import { createHash as createHash2 } from "crypto";
var DEFAULT_SESSION_GAP_SECONDS = 8 * 60 * 60;
var DEFAULT_BURST_GAP_SECONDS = 5 * 60;
var DEFAULT_STUDY_LIMIT = 12;
var MAX_STUDY_LIMIT = 50;
var DEFAULT_MAX_STUDY_TEXT_BYTES = 4 * 1024;
var MAX_STUDY_TEXT_BYTES = 64 * 1024;
var DEFAULT_MAX_STUDY_MESSAGES_PER_DIRECTION = 12;
var MAX_STUDY_MESSAGES_PER_DIRECTION = 64;
var DEFAULT_MAX_STUDY_PACKET_BODY_BYTES = 256 * 1024;
var MAX_STUDY_PACKET_BODY_BYTES = 1024 * 1024;
var MAX_GAP_SECONDS = 30 * 24 * 60 * 60;
function digest(namespace, parts) {
  const hash = createHash2("sha256");
  hash.update(`message-like-me\x00${namespace}\x00`, "utf8");
  for (const part of parts)
    hash.update(`${part.length}:`, "utf8").update(part, "utf8");
  return hash.digest("hex");
}
function round(value, places = 6) {
  if (!Number.isFinite(value))
    return 0;
  const scale = 10 ** places;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}
function boundedGap(value, fallback, label) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > MAX_GAP_SECONDS) {
    throw new Error(`${label} must be an integer from 1 through ${MAX_GAP_SECONDS}`);
  }
  return result;
}
function boundedStudyInteger(value, fallback, maximum, label) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) {
    throw new Error(`${label} must be an integer from 1 through ${maximum}`);
  }
  return result;
}
function canonicalTimestamp(value, label) {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO timestamp`);
  }
  return milliseconds;
}
function orderedMessages(messages) {
  if (!Array.isArray(messages))
    throw new Error("messages must be an array");
  const ids = new Set;
  const rows = messages.map((message, index) => {
    if (typeof message.id !== "string" || message.id.length === 0) {
      throw new Error(`messages[${index}].id must be non-empty text`);
    }
    if (ids.has(message.id))
      throw new Error(`messages repeat ID ${message.id}`);
    ids.add(message.id);
    if (!Number.isSafeInteger(message.sourceRowId) || message.sourceRowId < 1) {
      throw new Error(`messages[${index}].sourceRowId must be a positive safe integer`);
    }
    if (message.direction !== "incoming" && message.direction !== "outgoing") {
      throw new Error(`messages[${index}].direction is invalid`);
    }
    return Object.freeze({
      message,
      milliseconds: canonicalTimestamp(message.sentAt, `messages[${index}].sentAt`)
    });
  });
  rows.sort((left, right) => left.milliseconds - right.milliseconds || left.message.sourceRowId - right.message.sourceRowId || left.message.id.localeCompare(right.message.id, "en-US"));
  return Object.freeze(rows);
}
function timelineEligible(message) {
  return message.kind === "text" || message.kind === "attachment" || message.kind === "reaction";
}
function responseEligible(message) {
  return message.kind === "text" || message.kind === "attachment";
}
function secondsBetween(left, right) {
  return Math.max(0, (right.milliseconds - left.milliseconds) / 1000);
}
function sessionsFor(messages, corpusRevision, contactId, gapSeconds) {
  const eligible = messages.filter(({ message }) => timelineEligible(message));
  if (eligible.length === 0)
    return Object.freeze([]);
  const groups = [];
  for (const row of eligible) {
    const current = groups.at(-1);
    const prior = current?.at(-1);
    if (current === undefined || prior === undefined || secondsBetween(prior, row) > gapSeconds) {
      groups.push([row]);
    } else
      current.push(row);
  }
  return Object.freeze(groups.map((group, index) => {
    const first = group[0];
    const last = group.at(-1);
    const incomingCount = group.filter(({ message }) => message.direction === "incoming").length;
    const outgoingCount = group.length - incomingCount;
    return Object.freeze({
      id: digest("session", [corpusRevision, contactId, String(index), ...group.map(({ message }) => message.id)]),
      startedAt: first.message.sentAt,
      endedAt: last.message.sentAt,
      durationSeconds: round((last.milliseconds - first.milliseconds) / 1000, 3),
      messageCount: group.length,
      incomingCount,
      outgoingCount,
      startedBy: first.message.direction,
      endedBy: last.message.direction
    });
  }));
}
function blocksFor(messages, burstGapSeconds) {
  const eligible = messages.filter(({ message }) => responseEligible(message));
  const blocks = [];
  for (const row of eligible) {
    const current = blocks.at(-1);
    const prior = current?.messages.at(-1);
    if (current === undefined || prior === undefined || current.direction !== row.message.direction || secondsBetween(prior, row) > burstGapSeconds) {
      blocks.push({ direction: row.message.direction, messages: [row] });
    } else
      current.messages.push(row);
  }
  return Object.freeze(blocks.map((block) => Object.freeze({
    direction: block.direction,
    messages: Object.freeze(block.messages)
  })));
}
function burstsFor(messages, sessions, corpusRevision, contactId, burstGapSeconds) {
  const result = [];
  for (const session of sessions) {
    const started = Date.parse(session.startedAt);
    const ended = Date.parse(session.endedAt);
    const sessionRows = messages.filter((row) => row.milliseconds >= started && row.milliseconds <= ended && responseEligible(row.message));
    for (const block of blocksFor(sessionRows, burstGapSeconds)) {
      const first = block.messages[0];
      const last = block.messages.at(-1);
      const messageIds = Object.freeze(block.messages.map(({ message }) => message.id));
      const textBodies = bodies(block.messages);
      result.push(Object.freeze({
        metric: Object.freeze({
          id: digest("burst", [corpusRevision, contactId, session.id, ...messageIds]),
          sessionId: session.id,
          startedAt: first.message.sentAt,
          endedAt: last.message.sentAt,
          durationSeconds: round((last.milliseconds - first.milliseconds) / 1000, 3),
          direction: block.direction,
          messageIds,
          messageCount: block.messages.length,
          textMessageCount: textBodies.length,
          characters: textBodies.reduce((total, body) => total + characterCount(body), 0)
        }),
        messages: block.messages
      }));
    }
  }
  return Object.freeze(result);
}
function bodies(rows) {
  return rows.flatMap(({ message }) => message.kind === "text" && message.body !== null ? [message.body] : []);
}
function characterCount(value) {
  return Array.from(value).length;
}
function questionCount(value) {
  return value.match(/[?\uFF1F]/gu)?.length ?? 0;
}
function containsMultiItemBody(value) {
  const lines = value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 2)
    return true;
  return /(?:^|\n)\s*(?:[-*\u2022]|[0-9]{1,2}[.)])\s+/u.test(value) || (value.match(/;/gu)?.length ?? 0) >= 2;
}
function responseTags(incoming, outgoing, latencySeconds, incomingQuestions, outgoingCharacters, explicitReplyCount) {
  const tags = new Set;
  tags.add(outgoing.length === 1 ? "single-message-response" : "multi-message-response");
  if (incoming.length > 1)
    tags.add("multi-incoming");
  if (incomingQuestions > 1)
    tags.add("multi-question");
  if (incoming.length > 1 || incomingQuestions > 1 || bodies(incoming).some(containsMultiItemBody))
    tags.add("multi-item-context");
  if (explicitReplyCount > 0)
    tags.add("explicit-reply");
  if (latencySeconds <= 60)
    tags.add("fast-response");
  else if (latencySeconds >= 60 * 60)
    tags.add("delayed-response");
  if (outgoingCharacters <= 40)
    tags.add("short-response");
  else if (outgoingCharacters >= 280)
    tags.add("long-response");
  if (bodies(outgoing).some((body) => body.includes(`
`)))
    tags.add("multiline-response");
  return Object.freeze([...tags].sort((left, right) => left.localeCompare(right, "en-US")));
}
function responsesFor(bursts, corpusRevision, contactId) {
  const result = [];
  const bySession = new Map;
  for (const burst of bursts) {
    const values = bySession.get(burst.metric.sessionId) ?? [];
    values.push(burst);
    bySession.set(burst.metric.sessionId, values);
  }
  for (const sessionBursts of bySession.values()) {
    for (let index = 0;index + 1 < sessionBursts.length; index += 1) {
      const incoming = sessionBursts[index];
      const outgoing = sessionBursts[index + 1];
      if (incoming.metric.direction !== "incoming" || outgoing.metric.direction !== "outgoing")
        continue;
      const incomingBodies = bodies(incoming.messages);
      const outgoingBodies = bodies(outgoing.messages);
      const incomingCharacters = incomingBodies.reduce((total, body) => total + characterCount(body), 0);
      const outgoingCharacters = outgoingBodies.reduce((total, body) => total + characterCount(body), 0);
      const incomingQuestions = incomingBodies.reduce((total, body) => total + questionCount(body), 0);
      const explicitReplyCount = outgoing.messages.filter(({ message }) => message.replyToSourceGuid !== null).length;
      const lastIncoming = incoming.messages.at(-1);
      const firstOutgoing = outgoing.messages[0];
      const latencySeconds = round(secondsBetween(lastIncoming, firstOutgoing), 3);
      const incomingIds = Object.freeze(incoming.messages.map(({ message }) => message.id));
      const outgoingIds = Object.freeze(outgoing.messages.map(({ message }) => message.id));
      result.push(Object.freeze({
        id: digest("response", [corpusRevision, contactId, ...incomingIds, "->", ...outgoingIds]),
        startedAt: incoming.messages[0].message.sentAt,
        incomingMessageIds: incomingIds,
        outgoingMessageIds: outgoingIds,
        incomingCount: incoming.messages.length,
        outgoingCount: outgoing.messages.length,
        incomingCharacters,
        outgoingCharacters,
        incomingQuestions,
        latencySeconds,
        explicitReplyCount,
        tags: responseTags(incoming.messages, outgoing.messages, latencySeconds, incomingQuestions, outgoingCharacters, explicitReplyCount)
      }));
    }
  }
  return Object.freeze(result);
}
function quantile(values, proportion) {
  if (values.length === 0)
    return null;
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 1)
    return sorted[0];
  const position = (sorted.length - 1) * proportion;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower];
  const high = sorted[upper];
  return round(low + (high - low) * (position - lower), 6);
}
function numericDistribution(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  return Object.freeze({
    total,
    mean: values.length === 0 ? 0 : round(total / values.length),
    median: quantile(values, 0.5) ?? 0,
    p90: quantile(values, 0.9) ?? 0
  });
}
function wordCount(value) {
  return value.match(/[\p{L}\p{N}]+(?:['\u2019][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}
function firstLetterIsLowercase(value) {
  const letter = value.match(/\p{L}/u)?.[0];
  return letter !== undefined && letter.toLocaleLowerCase() === letter && letter.toLocaleUpperCase() !== letter;
}
function ratio(count, total) {
  return total === 0 ? 0 : round(count / total);
}
function surfaceMetrics(messages) {
  const outgoing = messages.flatMap(({ message }) => message.direction === "outgoing" && message.kind === "text" && message.body !== null ? [message.body] : []);
  const characters = outgoing.map(characterCount);
  const words = outgoing.map(wordCount);
  return Object.freeze({
    outgoingTextMessages: outgoing.length,
    characters: numericDistribution(characters),
    words: numericDistribution(words),
    lowercaseStartsRatio: ratio(outgoing.filter(firstLetterIsLowercase).length, outgoing.length),
    terminalPunctuationRatio: ratio(outgoing.filter((body) => /[.!?\u2026\u3002\uFF01\uFF1F]$/u.test(body.trimEnd())).length, outgoing.length),
    questionRatio: ratio(outgoing.filter((body) => /[?\uFF1F]/u.test(body)).length, outgoing.length),
    exclamationRatio: ratio(outgoing.filter((body) => /[!\uFF01]/u.test(body)).length, outgoing.length),
    emojiMessageRatio: ratio(outgoing.filter((body) => /\p{Extended_Pictographic}/u.test(body)).length, outgoing.length),
    multilineRatio: ratio(outgoing.filter((body) => /\r?\n/u.test(body)).length, outgoing.length)
  });
}
function tempoMetrics(messages, responses) {
  const latencies = responses.map((response) => response.latencySeconds);
  const bundles = responses.map((response) => response.outgoingCount);
  const outgoingText = messages.filter(({ message }) => message.direction === "outgoing" && message.kind === "text" && message.body !== null);
  const explicitReplies = outgoingText.filter(({ message }) => message.replyToSourceGuid !== null).length;
  return Object.freeze({
    responseEpisodes: responses.length,
    responseLatencySeconds: Object.freeze({
      median: quantile(latencies, 0.5),
      p25: quantile(latencies, 0.25),
      p75: quantile(latencies, 0.75),
      p90: quantile(latencies, 0.9)
    }),
    outgoingMessagesPerResponse: Object.freeze({
      mean: bundles.length === 0 ? 0 : round(bundles.reduce((sum, value) => sum + value, 0) / bundles.length),
      median: quantile(bundles, 0.5) ?? 0,
      p90: quantile(bundles, 0.9) ?? 0,
      singleRatio: ratio(bundles.filter((value) => value === 1).length, bundles.length),
      multiRatio: ratio(bundles.filter((value) => value > 1).length, bundles.length)
    }),
    explicitReplyMessages: explicitReplies,
    explicitReplyRatio: ratio(explicitReplies, outgoingText.length),
    multiIncomingEpisodes: responses.filter((response) => response.incomingCount > 1).length,
    multiQuestionEpisodes: responses.filter((response) => response.incomingQuestions > 1).length
  });
}
function reactionMetrics(messages) {
  const reactions = messages.filter(({ message }) => message.kind === "reaction");
  const outgoing = reactions.filter(({ message }) => message.direction === "outgoing").length;
  const outgoingActions = messages.filter(({ message }) => message.direction === "outgoing" && timelineEligible(message)).length;
  return Object.freeze({
    total: reactions.length,
    incoming: reactions.length - outgoing,
    outgoing,
    outgoingReactionRatio: ratio(outgoing, outgoingActions)
  });
}
function analyzeContact(messages, corpusRevision, contactId, options = {}) {
  if (typeof corpusRevision !== "string" || !/^[a-f0-9]{64}$/u.test(corpusRevision)) {
    throw new Error("corpusRevision must be a lowercase SHA-256 digest");
  }
  if (typeof contactId !== "string" || contactId.length < 1 || contactId.length > 256) {
    throw new Error("contactId must be bounded non-empty text");
  }
  const sessionGapSeconds = boundedGap(options.sessionGapSeconds, DEFAULT_SESSION_GAP_SECONDS, "sessionGapSeconds");
  const burstGapSeconds = boundedGap(options.burstGapSeconds, DEFAULT_BURST_GAP_SECONDS, "burstGapSeconds");
  if (burstGapSeconds > sessionGapSeconds) {
    throw new Error("burstGapSeconds cannot exceed sessionGapSeconds");
  }
  const ordered = orderedMessages(messages);
  const sessions = sessionsFor(ordered, corpusRevision, contactId, sessionGapSeconds);
  const burstRecords = burstsFor(ordered, sessions, corpusRevision, contactId, burstGapSeconds);
  const responses = responsesFor(burstRecords, corpusRevision, contactId);
  return Object.freeze({
    schemaVersion: METRICS_SCHEMA_VERSION,
    corpusRevision,
    contactId,
    firstMessageAt: ordered[0]?.message.sentAt ?? null,
    lastMessageAt: ordered.at(-1)?.message.sentAt ?? null,
    messageCount: ordered.length,
    incomingCount: ordered.filter(({ message }) => message.direction === "incoming").length,
    outgoingCount: ordered.filter(({ message }) => message.direction === "outgoing").length,
    textMessageCount: ordered.filter(({ message }) => message.kind === "text" && message.body !== null).length,
    sessionGapSeconds,
    burstGapSeconds,
    sessions,
    bursts: Object.freeze(burstRecords.map(({ metric }) => metric)),
    responses,
    tempo: tempoMetrics(ordered, responses),
    reactions: reactionMetrics(ordered),
    surface: surfaceMetrics(ordered)
  });
}
function studyMessages(response, byId, maximumTextBytes, maximumMessagesPerDirection) {
  const resolveRows = (ids, expectedDirection) => {
    const rows2 = [];
    let missing = 0;
    for (const id of ids) {
      const row = byId.get(id);
      if (row === undefined) {
        missing += 1;
        continue;
      }
      if (row.message.direction !== expectedDirection) {
        throw new Error(`response ${response.id} references a message with the wrong direction`);
      }
      rows2.push(row);
    }
    return Object.freeze({ rows: Object.freeze(rows2), missing });
  };
  const incoming = resolveRows(response.incomingMessageIds, "incoming");
  const outgoing = resolveRows(response.outgoingMessageIds, "outgoing");
  const incomingText = incoming.rows.filter(({ message }) => message.kind === "text" && message.body !== null);
  const outgoingText = outgoing.rows.filter(({ message }) => message.kind === "text" && message.body !== null);
  const selectedIncoming = incomingText.slice(-maximumMessagesPerDirection);
  const selectedOutgoing = outgoingText.slice(0, maximumMessagesPerDirection);
  const rows = [...selectedIncoming, ...selectedOutgoing].sort((left, right) => left.milliseconds - right.milliseconds || left.message.sourceRowId - right.message.sourceRowId || left.message.id.localeCompare(right.message.id, "en-US"));
  const started = canonicalTimestamp(response.startedAt, `response ${response.id} startedAt`);
  const messages = Object.freeze(rows.map(({ message, milliseconds }) => {
    const sourceBody = message.body;
    const sourceBodyBytes = Buffer.byteLength(sourceBody, "utf8");
    let body = sourceBody;
    let emittedBodyBytes = sourceBodyBytes;
    if (sourceBodyBytes > maximumTextBytes) {
      let bytes = 0;
      let bounded = "";
      for (const symbol of sourceBody) {
        const symbolBytes = Buffer.byteLength(symbol, "utf8");
        if (bytes + symbolBytes > maximumTextBytes)
          break;
        bounded += symbol;
        bytes += symbolBytes;
      }
      body = bounded;
      emittedBodyBytes = bytes;
    }
    return Object.freeze({
      id: message.id,
      offsetSeconds: round((milliseconds - started) / 1000, 3),
      direction: message.direction,
      body,
      sourceBodyBytes,
      emittedBodyBytes,
      bodyTruncated: emittedBodyBytes < sourceBodyBytes,
      explicitReply: message.replyToSourceGuid !== null
    });
  }));
  const eligibleRows = [...incomingText, ...outgoingText];
  const coverage = Object.freeze({
    source: Object.freeze({
      responseIncomingMessages: response.incomingMessageIds.length,
      responseOutgoingMessages: response.outgoingMessageIds.length,
      eligibleIncomingTextMessages: incomingText.length,
      eligibleOutgoingTextMessages: outgoingText.length,
      bodyBytes: eligibleRows.reduce((total, { message }) => total + Buffer.byteLength(message.body, "utf8"), 0)
    }),
    emitted: Object.freeze({
      incomingTextMessages: selectedIncoming.length,
      outgoingTextMessages: selectedOutgoing.length,
      bodyBytes: messages.reduce((total, message) => total + message.emittedBodyBytes, 0),
      truncatedMessages: messages.filter(({ bodyTruncated }) => bodyTruncated).length
    }),
    omitted: Object.freeze({
      missingMessages: incoming.missing + outgoing.missing,
      nonTextOrBodylessMessages: incoming.rows.length + outgoing.rows.length - eligibleRows.length,
      incomingTextMessagesByDirectionLimit: incomingText.length - selectedIncoming.length,
      outgoingTextMessagesByDirectionLimit: outgoingText.length - selectedOutgoing.length
    })
  });
  return Object.freeze({ messages, coverage });
}
function responseSignature(response) {
  const latency = response.latencySeconds <= 60 ? "immediate" : response.latencySeconds < 15 * 60 ? "minutes" : response.latencySeconds < 60 * 60 ? "hour" : "delayed";
  const length = response.outgoingCharacters <= 40 ? "short" : response.outgoingCharacters >= 280 ? "long" : "medium";
  return [
    response.incomingCount > 1 ? "multi-in" : "single-in",
    response.outgoingCount > 1 ? "multi-out" : "single-out",
    response.incomingQuestions > 1 ? "multi-q" : response.incomingQuestions === 1 ? "one-q" : "no-q",
    response.explicitReplyCount > 0 ? "reply" : "no-reply",
    latency,
    length
  ].join(":");
}
function candidatesFor(ordered, metrics, maximumTextBytes, maximumMessagesPerDirection) {
  const byId = new Map(ordered.map((row) => [row.message.id, row]));
  const candidates = [];
  let omittedWithoutBidirectionalText = 0;
  for (const response of metrics.responses) {
    const study = studyMessages(response, byId, maximumTextBytes, maximumMessagesPerDirection);
    const hasIncoming = study.messages.some((message) => message.direction === "incoming");
    const hasOutgoing = study.messages.some((message) => message.direction === "outgoing");
    if (!hasIncoming || !hasOutgoing) {
      omittedWithoutBidirectionalText += 1;
      continue;
    }
    const example = Object.freeze({
      id: response.id,
      tags: response.tags,
      startedAt: response.startedAt,
      messages: study.messages,
      coverage: study.coverage
    });
    candidates.push(Object.freeze({
      response,
      example,
      bodyBytes: study.coverage.emitted.bodyBytes,
      signature: responseSignature(response),
      informationCharacters: study.messages.reduce((total, message) => total + characterCount(message.body), 0),
      milliseconds: Date.parse(response.startedAt)
    }));
  }
  return Object.freeze({
    candidates: Object.freeze(candidates),
    responseCandidates: metrics.responses.length,
    omittedWithoutBidirectionalText
  });
}
function selectDiverse(candidates, limit, maximumBodyBytes) {
  if (candidates.length === 0) {
    return Object.freeze({
      examples: Object.freeze([]),
      omittedByExampleLimit: 0,
      omittedByTotalBodyBytes: 0,
      omittedExampleBodyBytes: 0
    });
  }
  const frequencies = new Map;
  for (const candidate of candidates) {
    for (const tag of candidate.example.tags)
      frequencies.set(tag, (frequencies.get(tag) ?? 0) + 1);
  }
  const remaining = [...candidates];
  const selected = [];
  const coveredTags = new Set;
  const coveredSignatures = new Set;
  let emittedBodyBytes = 0;
  let omittedByTotalBodyBytes = 0;
  let omittedExampleBodyBytes = 0;
  const minimumTime = Math.min(...remaining.map((candidate) => candidate.milliseconds));
  const maximumTime = Math.max(...remaining.map((candidate) => candidate.milliseconds));
  const timeSpan = Math.max(1, maximumTime - minimumTime);
  while (selected.length < limit && remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const [index, candidate] of remaining.entries()) {
      const newTags = candidate.example.tags.filter((tag) => !coveredTags.has(tag));
      const rareTagScore = candidate.example.tags.reduce((total, tag) => total + 1 / (frequencies.get(tag) ?? 1), 0);
      const signatureScore = coveredSignatures.has(candidate.signature) ? 0 : 1;
      const temporalDistance = selected.length === 0 ? 0 : Math.min(...selected.map((prior) => Math.abs(candidate.milliseconds - prior.milliseconds) / timeSpan));
      const information = Math.min(candidate.informationCharacters, 1000) / 1000;
      const score = newTags.length * 1e4 + signatureScore * 2000 + rareTagScore * 100 + temporalDistance * 50 + information;
      const best = remaining[bestIndex];
      if (score > bestScore || score === bestScore && (candidate.milliseconds < best.milliseconds || candidate.milliseconds === best.milliseconds && candidate.example.id < best.example.id)) {
        bestIndex = index;
        bestScore = score;
      }
    }
    const chosen = remaining.splice(bestIndex, 1)[0];
    if (chosen.bodyBytes > maximumBodyBytes - emittedBodyBytes) {
      omittedByTotalBodyBytes += 1;
      omittedExampleBodyBytes += chosen.bodyBytes;
      continue;
    }
    selected.push(chosen);
    emittedBodyBytes += chosen.bodyBytes;
    coveredSignatures.add(chosen.signature);
    for (const tag of chosen.example.tags)
      coveredTags.add(tag);
  }
  return Object.freeze({
    examples: Object.freeze(selected.map((candidate) => candidate.example)),
    omittedByExampleLimit: remaining.length,
    omittedByTotalBodyBytes,
    omittedExampleBodyBytes
  });
}
function aggregateStudyMetrics(metrics) {
  return Object.freeze({
    schemaVersion: metrics.schemaVersion,
    firstMessageAt: metrics.firstMessageAt,
    lastMessageAt: metrics.lastMessageAt,
    messageCount: metrics.messageCount,
    incomingCount: metrics.incomingCount,
    outgoingCount: metrics.outgoingCount,
    textMessageCount: metrics.textMessageCount,
    sessionGapSeconds: metrics.sessionGapSeconds,
    burstGapSeconds: metrics.burstGapSeconds,
    sessionCount: metrics.sessions.length,
    burstCount: metrics.bursts.length,
    responseCount: metrics.responses.length,
    tempo: Object.freeze({
      responseEpisodes: metrics.tempo.responseEpisodes,
      responseLatencySeconds: Object.freeze({
        median: metrics.tempo.responseLatencySeconds.median,
        p25: metrics.tempo.responseLatencySeconds.p25,
        p75: metrics.tempo.responseLatencySeconds.p75,
        p90: metrics.tempo.responseLatencySeconds.p90
      }),
      outgoingMessagesPerResponse: Object.freeze({
        mean: metrics.tempo.outgoingMessagesPerResponse.mean,
        median: metrics.tempo.outgoingMessagesPerResponse.median,
        p90: metrics.tempo.outgoingMessagesPerResponse.p90,
        singleRatio: metrics.tempo.outgoingMessagesPerResponse.singleRatio,
        multiRatio: metrics.tempo.outgoingMessagesPerResponse.multiRatio
      }),
      explicitReplyMessages: metrics.tempo.explicitReplyMessages,
      explicitReplyRatio: metrics.tempo.explicitReplyRatio,
      multiIncomingEpisodes: metrics.tempo.multiIncomingEpisodes,
      multiQuestionEpisodes: metrics.tempo.multiQuestionEpisodes
    }),
    reactions: Object.freeze({
      total: metrics.reactions.total,
      incoming: metrics.reactions.incoming,
      outgoing: metrics.reactions.outgoing,
      outgoingReactionRatio: metrics.reactions.outgoingReactionRatio
    }),
    surface: Object.freeze({
      outgoingTextMessages: metrics.surface.outgoingTextMessages,
      characters: Object.freeze({
        total: metrics.surface.characters.total,
        mean: metrics.surface.characters.mean,
        median: metrics.surface.characters.median,
        p90: metrics.surface.characters.p90
      }),
      words: Object.freeze({
        total: metrics.surface.words.total,
        mean: metrics.surface.words.mean,
        median: metrics.surface.words.median,
        p90: metrics.surface.words.p90
      }),
      lowercaseStartsRatio: metrics.surface.lowercaseStartsRatio,
      terminalPunctuationRatio: metrics.surface.terminalPunctuationRatio,
      questionRatio: metrics.surface.questionRatio,
      exclamationRatio: metrics.surface.exclamationRatio,
      emojiMessageRatio: metrics.surface.emojiMessageRatio,
      multilineRatio: metrics.surface.multilineRatio
    })
  });
}
function buildStudyPacket(messages, metrics, options = {}) {
  const limit = options.limit ?? DEFAULT_STUDY_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_STUDY_LIMIT) {
    throw new Error(`study packet limit must be an integer from 1 through ${MAX_STUDY_LIMIT}`);
  }
  const maximumTextBytes = boundedStudyInteger(options.maxTextBytesPerMessage, DEFAULT_MAX_STUDY_TEXT_BYTES, MAX_STUDY_TEXT_BYTES, "maxTextBytesPerMessage");
  const maximumMessagesPerDirection = boundedStudyInteger(options.maxMessagesPerDirectionPerExample, DEFAULT_MAX_STUDY_MESSAGES_PER_DIRECTION, MAX_STUDY_MESSAGES_PER_DIRECTION, "maxMessagesPerDirectionPerExample");
  const maximumBodyBytes = boundedStudyInteger(options.maxTotalBodyBytes, DEFAULT_MAX_STUDY_PACKET_BODY_BYTES, MAX_STUDY_PACKET_BODY_BYTES, "maxTotalBodyBytes");
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  canonicalTimestamp(generatedAt, "generatedAt");
  const ordered = orderedMessages(messages);
  const candidateSet = candidatesFor(ordered, metrics, maximumTextBytes, maximumMessagesPerDirection);
  const selected = selectDiverse(candidateSet.candidates, limit, maximumBodyBytes);
  const emittedBodyBytes = selected.examples.reduce((total, example) => total + example.coverage.emitted.bodyBytes, 0);
  return Object.freeze({
    schemaVersion: STUDY_PACKET_SCHEMA_VERSION,
    generatedAt,
    corpusRevision: metrics.corpusRevision,
    contactId: metrics.contactId,
    metrics: aggregateStudyMetrics(metrics),
    examples: selected.examples,
    selection: Object.freeze({
      algorithm: "bounded-diverse-response-contexts-v1",
      requestedLimit: limit,
      responseCandidates: candidateSet.responseCandidates,
      eligibleCandidates: candidateSet.candidates.length,
      emitted: selected.examples.length,
      omittedWithoutBidirectionalText: candidateSet.omittedWithoutBidirectionalText,
      omittedByExampleLimit: selected.omittedByExampleLimit,
      omittedByTotalBodyBytes: selected.omittedByTotalBodyBytes
    }),
    budget: Object.freeze({
      maxTextBytesPerMessage: maximumTextBytes,
      maxMessagesPerDirectionPerExample: maximumMessagesPerDirection,
      maxTotalBodyBytes: maximumBodyBytes,
      emittedBodyBytes,
      sourceBodyBytesInEmittedExamples: selected.examples.reduce((total, example) => total + example.coverage.source.bodyBytes, 0),
      truncatedMessages: selected.examples.reduce((total, example) => total + example.coverage.emitted.truncatedMessages, 0),
      omittedTextMessagesByDirectionLimit: selected.examples.reduce((total, example) => total + example.coverage.omitted.incomingTextMessagesByDirectionLimit + example.coverage.omitted.outgoingTextMessagesByDirectionLimit, 0),
      omittedExamplesByTotalBodyBytes: selected.omittedByTotalBodyBytes,
      omittedExampleBodyBytes: selected.omittedExampleBodyBytes
    })
  });
}

// src/paths.ts
import { randomBytes } from "crypto";
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
  writeFile
} from "fs/promises";
import { homedir as homedir2, platform } from "os";
import { basename as basename2, dirname, isAbsolute as isAbsolute2, join as join2, resolve as resolve2 } from "path";
function defaultDataDirectory() {
  const override = process.env.XDG_DATA_HOME;
  if (override !== undefined && override.trim() !== "") {
    if (!isAbsolute2(override)) {
      throw new CliError("unsafe-path", "XDG_DATA_HOME must be absolute");
    }
    return join2(resolve2(override), "message-like-me");
  }
  if (platform() === "darwin") {
    return join2(homedir2(), "Library", "Application Support", "Message Like Me");
  }
  return join2(homedir2(), ".local", "share", "message-like-me");
}
function dataPaths(explicit) {
  if (explicit !== undefined && !isAbsolute2(explicit)) {
    throw new CliError("unsafe-path", "Data directory must be absolute");
  }
  const root = explicit === undefined ? defaultDataDirectory() : resolve2(explicit);
  if (!isAbsolute2(root))
    throw new CliError("unsafe-path", "Data directory must be absolute");
  return {
    root,
    database: join2(root, "message-like-me.sqlite3"),
    installKey: join2(root, "install.key"),
    packets: join2(root, "study-packets")
  };
}
async function existingType(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT")
      return null;
    throw error;
  }
}
async function assertOwned(path) {
  if (typeof process.getuid !== "function")
    return;
  const metadata = await stat(path);
  if (metadata.uid !== process.getuid()) {
    throw new CliError("unsafe-path", `${path} is not owned by the current user`);
  }
}
async function ensurePrivateDirectory(path) {
  const before = await existingType(path);
  if (before?.isSymbolicLink())
    throw new CliError("unsafe-path", `${path} must not be a symbolic link`);
  if (before !== null && !before.isDirectory()) {
    throw new CliError("unsafe-path", `${path} must be a directory`);
  }
  await mkdir(path, { recursive: true, mode: 448 });
  const after = await lstat(path);
  if (after.isSymbolicLink() || !after.isDirectory()) {
    throw new CliError("unsafe-path", `${path} is not a physical directory`);
  }
  await assertOwned(path);
  await chmod(path, 448);
  return realpath(path);
}
async function initializeDataPaths(paths) {
  const physicalRoot = await ensurePrivateDirectory(paths.root);
  const physicalPackets = await ensurePrivateDirectory(join2(physicalRoot, "study-packets"));
  return {
    root: physicalRoot,
    database: join2(physicalRoot, basename2(paths.database)),
    installKey: join2(physicalRoot, basename2(paths.installKey)),
    packets: physicalPackets
  };
}
async function assertPrivateRegularFile(path) {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new CliError("unsafe-path", `${path} must be a physical regular file`);
  }
  await assertOwned(path);
  await chmod(path, 384);
}
async function loadOrCreateInstallKey(path) {
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
    const handle = await open(path, "wx", 384);
    try {
      await handle.writeFile(`${key.toString("hex")}
`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await assertPrivateRegularFile(path);
    return Uint8Array.from(key);
  } catch (error) {
    if (error.code === "EEXIST")
      return loadOrCreateInstallKey(path);
    throw error;
  }
}
async function atomicWritePrivate(path, bytes) {
  const parent = await ensurePrivateDirectory(dirname(resolve2(path)));
  const destination = join2(parent, basename2(path));
  const temporary = join2(parent, `.${basename2(path)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
  try {
    await writeFile(temporary, bytes, { mode: 384, flag: "wx" });
    await chmod(temporary, 384);
    await link(temporary, destination);
    await unlink(temporary);
    await assertPrivateRegularFile(destination);
  } catch (error) {
    await unlink(temporary).catch(() => {
      return;
    });
    throw error;
  }
}

// src/profile.ts
import { constants as fsConstants2 } from "fs";
import { open as open2 } from "fs/promises";
var MAX_PROFILE_FILE_BYTES = 4 * 1024 * 1024;
function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CliError("invalid-data", `${label} must be an object`);
  }
  return value;
}
function exactKeys(value, keys, label) {
  const expected = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key))
      throw new CliError("invalid-data", `${label}.${key} is not supported`);
  }
  for (const key of keys) {
    if (!(key in value))
      throw new CliError("invalid-data", `${label}.${key} is required`);
  }
}
function text(value, label, maximum = 4096) {
  if (typeof value !== "string")
    throw new CliError("invalid-data", `${label} must be text`);
  const result = value.trim();
  if (result.length < 1 || Buffer.byteLength(result) > maximum) {
    throw new CliError("invalid-data", `${label} must contain 1-${maximum} UTF-8 bytes`);
  }
  if (/\u0000/u.test(result))
    throw new CliError("invalid-data", `${label} contains a NUL byte`);
  return result;
}
function textArray(value, label, maximumItems = 32) {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new CliError("invalid-data", `${label} must contain at most ${maximumItems} items`);
  }
  return value.map((item, index) => text(item, `${label}[${index}]`, 1024));
}
function isoTimestamp(value, label) {
  const parsed = text(value, label, 64);
  const date = new Date(parsed);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== parsed) {
    throw new CliError("invalid-data", `${label} must be a canonical ISO timestamp`);
  }
  return parsed;
}
function parseStyleProfile(value) {
  const root = object(value, "profile");
  exactKeys(root, [
    "schemaVersion",
    "contactId",
    "corpusRevision",
    "packetSha256",
    "analyzedAt",
    "overview",
    "prose",
    "tempo",
    "replies",
    "contexts",
    "invariants",
    "avoid",
    "confidence"
  ], "profile");
  if (root.schemaVersion !== PROFILE_SCHEMA_VERSION) {
    throw new CliError("invalid-data", `profile.schemaVersion must be ${PROFILE_SCHEMA_VERSION}`);
  }
  const contactId = text(root.contactId, "profile.contactId", 128);
  const corpusRevision = text(root.corpusRevision, "profile.corpusRevision", 128);
  const packetSha256 = text(root.packetSha256, "profile.packetSha256", 64);
  if (!/^[a-f0-9]{64}$/u.test(packetSha256)) {
    throw new CliError("invalid-data", "profile.packetSha256 must be lowercase SHA-256");
  }
  const prose = object(root.prose, "profile.prose");
  exactKeys(prose, [
    "register",
    "capitalization",
    "punctuation",
    "vocabulary",
    "warmth",
    "humor",
    "openings",
    "closings",
    "notablePatterns"
  ], "profile.prose");
  const tempo = object(root.tempo, "profile.tempo");
  exactKeys(tempo, [
    "defaultBundle",
    "singleLongMessage",
    "multipleMessages",
    "responseTiming",
    "followUps"
  ], "profile.tempo");
  const replies = object(root.replies, "profile.replies");
  exactKeys(replies, ["usage", "useWhen", "avoidWhen"], "profile.replies");
  const confidence = object(root.confidence, "profile.confidence");
  exactKeys(confidence, ["overall", "limitations"], "profile.confidence");
  if (!Array.isArray(root.contexts) || root.contexts.length > 32) {
    throw new CliError("invalid-data", "profile.contexts must contain at most 32 items");
  }
  const overall = confidence.overall;
  if (overall !== "low" && overall !== "medium" && overall !== "high") {
    throw new CliError("invalid-data", "profile.confidence.overall must be low, medium, or high");
  }
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    contactId,
    corpusRevision,
    packetSha256,
    analyzedAt: isoTimestamp(root.analyzedAt, "profile.analyzedAt"),
    overview: text(root.overview, "profile.overview", 8192),
    prose: {
      register: text(prose.register, "profile.prose.register"),
      capitalization: text(prose.capitalization, "profile.prose.capitalization"),
      punctuation: text(prose.punctuation, "profile.prose.punctuation"),
      vocabulary: text(prose.vocabulary, "profile.prose.vocabulary"),
      warmth: text(prose.warmth, "profile.prose.warmth"),
      humor: text(prose.humor, "profile.prose.humor"),
      openings: textArray(prose.openings, "profile.prose.openings"),
      closings: textArray(prose.closings, "profile.prose.closings"),
      notablePatterns: textArray(prose.notablePatterns, "profile.prose.notablePatterns")
    },
    tempo: {
      defaultBundle: text(tempo.defaultBundle, "profile.tempo.defaultBundle"),
      singleLongMessage: text(tempo.singleLongMessage, "profile.tempo.singleLongMessage"),
      multipleMessages: text(tempo.multipleMessages, "profile.tempo.multipleMessages"),
      responseTiming: text(tempo.responseTiming, "profile.tempo.responseTiming"),
      followUps: text(tempo.followUps, "profile.tempo.followUps")
    },
    replies: {
      usage: text(replies.usage, "profile.replies.usage"),
      useWhen: textArray(replies.useWhen, "profile.replies.useWhen"),
      avoidWhen: textArray(replies.avoidWhen, "profile.replies.avoidWhen")
    },
    contexts: root.contexts.map((item, index) => {
      const context = object(item, `profile.contexts[${index}]`);
      exactKeys(context, [
        "when",
        "incomingPattern",
        "responseStrategy",
        "prosePattern",
        "tempoPattern",
        "evidenceExampleIds"
      ], `profile.contexts[${index}]`);
      return {
        when: text(context.when, `profile.contexts[${index}].when`),
        incomingPattern: text(context.incomingPattern, `profile.contexts[${index}].incomingPattern`),
        responseStrategy: text(context.responseStrategy, `profile.contexts[${index}].responseStrategy`),
        prosePattern: text(context.prosePattern, `profile.contexts[${index}].prosePattern`),
        tempoPattern: text(context.tempoPattern, `profile.contexts[${index}].tempoPattern`),
        evidenceExampleIds: textArray(context.evidenceExampleIds, `profile.contexts[${index}].evidenceExampleIds`)
      };
    }),
    invariants: textArray(root.invariants, "profile.invariants"),
    avoid: textArray(root.avoid, "profile.avoid"),
    confidence: {
      overall,
      limitations: textArray(confidence.limitations, "profile.confidence.limitations")
    }
  };
}
async function readStyleProfile(path) {
  let parsed;
  try {
    const handle = await open2(path, fsConstants2.O_RDONLY | fsConstants2.O_NOFOLLOW);
    try {
      const before = await handle.stat();
      const privateMode = (before.mode & 63) === 0;
      const owned = typeof process.getuid !== "function" || before.uid === process.getuid();
      if (!before.isFile() || before.nlink !== 1 || !owned || !privateMode) {
        throw new CliError("unsafe-path", "Profile must be one current-user-owned regular non-symlink file with private permissions");
      }
      if (!Number.isSafeInteger(before.size) || before.size < 1 || before.size > MAX_PROFILE_FILE_BYTES) {
        throw new CliError("invalid-data", `Profile must contain 1-${MAX_PROFILE_FILE_BYTES} bytes`);
      }
      const bytes = Buffer.alloc(before.size + 1);
      let offset = 0;
      while (offset < bytes.byteLength) {
        const result = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
        if (result.bytesRead === 0)
          break;
        offset += result.bytesRead;
      }
      const after = await handle.stat();
      if (offset !== before.size || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
        throw new CliError("conflict", "Profile changed while it was being read");
      }
      parsed = JSON.parse(bytes.subarray(0, offset).toString("utf8"));
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof CliError)
      throw error;
    if (error.code === "ELOOP") {
      throw new CliError("unsafe-path", `Profile path ${path} must not be a symbolic link`, {
        cause: error
      });
    }
    throw new CliError("invalid-data", `Could not read profile JSON at ${path}`, { cause: error });
  }
  return parseStyleProfile(parsed);
}

// src/skill-install.ts
import { cp, lstat as lstat2, mkdir as mkdir2, realpath as realpath2, rm } from "fs/promises";
import { homedir as homedir3 } from "os";
import { dirname as dirname2, join as join3, resolve as resolve3 } from "path";
import { fileURLToPath } from "url";
async function exists(path) {
  try {
    await lstat2(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT")
      return false;
    throw error;
  }
}
function bundledSkillPath() {
  return resolve3(dirname2(fileURLToPath(import.meta.url)), "../skills/message-like-me");
}
function targetRoot(target, scope, projectDirectory) {
  const directory = target === "codex" ? ".codex" : target === "claude" ? ".claude" : ".agents";
  return scope === "user" ? join3(homedir3(), directory, "skills") : join3(resolve3(projectDirectory), directory, "skills");
}
async function installSkill(options) {
  const source = bundledSkillPath();
  if (!await exists(source))
    throw new CliError("not-found", `Bundled skill is missing at ${source}`);
  const sourceMetadata = await lstat2(source);
  if (sourceMetadata.isSymbolicLink() || !sourceMetadata.isDirectory()) {
    throw new CliError("unsafe-path", "Bundled skill must be a physical directory");
  }
  const root = targetRoot(options.target, options.scope, options.projectDirectory ?? process.cwd());
  await mkdir2(root, { recursive: true, mode: 448 });
  const destination = join3(root, "message-like-me");
  if (await exists(destination)) {
    const metadata = await lstat2(destination);
    if (metadata.isSymbolicLink()) {
      throw new CliError("unsafe-path", `Refusing to replace symbolic link ${destination}`);
    }
    if (!options.force) {
      throw new CliError("conflict", `Skill already exists at ${destination}; pass --force to replace it`);
    }
    await rm(destination, { recursive: true, force: true });
  }
  await cp(source, destination, { recursive: true, errorOnExist: true });
  return realpath2(destination);
}

// src/store.ts
import { Database as Database2 } from "bun:sqlite";
import { chmodSync as chmodSync2, lstatSync as lstatSync2 } from "fs";
var SCHEMA = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    source_key TEXT NOT NULL,
    private_label TEXT,
    service TEXT,
    participant_count INTEGER NOT NULL CHECK (participant_count >= 0),
    participant_ids_json TEXT NOT NULL,
    private_participants_json TEXT NOT NULL,
    is_group INTEGER NOT NULL CHECK (is_group IN (0, 1))
  ) STRICT;
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    source_row_id INTEGER NOT NULL,
    source_guid TEXT NOT NULL,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sent_at TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
    body TEXT,
    body_source TEXT NOT NULL CHECK (body_source IN ('text', 'attributed-body', 'unavailable')),
    kind TEXT NOT NULL CHECK (kind IN ('text', 'attachment', 'reaction', 'system', 'unknown')),
    reply_to_source_guid TEXT,
    edited_at TEXT,
    retracted_at TEXT,
    service TEXT,
    attachment_count INTEGER NOT NULL CHECK (attachment_count >= 0),
    UNIQUE (source_row_id, conversation_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS messages_conversation_time
    ON messages(conversation_id, sent_at, source_row_id, id);
  CREATE INDEX IF NOT EXISTS messages_source_guid ON messages(source_guid);
  CREATE TABLE IF NOT EXISTS study_packets (
    sha256 TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL,
    corpus_revision TEXT NOT NULL,
    created_at TEXT NOT NULL,
    private_path TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS profiles (
    contact_id TEXT PRIMARY KEY,
    corpus_revision TEXT NOT NULL,
    packet_sha256 TEXT NOT NULL,
    analyzed_at TEXT NOT NULL,
    profile_json TEXT NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT;
`;
function get(database, sql, ...bindings) {
  return database.query(sql).get(...bindings);
}
function all(database, sql, ...bindings) {
  return database.query(sql).all(...bindings);
}
function scalarText(database, key) {
  return get(database, "SELECT value FROM metadata WHERE key = ?", key)?.value ?? null;
}
function transaction(database, operation) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
function readTransaction(database, operation) {
  database.exec("BEGIN");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

class LocalStore {
  #database;
  constructor(database) {
    this.#database = database;
  }
  static open(path) {
    const existing = (() => {
      try {
        return lstatSync2(path);
      } catch (error) {
        if (error.code === "ENOENT")
          return null;
        throw error;
      }
    })();
    if (existing?.isSymbolicLink() || existing !== null && !existing.isFile()) {
      throw new CliError("unsafe-path", `${path} must be a physical regular file`);
    }
    if (existing !== null && typeof process.getuid === "function" && existing.uid !== process.getuid()) {
      throw new CliError("unsafe-path", `${path} is not owned by the current user`);
    }
    const database = new Database2(path, { create: true, strict: true });
    database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");
    database.exec(SCHEMA);
    chmodSync2(path, 384);
    return new LocalStore(database);
  }
  close() {
    this.#database.close();
  }
  corpusRevision() {
    return scalarText(this.#database, "corpus_revision");
  }
  sourceIdentity() {
    const encoded = scalarText(this.#database, "source_identity");
    return encoded === null ? null : JSON.parse(encoded);
  }
  replaceCorpus(snapshot, ingestedAt) {
    const corpusRevision = snapshot.source.snapshotSha256;
    if (!/^[a-f0-9]{64}$/u.test(corpusRevision)) {
      throw new CliError("invalid-data", "The iMessage reader returned an invalid corpus revision");
    }
    const conversationIds = new Set(snapshot.conversations.map((conversation) => conversation.id));
    if (conversationIds.size !== snapshot.conversations.length) {
      throw new CliError("invalid-data", "The iMessage reader returned duplicate conversation IDs");
    }
    const messageIds = new Set;
    for (const message of snapshot.messages) {
      if (!conversationIds.has(message.conversationId)) {
        throw new CliError("invalid-data", `Message ${message.id} references an unknown conversation`);
      }
      if (messageIds.has(message.id))
        throw new CliError("invalid-data", `Duplicate message ID ${message.id}`);
      messageIds.add(message.id);
    }
    transaction(this.#database, () => {
      this.#database.exec("DELETE FROM messages; DELETE FROM conversations;");
      const insertConversation = this.#database.query(`
        INSERT INTO conversations (
          id, source_key, private_label, service, participant_count,
          participant_ids_json, private_participants_json, is_group
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const conversation of snapshot.conversations) {
        insertConversation.run(conversation.id, conversation.sourceKey, conversation.privateLabel, conversation.service, conversation.participantCount, canonicalJson(conversation.participantIds), canonicalJson(conversation.privateParticipants), conversation.group ? 1 : 0);
      }
      const insertMessage = this.#database.query(`
        INSERT INTO messages (
          id, source_row_id, source_guid, conversation_id, sent_at, direction,
          body, body_source, kind, reply_to_source_guid, edited_at, retracted_at,
          service, attachment_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const message of snapshot.messages) {
        insertMessage.run(message.id, message.sourceRowId, message.sourceGuid, message.conversationId, message.sentAt, message.direction, message.body, message.bodySource, message.kind, message.replyToSourceGuid, message.editedAt, message.retractedAt, message.service, message.attachmentCount);
      }
      const setMetadata = this.#database.query(`
        INSERT INTO metadata (key, value) VALUES (?, ?)
        ON CONFLICT (key) DO UPDATE SET value = excluded.value
      `);
      for (const [key, value] of [
        ["corpus_revision", corpusRevision],
        ["source_identity", canonicalJson(snapshot.source)],
        ["ingested_at", ingestedAt],
        ["warnings", canonicalJson(snapshot.warnings)],
        ["corpus_schema_version", String(snapshot.schemaVersion)]
      ])
        setMetadata.run(key, value);
    });
    return {
      corpusRevision,
      conversations: snapshot.conversations.length,
      messages: snapshot.messages.length
    };
  }
  listContacts(options) {
    const revision = this.corpusRevision();
    if (revision === null)
      return [];
    const rows = all(this.#database, `
      SELECT conversation.id, conversation.private_label, conversation.is_group,
        conversation.participant_count, min(message.sent_at) AS first_message_at,
        max(message.sent_at) AS last_message_at, count(message.id) AS message_count,
        sum(CASE WHEN message.direction = 'incoming' THEN 1 ELSE 0 END) AS incoming_count,
        sum(CASE WHEN message.direction = 'outgoing' THEN 1 ELSE 0 END) AS outgoing_count,
        profile.corpus_revision AS profile_revision
      FROM conversations conversation
      JOIN messages message ON message.conversation_id = conversation.id
      LEFT JOIN profiles profile ON profile.contact_id = conversation.id
      GROUP BY conversation.id
      HAVING outgoing_count >= ?
      ORDER BY outgoing_count DESC, last_message_at DESC, conversation.id
      LIMIT ?
    `, options.minimumOutgoing, options.limit);
    return rows.map((row) => ({
      id: row.id,
      ...options.privateLabels ? { privateLabel: row.private_label } : {},
      group: row.is_group === 1,
      participantCount: row.participant_count,
      firstMessageAt: row.first_message_at,
      lastMessageAt: row.last_message_at,
      messageCount: row.message_count,
      incomingCount: row.incoming_count,
      outgoingCount: row.outgoing_count,
      profileState: row.profile_revision === null ? "missing" : row.profile_revision === revision ? "current" : "stale"
    }));
  }
  conversation(contactId, privateLabels) {
    const row = get(this.#database, `
      SELECT conversation.*,
        min(message.sent_at) AS first_message_at,
        max(message.sent_at) AS last_message_at,
        count(message.id) AS message_count,
        sum(CASE WHEN message.direction = 'incoming' THEN 1 ELSE 0 END) AS incoming_count,
        sum(CASE WHEN message.direction = 'outgoing' THEN 1 ELSE 0 END) AS outgoing_count
      FROM conversations conversation
      LEFT JOIN messages message ON message.conversation_id = conversation.id
      WHERE conversation.id = ?
      GROUP BY conversation.id
    `, contactId);
    if (row === null)
      return null;
    return {
      id: row.id,
      sourceKey: row.source_key,
      privateLabel: privateLabels ? row.private_label : null,
      service: row.service,
      participantCount: row.participant_count,
      participantIds: JSON.parse(row.participant_ids_json),
      privateParticipants: privateLabels ? JSON.parse(row.private_participants_json) : [],
      group: row.is_group === 1,
      firstMessageAt: row.first_message_at,
      lastMessageAt: row.last_message_at,
      messageCount: row.message_count,
      incomingCount: row.incoming_count,
      outgoingCount: row.outgoing_count
    };
  }
  messages(contactId) {
    return all(this.#database, `
      SELECT * FROM messages WHERE conversation_id = ?
      ORDER BY sent_at, source_row_id, id
    `, contactId).map((row) => ({
      id: row.id,
      sourceRowId: row.source_row_id,
      sourceGuid: row.source_guid,
      conversationId: row.conversation_id,
      sentAt: row.sent_at,
      direction: row.direction,
      body: row.body,
      bodySource: row.body_source,
      kind: row.kind,
      replyToSourceGuid: row.reply_to_source_guid,
      editedAt: row.edited_at,
      retractedAt: row.retracted_at,
      service: row.service,
      attachmentCount: row.attachment_count
    }));
  }
  contactCorpus(contactId) {
    return readTransaction(this.#database, () => {
      const corpusRevision = scalarText(this.#database, "corpus_revision");
      const contact = get(this.#database, "SELECT 1 AS value FROM conversations WHERE id = ?", contactId);
      if (contact === null)
        return null;
      if (corpusRevision === null) {
        throw new CliError("invalid-data", "Stored conversations have no corpus revision");
      }
      return {
        corpusRevision,
        messages: this.messages(contactId)
      };
    });
  }
  recordStudyPacket(receipt) {
    transaction(this.#database, () => {
      const revision = scalarText(this.#database, "corpus_revision");
      if (revision !== receipt.corpusRevision) {
        throw new CliError("conflict", "Corpus changed while the study packet was prepared; prepare it again");
      }
      const contact = get(this.#database, "SELECT 1 AS value FROM conversations WHERE id = ?", receipt.contactId);
      if (contact === null)
        throw new CliError("not-found", `Unknown contact ${receipt.contactId}`);
      this.#database.query(`
        INSERT INTO study_packets (sha256, contact_id, corpus_revision, created_at, private_path)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (sha256) DO UPDATE SET
          contact_id = excluded.contact_id,
          corpus_revision = excluded.corpus_revision,
          created_at = excluded.created_at,
          private_path = excluded.private_path
      `).run(receipt.sha256, receipt.contactId, receipt.corpusRevision, receipt.createdAt, receipt.privatePath);
    });
  }
  applyProfile(profile, appliedAt) {
    const revision = this.corpusRevision();
    if (revision === null)
      throw new CliError("conflict", "Ingest iMessage before applying a profile");
    if (profile.corpusRevision !== revision) {
      throw new CliError("conflict", "Profile corpus revision is stale; prepare and analyze a new study packet");
    }
    if (this.conversation(profile.contactId, false) === null) {
      throw new CliError("not-found", `Unknown contact ${profile.contactId}`);
    }
    const packet = get(this.#database, `
      SELECT 1 AS value FROM study_packets
      WHERE sha256 = ? AND contact_id = ? AND corpus_revision = ?
    `, profile.packetSha256, profile.contactId, profile.corpusRevision);
    if (packet === null) {
      throw new CliError("conflict", "Profile does not bind a study packet prepared by this installation");
    }
    this.#database.query(`
      INSERT INTO profiles (
        contact_id, corpus_revision, packet_sha256, analyzed_at, profile_json, applied_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (contact_id) DO UPDATE SET
        corpus_revision = excluded.corpus_revision,
        packet_sha256 = excluded.packet_sha256,
        analyzed_at = excluded.analyzed_at,
        profile_json = excluded.profile_json,
        applied_at = excluded.applied_at
    `).run(profile.contactId, profile.corpusRevision, profile.packetSha256, profile.analyzedAt, canonicalJson(profile), appliedAt);
  }
  profile(contactId) {
    const row = get(this.#database, "SELECT corpus_revision, profile_json, applied_at FROM profiles WHERE contact_id = ?", contactId);
    if (row === null)
      return null;
    return {
      state: row.corpus_revision === this.corpusRevision() ? "current" : "stale",
      profile: JSON.parse(row.profile_json),
      appliedAt: row.applied_at
    };
  }
  doctor() {
    const quick = get(this.#database, "PRAGMA quick_check")?.quick_check ?? "unknown";
    const foreignKeys = all(this.#database, "PRAGMA foreign_key_check").length;
    const count = (table) => get(this.#database, `SELECT count(*) AS value FROM ${table}`)?.value ?? 0;
    return {
      quickCheck: quick,
      foreignKeyViolations: foreignKeys,
      corpusRevision: this.corpusRevision(),
      conversations: count("conversations"),
      messages: count("messages"),
      profiles: count("profiles")
    };
  }
}

// src/version.ts
var MESSAGE_LIKE_ME_VERSION = "0.1.0";

// src/commands.ts
var HELP = `Message Like Me ${MESSAGE_LIKE_ME_VERSION}

Usage:
  messagelikeme [--data-dir PATH] init [--json]
  messagelikeme [--data-dir PATH] ingest imessage [--database PATH] [--json]
  messagelikeme [--data-dir PATH] contacts list [--min-outgoing N] [--limit N] [--private] [--json]
  messagelikeme [--data-dir PATH] contacts show CONTACT_ID [--private] [--json]
  messagelikeme [--data-dir PATH] inspect tempo CONTACT_ID [--json]
  messagelikeme [--data-dir PATH] inspect sessions CONTACT_ID [--limit N] [--json]
  messagelikeme [--data-dir PATH] study prepare CONTACT_ID --output FILE [--limit N] [--json]
  messagelikeme [--data-dir PATH] profile apply FILE [--json]
  messagelikeme [--data-dir PATH] profile show CONTACT_ID [--json]
  messagelikeme [--data-dir PATH] profile export CONTACT_ID --output FILE [--json]
  messagelikeme [--data-dir PATH] context CONTACT_ID [--json]
  messagelikeme skill path [--json]
  messagelikeme skill install [--target codex|claude|agents] [--scope user|project]
                    [--project PATH] [--force] [--json]
  messagelikeme [--data-dir PATH] doctor [--json]

Message Like Me reads a caller-owned macOS Messages database and stores private
analysis locally. It has no network, account, AI-provider, or message-sending surface.
`;
async function exists2(path) {
  try {
    await lstat3(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT")
      return false;
    throw error;
  }
}
function emit(io, json, value, human) {
  io.stdout(json ? prettyJson(value) : `${human}
`);
}
function canonicalNow(io) {
  const date = io.now();
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new CliError("internal", "Clock returned an invalid time");
  }
  return date.toISOString();
}
function globalDataPaths(parsed) {
  return dataPaths(parsed.options.get("data-dir"));
}
async function existingStore(parsed) {
  const requested = globalDataPaths(parsed);
  if (!await exists2(requested.root) || !await exists2(requested.database)) {
    throw new CliError("not-found", "Message Like Me is not initialized; run messagelikeme init or ingest imessage");
  }
  const paths = await initializeDataPaths(requested);
  return { paths, store: LocalStore.open(paths.database) };
}
async function writableStore(parsed) {
  const paths = await initializeDataPaths(globalDataPaths(parsed));
  const key = await loadOrCreateInstallKey(paths.installKey);
  return { paths, key, store: LocalStore.open(paths.database) };
}
function requireContact(store, contactId, privateLabels = false) {
  if (contactId.length < 1 || contactId.length > 256)
    throw new CliError("usage", "Invalid contact ID");
  const conversation = store.conversation(contactId, privateLabels);
  if (conversation === null)
    throw new CliError("not-found", `Unknown contact ${contactId}`);
  return conversation;
}
function contactEvidence(store, contactId) {
  if (contactId.length < 1 || contactId.length > 256)
    throw new CliError("usage", "Invalid contact ID");
  const evidence = store.contactCorpus(contactId);
  if (evidence === null)
    throw new CliError("not-found", `Unknown contact ${contactId}`);
  return evidence;
}
function contactMetrics(store, contactId) {
  const evidence = contactEvidence(store, contactId);
  return analyzeContact(evidence.messages, evidence.corpusRevision, contactId);
}
function safeContactDetail(store, contactId, privateLabels) {
  const conversation = requireContact(store, contactId, privateLabels);
  return {
    id: conversation.id,
    ...privateLabels ? {
      privateLabel: conversation.privateLabel,
      privateParticipants: conversation.privateParticipants
    } : {},
    service: conversation.service,
    group: conversation.group,
    participantCount: conversation.participantCount,
    participantIds: conversation.participantIds,
    firstMessageAt: conversation.firstMessageAt,
    lastMessageAt: conversation.lastMessageAt,
    messageCount: conversation.messageCount,
    incomingCount: conversation.incomingCount,
    outgoingCount: conversation.outgoingCount
  };
}
function compactMetrics(metrics) {
  return {
    schemaVersion: metrics.schemaVersion,
    corpusRevision: metrics.corpusRevision,
    contactId: metrics.contactId,
    firstMessageAt: metrics.firstMessageAt,
    lastMessageAt: metrics.lastMessageAt,
    messageCount: metrics.messageCount,
    incomingCount: metrics.incomingCount,
    outgoingCount: metrics.outgoingCount,
    textMessageCount: metrics.textMessageCount,
    sessionGapSeconds: metrics.sessionGapSeconds,
    burstGapSeconds: metrics.burstGapSeconds,
    sessionCount: metrics.sessions.length,
    burstCount: metrics.bursts.length,
    reactions: metrics.reactions,
    tempo: metrics.tempo,
    surface: metrics.surface
  };
}
function absolutePrivatePath(value, label) {
  if (value === undefined)
    throw new CliError("usage", `${label} is required`);
  if (!isAbsolute3(value))
    throw new CliError("unsafe-path", `${label} must be an absolute private path`);
  return resolve4(value);
}
function translateIMessageError(error) {
  const code = error.code;
  if (code === "EACCES" || code === "EPERM") {
    throw new CliError("permission", "Messages data is not readable. Grant Full Disk Access to this terminal or agent host, then retry.", { cause: error });
  }
  if (code === "ENOENT") {
    throw new CliError("not-found", "The selected Messages database does not exist", { cause: error });
  }
  throw new CliError("invalid-data", error instanceof Error ? error.message : String(error), { cause: error });
}
async function runCommand(argv, io) {
  const parsed = parseArguments(argv);
  if (parsed.flags.has("version")) {
    rejectUnused(parsed, [], ["version"]);
    if (parsed.positionals.length !== 0)
      throw new CliError("usage", "--version takes no command");
    io.stdout(`${MESSAGE_LIKE_ME_VERSION}
`);
    return;
  }
  if (parsed.flags.has("help") || parsed.positionals.length === 0) {
    if (parsed.flags.has("help"))
      rejectUnused(parsed, ["data-dir"], ["help"]);
    io.stdout(HELP);
    return;
  }
  const json = parsed.flags.has("json");
  const [command, subcommand, identifier, ...extra] = parsed.positionals;
  if (extra.length !== 0)
    throw new CliError("usage", `Unexpected argument ${extra[0]}`);
  if (command === "init" && subcommand === undefined) {
    rejectUnused(parsed, ["data-dir"], ["json"]);
    const context = await writableStore(parsed);
    try {
      const result = { initialized: true, dataDirectory: context.paths.root, database: context.paths.database };
      emit(io, json, result, `Initialized private Message Like Me data at ${context.paths.root}`);
    } finally {
      context.store.close();
    }
    return;
  }
  if (command === "ingest" && subcommand === "imessage" && identifier === undefined) {
    rejectUnused(parsed, ["data-dir", "database"], ["json"]);
    const context = await writableStore(parsed);
    try {
      let snapshot;
      try {
        snapshot = readIMessageDatabase(parsed.options.get("database") ?? DEFAULT_IMESSAGE_DATABASE, {
          hmacKey: context.key
        });
      } catch (error) {
        translateIMessageError(error);
      }
      const stored = context.store.replaceCorpus(snapshot, canonicalNow(io));
      const result = {
        ...stored,
        source: {
          bytes: snapshot.source.bytes,
          modifiedAt: snapshot.source.modifiedAt,
          schemaSha256: snapshot.source.schemaSha256
        },
        warnings: snapshot.warnings
      };
      emit(io, json, result, `Ingested ${stored.messages} messages across ${stored.conversations} conversations`);
    } finally {
      context.store.close();
    }
    return;
  }
  if (command === "contacts" && subcommand === "list" && identifier === undefined) {
    rejectUnused(parsed, ["data-dir", "min-outgoing", "limit"], ["json", "private"]);
    const context = await existingStore(parsed);
    try {
      const contacts = context.store.listContacts({
        privateLabels: parsed.flags.has("private"),
        minimumOutgoing: integerOption(parsed, "min-outgoing", 1, 0, 1e7),
        limit: integerOption(parsed, "limit", 50, 1, 1000)
      });
      emit(io, json, { contacts }, `${contacts.length} contacts`);
    } finally {
      context.store.close();
    }
    return;
  }
  if (command === "contacts" && subcommand === "show" && identifier !== undefined) {
    rejectUnused(parsed, ["data-dir"], ["json", "private"]);
    const context = await existingStore(parsed);
    try {
      const detail = safeContactDetail(context.store, identifier, parsed.flags.has("private"));
      emit(io, json, detail, `Contact ${identifier}`);
    } finally {
      context.store.close();
    }
    return;
  }
  if (command === "inspect" && subcommand === "tempo" && identifier !== undefined) {
    rejectUnused(parsed, ["data-dir"], ["json"]);
    const context = await existingStore(parsed);
    try {
      const metrics = contactMetrics(context.store, identifier);
      const result = compactMetrics(metrics);
      emit(io, json, result, `Tempo metrics for ${identifier}: ${metrics.tempo.responseEpisodes} response episodes`);
    } finally {
      context.store.close();
    }
    return;
  }
  if (command === "inspect" && subcommand === "sessions" && identifier !== undefined) {
    rejectUnused(parsed, ["data-dir", "limit"], ["json"]);
    const context = await existingStore(parsed);
    try {
      const metrics = contactMetrics(context.store, identifier);
      const limit = integerOption(parsed, "limit", 20, 1, 1000);
      const sessions = metrics.sessions.slice(-limit);
      const result = { contactId: identifier, total: metrics.sessions.length, sessions };
      emit(io, json, result, `${sessions.length} of ${metrics.sessions.length} sessions for ${identifier}`);
    } finally {
      context.store.close();
    }
    return;
  }
  if (command === "study" && subcommand === "prepare" && identifier !== undefined) {
    rejectUnused(parsed, ["data-dir", "output", "limit"], ["json"]);
    const output = absolutePrivatePath(parsed.options.get("output"), "--output");
    const context = await existingStore(parsed);
    try {
      const evidence = contactEvidence(context.store, identifier);
      const metrics = analyzeContact(evidence.messages, evidence.corpusRevision, identifier);
      const packet = buildStudyPacket(evidence.messages, metrics, {
        limit: integerOption(parsed, "limit", 24, 1, 50),
        generatedAt: canonicalNow(io)
      });
      const bytes = prettyJson(packet);
      const packetSha256 = sha256(bytes);
      await atomicWritePrivate(output, bytes);
      context.store.recordStudyPacket({
        sha256: packetSha256,
        contactId: identifier,
        corpusRevision: metrics.corpusRevision,
        createdAt: packet.generatedAt,
        privatePath: output
      });
      const result = {
        contactId: identifier,
        corpusRevision: metrics.corpusRevision,
        packetSha256,
        examples: packet.examples.length,
        output
      };
      emit(io, json, result, `Prepared ${packet.examples.length} private study examples at ${output} (SHA-256 ${packetSha256})`);
    } finally {
      context.store.close();
    }
    return;
  }
  if (command === "profile" && subcommand === "apply" && identifier !== undefined) {
    rejectUnused(parsed, ["data-dir"], ["json"]);
    const path = absolutePrivatePath(identifier, "Profile path");
    const profile = await readStyleProfile(path);
    const context = await existingStore(parsed);
    try {
      context.store.applyProfile(profile, canonicalNow(io));
      const result = { applied: true, contactId: profile.contactId, corpusRevision: profile.corpusRevision };
      emit(io, json, result, `Applied current profile for ${profile.contactId}`);
    } finally {
      context.store.close();
    }
    return;
  }
  if (command === "profile" && subcommand === "show" && identifier !== undefined) {
    rejectUnused(parsed, ["data-dir"], ["json"]);
    const context = await existingStore(parsed);
    try {
      requireContact(context.store, identifier);
      const result = context.store.profile(identifier);
      if (result === null)
        throw new CliError("not-found", `No profile exists for ${identifier}`);
      emit(io, json, result, `${result.state} profile for ${identifier}`);
    } finally {
      context.store.close();
    }
    return;
  }
  if (command === "profile" && subcommand === "export" && identifier !== undefined) {
    rejectUnused(parsed, ["data-dir", "output"], ["json"]);
    const output = absolutePrivatePath(parsed.options.get("output"), "--output");
    const context = await existingStore(parsed);
    try {
      requireContact(context.store, identifier);
      const result = context.store.profile(identifier);
      if (result === null)
        throw new CliError("not-found", `No profile exists for ${identifier}`);
      await atomicWritePrivate(output, prettyJson(result.profile));
      const receipt = { contactId: identifier, state: result.state, output };
      emit(io, json, receipt, `Exported ${result.state} profile to ${output}`);
    } finally {
      context.store.close();
    }
    return;
  }
  if (command === "context" && subcommand !== undefined && identifier === undefined) {
    rejectUnused(parsed, ["data-dir"], ["json"]);
    const contactId = subcommand;
    const context = await existingStore(parsed);
    try {
      const result = {
        contact: safeContactDetail(context.store, contactId, false),
        metrics: compactMetrics(contactMetrics(context.store, contactId)),
        profile: context.store.profile(contactId)
      };
      emit(io, json, result, `Drafting context for ${contactId}`);
    } finally {
      context.store.close();
    }
    return;
  }
  if (command === "skill" && subcommand === "path" && identifier === undefined) {
    rejectUnused(parsed, ["data-dir"], ["json"]);
    const path = bundledSkillPath();
    emit(io, json, { path }, path);
    return;
  }
  if (command === "skill" && subcommand === "install" && identifier === undefined) {
    rejectUnused(parsed, ["data-dir", "target", "scope", "project"], ["force", "json"]);
    const target = parsed.options.get("target") ?? "codex";
    const scope = parsed.options.get("scope") ?? "user";
    if (target !== "codex" && target !== "claude" && target !== "agents") {
      throw new CliError("usage", "--target must be codex, claude, or agents");
    }
    if (scope !== "user" && scope !== "project") {
      throw new CliError("usage", "--scope must be user or project");
    }
    const project = parsed.options.get("project");
    if (project !== undefined && scope !== "project") {
      throw new CliError("usage", "--project requires --scope project");
    }
    const destination = await installSkill({
      target,
      scope,
      ...project === undefined ? {} : { projectDirectory: project },
      force: parsed.flags.has("force")
    });
    emit(io, json, { destination, target, scope }, `Installed message-like-me skill at ${destination}`);
    return;
  }
  if (command === "doctor" && subcommand === undefined) {
    rejectUnused(parsed, ["data-dir"], ["json"]);
    const requested = globalDataPaths(parsed);
    const initialized = await exists2(requested.database);
    if (!initialized) {
      const result = {
        ok: true,
        initialized: false,
        dataDirectory: requested.root,
        defaultMessagesDatabase: DEFAULT_IMESSAGE_DATABASE
      };
      emit(io, json, result, `Message Like Me is not initialized at ${requested.root}`);
      return;
    }
    const context = await existingStore(parsed);
    try {
      const status = context.store.doctor();
      const result = {
        ok: status.quickCheck === "ok" && status.foreignKeyViolations === 0,
        initialized: true,
        dataDirectory: context.paths.root,
        database: context.paths.database,
        ...status
      };
      emit(io, json, result, result.ok ? "Message Like Me local state is healthy" : "Message Like Me local state needs attention");
    } finally {
      context.store.close();
    }
    return;
  }
  throw new CliError("usage", `Unknown command

${HELP}`);
}

// src/io.ts
var processIo = {
  stdout: (text2) => process.stdout.write(text2),
  stderr: (text2) => process.stderr.write(text2),
  now: () => new Date
};

// src/cli.ts
async function main(argv, io = processIo) {
  try {
    await runCommand(argv, io);
    return 0;
  } catch (error) {
    io.stderr(`${errorMessage(error)}
`);
    return exitCodeFor(error);
  }
}
if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
export {
  main
};
