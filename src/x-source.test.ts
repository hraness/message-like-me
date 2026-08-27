import { describe, expect, test } from "bun:test";

import type { SourceOverlapEvidence } from "./store.ts";
import type { XArchiveEvidence } from "./x-archive.ts";
import {
  normalizeXArchive,
  planXArchiveEquivalence,
  xArchiveMatchesBeeperSource,
} from "./x-source.ts";

const TEST_KEY = "x-archive-normalization-test-key";

function evidence(): XArchiveEvidence {
  return Object.freeze({
    format: "message-like-me.x-archive-evidence",
    version: 1,
    archive: Object.freeze({
      sha256: "a".repeat(64),
      manifestSha256: "b".repeat(64),
      sizeBytes: 12_345,
      declaredSizeBytes: 12_345,
      mtimeNs: "1785585720000000000",
      mtime: "2026-08-01T12:02:00.000Z",
      generationDate: "2026-08-26T03:02:10.221Z",
      isPartialArchive: false,
    }),
    account: Object.freeze({
      providerUserId: "999",
      username: "Owner",
      displayName: "Archive Owner",
      email: "owner@example.test",
      createdAt: "2010-01-01T00:00:00.000Z",
      createdVia: "web",
    }),
    conversations: Object.freeze([Object.freeze({
      conversationId: "999-1002",
      kind: "direct",
      participantIds: Object.freeze(["1002", "999"]),
      events: Object.freeze([
        Object.freeze({
          kind: "message-create",
          id: "8001",
          senderId: "1002",
          recipientId: "999",
          createdAt: "2026-08-01T12:00:00.000Z",
          text: "incoming body",
          urlCount: 0,
          mediaCount: 0,
          editHistory: Object.freeze([]),
          activeReactions: Object.freeze([]),
          replyToMessageId: null,
        }),
        Object.freeze({
          kind: "message-create",
          id: "8002",
          senderId: "999",
          recipientId: "1002",
          createdAt: "2026-08-01T12:01:00.000Z",
          text: "original outgoing body",
          urlCount: 1,
          mediaCount: 1,
          editHistory: Object.freeze([Object.freeze({
            createdAtSec: "1785585720",
            createdAt: "2026-08-01T12:02:00.000Z",
            editedText: "edited outgoing body",
          })]),
          activeReactions: Object.freeze([Object.freeze({
            eventId: "9001",
            senderId: "1002",
            reactionKey: "like",
            createdAt: "2026-08-01T12:03:00.000Z",
          })]),
          replyToMessageId: null,
        }),
      ]),
    })]),
    identityObservations: Object.freeze([Object.freeze({
      kind: "mention",
      providerUserId: "1002",
      username: "Peer",
      displayName: "Synthetic Peer",
      observedAt: "2026-07-01T00:00:00.000Z",
      sourceMember: "data/tweets.js",
      sourceRecord: 1,
      identityRecord: 1,
    })]),
  });
}

