#!/usr/bin/env bun
/** Validate an Ensoul source packet without printing evidence content. */

import { existsSync, lstatSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

import {
  ArchiveError,
  canonicalBytes,
  canonicalText,
  failPacket,
  type JsonValue,
  rejectNonIJson,
  sha256Hex,
  strictJsonParse,
} from "./source-packet.ts";

export { PacketValidationError } from "./source-packet.ts";

const MAX_PACKET_BYTES = 128 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/u;
const PREFIXED_SHA256 = /^sha256:[a-f0-9]{64}$/u;
const DATE_TIME =
  /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]+))?(Z|[+-][0-9]{2}:[0-9]{2})$/u;

type JsonObject = { [key: string]: JsonValue };
type DateTime = bigint;

export type ValidationReceipt = Readonly<{
  valid: true;
  schemaVersion: JsonValue;
  packetDigest: string;
  adapter: JsonValue;
  payloadSchema: JsonValue;
  records: number;
  claims: number;
  visibility: Readonly<{ private: number; public: number }>;
}>;

function expectObject(value: JsonValue, path: string): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    failPacket(path, "must be an object");
  }
  return value;
}

function expectArray(value: JsonValue, path: string): JsonValue[] {
  if (!Array.isArray(value)) failPacket(path, "must be an array");
  return value;
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function expectString(value: JsonValue, path: string, minimum: number, maximum: number): string {
  if (typeof value !== "string") failPacket(path, "must be a string");
  const length = codePointLength(value);
  if (length < minimum || length > maximum) failPacket(path, "has an invalid length");
  return value;
}

function expectBoolean(value: JsonValue, path: string): boolean {
  if (typeof value !== "boolean") failPacket(path, "must be a boolean");
  return value;
}

function exactKeys(
  value: JsonObject,
  path: string,
  required: ReadonlySet<string>,
  optional: ReadonlySet<string> = new Set<string>(),
): void {
  const keys = new Set(Object.keys(value));
  const missing = Array.from(required).filter((key) => !keys.has(key)).sort();
  const extra = Array.from(keys)
    .filter((key) => !required.has(key) && !optional.has(key))
    .sort();
  if (missing.length !== 0) failPacket(path, `missing required member ${missing[0]}`);
  if (extra.length !== 0) failPacket(path, `contains unknown member ${extra[0]}`);
}

function expectEnum(
  value: JsonValue,
  path: string,
  allowed: ReadonlySet<string>,
): string {
  const text = expectString(value, path, 1, 200);
  if (!allowed.has(text)) failPacket(path, "has an unknown enum value");
  return text;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  const lengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths[month - 1] ?? 0;
}

function daysSinceUnixEpoch(year: number, month: number, day: number): number {
  const adjustedYear = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const adjustedMonth = month + (month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * adjustedMonth + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 +
    Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) +
    dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

function parseDateTime(value: JsonValue, path: string): DateTime {
  const text = expectString(value, path, 1, 100);
  const match = DATE_TIME.exec(text);
  if (match === null) failPacket(path, "must be an RFC 3339 date-time");

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fraction = match[7] ?? "";
  const zone = match[8]!;
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    failPacket(path, "must be a valid date-time");
  }

  let offsetSeconds = 0;
  if (zone !== "Z") {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) failPacket(path, "must be a valid date-time");
    const sign = zone[0] === "-" ? -1 : 1;
    offsetSeconds = sign * (offsetHour * 60 + offsetMinute) * 60;
  }

  const localSeconds =
    BigInt(daysSinceUnixEpoch(year, month, day)) * 86_400n +
    BigInt(hour * 3_600 + minute * 60 + second);
  const microseconds = BigInt((fraction.slice(0, 6) + "000000").slice(0, 6));
  return (localSeconds - BigInt(offsetSeconds)) * 1_000_000n + microseconds;
}

function expectDigest(value: JsonValue, path: string, prefixed: boolean): string {
  const length = prefixed ? 71 : 64;
  const text = expectString(value, path, length, length);
  if (!(prefixed ? PREFIXED_SHA256 : SHA256).test(text)) {
    failPacket(path, "must be a lowercase SHA-256 digest");
  }
  return text;
}

