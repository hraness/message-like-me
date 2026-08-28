import { types as nodeTypes } from "node:util";

import { canonicalJson, sha256 } from "./canonical-json.ts";

export const AGENTIC_MESSAGING_V1_SCHEMA_VERSION = 1 as const;
export const AGENT_MESSAGE_DRAFT_V1_FORMAT = "message-like-me.agent-message-draft" as const;
export const AGENT_MESSAGE_HANDOFF_REQUEST_V1_FORMAT =
  "message-like-me.agent-message-handoff-request" as const;
export const AGENT_MESSAGE_HANDOFF_V1_FORMAT = "message-like-me.agent-message-handoff" as const;
export const AGENT_MESSAGE_AUDIT_V1_FORMAT = "message-like-me.agent-message-handoff-audit" as const;
export const WRENCH_MESSAGING_CONTEXT_BINDING_V1_FORMAT = "wrench.messaging-context-binding" as const;
export const WRENCH_MESSAGING_RECEIPT_BINDING_V1_FORMAT = "wrench.messaging-receipt-binding" as const;

export const WRENCH_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_ID =
  "wrench.messaging-context-binding.v1" as const;
export const WRENCH_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_HASH =
  "5e64da6a3d826e7f6fa3db7dca0a4ba92c10cfb784981e71a25aed9513a5c687" as const;
export const WRENCH_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_DESCRIPTOR = Object.freeze({
  contractId: WRENCH_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_ID,
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
    "expiresAt:rfc3339",
  ]),
  format: "wrench.messaging-contract-descriptor" as const,
  schemaVersion: 1 as const,
});

export const WRENCH_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_ID =
  "wrench.messaging-receipt-binding.v1" as const;
export const WRENCH_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_HASH =
  "7f6cf724f0200b2399e4f4641c637b20b48914fc5c9b13755127a8ec69fe66f4" as const;
export const WRENCH_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_DESCRIPTOR = Object.freeze({
  contractId: WRENCH_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_ID,
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
    "recordedAt:rfc3339",
  ]),
  format: "wrench.messaging-contract-descriptor" as const,
  schemaVersion: 1 as const,
});

export const AGENTIC_MESSAGING_V1_LIMITS = Object.freeze({
  bubbles: 8,
  bubbleBytes: 8 * 1024,
  totalBubbleBytes: 32 * 1024,
  identifierBytes: 1_024,
  privateJsonBytes: 128 * 1024,
  handoffLifetimeMilliseconds: 10 * 60 * 1_000,
  maximumContextLifetimeMilliseconds: 24 * 60 * 60 * 1_000,
} as const);

export type WrenchMessagingContextBindingV1 = Readonly<{
  schemaVersion: typeof AGENTIC_MESSAGING_V1_SCHEMA_VERSION;
  format: typeof WRENCH_MESSAGING_CONTEXT_BINDING_V1_FORMAT;
  contractId: typeof WRENCH_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_ID;
  contractHash: typeof WRENCH_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_HASH;
  routeRef: string;
  contextRef: string;
  exactDataRevision: string;
  latestMessageRevision: string;
  validatedAt: string;
  expiresAt: string;
}>;

export type AgentMessageBubbleV1 = Readonly<{
  id: string;
  text: string;
  replyToRef: string | null;
}>;

export type AgentMessageDraftV1 = Readonly<{
  schemaVersion: typeof AGENTIC_MESSAGING_V1_SCHEMA_VERSION;
  format: typeof AGENT_MESSAGE_DRAFT_V1_FORMAT;
  bubbles: readonly AgentMessageBubbleV1[];
}>;

export type AgentMessageHandoffRequestV1 = Readonly<{
  schemaVersion: typeof AGENTIC_MESSAGING_V1_SCHEMA_VERSION;
  format: typeof AGENT_MESSAGE_HANDOFF_REQUEST_V1_FORMAT;
  routeCandidateId: string;
}>;

export type AgentMessageProfileStateV1 = "current" | "missing" | "stale";