function preferredEvidence(
  options: Readonly<{
    handle?: string;
    peerHandle?: string;
    group?: boolean;
    splitConversation?: boolean;
  }> = {},
): SourceOverlapEvidence {
  const sourceId = `source_${"c".repeat(64)}`;
  const firstConversation = `conversation_${"d".repeat(64)}`;
  const secondConversation = options.splitConversation
    ? `conversation_${"e".repeat(64)}`
    : firstConversation;
  const selfParticipantId = "beeper-self";
  const peerParticipantId = "beeper-peer";
  const otherParticipantId = "beeper-other";
  const conversationMetadata = Object.freeze({
    type: options.group ? "group" : "direct",
    participantsComplete: true,
    participantIds: Object.freeze([
      selfParticipantId,
      peerParticipantId,
      ...(options.group ? [otherParticipantId] : []),
    ]),
  });
  return Object.freeze({
    source: Object.freeze({
      id: sourceId,
      kind: "bundle",
      provider: "beeper",
      network: "x",
      accountId: "beeper-account-synthetic",
      externalId: "beeper-account-synthetic",
      identity: Object.freeze({
        account: Object.freeze({
          handle: options.handle ?? "@Owner",
          selfParticipantId,
        }),
      }),
    }),
    conversations: Object.freeze([
      Object.freeze({
        id: firstConversation,
        externalId: "beeper-conversation-one",
        privateLabel: "Synthetic Peer",
        service: "x",
        participantIds: Object.freeze([]),
        privateParticipants: Object.freeze([]),
        group: options.group ?? false,
        metadata: conversationMetadata,
      }),
      ...(options.splitConversation ? [Object.freeze({
        id: secondConversation,
        externalId: "beeper-conversation-two",
        privateLabel: "Other",
        service: "x",
        participantIds: Object.freeze([]),
        privateParticipants: Object.freeze([]),
        group: options.group ?? false,
        metadata: conversationMetadata,
      })] : []),
    ]),
    messages: Object.freeze([
      Object.freeze({
        id: `message_${"1".repeat(64)}`,
        externalId: "beeper-message-incoming",
        conversationId: firstConversation,
        sentAt: "2026-08-01T12:00:00.000Z",
        direction: "incoming",
        body: "incoming body",
        kind: "text",
        replyToExternalId: null,
        replyState: "none",
        attachmentCount: 0,
        attachments: Object.freeze([]),
        metadata: Object.freeze({ senderParticipantId: peerParticipantId }),
      }),
      Object.freeze({
        id: `message_${"2".repeat(64)}`,
        externalId: "beeper-message-outgoing",
        conversationId: secondConversation,
        sentAt: "2026-08-01T12:01:00.000Z",
        direction: "outgoing",
        body: "edited outgoing body",
        kind: "text",
        replyToExternalId: null,
        replyState: "none",
        attachmentCount: 1,
        attachments: Object.freeze([]),
        metadata: Object.freeze({ senderParticipantId: selfParticipantId }),
      }),
    ]),
    reactions: Object.freeze([Object.freeze({
      id: `reaction_${"3".repeat(64)}`,
      externalId: "beeper-reaction",
      targetExternalId: "beeper-message-outgoing",
      conversationId: secondConversation,
      direction: "incoming",
      body: "like",
      reactedAt: null,
    })]),
    auxiliaryRecords: Object.freeze([
      Object.freeze({
        kind: "participant" as const,
        externalId: "beeper-self-provider",
        record: Object.freeze({
          id: selfParticipantId,
          handle: options.handle ?? "Owner",
          isSelf: true,
          network: "x",
        }),
      }),
      Object.freeze({
        kind: "participant" as const,
        externalId: "beeper-peer-provider",
        record: Object.freeze({
          id: peerParticipantId,
          handle: options.peerHandle ?? "Peer",
          isSelf: false,
          network: "x",
        }),
      }),
      ...(options.group ? [Object.freeze({
        kind: "participant" as const,
        externalId: "beeper-other-provider",
        record: Object.freeze({
          id: otherParticipantId,
          handle: "OtherPeer",
          isSelf: false,
          network: "x",
        }),
      })] : []),
    ]),
  });
}

function groupEvidence(): XArchiveEvidence {
  const base = evidence();
  const direct = base.conversations[0]!;
  return Object.freeze({
    ...base,
    conversations: Object.freeze([Object.freeze({
      ...direct,
      conversationId: "7000",
      kind: "group" as const,
      participantIds: Object.freeze(["1002", "1003", "999"]),
      events: Object.freeze(direct.events.map((event) => event.kind === "message-create"
        ? Object.freeze({ ...event, recipientId: null })
        : event)),
    })]),
    identityObservations: Object.freeze([
      ...base.identityObservations,
      Object.freeze({
        ...base.identityObservations[0]!,
        providerUserId: "1003",
        username: "OtherPeer",
        sourceRecord: 2,
      }),
    ]),
  });
}

