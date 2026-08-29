import type { ContactMetrics, CorpusMessage, CorpusReactionFact } from "./types.ts";
export declare const ENSOUL_SOURCE_PACKET_V1_SCHEMA_IDENTITY: "ensoul.source-packet.v1";
export declare const ENSOUL_MESSAGES_SOURCE_V1_ADAPTER_ID: "ensoul.messages-source.v1";
export declare const ENSOUL_DIGEST_CANONICALIZATION: "JCS-RFC8785";
export declare const DEFAULT_ENSOUL_MESSAGES_EXAMPLE_LIMIT = 24;
export declare const MAX_ENSOUL_MESSAGES_EXAMPLE_LIMIT = 50;
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
        "records-are-linked-by-pseudonymous-response-context"
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
/** Rebase owner-relative corpus direction onto the person named by `subjectRole`. */
export declare function ensoulSubjectMessages(messages: readonly CorpusMessage[], subjectRole: EnsoulMessagesSubjectRole): readonly CorpusMessage[];
/** Rebase reaction direction alongside message direction for subject-relative analysis. */
export declare function ensoulSubjectReactions(reactions: readonly CorpusReactionFact[], subjectRole: EnsoulMessagesSubjectRole): readonly CorpusReactionFact[];
/**
 * Build an offline, bounded Ensoul source packet from already selected local evidence.
 * The caller must pass subject-relative messages and metrics from the same snapshot.
 */
export declare function buildEnsoulMessagesSourcePacketV1(messages: readonly CorpusMessage[], metrics: ContactMetrics, options: BuildEnsoulMessagesSourcePacketV1Options): EnsoulMessagesSourcePacketV1;
