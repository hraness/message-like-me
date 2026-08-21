import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseStyleProfile } from "./profile.ts";
import { contactHandleMatchId, normalizeContactHandle } from "./contacts.ts";
import { LocalStore } from "./store.ts";
import { syntheticProfile, syntheticProfileV2 } from "./test-fixtures.ts";
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

function snapshotWithLaterMessage(revision: string): CorpusSnapshot {
  const base = snapshot(revision);
  return {
    ...base,
    messages: [
      ...base.messages,
      {
        ...base.messages[1]!,
        id: "message_3",
        sourceRowId: 3,
        sourceGuid: "synthetic-guid-3",
        sentAt: "2026-08-21T13:00:00.000Z",
        body: "Fabricated later answer.",
        replyToSourceGuid: null,
      },
    ],
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

function scopedCorpus(
  revision: string,
  options: Readonly<{ relevantAddition?: boolean; unrelatedText?: string }> = {},
): CorpusSnapshot {
  const base = enrichmentCorpus(revision);
  const message = (
    id: string,
    sourceRowId: number,
    conversationId: string,
    sentAt: string,
    direction: "incoming" | "outgoing",
    body: string,
  ): CorpusSnapshot["messages"][number] => ({
    id,
    sourceRowId,
    sourceGuid: `guid-${id}`,
    conversationId,
    sentAt,
    direction,
    body,
    bodySource: "text",
    kind: "text",
    replyToSourceGuid: null,
    editedAt: null,
    retractedAt: null,
    service: "iMessage",
    attachmentCount: 0,
  });
  return {
    ...base,
    messages: [
      message("email-in", 1, "email-conversation", "2026-08-20T10:00:00.000Z", "incoming", "Email question?"),
      message("email-out", 2, "email-conversation", "2026-08-20T10:01:00.000Z", "outgoing", "Email answer."),
      message("sms-in", 3, "sms-email-conversation", "2026-08-20T11:00:00.000Z", "incoming", "SMS question?"),
      message("sms-out", 4, "sms-email-conversation", "2026-08-20T11:01:00.000Z", "outgoing", "SMS answer."),
      ...(options.relevantAddition === true
        ? [message(
          "sms-follow-up",
          5,
          "sms-email-conversation",
          "2026-08-20T11:02:00.000Z",
          "outgoing",
          "Relevant addition.",
        )]
        : []),
      message("phone-in", 20, "phone-conversation", "2026-08-20T12:00:00.000Z", "incoming", "Ambiguous question?"),
      message("phone-out", 21, "phone-conversation", "2026-08-20T12:01:00.000Z", "outgoing", "Separate answer."),
      message("group-in", 30, "group-conversation", "2026-08-20T13:00:00.000Z", "incoming", "Group question?"),
      message(
        "group-out",
        31,
        "group-conversation",
        "2026-08-20T13:01:00.000Z",
        "outgoing",
        options.unrelatedText ?? "Group answer.",
      ),
    ],
  };
}

function createLegacyV1Store(path: string): void {
  const database = new Database(path, { create: true, strict: true });
  const profile = syntheticProfile();
  try {
    database.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
      CREATE TABLE conversations(
        id TEXT PRIMARY KEY,source_key TEXT NOT NULL,private_label TEXT,service TEXT,
        participant_count INTEGER NOT NULL,participant_ids_json TEXT NOT NULL,
        private_participants_json TEXT NOT NULL,is_group INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE messages(
        id TEXT PRIMARY KEY,source_row_id INTEGER NOT NULL,source_guid TEXT NOT NULL,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        sent_at TEXT NOT NULL,direction TEXT NOT NULL,body TEXT,body_source TEXT NOT NULL,
        kind TEXT NOT NULL,reply_to_source_guid TEXT,edited_at TEXT,retracted_at TEXT,
        service TEXT,attachment_count INTEGER NOT NULL,
        UNIQUE(source_row_id,conversation_id)
      ) STRICT;
      CREATE TABLE study_packets(
        sha256 TEXT PRIMARY KEY,contact_id TEXT NOT NULL,corpus_revision TEXT NOT NULL,
        created_at TEXT NOT NULL,private_path TEXT NOT NULL
      ) STRICT;
      CREATE TABLE profiles(
        contact_id TEXT PRIMARY KEY,corpus_revision TEXT NOT NULL,packet_sha256 TEXT NOT NULL,
        analyzed_at TEXT NOT NULL,profile_json TEXT NOT NULL,applied_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE addressbook_contacts(
        id TEXT PRIMARY KEY,private_label TEXT,normalized_label TEXT,label_basis TEXT,
        contacts_revision TEXT NOT NULL
      ) STRICT;
      CREATE TABLE addressbook_handles(
        contact_id TEXT NOT NULL REFERENCES addressbook_contacts(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,match_id TEXT NOT NULL,PRIMARY KEY(contact_id,kind,match_id)
      ) WITHOUT ROWID,STRICT;
      CREATE TABLE conversation_contact_labels(
        conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
        contact_id TEXT NOT NULL REFERENCES addressbook_contacts(id) ON DELETE CASCADE,
        private_label TEXT NOT NULL,normalized_label TEXT NOT NULL,label_basis TEXT NOT NULL,
        contacts_revision TEXT NOT NULL
      ) STRICT;
    `);
    database.query("INSERT INTO metadata(key,value) VALUES ('corpus_revision',?)")
      .run("a".repeat(64));
    database.query(`INSERT INTO conversations VALUES (?,?,?,?,?,?,?,?)`).run(
      "contact_0123456789abcdef",
      "legacy-conversation",
      "Legacy Synthetic Contact",
      "iMessage",
      1,
      '["legacy-participant"]',
      '["legacy@example.test"]',
      0,
    );
    database.query(`INSERT INTO messages VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      "legacy-message",
      1,
      "legacy-guid",
      "contact_0123456789abcdef",
      "2026-08-21T11:00:00.000Z",
      "outgoing",
      "Legacy synthetic prose.",
      "text",
      "text",
      null,
      null,
      null,
      "iMessage",
      0,
    );
    database.query(`INSERT INTO study_packets VALUES (?,?,?,?,?)`).run(
      "b".repeat(64),
      "contact_0123456789abcdef",
      "a".repeat(64),
      "2026-08-21T12:00:00.000Z",
      "/synthetic/private/packet.json",
    );
    database.query(`INSERT INTO profiles VALUES (?,?,?,?,?,?)`).run(
      "contact_0123456789abcdef",
      "a".repeat(64),
      "b".repeat(64),
      "2026-08-21T12:00:00.000Z",
      JSON.stringify(profile),
      "2026-08-21T12:01:00.000Z",
    );
  } finally {
    database.close();
  }
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

function namelessContactsSnapshot(revision: string): ContactsSnapshot {
  const base = contactsSnapshot(revision);
  const email = base.contacts[0]!.handles.find(({ kind }) => kind === "email")!;
  return {
    ...base,
    contacts: [{
      id: "3".repeat(64),
      privateLabel: null,
      privateLabelBasis: null,
      handles: [email],
    }],
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
        scopeKind: "conversation",
        conversationCount: 1,
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
      expect(store.profile(profile.contactId)?.state).toBe("current");
      expect(store.doctor()).toMatchObject({
        storeSchemaVersion: 2,
        quickCheck: "ok",
        foreignKeyViolations: 0,
      });
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
          {
            id: `person_${"1".repeat(64)}`,
            privateLabel: "Synthetic Friend",
          },
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

  test("aggregates conservatively matched email and SMS threads into one person scope", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-person-scope-"));
    const store = LocalStore.open(join(root, "store.sqlite3"));
    const personId = `person_${"1".repeat(64)}`;
    try {
      store.replaceCorpus(
        scopedCorpus("a".repeat(64)),
        "2026-08-21T12:00:00.000Z",
        CONTACTS_TEST_KEY,
      );
      store.enrichContacts(
        contactsSnapshot("e".repeat(64)),
        "2026-08-21T12:01:00.000Z",
        CONTACTS_TEST_KEY,
      );

      expect(store.resolvePrivateContacts("Synthetic Friend", 10)).toEqual([{
        id: personId,
        privateLabel: "Synthetic Friend",
      }]);
      expect(store.conversation(personId, true)).toMatchObject({
        id: personId,
        privateLabel: "Synthetic Friend",
        scopeKind: "person",
        conversationCount: 2,
        group: false,
        participantCount: 1,
        messageCount: 4,
        incomingCount: 2,
        outgoingCount: 2,
      });
      expect(store.conversation("email-conversation", true)?.id).toBe(personId);
      expect(store.contactCorpus(personId)?.messages.map(({ conversationId }) => conversationId))
        .toEqual([
          "email-conversation",
          "email-conversation",
          "sms-email-conversation",
          "sms-email-conversation",
        ]);
      expect(store.contactCorpus("email-conversation")?.messages).toEqual(
        store.contactCorpus(personId)?.messages,
      );

      const summaries = store.listContacts({ privateLabels: true, minimumOutgoing: 1, limit: 10 });
      expect(summaries.find(({ id }) => id === personId)).toMatchObject({
        privateLabel: "Synthetic Friend",
        scopeKind: "person",
        conversationCount: 2,
        messageCount: 4,
        outgoingCount: 2,
      });
      expect(summaries.some(({ id }) => id === "email-conversation")).toBeFalse();
      expect(summaries.some(({ id }) => id === "sms-email-conversation")).toBeFalse();

      // The phone handle belongs to two Contacts records, so it remains an
      // independent conversation instead of being merged into either person.
      expect(summaries.find(({ id }) => id === "phone-conversation")).toMatchObject({
        privateLabel: null,
        messageCount: 2,
      });
      expect(summaries.find(({ id }) => id === "group-conversation")).toMatchObject({
        group: true,
        messageCount: 2,
      });
    } finally {
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("keeps a nameless AddressBook match as one person scope", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-nameless-scope-"));
    const store = LocalStore.open(join(root, "store.sqlite3"));
    const personId = `person_${"3".repeat(64)}`;
    try {
      store.replaceCorpus(
        scopedCorpus("a".repeat(64)),
        "2026-08-21T12:00:00.000Z",
        CONTACTS_TEST_KEY,
      );
      expect(store.enrichContacts(
        namelessContactsSnapshot("e".repeat(64)),
        "2026-08-21T12:01:00.000Z",
        CONTACTS_TEST_KEY,
      )).toMatchObject({ matched: 2, enriched: 0, matchedWithoutLabel: 2 });

      expect(store.resolvePrivateContacts("Synthetic Friend", 10)).toEqual([]);
      expect(store.conversation(personId, true)).toMatchObject({
        id: personId,
        privateLabel: null,
        scopeKind: "person",
        conversationCount: 2,
        messageCount: 4,
      });
      expect(store.contactCorpus("email-conversation")?.messages).toEqual(
        store.contactCorpus(personId)?.messages,
      );
      expect(store.listContacts({ privateLabels: true, minimumOutgoing: 1, limit: 10 })
        .find(({ id }) => id === personId)).toMatchObject({
        privateLabel: null,
        scopeKind: "person",
        conversationCount: 2,
      });
    } finally {
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("binds v2 evidence summaries and citations to the recorded study manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-v2-evidence-"));
    const store = LocalStore.open(join(root, "store.sqlite3"));
    try {
      const corpusRevision = "a".repeat(64);
      store.replaceCorpus(snapshot(corpusRevision), "2026-08-21T12:00:00.000Z");
      const corpus = store.contactCorpus("contact_0123456789abcdef")!;
      const evidence = {
        firstMessageAt: "2026-08-21T11:00:00.000Z",
        lastMessageAt: "2026-08-21T11:01:00.000Z",
        messageCount: 2,
        outgoingTextMessages: 1,
        responseEpisodes: 1,
        studyExamples: 1,
        selectionAlgorithm: "bounded-diverse-response-contexts-v1" as const,
        after: null,
        before: null,
      };
      store.recordStudyPacket({
        sha256: "b".repeat(64),
        contactId: "contact_0123456789abcdef",
        corpusRevision,
        evidenceRevision: corpus.evidenceRevision,
        createdAt: "2026-08-21T12:01:00.000Z",
        privatePath: join(root, "packet.json"),
        exampleIds: ["example_1"],
        evidence,
      });
      const profile = parseStyleProfile(syntheticProfileV2({
        evidence: { evidenceRevision: corpus.evidenceRevision, ...evidence },
      }));
      if (profile.schemaVersion !== 2) throw new Error("Expected a v2 synthetic profile");
      store.applyProfile(profile, "2026-08-21T12:02:00.000Z");
      expect(store.profile(profile.contactId)).toMatchObject({
        state: "current",
        profile: { schemaVersion: 2, evidence: { evidenceRevision: corpus.evidenceRevision } },
      });

      const context = profile.contexts[0]!;
      const claim = profile.claims[0]!;
      for (const candidate of [
        { ...profile, contexts: [{ ...context, evidenceExampleIds: ["unknown-context"] }] },
        { ...profile, claims: [{ ...claim, supportExampleIds: ["unknown-support"] }] },
        { ...profile, claims: [{ ...claim, counterexampleIds: ["unknown-counterexample"] }] },
      ]) {
        expect(() => store.applyProfile(parseStyleProfile(candidate), "2026-08-21T12:03:00.000Z"))
          .toThrow("not present in its recorded packet");
      }
      expect(() => store.applyProfile(parseStyleProfile({
        ...profile,
        evidence: { ...profile.evidence, messageCount: 3 },
      }), "2026-08-21T12:03:00.000Z")).toThrow("summary does not match");
      expect(() => store.applyProfile(parseStyleProfile({
        ...profile,
        evidence: { ...profile.evidence, evidenceRevision: "f".repeat(64) },
      }), "2026-08-21T12:03:00.000Z")).toThrow("revision does not match");
    } finally {
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("keeps bounded v2 evidence current outside its window and stales in-window changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-bounded-evidence-"));
    const store = LocalStore.open(join(root, "store.sqlite3"));
    const contactId = "contact_0123456789abcdef";
    const before = "2026-08-21T12:00:00.000Z";
    try {
      const corpusRevision = "a".repeat(64);
      store.replaceCorpus(snapshot(corpusRevision), "2026-08-21T12:00:00.000Z");
      const corpus = store.contactCorpus(contactId, { after: null, before })!;
      const evidence = {
        firstMessageAt: "2026-08-21T11:00:00.000Z",
        lastMessageAt: "2026-08-21T11:01:00.000Z",
        messageCount: 2,
        outgoingTextMessages: 1,
        responseEpisodes: 1,
        studyExamples: 1,
        selectionAlgorithm: "bounded-diverse-response-contexts-v1" as const,
        after: null,
        before,
      };
      store.recordStudyPacket({
        sha256: "b".repeat(64),
        contactId,
        corpusRevision,
        evidenceRevision: corpus.evidenceRevision,
        createdAt: "2026-08-21T12:01:00.000Z",
        privatePath: join(root, "bounded-packet.json"),
        exampleIds: ["example_1"],
        evidence,
      });
      const profile = parseStyleProfile(syntheticProfileV2({
        evidence: { evidenceRevision: corpus.evidenceRevision, ...evidence },
      }));
      store.applyProfile(profile, "2026-08-21T12:02:00.000Z");

      const originalUnboundedRevision = store.contactCorpus(contactId)!.evidenceRevision;
      store.replaceCorpus(
        snapshotWithLaterMessage("d".repeat(64)),
        "2026-08-21T13:01:00.000Z",
      );
      expect(store.contactCorpus(contactId, { after: null, before })!.evidenceRevision)
        .toBe(corpus.evidenceRevision);
      expect(store.contactCorpus(contactId)!.evidenceRevision).not.toBe(originalUnboundedRevision);
      expect(store.profile(contactId)?.state).toBe("current");
      expect(store.listContacts({ privateLabels: false, minimumOutgoing: 1, limit: 10 })[0]
        ?.profileState).toBe("current");

      const changed = snapshotWithLaterMessage("f".repeat(64));
      store.replaceCorpus({
        ...changed,
        messages: changed.messages.map((message) => message.id === "message_2"
          ? { ...message, body: "Changed inside the study window." }
          : message),
      }, "2026-08-21T13:02:00.000Z");
      expect(store.profile(contactId)?.state).toBe("stale");
      expect(store.listContacts({ privateLabels: false, minimumOutgoing: 1, limit: 10 })[0]
        ?.profileState).toBe("stale");
    } finally {
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("uses inclusive after and exclusive before bounds and rejects noncanonical windows", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-evidence-window-"));
    const store = LocalStore.open(join(root, "store.sqlite3"));
    const contactId = "contact_0123456789abcdef";
    try {
      store.replaceCorpus(snapshot("a".repeat(64)), "2026-08-21T12:00:00.000Z");
      const firstOnly = store.contactCorpus(contactId, {
        after: "2026-08-21T11:00:00.000Z",
        before: "2026-08-21T11:01:00.000Z",
      })!;
      expect(firstOnly.messages.map(({ id }) => id)).toEqual(["message_1"]);
      const secondOnly = store.contactCorpus(contactId, {
        after: "2026-08-21T11:01:00.000Z",
        before: null,
      })!;
      expect(secondOnly.messages.map(({ id }) => id)).toEqual(["message_2"]);

      const boundedAll = store.contactCorpus(contactId, {
        after: null,
        before: "2026-08-21T12:00:00.000Z",
      })!;
      expect(boundedAll.messages).toEqual(store.contactCorpus(contactId)!.messages);
      expect(boundedAll.evidenceRevision).not.toBe(store.contactCorpus(contactId)!.evidenceRevision);
      expect(() => store.contactCorpus(contactId, {
        after: "2026-08-21T11:00:00Z",
        before: null,
      })).toThrow("canonical ISO timestamp");
      expect(() => store.contactCorpus(contactId, {
        after: "2026-08-21T11:01:00.000Z",
        before: "2026-08-21T11:01:00.000Z",
      })).toThrow("must be earlier than before");
      expect(() => store.contactCorpus(contactId, {
        after: "2026-08-21T11:02:00.000Z",
        before: "2026-08-21T11:01:00.000Z",
      })).toThrow("must be earlier than before");
    } finally {
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("hardens the store and live SQLite sidecars to owner-only modes", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-store-modes-"));
    const path = join(root, "store.sqlite3");
    const first = LocalStore.open(path);
    let second: LocalStore | null = null;
    try {
      first.replaceCorpus(snapshot("a".repeat(64)), "2026-08-21T12:00:00.000Z");
      for (const candidate of [path, `${path}-wal`, `${path}-shm`]) await chmod(candidate, 0o644);
      second = LocalStore.open(path);
      for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
        expect((await stat(candidate)).mode & 0o077).toBe(0);
      }
    } finally {
      second?.close();
      first.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("keeps a person profile current across unrelated changes and stales relevant evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-scope-revision-"));
    const store = LocalStore.open(join(root, "store.sqlite3"));
    const personId = `person_${"1".repeat(64)}`;
    try {
      const originalRevision = "a".repeat(64);
      store.replaceCorpus(
        scopedCorpus(originalRevision),
        "2026-08-21T12:00:00.000Z",
        CONTACTS_TEST_KEY,
      );
      store.enrichContacts(
        contactsSnapshot("e".repeat(64)),
        "2026-08-21T12:01:00.000Z",
        CONTACTS_TEST_KEY,
      );
      const evidence = store.contactCorpus(personId)!;
      store.recordStudyPacket({
        sha256: "b".repeat(64),
        contactId: personId,
        corpusRevision: originalRevision,
        evidenceRevision: evidence.evidenceRevision,
        createdAt: "2026-08-21T12:02:00.000Z",
        privatePath: join(root, "person-packet.json"),
      });
      const profile = parseStyleProfile(syntheticProfile({
        contactId: personId,
        corpusRevision: originalRevision,
      }));
      store.applyProfile(profile, "2026-08-21T12:03:00.000Z");
      expect(store.profile(personId)?.state).toBe("current");

      store.replaceCorpus(
        scopedCorpus("d".repeat(64), { unrelatedText: "Changed only in the group." }),
        "2026-08-21T13:00:00.000Z",
        CONTACTS_TEST_KEY,
      );
      expect(store.profile(personId)).toMatchObject({
        state: "current",
        profile: { corpusRevision: originalRevision },
      });
      expect(store.listContacts({ privateLabels: false, minimumOutgoing: 1, limit: 10 })
        .find(({ id }) => id === personId)?.profileState).toBe("current");

      store.replaceCorpus(
        scopedCorpus("f".repeat(64), {
          relevantAddition: true,
          unrelatedText: "Changed only in the group.",
        }),
        "2026-08-21T14:00:00.000Z",
        CONTACTS_TEST_KEY,
      );
      expect(store.profile(personId)?.state).toBe("stale");
      expect(store.listContacts({ privateLabels: false, minimumOutgoing: 1, limit: 10 })
        .find(({ id }) => id === personId)?.profileState).toBe("stale");
    } finally {
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("uses the current person profile through legacy conversation aliases", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-profile-alias-"));
    const store = LocalStore.open(join(root, "store.sqlite3"));
    const personId = `person_${"1".repeat(64)}`;
    const alias = "email-conversation";
    try {
      store.replaceCorpus(
        scopedCorpus("a".repeat(64)),
        "2026-08-21T12:00:00.000Z",
        CONTACTS_TEST_KEY,
      );
      store.enrichContacts(
        contactsSnapshot("e".repeat(64)),
        "2026-08-21T12:01:00.000Z",
        CONTACTS_TEST_KEY,
      );
      const oldEvidence = store.contactCorpus(alias)!;
      store.recordStudyPacket({
        sha256: "b".repeat(64),
        contactId: alias,
        corpusRevision: "a".repeat(64),
        evidenceRevision: oldEvidence.evidenceRevision,
        createdAt: "2026-08-21T12:02:00.000Z",
        privatePath: join(root, "alias-packet.json"),
      });
      store.applyProfile(parseStyleProfile(syntheticProfile({
        contactId: alias,
        corpusRevision: "a".repeat(64),
        packetSha256: "b".repeat(64),
      })), "2026-08-21T12:03:00.000Z");

      store.replaceCorpus(
        scopedCorpus("d".repeat(64), { relevantAddition: true }),
        "2026-08-21T13:00:00.000Z",
        CONTACTS_TEST_KEY,
      );
      expect(store.profile(alias)?.state).toBe("stale");

      const currentEvidence = store.contactCorpus(personId)!;
      store.recordStudyPacket({
        sha256: "f".repeat(64),
        contactId: personId,
        corpusRevision: "d".repeat(64),
        evidenceRevision: currentEvidence.evidenceRevision,
        createdAt: "2026-08-21T13:01:00.000Z",
        privatePath: join(root, "person-packet.json"),
      });
      store.applyProfile(parseStyleProfile(syntheticProfile({
        contactId: personId,
        corpusRevision: "d".repeat(64),
        packetSha256: "f".repeat(64),
      })), "2026-08-21T13:02:00.000Z");

      expect(store.profile(alias)).toMatchObject({
        state: "current",
        profile: { contactId: personId, corpusRevision: "d".repeat(64) },
      });
      expect(store.profile(personId)).toMatchObject({
        state: "current",
        profile: { contactId: personId, corpusRevision: "d".repeat(64) },
      });
    } finally {
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("upgrades an unversioned v0.1 store without losing a current profile", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-v1-upgrade-"));
    const path = join(root, "store.sqlite3");
    createLegacyV1Store(path);
    const store = LocalStore.open(path);
    try {
      expect(store.doctor()).toMatchObject({ storeSchemaVersion: 2, profiles: 1 });
      expect(store.profile("contact_0123456789abcdef")).toMatchObject({
        state: "current",
        profile: { schemaVersion: 1, corpusRevision: "a".repeat(64) },
      });
    } finally {
      store.close();
    }

    const migrated = new Database(path, { strict: true });
    try {
      expect(migrated.query("PRAGMA user_version").get()).toEqual({ user_version: 2 });
      const profileColumns = migrated.query("PRAGMA table_info(profiles)").all() as Array<{ name: string }>;
      expect(profileColumns.map(({ name }) => name)).toContain("scope_id");
      expect(profileColumns.map(({ name }) => name)).toContain("evidence_revision");
      const packetColumns = migrated.query("PRAGMA table_info(study_packets)").all() as Array<{ name: string }>;
      expect(packetColumns.map(({ name }) => name)).toContain("example_ids_json");
      expect(packetColumns.map(({ name }) => name)).toContain("evidence_json");
      expect(migrated.query(`SELECT name FROM sqlite_master
        WHERE type='table' AND name='conversation_contact_scopes'`).get()).toEqual({
        name: "conversation_contact_scopes",
      });
    } finally {
      migrated.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
