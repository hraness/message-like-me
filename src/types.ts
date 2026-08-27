import { MESSAGE_BUNDLE_V1_SCHEMA_IDENTITY } from "./message-bundle-v1-identity.ts";

export const CORPUS_SCHEMA_VERSION = 2 as const;
export const METRICS_SCHEMA_VERSION = 3 as const;
export const PROFILE_SCHEMA_VERSION = 2 as const;
export const LEGACY_PROFILE_SCHEMA_VERSION = 1 as const;
export const STUDY_PACKET_SCHEMA_VERSION = 3 as const;
export const EVALUATION_PACKET_SCHEMA_VERSION = 2 as const;
export const CONTACTS_SCHEMA_VERSION = 1 as const;
export const MESSAGE_BUNDLE_SCHEMA_VERSION = MESSAGE_BUNDLE_V1_SCHEMA_IDENTITY;

export type Direction = "incoming" | "outgoing";
export type BodySource = "text" | "attributed-body" | "unavailable";
export type ReplyState = "explicit" | "none" | "unavailable";
export type MessageKind =
  | "text"
  | "attachment"
  | "reaction"
  | "system"
  | "unknown";

export type SourceIdentity = Readonly<{
  physicalPath: string;
  device: string;
  inode: string;
  bytes: number;
  modifiedAt: string;
  schemaSha256: string;
  snapshotSha256: string;
}>;

export type CorpusConversation = Readonly<{
  id: string;
  sourceKey: string;
  privateLabel: string | null;
  service: string | null;
  participantCount: number;
  participantIds: readonly string[];
  privateParticipants: readonly string[];
  group: boolean;
}>;

export type CorpusMessage = Readonly<{
  id: string;
  sourceRowId: number;
  sourceGuid: string;
  conversationId: string;
  sentAt: string;
  direction: Direction;
  body: string | null;
  bodySource: BodySource;
  kind: MessageKind;
  replyToSourceGuid: string | null;
  /** Whether this source observed an explicit reply, observed no reply, or cannot report reply links. */
  replyState: ReplyState;
  editedAt: string | null;
  retractedAt: string | null;
  service: string | null;
  attachmentCount: number;
}>;

export type CorpusSnapshot = Readonly<{
  schemaVersion: typeof CORPUS_SCHEMA_VERSION;
  source: SourceIdentity;
  conversations: readonly CorpusConversation[];
  messages: readonly CorpusMessage[];
  warnings: readonly string[];
}>;

export type CorpusSourceKind = "imessage" | "bundle" | "x-archive";

export type CorpusSourceCoverage = Readonly<{
  history: "complete-current-local" | "bounded" | "unknown";
  observedFrom: string | null;
  observedTo: string | null;
  /** Producer-specific completeness classification, when the import format has one. */
  kind?: string;
  /** Producer-supplied categorical reason for incomplete coverage. */
  reason?: string | null;
}>;

export type CorpusSourceDescriptor = Readonly<{
  /** Per-install source pseudonym used by the local store and CLI. */
  id: string;
  kind: CorpusSourceKind;
  provider: string;
  network: string | null;
  /** Private provider account identifier. Ordinary source views omit it. */
  accountId: string | null;
  /** Private producer-local source identifier. Ordinary source views omit it. */
  externalId: string;
  revision: string;
  generatedAt: string | null;
  producer: Readonly<{ id: string; version: string }>;
  coverage: CorpusSourceCoverage;
  manifestSha256: string | null;
  identity: unknown;
  warnings: readonly string[];
}>;

export type CorpusConversationProvenance = Readonly<{
  conversationId: string;
  externalId: string;
  metadata?: unknown;
}>;

export type CorpusAttachmentProvenance = Readonly<{
  id: string;
  kind: string | null;
  mimeType: string | null;
  fileName: string | null;
  bytes: number | null;
}>;

export type CorpusMessageProvenance = Readonly<{
  messageId: string;
  externalId: string;
  /** Provider ordering coordinate. Null when this record has no such coordinate. */
  providerSortKey: string | null;
  replyToExternalId: string | null;
  attachments: readonly CorpusAttachmentProvenance[];
  metadata?: unknown;
}>;

export type CorpusReactionFact = Readonly<{
  id: string;
  externalId: string;
  targetExternalId: string;
  conversationId: string | null;
  direction: Direction | null;
  body: string;
  reactedAt: string | null;
  state: "active" | "removed";
}>;

export type CorpusSourceRecord = Readonly<{
  kind: "account" | "participant" | "reaction" | "tombstone" | "excluded-message";
  id: string;
  record: unknown;
}>;

