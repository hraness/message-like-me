// @bun
import {
  MESSAGE_BUNDLE_V2_SCHEMA_IDENTITY
} from "./cli-kw20gkk3.js";
import {
  canonicalJson,
  sha256
} from "./cli-ththzwja.js";

// src/message-bundle-v2.ts
import { types as nodeTypes } from "util";
var LOCAL_MESSAGE_BUNDLE_V2_SCHEMA_VERSION = MESSAGE_BUNDLE_V2_SCHEMA_IDENTITY;
var LOCAL_MESSAGE_BUNDLE_V2_FORMAT = "message-like-me.local-message-bundle";
var LOCAL_MESSAGE_BUNDLE_V2_SOURCE_ID = "wacli-local";
var LOCAL_MESSAGE_BUNDLE_V2_SOURCE_TRANSFORM_VERSION = "1.0.0";
var LOCAL_MESSAGE_BUNDLE_V2_PROVIDER_ID = "whatsapp";
var LOCAL_MESSAGE_BUNDLE_V2_PROVIDER_VERSION = "0.15.0";
var LOCAL_MESSAGE_BUNDLE_V2_NETWORK = "whatsapp";
var LOCAL_MESSAGE_BUNDLE_V2_SUPPORTED_SOURCE_TRANSFORM_VERSIONS = Object.freeze([
  LOCAL_MESSAGE_BUNDLE_V2_SOURCE_TRANSFORM_VERSION
]);
var LOCAL_MESSAGE_BUNDLE_V2_LIMITS = Object.freeze({
  manifestBytes: 1024 * 1024,
  records: 500000,
  recordBytes: 2 * 1024 * 1024,
  totalBytes: 512 * 1024 * 1024,
  accounts: 1,
  identifierBytes: 1024,
  shortTextBytes: 8 * 1024,
  bodyBytes: 1024 * 1024,
  mimeTypeBytes: 256,
  participantsPerConversation: 1e4,
  attachmentsPerMessage: 256,
  warnings: 128
});
var LOCAL_MESSAGE_BUNDLE_V2_ARTIFACTS = Object.freeze([
  Object.freeze({ path: "accounts.ndjson", kind: "account" }),
  Object.freeze({ path: "participants.ndjson", kind: "participant" }),
  Object.freeze({ path: "conversations.ndjson", kind: "conversation" }),
  Object.freeze({ path: "messages.ndjson", kind: "message" }),
  Object.freeze({ path: "reactions.ndjson", kind: "reaction" }),
  Object.freeze({ path: "tombstones.ndjson", kind: "tombstone" })
]);