describe("normalizeXArchive", () => {
  test("retains current prose and bounded metadata while marking replies unavailable", () => {
    const snapshot = normalizeXArchive(evidence(), TEST_KEY);

    expect(snapshot.source).toMatchObject({
      kind: "x-archive",
      provider: "x",
      network: "x",
      generatedAt: "2026-08-26T03:02:10.221Z",
      manifestSha256: "b".repeat(64),
      coverage: { history: "bounded", kind: "complete-produced-official-archive" },
    });
    expect(snapshot.conversations).toMatchObject([{
      privateLabel: "Synthetic Peer",
      group: false,
      participantCount: 1,
    }]);
    expect(snapshot.messages).toHaveLength(2);
    expect(snapshot.messages[1]).toMatchObject({
      body: "edited outgoing body",
      editedAt: "2026-08-01T12:02:00.000Z",
      replyState: "unavailable",
      replyToSourceGuid: null,
      attachmentCount: 1,
    });
    expect(snapshot.reactionFacts).toMatchObject([{
      body: "like",
      reactedAt: "2026-08-01T12:03:00.000Z",
      direction: "incoming",
    }]);
    expect(JSON.stringify(snapshot)).not.toContain(`https:${"/".repeat(2)}`);
  });

  test("builds exact one-to-one Beeper overlap and prefers a dated archive reaction", () => {
    const archive = evidence();
    const snapshot = normalizeXArchive(archive, TEST_KEY);
    const plan = planXArchiveEquivalence(archive, snapshot, preferredEvidence());

    expect(plan.conversations).toHaveLength(1);
    expect(plan.messages).toHaveLength(2);
    expect(plan.reactions).toHaveLength(1);
    expect(plan.reactions![0]).toMatchObject({
      duplicateReactionId: `reaction_${"3".repeat(64)}`,
      preferredReactionId: snapshot.reactionFacts![0]!.id,
    });
    expect(plan.evidenceSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  test("fails closed on account or conversation ambiguity", () => {
    const archive = evidence();
    const snapshot = normalizeXArchive(archive, TEST_KEY);

    expect(() => planXArchiveEquivalence(
      archive,
      snapshot,
      preferredEvidence({ handle: "another_account" }),
    )).toThrow("different exact handles");
    expect(() => planXArchiveEquivalence(
      archive,
      snapshot,
      preferredEvidence({ splitConversation: true }),
    )).toThrow("multiple Beeper conversations");
    expect(xArchiveMatchesBeeperSource(archive, preferredEvidence().source)).toBeTrue();
    expect(xArchiveMatchesBeeperSource(
      archive,
      preferredEvidence({ handle: "another_account" }).source,
    )).toBeFalse();
  });

  test("requires exact direct peer and sender proof", () => {
    const archive = evidence();
    const snapshot = normalizeXArchive(archive, TEST_KEY);

    expect(() => planXArchiveEquivalence(
      archive,
      snapshot,
      preferredEvidence({ peerHandle: "DifferentPeer" }),
    )).toThrow("no unambiguous exact message overlap");

    const wrongSender = preferredEvidence();
    const plan = planXArchiveEquivalence(archive, snapshot, {
      ...wrongSender,
      messages: wrongSender.messages.map((message) => message.direction === "incoming"
        ? {
            ...message,
            metadata: Object.freeze({ senderParticipantId: "beeper-self" }),
          }
        : message),
    });
    expect(plan.messages).toEqual([expect.objectContaining({
      duplicateMessageId: snapshot.messages[1]!.id,
    })]);
  });

  test("does not treat bodyless media coordinates as exact message proof", () => {
    const archive = evidence();
    const bodylessArchive = Object.freeze({
      ...archive,
      conversations: Object.freeze(archive.conversations.map((conversation) => Object.freeze({
        ...conversation,
        events: Object.freeze(conversation.events.map((event) => event.kind === "message-create"
          ? Object.freeze({
              ...event,
              text: null,
              mediaCount: 1,
              editHistory: Object.freeze([]),
              activeReactions: Object.freeze([]),
            })
          : event)),
      }))),
    });
    const snapshot = normalizeXArchive(bodylessArchive, TEST_KEY);
    const preferred = preferredEvidence();
    const bodylessPreferred = Object.freeze({
      ...preferred,
      messages: Object.freeze(preferred.messages.map((message) => Object.freeze({
        ...message,
        body: null,
        kind: "attachment" as const,
        attachmentCount: 1,
      }))),
      reactions: Object.freeze([]),
    });

    expect(() => planXArchiveEquivalence(
      bodylessArchive,
      snapshot,
      bodylessPreferred,
    )).toThrow("no unambiguous exact message overlap");
  });

  test("excludes group overlap without exact roster and per-message actor proof", () => {
    const archive = groupEvidence();
    const snapshot = normalizeXArchive(archive, TEST_KEY);

    expect(() => planXArchiveEquivalence(
      archive,
      snapshot,
      preferredEvidence({ group: true }),
    )).toThrow("no unambiguous exact message overlap");
  });
});