export type CorpusSourceDeletion = Readonly<{
  entityKind: "account" | "participant" | "conversation" | "message" | "reaction" | "reaction-timeline";
  localEntityId: string | null;
  externalId: string;
  deletedAt: string;
  expectedConversationId?: string;
  reason?: "tombstone" | "explicit-exclusion" | "replacement";
}>;

export type SourceCorpusSnapshot = Readonly<{
  source: CorpusSourceDescriptor;
  conversations: readonly CorpusConversation[];
  conversationProvenance: readonly CorpusConversationProvenance[];
  messages: readonly CorpusMessage[];
  messageProvenance: readonly CorpusMessageProvenance[];
  reactionFacts?: readonly CorpusReactionFact[];
  auxiliaryRecords?: readonly CorpusSourceRecord[];
  deletions?: readonly CorpusSourceDeletion[];
}>;

export type MessageBundleSnapshot = Readonly<{
  schemaVersion: typeof MESSAGE_BUNDLE_SCHEMA_VERSION;
  manifestSha256: string;
  sources: readonly SourceCorpusSnapshot[];
}>;

export type ContactHandle = Readonly<{
  kind: "email" | "phone";
  normalizedValue: string;
  /** Per-install HMAC used by the local store instead of persisting the value. */
  matchId: string;
}>;

export type AddressBookContact = Readonly<{
  /** Per-install pseudonym for the source AddressBook record. */
  id: string;
  /** Sensitive local label. Ordinary aggregate commands never emit it. */
  privateLabel: string | null;
  privateLabelBasis: "display-name" | "name-parts" | "organization" | null;
  handles: readonly ContactHandle[];
}>;

export type AddressBookSourceIdentity = Readonly<{
  physicalPath: string;
  device: string;
  inode: string;
  bytes: number;
  modifiedAt: string;
  schemaSha256: string;
}>;

export type ContactsSnapshot = Readonly<{
  schemaVersion: typeof CONTACTS_SCHEMA_VERSION;
  snapshotSha256: string;
  sources: readonly AddressBookSourceIdentity[];
  contacts: readonly AddressBookContact[];
  warnings: readonly string[];
}>;

export type SessionMetric = Readonly<{
  id: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  messageCount: number;
  incomingCount: number;
  outgoingCount: number;
  startedBy: Direction;
  endedBy: Direction;
}>;

export type BurstMetric = Readonly<{
  id: string;
  sessionId: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  direction: Direction;
  messageIds: readonly string[];
  messageCount: number;
  textMessageCount: number;
  characters: number;
}>;

export type ResponseEpisode = Readonly<{
  id: string;
  startedAt: string;
  incomingMessageIds: readonly string[];
  outgoingMessageIds: readonly string[];
  incomingCount: number;
  outgoingCount: number;
  incomingCharacters: number;
  outgoingCharacters: number;
  incomingQuestions: number;
  latencySeconds: number;
  explicitReplyCount: number;
  replyEligibleCount: number;
  replyUnavailableCount: number;
  tags: readonly string[];
}>;

export type SurfaceStyleMetrics = Readonly<{
  outgoingTextMessages: number;
  characters: Readonly<{ total: number; mean: number; median: number; p90: number }>;
  words: Readonly<{ total: number; mean: number; median: number; p90: number }>;
  lowercaseStartsRatio: number;
  terminalPunctuationRatio: number;
  questionRatio: number;
  exclamationRatio: number;
  emojiMessageRatio: number;
  multilineRatio: number;
}>;

export type TempoMetrics = Readonly<{
  responseEpisodes: number;
  responseLatencySeconds: Readonly<{ median: number | null; p25: number | null; p75: number | null; p90: number | null }>;
  outgoingMessagesPerResponse: Readonly<{ mean: number; median: number; p90: number; singleRatio: number; multiRatio: number }>;
  explicitReplyMessages: number;
  explicitReplyEligibleMessages: number;
  explicitReplyUnavailableMessages: number;
  explicitReplyRatio: number | null;
  multiIncomingEpisodes: number;
  multiQuestionEpisodes: number;
}>;

export type ReactionMetrics = Readonly<{
  total: number;
  incoming: number;
  outgoing: number;
  unknownDirection: number;
  dated: number;
  undated: number;
  outgoingReactionRatio: number;
}>;

