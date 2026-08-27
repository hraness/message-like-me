import { createHash } from "node:crypto";

import {
  EVALUATION_PACKET_SCHEMA_VERSION,
  METRICS_SCHEMA_VERSION,
  STUDY_PACKET_SCHEMA_VERSION,
  type BurstMetric,
  type ContactMetrics,
  type CorpusMessage,
  type CorpusReactionFact,
  type Direction,
  type EvaluationPromptPacket,
  type EvaluationReferencePacket,
  type ReactionMetrics,
  type ResponseEpisode,
  type SessionMetric,
  type StudyAggregateMetrics,
  type StudyExample,
  type StudyExampleCoverage,
  type StudyMessage,
  type StudyPacket,
  type SurfaceStyleMetrics,
  type TempoMetrics,
} from "./types.ts";

const DEFAULT_SESSION_GAP_SECONDS = 8 * 60 * 60;
const DEFAULT_BURST_GAP_SECONDS = 5 * 60;
const DEFAULT_STUDY_LIMIT = 12;
const MAX_STUDY_LIMIT = 50;
const DEFAULT_MAX_STUDY_TEXT_BYTES = 4 * 1024;
const MAX_STUDY_TEXT_BYTES = 64 * 1024;
const DEFAULT_MAX_STUDY_MESSAGES_PER_DIRECTION = 12;
const MAX_STUDY_MESSAGES_PER_DIRECTION = 64;
const DEFAULT_MAX_STUDY_PACKET_BODY_BYTES = 256 * 1024;
const MAX_STUDY_PACKET_BODY_BYTES = 1024 * 1024;
const MAX_GAP_SECONDS = 30 * 24 * 60 * 60;

type OrderedMessage = Readonly<{
  message: CorpusMessage;
  milliseconds: number;
}>;

type MessageBlock = Readonly<{
  direction: Direction;
  messages: readonly OrderedMessage[];
}>;

type BurstRecord = Readonly<{
  metric: BurstMetric;
  messages: readonly OrderedMessage[];
}>;

type ResponseCandidate = Readonly<{
  response: ResponseEpisode;
  example: StudyExample;
  bodyBytes: number;
  signature: string;
  informationCharacters: number;
  milliseconds: number;
}>;

type StudyMessageSet = Readonly<{
  messages: readonly StudyMessage[];
  coverage: StudyExampleCoverage;
}>;

type StudyCandidates = Readonly<{
  candidates: readonly ResponseCandidate[];
  responseCandidates: number;
  omittedWithoutBidirectionalText: number;
}>;

type StudySelection = Readonly<{
  examples: readonly StudyExample[];
  omittedByExampleLimit: number;
  omittedByTotalBodyBytes: number;
  omittedExampleBodyBytes: number;
}>;

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

function digest(namespace: string, parts: readonly string[]): string {
  const hash = createHash("sha256");
  hash.update(`message-like-me\0${namespace}\0`, "utf8");
  for (const part of parts) hash.update(`${part.length}:`, "utf8").update(part, "utf8");
  return hash.digest("hex");
}

function round(value: number, places = 6): number {
  if (!Number.isFinite(value)) return 0;
  const scale = 10 ** places;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function boundedGap(value: number | undefined, fallback: number, label: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > MAX_GAP_SECONDS) {
    throw new Error(`${label} must be an integer from 1 through ${MAX_GAP_SECONDS}`);
  }
  return result;
}

function boundedStudyInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  label: string,
): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) {
    throw new Error(`${label} must be an integer from 1 through ${maximum}`);
  }
  return result;
}

