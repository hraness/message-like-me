import { describe, expect, test } from "bun:test";

import {
  analyzeContact,
  buildEvaluationPackets,
  buildStudyPacket,
  messagesInTimeWindow,
} from "./metrics.ts";
import type { CorpusMessage, MessageKind } from "./types.ts";

const CORPUS_REVISION = "a".repeat(64);
const CONTACT_ID = "contact-7d3a";

function message(
  id: string,
  sourceRowId: number,
  sentAt: string,
  direction: "incoming" | "outgoing",
  body: string | null,
  options: Readonly<{
    kind?: MessageKind;
    replyTo?: string | null;
    attachments?: number;
    retractedAt?: string | null;
    conversationId?: string;
  }> = {},
): CorpusMessage {
  return Object.freeze({
    id,
    sourceRowId,
    sourceGuid: `source-${id}`,
    conversationId: options.conversationId ?? CONTACT_ID,
    sentAt,
    direction,
    body,
    bodySource: body === null ? "unavailable" : "text",
    kind: options.kind ?? (body === null ? "unknown" : "text"),
    replyToSourceGuid: options.replyTo ?? null,
    editedAt: null,
    retractedAt: options.retractedAt ?? null,
    service: "iMessage",
    attachmentCount: options.attachments ?? 0,
  });
}

function studyCorpus(): readonly CorpusMessage[] {
  return Object.freeze([
    message("m01", 1, "2024-02-01T00:00:00.000Z", "incoming", "Are you free? Also where?"),
    message("m02", 2, "2024-02-01T00:00:10.000Z", "incoming", "1. dinner?\n2. movie?"),
    message("r01", 3, "2024-02-01T00:00:15.000Z", "incoming", "Liked a message", {
      kind: "reaction",
    }),
    message("m03", 4, "2024-02-01T00:01:10.000Z", "outgoing", "yeah\nthat works", {
      replyTo: "source-m02",
    }),
    message("m04", 5, "2024-02-01T00:01:30.000Z", "outgoing", "7?"),
    message("r02", 6, "2024-02-01T00:03:00.000Z", "outgoing", "Loved a message", {
      kind: "reaction",
    }),
    message("m05", 7, "2024-02-01T00:10:00.000Z", "incoming", "Bring anything?"),
    message("m06", 8, "2024-02-01T00:11:00.000Z", "outgoing", "nah!"),
    message("m07", 9, "2024-02-01T00:20:00.000Z", "outgoing", "actually snacks"),
    message("m08", 10, "2024-02-01T00:30:00.000Z", "incoming", null, {
      kind: "attachment",
      attachments: 1,
    }),
    message("m09", 11, "2024-02-01T00:31:00.000Z", "outgoing", null, {
      kind: "attachment",
      attachments: 1,
    }),
    message("s01", 12, "2024-02-01T00:32:00.000Z", "incoming", "A participant left", {
      kind: "system",
    }),
    message("m10", 13, "2024-02-01T10:00:00.000Z", "incoming", "Can you send the full version?"),
    message("m11", 14, "2024-02-01T11:01:00.000Z", "outgoing", "x".repeat(300)),
    message("m12", 15, "2024-02-01T11:02:00.000Z", "outgoing", "follow up 😊"),
  ]);
}

function denseResponseCorpus(): readonly CorpusMessage[] {
  return Object.freeze([
    message("d01", 101, "2024-04-01T00:00:00.000Z", "incoming", "drop-one"),
    message("d02", 102, "2024-04-01T00:00:01.000Z", "incoming", "drop-two"),
    message("d03", 103, "2024-04-01T00:00:02.000Z", "incoming", "third"),
    message("d04", 104, "2024-04-01T00:00:03.000Z", "incoming", "🙂🙂🙂"),
    message("d05", 105, "2024-04-01T00:00:10.000Z", "outgoing", "ééé"),
    message("d06", 106, "2024-04-01T00:00:11.000Z", "outgoing", "plain"),
    message("d07", 107, "2024-04-01T00:00:12.000Z", "outgoing", "drop-three"),
    message("d08", 108, "2024-04-01T00:00:13.000Z", "outgoing", "drop-four"),
  ]);
}

