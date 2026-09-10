// @bun
import {
  canonicalJson,
  sha256
} from "./index-y1aec88m.js";

// src/agentic-messaging-v1.ts
import { types as nodeTypes } from "util";
var AGENTIC_MESSAGING_V1_SCHEMA_VERSION = 1;
var AGENT_MESSAGE_DRAFT_V1_FORMAT = "message-like-me.agent-message-draft";
var AGENT_MESSAGE_HANDOFF_REQUEST_V1_FORMAT = "message-like-me.agent-message-handoff-request";
var AGENT_MESSAGE_HANDOFF_V1_FORMAT = "message-like-me.agent-message-handoff";
var AGENT_MESSAGE_AUDIT_V1_FORMAT = "message-like-me.agent-message-handoff-audit";
var GHOSTGET_MESSAGING_CONTEXT_BINDING_V1_FORMAT = "wrench.messaging-context-binding";
var GHOSTGET_MESSAGING_RECEIPT_BINDING_V1_FORMAT = "wrench.messaging-receipt-binding";
var GHOSTGET_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_ID = "wrench.messaging-context-binding.v1";
var GHOSTGET_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_HASH = "5e64da6a3d826e7f6fa3db7dca0a4ba92c10cfb784981e71a25aed9513a5c687";
var GHOSTGET_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_DESCRIPTOR = Object.freeze({
  contractId: GHOSTGET_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_ID,
  fields: Object.freeze([
    "schemaVersion:1",
    "format:wrench.messaging-context-binding",
    "contractId:wrench.messaging-context-binding.v1",
    "contractHash:sha256",
    "routeRef:opaque",
    "contextRef:opaque",
    "exactDataRevision:sha256",
    "latestMessageRevision:sha256",
    "validatedAt:rfc3339",
    "expiresAt:rfc3339"
  ]),
  format: "wrench.messaging-contract-descriptor",
  schemaVersion: 1
});
var GHOSTGET_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_ID = "wrench.messaging-receipt-binding.v1";
var GHOSTGET_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_HASH = "7f6cf724f0200b2399e4f4641c637b20b48914fc5c9b13755127a8ec69fe66f4";
var GHOSTGET_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_DESCRIPTOR = Object.freeze({
  contractId: GHOSTGET_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_ID,
  fields: Object.freeze([
    "schemaVersion:1",
    "format:wrench.messaging-receipt-binding",
    "contractId:wrench.messaging-receipt-binding.v1",
    "contractHash:sha256",
    "clientIntentSha256:sha256",
    "routeRefSha256:sha256",
    "contextRefSha256:sha256",
    "turnDigest:sha256",
    "previewDigest:sha256",
    "runId:opaque",
    "state:submitted|failed|partial|indeterminate",
    "partCount:uint",
    "provenPartCount:uint",
    "receiptSha256:sha256",
    "recordedAt:rfc3339"
  ]),
  format: "wrench.messaging-contract-descriptor",
  schemaVersion: 1
});
var AGENTIC_MESSAGING_V1_LIMITS = Object.freeze({
  bubbles: 8,
  bubbleBytes: 8 * 1024,
  totalBubbleBytes: 32 * 1024,
  identifierBytes: 1024,
  privateJsonBytes: 128 * 1024,
  handoffLifetimeMilliseconds: 10 * 60 * 1000,
  maximumContextLifetimeMilliseconds: 24 * 60 * 60 * 1000
});