export type AgentMessageHandoffV1 = Readonly<{
  schemaVersion: typeof AGENTIC_MESSAGING_V1_SCHEMA_VERSION;
  format: typeof AGENT_MESSAGE_HANDOFF_V1_FORMAT;
  handoffId: string;
  createdAt: string;
  expiresAt: string;
  contact: Readonly<{
    contactId: string;
    routeCandidateId: string;
    sourceId: string;
    conversationId: string;
  }>;
  evidence: Readonly<{
    corpusRevision: string;
    sourceRevision: string;
    profileState: AgentMessageProfileStateV1;
    profileEvidenceRevision: string | null;
  }>;
  wrench: Readonly<{
    contractId: typeof WRENCH_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_ID;
    contractHash: typeof WRENCH_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_HASH;
    routeRef: string;
    routeRefSha256: string;
    contextRef: string;
    contextRefSha256: string;
    exactDataRevision: string;
    latestMessageRevision: string;
    validatedAt: string;
    contextExpiresAt: string;
  }>;
  turn: Readonly<{ bubbles: readonly AgentMessageBubbleV1[] }>;
  privacy: Readonly<{
    classification: "private-local";
    excludedFields: readonly [
      "attachments",
      "credentials",
      "provider-coordinates",
      "provider-payloads",
    ];
  }>;
  integrity: Readonly<{
    algorithm: "sha256";
    canonicalSha256: string;
  }>;
}>;

export type AgentMessageRouteCandidateV1 = Readonly<{
  schemaVersion: typeof AGENTIC_MESSAGING_V1_SCHEMA_VERSION;
  format: "message-like-me.source-conversation-route";
  id: string;
  contactId: string;
  sourceId: string;
  conversationId: string;
  sourceKind: "bundle" | "imessage" | "x-archive";
  provider: string;
  network: string | null;
  service: string | null;
  group: boolean;
  sourceRevision: string;
  actionability: Readonly<{
    state: "evidence-only" | "wrench-binding-eligible";
    reason:
      | "archive-source"
      | "group-conversation"
      | "requires-exact-wrench-binding"
      | "superseded-route"
      | "unsupported-route";
  }>;
  privateBinding: Readonly<{
    sourceAccountId: string | null;
    sourceExternalId: string;
    coordinate:
      | Readonly<{
        kind: "beeperConversation";
        network: string;
        conversationId: string;
      }>
      | Readonly<{
        kind: "imessageChat";
        chatGuid: string;
        service: string | null;
        observedChatRowId: number | null;
      }>
      | Readonly<{
        kind: "whatsappJid";
        jid: string;
      }>;
  }> | null;
}>;

export type WrenchMessagingReceiptStateV1 =
  | "failed"
  | "indeterminate"
  | "partial"
  | "submitted";

export type WrenchMessagingReceiptBindingV1 = Readonly<{
  schemaVersion: typeof AGENTIC_MESSAGING_V1_SCHEMA_VERSION;
  format: typeof WRENCH_MESSAGING_RECEIPT_BINDING_V1_FORMAT;
  contractId: typeof WRENCH_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_ID;
  contractHash: typeof WRENCH_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_HASH;
  clientIntentSha256: string;
  routeRefSha256: string;
  contextRefSha256: string;
  turnDigest: string;
  previewDigest: string;
  runId: string;
  state: WrenchMessagingReceiptStateV1;
  partCount: number;
  provenPartCount: number;
  receiptSha256: string;
  recordedAt: string;
}>;

export class AgenticMessagingV1ContractError extends TypeError {
  readonly code = "agentic-messaging-v1-contract" as const;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AgenticMessagingV1ContractError";
  }
}

type JsonObject = Record<string, unknown>;

function fail(message: string): never {
  throw new AgenticMessagingV1ContractError(message);
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
  if (expected.length !== observed.length || observed.some((key, index) => key !== expected[index])) {
    fail(`${label} must contain exactly: ${keys.join(", ")}`);
  }
}