describe("analyzeContact", () => {
  test("partitions sessions and bursts and derives inbound-to-outgoing responses", () => {
    const messages = studyCorpus();
    const metrics = analyzeContact(messages, CORPUS_REVISION, CONTACT_ID);

    expect(metrics).toMatchObject({
      contactId: CONTACT_ID,
      corpusRevision: CORPUS_REVISION,
      messageCount: 15,
      incomingCount: 7,
      outgoingCount: 8,
      textMessageCount: 10,
      firstMessageAt: "2024-02-01T00:00:00.000Z",
      lastMessageAt: "2024-02-01T11:02:00.000Z",
    });
    expect(metrics.sessions).toHaveLength(2);
    expect(metrics.sessions[0]).toMatchObject({
      startedAt: "2024-02-01T00:00:00.000Z",
      endedAt: "2024-02-01T00:31:00.000Z",
      messageCount: 11,
      incomingCount: 5,
      outgoingCount: 6,
      startedBy: "incoming",
      endedBy: "outgoing",
    });
    expect(metrics.sessions.reduce((total, session) => total + session.messageCount, 0)).toBe(14);

    expect(metrics.bursts).toHaveLength(9);
    expect(metrics.bursts.reduce((total, burst) => total + burst.messageCount, 0)).toBe(12);
    expect(metrics.bursts[0]).toMatchObject({
      direction: "incoming",
      messageIds: ["m01", "m02"],
      messageCount: 2,
      textMessageCount: 2,
    });
    expect(metrics.bursts[1]).toMatchObject({
      direction: "outgoing",
      messageIds: ["m03", "m04"],
      messageCount: 2,
    });
    expect(metrics.bursts[4]).toMatchObject({
      direction: "outgoing",
      messageIds: ["m07"],
    });
    expect(new Set(metrics.bursts.map(({ sessionId }) => sessionId))).toEqual(
      new Set(metrics.sessions.map(({ id }) => id)),
    );

    expect(metrics.responses).toHaveLength(4);
    expect(metrics.responses[0]).toMatchObject({
      incomingMessageIds: ["m01", "m02"],
      outgoingMessageIds: ["m03", "m04"],
      incomingCount: 2,
      outgoingCount: 2,
      incomingQuestions: 4,
      latencySeconds: 60,
      explicitReplyCount: 1,
    });
    expect(metrics.responses[0]!.tags).toEqual([
      "explicit-reply",
      "fast-response",
      "multi-incoming",
      "multi-item-context",
      "multi-message-response",
      "multi-question",
      "multiline-response",
      "short-response",
    ]);
    expect(metrics.responses[2]).toMatchObject({
      incomingMessageIds: ["m08"],
      outgoingMessageIds: ["m09"],
      incomingCharacters: 0,
      outgoingCharacters: 0,
    });
    expect(metrics.responses[3]!.tags).toContain("delayed-response");
    expect(metrics.responses[3]!.tags).toContain("long-response");

    expect(metrics.tempo).toMatchObject({
      responseEpisodes: 4,
      explicitReplyMessages: 1,
      explicitReplyRatio: 0.166667,
      multiIncomingEpisodes: 1,
      multiQuestionEpisodes: 1,
      outgoingMessagesPerResponse: {
        mean: 1.5,
        median: 1.5,
        p90: 2,
        singleRatio: 0.5,
        multiRatio: 0.5,
      },
    });
    expect(metrics.reactions).toEqual({
      total: 2,
      incoming: 1,
      outgoing: 1,
      unknownDirection: 0,
      dated: 2,
      undated: 0,
      outgoingReactionRatio: 0.125,
      byBody: [{
        body: "unknown",
        total: 2,
        incoming: 1,
        outgoing: 1,
        unknownDirection: 0,
      }],
    });
    expect(analyzeContact(messages, CORPUS_REVISION, CONTACT_ID, { reactionFacts: [] }).reactions)
      .toEqual(metrics.reactions);
    expect(metrics.surface).toMatchObject({
      outgoingTextMessages: 6,
      lowercaseStartsRatio: 0.833333,
      terminalPunctuationRatio: 0.333333,
      questionRatio: 0.166667,
      exclamationRatio: 0.166667,
      emojiMessageRatio: 0.166667,
      multilineRatio: 0.166667,
    });
  });

  test("is deterministic for shuffled input and does not mutate the caller array", () => {
    const ordered = [...studyCorpus()];
    const shuffled = [...ordered].sort((left, right) => right.id.localeCompare(left.id, "en-US"));
    const before = shuffled.map(({ id }) => id);
    const expected = analyzeContact(ordered, CORPUS_REVISION, CONTACT_ID);

    expect(analyzeContact(shuffled, CORPUS_REVISION, CONTACT_ID)).toEqual(expected);
    expect(shuffled.map(({ id }) => id)).toEqual(before);
    expect(() => analyzeContact([...ordered, ordered[0]!], CORPUS_REVISION, CONTACT_ID))
      .toThrow("repeat ID");
  });

  test("never joins sessions, bursts, or responses across conversation boundaries", () => {
    const messages = [
      message("thread-a-in", 1, "2024-06-01T00:00:00.000Z", "incoming", "Question in A?", {
        conversationId: "thread-a",
      }),
      message("thread-b-out", 2, "2024-06-01T00:00:10.000Z", "outgoing", "Unrelated answer in B", {
        conversationId: "thread-b",
      }),
      message("thread-a-out", 3, "2024-06-01T00:01:00.000Z", "outgoing", "Answer in A", {
        conversationId: "thread-a",
      }),
      message("thread-b-in", 4, "2024-06-01T00:02:00.000Z", "incoming", "Question in B?", {
        conversationId: "thread-b",
      }),
    ] as const;

    const metrics = analyzeContact(messages, CORPUS_REVISION, CONTACT_ID);

    expect(metrics.sessions).toHaveLength(2);
    expect(metrics.bursts).toHaveLength(4);
    expect(metrics.responses).toHaveLength(1);
    expect(metrics.responses[0]).toMatchObject({
      incomingMessageIds: ["thread-a-in"],
      outgoingMessageIds: ["thread-a-out"],
      latencySeconds: 60,
    });
    for (const response of metrics.responses) {
      const ids = [...response.incomingMessageIds, ...response.outgoingMessageIds];
      const conversations = new Set(ids.map((id) =>
        messages.find((candidate) => candidate.id === id)!.conversationId));
      expect(conversations.size).toBe(1);
    }
  });

  test("returns well-defined empty distributions and rejects invalid bounds", () => {
    const metrics = analyzeContact([], CORPUS_REVISION, CONTACT_ID);
    expect(metrics.sessions).toEqual([]);
    expect(metrics.bursts).toEqual([]);
    expect(metrics.responses).toEqual([]);
    expect(metrics.tempo.responseLatencySeconds.median).toBeNull();
    expect(metrics.surface.characters).toEqual({ total: 0, mean: 0, median: 0, p90: 0 });
    expect(metrics.reactions).toEqual({
      total: 0,
      incoming: 0,
      outgoing: 0,
      unknownDirection: 0,
      dated: 0,
      undated: 0,
      outgoingReactionRatio: 0,
      byBody: [],
    });
    expect(() => analyzeContact([], CORPUS_REVISION, CONTACT_ID, {
      sessionGapSeconds: 30,
      burstGapSeconds: 31,
    })).toThrow("cannot exceed");
  });

  test("counts undated reaction facts without inventing timeline timestamps", () => {
    const metrics = analyzeContact([
      message("outgoing-text", 1, "2026-08-21T12:00:00.000Z", "outgoing", "ok"),
    ], CORPUS_REVISION, CONTACT_ID, {
      reactionFacts: [
        {
          id: "reaction-in",
          externalId: "external-in",
          targetExternalId: "target-1",
          conversationId: "conversation_1",
          direction: "incoming",
          body: "heart",
          reactedAt: null,
          state: "active",
        },
        {
          id: "reaction-out",
          externalId: "external-out",
          targetExternalId: "target-1",
          conversationId: "conversation_1",
          direction: "outgoing",
          body: "heart",
          reactedAt: null,
          state: "active",
        },
        {
          id: "reaction-unknown",
          externalId: "external-unknown",
          targetExternalId: "target-1",
          conversationId: "conversation_1",
          direction: null,
          body: "question",
          reactedAt: null,
          state: "active",
        },
      ],
    });
    expect(metrics.reactions).toEqual({
      total: 3,
      incoming: 1,
      outgoing: 1,
      unknownDirection: 1,
      dated: 0,
      undated: 3,
      outgoingReactionRatio: 0.5,
      byBody: [
        { body: "heart", total: 2, incoming: 1, outgoing: 1, unknownDirection: 0 },
        { body: "question", total: 1, incoming: 0, outgoing: 0, unknownDirection: 1 },
      ],
    });
  });

  test("excludes retracted and system records from style and tempo evidence", () => {
    const messages = [
      message("eligible-in", 1, "2024-05-01T00:00:00.000Z", "incoming", "Are you coming?"),
      message("retracted-out", 2, "2024-05-01T00:00:10.000Z", "outgoing", "secret draft", {
        replyTo: "source-eligible-in",
        retractedAt: "2024-05-01T00:00:11.000Z",
      }),
      message("system-out", 3, "2024-05-01T00:00:20.000Z", "outgoing", "A system event", {
        kind: "system",
      }),
      message("eligible-out", 4, "2024-05-01T00:00:30.000Z", "outgoing", "yes"),
      message("retracted-reaction", 5, "2024-05-01T00:00:40.000Z", "outgoing", "Loved a message", {
        kind: "reaction",
        retractedAt: "2024-05-01T00:00:41.000Z",
      }),
    ] as const;

    const metrics = analyzeContact(messages, CORPUS_REVISION, CONTACT_ID);

    expect(metrics).toMatchObject({
      messageCount: 5,
      incomingCount: 1,
      outgoingCount: 4,
      textMessageCount: 2,
    });
    expect(metrics.sessions).toHaveLength(1);
    expect(metrics.sessions[0]).toMatchObject({
      messageCount: 2,
      incomingCount: 1,
      outgoingCount: 1,
    });
    expect(metrics.bursts.map(({ messageIds }) => messageIds)).toEqual([
      ["eligible-in"],
      ["eligible-out"],
    ]);
    expect(metrics.responses).toHaveLength(1);
    expect(metrics.responses[0]).toMatchObject({
      incomingMessageIds: ["eligible-in"],
      outgoingMessageIds: ["eligible-out"],
      explicitReplyCount: 0,
    });
    expect(metrics.tempo.explicitReplyMessages).toBe(0);
    expect(metrics.surface).toMatchObject({
      outgoingTextMessages: 1,
      characters: { total: 3 },
    });
    expect(metrics.reactions).toEqual({
      total: 0,
      incoming: 0,
      outgoing: 0,
      unknownDirection: 0,
      dated: 0,
      undated: 0,
      outgoingReactionRatio: 0,
      byBody: [],
    });
  });
});

