import { createHash, createHmac } from "node:crypto";
import { constants as fsConstants, createReadStream, type BigIntStats } from "node:fs";
import { lstat, open, readdir, realpath, type FileHandle } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { canonicalJson, sha256 } from "./canonical-json.ts";
import { normalizeContactHandle } from "./contacts.ts";
import { CliError } from "./errors.ts";
import {
  MESSAGE_BUNDLE_SCHEMA_VERSION,
  type CorpusAttachmentProvenance,
  type CorpusConversation,
  type CorpusMessage,
  type CorpusMessageProvenance,
  type CorpusReactionFact,
  type CorpusSourceDeletion,
  type CorpusSourceRecord,
  type MessageBundleSnapshot,
  type SourceCorpusSnapshot,
} from "./types.ts";

type JsonObject = Record<string, unknown>;
type RecordKind = "account" | "participant" | "conversation" | "message" | "reaction" | "tombstone";

const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_RECORDS = 500_000;
const MAX_RECORD_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_ACCOUNTS = 128;
const MAX_IDENTIFIER_BYTES = 1_024;
const MAX_SHORT_TEXT_BYTES = 8 * 1024;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_PARTICIPANTS = 10_000;
const MAX_ATTACHMENTS = 256;
const MAX_WARNINGS = 128;

const ARTIFACTS = Object.freeze([
  Object.freeze({ path: "accounts.ndjson", kind: "account" as const }),
  Object.freeze({ path: "participants.ndjson", kind: "participant" as const }),
  Object.freeze({ path: "conversations.ndjson", kind: "conversation" as const }),
  Object.freeze({ path: "messages.ndjson", kind: "message" as const }),
  Object.freeze({ path: "reactions.ndjson", kind: "reaction" as const }),
  Object.freeze({ path: "tombstones.ndjson", kind: "tombstone" as const }),
]);

type Provenance = Readonly<{
  providerId: string;
  providerRevision: string | null;
  observedAt: string;
  connectedAccountProviderId: string;
}>;

type CommonRecord = Readonly<{
  schemaVersion: 1;
  kind: RecordKind;
  id: string;
  accountId: string;
  network: string;
  provenance: Provenance;
}>;

type AccountRecord = CommonRecord & Readonly<{
  kind: "account";
  displayName: string | null;
  handle: string | null;
  selfParticipantId: string;
}>;

type ParticipantRecord = CommonRecord & Readonly<{
  kind: "participant";
  displayName: string | null;
  handle: string | null;
  isSelf: boolean;
}>;

type ConversationRecord = CommonRecord & Readonly<{
  kind: "conversation";
  type: "direct" | "group" | "channel" | "unknown";
  title: string | null;
  participantIds: readonly string[];
  participantsComplete: boolean | null;
  startedAt: string | null;
  lastMessageAt: string | null;
}>;

type AttachmentRecord = Readonly<{
  kind: "audio" | "document" | "image" | "link" | "sticker" | "video" | "unknown";
  mimeType: string | null;
  name: string | null;
  sizeBytes: number | null;
}>;

type MessageRecord = CommonRecord & Readonly<{
  kind: "message";
  conversationId: string;
  senderParticipantId: string | null;
  direction: "incoming" | "outgoing" | "unknown";
  sentAt: string;
  sortKey: string;
  body: string | null;
  bodyTruncated: boolean | null;
  replyTo: Readonly<{ messageId: string | null; providerId: string }> | null;
  edit: Readonly<{
    kind: "in-place";
    editedAt: string;
    providerRevision: string;
  }> | Readonly<{
    kind: "replacement";
    replacesMessageId: string | null;
    replacesProviderId: string;
    editedAt: string;
    providerRevision: string;
  }> | null;
  deletion: Readonly<{
    state: "revoked" | "deleted-for-me" | "revoked-and-deleted-for-me";
    observedAt: string;
    providerRevision: string | null;
  }> | null;
  attachments: readonly AttachmentRecord[];
}>;

type ReactionRecord = CommonRecord & Readonly<{
  kind: "reaction";
  messageId: string | null;
  messageProviderId: string;
  participantId: string | null;
  body: string;
  reactedAt: string | null;
  state: "active" | "removed";
}>;

type TombstoneRecord = CommonRecord & Readonly<{
  kind: "tombstone";
  entityKind: "conversation" | "message" | "reaction";
  entityId: string | null;
  entityProviderId: string;
  deletedAt: string;
  scope: "remote" | "local" | "unknown";
  providerRevision: string | null;
}>;

type BundleRecord = AccountRecord | ParticipantRecord | ConversationRecord | MessageRecord | ReactionRecord | TombstoneRecord;

type Artifact = Readonly<{
  path: string;
  mediaType: "application/x-ndjson";
  recordKind: RecordKind;
  records: number;
  bytes: number;
  sha256: string;
}>;

type Manifest = Readonly<{
  schemaVersion: 1;
  format: "message-like-me.local-message-bundle";
  source: Readonly<{ id: "beeper-local"; version: string }>;
  provider: Readonly<{ id: "beeper"; version: string }>;
  timestamps: Readonly<{ startedAt: string; finishedAt: string; createdAt: string }>;
  completeness: Readonly<{
    kind: "bounded-local" | "truncated" | "unknown";
    reason: string | null;
    observedFrom: string | null;
    observedThrough: string | null;
  }>;
  warnings: readonly string[];
  privacy: Readonly<{
    classification: "private-local";
    attachments: "metadata-only";
    providerUrls: "excluded";
    credentials: "excluded";
  }>;
  counts: Readonly<Record<RecordKind, number>>;
  artifacts: readonly Artifact[];
  integrity: Readonly<{ algorithm: "sha256"; bundleSha256: string }>;
}>;

function object(value: unknown, label: string): JsonObject {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) throw new CliError("invalid-data", `${label} must be a plain object`);
  return value as JsonObject;
}

function exactKeys(value: JsonObject, keys: readonly string[], label: string): void {
  const expected = [...keys].sort();
  const observed = Object.keys(value).sort();
  if (
    expected.length !== observed.length
    || observed.some((key, index) => key !== expected[index])
  ) throw new CliError("invalid-data", `${label} must contain exactly: ${keys.join(", ")}`);
}

function boundedText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > maximum || value.includes("\u0000")) {
    throw new CliError("invalid-data", `${label} must be NUL-free text within ${maximum} UTF-8 bytes`);
  }
  return value;
}

function nullableText(value: unknown, label: string, maximum: number): string | null {
  return value === null ? null : boundedText(value, label, maximum);
}

function identifier(value: unknown, label: string): string {
  const result = boundedText(value, label, MAX_IDENTIFIER_BYTES);
  if (result.length === 0 || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw new CliError("invalid-data", `${label} must be a non-empty identifier without ASCII controls`);
  }
  return result;
}

function nullableIdentifier(value: unknown, label: string): string | null {
  return value === null ? null : identifier(value, label);
}

