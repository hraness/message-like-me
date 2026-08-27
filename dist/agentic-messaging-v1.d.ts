export declare const AGENTIC_MESSAGING_V1_SCHEMA_VERSION: 1;
export declare const AGENT_MESSAGE_DRAFT_V1_FORMAT: "message-like-me.agent-message-draft";
export declare const AGENT_MESSAGE_HANDOFF_REQUEST_V1_FORMAT: "message-like-me.agent-message-handoff-request";
export declare const AGENT_MESSAGE_HANDOFF_V1_FORMAT: "message-like-me.agent-message-handoff";
export declare const AGENT_MESSAGE_AUDIT_V1_FORMAT: "message-like-me.agent-message-handoff-audit";
export declare const WRENCH_MESSAGING_CONTEXT_BINDING_V1_FORMAT: "wrench.messaging-context-binding";
export declare const WRENCH_MESSAGING_RECEIPT_BINDING_V1_FORMAT: "wrench.messaging-receipt-binding";
export declare const WRENCH_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_ID: "wrench.messaging-context-binding.v1";
export declare const WRENCH_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_HASH: "5e64da6a3d826e7f6fa3db7dca0a4ba92c10cfb784981e71a25aed9513a5c687";
export declare const WRENCH_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_DESCRIPTOR: Readonly<{
    contractId: "wrench.messaging-context-binding.v1";
    fields: readonly string[];
    format: "wrench.messaging-contract-descriptor";
    schemaVersion: 1;
}>;
export declare const WRENCH_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_ID: "wrench.messaging-receipt-binding.v1";
export declare const WRENCH_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_HASH: "84ded556cf8bb4d5852cb22d0a0eb9c984613a1cb7c535af18cd6153e9e9bdfb";
export declare const WRENCH_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_DESCRIPTOR: Readonly<{
    contractId: "wrench.messaging-receipt-binding.v1";
    fields: readonly string[];
    format: "wrench.messaging-contract-descriptor";
    schemaVersion: 1;
}>;
export declare const AGENTIC_MESSAGING_V1_LIMITS: Readonly<{
    readonly bubbles: 8;
    readonly bubbleBytes: number;
    readonly totalBubbleBytes: number;
    readonly identifierBytes: 1024;
    readonly privateJsonBytes: number;
    readonly handoffLifetimeMilliseconds: number;
    readonly maximumContextLifetimeMilliseconds: number;
}>;
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
    turn: Readonly<{
        bubbles: readonly AgentMessageBubbleV1[];
    }>;
    privacy: Readonly<{
        classification: "private-local";
        excludedFields: readonly [
            "attachments",
            "credentials",
            "provider-coordinates",
            "provider-payloads"
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
        reason: "archive-source" | "group-conversation" | "requires-exact-wrench-binding";
    }>;
    privateBinding: Readonly<{
        sourceAccountId: string | null;
        sourceExternalId: string;
        conversationExternalId: string;
    }> | null;
}>;
export type WrenchMessagingReceiptStateV1 = "failed" | "indeterminate" | "partial" | "submitted";
export type WrenchMessagingReceiptBindingV1 = Readonly<{
    schemaVersion: typeof AGENTIC_MESSAGING_V1_SCHEMA_VERSION;
    format: typeof WRENCH_MESSAGING_RECEIPT_BINDING_V1_FORMAT;
    contractId: typeof WRENCH_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_ID;
    contractHash: typeof WRENCH_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_HASH;
    handoffSha256: string;
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
export declare class AgenticMessagingV1ContractError extends TypeError {
    readonly code: "agentic-messaging-v1-contract";
    constructor(message: string, options?: ErrorOptions);
}
export declare function parseWrenchMessagingContextBindingV1(value: unknown): WrenchMessagingContextBindingV1;
export declare function parseAgentMessageDraftV1(value: unknown): AgentMessageDraftV1;
export declare function parseAgentMessageHandoffRequestV1(value: unknown): AgentMessageHandoffRequestV1;
export declare function createAgentMessageHandoffV1(input: Readonly<{
    createdAt: string;
    expiresAt: string;
    contact: AgentMessageHandoffV1["contact"];
    evidence: AgentMessageHandoffV1["evidence"];
    wrenchContext: WrenchMessagingContextBindingV1;
    draft: AgentMessageDraftV1;
}>): AgentMessageHandoffV1;
export declare function parseAgentMessageHandoffV1(value: unknown): AgentMessageHandoffV1;
export declare function wrenchMessagingTurnDigestV1(value: unknown): string;
export declare function parseWrenchMessagingReceiptBindingV1(value: unknown): WrenchMessagingReceiptBindingV1;
export declare function agentMessageRouteCandidateId(sourceId: string, conversationId: string): string;