function canonicalTimestamp(value: string, label: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO timestamp`);
  }
  return milliseconds;
}

function optionalCanonicalTimestamp(
  value: string | null | undefined,
  label: string,
): Readonly<{ value: string | null; milliseconds: number | null }> {
  if (value === undefined || value === null) return Object.freeze({ value: null, milliseconds: null });
  return Object.freeze({ value, milliseconds: canonicalTimestamp(value, label) });
}

export function messagesInTimeWindow(
  messages: readonly CorpusMessage[],
  window: Readonly<{ after?: string | null; before?: string | null }>,
): readonly CorpusMessage[] {
  const after = optionalCanonicalTimestamp(window.after, "after");
  const before = optionalCanonicalTimestamp(window.before, "before");
  if (
    after.milliseconds !== null
    && before.milliseconds !== null
    && after.milliseconds >= before.milliseconds
  ) throw new Error("after must be earlier than before");
  return Object.freeze(orderedMessages(messages).flatMap(({ message, milliseconds }) =>
    (after.milliseconds === null || milliseconds >= after.milliseconds)
      && (before.milliseconds === null || milliseconds < before.milliseconds)
      ? [message]
      : []));
}

function orderedMessages(messages: readonly CorpusMessage[]): readonly OrderedMessage[] {
  if (!Array.isArray(messages)) throw new Error("messages must be an array");
  const ids = new Set<string>();
  const rows = messages.map((message, index) => {
    if (typeof message.id !== "string" || message.id.length === 0) {
      throw new Error(`messages[${index}].id must be non-empty text`);
    }
    if (ids.has(message.id)) throw new Error(`messages repeat ID ${message.id}`);
    ids.add(message.id);
    if (!Number.isSafeInteger(message.sourceRowId) || message.sourceRowId < 1) {
      throw new Error(`messages[${index}].sourceRowId must be a positive safe integer`);
    }
    if (message.direction !== "incoming" && message.direction !== "outgoing") {
      throw new Error(`messages[${index}].direction is invalid`);
    }
    return Object.freeze({
      message,
      milliseconds: canonicalTimestamp(message.sentAt, `messages[${index}].sentAt`),
    });
  });
  rows.sort((left, right) =>
    left.milliseconds - right.milliseconds
    || left.message.sourceRowId - right.message.sourceRowId
    || left.message.id.localeCompare(right.message.id, "en-US"));
  return Object.freeze(rows);
}

function timelineEligible(message: CorpusMessage): boolean {
  return message.retractedAt === null
    && (message.kind === "text" || message.kind === "attachment" || message.kind === "reaction");
}

function responseEligible(message: CorpusMessage): boolean {
  return message.retractedAt === null && (message.kind === "text" || message.kind === "attachment");
}

function secondsBetween(left: OrderedMessage, right: OrderedMessage): number {
  return Math.max(0, (right.milliseconds - left.milliseconds) / 1_000);
}

function sessionsFor(
  messages: readonly OrderedMessage[],
  corpusRevision: string,
  contactId: string,
  gapSeconds: number,
): readonly SessionMetric[] {
  const eligible = messages.filter(({ message }) => timelineEligible(message));
  if (eligible.length === 0) return Object.freeze([]);
  const groups: OrderedMessage[][] = [];
  for (const row of eligible) {
    const current = groups.at(-1);
    const prior = current?.at(-1);
    if (current === undefined || prior === undefined || secondsBetween(prior, row) > gapSeconds) {
      groups.push([row]);
    } else current.push(row);
  }
  return Object.freeze(groups.map((group, index) => {
    const first = group[0]!;
    const last = group.at(-1)!;
    const incomingCount = group.filter(({ message }) => message.direction === "incoming").length;
    const outgoingCount = group.length - incomingCount;
    return Object.freeze({
      id: digest("session", [corpusRevision, contactId, String(index), ...group.map(({ message }) => message.id)]),
      startedAt: first.message.sentAt,
      endedAt: last.message.sentAt,
      durationSeconds: round((last.milliseconds - first.milliseconds) / 1_000, 3),
      messageCount: group.length,
      incomingCount,
      outgoingCount,
      startedBy: first.message.direction,
      endedBy: last.message.direction,
    });
  }));
}

function blocksFor(messages: readonly OrderedMessage[], burstGapSeconds: number): readonly MessageBlock[] {
  const eligible = messages.filter(({ message }) => responseEligible(message));
  const blocks: Array<{ direction: Direction; messages: OrderedMessage[] }> = [];
  for (const row of eligible) {
    const current = blocks.at(-1);
    const prior = current?.messages.at(-1);
    if (
      current === undefined
      || prior === undefined
      || current.direction !== row.message.direction
      || secondsBetween(prior, row) > burstGapSeconds
    ) {
      blocks.push({ direction: row.message.direction, messages: [row] });
    } else current.messages.push(row);
  }
  return Object.freeze(blocks.map((block) => Object.freeze({
    direction: block.direction,
    messages: Object.freeze(block.messages),
  })));
}

function burstsFor(
  messages: readonly OrderedMessage[],
  sessions: readonly SessionMetric[],
  corpusRevision: string,
  contactId: string,
  burstGapSeconds: number,
): readonly BurstRecord[] {
  const result: BurstRecord[] = [];
  for (const session of sessions) {
    const started = Date.parse(session.startedAt);
    const ended = Date.parse(session.endedAt);
    const sessionRows = messages.filter((row) =>
      row.milliseconds >= started
      && row.milliseconds <= ended
      && responseEligible(row.message));
    for (const block of blocksFor(sessionRows, burstGapSeconds)) {
      const first = block.messages[0]!;
      const last = block.messages.at(-1)!;
      const messageIds = Object.freeze(block.messages.map(({ message }) => message.id));
      const textBodies = bodies(block.messages);
      result.push(Object.freeze({
        metric: Object.freeze({
          id: digest("burst", [corpusRevision, contactId, session.id, ...messageIds]),
          sessionId: session.id,
          startedAt: first.message.sentAt,
          endedAt: last.message.sentAt,
          durationSeconds: round((last.milliseconds - first.milliseconds) / 1_000, 3),
          direction: block.direction,
          messageIds,
          messageCount: block.messages.length,
          textMessageCount: textBodies.length,
          characters: textBodies.reduce((total, body) => total + characterCount(body), 0),
        }),
        messages: block.messages,
      }));
    }
  }
  return Object.freeze(result);
}

function bodies(rows: readonly OrderedMessage[]): readonly string[] {
  return rows.flatMap(({ message }) =>
    message.retractedAt === null && message.kind === "text" && message.body !== null ? [message.body] : []);
}

function characterCount(value: string): number {
  return Array.from(value).length;
}

function questionCount(value: string): number {
  return value.match(/[?？]/gu)?.length ?? 0;
}

function containsMultiItemBody(value: string): boolean {
  const lines = value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 2) return true;
  return /(?:^|\n)\s*(?:[-*•]|[0-9]{1,2}[.)])\s+/u.test(value)
    || (value.match(/;/gu)?.length ?? 0) >= 2;
}

function responseTags(
  incoming: readonly OrderedMessage[],
  outgoing: readonly OrderedMessage[],
  latencySeconds: number,
  incomingQuestions: number,
  outgoingCharacters: number,
  explicitReplyCount: number,
  replyUnavailableCount: number,
): readonly string[] {
  const tags = new Set<string>();
  tags.add(outgoing.length === 1 ? "single-message-response" : "multi-message-response");
  if (incoming.length > 1) tags.add("multi-incoming");
  if (incomingQuestions > 1) tags.add("multi-question");
  if (
    incoming.length > 1
    || incomingQuestions > 1
    || bodies(incoming).some(containsMultiItemBody)
  ) tags.add("multi-item-context");
  if (explicitReplyCount > 0) tags.add("explicit-reply");
  if (replyUnavailableCount > 0) tags.add("reply-unavailable");
  if (latencySeconds <= 60) tags.add("fast-response");
  else if (latencySeconds >= 60 * 60) tags.add("delayed-response");
  if (outgoingCharacters <= 40) tags.add("short-response");
  else if (outgoingCharacters >= 280) tags.add("long-response");
  if (bodies(outgoing).some((body) => body.includes("\n"))) tags.add("multiline-response");
  return Object.freeze([...tags].sort((left, right) => left.localeCompare(right, "en-US")));
}

function responsesFor(
  bursts: readonly BurstRecord[],
  corpusRevision: string,
  contactId: string,
): readonly ResponseEpisode[] {
  const result: ResponseEpisode[] = [];
  const bySession = new Map<string, BurstRecord[]>();
  for (const burst of bursts) {
    const values = bySession.get(burst.metric.sessionId) ?? [];
    values.push(burst);
    bySession.set(burst.metric.sessionId, values);
  }
  for (const sessionBursts of bySession.values()) {
    for (let index = 0; index + 1 < sessionBursts.length; index += 1) {
      const incoming = sessionBursts[index]!;
      const outgoing = sessionBursts[index + 1]!;
      if (incoming.metric.direction !== "incoming" || outgoing.metric.direction !== "outgoing") continue;
      const incomingBodies = bodies(incoming.messages);
      const outgoingBodies = bodies(outgoing.messages);
      const incomingCharacters = incomingBodies.reduce((total, body) => total + characterCount(body), 0);
      const outgoingCharacters = outgoingBodies.reduce((total, body) => total + characterCount(body), 0);
      const incomingQuestions = incomingBodies.reduce((total, body) => total + questionCount(body), 0);
      const explicitReplyCount = outgoing.messages.filter(({ message }) =>
        message.replyState === "explicit").length;
      const replyEligibleCount = outgoing.messages.filter(({ message }) =>
        message.replyState !== "unavailable").length;
      const replyUnavailableCount = outgoing.messages.length - replyEligibleCount;
      const lastIncoming = incoming.messages.at(-1)!;
      const firstOutgoing = outgoing.messages[0]!;
      const latencySeconds = round(secondsBetween(lastIncoming, firstOutgoing), 3);
      const incomingIds = Object.freeze(incoming.messages.map(({ message }) => message.id));
      const outgoingIds = Object.freeze(outgoing.messages.map(({ message }) => message.id));
      result.push(Object.freeze({
        id: digest("response", [corpusRevision, contactId, ...incomingIds, "->", ...outgoingIds]),
        startedAt: incoming.messages[0]!.message.sentAt,
        incomingMessageIds: incomingIds,
        outgoingMessageIds: outgoingIds,
        incomingCount: incoming.messages.length,
        outgoingCount: outgoing.messages.length,
        incomingCharacters,
        outgoingCharacters,
        incomingQuestions,
        latencySeconds,
        explicitReplyCount,
        replyEligibleCount,
        replyUnavailableCount,
        tags: responseTags(
          incoming.messages,
          outgoing.messages,
          latencySeconds,
          incomingQuestions,
          outgoingCharacters,
          explicitReplyCount,
          replyUnavailableCount,
        ),
      }));
    }
  }
  return Object.freeze(result);
}

function quantile(values: readonly number[], proportion: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 1) return sorted[0]!;
  const position = (sorted.length - 1) * proportion;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower]!;
  const high = sorted[upper]!;
  return round(low + (high - low) * (position - lower), 6);
}

function numericDistribution(values: readonly number[]): Readonly<{
  total: number;
  mean: number;
  median: number;
  p90: number;
}> {
  const total = values.reduce((sum, value) => sum + value, 0);
  return Object.freeze({
    total,
    mean: values.length === 0 ? 0 : round(total / values.length),
    median: quantile(values, 0.5) ?? 0,
    p90: quantile(values, 0.9) ?? 0,
  });
}

function wordCount(value: string): number {
  return value.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

function firstLetterIsLowercase(value: string): boolean {
  const letter = value.match(/\p{L}/u)?.[0];
  return letter !== undefined
    && letter.toLocaleLowerCase() === letter
    && letter.toLocaleUpperCase() !== letter;
}

function ratio(count: number, total: number): number {
  return total === 0 ? 0 : round(count / total);
}

function surfaceMetrics(messages: readonly OrderedMessage[]): SurfaceStyleMetrics {
  const outgoing = messages.flatMap(({ message }) =>
    message.retractedAt === null
      && message.direction === "outgoing" && message.kind === "text" && message.body !== null
      ? [message.body]
      : []);
  const characters = outgoing.map(characterCount);
  const words = outgoing.map(wordCount);
  return Object.freeze({
    outgoingTextMessages: outgoing.length,
    characters: numericDistribution(characters),
    words: numericDistribution(words),
    lowercaseStartsRatio: ratio(outgoing.filter(firstLetterIsLowercase).length, outgoing.length),
    terminalPunctuationRatio: ratio(
      outgoing.filter((body) => /[.!?…。！？]$/u.test(body.trimEnd())).length,
      outgoing.length,
    ),
    questionRatio: ratio(outgoing.filter((body) => /[?？]/u.test(body)).length, outgoing.length),
    exclamationRatio: ratio(outgoing.filter((body) => /[!！]/u.test(body)).length, outgoing.length),
    emojiMessageRatio: ratio(
      outgoing.filter((body) => /\p{Extended_Pictographic}/u.test(body)).length,
      outgoing.length,
    ),
    multilineRatio: ratio(outgoing.filter((body) => /\r?\n/u.test(body)).length, outgoing.length),
  });
}

function tempoMetrics(messages: readonly OrderedMessage[], responses: readonly ResponseEpisode[]): TempoMetrics {
  const latencies = responses.map((response) => response.latencySeconds);
  const bundles = responses.map((response) => response.outgoingCount);
  const outgoingText = messages.filter(({ message }) =>
    message.retractedAt === null
      && message.direction === "outgoing" && message.kind === "text" && message.body !== null);
  const replyEligible = outgoingText.filter(({ message }) => message.replyState !== "unavailable");
  const explicitReplies = replyEligible.filter(({ message }) => message.replyState === "explicit").length;
  const replyUnavailable = outgoingText.length - replyEligible.length;
  return Object.freeze({
    responseEpisodes: responses.length,
    responseLatencySeconds: Object.freeze({
      median: quantile(latencies, 0.5),
      p25: quantile(latencies, 0.25),
      p75: quantile(latencies, 0.75),
      p90: quantile(latencies, 0.9),
    }),
    outgoingMessagesPerResponse: Object.freeze({
      mean: bundles.length === 0 ? 0 : round(bundles.reduce((sum, value) => sum + value, 0) / bundles.length),
      median: quantile(bundles, 0.5) ?? 0,
      p90: quantile(bundles, 0.9) ?? 0,
      singleRatio: ratio(bundles.filter((value) => value === 1).length, bundles.length),
      multiRatio: ratio(bundles.filter((value) => value > 1).length, bundles.length),
    }),
    explicitReplyMessages: explicitReplies,
    explicitReplyEligibleMessages: replyEligible.length,
    explicitReplyUnavailableMessages: replyUnavailable,
    explicitReplyRatio: replyEligible.length === 0 ? null : ratio(explicitReplies, replyEligible.length),
    multiIncomingEpisodes: responses.filter((response) => response.incomingCount > 1).length,
    multiQuestionEpisodes: responses.filter((response) => response.incomingQuestions > 1).length,
  });
}

function reactionMetrics(
  messages: readonly OrderedMessage[],
  facts: readonly CorpusReactionFact[] | undefined,
): ReactionMetrics {
  const legacy = messages.filter(({ message }) =>
    message.kind === "reaction" && message.retractedAt === null).map(({ message }) => ({
      id: message.id,
      externalId: message.sourceGuid,
      targetExternalId: message.replyToSourceGuid ?? message.sourceGuid,
      conversationId: message.conversationId,
      direction: message.direction,
      body: "unknown",
      reactedAt: message.sentAt,
      state: "active" as const,
    }));
  const merged = new Map(legacy.map((fact) => [fact.id, fact as CorpusReactionFact]));
  for (const fact of facts ?? []) merged.set(fact.id, fact);
  const source = [...merged.values()];
  const ids = new Set<string>();
  const reactions = source.filter((fact, index) => {
    if (
      typeof fact.id !== "string"
      || fact.id.length === 0
      || ids.has(fact.id)
      || (fact.direction !== null && fact.direction !== "incoming" && fact.direction !== "outgoing")
      || typeof fact.body !== "string"
      || (fact.state !== "active" && fact.state !== "removed")
    ) throw new Error(`reactionFacts[${index}] is invalid`);
    if (fact.reactedAt !== null) canonicalTimestamp(fact.reactedAt, `reactionFacts[${index}].reactedAt`);
    ids.add(fact.id);
    return fact.state === "active";
  });
  const outgoing = reactions.filter(({ direction }) => direction === "outgoing").length;
  const incoming = reactions.filter(({ direction }) => direction === "incoming").length;
  const unknownDirection = reactions.length - outgoing - incoming;
  const outgoingActions = messages.filter(({ message }) =>
    message.kind !== "reaction"
    && message.direction === "outgoing"
    && timelineEligible(message)).length + outgoing;
  return Object.freeze({
    total: reactions.length,
    incoming,
    outgoing,
    unknownDirection,
    dated: reactions.filter(({ reactedAt }) => reactedAt !== null).length,
    undated: reactions.filter(({ reactedAt }) => reactedAt === null).length,
    outgoingReactionRatio: ratio(outgoing, outgoingActions),
  });
}

/** Analyze one already-selected contact or conversation corpus. */
export function analyzeContact(
  messages: readonly CorpusMessage[],
  corpusRevision: string,
  contactId: string,
  options: AnalyzeContactOptions = {},
): ContactMetrics {
  if (typeof corpusRevision !== "string" || !/^[a-f0-9]{64}$/u.test(corpusRevision)) {
    throw new Error("corpusRevision must be a lowercase SHA-256 digest");
  }
  if (typeof contactId !== "string" || contactId.length < 1 || contactId.length > 256) {
    throw new Error("contactId must be bounded non-empty text");
  }
  const sessionGapSeconds = boundedGap(
    options.sessionGapSeconds,
    DEFAULT_SESSION_GAP_SECONDS,
    "sessionGapSeconds",
  );
  const burstGapSeconds = boundedGap(
    options.burstGapSeconds,
    DEFAULT_BURST_GAP_SECONDS,
    "burstGapSeconds",
  );
  if (burstGapSeconds > sessionGapSeconds) {
    throw new Error("burstGapSeconds cannot exceed sessionGapSeconds");
  }
  const ordered = orderedMessages(messages);
  const byConversation = new Map<string, OrderedMessage[]>();
  for (const row of ordered) {
    const rows = byConversation.get(row.message.conversationId) ?? [];
    rows.push(row);
    byConversation.set(row.message.conversationId, rows);
  }
  const sessions: SessionMetric[] = [];
  const burstRecords: BurstRecord[] = [];
  const responses: ResponseEpisode[] = [];
  for (const conversationId of [...byConversation.keys()].sort((left, right) =>
    left.localeCompare(right, "en-US"))) {
    const rows = Object.freeze(byConversation.get(conversationId)!);
    const conversationSessions = sessionsFor(
      rows,
      corpusRevision,
      contactId,
      sessionGapSeconds,
    );
    const conversationBursts = burstsFor(
      rows,
      conversationSessions,
      corpusRevision,
      contactId,
      burstGapSeconds,
    );
    sessions.push(...conversationSessions);
    burstRecords.push(...conversationBursts);
    responses.push(...responsesFor(conversationBursts, corpusRevision, contactId));
  }
  sessions.sort((left, right) =>
    left.startedAt.localeCompare(right.startedAt, "en-US")
    || left.id.localeCompare(right.id, "en-US"));
  burstRecords.sort((left, right) =>
    left.metric.startedAt.localeCompare(right.metric.startedAt, "en-US")
    || left.metric.id.localeCompare(right.metric.id, "en-US"));
  responses.sort((left, right) =>
    left.startedAt.localeCompare(right.startedAt, "en-US")
    || left.id.localeCompare(right.id, "en-US"));
  return Object.freeze({
    schemaVersion: METRICS_SCHEMA_VERSION,
    corpusRevision,
    contactId,
    firstMessageAt: ordered[0]?.message.sentAt ?? null,
    lastMessageAt: ordered.at(-1)?.message.sentAt ?? null,
    messageCount: ordered.length,
    incomingCount: ordered.filter(({ message }) => message.direction === "incoming").length,
    outgoingCount: ordered.filter(({ message }) => message.direction === "outgoing").length,
    textMessageCount: ordered.filter(({ message }) =>
      message.retractedAt === null && message.kind === "text" && message.body !== null).length,
    sessionGapSeconds,
    burstGapSeconds,
    sessions: Object.freeze(sessions),
    bursts: Object.freeze(burstRecords.map(({ metric }) => metric)),
    responses: Object.freeze(responses),
    tempo: tempoMetrics(ordered, responses),
    reactions: reactionMetrics(ordered, options.reactionFacts),
    surface: surfaceMetrics(ordered),
  });
}

function studyMessages(
  response: ResponseEpisode,
  byId: ReadonlyMap<string, OrderedMessage>,
  maximumTextBytes: number,
  maximumMessagesPerDirection: number,
): StudyMessageSet {
  const resolveRows = (
    ids: readonly string[],
    expectedDirection: Direction,
  ): Readonly<{ rows: readonly OrderedMessage[]; missing: number }> => {
    const rows: OrderedMessage[] = [];
    let missing = 0;
    for (const id of ids) {
      const row = byId.get(id);
      if (row === undefined) {
        missing += 1;
        continue;
      }
      if (row.message.direction !== expectedDirection) {
        throw new Error(`response ${response.id} references a message with the wrong direction`);
      }
      rows.push(row);
    }
    return Object.freeze({ rows: Object.freeze(rows), missing });
  };
  const incoming = resolveRows(response.incomingMessageIds, "incoming");
  const outgoing = resolveRows(response.outgoingMessageIds, "outgoing");
  const incomingText = incoming.rows.filter(({ message }) =>
    message.kind === "text" && message.body !== null);
  const outgoingText = outgoing.rows.filter(({ message }) =>
    message.kind === "text" && message.body !== null);

  // The messages nearest the handoff provide inbound context; the first
  // outgoing messages preserve the initial response shape.
  const selectedIncoming = incomingText.slice(-maximumMessagesPerDirection);
  const selectedOutgoing = outgoingText.slice(0, maximumMessagesPerDirection);
  const rows = [...selectedIncoming, ...selectedOutgoing].sort((left, right) =>
    left.milliseconds - right.milliseconds
    || left.message.sourceRowId - right.message.sourceRowId
    || left.message.id.localeCompare(right.message.id, "en-US"));
  const started = canonicalTimestamp(response.startedAt, `response ${response.id} startedAt`);
  const messages = Object.freeze(rows.map(({ message, milliseconds }) => {
    const sourceBody = message.body!;
    const sourceBodyBytes = Buffer.byteLength(sourceBody, "utf8");
    let body = sourceBody;
    let emittedBodyBytes = sourceBodyBytes;
    if (sourceBodyBytes > maximumTextBytes) {
      let bytes = 0;
      let bounded = "";
      for (const symbol of sourceBody) {
        const symbolBytes = Buffer.byteLength(symbol, "utf8");
        if (bytes + symbolBytes > maximumTextBytes) break;
        bounded += symbol;
        bytes += symbolBytes;
      }
      body = bounded;
      emittedBodyBytes = bytes;
    }
    return Object.freeze({
      id: message.id,
      offsetSeconds: round((milliseconds - started) / 1_000, 3),
      direction: message.direction,
      body,
      sourceBodyBytes,
      emittedBodyBytes,
      bodyTruncated: emittedBodyBytes < sourceBodyBytes,
      explicitReply: message.replyState === "unavailable"
        ? null
        : message.replyState === "explicit",
    });
  }));
  const eligibleRows = [...incomingText, ...outgoingText];
  const coverage: StudyExampleCoverage = Object.freeze({
    source: Object.freeze({
      responseIncomingMessages: response.incomingMessageIds.length,
      responseOutgoingMessages: response.outgoingMessageIds.length,
      eligibleIncomingTextMessages: incomingText.length,
      eligibleOutgoingTextMessages: outgoingText.length,
      bodyBytes: eligibleRows.reduce(
        (total, { message }) => total + Buffer.byteLength(message.body!, "utf8"),
        0,
      ),
    }),
    emitted: Object.freeze({
      incomingTextMessages: selectedIncoming.length,
      outgoingTextMessages: selectedOutgoing.length,
      bodyBytes: messages.reduce((total, message) => total + message.emittedBodyBytes, 0),
      truncatedMessages: messages.filter(({ bodyTruncated }) => bodyTruncated).length,
    }),
    omitted: Object.freeze({
      missingMessages: incoming.missing + outgoing.missing,
      nonTextOrBodylessMessages:
        incoming.rows.length + outgoing.rows.length - eligibleRows.length,
      incomingTextMessagesByDirectionLimit: incomingText.length - selectedIncoming.length,
      outgoingTextMessagesByDirectionLimit: outgoingText.length - selectedOutgoing.length,
    }),
  });
  return Object.freeze({ messages, coverage });
}

function responseSignature(response: ResponseEpisode): string {
  const latency = response.latencySeconds <= 60
    ? "immediate"
    : response.latencySeconds < 15 * 60
      ? "minutes"
      : response.latencySeconds < 60 * 60
        ? "hour"
        : "delayed";
  const length = response.outgoingCharacters <= 40
    ? "short"
    : response.outgoingCharacters >= 280 ? "long" : "medium";
  return [
    response.incomingCount > 1 ? "multi-in" : "single-in",
    response.outgoingCount > 1 ? "multi-out" : "single-out",
    response.incomingQuestions > 1 ? "multi-q" : response.incomingQuestions === 1 ? "one-q" : "no-q",
    response.explicitReplyCount > 0
      ? "reply"
      : response.replyUnavailableCount > 0 ? "reply-unknown" : "no-reply",
    latency,
    length,
  ].join(":");
}

function candidatesFor(
  ordered: readonly OrderedMessage[],
  metrics: ContactMetrics,
  maximumTextBytes: number,
  maximumMessagesPerDirection: number,
): StudyCandidates {
  const byId = new Map(ordered.map((row) => [row.message.id, row]));
  const candidates: ResponseCandidate[] = [];
  let omittedWithoutBidirectionalText = 0;
  for (const response of metrics.responses) {
    const study = studyMessages(
      response,
      byId,
      maximumTextBytes,
      maximumMessagesPerDirection,
    );
    const hasIncoming = study.messages.some((message) => message.direction === "incoming");
    const hasOutgoing = study.messages.some((message) => message.direction === "outgoing");
    if (!hasIncoming || !hasOutgoing) {
      omittedWithoutBidirectionalText += 1;
      continue;
    }
    const example: StudyExample = Object.freeze({
      id: response.id,
      tags: response.tags,
      startedAt: response.startedAt,
      messages: study.messages,
      coverage: study.coverage,
    });
    candidates.push(Object.freeze({
      response,
      example,
      bodyBytes: study.coverage.emitted.bodyBytes,
      signature: responseSignature(response),
      informationCharacters: study.messages.reduce(
        (total, message) => total + characterCount(message.body),
        0,
      ),
      milliseconds: Date.parse(response.startedAt),
    }));
  }
  return Object.freeze({
    candidates: Object.freeze(candidates),
    responseCandidates: metrics.responses.length,
    omittedWithoutBidirectionalText,
  });
}

function selectDiverse(
  candidates: readonly ResponseCandidate[],
  limit: number,
  maximumBodyBytes: number,
): StudySelection {
  if (candidates.length === 0) {
    return Object.freeze({
      examples: Object.freeze([]),
      omittedByExampleLimit: 0,
      omittedByTotalBodyBytes: 0,
      omittedExampleBodyBytes: 0,
    });
  }
  const frequencies = new Map<string, number>();
  for (const candidate of candidates) {
    for (const tag of candidate.example.tags) frequencies.set(tag, (frequencies.get(tag) ?? 0) + 1);
  }
  const remaining = [...candidates];
  const selected: ResponseCandidate[] = [];
  const coveredTags = new Set<string>();
  const coveredSignatures = new Set<string>();
  let emittedBodyBytes = 0;
  let omittedByTotalBodyBytes = 0;
  let omittedExampleBodyBytes = 0;
  const minimumTime = Math.min(...remaining.map((candidate) => candidate.milliseconds));
  const maximumTime = Math.max(...remaining.map((candidate) => candidate.milliseconds));
  const timeSpan = Math.max(1, maximumTime - minimumTime);
  while (selected.length < limit && remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const [index, candidate] of remaining.entries()) {
      const newTags = candidate.example.tags.filter((tag) => !coveredTags.has(tag));
      const rareTagScore = candidate.example.tags.reduce(
        (total, tag) => total + 1 / (frequencies.get(tag) ?? 1),
        0,
      );
      const signatureScore = coveredSignatures.has(candidate.signature) ? 0 : 1;
      const temporalDistance = selected.length === 0
        ? 0
        : Math.min(...selected.map((prior) =>
          Math.abs(candidate.milliseconds - prior.milliseconds) / timeSpan));
      const information = Math.min(candidate.informationCharacters, 1_000) / 1_000;
      const score = newTags.length * 10_000
        + signatureScore * 2_000
        + rareTagScore * 100
        + temporalDistance * 50
        + information;
      const best = remaining[bestIndex]!;
      if (
        score > bestScore
        || (
          score === bestScore
          && (
            candidate.milliseconds < best.milliseconds
            || (candidate.milliseconds === best.milliseconds && candidate.example.id < best.example.id)
          )
        )
      ) {
        bestIndex = index;
        bestScore = score;
      }
    }
    const chosen = remaining.splice(bestIndex, 1)[0]!;
    if (chosen.bodyBytes > maximumBodyBytes - emittedBodyBytes) {
      omittedByTotalBodyBytes += 1;
      omittedExampleBodyBytes += chosen.bodyBytes;
      continue;
    }
    selected.push(chosen);
    emittedBodyBytes += chosen.bodyBytes;
    coveredSignatures.add(chosen.signature);
    for (const tag of chosen.example.tags) coveredTags.add(tag);
  }
  return Object.freeze({
    examples: Object.freeze(selected.map((candidate) => candidate.example)),
    omittedByExampleLimit: remaining.length,
    omittedByTotalBodyBytes,
    omittedExampleBodyBytes,
  });
}

function aggregateStudyMetrics(metrics: ContactMetrics): StudyAggregateMetrics {
  return Object.freeze({
    schemaVersion: metrics.schemaVersion,
    firstMessageAt: metrics.firstMessageAt,
    lastMessageAt: metrics.lastMessageAt,
    messageCount: metrics.messageCount,
    incomingCount: metrics.incomingCount,
    outgoingCount: metrics.outgoingCount,
    textMessageCount: metrics.textMessageCount,
    sessionGapSeconds: metrics.sessionGapSeconds,
    burstGapSeconds: metrics.burstGapSeconds,
    sessionCount: metrics.sessions.length,
    burstCount: metrics.bursts.length,
    responseCount: metrics.responses.length,
    tempo: Object.freeze({
      responseEpisodes: metrics.tempo.responseEpisodes,
      responseLatencySeconds: Object.freeze({
        median: metrics.tempo.responseLatencySeconds.median,
        p25: metrics.tempo.responseLatencySeconds.p25,
        p75: metrics.tempo.responseLatencySeconds.p75,
        p90: metrics.tempo.responseLatencySeconds.p90,
      }),
      outgoingMessagesPerResponse: Object.freeze({
        mean: metrics.tempo.outgoingMessagesPerResponse.mean,
        median: metrics.tempo.outgoingMessagesPerResponse.median,
        p90: metrics.tempo.outgoingMessagesPerResponse.p90,
        singleRatio: metrics.tempo.outgoingMessagesPerResponse.singleRatio,
        multiRatio: metrics.tempo.outgoingMessagesPerResponse.multiRatio,
      }),
      explicitReplyMessages: metrics.tempo.explicitReplyMessages,
      explicitReplyEligibleMessages: metrics.tempo.explicitReplyEligibleMessages,
      explicitReplyUnavailableMessages: metrics.tempo.explicitReplyUnavailableMessages,
      explicitReplyRatio: metrics.tempo.explicitReplyRatio,
      multiIncomingEpisodes: metrics.tempo.multiIncomingEpisodes,
      multiQuestionEpisodes: metrics.tempo.multiQuestionEpisodes,
    }),
    reactions: Object.freeze({
      total: metrics.reactions.total,
      incoming: metrics.reactions.incoming,
      outgoing: metrics.reactions.outgoing,
      unknownDirection: metrics.reactions.unknownDirection,
      dated: metrics.reactions.dated,
      undated: metrics.reactions.undated,
      outgoingReactionRatio: metrics.reactions.outgoingReactionRatio,
    }),
    surface: Object.freeze({
      outgoingTextMessages: metrics.surface.outgoingTextMessages,
      characters: Object.freeze({
        total: metrics.surface.characters.total,
        mean: metrics.surface.characters.mean,
        median: metrics.surface.characters.median,
        p90: metrics.surface.characters.p90,
      }),
      words: Object.freeze({
        total: metrics.surface.words.total,
        mean: metrics.surface.words.mean,
        median: metrics.surface.words.median,
        p90: metrics.surface.words.p90,
      }),
      lowercaseStartsRatio: metrics.surface.lowercaseStartsRatio,
      terminalPunctuationRatio: metrics.surface.terminalPunctuationRatio,
      questionRatio: metrics.surface.questionRatio,
      exclamationRatio: metrics.surface.exclamationRatio,
      emojiMessageRatio: metrics.surface.emojiMessageRatio,
      multilineRatio: metrics.surface.multilineRatio,
    }),
  });
}

/** Build a bounded, deterministic set of diverse response-context examples. */
export function buildStudyPacket(
  messages: readonly CorpusMessage[],
  metrics: ContactMetrics,
  options: BuildStudyPacketOptions = {},
): StudyPacket {
  const limit = options.limit ?? DEFAULT_STUDY_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_STUDY_LIMIT) {
    throw new Error(`study packet limit must be an integer from 1 through ${MAX_STUDY_LIMIT}`);
  }
  const maximumTextBytes = boundedStudyInteger(
    options.maxTextBytesPerMessage,
    DEFAULT_MAX_STUDY_TEXT_BYTES,
    MAX_STUDY_TEXT_BYTES,
    "maxTextBytesPerMessage",
  );
  const maximumMessagesPerDirection = boundedStudyInteger(
    options.maxMessagesPerDirectionPerExample,
    DEFAULT_MAX_STUDY_MESSAGES_PER_DIRECTION,
    MAX_STUDY_MESSAGES_PER_DIRECTION,
    "maxMessagesPerDirectionPerExample",
  );
  const maximumBodyBytes = boundedStudyInteger(
    options.maxTotalBodyBytes,
    DEFAULT_MAX_STUDY_PACKET_BODY_BYTES,
    MAX_STUDY_PACKET_BODY_BYTES,
    "maxTotalBodyBytes",
  );
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  canonicalTimestamp(generatedAt, "generatedAt");
  const evidenceRevision = options.evidenceRevision ?? metrics.corpusRevision;
  if (!/^[a-f0-9]{64}$/u.test(evidenceRevision)) {
    throw new Error("evidenceRevision must be a lowercase SHA-256 digest");
  }
  const after = optionalCanonicalTimestamp(options.evidenceWindow?.after, "evidenceWindow.after");
  const before = optionalCanonicalTimestamp(options.evidenceWindow?.before, "evidenceWindow.before");
  if (
    after.milliseconds !== null
    && before.milliseconds !== null
    && after.milliseconds >= before.milliseconds
  ) throw new Error("evidenceWindow.after must be earlier than evidenceWindow.before");
  const afterMilliseconds = after.milliseconds;
  const beforeMilliseconds = before.milliseconds;
  const ordered = orderedMessages(messages).filter(({ milliseconds }) =>
    (afterMilliseconds === null || milliseconds >= afterMilliseconds)
    && (beforeMilliseconds === null || milliseconds < beforeMilliseconds));
  const candidateSet = candidatesFor(
    ordered,
    metrics,
    maximumTextBytes,
    maximumMessagesPerDirection,
  );
  const selected = selectDiverse(candidateSet.candidates, limit, maximumBodyBytes);
  const emittedBodyBytes = selected.examples.reduce(
    (total, example) => total + example.coverage.emitted.bodyBytes,
    0,
  );
  return Object.freeze({
    schemaVersion: STUDY_PACKET_SCHEMA_VERSION,
    generatedAt,
    corpusRevision: metrics.corpusRevision,
    evidenceRevision,
    contactId: metrics.contactId,
    evidenceWindow: Object.freeze({ after: after.value, before: before.value }),
    metrics: aggregateStudyMetrics(metrics),
    examples: selected.examples,
    selection: Object.freeze({
      algorithm: "bounded-diverse-response-contexts-v1",
      requestedLimit: limit,
      responseCandidates: candidateSet.responseCandidates,
      eligibleCandidates: candidateSet.candidates.length,
      emitted: selected.examples.length,
      omittedWithoutBidirectionalText: candidateSet.omittedWithoutBidirectionalText,
      omittedByExampleLimit: selected.omittedByExampleLimit,
      omittedByTotalBodyBytes: selected.omittedByTotalBodyBytes,
    }),
    budget: Object.freeze({
      maxTextBytesPerMessage: maximumTextBytes,
      maxMessagesPerDirectionPerExample: maximumMessagesPerDirection,
      maxTotalBodyBytes: maximumBodyBytes,
      emittedBodyBytes,
      sourceBodyBytesInEmittedExamples: selected.examples.reduce(
        (total, example) => total + example.coverage.source.bodyBytes,
        0,
      ),
      truncatedMessages: selected.examples.reduce(
        (total, example) => total + example.coverage.emitted.truncatedMessages,
        0,
      ),
      omittedTextMessagesByDirectionLimit: selected.examples.reduce(
        (total, example) => total
          + example.coverage.omitted.incomingTextMessagesByDirectionLimit
          + example.coverage.omitted.outgoingTextMessagesByDirectionLimit,
        0,
      ),
      omittedExamplesByTotalBodyBytes: selected.omittedByTotalBodyBytes,
      omittedExampleBodyBytes: selected.omittedExampleBodyBytes,
    }),
  });
}

/** Build temporally held-out prompt and reference packets without model calls. */
export function buildEvaluationPackets(
  messages: readonly CorpusMessage[],
  metrics: ContactMetrics,
  options: BuildEvaluationPacketsOptions,
): Readonly<{
  prompt: EvaluationPromptPacket;
  reference: EvaluationReferencePacket;
}> {
  const limit = options.limit ?? 8;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) {
    throw new Error("evaluation limit must be an integer from 1 through 25");
  }
  const maximumTextBytes = boundedStudyInteger(
    options.maxTextBytesPerMessage,
    DEFAULT_MAX_STUDY_TEXT_BYTES,
    MAX_STUDY_TEXT_BYTES,
    "maxTextBytesPerMessage",
  );
  const maximumMessagesPerDirection = boundedStudyInteger(
    options.maxMessagesPerDirectionPerCase,
    DEFAULT_MAX_STUDY_MESSAGES_PER_DIRECTION,
    MAX_STUDY_MESSAGES_PER_DIRECTION,
    "maxMessagesPerDirectionPerCase",
  );
  const maximumBodyBytes = boundedStudyInteger(
    options.maxTotalBodyBytes,
    DEFAULT_MAX_STUDY_PACKET_BODY_BYTES,
    MAX_STUDY_PACKET_BODY_BYTES,
    "maxTotalBodyBytes",
  );
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  canonicalTimestamp(generatedAt, "generatedAt");
  const evidenceRevision = options.evidenceRevision ?? metrics.corpusRevision;
  if (!/^[a-f0-9]{64}$/u.test(evidenceRevision)) {
    throw new Error("evidenceRevision must be a lowercase SHA-256 digest");
  }
  const after = optionalCanonicalTimestamp(options.after, "after");
  const before = optionalCanonicalTimestamp(options.before, "before");
  if (after.value === null || after.milliseconds === null) throw new Error("after is required");
  if (
    before.milliseconds !== null
    && after.milliseconds >= before.milliseconds
  ) throw new Error("after must be earlier than before");

  const afterMilliseconds = after.milliseconds;
  const beforeMilliseconds = before.milliseconds;
  const ordered = orderedMessages(messages).filter(({ milliseconds }) =>
    milliseconds >= afterMilliseconds
    && (beforeMilliseconds === null || milliseconds < beforeMilliseconds));
  const candidateSet = candidatesFor(
    ordered,
    metrics,
    maximumTextBytes,
    maximumMessagesPerDirection,
  );
  const chronological = [...candidateSet.candidates].sort((left, right) =>
    left.milliseconds - right.milliseconds
    || left.example.id.localeCompare(right.example.id, "en-US"));
  const selected: ResponseCandidate[] = [];
  let emittedBodyBytes = 0;
  for (const candidate of chronological) {
    if (selected.length >= limit) break;
    if (candidate.bodyBytes > maximumBodyBytes - emittedBodyBytes) continue;
    selected.push(candidate);
    emittedBodyBytes += candidate.bodyBytes;
  }
  const caseIds = selected.map(({ example }) => example.id);
  const evaluationId = digest("evaluation", [
    metrics.corpusRevision,
    evidenceRevision,
    metrics.contactId,
    after.value,
    before.value ?? "",
    ...caseIds,
  ]);
  const promptCases = Object.freeze(selected.map(({ example }) => Object.freeze({
    id: example.id,
    startedAt: example.startedAt,
    incoming: Object.freeze(example.messages.filter(({ direction }) => direction === "incoming")),
  })));
  const referenceCases = Object.freeze(selected.map(({ example }) => {
    const outgoing = Object.freeze(example.messages.filter(({ direction }) => direction === "outgoing"));
    return Object.freeze({
      id: example.id,
      startedAt: example.startedAt,
      outgoing,
      shape: Object.freeze({
        bubbles: outgoing.length,
        characters: outgoing.reduce((total, message) => total + characterCount(message.body), 0),
        words: outgoing.reduce((total, message) => total + wordCount(message.body), 0),
        explicitReplyMessages: outgoing.filter(({ explicitReply }) => explicitReply === true).length,
        explicitReplyEligibleMessages: outgoing.filter(({ explicitReply }) => explicitReply !== null).length,
        explicitReplyUnavailableMessages: outgoing.filter(({ explicitReply }) => explicitReply === null).length,
      }),
    });
  }));
  const promptMessages = promptCases.flatMap(({ incoming }) => incoming);
  const evidenceWindow = Object.freeze({ after: after.value, before: before.value });
  const shared = {
    schemaVersion: EVALUATION_PACKET_SCHEMA_VERSION,
    evaluationId,
    generatedAt,
    corpusRevision: metrics.corpusRevision,
    evidenceRevision,
    contactId: metrics.contactId,
    evidenceWindow,
  } as const;
  return Object.freeze({
    prompt: Object.freeze({
      ...shared,
      cases: promptCases,
      selection: Object.freeze({
        algorithm: "temporal-held-out-responses-v1" as const,
        requestedLimit: limit,
        eligibleCandidates: candidateSet.candidates.length,
        emitted: promptCases.length,
      }),
      budget: Object.freeze({
        maxTextBytesPerMessage: maximumTextBytes,
        maxMessagesPerDirectionPerCase: maximumMessagesPerDirection,
        maxTotalBodyBytes: maximumBodyBytes,
        emittedBodyBytes: promptMessages.reduce(
          (total, message) => total + message.emittedBodyBytes,
          0,
        ),
        truncatedMessages: promptMessages.filter(({ bodyTruncated }) => bodyTruncated).length,
      }),
    }),
    reference: Object.freeze({
      ...shared,
      cases: referenceCases,
      notice: "Open only after the candidate drafts for every case are fixed." as const,
    }),
  });
}
