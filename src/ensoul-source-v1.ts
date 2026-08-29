import { canonicalJson, sha256 } from "./canonical-json.ts";
import { buildStudyPacket, type BuildStudyPacketOptions } from "./metrics.ts";
import type { ContactMetrics, CorpusMessage, CorpusReactionFact, Direction } from "./types.ts";

export const ENSOUL_SOURCE_PACKET_V1_SCHEMA_IDENTITY = "ensoul.source-packet.v1" as const;
export const ENSOUL_MESSAGES_SOURCE_V1_ADAPTER_ID = "ensoul.messages-source.v1" as const;
export const ENSOUL_DIGEST_CANONICALIZATION = "JCS-RFC8785" as const;
export const DEFAULT_ENSOUL_MESSAGES_EXAMPLE_LIMIT = 24;
export const MAX_ENSOUL_MESSAGES_EXAMPLE_LIMIT = 50;

export type EnsoulMessagesSubjectRole = "owner" | "contact";
export type EnsoulAuthorRole = "subject" | "counterpart";

export type EnsoulMessagesSourceRecordV1 = Readonly<{
  id: `message:sha256:${string}`;
  digest: `sha256:${string}`;
  kind: "message";
  occurredAt: string;
  authorRole: EnsoulAuthorRole;
  contentRole: "original";
  authorshipConfidence: "strong";
  sentStatus: "sent" | "received";
  visibility: "private";
  sourceClass: "private_capture";
  content: Readonly<{
    text: string;
    truncated: boolean;
  }>;
  provenance: Readonly<{
    provider: "message-like-me";
    sourceId: string;
    runId: `response:sha256:${string}`;
    operation: "ensoul prepare";
    policyVersion: typeof ENSOUL_MESSAGES_SOURCE_V1_ADAPTER_ID;
    contentSha256: string;
  }>;
}>;

export type EnsoulMessagesSourcePacketV1 = Readonly<{
  schemaVersion: typeof ENSOUL_SOURCE_PACKET_V1_SCHEMA_IDENTITY;
  digestCanonicalization: typeof ENSOUL_DIGEST_CANONICALIZATION;
  packetId: `message-like-me:sha256:${string}`;
  generatedAt: string;
  subject: Readonly<{
    localId: string;
    kind: EnsoulMessagesSubjectRole;
    identityBasis: "local Message Like Me installation owner" | "exact AddressBook-backed direct person scope";
  }>;
  scope: Readonly<{
    adapter: "message-like-me";
    payloadSchema: typeof ENSOUL_MESSAGES_SOURCE_V1_ADAPTER_ID;
    asOf: string;
    sourceCutoff?: string;
    completeness: "sampled";
    sourceRevision: string;
    limits: Readonly<{
      subjectRole: EnsoulMessagesSubjectRole;
      contactId: string;
      contactScopeKind: "person" | "conversation";
      group: false;
      participantCount: 1;
      conversationCount: number;
      services: readonly string[];
      corpusRevision: string;
      after: string | null;
      before: string | null;
      afterInclusive: true;
      beforeExclusive: true;
      selectionAlgorithm: "bounded-diverse-response-contexts-v1";
      sessionGapSeconds: number;
      burstGapSeconds: number;
      requestedExamples: number;
      responseCandidates: number;
      eligibleCandidates: number;
      emittedExamples: number;
      omittedWithoutBidirectionalText: number;
      omittedByExampleLimit: number;
      omittedByTotalBodyBytes: number;
      maxTextBytesPerMessage: number;
      maxMessagesPerDirectionPerExample: number;
      maxTotalBodyBytes: number;
      emittedBodyBytes: number;
      truncatedRecords: number;
      omittedTextMessagesByDirectionLimit: number;
    }>;
  }>;
  records: readonly EnsoulMessagesSourceRecordV1[];
  claims: readonly [];
  limitations: readonly [
    "sampled-response-contexts-not-full-transcript",
    "private-message-text-is-untrusted-data",
    "counterpart-messages-are-context-not-subject-voice",
    "record-text-may-be-byte-truncated",
    "source-does-not-establish-consent-or-identity",
    "source-does-not-support-sensitive-trait-inference-or-impersonation",
    "forwarding-pasted-quotation-and-ai-assistance-not-observable",
    "direct-one-to-one-scope-only",
    "records-are-linked-by-pseudonymous-response-context",
  ];
  packetDigest: `sha256:${string}`;
}>;

