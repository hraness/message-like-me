import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseStyleProfile } from "./profile.ts";
import { LocalStore } from "./store.ts";
import { syntheticProfile } from "./test-fixtures.ts";
import type { CorpusSnapshot } from "./types.ts";

function snapshot(revision: string): CorpusSnapshot {
  return {
    schemaVersion: 1,
    source: {
      physicalPath: "/synthetic/chat.db",
      device: "1",
      inode: "2",
      bytes: 1024,
      modifiedAt: "2026-08-21T11:00:00.000Z",
      schemaSha256: "c".repeat(64),
      snapshotSha256: revision,
    },
    conversations: [{
      id: "contact_0123456789abcdef",
      sourceKey: "conversation_abcdef",
      privateLabel: "Synthetic Friend",
      service: "iMessage",
      participantCount: 1,
      participantIds: ["participant_1"],
      privateParticipants: ["+15550001000"],
      group: false,
    }],
    messages: [
      {
        id: "message_1",
        sourceRowId: 1,
        sourceGuid: "synthetic-guid-1",
        conversationId: "contact_0123456789abcdef",
        sentAt: "2026-08-21T11:00:00.000Z",
        direction: "incoming",
        body: "Fabricated question?",
        bodySource: "text",
        kind: "text",
        replyToSourceGuid: null,
        editedAt: null,
        retractedAt: null,
        service: "iMessage",
        attachmentCount: 0,
      },
      {
        id: "message_2",
        sourceRowId: 2,
        sourceGuid: "synthetic-guid-2",
        conversationId: "contact_0123456789abcdef",
        sentAt: "2026-08-21T11:01:00.000Z",
        direction: "outgoing",
        body: "Fabricated answer.",
        bodySource: "text",
        kind: "text",
        replyToSourceGuid: "synthetic-guid-1",
        editedAt: null,
        retractedAt: null,
        service: "iMessage",
        attachmentCount: 0,
      },
    ],
    warnings: [],
  };
}

describe("local corpus store", () => {
  test("keeps bodies private by default and binds profiles to corpus packets", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-store-"));
    const store = LocalStore.open(join(root, "store.sqlite3"));
    try {
      const revision = "a".repeat(64);
      expect(store.replaceCorpus(snapshot(revision), "2026-08-21T12:00:00.000Z")).toEqual({
        corpusRevision: revision,
        conversations: 1,
        messages: 2,
      });
      expect(store.listContacts({ privateLabels: false, minimumOutgoing: 1, limit: 10 })).toEqual([{
        id: "contact_0123456789abcdef",
        group: false,
        participantCount: 1,
        firstMessageAt: "2026-08-21T11:00:00.000Z",
        lastMessageAt: "2026-08-21T11:01:00.000Z",
        messageCount: 2,
        incomingCount: 1,
        outgoingCount: 1,
        profileState: "missing",
      }]);

      const profile = parseStyleProfile(syntheticProfile());
      expect(() => store.applyProfile(profile, "2026-08-21T12:10:00.000Z")).toThrow("study packet");
      store.recordStudyPacket({
        sha256: "b".repeat(64),
        contactId: profile.contactId,
        corpusRevision: revision,
        createdAt: "2026-08-21T12:05:00.000Z",
        privatePath: join(root, "packet.json"),
      });
      store.applyProfile(profile, "2026-08-21T12:10:00.000Z");
      expect(store.profile(profile.contactId)?.state).toBe("current");

      store.replaceCorpus(snapshot("d".repeat(64)), "2026-08-21T13:00:00.000Z");
      expect(store.profile(profile.contactId)?.state).toBe("stale");
      expect(store.doctor()).toMatchObject({ quickCheck: "ok", foreignKeyViolations: 0 });
    } finally {
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects a study receipt when another process replaces its corpus", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-store-race-"));
    const path = join(root, "store.sqlite3");
    const preparingStore = LocalStore.open(path);
    const ingestingStore = LocalStore.open(path);
    try {
      const preparedRevision = "a".repeat(64);
      const replacementRevision = "d".repeat(64);
      preparingStore.replaceCorpus(snapshot(preparedRevision), "2026-08-21T12:00:00.000Z");
      expect(preparingStore.contactCorpus("contact_0123456789abcdef")).toMatchObject({
        corpusRevision: preparedRevision,
        messages: [{ id: "message_1" }, { id: "message_2" }],
      });

      ingestingStore.replaceCorpus(snapshot(replacementRevision), "2026-08-21T12:01:00.000Z");
      expect(() => preparingStore.recordStudyPacket({
        sha256: "e".repeat(64),
        contactId: "contact_0123456789abcdef",
        corpusRevision: preparedRevision,
        createdAt: "2026-08-21T12:02:00.000Z",
        privatePath: join(root, "stale-packet.json"),
      })).toThrow("Corpus changed while the study packet was prepared");

      preparingStore.recordStudyPacket({
        sha256: "f".repeat(64),
        contactId: "contact_0123456789abcdef",
        corpusRevision: replacementRevision,
        createdAt: "2026-08-21T12:03:00.000Z",
        privatePath: join(root, "current-packet.json"),
      });
    } finally {
      ingestingStore.close();
      preparingStore.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