function token(value: unknown, label: string, maximum = 128): string {
  const result = boundedText(value, label, maximum);
  if (!/^[a-z0-9](?:[a-z0-9._+-]*[a-z0-9])?$/u.test(result)) {
    throw new CliError("invalid-data", `${label} must be a lowercase categorical token`);
  }
  return result;
}

function version(value: unknown, label: string): string {
  const result = boundedText(value, label, 128);
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._+-]*[A-Za-z0-9])?$/u.test(result)) {
    throw new CliError("invalid-data", `${label} must be a bounded version token`);
  }
  return result;
}

function oneOf<const T extends readonly string[]>(value: unknown, values: T, label: string): T[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new CliError("invalid-data", `${label} must be one of: ${values.join(", ")}`);
  }
  return value as T[number];
}

function integer(value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw new CliError("invalid-data", `${label} must be a non-negative safe integer`);
  }
  return value as number;
}

function nullableInteger(value: unknown, label: string): number | null {
  return value === null ? null : integer(value, label);
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new CliError("invalid-data", `${label} must be boolean`);
  return value;
}

function nullableBoolean(value: unknown, label: string): boolean | null {
  return value === null ? null : boolean(value, label);
}

function timestamp(value: unknown, label: string): string {
  const result = boundedText(value, label, 64);
  const date = new Date(result);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== result) {
    throw new CliError("invalid-data", `${label} must be a canonical UTC timestamp`);
  }
  return result;
}

function nullableTimestamp(value: unknown, label: string): string | null {
  return value === null ? null : timestamp(value, label);
}

function digest(value: unknown, label: string): string {
  const result = boundedText(value, label, 64);
  if (!/^[a-f0-9]{64}$/u.test(result)) throw new CliError("invalid-data", `${label} must be lowercase SHA-256`);
  return result;
}

function array(value: unknown, label: string, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new CliError("invalid-data", `${label} must contain at most ${maximum} items`);
  }
  return value;
}

function identifiers(value: unknown, label: string, maximum: number): readonly string[] {
  const result = array(value, label, maximum).map((item, index) => identifier(item, `${label}[${index}]`));
  if (new Set(result).size !== result.length) throw new CliError("invalid-data", `${label} repeats an ID`);
  return Object.freeze(result);
}

function parseProvenance(value: unknown, label: string): Provenance {
  const record = object(value, label);
  exactKeys(record, ["providerId", "providerRevision", "observedAt", "connectedAccountProviderId"], label);
  return Object.freeze({
    providerId: identifier(record.providerId, `${label}.providerId`),
    providerRevision: nullableIdentifier(record.providerRevision, `${label}.providerRevision`),
    observedAt: timestamp(record.observedAt, `${label}.observedAt`),
    connectedAccountProviderId: identifier(
      record.connectedAccountProviderId,
      `${label}.connectedAccountProviderId`,
    ),
  });
}

function parseCommon(
  record: JsonObject,
  kind: RecordKind,
  extraKeys: readonly string[],
  label: string,
): Omit<CommonRecord, "kind"> & Readonly<{ kind: RecordKind }> {
  exactKeys(record, ["schemaVersion", "kind", "id", "accountId", "network", "provenance", ...extraKeys], label);
  if (record.schemaVersion !== 1 || record.kind !== kind) {
    throw new CliError("invalid-data", `${label} has the wrong schemaVersion or kind`);
  }
  return Object.freeze({
    schemaVersion: 1,
    kind,
    id: identifier(record.id, `${label}.id`),
    accountId: identifier(record.accountId, `${label}.accountId`),
    network: token(record.network, `${label}.network`, 64),
    provenance: parseProvenance(record.provenance, `${label}.provenance`),
  });
}

function parseAccount(record: JsonObject, label: string): AccountRecord {
  const common = parseCommon(record, "account", ["displayName", "handle", "selfParticipantId"], label);
  if (common.id !== common.accountId || common.provenance.providerId !== common.provenance.connectedAccountProviderId) {
    throw new CliError("invalid-data", `${label} does not establish one connected account realm`);
  }
  return Object.freeze({
    ...common,
    kind: "account",
    displayName: nullableText(record.displayName, `${label}.displayName`, MAX_SHORT_TEXT_BYTES),
    handle: nullableText(record.handle, `${label}.handle`, MAX_SHORT_TEXT_BYTES),
    selfParticipantId: identifier(record.selfParticipantId, `${label}.selfParticipantId`),
  });
}

function parseParticipant(record: JsonObject, label: string): ParticipantRecord {
  const common = parseCommon(record, "participant", ["displayName", "handle", "isSelf"], label);
  return Object.freeze({
    ...common,
    kind: "participant",
    displayName: nullableText(record.displayName, `${label}.displayName`, MAX_SHORT_TEXT_BYTES),
    handle: nullableText(record.handle, `${label}.handle`, MAX_SHORT_TEXT_BYTES),
    isSelf: boolean(record.isSelf, `${label}.isSelf`),
  });
}

function parseConversation(record: JsonObject, label: string): ConversationRecord {
  const common = parseCommon(record, "conversation", [
    "type", "title", "participantIds", "participantsComplete", "startedAt", "lastMessageAt",
  ], label);
  const startedAt = nullableTimestamp(record.startedAt, `${label}.startedAt`);
  const lastMessageAt = nullableTimestamp(record.lastMessageAt, `${label}.lastMessageAt`);
  if (startedAt !== null && lastMessageAt !== null && startedAt > lastMessageAt) {
    throw new CliError("invalid-data", `${label}.startedAt must not follow lastMessageAt`);
  }
  return Object.freeze({
    ...common,
    kind: "conversation",
    type: oneOf(record.type, ["direct", "group", "channel", "unknown"] as const, `${label}.type`),
    title: nullableText(record.title, `${label}.title`, MAX_SHORT_TEXT_BYTES),
    participantIds: identifiers(record.participantIds, `${label}.participantIds`, MAX_PARTICIPANTS),
    participantsComplete: nullableBoolean(record.participantsComplete, `${label}.participantsComplete`),
    startedAt,
    lastMessageAt,
  });
}

function parseReply(value: unknown, label: string): MessageRecord["replyTo"] {
  if (value === null) return null;
  const record = object(value, label);
  exactKeys(record, ["messageId", "providerId"], label);
  return Object.freeze({
    messageId: record.messageId === null ? null : identifier(record.messageId, `${label}.messageId`),
    providerId: identifier(record.providerId, `${label}.providerId`),
  });
}