function validateSubject(value: JsonValue): JsonObject {
  const subject = expectObject(value, "subject");
  exactKeys(
    subject,
    "subject",
    new Set(["localId", "kind", "identityBasis"]),
    new Set(["displayName"]),
  );
  expectString(subject.localId!, "subject.localId", 1, 200);
  expectEnum(subject.kind!, "subject.kind", new Set(["owner", "contact", "person"]));
  expectString(subject.identityBasis!, "subject.identityBasis", 1, 1_000);
  if ("displayName" in subject) expectString(subject.displayName!, "subject.displayName", 1, 300);
  return subject;
}

function effectiveBounds(limits: JsonObject): readonly [DateTime | null, DateTime | null] {
  const directAfter = typeof limits.after === "string" ? limits.after : null;
  const aliasAfter = typeof limits.afterInclusive === "string" ? limits.afterInclusive : null;
  const directBefore = typeof limits.before === "string" ? limits.before : null;
  const aliasBefore = typeof limits.beforeExclusive === "string" ? limits.beforeExclusive : null;
  if (directAfter !== null && aliasAfter !== null) {
    failPacket("scope.limits", "declares two lower-bound aliases");
  }
  if (directBefore !== null && aliasBefore !== null) {
    failPacket("scope.limits", "declares two upper-bound aliases");
  }
  const lowerRaw = directAfter ?? aliasAfter;
  const upperRaw = directBefore ?? aliasBefore;
  const lower = lowerRaw === null ? null : parseDateTime(lowerRaw, "scope.limits lower bound");
  const upper = upperRaw === null ? null : parseDateTime(upperRaw, "scope.limits upper bound");
  if (lower !== null && upper !== null && lower >= upper) {
    failPacket("scope.limits", "lower bound must be earlier than upper bound");
  }
  return [lower, upper];
}

function validateLimits(value: JsonValue): JsonObject {
  const limits = expectObject(value, "scope.limits");
  if (Object.keys(limits).length > 32) failPacket("scope.limits", "has too many members");
  for (const [key, member] of Object.entries(limits)) {
    expectString(key, "scope.limits key", 1, 200);
    if (Array.isArray(member)) {
      if (member.length > 32) failPacket(`scope.limits.${key}`, "has too many array items");
      const values = member.map((item) =>
        expectString(item, `scope.limits.${key}[]`, 1, 200),
      );
      if (new Set(values).size !== values.length) {
        failPacket(`scope.limits.${key}`, "contains duplicate array items");
      }
    } else if (
      member !== null &&
      typeof member !== "string" &&
      typeof member !== "number" &&
      typeof member !== "boolean"
    ) {
      failPacket(`scope.limits.${key}`, "has a disallowed value type");
    }
    rejectNonIJson(member, `scope.limits.${key}`);
  }
  for (const name of ["after", "afterInclusive", "before", "beforeExclusive"] as const) {
    const member = limits[name];
    if (typeof member === "string") parseDateTime(member, `scope.limits.${name}`);
  }
  effectiveBounds(limits);
  return limits;
}

function validateScope(
  value: JsonValue,
): readonly [JsonObject, JsonObject, DateTime | null, DateTime | null] {
  const scope = expectObject(value, "scope");
  exactKeys(
    scope,
    "scope",
    new Set(["adapter", "payloadSchema", "completeness", "limits"]),
    new Set(["asOf", "sourceCutoff", "sourceRevision"]),
  );
  expectString(scope.adapter!, "scope.adapter", 1, 100);
  expectString(scope.payloadSchema!, "scope.payloadSchema", 1, 160);
  expectEnum(
    scope.completeness!,
    "scope.completeness",
    new Set(["complete", "sampled", "bounded", "unknown"]),
  );
  const asOf = "asOf" in scope ? parseDateTime(scope.asOf!, "scope.asOf") : null;
  const sourceCutoff =
    "sourceCutoff" in scope
      ? parseDateTime(scope.sourceCutoff!, "scope.sourceCutoff")
      : null;
  if ("sourceRevision" in scope) {
    expectString(scope.sourceRevision!, "scope.sourceRevision", 1, 300);
  }
  return [scope, validateLimits(scope.limits!), asOf, sourceCutoff];
}

function containsUnicodeWhitespace(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (
      (code >= 0x09 && code <= 0x0d) ||
      (code >= 0x1c && code <= 0x20) ||
      code === 0x85 ||
      code === 0xa0 ||
      code === 0x1680 ||
      (code >= 0x2000 && code <= 0x200a) ||
      code === 0x2028 ||
      code === 0x2029 ||
      code === 0x202f ||
      code === 0x205f ||
      code === 0x3000
    ) {
      return true;
    }
  }
  return false;
}