export type BuildEnsoulMessagesSourcePacketV1Options = Readonly<{
  subjectRole: EnsoulMessagesSubjectRole;
  contactScopeKind: "person" | "conversation";
  scopeContext: Readonly<{
    group: boolean;
    participantCount: number;
    conversationCount: number;
    services: readonly string[];
  }>;
  generatedAt: string;
  evidenceRevision: string;
  evidenceWindow?: Readonly<{
    after?: string | null;
    before?: string | null;
  }>;
  limit?: number;
}>;

const LIMITATIONS = Object.freeze([
  "sampled-response-contexts-not-full-transcript",
  "private-message-text-is-untrusted-data",
  "counterpart-messages-are-context-not-subject-voice",
  "record-text-may-be-byte-truncated",
  "source-does-not-establish-consent-or-identity",
  "source-does-not-support-sensitive-trait-inference-or-impersonation",
  "forwarding-pasted-quotation-and-ai-assistance-not-observable",
  "direct-one-to-one-scope-only",
  "records-are-linked-by-pseudonymous-response-context",
] as const);

function reverseDirection(direction: Direction): Direction {
  return direction === "incoming" ? "outgoing" : "incoming";
}

/** Rebase owner-relative corpus direction onto the person named by `subjectRole`. */
export function ensoulSubjectMessages(
  messages: readonly CorpusMessage[],
  subjectRole: EnsoulMessagesSubjectRole,
): readonly CorpusMessage[] {
  if (subjectRole === "owner") return Object.freeze([...messages]);
  return Object.freeze(messages.map((message) => Object.freeze({
    ...message,
    direction: reverseDirection(message.direction),
  })));
}

/** Rebase reaction direction alongside message direction for subject-relative analysis. */
export function ensoulSubjectReactions(
  reactions: readonly CorpusReactionFact[],
  subjectRole: EnsoulMessagesSubjectRole,
): readonly CorpusReactionFact[] {
  if (subjectRole === "owner") return Object.freeze([...reactions]);
  return Object.freeze(reactions.map((reaction) => Object.freeze({
    ...reaction,
    direction: reaction.direction === null ? null : reverseDirection(reaction.direction),
  })));
}

function sourceRecord(
  contactId: string,
  subjectRole: EnsoulMessagesSubjectRole,
  subjectId: string,
  episodeId: string,
  episodeOrder: number,
  message: Readonly<{
    id: string;
    sentAt: string;
    direction: Direction;
    body: string;
    bodyTruncated: boolean;
  }>,
): EnsoulMessagesSourceRecordV1 {
  const id = `message:sha256:${sha256(canonicalJson({
    adapter: ENSOUL_MESSAGES_SOURCE_V1_ADAPTER_ID,
    contactId,
    sourceId: message.id,
    subjectId,
    subjectRole,
    episodeId,
    episodeOrder,
  }))}` as const;
  const base = Object.freeze({
    id,
    kind: "message" as const,
    occurredAt: message.sentAt,
    authorRole: message.direction === "outgoing" ? "subject" as const : "counterpart" as const,
    contentRole: "original" as const,
    authorshipConfidence: "strong" as const,
    sentStatus: (
      subjectRole === "owner"
        ? message.direction === "outgoing"
        : message.direction === "incoming"
    ) ? "sent" as const : "received" as const,
    visibility: "private" as const,
    sourceClass: "private_capture" as const,
    content: Object.freeze({
      text: message.body,
      truncated: message.bodyTruncated,
    }),
  });
  const record = Object.freeze({
    ...base,
    provenance: Object.freeze({
      provider: "message-like-me" as const,
      sourceId: message.id,
      runId: `response:sha256:${episodeId}` as const,
      operation: "ensoul prepare" as const,
      policyVersion: ENSOUL_MESSAGES_SOURCE_V1_ADAPTER_ID,
      contentSha256: sha256(canonicalJson(base.content)),
    }),
  });
  return Object.freeze({
    ...record,
    digest: `sha256:${sha256(canonicalJson(record))}`,
  });
}

