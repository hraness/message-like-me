/** Immutable wire-format identity for the local message bundle contract. */
export declare const LOCAL_MESSAGE_BUNDLE_V1_SCHEMA_VERSION: 1;
export declare const LOCAL_MESSAGE_BUNDLE_V1_FORMAT: "message-like-me.local-message-bundle";
export declare const LOCAL_MESSAGE_BUNDLE_V1_SOURCE_ID: "beeper-local";
export declare const LOCAL_MESSAGE_BUNDLE_V1_SOURCE_TRANSFORM_VERSION: "1.1.0";
export declare const LOCAL_MESSAGE_BUNDLE_V1_PROVIDER_ID: "beeper";
/**
 * Source-transform versions whose semantic output Message Like Me v1 accepts.
 * A producer package version may change without changing this transform version.
 */
export declare const LOCAL_MESSAGE_BUNDLE_V1_SUPPORTED_SOURCE_TRANSFORM_VERSIONS: readonly ["1.1.0"];
export declare const LOCAL_MESSAGE_BUNDLE_V1_LIMITS: Readonly<{
    readonly manifestBytes: number;
    readonly records: 500000;
    readonly recordBytes: number;
    readonly totalBytes: number;
    readonly accounts: 128;
    readonly identifierBytes: 1024;
    readonly shortTextBytes: number;
    readonly bodyBytes: number;
    readonly mimeTypeBytes: 256;
    readonly participantsPerConversation: 10000;
    readonly attachmentsPerMessage: 256;
    readonly warnings: 128;
}>;
export declare const LOCAL_MESSAGE_BUNDLE_V1_ARTIFACTS: readonly [Readonly<{
    path: "accounts.ndjson";
    kind: "account";
}>, Readonly<{
    path: "participants.ndjson";
    kind: "participant";
}>, Readonly<{
    path: "conversations.ndjson";
    kind: "conversation";
}>, Readonly<{
    path: "messages.ndjson";
    kind: "message";
}>, Readonly<{
    path: "reactions.ndjson";
    kind: "reaction";
}>, Readonly<{
    path: "tombstones.ndjson";
    kind: "tombstone";
}>];
export type LocalMessageBundleV1RecordKind = typeof LOCAL_MESSAGE_BUNDLE_V1_ARTIFACTS[number]["kind"];
export type LocalMessageBundleV1ArtifactPath = typeof LOCAL_MESSAGE_BUNDLE_V1_ARTIFACTS[number]["path"];
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
export type LocalMessageBundleV1Record = LocalMessageBundleV1AccountRecord | LocalMessageBundleV1ParticipantRecord | LocalMessageBundleV1ConversationRecord | LocalMessageBundleV1MessageRecord | LocalMessageBundleV1ReactionRecord | LocalMessageBundleV1TombstoneRecord;
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
    provider: Readonly<{
        id: typeof LOCAL_MESSAGE_BUNDLE_V1_PROVIDER_ID;
        version: string;
    }>;
    timestamps: Readonly<{
        startedAt: string;
        finishedAt: string;
        createdAt: string;
    }>;
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
    integrity: Readonly<{
        algorithm: "sha256";
        bundleSha256: string;
    }>;
}>;
/** Stable error category for callers that validate untrusted contract values. */
export declare class MessageBundleV1ContractError extends TypeError {
    readonly code: "message-bundle-v1-contract";
    constructor(message: string, options?: ErrorOptions);
}
export declare function isLocalMessageBundleV1SourceTransformVersion(value: unknown): value is typeof LOCAL_MESSAGE_BUNDLE_V1_SOURCE_TRANSFORM_VERSION;
export declare function assertLocalMessageBundleV1SourceTransformVersion(value: unknown, label?: string): typeof LOCAL_MESSAGE_BUNDLE_V1_SOURCE_TRANSFORM_VERSION;
export declare function parseLocalMessageBundleV1Record<Kind extends LocalMessageBundleV1RecordKind>(value: unknown, kind: Kind, label?: string): LocalMessageBundleV1RecordByKind[Kind];
export declare function localMessageBundleV1ManifestProjection(manifest: LocalMessageBundleV1Manifest): LocalMessageBundleV1ManifestProjection;
export declare function localMessageBundleV1BundleSha256(projection: LocalMessageBundleV1ManifestProjection): string;
export declare function parseLocalMessageBundleV1Manifest(value: unknown): LocalMessageBundleV1Manifest;