function denseArray(value: unknown, label: string, minimum: number, maximum: number): readonly unknown[] {
  if (
    !Array.isArray(value)
    || nodeTypes.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length < minimum
    || value.length > maximum
  ) return fail(`${label} must contain ${minimum} through ${maximum} items`);
  const keys = Reflect.ownKeys(value);
  const expected = new Set(["length", ...Array.from({ length: value.length }, (_item, index) => String(index))]);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== "string"
      || !expected.has(key)
      || descriptor === undefined
      || !("value" in descriptor)
      || (key !== "length" && descriptor.enumerable !== true)
    ) return fail(`${label} must be a dense array of data properties`);
  }
  if (keys.length !== expected.size) return fail(`${label} must be a dense array of data properties`);
  return value;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function boundedText(value: unknown, label: string, maximum: number): string {
  if (
    typeof value !== "string"
    || !isWellFormedUnicode(value)
    || utf8Bytes(value) > maximum
    || value.includes("\u0000")
  ) return fail(`${label} must be well-formed NUL-free text within ${maximum} UTF-8 bytes`);
  return value;
}

function identifier(
  value: unknown,
  label: string,
  maximum: number = AGENTIC_MESSAGING_V1_LIMITS.identifierBytes,
): string {
  const result = boundedText(value, label, maximum);
  if (result.length === 0 || /\p{Cc}|\p{Zl}|\p{Zp}/u.test(result) || result !== result.trim()) {
    return fail(`${label} must be a bounded opaque identifier without controls or surrounding space`);
  }
  return result;
}

function digest(value: unknown, label: string): string {
  const result = boundedText(value, label, 64);
  if (!/^[a-f0-9]{64}$/u.test(result)) return fail(`${label} must be lowercase SHA-256`);
  return result;
}

function routeCandidateId(value: unknown, label: string): string {
  const result = identifier(value, label, 70);
  if (!/^route_[a-f0-9]{64}$/u.test(result)) {
    return fail(`${label} must be a canonical source-conversation route ID`);
  }
  return result;
}

function timestamp(value: unknown, label: string): string {
  const result = boundedText(value, label, 64);
  const parsed = new Date(result);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== result) {
    return fail(`${label} must be a canonical UTC timestamp`);
  }
  return result;
}

function bubble(value: unknown, label: string): AgentMessageBubbleV1 {
  const record = object(value, label);
  exactKeys(record, ["id", "text", "replyToRef"], label);
  const text = boundedText(record.text, `${label}.text`, AGENTIC_MESSAGING_V1_LIMITS.bubbleBytes);
  if (text.trim().length === 0 || /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u.test(text)) {
    return fail(`${label}.text must contain visible text and no unsupported controls`);
  }
  return Object.freeze({
    id: identifier(record.id, `${label}.id`, 128),
    text,
    replyToRef: record.replyToRef === null
      ? null
      : identifier(record.replyToRef, `${label}.replyToRef`),
  });
}

function bubbles(value: unknown, label: string): readonly AgentMessageBubbleV1[] {
  const result = denseArray(value, label, 1, AGENTIC_MESSAGING_V1_LIMITS.bubbles)
    .map((item, index) => bubble(item, `${label}[${index}]`));
  if (new Set(result.map(({ id }) => id)).size !== result.length) fail(`${label} repeats a bubble ID`);
  if (result.reduce((sum, item) => sum + utf8Bytes(item.text), 0) > AGENTIC_MESSAGING_V1_LIMITS.totalBubbleBytes) {
    fail(`${label} exceeds the total text bound`);
  }
  return Object.freeze(result);
}

function profileState(value: unknown, label: string): AgentMessageProfileStateV1 {
  if (value !== "current" && value !== "missing" && value !== "stale") {
    return fail(`${label} must be current, missing, or stale`);
  }
  return value;
}

function handoffCore(value: Omit<AgentMessageHandoffV1, "handoffId" | "integrity">): unknown {
  return value;
}

function handoffDigest(value: Omit<AgentMessageHandoffV1, "handoffId" | "integrity">): string {
  return sha256(canonicalJson(handoffCore(value)));
}