describe("messagesInTimeWindow", () => {
  test("uses an inclusive after bound, exclusive before bound, and canonical ordering", () => {
    const messages = [
      message("after-before", 4, "2024-06-01T00:00:20.000Z", "outgoing", "excluded before"),
      message("at-after", 2, "2024-06-01T00:00:10.000Z", "incoming", "included after"),
      message("inside", 3, "2024-06-01T00:00:15.000Z", "outgoing", "included inside"),
      message("before-after", 1, "2024-06-01T00:00:05.000Z", "incoming", "excluded after"),
    ] as const;

    const selected = messagesInTimeWindow(messages, {
      after: "2024-06-01T00:00:10.000Z",
      before: "2024-06-01T00:00:20.000Z",
    });

    expect(selected.map(({ id }) => id)).toEqual(["at-after", "inside"]);
    expect(messages.map(({ id }) => id)).toEqual([
      "after-before",
      "at-after",
      "inside",
      "before-after",
    ]);
  });

  test("rejects non-canonical and inverted bounds", () => {
    const messages = studyCorpus();
    expect(() => messagesInTimeWindow(messages, { after: "2024-02-01" }))
      .toThrow("canonical ISO timestamp");
    expect(() => messagesInTimeWindow(messages, {
      after: "2024-02-02T00:00:00.000Z",
      before: "2024-02-01T00:00:00.000Z",
    })).toThrow("after must be earlier than before");
    expect(() => messagesInTimeWindow(messages, {
      after: "2024-02-01T00:00:00.000Z",
      before: "2024-02-01T00:00:00.000Z",
    })).toThrow("after must be earlier than before");
  });
});