class AgenticMessagingV1ContractError extends TypeError {
  code = "agentic-messaging-v1-contract";
  constructor(message, options) {
    super(message, options);
    this.name = "AgenticMessagingV1ContractError";
  }
}
function fail(message) {
  throw new AgenticMessagingV1ContractError(message);
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
  if (expected.length !== observed.length || observed.some((key, index) => key !== expected[index])) {
    fail(`${label} must contain exactly: ${keys.join(", ")}`);
  }
}
function denseArray(value, label, minimum, maximum) {
  if (!Array.isArray(value) || nodeTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < minimum || value.length > maximum)
    return fail(`${label} must contain ${minimum} through ${maximum} items`);
  const keys = Reflect.ownKeys(value);
  const expected = new Set(["length", ...Array.from({ length: value.length }, (_item, index) => String(index))]);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !expected.has(key) || descriptor === undefined || !("value" in descriptor) || key !== "length" && descriptor.enumerable !== true)
      return fail(`${label} must be a dense array of data properties`);
  }
  if (keys.length !== expected.size)
    return fail(`${label} must be a dense array of data properties`);
  return value;
}
function utf8Bytes(value) {
  return new TextEncoder().encode(value).byteLength;
}
function isWellFormedUnicode(value) {
  for (let index = 0;index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 55296 && unit <= 56319) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 56320 && next <= 57343))
        return false;
      index += 1;
    } else if (unit >= 56320 && unit <= 57343) {
      return false;
    }
  }
  return true;
}
function boundedText(value, label, maximum) {
  if (typeof value !== "string" || !isWellFormedUnicode(value) || utf8Bytes(value) > maximum || value.includes("\x00"))
    return fail(`${label} must be well-formed NUL-free text within ${maximum} UTF-8 bytes`);
  return value;
}
function identifier(value, label, maximum = AGENTIC_MESSAGING_V1_LIMITS.identifierBytes) {
  const result = boundedText(value, label, maximum);
  if (result.length === 0 || /\p{Cc}|\p{Zl}|\p{Zp}/u.test(result) || result !== result.trim()) {
    return fail(`${label} must be a bounded opaque identifier without controls or surrounding space`);
  }
  return result;
}
function digest(value, label) {
  const result = boundedText(value, label, 64);
  if (!/^[a-f0-9]{64}$/u.test(result))
    return fail(`${label} must be lowercase SHA-256`);
  return result;
}
function routeCandidateId(value, label) {
  const result = identifier(value, label, 70);
  if (!/^route_[a-f0-9]{64}$/u.test(result)) {
    return fail(`${label} must be a canonical source-conversation route ID`);
  }
  return result;
}
function timestamp(value, label) {
  const result = boundedText(value, label, 64);
  const parsed = new Date(result);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== result) {
    return fail(`${label} must be a canonical UTC timestamp`);
  }
  return result;
}
function bubble(value, label) {
  const record = object(value, label);
  exactKeys(record, ["id", "text", "replyToRef"], label);
  const text = boundedText(record.text, `${label}.text`, AGENTIC_MESSAGING_V1_LIMITS.bubbleBytes);
  if (text.trim().length === 0 || /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u.test(text)) {
    return fail(`${label}.text must contain visible text and no unsupported controls`);
  }
  return Object.freeze({
    id: identifier(record.id, `${label}.id`, 128),
    text,
    replyToRef: record.replyToRef === null ? null : identifier(record.replyToRef, `${label}.replyToRef`)
  });
}
function bubbles(value, label) {
  const result = denseArray(value, label, 1, AGENTIC_MESSAGING_V1_LIMITS.bubbles).map((item, index) => bubble(item, `${label}[${index}]`));
  if (new Set(result.map(({ id }) => id)).size !== result.length)
    fail(`${label} repeats a bubble ID`);
  if (result.reduce((sum, item) => sum + utf8Bytes(item.text), 0) > AGENTIC_MESSAGING_V1_LIMITS.totalBubbleBytes) {
    fail(`${label} exceeds the total text bound`);
  }
  return Object.freeze(result);
}
function profileState(value, label) {
  if (value !== "current" && value !== "missing" && value !== "stale") {
    return fail(`${label} must be current, missing, or stale`);
  }
  return value;
}
function handoffCore(value) {
  return value;
}
function handoffDigest(value) {
  return sha256(canonicalJson(handoffCore(value)));
}
function parseGhostgetMessagingContextBindingV1(value) {
  const record = object(value, "Ghostget messaging context binding");
  exactKeys(record, [
    "schemaVersion",
    "format",
    "contractId",
    "contractHash",
    "routeRef",
    "contextRef",
    "exactDataRevision",
    "latestMessageRevision",
    "validatedAt",
    "expiresAt"
  ], "Ghostget messaging context binding");
  if (record.schemaVersion !== AGENTIC_MESSAGING_V1_SCHEMA_VERSION || record.format !== GHOSTGET_MESSAGING_CONTEXT_BINDING_V1_FORMAT)
    return fail("Ghostget messaging context binding has the wrong schemaVersion or format");
  if (record.contractId !== GHOSTGET_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_ID || record.contractHash !== GHOSTGET_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_HASH)
    return fail("Ghostget messaging context binding has an unsupported contract identity");
  const validatedAt = timestamp(record.validatedAt, "Ghostget messaging context binding.validatedAt");
  const expiresAt = timestamp(record.expiresAt, "Ghostget messaging context binding.expiresAt");
  const lifetime = Date.parse(expiresAt) - Date.parse(validatedAt);
  if (lifetime <= 0 || lifetime > AGENTIC_MESSAGING_V1_LIMITS.maximumContextLifetimeMilliseconds) {
    return fail("Ghostget messaging context binding has an invalid lifetime");
  }
  return Object.freeze({
    schemaVersion: AGENTIC_MESSAGING_V1_SCHEMA_VERSION,
    format: GHOSTGET_MESSAGING_CONTEXT_BINDING_V1_FORMAT,
    contractId: GHOSTGET_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_ID,
    contractHash: GHOSTGET_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_HASH,
    routeRef: identifier(record.routeRef, "Ghostget messaging context binding.routeRef"),
    contextRef: identifier(record.contextRef, "Ghostget messaging context binding.contextRef"),
    exactDataRevision: digest(record.exactDataRevision, "Ghostget messaging context binding.exactDataRevision"),
    latestMessageRevision: digest(record.latestMessageRevision, "Ghostget messaging context binding.latestMessageRevision"),
    validatedAt,
    expiresAt
  });
}
function parseAgentMessageDraftV1(value) {
  const record = object(value, "Agent message draft");
  exactKeys(record, ["schemaVersion", "format", "bubbles"], "Agent message draft");
  if (record.schemaVersion !== AGENTIC_MESSAGING_V1_SCHEMA_VERSION || record.format !== AGENT_MESSAGE_DRAFT_V1_FORMAT)
    return fail("Agent message draft has the wrong schemaVersion or format");
  return Object.freeze({
    schemaVersion: AGENTIC_MESSAGING_V1_SCHEMA_VERSION,
    format: AGENT_MESSAGE_DRAFT_V1_FORMAT,
    bubbles: bubbles(record.bubbles, "Agent message draft.bubbles")
  });
}
function parseAgentMessageHandoffRequestV1(value) {
  const record = object(value, "Agent message handoff request");
  exactKeys(record, ["schemaVersion", "format", "routeCandidateId"], "Agent message handoff request");
  if (record.schemaVersion !== AGENTIC_MESSAGING_V1_SCHEMA_VERSION || record.format !== AGENT_MESSAGE_HANDOFF_REQUEST_V1_FORMAT)
    return fail("Agent message handoff request has the wrong schemaVersion or format");
  return Object.freeze({
    schemaVersion: AGENTIC_MESSAGING_V1_SCHEMA_VERSION,
    format: AGENT_MESSAGE_HANDOFF_REQUEST_V1_FORMAT,
    routeCandidateId: routeCandidateId(record.routeCandidateId, "Agent message handoff request.routeCandidateId")
  });
}
function createAgentMessageHandoffV1(input) {
  if (input.ghostgetContext !== undefined && input.wrenchContext !== undefined) {
    return fail("Choose ghostgetContext or its legacy wrenchContext alias, not both");
  }
  const context = parseGhostgetMessagingContextBindingV1(input.ghostgetContext ?? input.wrenchContext);
  const draft = parseAgentMessageDraftV1(input.draft);
  const core = Object.freeze({
    schemaVersion: AGENTIC_MESSAGING_V1_SCHEMA_VERSION,
    format: AGENT_MESSAGE_HANDOFF_V1_FORMAT,
    createdAt: timestamp(input.createdAt, "Agent message handoff.createdAt"),
    expiresAt: timestamp(input.expiresAt, "Agent message handoff.expiresAt"),
    contact: Object.freeze({
      contactId: identifier(input.contact.contactId, "Agent message handoff.contact.contactId"),
      routeCandidateId: routeCandidateId(input.contact.routeCandidateId, "Agent message handoff.contact.routeCandidateId"),
      sourceId: identifier(input.contact.sourceId, "Agent message handoff.contact.sourceId"),
      conversationId: identifier(input.contact.conversationId, "Agent message handoff.contact.conversationId")
    }),
    evidence: Object.freeze({
      corpusRevision: digest(input.evidence.corpusRevision, "Agent message handoff.evidence.corpusRevision"),
      sourceRevision: digest(input.evidence.sourceRevision, "Agent message handoff.evidence.sourceRevision"),
      profileState: profileState(input.evidence.profileState, "Agent message handoff.evidence.profileState"),
      profileEvidenceRevision: input.evidence.profileEvidenceRevision === null ? null : digest(input.evidence.profileEvidenceRevision, "Agent message handoff.evidence.profileEvidenceRevision")
    }),
    wrench: Object.freeze({
      contractId: context.contractId,
      contractHash: context.contractHash,
      routeRef: context.routeRef,
      routeRefSha256: sha256(context.routeRef),
      contextRef: context.contextRef,
      contextRefSha256: sha256(context.contextRef),
      exactDataRevision: context.exactDataRevision,
      latestMessageRevision: context.latestMessageRevision,
      validatedAt: context.validatedAt,
      contextExpiresAt: context.expiresAt
    }),
    turn: Object.freeze({ bubbles: draft.bubbles }),
    privacy: Object.freeze({
      classification: "private-local",
      excludedFields: Object.freeze([
        "attachments",
        "credentials",
        "provider-coordinates",
        "provider-payloads"
      ])
    })
  });
  const lifetime = Date.parse(core.expiresAt) - Date.parse(core.createdAt);
  if (lifetime <= 0 || lifetime > AGENTIC_MESSAGING_V1_LIMITS.handoffLifetimeMilliseconds || core.createdAt < core.wrench.validatedAt) {
    return fail("Agent message handoff timestamps are inconsistent");
  }
  if (core.expiresAt > core.wrench.contextExpiresAt) {
    return fail("Agent message handoff outlives its Ghostget context binding");
  }
  const canonicalSha256 = handoffDigest(core);
  return Object.freeze({
    ...core,
    handoffId: `handoff_${canonicalSha256}`,
    integrity: Object.freeze({ algorithm: "sha256", canonicalSha256 })
  });
}
function parseAgentMessageHandoffV1(value) {
  const record = object(value, "Agent message handoff");
  exactKeys(record, [
    "schemaVersion",
    "format",
    "handoffId",
    "createdAt",
    "expiresAt",
    "contact",
    "evidence",
    "wrench",
    "turn",
    "privacy",
    "integrity"
  ], "Agent message handoff");
  if (record.schemaVersion !== AGENTIC_MESSAGING_V1_SCHEMA_VERSION || record.format !== AGENT_MESSAGE_HANDOFF_V1_FORMAT)
    return fail("Agent message handoff has the wrong schemaVersion or format");
  const contactRecord = object(record.contact, "Agent message handoff.contact");
  exactKeys(contactRecord, ["contactId", "routeCandidateId", "sourceId", "conversationId"], "Agent message handoff.contact");
  const evidenceRecord = object(record.evidence, "Agent message handoff.evidence");
  exactKeys(evidenceRecord, [
    "corpusRevision",
    "sourceRevision",
    "profileState",
    "profileEvidenceRevision"
  ], "Agent message handoff.evidence");
  const wrenchRecord = object(record.wrench, "Agent message handoff.wrench");
  exactKeys(wrenchRecord, [
    "contractId",
    "contractHash",
    "routeRef",
    "routeRefSha256",
    "contextRef",
    "contextRefSha256",
    "exactDataRevision",
    "latestMessageRevision",
    "validatedAt",
    "contextExpiresAt"
  ], "Agent message handoff.wrench");
  const turnRecord = object(record.turn, "Agent message handoff.turn");
  exactKeys(turnRecord, ["bubbles"], "Agent message handoff.turn");
  const privacyRecord = object(record.privacy, "Agent message handoff.privacy");
  exactKeys(privacyRecord, ["classification", "excludedFields"], "Agent message handoff.privacy");
  const excluded = denseArray(privacyRecord.excludedFields, "Agent message handoff.privacy.excludedFields", 4, 4);
  const expectedExcluded = ["attachments", "credentials", "provider-coordinates", "provider-payloads"];
  if (excluded.some((item, index) => item !== expectedExcluded[index])) {
    return fail("Agent message handoff.privacy.excludedFields is not canonical");
  }
  if (privacyRecord.classification !== "private-local") {
    return fail("Agent message handoff must be classified private-local");
  }
  const integrityRecord = object(record.integrity, "Agent message handoff.integrity");
  exactKeys(integrityRecord, ["algorithm", "canonicalSha256"], "Agent message handoff.integrity");
  if (integrityRecord.algorithm !== "sha256")
    return fail("Agent message handoff integrity algorithm must be sha256");
  const context = parseGhostgetMessagingContextBindingV1({
    schemaVersion: AGENTIC_MESSAGING_V1_SCHEMA_VERSION,
    format: GHOSTGET_MESSAGING_CONTEXT_BINDING_V1_FORMAT,
    contractId: wrenchRecord.contractId,
    contractHash: wrenchRecord.contractHash,
    routeRef: wrenchRecord.routeRef,
    contextRef: wrenchRecord.contextRef,
    exactDataRevision: wrenchRecord.exactDataRevision,
    latestMessageRevision: wrenchRecord.latestMessageRevision,
    validatedAt: wrenchRecord.validatedAt,
    expiresAt: wrenchRecord.contextExpiresAt
  });
  const handoff = createAgentMessageHandoffV1({
    createdAt: timestamp(record.createdAt, "Agent message handoff.createdAt"),
    expiresAt: timestamp(record.expiresAt, "Agent message handoff.expiresAt"),
    contact: {
      contactId: identifier(contactRecord.contactId, "Agent message handoff.contact.contactId"),
      routeCandidateId: routeCandidateId(contactRecord.routeCandidateId, "Agent message handoff.contact.routeCandidateId"),
      sourceId: identifier(contactRecord.sourceId, "Agent message handoff.contact.sourceId"),
      conversationId: identifier(contactRecord.conversationId, "Agent message handoff.contact.conversationId")
    },
    evidence: {
      corpusRevision: digest(evidenceRecord.corpusRevision, "Agent message handoff.evidence.corpusRevision"),
      sourceRevision: digest(evidenceRecord.sourceRevision, "Agent message handoff.evidence.sourceRevision"),
      profileState: profileState(evidenceRecord.profileState, "Agent message handoff.evidence.profileState"),
      profileEvidenceRevision: evidenceRecord.profileEvidenceRevision === null ? null : digest(evidenceRecord.profileEvidenceRevision, "Agent message handoff.evidence.profileEvidenceRevision")
    },
    ghostgetContext: context,
    draft: {
      schemaVersion: AGENTIC_MESSAGING_V1_SCHEMA_VERSION,
      format: AGENT_MESSAGE_DRAFT_V1_FORMAT,
      bubbles: bubbles(turnRecord.bubbles, "Agent message handoff.turn.bubbles")
    }
  });
  const suppliedRouteSha = digest(wrenchRecord.routeRefSha256, "Agent message handoff.wrench.routeRefSha256");
  const suppliedContextSha = digest(wrenchRecord.contextRefSha256, "Agent message handoff.wrench.contextRefSha256");
  const suppliedCanonicalSha = digest(integrityRecord.canonicalSha256, "Agent message handoff.integrity.canonicalSha256");
  if (suppliedRouteSha !== handoff.wrench.routeRefSha256 || suppliedContextSha !== handoff.wrench.contextRefSha256 || suppliedCanonicalSha !== handoff.integrity.canonicalSha256 || record.handoffId !== handoff.handoffId)
    return fail("Agent message handoff integrity does not match its canonical content");
  return handoff;
}
function ghostgetMessagingTurnDigestV1(value) {
  const handoff = parseAgentMessageHandoffV1(value);
  return sha256(canonicalJson({
    schemaVersion: 1,
    format: "wrench.messaging-turn",
    clientIntentSha256: handoff.integrity.canonicalSha256,
    routeRef: handoff.wrench.routeRef,
    contextRef: handoff.wrench.contextRef,
    parts: handoff.turn.bubbles.map((bubble2) => ({
      partId: bubble2.id,
      text: bubble2.text,
      replyRef: bubble2.replyToRef
    }))
  }));
}
function parseGhostgetMessagingReceiptBindingV1(value) {
  const record = object(value, "Ghostget messaging receipt binding");
  exactKeys(record, [
    "schemaVersion",
    "format",
    "contractId",
    "contractHash",
    "clientIntentSha256",
    "routeRefSha256",
    "contextRefSha256",
    "turnDigest",
    "previewDigest",
    "runId",
    "state",
    "partCount",
    "provenPartCount",
    "receiptSha256",
    "recordedAt"
  ], "Ghostget messaging receipt binding");
  if (record.schemaVersion !== AGENTIC_MESSAGING_V1_SCHEMA_VERSION || record.format !== GHOSTGET_MESSAGING_RECEIPT_BINDING_V1_FORMAT)
    return fail("Ghostget messaging receipt binding has the wrong schemaVersion or format");
  if (record.contractId !== GHOSTGET_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_ID || record.contractHash !== GHOSTGET_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_HASH)
    return fail("Ghostget messaging receipt binding has an unsupported contract identity");
  if (record.state !== "submitted" && record.state !== "failed" && record.state !== "partial" && record.state !== "indeterminate")
    return fail("Ghostget messaging receipt binding has an invalid state");
  if (!Number.isSafeInteger(record.partCount) || record.partCount < 1 || record.partCount > 8) {
    return fail("Ghostget messaging receipt binding.partCount must be from 1 through 8");
  }
  if (!Number.isSafeInteger(record.provenPartCount) || record.provenPartCount < 0 || record.provenPartCount > record.partCount)
    return fail("Ghostget messaging receipt binding.provenPartCount is out of range");
  const partCount = record.partCount;
  const provenPartCount = record.provenPartCount;
  if (record.state === "submitted" && provenPartCount !== partCount || record.state === "failed" && provenPartCount !== 0 || record.state === "partial" && (provenPartCount < 1 || provenPartCount >= partCount) || record.state === "indeterminate" && provenPartCount >= partCount)
    return fail("Ghostget messaging receipt binding state does not match its proven prefix");
  const parsed = Object.freeze({
    schemaVersion: AGENTIC_MESSAGING_V1_SCHEMA_VERSION,
    format: GHOSTGET_MESSAGING_RECEIPT_BINDING_V1_FORMAT,
    contractId: GHOSTGET_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_ID,
    contractHash: GHOSTGET_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_HASH,
    clientIntentSha256: digest(record.clientIntentSha256, "Ghostget messaging receipt binding.clientIntentSha256"),
    routeRefSha256: digest(record.routeRefSha256, "Ghostget messaging receipt binding.routeRefSha256"),
    contextRefSha256: digest(record.contextRefSha256, "Ghostget messaging receipt binding.contextRefSha256"),
    turnDigest: digest(record.turnDigest, "Ghostget messaging receipt binding.turnDigest"),
    previewDigest: digest(record.previewDigest, "Ghostget messaging receipt binding.previewDigest"),
    runId: identifier(record.runId, "Ghostget messaging receipt binding.runId", 256),
    state: record.state,
    partCount,
    provenPartCount,
    receiptSha256: digest(record.receiptSha256, "Ghostget messaging receipt binding.receiptSha256"),
    recordedAt: timestamp(record.recordedAt, "Ghostget messaging receipt binding.recordedAt")
  });
  const { receiptSha256, ...receiptCore } = parsed;
  if (sha256(canonicalJson(receiptCore)) !== receiptSha256) {
    return fail("Ghostget messaging receipt binding receiptSha256 does not match its canonical content");
  }
  return parsed;
}
function agentMessageRouteCandidateId(sourceId, conversationId) {
  return `route_${sha256(canonicalJson({
    conversationId: identifier(conversationId, "Source-conversation route.conversationId"),
    sourceId: identifier(sourceId, "Source-conversation route.sourceId")
  }))}`;
}
export {
  ghostgetMessagingTurnDigestV1 as wrenchMessagingTurnDigestV1,
  parseGhostgetMessagingReceiptBindingV1 as parseWrenchMessagingReceiptBindingV1,
  parseGhostgetMessagingContextBindingV1 as parseWrenchMessagingContextBindingV1,
  parseGhostgetMessagingReceiptBindingV1,
  parseGhostgetMessagingContextBindingV1,
  parseAgentMessageHandoffV1,
  parseAgentMessageHandoffRequestV1,
  parseAgentMessageDraftV1,
  ghostgetMessagingTurnDigestV1,
  createAgentMessageHandoffV1,
  agentMessageRouteCandidateId,
  GHOSTGET_MESSAGING_RECEIPT_BINDING_V1_FORMAT as WRENCH_MESSAGING_RECEIPT_BINDING_V1_FORMAT,
  GHOSTGET_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_ID as WRENCH_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_ID,
  GHOSTGET_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_HASH as WRENCH_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_HASH,
  GHOSTGET_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_DESCRIPTOR as WRENCH_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_DESCRIPTOR,
  GHOSTGET_MESSAGING_CONTEXT_BINDING_V1_FORMAT as WRENCH_MESSAGING_CONTEXT_BINDING_V1_FORMAT,
  GHOSTGET_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_ID as WRENCH_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_ID,
  GHOSTGET_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_HASH as WRENCH_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_HASH,
  GHOSTGET_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_DESCRIPTOR as WRENCH_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_DESCRIPTOR,
  GHOSTGET_MESSAGING_RECEIPT_BINDING_V1_FORMAT,
  GHOSTGET_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_ID,
  GHOSTGET_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_HASH,
  GHOSTGET_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_DESCRIPTOR,
  GHOSTGET_MESSAGING_CONTEXT_BINDING_V1_FORMAT,
  GHOSTGET_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_ID,
  GHOSTGET_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_HASH,
  GHOSTGET_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_DESCRIPTOR,
  AgenticMessagingV1ContractError,
  AGENT_MESSAGE_HANDOFF_V1_FORMAT,
  AGENT_MESSAGE_HANDOFF_REQUEST_V1_FORMAT,
  AGENT_MESSAGE_DRAFT_V1_FORMAT,
  AGENT_MESSAGE_AUDIT_V1_FORMAT,
  AGENTIC_MESSAGING_V1_SCHEMA_VERSION,
  AGENTIC_MESSAGING_V1_LIMITS
};