export type ContactMetrics = Readonly<{
  schemaVersion: typeof METRICS_SCHEMA_VERSION;
  corpusRevision: string;
  contactId: string;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  messageCount: number;
  incomingCount: number;
  outgoingCount: number;
  textMessageCount: number;
  sessionGapSeconds: number;
  burstGapSeconds: number;
  sessions: readonly SessionMetric[];
  bursts: readonly BurstMetric[];
  responses: readonly ResponseEpisode[];
  tempo: TempoMetrics;
  reactions: ReactionMetrics;
  surface: SurfaceStyleMetrics;
}>;

export type StudyMessage = Readonly<{
  id: string;
  offsetSeconds: number;
  direction: Direction;
  body: string;
  sourceBodyBytes: number;
  emittedBodyBytes: number;
  bodyTruncated: boolean;
  /** Null means the source cannot report whether this message used an explicit reply link. */
  explicitReply: boolean | null;
}>;

export type StudyAggregateMetrics = Readonly<{
  schemaVersion: typeof METRICS_SCHEMA_VERSION;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  messageCount: number;
  incomingCount: number;
  outgoingCount: number;
  textMessageCount: number;
  sessionGapSeconds: number;
  burstGapSeconds: number;
  sessionCount: number;
  burstCount: number;
  responseCount: number;
  tempo: TempoMetrics;
  reactions: ReactionMetrics;
  surface: SurfaceStyleMetrics;
}>;

export type StudyExampleCoverage = Readonly<{
  source: Readonly<{
    responseIncomingMessages: number;
    responseOutgoingMessages: number;
    eligibleIncomingTextMessages: number;
    eligibleOutgoingTextMessages: number;
    bodyBytes: number;
  }>;
  emitted: Readonly<{
    incomingTextMessages: number;
    outgoingTextMessages: number;
    bodyBytes: number;
    truncatedMessages: number;
  }>;
  omitted: Readonly<{
    missingMessages: number;
    nonTextOrBodylessMessages: number;
    incomingTextMessagesByDirectionLimit: number;
    outgoingTextMessagesByDirectionLimit: number;
  }>;
}>;

export type StudyExample = Readonly<{
  id: string;
  tags: readonly string[];
  startedAt: string;
  messages: readonly StudyMessage[];
  coverage: StudyExampleCoverage;
}>;

export type StudyPacket = Readonly<{
  schemaVersion: typeof STUDY_PACKET_SCHEMA_VERSION;
  generatedAt: string;
  corpusRevision: string;
  evidenceRevision: string;
  contactId: string;
  evidenceWindow: Readonly<{
    after: string | null;
    before: string | null;
  }>;
  metrics: StudyAggregateMetrics;
  examples: readonly StudyExample[];
  selection: Readonly<{
    algorithm: "bounded-diverse-response-contexts-v1";
    requestedLimit: number;
    responseCandidates: number;
    eligibleCandidates: number;
    emitted: number;
    omittedWithoutBidirectionalText: number;
    omittedByExampleLimit: number;
    omittedByTotalBodyBytes: number;
  }>;
  budget: Readonly<{
    maxTextBytesPerMessage: number;
    maxMessagesPerDirectionPerExample: number;
    maxTotalBodyBytes: number;
    emittedBodyBytes: number;
    sourceBodyBytesInEmittedExamples: number;
    truncatedMessages: number;
    omittedTextMessagesByDirectionLimit: number;
    omittedExamplesByTotalBodyBytes: number;
    omittedExampleBodyBytes: number;
  }>;
}>;

export type EvaluationPromptCase = Readonly<{
  id: string;
  startedAt: string;
  incoming: readonly StudyMessage[];
}>;

export type EvaluationReferenceCase = Readonly<{
  id: string;
  startedAt: string;
  outgoing: readonly StudyMessage[];
  shape: Readonly<{
    bubbles: number;
    characters: number;
    words: number;
    explicitReplyMessages: number;
    explicitReplyEligibleMessages: number;
    explicitReplyUnavailableMessages: number;
  }>;
}>;

export type EvaluationPromptPacket = Readonly<{
  schemaVersion: typeof EVALUATION_PACKET_SCHEMA_VERSION;
  evaluationId: string;
  generatedAt: string;
  corpusRevision: string;
  evidenceRevision: string;
  contactId: string;
  evidenceWindow: Readonly<{
    after: string;
    before: string | null;
  }>;
  cases: readonly EvaluationPromptCase[];
  selection: Readonly<{
    algorithm: "temporal-held-out-responses-v1";
    requestedLimit: number;
    eligibleCandidates: number;
    emitted: number;
  }>;
  budget: Readonly<{
    maxTextBytesPerMessage: number;
    maxMessagesPerDirectionPerCase: number;
    maxTotalBodyBytes: number;
    emittedBodyBytes: number;
    truncatedMessages: number;
  }>;
}>;