describe("buildStudyPacket", () => {
  test("emits v2 evidence provenance without replacing the global corpus revision", () => {
    const evidenceRevision = "b".repeat(64);
    const after = "2024-02-01T00:10:00.000Z";
    const before = "2024-02-01T12:00:00.000Z";
    const selected = messagesInTimeWindow(studyCorpus(), { after, before });
    const metrics = analyzeContact(selected, CORPUS_REVISION, CONTACT_ID);

    const packet = buildStudyPacket(selected, metrics, {
      limit: 3,
      generatedAt: "2024-03-01T00:00:00.000Z",
      evidenceRevision,
      evidenceWindow: { after, before },
    });

    expect(packet).toMatchObject({
      schemaVersion: 2,
      corpusRevision: CORPUS_REVISION,
      evidenceRevision,
      contactId: CONTACT_ID,
      evidenceWindow: { after, before },
      metrics: {
        firstMessageAt: after,
        lastMessageAt: "2024-02-01T11:02:00.000Z",
        messageCount: selected.length,
      },
    });
    expect(Object.hasOwn(packet.metrics, "corpusRevision")).toBeFalse();
    expect(Object.hasOwn(packet.metrics, "evidenceRevision")).toBeFalse();
  });

  test("selects deterministic, diverse, exact response contexts within the bound", () => {
    const messages = studyCorpus();
    const metrics = analyzeContact(messages, CORPUS_REVISION, CONTACT_ID);
    const options = { limit: 2, generatedAt: "2024-03-01T00:00:00.000Z" } as const;
    const packet = buildStudyPacket(messages, metrics, options);
    const reversed = buildStudyPacket([...messages].reverse(), metrics, options);

    expect(reversed).toEqual(packet);
    expect(packet).toMatchObject({
      generatedAt: options.generatedAt,
      corpusRevision: CORPUS_REVISION,
      contactId: CONTACT_ID,
      selection: {
        algorithm: "bounded-diverse-response-contexts-v1",
        requestedLimit: 2,
        responseCandidates: 4,
        eligibleCandidates: 3,
        emitted: 2,
        omittedWithoutBidirectionalText: 1,
        omittedByExampleLimit: 1,
        omittedByTotalBodyBytes: 0,
      },
      budget: {
        maxTextBytesPerMessage: 4096,
        maxMessagesPerDirectionPerExample: 12,
        maxTotalBodyBytes: 262144,
        emittedBodyBytes: 406,
        sourceBodyBytesInEmittedExamples: 406,
        truncatedMessages: 0,
        omittedTextMessagesByDirectionLimit: 0,
        omittedExamplesByTotalBodyBytes: 0,
        omittedExampleBodyBytes: 0,
      },
    });
    expect(packet.metrics).toMatchObject({
      messageCount: 15,
      sessionCount: 2,
      burstCount: 9,
      responseCount: 4,
      tempo: metrics.tempo,
      reactions: metrics.reactions,
      surface: metrics.surface,
    });
    expect(Object.hasOwn(packet.metrics, "sessions")).toBeFalse();
    expect(Object.hasOwn(packet.metrics, "bursts")).toBeFalse();
    expect(Object.hasOwn(packet.metrics, "responses")).toBeFalse();
    expect(Object.hasOwn(packet.metrics, "corpusRevision")).toBeFalse();
    expect(Object.hasOwn(packet.metrics, "contactId")).toBeFalse();
    expect(packet.examples).toHaveLength(2);
    expect(packet.examples[0]!.messages.map(({ id }) => id)).toEqual(["m01", "m02", "m03", "m04"]);
    expect(packet.examples[0]!.messages.map(({ offsetSeconds }) => offsetSeconds)).toEqual([0, 10, 70, 90]);
    expect(packet.examples[0]!.messages[2]).toMatchObject({
      body: "yeah\nthat works",
      direction: "outgoing",
      explicitReply: true,
      sourceBodyBytes: 15,
      emittedBodyBytes: 15,
      bodyTruncated: false,
    });
    expect(packet.examples[0]!.coverage).toEqual({
      source: {
        responseIncomingMessages: 2,
        responseOutgoingMessages: 2,
        eligibleIncomingTextMessages: 2,
        eligibleOutgoingTextMessages: 2,
        bodyBytes: 62,
      },
      emitted: {
        incomingTextMessages: 2,
        outgoingTextMessages: 2,
        bodyBytes: 62,
        truncatedMessages: 0,
      },
      omitted: {
        missingMessages: 0,
        nonTextOrBodylessMessages: 0,
        incomingTextMessagesByDirectionLimit: 0,
        outgoingTextMessagesByDirectionLimit: 0,
      },
    });
    expect(packet.examples.some(({ tags }) => tags.includes("delayed-response"))).toBeTrue();
    expect(JSON.stringify(packet.examples)).not.toContain("Liked a message");
    expect(JSON.stringify(packet.examples)).not.toContain("Loved a message");
    expect(JSON.stringify(packet.examples)).not.toContain("A participant left");
  });

  test("caps UTF-8 text and each direction without splitting code points", () => {
    const messages = denseResponseCorpus();
    const metrics = analyzeContact(messages, CORPUS_REVISION, CONTACT_ID);
    const packet = buildStudyPacket(messages, metrics, {
      limit: 1,
      generatedAt: "2024-04-02T00:00:00.000Z",
      maxTextBytesPerMessage: 5,
      maxMessagesPerDirectionPerExample: 2,
      maxTotalBodyBytes: 100,
    });

    expect(packet.examples).toHaveLength(1);
    const example = packet.examples[0]!;
    expect(example.messages.map(({ id }) => id)).toEqual(["d03", "d04", "d05", "d06"]);
    expect(example.messages.map(({ offsetSeconds }) => offsetSeconds)).toEqual([2, 3, 10, 11]);
    expect(example.messages.map(({ body }) => body)).toEqual(["third", "🙂", "éé", "plain"]);
    expect(example.messages.every(({ emittedBodyBytes }) => emittedBodyBytes <= 5)).toBeTrue();
    expect(example.messages.map(({ bodyTruncated }) => bodyTruncated)).toEqual([
      false,
      true,
      true,
      false,
    ]);
    expect(example.coverage).toEqual({
      source: {
        responseIncomingMessages: 4,
        responseOutgoingMessages: 4,
        eligibleIncomingTextMessages: 4,
        eligibleOutgoingTextMessages: 4,
        bodyBytes: 63,
      },
      emitted: {
        incomingTextMessages: 2,
        outgoingTextMessages: 2,
        bodyBytes: 18,
        truncatedMessages: 2,
      },
      omitted: {
        missingMessages: 0,
        nonTextOrBodylessMessages: 0,
        incomingTextMessagesByDirectionLimit: 2,
        outgoingTextMessagesByDirectionLimit: 2,
      },
    });
    expect(packet.budget).toMatchObject({
      emittedBodyBytes: 18,
      sourceBodyBytesInEmittedExamples: 63,
      truncatedMessages: 2,
      omittedTextMessagesByDirectionLimit: 4,
    });
    const serialized = JSON.stringify(packet);
    expect(serialized).not.toContain("drop-one");
    expect(serialized).not.toContain("drop-four");
    expect(serialized).not.toContain("🙂🙂🙂");
    expect(serialized).not.toContain("ééé");
    expect(serialized).not.toContain("�");
  });

  test("omits whole examples that cannot fit the total body budget", () => {
    const messages = studyCorpus();
    const metrics = analyzeContact(messages, CORPUS_REVISION, CONTACT_ID);
    const options = {
      limit: 2,
      generatedAt: "2024-04-02T00:00:00.000Z",
      maxTextBytesPerMessage: 8,
      maxMessagesPerDirectionPerExample: 2,
      maxTotalBodyBytes: 20,
    } as const;
    const packet = buildStudyPacket(messages, metrics, options);
    const reversed = buildStudyPacket([...messages].reverse(), metrics, options);

    expect(reversed).toEqual(packet);
    expect(packet.examples).toHaveLength(1);
    expect(packet.examples[0]!.messages.map(({ id }) => id)).toEqual(["m05", "m06"]);
    expect(packet.selection).toEqual({
      algorithm: "bounded-diverse-response-contexts-v1",
      requestedLimit: 2,
      responseCandidates: 4,
      eligibleCandidates: 3,
      emitted: 1,
      omittedWithoutBidirectionalText: 1,
      omittedByExampleLimit: 0,
      omittedByTotalBodyBytes: 2,
    });
    expect(packet.budget).toEqual({
      maxTextBytesPerMessage: 8,
      maxMessagesPerDirectionPerExample: 2,
      maxTotalBodyBytes: 20,
      emittedBodyBytes: 12,
      sourceBodyBytesInEmittedExamples: 19,
      truncatedMessages: 1,
      omittedTextMessagesByDirectionLimit: 0,
      omittedExamplesByTotalBodyBytes: 2,
      omittedExampleBodyBytes: 50,
    });
    expect(packet.budget.emittedBodyBytes).toBeLessThanOrEqual(packet.budget.maxTotalBodyBytes);
  });

  test("rejects unbounded limits and non-canonical generated timestamps", () => {
    const messages = studyCorpus();
    const metrics = analyzeContact(messages, CORPUS_REVISION, CONTACT_ID);
    expect(() => buildStudyPacket(messages, metrics, { limit: 51 })).toThrow("1 through 50");
    expect(() => buildStudyPacket(messages, metrics, { generatedAt: "2024-03-01" }))
      .toThrow("canonical ISO timestamp");
    expect(() => buildStudyPacket(messages, metrics, { maxTextBytesPerMessage: 65_537 }))
      .toThrow("maxTextBytesPerMessage");
    expect(() => buildStudyPacket(messages, metrics, {
      maxMessagesPerDirectionPerExample: 65,
    })).toThrow("maxMessagesPerDirectionPerExample");
    expect(() => buildStudyPacket(messages, metrics, { maxTotalBodyBytes: 1_048_577 }))
      .toThrow("maxTotalBodyBytes");
  });
});

