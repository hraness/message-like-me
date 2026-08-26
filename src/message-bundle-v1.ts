import { types as nodeTypes } from "node:util";

import { canonicalJson, sha256 } from "./canonical-json.ts";
import { MESSAGE_BUNDLE_V1_SCHEMA_IDENTITY } from "./message-bundle-v1-identity.ts";

/** Immutable wire-format identity for the local message bundle contract. */
export const LOCAL_MESSAGE_BUNDLE_V1_SCHEMA_VERSION = MESSAGE_BUNDLE_V1_SCHEMA_IDENTITY;
export const LOCAL_MESSAGE_BUNDLE_V1_FORMAT = "message-like-me.local-message-bundle" as const;
export const LOCAL_MESSAGE_BUNDLE_V1_SOURCE_ID = "beeper-local" as const;
export const LOCAL_MESSAGE_BUNDLE_V1_SOURCE_TRANSFORM_VERSION = "1.1.0" as const;
export const LOCAL_MESSAGE_BUNDLE_V1_PROVIDER_ID = "beeper" as const;

/**
 * Source-transform versions whose semantic output Message Like Me v1 accepts.
 * A producer package version may change without changing this transform version.
 */
export const LOCAL_MESSAGE_BUNDLE_V1_SUPPORTED_SOURCE_TRANSFORM_VERSIONS = Object.freeze([
  LOCAL_MESSAGE_BUNDLE_V1_SOURCE_TRANSFORM_VERSION,
] as const);

export const LOCAL_MESSAGE_BUNDLE_V1_LIMITS = Object.freeze({
  manifestBytes: 1024 * 1024,
  records: 500_000,
  recordBytes: 2 * 1024 * 1024,
  totalBytes: 512 * 1024 * 1024,
  accounts: 128,
  identifierBytes: 1_024,
  shortTextBytes: 8 * 1024,
  bodyBytes: 1024 * 1024,
  mimeTypeBytes: 256,
  participantsPerConversation: 10_000,
  attachmentsPerMessage: 256,
  warnings: 128,
} as const);

export const LOCAL_MESSAGE_BUNDLE_V1_ARTIFACTS = Object.freeze([
  Object.freeze({ path: "accounts.ndjson", kind: "account" as const }),
  Object.freeze({ path: "participants.ndjson", kind: "participant" as const }),
  Object.freeze({ path: "conversations.ndjson", kind: "conversation" as const }),
  Object.freeze({ path: "messages.ndjson", kind: "message" as const }),
  Object.freeze({ path: "reactions.ndjson", kind: "reaction" as const }),
  Object.freeze({ path: "tombstones.ndjson", kind: "tombstone" as const }),
] as const);

export type LocalMessageBundleV1RecordKind =
  typeof LOCAL_MESSAGE_BUNDLE_V1_ARTIFACTS[number]["kind"];

export type LocalMessageBundleV1ArtifactPath =
  typeof LOCAL_MESSAGE_BUNDLE_V1_ARTIFACTS[number]["path"];

export type LocalMessageBundleV1Provenance = Readonly<{
  providerId: string;
  providerRevision: string | null;
  observedAt: string;
  connectedAccountProviderId: string;
}>;

export type LocalMessageBundleV1CommonRecord = Readonly<{
  schemaVersion: typeof LOCAL_MESSAGE_BUNDLE_V1_SCHEMA_VERSION;
  kind: LocalMessageBundleV1RecordKind;
  id: string;
  accountId: string;
  network: string;
  provenance: LocalMessageBundleV1Provenance;
}>;

export type LocalMessageBundleV1AccountRecord = LocalMessageBundleV1CommonRecord & Readonly<{
  kind: "account";
  displayName: string | null;
  handle: string | null;
  selfParticipantId: string;
}>;

export type LocalMessageBundleV1ParticipantRecord = LocalMessageBundleV1CommonRecord & Readonly<{
  kind: "participant";
  displayName: string | null;
  handle: string | null;
  isSelf: boolean;
}>;

export type LocalMessageBundleV1ConversationRecord = LocalMessageBundleV1CommonRecord & Readonly<{
  kind: "conversation";
  type: "direct" | "group" | "channel" | "unknown";
  title: string | null;
  participantIds: readonly string[];
  participantsComplete: boolean | null;
  startedAt: string | null;
  lastMessageAt: string | null;
}>;