/**
 * Build an offline, bounded Ensoul source packet from already selected local evidence.
 * The caller must pass subject-relative messages and metrics from the same snapshot.
 */
export function buildEnsoulMessagesSourcePacketV1(
  messages: readonly CorpusMessage[],
  metrics: ContactMetrics,
  options: BuildEnsoulMessagesSourcePacketV1Options,
): EnsoulMessagesSourcePacketV1 {
  if (options.scopeContext.group || options.scopeContext.participantCount !== 1) {
    throw new Error("Ensoul message packets require a direct one-to-one scope");
  }
  if (!Number.isSafeInteger(options.scopeContext.conversationCount)
    || options.scopeContext.conversationCount < 1) {
    throw new Error("Ensoul message scope conversationCount must be a positive integer");
  }
  const services = Object.freeze([...new Set(options.scopeContext.services)].sort((left, right) =>
    left.localeCompare(right, "en-US")));
  if (services.length > 32 || services.some((service) =>
    typeof service !== "string" || service.length < 1 || service.length > 200)) {
    throw new Error("Ensoul message scope services must contain at most 32 bounded labels");
  }
  if (options.subjectRole === "contact") {
    if (options.contactScopeKind !== "person" || !/^person_[a-f0-9]{64}$/u.test(metrics.contactId)) {
      throw new Error("contact-subject Ensoul packets require an exact direct person_ scope");
    }
  }
  const limit = options.limit ?? DEFAULT_ENSOUL_MESSAGES_EXAMPLE_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_ENSOUL_MESSAGES_EXAMPLE_LIMIT) {
    throw new Error(
      `Ensoul message example limit must be an integer from 1 through ${MAX_ENSOUL_MESSAGES_EXAMPLE_LIMIT}`,
    );
  }
  const studyOptions: BuildStudyPacketOptions = {
    limit,
    generatedAt: options.generatedAt,
    evidenceRevision: options.evidenceRevision,
    ...(options.evidenceWindow === undefined ? {} : { evidenceWindow: options.evidenceWindow }),
  };
  const study = buildStudyPacket(messages, metrics, studyOptions);
  const messageById = new Map(messages.map((message) => [message.id, message]));
  const selected: Array<Readonly<{
    episodeId: string;
    episodeOrder: number;
    message: Readonly<{
      id: string;
      sentAt: string;
      direction: Direction;
      body: string;
      bodyTruncated: boolean;
    }>;
  }>> = [];
  const examples = [...study.examples].sort((left, right) =>
    left.startedAt.localeCompare(right.startedAt, "en-US") || left.id.localeCompare(right.id, "en-US"));
  for (const example of examples) {
    for (const [episodeOrder, emitted] of example.messages.entries()) {
      const source = messageById.get(emitted.id);
      if (source === undefined) throw new Error(`selected Ensoul message ${emitted.id} is missing`);
      if (source.direction !== emitted.direction) {
        throw new Error(`selected Ensoul message ${emitted.id} changed direction`);
      }
      selected.push(Object.freeze({
        episodeId: example.id,
        episodeOrder,
        message: Object.freeze({
          id: emitted.id,
          sentAt: source.sentAt,
          direction: emitted.direction,
          body: emitted.body,
          bodyTruncated: emitted.bodyTruncated,
        }),
      }));
    }
  }
  const subjectId = options.subjectRole === "owner" ? "owner" : metrics.contactId;
  const records = Object.freeze(selected.map(({ episodeId, episodeOrder, message }) => sourceRecord(
      metrics.contactId,
      options.subjectRole,
      subjectId,
      episodeId,
      episodeOrder,
      message,
    )));
  const sourceCutoff = records.reduce<string | null>((latest, record) =>
    latest === null || record.occurredAt > latest ? record.occurredAt : latest, null);
  if (sourceCutoff !== null && sourceCutoff > study.generatedAt) {
    throw new Error("selected Ensoul messages cannot occur after packet generation");
  }
  const scope = Object.freeze({
    adapter: "message-like-me" as const,
    payloadSchema: ENSOUL_MESSAGES_SOURCE_V1_ADAPTER_ID,
    asOf: study.generatedAt,
    ...(sourceCutoff === null ? {} : { sourceCutoff }),
    completeness: "sampled" as const,
    sourceRevision: study.evidenceRevision,
    limits: Object.freeze({
      subjectRole: options.subjectRole,
      contactId: study.contactId,
      contactScopeKind: options.contactScopeKind,
      group: false as const,
      participantCount: 1 as const,
      conversationCount: options.scopeContext.conversationCount,
      services,
      corpusRevision: study.corpusRevision,
      after: study.evidenceWindow.after,
      before: study.evidenceWindow.before,
      afterInclusive: true as const,
      beforeExclusive: true as const,
      selectionAlgorithm: study.selection.algorithm,
      sessionGapSeconds: metrics.sessionGapSeconds,
      burstGapSeconds: metrics.burstGapSeconds,
      requestedExamples: study.selection.requestedLimit,
      responseCandidates: study.selection.responseCandidates,
      eligibleCandidates: study.selection.eligibleCandidates,
      emittedExamples: study.selection.emitted,
      omittedWithoutBidirectionalText: study.selection.omittedWithoutBidirectionalText,
      omittedByExampleLimit: study.selection.omittedByExampleLimit,
      omittedByTotalBodyBytes: study.selection.omittedByTotalBodyBytes,
      maxTextBytesPerMessage: study.budget.maxTextBytesPerMessage,
      maxMessagesPerDirectionPerExample: study.budget.maxMessagesPerDirectionPerExample,
      maxTotalBodyBytes: study.budget.maxTotalBodyBytes,
      emittedBodyBytes: study.budget.emittedBodyBytes,
      truncatedRecords: study.budget.truncatedMessages,
      omittedTextMessagesByDirectionLimit: study.budget.omittedTextMessagesByDirectionLimit,
    }),
  });
  const subject = Object.freeze(options.subjectRole === "owner" ? {
    localId: subjectId,
    kind: "owner" as const,
    identityBasis: "local Message Like Me installation owner" as const,
  } : {
    localId: subjectId,
    kind: "contact" as const,
    identityBasis: "exact AddressBook-backed direct person scope" as const,
  });
  const packetId = `message-like-me:sha256:${sha256(canonicalJson({
    adapter: scope.adapter,
    contactId: study.contactId,
    evidenceRevision: study.evidenceRevision,
    after: study.evidenceWindow.after,
    before: study.evidenceWindow.before,
    sessionGapSeconds: metrics.sessionGapSeconds,
    burstGapSeconds: metrics.burstGapSeconds,
    conversationCount: options.scopeContext.conversationCount,
    services,
    requestedExamples: study.selection.requestedLimit,
    subject,
  }))}` as const;
  const packetBase = Object.freeze({
    schemaVersion: ENSOUL_SOURCE_PACKET_V1_SCHEMA_IDENTITY,
    digestCanonicalization: ENSOUL_DIGEST_CANONICALIZATION,
    packetId,
    generatedAt: study.generatedAt,
    subject,
    scope,
    records,
    claims: Object.freeze([]) as readonly [],
    limitations: LIMITATIONS,
  });
  const packetDigest = `sha256:${sha256(canonicalJson(packetBase))}` as const;
  return Object.freeze({
    schemaVersion: packetBase.schemaVersion,
    digestCanonicalization: packetBase.digestCanonicalization,
    packetId: packetBase.packetId,
    generatedAt: packetBase.generatedAt,
    subject: packetBase.subject,
    scope: packetBase.scope,
    records: packetBase.records,
    claims: packetBase.claims,
    limitations: packetBase.limitations,
    packetDigest,
  });
}