export function parseWrenchMessagingContextBindingV1(
  value: unknown,
): WrenchMessagingContextBindingV1 {
  const record = object(value, "Wrench messaging context binding");
  exactKeys(record, [
    "schemaVersion", "format", "contractId", "contractHash", "routeRef", "contextRef", "exactDataRevision",
    "latestMessageRevision", "validatedAt", "expiresAt",
  ], "Wrench messaging context binding");
  if (
    record.schemaVersion !== AGENTIC_MESSAGING_V1_SCHEMA_VERSION
    || record.format !== WRENCH_MESSAGING_CONTEXT_BINDING_V1_FORMAT
  ) return fail("Wrench messaging context binding has the wrong schemaVersion or format");
  if (
    record.contractId !== WRENCH_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_ID
    || record.contractHash !== WRENCH_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_HASH
  ) return fail("Wrench messaging context binding has an unsupported contract identity");
  const validatedAt = timestamp(record.validatedAt, "Wrench messaging context binding.validatedAt");
  const expiresAt = timestamp(record.expiresAt, "Wrench messaging context binding.expiresAt");
  const lifetime = Date.parse(expiresAt) - Date.parse(validatedAt);
  if (lifetime <= 0 || lifetime > AGENTIC_MESSAGING_V1_LIMITS.maximumContextLifetimeMilliseconds) {
    return fail("Wrench messaging context binding has an invalid lifetime");
  }
  return Object.freeze({
    schemaVersion: AGENTIC_MESSAGING_V1_SCHEMA_VERSION,
    format: WRENCH_MESSAGING_CONTEXT_BINDING_V1_FORMAT,
    contractId: WRENCH_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_ID,
    contractHash: WRENCH_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_HASH,
    routeRef: identifier(record.routeRef, "Wrench messaging context binding.routeRef"),
    contextRef: identifier(record.contextRef, "Wrench messaging context binding.contextRef"),
    exactDataRevision: digest(
      record.exactDataRevision,
      "Wrench messaging context binding.exactDataRevision",
    ),
    latestMessageRevision: digest(
      record.latestMessageRevision,
      "Wrench messaging context binding.latestMessageRevision",
    ),
    validatedAt,
    expiresAt,
  });
}

export function parseAgentMessageDraftV1(value: unknown): AgentMessageDraftV1 {
  const record = object(value, "Agent message draft");
  exactKeys(record, ["schemaVersion", "format", "bubbles"], "Agent message draft");
  if (
    record.schemaVersion !== AGENTIC_MESSAGING_V1_SCHEMA_VERSION
    || record.format !== AGENT_MESSAGE_DRAFT_V1_FORMAT
  ) return fail("Agent message draft has the wrong schemaVersion or format");
  return Object.freeze({
    schemaVersion: AGENTIC_MESSAGING_V1_SCHEMA_VERSION,
    format: AGENT_MESSAGE_DRAFT_V1_FORMAT,
    bubbles: bubbles(record.bubbles, "Agent message draft.bubbles"),
  });
}

export function parseAgentMessageHandoffRequestV1(
  value: unknown,
): AgentMessageHandoffRequestV1 {
  const record = object(value, "Agent message handoff request");
  exactKeys(
    record,
    ["schemaVersion", "format", "routeCandidateId"],
    "Agent message handoff request",
  );
  if (
    record.schemaVersion !== AGENTIC_MESSAGING_V1_SCHEMA_VERSION
    || record.format !== AGENT_MESSAGE_HANDOFF_REQUEST_V1_FORMAT
  ) return fail("Agent message handoff request has the wrong schemaVersion or format");
  return Object.freeze({
    schemaVersion: AGENTIC_MESSAGING_V1_SCHEMA_VERSION,
    format: AGENT_MESSAGE_HANDOFF_REQUEST_V1_FORMAT,
    routeCandidateId: routeCandidateId(
      record.routeCandidateId,
      "Agent message handoff request.routeCandidateId",
    ),
  });
}