describe("buildEvaluationPackets", () => {
  test("separates prompts from references and keeps held-out cases chronological", () => {
    const after = "2024-02-01T00:10:00.000Z";
    const before = "2024-02-01T12:00:00.000Z";
    const evidenceRevision = "b".repeat(64);
    const selected = messagesInTimeWindow(studyCorpus(), { after, before });
    const metrics = analyzeContact(selected, CORPUS_REVISION, CONTACT_ID);
    const options = {
      after,
      before,
      evidenceRevision,
      generatedAt: "2024-03-01T00:00:00.000Z",
      limit: 3,
    } as const;

    const packets = buildEvaluationPackets(selected, metrics, options);
    const reversed = buildEvaluationPackets([...selected].reverse(), metrics, options);
    const fullCorpus = studyCorpus();
    const fromUnfilteredInputs = buildEvaluationPackets(
      fullCorpus,
      analyzeContact(fullCorpus, CORPUS_REVISION, CONTACT_ID),
      options,
    );

    expect(reversed).toEqual(packets);
    const sentAtById = new Map(fullCorpus.map(({ id, sentAt }) => [id, sentAt]));
    expect(fromUnfilteredInputs.prompt.cases.flatMap(({ incoming }) => incoming)
      .every(({ id }) => sentAtById.get(id)! >= after && sentAtById.get(id)! < before)).toBe(true);
    expect(fromUnfilteredInputs.reference.cases.flatMap(({ outgoing }) => outgoing)
      .every(({ id }) => sentAtById.get(id)! >= after && sentAtById.get(id)! < before)).toBe(true);
    expect(packets.prompt).toMatchObject({
      schemaVersion: 1,
      generatedAt: options.generatedAt,
      corpusRevision: CORPUS_REVISION,
      evidenceRevision,
      contactId: CONTACT_ID,
      evidenceWindow: { after, before },
      selection: {
        algorithm: "temporal-held-out-responses-v1",
        requestedLimit: 3,
        eligibleCandidates: 2,
        emitted: 2,
      },
    });
    expect(packets.reference).toMatchObject({
      evaluationId: packets.prompt.evaluationId,
      generatedAt: packets.prompt.generatedAt,
      corpusRevision: packets.prompt.corpusRevision,
      evidenceRevision: packets.prompt.evidenceRevision,
      contactId: packets.prompt.contactId,
      evidenceWindow: packets.prompt.evidenceWindow,
      notice: "Open only after the candidate drafts for every case are fixed.",
    });

    expect(packets.prompt.cases.map(({ startedAt }) => startedAt)).toEqual([
      "2024-02-01T00:10:00.000Z",
      "2024-02-01T10:00:00.000Z",
    ]);
    expect(packets.prompt.cases.map(({ id }) => id)).toEqual(
      packets.reference.cases.map(({ id }) => id),
    );
    expect(packets.prompt.cases.flatMap(({ incoming }) =>
      incoming.map(({ id, direction }) => [id, direction]))).toEqual([
      ["m05", "incoming"],
      ["m10", "incoming"],
    ]);
    expect(packets.reference.cases.flatMap(({ outgoing }) =>
      outgoing.map(({ id, direction }) => [id, direction]))).toEqual([
      ["m06", "outgoing"],
      ["m11", "outgoing"],
      ["m12", "outgoing"],
    ]);
    expect(JSON.stringify(packets.prompt)).not.toContain("nah!");
    expect(JSON.stringify(packets.prompt)).not.toContain("follow up 😊");
    expect(packets.prompt.budget.emittedBodyBytes).toBe(
      packets.prompt.cases.flatMap(({ incoming }) => incoming)
        .reduce((total, item) => total + item.emittedBodyBytes, 0),
    );
    expect(JSON.stringify(packets.reference)).not.toContain("Bring anything?");
    expect(JSON.stringify(packets.reference)).not.toContain("Can you send the full version?");
    expect(packets.reference.cases.map(({ shape }) => shape)).toEqual([
      { bubbles: 1, characters: 4, words: 1, explicitReplyMessages: 0 },
      { bubbles: 2, characters: 311, words: 3, explicitReplyMessages: 0 },
    ]);
  });

  test("rejects invalid temporal and packet bounds", () => {
    const messages = studyCorpus();
    const metrics = analyzeContact(messages, CORPUS_REVISION, CONTACT_ID);
    const base = {
      after: "2024-02-01T00:00:00.000Z",
      generatedAt: "2024-03-01T00:00:00.000Z",
    } as const;

    expect(() => buildEvaluationPackets(messages, metrics, { ...base, limit: 26 }))
      .toThrow("1 through 25");
    expect(() => buildEvaluationPackets(messages, metrics, {
      ...base,
      before: base.after,
    })).toThrow("after must be earlier than before");
    expect(() => buildEvaluationPackets(messages, metrics, {
      ...base,
      after: "2024-02-01",
    })).toThrow("canonical ISO timestamp");
  });
});
