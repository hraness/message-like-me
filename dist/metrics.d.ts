import { type ContactMetrics, type CorpusMessage, type CorpusReactionFact, type EvaluationPromptPacket, type EvaluationReferencePacket, type StudyPacket } from "./types.ts";
export type AnalyzeContactOptions = Readonly<{
    sessionGapSeconds?: number;
    burstGapSeconds?: number;
    reactionFacts?: readonly CorpusReactionFact[];
}>;
export type BuildStudyPacketOptions = Readonly<{
    limit?: number;
    generatedAt?: string;
    evidenceRevision?: string;
    evidenceWindow?: Readonly<{
        after?: string | null;
        before?: string | null;
    }>;
    maxTextBytesPerMessage?: number;
    maxMessagesPerDirectionPerExample?: number;
    maxTotalBodyBytes?: number;
}>;
export type BuildEvaluationPacketsOptions = Readonly<{
    limit?: number;
    generatedAt?: string;
    evidenceRevision?: string;
    after: string;
    before?: string | null;
    maxTextBytesPerMessage?: number;
    maxMessagesPerDirectionPerCase?: number;
    maxTotalBodyBytes?: number;
}>;
export declare function messagesInTimeWindow(messages: readonly CorpusMessage[], window: Readonly<{
    after?: string | null;
    before?: string | null;
}>): readonly CorpusMessage[];
/** Analyze one already-selected contact or conversation corpus. */
export declare function analyzeContact(messages: readonly CorpusMessage[], corpusRevision: string, contactId: string, options?: AnalyzeContactOptions): ContactMetrics;
/** Build a bounded, deterministic set of diverse response-context examples. */
export declare function buildStudyPacket(messages: readonly CorpusMessage[], metrics: ContactMetrics, options?: BuildStudyPacketOptions): StudyPacket;
/** Build temporally held-out prompt and reference packets without model calls. */
export declare function buildEvaluationPackets(messages: readonly CorpusMessage[], metrics: ContactMetrics, options: BuildEvaluationPacketsOptions): Readonly<{
    prompt: EvaluationPromptPacket;
    reference: EvaluationReferencePacket;
}>;
