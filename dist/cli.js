#!/usr/bin/env bun
// @bun
import {
  CONTACTS_SCHEMA_VERSION,
  CORPUS_SCHEMA_VERSION,
  EVALUATION_PACKET_SCHEMA_VERSION,
  LEGACY_PROFILE_SCHEMA_VERSION,
  METRICS_SCHEMA_VERSION,
  PROFILE_SCHEMA_VERSION,
  STUDY_PACKET_SCHEMA_VERSION,
  canonicalJson,
  prettyJson,
  sha256
} from "./cli-xby0v0et.js";

// src/commands.ts
import { lstat as lstat3 } from "fs/promises";
import { isAbsolute as isAbsolute4, resolve as resolve5 } from "path";

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
  "limit",
  "min-outgoing",
  "output",
  "prompt-output",
  "project",
  "reference-output",
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

// src/imessage.ts
import { Database as Database2 } from "bun:sqlite";
import { createHash, createHmac as createHmac2 } from "crypto";
import {
  chmodSync as chmodSync2,
  constants as fsConstants2,
  copyFileSync as copyFileSync2,
  lstatSync as lstatSync2,
  mkdirSync as mkdirSync2,
  mkdtempSync as mkdtempSync2,
  realpathSync as realpathSync2,
  rmSync as rmSync2
} from "fs";
import { homedir as homedir2, tmpdir as tmpdir2 } from "os";
import { basename as basename2, isAbsolute as isAbsolute2, join as join2, resolve as resolve2 } from "path";
var DEFAULT_IMESSAGE_DATABASE = join2(homedir2(), "Library", "Messages", "chat.db");
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
  return createHash("sha256").update(value).digest("hex");
}
function hmac2(key, namespace, value) {
  return createHmac2("sha256", key).update(`message-like-me\x00${namespace}\x00`, "utf8").update(value, "utf8").digest("hex");
}
function hmacKey(value) {
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
function sameFile2(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}
function inspectSource(path, maximumBytes) {
  if (!isAbsolute2(path))
    return fail2("path must be absolute");
  const requested = resolve2(path);
  const requestedStats = lstatSync2(requested, { bigint: true });
  if (!requestedStats.isFile() || requestedStats.isSymbolicLink() || requestedStats.nlink !== 1n || !ownedByCurrentUser(requestedStats) || requestedStats.size < 1n || requestedStats.size > BigInt(maximumBytes)) {
    return fail2("must be one current-user-owned regular non-symlink file within the configured size bound");
  }
  const physicalPath = realpathSync2(requested);
  const physicalStats = lstatSync2(physicalPath, { bigint: true });
  if (!sameFile2(requestedStats, physicalStats)) {
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
  if (!sameFile2(source.stats, current.stats))
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
    return other !== undefined && member.suffix === other.suffix && sameFile2(member.stats, other.stats) && member.stats.size === other.stats.size && member.stats.mtimeNs === other.stats.mtimeNs && member.stats.ctimeNs === other.stats.ctimeNs;
  });
}
function isolateSource2(source, maximumBytes) {
  const temporaryRoot = tmpdir2();
  if (!isAbsolute2(temporaryRoot))
    return fail2("requires an absolute temporary directory");
  const temporaryDirectory = mkdtempSync2(join2(temporaryRoot, "message-like-me-source-"));
  chmodSync2(temporaryDirectory, 448);
  try {
    for (let attempt = 0;attempt < SOURCE_SNAPSHOT_ATTEMPTS; attempt += 1) {
      const before = snapshotMembers2(source, maximumBytes);
      const attemptDirectory = join2(temporaryDirectory, `attempt-${attempt}`);
      mkdirSync2(attemptDirectory, { mode: 448 });
      let copyFailedForRace = false;
      try {
        for (const member of before) {
          const destination = join2(attemptDirectory, `${basename2(source.path)}${member.suffix}`);
          copyFileSync2(member.path, destination, fsConstants2.COPYFILE_EXCL | fsConstants2.COPYFILE_FICLONE);
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
          path: join2(attemptDirectory, basename2(source.path)),
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
      participantId: hmac2(key, "participant", `${service ?? ""}\x00${id}`)
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
      id: hmac2(key, "conversation", sourceKey),
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
  const key = hmacKey(options.hmacKey);
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
        const id = hmac2(key, "message", row.sourceGuid);
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
  const reactions = messages.filter(({ message }) => message.kind === "reaction" && message.retractedAt === null);
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
    textMessageCount: ordered.filter(({ message }) => message.retractedAt === null && message.kind === "text" && message.body !== null).length,
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
        explicitReplyMessages: outgoing.filter(({ explicitReply }) => explicitReply).length
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
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  stat,
  unlink
} from "fs/promises";
import { homedir as homedir3, platform } from "os";
import { basename as basename3, dirname as dirname2, isAbsolute as isAbsolute3, join as join3, resolve as resolve3 } from "path";
function defaultDataDirectory() {
  const override = process.env.XDG_DATA_HOME;
  if (override !== undefined && override.trim() !== "") {
    if (!isAbsolute3(override)) {
      throw new CliError("unsafe-path", "XDG_DATA_HOME must be absolute");
    }
    return join3(resolve3(override), "message-like-me");
  }
  if (platform() === "darwin") {
    return join3(homedir3(), "Library", "Application Support", "Message Like Me");
  }
  return join3(homedir3(), ".local", "share", "message-like-me");
}
function dataPaths(explicit) {
  if (explicit !== undefined && !isAbsolute3(explicit)) {
    throw new CliError("unsafe-path", "Data directory must be absolute");
  }
  const root = explicit === undefined ? defaultDataDirectory() : resolve3(explicit);
  if (!isAbsolute3(root))
    throw new CliError("unsafe-path", "Data directory must be absolute");
  return {
    root,
    database: join3(root, "message-like-me.sqlite3"),
    installKey: join3(root, "install.key"),
    packets: join3(root, "study-packets")
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
  const physicalPackets = await ensurePrivateDirectory(join3(physicalRoot, "study-packets"));
  return {
    root: physicalRoot,
    database: join3(physicalRoot, basename3(paths.database)),
    installKey: join3(physicalRoot, basename3(paths.installKey)),
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
  const requested = await lstat(path);
  if (requested.isSymbolicLink() || !requested.isDirectory()) {
    throw new CliError("unsafe-path", `${path} must be a physical directory`);
  }
  await assertOwned(path);
  if ((requested.mode & 63) !== 0) {
    throw new CliError("unsafe-path", `${path} must already have private permissions; refusing to change a caller-owned directory`);
  }
  return realpath(path);
}
async function syncDirectory(path) {
  let handle = null;
  try {
    handle = await open(path, "r");
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
  const parent = await privateOutputDirectory(dirname2(resolve3(path)));
  const destination = join3(parent, basename3(path));
  const temporary = join3(parent, `.${basename3(path)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
  let published = false;
  try {
    const handle = await open(temporary, "wx", 384);
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
import { constants as fsConstants3 } from "fs";
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
    const handle = await open2(path, fsConstants3.O_RDONLY | fsConstants3.O_NOFOLLOW);
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

// src/skill-install.ts
import { cp, lstat as lstat2, mkdir as mkdir2, realpath as realpath2, rm } from "fs/promises";
import { homedir as homedir4 } from "os";
import { dirname as dirname3, join as join4, resolve as resolve4 } from "path";
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
  return resolve4(dirname3(fileURLToPath(import.meta.url)), "../skills/message-like-me");
}
function targetRoot(target, scope, projectDirectory) {
  const directory = target === "codex" ? ".codex" : target === "claude" ? ".claude" : ".agents";
  return scope === "user" ? join4(homedir4(), directory, "skills") : join4(resolve4(projectDirectory), directory, "skills");
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
  const destination = join4(root, "message-like-me");
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
import { Database as Database3 } from "bun:sqlite";
import {
  closeSync,
  constants as fsConstants4,
  fchmodSync,
  fstatSync,
  lstatSync as lstatSync3,
  openSync
} from "fs";
var STORE_SCHEMA_VERSION = 2;
var PERSON_SCOPE_PREFIX = "person_";
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
  if (rows.length === 0)
    return null;
  return Object.freeze({
    id: personScopeId(addressBookContactId),
    kind: "person",
    addressBookContactId,
    conversationIds: Object.freeze(rows.map((row) => row.conversation_id))
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
  const matched = get(database, `
    SELECT contact_id FROM conversation_contact_scopes WHERE conversation_id=?
  `, contactId);
  if (matched !== null)
    return personScope(database, matched.contact_id);
  return Object.freeze({
    id: contactId,
    kind: "conversation",
    addressBookContactId: null,
    conversationIds: Object.freeze([contactId])
  });
}
function messageRowsForScope(database, scope, exactConversationId, window = UNBOUNDED_EVIDENCE_WINDOW) {
  if (exactConversationId !== undefined) {
    return all(database, `
      SELECT * FROM messages WHERE conversation_id=?
        AND (? IS NULL OR sent_at>=?) AND (? IS NULL OR sent_at<?)
      ORDER BY sent_at,source_row_id,id
    `, exactConversationId, window.after, window.after, window.before, window.before);
  }
  if (scope.kind === "person") {
    return all(database, `
      SELECT message.*
      FROM messages message
      JOIN conversation_contact_scopes association
        ON association.conversation_id=message.conversation_id
      WHERE association.contact_id=?
        AND (? IS NULL OR message.sent_at>=?)
        AND (? IS NULL OR message.sent_at<?)
      ORDER BY message.sent_at,message.source_row_id,message.id
    `, scope.addressBookContactId, window.after, window.after, window.before, window.before);
  }
  return all(database, `
    SELECT * FROM messages WHERE conversation_id=?
      AND (? IS NULL OR sent_at>=?) AND (? IS NULL OR sent_at<?)
    ORDER BY sent_at,source_row_id,id
  `, scope.conversationIds[0], window.after, window.after, window.before, window.before);
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
    editedAt: row.edited_at,
    retractedAt: row.retracted_at,
    service: row.service,
    attachmentCount: row.attachment_count
  };
}
function scopeEvidenceRevision(database, scope, exactConversationId, window = UNBOUNDED_EVIDENCE_WINDOW) {
  const conversationIds = exactConversationId === undefined ? scope.conversationIds : Object.freeze([exactConversationId]);
  const messages = messageRowsForScope(database, scope, exactConversationId, window).map(corpusMessage);
  return sha256(canonicalJson(window.after === null && window.before === null ? {
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
  const row = scope.kind === "person" ? get(database, `${select}
      FROM messages message
      JOIN conversation_contact_scopes association
        ON association.conversation_id=message.conversation_id
      WHERE association.contact_id=?`, scope.addressBookContactId) : get(database, `${select} FROM messages message WHERE message.conversation_id=?`, scope.conversationIds[0]);
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
  transaction(database, () => {
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
    backfillLegacyEvidence(database);
    database.exec(`PRAGMA user_version=${STORE_SCHEMA_VERSION}`);
  });
  database.exec(SCHEMA);
}
function rebuildConversationLabels(database, hmacKey2) {
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
    SELECT id,private_participants_json FROM conversations WHERE is_group=0 ORDER BY id
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
    if (normalizedHandles.length > 0 && owners.size > 0 && hmacKey2 === undefined) {
      throw new CliError("internal", "The installation key is required to rebuild contact labels");
    }
    const keys = hmacKey2 === undefined ? new Set : new Set(normalizedHandles.map((handle) => `${handle.kind}\x00${contactHandleMatchId(hmacKey2, handle)}`));
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
      descriptor = openSync(candidate, fsConstants4.O_RDONLY | fsConstants4.O_NOFOLLOW);
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
    const encoded = scalarText(this.#database, "source_identity");
    return encoded === null ? null : JSON.parse(encoded);
  }
  contactsRevision() {
    return scalarText(this.#database, "contacts_revision");
  }
  enrichContacts(snapshot, ingestedAt, hmacKey2) {
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
        if (canonical === null || canonical.kind !== handle.kind || canonical.normalizedValue !== handle.normalizedValue || handle.matchId !== contactHandleMatchId(hmacKey2, canonical) || !/^[a-f0-9]{64}$/u.test(handle.matchId))
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
      const projection = rebuildConversationLabels(this.#database, hmacKey2);
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
  replaceCorpus(snapshot, ingestedAt, hmacKey2) {
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
      rebuildConversationLabels(this.#database, hmacKey2);
    });
    return {
      corpusRevision,
      conversations: snapshot.conversations.length,
      messages: snapshot.messages.length
    };
  }
  listContacts(options) {
    if (this.corpusRevision() === null)
      return [];
    const rows = all(this.#database, `
      WITH scope_conversations AS (
        SELECT '${PERSON_SCOPE_PREFIX}' || association.contact_id AS id,
          coalesce(label.private_label,conversation.private_label) AS private_label,
          'person' AS scope_kind,0 AS is_group,1 AS participant_count,
          conversation.id AS conversation_id
        FROM conversation_contact_scopes association
        JOIN conversations conversation ON conversation.id=association.conversation_id
        LEFT JOIN conversation_contact_labels label
          ON label.conversation_id=association.conversation_id
        WHERE conversation.is_group=0
        UNION ALL
        SELECT conversation.id,conversation.private_label,'conversation',conversation.is_group,
          conversation.participant_count,conversation.id
        FROM conversations conversation
        LEFT JOIN conversation_contact_scopes association
          ON association.conversation_id=conversation.id
        WHERE association.conversation_id IS NULL
      )
      SELECT scope.id,min(scope.private_label) AS private_label,
        max(scope.scope_kind) AS scope_kind,
        count(distinct scope.conversation_id) AS conversation_count,
        max(scope.is_group) AS is_group,max(scope.participant_count) AS participant_count,
        min(message.sent_at) AS first_message_at,max(message.sent_at) AS last_message_at,
        count(message.id) AS message_count,
        sum(CASE WHEN message.direction = 'incoming' THEN 1 ELSE 0 END) AS incoming_count,
        sum(CASE WHEN message.direction = 'outgoing' THEN 1 ELSE 0 END) AS outgoing_count
      FROM scope_conversations scope
      JOIN messages message ON message.conversation_id=scope.conversation_id
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
    const rows = scope.kind === "person" ? all(this.#database, `
        SELECT conversation.id,conversation.source_key,
          coalesce(label.private_label,conversation.private_label) AS private_label,
          conversation.service,conversation.participant_count,
          conversation.participant_ids_json,conversation.private_participants_json,
          conversation.is_group
        FROM conversations conversation
        JOIN conversation_contact_scopes association
          ON association.conversation_id=conversation.id
        LEFT JOIN conversation_contact_labels label
          ON label.conversation_id=conversation.id
        WHERE association.contact_id=? ORDER BY conversation.id
      `, scope.addressBookContactId) : all(this.#database, `
      SELECT conversation.id,conversation.source_key,
        coalesce(contact_label.private_label,conversation.private_label) AS private_label,
        conversation.service,conversation.participant_count,conversation.participant_ids_json,
        conversation.private_participants_json,conversation.is_group
      FROM conversations conversation
      LEFT JOIN conversation_contact_labels contact_label
        ON contact_label.conversation_id = conversation.id
      WHERE conversation.id = ?
    `, scope.conversationIds[0]);
    const first = rows[0];
    if (first === undefined)
      return null;
    const services = [...new Set(rows.map((row) => row.service).filter((value) => value !== null))];
    const participants = [...new Set(rows.flatMap((row) => stringArray(row.participant_ids_json, `conversation ${row.id} participant IDs`)))].sort();
    const privateParticipants = privateLabels ? [...new Set(rows.flatMap((row) => stringArray(row.private_participants_json, `conversation ${row.id} private participants`)))].sort() : [];
    const counts = scopeMessageCounts(this.#database, scope);
    return {
      id: scope.id,
      sourceKey: scope.kind === "person" ? scope.id : first.source_key,
      privateLabel: privateLabels ? first.private_label : null,
      scopeKind: scope.kind,
      conversationCount: scope.conversationIds.length,
      service: services.length === 1 ? services[0] : null,
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
        messages: messageRowsForScope(this.#database, scope, undefined, window).map(corpusMessage)
      };
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
    return {
      storeSchemaVersion: userVersion(this.#database),
      quickCheck: quick,
      foreignKeyViolations: foreignKeys,
      corpusRevision: this.corpusRevision(),
      contactsRevision: this.contactsRevision(),
      conversations: count("conversations"),
      messages: count("messages"),
      profiles: count("profiles"),
      addressBookContacts: count("addressbook_contacts"),
      enrichedLabels: count("conversation_contact_labels")
    };
  }
}

// src/version.ts
var MESSAGE_LIKE_ME_VERSION = "0.2.0";

// src/commands.ts
var HELP = `Message Like Me ${MESSAGE_LIKE_ME_VERSION}

Usage:
  messagelikeme [--data-dir PATH] init [--json]
  messagelikeme [--data-dir PATH] ingest imessage [--database PATH] [--json]
  messagelikeme [--data-dir PATH] ingest contacts [--addressbook PATH] [--json]
  messagelikeme [--data-dir PATH] contacts list [--min-outgoing N] [--limit N] [--private] [--json]
  messagelikeme [--data-dir PATH] contacts show CONTACT_ID [--private] [--json]
  messagelikeme [--data-dir PATH] contacts resolve QUERY --private [--limit N] [--json]
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
  messagelikeme skill path [--json]
  messagelikeme skill install [--target codex|claude|agents] [--scope user|project]
                    [--project PATH] [--force] [--json]
  messagelikeme [--data-dir PATH] doctor [--json]

Message Like Me reads caller-owned macOS Messages and optional Contacts data,
then stores private analysis locally. It has no network, account, AI-provider,
or message-sending surface.
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
  return analyzeContact(evidence.messages, evidence.corpusRevision, contactId, options);
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
  if (!isAbsolute4(value))
    throw new CliError("unsafe-path", `${label} must be an absolute private path`);
  return resolve5(value);
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
      const metrics = analyzeContact(evidence.messages, evidence.corpusRevision, identifier, metricOptions(parsed));
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
      const metrics = analyzeContact(evidence.messages, evidence.corpusRevision, identifier, metricOptions(parsed));
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