export type LocalMessageBundleV1AttachmentRecord = Readonly<{
  kind: "audio" | "document" | "image" | "link" | "sticker" | "video" | "unknown";
  mimeType: string | null;
  name: string | null;
  sizeBytes: number | null;
}>;

export type LocalMessageBundleV1Reply = Readonly<{
  messageId: string | null;
  providerId: string;
}>;

export type LocalMessageBundleV1Edit = Readonly<{
  kind: "in-place";
  editedAt: string;
  providerRevision: string;
}> | Readonly<{
  kind: "replacement";
  replacesMessageId: string | null;
  replacesProviderId: string;
  editedAt: string;
  providerRevision: string;
}>;

export type LocalMessageBundleV1Deletion = Readonly<{
  state: "revoked" | "deleted-for-me" | "revoked-and-deleted-for-me";
  observedAt: string;
  providerRevision: string | null;
}>;

export type LocalMessageBundleV1MessageRecord = LocalMessageBundleV1CommonRecord & Readonly<{
  kind: "message";
  conversationId: string;
  senderParticipantId: string | null;
  direction: "incoming" | "outgoing" | "unknown";
  sentAt: string;
  sortKey: string;
  body: string | null;
  bodyTruncated: boolean | null;
  replyTo: LocalMessageBundleV1Reply | null;
  edit: LocalMessageBundleV1Edit | null;
  deletion: LocalMessageBundleV1Deletion | null;
  attachments: readonly LocalMessageBundleV1AttachmentRecord[];
}>;

export type LocalMessageBundleV1ReactionRecord = LocalMessageBundleV1CommonRecord & Readonly<{
  kind: "reaction";
  messageId: string | null;
  messageProviderId: string;
  participantId: string | null;
  body: string;
  reactedAt: string | null;
  state: "active" | "removed";
}>;

export type LocalMessageBundleV1TombstoneRecord = LocalMessageBundleV1CommonRecord & Readonly<{
  kind: "tombstone";
  entityKind: "conversation" | "message" | "reaction";
  entityId: string | null;
  entityProviderId: string;
  deletedAt: string;
  scope: "remote" | "local" | "unknown";
  providerRevision: string | null;
}>;

export type LocalMessageBundleV1Record =
  | LocalMessageBundleV1AccountRecord
  | LocalMessageBundleV1ParticipantRecord
  | LocalMessageBundleV1ConversationRecord
  | LocalMessageBundleV1MessageRecord
  | LocalMessageBundleV1ReactionRecord
  | LocalMessageBundleV1TombstoneRecord;

export type LocalMessageBundleV1RecordByKind = Readonly<{
  account: LocalMessageBundleV1AccountRecord;
  participant: LocalMessageBundleV1ParticipantRecord;
  conversation: LocalMessageBundleV1ConversationRecord;
  message: LocalMessageBundleV1MessageRecord;
  reaction: LocalMessageBundleV1ReactionRecord;
  tombstone: LocalMessageBundleV1TombstoneRecord;
}>;

export type LocalMessageBundleV1Artifact = Readonly<{
  path: LocalMessageBundleV1ArtifactPath;
  mediaType: "application/x-ndjson";
  recordKind: LocalMessageBundleV1RecordKind;
  records: number;
  bytes: number;
  sha256: string;
}>;

export type LocalMessageBundleV1ManifestProjection = Readonly<{
  schemaVersion: typeof LOCAL_MESSAGE_BUNDLE_V1_SCHEMA_VERSION;
  format: typeof LOCAL_MESSAGE_BUNDLE_V1_FORMAT;
  source: Readonly<{
    id: typeof LOCAL_MESSAGE_BUNDLE_V1_SOURCE_ID;
    version: typeof LOCAL_MESSAGE_BUNDLE_V1_SOURCE_TRANSFORM_VERSION;
  }>;
  provider: Readonly<{ id: typeof LOCAL_MESSAGE_BUNDLE_V1_PROVIDER_ID; version: string }>;
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
  counts: Readonly<Record<LocalMessageBundleV1RecordKind, number>>;
  artifacts: readonly LocalMessageBundleV1Artifact[];
}>;

export type LocalMessageBundleV1Manifest = LocalMessageBundleV1ManifestProjection & Readonly<{
  integrity: Readonly<{ algorithm: "sha256"; bundleSha256: string }>;
}>;