function validateContent(value: JsonValue, path: string): JsonObject {
  const content = expectObject(value, path);
  exactKeys(content, path, new Set(), new Set(["text", "title", "url", "truncated"]));
  if (!("text" in content) && !("title" in content) && !("url" in content)) {
    failPacket(path, "must include text, title, or url");
  }
  if ("text" in content) expectString(content.text!, `${path}.text`, 0, 50_000);
  if ("title" in content) expectString(content.title!, `${path}.title`, 0, 1_000);
  if ("url" in content) {
    const url = expectString(content.url!, `${path}.url`, 1, 4_096);
    if (!/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(url) || containsUnicodeWhitespace(url)) {
      failPacket(`${path}.url`, "must be an absolute URI");
    }
  }
  if ("truncated" in content) expectBoolean(content.truncated!, `${path}.truncated`);
  return content;
}

function validateProvenance(value: JsonValue, path: string, content: JsonObject): void {
  const provenance = expectObject(value, path);
  exactKeys(
    provenance,
    path,
    new Set(["provider", "contentSha256"]),
    new Set(["operation", "sourceId", "runId", "policyVersion", "model"]),
  );
  expectString(provenance.provider!, `${path}.provider`, 1, 100);
  for (const key of ["operation", "policyVersion", "model"] as const) {
    if (key in provenance) expectString(provenance[key]!, `${path}.${key}`, 1, 160);
  }
  for (const key of ["sourceId", "runId"] as const) {
    if (key in provenance) expectString(provenance[key]!, `${path}.${key}`, 1, 300);
  }
  const digest = expectDigest(provenance.contentSha256!, `${path}.contentSha256`, false);
  let expected: string;
  try {
    expected = sha256Hex(canonicalBytes(content));
  } catch (error) {
    if (error instanceof ArchiveError) failPacket(path, error.message);
    throw error;
  }
  if (digest !== expected) failPacket(path, "content digest mismatch");
}

type ValidatedRecord = Readonly<{
  record: JsonObject;
  occurred: DateTime | null;
  observed: DateTime | null;
}>;

function validateRecord(value: JsonValue, index: number): ValidatedRecord {
  const path = `records[${index}]`;
  const record = expectObject(value, path);
  exactKeys(
    record,
    path,
    new Set([
      "id",
      "digest",
      "kind",
      "authorRole",
      "contentRole",
      "authorshipConfidence",
      "sentStatus",
      "visibility",
      "sourceClass",
      "content",
      "provenance",
    ]),
    new Set(["occurredAt", "observedAt"]),
  );
  if (!("occurredAt" in record) && !("observedAt" in record)) {
    failPacket(path, "must include occurredAt or observedAt");
  }
  expectString(record.id!, `${path}.id`, 1, 200);
  const digest = expectDigest(record.digest!, `${path}.digest`, true);
  expectString(record.kind!, `${path}.kind`, 1, 100);
  expectEnum(
    record.authorRole!,
    `${path}.authorRole`,
    new Set(["subject", "counterpart", "third_party", "mixed", "unknown"]),
  );
  expectEnum(
    record.contentRole!,
    `${path}.contentRole`,
    new Set(["original", "quoted", "forwarded", "summary", "ai_assisted", "mixed", "unknown"]),
  );
  expectEnum(
    record.authorshipConfidence!,
    `${path}.authorshipConfidence`,
    new Set(["verified", "strong", "weak", "unknown"]),
  );
  expectEnum(
    record.sentStatus!,
    `${path}.sentStatus`,
    new Set(["sent", "draft", "received", "published", "unknown"]),
  );
  expectEnum(record.visibility!, `${path}.visibility`, new Set(["public", "private"]));
  expectEnum(
    record.sourceClass!,
    `${path}.sourceClass`,
    new Set([
      "private_capture",
      "polished_self_presentation",
      "observed_behavior",
      "public_web_evidence",
      "third_party_description",
      "institutional",
      "metadata",
    ]),
  );
  const occurred =
    "occurredAt" in record ? parseDateTime(record.occurredAt!, `${path}.occurredAt`) : null;
  const observed =
    "observedAt" in record ? parseDateTime(record.observedAt!, `${path}.observedAt`) : null;
  const content = validateContent(record.content!, `${path}.content`);
  validateProvenance(record.provenance!, `${path}.provenance`, content);
  const withoutDigest: JsonObject = { ...record };
  delete withoutDigest.digest;
  let expected: string;
  try {
    expected = `sha256:${sha256Hex(canonicalBytes(withoutDigest))}`;
  } catch (error) {
    if (error instanceof ArchiveError) failPacket(path, error.message);
    throw error;
  }
  if (digest !== expected) failPacket(path, "record digest mismatch");
  return { record, occurred, observed };
}