export function createAgentMessageHandoffV1(input: Readonly<{
  createdAt: string;
  expiresAt: string;
  contact: AgentMessageHandoffV1["contact"];
  evidence: AgentMessageHandoffV1["evidence"];
  wrenchContext: WrenchMessagingContextBindingV1;
  draft: AgentMessageDraftV1;
}>): AgentMessageHandoffV1 {
  const context = parseWrenchMessagingContextBindingV1(input.wrenchContext);
  const draft = parseAgentMessageDraftV1(input.draft);
  const core = Object.freeze({
    schemaVersion: AGENTIC_MESSAGING_V1_SCHEMA_VERSION,
    format: AGENT_MESSAGE_HANDOFF_V1_FORMAT,
    createdAt: timestamp(input.createdAt, "Agent message handoff.createdAt"),
    expiresAt: timestamp(input.expiresAt, "Agent message handoff.expiresAt"),
    contact: Object.freeze({
      contactId: identifier(input.contact.contactId, "Agent message handoff.contact.contactId"),
      routeCandidateId: routeCandidateId(
        input.contact.routeCandidateId,
        "Agent message handoff.contact.routeCandidateId",
      ),
      sourceId: identifier(input.contact.sourceId, "Agent message handoff.contact.sourceId"),
      conversationId: identifier(
        input.contact.conversationId,
        "Agent message handoff.contact.conversationId",
      ),
    }),
    evidence: Object.freeze({
      corpusRevision: digest(
        input.evidence.corpusRevision,
        "Agent message handoff.evidence.corpusRevision",
      ),
      sourceRevision: digest(
        input.evidence.sourceRevision,
        "Agent message handoff.evidence.sourceRevision",
      ),
      profileState: profileState(
        input.evidence.profileState,
        "Agent message handoff.evidence.profileState",
      ),
      profileEvidenceRevision: input.evidence.profileEvidenceRevision === null
        ? null
        : digest(
          input.evidence.profileEvidenceRevision,
          "Agent message handoff.evidence.profileEvidenceRevision",
        ),
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
      contextExpiresAt: context.expiresAt,
    }),
    turn: Object.freeze({ bubbles: draft.bubbles }),
    privacy: Object.freeze({
      classification: "private-local" as const,
      excludedFields: Object.freeze([
        "attachments",
        "credentials",
        "provider-coordinates",
        "provider-payloads",
      ] as const),
    }),
  });
  const lifetime = Date.parse(core.expiresAt) - Date.parse(core.createdAt);
  if (
    lifetime <= 0
    || lifetime > AGENTIC_MESSAGING_V1_LIMITS.handoffLifetimeMilliseconds
    || core.createdAt < core.wrench.validatedAt
  ) {
    return fail("Agent message handoff timestamps are inconsistent");
  }
  if (core.expiresAt > core.wrench.contextExpiresAt) {
    return fail("Agent message handoff outlives its Wrench context binding");
  }
  const canonicalSha256 = handoffDigest(core);
  return Object.freeze({
    ...core,
    handoffId: `handoff_${canonicalSha256}`,
    integrity: Object.freeze({ algorithm: "sha256", canonicalSha256 }),
  });
}