/** Stable error category for callers that validate untrusted contract values. */
export class MessageBundleV1ContractError extends TypeError {
  readonly code = "message-bundle-v1-contract" as const;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MessageBundleV1ContractError";
  }
}

type JsonObject = Record<string, unknown>;

function fail(message: string): never {
  throw new MessageBundleV1ContractError(message);
}

function object(value: unknown, label: string): JsonObject {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || nodeTypes.isProxy(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) return fail(`${label} must be a plain object`);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== "string"
      || descriptor === undefined
      || descriptor.enumerable !== true
      || !("value" in descriptor)
    ) return fail(`${label} must contain only enumerable string data properties`);
  }
  return value as JsonObject;
}

function exactKeys(value: JsonObject, keys: readonly string[], label: string): void {
  const expected = [...keys].sort();
  const observed = Reflect.ownKeys(value).map(String).sort();
  if (
    expected.length !== observed.length
    || observed.some((key, index) => key !== expected[index])
  ) fail(`${label} must contain exactly: ${keys.join(", ")}`);
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function boundedText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || utf8Bytes(value) > maximum || value.includes("\u0000")) {
    return fail(`${label} must be NUL-free text within ${maximum} UTF-8 bytes`);
  }
  return value;
}

function nullableText(value: unknown, label: string, maximum: number): string | null {
  return value === null ? null : boundedText(value, label, maximum);
}

function identifier(value: unknown, label: string): string {
  const result = boundedText(value, label, LOCAL_MESSAGE_BUNDLE_V1_LIMITS.identifierBytes);
  if (result.length === 0 || /[\u0000-\u001f\u007f]/u.test(result)) {
    return fail(`${label} must be a non-empty identifier without ASCII controls`);
  }
  return result;
}

function nullableIdentifier(value: unknown, label: string): string | null {
  return value === null ? null : identifier(value, label);
}

function token(value: unknown, label: string, maximum = 128): string {
  const result = boundedText(value, label, maximum);
  if (!/^[a-z0-9](?:[a-z0-9._+-]*[a-z0-9])?$/u.test(result)) {
    return fail(`${label} must be a lowercase categorical token`);
  }
  return result;
}

function version(value: unknown, label: string): string {
  const result = boundedText(value, label, 128);
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._+-]*[A-Za-z0-9])?$/u.test(result)) {
    return fail(`${label} must be a bounded version token`);
  }
  return result;
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  values: T,
  label: string,
): T[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    return fail(`${label} must be one of: ${values.join(", ")}`);
  }
  return value as T[number];
}

function integer(value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    return fail(`${label} must be a non-negative safe integer`);
  }
  return value as number;
}

function nullableInteger(value: unknown, label: string): number | null {
  return value === null ? null : integer(value, label);
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") return fail(`${label} must be boolean`);
  return value;
}

function nullableBoolean(value: unknown, label: string): boolean | null {
  return value === null ? null : boolean(value, label);
}

function timestamp(value: unknown, label: string): string {
  const result = boundedText(value, label, 64);
  const date = new Date(result);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== result) {
    return fail(`${label} must be a canonical UTC timestamp`);
  }
  return result;
}

function nullableTimestamp(value: unknown, label: string): string | null {
  return value === null ? null : timestamp(value, label);
}

function digest(value: unknown, label: string): string {
  const result = boundedText(value, label, 64);
  if (!/^[a-f0-9]{64}$/u.test(result)) return fail(`${label} must be lowercase SHA-256`);
  return result;
}

function array(value: unknown, label: string, maximum: number): readonly unknown[] {
  if (
    !Array.isArray(value)
    || nodeTypes.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > maximum
  ) {
    return fail(`${label} must contain at most ${maximum} items`);
  }
  const expectedKeys = new Set([
    "length",
    ...Array.from({ length: value.length }, (_item, index) => String(index)),
  ]);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    const isLength = key === "length";
    if (
      typeof key !== "string"
      || !expectedKeys.has(key)
      || descriptor === undefined
      || !("value" in descriptor)
      || (!isLength && descriptor.enumerable !== true)
    ) return fail(`${label} must be a dense array of data properties`);
  }
  if (Reflect.ownKeys(value).length !== expectedKeys.size) {
    return fail(`${label} must be a dense array of data properties`);
  }
  return value;
}