function validateClaims(
  value: JsonValue,
  subjectLocalId: string,
  recordIds: ReadonlySet<string>,
): number {
  const claims = expectArray(value, "claims");
  if (claims.length > 500) failPacket("claims", "has too many items");
  const claimIds = new Set<string>();
  const required = new Set([
    "id",
    "text",
    "recordIds",
    "status",
    "claimantRole",
    "claimKind",
    "subjectLocalId",
    "sensitivity",
  ]);
  claims.forEach((raw, index) => {
    const path = `claims[${index}]`;
    const claim = expectObject(raw, path);
    exactKeys(claim, path, required);
    const claimId = expectString(claim.id!, `${path}.id`, 1, 200);
    if (claimIds.has(claimId)) failPacket(path, "duplicates another claim id");
    claimIds.add(claimId);
    expectString(claim.text!, `${path}.text`, 1, 4_000);
    const refs = expectArray(claim.recordIds!, `${path}.recordIds`);
    if (refs.length < 1 || refs.length > 50) {
      failPacket(`${path}.recordIds`, "has an invalid item count");
    }
    const normalizedRefs = refs.map((ref, refIndex) =>
      expectString(ref, `${path}.recordIds[${refIndex}]`, 1, 200),
    );
    if (new Set(normalizedRefs).size !== normalizedRefs.length) {
      failPacket(`${path}.recordIds`, "contains duplicates");
    }
    if (normalizedRefs.some((ref) => !recordIds.has(ref))) {
      failPacket(`${path}.recordIds`, "references an unknown record");
    }
    expectEnum(
      claim.status!,
      `${path}.status`,
      new Set(["source_reported", "adapter_structured", "contested"]),
    );
    expectEnum(
      claim.claimantRole!,
      `${path}.claimantRole`,
      new Set(["subject", "counterpart", "third_party", "institutional", "adapter", "unknown"]),
    );
    expectEnum(
      claim.claimKind!,
      `${path}.claimKind`,
      new Set(["fact", "stated_belief", "reported_observation", "derived_index"]),
    );
    if (expectString(claim.subjectLocalId!, `${path}.subjectLocalId`, 1, 200) !== subjectLocalId) {
      failPacket(`${path}.subjectLocalId`, "does not match packet subject");
    }
    expectEnum(
      claim.sensitivity!,
      `${path}.sensitivity`,
      new Set(["ordinary", "sensitive_explicit"]),
    );
  });
  return claims.length;
}

