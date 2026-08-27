#!/usr/bin/env bun
// @bun
import {
  CONTACTS_SCHEMA_VERSION,
  CORPUS_SCHEMA_VERSION,
  EVALUATION_PACKET_SCHEMA_VERSION,
  LEGACY_PROFILE_SCHEMA_VERSION,
  MESSAGE_BUNDLE_SCHEMA_VERSION,
  METRICS_SCHEMA_VERSION,
  PROFILE_SCHEMA_VERSION,
  STUDY_PACKET_SCHEMA_VERSION
} from "./cli-d8tyw38n.js";
import {
  LOCAL_MESSAGE_BUNDLE_V1_ARTIFACTS,
  LOCAL_MESSAGE_BUNDLE_V1_LIMITS,
  MessageBundleV1ContractError,
  parseLocalMessageBundleV1Manifest,
  parseLocalMessageBundleV1Record
} from "./cli-ry4128kz.js";
import"./cli-qqafdvz9.js";
import {
  AGENTIC_MESSAGING_V1_LIMITS,
  AgenticMessagingV1ContractError,
  agentMessageRouteCandidateId,
  createAgentMessageHandoffV1,
  parseAgentMessageDraftV1,
  parseAgentMessageHandoffRequestV1,
  parseAgentMessageHandoffV1,
  parseWrenchMessagingContextBindingV1,
  parseWrenchMessagingReceiptBindingV1,
  wrenchMessagingTurnDigestV1
} from "./cli-d7qv38ab.js";
import {
  canonicalJson,
  prettyJson,
  sha256
} from "./cli-ththzwja.js";

// src/commands.ts
import { lstat as lstat5, unlink as unlink2 } from "fs/promises";
import { isAbsolute as isAbsolute6, resolve as resolve7 } from "path";

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
  "addressbook",
  "after",
  "before",
  "burst-gap",
  "data-dir",
  "database",
  "input",
  "limit",
  "min-outgoing",
  "output",
  "overlap-source",
  "prompt-output",
  "project",
  "reference-output",
  "request",
  "scope",
  "session-gap",
  "target",
  "draft",
  "wrench-context",
  "wrench-receipt"
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

// src/bundle.ts
import { createHash, createHmac as createHmac2 } from "crypto";
import { constants as fsConstants2, createReadStream } from "fs";
import { lstat, open, readdir, realpath } from "fs/promises";
import { isAbsolute as isAbsolute2, join as join2, resolve as resolve2 } from "path";

// src/contacts.ts
import { Database } from "bun:sqlite";
import { createHmac } from "crypto";
import {
  chmodSync,
  constants as fsConstants,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync
} from "fs";
import { homedir, tmpdir } from "os";
import { basename, dirname, isAbsolute, join, resolve } from "path";
var DEFAULT_CONTACTS_DIRECTORY = join(homedir(), "Library", "Application Support", "AddressBook");
var DATABASE_NAME = /^AddressBook-v[1-9][0-9]*\.abcddb$/u;
var MAX_SOURCE_DATABASES = 64;
var MAX_SOURCE_DATABASE_BYTES = 512 * 1024 * 1024;
var MAX_TOTAL_SOURCE_BYTES = 4 * 1024 * 1024 * 1024;
var MAX_SHM_BYTES = 64 * 1024 * 1024;
var MAX_CONTACTS = 1e5;
var MAX_METHOD_ROWS = 500000;
var MAX_TABLES = 512;
var MAX_COLUMNS_PER_TABLE = 512;
var MAX_IDENTIFIER_BYTES = 1024;
var MAX_LABEL_BYTES = 4096;
var MAX_HANDLE_BYTES = 4096;
var MAX_TOTAL_TEXT_BYTES = 128 * 1024 * 1024;
var DEFAULT_PAGE_SIZE = 5000;
var MAX_PAGE_SIZE = 20000;
var SNAPSHOT_ATTEMPTS = 5;
function fail(message) {
  throw new Error(`Contacts source ${message}`);
}
function boundedInteger(value, fallback, minimum, maximum, label) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}`);
  }
  return result;
}
function keyBytes(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 16 || bytes.byteLength > 1024) {
    throw new Error("Contacts HMAC key must contain 16 through 1024 bytes");
  }
  return Uint8Array.from(bytes);
}
function hmac(key, namespace, value) {
  return createHmac("sha256", key).update(`message-like-me\x00${namespace}\x00`, "utf8").update(value, "utf8").digest("hex");
}
function owned(stats) {
  return typeof process.getuid !== "function" || stats.uid === BigInt(process.getuid());
}
function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
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
function inspectDirectory(path, label) {
  if (!isAbsolute(path))
    return fail(`${label} path must be absolute`);
  const requested = resolve(path);
  const before = lstatSync(requested, { bigint: true });
  if (!before.isDirectory() || before.isSymbolicLink() || before.nlink < 1n || !owned(before)) {
    return fail(`${label} must be a current-user-owned physical directory`);
  }
  const physical = realpathSync(requested);
  const after = lstatSync(physical, { bigint: true });
  if (!sameFile(before, after))
    return fail(`${label} changed identity while resolving`);
  return physical;
}
function inspectDatabase(path, key, maximumBytes) {
  if (!isAbsolute(path))
    return fail("database path must be absolute");
  const requested = resolve(path);
  const before = lstatSync(requested, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || !owned(before) || before.size < 1n || before.size > BigInt(maximumBytes)) {
    return fail("database must be one current-user-owned regular non-symlink file within the configured size bound");
  }
  const physical = realpathSync(requested);
  const after = lstatSync(physical, { bigint: true });
  if (!sameFile(before, after))
    return fail("database changed identity while resolving");
  return Object.freeze({ key, path: physical, stats: after });
}
function databaseInDirectory(directory, key, maximumBytes) {
  const candidates = readdirSync(directory, { withFileTypes: true }).filter((entry) => DATABASE_NAME.test(entry.name));
  if (candidates.length === 0)
    return null;
  if (candidates.length !== 1)
    return fail("one source store contains multiple AddressBook databases");
  const name = candidates[0]?.name;
  if (name === undefined)
    return fail("one source store has no database name");
  return inspectDatabase(join(directory, name), key, maximumBytes);
}
function databasesInSources(sourcesPath, maximumBytes) {
  const sources = inspectDirectory(sourcesPath, "Sources");
  const result = [];
  for (const entry of readdirSync(sources, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name, "en-US"))) {
    if (entry.isSymbolicLink())
      return fail("Sources must not contain symbolic-link stores");
    if (!entry.isDirectory())
      continue;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(entry.name)) {
      return fail("source store directory name is invalid");
    }
    const storeDirectory = inspectDirectory(join(sources, entry.name), "source store");
    const source = databaseInDirectory(storeDirectory, entry.name, maximumBytes);
    if (source !== null)
      result.push(source);
  }
  return result;
}
function discoverDatabases(path, maximumBytes) {
  if (!isAbsolute(path))
    return fail("AddressBook path must be absolute");
  const requested = resolve(path);
  const identity = lstatSync(requested, { bigint: true });
  let result;
  if (identity.isFile() || identity.isSymbolicLink()) {
    if (!DATABASE_NAME.test(basename(requested))) {
      return fail("explicit database must be named AddressBook-vN.abcddb");
    }
    result = [inspectDatabase(requested, basename(dirname(requested)), maximumBytes)];
  } else {
    const directory = inspectDirectory(requested, "AddressBook root");
    if (basename(directory) === "Sources") {
      result = databasesInSources(directory, maximumBytes);
    } else {
      const sourcesStats = optionalStats(join(directory, "Sources"));
      result = sourcesStats === null ? [] : databasesInSources(join(directory, "Sources"), maximumBytes);
      if (result.length === 0) {
        const direct = databaseInDirectory(directory, basename(directory), maximumBytes);
        result = direct === null ? [] : [direct];
      }
    }
  }
  result.sort((left, right) => left.key.localeCompare(right.key, "en-US"));
  if (result.length < 1)
    return fail("contains no supported AddressBook database");
  if (result.length > MAX_SOURCE_DATABASES)
    return fail("contains too many AddressBook databases");
  const total = result.reduce((bytes, source) => bytes + source.stats.size, 0n);
  if (total > BigInt(MAX_TOTAL_SOURCE_BYTES))
    return fail("databases exceed the aggregate source size bound");
  return Object.freeze(result);
}
function validateSidecar(path, stats, maximumBytes) {
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1n || !owned(stats) || stats.size < 0n || stats.size > BigInt(maximumBytes))
    return fail(`sidecar ${basename(path)} is not a bounded current-user-owned physical file`);
}
function snapshotMembers(source, maximumBytes) {
  const current = inspectDatabase(source.path, source.key, maximumBytes);
  if (!sameFile(source.stats, current.stats))
    return fail("database changed identity before isolation");
  const members = [{ suffix: "", path: source.path, stats: current.stats }];
  for (const suffix of ["-wal", "-journal"]) {
    const sidecarPath = `${source.path}${suffix}`;
    const stats = optionalStats(sidecarPath);
    if (stats === null)
      continue;
    validateSidecar(sidecarPath, stats, maximumBytes);
    members.push({ suffix, path: sidecarPath, stats });
  }
  const shmPath = `${source.path}-shm`;
  const shm = optionalStats(shmPath);
  if (shm !== null)
    validateSidecar(shmPath, shm, MAX_SHM_BYTES);
  const total = members.reduce((bytes, member) => bytes + member.stats.size, 0n);
  if (total > BigInt(maximumBytes) * 2n)
    return fail("database and sidecars exceed the snapshot bound");
  return Object.freeze(members);
}
function sameMembers(left, right) {
  return left.length === right.length && left.every((member, index) => {
    const other = right[index];
    return other !== undefined && member.suffix === other.suffix && sameFile(member.stats, other.stats) && member.stats.size === other.stats.size && member.stats.mtimeNs === other.stats.mtimeNs && member.stats.ctimeNs === other.stats.ctimeNs;
  });
}
function isolateSource(source, maximumBytes) {
  const temporaryRoot = tmpdir();
  if (!isAbsolute(temporaryRoot))
    return fail("requires an absolute temporary directory");
  const temporaryDirectory = mkdtempSync(join(temporaryRoot, "message-like-me-contacts-"));
  chmodSync(temporaryDirectory, 448);
  try {
    for (let attempt = 0;attempt < SNAPSHOT_ATTEMPTS; attempt += 1) {
      const before = snapshotMembers(source, maximumBytes);
      const attemptDirectory = join(temporaryDirectory, `attempt-${attempt}`);
      mkdirSync(attemptDirectory, { mode: 448 });
      let raced = false;
      try {
        for (const member of before) {
          const destination = join(attemptDirectory, `${basename(source.path)}${member.suffix}`);
          copyFileSync(member.path, destination, fsConstants.COPYFILE_EXCL | fsConstants.COPYFILE_FICLONE);
          chmodSync(destination, 384);
        }
      } catch (error) {
        const code = error.code;
        if (code === "ENOENT" || code === "ESTALE")
          raced = true;
        else
          throw error;
      }
      const after = snapshotMembers(source, maximumBytes);
      if (!raced && sameMembers(before, after)) {
        return Object.freeze({
          source: Object.freeze({ ...source, stats: before[0].stats }),
          path: join(attemptDirectory, basename(source.path)),
          temporaryDirectory
        });
      }
      rmSync(attemptDirectory, { recursive: true, force: true });
    }
    return fail(`changed during ${SNAPSHOT_ATTEMPTS} snapshot attempts`);
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
function integer(value, label) {
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    return fail(`${label} must be an integer`);
  return value;
}
function flag(value, label) {
  const result = integer(value, label);
  if (result !== 0 && result !== 1)
    return fail(`${label} must be zero or one`);
  return result;
}
function boundedText(value, label, maximumBytes) {
  if (typeof value !== "string" || value.includes("\x00") || Buffer.byteLength(value, "utf8") < 1 || Buffer.byteLength(value, "utf8") > maximumBytes)
    return fail(`${label} must be bounded text`);
  return value;
}
function privateLabel(parts) {
  const clean = parts.map((value) => {
    if (value === null)
      return null;
    if (typeof value !== "string")
      return fail("contact name field must be text or null");
    const normalized = value.normalize("NFKC").trim();
    if (normalized === "")
      return null;
    if (/\p{Cc}/u.test(normalized) || Buffer.byteLength(normalized, "utf8") > MAX_LABEL_BYTES) {
      return fail("contact label exceeds its text bound");
    }
    return normalized;
  });
  const display = clean[0];
  if (display !== null && display !== undefined)
    return { value: display, basis: "display-name" };
  const personal = clean.slice(1, 4).filter((value) => value !== null).join(" ");
  if (personal !== "")
    return { value: personal, basis: "name-parts" };
  const organization = clean[4] ?? null;
  return { value: organization, basis: organization === null ? null : "organization" };
}
function normalizeContactLabelQuery(value) {
  const normalized = value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
  if (normalized.length < 1 || /\p{Cc}/u.test(normalized) || Buffer.byteLength(normalized, "utf8") > MAX_LABEL_BYTES)
    return fail("private label query must be bounded text");
  return normalized;
}
function normalizeEmail(value) {
  if (value.length > 254 || !/^[\x21-\x7e]+$/u.test(value) || value.includes("\x00"))
    return null;
  const separator = value.indexOf("@");
  if (separator < 1 || separator !== value.lastIndexOf("@"))
    return null;
  const local = value.slice(0, separator);
  const domain = value.slice(separator + 1);
  if (local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..") || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/u.test(local))
    return null;
  const labels = domain.split(".");
  if (domain.length > 253 || labels.length < 2 || labels.some((label) => label.length < 1 || label.length > 63 || !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u.test(label)))
    return null;
  return value.toLocaleLowerCase("en-US");
}
function normalizeContactHandle(value) {
  const trimmed = value.trim();
  const email = normalizeEmail(trimmed);
  if (email !== null) {
    return Object.freeze({
      kind: "email",
      normalizedValue: email
    });
  }
  const text = trimmed.normalize("NFKC");
  if (text === "" || /\p{Cc}/u.test(text) || Buffer.byteLength(text, "utf8") > MAX_HANDLE_BYTES) {
    return null;
  }
  const extension = text.match(/(?:\s*(?:ext\.?|extension|x|#)\s*\d{1,12})$/iu);
  const number = text.startsWith("+") ? text.slice(1) : text;
  if (extension !== null || !/^[0-9().\-\s]+$/u.test(number))
    return null;
  const international = text.startsWith("+") || text.startsWith("00");
  const digits = text.replaceAll(/[^0-9]/gu, "");
  const canonicalDigits = text.startsWith("00") ? digits.slice(2) : digits;
  if (canonicalDigits.length < 7 || canonicalDigits.length > 15)
    return null;
  return Object.freeze({
    kind: "phone",
    normalizedValue: international ? `+${canonicalDigits}` : canonicalDigits
  });
}
function contactHandleMatchId(hmacKey, handle) {
  return hmac(keyBytes(hmacKey), "contact-handle", `${handle.kind}\x00${handle.normalizedValue}`);
}
function tableNames(database) {
  const rows = allRows(database, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  if (rows.length > MAX_TABLES)
    return fail("schema contains too many tables");
  return new Set(rows.map((row) => boundedText(row.name, "table name", 256)));
}
function tableColumns(database, table) {
  const rows = allRows(database, "SELECT name FROM pragma_table_info(?) ORDER BY cid", table);
  if (rows.length > MAX_COLUMNS_PER_TABLE)
    return fail(`${table} contains too many columns`);
  return rows.map((row) => boundedText(row.name, `${table} column name`, 256));
}
function requireColumns(database, table, required) {
  const columns = new Set(tableColumns(database, table));
  for (const column of required) {
    if (!columns.has(column))
      return fail(`${table} is missing required column ${column}`);
  }
  return columns;
}
function boundedColumn(columns, column, alias, maximumBytes) {
  if (!columns.has(column))
    return `NULL AS ${alias}, 0 AS ${alias}_over_bound`;
  return `CASE WHEN ${column} IS NULL OR length(CAST(${column} AS BLOB)) <= ${maximumBytes}
      THEN ${column} ELSE NULL END AS ${alias},
    CASE WHEN ${column} IS NOT NULL AND length(CAST(${column} AS BLOB)) > ${maximumBytes}
      THEN 1 ELSE 0 END AS ${alias}_over_bound`;
}
function countRows(database, table, maximum) {
  const count = integer(getRow(database, `SELECT count(*) AS value FROM ${table}`)?.value, `${table} row count`);
  if (count < 0 || count > maximum)
    return fail(`${table} exceeds its row bound`);
  return count;
}
function contactEntityIds(database, columns) {
  const rows = allRows(database, `
    SELECT Z_ENT,Z_NAME,${columns.has("Z_SUPER") ? "Z_SUPER" : "NULL AS Z_SUPER"}
    FROM Z_PRIMARYKEY ORDER BY Z_ENT
  `);
  if (rows.length > MAX_TABLES)
    return fail("Z_PRIMARYKEY exceeds its entity bound");
  const parsed = rows.map((row) => ({
    entity: integer(row.Z_ENT, "AddressBook entity ID"),
    name: boundedText(row.Z_NAME, "AddressBook entity name", 256),
    parent: row.Z_SUPER === null ? null : integer(row.Z_SUPER, "AddressBook parent entity ID")
  }));
  const roots = parsed.filter((row) => row.name === "ABCDContact").map((row) => row.entity);
  if (roots.length !== 1 || roots[0] < 1)
    return fail("has no unique ABCDContact entity");
  const result = new Set(roots);
  for (;; ) {
    let changed = false;
    for (const row of parsed) {
      if (row.parent !== null && result.has(row.parent) && !result.has(row.entity)) {
        result.add(row.entity);
        changed = true;
      }
    }
    if (!changed)
      break;
  }
  return Object.freeze([...result].sort((left, right) => left - right));
}
function readContactRows(database, columns, entities, maximumContacts, pageSize) {
  const placeholders = entities.map(() => "?").join(",");
  const count = integer(getRow(database, `SELECT count(*) AS value FROM ZABCDRECORD WHERE Z_ENT IN (${placeholders})`, ...entities)?.value, "contact row count");
  if (count < 0 || count > maximumContacts)
    return fail("contact rows exceed their bound");
  const result = [];
  const identifiers = new Set;
  let after = 0;
  let textBytes = 0;
  for (;; ) {
    const rows = allRows(database, `SELECT Z_PK AS primary_key,
      ${boundedColumn(columns, "ZUNIQUEID", "unique_id", MAX_IDENTIFIER_BYTES)},
      ${boundedColumn(columns, "ZNAME", "display_name", MAX_LABEL_BYTES)},
      ${boundedColumn(columns, "ZFIRSTNAME", "first_name", MAX_LABEL_BYTES)},
      ${boundedColumn(columns, "ZMIDDLENAME", "middle_name", MAX_LABEL_BYTES)},
      ${boundedColumn(columns, "ZLASTNAME", "last_name", MAX_LABEL_BYTES)},
      ${boundedColumn(columns, "ZORGANIZATION", "organization", MAX_LABEL_BYTES)}
      FROM ZABCDRECORD WHERE Z_ENT IN (${placeholders}) AND Z_PK > ? ORDER BY Z_PK LIMIT ?`, ...entities, after, pageSize);
    if (rows.length === 0)
      break;
    for (const row of rows) {
      const primaryKey = integer(row.primary_key, "contact primary key");
      if (primaryKey <= after)
        return fail("contact paging did not advance");
      for (const alias of ["unique_id", "display_name", "first_name", "middle_name", "last_name", "organization"]) {
        if (flag(row[`${alias}_over_bound`], `${alias} bound flag`) === 1) {
          return fail(`contact ${alias} exceeds its text bound`);
        }
      }
      const identifier = boundedText(row.unique_id, "contact identifier", MAX_IDENTIFIER_BYTES);
      if (identifiers.has(identifier))
        return fail("contact identifiers are duplicated");
      identifiers.add(identifier);
      const label = privateLabel([
        row.display_name,
        row.first_name,
        row.middle_name,
        row.last_name,
        row.organization
      ]);
      textBytes += Buffer.byteLength(identifier, "utf8");
      for (const alias of ["display_name", "first_name", "middle_name", "last_name", "organization"]) {
        const value = row[alias];
        if (typeof value === "string")
          textBytes += Buffer.byteLength(value, "utf8");
      }
      if (label.value !== null)
        textBytes += Buffer.byteLength(label.value, "utf8");
      if (textBytes > MAX_TOTAL_TEXT_BYTES)
        return fail("contact text exceeds its aggregate bound");
      result.push(Object.freeze({
        primaryKey,
        identifier,
        privateLabel: label.value,
        privateLabelBasis: label.basis
      }));
      after = primaryKey;
    }
  }
  if (result.length !== count)
    return fail("contact paging count changed during its transaction");
  return Object.freeze({ rows: Object.freeze(result), textBytes });
}
function methodColumns(database, table) {
  const value = table === "ZABCDEMAILADDRESS" ? "ZADDRESS" : "ZFULLNUMBER";
  const columns = requireColumns(database, table, ["Z_PK", "ZOWNER", value]);
  return Object.freeze({ columns, owner: "ZOWNER", value });
}
function readMethods(database, table, pageSize) {
  const expectedRows = countRows(database, table, MAX_METHOD_ROWS);
  const shape = methodColumns(database, table);
  const grouped = new Map;
  let after = 0;
  let invalid = 0;
  let textBytes = 0;
  let rowsRead = 0;
  for (;; ) {
    const rows = allRows(database, `SELECT Z_PK AS primary_key, ${shape.owner} AS owner,
      ${boundedColumn(shape.columns, shape.value, "method_value", MAX_HANDLE_BYTES)}
      FROM ${table} WHERE Z_PK > ? ORDER BY Z_PK LIMIT ?`, after, pageSize);
    if (rows.length === 0)
      break;
    for (const row of rows) {
      const primaryKey = integer(row.primary_key, `${table} primary key`);
      if (primaryKey <= after)
        return fail(`${table} paging did not advance`);
      const owner = integer(row.owner, `${table} owner`);
      if (owner < 1)
        return fail(`${table} owner is invalid`);
      if (flag(row.method_value_over_bound, `${table} value bound flag`) === 1) {
        return fail(`${table} value exceeds its text bound`);
      }
      if (row.method_value !== null && typeof row.method_value !== "string") {
        return fail(`${table} value must be text or null`);
      }
      const raw = row.method_value;
      if (raw !== null) {
        textBytes += Buffer.byteLength(raw, "utf8");
        if (textBytes > MAX_TOTAL_TEXT_BYTES)
          return fail("contact methods exceed their aggregate text bound");
      }
      const handle = raw === null ? null : normalizeContactHandle(raw);
      const expectedKind = table === "ZABCDEMAILADDRESS" ? "email" : "phone";
      if (handle === null || handle.kind !== expectedKind)
        invalid += 1;
      else {
        const values = grouped.get(owner) ?? new Map;
        values.set(`${handle.kind}\x00${handle.normalizedValue}`, handle);
        grouped.set(owner, values);
      }
      after = primaryKey;
      rowsRead += 1;
    }
  }
  if (rowsRead !== expectedRows)
    return fail(`${table} paging count changed during its transaction`);
  return Object.freeze({
    byOwner: new Map([...grouped.entries()].map(([owner, values]) => [
      owner,
      Object.freeze([...values.values()].sort((left, right) => {
        const kind = left.kind.localeCompare(right.kind, "en-US");
        return kind !== 0 ? kind : left.normalizedValue.localeCompare(right.normalizedValue, "en-US");
      }))
    ])),
    invalid,
    rows: rowsRead,
    textBytes
  });
}
function modifiedAt(stats) {
  const milliseconds = Number(stats.mtimeMs);
  if (!Number.isFinite(milliseconds))
    return fail("database modification time is invalid");
  return new Date(milliseconds).toISOString();
}
function readStore(source, key, maximumBytes, maximumContacts, pageSize) {
  const isolated = isolateSource(source, maximumBytes);
  let database = null;
  let transactionOpen = false;
  try {
    database = new Database(isolated.path, { strict: true });
    database.exec("PRAGMA trusted_schema=OFF; PRAGMA temp_store=MEMORY; PRAGMA mmap_size=0; PRAGMA query_only=ON");
    if (getRow(database, "PRAGMA query_only")?.query_only !== 1) {
      return fail("could not enable query-only mode");
    }
    database.exec("BEGIN");
    transactionOpen = true;
    const names = tableNames(database);
    if (!names.has("Z_PRIMARYKEY") || !names.has("ZABCDRECORD")) {
      return fail("has an unsupported AddressBook schema");
    }
    const primaryColumns = requireColumns(database, "Z_PRIMARYKEY", ["Z_ENT", "Z_NAME"]);
    const recordColumns = requireColumns(database, "ZABCDRECORD", ["Z_PK", "Z_ENT", "ZUNIQUEID"]);
    const entities = contactEntityIds(database, primaryColumns);
    const schema = [...names].sort((left, right) => left.localeCompare(right, "en-US")).map((table) => ({ table, columns: tableColumns(database, table) }));
    const schemaSha256 = sha256(canonicalJson(schema));
    const contactRead = readContactRows(database, recordColumns, entities, maximumContacts, pageSize);
    const emails = names.has("ZABCDEMAILADDRESS") ? readMethods(database, "ZABCDEMAILADDRESS", pageSize) : { byOwner: new Map, invalid: 0, rows: 0, textBytes: 0 };
    const phones = names.has("ZABCDPHONENUMBER") ? readMethods(database, "ZABCDPHONENUMBER", pageSize) : { byOwner: new Map, invalid: 0, rows: 0, textBytes: 0 };
    if (emails.rows + phones.rows > MAX_METHOD_ROWS) {
      return fail("contact methods exceed their aggregate row bound");
    }
    if (contactRead.textBytes + emails.textBytes + phones.textBytes > MAX_TOTAL_TEXT_BYTES) {
      return fail("contact data exceeds its aggregate text bound");
    }
    const contactRows = contactRead.rows;
    const contactPrimaryKeys = new Set(contactRows.map((contact) => contact.primaryKey));
    for (const owner of [...emails.byOwner.keys(), ...phones.byOwner.keys()]) {
      if (!contactPrimaryKeys.has(owner))
        return fail("contact method references a missing contact");
    }
    const contacts = contactRows.map((contact) => {
      const handles = [
        ...emails.byOwner.get(contact.primaryKey) ?? [],
        ...phones.byOwner.get(contact.primaryKey) ?? []
      ].sort((left, right) => {
        const kind = left.kind.localeCompare(right.kind, "en-US");
        return kind !== 0 ? kind : left.normalizedValue.localeCompare(right.normalizedValue, "en-US");
      }).map((handle) => Object.freeze({
        ...handle,
        matchId: contactHandleMatchId(key, handle)
      }));
      return Object.freeze({
        id: hmac(key, "addressbook-contact", `${source.key}\x00${contact.identifier}`),
        privateLabel: contact.privateLabel,
        privateLabelBasis: contact.privateLabelBasis,
        handles: Object.freeze(handles)
      });
    }).sort((left, right) => left.id.localeCompare(right.id, "en-US"));
    database.exec("COMMIT");
    transactionOpen = false;
    return Object.freeze({
      contacts: Object.freeze(contacts),
      source: Object.freeze({
        physicalPath: isolated.source.path,
        device: isolated.source.stats.dev.toString(),
        inode: isolated.source.stats.ino.toString(),
        bytes: Number(isolated.source.stats.size),
        modifiedAt: modifiedAt(isolated.source.stats),
        schemaSha256
      }),
      invalidEmails: emails.invalid,
      invalidPhones: phones.invalid,
      withoutHandles: contacts.filter((contact) => contact.handles.length === 0).length,
      methodRows: emails.rows + phones.rows,
      textBytes: contactRead.textBytes + emails.textBytes + phones.textBytes
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
function readMacOSContacts(path, options) {
  const key = keyBytes(options.hmacKey);
  const maximumBytes = boundedInteger(options.maxDatabaseBytes, MAX_SOURCE_DATABASE_BYTES, 1, MAX_SOURCE_DATABASE_BYTES, "maxDatabaseBytes");
  const maximumContacts = boundedInteger(options.maxContacts, MAX_CONTACTS, 1, MAX_CONTACTS, "maxContacts");
  const pageSize = boundedInteger(options.pageSize, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE, "pageSize");
  const sources = discoverDatabases(path, maximumBytes);
  const initialMembers = sources.map((source) => snapshotMembers(source, maximumBytes));
  const reads = [];
  let aggregateContacts = 0;
  let aggregateHandles = 0;
  let aggregateMethodRows = 0;
  let aggregateTextBytes = 0;
  for (const source of sources) {
    const read = readStore(source, key, maximumBytes, maximumContacts, pageSize);
    reads.push(read);
    aggregateContacts += read.contacts.length;
    aggregateHandles += read.contacts.reduce((sum, contact) => sum + contact.handles.length, 0);
    aggregateMethodRows += read.methodRows;
    aggregateTextBytes += read.textBytes;
    if (aggregateContacts > maximumContacts)
      return fail("contacts exceed their aggregate row bound");
    if (aggregateHandles > MAX_METHOD_ROWS)
      return fail("contact methods exceed their aggregate row bound");
    if (aggregateMethodRows > MAX_METHOD_ROWS)
      return fail("contact method rows exceed their aggregate bound");
    if (aggregateTextBytes > MAX_TOTAL_TEXT_BYTES)
      return fail("contact text exceeds its aggregate bound");
  }
  const finalSources = discoverDatabases(path, maximumBytes);
  if (finalSources.length !== sources.length || finalSources.some((source, index) => {
    const prior = sources[index];
    return prior === undefined || source.key !== prior.key || source.path !== prior.path || !sameFile(source.stats, prior.stats);
  }) || finalSources.some((source, index) => !sameMembers(initialMembers[index] ?? [], snapshotMembers(source, maximumBytes))))
    return fail("AddressBook store set changed during its snapshot");
  const contacts = reads.flatMap((read) => read.contacts).sort((left, right) => left.id.localeCompare(right.id, "en-US"));
  const ids = new Set;
  for (const contact of contacts) {
    if (ids.has(contact.id))
      return fail("contains duplicate pseudonymous contact IDs");
    ids.add(contact.id);
  }
  const warnings = [];
  const invalidEmails = reads.reduce((sum, read) => sum + read.invalidEmails, 0);
  const invalidPhones = reads.reduce((sum, read) => sum + read.invalidPhones, 0);
  const withoutHandles = reads.reduce((sum, read) => sum + read.withoutHandles, 0);
  if (invalidEmails > 0)
    warnings.push(`ignored invalid email handles: ${invalidEmails}`);
  if (invalidPhones > 0)
    warnings.push(`ignored invalid phone handles: ${invalidPhones}`);
  if (withoutHandles > 0)
    warnings.push(`contacts without exact matchable handles: ${withoutHandles}`);
  const sourceIdentities = reads.map((read) => read.source);
  const snapshotSha256 = sha256(canonicalJson({
    schemaVersion: CONTACTS_SCHEMA_VERSION,
    sources: sources.map((source, index) => ({
      id: hmac(key, "addressbook-source", source.key),
      schemaSha256: sourceIdentities[index].schemaSha256
    })),
    contacts,
    warnings
  }));
  return Object.freeze({
    schemaVersion: CONTACTS_SCHEMA_VERSION,
    snapshotSha256,
    sources: Object.freeze(sourceIdentities),
    contacts: Object.freeze(contacts),
    warnings: Object.freeze(warnings)
  });
}

// src/bundle.ts
var MAX_MANIFEST_BYTES = LOCAL_MESSAGE_BUNDLE_V1_LIMITS.manifestBytes;
var MAX_RECORD_BYTES = LOCAL_MESSAGE_BUNDLE_V1_LIMITS.recordBytes;
var MAX_ACCOUNTS = LOCAL_MESSAGE_BUNDLE_V1_LIMITS.accounts;
function contractValue(read) {
  try {
    return read();
  } catch (error) {
    if (error instanceof MessageBundleV1ContractError) {
      throw new CliError("invalid-data", error.message, { cause: error });
    }
    throw error;
  }
}
function parseManifest(value) {
  return contractValue(() => parseLocalMessageBundleV1Manifest(value));
}
function parseRecord(value, kind, label) {
  return contractValue(() => parseLocalMessageBundleV1Record(value, kind, label));
}
function sameFile2(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}
async function bundleDirectory(path) {
  if (!isAbsolute2(path) || resolve2(path) !== path) {
    throw new CliError("unsafe-path", "Bundle input must be a normalized absolute path");
  }
  const before = await lstat(path);
  if (!before.isDirectory() || before.isSymbolicLink() || (before.mode & 511) !== 448 || typeof process.getuid === "function" && before.uid !== process.getuid())
    throw new CliError("unsafe-path", "Bundle input must be a current-user-owned mode-0700 physical directory");
  const physical = await realpath(path);
  if (physical !== path)
    throw new CliError("unsafe-path", "Bundle input path must not traverse a symbolic link");
  const after = await lstat(physical);
  if (!sameFile2(before, after))
    throw new CliError("unsafe-path", "Bundle directory changed while resolving");
  const expected = ["manifest.json", ...LOCAL_MESSAGE_BUNDLE_V1_ARTIFACTS.map(({ path: artifactPath }) => artifactPath)].sort();
  const entries = (await readdir(physical)).sort();
  if (entries.length !== expected.length || entries.some((entry, index) => entry !== expected[index])) {
    throw new CliError("invalid-data", "Bundle directory does not contain exactly the version-one inventory");
  }
  return physical;
}
async function openPrivateFile(path, maximumBytes, allowEmpty) {
  const handle = await open(path, fsConstants2.O_RDONLY | fsConstants2.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(maximumBytes) || !allowEmpty && before.size < 1n || (before.mode & 0o777n) !== 0o600n || typeof process.getuid === "function" && before.uid !== BigInt(process.getuid()))
      throw new CliError("unsafe-path", `${path} must be a private physical file within its bound`);
    return { handle, before };
  } catch (error) {
    await handle.close();
    throw error;
  }
}
async function assertFileUnchanged(path, handle, before) {
  const after = await handle.stat({ bigint: true });
  if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs)
    throw new CliError("unsafe-path", `${path} changed while it was read`);
}
async function closeReadHandle(handle) {
  try {
    await handle.close();
  } catch (error) {
    if (error.code !== "EBADF")
      throw error;
  }
}
function decodeUtf8(bytes, label) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new CliError("invalid-data", `${label} is not valid UTF-8`, { cause: error });
  }
}
async function readManifest(path) {
  const opened = await openPrivateFile(path, MAX_MANIFEST_BYTES, false);
  try {
    const bytes = Uint8Array.from(await opened.handle.readFile());
    await assertFileUnchanged(path, opened.handle, opened.before);
    let value;
    try {
      value = JSON.parse(decodeUtf8(bytes, "manifest.json"));
    } catch (error) {
      throw new CliError("invalid-data", "manifest.json is not valid UTF-8 JSON", { cause: error });
    }
    const manifest = parseManifest(value);
    if (!Buffer.from(`${canonicalJson(manifest)}
`, "utf8").equals(Buffer.from(bytes))) {
      throw new CliError("invalid-data", "manifest.json must use canonical JSON with one final newline");
    }
    return Object.freeze({ bytes, manifest });
  } finally {
    await closeReadHandle(opened.handle);
  }
}
async function readArtifact(root, artifact) {
  const path = join2(root, artifact.path);
  const opened = await openPrivateFile(path, artifact.bytes, true);
  const hash = createHash("sha256");
  const records = [];
  let totalBytes = 0;
  let pending = Buffer.alloc(0);
  let endedWithNewline = false;
  try {
    const stream = createReadStream(path, {
      fd: opened.handle.fd,
      autoClose: false,
      start: 0,
      highWaterMark: 64 * 1024
    });
    for await (const value of stream) {
      const chunk = Buffer.from(value);
      hash.update(chunk);
      totalBytes += chunk.byteLength;
      if (totalBytes > artifact.bytes)
        throw new CliError("invalid-data", `${artifact.path} exceeds manifest bytes`);
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      let newline = pending.indexOf(10);
      while (newline >= 0) {
        const line = pending.subarray(0, newline);
        pending = pending.subarray(newline + 1);
        endedWithNewline = true;
        if (line.byteLength < 1 || line.byteLength + 1 > MAX_RECORD_BYTES) {
          throw new CliError("invalid-data", `${artifact.path} contains a blank or oversized record`);
        }
        let parsed;
        try {
          parsed = JSON.parse(decodeUtf8(line, `${artifact.path} record`));
        } catch (error) {
          throw new CliError("invalid-data", `${artifact.path} contains invalid UTF-8 JSON`, { cause: error });
        }
        const normalized = parseRecord(parsed, artifact.recordKind, `${artifact.path}:${records.length + 1}`);
        if (!Buffer.from(canonicalJson(normalized), "utf8").equals(line)) {
          throw new CliError("invalid-data", `${artifact.path} records must use canonical JSON`);
        }
        records.push(normalized);
        if (records.length > artifact.records) {
          throw new CliError("invalid-data", `${artifact.path} exceeds its manifest record count`);
        }
        newline = pending.indexOf(10);
      }
      if (pending.byteLength + 1 > MAX_RECORD_BYTES) {
        throw new CliError("invalid-data", `${artifact.path} contains an oversized record`);
      }
      if (pending.length > 0)
        endedWithNewline = false;
    }
    await assertFileUnchanged(path, opened.handle, opened.before);
  } finally {
    await closeReadHandle(opened.handle);
  }
  if (pending.byteLength !== 0 || artifact.records > 0 && !endedWithNewline) {
    throw new CliError("invalid-data", `${artifact.path} must end every record with a newline`);
  }
  if (totalBytes !== artifact.bytes || records.length !== artifact.records || hash.digest("hex") !== artifact.sha256)
    throw new CliError("invalid-data", `${artifact.path} does not match its manifest integrity`);
  return Object.freeze(records);
}
function hmacKey(value) {
  const key = typeof value === "string" ? new TextEncoder().encode(value) : value;
  if (!(key instanceof Uint8Array) || key.byteLength < 16 || key.byteLength > 1024) {
    throw new CliError("invalid-data", "Bundle HMAC key must contain 16 through 1024 bytes");
  }
  return Uint8Array.from(key);
}
function hmac2(key, namespace, value) {
  return createHmac2("sha256", key).update(`message-like-me\x00bundle-${namespace}\x00`, "utf8").update(value, "utf8").digest("hex");
}
function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
function recordMap(records, label) {
  const result = new Map;
  for (const record of records) {
    if (result.has(record.id))
      throw new CliError("invalid-data", `${label} repeats a bundle-local ID`);
    result.set(record.id, record);
  }
  return result;
}
function groupByAccount(records) {
  const grouped = new Map;
  for (const record of records) {
    const values = grouped.get(record.accountId) ?? [];
    values.push(record);
    grouped.set(record.accountId, values);
  }
  return grouped;
}
function attachmentProvenance(messageId, attachments) {
  return Object.freeze(attachments.map((attachment, index) => ({
    id: `${messageId}:attachment:${index + 1}`,
    kind: attachment.kind,
    mimeType: attachment.mimeType,
    fileName: attachment.name,
    bytes: attachment.sizeBytes
  })));
}
function reactionTimelineCoordinate(localReactionId) {
  return `\x1Freaction-timeline:${localReactionId}`;
}
function normalizeBundle(manifest, manifestSha256, records, key) {
  const accounts = records.account;
  const participants = records.participant;
  const conversations = records.conversation;
  const messages = records.message;
  const reactions = records.reaction;
  const tombstones = records.tombstone;
  if (accounts.length > MAX_ACCOUNTS) {
    throw new CliError("invalid-data", `Bundle exceeds the ${MAX_ACCOUNTS}-account safety bound`);
  }
  const accountById = recordMap(accounts, "accounts");
  recordMap(participants, "participants");
  recordMap(conversations, "conversations");
  const messageRecordById = recordMap(messages, "messages");
  const reactionById = recordMap(reactions, "reactions");
  recordMap(tombstones, "tombstones");
  for (const [kind, values] of [
    ["account", accounts],
    ["participant", participants],
    ["conversation", conversations],
    ["message", messages],
    ["reaction", reactions],
    ["tombstone", tombstones]
  ]) {
    const providerCoordinates = new Set;
    for (const record of values) {
      const coordinate = `${record.accountId}\x00${record.provenance.providerId}`;
      if (providerCoordinates.has(coordinate)) {
        throw new CliError("invalid-data", `${kind} records repeat a provider identity within one account`);
      }
      providerCoordinates.add(coordinate);
    }
  }
  for (const record of [...participants, ...conversations, ...messages, ...reactions, ...tombstones]) {
    const account = accountById.get(record.accountId);
    if (account === undefined || account.network !== record.network || account.provenance.connectedAccountProviderId !== record.provenance.connectedAccountProviderId)
      throw new CliError("invalid-data", "A record does not match its connected account realm");
  }
  const participantsByAccount = groupByAccount(participants);
  const conversationsByAccount = groupByAccount(conversations);
  const messagesByAccount = groupByAccount(messages);
  const reactionsByAccount = groupByAccount(reactions);
  const tombstonesByAccount = groupByAccount(tombstones);
  const result = [];
  const sourceIds = new Set;
  for (const account of accounts) {
    const accountParticipants = participantsByAccount.get(account.id) ?? [];
    const participantById = new Map(accountParticipants.map((participant) => [participant.id, participant]));
    const self = participantById.get(account.selfParticipantId);
    if (self === undefined || !self.isSelf || accountParticipants.filter(({ isSelf }) => isSelf).length !== 1) {
      throw new CliError("invalid-data", "An account must have exactly one matching self participant");
    }
    const accountConversations = conversationsByAccount.get(account.id) ?? [];
    const conversationParticipantIds = new Map(accountConversations.map((conversation) => [
      conversation.id,
      new Set(conversation.participantIds)
    ]));
    for (const conversation of accountConversations) {
      for (const participantId of conversation.participantIds) {
        if (!participantById.has(participantId)) {
          throw new CliError("invalid-data", "A conversation references an unknown participant");
        }
      }
      if (conversation.type === "direct" && conversation.participantsComplete === true && (conversation.participantIds.length !== 2 || !conversation.participantIds.includes(account.selfParticipantId) || conversation.participantIds.filter((participantId) => participantById.get(participantId)?.isSelf === false).length !== 1)) {
        throw new CliError("invalid-data", "A complete direct conversation must contain one self and one non-self participant");
      }
    }
    const conversationById = new Map(accountConversations.map((conversation) => [conversation.id, conversation]));
    const namespace = [
      manifest.provider.id,
      account.provenance.connectedAccountProviderId,
      self.provenance.providerId
    ].join("\x00");
    const sourceId = `source_${hmac2(key, "source", namespace)}`;
    if (sourceIds.has(sourceId)) {
      throw new CliError("invalid-data", "Connected accounts repeat a stable source realm");
    }
    sourceIds.add(sourceId);
    const conversationLocalIds = new Map(accountConversations.map((conversation) => [
      conversation.id,
      `conversation_${hmac2(key, "conversation", `${namespace}\x00${conversation.provenance.providerId}`)}`
    ]));
    const participantLocalIds = new Map(accountParticipants.map((participant) => [
      participant.id,
      `participant_${hmac2(key, "participant", `${namespace}\x00${participant.provenance.providerId}`)}`
    ]));
    const normalizedConversations = accountConversations.map((conversation) => {
      const known = conversation.participantIds.flatMap((id) => {
        const participant = participantById.get(id);
        return participant === undefined ? [] : [participant];
      });
      const peers = known.filter(({ isSelf }) => !isSelf);
      const completeDirectPeer = conversation.type === "direct" && conversation.participantsComplete === true && peers.length === 1 ? peers[0] : null;
      const canonicalHandle = completeDirectPeer?.handle === null || completeDirectPeer === null ? null : normalizeContactHandle(completeDirectPeer.handle);
      return Object.freeze({
        id: conversationLocalIds.get(conversation.id),
        sourceKey: conversation.provenance.providerId,
        privateLabel: conversation.title,
        service: account.network,
        participantCount: conversation.type === "direct" ? 1 : peers.length,
        participantIds: Object.freeze(peers.map((participant) => participantLocalIds.get(participant.id))),
        privateParticipants: canonicalHandle === null ? Object.freeze([]) : Object.freeze([canonicalHandle.normalizedValue]),
        group: conversation.type !== "direct"
      });
    });
    const accountMessages = messagesByAccount.get(account.id) ?? [];
    const messageById = new Map(accountMessages.map((message) => [message.id, message]));
    const messageByProviderId = new Map(accountMessages.map((message) => [
      message.provenance.providerId,
      message
    ]));
    const replacementTargets = new Map;
    const replacerByTarget = new Map;
    for (const message of accountMessages) {
      if (!conversationById.has(message.conversationId)) {
        throw new CliError("invalid-data", "A message references an unknown conversation");
      }
      if (message.senderParticipantId !== null && !participantById.has(message.senderParticipantId)) {
        throw new CliError("invalid-data", "A message references an unknown sender participant");
      }
      const sender = message.senderParticipantId === null ? null : participantById.get(message.senderParticipantId);
      const conversation = conversationById.get(message.conversationId);
      if (sender !== null && (message.direction === "outgoing" && !sender.isSelf || message.direction === "incoming" && sender.isSelf))
        throw new CliError("invalid-data", "A message direction conflicts with its sender identity");
      if (sender !== null && conversation.participantsComplete === true && !conversationParticipantIds.get(conversation.id).has(sender.id))
        throw new CliError("invalid-data", "A message sender is outside its complete conversation roster");
      if (message.replyTo !== null) {
        const localTarget = message.replyTo.messageId === null ? undefined : messageRecordById.get(message.replyTo.messageId);
        if (message.replyTo.messageId !== null && (localTarget === undefined || localTarget.accountId !== account.id || localTarget.provenance.providerId !== message.replyTo.providerId))
          throw new CliError("invalid-data", "A message reply has mismatched target coordinates");
        const providerTarget = messageByProviderId.get(message.replyTo.providerId);
        const target = localTarget ?? providerTarget;
        if (message.replyTo.providerId === message.provenance.providerId || target !== undefined && target.conversationId !== message.conversationId)
          throw new CliError("invalid-data", "A message reply has an invalid conversation target");
      }
      if (message.edit?.kind === "replacement") {
        const localTarget = message.edit.replacesMessageId === null ? undefined : messageRecordById.get(message.edit.replacesMessageId);
        if (message.edit.replacesMessageId !== null && (localTarget === undefined || localTarget.accountId !== account.id || localTarget.provenance.providerId !== message.edit.replacesProviderId))
          throw new CliError("invalid-data", "A message edit has mismatched replacement coordinates");
        const providerTarget = messageByProviderId.get(message.edit.replacesProviderId);
        const target = localTarget ?? providerTarget;
        if (message.edit.replacesProviderId === message.provenance.providerId || target !== undefined && target.conversationId !== message.conversationId)
          throw new CliError("invalid-data", "A message edit has an invalid replacement target");
        if (replacerByTarget.has(message.edit.replacesProviderId)) {
          throw new CliError("invalid-data", "A message version has multiple replacements");
        }
        replacerByTarget.set(message.edit.replacesProviderId, message.provenance.providerId);
        replacementTargets.set(message.id, Object.freeze({
          target,
          externalId: message.edit.replacesProviderId
        }));
      }
    }
    const editEdges = new Map([...replacementTargets.entries()].map(([messageId, target]) => [
      messageById.get(messageId).provenance.providerId,
      target.externalId
    ]));
    const completedEditNodes = new Set;
    for (const start of editEdges.keys()) {
      if (completedEditNodes.has(start))
        continue;
      const seen = new Set;
      const chain = [];
      let current = start;
      while (current !== undefined && !completedEditNodes.has(current)) {
        if (seen.has(current))
          throw new CliError("invalid-data", "Message replacement edits contain a cycle");
        seen.add(current);
        chain.push(current);
        current = editEdges.get(current);
      }
      for (const node of chain)
        completedEditNodes.add(node);
    }
    const analyzableMessages = accountMessages.filter(({ direction }) => direction !== "unknown").sort((left, right) => compareCodeUnits(left.conversationId, right.conversationId) || compareCodeUnits(left.sortKey, right.sortKey) || compareCodeUnits(left.sentAt, right.sentAt) || compareCodeUnits(left.provenance.providerId, right.provenance.providerId));
    const normalizedMessages = [];
    const messageProvenance = [];
    const localMessageIds = new Map;
    const localReactionIds = new Map;
    const timelineReactionIds = new Set;
    for (const [index, message] of analyzableMessages.entries()) {
      const localId = `message_${hmac2(key, "message", `${namespace}\x00${message.provenance.providerId}`)}`;
      localMessageIds.set(message.id, localId);
      const body = message.bodyTruncated === true || message.deletion !== null ? null : message.body;
      normalizedMessages.push(Object.freeze({
        id: localId,
        sourceRowId: index + 1,
        sourceGuid: message.provenance.providerId,
        conversationId: conversationLocalIds.get(message.conversationId),
        sentAt: message.sentAt,
        direction: message.direction,
        body,
        bodySource: body === null ? "unavailable" : "text",
        kind: body !== null || message.bodyTruncated === true ? "text" : message.attachments.length > 0 ? "attachment" : "unknown",
        replyToSourceGuid: message.replyTo?.providerId ?? null,
        replyState: message.replyTo === null ? "none" : "explicit",
        editedAt: message.edit?.editedAt ?? null,
        retractedAt: message.deletion?.observedAt ?? null,
        service: account.network,
        attachmentCount: message.attachments.length
      }));
      messageProvenance.push(Object.freeze({
        messageId: localId,
        externalId: message.provenance.providerId,
        providerSortKey: message.sortKey,
        replyToExternalId: message.replyTo?.providerId ?? null,
        attachments: attachmentProvenance(localId, message.attachments),
        metadata: message
      }));
    }
    const accountReactions = reactionsByAccount.get(account.id) ?? [];
    for (const reaction of accountReactions) {
      localReactionIds.set(reaction.id, `message_${hmac2(key, "reaction", `${namespace}\x00${reaction.provenance.providerId}`)}`);
    }
    const reactionFacts = [];
    for (const reaction of accountReactions) {
      const localTarget = reaction.messageId === null ? undefined : messageRecordById.get(reaction.messageId);
      if (reaction.messageId !== null && (localTarget === undefined || localTarget.accountId !== account.id || localTarget.provenance.providerId !== reaction.messageProviderId))
        throw new CliError("invalid-data", "A reaction has mismatched target coordinates");
      if (reaction.participantId !== null && !participantById.has(reaction.participantId)) {
        throw new CliError("invalid-data", "A reaction references an unknown participant");
      }
      const target = localTarget ?? messageByProviderId.get(reaction.messageProviderId);
      const participant = reaction.participantId === null ? null : participantById.get(reaction.participantId);
      const targetConversationId = target === undefined ? null : conversationLocalIds.get(target.conversationId) ?? null;
      if (target !== undefined && participant !== null) {
        const targetConversation = conversationById.get(target.conversationId);
        if (targetConversation.participantsComplete === true && !conversationParticipantIds.get(targetConversation.id).has(participant.id))
          throw new CliError("invalid-data", "A reaction participant is outside its complete conversation roster");
      }
      const localId = localReactionIds.get(reaction.id);
      reactionFacts.push(Object.freeze({
        id: localId,
        externalId: reaction.provenance.providerId,
        targetExternalId: reaction.messageProviderId,
        conversationId: targetConversationId,
        direction: participant === null ? null : participant.isSelf ? "outgoing" : "incoming",
        body: reaction.body,
        reactedAt: reaction.reactedAt,
        state: reaction.state
      }));
      if (reaction.state !== "active" || reaction.reactedAt === null || reaction.participantId === null)
        continue;
      if (participant === null || target === undefined || targetConversationId === null)
        continue;
      timelineReactionIds.add(reaction.id);
      const timelineCoordinate = reactionTimelineCoordinate(localId);
      normalizedMessages.push(Object.freeze({
        id: localId,
        sourceRowId: normalizedMessages.length + 1,
        sourceGuid: timelineCoordinate,
        conversationId: targetConversationId,
        sentAt: reaction.reactedAt,
        direction: participant.isSelf ? "outgoing" : "incoming",
        body: null,
        bodySource: "unavailable",
        kind: "reaction",
        replyToSourceGuid: reaction.messageProviderId,
        replyState: "explicit",
        editedAt: null,
        retractedAt: null,
        service: account.network,
        attachmentCount: 0
      }));
      messageProvenance.push(Object.freeze({
        messageId: localId,
        externalId: timelineCoordinate,
        providerSortKey: null,
        replyToExternalId: reaction.messageProviderId,
        attachments: Object.freeze([]),
        metadata: reaction
      }));
    }
    const reactionFactByExternal = new Map(reactionFacts.map((fact) => [fact.externalId, fact]));
    const auxiliaryRecords = [
      { kind: "account", id: account.provenance.providerId, record: account },
      ...accountParticipants.map((participant) => ({
        kind: "participant",
        id: participant.provenance.providerId,
        record: participant
      })),
      ...accountReactions.map((reaction) => ({
        kind: "reaction",
        id: reaction.provenance.providerId,
        record: reaction
      })),
      ...(tombstonesByAccount.get(account.id) ?? []).map((tombstone) => ({
        kind: "tombstone",
        id: tombstone.provenance.providerId,
        record: tombstone
      })),
      ...accountMessages.filter(({ direction }) => direction === "unknown").map((message) => ({
        kind: "excluded-message",
        id: message.provenance.providerId,
        record: message
      }))
    ];
    const accountTombstones = tombstonesByAccount.get(account.id) ?? [];
    const deletions = accountTombstones.map((tombstone) => {
      const entityId = tombstone.entityId;
      let localEntityId = null;
      if (entityId !== null) {
        if (tombstone.entityKind === "conversation") {
          const target = conversationById.get(entityId);
          if (target === undefined) {
            throw new CliError("invalid-data", "A tombstone references an unknown local conversation");
          }
          if (target.provenance.providerId !== tombstone.entityProviderId) {
            throw new CliError("invalid-data", "A tombstone has mismatched conversation identity");
          }
          localEntityId = conversationLocalIds.get(entityId) ?? null;
        } else if (tombstone.entityKind === "message") {
          const target = messageRecordById.get(entityId);
          if (target === undefined || target.accountId !== account.id) {
            throw new CliError("invalid-data", "A tombstone references an unknown local message");
          }
          if (target.provenance.providerId !== tombstone.entityProviderId) {
            throw new CliError("invalid-data", "A tombstone has mismatched message identity");
          }
          localEntityId = localMessageIds.get(entityId) ?? null;
        } else if (tombstone.entityKind === "reaction") {
          const target = reactionById.get(entityId);
          if (target === undefined || target.accountId !== account.id) {
            throw new CliError("invalid-data", "A tombstone references an unknown local reaction");
          }
          if (target.provenance.providerId !== tombstone.entityProviderId) {
            throw new CliError("invalid-data", "A tombstone has mismatched reaction identity");
          }
          localEntityId = localReactionIds.get(entityId) ?? null;
        }
      }
      return Object.freeze({
        entityKind: tombstone.entityKind,
        localEntityId,
        externalId: tombstone.entityProviderId,
        deletedAt: tombstone.deletedAt,
        reason: "tombstone"
      });
    });
    for (const [messageId, replacement] of replacementTargets) {
      const message = messageById.get(messageId);
      deletions.push(Object.freeze({
        entityKind: "message",
        localEntityId: replacement.target === undefined ? null : localMessageIds.get(replacement.target.id) ?? null,
        externalId: replacement.externalId,
        deletedAt: message.edit.editedAt,
        expectedConversationId: conversationLocalIds.get(message.conversationId),
        reason: "replacement"
      }));
    }
    for (const message of accountMessages) {
      if (message.deletion === null)
        continue;
      deletions.push(Object.freeze({
        entityKind: "message",
        localEntityId: localMessageIds.get(message.id) ?? null,
        externalId: message.provenance.providerId,
        deletedAt: message.deletion.observedAt,
        expectedConversationId: conversationLocalIds.get(message.conversationId),
        reason: "tombstone"
      }));
    }
    for (const message of accountMessages) {
      if (message.direction !== "unknown")
        continue;
      deletions.push(Object.freeze({
        entityKind: "message",
        localEntityId: null,
        externalId: message.provenance.providerId,
        deletedAt: message.provenance.observedAt,
        expectedConversationId: conversationLocalIds.get(message.conversationId),
        reason: "explicit-exclusion"
      }));
    }
    for (const reaction of accountReactions) {
      if (timelineReactionIds.has(reaction.id))
        continue;
      const fact = reactionFactByExternal.get(reaction.provenance.providerId);
      deletions.push(Object.freeze({
        entityKind: reaction.state === "removed" ? "reaction" : "reaction-timeline",
        localEntityId: localReactionIds.get(reaction.id),
        externalId: reaction.provenance.providerId,
        deletedAt: reaction.provenance.observedAt,
        ...fact.conversationId === null ? {} : { expectedConversationId: fact.conversationId },
        reason: reaction.state === "removed" ? "tombstone" : "explicit-exclusion"
      }));
    }
    const sourceWarnings = [...manifest.warnings];
    const unknownDirections = accountMessages.filter(({ direction }) => direction === "unknown").length;
    const undatedReactions = accountReactions.filter(({ reactedAt }) => reactedAt === null).length;
    if (unknownDirections > 0)
      sourceWarnings.push(`unknown-direction-messages:${unknownDirections}`);
    if (undatedReactions > 0)
      sourceWarnings.push(`undated-reactions:${undatedReactions}`);
    const accountTimelineBounds = [
      ...accountMessages.map(({ sentAt }) => sentAt),
      ...accountReactions.flatMap(({ reactedAt }) => reactedAt === null ? [] : [reactedAt])
    ].sort(compareCodeUnits);
    const accountObservedFrom = accountTimelineBounds[0] ?? null;
    const accountObservedThrough = accountTimelineBounds.at(-1) ?? null;
    const revisionHash = createHash("sha256");
    const revisionHeader = canonicalJson({
      schemaVersion: 1,
      source: manifest.source,
      provider: manifest.provider,
      completeness: manifest.completeness,
      warnings: manifest.warnings
    });
    revisionHash.update(`${revisionHeader.length}:`, "utf8").update(revisionHeader, "utf8");
    for (const [kind, values] of [
      ["account", [account]],
      ["participant", accountParticipants],
      ["conversation", accountConversations],
      ["message", accountMessages],
      ["reaction", accountReactions],
      ["tombstone", accountTombstones]
    ]) {
      revisionHash.update(`${kind.length}:${kind}`, "utf8");
      for (const record of values) {
        const encoded = canonicalJson(record);
        revisionHash.update(`${Buffer.byteLength(encoded, "utf8")}:`, "utf8").update(encoded, "utf8");
      }
    }
    const revision = revisionHash.digest("hex");
    result.push(Object.freeze({
      source: Object.freeze({
        id: sourceId,
        kind: "bundle",
        provider: manifest.provider.id,
        network: account.network,
        accountId: account.provenance.connectedAccountProviderId,
        externalId: account.provenance.connectedAccountProviderId,
        revision,
        generatedAt: manifest.timestamps.createdAt,
        producer: manifest.source,
        coverage: Object.freeze({
          history: manifest.completeness.kind === "unknown" ? "unknown" : "bounded",
          observedFrom: accountObservedFrom,
          observedTo: accountObservedThrough,
          kind: manifest.completeness.kind,
          reason: manifest.completeness.reason
        }),
        manifestSha256,
        identity: Object.freeze({ account, selfParticipantProviderId: self.provenance.providerId }),
        warnings: Object.freeze(sourceWarnings)
      }),
      conversations: Object.freeze(normalizedConversations),
      conversationProvenance: Object.freeze(accountConversations.map((conversation) => ({
        conversationId: conversationLocalIds.get(conversation.id),
        externalId: conversation.provenance.providerId,
        metadata: conversation
      }))),
      messages: Object.freeze(normalizedMessages),
      messageProvenance: Object.freeze(messageProvenance),
      reactionFacts: Object.freeze(reactionFacts),
      auxiliaryRecords: Object.freeze(auxiliaryRecords),
      deletions: Object.freeze(deletions)
    }));
  }
  return Object.freeze(result);
}
async function readMessageBundle(path, options) {
  const key = hmacKey(options.hmacKey);
  const root = await bundleDirectory(path);
  const manifestResult = await readManifest(join2(root, "manifest.json"));
  const manifest = manifestResult.manifest;
  const manifestSha256 = sha256(manifestResult.bytes);
  const parsedRecords = [];
  for (const artifact of manifest.artifacts)
    parsedRecords.push(await readArtifact(root, artifact));
  const records = Object.fromEntries(manifest.artifacts.map((artifact, index) => [
    artifact.recordKind,
    parsedRecords[index]
  ]));
  return Object.freeze({
    schemaVersion: MESSAGE_BUNDLE_SCHEMA_VERSION,
    manifestSha256,
    sources: normalizeBundle(manifest, manifestSha256, records, key)
  });
}

// src/imessage.ts
import { Database as Database2 } from "bun:sqlite";
import { createHash as createHash2, createHmac as createHmac3 } from "crypto";
import {
  chmodSync as chmodSync2,
  constants as fsConstants3,
  copyFileSync as copyFileSync2,
  lstatSync as lstatSync2,
  mkdirSync as mkdirSync2,
  mkdtempSync as mkdtempSync2,
  realpathSync as realpathSync2,
  rmSync as rmSync2
} from "fs";
import { homedir as homedir2, tmpdir as tmpdir2 } from "os";
import { basename as basename2, isAbsolute as isAbsolute3, join as join3, resolve as resolve3 } from "path";
var DEFAULT_IMESSAGE_DATABASE = join3(homedir2(), "Library", "Messages", "chat.db");
var APPLE_EPOCH_MILLISECONDS = Date.UTC(2001, 0, 1);
var DEFAULT_MAX_DATABASE_BYTES = 16 * 1024 * 1024 * 1024;
var MAX_CONFIGURABLE_DATABASE_BYTES = 64 * 1024 * 1024 * 1024;
var DEFAULT_MAX_MESSAGES = 5000000;
var MAX_CONFIGURABLE_MESSAGES = 1e7;
var DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
var MAX_CONFIGURABLE_BODY_BYTES = 16 * 1024 * 1024;
var DEFAULT_MAX_ATTRIBUTED_BODY_BYTES = 8 * 1024 * 1024;
var MAX_CONFIGURABLE_ATTRIBUTED_BODY_BYTES = 32 * 1024 * 1024;
var DEFAULT_PAGE_SIZE2 = 5000;
var MAX_PAGE_SIZE2 = 20000;
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
function fail2(message) {
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
  return createHash2("sha256").update(value).digest("hex");
}
function hmac3(key, namespace, value) {
  return createHmac3("sha256", key).update(`message-like-me\x00${namespace}\x00`, "utf8").update(value, "utf8").digest("hex");
}
function hmacKey2(value) {
  const key = typeof value === "string" ? new TextEncoder().encode(value) : value;
  if (!(key instanceof Uint8Array) || key.byteLength < 16 || key.byteLength > 1024) {
    throw new Error("iMessage HMAC key must contain 16 through 1024 bytes");
  }
  return Uint8Array.from(key);
}
function boundedInteger2(value, fallback, minimum, maximum, label) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}`);
  }
  return result;
}
function ownedByCurrentUser(stats) {
  return typeof process.getuid !== "function" || stats.uid === BigInt(process.getuid());
}
function sameFile3(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}
function inspectSource(path, maximumBytes) {
  if (!isAbsolute3(path))
    return fail2("path must be absolute");
  const requested = resolve3(path);
  const requestedStats = lstatSync2(requested, { bigint: true });
  if (!requestedStats.isFile() || requestedStats.isSymbolicLink() || requestedStats.nlink !== 1n || !ownedByCurrentUser(requestedStats) || requestedStats.size < 1n || requestedStats.size > BigInt(maximumBytes)) {
    return fail2("must be one current-user-owned regular non-symlink file within the configured size bound");
  }
  const physicalPath = realpathSync2(requested);
  const physicalStats = lstatSync2(physicalPath, { bigint: true });
  if (!sameFile3(requestedStats, physicalStats)) {
    return fail2("changed identity while its path was resolved");
  }
  return Object.freeze({ path: physicalPath, stats: physicalStats });
}
function optionalStats2(path) {
  try {
    return lstatSync2(path, { bigint: true });
  } catch (error) {
    if (error.code === "ENOENT")
      return null;
    throw error;
  }
}
function validateSidecar2(path, stats, maximumBytes) {
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1n || !ownedByCurrentUser(stats) || stats.size < 0n || stats.size > BigInt(maximumBytes)) {
    return fail2(`sidecar ${basename2(path)} must be one current-user-owned regular non-symlink file within its size bound`);
  }
}
function snapshotMembers2(source, maximumBytes) {
  const current = inspectSource(source.path, maximumBytes);
  if (!sameFile3(source.stats, current.stats))
    return fail2("changed identity before its snapshot was isolated");
  const members = [{ suffix: "", path: current.path, stats: current.stats }];
  for (const suffix of ["-wal", "-journal"]) {
    const path = `${source.path}${suffix}`;
    const stats = optionalStats2(path);
    if (stats === null)
      continue;
    validateSidecar2(path, stats, maximumBytes);
    members.push(Object.freeze({ suffix, path, stats }));
  }
  const shmPath = `${source.path}-shm`;
  const shm = optionalStats2(shmPath);
  if (shm !== null)
    validateSidecar2(shmPath, shm, MAX_SQLITE_SHM_BYTES);
  const totalBytes = members.reduce((total, member) => total + member.stats.size, 0n);
  if (totalBytes > BigInt(maximumBytes) * 2n) {
    return fail2("database and transactional sidecars exceed the configured snapshot size bound");
  }
  return Object.freeze(members);
}
function sameSnapshotMembers(left, right) {
  return left.length === right.length && left.every((member, index) => {
    const other = right[index];
    return other !== undefined && member.suffix === other.suffix && sameFile3(member.stats, other.stats) && member.stats.size === other.stats.size && member.stats.mtimeNs === other.stats.mtimeNs && member.stats.ctimeNs === other.stats.ctimeNs;
  });
}
function isolateSource2(source, maximumBytes) {
  const temporaryRoot = tmpdir2();
  if (!isAbsolute3(temporaryRoot))
    return fail2("requires an absolute temporary directory");
  const temporaryDirectory = mkdtempSync2(join3(temporaryRoot, "message-like-me-source-"));
  chmodSync2(temporaryDirectory, 448);
  try {
    for (let attempt = 0;attempt < SOURCE_SNAPSHOT_ATTEMPTS; attempt += 1) {
      const before = snapshotMembers2(source, maximumBytes);
      const attemptDirectory = join3(temporaryDirectory, `attempt-${attempt}`);
      mkdirSync2(attemptDirectory, { mode: 448 });
      let copyFailedForRace = false;
      try {
        for (const member of before) {
          const destination = join3(attemptDirectory, `${basename2(source.path)}${member.suffix}`);
          copyFileSync2(member.path, destination, fsConstants3.COPYFILE_EXCL | fsConstants3.COPYFILE_FICLONE);
          chmodSync2(destination, 384);
        }
      } catch (error) {
        const code = error.code;
        if (code === "ENOENT" || code === "ESTALE")
          copyFailedForRace = true;
        else
          throw error;
      }
      const after = snapshotMembers2(source, maximumBytes);
      if (!copyFailedForRace && sameSnapshotMembers(before, after)) {
        return Object.freeze({
          source: Object.freeze({ path: source.path, stats: before[0].stats }),
          path: join3(attemptDirectory, basename2(source.path)),
          temporaryDirectory
        });
      }
      rmSync2(attemptDirectory, { recursive: true, force: true });
    }
    return fail2(`changed during ${SOURCE_SNAPSHOT_ATTEMPTS} attempts to isolate a consistent snapshot`);
  } catch (error) {
    rmSync2(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}
function allRows2(database, sql, ...bindings) {
  return database.query(sql).all(...bindings);
}
function getRow2(database, sql, ...bindings) {
  return database.query(sql).get(...bindings);
}
function safeInteger(value, label, nullable = false) {
  if (nullable && value === null)
    return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    return fail2(`${label} must be a safe integer`);
  }
  return value;
}
function flag2(value, label, fallback = 0) {
  if (value === null)
    return fallback;
  const parsed = safeInteger(value, label);
  if (parsed !== 0 && parsed !== 1)
    return fail2(`${label} must be zero or one`);
  return parsed;
}
function privateText(value, label, nullable = false, allowEmpty = false) {
  if (nullable && value === null)
    return null;
  if (typeof value !== "string" || !allowEmpty && value.length === 0 || Buffer.byteLength(value, "utf8") > MAX_TEXT_IDENTITY_BYTES || value.includes("\x00"))
    return fail2(`${label} must be bounded text`);
  return value;
}
function bodyText(value, label, maximumBytes) {
  if (value === null)
    return null;
  if (typeof value !== "string")
    return fail2(`${label} must be text or null`);
  if (Buffer.byteLength(value, "utf8") > maximumBytes) {
    return fail2(`${label} exceeds the configured body bound`);
  }
  return value;
}
function blob(value, label) {
  if (value === null)
    return null;
  if (value instanceof Uint8Array)
    return Uint8Array.from(value);
  return fail2(`${label} must be binary data or null`);
}
function tableColumns2(database, table) {
  return allRows2(database, `SELECT cid,name,type,"notnull",dflt_value,pk FROM pragma_table_info('${table}') ORDER BY cid`).map((row) => Object.freeze({
    cid: safeInteger(row.cid, `${table} column ordinal`),
    name: privateText(row.name, `${table} column name`),
    type: privateText(row.type, `${table} column type`, false, true),
    notnull: safeInteger(row.notnull, `${table} column nullability`),
    dflt_value: row.dflt_value,
    pk: safeInteger(row.pk, `${table} column primary-key position`)
  }));
}
function tableNames2(database) {
  return new Set(allRows2(database, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map((row) => privateText(row.name, "table name")));
}
function inspectSchema(database) {
  const names = tableNames2(database);
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
      return fail2(`is missing required table ${table}`);
    const shape = tableColumns2(database, table);
    const set = new Set(shape.map((column) => column.name));
    for (const column of columns) {
      if (!set.has(column))
        return fail2(`${table} is missing required column ${column}`);
    }
    inspected.set(table, shape);
    sets.set(table, set);
  }
  const messageColumns = sets.get("message");
  if (messageColumns === undefined || !messageColumns.has("text") && !messageColumns.has("attributedBody")) {
    return fail2("message must expose text or attributedBody");
  }
  let hasAttachmentJoin = false;
  if (names.has("message_attachment_join")) {
    const shape = tableColumns2(database, "message_attachment_join");
    const set = new Set(shape.map((column) => column.name));
    for (const column of ["message_id", "attachment_id"]) {
      if (!set.has(column))
        return fail2(`message_attachment_join is missing required column ${column}`);
    }
    inspected.set("message_attachment_join", shape);
    sets.set("message_attachment_join", set);
    hasAttachmentJoin = true;
  }
  const serialized = [...inspected.entries()].sort(([left], [right]) => left.localeCompare(right, "en-US")).map(([table, columns]) => ({ table, columns }));
  return Object.freeze({ hash: sha2562(stableJson(serialized)), tables: sets, hasAttachmentJoin });
}
function boundedTableCount(database, table, maximum) {
  const row = getRow2(database, `SELECT count(*) AS value FROM ${table}`);
  const count = safeInteger(row?.value, `${table} row count`);
  if (count === null || count < 0 || count > maximum) {
    return fail2(`${table} exceeds its supported row bound`);
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
function hasAppleTimestampMarker(value) {
  if (value === null || value === "")
    return false;
  return !/^0+(?:\.0+)?$/u.test(value);
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
  for (const row of allRows2(database, "SELECT ROWID,id,service FROM handle ORDER BY ROWID")) {
    const rowId = safeInteger(row.ROWID, "handle ROWID");
    const id = privateText(row.id, "handle identity");
    const service = privateText(row.service, "handle service", true);
    if (result.has(rowId))
      return fail2("contains duplicate handle ROWIDs");
    result.set(rowId, Object.freeze({
      rowId,
      id,
      service,
      participantId: hmac3(key, "participant", `${service ?? ""}\x00${id}`)
    }));
  }
  return result;
}
function loadChats(database, schema, handles, key) {
  boundedTableCount(database, "chat", MAX_CHATS);
  boundedTableCount(database, "chat_handle_join", MAX_CHAT_HANDLE_JOINS);
  const handleIds = new Map;
  for (const row of allRows2(database, "SELECT chat_id,handle_id FROM chat_handle_join ORDER BY chat_id,handle_id")) {
    const chatId = safeInteger(row.chat_id, "chat participant chat ID");
    const handleId = safeInteger(row.handle_id, "chat participant handle ID");
    if (!handles.has(handleId))
      return fail2("chat participant references a missing handle");
    const set = handleIds.get(chatId) ?? new Set;
    set.add(handleId);
    handleIds.set(chatId, set);
  }
  const columns = schema.tables.get("chat");
  if (columns === undefined)
    return fail2("chat schema disappeared");
  const rows = allRows2(database, `SELECT ROWID,guid,style,
    ${columnExpression(columns, "display_name", "display_name", "display_name")},
    ${columnExpression(columns, "service_name", "service_name", "service_name")}
    FROM chat ORDER BY ROWID`);
  const result = new Map;
  const conversationIds = new Set;
  for (const row of rows) {
    const rowId = safeInteger(row.ROWID, "chat ROWID");
    const sourceKey = privateText(row.guid, "chat GUID");
    safeInteger(row.style, "chat style", true);
    const privateLabel2 = privateText(row.display_name, "chat display name", true, true);
    const declaredService = privateText(row.service_name, "chat service", true, true);
    const participants = [...handleIds.get(rowId) ?? new Set].sort((left, right) => left - right).map((handleId) => handles.get(handleId)).filter((handle) => handle !== undefined);
    const services = [...new Set(participants.map((participant) => participant.service).filter((service) => service !== null))].sort();
    const conversation = Object.freeze({
      id: hmac3(key, "conversation", sourceKey),
      sourceKey,
      privateLabel: privateLabel2,
      service: declaredService === null || declaredService === "" ? services.length === 1 ? services[0] : null : declaredService,
      participantCount: participants.length,
      participantIds: Object.freeze(participants.map((participant) => participant.participantId)),
      privateParticipants: Object.freeze(participants.map((participant) => participant.id)),
      group: participants.length > 1
    });
    if (result.has(rowId) || conversationIds.has(conversation.id)) {
      return fail2("contains duplicate chat identities");
    }
    result.set(rowId, Object.freeze({ rowId, conversation }));
    conversationIds.add(conversation.id);
  }
  return result;
}
function loadChatJoins(database, first, last) {
  const grouped = new Map;
  for (const row of allRows2(database, `SELECT message_id,chat_id
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
  for (const row of allRows2(database, `SELECT message_id,
    count(DISTINCT attachment_id) AS value FROM message_attachment_join
    WHERE message_id BETWEEN ? AND ? GROUP BY message_id ORDER BY message_id`, first, last)) {
    const messageId = safeInteger(row.message_id, "attachment message ID");
    const count = safeInteger(row.value, "message attachment count");
    if (count < 0)
      return fail2("contains a negative attachment count");
    result.set(messageId, count);
  }
  return result;
}
function messageRows(database, schema, afterRowId, pageSize, maximumBodyBytes, maximumAttributedBodyBytes) {
  const columns = schema.tables.get("message");
  if (columns === undefined)
    return fail2("message schema disappeared");
  const rows = allRows2(database, `SELECT
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
    isFromMe: flag2(row.is_from_me, "message direction"),
    text: bodyText(row.message_text, "message text", maximumBodyBytes),
    textOverBound: flag2(row.message_text_over_bound, "message text bound flag"),
    attributedBody: blob(row.attributed_body, "message attributed body"),
    attributedBodyOverBound: flag2(row.attributed_body_over_bound, "message attributed-body bound flag"),
    itemType: row.item_type === null ? 0 : safeInteger(row.item_type, "message item type"),
    associatedMessageType: row.associated_message_type === null ? 0 : safeInteger(row.associated_message_type, "message associated-message type"),
    associatedMessageGuid: privateText(row.associated_message_guid, "associated message GUID", true, true),
    threadOriginatorGuid: privateText(row.thread_originator_guid, "thread originator GUID", true, true),
    replyToGuid: privateText(row.reply_to_guid, "reply-to GUID", true, true),
    isSystemMessage: flag2(row.is_system_message, "message system flag"),
    isServiceMessage: flag2(row.is_service_message, "message service flag"),
    isSpam: flag2(row.is_spam, "message spam flag"),
    isCorrupt: flag2(row.is_corrupt, "message corrupt flag"),
    editedDateText: privateText(row.date_edited_text, "message edited date", true, true),
    retractedDateText: privateText(row.date_retracted_text, "message retracted date", true, true),
    cacheHasAttachments: flag2(row.cache_has_attachments, "message attachment cache flag")
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
    return fail2("has an invalid modification time");
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
  const key = hmacKey2(options.hmacKey);
  const maximumDatabaseBytes = boundedInteger2(options.maxDatabaseBytes, DEFAULT_MAX_DATABASE_BYTES, 1, MAX_CONFIGURABLE_DATABASE_BYTES, "maxDatabaseBytes");
  const maximumMessages = boundedInteger2(options.maxMessages, DEFAULT_MAX_MESSAGES, 1, MAX_CONFIGURABLE_MESSAGES, "maxMessages");
  const maximumBodyBytes = boundedInteger2(options.maxBodyBytes, DEFAULT_MAX_BODY_BYTES, 1, MAX_CONFIGURABLE_BODY_BYTES, "maxBodyBytes");
  const maximumAttributedBodyBytes = boundedInteger2(options.maxAttributedBodyBytes, DEFAULT_MAX_ATTRIBUTED_BODY_BYTES, 1, MAX_CONFIGURABLE_ATTRIBUTED_BODY_BYTES, "maxAttributedBodyBytes");
  const pageSize = boundedInteger2(options.pageSize, DEFAULT_PAGE_SIZE2, 1, MAX_PAGE_SIZE2, "pageSize");
  const requestedSource = inspectSource(path, maximumDatabaseBytes);
  const isolated = isolateSource2(requestedSource, maximumDatabaseBytes);
  const source = isolated.source;
  let database = null;
  let transactionOpen = false;
  try {
    database = new Database2(isolated.path, { strict: true });
    database.exec("PRAGMA trusted_schema=OFF; PRAGMA temp_store=MEMORY; PRAGMA mmap_size=0; PRAGMA query_only=ON");
    const queryOnly = getRow2(database, "PRAGMA query_only");
    if (queryOnly?.query_only !== 1)
      return fail2("could not enable query-only mode");
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
        return fail2("message paging order is inconsistent");
      }
      const joins = loadChatJoins(database, first, last);
      const attachments = loadAttachmentCounts(database, schema, first, last);
      for (const row of page) {
        const id = hmac3(key, "message", row.sourceGuid);
        if (messageIds.has(id))
          return fail2("contains duplicate message GUIDs");
        if (row.isSpam === 1 || row.isCorrupt === 1) {
          warningCounts.spamOrCorrupt += 1;
          continue;
        }
        if (row.textOverBound === 1) {
          return fail2(`message text ${id} exceeds the configured body bound`);
        }
        if (row.attributedBodyOverBound === 1) {
          return fail2(`attributed body ${id} exceeds the configured attributed-body bound`);
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
          return fail2("message references a missing chat");
        if (row.isFromMe === 0 && row.handleId !== null && !handles.has(row.handleId)) {
          warningCounts.missingSenderHandle += 1;
        }
        const decodedBody = messageBody(row, maximumAttributedBodyBytes, maximumBodyBytes);
        if (row.text === null && row.attributedBody !== null && decodedBody.body === null) {
          warningCounts.unsupportedAttributedBody += 1;
        }
        const attachmentCount = attachments.get(row.sourceRowId) ?? (row.cacheHasAttachments === 1 ? 1 : 0);
        const kind = messageKind(row, decodedBody.body, attachmentCount);
        const retractedAt = appleTimestamp(row.retractedDateText);
        const retainBody = !hasAppleTimestampMarker(row.retractedDateText) && kind !== "reaction" && kind !== "system";
        const body = retainBody ? decodedBody : Object.freeze({ body: null, bodySource: "unavailable" });
        messages.push(Object.freeze({
          id,
          sourceRowId: row.sourceRowId,
          sourceGuid: row.sourceGuid,
          conversationId: chat.conversation.id,
          sentAt,
          direction: row.isFromMe === 1 ? "outgoing" : "incoming",
          body: body.body,
          bodySource: body.bodySource,
          kind,
          replyToSourceGuid: (row.threadOriginatorGuid || row.replyToGuid) ?? null,
          replyState: row.threadOriginatorGuid || row.replyToGuid ? "explicit" : "none",
          editedAt: appleTimestamp(row.editedDateText),
          retractedAt,
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
      rmSync2(isolated.temporaryDirectory, { recursive: true, force: true });
    }
  }
}

// src/metrics.ts
import { createHash as createHash3 } from "crypto";
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
  const hash = createHash3("sha256");
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
function optionalCanonicalTimestamp(value, label) {
  if (value === undefined || value === null)
    return Object.freeze({ value: null, milliseconds: null });
  return Object.freeze({ value, milliseconds: canonicalTimestamp(value, label) });
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
  return message.retractedAt === null && (message.kind === "text" || message.kind === "attachment" || message.kind === "reaction");
}
function responseEligible(message) {
  return message.retractedAt === null && (message.kind === "text" || message.kind === "attachment");
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
  return rows.flatMap(({ message }) => message.retractedAt === null && message.kind === "text" && message.body !== null ? [message.body] : []);
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
function responseTags(incoming, outgoing, latencySeconds, incomingQuestions, outgoingCharacters, explicitReplyCount, replyUnavailableCount) {
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
  if (replyUnavailableCount > 0)
    tags.add("reply-unavailable");
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
      const explicitReplyCount = outgoing.messages.filter(({ message }) => message.replyState === "explicit").length;
      const replyEligibleCount = outgoing.messages.filter(({ message }) => message.replyState !== "unavailable").length;
      const replyUnavailableCount = outgoing.messages.length - replyEligibleCount;
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
        replyEligibleCount,
        replyUnavailableCount,
        tags: responseTags(incoming.messages, outgoing.messages, latencySeconds, incomingQuestions, outgoingCharacters, explicitReplyCount, replyUnavailableCount)
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
  const outgoing = messages.flatMap(({ message }) => message.retractedAt === null && message.direction === "outgoing" && message.kind === "text" && message.body !== null ? [message.body] : []);
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
  const outgoingText = messages.filter(({ message }) => message.retractedAt === null && message.direction === "outgoing" && message.kind === "text" && message.body !== null);
  const replyEligible = outgoingText.filter(({ message }) => message.replyState !== "unavailable");
  const explicitReplies = replyEligible.filter(({ message }) => message.replyState === "explicit").length;
  const replyUnavailable = outgoingText.length - replyEligible.length;
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
    explicitReplyEligibleMessages: replyEligible.length,
    explicitReplyUnavailableMessages: replyUnavailable,
    explicitReplyRatio: replyEligible.length === 0 ? null : ratio(explicitReplies, replyEligible.length),
    multiIncomingEpisodes: responses.filter((response) => response.incomingCount > 1).length,
    multiQuestionEpisodes: responses.filter((response) => response.incomingQuestions > 1).length
  });
}
function reactionMetrics(messages, facts) {
  const legacy = messages.filter(({ message }) => message.kind === "reaction" && message.retractedAt === null).map(({ message }) => ({
    id: message.id,
    externalId: message.sourceGuid,
    targetExternalId: message.replyToSourceGuid ?? message.sourceGuid,
    conversationId: message.conversationId,
    direction: message.direction,
    body: "unknown",
    reactedAt: message.sentAt,
    state: "active"
  }));
  const merged = new Map(legacy.map((fact) => [fact.id, fact]));
  for (const fact of facts ?? [])
    merged.set(fact.id, fact);
  const source = [...merged.values()];
  const ids = new Set;
  const reactions = source.filter((fact, index) => {
    if (typeof fact.id !== "string" || fact.id.length === 0 || ids.has(fact.id) || fact.direction !== null && fact.direction !== "incoming" && fact.direction !== "outgoing" || typeof fact.body !== "string" || fact.state !== "active" && fact.state !== "removed")
      throw new Error(`reactionFacts[${index}] is invalid`);
    if (fact.reactedAt !== null)
      canonicalTimestamp(fact.reactedAt, `reactionFacts[${index}].reactedAt`);
    ids.add(fact.id);
    return fact.state === "active";
  });
  const outgoing = reactions.filter(({ direction }) => direction === "outgoing").length;
  const incoming = reactions.filter(({ direction }) => direction === "incoming").length;
  const unknownDirection = reactions.length - outgoing - incoming;
  const outgoingActions = messages.filter(({ message }) => message.kind !== "reaction" && message.direction === "outgoing" && timelineEligible(message)).length + outgoing;
  return Object.freeze({
    total: reactions.length,
    incoming,
    outgoing,
    unknownDirection,
    dated: reactions.filter(({ reactedAt }) => reactedAt !== null).length,
    undated: reactions.filter(({ reactedAt }) => reactedAt === null).length,
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
  const byConversation = new Map;
  for (const row of ordered) {
    const rows = byConversation.get(row.message.conversationId) ?? [];
    rows.push(row);
    byConversation.set(row.message.conversationId, rows);
  }
  const sessions = [];
  const burstRecords = [];
  const responses = [];
  for (const conversationId of [...byConversation.keys()].sort((left, right) => left.localeCompare(right, "en-US"))) {
    const rows = Object.freeze(byConversation.get(conversationId));
    const conversationSessions = sessionsFor(rows, corpusRevision, contactId, sessionGapSeconds);
    const conversationBursts = burstsFor(rows, conversationSessions, corpusRevision, contactId, burstGapSeconds);
    sessions.push(...conversationSessions);
    burstRecords.push(...conversationBursts);
    responses.push(...responsesFor(conversationBursts, corpusRevision, contactId));
  }
  sessions.sort((left, right) => left.startedAt.localeCompare(right.startedAt, "en-US") || left.id.localeCompare(right.id, "en-US"));
  burstRecords.sort((left, right) => left.metric.startedAt.localeCompare(right.metric.startedAt, "en-US") || left.metric.id.localeCompare(right.metric.id, "en-US"));
  responses.sort((left, right) => left.startedAt.localeCompare(right.startedAt, "en-US") || left.id.localeCompare(right.id, "en-US"));
  return Object.freeze({
    schemaVersion: METRICS_SCHEMA_VERSION,
    corpusRevision,
    contactId,
    firstMessageAt: ordered[0]?.message.sentAt ?? null,
    lastMessageAt: ordered.at(-1)?.message.sentAt ?? null,
    messageCount: ordered.length,
    incomingCount: ordered.filter(({ message }) => message.direction === "incoming").length,
    outgoingCount: ordered.filter(({ message }) => message.direction === "outgoing").length,
    textMessageCount: ordered.filter(({ message }) => message.retractedAt === null && message.kind === "text" && message.body !== null).length,
    sessionGapSeconds,
    burstGapSeconds,
    sessions: Object.freeze(sessions),
    bursts: Object.freeze(burstRecords.map(({ metric }) => metric)),
    responses: Object.freeze(responses),
    tempo: tempoMetrics(ordered, responses),
    reactions: reactionMetrics(ordered, options.reactionFacts),
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
      explicitReply: message.replyState === "unavailable" ? null : message.replyState === "explicit"
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
    response.explicitReplyCount > 0 ? "reply" : response.replyUnavailableCount > 0 ? "reply-unknown" : "no-reply",
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
      explicitReplyEligibleMessages: metrics.tempo.explicitReplyEligibleMessages,
      explicitReplyUnavailableMessages: metrics.tempo.explicitReplyUnavailableMessages,
      explicitReplyRatio: metrics.tempo.explicitReplyRatio,
      multiIncomingEpisodes: metrics.tempo.multiIncomingEpisodes,
      multiQuestionEpisodes: metrics.tempo.multiQuestionEpisodes
    }),
    reactions: Object.freeze({
      total: metrics.reactions.total,
      incoming: metrics.reactions.incoming,
      outgoing: metrics.reactions.outgoing,
      unknownDirection: metrics.reactions.unknownDirection,
      dated: metrics.reactions.dated,
      undated: metrics.reactions.undated,
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
  const evidenceRevision = options.evidenceRevision ?? metrics.corpusRevision;
  if (!/^[a-f0-9]{64}$/u.test(evidenceRevision)) {
    throw new Error("evidenceRevision must be a lowercase SHA-256 digest");
  }
  const after = optionalCanonicalTimestamp(options.evidenceWindow?.after, "evidenceWindow.after");
  const before = optionalCanonicalTimestamp(options.evidenceWindow?.before, "evidenceWindow.before");
  if (after.milliseconds !== null && before.milliseconds !== null && after.milliseconds >= before.milliseconds)
    throw new Error("evidenceWindow.after must be earlier than evidenceWindow.before");
  const afterMilliseconds = after.milliseconds;
  const beforeMilliseconds = before.milliseconds;
  const ordered = orderedMessages(messages).filter(({ milliseconds }) => (afterMilliseconds === null || milliseconds >= afterMilliseconds) && (beforeMilliseconds === null || milliseconds < beforeMilliseconds));
  const candidateSet = candidatesFor(ordered, metrics, maximumTextBytes, maximumMessagesPerDirection);
  const selected = selectDiverse(candidateSet.candidates, limit, maximumBodyBytes);
  const emittedBodyBytes = selected.examples.reduce((total, example) => total + example.coverage.emitted.bodyBytes, 0);
  return Object.freeze({
    schemaVersion: STUDY_PACKET_SCHEMA_VERSION,
    generatedAt,
    corpusRevision: metrics.corpusRevision,
    evidenceRevision,
    contactId: metrics.contactId,
    evidenceWindow: Object.freeze({ after: after.value, before: before.value }),
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
function buildEvaluationPackets(messages, metrics, options) {
  const limit = options.limit ?? 8;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) {
    throw new Error("evaluation limit must be an integer from 1 through 25");
  }
  const maximumTextBytes = boundedStudyInteger(options.maxTextBytesPerMessage, DEFAULT_MAX_STUDY_TEXT_BYTES, MAX_STUDY_TEXT_BYTES, "maxTextBytesPerMessage");
  const maximumMessagesPerDirection = boundedStudyInteger(options.maxMessagesPerDirectionPerCase, DEFAULT_MAX_STUDY_MESSAGES_PER_DIRECTION, MAX_STUDY_MESSAGES_PER_DIRECTION, "maxMessagesPerDirectionPerCase");
  const maximumBodyBytes = boundedStudyInteger(options.maxTotalBodyBytes, DEFAULT_MAX_STUDY_PACKET_BODY_BYTES, MAX_STUDY_PACKET_BODY_BYTES, "maxTotalBodyBytes");
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  canonicalTimestamp(generatedAt, "generatedAt");
  const evidenceRevision = options.evidenceRevision ?? metrics.corpusRevision;
  if (!/^[a-f0-9]{64}$/u.test(evidenceRevision)) {
    throw new Error("evidenceRevision must be a lowercase SHA-256 digest");
  }
  const after = optionalCanonicalTimestamp(options.after, "after");
  const before = optionalCanonicalTimestamp(options.before, "before");
  if (after.value === null || after.milliseconds === null)
    throw new Error("after is required");
  if (before.milliseconds !== null && after.milliseconds >= before.milliseconds)
    throw new Error("after must be earlier than before");
  const afterMilliseconds = after.milliseconds;
  const beforeMilliseconds = before.milliseconds;
  const ordered = orderedMessages(messages).filter(({ milliseconds }) => milliseconds >= afterMilliseconds && (beforeMilliseconds === null || milliseconds < beforeMilliseconds));
  const candidateSet = candidatesFor(ordered, metrics, maximumTextBytes, maximumMessagesPerDirection);
  const chronological = [...candidateSet.candidates].sort((left, right) => left.milliseconds - right.milliseconds || left.example.id.localeCompare(right.example.id, "en-US"));
  const selected = [];
  let emittedBodyBytes = 0;
  for (const candidate of chronological) {
    if (selected.length >= limit)
      break;
    if (candidate.bodyBytes > maximumBodyBytes - emittedBodyBytes)
      continue;
    selected.push(candidate);
    emittedBodyBytes += candidate.bodyBytes;
  }
  const caseIds = selected.map(({ example }) => example.id);
  const evaluationId = digest("evaluation", [
    metrics.corpusRevision,
    evidenceRevision,
    metrics.contactId,
    after.value,
    before.value ?? "",
    ...caseIds
  ]);
  const promptCases = Object.freeze(selected.map(({ example }) => Object.freeze({
    id: example.id,
    startedAt: example.startedAt,
    incoming: Object.freeze(example.messages.filter(({ direction }) => direction === "incoming"))
  })));
  const referenceCases = Object.freeze(selected.map(({ example }) => {
    const outgoing = Object.freeze(example.messages.filter(({ direction }) => direction === "outgoing"));
    return Object.freeze({
      id: example.id,
      startedAt: example.startedAt,
      outgoing,
      shape: Object.freeze({
        bubbles: outgoing.length,
        characters: outgoing.reduce((total, message) => total + characterCount(message.body), 0),
        words: outgoing.reduce((total, message) => total + wordCount(message.body), 0),
        explicitReplyMessages: outgoing.filter(({ explicitReply }) => explicitReply === true).length,
        explicitReplyEligibleMessages: outgoing.filter(({ explicitReply }) => explicitReply !== null).length,
        explicitReplyUnavailableMessages: outgoing.filter(({ explicitReply }) => explicitReply === null).length
      })
    });
  }));
  const promptMessages = promptCases.flatMap(({ incoming }) => incoming);
  const evidenceWindow = Object.freeze({ after: after.value, before: before.value });
  const shared = {
    schemaVersion: EVALUATION_PACKET_SCHEMA_VERSION,
    evaluationId,
    generatedAt,
    corpusRevision: metrics.corpusRevision,
    evidenceRevision,
    contactId: metrics.contactId,
    evidenceWindow
  };
  return Object.freeze({
    prompt: Object.freeze({
      ...shared,
      cases: promptCases,
      selection: Object.freeze({
        algorithm: "temporal-held-out-responses-v1",
        requestedLimit: limit,
        eligibleCandidates: candidateSet.candidates.length,
        emitted: promptCases.length
      }),
      budget: Object.freeze({
        maxTextBytesPerMessage: maximumTextBytes,
        maxMessagesPerDirectionPerCase: maximumMessagesPerDirection,
        maxTotalBodyBytes: maximumBodyBytes,
        emittedBodyBytes: promptMessages.reduce((total, message) => total + message.emittedBodyBytes, 0),
        truncatedMessages: promptMessages.filter(({ bodyTruncated }) => bodyTruncated).length
      })
    }),
    reference: Object.freeze({
      ...shared,
      cases: referenceCases,
      notice: "Open only after the candidate drafts for every case are fixed."
    })
  });
}

// src/paths.ts
import { randomBytes } from "crypto";
import {
  chmod,
  link,
  lstat as lstat2,
  mkdir,
  open as open2,
  readFile,
  realpath as realpath2,
  stat,
  unlink
} from "fs/promises";
import { homedir as homedir3, platform } from "os";
import { basename as basename3, dirname as dirname2, isAbsolute as isAbsolute4, join as join4, resolve as resolve4 } from "path";
function defaultDataDirectory() {
  const override = process.env.XDG_DATA_HOME;
  if (override !== undefined && override.trim() !== "") {
    if (!isAbsolute4(override)) {
      throw new CliError("unsafe-path", "XDG_DATA_HOME must be absolute");
    }
    return join4(resolve4(override), "message-like-me");
  }
  if (platform() === "darwin") {
    return join4(homedir3(), "Library", "Application Support", "Message Like Me");
  }
  return join4(homedir3(), ".local", "share", "message-like-me");
}
function dataPaths(explicit) {
  if (explicit !== undefined && !isAbsolute4(explicit)) {
    throw new CliError("unsafe-path", "Data directory must be absolute");
  }
  const root = explicit === undefined ? defaultDataDirectory() : resolve4(explicit);
  if (!isAbsolute4(root))
    throw new CliError("unsafe-path", "Data directory must be absolute");
  return {
    root,
    database: join4(root, "message-like-me.sqlite3"),
    installKey: join4(root, "install.key"),
    packets: join4(root, "study-packets")
  };
}
async function existingType(path) {
  try {
    return await lstat2(path);
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
  const after = await lstat2(path);
  if (after.isSymbolicLink() || !after.isDirectory()) {
    throw new CliError("unsafe-path", `${path} is not a physical directory`);
  }
  await assertOwned(path);
  await chmod(path, 448);
  return realpath2(path);
}
async function initializeDataPaths(paths) {
  const physicalRoot = await ensurePrivateDirectory(paths.root);
  const physicalPackets = await ensurePrivateDirectory(join4(physicalRoot, "study-packets"));
  return {
    root: physicalRoot,
    database: join4(physicalRoot, basename3(paths.database)),
    installKey: join4(physicalRoot, basename3(paths.installKey)),
    packets: physicalPackets
  };
}
async function assertPrivateRegularFile(path) {
  const metadata = await lstat2(path);
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
    const handle = await open2(path, "wx", 384);
    try {
      await handle.writeFile(`${key.toString("hex")}
`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await assertPrivateRegularFile(path);
    await syncDirectory(dirname2(path));
    return Uint8Array.from(key);
  } catch (error) {
    if (error.code === "EEXIST")
      return loadOrCreateInstallKey(path);
    throw error;
  }
}
async function privateOutputDirectory(path) {
  await mkdir(path, { recursive: true, mode: 448 });
  const requested = await lstat2(path);
  if (requested.isSymbolicLink() || !requested.isDirectory()) {
    throw new CliError("unsafe-path", `${path} must be a physical directory`);
  }
  await assertOwned(path);
  if ((requested.mode & 63) !== 0) {
    throw new CliError("unsafe-path", `${path} must already have private permissions; refusing to change a caller-owned directory`);
  }
  return realpath2(path);
}
async function syncDirectory(path) {
  let handle = null;
  try {
    handle = await open2(path, "r");
    await handle.sync();
  } catch (error) {
    const code = error.code;
    if (code !== "EINVAL" && code !== "ENOTSUP" && code !== "EISDIR" && code !== "EPERM") {
      throw error;
    }
  } finally {
    await handle?.close();
  }
}
async function atomicWritePrivate(path, bytes) {
  const parent = await privateOutputDirectory(dirname2(resolve4(path)));
  const destination = join4(parent, basename3(path));
  const temporary = join4(parent, `.${basename3(path)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
  let published = false;
  try {
    const handle = await open2(temporary, "wx", 384);
    try {
      await handle.writeFile(bytes);
      await handle.chmod(384);
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
    await unlink(temporary).catch(() => {
      return;
    });
    if (published) {
      await unlink(destination).catch(() => {
        return;
      });
      await syncDirectory(parent).catch(() => {
        return;
      });
    }
    throw error;
  }
}

// src/profile.ts
import { constants as fsConstants4 } from "fs";
import { open as open3 } from "fs/promises";
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
function nullableIsoTimestamp(value, label) {
  return value === null ? null : isoTimestamp(value, label);
}
function digest2(value, label) {
  const parsed = text(value, label, 64);
  if (!/^[a-f0-9]{64}$/u.test(parsed)) {
    throw new CliError("invalid-data", `${label} must be lowercase SHA-256`);
  }
  return parsed;
}
function nonNegativeInteger(value, label, maximum = 1e7) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new CliError("invalid-data", `${label} must be an integer from 0 through ${maximum}`);
  }
  return value;
}
function confidenceLevel(value, label) {
  if (value !== "low" && value !== "medium" && value !== "high") {
    throw new CliError("invalid-data", `${label} must be low, medium, or high`);
  }
  return value;
}
function parseStyleProfileV1(value) {
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
  if (root.schemaVersion !== LEGACY_PROFILE_SCHEMA_VERSION) {
    throw new CliError("invalid-data", `profile.schemaVersion must be ${LEGACY_PROFILE_SCHEMA_VERSION}`);
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
    schemaVersion: LEGACY_PROFILE_SCHEMA_VERSION,
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
function parseStyleProfileV2(value) {
  const root = object(value, "profile");
  exactKeys(root, [
    "schemaVersion",
    "contactId",
    "corpusRevision",
    "packetSha256",
    "analyzedAt",
    "evidence",
    "overview",
    "prose",
    "tempo",
    "replies",
    "contexts",
    "claims",
    "invariants",
    "avoid",
    "confidence"
  ], "profile");
  if (root.schemaVersion !== PROFILE_SCHEMA_VERSION) {
    throw new CliError("invalid-data", `profile.schemaVersion must be ${PROFILE_SCHEMA_VERSION}`);
  }
  const contactId = text(root.contactId, "profile.contactId", 128);
  const corpusRevision = digest2(root.corpusRevision, "profile.corpusRevision");
  const packetSha256 = digest2(root.packetSha256, "profile.packetSha256");
  const evidence = object(root.evidence, "profile.evidence");
  exactKeys(evidence, [
    "evidenceRevision",
    "firstMessageAt",
    "lastMessageAt",
    "messageCount",
    "outgoingTextMessages",
    "responseEpisodes",
    "studyExamples",
    "selectionAlgorithm",
    "after",
    "before"
  ], "profile.evidence");
  if (evidence.selectionAlgorithm !== "bounded-diverse-response-contexts-v1") {
    throw new CliError("invalid-data", "profile.evidence.selectionAlgorithm must be bounded-diverse-response-contexts-v1");
  }
  const firstMessageAt = nullableIsoTimestamp(evidence.firstMessageAt, "profile.evidence.firstMessageAt");
  const lastMessageAt = nullableIsoTimestamp(evidence.lastMessageAt, "profile.evidence.lastMessageAt");
  const after = nullableIsoTimestamp(evidence.after, "profile.evidence.after");
  const before = nullableIsoTimestamp(evidence.before, "profile.evidence.before");
  if (firstMessageAt !== null && lastMessageAt !== null && firstMessageAt > lastMessageAt) {
    throw new CliError("invalid-data", "profile.evidence.firstMessageAt must not follow lastMessageAt");
  }
  if (after !== null && before !== null && after >= before) {
    throw new CliError("invalid-data", "profile.evidence.after must be earlier than before");
  }
  const prose = object(root.prose, "profile.prose");
  exactKeys(prose, [
    "register",
    "capitalization",
    "punctuation",
    "vocabulary",
    "warmth",
    "humor",
    "openingPatterns",
    "closingPatterns",
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
  exactKeys(confidence, [
    "overall",
    "prose",
    "tempo",
    "replies",
    "contexts",
    "limitations"
  ], "profile.confidence");
  if (!Array.isArray(root.contexts) || root.contexts.length > 32) {
    throw new CliError("invalid-data", "profile.contexts must contain at most 32 items");
  }
  if (!Array.isArray(root.claims) || root.claims.length > 64) {
    throw new CliError("invalid-data", "profile.claims must contain at most 64 items");
  }
  const contexts = root.contexts.map((item, index) => {
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
  });
  const claims = root.claims.map((item, index) => {
    const claim = object(item, `profile.claims[${index}]`);
    exactKeys(claim, [
      "dimension",
      "statement",
      "basis",
      "appliesWhen",
      "supportExampleIds",
      "counterexampleIds",
      "supportCount",
      "confidence",
      "draftingConsequence"
    ], `profile.claims[${index}]`);
    if (claim.dimension !== "prose" && claim.dimension !== "tempo" && claim.dimension !== "reply" && claim.dimension !== "context")
      throw new CliError("invalid-data", `profile.claims[${index}].dimension is invalid`);
    if (claim.basis !== "measured" && claim.basis !== "inferred") {
      throw new CliError("invalid-data", `profile.claims[${index}].basis must be measured or inferred`);
    }
    return {
      dimension: claim.dimension,
      statement: text(claim.statement, `profile.claims[${index}].statement`),
      basis: claim.basis,
      appliesWhen: text(claim.appliesWhen, `profile.claims[${index}].appliesWhen`),
      supportExampleIds: textArray(claim.supportExampleIds, `profile.claims[${index}].supportExampleIds`),
      counterexampleIds: textArray(claim.counterexampleIds, `profile.claims[${index}].counterexampleIds`),
      supportCount: nonNegativeInteger(claim.supportCount, `profile.claims[${index}].supportCount`),
      confidence: confidenceLevel(claim.confidence, `profile.claims[${index}].confidence`),
      draftingConsequence: text(claim.draftingConsequence, `profile.claims[${index}].draftingConsequence`)
    };
  });
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    contactId,
    corpusRevision,
    packetSha256,
    analyzedAt: isoTimestamp(root.analyzedAt, "profile.analyzedAt"),
    evidence: {
      evidenceRevision: digest2(evidence.evidenceRevision, "profile.evidence.evidenceRevision"),
      firstMessageAt,
      lastMessageAt,
      messageCount: nonNegativeInteger(evidence.messageCount, "profile.evidence.messageCount"),
      outgoingTextMessages: nonNegativeInteger(evidence.outgoingTextMessages, "profile.evidence.outgoingTextMessages"),
      responseEpisodes: nonNegativeInteger(evidence.responseEpisodes, "profile.evidence.responseEpisodes"),
      studyExamples: nonNegativeInteger(evidence.studyExamples, "profile.evidence.studyExamples", 50),
      selectionAlgorithm: "bounded-diverse-response-contexts-v1",
      after,
      before
    },
    overview: text(root.overview, "profile.overview", 8192),
    prose: {
      register: text(prose.register, "profile.prose.register"),
      capitalization: text(prose.capitalization, "profile.prose.capitalization"),
      punctuation: text(prose.punctuation, "profile.prose.punctuation"),
      vocabulary: text(prose.vocabulary, "profile.prose.vocabulary"),
      warmth: text(prose.warmth, "profile.prose.warmth"),
      humor: text(prose.humor, "profile.prose.humor"),
      openingPatterns: textArray(prose.openingPatterns, "profile.prose.openingPatterns"),
      closingPatterns: textArray(prose.closingPatterns, "profile.prose.closingPatterns"),
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
    contexts,
    claims,
    invariants: textArray(root.invariants, "profile.invariants"),
    avoid: textArray(root.avoid, "profile.avoid"),
    confidence: {
      overall: confidenceLevel(confidence.overall, "profile.confidence.overall"),
      prose: confidenceLevel(confidence.prose, "profile.confidence.prose"),
      tempo: confidenceLevel(confidence.tempo, "profile.confidence.tempo"),
      replies: confidenceLevel(confidence.replies, "profile.confidence.replies"),
      contexts: confidenceLevel(confidence.contexts, "profile.confidence.contexts"),
      limitations: textArray(confidence.limitations, "profile.confidence.limitations")
    }
  };
}
function parseStyleProfile(value) {
  const root = object(value, "profile");
  if (root.schemaVersion === LEGACY_PROFILE_SCHEMA_VERSION)
    return parseStyleProfileV1(root);
  if (root.schemaVersion === PROFILE_SCHEMA_VERSION)
    return parseStyleProfileV2(root);
  throw new CliError("invalid-data", `profile.schemaVersion must be ${LEGACY_PROFILE_SCHEMA_VERSION} or ${PROFILE_SCHEMA_VERSION}`);
}
async function readStyleProfile(path) {
  let parsed;
  try {
    const handle = await open3(path, fsConstants4.O_RDONLY | fsConstants4.O_NOFOLLOW);
    try {
      const before = await handle.stat();
      const privateMode = (before.mode & 63) === 0;
      const owned2 = typeof process.getuid !== "function" || before.uid === process.getuid();
      if (!before.isFile() || before.nlink !== 1 || !owned2 || !privateMode) {
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

// src/private-json.ts
import { constants as fsConstants5 } from "fs";
import { lstat as lstat3, open as open4 } from "fs/promises";
function sameFile4(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}
function assertPrivateMetadata(metadata, label, maximumBytes) {
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1) {
    throw new CliError("unsafe-path", `${label} must be one physical regular file`);
  }
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
    throw new CliError("unsafe-path", `${label} must be owned by the current user`);
  }
  if ((metadata.mode & 63) !== 0) {
    throw new CliError("unsafe-path", `${label} must already have owner-only permissions`);
  }
  if (metadata.size < 1 || metadata.size > maximumBytes) {
    throw new CliError("invalid-data", `${label} must be within its private file-size bound`);
  }
}
async function readStablePrivateFile(path, label, maximumBytes) {
  let before;
  try {
    before = await lstat3(path);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new CliError("not-found", `${label} does not exist`, { cause: error });
    }
    throw new CliError("permission", `${label} cannot be inspected safely`, { cause: error });
  }
  assertPrivateMetadata(before, label, maximumBytes);
  let handle;
  try {
    handle = await open4(path, fsConstants5.O_RDONLY | fsConstants5.O_NOFOLLOW);
  } catch (error) {
    throw new CliError("unsafe-path", `${label} could not be opened without following links`, { cause: error });
  }
  try {
    const opened = await handle.stat();
    assertPrivateMetadata(opened, label, maximumBytes);
    if (!sameFile4(before, opened)) {
      throw new CliError("unsafe-path", `${label} changed before it was read`);
    }
    const bytes = await handle.readFile();
    const afterHandle = await handle.stat();
    let afterPath;
    try {
      afterPath = await lstat3(path);
    } catch (error) {
      throw new CliError("unsafe-path", `${label} changed while it was read`, { cause: error });
    }
    if (bytes.byteLength !== opened.size || !sameFile4(opened, afterHandle) || !sameFile4(opened, afterPath))
      throw new CliError("unsafe-path", `${label} changed while it was read`);
    return Uint8Array.from(bytes);
  } finally {
    await handle.close();
  }
}
async function readStablePrivateJson(path, label, maximumBytes) {
  const bytes = await readStablePrivateFile(path, label, maximumBytes);
  let text2;
  try {
    text2 = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new CliError("invalid-data", `${label} must be canonical UTF-8 JSON`, { cause: error });
  }
  if (text2.charCodeAt(0) === 65279 || text2.includes("\r")) {
    throw new CliError("invalid-data", `${label} must be canonical UTF-8 JSON without BOM or CR bytes`);
  }
  try {
    return JSON.parse(text2);
  } catch (error) {
    throw new CliError("invalid-data", `${label} is malformed JSON`, { cause: error });
  }
}

// src/skill-install.ts
import { cp, lstat as lstat4, mkdir as mkdir2, realpath as realpath3, rm } from "fs/promises";
import { homedir as homedir4 } from "os";
import { dirname as dirname3, join as join5, resolve as resolve5 } from "path";
import { fileURLToPath } from "url";
async function exists(path) {
  try {
    await lstat4(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT")
      return false;
    throw error;
  }
}
function bundledSkillPath() {
  return resolve5(dirname3(fileURLToPath(import.meta.url)), "../skills/message-like-me");
}
function targetRoot(target, scope, projectDirectory) {
  const directory = target === "codex" ? ".codex" : target === "claude" ? ".claude" : ".agents";
  return scope === "user" ? join5(homedir4(), directory, "skills") : join5(resolve5(projectDirectory), directory, "skills");
}
async function installSkill(options) {
  const source = bundledSkillPath();
  if (!await exists(source))
    throw new CliError("not-found", `Bundled skill is missing at ${source}`);
  const sourceMetadata = await lstat4(source);
  if (sourceMetadata.isSymbolicLink() || !sourceMetadata.isDirectory()) {
    throw new CliError("unsafe-path", "Bundled skill must be a physical directory");
  }
  const root = targetRoot(options.target, options.scope, options.projectDirectory ?? process.cwd());
  await mkdir2(root, { recursive: true, mode: 448 });
  const destination = join5(root, "message-like-me");
  if (await exists(destination)) {
    const metadata = await lstat4(destination);
    if (metadata.isSymbolicLink()) {
      throw new CliError("unsafe-path", `Refusing to replace symbolic link ${destination}`);
    }
    if (!options.force) {
      throw new CliError("conflict", `Skill already exists at ${destination}; pass --force to replace it`);
    }
    await rm(destination, { recursive: true, force: true });
  }
  await cp(source, destination, { recursive: true, errorOnExist: true });
  return realpath3(destination);
}

// src/store.ts
import { Database as Database3 } from "bun:sqlite";
import { createHash as createHash4 } from "crypto";
import {
  closeSync,
  constants as fsConstants6,
  fchmodSync,
  fstatSync,
  lstatSync as lstatSync3,
  openSync
} from "fs";
var STORE_SCHEMA_VERSION = 5;
var PERSON_SCOPE_PREFIX = "person_";
var IMESSAGE_SOURCE_ID = "source_imessage_local";
var SCHEMA = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS corpus_sources (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('imessage', 'bundle', 'x-archive')),
    kind_v4 TEXT CHECK (kind_v4 IN ('imessage', 'bundle', 'x-archive')),
    provider TEXT NOT NULL,
    network TEXT,
    account_id TEXT,
    external_id TEXT NOT NULL,
    input_revision TEXT NOT NULL,
    revision TEXT NOT NULL,
    generated_at TEXT,
    producer_json TEXT NOT NULL,
    coverage_json TEXT NOT NULL,
    manifest_sha256 TEXT,
    identity_json TEXT NOT NULL,
    warnings_json TEXT NOT NULL,
    ingested_at TEXT NOT NULL
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
  CREATE TABLE IF NOT EXISTS conversation_sources (
    conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES corpus_sources(id) ON DELETE RESTRICT,
    external_id TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    UNIQUE (source_id, external_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS conversation_sources_lookup
    ON conversation_sources(source_id, conversation_id);
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
    reply_state TEXT NOT NULL CHECK (reply_state IN ('explicit','none','unavailable')),
    edited_at TEXT,
    retracted_at TEXT,
    service TEXT,
    attachment_count INTEGER NOT NULL CHECK (attachment_count >= 0),
    UNIQUE (source_row_id, conversation_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS messages_conversation_time
    ON messages(conversation_id, sent_at, source_row_id, id);
  CREATE INDEX IF NOT EXISTS messages_source_guid ON messages(source_guid);
  CREATE TABLE IF NOT EXISTS message_provenance (
    message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES corpus_sources(id) ON DELETE RESTRICT,
    external_id TEXT NOT NULL,
    reply_to_external_id TEXT,
    attachments_json TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    UNIQUE (source_id, external_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS message_provenance_source
    ON message_provenance(source_id, message_id);
  CREATE TABLE IF NOT EXISTS corpus_reaction_facts (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES corpus_sources(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    target_external_id TEXT NOT NULL,
    conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
    direction TEXT CHECK (direction IN ('incoming','outgoing')),
    body TEXT NOT NULL,
    reacted_at TEXT,
    state TEXT NOT NULL CHECK (state IN ('active','removed')),
    UNIQUE (source_id, external_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS corpus_reaction_facts_source
    ON corpus_reaction_facts(source_id,conversation_id,id);
  CREATE TABLE IF NOT EXISTS corpus_source_records (
    source_id TEXT NOT NULL REFERENCES corpus_sources(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (
      kind IN ('account','participant','reaction','tombstone','excluded-message')
    ),
    external_id TEXT NOT NULL,
    record_json TEXT NOT NULL,
    PRIMARY KEY (source_id, kind, external_id)
  ) WITHOUT ROWID, STRICT;
  CREATE TABLE IF NOT EXISTS corpus_source_suppressions (
    source_id TEXT NOT NULL REFERENCES corpus_sources(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (
      kind IN ('conversation','message','reaction','reaction-timeline','participant','account')
    ),
    local_id TEXT NOT NULL,
    external_id TEXT NOT NULL,
    suppressed_at TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (
      reason IN ('authoritative-absence','tombstone','explicit-exclusion','replacement','reappeared')
    ),
    suppressed INTEGER NOT NULL CHECK (suppressed IN (0,1)),
    PRIMARY KEY (source_id, kind, local_id)
  ) WITHOUT ROWID, STRICT;
  CREATE TABLE IF NOT EXISTS conversation_equivalences (
    duplicate_conversation_id TEXT PRIMARY KEY
      REFERENCES conversations(id) ON DELETE CASCADE,
    preferred_conversation_id TEXT NOT NULL
      REFERENCES conversations(id) ON DELETE RESTRICT,
    duplicate_source_id TEXT NOT NULL
      REFERENCES corpus_sources(id) ON DELETE CASCADE,
    preferred_source_id TEXT NOT NULL
      REFERENCES corpus_sources(id) ON DELETE RESTRICT,
    basis TEXT NOT NULL CHECK (basis='exact-message-overlap'),
    plan_evidence_sha256 TEXT NOT NULL,
    match_sha256 TEXT NOT NULL,
    established_at TEXT NOT NULL,
    CHECK (duplicate_conversation_id <> preferred_conversation_id),
    CHECK (duplicate_source_id <> preferred_source_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS conversation_equivalences_preferred
    ON conversation_equivalences(preferred_conversation_id,duplicate_conversation_id);
  CREATE TABLE IF NOT EXISTS message_equivalences (
    duplicate_message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    preferred_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
    duplicate_source_id TEXT NOT NULL
      REFERENCES corpus_sources(id) ON DELETE CASCADE,
    preferred_source_id TEXT NOT NULL
      REFERENCES corpus_sources(id) ON DELETE RESTRICT,
    basis TEXT NOT NULL CHECK (basis='exact-message-overlap'),
    plan_evidence_sha256 TEXT NOT NULL,
    match_sha256 TEXT NOT NULL,
    established_at TEXT NOT NULL,
    UNIQUE (preferred_message_id),
    CHECK (duplicate_message_id <> preferred_message_id),
    CHECK (duplicate_source_id <> preferred_source_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS message_equivalences_sources
    ON message_equivalences(duplicate_source_id,preferred_source_id);
  CREATE TABLE IF NOT EXISTS reaction_equivalences (
    duplicate_reaction_id TEXT PRIMARY KEY
      REFERENCES corpus_reaction_facts(id) ON DELETE CASCADE,
    preferred_reaction_id TEXT NOT NULL
      REFERENCES corpus_reaction_facts(id) ON DELETE RESTRICT,
    duplicate_source_id TEXT NOT NULL
      REFERENCES corpus_sources(id) ON DELETE CASCADE,
    preferred_source_id TEXT NOT NULL
      REFERENCES corpus_sources(id) ON DELETE RESTRICT,
    basis TEXT NOT NULL CHECK (basis='exact-message-overlap'),
    plan_evidence_sha256 TEXT NOT NULL,
    match_sha256 TEXT NOT NULL,
    established_at TEXT NOT NULL,
    UNIQUE (preferred_reaction_id),
    CHECK (duplicate_reaction_id <> preferred_reaction_id),
    CHECK (duplicate_source_id <> preferred_source_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS reaction_equivalences_sources
    ON reaction_equivalences(duplicate_source_id,preferred_source_id);
  CREATE TABLE IF NOT EXISTS study_packets (
    sha256 TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL,
    corpus_revision TEXT NOT NULL,
    scope_id TEXT,
    evidence_revision TEXT,
    example_ids_json TEXT,
    evidence_json TEXT,
    created_at TEXT NOT NULL,
    private_path TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS study_packets_scope ON study_packets(scope_id, created_at);
  CREATE TABLE IF NOT EXISTS profiles (
    contact_id TEXT PRIMARY KEY,
    corpus_revision TEXT NOT NULL,
    scope_id TEXT,
    evidence_revision TEXT,
    packet_sha256 TEXT NOT NULL,
    analyzed_at TEXT NOT NULL,
    profile_json TEXT NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS profiles_scope ON profiles(scope_id, applied_at);
  CREATE TABLE IF NOT EXISTS agent_message_handoffs (
    handoff_id TEXT PRIMARY KEY,
    handoff_sha256 TEXT NOT NULL CHECK (length(handoff_sha256)=64),
    contact_id_sha256 TEXT NOT NULL CHECK (length(contact_id_sha256)=64),
    route_candidate_id_sha256 TEXT NOT NULL CHECK (length(route_candidate_id_sha256)=64),
    source_id_sha256 TEXT NOT NULL CHECK (length(source_id_sha256)=64),
    conversation_id_sha256 TEXT NOT NULL CHECK (length(conversation_id_sha256)=64),
    corpus_revision TEXT NOT NULL CHECK (length(corpus_revision)=64),
    source_revision TEXT NOT NULL CHECK (length(source_revision)=64),
    profile_state TEXT NOT NULL CHECK (profile_state IN ('current','missing','stale')),
    profile_evidence_revision TEXT,
    wrench_contract_hash TEXT NOT NULL CHECK (length(wrench_contract_hash)=64),
    route_ref_sha256 TEXT NOT NULL CHECK (length(route_ref_sha256)=64),
    context_ref_sha256 TEXT NOT NULL CHECK (length(context_ref_sha256)=64),
    exact_data_revision_sha256 TEXT NOT NULL CHECK (length(exact_data_revision_sha256)=64),
    latest_message_revision_sha256 TEXT NOT NULL CHECK (length(latest_message_revision_sha256)=64),
    turn_digest_sha256 TEXT NOT NULL CHECK (length(turn_digest_sha256)=64),
    part_count INTEGER NOT NULL CHECK (part_count BETWEEN 1 AND 8),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('prepared','recorded')),
    receipt_sha256 TEXT CHECK (receipt_sha256 IS NULL OR length(receipt_sha256)=64),
    receipt_contract_hash TEXT CHECK (receipt_contract_hash IS NULL OR length(receipt_contract_hash)=64),
    preview_digest_sha256 TEXT CHECK (preview_digest_sha256 IS NULL OR length(preview_digest_sha256)=64),
    run_id_sha256 TEXT CHECK (run_id_sha256 IS NULL OR length(run_id_sha256)=64),
    receipt_state TEXT CHECK (receipt_state IN ('submitted','failed','partial','indeterminate')),
    proven_part_count INTEGER,
    recorded_at TEXT,
    CHECK (
      (state='prepared' AND receipt_sha256 IS NULL AND receipt_contract_hash IS NULL
        AND preview_digest_sha256 IS NULL AND run_id_sha256 IS NULL AND receipt_state IS NULL
        AND proven_part_count IS NULL AND recorded_at IS NULL)
      OR
      (state='recorded' AND receipt_sha256 IS NOT NULL AND receipt_contract_hash IS NOT NULL
        AND preview_digest_sha256 IS NOT NULL AND run_id_sha256 IS NOT NULL
        AND receipt_state IS NOT NULL AND proven_part_count IS NOT NULL AND recorded_at IS NOT NULL)
    ),
    CHECK (
      state='prepared'
      OR (receipt_state='submitted' AND proven_part_count=part_count)
      OR (receipt_state='failed' AND proven_part_count=0)
      OR (receipt_state='partial' AND proven_part_count BETWEEN 1 AND part_count-1)
      OR (receipt_state='indeterminate' AND proven_part_count BETWEEN 0 AND part_count-1)
    )
  ) STRICT;
  CREATE INDEX IF NOT EXISTS agent_message_handoffs_contact
    ON agent_message_handoffs(contact_id_sha256,created_at,handoff_id);
  CREATE TABLE IF NOT EXISTS addressbook_contacts (
    id TEXT PRIMARY KEY,
    private_label TEXT,
    normalized_label TEXT,
    label_basis TEXT CHECK (label_basis IN ('display-name', 'name-parts', 'organization')),
    contacts_revision TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS addressbook_handles (
    contact_id TEXT NOT NULL REFERENCES addressbook_contacts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('email', 'phone')),
    match_id TEXT NOT NULL,
    PRIMARY KEY (contact_id, kind, match_id)
  ) WITHOUT ROWID, STRICT;
  CREATE INDEX IF NOT EXISTS addressbook_handles_lookup
    ON addressbook_handles(kind, match_id, contact_id);
  CREATE TABLE IF NOT EXISTS conversation_contact_scopes (
    conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
    contact_id TEXT NOT NULL REFERENCES addressbook_contacts(id) ON DELETE CASCADE,
    contacts_revision TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS conversation_contact_scopes_lookup
    ON conversation_contact_scopes(contact_id, conversation_id);
  CREATE TABLE IF NOT EXISTS conversation_contact_labels (
    conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
    contact_id TEXT NOT NULL REFERENCES addressbook_contacts(id) ON DELETE CASCADE,
    private_label TEXT NOT NULL,
    normalized_label TEXT NOT NULL,
    label_basis TEXT NOT NULL CHECK (label_basis IN ('display-name', 'name-parts', 'organization')),
    contacts_revision TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS conversation_contact_labels_lookup
    ON conversation_contact_labels(normalized_label, conversation_id);
`;
var SOURCE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS corpus_sources (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('imessage', 'bundle', 'x-archive')),
    kind_v4 TEXT CHECK (kind_v4 IN ('imessage', 'bundle', 'x-archive')),
    provider TEXT NOT NULL,
    network TEXT,
    account_id TEXT,
    external_id TEXT NOT NULL,
    input_revision TEXT NOT NULL,
    revision TEXT NOT NULL,
    generated_at TEXT,
    producer_json TEXT NOT NULL,
    coverage_json TEXT NOT NULL,
    manifest_sha256 TEXT,
    identity_json TEXT NOT NULL,
    warnings_json TEXT NOT NULL,
    ingested_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS conversation_sources (
    conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES corpus_sources(id) ON DELETE RESTRICT,
    external_id TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    UNIQUE (source_id, external_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS conversation_sources_lookup
    ON conversation_sources(source_id, conversation_id);
  CREATE TABLE IF NOT EXISTS message_provenance (
    message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES corpus_sources(id) ON DELETE RESTRICT,
    external_id TEXT NOT NULL,
    reply_to_external_id TEXT,
    attachments_json TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    UNIQUE (source_id, external_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS message_provenance_source
    ON message_provenance(source_id, message_id);
  CREATE TABLE IF NOT EXISTS corpus_reaction_facts (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES corpus_sources(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    target_external_id TEXT NOT NULL,
    conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
    direction TEXT CHECK (direction IN ('incoming','outgoing')),
    body TEXT NOT NULL,
    reacted_at TEXT,
    state TEXT NOT NULL CHECK (state IN ('active','removed')),
    UNIQUE (source_id, external_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS corpus_reaction_facts_source
    ON corpus_reaction_facts(source_id,conversation_id,id);
  CREATE TABLE IF NOT EXISTS corpus_source_records (
    source_id TEXT NOT NULL REFERENCES corpus_sources(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (
      kind IN ('account','participant','reaction','tombstone','excluded-message')
    ),
    external_id TEXT NOT NULL,
    record_json TEXT NOT NULL,
    PRIMARY KEY (source_id, kind, external_id)
  ) WITHOUT ROWID, STRICT;
  CREATE TABLE IF NOT EXISTS corpus_source_suppressions (
    source_id TEXT NOT NULL REFERENCES corpus_sources(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (
      kind IN ('conversation','message','reaction','reaction-timeline','participant','account')
    ),
    local_id TEXT NOT NULL,
    external_id TEXT NOT NULL,
    suppressed_at TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (
      reason IN ('authoritative-absence','tombstone','explicit-exclusion','replacement','reappeared')
    ),
    suppressed INTEGER NOT NULL CHECK (suppressed IN (0,1)),
    PRIMARY KEY (source_id, kind, local_id)
  ) WITHOUT ROWID, STRICT;
  CREATE TABLE IF NOT EXISTS conversation_equivalences (
    duplicate_conversation_id TEXT PRIMARY KEY
      REFERENCES conversations(id) ON DELETE CASCADE,
    preferred_conversation_id TEXT NOT NULL
      REFERENCES conversations(id) ON DELETE RESTRICT,
    duplicate_source_id TEXT NOT NULL
      REFERENCES corpus_sources(id) ON DELETE CASCADE,
    preferred_source_id TEXT NOT NULL
      REFERENCES corpus_sources(id) ON DELETE RESTRICT,
    basis TEXT NOT NULL CHECK (basis='exact-message-overlap'),
    plan_evidence_sha256 TEXT NOT NULL,
    match_sha256 TEXT NOT NULL,
    established_at TEXT NOT NULL,
    CHECK (duplicate_conversation_id <> preferred_conversation_id),
    CHECK (duplicate_source_id <> preferred_source_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS conversation_equivalences_preferred
    ON conversation_equivalences(preferred_conversation_id,duplicate_conversation_id);
  CREATE TABLE IF NOT EXISTS message_equivalences (
    duplicate_message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    preferred_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
    duplicate_source_id TEXT NOT NULL
      REFERENCES corpus_sources(id) ON DELETE CASCADE,
    preferred_source_id TEXT NOT NULL
      REFERENCES corpus_sources(id) ON DELETE RESTRICT,
    basis TEXT NOT NULL CHECK (basis='exact-message-overlap'),
    plan_evidence_sha256 TEXT NOT NULL,
    match_sha256 TEXT NOT NULL,
    established_at TEXT NOT NULL,
    UNIQUE (preferred_message_id),
    CHECK (duplicate_message_id <> preferred_message_id),
    CHECK (duplicate_source_id <> preferred_source_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS message_equivalences_sources
    ON message_equivalences(duplicate_source_id,preferred_source_id);
  CREATE TABLE IF NOT EXISTS reaction_equivalences (
    duplicate_reaction_id TEXT PRIMARY KEY
      REFERENCES corpus_reaction_facts(id) ON DELETE CASCADE,
    preferred_reaction_id TEXT NOT NULL
      REFERENCES corpus_reaction_facts(id) ON DELETE RESTRICT,
    duplicate_source_id TEXT NOT NULL
      REFERENCES corpus_sources(id) ON DELETE CASCADE,
    preferred_source_id TEXT NOT NULL
      REFERENCES corpus_sources(id) ON DELETE RESTRICT,
    basis TEXT NOT NULL CHECK (basis='exact-message-overlap'),
    plan_evidence_sha256 TEXT NOT NULL,
    match_sha256 TEXT NOT NULL,
    established_at TEXT NOT NULL,
    UNIQUE (preferred_reaction_id),
    CHECK (duplicate_reaction_id <> preferred_reaction_id),
    CHECK (duplicate_source_id <> preferred_source_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS reaction_equivalences_sources
    ON reaction_equivalences(duplicate_source_id,preferred_source_id);
`;
var CONTACT_SCOPE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS conversation_contact_scopes (
    conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
    contact_id TEXT NOT NULL REFERENCES addressbook_contacts(id) ON DELETE CASCADE,
    contacts_revision TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS conversation_contact_scopes_lookup
    ON conversation_contact_scopes(contact_id, conversation_id);
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
function stringArray(value, label) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new CliError("invalid-data", `${label} is malformed JSON`, { cause: error });
  }
  if (!Array.isArray(parsed) || parsed.length > 1000 || parsed.some((item) => typeof item !== "string" || Buffer.byteLength(item, "utf8") > 4096)) {
    throw new CliError("invalid-data", `${label} must be a bounded text array`);
  }
  return parsed;
}
function parsedJson(value, label) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new CliError("invalid-data", `${label} is malformed JSON`, { cause: error });
  }
}
function studyExampleIds(value, label) {
  if (!Array.isArray(value) || value.length > 50) {
    throw new CliError("invalid-data", `${label} must contain at most 50 IDs`);
  }
  const result = value.map((item, index) => {
    if (typeof item !== "string" || item.length < 1 || item !== item.trim() || item.includes("\x00") || Buffer.byteLength(item, "utf8") > 1024) {
      throw new CliError("invalid-data", `${label}[${index}] must be a bounded text ID`);
    }
    return item;
  });
  if (new Set(result).size !== result.length) {
    throw new CliError("invalid-data", `${label} must not contain duplicate IDs`);
  }
  return result;
}
function canonicalTimestampOrNull(value, label) {
  if (value === null)
    return null;
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 64) {
    throw new CliError("invalid-data", `${label} must be a canonical ISO timestamp or null`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new CliError("invalid-data", `${label} must be a canonical ISO timestamp or null`);
  }
  return value;
}
function boundedCount(value, label, maximum = 1e7) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new CliError("invalid-data", `${label} must be an integer from 0 through ${maximum}`);
  }
  return value;
}
function studyEvidenceManifest(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CliError("invalid-data", `${label} must be an object`);
  }
  const record = value;
  const keys = [
    "firstMessageAt",
    "lastMessageAt",
    "messageCount",
    "outgoingTextMessages",
    "responseEpisodes",
    "studyExamples",
    "selectionAlgorithm",
    "after",
    "before"
  ];
  const expected = new Set(keys);
  if (Object.keys(record).some((key) => !expected.has(key)) || keys.some((key) => !(key in record))) {
    throw new CliError("invalid-data", `${label} has unsupported or missing fields`);
  }
  if (record.selectionAlgorithm !== "bounded-diverse-response-contexts-v1") {
    throw new CliError("invalid-data", `${label}.selectionAlgorithm must be bounded-diverse-response-contexts-v1`);
  }
  const firstMessageAt = canonicalTimestampOrNull(record.firstMessageAt, `${label}.firstMessageAt`);
  const lastMessageAt = canonicalTimestampOrNull(record.lastMessageAt, `${label}.lastMessageAt`);
  const after = canonicalTimestampOrNull(record.after, `${label}.after`);
  const before = canonicalTimestampOrNull(record.before, `${label}.before`);
  if (firstMessageAt !== null && lastMessageAt !== null && firstMessageAt > lastMessageAt) {
    throw new CliError("invalid-data", `${label}.firstMessageAt must not follow lastMessageAt`);
  }
  if (after !== null && before !== null && after >= before) {
    throw new CliError("invalid-data", `${label}.after must be earlier than before`);
  }
  const messageCount = boundedCount(record.messageCount, `${label}.messageCount`);
  const outgoingTextMessages = boundedCount(record.outgoingTextMessages, `${label}.outgoingTextMessages`);
  if (outgoingTextMessages > messageCount) {
    throw new CliError("invalid-data", `${label}.outgoingTextMessages exceeds messageCount`);
  }
  return Object.freeze({
    firstMessageAt,
    lastMessageAt,
    messageCount,
    outgoingTextMessages,
    responseEpisodes: boundedCount(record.responseEpisodes, `${label}.responseEpisodes`),
    studyExamples: boundedCount(record.studyExamples, `${label}.studyExamples`, 50),
    selectionAlgorithm: "bounded-diverse-response-contexts-v1",
    after,
    before
  });
}
function profileEvidenceManifest(profile) {
  return {
    firstMessageAt: profile.evidence.firstMessageAt,
    lastMessageAt: profile.evidence.lastMessageAt,
    messageCount: profile.evidence.messageCount,
    outgoingTextMessages: profile.evidence.outgoingTextMessages,
    responseEpisodes: profile.evidence.responseEpisodes,
    studyExamples: profile.evidence.studyExamples,
    selectionAlgorithm: profile.evidence.selectionAlgorithm,
    after: profile.evidence.after,
    before: profile.evidence.before
  };
}
function assertProfileEvidenceIds(profile, exampleIds) {
  const references = [
    ...profile.contexts.flatMap(({ evidenceExampleIds }) => evidenceExampleIds),
    ...profile.claims.flatMap(({ supportExampleIds, counterexampleIds }) => [
      ...supportExampleIds,
      ...counterexampleIds
    ])
  ];
  const unknown = references.find((id) => !exampleIds.has(id));
  if (unknown !== undefined) {
    throw new CliError("conflict", `Profile cites study example ${unknown} that is not present in its recorded packet`);
  }
}
var UNBOUNDED_EVIDENCE_WINDOW = Object.freeze({
  after: null,
  before: null
});
function evidenceWindow(value, label) {
  if (value === undefined)
    return UNBOUNDED_EVIDENCE_WINDOW;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CliError("invalid-data", `${label} must contain after and before bounds`);
  }
  const record = value;
  if (Object.keys(record).some((key) => key !== "after" && key !== "before") || !("after" in record) || !("before" in record)) {
    throw new CliError("invalid-data", `${label} must contain only after and before bounds`);
  }
  const after = canonicalTimestampOrNull(record.after, `${label}.after`);
  const before = canonicalTimestampOrNull(record.before, `${label}.before`);
  if (after !== null && before !== null && after >= before) {
    throw new CliError("invalid-data", `${label}.after must be earlier than before`);
  }
  return Object.freeze({ after, before });
}
function personScopeId(addressBookContactId) {
  return `${PERSON_SCOPE_PREFIX}${addressBookContactId}`;
}
var ACTIVE_MESSAGE_EQUIVALENCE_EXCLUSION = `NOT EXISTS (
  SELECT 1 FROM message_equivalences equivalence
  JOIN message_provenance preferred_provenance
    ON preferred_provenance.message_id=equivalence.preferred_message_id
  JOIN messages preferred_message
    ON preferred_message.id=equivalence.preferred_message_id
  WHERE equivalence.duplicate_message_id=message.id
    AND preferred_message.sent_at=message.sent_at
    AND preferred_message.direction=message.direction
    AND preferred_message.body IS message.body
    AND preferred_message.kind=message.kind
    AND preferred_message.attachment_count=message.attachment_count
    AND NOT EXISTS (
      SELECT 1 FROM corpus_source_suppressions preferred_suppression
      WHERE preferred_suppression.source_id=preferred_provenance.source_id
        AND preferred_suppression.local_id=equivalence.preferred_message_id
        AND preferred_suppression.kind IN ('message','reaction','reaction-timeline')
        AND preferred_suppression.suppressed=1
    )
)`;
var ACTIVE_REACTION_EQUIVALENCE_EXCLUSION = `NOT EXISTS (
  SELECT 1 FROM reaction_equivalences equivalence
  JOIN corpus_reaction_facts preferred_reaction
    ON preferred_reaction.id=equivalence.preferred_reaction_id
  JOIN message_provenance duplicate_target
    ON duplicate_target.source_id=reaction.source_id
      AND duplicate_target.external_id=reaction.target_external_id
  JOIN message_provenance preferred_target
    ON preferred_target.source_id=preferred_reaction.source_id
      AND preferred_target.external_id=preferred_reaction.target_external_id
  JOIN message_equivalences target_equivalence
    ON (target_equivalence.duplicate_message_id=duplicate_target.message_id
        AND target_equivalence.preferred_message_id=preferred_target.message_id)
      OR (target_equivalence.duplicate_message_id=preferred_target.message_id
        AND target_equivalence.preferred_message_id=duplicate_target.message_id)
  JOIN messages target_duplicate_message
    ON target_duplicate_message.id=target_equivalence.duplicate_message_id
  JOIN messages target_preferred_message
    ON target_preferred_message.id=target_equivalence.preferred_message_id
  WHERE equivalence.duplicate_reaction_id=reaction.id
    AND preferred_reaction.state='active'
    AND preferred_reaction.body=reaction.body
    AND preferred_reaction.direction IS reaction.direction
    AND target_preferred_message.sent_at=target_duplicate_message.sent_at
    AND target_preferred_message.direction=target_duplicate_message.direction
    AND target_preferred_message.body IS target_duplicate_message.body
    AND target_preferred_message.kind=target_duplicate_message.kind
    AND target_preferred_message.attachment_count=target_duplicate_message.attachment_count
    AND NOT EXISTS (
      SELECT 1 FROM corpus_source_suppressions target_suppression
      WHERE target_suppression.source_id=preferred_target.source_id
        AND target_suppression.local_id=preferred_target.message_id
        AND target_suppression.kind IN ('message','reaction','reaction-timeline')
        AND target_suppression.suppressed=1
    )
    AND NOT EXISTS (
      SELECT 1 FROM corpus_source_suppressions preferred_suppression
      WHERE preferred_suppression.source_id=preferred_reaction.source_id
        AND preferred_suppression.kind='reaction'
        AND preferred_suppression.local_id=preferred_reaction.id
        AND preferred_suppression.suppressed=1
    )
)`;
function canonicalConversationId(database, conversationId) {
  return get(database, `
    SELECT preferred_conversation_id FROM conversation_equivalences
    WHERE duplicate_conversation_id=?
  `, conversationId)?.preferred_conversation_id ?? conversationId;
}
function equivalentConversationIds(database, conversationId) {
  const canonicalId = canonicalConversationId(database, conversationId);
  const rows = all(database, `
    SELECT ? AS id
    UNION ALL
    SELECT duplicate_conversation_id AS id FROM conversation_equivalences
    WHERE preferred_conversation_id=?
    ORDER BY id
  `, canonicalId, canonicalId);
  if (rows.length > 1e4) {
    throw new CliError("invalid-data", `Conversation equivalence group ${canonicalId} is oversized`);
  }
  return Object.freeze(rows.map((row) => row.id));
}
function idPlaceholders(ids) {
  if (ids.length < 1 || ids.length > 1e4) {
    throw new CliError("internal", "Analysis scope has an invalid conversation count");
  }
  return ids.map(() => "?").join(",");
}
function activeConversationIds(database, ids) {
  const placeholders = idPlaceholders(ids);
  return Object.freeze(all(database, `
    SELECT conversation.id
    FROM conversations conversation
    JOIN conversation_sources ownership ON ownership.conversation_id=conversation.id
    WHERE conversation.id IN (${placeholders})
      AND NOT EXISTS (
        SELECT 1 FROM corpus_source_suppressions suppression
        WHERE suppression.source_id=ownership.source_id
          AND suppression.kind='conversation'
          AND suppression.local_id=conversation.id
          AND suppression.suppressed=1
      )
    ORDER BY conversation.id
  `, ...ids).map((row) => row.id));
}
function tableExists(database, name) {
  return get(database, "SELECT 1 AS value FROM sqlite_master WHERE type='table' AND name=?", name) !== null;
}
function tableColumns3(database, name) {
  return new Set(all(database, `PRAGMA table_info(${name})`).map((row) => row.name));
}
function userVersion(database) {
  return get(database, "PRAGMA user_version")?.user_version ?? 0;
}
function personScope(database, addressBookContactId) {
  const rows = all(database, `
    SELECT association.conversation_id
    FROM conversation_contact_scopes association
    JOIN conversations conversation ON conversation.id=association.conversation_id
    WHERE association.contact_id=? AND conversation.is_group=0
    ORDER BY association.conversation_id
  `, addressBookContactId);
  const expanded = new Set;
  for (const row of rows) {
    for (const id of equivalentConversationIds(database, row.conversation_id))
      expanded.add(id);
  }
  if (expanded.size === 0)
    return null;
  const conversationIds = activeConversationIds(database, [...expanded]);
  if (conversationIds.length === 0)
    return null;
  return Object.freeze({
    id: personScopeId(addressBookContactId),
    kind: "person",
    addressBookContactId,
    conversationIds
  });
}
function analysisScope(database, contactId) {
  if (contactId.startsWith(PERSON_SCOPE_PREFIX)) {
    const addressBookContactId = contactId.slice(PERSON_SCOPE_PREFIX.length);
    if (/^[a-f0-9]{64}$/u.test(addressBookContactId)) {
      return personScope(database, addressBookContactId);
    }
  }
  const conversation = get(database, "SELECT id FROM conversations WHERE id=?", contactId);
  if (conversation === null)
    return null;
  const canonicalId = canonicalConversationId(database, contactId);
  const conversationIds = activeConversationIds(database, equivalentConversationIds(database, canonicalId));
  if (conversationIds.length === 0)
    return null;
  const placeholders = idPlaceholders(conversationIds);
  const matches = all(database, `
    SELECT DISTINCT contact_id FROM conversation_contact_scopes
    WHERE conversation_id IN (${placeholders}) ORDER BY contact_id
  `, ...conversationIds);
  if (matches.length > 1) {
    throw new CliError("invalid-data", `Equivalent conversation ${canonicalId} spans multiple contacts`);
  }
  if (matches[0] !== undefined)
    return personScope(database, matches[0].contact_id);
  return Object.freeze({
    id: canonicalId,
    kind: "conversation",
    addressBookContactId: null,
    conversationIds
  });
}
function routeCandidatesForScope(database, scope, privateDetails) {
  const placeholders = idPlaceholders(scope.conversationIds);
  const rows = all(database, `
    SELECT conversation.id AS conversation_id,conversation.service,conversation.is_group,
      source.id AS source_id,coalesce(source.kind_v4,source.kind) AS source_kind,
      source.provider,source.network,source.account_id,
      source.external_id AS source_external_id,source.revision AS source_revision,
      ownership.external_id AS conversation_external_id
    FROM conversations conversation
    JOIN conversation_sources ownership ON ownership.conversation_id=conversation.id
    JOIN corpus_sources source ON source.id=ownership.source_id
    WHERE conversation.id IN (${placeholders})
      AND NOT EXISTS (
        SELECT 1 FROM corpus_source_suppressions suppression
        WHERE suppression.source_id=ownership.source_id
          AND suppression.kind='conversation'
          AND suppression.local_id=conversation.id
          AND suppression.suppressed=1
      )
    ORDER BY source.provider,source.network,source.id,conversation.id
  `, ...scope.conversationIds);
  if (rows.length > 1e4)
    throw new CliError("invalid-data", "Contact has too many source conversations");
  return Object.freeze(rows.map((row) => {
    const archive = row.source_kind === "x-archive";
    const group = row.is_group === 1;
    return Object.freeze({
      schemaVersion: 1,
      format: "message-like-me.source-conversation-route",
      id: agentMessageRouteCandidateId(row.source_id, row.conversation_id),
      contactId: scope.id,
      sourceId: row.source_id,
      conversationId: row.conversation_id,
      sourceKind: row.source_kind,
      provider: row.provider,
      network: row.network,
      service: row.service,
      group,
      sourceRevision: row.source_revision,
      actionability: Object.freeze(archive ? { state: "evidence-only", reason: "archive-source" } : group ? { state: "evidence-only", reason: "group-conversation" } : {
        state: "wrench-binding-eligible",
        reason: "requires-exact-wrench-binding"
      }),
      privateBinding: privateDetails ? Object.freeze({
        sourceAccountId: row.account_id,
        sourceExternalId: row.source_external_id,
        conversationExternalId: row.conversation_external_id
      }) : null
    });
  }));
}
function messageRowsForScope(database, scope, exactConversationId, window = UNBOUNDED_EVIDENCE_WINDOW) {
  if (exactConversationId !== undefined) {
    return all(database, `
      SELECT message.* FROM messages message
      JOIN message_provenance provenance ON provenance.message_id=message.id
      WHERE message.conversation_id=?
        AND (? IS NULL OR message.sent_at>=?) AND (? IS NULL OR message.sent_at<?)
        AND NOT EXISTS (
          SELECT 1 FROM corpus_source_suppressions suppression
          WHERE suppression.source_id=provenance.source_id
            AND suppression.local_id=message.id
            AND suppression.kind IN ('message','reaction','reaction-timeline')
            AND suppression.suppressed=1
        ) AND ${ACTIVE_MESSAGE_EQUIVALENCE_EXCLUSION}
      ORDER BY message.sent_at,message.source_row_id,message.id
    `, exactConversationId, window.after, window.after, window.before, window.before);
  }
  const placeholders = idPlaceholders(scope.conversationIds);
  return all(database, `
    SELECT message.* FROM messages message
    JOIN message_provenance provenance ON provenance.message_id=message.id
    WHERE message.conversation_id IN (${placeholders})
      AND (? IS NULL OR message.sent_at>=?) AND (? IS NULL OR message.sent_at<?)
      AND NOT EXISTS (
        SELECT 1 FROM corpus_source_suppressions suppression
        WHERE suppression.source_id=provenance.source_id
          AND suppression.local_id=message.id
          AND suppression.kind IN ('message','reaction','reaction-timeline')
          AND suppression.suppressed=1
      ) AND ${ACTIVE_MESSAGE_EQUIVALENCE_EXCLUSION}
    ORDER BY message.sent_at,message.source_row_id,message.id
  `, ...scope.conversationIds, window.after, window.after, window.before, window.before);
}
function corpusMessage(row) {
  return {
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
    replyState: row.reply_state,
    editedAt: row.edited_at,
    retractedAt: row.retracted_at,
    service: row.service,
    attachmentCount: row.attachment_count
  };
}
function reactionFactsForScope(database, scope, window = UNBOUNDED_EVIDENCE_WINDOW) {
  const select = `SELECT reaction.id,reaction.external_id,reaction.target_external_id,
    reaction.conversation_id,reaction.direction,reaction.body,reaction.reacted_at,reaction.state
    FROM corpus_reaction_facts reaction`;
  const suppression = `NOT EXISTS (
    SELECT 1 FROM corpus_source_suppressions suppression
    WHERE suppression.source_id=reaction.source_id
      AND suppression.kind='reaction'
      AND suppression.local_id=reaction.id
      AND suppression.suppressed=1
  )`;
  const placeholders = idPlaceholders(scope.conversationIds);
  const rows = all(database, `${select}
    WHERE reaction.conversation_id IN (${placeholders}) AND reaction.state='active'
      AND ${suppression} AND ${ACTIVE_REACTION_EQUIVALENCE_EXCLUSION}
    ORDER BY reaction.reacted_at IS NULL,reaction.reacted_at,reaction.id`, ...scope.conversationIds);
  return rows.filter((row) => row.reacted_at === null ? window.after === null && window.before === null : (window.after === null || row.reacted_at >= window.after) && (window.before === null || row.reacted_at < window.before)).map((row) => ({
    id: row.id,
    externalId: row.external_id,
    targetExternalId: row.target_external_id,
    conversationId: row.conversation_id,
    direction: row.direction,
    body: row.body,
    reactedAt: row.reacted_at,
    state: row.state
  }));
}
function scopeEvidenceRevision(database, scope, exactConversationId, window = UNBOUNDED_EVIDENCE_WINDOW) {
  const conversationIds = exactConversationId === undefined ? scope.conversationIds : Object.freeze([exactConversationId]);
  const messages = messageRowsForScope(database, scope, exactConversationId, window).map(corpusMessage);
  const reactions = reactionFactsForScope(database, scope, window);
  return sha256(canonicalJson(reactions.length > 0 ? {
    schemaVersion: 3,
    scopeId: scope.id,
    conversationIds,
    evidenceWindow: window,
    messages,
    reactions
  } : window.after === null && window.before === null ? {
    schemaVersion: 1,
    scopeId: scope.id,
    conversationIds,
    messages
  } : {
    schemaVersion: 2,
    scopeId: scope.id,
    evidenceWindow: window,
    messages
  }));
}
function storedProfileIsCurrent(database, scope, evidenceRevision, profile) {
  const window = profile.schemaVersion === 2 ? Object.freeze({
    after: profile.evidence.after,
    before: profile.evidence.before
  }) : UNBOUNDED_EVIDENCE_WINDOW;
  if (profile.schemaVersion === 2 && profile.evidence.evidenceRevision !== evidenceRevision)
    return false;
  return evidenceRevision === scopeEvidenceRevision(database, scope, undefined, window);
}
function scopeMessageCounts(database, scope) {
  const select = `SELECT min(message.sent_at) AS first_message_at,
    max(message.sent_at) AS last_message_at,count(message.id) AS message_count,
    coalesce(sum(CASE WHEN message.direction='incoming' THEN 1 ELSE 0 END),0) AS incoming_count,
    coalesce(sum(CASE WHEN message.direction='outgoing' THEN 1 ELSE 0 END),0) AS outgoing_count`;
  const placeholders = idPlaceholders(scope.conversationIds);
  const row = get(database, `${select}
    FROM messages message
    JOIN message_provenance provenance ON provenance.message_id=message.id
    WHERE message.conversation_id IN (${placeholders}) AND NOT EXISTS (
      SELECT 1 FROM corpus_source_suppressions suppression
      WHERE suppression.source_id=provenance.source_id
        AND suppression.local_id=message.id
        AND suppression.kind IN ('message','reaction','reaction-timeline')
        AND suppression.suppressed=1
    ) AND ${ACTIVE_MESSAGE_EQUIVALENCE_EXCLUSION}`, ...scope.conversationIds);
  return {
    firstMessageAt: row?.first_message_at ?? null,
    lastMessageAt: row?.last_message_at ?? null,
    messageCount: row?.message_count ?? 0,
    incomingCount: row?.incoming_count ?? 0,
    outgoingCount: row?.outgoing_count ?? 0
  };
}
function addColumn(database, table, definition) {
  const name = definition.split(/\s+/u)[0];
  if (name !== undefined && !tableColumns3(database, table).has(name)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}
function migrateStoreV4Columns(database) {
  addColumn(database, "messages", "reply_state TEXT NOT NULL DEFAULT 'none' CHECK (reply_state IN ('explicit','none','unavailable'))");
  database.exec(`
    UPDATE messages SET reply_state=CASE
      WHEN reply_to_source_guid IS NULL THEN 'none' ELSE 'explicit' END
    WHERE reply_state<>'unavailable'
  `);
  addColumn(database, "corpus_sources", "kind_v4 TEXT CHECK (kind_v4 IN ('imessage','bundle','x-archive'))");
  database.exec("UPDATE corpus_sources SET kind_v4=kind WHERE kind_v4 IS NULL");
}
function backfillLegacyEvidence(database) {
  const currentCorpusRevision = scalarText(database, "corpus_revision");
  for (const table of ["study_packets", "profiles"]) {
    const rows = all(database, `
      SELECT rowid,contact_id,corpus_revision,scope_id,evidence_revision
      FROM ${table}
      WHERE scope_id IS NULL OR evidence_revision IS NULL
      ORDER BY rowid
    `);
    const update = database.query(`
      UPDATE ${table} SET scope_id=?,evidence_revision=? WHERE rowid=?
    `);
    for (const row of rows) {
      const scope = analysisScope(database, row.contact_id);
      if (scope === null)
        continue;
      const exactConversation = get(database, `
        SELECT 1 AS value FROM conversations WHERE id=?
      `, row.contact_id) === null ? undefined : row.contact_id;
      const evidenceRevision = row.evidence_revision ?? (currentCorpusRevision === row.corpus_revision ? scopeEvidenceRevision(database, scope, exactConversation) : null);
      update.run(row.scope_id ?? scope.id, evidenceRevision, row.rowid);
    }
  }
}
function backfillLegacySource(database) {
  const conversations = get(database, "SELECT count(*) AS value FROM conversations")?.value ?? 0;
  const assigned = get(database, "SELECT count(*) AS value FROM conversation_sources")?.value ?? 0;
  if (assigned !== 0 && assigned !== conversations) {
    throw new CliError("invalid-data", "Local store has partially assigned corpus source ownership");
  }
  if (conversations === 0 || assigned === conversations)
    return;
  const revision = scalarText(database, "corpus_revision");
  if (revision === null || !/^[a-f0-9]{64}$/u.test(revision)) {
    throw new CliError("invalid-data", "Legacy local store has no valid corpus revision");
  }
  const identity = scalarText(database, "source_identity") ?? canonicalJson({ migrated: true });
  const warnings = scalarText(database, "warnings") ?? canonicalJson([]);
  const ingestedAt = scalarText(database, "ingested_at") ?? "1970-01-01T00:00:00.000Z";
  database.query(`
    INSERT INTO corpus_sources(
      id,kind,kind_v4,provider,network,account_id,external_id,input_revision,revision,generated_at,
      producer_json,coverage_json,manifest_sha256,identity_json,warnings_json,ingested_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(IMESSAGE_SOURCE_ID, "imessage", "imessage", "apple", null, null, "local-imessage", revision, revision, null, canonicalJson({ id: "message-like-me", version: "legacy" }), canonicalJson({ history: "complete-current-local", observedFrom: null, observedTo: null }), null, identity, warnings, ingestedAt);
  database.exec(`
    INSERT INTO conversation_sources(conversation_id,source_id,external_id,metadata_json)
    SELECT id,'${IMESSAGE_SOURCE_ID}',source_key,'{}' FROM conversations;
  `);
  const rows = all(database, `
    SELECT id,source_guid,reply_to_source_guid,attachment_count
    FROM messages ORDER BY id
  `);
  const insert = database.query(`
    INSERT INTO message_provenance(
      message_id,source_id,external_id,reply_to_external_id,attachments_json,metadata_json
    ) VALUES (?,?,?,?,?,?)
  `);
  for (const row of rows) {
    insert.run(row.id, IMESSAGE_SOURCE_ID, row.source_guid, row.reply_to_source_guid, canonicalJson({ count: row.attachment_count, detailsAvailable: false }), canonicalJson({ migrated: true }));
  }
}
function initializeStoreSchema(database) {
  const existingStore = tableExists(database, "metadata");
  const version = userVersion(database);
  if (version > STORE_SCHEMA_VERSION) {
    throw new CliError("invalid-data", `Local store schema ${version} is newer than supported schema ${STORE_SCHEMA_VERSION}`);
  }
  if (!existingStore) {
    database.exec(SCHEMA);
    database.exec(`PRAGMA user_version=${STORE_SCHEMA_VERSION}`);
    return;
  }
  for (const table of ["study_packets", "profiles"]) {
    if (!tableExists(database, table)) {
      throw new CliError("invalid-data", `Local store is missing required table ${table}`);
    }
  }
  database.exec(SOURCE_SCHEMA);
  transaction(database, () => {
    migrateStoreV4Columns(database);
    database.exec(CONTACT_SCOPE_SCHEMA);
    database.exec(`
      INSERT OR IGNORE INTO conversation_contact_scopes(
        conversation_id,contact_id,contacts_revision
      )
      SELECT conversation_id,contact_id,contacts_revision
      FROM conversation_contact_labels
    `);
    addColumn(database, "study_packets", "scope_id TEXT");
    addColumn(database, "study_packets", "evidence_revision TEXT");
    addColumn(database, "study_packets", "example_ids_json TEXT");
    addColumn(database, "study_packets", "evidence_json TEXT");
    addColumn(database, "profiles", "scope_id TEXT");
    addColumn(database, "profiles", "evidence_revision TEXT");
    backfillLegacySource(database);
    backfillLegacyEvidence(database);
    database.exec(`PRAGMA user_version=${STORE_SCHEMA_VERSION}`);
  });
  database.exec(SCHEMA);
}
function rebuildConversationLabels(database, hmacKey3) {
  database.exec("DELETE FROM conversation_contact_labels; DELETE FROM conversation_contact_scopes;");
  const contacts = new Map(all(database, `SELECT id,private_label,normalized_label,label_basis,contacts_revision
    FROM addressbook_contacts ORDER BY id`).map((row) => [row.id, row]));
  const owners = new Map;
  for (const row of all(database, `SELECT contact_id,kind,match_id FROM addressbook_handles
    ORDER BY kind,match_id,contact_id`)) {
    const key = `${row.kind}\x00${row.match_id}`;
    const values = owners.get(key) ?? new Set;
    values.add(row.contact_id);
    owners.set(key, values);
  }
  const conversations = all(database, `
    SELECT conversation.id,conversation.private_participants_json
    FROM conversations conversation
    JOIN conversation_sources ownership ON ownership.conversation_id=conversation.id
    WHERE conversation.is_group=0 AND NOT EXISTS (
      SELECT 1 FROM corpus_source_suppressions suppression
      WHERE suppression.source_id=ownership.source_id
        AND suppression.kind='conversation'
        AND suppression.local_id=conversation.id
        AND suppression.suppressed=1
    )
    ORDER BY conversation.id
  `);
  const insertScope = database.query(`INSERT INTO conversation_contact_scopes(
    conversation_id,contact_id,contacts_revision
  ) VALUES (?,?,?)`);
  const insertLabel = database.query(`INSERT INTO conversation_contact_labels(
    conversation_id,contact_id,private_label,normalized_label,label_basis,contacts_revision
  ) VALUES (?,?,?,?,?,?)`);
  let eligibleConversations = 0;
  let matched = 0;
  let enriched = 0;
  let unmatched = 0;
  let ambiguous = 0;
  let matchedWithoutLabel = 0;
  for (const conversation of conversations) {
    const normalizedHandles = stringArray(conversation.private_participants_json, `conversation ${conversation.id} participants`).map(normalizeContactHandle).filter((handle) => handle !== null);
    if (normalizedHandles.length > 0 && owners.size > 0 && hmacKey3 === undefined) {
      throw new CliError("internal", "The installation key is required to rebuild contact labels");
    }
    const keys = hmacKey3 === undefined ? new Set : new Set(normalizedHandles.map((handle) => `${handle.kind}\x00${contactHandleMatchId(hmacKey3, handle)}`));
    if (keys.size > 0)
      eligibleConversations += 1;
    const candidates = new Set;
    for (const key of keys)
      for (const contactId2 of owners.get(key) ?? [])
        candidates.add(contactId2);
    if (candidates.size === 0) {
      unmatched += 1;
      continue;
    }
    if (candidates.size > 1) {
      ambiguous += 1;
      continue;
    }
    matched += 1;
    const contactId = [...candidates][0];
    const contact = contacts.get(contactId);
    if (contact === undefined) {
      throw new CliError("invalid-data", "A contact handle references an unknown contact");
    }
    insertScope.run(conversation.id, contact.id, contact.contacts_revision);
    if (contact.private_label === null || contact.normalized_label === null || contact.label_basis === null) {
      matchedWithoutLabel += 1;
      continue;
    }
    insertLabel.run(conversation.id, contact.id, contact.private_label, contact.normalized_label, contact.label_basis, contact.contacts_revision);
    enriched += 1;
  }
  const conflicting = get(database, `
    SELECT equivalence.preferred_conversation_id
    FROM conversation_equivalences equivalence
    JOIN conversation_contact_scopes duplicate_scope
      ON duplicate_scope.conversation_id=equivalence.duplicate_conversation_id
    JOIN conversation_contact_scopes preferred_scope
      ON preferred_scope.conversation_id=equivalence.preferred_conversation_id
    WHERE duplicate_scope.contact_id<>preferred_scope.contact_id
    ORDER BY equivalence.preferred_conversation_id LIMIT 1
  `);
  if (conflicting !== null) {
    throw new CliError("conflict", `Equivalent conversation ${conflicting.preferred_conversation_id} resolves to multiple contacts`);
  }
  return {
    directConversations: conversations.length,
    eligibleConversations,
    matched,
    enriched,
    unmatched,
    ambiguous,
    matchedWithoutLabel
  };
}
function assertSafeDatabaseFileIfPresent(path) {
  const existing = (() => {
    try {
      return lstatSync3(path);
    } catch (error) {
      if (error.code === "ENOENT")
        return null;
      throw error;
    }
  })();
  if (existing === null)
    return;
  if (existing.isSymbolicLink() || !existing.isFile()) {
    throw new CliError("unsafe-path", `${path} must be a physical regular file`);
  }
  if (typeof process.getuid === "function" && existing.uid !== process.getuid()) {
    throw new CliError("unsafe-path", `${path} is not owned by the current user`);
  }
}
function hardenDatabaseFiles(path) {
  for (const [candidate, required] of [
    [path, true],
    [`${path}-wal`, false],
    [`${path}-shm`, false]
  ]) {
    let descriptor;
    try {
      descriptor = openSync(candidate, fsConstants6.O_RDONLY | fsConstants6.O_NOFOLLOW);
    } catch (error) {
      const code = error.code;
      if (!required && code === "ENOENT")
        continue;
      if (code === "ELOOP") {
        throw new CliError("unsafe-path", `${candidate} must not be a symbolic link`, { cause: error });
      }
      throw error;
    }
    try {
      const status = fstatSync(descriptor);
      if (!status.isFile()) {
        throw new CliError("unsafe-path", `${candidate} must be a physical regular file`);
      }
      if (typeof process.getuid === "function" && status.uid !== process.getuid()) {
        throw new CliError("unsafe-path", `${candidate} is not owned by the current user`);
      }
      fchmodSync(descriptor, 384);
    } finally {
      closeSync(descriptor);
    }
  }
}
function globalCorpusRevision(database) {
  const sources = all(database, `SELECT id,coalesce(kind_v4,kind) AS kind,input_revision,revision
    FROM corpus_sources ORDER BY id`);
  if (sources.length === 0)
    return null;
  if (sources.length === 1 && sources[0].id === IMESSAGE_SOURCE_ID && sources[0].kind === "imessage")
    return sources[0].input_revision;
  return sha256(canonicalJson({
    schemaVersion: 1,
    sources: sources.map(({ id, kind, revision }) => ({ id, kind, revision }))
  }));
}
function sourceStateRevision(database, sourceId) {
  const hash = createHash4("sha256");
  hash.update("message-like-me\x00stored-source-state-v1\x00", "utf8");
  const append = (kind, row) => {
    const encoded = canonicalJson(row);
    hash.update(`${kind.length}:${kind}${encoded.length}:`, "utf8").update(encoded, "utf8");
  };
  const source = get(database, `
    SELECT coalesce(kind_v4,kind) AS kind,provider,network,account_id,external_id,producer_json,
      coverage_json,warnings_json
    FROM corpus_sources WHERE id=?
  `, sourceId);
  if (source === null)
    throw new CliError("internal", `Missing corpus source ${sourceId}`);
  append("source", source);
  for (const row of database.query(`
    SELECT conversation.id,conversation.source_key,conversation.private_label,
      conversation.service,conversation.participant_count,
      conversation.participant_ids_json,conversation.private_participants_json,
      conversation.is_group
    FROM conversation_sources ownership
    JOIN conversations conversation ON conversation.id=ownership.conversation_id
    WHERE ownership.source_id=?
    ORDER BY ownership.external_id,conversation.id
  `).iterate(sourceId))
    append("conversation", row);
  for (const row of database.query(`
    SELECT message.id,message.source_row_id,message.source_guid,message.conversation_id,
      message.sent_at,message.direction,message.body,message.body_source,message.kind,
      message.reply_to_source_guid,message.reply_state,
      message.edited_at,message.retracted_at,message.service,
      message.attachment_count,provenance.external_id,
      provenance.reply_to_external_id,provenance.attachments_json
    FROM message_provenance provenance
    JOIN messages message ON message.id=provenance.message_id
    WHERE provenance.source_id=?
    ORDER BY provenance.external_id,message.id
  `).iterate(sourceId))
    append("message", row);
  for (const row of database.query(`
    SELECT id,external_id,target_external_id,conversation_id,direction,body,reacted_at,state
    FROM corpus_reaction_facts WHERE source_id=? ORDER BY external_id,id
  `).iterate(sourceId))
    append("reaction-fact", row);
  for (const row of database.query(`
    SELECT kind,local_id,external_id,reason FROM corpus_source_suppressions
    WHERE source_id=? AND suppressed=1 ORDER BY kind,local_id
  `).iterate(sourceId))
    append("suppression", row);
  for (const row of database.query(`
    SELECT duplicate_conversation_id,preferred_conversation_id,basis,
      plan_evidence_sha256,match_sha256
    FROM conversation_equivalences WHERE duplicate_source_id=?
    ORDER BY duplicate_conversation_id
  `).iterate(sourceId))
    append("conversation-equivalence", row);
  for (const row of database.query(`
    SELECT duplicate_message_id,preferred_message_id,basis,
      plan_evidence_sha256,match_sha256
    FROM message_equivalences WHERE duplicate_source_id=?
    ORDER BY duplicate_message_id
  `).iterate(sourceId))
    append("message-equivalence", row);
  for (const row of database.query(`
    SELECT duplicate_reaction_id,preferred_reaction_id,duplicate_source_id,
      preferred_source_id,basis,plan_evidence_sha256,match_sha256
    FROM reaction_equivalences
    WHERE duplicate_source_id=? OR preferred_source_id=?
    ORDER BY duplicate_reaction_id
  `).iterate(sourceId, sourceId))
    append("reaction-equivalence", row);
  return hash.digest("hex");
}
function compareCodeUnits2(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
function storedProviderSortKey(row) {
  const parsed = parsedJson(row.metadata_json, `Message ${row.id} provenance`);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    return null;
  const record = parsed;
  const value = "providerSortKey" in record ? record.providerSortKey : record.sortKey;
  return typeof value === "string" ? value : null;
}
function rerankBundleMessages(database, sourceId) {
  const rows = all(database, `
    SELECT message.id,message.conversation_id,message.sent_at,message.kind,
      provenance.external_id,provenance.metadata_json
    FROM message_provenance provenance
    JOIN messages message ON message.id=provenance.message_id
    WHERE provenance.source_id=?
    ORDER BY message.conversation_id,message.id
  `, sourceId);
  const byConversation = new Map;
  for (const value of rows) {
    const row = Object.freeze({ ...value, provider_sort_key: storedProviderSortKey(value) });
    const values = byConversation.get(row.conversation_id) ?? [];
    values.push(row);
    byConversation.set(row.conversation_id, values);
  }
  const update = database.query("UPDATE messages SET source_row_id=? WHERE id=?");
  for (const values of byConversation.values()) {
    for (const [index, row] of values.entries())
      update.run(-(index + 1), row.id);
    values.sort((left, right) => {
      const leftReaction = left.kind === "reaction";
      const rightReaction = right.kind === "reaction";
      if (leftReaction !== rightReaction)
        return leftReaction ? 1 : -1;
      if (!leftReaction) {
        const sort = compareCodeUnits2(left.provider_sort_key ?? left.external_id, right.provider_sort_key ?? right.external_id);
        if (sort !== 0)
          return sort;
      }
      return compareCodeUnits2(left.sent_at, right.sent_at) || compareCodeUnits2(left.external_id, right.external_id) || compareCodeUnits2(left.id, right.id);
    });
    for (const [index, row] of values.entries())
      update.run(index + 1, row.id);
  }
}
function setCorpusRevision(database) {
  const revision = globalCorpusRevision(database);
  if (revision === null) {
    database.query("DELETE FROM metadata WHERE key='corpus_revision'").run();
    return null;
  }
  database.query(`
    INSERT INTO metadata(key,value) VALUES ('corpus_revision',?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `).run(revision);
  return revision;
}
function validSourceDescriptor(source) {
  if (source.id !== IMESSAGE_SOURCE_ID && !/^source_[a-f0-9]{64}$/u.test(source.id) || source.kind !== "imessage" && source.kind !== "bundle" && source.kind !== "x-archive" || source.provider.length < 1 || Buffer.byteLength(source.provider, "utf8") > 256 || !/^[a-f0-9]{64}$/u.test(source.revision) || source.externalId.length < 1 || Buffer.byteLength(source.externalId, "utf8") > 4096 || source.warnings.length > 130)
    throw new CliError("invalid-data", `Corpus source ${source.id} is invalid`);
  canonicalTimestampOrNull(source.generatedAt, `Corpus source ${source.id} generatedAt`);
  if (source.kind !== "imessage" && source.generatedAt === null) {
    throw new CliError("invalid-data", `${source.kind} source ${source.id} requires generatedAt`);
  }
  canonicalTimestampOrNull(source.coverage.observedFrom, `Corpus source ${source.id} observedFrom`);
  canonicalTimestampOrNull(source.coverage.observedTo, `Corpus source ${source.id} observedTo`);
  if (source.coverage.observedFrom !== null && source.coverage.observedTo !== null && source.coverage.observedFrom > source.coverage.observedTo)
    throw new CliError("invalid-data", `Corpus source ${source.id} has invalid coverage bounds`);
  if (source.coverage.history !== "complete-current-local" && source.coverage.history !== "bounded" && source.coverage.history !== "unknown")
    throw new CliError("invalid-data", `Corpus source ${source.id} has invalid history coverage`);
  if (source.coverage.kind !== undefined && (source.coverage.kind.length < 1 || Buffer.byteLength(source.coverage.kind, "utf8") > 128 || /\p{Cc}/u.test(source.coverage.kind)) || source.coverage.reason !== undefined && source.coverage.reason !== null && (source.coverage.reason.length < 1 || Buffer.byteLength(source.coverage.reason, "utf8") > 128 || /\p{Cc}/u.test(source.coverage.reason)))
    throw new CliError("invalid-data", `Corpus source ${source.id} has invalid coverage metadata`);
  if (source.manifestSha256 !== null && !/^[a-f0-9]{64}$/u.test(source.manifestSha256))
    throw new CliError("invalid-data", `Corpus source ${source.id} has an invalid manifest digest`);
  if (source.producer.id.length < 1 || source.producer.version.length < 1 || Buffer.byteLength(source.producer.id, "utf8") > 256 || Buffer.byteLength(source.producer.version, "utf8") > 256)
    throw new CliError("invalid-data", `Corpus source ${source.id} has invalid producer identity`);
  for (const warning of source.warnings) {
    if (Buffer.byteLength(warning, "utf8") > 1024 || warning.includes("\x00")) {
      throw new CliError("invalid-data", `Corpus source ${source.id} has an invalid warning`);
    }
  }
}
function validateSourceSnapshot(snapshot) {
  validSourceDescriptor(snapshot.source);
  if (snapshot.conversations.length > 2000000 || snapshot.messages.length > 2000000 || (snapshot.reactionFacts?.length ?? 0) > 2000000 || snapshot.conversationProvenance.length !== snapshot.conversations.length || snapshot.messageProvenance.length !== snapshot.messages.length)
    throw new CliError("invalid-data", `Corpus source ${snapshot.source.id} exceeds its result bounds`);
  const conversationIds = new Set(snapshot.conversations.map(({ id }) => id));
  if (conversationIds.size !== snapshot.conversations.length) {
    throw new CliError("invalid-data", `Corpus source ${snapshot.source.id} repeats conversation IDs`);
  }
  const conversationProvenance = new Map(snapshot.conversationProvenance.map((value) => [value.conversationId, value]));
  if (conversationProvenance.size !== snapshot.conversationProvenance.length || [...conversationIds].some((id) => !conversationProvenance.has(id)))
    throw new CliError("invalid-data", `Corpus source ${snapshot.source.id} has invalid conversation provenance`);
  const externalConversations = new Set;
  for (const provenance of snapshot.conversationProvenance) {
    if (provenance.externalId.length < 1 || Buffer.byteLength(provenance.externalId, "utf8") > 4096 || externalConversations.has(provenance.externalId))
      throw new CliError("invalid-data", `Corpus source ${snapshot.source.id} has invalid external conversation IDs`);
    externalConversations.add(provenance.externalId);
  }
  const messageIds = new Set(snapshot.messages.map(({ id }) => id));
  const messagesById = new Map(snapshot.messages.map((message) => [message.id, message]));
  if (messageIds.size !== snapshot.messages.length) {
    throw new CliError("invalid-data", `Corpus source ${snapshot.source.id} repeats message IDs`);
  }
  const messageRows2 = new Set;
  for (const message of snapshot.messages) {
    if (!conversationIds.has(message.conversationId)) {
      throw new CliError("invalid-data", `Message ${message.id} references an unknown conversation`);
    }
    const rowCoordinate = `${message.conversationId}\x00${message.sourceRowId}`;
    if (!Number.isSafeInteger(message.sourceRowId) || message.sourceRowId < 1 || messageRows2.has(rowCoordinate))
      throw new CliError("invalid-data", `Message ${message.id} has an invalid source row coordinate`);
    messageRows2.add(rowCoordinate);
    if (message.replyState === "explicit" !== (message.replyToSourceGuid !== null) || message.replyState !== "explicit" && message.replyState !== "none" && message.replyState !== "unavailable")
      throw new CliError("invalid-data", `Message ${message.id} has inconsistent reply observability`);
  }
  const messageProvenance = new Map(snapshot.messageProvenance.map((value) => [value.messageId, value]));
  if (messageProvenance.size !== snapshot.messageProvenance.length || [...messageIds].some((id) => !messageProvenance.has(id)))
    throw new CliError("invalid-data", `Corpus source ${snapshot.source.id} has invalid message provenance`);
  const externalMessages = new Set;
  for (const provenance of snapshot.messageProvenance) {
    const message = messagesById.get(provenance.messageId);
    if (provenance.externalId.length < 1 || Buffer.byteLength(provenance.externalId, "utf8") > 4096 || externalMessages.has(provenance.externalId) || provenance.attachments.length > 256 || provenance.providerSortKey !== null && (provenance.providerSortKey.length < 1 || Buffer.byteLength(provenance.providerSortKey, "utf8") > 1024 || /[\u0000-\u001f\u007f]/u.test(provenance.providerSortKey)) || (snapshot.source.kind === "bundle" ? message.kind === "reaction" === (provenance.providerSortKey !== null) : provenance.providerSortKey !== null))
      throw new CliError("invalid-data", `Corpus source ${snapshot.source.id} has invalid external message provenance`);
    externalMessages.add(provenance.externalId);
  }
  const auxiliaryIds = new Set;
  for (const record of snapshot.auxiliaryRecords ?? []) {
    const key = `${record.kind}\x00${record.id}`;
    if (!["account", "participant", "reaction", "tombstone", "excluded-message"].includes(record.kind) || record.id.length < 1 || Buffer.byteLength(record.id, "utf8") > 4096 || auxiliaryIds.has(key))
      throw new CliError("invalid-data", `Corpus source ${snapshot.source.id} has invalid auxiliary records`);
    const encoded = canonicalJson(record.record);
    if (typeof encoded !== "string" || Buffer.byteLength(encoded, "utf8") > 2 * 1024 * 1024) {
      throw new CliError("invalid-data", `Corpus source ${snapshot.source.id} has an oversized auxiliary record`);
    }
    auxiliaryIds.add(key);
  }
  const reactionIds = new Set;
  const externalReactionIds = new Set;
  for (const reaction of snapshot.reactionFacts ?? []) {
    if (reaction.id.length < 1 || reaction.externalId.length < 1 || reaction.targetExternalId.length < 1 || Buffer.byteLength(reaction.id, "utf8") > 4096 || Buffer.byteLength(reaction.externalId, "utf8") > 4096 || Buffer.byteLength(reaction.targetExternalId, "utf8") > 4096 || Buffer.byteLength(reaction.body, "utf8") > 8 * 1024 || reactionIds.has(reaction.id) || externalReactionIds.has(reaction.externalId) || reaction.conversationId !== null && !conversationIds.has(reaction.conversationId) || reaction.direction !== null && reaction.direction !== "incoming" && reaction.direction !== "outgoing" || reaction.state !== "active" && reaction.state !== "removed")
      throw new CliError("invalid-data", `Corpus source ${snapshot.source.id} has invalid reaction facts`);
    canonicalTimestampOrNull(reaction.reactedAt, `Corpus source ${snapshot.source.id} reaction time`);
    reactionIds.add(reaction.id);
    externalReactionIds.add(reaction.externalId);
  }
  for (const deletion of snapshot.deletions ?? []) {
    if (![
      "account",
      "participant",
      "conversation",
      "message",
      "reaction",
      "reaction-timeline"
    ].includes(deletion.entityKind) || deletion.externalId.length < 1 || Buffer.byteLength(deletion.externalId, "utf8") > 4096 || deletion.localEntityId !== null && Buffer.byteLength(deletion.localEntityId, "utf8") > 4096 || deletion.expectedConversationId !== undefined && (deletion.expectedConversationId.length < 1 || Buffer.byteLength(deletion.expectedConversationId, "utf8") > 4096) || deletion.reason !== undefined && ![
      "tombstone",
      "explicit-exclusion",
      "replacement"
    ].includes(deletion.reason))
      throw new CliError("invalid-data", `Corpus source ${snapshot.source.id} has an invalid deletion`);
    canonicalTimestampOrNull(deletion.deletedAt, `Corpus source ${snapshot.source.id} deletion time`);
  }
}
function validateEquivalencePlan(plan, replacedSourceIds) {
  if (plan.basis !== "exact-message-overlap" || plan.duplicateSourceId === plan.preferredSourceId || !/^source_[a-f0-9]{64}$/u.test(plan.duplicateSourceId) || !/^source_[a-f0-9]{64}$/u.test(plan.preferredSourceId) || !/^[a-f0-9]{64}$/u.test(plan.evidenceSha256) || !replacedSourceIds.has(plan.duplicateSourceId) || plan.conversations.length < 1 || plan.conversations.length > 1e5 || plan.messages.length < 1 || plan.messages.length > 2000000 || (plan.reactions?.length ?? 0) > 2000000)
    throw new CliError("invalid-data", "Cross-source equivalence plan is invalid or unbounded");
  const coordinates = (values, duplicateKey, preferredKey, label) => {
    const duplicates = new Set;
    const preferred = new Set;
    for (const value of values) {
      const duplicateId = value[duplicateKey];
      const preferredId = value[preferredKey];
      if (duplicateId === undefined || preferredId === undefined || duplicateId.length < 1 || preferredId.length < 1 || Buffer.byteLength(duplicateId, "utf8") > 4096 || Buffer.byteLength(preferredId, "utf8") > 4096 || duplicateId === preferredId || duplicates.has(duplicateId) || preferred.has(preferredId))
        throw new CliError("invalid-data", `Cross-source equivalence repeats ${label} coordinates`);
      duplicates.add(duplicateId);
      preferred.add(preferredId);
    }
    if ([...duplicates].some((id) => preferred.has(id))) {
      throw new CliError("invalid-data", `Cross-source ${label} equivalence contains a chain`);
    }
  };
  coordinates(plan.conversations, "duplicateConversationId", "preferredConversationId", "conversation");
  coordinates(plan.messages, "duplicateMessageId", "preferredMessageId", "message");
  coordinates(plan.reactions ?? [], "duplicateReactionId", "preferredReactionId", "reaction");
}
function applyEquivalencePlan(database, plan, establishedAt) {
  const duplicateSource = get(database, `SELECT coalesce(kind_v4,kind) AS kind,network FROM corpus_sources WHERE id=?`, plan.duplicateSourceId);
  const preferredSource = get(database, `SELECT coalesce(kind_v4,kind) AS kind,network FROM corpus_sources WHERE id=?`, plan.preferredSourceId);
  if (duplicateSource?.kind !== "x-archive" || preferredSource?.kind !== "bundle" || duplicateSource.network !== "x" || preferredSource.network !== "x") {
    throw new CliError("conflict", "Cross-source equivalence requires an X archive and an existing Beeper X source");
  }
  const conversationPairs = new Map(plan.conversations.map((pair) => [pair.duplicateConversationId, pair.preferredConversationId]));
  const conversationMatchDigests = new Map;
  const matchedMessages = [];
  for (const pair of plan.messages) {
    const message = (id) => get(database, `
      SELECT message.id,provenance.source_id,message.conversation_id,message.sent_at,
        message.direction,message.body,message.kind,message.attachment_count
      FROM messages message
      JOIN message_provenance provenance ON provenance.message_id=message.id
      WHERE message.id=?
    `, id);
    const duplicate = message(pair.duplicateMessageId);
    const preferred = message(pair.preferredMessageId);
    if (duplicate === null || preferred === null || duplicate.source_id !== plan.duplicateSourceId || preferred.source_id !== plan.preferredSourceId || conversationPairs.get(duplicate.conversation_id) !== preferred.conversation_id || duplicate.sent_at !== preferred.sent_at || duplicate.direction !== preferred.direction || duplicate.body !== preferred.body || duplicate.kind !== preferred.kind || duplicate.attachment_count !== preferred.attachment_count) {
      throw new CliError("conflict", `Message ${pair.duplicateMessageId} lacks an exact preferred-source fingerprint`);
    }
    const fingerprintCounts = all(database, `
      SELECT conversation_id,count(*) AS value FROM messages
      WHERE conversation_id IN (?,?) AND sent_at=? AND direction=? AND body IS ?
        AND kind=? AND attachment_count=?
      GROUP BY conversation_id ORDER BY conversation_id
    `, duplicate.conversation_id, preferred.conversation_id, duplicate.sent_at, duplicate.direction, duplicate.body, duplicate.kind, duplicate.attachment_count);
    if (fingerprintCounts.length !== 2 || fingerprintCounts.some((row) => row.value !== 1))
      throw new CliError("conflict", `Message ${pair.duplicateMessageId} has an ambiguous cross-source fingerprint`);
    const existingDuplicate = get(database, `
      SELECT preferred_message_id FROM message_equivalences WHERE duplicate_message_id=?
    `, duplicate.id);
    const existingPreferred = get(database, `
      SELECT duplicate_message_id FROM message_equivalences WHERE preferred_message_id=?
    `, preferred.id);
    if (existingDuplicate !== null && existingDuplicate.preferred_message_id !== preferred.id || existingPreferred !== null && existingPreferred.duplicate_message_id !== duplicate.id)
      throw new CliError("conflict", "A message already has a different equivalence coordinate");
    const matchSha256 = sha256(canonicalJson({
      schemaVersion: 1,
      duplicateMessageId: duplicate.id,
      preferredMessageId: preferred.id,
      sentAt: duplicate.sent_at,
      direction: duplicate.direction,
      body: duplicate.body,
      kind: duplicate.kind,
      attachmentCount: duplicate.attachment_count
    }));
    const digests = conversationMatchDigests.get(duplicate.conversation_id) ?? [];
    digests.push(matchSha256);
    conversationMatchDigests.set(duplicate.conversation_id, digests);
    matchedMessages.push(Object.freeze({ duplicate, preferred, matchSha256 }));
  }
  const matchedConversations = [];
  for (const pair of plan.conversations) {
    const rows = all(database, `
      SELECT conversation.id,ownership.source_id,conversation.is_group,association.contact_id
      FROM conversations conversation
      JOIN conversation_sources ownership ON ownership.conversation_id=conversation.id
      LEFT JOIN conversation_contact_scopes association
        ON association.conversation_id=conversation.id
      WHERE conversation.id IN (?,?) ORDER BY conversation.id
    `, pair.duplicateConversationId, pair.preferredConversationId);
    const duplicate = rows.find((row) => row.id === pair.duplicateConversationId);
    const preferred = rows.find((row) => row.id === pair.preferredConversationId);
    const digests = conversationMatchDigests.get(pair.duplicateConversationId) ?? [];
    if (duplicate === undefined || preferred === undefined || duplicate.source_id !== plan.duplicateSourceId || preferred.source_id !== plan.preferredSourceId || duplicate.is_group !== preferred.is_group || duplicate.is_group !== 0 || digests.length < 1 || duplicate.contact_id !== null && preferred.contact_id !== null && duplicate.contact_id !== preferred.contact_id)
      throw new CliError("conflict", "Conversation equivalence requires exact direct-peer identity and message overlap");
    const existingDuplicate = get(database, `
      SELECT preferred_conversation_id FROM conversation_equivalences
      WHERE duplicate_conversation_id=?
    `, duplicate.id);
    const isExistingPreferred = get(database, `
      SELECT 1 AS value FROM conversation_equivalences WHERE duplicate_conversation_id=?
    `, preferred.id);
    const isExistingDuplicate = get(database, `
      SELECT 1 AS value FROM conversation_equivalences WHERE preferred_conversation_id=?
    `, duplicate.id);
    if (existingDuplicate !== null && existingDuplicate.preferred_conversation_id !== preferred.id || isExistingPreferred !== null || isExistingDuplicate !== null)
      throw new CliError("conflict", "Conversation equivalence would form a chain");
    matchedConversations.push(Object.freeze({
      duplicateId: duplicate.id,
      preferredId: preferred.id,
      matchSha256: sha256(canonicalJson({
        schemaVersion: 1,
        duplicateConversationId: duplicate.id,
        preferredConversationId: preferred.id,
        messageMatches: digests.sort()
      }))
    }));
  }
  const matchedReactions = [];
  for (const pair of plan.reactions ?? []) {
    const rows = all(database, `SELECT id,source_id,target_external_id,direction,body,state
      FROM corpus_reaction_facts WHERE id IN (?,?) ORDER BY id`, pair.duplicateReactionId, pair.preferredReactionId);
    const duplicate = rows.find((row) => row.id === pair.duplicateReactionId);
    const preferred = rows.find((row) => row.id === pair.preferredReactionId);
    if (duplicate === undefined || preferred === undefined || new Set([duplicate.source_id, preferred.source_id]).size !== 2 || ![duplicate.source_id, preferred.source_id].includes(plan.duplicateSourceId) || ![duplicate.source_id, preferred.source_id].includes(plan.preferredSourceId) || duplicate.direction !== preferred.direction || duplicate.body !== preferred.body || duplicate.state !== "active" || preferred.state !== "active")
      throw new CliError("conflict", "Reaction equivalence lacks exact cross-source evidence");
    const duplicateTarget = get(database, `
      SELECT message_id FROM message_provenance WHERE source_id=? AND external_id=?
    `, duplicate.source_id, duplicate.target_external_id)?.message_id;
    const preferredTarget = get(database, `
      SELECT message_id FROM message_provenance WHERE source_id=? AND external_id=?
    `, preferred.source_id, preferred.target_external_id)?.message_id;
    const targetEquivalent = duplicateTarget !== undefined && preferredTarget !== undefined && (matchedMessages.some(({ duplicate: messageDuplicate, preferred: messagePreferred }) => messageDuplicate.id === duplicateTarget && messagePreferred.id === preferredTarget || messageDuplicate.id === preferredTarget && messagePreferred.id === duplicateTarget) || get(database, `SELECT 1 AS value FROM message_equivalences
          WHERE (duplicate_message_id=? AND preferred_message_id=?)
             OR (duplicate_message_id=? AND preferred_message_id=?)`, duplicateTarget, preferredTarget, preferredTarget, duplicateTarget) !== null);
    if (!targetEquivalent) {
      throw new CliError("conflict", "Reaction equivalence targets non-equivalent messages");
    }
    const duplicateMatches = get(database, `
      SELECT count(*) AS value FROM corpus_reaction_facts
      WHERE source_id=? AND target_external_id=? AND direction IS ? AND body=? AND state='active'
    `, duplicate.source_id, duplicate.target_external_id, duplicate.direction, duplicate.body)?.value ?? 0;
    const preferredMatches = get(database, `
      SELECT count(*) AS value FROM corpus_reaction_facts
      WHERE source_id=? AND target_external_id=? AND direction IS ? AND body=? AND state='active'
    `, preferred.source_id, preferred.target_external_id, preferred.direction, preferred.body)?.value ?? 0;
    if (duplicateMatches !== 1 || preferredMatches !== 1) {
      throw new CliError("conflict", "Reaction equivalence has ambiguous actor evidence");
    }
    matchedReactions.push(Object.freeze({
      duplicateId: duplicate.id,
      preferredId: preferred.id,
      duplicateSourceId: duplicate.source_id,
      preferredSourceId: preferred.source_id,
      matchSha256: sha256(canonicalJson({
        schemaVersion: 1,
        duplicateReactionId: duplicate.id,
        preferredReactionId: preferred.id,
        duplicateTarget,
        preferredTarget,
        direction: duplicate.direction,
        body: duplicate.body
      }))
    }));
  }
  const upsertConversation = database.query(`
    INSERT INTO conversation_equivalences(
      duplicate_conversation_id,preferred_conversation_id,duplicate_source_id,
      preferred_source_id,basis,plan_evidence_sha256,match_sha256,established_at
    ) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(duplicate_conversation_id) DO UPDATE SET
      plan_evidence_sha256=excluded.plan_evidence_sha256,
      match_sha256=excluded.match_sha256,established_at=excluded.established_at
  `);
  for (const value of matchedConversations)
    upsertConversation.run(value.duplicateId, value.preferredId, plan.duplicateSourceId, plan.preferredSourceId, plan.basis, plan.evidenceSha256, value.matchSha256, establishedAt);
  const upsertMessage = database.query(`
    INSERT INTO message_equivalences(
      duplicate_message_id,preferred_message_id,duplicate_source_id,
      preferred_source_id,basis,plan_evidence_sha256,match_sha256,established_at
    ) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(duplicate_message_id) DO UPDATE SET
      plan_evidence_sha256=excluded.plan_evidence_sha256,
      match_sha256=excluded.match_sha256,established_at=excluded.established_at
  `);
  for (const value of matchedMessages)
    upsertMessage.run(value.duplicate.id, value.preferred.id, plan.duplicateSourceId, plan.preferredSourceId, plan.basis, plan.evidenceSha256, value.matchSha256, establishedAt);
  const upsertReaction = database.query(`
    INSERT INTO reaction_equivalences(
      duplicate_reaction_id,preferred_reaction_id,duplicate_source_id,
      preferred_source_id,basis,plan_evidence_sha256,match_sha256,established_at
    ) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(duplicate_reaction_id) DO UPDATE SET
      plan_evidence_sha256=excluded.plan_evidence_sha256,
      match_sha256=excluded.match_sha256,established_at=excluded.established_at
  `);
  for (const value of matchedReactions)
    upsertReaction.run(value.duplicateId, value.preferredId, value.duplicateSourceId, value.preferredSourceId, plan.basis, plan.evidenceSha256, value.matchSha256, establishedAt);
}

class LocalStore {
  #database;
  constructor(database) {
    this.#database = database;
  }
  static open(path) {
    for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
      assertSafeDatabaseFileIfPresent(candidate);
    }
    const database = new Database3(path, { create: true, strict: true });
    try {
      hardenDatabaseFiles(path);
      database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");
      initializeStoreSchema(database);
      hardenDatabaseFiles(path);
      return new LocalStore(database);
    } catch (error) {
      try {
        database.close();
      } catch {}
      throw error;
    }
  }
  close() {
    this.#database.close();
  }
  corpusRevision() {
    return scalarText(this.#database, "corpus_revision");
  }
  sourceIdentity() {
    const encoded = get(this.#database, `
      SELECT identity_json FROM corpus_sources WHERE id=?
    `, IMESSAGE_SOURCE_ID)?.identity_json ?? scalarText(this.#database, "source_identity");
    return encoded === null ? null : parsedJson(encoded, "Stored iMessage source identity");
  }
  contactsRevision() {
    return scalarText(this.#database, "contacts_revision");
  }
  enrichContacts(snapshot, ingestedAt, hmacKey3) {
    if (snapshot.schemaVersion !== 1 || !/^[a-f0-9]{64}$/u.test(snapshot.snapshotSha256)) {
      throw new CliError("invalid-data", "The Contacts reader returned an invalid snapshot revision");
    }
    if (snapshot.sources.length < 1 || snapshot.sources.length > 64) {
      throw new CliError("invalid-data", "The Contacts reader returned an invalid source count");
    }
    if (snapshot.contacts.length > 1e5 || snapshot.warnings.length > 16) {
      throw new CliError("invalid-data", "The Contacts reader exceeded its result bounds");
    }
    const ids = new Set;
    let handleCount = 0;
    for (const contact of snapshot.contacts) {
      if (!/^[a-f0-9]{64}$/u.test(contact.id) || ids.has(contact.id)) {
        throw new CliError("invalid-data", "The Contacts reader returned duplicate or invalid contact IDs");
      }
      ids.add(contact.id);
      if (contact.privateLabel !== null && (Buffer.byteLength(contact.privateLabel, "utf8") < 1 || Buffer.byteLength(contact.privateLabel, "utf8") > 4096 || /\p{Cc}/u.test(contact.privateLabel)))
        throw new CliError("invalid-data", "The Contacts reader returned an invalid private label");
      if (contact.privateLabel === null !== (contact.privateLabelBasis === null) || contact.privateLabelBasis !== null && contact.privateLabelBasis !== "display-name" && contact.privateLabelBasis !== "name-parts" && contact.privateLabelBasis !== "organization")
        throw new CliError("invalid-data", "The Contacts reader returned an invalid label basis");
      handleCount += contact.handles.length;
      if (handleCount > 1e6) {
        throw new CliError("invalid-data", "The Contacts reader returned too many handles");
      }
      const handles = new Set;
      for (const handle of contact.handles) {
        const canonical = normalizeContactHandle(handle.normalizedValue);
        if (canonical === null || canonical.kind !== handle.kind || canonical.normalizedValue !== handle.normalizedValue || handle.matchId !== contactHandleMatchId(hmacKey3, canonical) || !/^[a-f0-9]{64}$/u.test(handle.matchId))
          throw new CliError("invalid-data", "The Contacts reader returned a non-canonical handle");
        const key = `${handle.kind}\x00${handle.matchId}`;
        if (handles.has(key)) {
          throw new CliError("invalid-data", "The Contacts reader returned duplicate contact handles");
        }
        handles.add(key);
      }
    }
    for (const warning of snapshot.warnings) {
      if (Buffer.byteLength(warning, "utf8") > 1024 || warning.includes("\x00")) {
        throw new CliError("invalid-data", "The Contacts reader returned an invalid warning");
      }
    }
    return transaction(this.#database, () => {
      this.#database.exec("DELETE FROM addressbook_contacts");
      const insertContact = this.#database.query(`INSERT INTO addressbook_contacts(
        id,private_label,normalized_label,label_basis,contacts_revision
      ) VALUES (?,?,?,?,?)`);
      const insertHandle = this.#database.query(`INSERT INTO addressbook_handles(
        contact_id,kind,match_id
      ) VALUES (?,?,?)`);
      for (const contact of snapshot.contacts) {
        insertContact.run(contact.id, contact.privateLabel, contact.privateLabel === null ? null : normalizeContactLabelQuery(contact.privateLabel), contact.privateLabelBasis, snapshot.snapshotSha256);
        for (const handle of contact.handles) {
          insertHandle.run(contact.id, handle.kind, handle.matchId);
        }
      }
      const projection = rebuildConversationLabels(this.#database, hmacKey3);
      const setMetadata = this.#database.query(`
        INSERT INTO metadata (key,value) VALUES (?,?)
        ON CONFLICT (key) DO UPDATE SET value=excluded.value
      `);
      for (const [key, value] of [
        ["contacts_revision", snapshot.snapshotSha256],
        ["contacts_source_identity", canonicalJson(snapshot.sources.map((source) => ({
          device: source.device,
          inode: source.inode,
          bytes: source.bytes,
          modifiedAt: source.modifiedAt,
          schemaSha256: source.schemaSha256
        })))],
        ["contacts_ingested_at", ingestedAt],
        ["contacts_warnings", canonicalJson(snapshot.warnings)],
        ["contacts_schema_version", String(snapshot.schemaVersion)]
      ])
        setMetadata.run(key, value);
      return {
        contactsRevision: snapshot.snapshotSha256,
        sources: snapshot.sources.length,
        sourceContacts: snapshot.contacts.length,
        ...projection
      };
    });
  }
  resolvePrivateContacts(query, limit) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      throw new CliError("usage", "Contact resolution limit must be between 1 and 50");
    }
    const normalized = normalizeContactLabelQuery(query);
    return all(this.#database, `
      SELECT label.contact_id AS id,min(label.private_label) AS private_label
      FROM conversation_contact_labels label
      JOIN conversations conversation ON conversation.id=label.conversation_id
      WHERE conversation.is_group=0 AND label.normalized_label=?
      GROUP BY label.contact_id
      ORDER BY label.contact_id LIMIT ?
    `, normalized, limit).map((row) => ({
      id: personScopeId(row.id),
      privateLabel: row.private_label
    }));
  }
  replaceSources(snapshots, ingestedAt, hmacKey3, equivalencePlan, progress) {
    canonicalTimestampOrNull(ingestedAt, "Source ingest time");
    if (snapshots.length < 1) {
      throw new CliError("invalid-data", "A source replacement must contain at least one source");
    }
    const sourceIds = new Set;
    for (const snapshot of snapshots) {
      if (sourceIds.has(snapshot.source.id)) {
        throw new CliError("invalid-data", `Source replacement repeats ${snapshot.source.id}`);
      }
      sourceIds.add(snapshot.source.id);
      validateSourceSnapshot(snapshot);
    }
    if (equivalencePlan !== undefined)
      validateEquivalencePlan(equivalencePlan, sourceIds);
    return transaction(this.#database, () => {
      const upsertSource = this.#database.query(`
        INSERT INTO corpus_sources(
          id,kind,kind_v4,provider,network,account_id,external_id,input_revision,revision,generated_at,
          producer_json,coverage_json,manifest_sha256,identity_json,warnings_json,ingested_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          kind=excluded.kind,kind_v4=excluded.kind_v4,
          provider=excluded.provider,network=excluded.network,
          account_id=excluded.account_id,external_id=excluded.external_id,
          input_revision=excluded.input_revision,generated_at=excluded.generated_at,
          producer_json=excluded.producer_json,coverage_json=excluded.coverage_json,
          manifest_sha256=excluded.manifest_sha256,identity_json=excluded.identity_json,
          warnings_json=excluded.warnings_json,ingested_at=excluded.ingested_at
      `);
      const relabelSourceConversations = this.#database.query(`
        UPDATE conversations SET service=?
        WHERE id IN (
          SELECT conversation_id FROM conversation_sources WHERE source_id=?
        )
      `);
      const relabelSourceMessages = this.#database.query(`
        UPDATE messages SET service=?
        WHERE id IN (
          SELECT message_id FROM message_provenance WHERE source_id=?
        )
      `);
      const upsertConversation = this.#database.query(`
        INSERT INTO conversations(
          id,source_key,private_label,service,participant_count,
          participant_ids_json,private_participants_json,is_group
        ) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          source_key=excluded.source_key,private_label=excluded.private_label,
          service=excluded.service,participant_count=excluded.participant_count,
          participant_ids_json=excluded.participant_ids_json,
          private_participants_json=excluded.private_participants_json,is_group=excluded.is_group
      `);
      const upsertConversationSource = this.#database.query(`
        INSERT INTO conversation_sources(conversation_id,source_id,external_id,metadata_json)
        VALUES (?,?,?,?)
        ON CONFLICT(conversation_id) DO UPDATE SET
          external_id=excluded.external_id,metadata_json=excluded.metadata_json
      `);
      const upsertMessage = this.#database.query(`
        INSERT INTO messages(
          id,source_row_id,source_guid,conversation_id,sent_at,direction,
          body,body_source,kind,reply_to_source_guid,reply_state,edited_at,retracted_at,
          service,attachment_count
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          source_guid=excluded.source_guid,conversation_id=excluded.conversation_id,
          sent_at=excluded.sent_at,direction=excluded.direction,body=excluded.body,
          body_source=excluded.body_source,kind=excluded.kind,
          reply_to_source_guid=excluded.reply_to_source_guid,reply_state=excluded.reply_state,
          edited_at=excluded.edited_at,
          retracted_at=excluded.retracted_at,service=excluded.service,
          attachment_count=excluded.attachment_count
      `);
      const upsertMessageProvenance = this.#database.query(`
        INSERT INTO message_provenance(
          message_id,source_id,external_id,reply_to_external_id,attachments_json,metadata_json
        ) VALUES (?,?,?,?,?,?)
        ON CONFLICT(message_id) DO UPDATE SET
          external_id=excluded.external_id,reply_to_external_id=excluded.reply_to_external_id,
          attachments_json=excluded.attachments_json,metadata_json=excluded.metadata_json
      `);
      const upsertReactionFact = this.#database.query(`
        INSERT INTO corpus_reaction_facts(
          id,source_id,external_id,target_external_id,conversation_id,
          direction,body,reacted_at,state
        ) VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          external_id=excluded.external_id,target_external_id=excluded.target_external_id,
          conversation_id=excluded.conversation_id,direction=excluded.direction,
          body=excluded.body,reacted_at=excluded.reacted_at,state=excluded.state
      `);
      const upsertSourceRecord = this.#database.query(`
        INSERT INTO corpus_source_records(source_id,kind,external_id,record_json)
        VALUES (?,?,?,?)
        ON CONFLICT(source_id,kind,external_id) DO UPDATE SET record_json=excluded.record_json
      `);
      const setSuppression = this.#database.query(`
        INSERT INTO corpus_source_suppressions(
          source_id,kind,local_id,external_id,suppressed_at,reason,suppressed
        ) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(source_id,kind,local_id) DO UPDATE SET
          external_id=excluded.external_id,suppressed_at=excluded.suppressed_at,
          reason=excluded.reason,suppressed=excluded.suppressed
      `);
      const clearExternalSuppression = this.#database.query(`
        UPDATE corpus_source_suppressions
        SET suppressed_at=?,reason='reappeared',suppressed=0
        WHERE source_id=? AND kind=? AND external_id=? AND suppressed=1
      `);
      const results = [];
      let changedAny = false;
      for (const snapshot of snapshots) {
        const existing = get(this.#database, `
          SELECT coalesce(kind_v4,kind) AS kind,network,input_revision,revision,
            generated_at,manifest_sha256
          FROM corpus_sources WHERE id=?
        `, snapshot.source.id);
        if (existing !== null && existing.kind !== snapshot.source.kind) {
          throw new CliError("conflict", `Source ${snapshot.source.id} changed kind`);
        }
        if (existing !== null && snapshot.source.kind !== "imessage") {
          if (existing.generated_at === null || snapshot.source.generatedAt < existing.generated_at) {
            throw new CliError("conflict", `Source ${snapshot.source.id} snapshot is older than stored state`);
          }
          if (snapshot.source.generatedAt === existing.generated_at && (snapshot.source.revision !== existing.input_revision || snapshot.source.manifestSha256 !== existing.manifest_sha256))
            throw new CliError("conflict", `Source ${snapshot.source.id} reuses generatedAt for different input`);
        }
        const authoritative = snapshot.source.kind === "imessage" || snapshot.source.kind === "bundle" && snapshot.source.coverage.history === "complete-current-local";
        if (authoritative) {
          for (const row of this.#database.query(`
            SELECT conversation_id,external_id FROM conversation_sources WHERE source_id=?
          `).iterate(snapshot.source.id)) {
            setSuppression.run(snapshot.source.id, "conversation", row.conversation_id, row.external_id, ingestedAt, "authoritative-absence", 1);
          }
          for (const row of this.#database.query(`
            SELECT id,external_id FROM corpus_reaction_facts WHERE source_id=?
          `).iterate(snapshot.source.id)) {
            setSuppression.run(snapshot.source.id, "reaction", row.id, row.external_id, ingestedAt, "authoritative-absence", 1);
          }
          for (const row of this.#database.query(`
            SELECT provenance.message_id,provenance.external_id,message.kind
            FROM message_provenance provenance
            JOIN messages message ON message.id=provenance.message_id
            WHERE provenance.source_id=?
          `).iterate(snapshot.source.id)) {
            setSuppression.run(snapshot.source.id, row.kind === "reaction" ? "reaction" : "message", row.message_id, row.external_id, ingestedAt, "authoritative-absence", 1);
          }
        }
        upsertSource.run(snapshot.source.id, snapshot.source.kind === "x-archive" ? "bundle" : snapshot.source.kind, snapshot.source.kind, snapshot.source.provider, snapshot.source.network, snapshot.source.accountId, snapshot.source.externalId, snapshot.source.revision, existing?.revision ?? snapshot.source.revision, snapshot.source.generatedAt, canonicalJson(snapshot.source.producer), canonicalJson(snapshot.source.coverage), snapshot.source.manifestSha256, canonicalJson(snapshot.source.identity), canonicalJson(snapshot.source.warnings), ingestedAt);
        if (existing !== null && existing.network !== snapshot.source.network) {
          relabelSourceConversations.run(snapshot.source.network, snapshot.source.id);
          relabelSourceMessages.run(snapshot.source.network, snapshot.source.id);
        }
        const conversationProvenance = new Map(snapshot.conversationProvenance.map((value) => [value.conversationId, value]));
        let completedConversations = 0;
        for (const conversation of snapshot.conversations) {
          const owner = get(this.#database, `
            SELECT source_id FROM conversation_sources WHERE conversation_id=?
          `, conversation.id);
          if (owner !== null && owner.source_id !== snapshot.source.id) {
            throw new CliError("conflict", `Conversation ${conversation.id} belongs to another source`);
          }
          upsertConversation.run(conversation.id, conversation.sourceKey, conversation.privateLabel, conversation.service, conversation.participantCount, canonicalJson(conversation.participantIds), canonicalJson(conversation.privateParticipants), conversation.group ? 1 : 0);
          const provenance = conversationProvenance.get(conversation.id);
          upsertConversationSource.run(conversation.id, snapshot.source.id, provenance.externalId, canonicalJson(provenance.metadata ?? {}));
          clearExternalSuppression.run(ingestedAt, snapshot.source.id, "conversation", provenance.externalId);
          completedConversations += 1;
          if (progress !== undefined && (completedConversations === snapshot.conversations.length || completedConversations % 1e4 === 0))
            progress({
              phase: "conversations",
              completed: completedConversations,
              total: snapshot.conversations.length
            });
        }
        const messageProvenance = new Map(snapshot.messageProvenance.map((value) => [value.messageId, value]));
        let completedMessages = 0;
        for (const message of snapshot.messages) {
          const owner = get(this.#database, `
            SELECT provenance.source_id,message.source_row_id
            FROM message_provenance provenance
            JOIN messages message ON message.id=provenance.message_id
            WHERE provenance.message_id=?
          `, message.id);
          if (owner !== null && owner.source_id !== snapshot.source.id) {
            throw new CliError("conflict", `Message ${message.id} belongs to another source`);
          }
          const preferredRowId = authoritative || existing === null ? message.sourceRowId : null;
          const preferredCollision = preferredRowId === null ? null : get(this.#database, "SELECT id FROM messages WHERE conversation_id=? AND source_row_id=?", message.conversationId, preferredRowId);
          const sourceRowId = owner?.source_row_id ?? (preferredRowId !== null && preferredCollision === null ? preferredRowId : (get(this.#database, `
                SELECT max(source_row_id) AS value FROM messages WHERE conversation_id=?
              `, message.conversationId)?.value ?? 0) + 1);
          upsertMessage.run(message.id, sourceRowId, message.sourceGuid, message.conversationId, message.sentAt, message.direction, message.body, message.bodySource, message.kind, message.replyToSourceGuid, message.replyState, message.editedAt, message.retractedAt, message.service, message.attachmentCount);
          const provenance = messageProvenance.get(message.id);
          upsertMessageProvenance.run(message.id, snapshot.source.id, provenance.externalId, provenance.replyToExternalId, canonicalJson(provenance.attachments), canonicalJson({
            providerSortKey: provenance.providerSortKey,
            metadata: provenance.metadata ?? {}
          }));
          clearExternalSuppression.run(ingestedAt, snapshot.source.id, message.kind === "reaction" ? "reaction" : "message", provenance.externalId);
          if (message.kind === "reaction") {
            clearExternalSuppression.run(ingestedAt, snapshot.source.id, "reaction-timeline", provenance.externalId);
          }
          completedMessages += 1;
          if (progress !== undefined && (completedMessages === snapshot.messages.length || completedMessages % 1e4 === 0))
            progress({
              phase: "messages",
              completed: completedMessages,
              total: snapshot.messages.length
            });
        }
        const reactions = snapshot.reactionFacts ?? [];
        let completedReactions = 0;
        for (const reaction of reactions) {
          const existingReaction = get(this.#database, `
            SELECT source_id,external_id FROM corpus_reaction_facts WHERE id=?
          `, reaction.id);
          if (existingReaction !== null && (existingReaction.source_id !== snapshot.source.id || existingReaction.external_id !== reaction.externalId))
            throw new CliError("conflict", `Reaction ${reaction.id} belongs to another source coordinate`);
          const conversationId = reaction.conversationId ?? get(this.#database, `SELECT message.conversation_id
             FROM message_provenance provenance
             JOIN messages message ON message.id=provenance.message_id
             WHERE provenance.source_id=? AND provenance.external_id=?`, snapshot.source.id, reaction.targetExternalId)?.conversation_id ?? null;
          upsertReactionFact.run(reaction.id, snapshot.source.id, reaction.externalId, reaction.targetExternalId, conversationId, reaction.direction, reaction.body, reaction.reactedAt, reaction.state);
          if (reaction.state === "active") {
            clearExternalSuppression.run(ingestedAt, snapshot.source.id, "reaction", reaction.externalId);
            clearExternalSuppression.run(ingestedAt, snapshot.source.id, "reaction-timeline", reaction.externalId);
          }
          completedReactions += 1;
          if (progress !== undefined && (completedReactions === reactions.length || completedReactions % 1e4 === 0))
            progress({
              phase: "reactions",
              completed: completedReactions,
              total: reactions.length
            });
        }
        this.#database.query(`
          UPDATE corpus_reaction_facts AS reaction
          SET conversation_id=(
            SELECT message.conversation_id
            FROM message_provenance provenance
            JOIN messages message ON message.id=provenance.message_id
            WHERE provenance.source_id=reaction.source_id
              AND provenance.external_id=reaction.target_external_id
          )
          WHERE reaction.source_id=? AND reaction.conversation_id IS NULL
            AND EXISTS (
              SELECT 1 FROM message_provenance provenance
              WHERE provenance.source_id=reaction.source_id
                AND provenance.external_id=reaction.target_external_id
            )
        `).run(snapshot.source.id);
        for (const record of snapshot.auxiliaryRecords ?? []) {
          upsertSourceRecord.run(snapshot.source.id, record.kind, record.id, canonicalJson(record.record));
        }
        for (const deletion of snapshot.deletions ?? []) {
          let localId = deletion.localEntityId;
          if (deletion.entityKind === "conversation") {
            const specifiedLocal = localId !== null;
            const target = localId === null ? get(this.#database, `
              SELECT conversation_id,external_id FROM conversation_sources
              WHERE source_id=? AND external_id=?
            `, snapshot.source.id, deletion.externalId) : get(this.#database, `
                SELECT conversation_id,external_id FROM conversation_sources
                WHERE source_id=? AND conversation_id=?
              `, snapshot.source.id, localId);
            if (target !== null) {
              if (target.external_id !== deletion.externalId) {
                throw new CliError("invalid-data", "A conversation deletion has mismatched coordinates");
              }
              localId = target.conversation_id;
            } else if (specifiedLocal) {
              throw new CliError("invalid-data", "A conversation deletion references an unknown local entity");
            }
          }
          if (deletion.entityKind === "message") {
            const specifiedLocal = localId !== null;
            const target = localId === null ? get(this.#database, `
                SELECT provenance.message_id,provenance.external_id,
                  message.conversation_id,message.kind
                FROM message_provenance provenance
                JOIN messages message ON message.id=provenance.message_id
                WHERE provenance.source_id=? AND provenance.external_id=?
              `, snapshot.source.id, deletion.externalId) : get(this.#database, `
                SELECT provenance.message_id,provenance.external_id,
                  message.conversation_id,message.kind
                FROM message_provenance provenance
                JOIN messages message ON message.id=provenance.message_id
                WHERE provenance.source_id=? AND provenance.message_id=?
              `, snapshot.source.id, localId);
            if (target !== null) {
              if (target.external_id !== deletion.externalId || target.kind === "reaction" || deletion.expectedConversationId !== undefined && deletion.expectedConversationId !== target.conversation_id)
                throw new CliError("invalid-data", "A message deletion has mismatched coordinates");
              localId = target.message_id;
            } else if (specifiedLocal) {
              throw new CliError("invalid-data", "A message deletion references an unknown local entity");
            }
          }
          if (deletion.entityKind === "reaction" || deletion.entityKind === "reaction-timeline") {
            const specifiedLocal = localId !== null;
            const target = localId === null ? get(this.#database, `
                SELECT id,external_id,conversation_id FROM corpus_reaction_facts
                WHERE source_id=? AND external_id=?
              `, snapshot.source.id, deletion.externalId) : get(this.#database, `
                SELECT id,external_id,conversation_id FROM corpus_reaction_facts
                WHERE source_id=? AND id=?
              `, snapshot.source.id, localId);
            if (target !== null) {
              if (target.external_id !== deletion.externalId || deletion.expectedConversationId !== undefined && deletion.expectedConversationId !== target.conversation_id)
                throw new CliError("invalid-data", "A reaction deletion has mismatched coordinates");
              localId = target.id;
            } else if (specifiedLocal) {
              throw new CliError("invalid-data", "A reaction deletion references an unknown local entity");
            }
          }
          setSuppression.run(snapshot.source.id, deletion.entityKind, localId ?? `external:${deletion.externalId}`, deletion.externalId, deletion.deletedAt, deletion.reason ?? "tombstone", 1);
        }
        if (snapshot.source.kind === "bundle") {
          rerankBundleMessages(this.#database, snapshot.source.id);
        }
        if (equivalencePlan?.duplicateSourceId === snapshot.source.id) {
          applyEquivalencePlan(this.#database, equivalencePlan, ingestedAt);
          const preferredRevision = get(this.#database, `
            SELECT revision FROM corpus_sources WHERE id=?
          `, equivalencePlan.preferredSourceId)?.revision;
          const preferredStateRevision = sourceStateRevision(this.#database, equivalencePlan.preferredSourceId);
          this.#database.query("UPDATE corpus_sources SET revision=? WHERE id=?").run(preferredStateRevision, equivalencePlan.preferredSourceId);
          changedAny ||= preferredRevision !== preferredStateRevision;
        }
        const stateRevision = sourceStateRevision(this.#database, snapshot.source.id);
        this.#database.query("UPDATE corpus_sources SET revision=? WHERE id=?").run(stateRevision, snapshot.source.id);
        const changed = existing?.revision !== stateRevision;
        changedAny ||= changed;
        const counts = get(this.#database, `
          SELECT count(distinct conversation.id) AS conversations,
            count(message.id) AS messages
          FROM conversation_sources ownership
          JOIN conversations conversation ON conversation.id=ownership.conversation_id
          LEFT JOIN messages message ON message.conversation_id=conversation.id
            AND NOT EXISTS (
              SELECT 1 FROM corpus_source_suppressions suppression
              WHERE suppression.source_id=ownership.source_id
                AND suppression.local_id=message.id
                AND suppression.kind IN ('message','reaction','reaction-timeline')
                AND suppression.suppressed=1
            ) AND ${ACTIVE_MESSAGE_EQUIVALENCE_EXCLUSION}
          WHERE ownership.source_id=?
            AND NOT EXISTS (
              SELECT 1 FROM corpus_source_suppressions suppression
              WHERE suppression.source_id=ownership.source_id
                AND suppression.local_id=conversation.id
                AND suppression.kind='conversation'
                AND suppression.suppressed=1
            )
        `, snapshot.source.id) ?? { conversations: 0, messages: 0 };
        results.push(Object.freeze({ id: snapshot.source.id, changed, ...counts }));
      }
      if (changedAny)
        rebuildConversationLabels(this.#database, hmacKey3);
      const corpusRevision = setCorpusRevision(this.#database);
      if (corpusRevision === null)
        throw new CliError("internal", "Source replacement produced no corpus revision");
      return Object.freeze({ corpusRevision, sources: Object.freeze(results) });
    });
  }
  replaceCorpus(snapshot, ingestedAt, hmacKey3) {
    if (!/^[a-f0-9]{64}$/u.test(snapshot.source.snapshotSha256)) {
      throw new CliError("invalid-data", "The iMessage reader returned an invalid corpus revision");
    }
    const observed = snapshot.messages.map(({ sentAt }) => sentAt).sort();
    const sourceSnapshot = Object.freeze({
      source: Object.freeze({
        id: IMESSAGE_SOURCE_ID,
        kind: "imessage",
        provider: "apple",
        network: null,
        accountId: null,
        externalId: "local-imessage",
        revision: snapshot.source.snapshotSha256,
        generatedAt: null,
        producer: Object.freeze({ id: "message-like-me", version: "imessage-reader-v1" }),
        coverage: Object.freeze({
          history: "complete-current-local",
          observedFrom: observed[0] ?? null,
          observedTo: observed.at(-1) ?? null
        }),
        manifestSha256: null,
        identity: snapshot.source,
        warnings: snapshot.warnings
      }),
      conversations: snapshot.conversations,
      conversationProvenance: Object.freeze(snapshot.conversations.map((conversation) => ({
        conversationId: conversation.id,
        externalId: conversation.sourceKey
      }))),
      messages: snapshot.messages,
      messageProvenance: Object.freeze(snapshot.messages.map((message) => ({
        messageId: message.id,
        externalId: message.sourceGuid,
        providerSortKey: null,
        replyToExternalId: message.replyToSourceGuid,
        attachments: Object.freeze(Array.from({ length: message.attachmentCount }, (_value, index) => ({
          id: `unavailable-${index + 1}`,
          kind: null,
          mimeType: null,
          fileName: null,
          bytes: null
        })))
      })))
    });
    const replaced = this.replaceSources([sourceSnapshot], ingestedAt, hmacKey3);
    transaction(this.#database, () => {
      const setMetadata = this.#database.query(`
        INSERT INTO metadata(key,value) VALUES (?,?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value
      `);
      for (const [key, value] of [
        ["source_identity", canonicalJson(snapshot.source)],
        ["ingested_at", ingestedAt],
        ["warnings", canonicalJson(snapshot.warnings)],
        ["corpus_schema_version", String(snapshot.schemaVersion)]
      ])
        setMetadata.run(key, value);
    });
    return {
      corpusRevision: replaced.corpusRevision,
      conversations: snapshot.conversations.length,
      messages: snapshot.messages.length
    };
  }
  listSources(privateDetails = false) {
    const rows = all(this.#database, `
      SELECT source.id,coalesce(source.kind_v4,source.kind) AS kind,
        source.provider,source.network,source.account_id,source.external_id,
        source.input_revision,source.revision,source.generated_at,source.coverage_json,
        source.manifest_sha256,source.identity_json,source.warnings_json,source.ingested_at,
        count(distinct ownership.conversation_id) AS conversations,
        count(message.id) AS messages,
        CASE WHEN coalesce(source.kind_v4,source.kind) IN ('bundle','x-archive') THEN
          (SELECT count(*) FROM corpus_reaction_facts reaction
            WHERE reaction.source_id=source.id AND reaction.state='active'
              AND NOT EXISTS (
                SELECT 1 FROM corpus_source_suppressions suppression
                WHERE suppression.source_id=source.id AND suppression.kind='reaction'
                  AND suppression.local_id=reaction.id AND suppression.suppressed=1
              )
              AND NOT EXISTS (
                SELECT 1 FROM corpus_source_suppressions suppression
                WHERE suppression.source_id=source.id AND suppression.kind='conversation'
                  AND suppression.local_id=reaction.conversation_id
                  AND suppression.suppressed=1
              ) AND ${ACTIVE_REACTION_EQUIVALENCE_EXCLUSION})
          ELSE
          (SELECT count(*) FROM messages reaction_message
            JOIN message_provenance reaction_provenance
              ON reaction_provenance.message_id=reaction_message.id
            WHERE reaction_provenance.source_id=source.id
              AND reaction_message.kind='reaction' AND reaction_message.retracted_at IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM corpus_source_suppressions suppression
                WHERE suppression.source_id=source.id
                  AND suppression.kind IN ('message','reaction','reaction-timeline')
                  AND suppression.local_id=reaction_message.id AND suppression.suppressed=1
              )
              AND NOT EXISTS (
                SELECT 1 FROM corpus_source_suppressions suppression
                WHERE suppression.source_id=source.id AND suppression.kind='conversation'
                  AND suppression.local_id=reaction_message.conversation_id
                  AND suppression.suppressed=1
              ))
        END AS reactions,
        CASE WHEN coalesce(source.kind_v4,source.kind) IN ('bundle','x-archive') THEN
          (SELECT count(*) FROM corpus_reaction_facts reaction
            WHERE reaction.source_id=source.id AND reaction.state='active'
              AND reaction.reacted_at IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM corpus_source_suppressions suppression
                WHERE suppression.source_id=source.id AND suppression.kind='reaction'
                  AND suppression.local_id=reaction.id AND suppression.suppressed=1
              )
              AND NOT EXISTS (
                SELECT 1 FROM corpus_source_suppressions suppression
                WHERE suppression.source_id=source.id AND suppression.kind='conversation'
                  AND suppression.local_id=reaction.conversation_id
                  AND suppression.suppressed=1
              ) AND ${ACTIVE_REACTION_EQUIVALENCE_EXCLUSION})
          ELSE 0
        END AS undated_reactions
      FROM corpus_sources source
      LEFT JOIN conversation_sources ownership ON ownership.source_id=source.id
        AND NOT EXISTS (
          SELECT 1 FROM corpus_source_suppressions suppression
          WHERE suppression.source_id=source.id
            AND suppression.kind='conversation'
            AND suppression.local_id=ownership.conversation_id
            AND suppression.suppressed=1
        )
      LEFT JOIN messages message ON message.conversation_id=ownership.conversation_id
        AND NOT EXISTS (
          SELECT 1 FROM corpus_source_suppressions suppression
          WHERE suppression.source_id=source.id
            AND suppression.kind IN ('message','reaction','reaction-timeline')
            AND suppression.local_id=message.id
            AND suppression.suppressed=1
        ) AND ${ACTIVE_MESSAGE_EQUIVALENCE_EXCLUSION}
      GROUP BY source.id
      ORDER BY source.provider,source.network,source.id
    `);
    return rows.map((row) => {
      const warnings = parsedJson(row.warnings_json, `Source ${row.id} warnings`);
      if (!Array.isArray(warnings))
        throw new CliError("invalid-data", `Source ${row.id} warnings are invalid`);
      return {
        id: row.id,
        kind: row.kind,
        provider: row.provider,
        network: row.network,
        revision: row.revision,
        generatedAt: row.generated_at,
        ingestedAt: row.ingested_at,
        coverage: parsedJson(row.coverage_json, `Source ${row.id} coverage`),
        warningCount: warnings.length,
        conversations: row.conversations,
        messages: row.messages,
        reactions: row.reactions,
        undatedReactions: row.undated_reactions,
        ...privateDetails ? {
          accountId: row.account_id,
          externalId: row.external_id,
          manifestSha256: row.manifest_sha256,
          inputRevision: row.input_revision,
          identity: parsedJson(row.identity_json, `Source ${row.id} identity`),
          warnings
        } : {}
      };
    });
  }
  source(sourceId, privateDetails = false) {
    if (sourceId.length < 1 || sourceId.length > 256) {
      throw new CliError("usage", "Source ID must be bounded non-empty text");
    }
    return this.listSources(privateDetails).find(({ id }) => id === sourceId) ?? null;
  }
  sourceOverlapEvidence(sourceId, maximumRecords = 250000) {
    if (!/^source_[a-f0-9]{64}$/u.test(sourceId) || !Number.isSafeInteger(maximumRecords) || maximumRecords < 1 || maximumRecords > 500000)
      throw new CliError("usage", "Overlap evidence requires a valid source and bounded record limit");
    const source = get(this.#database, `
      SELECT id,coalesce(kind_v4,kind) AS kind,provider,network,account_id,external_id,identity_json
      FROM corpus_sources WHERE id=?
    `, sourceId);
    if (source === null)
      throw new CliError("not-found", `Unknown source ${sourceId}`);
    const counts = get(this.#database, `
      SELECT
        (SELECT count(*) FROM conversation_sources WHERE source_id=?) AS conversations,
        (SELECT count(*) FROM message_provenance WHERE source_id=?) AS messages,
        (SELECT count(*) FROM corpus_reaction_facts WHERE source_id=? AND state='active') AS reactions,
        (SELECT count(*) FROM corpus_source_records
          WHERE source_id=? AND kind IN ('account','participant')) AS auxiliary_records
    `, sourceId, sourceId, sourceId, sourceId);
    if (counts.conversations + counts.messages + counts.reactions + counts.auxiliary_records > maximumRecords)
      throw new CliError("conflict", `Source ${sourceId} exceeds the ${maximumRecords}-record overlap evidence bound`);
    const conversations = all(this.#database, `
      SELECT conversation.id,ownership.external_id,conversation.private_label,
        conversation.service,conversation.participant_ids_json,
        conversation.private_participants_json,conversation.is_group,ownership.metadata_json
      FROM conversation_sources ownership
      JOIN conversations conversation ON conversation.id=ownership.conversation_id
      WHERE ownership.source_id=? AND NOT EXISTS (
        SELECT 1 FROM corpus_source_suppressions suppression
        WHERE suppression.source_id=ownership.source_id
          AND suppression.kind='conversation'
          AND suppression.local_id=conversation.id
          AND suppression.suppressed=1
      )
      ORDER BY ownership.external_id,conversation.id
    `, sourceId).map((row) => Object.freeze({
      id: row.id,
      externalId: row.external_id,
      privateLabel: row.private_label,
      service: row.service,
      participantIds: Object.freeze(stringArray(row.participant_ids_json, `Conversation ${row.id} participant IDs`)),
      privateParticipants: Object.freeze(stringArray(row.private_participants_json, `Conversation ${row.id} private participants`)),
      group: row.is_group === 1,
      metadata: parsedJson(row.metadata_json, `Conversation ${row.id} metadata`)
    }));
    const messages = all(this.#database, `
      SELECT message.id,provenance.external_id,message.conversation_id,message.sent_at,
        message.direction,message.body,message.kind,provenance.reply_to_external_id,
        message.reply_state,message.attachment_count,provenance.attachments_json,
        provenance.metadata_json
      FROM message_provenance provenance
      JOIN messages message ON message.id=provenance.message_id
      WHERE provenance.source_id=? AND NOT EXISTS (
        SELECT 1 FROM corpus_source_suppressions suppression
        WHERE suppression.source_id=provenance.source_id
          AND suppression.local_id=message.id
          AND suppression.kind IN ('message','reaction','reaction-timeline')
          AND suppression.suppressed=1
      )
      ORDER BY message.sent_at,message.source_row_id,message.id
    `, sourceId).map((row) => Object.freeze({
      id: row.id,
      externalId: row.external_id,
      conversationId: row.conversation_id,
      sentAt: row.sent_at,
      direction: row.direction,
      body: row.body,
      kind: row.kind,
      replyToExternalId: row.reply_to_external_id,
      replyState: row.reply_state,
      attachmentCount: row.attachment_count,
      attachments: parsedJson(row.attachments_json, `Message ${row.id} attachments`),
      metadata: parsedJson(row.metadata_json, `Message ${row.id} metadata`)
    }));
    const reactions = all(this.#database, `
      SELECT reaction.id,reaction.external_id,reaction.target_external_id,
        reaction.conversation_id,reaction.direction,reaction.body,reaction.reacted_at
      FROM corpus_reaction_facts reaction
      WHERE reaction.source_id=? AND reaction.state='active' AND NOT EXISTS (
        SELECT 1 FROM corpus_source_suppressions suppression
        WHERE suppression.source_id=reaction.source_id
          AND suppression.kind='reaction'
          AND suppression.local_id=reaction.id
          AND suppression.suppressed=1
      ) ORDER BY reaction.external_id,reaction.id
    `, sourceId).map((row) => Object.freeze({
      id: row.id,
      externalId: row.external_id,
      targetExternalId: row.target_external_id,
      conversationId: row.conversation_id,
      direction: row.direction,
      body: row.body,
      reactedAt: row.reacted_at
    }));
    const auxiliaryRecords = all(this.#database, `
      SELECT kind,external_id,record_json FROM corpus_source_records
      WHERE source_id=? AND kind IN ('account','participant')
      ORDER BY kind,external_id
    `, sourceId).map((row) => Object.freeze({
      kind: row.kind,
      externalId: row.external_id,
      record: parsedJson(row.record_json, `Source ${sourceId} ${row.kind} record`)
    }));
    return Object.freeze({
      source: Object.freeze({
        id: source.id,
        kind: source.kind,
        provider: source.provider,
        network: source.network,
        accountId: source.account_id,
        externalId: source.external_id,
        identity: parsedJson(source.identity_json, `Source ${source.id} identity`)
      }),
      conversations: Object.freeze(conversations),
      messages: Object.freeze(messages),
      reactions: Object.freeze(reactions),
      auxiliaryRecords: Object.freeze(auxiliaryRecords)
    });
  }
  listContacts(options) {
    if (this.corpusRevision() === null)
      return [];
    const rows = all(this.#database, `
      WITH conversation_members AS (
        SELECT conversation.id AS conversation_id,
          coalesce(equivalence.preferred_conversation_id,conversation.id) AS root_id,
          conversation.private_label,conversation.is_group,conversation.participant_count
        FROM conversations conversation
        JOIN conversation_sources ownership ON ownership.conversation_id=conversation.id
        LEFT JOIN conversation_equivalences equivalence
          ON equivalence.duplicate_conversation_id=conversation.id
        WHERE NOT EXISTS (
          SELECT 1 FROM corpus_source_suppressions suppression
          WHERE suppression.source_id=ownership.source_id
            AND suppression.kind='conversation'
            AND suppression.local_id=conversation.id
            AND suppression.suppressed=1
        )
      ), group_contacts AS (
        SELECT member.root_id,
          CASE WHEN count(distinct association.contact_id)=1
            THEN min(association.contact_id) ELSE NULL END AS contact_id
        FROM conversation_members member
        LEFT JOIN conversation_contact_scopes association
          ON association.conversation_id=member.conversation_id
        GROUP BY member.root_id
      ), scope_conversations AS (
        SELECT CASE WHEN group_contact.contact_id IS NULL THEN member.root_id
            ELSE '${PERSON_SCOPE_PREFIX}' || group_contact.contact_id END AS id,
          coalesce(root_label.private_label,root.private_label,
            member_label.private_label,member.private_label) AS private_label,
          CASE WHEN group_contact.contact_id IS NULL THEN 'conversation' ELSE 'person' END
            AS scope_kind,
          CASE WHEN group_contact.contact_id IS NULL THEN member.is_group ELSE 0 END AS is_group,
          CASE WHEN group_contact.contact_id IS NULL THEN member.participant_count ELSE 1 END
            AS participant_count,
          member.root_id,member.conversation_id
        FROM conversation_members member
        JOIN group_contacts group_contact ON group_contact.root_id=member.root_id
        JOIN conversations root ON root.id=member.root_id
        LEFT JOIN conversation_contact_labels root_label
          ON root_label.conversation_id=member.root_id
        LEFT JOIN conversation_contact_labels member_label
          ON member_label.conversation_id=member.conversation_id
      )
      SELECT scope.id,min(scope.private_label) AS private_label,
        max(scope.scope_kind) AS scope_kind,
        count(distinct scope.root_id) AS conversation_count,
        max(scope.is_group) AS is_group,max(scope.participant_count) AS participant_count,
        min(message.sent_at) AS first_message_at,max(message.sent_at) AS last_message_at,
        count(message.id) AS message_count,
        sum(CASE WHEN message.direction = 'incoming' THEN 1 ELSE 0 END) AS incoming_count,
        sum(CASE WHEN message.direction = 'outgoing' THEN 1 ELSE 0 END) AS outgoing_count
      FROM scope_conversations scope
      JOIN messages message ON message.conversation_id=scope.conversation_id
      JOIN message_provenance provenance ON provenance.message_id=message.id
      WHERE NOT EXISTS (
        SELECT 1 FROM corpus_source_suppressions suppression
        WHERE suppression.source_id=provenance.source_id
          AND suppression.local_id=message.id
          AND suppression.kind IN ('message','reaction','reaction-timeline')
          AND suppression.suppressed=1
      ) AND ${ACTIVE_MESSAGE_EQUIVALENCE_EXCLUSION}
      GROUP BY scope.id
      HAVING outgoing_count >= ?
      ORDER BY outgoing_count DESC,last_message_at DESC,scope.id
      LIMIT ?
    `, options.minimumOutgoing, options.limit);
    const storedProfiles = new Map;
    for (const row of all(this.#database, `
      SELECT scope_id,evidence_revision,profile_json FROM profiles
      WHERE scope_id IS NOT NULL AND evidence_revision IS NOT NULL
      ORDER BY scope_id,applied_at DESC,contact_id
    `)) {
      const profiles = storedProfiles.get(row.scope_id) ?? [];
      profiles.push({
        evidenceRevision: row.evidence_revision,
        profile: parseStyleProfile(parsedJson(row.profile_json, "Stored profile"))
      });
      storedProfiles.set(row.scope_id, profiles);
    }
    return rows.map((row) => ({
      id: row.id,
      ...options.privateLabels ? { privateLabel: row.private_label } : {},
      scopeKind: row.scope_kind,
      conversationCount: row.conversation_count,
      group: row.is_group === 1,
      participantCount: row.participant_count,
      firstMessageAt: row.first_message_at,
      lastMessageAt: row.last_message_at,
      messageCount: row.message_count,
      incomingCount: row.incoming_count,
      outgoingCount: row.outgoing_count,
      profileState: (() => {
        const profiles = storedProfiles.get(row.id);
        if (profiles === undefined)
          return "missing";
        const scope = analysisScope(this.#database, row.id);
        if (scope === null)
          return "stale";
        return profiles.some(({ evidenceRevision, profile }) => storedProfileIsCurrent(this.#database, scope, evidenceRevision, profile)) ? "current" : "stale";
      })()
    }));
  }
  conversation(contactId, privateLabels) {
    const scope = analysisScope(this.#database, contactId);
    if (scope === null)
      return null;
    const placeholders = idPlaceholders(scope.conversationIds);
    const rows = all(this.#database, `
      SELECT conversation.id,conversation.source_key,
        coalesce(contact_label.private_label,conversation.private_label) AS private_label,
        conversation.service,conversation.participant_count,conversation.participant_ids_json,
        conversation.private_participants_json,conversation.is_group
      FROM conversations conversation
      LEFT JOIN conversation_contact_labels contact_label
        ON contact_label.conversation_id = conversation.id
      WHERE conversation.id IN (${placeholders})
      ORDER BY CASE WHEN conversation.id=? THEN 0 ELSE 1 END,conversation.id
    `, ...scope.conversationIds, scope.kind === "conversation" ? scope.id : "");
    const first = rows[0];
    if (first === undefined)
      return null;
    const services = [...new Set(rows.map((row) => row.service).filter((value) => value !== null))];
    const participants = [...new Set(rows.flatMap((row) => stringArray(row.participant_ids_json, `conversation ${row.id} participant IDs`)))].sort();
    const privateParticipants = privateLabels ? [...new Set(rows.flatMap((row) => stringArray(row.private_participants_json, `conversation ${row.id} private participants`)))].sort() : [];
    const counts = scopeMessageCounts(this.#database, scope);
    return {
      id: scope.id,
      sourceKey: scope.kind === "person" || scope.conversationIds.length > 1 ? scope.id : first.source_key,
      privateLabel: privateLabels ? first.private_label : null,
      scopeKind: scope.kind,
      conversationCount: new Set(scope.conversationIds.map((id) => canonicalConversationId(this.#database, id))).size,
      service: services.length === 1 ? services[0] : null,
      services: Object.freeze(services.sort((left, right) => left < right ? -1 : left > right ? 1 : 0)),
      participantCount: scope.kind === "person" ? 1 : first.participant_count,
      participantIds: participants,
      privateParticipants,
      group: scope.kind === "person" ? false : first.is_group === 1,
      ...counts
    };
  }
  messages(contactId) {
    const scope = analysisScope(this.#database, contactId);
    return scope === null ? [] : messageRowsForScope(this.#database, scope).map(corpusMessage);
  }
  contactCorpus(contactId, options) {
    const window = evidenceWindow(options, "Evidence window");
    return readTransaction(this.#database, () => {
      const corpusRevision = scalarText(this.#database, "corpus_revision");
      const scope = analysisScope(this.#database, contactId);
      if (scope === null)
        return null;
      if (corpusRevision === null) {
        throw new CliError("invalid-data", "Stored conversations have no corpus revision");
      }
      return {
        corpusRevision,
        evidenceRevision: scopeEvidenceRevision(this.#database, scope, undefined, window),
        messages: messageRowsForScope(this.#database, scope, undefined, window).map(corpusMessage),
        reactions: reactionFactsForScope(this.#database, scope, window)
      };
    });
  }
  routeCandidates(contactId, privateDetails = false) {
    if (contactId.length < 1 || contactId.length > 256) {
      throw new CliError("usage", "Invalid contact ID");
    }
    return readTransaction(this.#database, () => {
      const scope = analysisScope(this.#database, contactId);
      if (scope === null)
        return null;
      return Object.freeze({
        contactId: scope.id,
        candidates: routeCandidatesForScope(this.#database, scope, privateDetails)
      });
    });
  }
  handoffPreparation(contactId, routeCandidateId) {
    if (routeCandidateId.length < 1 || routeCandidateId.length > 256) {
      throw new CliError("usage", "Invalid source-conversation route ID");
    }
    return readTransaction(this.#database, () => {
      const scope = analysisScope(this.#database, contactId);
      if (scope === null)
        throw new CliError("not-found", `Unknown contact ${contactId}`);
      const candidate = routeCandidatesForScope(this.#database, scope, false).find(({ id }) => id === routeCandidateId);
      if (candidate === undefined) {
        throw new CliError("not-found", "The selected source-conversation route does not belong to this contact");
      }
      if (candidate.actionability.state !== "wrench-binding-eligible") {
        throw new CliError("conflict", `The selected source-conversation route is evidence-only (${candidate.actionability.reason})`);
      }
      const corpusRevision = scalarText(this.#database, "corpus_revision");
      if (corpusRevision === null)
        throw new CliError("invalid-data", "Stored conversations have no corpus revision");
      const storedProfile = this.profile(scope.id);
      return Object.freeze({
        contactId: scope.id,
        candidate,
        corpusRevision,
        profileState: storedProfile?.state ?? "missing",
        profileEvidenceRevision: storedProfile?.profile.schemaVersion === 2 ? storedProfile.profile.evidence.evidenceRevision : null
      });
    });
  }
  recordPreparedHandoff(value) {
    const handoff = parseAgentMessageHandoffV1(value);
    transaction(this.#database, () => {
      const scope = analysisScope(this.#database, handoff.contact.contactId);
      if (scope === null || scope.id !== handoff.contact.contactId) {
        throw new CliError("conflict", "Handoff contact scope is no longer current");
      }
      const candidate = routeCandidatesForScope(this.#database, scope, false).find(({ id }) => id === handoff.contact.routeCandidateId);
      if (candidate === undefined || candidate.sourceId !== handoff.contact.sourceId || candidate.conversationId !== handoff.contact.conversationId || candidate.actionability.state !== "wrench-binding-eligible")
        throw new CliError("conflict", "Handoff source-conversation route is no longer actionable");
      const corpusRevision = scalarText(this.#database, "corpus_revision");
      if (corpusRevision !== handoff.evidence.corpusRevision || candidate.sourceRevision !== handoff.evidence.sourceRevision)
        throw new CliError("conflict", "Message evidence changed while the handoff was prepared");
      const storedProfile = this.profile(scope.id);
      const currentProfileState = storedProfile?.state ?? "missing";
      const currentProfileEvidenceRevision = storedProfile?.profile.schemaVersion === 2 ? storedProfile.profile.evidence.evidenceRevision : null;
      if (currentProfileState !== handoff.evidence.profileState || currentProfileEvidenceRevision !== handoff.evidence.profileEvidenceRevision)
        throw new CliError("conflict", "Style profile evidence changed while the handoff was prepared");
      this.#database.query(`
        INSERT INTO agent_message_handoffs(
          handoff_id,handoff_sha256,contact_id_sha256,route_candidate_id_sha256,
          source_id_sha256,conversation_id_sha256,
          corpus_revision,source_revision,profile_state,profile_evidence_revision,
          wrench_contract_hash,route_ref_sha256,context_ref_sha256,
          exact_data_revision_sha256,latest_message_revision_sha256,
          turn_digest_sha256,part_count,created_at,expires_at,state
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'prepared')
        ON CONFLICT(handoff_id) DO NOTHING
      `).run(handoff.handoffId, handoff.integrity.canonicalSha256, sha256(handoff.contact.contactId), sha256(handoff.contact.routeCandidateId), sha256(handoff.contact.sourceId), sha256(handoff.contact.conversationId), handoff.evidence.corpusRevision, handoff.evidence.sourceRevision, handoff.evidence.profileState, handoff.evidence.profileEvidenceRevision, handoff.wrench.contractHash, handoff.wrench.routeRefSha256, handoff.wrench.contextRefSha256, handoff.wrench.exactDataRevision, handoff.wrench.latestMessageRevision, wrenchMessagingTurnDigestV1(handoff), handoff.turn.bubbles.length, handoff.createdAt, handoff.expiresAt);
      const stored = get(this.#database, `
        SELECT handoff_sha256 FROM agent_message_handoffs WHERE handoff_id=?
      `, handoff.handoffId);
      if (stored?.handoff_sha256 !== handoff.integrity.canonicalSha256) {
        throw new CliError("conflict", "Handoff ID is already bound to different evidence");
      }
    });
    return this.handoffAudit(handoff.handoffId);
  }
  recordHandoffReceipt(handoffId, value) {
    if (!/^handoff_[a-f0-9]{64}$/u.test(handoffId)) {
      throw new CliError("usage", "Invalid handoff ID");
    }
    const receipt = parseWrenchMessagingReceiptBindingV1(value);
    transaction(this.#database, () => {
      const stored = get(this.#database, `
        SELECT handoff_sha256,route_ref_sha256,context_ref_sha256,turn_digest_sha256,
          part_count,created_at,state,receipt_sha256
        FROM agent_message_handoffs WHERE handoff_id=?
      `, handoffId);
      if (stored === null)
        throw new CliError("not-found", `Unknown handoff ${handoffId}`);
      if (receipt.clientIntentSha256 !== stored.handoff_sha256 || receipt.routeRefSha256 !== stored.route_ref_sha256 || receipt.contextRefSha256 !== stored.context_ref_sha256 || receipt.turnDigest !== stored.turn_digest_sha256 || receipt.partCount !== stored.part_count || receipt.recordedAt < stored.created_at)
        throw new CliError("conflict", "Wrench receipt does not bind the recorded handoff");
      if (stored.state === "recorded") {
        if (stored.receipt_sha256 === receipt.receiptSha256)
          return;
        throw new CliError("conflict", "Handoff already has a different Wrench receipt");
      }
      this.#database.query(`
        UPDATE agent_message_handoffs SET
          state='recorded',receipt_sha256=?,receipt_contract_hash=?,preview_digest_sha256=?,
          run_id_sha256=?,receipt_state=?,proven_part_count=?,recorded_at=?
        WHERE handoff_id=? AND state='prepared'
      `).run(receipt.receiptSha256, receipt.contractHash, receipt.previewDigest, sha256(receipt.runId), receipt.state, receipt.provenPartCount, receipt.recordedAt, handoffId);
    });
    return this.handoffAudit(handoffId);
  }
  handoffAudit(handoffId) {
    if (!/^handoff_[a-f0-9]{64}$/u.test(handoffId)) {
      throw new CliError("usage", "Invalid handoff ID");
    }
    const row = get(this.#database, `SELECT * FROM agent_message_handoffs WHERE handoff_id=?`, handoffId);
    if (row === null)
      throw new CliError("not-found", `Unknown handoff ${handoffId}`);
    const receipt = row.state === "recorded" ? Object.freeze({
      contractHash: row.receipt_contract_hash,
      receiptSha256: row.receipt_sha256,
      previewDigest: row.preview_digest_sha256,
      runIdSha256: row.run_id_sha256,
      state: row.receipt_state,
      provenPartCount: row.proven_part_count,
      recordedAt: row.recorded_at
    }) : null;
    return Object.freeze({
      schemaVersion: 1,
      format: "message-like-me.agent-message-handoff-audit",
      handoffId: row.handoff_id,
      handoffSha256: row.handoff_sha256,
      contactIdSha256: row.contact_id_sha256,
      routeCandidateIdSha256: row.route_candidate_id_sha256,
      sourceIdSha256: row.source_id_sha256,
      conversationIdSha256: row.conversation_id_sha256,
      corpusRevision: row.corpus_revision,
      sourceRevision: row.source_revision,
      profileState: row.profile_state,
      profileEvidenceRevision: row.profile_evidence_revision,
      wrenchContractHash: row.wrench_contract_hash,
      routeRefSha256: row.route_ref_sha256,
      contextRefSha256: row.context_ref_sha256,
      exactDataRevisionSha256: row.exact_data_revision_sha256,
      latestMessageRevisionSha256: row.latest_message_revision_sha256,
      turnDigest: row.turn_digest_sha256,
      partCount: row.part_count,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      state: row.state,
      receipt
    });
  }
  recordStudyPacket(receipt) {
    if (receipt.exampleIds === undefined !== (receipt.evidence === undefined)) {
      throw new CliError("invalid-data", "Study packet example IDs and evidence manifest must be recorded together");
    }
    const manifest = receipt.exampleIds === undefined || receipt.evidence === undefined ? null : {
      exampleIds: studyExampleIds(receipt.exampleIds, "study packet exampleIds"),
      evidence: studyEvidenceManifest(receipt.evidence, "study packet evidence")
    };
    if (manifest !== null && manifest.evidence.studyExamples !== manifest.exampleIds.length) {
      throw new CliError("invalid-data", "Study packet evidence.studyExamples must equal the number of example IDs");
    }
    transaction(this.#database, () => {
      const revision = scalarText(this.#database, "corpus_revision");
      const scope = analysisScope(this.#database, receipt.contactId);
      if (scope === null)
        throw new CliError("not-found", `Unknown contact ${receipt.contactId}`);
      const window = manifest === null ? UNBOUNDED_EVIDENCE_WINDOW : Object.freeze({
        after: manifest.evidence.after,
        before: manifest.evidence.before
      });
      const currentEvidenceRevision = scopeEvidenceRevision(this.#database, scope, undefined, window);
      if (revision !== receipt.corpusRevision && receipt.evidenceRevision === undefined) {
        throw new CliError("conflict", "Corpus changed while the study packet was prepared; prepare it again");
      }
      if (receipt.evidenceRevision !== undefined && receipt.evidenceRevision !== currentEvidenceRevision) {
        throw new CliError("conflict", "Contact evidence changed while the study packet was prepared; prepare it again");
      }
      this.#database.query(`
        INSERT INTO study_packets (
          sha256,contact_id,corpus_revision,scope_id,evidence_revision,
          example_ids_json,evidence_json,created_at,private_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (sha256) DO UPDATE SET
          contact_id = excluded.contact_id,
          corpus_revision = excluded.corpus_revision,
          scope_id = excluded.scope_id,
          evidence_revision = excluded.evidence_revision,
          example_ids_json = excluded.example_ids_json,
          evidence_json = excluded.evidence_json,
          created_at = excluded.created_at,
          private_path = excluded.private_path
      `).run(receipt.sha256, receipt.contactId, receipt.corpusRevision, scope.id, currentEvidenceRevision, manifest === null ? null : canonicalJson(manifest.exampleIds), manifest === null ? null : canonicalJson(manifest.evidence), receipt.createdAt, receipt.privatePath);
    });
  }
  applyProfile(profile, appliedAt) {
    const parsedProfile = parseStyleProfile(profile);
    transaction(this.#database, () => {
      const revision = scalarText(this.#database, "corpus_revision");
      if (revision === null)
        throw new CliError("conflict", "Ingest iMessage before applying a profile");
      const scope = analysisScope(this.#database, parsedProfile.contactId);
      if (scope === null)
        throw new CliError("not-found", `Unknown contact ${parsedProfile.contactId}`);
      const packet = get(this.#database, `
        SELECT scope_id,evidence_revision,example_ids_json,evidence_json
        FROM study_packets
        WHERE sha256 = ? AND contact_id = ? AND corpus_revision = ?
      `, parsedProfile.packetSha256, parsedProfile.contactId, parsedProfile.corpusRevision);
      if (packet === null) {
        throw new CliError("conflict", "Profile does not bind a study packet prepared by this installation");
      }
      if (packet.scope_id !== scope.id || packet.evidence_revision === null) {
        throw new CliError("conflict", "Profile study scope changed; prepare and analyze a new study packet");
      }
      let window = UNBOUNDED_EVIDENCE_WINDOW;
      if (parsedProfile.schemaVersion === 2) {
        if (parsedProfile.evidence.evidenceRevision !== packet.evidence_revision) {
          throw new CliError("conflict", "Profile evidence revision does not match its study packet");
        }
        if (packet.example_ids_json === null || packet.evidence_json === null) {
          throw new CliError("conflict", "Profile requires a study packet with a recorded evidence manifest");
        }
        const exampleIds = studyExampleIds(parsedJson(packet.example_ids_json, "Stored study packet example IDs"), "Stored study packet example IDs");
        const evidence = studyEvidenceManifest(parsedJson(packet.evidence_json, "Stored study packet evidence"), "Stored study packet evidence");
        if (evidence.studyExamples !== exampleIds.length) {
          throw new CliError("invalid-data", "Stored study packet evidence manifest is inconsistent");
        }
        if (canonicalJson(evidence) !== canonicalJson(profileEvidenceManifest(parsedProfile))) {
          throw new CliError("conflict", "Profile evidence summary does not match its study packet");
        }
        window = Object.freeze({ after: evidence.after, before: evidence.before });
        assertProfileEvidenceIds(parsedProfile, new Set(exampleIds));
      }
      const currentEvidenceRevision = scopeEvidenceRevision(this.#database, scope, undefined, window);
      if (packet.evidence_revision !== currentEvidenceRevision) {
        throw new CliError("conflict", "Profile evidence is stale; prepare and analyze a new study packet");
      }
      this.#database.query("DELETE FROM profiles WHERE scope_id=?").run(scope.id);
      this.#database.query(`
        INSERT INTO profiles (
          contact_id,corpus_revision,scope_id,evidence_revision,
          packet_sha256,analyzed_at,profile_json,applied_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (contact_id) DO UPDATE SET
          corpus_revision = excluded.corpus_revision,
          scope_id = excluded.scope_id,
          evidence_revision = excluded.evidence_revision,
          packet_sha256 = excluded.packet_sha256,
          analyzed_at = excluded.analyzed_at,
          profile_json = excluded.profile_json,
          applied_at = excluded.applied_at
      `).run(parsedProfile.contactId, parsedProfile.corpusRevision, scope.id, currentEvidenceRevision, parsedProfile.packetSha256, parsedProfile.analyzedAt, canonicalJson(parsedProfile), appliedAt);
    });
  }
  profile(contactId) {
    const scope = analysisScope(this.#database, contactId);
    if (scope === null)
      return null;
    const rows = all(this.#database, `
      SELECT evidence_revision,profile_json,applied_at
      FROM profiles
      WHERE scope_id=?
      ORDER BY applied_at DESC,CASE WHEN contact_id=? THEN 0 ELSE 1 END,contact_id
    `, scope.id, contactId);
    const fallback = rows.length === 0 ? get(this.#database, `
      SELECT evidence_revision,profile_json,applied_at FROM profiles WHERE contact_id=?
    `, contactId) : null;
    const candidates = (fallback === null ? rows : [fallback]).map((row) => ({
      row,
      profile: parseStyleProfile(parsedJson(row.profile_json, "Stored profile"))
    }));
    if (candidates.length === 0)
      return null;
    const selected = candidates.find(({ row, profile }) => row.evidence_revision !== null && storedProfileIsCurrent(this.#database, scope, row.evidence_revision, profile)) ?? candidates[0];
    return {
      state: selected.row.evidence_revision !== null && storedProfileIsCurrent(this.#database, scope, selected.row.evidence_revision, selected.profile) ? "current" : "stale",
      profile: selected.profile,
      appliedAt: selected.row.applied_at
    };
  }
  doctor() {
    const quick = get(this.#database, "PRAGMA quick_check")?.quick_check ?? "unknown";
    const foreignKeys = all(this.#database, "PRAGMA foreign_key_check").length;
    const count = (table) => get(this.#database, `SELECT count(*) AS value FROM ${table}`)?.value ?? 0;
    const activeMessages = get(this.#database, `
      SELECT count(*) AS value FROM messages message
      JOIN message_provenance provenance ON provenance.message_id=message.id
      JOIN conversation_sources ownership ON ownership.conversation_id=message.conversation_id
      WHERE NOT EXISTS (
        SELECT 1 FROM corpus_source_suppressions suppression
        WHERE suppression.source_id=provenance.source_id
          AND suppression.local_id=message.id
          AND suppression.kind IN ('message','reaction','reaction-timeline')
          AND suppression.suppressed=1
      ) AND NOT EXISTS (
        SELECT 1 FROM corpus_source_suppressions suppression
        WHERE suppression.source_id=ownership.source_id
          AND suppression.kind='conversation'
          AND suppression.local_id=message.conversation_id
          AND suppression.suppressed=1
      ) AND ${ACTIVE_MESSAGE_EQUIVALENCE_EXCLUSION}
    `)?.value ?? 0;
    return {
      storeSchemaVersion: userVersion(this.#database),
      quickCheck: quick,
      foreignKeyViolations: foreignKeys,
      corpusRevision: this.corpusRevision(),
      contactsRevision: this.contactsRevision(),
      sources: count("corpus_sources"),
      conversations: count("conversations"),
      messages: count("messages"),
      activeMessages,
      conversationEquivalences: count("conversation_equivalences"),
      messageEquivalences: count("message_equivalences"),
      reactionEquivalences: count("reaction_equivalences"),
      profiles: count("profiles"),
      handoffs: count("agent_message_handoffs"),
      addressBookContacts: count("addressbook_contacts"),
      enrichedLabels: count("conversation_contact_labels")
    };
  }
}

// src/version.ts
var MESSAGE_LIKE_ME_VERSION = "0.5.0";

// src/x-archive.ts
import { createHash as createHash5 } from "crypto";
import {
  closeSync as closeSync2,
  constants,
  fstatSync as fstatSync2,
  lstatSync as lstatSync4,
  openSync as openSync2,
  readSync as readSync2,
  realpathSync as realpathSync3
} from "fs";
import { isAbsolute as isAbsolute5, resolve as resolve6 } from "path";

// src/x-archive-zip.ts
import { readSync } from "fs";
import { inflateRawSync } from "zlib";
var EOCD = 101010256;
var ZIP64_EOCD = 101075792;
var ZIP64_LOCATOR = 117853008;
var CENTRAL = 33639248;
var LOCAL = 67324752;
var DESCRIPTOR = 134695760;
var ZIP64_EXTRA = 1;
var STORED = 0;
var DEFLATE = 8;
var DESCRIPTOR_FLAG = 8;
var UTF8_FLAG = 2048;
var ENCRYPTED_FLAG = 1;
var STRONG_ENCRYPTION_FLAG = 64;
var MASKED_HEADER_FLAG = 8192;
var DEFLATE_OPTION_FLAGS = 6;
var UNIX_HOST = 3;
var MACOS_HOST = 19;
var UNIX_TYPE_MASK = 61440;
var UNIX_REGULAR = 32768;
var UNIX_DIRECTORY = 16384;
var DOS_DIRECTORY = 16;
var U16_MAX = 65535;
var U32_MAX = 4294967295;
var MAX_X_ZIP_ARCHIVE_BYTES = 16 * 1024 * 1024 * 1024;
var MAX_X_ZIP_MEMBER_BYTES = 256 * 1024 * 1024;
var MAX_COMPRESSED_MEMBER_BYTES = 64 * 1024 * 1024;
var MAX_ENTRIES = 1e5;
var MAX_CENTRAL_BYTES = 64 * 1024 * 1024;
var MAX_TOTAL_SELECTED_BYTES = 768 * 1024 * 1024;
var MAX_TOTAL_DECLARED_BYTES = 64 * 1024 * 1024 * 1024;
var MAX_NAME_BYTES = 4 * 1024;
var MAX_RATIO = 200;
var SELECTED = /^(?:[^/]+\/)?data\/(?:manifest|account|direct-message(?:-group)?-headers|direct-messages(?:-group)?[^/]*|tweets|deleted-tweets|community-tweet)\.js$/u;
var CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0;index < table.length; index += 1) {
    let value = index;
    for (let bit = 0;bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 3988292384 ^ value >>> 1 : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();
function updateCrc32(state, bytes) {
  let value = state;
  for (const byte of bytes)
    value = CRC32_TABLE[(value ^ byte) & 255] ^ value >>> 8;
  return value;
}
function checkedEnd(offset, length, label) {
  const value = offset + length;
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || !Number.isSafeInteger(value) || value < offset)
    throw new Error(`X ZIP ${label} has invalid bounds`);
  return value;
}
function readExact(descriptor, offset, length, label) {
  checkedEnd(offset, length, label);
  const bytes = Buffer.allocUnsafe(length);
  let position = 0;
  while (position < length) {
    const count = readSync(descriptor, bytes, position, length - position, offset + position);
    if (count < 1)
      throw new Error(`X ZIP ${label} is truncated`);
    position += count;
  }
  return bytes;
}
function u64(bytes, offset, label) {
  if (offset < 0 || bytes.length - offset < 8)
    throw new Error(`X ZIP ${label} is truncated`);
  const value = bytes.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`X ZIP ${label} exceeds JavaScript's exact integer range`);
  }
  return Number(value);
}
function fieldValue(legacy, resolved, sentinel, label) {
  if (legacy !== sentinel && legacy !== resolved) {
    throw new Error(`X ZIP legacy ${label} contradicts ZIP64 metadata`);
  }
}
function directoryFromEocd(descriptor, archiveSize) {
  const tailLength = Math.min(archiveSize, 22 + U16_MAX + 20);
  const tailOffset = archiveSize - tailLength;
  const tail = readExact(descriptor, tailOffset, tailLength, "end records");
  const candidates = [];
  for (let offset2 = tail.length - 22;offset2 >= 0; offset2 -= 1) {
    if (tail.readUInt32LE(offset2) === EOCD && tailOffset + offset2 + 22 + tail.readUInt16LE(offset2 + 20) === archiveSize)
      candidates.push(tailOffset + offset2);
  }
  if (candidates.length !== 1) {
    throw new Error(candidates.length === 0 ? "X ZIP end-of-central-directory record is missing" : "X ZIP end-of-central-directory record is ambiguous");
  }
  const eocdOffset = candidates[0];
  const eocd = readExact(descriptor, eocdOffset, archiveSize - eocdOffset, "end-of-central-directory record");
  if (eocd.length !== 22 || eocd.readUInt16LE(20) !== 0) {
    throw new Error("X ZIP archive comments are not supported");
  }
  const legacyDisk = eocd.readUInt16LE(4);
  const legacyCentralDisk = eocd.readUInt16LE(6);
  const legacyOnDisk = eocd.readUInt16LE(8);
  const legacyCount = eocd.readUInt16LE(10);
  const legacySize = eocd.readUInt32LE(12);
  const legacyOffset = eocd.readUInt32LE(16);
  const locatorOffset = eocdOffset - 20;
  const hasZip64 = locatorOffset >= 0 && readExact(descriptor, locatorOffset, 4, "ZIP64 locator signature").readUInt32LE(0) === ZIP64_LOCATOR;
  if (!hasZip64) {
    if ([legacyDisk, legacyCentralDisk, legacyOnDisk, legacyCount].includes(U16_MAX) || [legacySize, legacyOffset].includes(U32_MAX))
      throw new Error("X ZIP archive is missing required ZIP64 end metadata");
    if (legacyDisk !== 0 || legacyCentralDisk !== 0 || legacyOnDisk !== legacyCount) {
      throw new Error("X ZIP multi-disk archives are not supported");
    }
    if (legacyCount < 1 || legacyCount > MAX_ENTRIES || legacySize > MAX_CENTRAL_BYTES) {
      throw new Error("X ZIP central directory exceeds its bounds");
    }
    const end2 = checkedEnd(legacyOffset, legacySize, "central directory");
    if (end2 !== eocdOffset)
      throw new Error("X ZIP central directory has invalid bounds");
    return { count: legacyCount, offset: legacyOffset, end: end2 };
  }
  const locator = readExact(descriptor, locatorOffset, 20, "ZIP64 locator");
  if (locator.readUInt32LE(4) !== 0 || locator.readUInt32LE(16) !== 1) {
    throw new Error("X ZIP multi-disk archives are not supported");
  }
  const zip64Offset = u64(locator, 8, "ZIP64 end record offset");
  const zip64 = readExact(descriptor, zip64Offset, 56, "ZIP64 end record");
  if (zip64.readUInt32LE(0) !== ZIP64_EOCD || u64(zip64, 4, "ZIP64 end record size") !== 44) {
    throw new Error("X ZIP64 end record has an unsupported shape");
  }
  if (zip64Offset + zip64.length !== locatorOffset || zip64.readUInt32LE(16) !== 0 || zip64.readUInt32LE(20) !== 0)
    throw new Error("X ZIP64 end record has invalid bounds or disk ownership");
  const onDisk = u64(zip64, 24, "ZIP64 entries on disk");
  const count = u64(zip64, 32, "ZIP64 entry count");
  const size = u64(zip64, 40, "ZIP64 central directory size");
  const offset = u64(zip64, 48, "ZIP64 central directory offset");
  if (onDisk !== count)
    throw new Error("X ZIP multi-disk archives are not supported");
  if (count < 1 || count > MAX_ENTRIES || size > MAX_CENTRAL_BYTES) {
    throw new Error("X ZIP central directory exceeds its bounds");
  }
  const end = checkedEnd(offset, size, "ZIP64 central directory");
  if (end !== zip64Offset)
    throw new Error("X ZIP64 central directory has invalid bounds");
  fieldValue(legacyDisk, 0, U16_MAX, "disk number");
  fieldValue(legacyCentralDisk, 0, U16_MAX, "central disk number");
  fieldValue(legacyOnDisk, onDisk, U16_MAX, "entries-on-disk count");
  fieldValue(legacyCount, count, U16_MAX, "entry count");
  fieldValue(legacySize, size, U32_MAX, "central directory size");
  fieldValue(legacyOffset, offset, U32_MAX, "central directory offset");
  return { count, offset, end };
}
function extraFields(bytes, label) {
  const fields = new Map;
  let position = 0;
  while (position < bytes.length) {
    if (bytes.length - position < 4)
      throw new Error(`X ZIP ${label} contains a truncated extra field`);
    const id = bytes.readUInt16LE(position);
    const length = bytes.readUInt16LE(position + 2);
    const next = checkedEnd(position + 4, length, `${label} extra field`);
    if (next > bytes.length)
      throw new Error(`X ZIP ${label} contains a truncated extra field`);
    if (fields.has(id))
      throw new Error(`X ZIP ${label} contains duplicate extra field ${id}`);
    fields.set(id, bytes.subarray(position + 4, next));
    position = next;
  }
  return fields;
}
function decodeName(nameBytes, flags, selected) {
  if (nameBytes.length < 1 || nameBytes.length > MAX_NAME_BYTES) {
    throw new Error("X ZIP member name exceeds its bounds");
  }
  let decoded;
  if ((flags & UTF8_FLAG) !== 0) {
    try {
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes);
    } catch (error) {
      throw new Error("X ZIP member name is not valid UTF-8", { cause: error });
    }
  } else {
    if (nameBytes.some((byte) => byte > 127)) {
      throw new Error("X ZIP non-UTF-8 member names must be ASCII");
    }
    decoded = nameBytes.toString("ascii");
  }
  if (decoded.normalize("NFC") !== decoded)
    throw new Error("X ZIP member name is not NFC-normalized");
  if (/^[A-Za-z]:\//u.test(decoded) || decoded.startsWith("/")) {
    throw new Error("X ZIP member has an absolute name");
  }
  if (decoded.includes("\\"))
    throw new Error("X ZIP member name contains a backslash");
  if (/[\u0000-\u001F\u007F-\u009F]/u.test(decoded)) {
    throw new Error("X ZIP member name contains a control character");
  }
  const directory = decoded.endsWith("/");
  const path = directory ? decoded.slice(0, -1) : decoded;
  const parts = path.split("/");
  if (parts.some((part) => part === "." || part === "..") || selected && parts.some((part) => part === "")) {
    throw new Error("X ZIP selected member has an unsafe path component");
  }
  return { name: decoded, directory };
}
function validateFlags(flags, method) {
  if ((flags & (ENCRYPTED_FLAG | STRONG_ENCRYPTION_FLAG)) !== 0) {
    throw new Error("X ZIP encrypted members are not supported");
  }
  if ((flags & MASKED_HEADER_FLAG) !== 0) {
    throw new Error("X ZIP members with masked local headers are not supported");
  }
  const allowed = UTF8_FLAG | DESCRIPTOR_FLAG | (method === DEFLATE ? DEFLATE_OPTION_FLAGS : 0);
  if ((flags & ~allowed) !== 0)
    throw new Error("X ZIP member uses unsupported general-purpose flags");
}
function validateType(entry) {
  const host = entry.versionMadeBy >>> 8;
  const unixType = host === UNIX_HOST || host === MACOS_HOST ? entry.externalAttributes >>> 16 & UNIX_TYPE_MASK : 0;
  if (entry.directory) {
    if (entry.crc32 !== 0 || entry.uncompressedSize !== 0 || entry.method === STORED && entry.compressedSize !== 0)
      throw new Error("X ZIP directory member must expand to empty data");
    if (unixType !== 0 && unixType !== UNIX_DIRECTORY) {
      throw new Error("X ZIP member is a symlink or another non-regular file");
    }
  } else if ((entry.externalAttributes & DOS_DIRECTORY) !== 0 || unixType !== 0 && unixType !== UNIX_REGULAR)
    throw new Error("X ZIP member is not a regular file");
}
function logicalName(name) {
  if (name.startsWith("data/"))
    return name;
  const components = name.split("/");
  return components.length === 3 && components[1] === "data" ? components.slice(1).join("/") : null;
}
function centralEntries(descriptor, directory, archiveSize) {
  const bytes = readExact(descriptor, directory.offset, directory.end - directory.offset, "central directory");
  const entries = [];
  const names = new Set;
  let declared = 0;
  let selectedTotal = 0;
  let position = 0;
  for (let index = 0;index < directory.count; index += 1) {
    if (bytes.length - position < 46 || bytes.readUInt32LE(position) !== CENTRAL) {
      throw new Error("X ZIP central directory entry is invalid or truncated");
    }
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
    if (next > bytes.length)
      throw new Error("X ZIP central directory entry is truncated");
    const nameBytes = Buffer.from(bytes.subarray(position + 46, position + 46 + nameLength));
    const extraStart = position + 46 + nameLength;
    const fields = extraFields(bytes.subarray(extraStart, extraStart + extraLength), `central directory entry ${index + 1}`);
    const zip64 = fields.get(ZIP64_EXTRA) ?? null;
    let zip64Position = 0;
    const nextZip64 = (label) => {
      if (zip64 === null)
        throw new Error(`X ZIP ${label} is missing ZIP64 metadata`);
      const value = u64(zip64, zip64Position, label);
      zip64Position += 8;
      return value;
    };
    const uncompressedSize = uncompressedLegacy === U32_MAX ? nextZip64("uncompressed size") : uncompressedLegacy;
    const compressedSize = compressedLegacy === U32_MAX ? nextZip64("compressed size") : compressedLegacy;
    const localHeaderOffset = offsetLegacy === U32_MAX ? nextZip64("local header offset") : offsetLegacy;
    let disk = diskLegacy;
    if (diskLegacy === U16_MAX) {
      if (zip64 === null || zip64.length - zip64Position < 4) {
        throw new Error("X ZIP disk number is missing ZIP64 metadata");
      }
      disk = zip64.readUInt32LE(zip64Position);
      zip64Position += 4;
    }
    if (zip64 === null && zip64Position !== 0 || zip64 !== null && zip64Position !== zip64.length) {
      throw new Error("X ZIP central directory contains ambiguous ZIP64 metadata");
    }
    if (disk !== 0)
      throw new Error("X ZIP multi-disk archives are not supported");
    validateFlags(flags, method);
    if (method !== STORED && method !== DEFLATE) {
      throw new Error(`X ZIP compression method ${method} is unsupported`);
    }
    const provisional = decodeName(nameBytes, flags, false);
    const selected = !provisional.directory && SELECTED.test(provisional.name);
    const decoded = selected ? decodeName(nameBytes, flags, true) : provisional;
    const entry = {
      name: decoded.name,
      nameBytes,
      directory: decoded.directory,
      selected,
      versionMadeBy,
      versionNeeded,
      flags,
      method,
      modifiedTime,
      modifiedDate,
      crc32: checksum,
      compressedSize,
      uncompressedSize,
      externalAttributes,
      localHeaderOffset
    };
    if (names.has(entry.name))
      throw new Error("X ZIP archive contains duplicate member names");
    names.add(entry.name);
    if (![compressedSize, uncompressedSize, localHeaderOffset].every((value) => Number.isSafeInteger(value) && value >= 0))
      throw new Error("X ZIP member has an invalid size or offset");
    if (compressedSize > archiveSize || localHeaderOffset >= directory.offset) {
      throw new Error("X ZIP member exceeds archive bounds");
    }
    if (method === STORED && compressedSize !== uncompressedSize) {
      throw new Error("X ZIP stored member has inconsistent sizes");
    }
    if (selected && (compressedSize < 1 || uncompressedSize < 1 || compressedSize > MAX_COMPRESSED_MEMBER_BYTES || uncompressedSize > MAX_X_ZIP_MEMBER_BYTES))
      throw new Error("selected X ZIP member exceeds its size bounds");
    if (selected && uncompressedSize > compressedSize * MAX_RATIO) {
      throw new Error("selected X ZIP member exceeds its compression-ratio limit");
    }
    declared += uncompressedSize;
    if (!Number.isSafeInteger(declared) || declared > MAX_TOTAL_DECLARED_BYTES) {
      throw new Error("X ZIP archive exceeds its declared uncompressed-size limit");
    }
    if (selected) {
      selectedTotal += uncompressedSize;
      if (!Number.isSafeInteger(selectedTotal) || selectedTotal > MAX_TOTAL_SELECTED_BYTES) {
        throw new Error("selected X ZIP members exceed their total size limit");
      }
    }
    validateType(entry);
    entries.push(entry);
    position = next;
  }
  if (position !== bytes.length)
    throw new Error("X ZIP central directory contains unindexed data");
  return entries;
}
function localSizes(compressed, uncompressed, fields, label) {
  const zip64 = fields.get(ZIP64_EXTRA) ?? null;
  if (compressed !== U32_MAX && uncompressed !== U32_MAX) {
    if (zip64 !== null)
      throw new Error(`X ZIP ${label} contains redundant ZIP64 size metadata`);
    return { compressed, uncompressed, zip64: false };
  }
  if (zip64 === null)
    throw new Error(`X ZIP ${label} is missing ZIP64 size metadata`);
  let position = 0;
  let resolvedUncompressed = uncompressed;
  let resolvedCompressed = compressed;
  if (uncompressed === U32_MAX) {
    resolvedUncompressed = u64(zip64, position, `${label} uncompressed size`);
    position += 8;
  }
  if (compressed === U32_MAX) {
    resolvedCompressed = u64(zip64, position, `${label} compressed size`);
    position += 8;
  }
  if (position !== zip64.length)
    throw new Error(`X ZIP ${label} contains ambiguous ZIP64 size metadata`);
  return { compressed: resolvedCompressed, uncompressed: resolvedUncompressed, zip64: true };
}
function validateDescriptor(bytes, entry) {
  let position = 0;
  if (bytes.length === 16 || bytes.length === 24) {
    if (bytes.readUInt32LE(0) !== DESCRIPTOR)
      throw new Error("X ZIP data descriptor signature is invalid");
    position = 4;
  } else if (bytes.length !== 12 && bytes.length !== 20) {
    throw new Error("X ZIP data descriptor has an invalid length");
  }
  if (bytes.readUInt32LE(position) !== entry.crc32) {
    throw new Error("X ZIP data descriptor checksum disagrees with the central directory");
  }
  position += 4;
  const zip64 = bytes.length - position === 16;
  const compressed = zip64 ? u64(bytes, position, "descriptor compressed size") : bytes.readUInt32LE(position);
  position += zip64 ? 8 : 4;
  const uncompressed = zip64 ? u64(bytes, position, "descriptor uncompressed size") : bytes.readUInt32LE(position);
  if (compressed !== entry.compressedSize || uncompressed !== entry.uncompressedSize) {
    throw new Error("X ZIP data descriptor sizes disagree with the central directory");
  }
}
function localRanges(descriptor, entries, centralOffset) {
  const ordered = [...entries].sort((left, right) => left.localHeaderOffset - right.localHeaderOffset);
  const ranges = new Map;
  let expected = 0;
  for (const [index, entry] of ordered.entries()) {
    const label = `local member ${index + 1}`;
    const offset = entry.localHeaderOffset;
    if (offset !== expected) {
      throw new Error(offset < expected ? "X ZIP local member ranges overlap" : "X ZIP archive contains unindexed local data");
    }
    const header = readExact(descriptor, offset, 30, `${label} header`);
    if (header.readUInt32LE(0) !== LOCAL)
      throw new Error("X ZIP local header signature is invalid");
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
    if (version !== entry.versionNeeded || flags !== entry.flags || method !== entry.method || modifiedTime !== entry.modifiedTime || modifiedDate !== entry.modifiedDate)
      throw new Error("X ZIP local header disagrees with the central directory");
    const variable = readExact(descriptor, offset + 30, nameLength + extraLength, `${label} fields`);
    if (!variable.subarray(0, nameLength).equals(entry.nameBytes)) {
      throw new Error("X ZIP local member name disagrees with the central directory");
    }
    const fields = extraFields(variable.subarray(nameLength), `${label} header`);
    const sizes = localSizes(compressedLegacy, uncompressedLegacy, fields, `${label} header`);
    if ((flags & DESCRIPTOR_FLAG) === 0) {
      if (checksum !== entry.crc32 || sizes.compressed !== entry.compressedSize || sizes.uncompressed !== entry.uncompressedSize)
        throw new Error("X ZIP local sizes or checksum disagree with the central directory");
    } else if (checksum !== 0 && checksum !== entry.crc32 || sizes.compressed !== 0 && sizes.compressed !== entry.compressedSize || sizes.uncompressed !== 0 && sizes.uncompressed !== entry.uncompressedSize)
      throw new Error("X ZIP local descriptor placeholders disagree with the central directory");
    const dataOffset = checkedEnd(offset + 30, nameLength + extraLength, "local member data offset");
    const dataEnd = checkedEnd(dataOffset, entry.compressedSize, "local member compressed data");
    const next = index + 1 < ordered.length ? ordered[index + 1].localHeaderOffset : centralOffset;
    if (dataEnd > next)
      throw new Error("X ZIP local member ranges overlap");
    if ((flags & DESCRIPTOR_FLAG) === 0) {
      if (dataEnd !== next)
        throw new Error("X ZIP archive contains unindexed local data");
    } else {
      const descriptorLength = next - dataEnd;
      const allowedLengths = sizes.zip64 ? [20, 24] : [12, 16];
      if (!allowedLengths.includes(descriptorLength)) {
        throw new Error("X ZIP data descriptor has an invalid width");
      }
      validateDescriptor(readExact(descriptor, dataEnd, descriptorLength, `${label} descriptor`), entry);
    }
    ranges.set(offset, { dataOffset, dataEnd });
    expected = next;
  }
  if (expected !== centralOffset)
    throw new Error("X ZIP archive contains unindexed local data");
  return ranges;
}
function readSelected(descriptor, entry, range) {
  const compressed = readExact(descriptor, range.dataOffset, range.dataEnd - range.dataOffset, `selected member ${entry.name}`);
  let output;
  try {
    output = entry.method === STORED ? Buffer.from(compressed) : inflateRawSync(compressed, {
      maxOutputLength: Math.min(MAX_X_ZIP_MEMBER_BYTES + 1, entry.uncompressedSize + 1)
    });
  } catch (error) {
    throw new Error(`selected X ZIP member is invalid: ${entry.name}`, { cause: error });
  }
  if (output.length !== entry.uncompressedSize) {
    throw new Error("selected X ZIP member has an incorrect output size");
  }
  if ((updateCrc32(4294967295, output) ^ 4294967295) >>> 0 !== entry.crc32) {
    throw new Error("selected X ZIP member failed its CRC-32 check");
  }
  const logical = logicalName(entry.name);
  if (logical === null)
    throw new Error("X ZIP selected member has an unsupported root");
  return { memberName: entry.name, logicalName: logical, bytes: output };
}
function extractXArchiveFile(descriptor, archiveSize) {
  if (!Number.isSafeInteger(descriptor) || descriptor < 0)
    throw new Error("X ZIP descriptor is invalid");
  if (!Number.isSafeInteger(archiveSize) || archiveSize < 1 || archiveSize > MAX_X_ZIP_ARCHIVE_BYTES) {
    throw new Error("X archive size is invalid");
  }
  const directory = directoryFromEocd(descriptor, archiveSize);
  const entries = centralEntries(descriptor, directory, archiveSize);
  const ranges = localRanges(descriptor, entries, directory.offset);
  const selected = new Map;
  for (const entry of entries) {
    if (!entry.selected)
      continue;
    const range = ranges.get(entry.localHeaderOffset);
    if (range === undefined)
      throw new Error("X ZIP selected member has no validated local range");
    const member = readSelected(descriptor, entry, range);
    if (selected.has(member.logicalName)) {
      throw new Error("X ZIP archive contains a duplicate selected member");
    }
    selected.set(member.logicalName, member);
  }
  const manifest = selected.get("data/manifest.js");
  const account = selected.get("data/account.js");
  const directMessages = selected.get("data/direct-messages.js") ?? null;
  const groupDirectMessages = selected.get("data/direct-messages-group.js") ?? null;
  if (manifest === undefined || account === undefined) {
    throw new Error("X archive must contain data/manifest.js and data/account.js");
  }
  if (directMessages === null && groupDirectMessages === null) {
    throw new Error("X archive must contain at least one direct-message member");
  }
  const allowed = new Set([
    "data/manifest.js",
    "data/account.js",
    "data/direct-messages.js",
    "data/direct-messages-group.js",
    "data/direct-message-headers.js",
    "data/direct-message-group-headers.js",
    "data/tweets.js",
    "data/deleted-tweets.js",
    "data/community-tweet.js"
  ]);
  const unsupported = [...selected.keys()].find((name) => !allowed.has(name));
  if (unsupported !== undefined) {
    throw new Error(`X archive contains an unsupported additional direct-message part: ${unsupported}`);
  }
  return {
    manifest,
    account,
    directMessages,
    groupDirectMessages,
    directMessageHeaders: selected.get("data/direct-message-headers.js") ?? null,
    groupDirectMessageHeaders: selected.get("data/direct-message-group-headers.js") ?? null,
    identityMetadata: [
      selected.get("data/tweets.js"),
      selected.get("data/deleted-tweets.js"),
      selected.get("data/community-tweet.js")
    ].filter((member) => member !== undefined)
  };
}

// src/x-archive.ts
var MAX_CONVERSATIONS = 500000;
var MAX_EVENTS = 2000000;
var MAX_EVENT_PARTICIPANTS = 512;
var MAX_TWEETS = 2000000;
var MAX_TWEET_MENTIONS = 1e5;
var MAX_TEXT_BYTES = 1024 * 1024;
var MAX_URLS = 100;
var MAX_MEDIA = 100;
var MAX_REACTIONS = 1000;
var MAX_EDITS = 100;
var PROVIDER_ID = /^[1-9][0-9]{0,39}$/u;
var OPAQUE_PROVIDER_ID = /^-?[0-9]{1,40}$/u;
var HANDLE = /^[A-Za-z0-9_]{1,15}$/u;
function sha2563(value) {
  return createHash5("sha256").update(value).digest("hex");
}
function plain(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}
function exactKeys2(value, allowed, label) {
  const reviewed = new Set(allowed);
  const unexpected = Object.keys(value).find((key) => !reviewed.has(key));
  if (unexpected !== undefined)
    throw new Error(`${label} contains unreviewed property ${unexpected}`);
}
function dense(value, label, maximum) {
  if (!Array.isArray(value))
    throw new Error(`${label} must be an array`);
  if (value.length > maximum)
    throw new Error(`${label} exceeds its item limit`);
  for (let index = 0;index < value.length; index += 1) {
    if (!Object.hasOwn(value, index))
      throw new Error(`${label} must not be sparse`);
  }
  return value;
}
function text2(value, label, maximum = MAX_TEXT_BYTES, required = false) {
  if (value === undefined || value === null || value === "") {
    if (required)
      throw new Error(`${label} is required`);
    return null;
  }
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > maximum || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(value))
    throw new Error(`${label} is invalid`);
  return value;
}
function providerId(value, label) {
  if (typeof value !== "string" || !PROVIDER_ID.test(value)) {
    throw new Error(`${label} must be an exact X user ID string`);
  }
  return value;
}
function optionalProviderId(value, label) {
  if (value === undefined || value === null || value === "")
    return null;
  return providerId(value, label);
}
function optionalOpaqueProviderId(value, label) {
  if (value === undefined || value === null || value === "")
    return null;
  if (typeof value !== "string" || !OPAQUE_PROVIDER_ID.test(value)) {
    throw new Error(`${label} is not a reviewed X user ID string`);
  }
  return value;
}
function username(value, label) {
  const parsed = text2(value, label, 64, true);
  if (!HANDLE.test(parsed))
    throw new Error(`${label} is not an exact X username`);
  return parsed;
}
function timestamp(value, label) {
  const parsed = text2(value, label, 128, true);
  const milliseconds = Date.parse(parsed);
  if (!Number.isFinite(milliseconds))
    throw new Error(`${label} is not a timestamp`);
  return new Date(milliseconds).toISOString();
}
function countString(value, label, maximum) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error(`${label} must be an exact decimal count string`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
    throw new Error(`${label} exceeds its count bound`);
  }
  return parsed;
}
function assignment(member, prefix) {
  if (member.bytes.byteLength > MAX_X_ZIP_MEMBER_BYTES) {
    throw new Error(`X archive member exceeds its limit: ${member.logicalName}`);
  }
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(member.bytes);
  } catch (error) {
    throw new Error(`X archive member is not UTF-8: ${member.logicalName}`, { cause: error });
  }
  if (!source.startsWith(prefix)) {
    throw new Error(`X archive member has an unexpected assignment: ${member.logicalName}`);
  }
  let payload = source.slice(prefix.length).trim();
  if (payload.endsWith(";"))
    payload = payload.slice(0, -1).trimEnd();
  try {
    return JSON.parse(payload);
  } catch (error) {
    throw new Error(`X archive member contains invalid assignment JSON: ${member.logicalName}`, { cause: error });
  }
}
function ytdAssignment(member, binding) {
  return assignment(member, `window.YTD.${binding}.part0 = `);
}
function manifestFile(dataTypes, key, expectedFileName, expectedGlobalName, maximum, required, media) {
  const raw = dataTypes[key];
  if (raw === undefined) {
    if (required)
      throw new Error(`X manifest is missing dataTypes.${key}`);
    return null;
  }
  const declaration = plain(raw, `X manifest dataTypes.${key}`);
  exactKeys2(declaration, media ? ["mediaDirectory", "files"] : ["files"], `X manifest dataTypes.${key}`);
  if (media)
    text2(declaration.mediaDirectory, `X manifest dataTypes.${key}.mediaDirectory`, 1024, true);
  const files = dense(declaration.files, `X manifest dataTypes.${key}.files`, 2);
  if (files.length !== 1) {
    throw new Error(`X manifest dataTypes.${key} declares unsupported additional parts`);
  }
  const file = plain(files[0], `X manifest dataTypes.${key}.files[0]`);
  exactKeys2(file, ["fileName", "globalName", "count"], `X manifest dataTypes.${key}.files[0]`);
  const fileName = text2(file.fileName, `X manifest dataTypes.${key}.files[0].fileName`, 1024, true);
  const globalName = text2(file.globalName, `X manifest dataTypes.${key}.files[0].globalName`, 1024, true);
  if (fileName !== expectedFileName || globalName !== expectedGlobalName) {
    throw new Error(`X manifest dataTypes.${key} declares an unsupported part`);
  }
  return {
    fileName,
    globalName,
    count: countString(file.count, `X manifest dataTypes.${key}.files[0].count`, maximum)
  };
}
function parseManifest2(member) {
  const root = plain(assignment(member, "window.__THAR_CONFIG = "), "X manifest");
  exactKeys2(root, ["userInfo", "archiveInfo", "readmeInfo", "dataTypes"], "X manifest");
  const userInfo = plain(root.userInfo, "X manifest userInfo");
  exactKeys2(userInfo, ["accountId", "userName", "displayName"], "X manifest userInfo");
  const accountId = providerId(userInfo.accountId, "X manifest userInfo.accountId");
  const handle = username(userInfo.userName, "X manifest userInfo.userName");
  const displayName = text2(userInfo.displayName, "X manifest userInfo.displayName", 1024, true);
  const archiveInfo = plain(root.archiveInfo, "X manifest archiveInfo");
  exactKeys2(archiveInfo, ["sizeBytes", "generationDate", "isPartialArchive", "maxPartSizeBytes"], "X manifest archiveInfo");
  const declaredSizeBytes = countString(archiveInfo.sizeBytes, "X manifest archiveInfo.sizeBytes", MAX_X_ZIP_ARCHIVE_BYTES * 4);
  countString(archiveInfo.maxPartSizeBytes, "X manifest archiveInfo.maxPartSizeBytes", MAX_X_ZIP_ARCHIVE_BYTES * 16);
  const generationDate = timestamp(archiveInfo.generationDate, "X manifest archiveInfo.generationDate");
  if (typeof archiveInfo.isPartialArchive !== "boolean") {
    throw new Error("X manifest archiveInfo.isPartialArchive must be a boolean");
  }
  const readmeInfo = plain(root.readmeInfo, "X manifest readmeInfo");
  exactKeys2(readmeInfo, ["fileName", "directory", "name"], "X manifest readmeInfo");
  for (const key of ["fileName", "directory", "name"]) {
    text2(readmeInfo[key], `X manifest readmeInfo.${key}`, 1024, true);
  }
  const dataTypes = plain(root.dataTypes, "X manifest dataTypes");
  const account = manifestFile(dataTypes, "account", "data/account.js", "YTD.account.part0", 1, true, false);
  if (account.count !== 1)
    throw new Error("X manifest must declare exactly one account record");
  const directMessages = manifestFile(dataTypes, "directMessages", "data/direct-messages.js", "YTD.direct_messages.part0", MAX_CONVERSATIONS, false, true);
  const groupDirectMessages = manifestFile(dataTypes, "directMessagesGroup", "data/direct-messages-group.js", "YTD.direct_messages_group.part0", MAX_CONVERSATIONS, false, true);
  if (directMessages === null && groupDirectMessages === null) {
    throw new Error("X manifest must declare at least one direct-message member");
  }
  return {
    generationDate,
    isPartialArchive: archiveInfo.isPartialArchive,
    declaredSizeBytes,
    userInfo: { accountId, username: handle, displayName },
    declarations: {
      account,
      directMessages,
      groupDirectMessages,
      directMessageHeaders: manifestFile(dataTypes, "directMessageHeaders", "data/direct-message-headers.js", "YTD.direct_message_headers.part0", MAX_CONVERSATIONS, false, false),
      groupDirectMessageHeaders: manifestFile(dataTypes, "directMessageGroupHeaders", "data/direct-message-group-headers.js", "YTD.direct_message_group_headers.part0", MAX_CONVERSATIONS, false, false)
    }
  };
}
function parseAccount(member) {
  const values = dense(ytdAssignment(member, "account"), `${member.logicalName} root`, 1);
  if (values.length !== 1)
    throw new Error("X archive must contain exactly one account record");
  const wrapper = plain(values[0], `${member.logicalName}[0]`);
  exactKeys2(wrapper, ["account"], `${member.logicalName}[0]`);
  const account = plain(wrapper.account, `${member.logicalName}[0].account`);
  exactKeys2(account, ["email", "createdVia", "username", "accountId", "createdAt", "accountDisplayName"], `${member.logicalName}[0].account`);
  return {
    providerUserId: providerId(account.accountId, `${member.logicalName}.accountId`),
    username: username(account.username, `${member.logicalName}.username`),
    displayName: text2(account.accountDisplayName, `${member.logicalName}.accountDisplayName`, 1024),
    email: text2(account.email, `${member.logicalName}.email`, 8192),
    createdAt: account.createdAt === undefined || account.createdAt === null || account.createdAt === "" ? null : timestamp(account.createdAt, `${member.logicalName}.createdAt`),
    createdVia: text2(account.createdVia, `${member.logicalName}.createdVia`, 1024)
  };
}
function idArray(value, label) {
  const ids = dense(value, label, MAX_EVENT_PARTICIPANTS).map((item, index) => providerId(item, `${label}[${index}]`));
  if (new Set(ids).size !== ids.length)
    throw new Error(`${label} repeats an X user ID`);
  return ids.sort();
}
function parseEdits(value, label) {
  if (value === undefined)
    return [];
  const edits = dense(value, label, MAX_EDITS).map((item, index) => {
    const editLabel = `${label}[${index}]`;
    const edit = plain(item, editLabel);
    exactKeys2(edit, ["createdAtSec", "editedText"], editLabel);
    const seconds = text2(edit.createdAtSec, `${editLabel}.createdAtSec`, 16, true);
    const parsed = Number(seconds);
    if (!/^[0-9]{1,16}$/u.test(seconds) || !Number.isSafeInteger(parsed) || parsed > 253402300799)
      throw new Error(`${editLabel}.createdAtSec is invalid`);
    return {
      createdAtSec: seconds,
      createdAt: new Date(parsed * 1000).toISOString(),
      editedText: text2(edit.editedText, `${editLabel}.editedText`, MAX_TEXT_BYTES, true)
    };
  });
  return edits.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.editedText.localeCompare(right.editedText));
}
function countedUrls(value, label) {
  if (value === undefined)
    return 0;
  const urls = dense(value, label, MAX_URLS);
  for (const [index, value2] of urls.entries()) {
    const url = plain(value2, `${label}[${index}]`);
    exactKeys2(url, ["url", "expanded", "display"], `${label}[${index}]`);
    for (const key of Object.keys(url))
      text2(url[key], `${label}[${index}].${key}`, 8192, true);
  }
  return urls.length;
}
function countedMedia(value, label) {
  if (value === undefined)
    return 0;
  const media = dense(value, label, MAX_MEDIA);
  for (const [index, item] of media.entries())
    text2(item, `${label}[${index}]`, 8192, true);
  return media.length;
}
function parseReactions(value, label, seenReactionIds) {
  if (value === undefined)
    return [];
  const reactions = dense(value, label, MAX_REACTIONS).map((item, index) => {
    const reactionLabel = `${label}[${index}]`;
    const reaction = plain(item, reactionLabel);
    exactKeys2(reaction, ["senderId", "reactionKey", "eventId", "createdAt"], reactionLabel);
    const eventId = providerId(reaction.eventId, `${reactionLabel}.eventId`);
    if (seenReactionIds.has(eventId))
      throw new Error(`${reactionLabel} repeats an X reaction event ID`);
    seenReactionIds.add(eventId);
    return {
      eventId,
      senderId: providerId(reaction.senderId, `${reactionLabel}.senderId`),
      reactionKey: text2(reaction.reactionKey, `${reactionLabel}.reactionKey`, 128, true),
      createdAt: timestamp(reaction.createdAt, `${reactionLabel}.createdAt`)
    };
  });
  return reactions.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.eventId.localeCompare(right.eventId));
}
function parseMessageCreate(value, label, seenMessageIds, seenReactionIds) {
  const message = plain(value, label);
  exactKeys2(message, ["recipientId", "text", "reactions", "urls", "mediaUrls", "senderId", "id", "createdAt", "editHistory"], label);
  const id = providerId(message.id, `${label}.id`);
  if (seenMessageIds.has(id))
    throw new Error(`${label} repeats an X message ID`);
  seenMessageIds.add(id);
  return {
    kind: "message-create",
    id,
    senderId: providerId(message.senderId, `${label}.senderId`),
    recipientId: optionalProviderId(message.recipientId, `${label}.recipientId`),
    createdAt: timestamp(message.createdAt, `${label}.createdAt`),
    text: text2(message.text, `${label}.text`),
    urlCount: countedUrls(message.urls, `${label}.urls`),
    mediaCount: countedMedia(message.mediaUrls, `${label}.mediaUrls`),
    editHistory: parseEdits(message.editHistory, `${label}.editHistory`),
    activeReactions: parseReactions(message.reactions, `${label}.reactions`, seenReactionIds),
    replyToMessageId: null
  };
}
function parseMembershipEvent(value, label, sourceKind) {
  const event = plain(value, label);
  const allowed = sourceKind === "participantsLeave" ? ["userIds", "createdAt"] : ["initiatingUserId", "participantsSnapshot", "userIds", "createdAt"];
  exactKeys2(event, allowed, label);
  const participantSnapshotIds = event.participantsSnapshot === undefined ? [] : idArray(event.participantsSnapshot, `${label}.participantsSnapshot`);
  const userIds = event.userIds === undefined ? [] : idArray(event.userIds, `${label}.userIds`);
  if (sourceKind === "participantsLeave" && event.userIds === undefined) {
    throw new Error(`${label}.userIds is required`);
  }
  if (sourceKind !== "participantsLeave" && participantSnapshotIds.length === 0 && userIds.length === 0) {
    throw new Error(`${label} has no participant inventory`);
  }
  return {
    kind: sourceKind === "joinConversation" ? "join-conversation" : sourceKind === "participantsJoin" ? "participants-join" : "participants-leave",
    initiatingUserId: optionalProviderId(event.initiatingUserId, `${label}.initiatingUserId`),
    participantSnapshotIds,
    userIds,
    createdAt: timestamp(event.createdAt, `${label}.createdAt`)
  };
}
function parseNameUpdate(value, label) {
  const event = plain(value, label);
  exactKeys2(event, ["initiatingUserId", "name", "createdAt"], label);
  return {
    kind: "conversation-name-update",
    initiatingUserId: optionalProviderId(event.initiatingUserId, `${label}.initiatingUserId`),
    name: text2(event.name, `${label}.name`, 1024, true),
    createdAt: timestamp(event.createdAt, `${label}.createdAt`)
  };
}
function eventSortKey(event) {
  if (event.kind === "message-create")
    return `0\x00${event.id}`;
  if (event.kind === "conversation-name-update")
    return `4\x00${event.initiatingUserId ?? ""}\x00${event.name}`;
  return `${event.kind === "join-conversation" ? "1" : event.kind === "participants-join" ? "2" : "3"}\x00${event.initiatingUserId ?? ""}\x00${event.userIds.join("\x00")}`;
}
function headerSignature(message) {
  return JSON.stringify([message.id, message.senderId, message.recipientId, message.createdAt]);
}
function eventHeaderSignature(event) {
  if (event.kind === "message-create")
    return `message\x00${headerSignature(event)}`;
  if (event.kind === "conversation-name-update") {
    return JSON.stringify([event.kind, event.initiatingUserId, event.name, event.createdAt]);
  }
  return JSON.stringify([
    event.kind,
    event.initiatingUserId,
    event.participantSnapshotIds,
    event.userIds,
    event.createdAt
  ]);
}
function parseConversations(member, selfId, group, seenConversationIds, seenMessageIds, seenReactionIds) {
  const binding = group ? "direct_messages_group" : "direct_messages";
  const values = dense(ytdAssignment(member, binding), `${member.logicalName} root`, MAX_CONVERSATIONS);
  const combined = new Map;
  let totalEvents = 0;
  for (const [recordIndex, value] of values.entries()) {
    const label = `${member.logicalName}[${recordIndex}]`;
    const wrapper = plain(value, label);
    exactKeys2(wrapper, ["dmConversation"], label);
    const conversation = plain(wrapper.dmConversation, `${label}.dmConversation`);
    exactKeys2(conversation, ["conversationId", "messages"], `${label}.dmConversation`);
    const conversationId = text2(conversation.conversationId, `${label}.dmConversation.conversationId`, 256, true);
    if (!/^[0-9]+(?:-[0-9]+)?$/u.test(conversationId)) {
      throw new Error(`${label}.dmConversation.conversationId is invalid`);
    }
    let state = combined.get(conversationId);
    if (state === undefined) {
      if (seenConversationIds.has(conversationId)) {
        throw new Error(`${label} repeats an X conversation across direct and group members`);
      }
      seenConversationIds.add(conversationId);
      state = { participants: new Set([selfId]), events: [] };
      combined.set(conversationId, state);
    }
    const participants = state.participants;
    const directIds = group ? null : conversationId.split("-").map((id, index) => providerId(id, `${label}.conversationId[${index}]`));
    if (directIds !== null) {
      if (directIds.length !== 2 || !directIds.includes(selfId)) {
        throw new Error(`${label}.conversationId is not bound to the archive account`);
      }
      for (const id of directIds)
        participants.add(id);
      if (participants.size !== 2)
        throw new Error(`${label}.conversationId does not identify a direct-message peer`);
    }
    for (const [eventIndex, item] of dense(conversation.messages, `${label}.dmConversation.messages`, MAX_EVENTS).entries()) {
      totalEvents += 1;
      if (totalEvents > MAX_EVENTS)
        throw new Error(`${member.logicalName} exceeds its event limit`);
      const eventLabel = `${label}.dmConversation.messages[${eventIndex}]`;
      const event = plain(item, eventLabel);
      const keys = Object.keys(event);
      if (keys.length !== 1)
        throw new Error(`${eventLabel} must contain exactly one event`);
      const sourceKind = keys[0];
      let parsed;
      if (sourceKind === "messageCreate") {
        parsed = parseMessageCreate(event.messageCreate, `${eventLabel}.messageCreate`, seenMessageIds, seenReactionIds);
        participants.add(parsed.senderId);
        if (parsed.recipientId !== null)
          participants.add(parsed.recipientId);
        for (const reaction of parsed.activeReactions)
          participants.add(reaction.senderId);
      } else if (sourceKind === "joinConversation" || sourceKind === "participantsJoin" || sourceKind === "participantsLeave") {
        parsed = parseMembershipEvent(event[sourceKind], `${eventLabel}.${sourceKind}`, sourceKind);
        if (parsed.initiatingUserId !== null)
          participants.add(parsed.initiatingUserId);
        for (const id of [...parsed.participantSnapshotIds, ...parsed.userIds])
          participants.add(id);
      } else if (sourceKind === "conversationNameUpdate") {
        parsed = parseNameUpdate(event.conversationNameUpdate, `${eventLabel}.conversationNameUpdate`);
        if (parsed.initiatingUserId !== null)
          participants.add(parsed.initiatingUserId);
      } else {
        throw new Error(`${eventLabel} contains unreviewed event ${sourceKind}`);
      }
      if (directIds !== null && [...participants].some((id) => !directIds.includes(id))) {
        throw new Error(`${eventLabel} names a user outside its direct conversation`);
      }
      state.events.push(parsed);
    }
  }
  const signatures = new Map;
  const conversations = [...combined.entries()].map(([conversationId, state]) => {
    const orderedEvents = state.events.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || eventSortKey(left).localeCompare(eventSortKey(right)));
    signatures.set(conversationId, orderedEvents.filter((event) => event.kind === "message-create").map(eventHeaderSignature).sort());
    return {
      conversationId,
      kind: group ? "group" : "direct",
      participantIds: [...state.participants].sort(),
      events: orderedEvents
    };
  });
  return {
    recordCount: values.length,
    conversations: conversations.sort((left, right) => left.conversationId.localeCompare(right.conversationId)),
    headerSignatures: signatures
  };
}
function parseHeaders(member, group) {
  const binding = group ? "direct_message_group_headers" : "direct_message_headers";
  const values = dense(ytdAssignment(member, binding), `${member.logicalName} root`, MAX_CONVERSATIONS);
  const result = new Map;
  let total = 0;
  for (const [recordIndex, value] of values.entries()) {
    const label = `${member.logicalName}[${recordIndex}]`;
    const wrapper = plain(value, label);
    exactKeys2(wrapper, ["dmConversation"], label);
    const conversation = plain(wrapper.dmConversation, `${label}.dmConversation`);
    exactKeys2(conversation, ["conversationId", "messages"], `${label}.dmConversation`);
    const id = text2(conversation.conversationId, `${label}.conversationId`, 256, true);
    if (!/^[0-9]+(?:-[0-9]+)?$/u.test(id))
      throw new Error(`${label}.conversationId is invalid`);
    const signatures = [...result.get(id) ?? []];
    for (const [eventIndex, item] of dense(conversation.messages, `${label}.messages`, MAX_EVENTS).entries()) {
      total += 1;
      if (total > MAX_EVENTS)
        throw new Error(`${member.logicalName} exceeds its event limit`);
      const eventLabel = `${label}.messages[${eventIndex}]`;
      const event = plain(item, eventLabel);
      const keys = Object.keys(event);
      if (keys.length !== 1)
        throw new Error(`${eventLabel} must contain exactly one event`);
      const sourceKind = keys[0];
      let parsed;
      if (sourceKind === "messageCreate") {
        const message = plain(event.messageCreate, `${eventLabel}.messageCreate`);
        exactKeys2(message, group ? ["id", "senderId", "createdAt"] : ["id", "senderId", "recipientId", "createdAt"], `${eventLabel}.messageCreate`);
        parsed = {
          kind: "message-create",
          id: providerId(message.id, `${eventLabel}.messageCreate.id`),
          senderId: providerId(message.senderId, `${eventLabel}.messageCreate.senderId`),
          recipientId: optionalProviderId(message.recipientId, `${eventLabel}.messageCreate.recipientId`),
          createdAt: timestamp(message.createdAt, `${eventLabel}.messageCreate.createdAt`),
          text: null,
          urlCount: 0,
          mediaCount: 0,
          editHistory: [],
          activeReactions: [],
          replyToMessageId: null
        };
      } else if (sourceKind === "joinConversation" || sourceKind === "participantsJoin" || sourceKind === "participantsLeave") {
        parsed = parseMembershipEvent(event[sourceKind], `${eventLabel}.${sourceKind}`, sourceKind);
      } else if (sourceKind === "conversationNameUpdate") {
        parsed = parseNameUpdate(event.conversationNameUpdate, `${eventLabel}.conversationNameUpdate`);
      } else {
        throw new Error(`${eventLabel} contains unreviewed event ${sourceKind}`);
      }
      if (parsed.kind === "message-create")
        signatures.push(eventHeaderSignature(parsed));
    }
    result.set(id, signatures.sort());
  }
  return { recordCount: values.length, signatures: result };
}
function assertHeaderParity(body, header, label) {
  if (body.size !== header.size)
    throw new Error(`${label} conversation count disagrees with its DM body`);
  for (const [conversationId, bodyMessages] of body) {
    const headerMessages = header.get(conversationId);
    if (headerMessages === undefined) {
      throw new Error(`${label} omits body conversation ${conversationId}`);
    }
    if (bodyMessages.length !== headerMessages.length) {
      throw new Error(`${label} disagrees with its DM body for conversation ${conversationId}: ${headerMessages.length} header events versus ${bodyMessages.length} body events`);
    }
    if (bodyMessages.some((value, index) => value !== headerMessages[index])) {
      throw new Error(`${label} disagrees with its DM body event coordinates for conversation ${conversationId}`);
    }
  }
}
var REVIEWED_TWEET_KEYS = [
  "community_id",
  "community_id_str",
  "contributors",
  "coordinates",
  "created_at",
  "deleted_at",
  "display_text_range",
  "edit_info",
  "entities",
  "extended_entities",
  "extended_tweet",
  "favorite_count",
  "favorited",
  "filter_level",
  "full_text",
  "geo",
  "id",
  "id_str",
  "in_reply_to_screen_name",
  "in_reply_to_status_id",
  "in_reply_to_status_id_str",
  "in_reply_to_user_id",
  "in_reply_to_user_id_str",
  "is_quote_status",
  "lang",
  "matching_rules",
  "place",
  "possibly_sensitive",
  "possibly_sensitive_appealable",
  "quoted_status",
  "quoted_status_id",
  "quoted_status_id_str",
  "quoted_status_permalink",
  "retweet_count",
  "retweeted",
  "retweeted_status",
  "scopes",
  "source",
  "text",
  "truncated",
  "withheld_copyright",
  "withheld_in_countries",
  "withheld_scope"
];
var REVIEWED_ENTITY_KEYS = ["hashtags", "media", "symbols", "timestamps", "urls", "user_mentions"];
var REVIEWED_MENTION_KEYS = ["id", "id_str", "indices", "name", "screen_name"];
function tweetBinding(member) {
  if (member.logicalName === "data/tweets.js")
    return { binding: "tweets", source: member.logicalName };
  if (member.logicalName === "data/deleted-tweets.js")
    return { binding: "deleted_tweets", source: member.logicalName };
  if (member.logicalName === "data/community-tweet.js")
    return { binding: "community_tweet", source: member.logicalName };
  throw new Error(`X archive identity member is not allowlisted: ${member.logicalName}`);
}
function parseIdentityObservations(member) {
  const source = tweetBinding(member);
  const values = dense(ytdAssignment(member, source.binding), `${member.logicalName} root`, MAX_TWEETS);
  const observations = [];
  let mentionTotal = 0;
  for (const [recordIndex, value] of values.entries()) {
    const label = `${member.logicalName}[${recordIndex}]`;
    const wrapper = plain(value, label);
    exactKeys2(wrapper, ["tweet"], label);
    const tweet = plain(wrapper.tweet, `${label}.tweet`);
    exactKeys2(tweet, REVIEWED_TWEET_KEYS, `${label}.tweet`);
    const observedAt = timestamp(tweet.created_at, `${label}.tweet.created_at`);
    let identityRecord = 0;
    const replyId = optionalOpaqueProviderId(tweet.in_reply_to_user_id, `${label}.tweet.in_reply_to_user_id`);
    const replyIdString = optionalOpaqueProviderId(tweet.in_reply_to_user_id_str, `${label}.tweet.in_reply_to_user_id_str`);
    if (replyId !== null && replyIdString !== null && replyId !== replyIdString) {
      throw new Error(`${label}.tweet reply user IDs disagree`);
    }
    const rawReplyHandle = text2(tweet.in_reply_to_screen_name, `${label}.tweet.in_reply_to_screen_name`, 64);
    const replyHandle = rawReplyHandle === null ? null : username(rawReplyHandle, `${label}.tweet.in_reply_to_screen_name`);
    const effectiveReplyId = replyIdString ?? replyId;
    if (effectiveReplyId !== null && replyHandle !== null && PROVIDER_ID.test(effectiveReplyId)) {
      identityRecord += 1;
      observations.push({
        kind: "reply",
        providerUserId: effectiveReplyId,
        username: replyHandle,
        displayName: null,
        observedAt,
        sourceMember: source.source,
        sourceRecord: recordIndex + 1,
        identityRecord
      });
    }
    if (tweet.entities === undefined || tweet.entities === null)
      continue;
    const entities = plain(tweet.entities, `${label}.tweet.entities`);
    exactKeys2(entities, REVIEWED_ENTITY_KEYS, `${label}.tweet.entities`);
    if (entities.user_mentions === undefined || entities.user_mentions === null)
      continue;
    const mentions = dense(entities.user_mentions, `${label}.tweet.entities.user_mentions`, MAX_TWEET_MENTIONS);
    mentionTotal += mentions.length;
    if (mentionTotal > MAX_TWEET_MENTIONS)
      throw new Error(`${member.logicalName} exceeds its mention limit`);
    for (const [mentionIndex, value2] of mentions.entries()) {
      const mentionLabel = `${label}.tweet.entities.user_mentions[${mentionIndex}]`;
      const mention = plain(value2, mentionLabel);
      exactKeys2(mention, REVIEWED_MENTION_KEYS, mentionLabel);
      const id = optionalOpaqueProviderId(mention.id, `${mentionLabel}.id`);
      const idString = optionalOpaqueProviderId(mention.id_str, `${mentionLabel}.id_str`);
      if (id === null || idString === null) {
        throw new Error(`${mentionLabel} must contain both X user ID coordinates`);
      }
      if (id !== idString)
        throw new Error(`${mentionLabel} X user IDs disagree`);
      if (!PROVIDER_ID.test(idString))
        continue;
      identityRecord += 1;
      observations.push({
        kind: "mention",
        providerUserId: idString,
        username: username(mention.screen_name, `${mentionLabel}.screen_name`),
        displayName: text2(mention.name, `${mentionLabel}.name`, 1024),
        observedAt,
        sourceMember: source.source,
        sourceRecord: recordIndex + 1,
        identityRecord
      });
    }
  }
  return observations;
}
function memberParity(declaration, member, label) {
  if (declaration === null !== (member === null)) {
    throw new Error(`X manifest and ZIP inventory disagree for ${label}`);
  }
}
function parseXArchiveMembers(members) {
  const manifest = parseManifest2(members.manifest);
  const account = parseAccount(members.account);
  if (manifest.userInfo.accountId !== account.providerUserId || manifest.userInfo.username !== account.username || manifest.userInfo.displayName !== account.displayName)
    throw new Error("X manifest userInfo disagrees with data/account.js");
  memberParity(manifest.declarations.directMessages, members.directMessages, "direct messages");
  memberParity(manifest.declarations.groupDirectMessages, members.groupDirectMessages, "group direct messages");
  memberParity(manifest.declarations.directMessageHeaders, members.directMessageHeaders, "direct-message headers");
  memberParity(manifest.declarations.groupDirectMessageHeaders, members.groupDirectMessageHeaders, "group direct-message headers");
  const seenConversationIds = new Set;
  const seenMessageIds = new Set;
  const seenReactionIds = new Set;
  const conversations = [];
  let direct = null;
  let group = null;
  if (members.directMessages !== null) {
    direct = parseConversations(members.directMessages, account.providerUserId, false, seenConversationIds, seenMessageIds, seenReactionIds);
    if (direct.recordCount !== manifest.declarations.directMessages.count) {
      throw new Error("X manifest directMessages count disagrees with its member");
    }
    conversations.push(...direct.conversations);
  }
  if (members.groupDirectMessages !== null) {
    group = parseConversations(members.groupDirectMessages, account.providerUserId, true, seenConversationIds, seenMessageIds, seenReactionIds);
    if (group.recordCount !== manifest.declarations.groupDirectMessages.count) {
      throw new Error("X manifest directMessagesGroup count disagrees with its member");
    }
    conversations.push(...group.conversations);
  }
  if (members.directMessageHeaders !== null) {
    const headers = parseHeaders(members.directMessageHeaders, false);
    if (headers.recordCount !== manifest.declarations.directMessageHeaders.count) {
      throw new Error("X manifest directMessageHeaders count disagrees with its member");
    }
    if (direct === null)
      throw new Error("X direct-message headers have no DM body");
    assertHeaderParity(direct.headerSignatures, headers.signatures, "X direct-message headers");
  }
  if (members.groupDirectMessageHeaders !== null) {
    const headers = parseHeaders(members.groupDirectMessageHeaders, true);
    if (headers.recordCount !== manifest.declarations.groupDirectMessageHeaders.count) {
      throw new Error("X manifest directMessageGroupHeaders count disagrees with its member");
    }
    if (group === null)
      throw new Error("X group direct-message headers have no DM body");
    assertHeaderParity(group.headerSignatures, headers.signatures, "X group direct-message headers");
  }
  const identityObservations = members.identityMetadata.flatMap(parseIdentityObservations).sort((left, right) => left.observedAt.localeCompare(right.observedAt) || left.providerUserId.localeCompare(right.providerUserId) || left.kind.localeCompare(right.kind) || left.username.localeCompare(right.username) || (left.displayName ?? "").localeCompare(right.displayName ?? "") || left.sourceMember.localeCompare(right.sourceMember) || left.sourceRecord - right.sourceRecord || left.identityRecord - right.identityRecord);
  return {
    format: "message-like-me.x-archive-evidence",
    version: 1,
    manifest: {
      manifestSha256: sha2563(members.manifest.bytes),
      declaredSizeBytes: manifest.declaredSizeBytes,
      generationDate: manifest.generationDate,
      isPartialArchive: manifest.isPartialArchive
    },
    account,
    conversations: conversations.sort((left, right) => left.conversationId.localeCompare(right.conversationId)),
    identityObservations
  };
}
function sha256Descriptor(descriptor, size) {
  const digest3 = createHash5("sha256");
  const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
  let position = 0;
  while (position < size) {
    const count = readSync2(descriptor, buffer, 0, Math.min(buffer.length, size - position), position);
    if (count < 1)
      throw new Error("X archive changed while being hashed");
    digest3.update(buffer.subarray(0, count));
    position += count;
  }
  return digest3.digest("hex");
}
function sameStat(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs && left.mode === right.mode && left.uid === right.uid && left.nlink === right.nlink;
}
async function readXArchive(path) {
  if (typeof path !== "string" || path.length < 1 || path.includes("\x00") || !isAbsolute5(path) || resolve6(path) !== path)
    throw new Error("X archive path must be a normalized absolute path");
  let physical;
  try {
    physical = realpathSync3(path);
  } catch (error) {
    throw new Error("X archive path cannot be resolved", { cause: error });
  }
  if (physical !== path)
    throw new Error("X archive path must not traverse a symbolic link");
  const pathBefore = lstatSync4(path, { bigint: true });
  const descriptor = openSync2(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = fstatSync2(descriptor, { bigint: true });
    const uid = typeof process.getuid === "function" ? BigInt(process.getuid()) : null;
    if (!before.isFile() || before.nlink !== 1n || uid !== null && before.uid !== uid || (before.mode & 0o077n) !== 0n || pathBefore.dev !== before.dev || pathBefore.ino !== before.ino)
      throw new Error("X archive must be one private current-user-owned physical file");
    if (before.size < 1n || before.size > BigInt(MAX_X_ZIP_ARCHIVE_BYTES)) {
      throw new Error("X archive size is invalid");
    }
    const size = Number(before.size);
    const digest3 = sha256Descriptor(descriptor, size);
    const members = extractXArchiveFile(descriptor, size);
    const parsed = parseXArchiveMembers(members);
    const after = fstatSync2(descriptor, { bigint: true });
    const pathAfter = lstatSync4(path, { bigint: true });
    if (!sameStat(before, after) || pathAfter.dev !== after.dev || pathAfter.ino !== after.ino || realpathSync3(path) !== path)
      throw new Error("X archive changed while being read");
    const mtimeNs = before.mtimeNs.toString();
    return {
      format: parsed.format,
      version: parsed.version,
      archive: {
        sha256: digest3,
        manifestSha256: parsed.manifest.manifestSha256,
        sizeBytes: size,
        declaredSizeBytes: parsed.manifest.declaredSizeBytes,
        mtimeNs,
        mtime: new Date(Number(before.mtimeNs / 1000000n)).toISOString(),
        generationDate: parsed.manifest.generationDate,
        isPartialArchive: parsed.manifest.isPartialArchive
      },
      account: parsed.account,
      conversations: parsed.conversations,
      identityObservations: parsed.identityObservations
    };
  } finally {
    closeSync2(descriptor);
  }
}

// src/x-source.ts
import { createHmac as createHmac4 } from "crypto";
var MAX_RETAINED_IDENTITY_LABELS = 64;
function keyBytes2(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 16 || bytes.byteLength > 1024) {
    throw new CliError("invalid-data", "X archive HMAC key must contain 16 through 1024 bytes");
  }
  return Uint8Array.from(bytes);
}
function hmac4(key, namespace, value) {
  return createHmac4("sha256", key).update(`message-like-me\x00${namespace}\x00`, "utf8").update(value, "utf8").digest("hex");
}
function compareCodeUnits3(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
function messageEvents(conversation) {
  return conversation.events.filter((event) => event.kind === "message-create");
}
function latestGroupName(conversation) {
  const updates = conversation.events.filter((event) => event.kind === "conversation-name-update");
  return updates.at(-1)?.name ?? null;
}
function observationsByParticipant(observations) {
  const grouped = new Map;
  for (const observation of observations) {
    const values = grouped.get(observation.providerUserId) ?? [];
    values.push(observation);
    grouped.set(observation.providerUserId, values);
  }
  return new Map([...grouped].map(([id, values]) => {
    const unique = new Map;
    for (const value of values) {
      unique.set(`${value.username.toLowerCase()}\x00${value.displayName ?? ""}`, value);
    }
    const ordered = [...unique.values()].sort((left, right) => compareCodeUnits3(left.observedAt, right.observedAt) || compareCodeUnits3(left.username, right.username) || compareCodeUnits3(left.displayName ?? "", right.displayName ?? ""));
    return [id, Object.freeze(ordered.slice(-MAX_RETAINED_IDENTITY_LABELS))];
  }));
}
function latestParticipantLabel(observations, participantId) {
  const latest = observations.get(participantId)?.at(-1);
  return latest?.displayName ?? latest?.username ?? null;
}
function attachmentProvenance2(key, namespace, message) {
  return Object.freeze(Array.from({ length: message.mediaCount }, (_, index) => Object.freeze({
    id: `attachment_${hmac4(key, "attachment", `${namespace}\x00${message.id}\x00${index + 1}`)}`,
    kind: "x-media-reference",
    mimeType: null,
    fileName: null,
    bytes: null
  })));
}
function currentBody(message) {
  const edit = message.editHistory.at(-1);
  return Object.freeze({
    body: edit?.editedText ?? message.text,
    editedAt: edit?.createdAt ?? null
  });
}
function normalizeXArchive(evidence, hmacKey3) {
  const key = keyBytes2(hmacKey3);
  const namespace = `x\x00${evidence.account.providerUserId}`;
  const sourceId = `source_${hmac4(key, "source", namespace)}`;
  const observations = observationsByParticipant(evidence.identityObservations);
  const allParticipantIds = new Set([evidence.account.providerUserId]);
  for (const conversation of evidence.conversations) {
    for (const participantId of conversation.participantIds)
      allParticipantIds.add(participantId);
  }
  const conversationIds = new Map(evidence.conversations.map((conversation) => [
    conversation.conversationId,
    `conversation_${hmac4(key, "conversation", `${namespace}\x00${conversation.conversationId}`)}`
  ]));
  const participantIds = new Map([...allParticipantIds].map((participantId) => [
    participantId,
    `participant_${hmac4(key, "participant", `${namespace}\x00${participantId}`)}`
  ]));
  const conversations = [];
  const conversationProvenance = [];
  const messages = [];
  const messageProvenance = [];
  const reactionFacts = [];
  const timeline = [];
  for (const conversation of evidence.conversations) {
    const peers = conversation.participantIds.filter((id) => id !== evidence.account.providerUserId);
    const directPeer = conversation.kind === "direct" && peers.length === 1 ? peers[0] : null;
    const localConversationId = conversationIds.get(conversation.conversationId);
    conversations.push(Object.freeze({
      id: localConversationId,
      sourceKey: conversation.conversationId,
      privateLabel: directPeer === null ? latestGroupName(conversation) : latestParticipantLabel(observations, directPeer),
      service: "x",
      participantCount: peers.length,
      participantIds: Object.freeze(peers.map((id) => participantIds.get(id)).sort(compareCodeUnits3)),
      privateParticipants: Object.freeze([]),
      group: conversation.kind === "group"
    }));
    conversationProvenance.push(Object.freeze({
      conversationId: localConversationId,
      externalId: conversation.conversationId,
      metadata: Object.freeze({
        kind: conversation.kind,
        participantProviderIds: conversation.participantIds,
        nonMessageEvents: conversation.events.filter((event) => event.kind !== "message-create")
      })
    }));
    for (const [rowIndex, event] of messageEvents(conversation).entries()) {
      const localMessageId = `message_${hmac4(key, "message", `${namespace}\x00${event.id}`)}`;
      const current = currentBody(event);
      const attachments = attachmentProvenance2(key, namespace, event);
      const direction = event.senderId === evidence.account.providerUserId ? "outgoing" : "incoming";
      messages.push(Object.freeze({
        id: localMessageId,
        sourceRowId: rowIndex + 1,
        sourceGuid: event.id,
        conversationId: localConversationId,
        sentAt: event.createdAt,
        direction,
        body: current.body,
        bodySource: current.body === null ? "unavailable" : "text",
        kind: current.body !== null ? "text" : event.mediaCount > 0 ? "attachment" : "unknown",
        replyToSourceGuid: null,
        replyState: "unavailable",
        editedAt: current.editedAt,
        retractedAt: null,
        service: "x",
        attachmentCount: event.mediaCount
      }));
      messageProvenance.push(Object.freeze({
        messageId: localMessageId,
        externalId: event.id,
        providerSortKey: null,
        replyToExternalId: null,
        attachments,
        metadata: Object.freeze({
          senderProviderId: event.senderId,
          recipientProviderId: event.recipientId,
          urlCount: event.urlCount,
          mediaCount: event.mediaCount,
          editHistory: event.editHistory,
          replyCapability: "unavailable"
        })
      }));
      timeline.push(event.createdAt);
      for (const reaction of event.activeReactions) {
        const reactionId = `reaction_${hmac4(key, "reaction", `${namespace}\x00${reaction.eventId}`)}`;
        reactionFacts.push(Object.freeze({
          id: reactionId,
          externalId: reaction.eventId,
          targetExternalId: event.id,
          conversationId: localConversationId,
          direction: reaction.senderId === evidence.account.providerUserId ? "outgoing" : "incoming",
          body: reaction.reactionKey,
          reactedAt: reaction.createdAt,
          state: "active"
        }));
        timeline.push(reaction.createdAt);
      }
    }
  }
  const auxiliaryRecords = [{
    kind: "account",
    id: evidence.account.providerUserId,
    record: Object.freeze({
      providerUserId: evidence.account.providerUserId,
      username: evidence.account.username,
      displayName: evidence.account.displayName,
      email: evidence.account.email,
      createdAt: evidence.account.createdAt,
      createdVia: evidence.account.createdVia,
      network: "x",
      isSelf: true
    })
  }];
  for (const participantId of [...allParticipantIds].sort(compareCodeUnits3)) {
    if (participantId === evidence.account.providerUserId)
      continue;
    auxiliaryRecords.push(Object.freeze({
      kind: "participant",
      id: participantId,
      record: Object.freeze({
        providerUserId: participantId,
        network: "x",
        isSelf: false,
        historicalLabels: observations.get(participantId) ?? Object.freeze([])
      })
    }));
  }
  const warnings = [
    "legacy-x-direct-message-export",
    "encrypted-x-chat-not-included",
    "reply-links-unavailable",
    "media-metadata-only",
    ...evidence.archive.isPartialArchive ? ["partial-official-archive"] : [],
    ...evidence.identityObservations.length > 0 ? ["historical-identity-labels"] : []
  ].sort(compareCodeUnits3);
  const bounds = timeline.sort(compareCodeUnits3);
  return Object.freeze({
    source: Object.freeze({
      id: sourceId,
      kind: "x-archive",
      provider: "x",
      network: "x",
      accountId: evidence.account.providerUserId,
      externalId: evidence.account.providerUserId,
      revision: evidence.archive.sha256,
      generatedAt: evidence.archive.generationDate,
      producer: Object.freeze({ id: "x-official-archive", version: "1" }),
      coverage: Object.freeze({
        history: evidence.archive.isPartialArchive ? "unknown" : "bounded",
        observedFrom: bounds[0] ?? null,
        observedTo: bounds.at(-1) ?? null,
        kind: evidence.archive.isPartialArchive ? "partial-official-archive" : "complete-produced-official-archive",
        reason: evidence.archive.isPartialArchive ? "producer-declared-partial" : "legacy-dm-export"
      }),
      manifestSha256: evidence.archive.manifestSha256,
      identity: Object.freeze({
        account: evidence.account,
        archiveSha256: evidence.archive.sha256,
        replyCapability: "unavailable"
      }),
      warnings: Object.freeze(warnings)
    }),
    conversations: Object.freeze(conversations),
    conversationProvenance: Object.freeze(conversationProvenance),
    messages: Object.freeze(messages),
    messageProvenance: Object.freeze(messageProvenance),
    reactionFacts: Object.freeze(reactionFacts),
    auxiliaryRecords: Object.freeze(auxiliaryRecords),
    deletions: Object.freeze([])
  });
}
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function exactXHandle(value) {
  return typeof value === "string" && /^@?[A-Za-z0-9_]{1,15}$/u.test(value) ? value.replace(/^@/u, "").toLowerCase() : null;
}
function exactBeeperAccount(evidence) {
  if (evidence.source.kind !== "bundle" || evidence.source.provider !== "beeper" || evidence.source.network !== "x")
    throw new CliError("conflict", "The overlap source must be an existing Beeper X source");
  const identity = record(evidence.source.identity);
  const account = record(identity?.account);
  const handle = exactXHandle(account?.handle);
  const selfParticipantId = account?.selfParticipantId;
  if (handle === null || typeof selfParticipantId !== "string" || selfParticipantId.length < 1) {
    throw new CliError("conflict", "The Beeper X source has no exact self handle and participant identity for account proof");
  }
  return Object.freeze({ handle, selfParticipantId });
}
function xArchiveMatchesBeeperSource(archive, value) {
  const source = record(value);
  if (source?.kind !== "bundle" || source.provider !== "beeper" || source.network !== "x")
    return false;
  const identity = record(source.identity);
  const account = record(identity?.account);
  return exactXHandle(account?.handle) === archive.account.username.toLowerCase();
}
function exactStringArray(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 1e4)
    return null;
  const values = [];
  for (let index = 0;index < value.length; index += 1) {
    if (!Object.hasOwn(value, index))
      return null;
    const item = value[index];
    if (typeof item !== "string" || item.length < 1 || item.length > 1024)
      return null;
    values.push(item);
  }
  return new Set(values).size === values.length ? Object.freeze(values) : null;
}
function archiveDirectIdentityProofs(archive, snapshot) {
  const observedHandles = new Map;
  for (const observation of archive.identityObservations) {
    const handle = exactXHandle(observation.username);
    if (handle === null)
      continue;
    const values = observedHandles.get(observation.providerUserId) ?? new Set;
    values.add(handle);
    observedHandles.set(observation.providerUserId, values);
  }
  const uniqueHandleByParticipant = new Map;
  for (const [participantId, handles] of observedHandles) {
    if (handles.size === 1)
      uniqueHandleByParticipant.set(participantId, [...handles][0]);
  }
  const archiveConversations = new Map(archive.conversations.map((conversation) => [
    conversation.conversationId,
    conversation
  ]));
  const normalizedConversations = new Map(snapshot.conversations.map((conversation) => [
    conversation.id,
    conversation
  ]));
  const proofs = new Map;
  for (const provenance of snapshot.conversationProvenance) {
    const normalized = normalizedConversations.get(provenance.conversationId);
    const conversation = archiveConversations.get(provenance.externalId);
    if (normalized?.group !== false || conversation?.kind !== "direct")
      continue;
    const peers = conversation.participantIds.filter((id) => id !== archive.account.providerUserId);
    if (peers.length !== 1)
      continue;
    const peerActorId = peers[0];
    const peerHandle = uniqueHandleByParticipant.get(peerActorId);
    if (peerHandle === undefined)
      continue;
    proofs.set(provenance.conversationId, Object.freeze({
      peerHandle,
      selfActorId: archive.account.providerUserId,
      peerActorId
    }));
  }
  return proofs;
}
function preferredDirectIdentityProofs(evidence, account) {
  const participants = new Map;
  const ambiguousIds = new Set;
  for (const auxiliary of evidence.auxiliaryRecords) {
    if (auxiliary.kind !== "participant")
      continue;
    const participant = record(auxiliary.record);
    const id = participant?.id;
    const handle = exactXHandle(participant?.handle);
    const isSelf = participant?.isSelf;
    if (typeof id !== "string" || id.length < 1 || handle === null || typeof isSelf !== "boolean" || participant?.network !== "x")
      continue;
    if (participants.has(id))
      ambiguousIds.add(id);
    participants.set(id, Object.freeze({ handle, isSelf }));
  }
  for (const id of ambiguousIds)
    participants.delete(id);
  const proofs = new Map;
  for (const conversation of evidence.conversations) {
    const metadata = record(conversation.metadata);
    const participantIds = exactStringArray(metadata?.participantIds);
    if (conversation.group || metadata?.type !== "direct" || metadata.participantsComplete !== true || participantIds?.length !== 2 || !participantIds.includes(account.selfParticipantId))
      continue;
    const self = participants.get(account.selfParticipantId);
    const peerActorId = participantIds.find((id) => id !== account.selfParticipantId);
    const peer = participants.get(peerActorId);
    if (self?.isSelf !== true || self.handle !== account.handle || peer?.isSelf !== false)
      continue;
    proofs.set(conversation.id, Object.freeze({
      peerHandle: peer.handle,
      selfActorId: account.selfParticipantId,
      peerActorId
    }));
  }
  return proofs;
}
function messageFingerprint(message, proof, senderActorId) {
  if (message.body === null)
    return null;
  const actorHandle = senderActorId === proof.selfActorId && message.direction === "outgoing" ? "self" : senderActorId === proof.peerActorId && message.direction === "incoming" ? proof.peerHandle : null;
  if (actorHandle === null)
    return null;
  return sha256(canonicalJson({
    schemaVersion: 2,
    conversationKind: "direct",
    peerHandle: proof.peerHandle,
    actorHandle,
    sentAt: message.sentAt,
    direction: message.direction,
    body: message.body,
    kind: message.kind,
    attachmentCount: message.attachmentCount
  }));
}
function messageFingerprints(messages, proofs, senderActorId) {
  const fingerprints = new Map;
  for (const message of messages) {
    if (message.kind === "reaction")
      continue;
    const proof = proofs.get(message.conversationId);
    const sender = senderActorId(message);
    if (proof === undefined || sender === null)
      continue;
    const fingerprint = messageFingerprint(message, proof, sender);
    if (fingerprint !== null)
      fingerprints.set(message.id, fingerprint);
  }
  return fingerprints;
}
function groupedBy(values, key) {
  const grouped = new Map;
  for (const value of values) {
    const coordinate = key(value);
    const rows = grouped.get(coordinate) ?? [];
    rows.push(value);
    grouped.set(coordinate, rows);
  }
  return grouped;
}
function planXArchiveEquivalence(archive, snapshot, preferred) {
  if (snapshot.source.kind !== "x-archive" || snapshot.source.network !== "x") {
    throw new CliError("internal", "X overlap planning requires an X archive snapshot");
  }
  const preferredAccount = exactBeeperAccount(preferred);
  if (archive.account.username.toLowerCase() !== preferredAccount.handle) {
    throw new CliError("conflict", "The X archive and Beeper source belong to different exact handles");
  }
  const duplicateProofs = archiveDirectIdentityProofs(archive, snapshot);
  const preferredProofs = preferredDirectIdentityProofs(preferred, preferredAccount);
  const archiveProvenanceByMessage = new Map(snapshot.messageProvenance.map((value) => [
    value.messageId,
    value
  ]));
  const duplicateFingerprints = messageFingerprints(snapshot.messages, duplicateProofs, (message) => {
    const metadata = record(archiveProvenanceByMessage.get(message.id)?.metadata);
    return typeof metadata?.senderProviderId === "string" ? metadata.senderProviderId : null;
  });
  const preferredFingerprints = messageFingerprints(preferred.messages, preferredProofs, (message) => {
    const metadata = record(message.metadata);
    return typeof metadata?.senderParticipantId === "string" ? metadata.senderParticipantId : null;
  });
  const duplicateByFingerprint = groupedBy(snapshot.messages.filter((message) => duplicateFingerprints.has(message.id)), (message) => duplicateFingerprints.get(message.id));
  const preferredByFingerprint = groupedBy(preferred.messages.filter((message) => preferredFingerprints.has(message.id)), (message) => preferredFingerprints.get(message.id));
  const preferredConversationCandidates = new Map;
  for (const [fingerprint, duplicates] of duplicateByFingerprint) {
    const candidates = preferredByFingerprint.get(fingerprint) ?? [];
    if (duplicates.length !== 1 || candidates.length !== 1)
      continue;
    const values = preferredConversationCandidates.get(duplicates[0].conversationId) ?? new Set;
    values.add(candidates[0].conversationId);
    preferredConversationCandidates.set(duplicates[0].conversationId, values);
  }
  const conversationPairs = [];
  const usedPreferredConversations = new Set;
  for (const [duplicateConversationId, candidates] of [...preferredConversationCandidates].sort(([left], [right]) => compareCodeUnits3(left, right))) {
    if (candidates.size > 1) {
      throw new CliError("conflict", "Exact X message evidence maps one archive conversation to multiple Beeper conversations");
    }
    const preferredConversationId = [...candidates][0];
    if (preferredConversationId === undefined)
      continue;
    if (usedPreferredConversations.has(preferredConversationId)) {
      throw new CliError("conflict", "Exact X message evidence maps multiple archive conversations to one Beeper conversation");
    }
    usedPreferredConversations.add(preferredConversationId);
    conversationPairs.push({ duplicateConversationId, preferredConversationId });
  }
  const preferredConversationByDuplicate = new Map(conversationPairs.map((pair) => [
    pair.duplicateConversationId,
    pair.preferredConversationId
  ]));
  const duplicateMessagesByConversation = groupedBy(snapshot.messages, ({ conversationId }) => conversationId);
  const preferredMessagesByConversation = groupedBy(preferred.messages, ({ conversationId }) => conversationId);
  const messagePairs = [];
  for (const pair of conversationPairs) {
    const duplicates = groupedBy((duplicateMessagesByConversation.get(pair.duplicateConversationId) ?? []).filter((message) => duplicateFingerprints.has(message.id)), (message) => duplicateFingerprints.get(message.id));
    const candidates = groupedBy((preferredMessagesByConversation.get(pair.preferredConversationId) ?? []).filter((message) => preferredFingerprints.has(message.id)), (message) => preferredFingerprints.get(message.id));
    for (const [fingerprint, duplicateRows] of duplicates) {
      const preferredRows = candidates.get(fingerprint) ?? [];
      if (duplicateRows.length === 1 && preferredRows.length === 1) {
        messagePairs.push({
          duplicateMessageId: duplicateRows[0].id,
          preferredMessageId: preferredRows[0].id
        });
      }
    }
  }
  const duplicateMessageById = new Map(snapshot.messages.map((message) => [message.id, message]));
  const coveredConversations = new Set(messagePairs.map(({ duplicateMessageId }) => duplicateMessageById.get(duplicateMessageId).conversationId));
  const filteredConversationPairs = conversationPairs.filter(({ duplicateConversationId }) => coveredConversations.has(duplicateConversationId));
  if (filteredConversationPairs.length === 0 || messagePairs.length === 0) {
    throw new CliError("conflict", "The X archive has no unambiguous exact message overlap with this Beeper source");
  }
  const duplicateExternalToLocal = new Map(snapshot.messageProvenance.map((value) => [
    value.externalId,
    value.messageId
  ]));
  const preferredExternalToLocal = new Map(preferred.messages.map((value) => [
    value.externalId,
    value.id
  ]));
  const preferredMessageByDuplicate = new Map(messagePairs.map((pair) => [
    pair.duplicateMessageId,
    pair.preferredMessageId
  ]));
  const archiveReactionCoordinates = snapshot.reactionFacts?.flatMap((reaction) => {
    const duplicateTarget = duplicateExternalToLocal.get(reaction.targetExternalId);
    const preferredTarget = duplicateTarget === undefined ? undefined : preferredMessageByDuplicate.get(duplicateTarget);
    return preferredTarget === undefined ? [] : [{ reaction, preferredTarget }];
  }) ?? [];
  const preferredReactionCoordinates = preferred.reactions.flatMap((reaction) => {
    const preferredTarget = preferredExternalToLocal.get(reaction.targetExternalId);
    return preferredTarget === undefined ? [] : [{ reaction, preferredTarget }];
  });
  const reactionKey = (value) => canonicalJson([
    value.preferredTarget,
    value.reaction.direction,
    value.reaction.body
  ]);
  const archiveReactions = groupedBy(archiveReactionCoordinates, reactionKey);
  const preferredReactions = groupedBy(preferredReactionCoordinates, reactionKey);
  const reactionPairs = [];
  for (const [coordinate, archiveRows] of archiveReactions) {
    const preferredRows = preferredReactions.get(coordinate) ?? [];
    if (archiveRows.length !== 1 || preferredRows.length !== 1)
      continue;
    const archiveReaction = archiveRows[0].reaction;
    const preferredReaction = preferredRows[0].reaction;
    const preferArchive = archiveReaction.reactedAt !== null && preferredReaction.reactedAt === null;
    reactionPairs.push(preferArchive ? { duplicateReactionId: preferredReaction.id, preferredReactionId: archiveReaction.id } : { duplicateReactionId: archiveReaction.id, preferredReactionId: preferredReaction.id });
  }
  const sortedConversations = filteredConversationPairs.sort((left, right) => compareCodeUnits3(left.duplicateConversationId, right.duplicateConversationId));
  const sortedMessages = messagePairs.filter(({ duplicateMessageId }) => {
    const conversationId = duplicateMessageById.get(duplicateMessageId).conversationId;
    return preferredConversationByDuplicate.has(conversationId) && coveredConversations.has(conversationId);
  }).sort((left, right) => compareCodeUnits3(left.duplicateMessageId, right.duplicateMessageId));
  const sortedReactions = reactionPairs.sort((left, right) => compareCodeUnits3(left.duplicateReactionId, right.duplicateReactionId));
  const evidenceSha256 = sha256(canonicalJson({
    schemaVersion: 2,
    archiveSha256: archive.archive.sha256,
    archiveSourceId: snapshot.source.id,
    preferredSourceId: preferred.source.id,
    accountProofSha256: sha256(archive.account.username.toLowerCase()),
    directPeerProofs: sortedConversations.map((pair) => ({
      duplicateConversationId: pair.duplicateConversationId,
      preferredConversationId: pair.preferredConversationId,
      peerHandleSha256: sha256(duplicateProofs.get(pair.duplicateConversationId).peerHandle)
    })),
    messageFingerprints: sortedMessages.map((pair) => ({
      duplicateMessageId: pair.duplicateMessageId,
      preferredMessageId: pair.preferredMessageId,
      fingerprint: duplicateFingerprints.get(pair.duplicateMessageId)
    })),
    conversations: sortedConversations,
    messages: sortedMessages,
    reactions: sortedReactions
  }));
  return Object.freeze({
    duplicateSourceId: snapshot.source.id,
    preferredSourceId: preferred.source.id,
    basis: "exact-message-overlap",
    evidenceSha256,
    conversations: Object.freeze(sortedConversations.map((value) => Object.freeze(value))),
    messages: Object.freeze(sortedMessages.map((value) => Object.freeze(value))),
    reactions: Object.freeze(sortedReactions.map((value) => Object.freeze(value)))
  });
}

// src/commands.ts
var HELP = `Message Like Me ${MESSAGE_LIKE_ME_VERSION}

Usage:
  messagelikeme [--data-dir PATH] init [--json]
  messagelikeme [--data-dir PATH] ingest imessage [--database PATH] [--json]
  messagelikeme [--data-dir PATH] ingest bundle --input ABS_PATH [--json]
  messagelikeme [--data-dir PATH] ingest x-archive --input ABS_PATH
                    [--overlap-source SOURCE_ID] [--json]
  messagelikeme [--data-dir PATH] ingest contacts [--addressbook PATH] [--json]
  messagelikeme [--data-dir PATH] sources list [--private] [--json]
  messagelikeme [--data-dir PATH] sources show SOURCE_ID [--private] [--json]
  messagelikeme [--data-dir PATH] contacts list [--min-outgoing N] [--limit N] [--private] [--json]
  messagelikeme [--data-dir PATH] contacts show CONTACT_ID [--private] [--json]
  messagelikeme [--data-dir PATH] contacts resolve QUERY --private [--limit N] [--json]
  messagelikeme [--data-dir PATH] routes list CONTACT_ID --output FILE [--private] [--json]
  messagelikeme [--data-dir PATH] inspect tempo CONTACT_ID [--session-gap N] [--burst-gap N] [--json]
  messagelikeme [--data-dir PATH] inspect sessions CONTACT_ID [--limit N] [--session-gap N] [--burst-gap N] [--json]
  messagelikeme [--data-dir PATH] study prepare CONTACT_ID --output FILE [--limit N]
                    [--after ISO_TIMESTAMP] [--before ISO_TIMESTAMP]
                    [--session-gap N] [--burst-gap N] [--json]
  messagelikeme [--data-dir PATH] evaluate prepare CONTACT_ID --after ISO_TIMESTAMP
                    --prompt-output FILE --reference-output FILE [--before ISO_TIMESTAMP]
                    [--limit N] [--session-gap N] [--burst-gap N] [--json]
  messagelikeme [--data-dir PATH] profile apply FILE [--json]
  messagelikeme [--data-dir PATH] profile show CONTACT_ID [--json]
  messagelikeme [--data-dir PATH] profile export CONTACT_ID --output FILE [--json]
  messagelikeme [--data-dir PATH] context CONTACT_ID [--json]
  messagelikeme [--data-dir PATH] handoff prepare CONTACT_ID --request FILE
                    --wrench-context FILE --draft FILE --output FILE [--json]
  messagelikeme [--data-dir PATH] handoff verify FILE [--json]
  messagelikeme [--data-dir PATH] handoff record HANDOFF_ID --wrench-receipt FILE [--json]
  messagelikeme [--data-dir PATH] handoffs show HANDOFF_ID [--json]
  messagelikeme skill path [--json]
  messagelikeme skill install [--target codex|claude|agents] [--scope user|project]
                    [--project PATH] [--force] [--json]
  messagelikeme [--data-dir PATH] doctor [--json]

Message Like Me reads caller-owned macOS Messages, official X archives,
optional Contacts data, and strict private local message bundles, then stores
private analysis locally. It has no network, account, AI-provider, or
message-sending surface.
`;
async function exists2(path) {
  try {
    await lstat5(path);
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
    throw new CliError("not-found", "Message Like Me is not initialized; run messagelikeme init or an ingest command");
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
function contactEvidence(store, contactId, window) {
  if (contactId.length < 1 || contactId.length > 256)
    throw new CliError("usage", "Invalid contact ID");
  const evidence = store.contactCorpus(contactId, window);
  if (evidence === null)
    throw new CliError("not-found", `Unknown contact ${contactId}`);
  return evidence;
}
function contactMetrics(store, contactId, options = {}) {
  const evidence = contactEvidence(store, contactId);
  return analyzeContact(evidence.messages, evidence.corpusRevision, contactId, {
    ...options,
    reactionFacts: evidence.reactions
  });
}
function metricOptions(parsed) {
  return {
    sessionGapSeconds: integerOption(parsed, "session-gap", 8 * 60 * 60, 1, 30 * 24 * 60 * 60),
    burstGapSeconds: integerOption(parsed, "burst-gap", 5 * 60, 1, 30 * 24 * 60 * 60)
  };
}
function canonicalTimestampOption(parsed, key, required = false) {
  const value = parsed.options.get(key);
  if (value === undefined) {
    if (required)
      throw new CliError("usage", `--${key} is required`);
    return null;
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new CliError("usage", `--${key} must be a canonical ISO timestamp`);
  }
  return value;
}
function safeContactDetail(store, contactId, privateLabels) {
  const conversation = requireContact(store, contactId, privateLabels);
  return {
    id: conversation.id,
    scopeKind: conversation.scopeKind,
    conversationCount: conversation.conversationCount,
    ...privateLabels ? {
      privateLabel: conversation.privateLabel,
      privateParticipants: conversation.privateParticipants
    } : {},
    service: conversation.service,
    services: conversation.services,
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
  if (!isAbsolute6(value))
    throw new CliError("unsafe-path", `${label} must be an absolute private path`);
  return resolve7(value);
}
function translateIMessageError(error) {
  const code = error.code;
  if (code === "EACCES" || code === "EPERM" || code === "permission") {
    throw new CliError("permission", "Messages data is not readable. Grant Full Disk Access to this terminal or agent host, then retry.", { cause: error });
  }
  if (code === "ENOENT") {
    throw new CliError("not-found", "The selected Messages database does not exist", { cause: error });
  }
  throw new CliError("invalid-data", error instanceof Error ? error.message : String(error), { cause: error });
}
function translateContactsError(error) {
  const code = error.code;
  if (code === "EACCES" || code === "EPERM") {
    throw new CliError("permission", "Contacts data is not readable. Grant Full Disk Access to this terminal or agent host, then retry.", { cause: error });
  }
  if (code === "ENOENT") {
    throw new CliError("not-found", "The selected AddressBook source does not exist", { cause: error });
  }
  const message = error instanceof Error ? error.message : "";
  throw new CliError("invalid-data", message.startsWith("Contacts source ") ? message : "The selected AddressBook source could not be read safely", { cause: error });
}
function translateBundleError(error) {
  if (error instanceof CliError)
    throw error;
  const code = error.code;
  if (code === "EACCES" || code === "EPERM") {
    throw new CliError("permission", "The selected private bundle is not readable", { cause: error });
  }
  if (code === "ENOENT") {
    throw new CliError("not-found", "The selected private bundle does not exist", { cause: error });
  }
  throw new CliError("invalid-data", "The selected private message bundle could not be read safely", { cause: error });
}
function translateXArchiveError(error) {
  const code = error instanceof CliError ? error.kind : error.code;
  if (code === "EACCES" || code === "EPERM") {
    throw new CliError("permission", "The selected private X archive is not readable", { cause: error });
  }
  if (code === "ENOENT" || code === "not-found") {
    throw new CliError("not-found", "The selected private X archive does not exist", { cause: error });
  }
  throw new CliError("invalid-data", "The selected private X archive could not be validated safely", { cause: error });
}
function translateAgenticContractError(error, label) {
  if (error instanceof CliError)
    throw error;
  if (error instanceof AgenticMessagingV1ContractError) {
    throw new CliError("invalid-data", `${label} does not satisfy its versioned private contract`, {
      cause: error
    });
  }
  throw new CliError("invalid-data", `${label} could not be validated safely`, { cause: error });
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
      const stored = context.store.replaceCorpus(snapshot, canonicalNow(io), context.key);
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
  if (command === "ingest" && subcommand === "bundle" && identifier === undefined) {
    rejectUnused(parsed, ["data-dir", "input"], ["json"]);
    const input = absolutePrivatePath(parsed.options.get("input"), "--input");
    const context = await writableStore(parsed);
    try {
      let bundle;
      try {
        bundle = await readMessageBundle(input, { hmacKey: context.key });
      } catch (error) {
        translateBundleError(error);
      }
      const stored = context.store.replaceSources(bundle.sources, canonicalNow(io), context.key);
      const result = {
        schemaVersion: bundle.schemaVersion,
        manifestSha256: bundle.manifestSha256,
        corpusRevision: stored.corpusRevision,
        sources: stored.sources,
        conversations: stored.sources.reduce((sum, source) => sum + source.conversations, 0),
        messages: stored.sources.reduce((sum, source) => sum + source.messages, 0)
      };
      emit(io, json, result, `Ingested ${result.messages} active messages across ${result.conversations} conversations from ${result.sources.length} sources`);
    } finally {
      context.store.close();
    }
    return;
  }
  if (command === "ingest" && subcommand === "x-archive" && identifier === undefined) {
    rejectUnused(parsed, ["data-dir", "input", "overlap-source"], ["json"]);
    const input = absolutePrivatePath(parsed.options.get("input"), "--input");
    const paths = await initializeDataPaths(globalDataPaths(parsed));
    const key = await loadOrCreateInstallKey(paths.installKey);
    io.stderr(`Validating one private X archive locally; no data is uploaded.
`);
    let archive;
    try {
      archive = await readXArchive(input);
    } catch (error) {
      translateXArchiveError(error);
    }
    const snapshot = normalizeXArchive(archive, key);
    io.stderr(`Validated ${snapshot.messages.length} messages across ${snapshot.conversations.length} ${snapshot.conversations.length === 1 ? "conversation" : "conversations"}.
`);
    const store = LocalStore.open(paths.database);
    try {
      const overlapSourceId = parsed.options.get("overlap-source");
      const beeperXSources = store.listSources().filter((source2) => source2.kind === "bundle" && source2.provider === "beeper" && source2.network === "x");
      const matchingBeeperSources = beeperXSources.filter((source2) => {
        const privateSource = store.source(source2.id, true);
        return privateSource !== null && xArchiveMatchesBeeperSource(archive, privateSource);
      });
      if (overlapSourceId === undefined && matchingBeeperSources.length > 0) {
        const ids = matchingBeeperSources.map(({ id }) => id).join(", ");
        throw new CliError("conflict", `A Beeper X source for this exact account already exists; inspect sources and rerun with --overlap-source ${ids}`);
      }
      const equivalence = overlapSourceId === undefined ? undefined : planXArchiveEquivalence(archive, snapshot, store.sourceOverlapEvidence(overlapSourceId));
      if (equivalence !== undefined) {
        io.stderr(`Proved ${equivalence.messages.length} exact message overlaps with the named Beeper source; they will be reconciled atomically.
`);
      }
      io.stderr(`Updating the private local Message Like Me store atomically.
`);
      const stored = store.replaceSources([snapshot], canonicalNow(io), key, equivalence, ({ phase, completed, total }) => {
        io.stderr(`Processed ${completed} of ${total} ${phase} inside the pending transaction.
`);
      });
      const source = stored.sources[0];
      const outgoingMessages = snapshot.messages.filter(({ direction }) => direction === "outgoing").length;
      const result = {
        archive: {
          sha256: archive.archive.sha256,
          manifestSha256: archive.archive.manifestSha256,
          sizeBytes: archive.archive.sizeBytes,
          generatedAt: archive.archive.generationDate,
          partial: archive.archive.isPartialArchive
        },
        corpusRevision: stored.corpusRevision,
        source,
        imported: {
          conversations: snapshot.conversations.length,
          messages: snapshot.messages.length,
          incomingMessages: snapshot.messages.length - outgoingMessages,
          outgoingMessages,
          reactions: snapshot.reactionFacts?.length ?? 0,
          replyStateUnavailableMessages: snapshot.messages.length
        },
        active: {
          conversations: source.conversations,
          messages: source.messages
        },
        reconciliation: equivalence === undefined ? null : {
          preferredSourceId: equivalence.preferredSourceId,
          conversations: equivalence.conversations.length,
          messages: equivalence.messages.length,
          reactions: equivalence.reactions?.length ?? 0,
          basis: equivalence.basis
        },
        warnings: snapshot.source.warnings
      };
      emit(io, json, result, `Ingested ${result.imported.messages} X archive messages across ${result.imported.conversations} conversations${result.reconciliation === null ? "" : `; reconciled ${result.reconciliation.messages} exact Beeper duplicates`}`);
    } finally {
      store.close();
    }
    return;
  }
  if (command === "ingest" && subcommand === "contacts" && identifier === undefined) {
    rejectUnused(parsed, ["data-dir", "addressbook"], ["json"]);
    const context = await writableStore(parsed);
    try {
      const override = parsed.options.get("addressbook");
      const sourcePath = override === undefined ? DEFAULT_CONTACTS_DIRECTORY : absolutePrivatePath(override, "--addressbook");
      let snapshot;
      try {
        snapshot = readMacOSContacts(sourcePath, { hmacKey: context.key });
      } catch (error) {
        translateContactsError(error);
      }
      const stored = context.store.enrichContacts(snapshot, canonicalNow(io), context.key);
      const result = {
        ...stored,
        source: {
          databases: snapshot.sources.length,
          bytes: snapshot.sources.reduce((sum, source) => sum + source.bytes, 0),
          schemaSha256: snapshot.sources.map((source) => source.schemaSha256)
        },
        warnings: snapshot.warnings
      };
      emit(io, json, result, `Matched ${stored.matched} direct conversations and enriched ${stored.enriched} private labels`);
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
  if (command === "sources" && subcommand === "list" && identifier === undefined) {
    rejectUnused(parsed, ["data-dir"], ["json", "private"]);
    const context = await existingStore(parsed);
    try {
      const sources = context.store.listSources(parsed.flags.has("private"));
      emit(io, json, { sources }, `${sources.length} message sources`);
    } finally {
      context.store.close();
    }
    return;
  }
  if (command === "sources" && subcommand === "show" && identifier !== undefined) {
    rejectUnused(parsed, ["data-dir"], ["json", "private"]);
    const context = await existingStore(parsed);
    try {
      const source = context.store.source(identifier, parsed.flags.has("private"));
      if (source === null)
        throw new CliError("not-found", `Unknown source ${identifier}`);
      emit(io, json, source, `Message source ${identifier}`);
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
  if (command === "contacts" && subcommand === "resolve" && identifier !== undefined) {
    rejectUnused(parsed, ["data-dir", "limit"], ["json", "private"]);
    if (!parsed.flags.has("private")) {
      throw new CliError("usage", "contacts resolve requires --private");
    }
    const context = await existingStore(parsed);
    try {
      let matches;
      try {
        matches = context.store.resolvePrivateContacts(identifier, integerOption(parsed, "limit", 10, 1, 50));
      } catch (error) {
        if (error instanceof CliError)
          throw error;
        throw new CliError("usage", "Contact query must be bounded exact text", { cause: error });
      }
      emit(io, json, { exact: true, matches }, `${matches.length} exact private contact matches`);
    } finally {
      context.store.close();
    }
    return;
  }
  if (command === "routes" && subcommand === "list" && identifier !== undefined) {
    rejectUnused(parsed, ["data-dir", "output"], ["json", "private"]);
    const output = absolutePrivatePath(parsed.options.get("output"), "--output");
    const context = await existingStore(parsed);
    try {
      const routes = context.store.routeCandidates(identifier, parsed.flags.has("private"));
      if (routes === null)
        throw new CliError("not-found", `Unknown contact ${identifier}`);
      const eligible = routes.candidates.filter(({ actionability }) => actionability.state === "wrench-binding-eligible");
      const selection = eligible.length === 0 ? Object.freeze({ state: "unavailable", eligibleCandidateId: null }) : eligible.length === 1 ? Object.freeze({ state: "single-exact-candidate", eligibleCandidateId: eligible[0].id }) : Object.freeze({ state: "ambiguous", eligibleCandidateId: null });
      const result = {
        schemaVersion: 1,
        format: "message-like-me.source-conversation-routes",
        contactId: routes.contactId,
        selection,
        candidates: routes.candidates
      };
      const bytes = prettyJson(result);
      await atomicWritePrivate(output, bytes);
      const receipt = {
        schemaVersion: 1,
        format: "message-like-me.source-conversation-routes-receipt",
        contactIdSha256: sha256(routes.contactId),
        routesSha256: sha256(bytes),
        candidates: routes.candidates.length,
        eligibleCandidates: eligible.length,
        selectionState: selection.state,
        privateCoordinatesIncluded: parsed.flags.has("private")
      };
      emit(io, json, receipt, `Wrote ${routes.candidates.length} exact source-conversation routes to a private file`);
    } finally {
      context.store.close();
    }
    return;
  }
  if (command === "inspect" && subcommand === "tempo" && identifier !== undefined) {
    rejectUnused(parsed, ["data-dir", "session-gap", "burst-gap"], ["json"]);
    const context = await existingStore(parsed);
    try {
      const metrics = contactMetrics(context.store, identifier, metricOptions(parsed));
      const result = compactMetrics(metrics);
      emit(io, json, result, `Tempo metrics for ${identifier}: ${metrics.tempo.responseEpisodes} response episodes`);
    } finally {
      context.store.close();
    }
    return;
  }
  if (command === "inspect" && subcommand === "sessions" && identifier !== undefined) {
    rejectUnused(parsed, ["data-dir", "limit", "session-gap", "burst-gap"], ["json"]);
    const context = await existingStore(parsed);
    try {
      const metrics = contactMetrics(context.store, identifier, metricOptions(parsed));
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
    rejectUnused(parsed, [
      "data-dir",
      "output",
      "limit",
      "after",
      "before",
      "session-gap",
      "burst-gap"
    ], ["json"]);
    const output = absolutePrivatePath(parsed.options.get("output"), "--output");
    const context = await existingStore(parsed);
    try {
      const after = canonicalTimestampOption(parsed, "after");
      const before = canonicalTimestampOption(parsed, "before");
      let evidence;
      try {
        evidence = contactEvidence(context.store, identifier, { after, before });
      } catch (error) {
        if (error instanceof CliError)
          throw error;
        throw new CliError("usage", error instanceof Error ? error.message : String(error), { cause: error });
      }
      const metrics = analyzeContact(evidence.messages, evidence.corpusRevision, identifier, { ...metricOptions(parsed), reactionFacts: evidence.reactions });
      const packet = buildStudyPacket(evidence.messages, metrics, {
        limit: integerOption(parsed, "limit", 24, 1, 50),
        generatedAt: canonicalNow(io),
        evidenceRevision: evidence.evidenceRevision,
        evidenceWindow: { after, before }
      });
      const bytes = prettyJson(packet);
      const packetSha256 = sha256(bytes);
      await atomicWritePrivate(output, bytes);
      context.store.recordStudyPacket({
        sha256: packetSha256,
        contactId: identifier,
        corpusRevision: metrics.corpusRevision,
        evidenceRevision: evidence.evidenceRevision,
        createdAt: packet.generatedAt,
        privatePath: output,
        exampleIds: packet.examples.map(({ id }) => id),
        evidence: {
          firstMessageAt: packet.metrics.firstMessageAt,
          lastMessageAt: packet.metrics.lastMessageAt,
          messageCount: packet.metrics.messageCount,
          outgoingTextMessages: packet.metrics.surface.outgoingTextMessages,
          responseEpisodes: packet.metrics.tempo.responseEpisodes,
          studyExamples: packet.examples.length,
          selectionAlgorithm: packet.selection.algorithm,
          after: packet.evidenceWindow.after,
          before: packet.evidenceWindow.before
        }
      });
      const result = {
        contactId: identifier,
        corpusRevision: metrics.corpusRevision,
        evidenceRevision: evidence.evidenceRevision,
        packetSha256,
        examples: packet.examples.length,
        evidenceWindow: packet.evidenceWindow,
        output
      };
      emit(io, json, result, `Prepared ${packet.examples.length} private study examples at ${output} (SHA-256 ${packetSha256})`);
    } finally {
      context.store.close();
    }
    return;
  }
  if (command === "evaluate" && subcommand === "prepare" && identifier !== undefined) {
    rejectUnused(parsed, [
      "data-dir",
      "after",
      "before",
      "prompt-output",
      "reference-output",
      "limit",
      "session-gap",
      "burst-gap"
    ], ["json"]);
    const promptOutput = absolutePrivatePath(parsed.options.get("prompt-output"), "--prompt-output");
    const referenceOutput = absolutePrivatePath(parsed.options.get("reference-output"), "--reference-output");
    if (promptOutput === referenceOutput) {
      throw new CliError("usage", "--prompt-output and --reference-output must be different paths");
    }
    const after = canonicalTimestampOption(parsed, "after", true);
    const before = canonicalTimestampOption(parsed, "before");
    const context = await existingStore(parsed);
    try {
      let evidence;
      try {
        evidence = contactEvidence(context.store, identifier, { after, before });
      } catch (error) {
        if (error instanceof CliError)
          throw error;
        throw new CliError("usage", error instanceof Error ? error.message : String(error), { cause: error });
      }
      const metrics = analyzeContact(evidence.messages, evidence.corpusRevision, identifier, { ...metricOptions(parsed), reactionFacts: evidence.reactions });
      const packets = buildEvaluationPackets(evidence.messages, metrics, {
        after,
        before,
        limit: integerOption(parsed, "limit", 8, 1, 25),
        generatedAt: canonicalNow(io),
        evidenceRevision: evidence.evidenceRevision
      });
      if (packets.prompt.cases.length === 0) {
        throw new CliError("not-found", "No complete held-out response cases exist in that time window");
      }
      await atomicWritePrivate(promptOutput, prettyJson(packets.prompt));
      await atomicWritePrivate(referenceOutput, prettyJson(packets.reference));
      const result = {
        evaluationId: packets.prompt.evaluationId,
        contactId: identifier,
        corpusRevision: evidence.corpusRevision,
        evidenceRevision: evidence.evidenceRevision,
        cases: packets.prompt.cases.length,
        evidenceWindow: packets.prompt.evidenceWindow,
        promptOutput,
        referenceOutput,
        referenceNotice: packets.reference.notice
      };
      emit(io, json, result, `Prepared ${packets.prompt.cases.length} held-out cases. Draft from ${promptOutput} before opening ${referenceOutput}`);
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
  if (command === "handoff" && subcommand === "prepare" && identifier !== undefined) {
    rejectUnused(parsed, [
      "data-dir",
      "request",
      "wrench-context",
      "draft",
      "output"
    ], ["json"]);
    const requestPath = absolutePrivatePath(parsed.options.get("request"), "--request");
    const wrenchContextPath = absolutePrivatePath(parsed.options.get("wrench-context"), "--wrench-context");
    const draftPath = absolutePrivatePath(parsed.options.get("draft"), "--draft");
    const output = absolutePrivatePath(parsed.options.get("output"), "--output");
    if (new Set([requestPath, wrenchContextPath, draftPath, output]).size !== 4) {
      throw new CliError("usage", "Handoff request, Wrench context, draft, and output paths must be different");
    }
    let request;
    let wrenchContext;
    let draft;
    try {
      request = parseAgentMessageHandoffRequestV1(await readStablePrivateJson(requestPath, "Private handoff request file", AGENTIC_MESSAGING_V1_LIMITS.privateJsonBytes));
      wrenchContext = parseWrenchMessagingContextBindingV1(await readStablePrivateJson(wrenchContextPath, "Private Wrench context file", AGENTIC_MESSAGING_V1_LIMITS.privateJsonBytes));
      draft = parseAgentMessageDraftV1(await readStablePrivateJson(draftPath, "Private draft file", AGENTIC_MESSAGING_V1_LIMITS.privateJsonBytes));
    } catch (error) {
      translateAgenticContractError(error, "Private handoff input");
    }
    const createdAt = canonicalNow(io);
    if (wrenchContext.validatedAt > createdAt || wrenchContext.expiresAt <= createdAt) {
      throw new CliError("conflict", "The private Wrench context is not current; collect a fresh exact context");
    }
    const context = await existingStore(parsed);
    let published = false;
    try {
      const preparation = context.store.handoffPreparation(identifier, request.routeCandidateId);
      const expiresAt = new Date(Math.min(Date.parse(createdAt) + AGENTIC_MESSAGING_V1_LIMITS.handoffLifetimeMilliseconds, Date.parse(wrenchContext.expiresAt))).toISOString();
      const handoff = createAgentMessageHandoffV1({
        createdAt,
        expiresAt,
        contact: {
          contactId: preparation.contactId,
          routeCandidateId: preparation.candidate.id,
          sourceId: preparation.candidate.sourceId,
          conversationId: preparation.candidate.conversationId
        },
        evidence: {
          corpusRevision: preparation.corpusRevision,
          sourceRevision: preparation.candidate.sourceRevision,
          profileState: preparation.profileState,
          profileEvidenceRevision: preparation.profileEvidenceRevision
        },
        wrenchContext,
        draft
      });
      await atomicWritePrivate(output, prettyJson(handoff));
      published = true;
      const audit = context.store.recordPreparedHandoff(handoff);
      emit(io, json, audit, `Prepared private handoff ${audit.handoffId} with ${audit.partCount} message parts`);
    } catch (error) {
      if (published)
        await unlink2(output).catch(() => {
          return;
        });
      if (error instanceof AgenticMessagingV1ContractError) {
        translateAgenticContractError(error, "Private handoff");
      }
      throw error;
    } finally {
      context.store.close();
    }
    return;
  }
  if (command === "handoff" && subcommand === "verify" && identifier !== undefined) {
    rejectUnused(parsed, ["data-dir"], ["json"]);
    const input = absolutePrivatePath(identifier, "Handoff path");
    let handoff;
    try {
      handoff = parseAgentMessageHandoffV1(await readStablePrivateJson(input, "Private handoff file", AGENTIC_MESSAGING_V1_LIMITS.privateJsonBytes));
    } catch (error) {
      translateAgenticContractError(error, "Private handoff file");
    }
    const result = {
      valid: true,
      handoffId: handoff.handoffId,
      handoffSha256: handoff.integrity.canonicalSha256,
      contactIdSha256: sha256(handoff.contact.contactId),
      routeCandidateIdSha256: sha256(handoff.contact.routeCandidateId),
      sourceIdSha256: sha256(handoff.contact.sourceId),
      conversationIdSha256: sha256(handoff.contact.conversationId),
      corpusRevision: handoff.evidence.corpusRevision,
      sourceRevision: handoff.evidence.sourceRevision,
      profileState: handoff.evidence.profileState,
      profileEvidenceRevision: handoff.evidence.profileEvidenceRevision,
      wrenchContractHash: handoff.wrench.contractHash,
      routeRefSha256: handoff.wrench.routeRefSha256,
      contextRefSha256: handoff.wrench.contextRefSha256,
      exactDataRevisionSha256: handoff.wrench.exactDataRevision,
      latestMessageRevisionSha256: handoff.wrench.latestMessageRevision,
      turnDigest: wrenchMessagingTurnDigestV1(handoff),
      partCount: handoff.turn.bubbles.length,
      createdAt: handoff.createdAt,
      expiresAt: handoff.expiresAt,
      expired: handoff.expiresAt <= canonicalNow(io)
    };
    emit(io, json, result, `Verified private handoff ${handoff.handoffId}`);
    return;
  }
  if (command === "handoff" && subcommand === "record" && identifier !== undefined) {
    rejectUnused(parsed, ["data-dir", "wrench-receipt"], ["json"]);
    const receiptPath = absolutePrivatePath(parsed.options.get("wrench-receipt"), "--wrench-receipt");
    let receipt;
    try {
      receipt = await readStablePrivateJson(receiptPath, "Private Wrench receipt file", AGENTIC_MESSAGING_V1_LIMITS.privateJsonBytes);
    } catch (error) {
      translateAgenticContractError(error, "Private Wrench receipt file");
    }
    const context = await existingStore(parsed);
    try {
      let audit;
      try {
        audit = context.store.recordHandoffReceipt(identifier, receipt);
      } catch (error) {
        if (error instanceof AgenticMessagingV1ContractError) {
          translateAgenticContractError(error, "Private Wrench receipt file");
        }
        throw error;
      }
      emit(io, json, audit, `Recorded body-free Wrench audit for ${audit.handoffId}`);
    } finally {
      context.store.close();
    }
    return;
  }
  if (command === "handoffs" && subcommand === "show" && identifier !== undefined) {
    rejectUnused(parsed, ["data-dir"], ["json"]);
    const context = await existingStore(parsed);
    try {
      const audit = context.store.handoffAudit(identifier);
      emit(io, json, audit, `${audit.state} handoff audit ${audit.handoffId}`);
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
        defaultMessagesDatabase: DEFAULT_IMESSAGE_DATABASE,
        defaultContactsDirectory: DEFAULT_CONTACTS_DIRECTORY
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
  stdout: (text3) => process.stdout.write(text3),
  stderr: (text3) => process.stderr.write(text3),
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