function identifiers(value: unknown, label: string, maximum: number): readonly string[] {
  const result = array(value, label, maximum)
    .map((item, index) => identifier(item, `${label}[${index}]`));
  if (new Set(result).size !== result.length) fail(`${label} repeats an ID`);
  return Object.freeze(result);
}

export function isLocalMessageBundleV1SourceTransformVersion(
  value: unknown,
): value is typeof LOCAL_MESSAGE_BUNDLE_V1_SOURCE_TRANSFORM_VERSION {
  return value === LOCAL_MESSAGE_BUNDLE_V1_SOURCE_TRANSFORM_VERSION;
}

export function assertLocalMessageBundleV1SourceTransformVersion(
  value: unknown,
  label = "manifest.source.version",
): typeof LOCAL_MESSAGE_BUNDLE_V1_SOURCE_TRANSFORM_VERSION {
  const parsed = version(value, label);
  if (!isLocalMessageBundleV1SourceTransformVersion(parsed)) {
    return fail(
      `${label} must be a supported source transform: ${LOCAL_MESSAGE_BUNDLE_V1_SUPPORTED_SOURCE_TRANSFORM_VERSIONS.join(", ")}`,
    );
  }
  return parsed;
}

function parseProvenance(value: unknown, label: string): LocalMessageBundleV1Provenance {
  const record = object(value, label);
  exactKeys(record, [
    "providerId", "providerRevision", "observedAt", "connectedAccountProviderId",
  ], label);
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
  kind: LocalMessageBundleV1RecordKind,
  extraKeys: readonly string[],
  label: string,
): Omit<LocalMessageBundleV1CommonRecord, "kind"> & Readonly<{
  kind: LocalMessageBundleV1RecordKind;
}> {
  exactKeys(record, [
    "schemaVersion", "kind", "id", "accountId", "network", "provenance", ...extraKeys,
  ], label);
  if (record.schemaVersion !== LOCAL_MESSAGE_BUNDLE_V1_SCHEMA_VERSION || record.kind !== kind) {
    return fail(`${label} has the wrong schemaVersion or kind`);
  }
  return Object.freeze({
    schemaVersion: LOCAL_MESSAGE_BUNDLE_V1_SCHEMA_VERSION,
    kind,
    id: identifier(record.id, `${label}.id`),
    accountId: identifier(record.accountId, `${label}.accountId`),
    network: token(record.network, `${label}.network`, 64),
    provenance: parseProvenance(record.provenance, `${label}.provenance`),
  });
}

function parseAccount(
  record: JsonObject,
  label: string,
): LocalMessageBundleV1AccountRecord {
  const common = parseCommon(record, "account", [
    "displayName", "handle", "selfParticipantId",
  ], label);
  if (
    common.id !== common.accountId
    || common.provenance.providerId !== common.provenance.connectedAccountProviderId
  ) return fail(`${label} does not establish one connected account realm`);
  return Object.freeze({
    ...common,
    kind: "account",
    displayName: nullableText(
      record.displayName,
      `${label}.displayName`,
      LOCAL_MESSAGE_BUNDLE_V1_LIMITS.shortTextBytes,
    ),
    handle: nullableText(
      record.handle,
      `${label}.handle`,
      LOCAL_MESSAGE_BUNDLE_V1_LIMITS.shortTextBytes,
    ),
    selfParticipantId: identifier(record.selfParticipantId, `${label}.selfParticipantId`),
  });
}

function parseParticipant(
  record: JsonObject,
  label: string,
): LocalMessageBundleV1ParticipantRecord {
  const common = parseCommon(record, "participant", ["displayName", "handle", "isSelf"], label);
  return Object.freeze({
    ...common,
    kind: "participant",
    displayName: nullableText(
      record.displayName,
      `${label}.displayName`,
      LOCAL_MESSAGE_BUNDLE_V1_LIMITS.shortTextBytes,
    ),
    handle: nullableText(
      record.handle,
      `${label}.handle`,
      LOCAL_MESSAGE_BUNDLE_V1_LIMITS.shortTextBytes,
    ),
    isSelf: boolean(record.isSelf, `${label}.isSelf`),
  });
}