export type EvaluationReferencePacket = Readonly<{
  schemaVersion: typeof EVALUATION_PACKET_SCHEMA_VERSION;
  evaluationId: string;
  generatedAt: string;
  corpusRevision: string;
  evidenceRevision: string;
  contactId: string;
  evidenceWindow: Readonly<{
    after: string;
    before: string | null;
  }>;
  cases: readonly EvaluationReferenceCase[];
  notice: "Open only after the candidate drafts for every case are fixed.";
}>;

export type StyleProfileV1 = Readonly<{
  schemaVersion: typeof LEGACY_PROFILE_SCHEMA_VERSION;
  contactId: string;
  corpusRevision: string;
  packetSha256: string;
  analyzedAt: string;
  overview: string;
  prose: Readonly<{
    register: string;
    capitalization: string;
    punctuation: string;
    vocabulary: string;
    warmth: string;
    humor: string;
    openings: readonly string[];
    closings: readonly string[];
    notablePatterns: readonly string[];
  }>;
  tempo: Readonly<{
    defaultBundle: string;
    singleLongMessage: string;
    multipleMessages: string;
    responseTiming: string;
    followUps: string;
  }>;
  replies: Readonly<{
    usage: string;
    useWhen: readonly string[];
    avoidWhen: readonly string[];
  }>;
  contexts: readonly Readonly<{
    when: string;
    incomingPattern: string;
    responseStrategy: string;
    prosePattern: string;
    tempoPattern: string;
    evidenceExampleIds: readonly string[];
  }>[];
  invariants: readonly string[];
  avoid: readonly string[];
  confidence: Readonly<{
    overall: "low" | "medium" | "high";
    limitations: readonly string[];
  }>;
}>;

export type ProfileEvidenceV2 = Readonly<{
  evidenceRevision: string;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  messageCount: number;
  outgoingTextMessages: number;
  responseEpisodes: number;
  studyExamples: number;
  selectionAlgorithm: "bounded-diverse-response-contexts-v1";
  after: string | null;
  before: string | null;
}>;

export type ProfileClaimV2 = Readonly<{
  dimension: "prose" | "tempo" | "reply" | "context";
  statement: string;
  basis: "measured" | "inferred";
  appliesWhen: string;
  supportExampleIds: readonly string[];
  counterexampleIds: readonly string[];
  supportCount: number;
  confidence: "low" | "medium" | "high";
  draftingConsequence: string;
}>;

export type StyleProfileV2 = Readonly<{
  schemaVersion: typeof PROFILE_SCHEMA_VERSION;
  contactId: string;
  corpusRevision: string;
  packetSha256: string;
  analyzedAt: string;
  evidence: ProfileEvidenceV2;
  overview: string;
  prose: Readonly<{
    register: string;
    capitalization: string;
    punctuation: string;
    vocabulary: string;
    warmth: string;
    humor: string;
    openingPatterns: readonly string[];
    closingPatterns: readonly string[];
    notablePatterns: readonly string[];
  }>;
  tempo: Readonly<{
    defaultBundle: string;
    singleLongMessage: string;
    multipleMessages: string;
    responseTiming: string;
    followUps: string;
  }>;
  replies: Readonly<{
    usage: string;
    useWhen: readonly string[];
    avoidWhen: readonly string[];
  }>;
  contexts: readonly Readonly<{
    when: string;
    incomingPattern: string;
    responseStrategy: string;
    prosePattern: string;
    tempoPattern: string;
    evidenceExampleIds: readonly string[];
  }>[];
  claims: readonly ProfileClaimV2[];
  invariants: readonly string[];
  avoid: readonly string[];
  confidence: Readonly<{
    overall: "low" | "medium" | "high";
    prose: "low" | "medium" | "high";
    tempo: "low" | "medium" | "high";
    replies: "low" | "medium" | "high";
    contexts: "low" | "medium" | "high";
    limitations: readonly string[];
  }>;
}>;

export type StyleProfile = StyleProfileV1 | StyleProfileV2;

export type ContactSummary = Readonly<{
  id: string;
  privateLabel?: string | null;
  scopeKind: "person" | "conversation";
  conversationCount: number;
  group: boolean;
  participantCount: number;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  messageCount: number;
  incomingCount: number;
  outgoingCount: number;
  profileState: "missing" | "current" | "stale";
}>;