function parseEdit(value: unknown, sentAt: string, label: string): MessageRecord["edit"] {
  if (value === null) return null;
  const record = object(value, label);
  if (record.kind === "in-place") {
    exactKeys(record, ["kind", "editedAt", "providerRevision"], label);
    const editedAt = timestamp(record.editedAt, `${label}.editedAt`);
    if (editedAt < sentAt) throw new CliError("invalid-data", `${label} precedes the message`);
    return Object.freeze({
      kind: "in-place",
      editedAt,
      providerRevision: identifier(record.providerRevision, `${label}.providerRevision`),
    });
  }
  if (record.kind !== "replacement") {
    throw new CliError("invalid-data", `${label}.kind must be in-place or replacement`);
  }
  exactKeys(record, [
    "kind", "replacesMessageId", "replacesProviderId", "editedAt", "providerRevision",
  ], label);
  const replacesMessageId = record.replacesMessageId === null
    ? null
    : identifier(record.replacesMessageId, `${label}.replacesMessageId`);
  const replacesProviderId = identifier(record.replacesProviderId, `${label}.replacesProviderId`);
  const editedAt = timestamp(record.editedAt, `${label}.editedAt`);
  if (editedAt < sentAt) throw new CliError("invalid-data", `${label} precedes the message`);
  return Object.freeze({
    kind: "replacement",
    replacesMessageId,
    replacesProviderId,
    editedAt,
    providerRevision: identifier(record.providerRevision, `${label}.providerRevision`),
  });
}

function parseDeletion(value: unknown, label: string): MessageRecord["deletion"] {
  if (value === null) return null;
  const record = object(value, label);
  exactKeys(record, ["state", "observedAt", "providerRevision"], label);
  return Object.freeze({
    state: oneOf(record.state, ["revoked", "deleted-for-me", "revoked-and-deleted-for-me"] as const, `${label}.state`),
    observedAt: timestamp(record.observedAt, `${label}.observedAt`),
    providerRevision: nullableIdentifier(record.providerRevision, `${label}.providerRevision`),
  });
}

function parseAttachments(value: unknown, label: string): readonly AttachmentRecord[] {
  return Object.freeze(array(value, label, MAX_ATTACHMENTS).map((item, index) => {
    const itemLabel = `${label}[${index}]`;
    const record = object(item, itemLabel);
    exactKeys(record, ["kind", "mimeType", "name", "sizeBytes"], itemLabel);
    const name = nullableText(record.name, `${itemLabel}.name`, MAX_SHORT_TEXT_BYTES);
    if (name !== null && (name === "." || name === ".." || name.includes("/") || name.includes("\\"))) {
      throw new CliError("invalid-data", `${itemLabel}.name must not be a path`);
    }
    return Object.freeze({
      kind: oneOf(record.kind, ["audio", "document", "image", "link", "sticker", "video", "unknown"] as const, `${itemLabel}.kind`),
      mimeType: nullableText(record.mimeType, `${itemLabel}.mimeType`, 256),
      name,
      sizeBytes: nullableInteger(record.sizeBytes, `${itemLabel}.sizeBytes`),
    });
  }));
}

function parseMessage(record: JsonObject, label: string): MessageRecord {
  const common = parseCommon(record, "message", [
    "conversationId", "senderParticipantId", "direction", "sentAt", "sortKey", "body",
    "bodyTruncated", "replyTo", "edit", "deletion", "attachments",
  ], label);
  const sentAt = timestamp(record.sentAt, `${label}.sentAt`);
  const deletion = parseDeletion(record.deletion, `${label}.deletion`);
  const body = nullableText(record.body, `${label}.body`, MAX_BODY_BYTES);
  if (deletion !== null && body !== null) {
    throw new CliError("invalid-data", `${label}.body must be null for a deleted message`);
  }
  return Object.freeze({
    ...common,
    kind: "message",
    conversationId: identifier(record.conversationId, `${label}.conversationId`),
    senderParticipantId: record.senderParticipantId === null
      ? null
      : identifier(record.senderParticipantId, `${label}.senderParticipantId`),
    direction: oneOf(record.direction, ["incoming", "outgoing", "unknown"] as const, `${label}.direction`),
    sentAt,
    sortKey: identifier(record.sortKey, `${label}.sortKey`),
    body,
    bodyTruncated: nullableBoolean(record.bodyTruncated, `${label}.bodyTruncated`),
    replyTo: parseReply(record.replyTo, `${label}.replyTo`),
    edit: parseEdit(record.edit, sentAt, `${label}.edit`),
    deletion,
    attachments: parseAttachments(record.attachments, `${label}.attachments`),
  });
}

function parseReaction(record: JsonObject, label: string): ReactionRecord {
  const common = parseCommon(record, "reaction", [
    "messageId", "messageProviderId", "participantId", "body", "reactedAt", "state",
  ], label);
  return Object.freeze({
    ...common,
    kind: "reaction",
    messageId: record.messageId === null ? null : identifier(record.messageId, `${label}.messageId`),
    messageProviderId: identifier(record.messageProviderId, `${label}.messageProviderId`),
    participantId: record.participantId === null
      ? null
      : identifier(record.participantId, `${label}.participantId`),
    body: boundedText(record.body, `${label}.body`, MAX_SHORT_TEXT_BYTES),
    reactedAt: nullableTimestamp(record.reactedAt, `${label}.reactedAt`),
    state: oneOf(record.state, ["active", "removed"] as const, `${label}.state`),
  });
}

function parseTombstone(record: JsonObject, label: string): TombstoneRecord {
  const common = parseCommon(record, "tombstone", [
    "entityKind", "entityId", "entityProviderId", "deletedAt", "scope", "providerRevision",
  ], label);
  return Object.freeze({
    ...common,
    kind: "tombstone",
    entityKind: oneOf(record.entityKind, ["conversation", "message", "reaction"] as const, `${label}.entityKind`),
    entityId: record.entityId === null ? null : identifier(record.entityId, `${label}.entityId`),
    entityProviderId: identifier(record.entityProviderId, `${label}.entityProviderId`),
    deletedAt: timestamp(record.deletedAt, `${label}.deletedAt`),
    scope: oneOf(record.scope, ["remote", "local", "unknown"] as const, `${label}.scope`),
    providerRevision: nullableIdentifier(record.providerRevision, `${label}.providerRevision`),
  });
}

function parseRecord(value: unknown, kind: RecordKind, label: string): BundleRecord {
  const record = object(value, label);
  switch (kind) {
    case "account": return parseAccount(record, label);
    case "participant": return parseParticipant(record, label);
    case "conversation": return parseConversation(record, label);
    case "message": return parseMessage(record, label);
    case "reaction": return parseReaction(record, label);
    case "tombstone": return parseTombstone(record, label);
  }
}

function parseArtifact(value: unknown, index: number): Artifact {
  const expected = ARTIFACTS[index]!;
  const label = `manifest.artifacts[${index}]`;
  const record = object(value, label);
  exactKeys(record, ["path", "mediaType", "recordKind", "records", "bytes", "sha256"], label);
  if (
    record.path !== expected.path
    || record.mediaType !== "application/x-ndjson"
    || record.recordKind !== expected.kind
  ) throw new CliError("invalid-data", `${label} does not match the fixed artifact inventory`);
  return Object.freeze({
    path: expected.path,
    mediaType: "application/x-ndjson",
    recordKind: expected.kind,
    records: integer(record.records, `${label}.records`, MAX_RECORDS),
    bytes: integer(record.bytes, `${label}.bytes`, MAX_TOTAL_BYTES),
    sha256: digest(record.sha256, `${label}.sha256`),
  });
}

