import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseStyleProfile } from "./profile.ts";
import { contactHandleMatchId, normalizeContactHandle } from "./contacts.ts";
import { LocalStore } from "./store.ts";
import { syntheticProfile } from "./test-fixtures.ts";
import type { ContactsSnapshot, CorpusSnapshot } from "./types.ts";

const CONTACTS_TEST_KEY = "synthetic-contacts-store-key-32";

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

function enrichmentCorpus(revision: string): CorpusSnapshot {
  const conversation = (
    id: string,
    participants: readonly string[],
    group: boolean,
    service = "iMessage",
  ): CorpusSnapshot["conversations"][number] => ({
    id,
    sourceKey: `private-${id}`,
    privateLabel: group ? "Synthetic Group" : null,
    service,
    participantCount: participants.length,
    participantIds: participants.map((_value, index) => `participant-${id}-${index}`),
    privateParticipants: participants,
    group,
  });
  return {
    ...snapshot(revision),
    conversations: [
      conversation("email-conversation", ["FRIEND@EXAMPLE.COM"], false),
      conversation("sms-email-conversation", ["friend@example.com"], false, "SMS"),
      conversation("phone-conversation", ["+1 (555) 500-1000"], false),
      conversation("local-phone-conversation", ["5555001000"], false),
      conversation("group-conversation", ["friend@example.com", "+15555001000"], true),
    ],
    messages: [],
  };
}

function contactsSnapshot(revision: string, label = "Synthetic Friend"): ContactsSnapshot {
  const handle = (value: string) => {
    const normalized = normalizeContactHandle(value)!;
    return { ...normalized, matchId: contactHandleMatchId(CONTACTS_TEST_KEY, normalized) };
  };
  return {
    schemaVersion: 1,
    snapshotSha256: revision,
    sources: [{
      physicalPath: "/synthetic/AddressBook-v22.abcddb",
      device: "1",
      inode: "3",
      bytes: 4096,
      modifiedAt: "2026-08-21T11:00:00.000Z",
      schemaSha256: "c".repeat(64),
    }],
    contacts: [
      {
        id: "1".repeat(64),
        privateLabel: label,
        privateLabelBasis: "name-parts",
        handles: [handle("friend@example.com"), handle("+15555001000")],
      },
      {
        id: "2".repeat(64),
        privateLabel: "Synthetic Other",
        privateLabelBasis: "display-name",
        handles: [handle("+15555001000")],
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

  test("converges before or after iMessage, preserves corpus identity, and resolves exact private labels", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-store-contacts-"));
    const beforePath = join(root, "before.sqlite3");
    const afterPath = join(root, "after.sqlite3");
    const before = LocalStore.open(beforePath);
    const after = LocalStore.open(afterPath);
    try {
      const corpusRevision = "a".repeat(64);
      const contactsRevision = "e".repeat(64);
      expect(before.enrichContacts(
        contactsSnapshot(contactsRevision),
        "2026-08-21T12:00:00.000Z",
        CONTACTS_TEST_KEY,
      )).toMatchObject({ directConversations: 0, matched: 0, enriched: 0 });
      before.replaceCorpus(
        enrichmentCorpus(corpusRevision),
        "2026-08-21T12:01:00.000Z",
        CONTACTS_TEST_KEY,
      );

      after.replaceCorpus(
        enrichmentCorpus(corpusRevision),
        "2026-08-21T12:00:00.000Z",
        CONTACTS_TEST_KEY,
      );
      expect(after.enrichContacts(
        contactsSnapshot(contactsRevision),
        "2026-08-21T12:01:00.000Z",
        CONTACTS_TEST_KEY,
      )).toMatchObject({
        directConversations: 4,
        eligibleConversations: 4,
        matched: 2,
        enriched: 2,
        unmatched: 1,
        ambiguous: 1,
        matchedWithoutLabel: 0,
      });

      for (const store of [before, after]) {
        expect(store.conversation("email-conversation", true)?.privateLabel)
          .toBe("Synthetic Friend");
        expect(store.conversation("sms-email-conversation", true)?.privateLabel)
          .toBe("Synthetic Friend");
        expect(store.conversation("phone-conversation", true)?.privateLabel).toBeNull();
        expect(store.conversation("local-phone-conversation", true)?.privateLabel).toBeNull();
        expect(store.conversation("group-conversation", true)?.privateLabel)
          .toBe("Synthetic Group");
        expect(store.resolvePrivateContacts("  SYNTHETIC FRIEND  ", 10)).toEqual([
          { id: "email-conversation", privateLabel: "Synthetic Friend" },
          { id: "sms-email-conversation", privateLabel: "Synthetic Friend" },
        ]);
        expect(store.resolvePrivateContacts("Synthetic", 10)).toEqual([]);
      }

      const revisionBeforeRename = after.corpusRevision();
      after.enrichContacts(
        contactsSnapshot("f".repeat(64), "Synthetic Friend Renamed"),
        "2026-08-21T12:02:00.000Z",
        CONTACTS_TEST_KEY,
      );
      expect(after.corpusRevision()).toBe(revisionBeforeRename);
      expect(after.contactsRevision()).toBe("f".repeat(64));
      expect(after.conversation("email-conversation", true)?.privateLabel)
        .toBe("Synthetic Friend Renamed");
      after.replaceCorpus(
        enrichmentCorpus(corpusRevision),
        "2026-08-21T12:03:00.000Z",
        CONTACTS_TEST_KEY,
      );
      expect(after.conversation("email-conversation", true)?.privateLabel)
        .toBe("Synthetic Friend Renamed");

      const inspection = new Database(afterPath, { readonly: true, strict: true });
      try {
        expect(inspection.query("SELECT match_id FROM addressbook_handles ORDER BY match_id").all())
          .toHaveLength(3);
        expect(inspection.query("SELECT name FROM pragma_table_info('addressbook_handles') ORDER BY cid")
          .all()).not.toContainEqual({ name: "normalized_value" });
      } finally {
        inspection.close();
      }

      const revisionBeforeRemoval = after.corpusRevision();
      expect(after.enrichContacts(
        { ...contactsSnapshot("9".repeat(64)), contacts: [] },
        "2026-08-21T12:04:00.000Z",
        CONTACTS_TEST_KEY,
      )).toMatchObject({ sourceContacts: 0, matched: 0, enriched: 0 });
      expect(after.corpusRevision()).toBe(revisionBeforeRemoval);
      expect(after.conversation("email-conversation", true)?.privateLabel).toBeNull();
      expect(after.resolvePrivateContacts("Synthetic Friend Renamed", 10)).toEqual([]);
    } finally {
      after.close();
      before.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