function parseConversation(
  record: JsonObject,
  label: string,
): LocalMessageBundleV1ConversationRecord {
  const common = parseCommon(record, "conversation", [
    "type", "title", "participantIds", "participantsComplete", "startedAt", "lastMessageAt",
  ], label);
  const startedAt = nullableTimestamp(record.startedAt, `${label}.startedAt`);
  const lastMessageAt = nullableTimestamp(record.lastMessageAt, `${label}.lastMessageAt`);
  if (startedAt !== null && lastMessageAt !== null && startedAt > lastMessageAt) {
    return fail(`${label}.startedAt must not follow lastMessageAt`);
  }
  return Object.freeze({
    ...common,
    kind: "conversation",
    type: oneOf(
      record.type,
      ["direct", "group", "channel", "unknown"] as const,
      `${label}.type`,
    ),
    title: nullableText(
      record.title,
      `${label}.title`,
      LOCAL_MESSAGE_BUNDLE_V1_LIMITS.shortTextBytes,
    ),
    participantIds: identifiers(
      record.participantIds,
      `${label}.participantIds`,
      LOCAL_MESSAGE_BUNDLE_V1_LIMITS.participantsPerConversation,
    ),
    participantsComplete: nullableBoolean(
      record.participantsComplete,
      `${label}.participantsComplete`,
    ),
    startedAt,
    lastMessageAt,
  });
}

function parseReply(value: unknown, label: string): LocalMessageBundleV1Reply | null {
  if (value === null) return null;
  const record = object(value, label);
  exactKeys(record, ["messageId", "providerId"], label);
  return Object.freeze({
    messageId: nullableIdentifier(record.messageId, `${label}.messageId`),
    providerId: identifier(record.providerId, `${label}.providerId`),
  });
}

function parseEdit(
  value: unknown,
  sentAt: string,
  label: string,
): LocalMessageBundleV1Edit | null {
  if (value === null) return null;
  const record = object(value, label);
  if (record.kind === "in-place") {
    exactKeys(record, ["kind", "editedAt", "providerRevision"], label);
    const editedAt = timestamp(record.editedAt, `${label}.editedAt`);
    if (editedAt < sentAt) return fail(`${label} precedes the message`);
    return Object.freeze({
      kind: "in-place",
      editedAt,
      providerRevision: identifier(record.providerRevision, `${label}.providerRevision`),
    });
  }
  if (record.kind !== "replacement") {
    return fail(`${label}.kind must be in-place or replacement`);
  }
  exactKeys(record, [
    "kind", "replacesMessageId", "replacesProviderId", "editedAt", "providerRevision",
  ], label);
  const editedAt = timestamp(record.editedAt, `${label}.editedAt`);
  if (editedAt < sentAt) return fail(`${label} precedes the message`);
  return Object.freeze({
    kind: "replacement",
    replacesMessageId: nullableIdentifier(
      record.replacesMessageId,
      `${label}.replacesMessageId`,
    ),
    replacesProviderId: identifier(record.replacesProviderId, `${label}.replacesProviderId`),
    editedAt,
    providerRevision: identifier(record.providerRevision, `${label}.providerRevision`),
  });
}

function parseDeletion(value: unknown, label: string): LocalMessageBundleV1Deletion | null {
  if (value === null) return null;
  const record = object(value, label);
  exactKeys(record, ["state", "observedAt", "providerRevision"], label);
  return Object.freeze({
    state: oneOf(
      record.state,
      ["revoked", "deleted-for-me", "revoked-and-deleted-for-me"] as const,
      `${label}.state`,
    ),
    observedAt: timestamp(record.observedAt, `${label}.observedAt`),
    providerRevision: nullableIdentifier(record.providerRevision, `${label}.providerRevision`),
  });
}

function parseAttachments(
  value: unknown,
  label: string,
): readonly LocalMessageBundleV1AttachmentRecord[] {
  return Object.freeze(array(
    value,
    label,
    LOCAL_MESSAGE_BUNDLE_V1_LIMITS.attachmentsPerMessage,
  ).map((item, index) => {
    const itemLabel = `${label}[${index}]`;
    const record = object(item, itemLabel);
    exactKeys(record, ["kind", "mimeType", "name", "sizeBytes"], itemLabel);
    const name = nullableText(
      record.name,
      `${itemLabel}.name`,
      LOCAL_MESSAGE_BUNDLE_V1_LIMITS.shortTextBytes,
    );
    if (name !== null && (name === "." || name === ".." || name.includes("/") || name.includes("\\"))) {
      return fail(`${itemLabel}.name must not be a path`);
    }
    return Object.freeze({
      kind: oneOf(
        record.kind,
        ["audio", "document", "image", "link", "sticker", "video", "unknown"] as const,
        `${itemLabel}.kind`,
      ),
      mimeType: nullableText(
        record.mimeType,
        `${itemLabel}.mimeType`,
        LOCAL_MESSAGE_BUNDLE_V1_LIMITS.mimeTypeBytes,
      ),
      name,
      sizeBytes: nullableInteger(record.sizeBytes, `${itemLabel}.sizeBytes`),
    });
  }));
}