function parseManifest(value: unknown): Manifest {
  const record = object(value, "manifest");
  exactKeys(record, [
    "schemaVersion", "format", "source", "provider", "timestamps", "completeness",
    "warnings", "privacy", "counts", "artifacts", "integrity",
  ], "manifest");
  if (record.schemaVersion !== MESSAGE_BUNDLE_SCHEMA_VERSION || record.format !== "message-like-me.local-message-bundle") {
    throw new CliError("invalid-data", "Manifest has an unsupported schemaVersion or format");
  }
  const source = object(record.source, "manifest.source");
  exactKeys(source, ["id", "version"], "manifest.source");
  if (source.id !== "beeper-local") throw new CliError("invalid-data", "manifest.source.id must be beeper-local");
  const provider = object(record.provider, "manifest.provider");
  exactKeys(provider, ["id", "version"], "manifest.provider");
  if (provider.id !== "beeper") throw new CliError("invalid-data", "manifest.provider.id must be beeper");
  const timestamps = object(record.timestamps, "manifest.timestamps");
  exactKeys(timestamps, ["startedAt", "finishedAt", "createdAt"], "manifest.timestamps");
  const startedAt = timestamp(timestamps.startedAt, "manifest.timestamps.startedAt");
  const finishedAt = timestamp(timestamps.finishedAt, "manifest.timestamps.finishedAt");
  const createdAt = timestamp(timestamps.createdAt, "manifest.timestamps.createdAt");
  if (startedAt > finishedAt || finishedAt > createdAt) {
    throw new CliError("invalid-data", "Manifest timestamps are not monotonic");
  }
  const completeness = object(record.completeness, "manifest.completeness");
  exactKeys(completeness, ["kind", "reason", "observedFrom", "observedThrough"], "manifest.completeness");
  const observedFrom = nullableTimestamp(completeness.observedFrom, "manifest.completeness.observedFrom");
  const observedThrough = nullableTimestamp(completeness.observedThrough, "manifest.completeness.observedThrough");
  if (observedFrom !== null && observedThrough !== null && observedFrom > observedThrough) {
    throw new CliError("invalid-data", "Manifest completeness bounds are reversed");
  }
  const warnings = array(record.warnings, "manifest.warnings", MAX_WARNINGS)
    .map((value, index) => token(value, `manifest.warnings[${index}]`));
  if (new Set(warnings).size !== warnings.length) throw new CliError("invalid-data", "Manifest warnings repeat");
  const privacy = object(record.privacy, "manifest.privacy");
  exactKeys(privacy, ["classification", "attachments", "providerUrls", "credentials"], "manifest.privacy");
  if (
    privacy.classification !== "private-local"
    || privacy.attachments !== "metadata-only"
    || privacy.providerUrls !== "excluded"
    || privacy.credentials !== "excluded"
  ) throw new CliError("invalid-data", "Manifest privacy guarantees are unsupported");
  const counts = object(record.counts, "manifest.counts");
  exactKeys(counts, ARTIFACTS.map(({ kind }) => kind), "manifest.counts");
  const parsedCounts = Object.fromEntries(ARTIFACTS.map(({ kind }) => [
    kind,
    integer(counts[kind], `manifest.counts.${kind}`, MAX_RECORDS),
  ])) as Record<RecordKind, number>;
  if (parsedCounts.account > MAX_ACCOUNTS) {
    throw new CliError("invalid-data", `Manifest exceeds the ${MAX_ACCOUNTS}-account safety bound`);
  }
  if (!Array.isArray(record.artifacts) || record.artifacts.length !== ARTIFACTS.length) {
    throw new CliError("invalid-data", "Manifest must list the fixed six artifacts");
  }
  const artifacts = Object.freeze(record.artifacts.map(parseArtifact));
  let totalRecords = 0;
  let totalBytes = 0;
  for (const artifact of artifacts) {
    if (artifact.records !== parsedCounts[artifact.recordKind]) {
      throw new CliError("invalid-data", `${artifact.path} count disagrees with manifest.counts`);
    }
    totalRecords += artifact.records;
    totalBytes += artifact.bytes;
  }
  if (totalRecords > MAX_RECORDS || totalBytes > MAX_TOTAL_BYTES) {
    throw new CliError("invalid-data", "Manifest exceeds the bundle record or byte bound");
  }
  const integrity = object(record.integrity, "manifest.integrity");
  exactKeys(integrity, ["algorithm", "bundleSha256"], "manifest.integrity");
  if (integrity.algorithm !== "sha256") throw new CliError("invalid-data", "Manifest integrity algorithm is unsupported");
  const result: Manifest = Object.freeze({
    schemaVersion: 1,
    format: "message-like-me.local-message-bundle",
    source: Object.freeze({ id: "beeper-local", version: version(source.version, "manifest.source.version") }),
    provider: Object.freeze({ id: "beeper", version: version(provider.version, "manifest.provider.version") }),
    timestamps: Object.freeze({ startedAt, finishedAt, createdAt }),
    completeness: Object.freeze({
      kind: oneOf(completeness.kind, ["bounded-local", "truncated", "unknown"] as const, "manifest.completeness.kind"),
      reason: completeness.reason === null ? null : token(completeness.reason, "manifest.completeness.reason"),
      observedFrom,
      observedThrough,
    }),
    warnings: Object.freeze(warnings),
    privacy: Object.freeze({
      classification: "private-local",
      attachments: "metadata-only",
      providerUrls: "excluded",
      credentials: "excluded",
    }),
    counts: Object.freeze(parsedCounts),
    artifacts,
    integrity: Object.freeze({ algorithm: "sha256", bundleSha256: digest(integrity.bundleSha256, "manifest.integrity.bundleSha256") }),
  });
  const { integrity: _integrity, ...projection } = result;
  if (sha256(canonicalJson(projection)) !== result.integrity.bundleSha256) {
    throw new CliError("invalid-data", "Manifest bundle SHA-256 does not match its canonical projection");
  }
  return result;
}

function sameFile(left: Awaited<ReturnType<typeof lstat>>, right: Awaited<ReturnType<typeof lstat>>): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

async function bundleDirectory(path: string): Promise<string> {
  if (!isAbsolute(path) || resolve(path) !== path) {
    throw new CliError("unsafe-path", "Bundle input must be a normalized absolute path");
  }
  const before = await lstat(path);
  if (
    !before.isDirectory()
    || before.isSymbolicLink()
    || (before.mode & 0o777) !== 0o700
    || (typeof process.getuid === "function" && before.uid !== process.getuid())
  ) throw new CliError("unsafe-path", "Bundle input must be a current-user-owned mode-0700 physical directory");
  const physical = await realpath(path);
  if (physical !== path) throw new CliError("unsafe-path", "Bundle input path must not traverse a symbolic link");
  const after = await lstat(physical);
  if (!sameFile(before, after)) throw new CliError("unsafe-path", "Bundle directory changed while resolving");
  const expected = ["manifest.json", ...ARTIFACTS.map(({ path: artifactPath }) => artifactPath)].sort();
  const entries = (await readdir(physical)).sort();
  if (entries.length !== expected.length || entries.some((entry, index) => entry !== expected[index])) {
    throw new CliError("invalid-data", "Bundle directory does not contain exactly the version-one inventory");
  }
  return physical;
}

