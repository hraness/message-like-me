/** Immutable wire-format identity for the local message bundle contract. */
export declare const LOCAL_MESSAGE_BUNDLE_V2_SCHEMA_VERSION: 2;
export declare const LOCAL_MESSAGE_BUNDLE_V2_FORMAT: "message-like-me.local-message-bundle";
export declare const LOCAL_MESSAGE_BUNDLE_V2_SOURCE_ID: "wacli-local";
export declare const LOCAL_MESSAGE_BUNDLE_V2_SOURCE_TRANSFORM_VERSION: "1.0.0";
export declare const LOCAL_MESSAGE_BUNDLE_V2_PROVIDER_ID: "whatsapp";
export declare const LOCAL_MESSAGE_BUNDLE_V2_PROVIDER_VERSION: "0.15.0";
export declare const LOCAL_MESSAGE_BUNDLE_V2_NETWORK: "whatsapp";
/**
 * Source-transform versions whose semantic output Message Like Me v2 accepts.
 * A producer package version may change without changing this transform version.
 */
export declare const LOCAL_MESSAGE_BUNDLE_V2_SUPPORTED_SOURCE_TRANSFORM_VERSIONS: readonly ["1.0.0"];
export declare const LOCAL_MESSAGE_BUNDLE_V2_LIMITS: Readonly<{
    readonly manifestBytes: number;
    readonly records: 500000;
    readonly recordBytes: number;
    readonly totalBytes: number;
    readonly accounts: 1;
    readonly identifierBytes: 1024;
    readonly shortTextBytes: number;
    readonly bodyBytes: number;
    readonly mimeTypeBytes: 256;
    readonly participantsPerConversation: 10000;
    readonly attachmentsPerMessage: 256;
    readonly warnings: 128;
}>;
export declare const LOCAL_MESSAGE_BUNDLE_V2_ARTIFACTS: readonly [Readonly<{
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
export type LocalMessageBundleV2RecordKind = typeof LOCAL_MESSAGE_BUNDLE_V2_ARTIFACTS[number]["kind"];
export type LocalMessageBundleV2ArtifactPath = typeof LOCAL_MESSAGE_BUNDLE_V2_ARTIFACTS[number]["path"];
export type LocalMessageBundleV2Provenance = Readonly<{
    providerId: string;
    providerRevision: string | null;
    observedAt: string;
    connectedAccountProviderId: string;
}>;
export type LocalMessageBundleV2CommonRecord = Readonly<{
    schemaVersion: typeof LOCAL_MESSAGE_BUNDLE_V2_SCHEMA_VERSION;
    kind: LocalMessageBundleV2RecordKind;
    id: string;
    accountId: string;
    network: typeof LOCAL_MESSAGE_BUNDLE_V2_NETWORK;
    provenance: LocalMessageBundleV2Provenance;
}>;
export type LocalMessageBundleV2AccountRecord = LocalMessageBundleV2CommonRecord & Readonly<{
    kind: "account";
    displayName: string | null;
    handle: string | null;
    selfParticipantId: string;
}>;
export type LocalMessageBundleV2ParticipantRecord = LocalMessageBundleV2CommonRecord & Readonly<{
    kind: "participant";
    displayName: string | null;
    handle: string | null;
    isSelf: boolean;
}>;
export type LocalMessageBundleV2ConversationRecord = LocalMessageBundleV2CommonRecord & Readonly<{
    kind: "conversation";
    type: "direct" | "group";
    title: string | null;
    participantIds: readonly string[];
    participantsComplete: boolean | null;
    startedAt: string | null;
    lastMessageAt: string | null;
}>;
export type LocalMessageBundleV2AttachmentRecord = Readonly<{
    kind: "audio" | "document" | "image" | "link" | "sticker" | "video" | "unknown";
    mimeType: string | null;
    name: string | null;
    sizeBytes: number | null;
}>;
export type LocalMessageBundleV2Reply = Readonly<{
    messageId: string | null;
    providerId: string;
}>;
export type LocalMessageBundleV2Edit = Readonly<{
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
export type LocalMessageBundleV2Deletion = Readonly<{
    state: "revoked" | "deleted-for-me" | "revoked-and-deleted-for-me";
    observedAt: string;
    providerRevision: string | null;
}>;
export type LocalMessageBundleV2MessageRecord = LocalMessageBundleV2CommonRecord & Readonly<{
    kind: "message";
    conversationId: string;
    senderParticipantId: string | null;
    direction: "incoming" | "outgoing" | "unknown";
    sentAt: string;
    sortKey: string;
    body: string | null;
    bodyTruncated: boolean | null;
    replyTo: LocalMessageBundleV2Reply | null;
    edit: LocalMessageBundleV2Edit | null;
    deletion: LocalMessageBundleV2Deletion | null;
    attachments: readonly LocalMessageBundleV2AttachmentRecord[];
}>;
export type LocalMessageBundleV2ReactionRecord = LocalMessageBundleV2CommonRecord & Readonly<{
    kind: "reaction";
    messageId: string | null;
    messageProviderId: string;
    participantId: string | null;
    body: string;
    reactedAt: string | null;
    state: "active" | "removed";
}>;
export type LocalMessageBundleV2TombstoneRecord = LocalMessageBundleV2CommonRecord & Readonly<{
    kind: "tombstone";
    entityKind: "conversation" | "message" | "reaction";
    entityId: string | null;
    entityProviderId: string;
    deletedAt: string;
    scope: "remote" | "local" | "unknown";
    providerRevision: string | null;
}>;
export type LocalMessageBundleV2Record = LocalMessageBundleV2AccountRecord | LocalMessageBundleV2ParticipantRecord | LocalMessageBundleV2ConversationRecord | LocalMessageBundleV2MessageRecord | LocalMessageBundleV2ReactionRecord | LocalMessageBundleV2TombstoneRecord;
export type LocalMessageBundleV2RecordByKind = Readonly<{
    account: LocalMessageBundleV2AccountRecord;
    participant: LocalMessageBundleV2ParticipantRecord;
    conversation: LocalMessageBundleV2ConversationRecord;
    message: LocalMessageBundleV2MessageRecord;
    reaction: LocalMessageBundleV2ReactionRecord;
    tombstone: LocalMessageBundleV2TombstoneRecord;
}>;
export type LocalMessageBundleV2WhatsAppJidKind = "user" | "lid" | "group";
export type LocalMessageBundleV2WhatsAppJid = Readonly<{
    jid: string;
    kind: LocalMessageBundleV2WhatsAppJidKind;
    e164: string | null;
}>;
export type LocalMessageBundleV2Artifact = Readonly<{
    path: LocalMessageBundleV2ArtifactPath;
    mediaType: "application/x-ndjson";
    recordKind: LocalMessageBundleV2RecordKind;
    records: number;
    bytes: number;
    sha256: string;
}>;
export type LocalMessageBundleV2ManifestProjection = Readonly<{
    schemaVersion: typeof LOCAL_MESSAGE_BUNDLE_V2_SCHEMA_VERSION;
    format: typeof LOCAL_MESSAGE_BUNDLE_V2_FORMAT;
    source: Readonly<{
        id: typeof LOCAL_MESSAGE_BUNDLE_V2_SOURCE_ID;
        version: typeof LOCAL_MESSAGE_BUNDLE_V2_SOURCE_TRANSFORM_VERSION;
    }>;
    provider: Readonly<{
        id: typeof LOCAL_MESSAGE_BUNDLE_V2_PROVIDER_ID;
        version: typeof LOCAL_MESSAGE_BUNDLE_V2_PROVIDER_VERSION;
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
    counts: Readonly<Record<LocalMessageBundleV2RecordKind, number>>;
    artifacts: readonly LocalMessageBundleV2Artifact[];
}>;
export type LocalMessageBundleV2Manifest = LocalMessageBundleV2ManifestProjection & Readonly<{
    integrity: Readonly<{
        algorithm: "sha256";
        bundleSha256: string;
    }>;
}>;
/** Stable error category for callers that validate untrusted contract values. */
export declare class MessageBundleV2ContractError extends TypeError {
    readonly code: "message-bundle-v2-contract";
    constructor(message: string, options?: ErrorOptions);
}
/** Parse one exact canonical WhatsApp JID admitted by the native bundle seam. */
export declare function parseLocalMessageBundleV2WhatsAppJid(value: unknown, label?: string): LocalMessageBundleV2WhatsAppJid;
export declare function isLocalMessageBundleV2SourceTransformVersion(value: unknown): value is typeof LOCAL_MESSAGE_BUNDLE_V2_SOURCE_TRANSFORM_VERSION;
export declare function assertLocalMessageBundleV2SourceTransformVersion(value: unknown, label?: string): typeof LOCAL_MESSAGE_BUNDLE_V2_SOURCE_TRANSFORM_VERSION;
export declare function parseLocalMessageBundleV2Record<Kind extends LocalMessageBundleV2RecordKind>(value: unknown, kind: Kind, label?: string): LocalMessageBundleV2RecordByKind[Kind];
export declare function localMessageBundleV2ManifestProjection(manifest: LocalMessageBundleV2Manifest): LocalMessageBundleV2ManifestProjection;
export declare function localMessageBundleV2BundleSha256(projection: LocalMessageBundleV2ManifestProjection): string;
export declare function parseLocalMessageBundleV2Manifest(value: unknown): LocalMessageBundleV2Manifest;