export function validateSourcePacket(value: unknown): ValidationReceipt {
  rejectNonIJson(value);
  const packet = expectObject(value, "packet");
  exactKeys(
    packet,
    "packet",
    new Set([
      "schemaVersion",
      "digestCanonicalization",
      "packetId",
      "generatedAt",
      "subject",
      "scope",
      "records",
      "limitations",
      "packetDigest",
    ]),
    new Set(["claims"]),
  );
  if (packet.schemaVersion !== "ensoul.source-packet.v1") {
    failPacket("schemaVersion", "unsupported schema");
  }
  if (packet.digestCanonicalization !== "JCS-RFC8785") {
    failPacket("digestCanonicalization", "unsupported digest canonicalization");
  }
  expectString(packet.packetId!, "packetId", 8, 160);
  const generatedAt = parseDateTime(packet.generatedAt!, "generatedAt");
  const subject = validateSubject(packet.subject!);
  const [scope, limits, asOf, sourceCutoff] = validateScope(packet.scope!);
  if (asOf !== null && asOf > generatedAt) {
    failPacket("scope.asOf", "must not be later than generatedAt");
  }
  if (sourceCutoff !== null && sourceCutoff > generatedAt) {
    failPacket("scope.sourceCutoff", "must not be later than generatedAt");
  }
  if (sourceCutoff !== null && asOf !== null && sourceCutoff > asOf) {
    failPacket("scope.sourceCutoff", "must not be later than scope.asOf");
  }

  const records = expectArray(packet.records!, "records");
  if (records.length > 2_000) failPacket("records", "has too many items");
  const recordIds = new Set<string>();
  const timeValues: Array<readonly [DateTime | null, DateTime | null]> = [];
  const validatedRecords: JsonObject[] = [];
  records.forEach((raw, index) => {
    const { record, occurred, observed } = validateRecord(raw, index);
    const recordId = String(record.id);
    if (recordIds.has(recordId)) failPacket(`records[${index}].id`, "duplicates another record id");
    recordIds.add(recordId);
    timeValues.push([occurred, observed]);
    validatedRecords.push(record);
  });

  const [lower, upper] = effectiveBounds(limits);
  timeValues.forEach(([occurred, observed], index) => {
    if (occurred !== null && observed !== null && occurred > observed) {
      failPacket(`records[${index}]`, "occurredAt must not be later than observedAt");
    }
    const values: Array<readonly ["occurredAt" | "observedAt", DateTime | null]> = [
      ["occurredAt", occurred],
      ["observedAt", observed],
    ];
    for (const [label, time] of values) {
      if (time === null) continue;
      if (time > generatedAt) {
        failPacket(`records[${index}].${label}`, "must not be later than generatedAt");
      }
      if (asOf !== null && time > asOf) {
        failPacket(`records[${index}].${label}`, "must not be later than scope.asOf");
      }
      if (sourceCutoff !== null && time > sourceCutoff) {
        failPacket(`records[${index}].${label}`, "must not be later than scope.sourceCutoff");
      }
    }
    const effectiveTime = occurred ?? observed;
    if (effectiveTime !== null && lower !== null && effectiveTime < lower) {
      failPacket(`records[${index}]`, "evidence time is before the declared lower bound");
    }
    if (effectiveTime !== null && upper !== null && effectiveTime >= upper) {
      failPacket(`records[${index}]`, "evidence time is at or after the declared upper bound");
    }
  });

  const limitations = expectArray(packet.limitations!, "limitations");
  if (limitations.length < 1 || limitations.length > 32) {
    failPacket("limitations", "has an invalid item count");
  }
  limitations.forEach((limitation, index) =>
    expectString(limitation, `limitations[${index}]`, 1, 1_000),
  );
  const subjectLocalId = String(subject.localId);
  const claimCount = validateClaims(packet.claims ?? [], subjectLocalId, recordIds);
  const digest = expectDigest(packet.packetDigest!, "packetDigest", true);
  const withoutDigest: JsonObject = { ...packet };
  delete withoutDigest.packetDigest;
  let expected: string;
  try {
    expected = `sha256:${sha256Hex(canonicalBytes(withoutDigest))}`;
  } catch (error) {
    if (error instanceof ArchiveError) failPacket("packet", error.message);
    throw error;
  }
  if (digest !== expected) failPacket("packetDigest", "packet digest mismatch");

  const visibility = { private: 0, public: 0 };
  for (const record of validatedRecords) {
    const label = String(record.visibility);
    if (label === "private") visibility.private += 1;
    else visibility.public += 1;
  }
  return {
    valid: true,
    schemaVersion: packet.schemaVersion,
    packetDigest: digest,
    adapter: scope.adapter!,
    payloadSchema: scope.payloadSchema!,
    records: records.length,
    claims: claimCount,
    visibility,
  };
}

export function validateSourcePacketFile(path: string): ValidationReceipt {
  if (!isAbsolute(path)) failPacket("input", "path must be absolute");
  if (!existsSync(path)) failPacket("input", "must be a regular non-symlink file");
  const status = lstatSync(path);
  if (status.isSymbolicLink() || !status.isFile()) {
    failPacket("input", "must be a regular non-symlink file");
  }
  if (status.size > MAX_PACKET_BYTES) failPacket("input", "packet exceeds the size limit");
  return validateSourcePacket(strictJsonParse(readFileSync(path)));
}

function printUsage(): void {
  console.error("usage: validate-source-packet.ts ABSOLUTE_PACKET_PATH");
}

export function main(argv: string[] = Bun.argv.slice(2)): number {
  if (argv.length === 1 && (argv[0] === "-h" || argv[0] === "--help")) {
    console.log("Validate an Ensoul source packet without printing evidence content.");
    console.log("usage: validate-source-packet.ts ABSOLUTE_PACKET_PATH");
    return 0;
  }
  if (argv.length !== 1) {
    printUsage();
    return 2;
  }
  try {
    const receipt = validateSourcePacketFile(argv[0]!);
    console.log(canonicalText(receipt));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`invalid Ensoul source packet: ${message}`);
    return 2;
  }
}

if (import.meta.main) process.exitCode = main();