export function parseAgentMessageHandoffV1(value: unknown): AgentMessageHandoffV1 {
  const record = object(value, "Agent message handoff");
  exactKeys(record, [
    "schemaVersion", "format", "handoffId", "createdAt", "expiresAt", "contact", "evidence",
    "wrench", "turn", "privacy", "integrity",
  ], "Agent message handoff");
  if (
    record.schemaVersion !== AGENTIC_MESSAGING_V1_SCHEMA_VERSION
    || record.format !== AGENT_MESSAGE_HANDOFF_V1_FORMAT
  ) return fail("Agent message handoff has the wrong schemaVersion or format");

  const contactRecord = object(record.contact, "Agent message handoff.contact");
  exactKeys(contactRecord, ["contactId", "routeCandidateId", "sourceId", "conversationId"], "Agent message handoff.contact");
  const evidenceRecord = object(record.evidence, "Agent message handoff.evidence");
  exactKeys(evidenceRecord, [
    "corpusRevision", "sourceRevision", "profileState", "profileEvidenceRevision",
  ], "Agent message handoff.evidence");
  const wrenchRecord = object(record.wrench, "Agent message handoff.wrench");
  exactKeys(wrenchRecord, [
    "contractId", "contractHash", "routeRef", "routeRefSha256", "contextRef", "contextRefSha256",
    "exactDataRevision", "latestMessageRevision", "validatedAt", "contextExpiresAt",
  ], "Agent message handoff.wrench");
  const turnRecord = object(record.turn, "Agent message handoff.turn");
  exactKeys(turnRecord, ["bubbles"], "Agent message handoff.turn");
  const privacyRecord = object(record.privacy, "Agent message handoff.privacy");
  exactKeys(privacyRecord, ["classification", "excludedFields"], "Agent message handoff.privacy");
  const excluded = denseArray(
    privacyRecord.excludedFields,
    "Agent message handoff.privacy.excludedFields",
    4,
    4,
  );
  const expectedExcluded = ["attachments", "credentials", "provider-coordinates", "provider-payloads"];
  if (excluded.some((item, index) => item !== expectedExcluded[index])) {
    return fail("Agent message handoff.privacy.excludedFields is not canonical");
  }
  if (privacyRecord.classification !== "private-local") {
    return fail("Agent message handoff must be classified private-local");
  }
  const integrityRecord = object(record.integrity, "Agent message handoff.integrity");
  exactKeys(integrityRecord, ["algorithm", "canonicalSha256"], "Agent message handoff.integrity");
  if (integrityRecord.algorithm !== "sha256") return fail("Agent message handoff integrity algorithm must be sha256");

  const context = parseWrenchMessagingContextBindingV1({
    schemaVersion: AGENTIC_MESSAGING_V1_SCHEMA_VERSION,
    format: WRENCH_MESSAGING_CONTEXT_BINDING_V1_FORMAT,
    contractId: wrenchRecord.contractId,
    contractHash: wrenchRecord.contractHash,
    routeRef: wrenchRecord.routeRef,
    contextRef: wrenchRecord.contextRef,
    exactDataRevision: wrenchRecord.exactDataRevision,
    latestMessageRevision: wrenchRecord.latestMessageRevision,
    validatedAt: wrenchRecord.validatedAt,
    expiresAt: wrenchRecord.contextExpiresAt,
  });
  const handoff = createAgentMessageHandoffV1({
    createdAt: timestamp(record.createdAt, "Agent message handoff.createdAt"),
    expiresAt: timestamp(record.expiresAt, "Agent message handoff.expiresAt"),
    contact: {
      contactId: identifier(contactRecord.contactId, "Agent message handoff.contact.contactId"),
      routeCandidateId: routeCandidateId(
        contactRecord.routeCandidateId,
        "Agent message handoff.contact.routeCandidateId",
      ),
      sourceId: identifier(contactRecord.sourceId, "Agent message handoff.contact.sourceId"),
      conversationId: identifier(
        contactRecord.conversationId,
        "Agent message handoff.contact.conversationId",
      ),
    },
    evidence: {
      corpusRevision: digest(evidenceRecord.corpusRevision, "Agent message handoff.evidence.corpusRevision"),
      sourceRevision: digest(evidenceRecord.sourceRevision, "Agent message handoff.evidence.sourceRevision"),
      profileState: profileState(evidenceRecord.profileState, "Agent message handoff.evidence.profileState"),
      profileEvidenceRevision: evidenceRecord.profileEvidenceRevision === null
        ? null
        : digest(
          evidenceRecord.profileEvidenceRevision,
          "Agent message handoff.evidence.profileEvidenceRevision",
        ),
    },
    wrenchContext: context,
    draft: {
      schemaVersion: AGENTIC_MESSAGING_V1_SCHEMA_VERSION,
      format: AGENT_MESSAGE_DRAFT_V1_FORMAT,
      bubbles: bubbles(turnRecord.bubbles, "Agent message handoff.turn.bubbles"),
    },
  });
  const suppliedRouteSha = digest(
    wrenchRecord.routeRefSha256,
    "Agent message handoff.wrench.routeRefSha256",
  );
  const suppliedContextSha = digest(
    wrenchRecord.contextRefSha256,
    "Agent message handoff.wrench.contextRefSha256",
  );
  const suppliedCanonicalSha = digest(
    integrityRecord.canonicalSha256,
    "Agent message handoff.integrity.canonicalSha256",
  );
  if (
    suppliedRouteSha !== handoff.wrench.routeRefSha256
    || suppliedContextSha !== handoff.wrench.contextRefSha256
    || suppliedCanonicalSha !== handoff.integrity.canonicalSha256
    || record.handoffId !== handoff.handoffId
  ) return fail("Agent message handoff integrity does not match its canonical content");
  return handoff;
}

export function wrenchMessagingTurnDigestV1(value: unknown): string {
  const handoff = parseAgentMessageHandoffV1(value);
  return sha256(canonicalJson({
    schemaVersion: 1,
    format: "wrench.messaging-turn",
    clientIntentSha256: handoff.integrity.canonicalSha256,
    routeRef: handoff.wrench.routeRef,
    contextRef: handoff.wrench.contextRef,
    parts: handoff.turn.bubbles.map((bubble) => ({
      partId: bubble.id,
      text: bubble.text,
      replyRef: bubble.replyToRef,
    })),
  }));
}