async function openPrivateFile(path: string, maximumBytes: number, allowEmpty: boolean): Promise<{
  handle: FileHandle;
  before: BigIntStats;
}> {
  const handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    if (
      !before.isFile()
      || before.nlink !== 1n
      || before.size > BigInt(maximumBytes)
      || (!allowEmpty && before.size < 1n)
      || (before.mode & 0o777n) !== 0o600n
      || (typeof process.getuid === "function" && before.uid !== BigInt(process.getuid()))
    ) throw new CliError("unsafe-path", `${path} must be a private physical file within its bound`);
    return { handle, before };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function assertFileUnchanged(
  path: string,
  handle: FileHandle,
  before: BigIntStats,
): Promise<void> {
  const after = await handle.stat({ bigint: true });
  if (
    before.dev !== after.dev
    || before.ino !== after.ino
    || before.size !== after.size
    || before.mtimeNs !== after.mtimeNs
    || before.ctimeNs !== after.ctimeNs
  ) throw new CliError("unsafe-path", `${path} changed while it was read`);
}

async function closeReadHandle(handle: FileHandle): Promise<void> {
  try {
    await handle.close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EBADF") throw error;
  }
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new CliError("invalid-data", `${label} is not valid UTF-8`, { cause: error });
  }
}

async function readManifest(path: string): Promise<Readonly<{ bytes: Uint8Array; manifest: Manifest }>> {
  const opened = await openPrivateFile(path, MAX_MANIFEST_BYTES, false);
  try {
    const bytes = Uint8Array.from(await opened.handle.readFile());
    await assertFileUnchanged(path, opened.handle, opened.before);
    let value: unknown;
    try {
      value = JSON.parse(decodeUtf8(bytes, "manifest.json")) as unknown;
    } catch (error) {
      throw new CliError("invalid-data", "manifest.json is not valid UTF-8 JSON", { cause: error });
    }
    const manifest = parseManifest(value);
    if (!Buffer.from(`${canonicalJson(manifest)}\n`, "utf8").equals(Buffer.from(bytes))) {
      throw new CliError("invalid-data", "manifest.json must use canonical JSON with one final newline");
    }
    return Object.freeze({ bytes, manifest });
  } finally {
    await closeReadHandle(opened.handle);
  }
}

async function readArtifact(root: string, artifact: Artifact): Promise<readonly BundleRecord[]> {
  const path = join(root, artifact.path);
  const opened = await openPrivateFile(path, artifact.bytes, true);
  const hash = createHash("sha256");
  const records: BundleRecord[] = [];
  let totalBytes = 0;
  let pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let endedWithNewline = false;
  try {
    const stream = createReadStream(path, {
      fd: opened.handle.fd,
      autoClose: false,
      start: 0,
      highWaterMark: 64 * 1024,
    });
    for await (const value of stream) {
      const chunk: Buffer<ArrayBufferLike> = Buffer.from(value as Uint8Array);
      hash.update(chunk);
      totalBytes += chunk.byteLength;
      if (totalBytes > artifact.bytes) throw new CliError("invalid-data", `${artifact.path} exceeds manifest bytes`);
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      let newline = pending.indexOf(0x0a);
      while (newline >= 0) {
        const line = pending.subarray(0, newline);
        pending = pending.subarray(newline + 1);
        endedWithNewline = true;
        if (line.byteLength < 1 || line.byteLength + 1 > MAX_RECORD_BYTES) {
          throw new CliError("invalid-data", `${artifact.path} contains a blank or oversized record`);
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(decodeUtf8(line, `${artifact.path} record`)) as unknown;
        } catch (error) {
          throw new CliError("invalid-data", `${artifact.path} contains invalid UTF-8 JSON`, { cause: error });
        }
        const normalized = parseRecord(
          parsed,
          artifact.recordKind,
          `${artifact.path}:${records.length + 1}`,
        );
        if (!Buffer.from(canonicalJson(normalized), "utf8").equals(line)) {
          throw new CliError("invalid-data", `${artifact.path} records must use canonical JSON`);
        }
        records.push(normalized);
        if (records.length > artifact.records) {
          throw new CliError("invalid-data", `${artifact.path} exceeds its manifest record count`);
        }
        newline = pending.indexOf(0x0a);
      }
      if (pending.byteLength + 1 > MAX_RECORD_BYTES) {
        throw new CliError("invalid-data", `${artifact.path} contains an oversized record`);
      }
      if (pending.length > 0) endedWithNewline = false;
    }
    await assertFileUnchanged(path, opened.handle, opened.before);
  } finally {
    await closeReadHandle(opened.handle);
  }
  if (pending.byteLength !== 0 || (artifact.records > 0 && !endedWithNewline)) {
    throw new CliError("invalid-data", `${artifact.path} must end every record with a newline`);
  }
  if (
    totalBytes !== artifact.bytes
    || records.length !== artifact.records
    || hash.digest("hex") !== artifact.sha256
  ) throw new CliError("invalid-data", `${artifact.path} does not match its manifest integrity`);
  return Object.freeze(records);
}

function hmacKey(value: string | Uint8Array): Uint8Array {
  const key = typeof value === "string" ? new TextEncoder().encode(value) : value;
  if (!(key instanceof Uint8Array) || key.byteLength < 16 || key.byteLength > 1_024) {
    throw new CliError("invalid-data", "Bundle HMAC key must contain 16 through 1024 bytes");
  }
  return Uint8Array.from(key);
}

function hmac(key: Uint8Array, namespace: string, value: string): string {
  return createHmac("sha256", key)
    .update(`message-like-me\0bundle-${namespace}\0`, "utf8")
    .update(value, "utf8")
    .digest("hex");
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function recordMap<T extends BundleRecord>(records: readonly T[], label: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const record of records) {
    if (result.has(record.id)) throw new CliError("invalid-data", `${label} repeats a bundle-local ID`);
    result.set(record.id, record);
  }
  return result;
}

function groupByAccount<T extends BundleRecord>(records: readonly T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const record of records) {
    const values = grouped.get(record.accountId) ?? [];
    values.push(record);
    grouped.set(record.accountId, values);
  }
  return grouped;
}

function attachmentProvenance(
  messageId: string,
  attachments: readonly AttachmentRecord[],
): readonly CorpusAttachmentProvenance[] {
  return Object.freeze(attachments.map((attachment, index) => ({
    id: `${messageId}:attachment:${index + 1}`,
    kind: attachment.kind,
    mimeType: attachment.mimeType,
    fileName: attachment.name,
    bytes: attachment.sizeBytes,
  })));
}