class MessageBundleV2ContractError extends TypeError {
  code = "message-bundle-v2-contract";
  constructor(message, options) {
    super(message, options);
    this.name = "MessageBundleV2ContractError";
  }
}
function fail(message) {
  throw new MessageBundleV2ContractError(message);
}
function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || nodeTypes.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    return fail(`${label} must be a plain object`);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || descriptor === undefined || descriptor.enumerable !== true || !("value" in descriptor))
      return fail(`${label} must contain only enumerable string data properties`);
  }
  return value;
}
function exactKeys(value, keys, label) {
  const expected = [...keys].sort();
  const observed = Reflect.ownKeys(value).map(String).sort();
  if (expected.length !== observed.length || observed.some((key, index) => key !== expected[index]))
    fail(`${label} must contain exactly: ${keys.join(", ")}`);
}
function utf8Bytes(value) {
  return new TextEncoder().encode(value).byteLength;
}
function boundedText(value, label, maximum) {
  if (typeof value !== "string" || utf8Bytes(value) > maximum || value.includes("\x00")) {
    return fail(`${label} must be NUL-free text within ${maximum} UTF-8 bytes`);
  }
  return value;
}
function nullableText(value, label, maximum) {
  return value === null ? null : boundedText(value, label, maximum);
}
function identifier(value, label) {
  const result = boundedText(value, label, LOCAL_MESSAGE_BUNDLE_V2_LIMITS.identifierBytes);
  if (result.length === 0 || /[\u0000-\u001f\u007f]/u.test(result)) {
    return fail(`${label} must be a non-empty identifier without ASCII controls`);
  }
  return result;
}
function nullableIdentifier(value, label) {
  return value === null ? null : identifier(value, label);
}
function parseLocalMessageBundleV2WhatsAppJid(value, label = "WhatsApp JID") {
  const jid = identifier(value, label);
  const user = /^([1-9][0-9]{4,14})@s\.whatsapp\.net$/u.exec(jid);
  if (user !== null) {
    return Object.freeze({ jid, kind: "user", e164: `+${user[1]}` });
  }
  if (/^[1-9][0-9]{4,19}@lid$/u.test(jid)) {
    return Object.freeze({ jid, kind: "lid", e164: null });
  }
  if (/^[1-9][0-9]{4,19}(?:-[1-9][0-9]{0,19})?@g\.us$/u.test(jid)) {
    return Object.freeze({ jid, kind: "group", e164: null });
  }
  return fail(`${label} must be a canonical user, LID, or group WhatsApp JID`);
}
function exactJidHandle(value, jid, label) {
  const handle = nullableText(value, label, LOCAL_MESSAGE_BUNDLE_V2_LIMITS.shortTextBytes);
  if (jid.kind === "user" && handle !== jid.e164) {
    return fail(`${label} must be the exact E.164 projection of its WhatsApp user JID`);
  }
  if (jid.kind !== "user" && handle !== null) {
    return fail(`${label} must be null when the WhatsApp JID has no exact E.164 projection`);
  }
  return handle;
}
function token(value, label, maximum = 128) {
  const result = boundedText(value, label, maximum);
  if (!/^[a-z0-9](?:[a-z0-9._+-]*[a-z0-9])?$/u.test(result)) {
    return fail(`${label} must be a lowercase categorical token`);
  }
  return result;
}
function version(value, label) {
  const result = boundedText(value, label, 128);
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._+-]*[A-Za-z0-9])?$/u.test(result)) {
    return fail(`${label} must be a bounded version token`);
  }
  return result;
}
function oneOf(value, values, label) {
  if (typeof value !== "string" || !values.includes(value)) {
    return fail(`${label} must be one of: ${values.join(", ")}`);
  }
  return value;
}
function integer(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    return fail(`${label} must be a non-negative safe integer`);
  }
  return value;
}
function nullableInteger(value, label) {
  return value === null ? null : integer(value, label);
}
function boolean(value, label) {
  if (typeof value !== "boolean")
    return fail(`${label} must be boolean`);
  return value;
}
function nullableBoolean(value, label) {
  return value === null ? null : boolean(value, label);
}
function timestamp(value, label) {
  const result = boundedText(value, label, 64);
  const date = new Date(result);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== result) {
    return fail(`${label} must be a canonical UTC timestamp`);
  }
  return result;
}
function nullableTimestamp(value, label) {
  return value === null ? null : timestamp(value, label);
}
function digest(value, label) {
  const result = boundedText(value, label, 64);
  if (!/^[a-f0-9]{64}$/u.test(result))
    return fail(`${label} must be lowercase SHA-256`);
  return result;
}
function array(value, label, maximum) {
  if (!Array.isArray(value) || nodeTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) {
    return fail(`${label} must contain at most ${maximum} items`);
  }
  const expectedKeys = new Set([
    "length",
    ...Array.from({ length: value.length }, (_item, index) => String(index))
  ]);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    const isLength = key === "length";
    if (typeof key !== "string" || !expectedKeys.has(key) || descriptor === undefined || !("value" in descriptor) || !isLength && descriptor.enumerable !== true)
      return fail(`${label} must be a dense array of data properties`);
  }
  if (Reflect.ownKeys(value).length !== expectedKeys.size) {
    return fail(`${label} must be a dense array of data properties`);
  }
  return value;
}
function identifiers(value, label, maximum) {
  const result = array(value, label, maximum).map((item, index) => identifier(item, `${label}[${index}]`));
  if (new Set(result).size !== result.length)
    fail(`${label} repeats an ID`);
  return Object.freeze(result);
}
function isLocalMessageBundleV2SourceTransformVersion(value) {
  return value === LOCAL_MESSAGE_BUNDLE_V2_SOURCE_TRANSFORM_VERSION;
}
function assertLocalMessageBundleV2SourceTransformVersion(value, label = "manifest.source.version") {
  const parsed = version(value, label);
  if (!isLocalMessageBundleV2SourceTransformVersion(parsed)) {
    return fail(`${label} must be a supported source transform: ${LOCAL_MESSAGE_BUNDLE_V2_SUPPORTED_SOURCE_TRANSFORM_VERSIONS.join(", ")}`);
  }
  return parsed;
}
function parseProvenance(value, label) {
  const record = object(value, label);
  exactKeys(record, [
    "providerId",
    "providerRevision",
    "observedAt",
    "connectedAccountProviderId"
  ], label);
  return Object.freeze({
    providerId: identifier(record.providerId, `${label}.providerId`),
    providerRevision: nullableIdentifier(record.providerRevision, `${label}.providerRevision`),
    observedAt: timestamp(record.observedAt, `${label}.observedAt`),
    connectedAccountProviderId: identifier(record.connectedAccountProviderId, `${label}.connectedAccountProviderId`)
  });
}
function parseCommon(record, kind, extraKeys, label) {
  exactKeys(record, [
    "schemaVersion",
    "kind",
    "id",
    "accountId",
    "network",
    "provenance",
    ...extraKeys
  ], label);
  if (record.schemaVersion !== LOCAL_MESSAGE_BUNDLE_V2_SCHEMA_VERSION || record.kind !== kind) {
    return fail(`${label} has the wrong schemaVersion or kind`);
  }
  if (record.network !== LOCAL_MESSAGE_BUNDLE_V2_NETWORK) {
    return fail(`${label}.network must be ${LOCAL_MESSAGE_BUNDLE_V2_NETWORK}`);
  }
  const connectedAccount = parseLocalMessageBundleV2WhatsAppJid(object(record.provenance, `${label}.provenance`).connectedAccountProviderId, `${label}.provenance.connectedAccountProviderId`);
  if (connectedAccount.kind === "group") {
    return fail(`${label}.provenance.connectedAccountProviderId must be a WhatsApp user or LID JID`);
  }
  return Object.freeze({
    schemaVersion: LOCAL_MESSAGE_BUNDLE_V2_SCHEMA_VERSION,
    kind,
    id: identifier(record.id, `${label}.id`),
    accountId: identifier(record.accountId, `${label}.accountId`),
    network: LOCAL_MESSAGE_BUNDLE_V2_NETWORK,
    provenance: parseProvenance(record.provenance, `${label}.provenance`)
  });
}
function parseAccount(record, label) {
  const common = parseCommon(record, "account", [
    "displayName",
    "handle",
    "selfParticipantId"
  ], label);
  if (common.id !== common.accountId || common.provenance.providerId !== common.provenance.connectedAccountProviderId)
    return fail(`${label} does not establish one connected account realm`);
  const providerJid = parseLocalMessageBundleV2WhatsAppJid(common.provenance.providerId, `${label}.provenance.providerId`);
  if (providerJid.kind === "group") {
    return fail(`${label}.provenance.providerId must be a WhatsApp user or LID JID`);
  }
  return Object.freeze({
    ...common,
    kind: "account",
    displayName: nullableText(record.displayName, `${label}.displayName`, LOCAL_MESSAGE_BUNDLE_V2_LIMITS.shortTextBytes),
    handle: exactJidHandle(record.handle, providerJid, `${label}.handle`),
    selfParticipantId: identifier(record.selfParticipantId, `${label}.selfParticipantId`)
  });
}
function parseParticipant(record, label) {
  const common = parseCommon(record, "participant", ["displayName", "handle", "isSelf"], label);
  const providerJid = parseLocalMessageBundleV2WhatsAppJid(common.provenance.providerId, `${label}.provenance.providerId`);
  if (providerJid.kind === "group") {
    return fail(`${label}.provenance.providerId must identify a WhatsApp user or LID participant`);
  }
  return Object.freeze({
    ...common,
    kind: "participant",
    displayName: nullableText(record.displayName, `${label}.displayName`, LOCAL_MESSAGE_BUNDLE_V2_LIMITS.shortTextBytes),
    handle: exactJidHandle(record.handle, providerJid, `${label}.handle`),
    isSelf: boolean(record.isSelf, `${label}.isSelf`)
  });
}
function parseConversation(record, label) {
  const common = parseCommon(record, "conversation", [
    "type",
    "title",
    "participantIds",
    "participantsComplete",
    "startedAt",
    "lastMessageAt"
  ], label);
  const startedAt = nullableTimestamp(record.startedAt, `${label}.startedAt`);
  const lastMessageAt = nullableTimestamp(record.lastMessageAt, `${label}.lastMessageAt`);
  if (startedAt !== null && lastMessageAt !== null && startedAt > lastMessageAt) {
    return fail(`${label}.startedAt must not follow lastMessageAt`);
  }
  const type = oneOf(record.type, ["direct", "group"], `${label}.type`);
  const providerJid = parseLocalMessageBundleV2WhatsAppJid(common.provenance.providerId, `${label}.provenance.providerId`);
  if (type === "direct" && providerJid.kind === "group" || type === "group" && providerJid.kind !== "group")
    return fail(`${label} type conflicts with its WhatsApp JID`);
  const participantIds = identifiers(record.participantIds, `${label}.participantIds`, LOCAL_MESSAGE_BUNDLE_V2_LIMITS.participantsPerConversation);
  const participantsComplete = nullableBoolean(record.participantsComplete, `${label}.participantsComplete`);
  if (type === "direct" && (participantsComplete !== true || participantIds.length !== 2)) {
    return fail(`${label} direct roster must contain exactly two proven participants`);
  }
  return Object.freeze({
    ...common,
    kind: "conversation",
    type,
    title: nullableText(record.title, `${label}.title`, LOCAL_MESSAGE_BUNDLE_V2_LIMITS.shortTextBytes),
    participantIds,
    participantsComplete,
    startedAt,
    lastMessageAt
  });
}
function parseReply(value, label) {
  if (value === null)
    return null;
  const record = object(value, label);
  exactKeys(record, ["messageId", "providerId"], label);
  return Object.freeze({
    messageId: nullableIdentifier(record.messageId, `${label}.messageId`),
    providerId: identifier(record.providerId, `${label}.providerId`)
  });
}
function parseEdit(value, sentAt, label) {
  if (value === null)
    return null;
  const record = object(value, label);
  if (record.kind === "in-place") {
    exactKeys(record, ["kind", "editedAt", "providerRevision"], label);
    const editedAt2 = timestamp(record.editedAt, `${label}.editedAt`);
    if (editedAt2 < sentAt)
      return fail(`${label} precedes the message`);
    return Object.freeze({
      kind: "in-place",
      editedAt: editedAt2,
      providerRevision: identifier(record.providerRevision, `${label}.providerRevision`)
    });
  }
  if (record.kind !== "replacement") {
    return fail(`${label}.kind must be in-place or replacement`);
  }
  exactKeys(record, [
    "kind",
    "replacesMessageId",
    "replacesProviderId",
    "editedAt",
    "providerRevision"
  ], label);
  const editedAt = timestamp(record.editedAt, `${label}.editedAt`);
  if (editedAt < sentAt)
    return fail(`${label} precedes the message`);
  return Object.freeze({
    kind: "replacement",
    replacesMessageId: nullableIdentifier(record.replacesMessageId, `${label}.replacesMessageId`),
    replacesProviderId: identifier(record.replacesProviderId, `${label}.replacesProviderId`),
    editedAt,
    providerRevision: identifier(record.providerRevision, `${label}.providerRevision`)
  });
}
function parseDeletion(value, label) {
  if (value === null)
    return null;
  const record = object(value, label);
  exactKeys(record, ["state", "observedAt", "providerRevision"], label);
  return Object.freeze({
    state: oneOf(record.state, ["revoked", "deleted-for-me", "revoked-and-deleted-for-me"], `${label}.state`),
    observedAt: timestamp(record.observedAt, `${label}.observedAt`),
    providerRevision: nullableIdentifier(record.providerRevision, `${label}.providerRevision`)
  });
}
function parseAttachments(value, label) {
  return Object.freeze(array(value, label, LOCAL_MESSAGE_BUNDLE_V2_LIMITS.attachmentsPerMessage).map((item, index) => {
    const itemLabel = `${label}[${index}]`;
    const record = object(item, itemLabel);
    exactKeys(record, ["kind", "mimeType", "name", "sizeBytes"], itemLabel);
    const name = nullableText(record.name, `${itemLabel}.name`, LOCAL_MESSAGE_BUNDLE_V2_LIMITS.shortTextBytes);
    if (name !== null && (name === "." || name === ".." || name.includes("/") || name.includes("\\"))) {
      return fail(`${itemLabel}.name must not be a path`);
    }
    return Object.freeze({
      kind: oneOf(record.kind, ["audio", "document", "image", "link", "sticker", "video", "unknown"], `${itemLabel}.kind`),
      mimeType: nullableText(record.mimeType, `${itemLabel}.mimeType`, LOCAL_MESSAGE_BUNDLE_V2_LIMITS.mimeTypeBytes),
      name,
      sizeBytes: nullableInteger(record.sizeBytes, `${itemLabel}.sizeBytes`)
    });
  }));
}
function parseMessage(record, label) {
  const common = parseCommon(record, "message", [
    "conversationId",
    "senderParticipantId",
    "direction",
    "sentAt",
    "sortKey",
    "body",
    "bodyTruncated",
    "replyTo",
    "edit",
    "deletion",
    "attachments"
  ], label);
  const sentAt = timestamp(record.sentAt, `${label}.sentAt`);
  const deletion = parseDeletion(record.deletion, `${label}.deletion`);
  const body = nullableText(record.body, `${label}.body`, LOCAL_MESSAGE_BUNDLE_V2_LIMITS.bodyBytes);
  if (deletion !== null && body !== null) {
    return fail(`${label}.body must be null for a deleted message`);
  }
  return Object.freeze({
    ...common,
    kind: "message",
    conversationId: identifier(record.conversationId, `${label}.conversationId`),
    senderParticipantId: nullableIdentifier(record.senderParticipantId, `${label}.senderParticipantId`),
    direction: oneOf(record.direction, ["incoming", "outgoing", "unknown"], `${label}.direction`),
    sentAt,
    sortKey: identifier(record.sortKey, `${label}.sortKey`),
    body,
    bodyTruncated: nullableBoolean(record.bodyTruncated, `${label}.bodyTruncated`),
    replyTo: parseReply(record.replyTo, `${label}.replyTo`),
    edit: parseEdit(record.edit, sentAt, `${label}.edit`),
    deletion,
    attachments: parseAttachments(record.attachments, `${label}.attachments`)
  });
}
function parseReaction(record, label) {
  const common = parseCommon(record, "reaction", [
    "messageId",
    "messageProviderId",
    "participantId",
    "body",
    "reactedAt",
    "state"
  ], label);
  return Object.freeze({
    ...common,
    kind: "reaction",
    messageId: nullableIdentifier(record.messageId, `${label}.messageId`),
    messageProviderId: identifier(record.messageProviderId, `${label}.messageProviderId`),
    participantId: nullableIdentifier(record.participantId, `${label}.participantId`),
    body: boundedText(record.body, `${label}.body`, LOCAL_MESSAGE_BUNDLE_V2_LIMITS.shortTextBytes),
    reactedAt: nullableTimestamp(record.reactedAt, `${label}.reactedAt`),
    state: oneOf(record.state, ["active", "removed"], `${label}.state`)
  });
}
function parseTombstone(record, label) {
  const common = parseCommon(record, "tombstone", [
    "entityKind",
    "entityId",
    "entityProviderId",
    "deletedAt",
    "scope",
    "providerRevision"
  ], label);
  return Object.freeze({
    ...common,
    kind: "tombstone",
    entityKind: oneOf(record.entityKind, ["conversation", "message", "reaction"], `${label}.entityKind`),
    entityId: nullableIdentifier(record.entityId, `${label}.entityId`),
    entityProviderId: identifier(record.entityProviderId, `${label}.entityProviderId`),
    deletedAt: timestamp(record.deletedAt, `${label}.deletedAt`),
    scope: oneOf(record.scope, ["remote", "local", "unknown"], `${label}.scope`),
    providerRevision: nullableIdentifier(record.providerRevision, `${label}.providerRevision`)
  });
}
function parseLocalMessageBundleV2Record(value, kind, label = `${kind} record`) {
  const record = object(value, label);
  switch (kind) {
    case "account":
      return parseAccount(record, label);
    case "participant":
      return parseParticipant(record, label);
    case "conversation":
      return parseConversation(record, label);
    case "message":
      return parseMessage(record, label);
    case "reaction":
      return parseReaction(record, label);
    case "tombstone":
      return parseTombstone(record, label);
  }
}
function parseArtifact(value, index) {
  const expected = LOCAL_MESSAGE_BUNDLE_V2_ARTIFACTS[index];
  const label = `manifest.artifacts[${index}]`;
  const record = object(value, label);
  exactKeys(record, ["path", "mediaType", "recordKind", "records", "bytes", "sha256"], label);
  if (record.path !== expected.path || record.mediaType !== "application/x-ndjson" || record.recordKind !== expected.kind)
    return fail(`${label} does not match the fixed artifact inventory`);
  return Object.freeze({
    path: expected.path,
    mediaType: "application/x-ndjson",
    recordKind: expected.kind,
    records: integer(record.records, `${label}.records`, LOCAL_MESSAGE_BUNDLE_V2_LIMITS.records),
    bytes: integer(record.bytes, `${label}.bytes`, LOCAL_MESSAGE_BUNDLE_V2_LIMITS.totalBytes),
    sha256: digest(record.sha256, `${label}.sha256`)
  });
}
function localMessageBundleV2ManifestProjection(manifest) {
  const { integrity: _integrity, ...projection } = manifest;
  return Object.freeze(projection);
}
function localMessageBundleV2BundleSha256(projection) {
  return sha256(canonicalJson(projection));
}
function parseLocalMessageBundleV2Manifest(value) {
  const record = object(value, "manifest");
  exactKeys(record, [
    "schemaVersion",
    "format",
    "source",
    "provider",
    "timestamps",
    "completeness",
    "warnings",
    "privacy",
    "counts",
    "artifacts",
    "integrity"
  ], "manifest");
  if (record.schemaVersion !== LOCAL_MESSAGE_BUNDLE_V2_SCHEMA_VERSION || record.format !== LOCAL_MESSAGE_BUNDLE_V2_FORMAT)
    return fail("Manifest has an unsupported schemaVersion or format");
  const source = object(record.source, "manifest.source");
  exactKeys(source, ["id", "version"], "manifest.source");
  if (source.id !== LOCAL_MESSAGE_BUNDLE_V2_SOURCE_ID) {
    return fail(`manifest.source.id must be ${LOCAL_MESSAGE_BUNDLE_V2_SOURCE_ID}`);
  }
  const provider = object(record.provider, "manifest.provider");
  exactKeys(provider, ["id", "version"], "manifest.provider");
  if (provider.id !== LOCAL_MESSAGE_BUNDLE_V2_PROVIDER_ID) {
    return fail(`manifest.provider.id must be ${LOCAL_MESSAGE_BUNDLE_V2_PROVIDER_ID}`);
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
    "kind",
    "reason",
    "observedFrom",
    "observedThrough"
  ], "manifest.completeness");
  const observedFrom = nullableTimestamp(completeness.observedFrom, "manifest.completeness.observedFrom");
  const observedThrough = nullableTimestamp(completeness.observedThrough, "manifest.completeness.observedThrough");
  if (observedFrom !== null && observedThrough !== null && observedFrom > observedThrough) {
    return fail("Manifest completeness bounds are reversed");
  }
  const warnings = array(record.warnings, "manifest.warnings", LOCAL_MESSAGE_BUNDLE_V2_LIMITS.warnings).map((item, index) => token(item, `manifest.warnings[${index}]`));
  if (new Set(warnings).size !== warnings.length)
    fail("Manifest warnings repeat");
  const privacy = object(record.privacy, "manifest.privacy");
  exactKeys(privacy, [
    "classification",
    "attachments",
    "providerUrls",
    "credentials"
  ], "manifest.privacy");
  if (privacy.classification !== "private-local" || privacy.attachments !== "metadata-only" || privacy.providerUrls !== "excluded" || privacy.credentials !== "excluded")
    return fail("Manifest privacy guarantees are unsupported");
  const counts = object(record.counts, "manifest.counts");
  exactKeys(counts, LOCAL_MESSAGE_BUNDLE_V2_ARTIFACTS.map(({ kind }) => kind), "manifest.counts");
  const parsedCounts = Object.fromEntries(LOCAL_MESSAGE_BUNDLE_V2_ARTIFACTS.map(({ kind }) => [
    kind,
    integer(counts[kind], `manifest.counts.${kind}`, LOCAL_MESSAGE_BUNDLE_V2_LIMITS.records)
  ]));
  if (parsedCounts.account > LOCAL_MESSAGE_BUNDLE_V2_LIMITS.accounts) {
    return fail(`Manifest exceeds the ${LOCAL_MESSAGE_BUNDLE_V2_LIMITS.accounts}-account safety bound`);
  }
  if (parsedCounts.account !== 1) {
    return fail("A native Wacli bundle must contain exactly one connected account");
  }
  const artifactValues = array(record.artifacts, "manifest.artifacts", LOCAL_MESSAGE_BUNDLE_V2_ARTIFACTS.length);
  if (artifactValues.length !== LOCAL_MESSAGE_BUNDLE_V2_ARTIFACTS.length) {
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
  if (totalRecords > LOCAL_MESSAGE_BUNDLE_V2_LIMITS.records || totalBytes > LOCAL_MESSAGE_BUNDLE_V2_LIMITS.totalBytes)
    return fail("Manifest exceeds the bundle record or byte bound");
  const integrity = object(record.integrity, "manifest.integrity");
  exactKeys(integrity, ["algorithm", "bundleSha256"], "manifest.integrity");
  if (integrity.algorithm !== "sha256") {
    return fail("Manifest integrity algorithm is unsupported");
  }
  const result = Object.freeze({
    schemaVersion: LOCAL_MESSAGE_BUNDLE_V2_SCHEMA_VERSION,
    format: LOCAL_MESSAGE_BUNDLE_V2_FORMAT,
    source: Object.freeze({
      id: LOCAL_MESSAGE_BUNDLE_V2_SOURCE_ID,
      version: assertLocalMessageBundleV2SourceTransformVersion(source.version)
    }),
    provider: Object.freeze({
      id: LOCAL_MESSAGE_BUNDLE_V2_PROVIDER_ID,
      version: (() => {
        const parsed = version(provider.version, "manifest.provider.version");
        if (parsed !== LOCAL_MESSAGE_BUNDLE_V2_PROVIDER_VERSION) {
          return fail(`manifest.provider.version must be ${LOCAL_MESSAGE_BUNDLE_V2_PROVIDER_VERSION}`);
        }
        return LOCAL_MESSAGE_BUNDLE_V2_PROVIDER_VERSION;
      })()
    }),
    timestamps: Object.freeze({ startedAt, finishedAt, createdAt }),
    completeness: Object.freeze({
      kind: oneOf(completeness.kind, ["bounded-local", "truncated", "unknown"], "manifest.completeness.kind"),
      reason: completeness.reason === null ? null : token(completeness.reason, "manifest.completeness.reason"),
      observedFrom,
      observedThrough
    }),
    warnings: Object.freeze(warnings),
    privacy: Object.freeze({
      classification: "private-local",
      attachments: "metadata-only",
      providerUrls: "excluded",
      credentials: "excluded"
    }),
    counts: Object.freeze(parsedCounts),
    artifacts,
    integrity: Object.freeze({
      algorithm: "sha256",
      bundleSha256: digest(integrity.bundleSha256, "manifest.integrity.bundleSha256")
    })
  });
  if (localMessageBundleV2BundleSha256(localMessageBundleV2ManifestProjection(result)) !== result.integrity.bundleSha256)
    return fail("Manifest bundle SHA-256 does not match its canonical projection");
  return result;
}

export { LOCAL_MESSAGE_BUNDLE_V2_SCHEMA_VERSION, LOCAL_MESSAGE_BUNDLE_V2_FORMAT, LOCAL_MESSAGE_BUNDLE_V2_SOURCE_ID, LOCAL_MESSAGE_BUNDLE_V2_SOURCE_TRANSFORM_VERSION, LOCAL_MESSAGE_BUNDLE_V2_PROVIDER_ID, LOCAL_MESSAGE_BUNDLE_V2_PROVIDER_VERSION, LOCAL_MESSAGE_BUNDLE_V2_NETWORK, LOCAL_MESSAGE_BUNDLE_V2_SUPPORTED_SOURCE_TRANSFORM_VERSIONS, LOCAL_MESSAGE_BUNDLE_V2_LIMITS, LOCAL_MESSAGE_BUNDLE_V2_ARTIFACTS, MessageBundleV2ContractError, parseLocalMessageBundleV2WhatsAppJid, isLocalMessageBundleV2SourceTransformVersion, assertLocalMessageBundleV2SourceTransformVersion, parseLocalMessageBundleV2Record, localMessageBundleV2ManifestProjection, localMessageBundleV2BundleSha256, parseLocalMessageBundleV2Manifest };