export function parseWrenchMessagingReceiptBindingV1(
  value: unknown,
): WrenchMessagingReceiptBindingV1 {
  const record = object(value, "Wrench messaging receipt binding");
  exactKeys(record, [
    "schemaVersion", "format", "contractId", "contractHash", "clientIntentSha256",
    "routeRefSha256", "contextRefSha256", "turnDigest", "previewDigest", "runId",
    "state", "partCount", "provenPartCount", "receiptSha256", "recordedAt",
  ], "Wrench messaging receipt binding");
  if (
    record.schemaVersion !== AGENTIC_MESSAGING_V1_SCHEMA_VERSION
    || record.format !== WRENCH_MESSAGING_RECEIPT_BINDING_V1_FORMAT
  ) return fail("Wrench messaging receipt binding has the wrong schemaVersion or format");
  if (
    record.contractId !== WRENCH_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_ID
    || record.contractHash !== WRENCH_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_HASH
  ) return fail("Wrench messaging receipt binding has an unsupported contract identity");
  if (
    record.state !== "submitted"
    && record.state !== "failed"
    && record.state !== "partial"
    && record.state !== "indeterminate"
  ) return fail("Wrench messaging receipt binding has an invalid state");
  if (!Number.isSafeInteger(record.partCount) || (record.partCount as number) < 1 || (record.partCount as number) > 8) {
    return fail("Wrench messaging receipt binding.partCount must be from 1 through 8");
  }
  if (
    !Number.isSafeInteger(record.provenPartCount)
    || (record.provenPartCount as number) < 0
    || (record.provenPartCount as number) > (record.partCount as number)
  ) return fail("Wrench messaging receipt binding.provenPartCount is out of range");
  const partCount = record.partCount as number;
  const provenPartCount = record.provenPartCount as number;
  if (
    (record.state === "submitted" && provenPartCount !== partCount)
    || (record.state === "failed" && provenPartCount !== 0)
    || (record.state === "partial" && (provenPartCount < 1 || provenPartCount >= partCount))
    || (record.state === "indeterminate" && provenPartCount >= partCount)
  ) return fail("Wrench messaging receipt binding state does not match its proven prefix");
  const parsed = Object.freeze({
    schemaVersion: AGENTIC_MESSAGING_V1_SCHEMA_VERSION,
    format: WRENCH_MESSAGING_RECEIPT_BINDING_V1_FORMAT,
    contractId: WRENCH_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_ID,
    contractHash: WRENCH_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_HASH,
    clientIntentSha256: digest(
      record.clientIntentSha256,
      "Wrench messaging receipt binding.clientIntentSha256",
    ),
    routeRefSha256: digest(
      record.routeRefSha256,
      "Wrench messaging receipt binding.routeRefSha256",
    ),
    contextRefSha256: digest(
      record.contextRefSha256,
      "Wrench messaging receipt binding.contextRefSha256",
    ),
    turnDigest: digest(record.turnDigest, "Wrench messaging receipt binding.turnDigest"),
    previewDigest: digest(record.previewDigest, "Wrench messaging receipt binding.previewDigest"),
    runId: identifier(record.runId, "Wrench messaging receipt binding.runId", 256),
    state: record.state,
    partCount,
    provenPartCount,
    receiptSha256: digest(record.receiptSha256, "Wrench messaging receipt binding.receiptSha256"),
    recordedAt: timestamp(record.recordedAt, "Wrench messaging receipt binding.recordedAt"),
  });
  const { receiptSha256, ...receiptCore } = parsed;
  if (sha256(canonicalJson(receiptCore)) !== receiptSha256) {
    return fail("Wrench messaging receipt binding receiptSha256 does not match its canonical content");
  }
  return parsed;
}

export function agentMessageRouteCandidateId(sourceId: string, conversationId: string): string {
  return `route_${sha256(canonicalJson({
    conversationId: identifier(conversationId, "Source-conversation route.conversationId"),
    sourceId: identifier(sourceId, "Source-conversation route.sourceId"),
  }))}`;
}