/**
 * Timeline reactions share the messages table, but provider message and
 * reaction IDs occupy independent foreign domains. The control-prefixed local
 * coordinate cannot equal a provider identifier because the bundle parser
 * rejects ASCII controls in every provider ID.
 */
function reactionTimelineCoordinate(localReactionId: string): string {
  return `\u001freaction-timeline:${localReactionId}`;
}

function normalizeBundle(
  manifest: Manifest,
  manifestSha256: string,
  records: Readonly<Record<RecordKind, readonly BundleRecord[]>>,
  key: Uint8Array,
): readonly SourceCorpusSnapshot[] {
  const accounts = records.account as readonly AccountRecord[];
  const participants = records.participant as readonly ParticipantRecord[];
  const conversations = records.conversation as readonly ConversationRecord[];
  const messages = records.message as readonly MessageRecord[];
  const reactions = records.reaction as readonly ReactionRecord[];
  const tombstones = records.tombstone as readonly TombstoneRecord[];
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
    ["tombstone", tombstones],
  ] as const) {
    const providerCoordinates = new Set<string>();
    for (const record of values) {
      const coordinate = `${record.accountId}\0${record.provenance.providerId}`;
      if (providerCoordinates.has(coordinate)) {
        throw new CliError(
          "invalid-data",
          `${kind} records repeat a provider identity within one account`,
        );
      }
      providerCoordinates.add(coordinate);
    }
  }
  for (const record of [...participants, ...conversations, ...messages, ...reactions, ...tombstones]) {
    const account = accountById.get(record.accountId);
    if (
      account === undefined
      || account.network !== record.network
      || account.provenance.connectedAccountProviderId !== record.provenance.connectedAccountProviderId
    ) throw new CliError("invalid-data", "A record does not match its connected account realm");
  }
  const participantsByAccount = groupByAccount(participants);
  const conversationsByAccount = groupByAccount(conversations);
  const messagesByAccount = groupByAccount(messages);
  const reactionsByAccount = groupByAccount(reactions);
  const tombstonesByAccount = groupByAccount(tombstones);

  const result: SourceCorpusSnapshot[] = [];
  const sourceIds = new Set<string>();
  for (const account of accounts) {
    const accountParticipants = participantsByAccount.get(account.id) ?? [];
    const participantById = new Map(accountParticipants.map((participant) => [participant.id, participant]));
    const self = participantById.get(account.selfParticipantId);
    if (
      self === undefined
      || !self.isSelf
      || accountParticipants.filter(({ isSelf }) => isSelf).length !== 1
    ) {
      throw new CliError("invalid-data", "An account must have exactly one matching self participant");
    }
    const accountConversations = conversationsByAccount.get(account.id) ?? [];
    const conversationParticipantIds = new Map(accountConversations.map((conversation) => [
      conversation.id,
      new Set(conversation.participantIds),
    ]));
    for (const conversation of accountConversations) {
      for (const participantId of conversation.participantIds) {
        if (!participantById.has(participantId)) {
          throw new CliError(
            "invalid-data",
            "A conversation references an unknown participant",
          );
        }
      }
      if (
        conversation.type === "direct"
        && conversation.participantsComplete === true
        && (
          conversation.participantIds.length !== 2
          || !conversation.participantIds.includes(account.selfParticipantId)
          || conversation.participantIds.filter((participantId) =>
            participantById.get(participantId)?.isSelf === false).length !== 1
        )
      ) {
        throw new CliError(
          "invalid-data",
          "A complete direct conversation must contain one self and one non-self participant",
        );
      }
    }
    const conversationById = new Map(accountConversations.map((conversation) => [conversation.id, conversation]));
    const namespace = [
      manifest.provider.id,
      account.provenance.connectedAccountProviderId,
      self.provenance.providerId,
    ].join("\0");
    const sourceId = `source_${hmac(key, "source", namespace)}`;
    if (sourceIds.has(sourceId)) {
      throw new CliError(
        "invalid-data",
        "Connected accounts repeat a stable source realm",
      );
    }
    sourceIds.add(sourceId);
    const conversationLocalIds = new Map(accountConversations.map((conversation) => [
      conversation.id,
      `conversation_${hmac(key, "conversation", `${namespace}\0${conversation.provenance.providerId}`)}`,
    ]));
    const participantLocalIds = new Map(accountParticipants.map((participant) => [
      participant.id,
      `participant_${hmac(key, "participant", `${namespace}\0${participant.provenance.providerId}`)}`,
    ]));
    const normalizedConversations: CorpusConversation[] = accountConversations.map((conversation) => {
      const known = conversation.participantIds.flatMap((id) => {
        const participant = participantById.get(id);
        return participant === undefined ? [] : [participant];
      });
      const peers = known.filter(({ isSelf }) => !isSelf);
      const completeDirectPeer = conversation.type === "direct"
        && conversation.participantsComplete === true
        && peers.length === 1
        ? peers[0]!
        : null;
      const canonicalHandle = completeDirectPeer?.handle === null || completeDirectPeer === null
        ? null
        : normalizeContactHandle(completeDirectPeer.handle);
      return Object.freeze({
        id: conversationLocalIds.get(conversation.id)!,
        sourceKey: conversation.provenance.providerId,
        privateLabel: conversation.title,
        service: account.network,
        participantCount: conversation.type === "direct" ? 1 : peers.length,
        participantIds: Object.freeze(peers.map((participant) => participantLocalIds.get(participant.id)!)),
        privateParticipants: canonicalHandle === null
          ? Object.freeze([])
          : Object.freeze([canonicalHandle.normalizedValue]),
        group: conversation.type !== "direct",
      });
    });

    const accountMessages = messagesByAccount.get(account.id) ?? [];
    const messageById = new Map(accountMessages.map((message) => [message.id, message]));
    const messageByProviderId = new Map(accountMessages.map((message) => [
      message.provenance.providerId,
      message,
    ]));
    const replacementTargets = new Map<string, Readonly<{
      target: MessageRecord | undefined;
      externalId: string;
    }>>();
    const replacerByTarget = new Map<string, string>();
    for (const message of accountMessages) {
      if (!conversationById.has(message.conversationId)) {
        throw new CliError("invalid-data", "A message references an unknown conversation");
      }
      if (message.senderParticipantId !== null && !participantById.has(message.senderParticipantId)) {
        throw new CliError("invalid-data", "A message references an unknown sender participant");
      }
      const sender = message.senderParticipantId === null
        ? null
        : participantById.get(message.senderParticipantId)!;
      const conversation = conversationById.get(message.conversationId)!;
      if (
        sender !== null
        && (
          (message.direction === "outgoing" && !sender.isSelf)
          || (message.direction === "incoming" && sender.isSelf)
        )
      ) throw new CliError("invalid-data", "A message direction conflicts with its sender identity");
      if (
        sender !== null
        && conversation.participantsComplete === true
        && !conversationParticipantIds.get(conversation.id)!.has(sender.id)
      ) throw new CliError("invalid-data", "A message sender is outside its complete conversation roster");
      if (message.replyTo !== null) {
        const localTarget = message.replyTo.messageId === null
          ? undefined
          : messageRecordById.get(message.replyTo.messageId);
        if (
          message.replyTo.messageId !== null
          && (
            localTarget === undefined
            || localTarget.accountId !== account.id
            || localTarget.provenance.providerId !== message.replyTo.providerId
          )
        ) throw new CliError("invalid-data", "A message reply has mismatched target coordinates");
        const providerTarget = messageByProviderId.get(message.replyTo.providerId);
        const target = localTarget ?? providerTarget;
        if (
          message.replyTo.providerId === message.provenance.providerId
          || (target !== undefined && target.conversationId !== message.conversationId)
        ) throw new CliError("invalid-data", "A message reply has an invalid conversation target");
      }
      if (message.edit?.kind === "replacement") {
        const localTarget = message.edit.replacesMessageId === null
          ? undefined
          : messageRecordById.get(message.edit.replacesMessageId);
        if (
          message.edit.replacesMessageId !== null
          && (
            localTarget === undefined
            || localTarget.accountId !== account.id
            || localTarget.provenance.providerId !== message.edit.replacesProviderId
          )
        ) throw new CliError("invalid-data", "A message edit has mismatched replacement coordinates");
        const providerTarget = messageByProviderId.get(message.edit.replacesProviderId);
        const target = localTarget ?? providerTarget;
        if (
          message.edit.replacesProviderId === message.provenance.providerId
          || (target !== undefined && target.conversationId !== message.conversationId)
        ) throw new CliError("invalid-data", "A message edit has an invalid replacement target");
        if (replacerByTarget.has(message.edit.replacesProviderId)) {
          throw new CliError("invalid-data", "A message version has multiple replacements");
        }
        replacerByTarget.set(message.edit.replacesProviderId, message.provenance.providerId);
        replacementTargets.set(message.id, Object.freeze({
          target,
          externalId: message.edit.replacesProviderId,
        }));
      }
    }
    const editEdges = new Map([...replacementTargets.entries()].map(([messageId, target]) => [
      messageById.get(messageId)!.provenance.providerId,
      target.externalId,
    ]));
    const completedEditNodes = new Set<string>();
    for (const start of editEdges.keys()) {
      if (completedEditNodes.has(start)) continue;
      const seen = new Set<string>();
      const chain: string[] = [];
      let current: string | undefined = start;
      while (current !== undefined && !completedEditNodes.has(current)) {
        if (seen.has(current)) throw new CliError("invalid-data", "Message replacement edits contain a cycle");
        seen.add(current);
        chain.push(current);
        current = editEdges.get(current);
      }
      for (const node of chain) completedEditNodes.add(node);
    }
    const analyzableMessages = accountMessages.filter(({ direction }) => direction !== "unknown")
      .sort((left, right) =>
        compareCodeUnits(left.conversationId, right.conversationId)
        || compareCodeUnits(left.sortKey, right.sortKey)
        || compareCodeUnits(left.sentAt, right.sentAt)
        || compareCodeUnits(left.provenance.providerId, right.provenance.providerId));
    const normalizedMessages: CorpusMessage[] = [];
    const messageProvenance: CorpusMessageProvenance[] = [];
    const localMessageIds = new Map<string, string>();
    const localReactionIds = new Map<string, string>();
    const timelineReactionIds = new Set<string>();
    for (const [index, message] of analyzableMessages.entries()) {
      const localId = `message_${hmac(key, "message", `${namespace}\0${message.provenance.providerId}`)}`;
      localMessageIds.set(message.id, localId);
      const body = message.bodyTruncated === true || message.deletion !== null ? null : message.body;
      normalizedMessages.push(Object.freeze({
        id: localId,
        sourceRowId: index + 1,
        sourceGuid: message.provenance.providerId,
        conversationId: conversationLocalIds.get(message.conversationId)!,
        sentAt: message.sentAt,
        direction: message.direction as "incoming" | "outgoing",
        body,
        bodySource: body === null ? "unavailable" : "text",
        kind: body !== null || message.bodyTruncated === true
          ? "text"
          : message.attachments.length > 0 ? "attachment" : "unknown",
        replyToSourceGuid: message.replyTo?.providerId ?? null,
        editedAt: message.edit?.editedAt ?? null,
        retractedAt: message.deletion?.observedAt ?? null,
        service: account.network,
        attachmentCount: message.attachments.length,
      }));
      messageProvenance.push(Object.freeze({
        messageId: localId,
        externalId: message.provenance.providerId,
        providerSortKey: message.sortKey,
        replyToExternalId: message.replyTo?.providerId ?? null,
        attachments: attachmentProvenance(localId, message.attachments),
        metadata: message,
      }));
    }

    const accountReactions = reactionsByAccount.get(account.id) ?? [];
    for (const reaction of accountReactions) {
      localReactionIds.set(
        reaction.id,
        `message_${hmac(key, "reaction", `${namespace}\0${reaction.provenance.providerId}`)}`,
      );
    }
    const reactionFacts: CorpusReactionFact[] = [];
    for (const reaction of accountReactions) {
      const localTarget = reaction.messageId === null
        ? undefined
        : messageRecordById.get(reaction.messageId);
      if (
        reaction.messageId !== null
        && (
          localTarget === undefined
          || localTarget.accountId !== account.id
          || localTarget.provenance.providerId !== reaction.messageProviderId
        )
      ) throw new CliError("invalid-data", "A reaction has mismatched target coordinates");
      if (reaction.participantId !== null && !participantById.has(reaction.participantId)) {
        throw new CliError("invalid-data", "A reaction references an unknown participant");
      }
      const target = localTarget ?? messageByProviderId.get(reaction.messageProviderId);
      const participant = reaction.participantId === null
        ? null
        : participantById.get(reaction.participantId)!;
      const targetConversationId = target === undefined
        ? null
        : conversationLocalIds.get(target.conversationId) ?? null;
      if (target !== undefined && participant !== null) {
        const targetConversation = conversationById.get(target.conversationId)!;
        if (
          targetConversation.participantsComplete === true
          && !conversationParticipantIds.get(targetConversation.id)!.has(participant.id)
        ) throw new CliError("invalid-data", "A reaction participant is outside its complete conversation roster");
      }
      const localId = localReactionIds.get(reaction.id)!;
      reactionFacts.push(Object.freeze({
        id: localId,
        externalId: reaction.provenance.providerId,
        targetExternalId: reaction.messageProviderId,
        conversationId: targetConversationId,
        direction: participant === null ? null : participant.isSelf ? "outgoing" : "incoming",
        body: reaction.body,
        reactedAt: reaction.reactedAt,
        state: reaction.state,
      }));
      if (reaction.state !== "active" || reaction.reactedAt === null || reaction.participantId === null) continue;
      if (participant === null || target === undefined || targetConversationId === null) continue;
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
        editedAt: null,
        retractedAt: null,
        service: account.network,
        attachmentCount: 0,
      }));
      messageProvenance.push(Object.freeze({
        messageId: localId,
        externalId: timelineCoordinate,
        providerSortKey: null,
        replyToExternalId: reaction.messageProviderId,
        attachments: Object.freeze([]),
        metadata: reaction,
      }));
    }
    const reactionFactByExternal = new Map(reactionFacts.map((fact) => [fact.externalId, fact]));

    const auxiliaryRecords: CorpusSourceRecord[] = [
      { kind: "account", id: account.provenance.providerId, record: account },
      ...accountParticipants.map((participant) => ({
        kind: "participant" as const,
        id: participant.provenance.providerId,
        record: participant,
      })),
      ...accountReactions.map((reaction) => ({
        kind: "reaction" as const,
        id: reaction.provenance.providerId,
        record: reaction,
      })),
      ...(tombstonesByAccount.get(account.id) ?? []).map((tombstone) => ({
        kind: "tombstone" as const,
        id: tombstone.provenance.providerId,
        record: tombstone,
      })),
      ...accountMessages.filter(({ direction }) => direction === "unknown").map((message) => ({
        kind: "excluded-message" as const,
        id: message.provenance.providerId,
        record: message,
      })),
    ];
    const accountTombstones = tombstonesByAccount.get(account.id) ?? [];
    const deletions: CorpusSourceDeletion[] = accountTombstones.map((tombstone) => {
      const entityId = tombstone.entityId;
      let localEntityId: string | null = null;
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
        reason: "tombstone" as const,
      });
    });
    for (const [messageId, replacement] of replacementTargets) {
      const message = messageById.get(messageId)!;
      deletions.push(Object.freeze({
        entityKind: "message" as const,
        localEntityId: replacement.target === undefined
          ? null
          : localMessageIds.get(replacement.target.id) ?? null,
        externalId: replacement.externalId,
        deletedAt: message.edit!.editedAt,
        expectedConversationId: conversationLocalIds.get(message.conversationId)!,
        reason: "replacement" as const,
      }));
    }
    for (const message of accountMessages) {
      if (message.deletion === null) continue;
      deletions.push(Object.freeze({
        entityKind: "message" as const,
        localEntityId: localMessageIds.get(message.id) ?? null,
        externalId: message.provenance.providerId,
        deletedAt: message.deletion.observedAt,
        expectedConversationId: conversationLocalIds.get(message.conversationId)!,
        reason: "tombstone" as const,
      }));
    }
    for (const message of accountMessages) {
      if (message.direction !== "unknown") continue;
      deletions.push(Object.freeze({
        entityKind: "message" as const,
        localEntityId: null,
        externalId: message.provenance.providerId,
        deletedAt: message.provenance.observedAt,
        expectedConversationId: conversationLocalIds.get(message.conversationId)!,
        reason: "explicit-exclusion" as const,
      }));
    }
    for (const reaction of accountReactions) {
      if (timelineReactionIds.has(reaction.id)) continue;
      const fact = reactionFactByExternal.get(reaction.provenance.providerId)!;
      deletions.push(Object.freeze({
        entityKind: reaction.state === "removed" ? "reaction" as const : "reaction-timeline" as const,
        localEntityId: localReactionIds.get(reaction.id)!,
        externalId: reaction.provenance.providerId,
        deletedAt: reaction.provenance.observedAt,
        ...(fact.conversationId === null ? {} : { expectedConversationId: fact.conversationId }),
        reason: reaction.state === "removed" ? "tombstone" as const : "explicit-exclusion" as const,
      }));
    }
    const sourceWarnings = [...manifest.warnings];
    const unknownDirections = accountMessages.filter(({ direction }) => direction === "unknown").length;
    const undatedReactions = accountReactions.filter(({ reactedAt }) => reactedAt === null).length;
    if (unknownDirections > 0) sourceWarnings.push(`unknown-direction-messages:${unknownDirections}`);
    if (undatedReactions > 0) sourceWarnings.push(`undated-reactions:${undatedReactions}`);
    const accountTimelineBounds = [
      ...accountMessages.map(({ sentAt }) => sentAt),
      ...accountReactions.flatMap(({ reactedAt }) => reactedAt === null ? [] : [reactedAt]),
    ].sort(compareCodeUnits);
    const accountObservedFrom = accountTimelineBounds[0] ?? null;
    const accountObservedThrough = accountTimelineBounds.at(-1) ?? null;
    const revisionHash = createHash("sha256");
    const revisionHeader = canonicalJson({
      schemaVersion: 1,
      source: manifest.source,
      provider: manifest.provider,
      completeness: manifest.completeness,
      warnings: manifest.warnings,
    });
    revisionHash.update(`${revisionHeader.length}:`, "utf8").update(revisionHeader, "utf8");
    for (const [kind, values] of [
      ["account", [account]],
      ["participant", accountParticipants],
      ["conversation", accountConversations],
      ["message", accountMessages],
      ["reaction", accountReactions],
      ["tombstone", accountTombstones],
    ] as const) {
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
          reason: manifest.completeness.reason,
        }),
        manifestSha256,
        identity: Object.freeze({ account, selfParticipantProviderId: self.provenance.providerId }),
        warnings: Object.freeze(sourceWarnings),
      }),
      conversations: Object.freeze(normalizedConversations),
      conversationProvenance: Object.freeze(accountConversations.map((conversation) => ({
        conversationId: conversationLocalIds.get(conversation.id)!,
        externalId: conversation.provenance.providerId,
        metadata: conversation,
      }))),
      messages: Object.freeze(normalizedMessages),
      messageProvenance: Object.freeze(messageProvenance),
      reactionFacts: Object.freeze(reactionFacts),
      auxiliaryRecords: Object.freeze(auxiliaryRecords),
      deletions: Object.freeze(deletions),
    }));
  }
  return Object.freeze(result);
}

/** Read one complete private Wrench/Beeper replacement-snapshot bundle. */
export async function readMessageBundle(
  path: string,
  options: Readonly<{ hmacKey: string | Uint8Array }>,
): Promise<MessageBundleSnapshot> {
  const key = hmacKey(options.hmacKey);
  const root = await bundleDirectory(path);
  const manifestResult = await readManifest(join(root, "manifest.json"));
  const manifest = manifestResult.manifest;
  const manifestSha256 = sha256(manifestResult.bytes);
  const parsedRecords: Array<readonly BundleRecord[]> = [];
  for (const artifact of manifest.artifacts) parsedRecords.push(await readArtifact(root, artifact));
  const records = Object.fromEntries(manifest.artifacts.map((artifact, index) => [
    artifact.recordKind,
    parsedRecords[index]!,
  ])) as Record<RecordKind, readonly BundleRecord[]>;
  return Object.freeze({
    schemaVersion: MESSAGE_BUNDLE_SCHEMA_VERSION,
    manifestSha256,
    sources: normalizeBundle(manifest, manifestSha256, records, key),
  });
}