function parseMessage(
  record: JsonObject,
  label: string,
): LocalMessageBundleV1MessageRecord {
  const common = parseCommon(record, "message", [
    "conversationId", "senderParticipantId", "direction", "sentAt", "sortKey", "body",
    "bodyTruncated", "replyTo", "edit", "deletion", "attachments",
  ], label);
  const sentAt = timestamp(record.sentAt, `${label}.sentAt`);
  const deletion = parseDeletion(record.deletion, `${label}.deletion`);
  const body = nullableText(
    record.body,
    `${label}.body`,
    LOCAL_MESSAGE_BUNDLE_V1_LIMITS.bodyBytes,
  );
  if (deletion !== null && body !== null) {
    return fail(`${label}.body must be null for a deleted message`);
  }
  return Object.freeze({
    ...common,
    kind: "message",
    conversationId: identifier(record.conversationId, `${label}.conversationId`),
    senderParticipantId: nullableIdentifier(
      record.senderParticipantId,
      `${label}.senderParticipantId`,
    ),
    direction: oneOf(
      record.direction,
      ["incoming", "outgoing", "unknown"] as const,
      `${label}.direction`,
    ),
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

function parseReaction(
  record: JsonObject,
  label: string,
): LocalMessageBundleV1ReactionRecord {
  const common = parseCommon(record, "reaction", [
    "messageId", "messageProviderId", "participantId", "body", "reactedAt", "state",
  ], label);
  return Object.freeze({
    ...common,
    kind: "reaction",
    messageId: nullableIdentifier(record.messageId, `${label}.messageId`),
    messageProviderId: identifier(record.messageProviderId, `${label}.messageProviderId`),
    participantId: nullableIdentifier(record.participantId, `${label}.participantId`),
    body: boundedText(
      record.body,
      `${label}.body`,
      LOCAL_MESSAGE_BUNDLE_V1_LIMITS.shortTextBytes,
    ),
    reactedAt: nullableTimestamp(record.reactedAt, `${label}.reactedAt`),
    state: oneOf(record.state, ["active", "removed"] as const, `${label}.state`),
  });
}

function parseTombstone(
  record: JsonObject,
  label: string,
): LocalMessageBundleV1TombstoneRecord {
  const common = parseCommon(record, "tombstone", [
    "entityKind", "entityId", "entityProviderId", "deletedAt", "scope", "providerRevision",
  ], label);
  return Object.freeze({
    ...common,
    kind: "tombstone",
    entityKind: oneOf(
      record.entityKind,
      ["conversation", "message", "reaction"] as const,
      `${label}.entityKind`,
    ),
    entityId: nullableIdentifier(record.entityId, `${label}.entityId`),
    entityProviderId: identifier(record.entityProviderId, `${label}.entityProviderId`),
    deletedAt: timestamp(record.deletedAt, `${label}.deletedAt`),
    scope: oneOf(record.scope, ["remote", "local", "unknown"] as const, `${label}.scope`),
    providerRevision: nullableIdentifier(record.providerRevision, `${label}.providerRevision`),
  });
}

export function parseLocalMessageBundleV1Record<Kind extends LocalMessageBundleV1RecordKind>(
  value: unknown,
  kind: Kind,
  label = `${kind} record`,
): LocalMessageBundleV1RecordByKind[Kind] {
  const record = object(value, label);
  switch (kind) {
    case "account": return parseAccount(record, label) as LocalMessageBundleV1RecordByKind[Kind];
    case "participant": return parseParticipant(record, label) as LocalMessageBundleV1RecordByKind[Kind];
    case "conversation": return parseConversation(record, label) as LocalMessageBundleV1RecordByKind[Kind];
    case "message": return parseMessage(record, label) as LocalMessageBundleV1RecordByKind[Kind];
    case "reaction": return parseReaction(record, label) as LocalMessageBundleV1RecordByKind[Kind];
    case "tombstone": return parseTombstone(record, label) as LocalMessageBundleV1RecordByKind[Kind];
  }
}

function parseArtifact(value: unknown, index: number): LocalMessageBundleV1Artifact {
  const expected = LOCAL_MESSAGE_BUNDLE_V1_ARTIFACTS[index]!;
  const label = `manifest.artifacts[${index}]`;
  const record = object(value, label);
  exactKeys(record, ["path", "mediaType", "recordKind", "records", "bytes", "sha256"], label);
  if (
    record.path !== expected.path
    || record.mediaType !== "application/x-ndjson"
    || record.recordKind !== expected.kind
  ) return fail(`${label} does not match the fixed artifact inventory`);
  return Object.freeze({
    path: expected.path,
    mediaType: "application/x-ndjson",
    recordKind: expected.kind,
    records: integer(record.records, `${label}.records`, LOCAL_MESSAGE_BUNDLE_V1_LIMITS.records),
    bytes: integer(record.bytes, `${label}.bytes`, LOCAL_MESSAGE_BUNDLE_V1_LIMITS.totalBytes),
    sha256: digest(record.sha256, `${label}.sha256`),
  });
}

export function localMessageBundleV1ManifestProjection(
  manifest: LocalMessageBundleV1Manifest,
): LocalMessageBundleV1ManifestProjection {
  const { integrity: _integrity, ...projection } = manifest;
  return Object.freeze(projection);
}

export function localMessageBundleV1BundleSha256(
  projection: LocalMessageBundleV1ManifestProjection,
): string {
  return sha256(canonicalJson(projection));
}

export function parseLocalMessageBundleV1Manifest(value: unknown): LocalMessageBundleV1Manifest {
  const record = object(value, "manifest");
  exactKeys(record, [
    "schemaVersion", "format", "source", "provider", "timestamps", "completeness",
    "warnings", "privacy", "counts", "artifacts", "integrity",
  ], "manifest");
  if (
    record.schemaVersion !== LOCAL_MESSAGE_BUNDLE_V1_SCHEMA_VERSION
    || record.format !== LOCAL_MESSAGE_BUNDLE_V1_FORMAT
  ) return fail("Manifest has an unsupported schemaVersion or format");

  const source = object(record.source, "manifest.source");
  exactKeys(source, ["id", "version"], "manifest.source");
  if (source.id !== LOCAL_MESSAGE_BUNDLE_V1_SOURCE_ID) {
    return fail(`manifest.source.id must be ${LOCAL_MESSAGE_BUNDLE_V1_SOURCE_ID}`);
  }

  const provider = object(record.provider, "manifest.provider");
  exactKeys(provider, ["id", "version"], "manifest.provider");
  if (provider.id !== LOCAL_MESSAGE_BUNDLE_V1_PROVIDER_ID) {
    return fail(`manifest.provider.id must be ${LOCAL_MESSAGE_BUNDLE_V1_PROVIDER_ID}`);
  }

  const timestamps = object(record.timestamps, "manifest.timestamps");
  exactKeys(timestamps, ["startedAt", "finishedAt", "createdAt"], "manifest.timestamps");
  const startedAt = timestamp(timestamps.startedAt, "manifest.timestamps.startedAt");
  const finishedAt = timestamp(timestamps.finishedAt, "manifest.timestamps.finishedAt");
  const createdAt = timestamp(timestamps.createdAt, "manifest.timestamps.createdAt");
  if (startedAt > finishedAt || finishedAt > createdAt) {
    return fail("Manifest timestamps are not monotonic");
  }

  const completeness = object(record.completeness, "manifest.completeness");
  exactKeys(completeness, [
    "kind", "reason", "observedFrom", "observedThrough",
  ], "manifest.completeness");
  const observedFrom = nullableTimestamp(
    completeness.observedFrom,
    "manifest.completeness.observedFrom",
  );
  const observedThrough = nullableTimestamp(
    completeness.observedThrough,
    "manifest.completeness.observedThrough",
  );
  if (observedFrom !== null && observedThrough !== null && observedFrom > observedThrough) {
    return fail("Manifest completeness bounds are reversed");
  }

  const warnings = array(
    record.warnings,
    "manifest.warnings",
    LOCAL_MESSAGE_BUNDLE_V1_LIMITS.warnings,
  ).map((item, index) => token(item, `manifest.warnings[${index}]`));
  if (new Set(warnings).size !== warnings.length) fail("Manifest warnings repeat");

  const privacy = object(record.privacy, "manifest.privacy");
  exactKeys(privacy, [
    "classification", "attachments", "providerUrls", "credentials",
  ], "manifest.privacy");
  if (
    privacy.classification !== "private-local"
    || privacy.attachments !== "metadata-only"
    || privacy.providerUrls !== "excluded"
    || privacy.credentials !== "excluded"
  ) return fail("Manifest privacy guarantees are unsupported");

  const counts = object(record.counts, "manifest.counts");
  exactKeys(
    counts,
    LOCAL_MESSAGE_BUNDLE_V1_ARTIFACTS.map(({ kind }) => kind),
    "manifest.counts",
  );
  const parsedCounts = Object.fromEntries(LOCAL_MESSAGE_BUNDLE_V1_ARTIFACTS.map(({ kind }) => [
    kind,
    integer(counts[kind], `manifest.counts.${kind}`, LOCAL_MESSAGE_BUNDLE_V1_LIMITS.records),
  ])) as Record<LocalMessageBundleV1RecordKind, number>;
  if (parsedCounts.account > LOCAL_MESSAGE_BUNDLE_V1_LIMITS.accounts) {
    return fail(
      `Manifest exceeds the ${LOCAL_MESSAGE_BUNDLE_V1_LIMITS.accounts}-account safety bound`,
    );
  }

  const artifactValues = array(
    record.artifacts,
    "manifest.artifacts",
    LOCAL_MESSAGE_BUNDLE_V1_ARTIFACTS.length,
  );
  if (artifactValues.length !== LOCAL_MESSAGE_BUNDLE_V1_ARTIFACTS.length) {
    return fail("Manifest must list the fixed six artifacts");
  }
  const artifacts = Object.freeze(artifactValues.map(parseArtifact));
  let totalRecords = 0;
  let totalBytes = 0;
  for (const artifact of artifacts) {
    if (artifact.records !== parsedCounts[artifact.recordKind]) {
      return fail(`${artifact.path} count disagrees with manifest.counts`);
    }
    totalRecords += artifact.records;
    totalBytes += artifact.bytes;
  }
  if (
    totalRecords > LOCAL_MESSAGE_BUNDLE_V1_LIMITS.records
    || totalBytes > LOCAL_MESSAGE_BUNDLE_V1_LIMITS.totalBytes
  ) return fail("Manifest exceeds the bundle record or byte bound");

  const integrity = object(record.integrity, "manifest.integrity");
  exactKeys(integrity, ["algorithm", "bundleSha256"], "manifest.integrity");
  if (integrity.algorithm !== "sha256") {
    return fail("Manifest integrity algorithm is unsupported");
  }

  const result: LocalMessageBundleV1Manifest = Object.freeze({
    schemaVersion: LOCAL_MESSAGE_BUNDLE_V1_SCHEMA_VERSION,
    format: LOCAL_MESSAGE_BUNDLE_V1_FORMAT,
    source: Object.freeze({
      id: LOCAL_MESSAGE_BUNDLE_V1_SOURCE_ID,
      version: assertLocalMessageBundleV1SourceTransformVersion(source.version),
    }),
    provider: Object.freeze({
      id: LOCAL_MESSAGE_BUNDLE_V1_PROVIDER_ID,
      version: version(provider.version, "manifest.provider.version"),
    }),
    timestamps: Object.freeze({ startedAt, finishedAt, createdAt }),
    completeness: Object.freeze({
      kind: oneOf(
        completeness.kind,
        ["bounded-local", "truncated", "unknown"] as const,
        "manifest.completeness.kind",
      ),
      reason: completeness.reason === null
        ? null
        : token(completeness.reason, "manifest.completeness.reason"),
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
    integrity: Object.freeze({
      algorithm: "sha256",
      bundleSha256: digest(integrity.bundleSha256, "manifest.integrity.bundleSha256"),
    }),
  });
  if (
    localMessageBundleV1BundleSha256(localMessageBundleV1ManifestProjection(result))
    !== result.integrity.bundleSha256
  ) return fail("Manifest bundle SHA-256 does not match its canonical projection");
  return result;
}
