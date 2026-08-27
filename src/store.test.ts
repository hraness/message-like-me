import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseStyleProfile } from "./profile.ts";
import { contactHandleMatchId, normalizeContactHandle } from "./contacts.ts";
import { analyzeContact } from "./metrics.ts";
import { IMESSAGE_SOURCE_ID, LocalStore } from "./store.ts";
import { syntheticProfile, syntheticProfileV2 } from "./test-fixtures.ts";
import type {
  ContactsSnapshot,
  CorpusMessage,
  CorpusReactionFact,
  CorpusSnapshot,
  SourceCorpusSnapshot,
} from "./types.ts";

const CONTACTS_TEST_KEY = "synthetic-contacts-store-key-32";

function snapshot(revision: string): CorpusSnapshot {
  return {
    schemaVersion: 2,
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
        replyState: "none",
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
        replyState: "explicit",
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
        replyState: "none",
      },
    ],
  };
}

const BUNDLE_SOURCE_ID = `source_${"7".repeat(64)}`;
const BUNDLE_CONVERSATION_ID = "conversation_bundle_synthetic";
const X_BEEPER_SOURCE_ID = `source_${"8".repeat(64)}`;
const X_ARCHIVE_SOURCE_ID = `source_${"9".repeat(64)}`;
const X_BEEPER_CONVERSATION_ID = "conversation_x_beeper_synthetic";
const X_ARCHIVE_CONVERSATION_ID = "conversation_x_archive_synthetic";

function bundleMessage(
  id: string,
  sourceRowId: number,
  sentAt: string,
  kind: CorpusMessage["kind"] = "text",
): CorpusMessage {
  return {
    id: `bundle-message-${id}`,
    sourceRowId,
    sourceGuid: `provider-message-${id}`,
    conversationId: BUNDLE_CONVERSATION_ID,
    sentAt,
    direction: id === "a" ? "incoming" : "outgoing",
    body: kind === "text" ? `Synthetic bundle ${id}.` : null,
    bodySource: kind === "text" ? "text" : "unavailable",
    kind,
    replyToSourceGuid: null,
    replyState: "none",
    editedAt: null,
    retractedAt: null,
    service: "whatsapp",
    attachmentCount: 0,
  };
}

function bundleReaction(state: "active" | "removed" = "active"): CorpusReactionFact {
  return {
    id: "bundle-reaction-r",
    externalId: "provider-reaction-r",
    targetExternalId: "provider-message-a",
    conversationId: BUNDLE_CONVERSATION_ID,
    direction: "outgoing",
    body: "heart",
    reactedAt: null,
    state,
  };
}

function bundleSnapshot(options: Readonly<{
  revision: string;
  generatedAt: string;
  messages: readonly CorpusMessage[];
  reactions?: readonly CorpusReactionFact[];
  history?: "bounded" | "complete-current-local";
  deletions?: SourceCorpusSnapshot["deletions"];
  includeConversation?: boolean;
  providerSortKeys?: Readonly<Record<string, string>>;
}>): SourceCorpusSnapshot {
  const conversations: SourceCorpusSnapshot["conversations"] = options.includeConversation === false
    ? []
    : [{
      id: BUNDLE_CONVERSATION_ID,
      sourceKey: "provider-conversation-bundle",
      privateLabel: "Synthetic Bundle Contact",
      service: "whatsapp",
      participantCount: 1,
      participantIds: ["participant-bundle-peer"],
      privateParticipants: [],
      group: false,
    }];
  return {
    source: {
      id: BUNDLE_SOURCE_ID,
      kind: "bundle",
      provider: "beeper",
      network: "whatsapp",
      accountId: "synthetic-connected-account",
      externalId: "synthetic-connected-account",
      revision: options.revision,
      generatedAt: options.generatedAt,
      producer: { id: "beeper-local", version: "test" },
      coverage: {
        history: options.history ?? "bounded",
        observedFrom: "2026-08-20T10:00:00.000Z",
        observedTo: "2026-08-20T11:00:00.000Z",
        kind: options.history === "complete-current-local" ? "complete-current-local" : "bounded-local",
        reason: null,
      },
      manifestSha256: options.revision,
      identity: { synthetic: true },
      warnings: [],
    },
    conversations,
    conversationProvenance: conversations.map((conversation) => ({
      conversationId: conversation.id,
      externalId: "provider-conversation-bundle",
    })),
    messages: options.messages,
    messageProvenance: options.messages.map((message) => ({
      messageId: message.id,
      externalId: message.sourceGuid,
      providerSortKey: message.kind === "reaction"
        ? null
        : options.providerSortKeys?.[message.id] ?? message.sourceGuid,
      replyToExternalId: message.replyToSourceGuid,
      attachments: [],
    })),
    reactionFacts: options.reactions ?? [],
    deletions: options.deletions ?? [],
  };
}

function xSourceMessage(options: Readonly<{
  id: string;
  conversationId: string;
  sourceGuid: string;
  sentAt: string;
  direction: "incoming" | "outgoing";
  body: string;
  replyState: "explicit" | "none" | "unavailable";
  replyToSourceGuid?: string | null;
}>): CorpusMessage {
  return {
    id: options.id,
    sourceRowId: 1,
    sourceGuid: options.sourceGuid,
    conversationId: options.conversationId,
    sentAt: options.sentAt,
    direction: options.direction,
    body: options.body,
    bodySource: "text",
    kind: "text",
    replyToSourceGuid: options.replyToSourceGuid ?? null,
    replyState: options.replyState,
    editedAt: null,
    retractedAt: null,
    service: "x",
    attachmentCount: 0,
  };
}

function xBeeperSnapshot(extraMessage = false): SourceCorpusSnapshot {
  const messages = [
    xSourceMessage({
      id: "x-beeper-message-overlap",
      conversationId: X_BEEPER_CONVERSATION_ID,
      sourceGuid: "x-beeper-external-overlap",
      sentAt: "2026-08-20T10:00:00.000Z",
      direction: "incoming",
      body: "Synthetic exact overlap.",
      replyState: "none",
    }),
    xSourceMessage({
      id: "x-beeper-message-unique",
      conversationId: X_BEEPER_CONVERSATION_ID,
      sourceGuid: "x-beeper-external-unique",
      sentAt: "2026-08-20T10:01:00.000Z",
      direction: "outgoing",
      body: "Synthetic Beeper-only reply.",
      replyState: "explicit",
      replyToSourceGuid: "x-beeper-external-overlap",
    }),
    ...(extraMessage ? [xSourceMessage({
      id: "x-beeper-message-later",
      conversationId: X_BEEPER_CONVERSATION_ID,
      sourceGuid: "x-beeper-external-later",
      sentAt: "2026-08-20T10:03:00.000Z",
      direction: "outgoing",
      body: "Synthetic later Beeper reply.",
      replyState: "none",
    })] : []),
  ].map((message, index) => ({ ...message, sourceRowId: index + 1 }));
  return {
    source: {
      id: X_BEEPER_SOURCE_ID,
      kind: "bundle",
      provider: "beeper",
      network: "x",
      accountId: "synthetic-beeper-account",
      externalId: "synthetic-beeper-account",
      revision: (extraMessage ? "b" : "a").repeat(64),
      generatedAt: extraMessage ? "2026-08-21T01:00:00.000Z" : "2026-08-21T00:00:00.000Z",
      producer: { id: "beeper-local", version: "test" },
      coverage: {
        history: extraMessage ? "complete-current-local" : "bounded",
        observedFrom: "2026-08-20T10:00:00.000Z",
        observedTo: "2026-08-20T10:03:00.000Z",
      },
      manifestSha256: (extraMessage ? "b" : "a").repeat(64),
      identity: { account: { handle: "@synthetic-self", network: "x" } },
      warnings: [],
    },
    conversations: [{
      id: X_BEEPER_CONVERSATION_ID,
      sourceKey: "x-beeper-conversation",
      privateLabel: "Synthetic X Peer",
      service: "x",
      participantCount: 1,
      participantIds: ["x-beeper-peer"],
      privateParticipants: ["@synthetic-peer"],
      group: false,
    }],
    conversationProvenance: [{
      conversationId: X_BEEPER_CONVERSATION_ID,
      externalId: "x-beeper-conversation-external",
      metadata: { participantsComplete: true },
    }],
    messages,
    messageProvenance: messages.map((message) => ({
      messageId: message.id,
      externalId: message.sourceGuid,
      providerSortKey: message.sourceGuid,
      replyToExternalId: message.replyToSourceGuid,
      attachments: [],
    })),
    reactionFacts: [{
      id: "x-beeper-reaction",
      externalId: "x-beeper-reaction-external",
      targetExternalId: "x-beeper-external-overlap",
      conversationId: X_BEEPER_CONVERSATION_ID,
      direction: "outgoing",
      body: "heart",
      reactedAt: null,
      state: "active",
    }],
    auxiliaryRecords: [
      { kind: "account", id: "self", record: { isSelf: true, handle: "@synthetic-self" } },
      { kind: "participant", id: "peer", record: { isSelf: false, handle: "@synthetic-peer" } },
    ],
  };
}

function xArchiveSnapshot(): SourceCorpusSnapshot {
  const messages = [
    xSourceMessage({
      id: "x-archive-message-overlap",
      conversationId: X_ARCHIVE_CONVERSATION_ID,
      sourceGuid: "x-archive-external-overlap",
      sentAt: "2026-08-20T10:00:00.000Z",
      direction: "incoming",
      body: "Synthetic exact overlap.",
      replyState: "unavailable",
    }),
    xSourceMessage({
      id: "x-archive-message-unique",
      conversationId: X_ARCHIVE_CONVERSATION_ID,
      sourceGuid: "x-archive-external-unique",
      sentAt: "2026-08-20T10:02:00.000Z",
      direction: "outgoing",
      body: "Synthetic archive-only reply.",
      replyState: "unavailable",
    }),
  ].map((message, index) => ({ ...message, sourceRowId: index + 1 }));
  return {
    source: {
      id: X_ARCHIVE_SOURCE_ID,
      kind: "x-archive",
      provider: "x",
      network: "x",
      accountId: "123456789",
      externalId: "123456789",
      revision: "c".repeat(64),
      generatedAt: "2026-08-26T03:02:10.221Z",
      producer: { id: "x-archive", version: "test" },
      coverage: {
        history: "bounded",
        observedFrom: "2026-08-20T10:00:00.000Z",
        observedTo: "2026-08-20T10:02:00.000Z",
      },
      manifestSha256: "c".repeat(64),
      identity: { account: { providerUserId: "123456789", username: "synthetic-self" } },
      warnings: [],
    },
    conversations: [{
      id: X_ARCHIVE_CONVERSATION_ID,
      sourceKey: "x-archive-conversation",
      privateLabel: "Synthetic X Peer Archive",
      service: "x",
      participantCount: 1,
      participantIds: ["x-archive-peer"],
      privateParticipants: ["@synthetic-peer"],
      group: false,
    }],
    conversationProvenance: [{
      conversationId: X_ARCHIVE_CONVERSATION_ID,
      externalId: "x-archive-conversation-external",
    }],
    messages,
    messageProvenance: messages.map((message) => ({
      messageId: message.id,
      externalId: message.sourceGuid,
      providerSortKey: null,
      replyToExternalId: null,
      attachments: [],
    })),
    reactionFacts: [{
      id: "x-archive-reaction",
      externalId: "x-archive-reaction-external",
      targetExternalId: "x-archive-external-overlap",
      conversationId: X_ARCHIVE_CONVERSATION_ID,
      direction: "outgoing",
      body: "heart",
      reactedAt: "2026-08-20T10:00:30.000Z",
      state: "active",
    }],
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
    replyState: "none",
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

function createLegacyV2Store(path: string): void {
  createLegacyV1Store(path);
  const database = new Database(path, { strict: true });
  try {
    database.exec(`
      ALTER TABLE study_packets ADD COLUMN scope_id TEXT;
      ALTER TABLE study_packets ADD COLUMN evidence_revision TEXT;
      ALTER TABLE study_packets ADD COLUMN example_ids_json TEXT;
      ALTER TABLE study_packets ADD COLUMN evidence_json TEXT;
      ALTER TABLE profiles ADD COLUMN scope_id TEXT;
      ALTER TABLE profiles ADD COLUMN evidence_revision TEXT;
      CREATE TABLE conversation_contact_scopes(
        conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
        contact_id TEXT NOT NULL REFERENCES addressbook_contacts(id) ON DELETE CASCADE,
        contacts_revision TEXT NOT NULL
      ) STRICT;
      CREATE INDEX conversation_contact_scopes_lookup
        ON conversation_contact_scopes(contact_id,conversation_id);
      PRAGMA user_version=2;
    `);
  } finally {
    database.close();
  }
}

function createLegacyV3Store(path: string): void {
  createLegacyV2Store(path);
  const database = new Database(path, { strict: true });
  try {
    database.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE corpus_sources(
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('imessage','bundle')),
        provider TEXT NOT NULL,network TEXT,account_id TEXT,external_id TEXT NOT NULL,
        input_revision TEXT NOT NULL,revision TEXT NOT NULL,generated_at TEXT,
        producer_json TEXT NOT NULL,coverage_json TEXT NOT NULL,manifest_sha256 TEXT,
        identity_json TEXT NOT NULL,warnings_json TEXT NOT NULL,ingested_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE conversation_sources(
        conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL REFERENCES corpus_sources(id) ON DELETE RESTRICT,
        external_id TEXT NOT NULL,metadata_json TEXT NOT NULL,
        UNIQUE(source_id,external_id)
      ) STRICT;
      CREATE TABLE message_provenance(
        message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL REFERENCES corpus_sources(id) ON DELETE RESTRICT,
        external_id TEXT NOT NULL,reply_to_external_id TEXT,attachments_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL,UNIQUE(source_id,external_id)
      ) STRICT;
      PRAGMA user_version=3;
    `);
    database.query(`INSERT INTO corpus_sources VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      IMESSAGE_SOURCE_ID,
      "imessage",
      "apple",
      null,
      null,
      "local-imessage",
      "a".repeat(64),
      "a".repeat(64),
      null,
      JSON.stringify({ id: "message-like-me", version: "0.4.0" }),
      JSON.stringify({ history: "complete-current-local", observedFrom: null, observedTo: null }),
      null,
      JSON.stringify({ migrated: false }),
      "[]",
      "2026-08-21T12:00:00.000Z",
    );
    database.query(`INSERT INTO conversation_sources VALUES (?,?,?,?)`).run(
      "contact_0123456789abcdef",
      IMESSAGE_SOURCE_ID,
      "legacy-conversation",
      "{}",
    );
    database.query("UPDATE messages SET reply_to_source_guid=? WHERE id=?")
      .run("legacy-parent-guid", "legacy-message");
    database.query(`INSERT INTO messages VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      "legacy-message-none",
      2,
      "legacy-guid-none",
      "contact_0123456789abcdef",
      "2026-08-21T11:01:00.000Z",
      "incoming",
      "Legacy synthetic question.",
      "text",
      "text",
      null,
      null,
      null,
      "iMessage",
      0,
    );
    const insertProvenance = database.query(`
      INSERT INTO message_provenance VALUES (?,?,?,?,?,?)
    `);
    insertProvenance.run(
      "legacy-message",
      IMESSAGE_SOURCE_ID,
      "legacy-guid",
      "legacy-parent-guid",
      JSON.stringify({ count: 0, detailsAvailable: false }),
      JSON.stringify({ migrated: false }),
    );
    insertProvenance.run(
      "legacy-message-none",
      IMESSAGE_SOURCE_ID,
      "legacy-guid-none",
      null,
      JSON.stringify({ count: 0, detailsAvailable: false }),
      JSON.stringify({ migrated: false }),
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
        storeSchemaVersion: 4,
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
        service: null,
        services: ["SMS", "iMessage"],
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

  test("merges bounded sources, applies explicit suppression, and rejects stale snapshots", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-source-merge-"));
    const store = LocalStore.open(join(root, "store.sqlite3"));
    const a = bundleMessage("a", 1, "2026-08-20T10:00:00.000Z");
    const b = bundleMessage("b", 2, "2026-08-20T10:01:00.000Z");
    try {
      store.replaceCorpus(snapshot("a".repeat(64)), "2026-08-21T12:00:00.000Z");
      const first = bundleSnapshot({
        revision: "1".repeat(64),
        generatedAt: "2026-08-21T12:01:00.000Z",
        messages: [a, b],
        reactions: [bundleReaction()],
      });
      store.replaceSources([first], "2026-08-21T12:01:01.000Z");
      expect(store.listSources()).toHaveLength(2);
      expect(store.contactCorpus(BUNDLE_CONVERSATION_ID)).toMatchObject({
        messages: [{ id: a.id }, { id: b.id }],
        reactions: [{ id: "bundle-reaction-r", reactedAt: null, state: "active" }],
      });

      const retained = store.replaceSources([bundleSnapshot({
        revision: "2".repeat(64),
        generatedAt: "2026-08-21T12:02:00.000Z",
        messages: [a],
        reactions: [bundleReaction()],
      })], "2026-08-21T12:02:01.000Z");
      expect(retained.sources[0]?.changed).toBeFalse();
      expect(store.contactCorpus(BUNDLE_CONVERSATION_ID)?.messages.map(({ id }) => id))
        .toEqual([a.id, b.id]);
      expect(store.source(BUNDLE_SOURCE_ID)).toMatchObject({ conversations: 1, messages: 2 });

      store.replaceSources([bundleSnapshot({
        revision: "3".repeat(64),
        generatedAt: "2026-08-21T12:03:00.000Z",
        messages: [a],
        reactions: [bundleReaction("removed")],
        deletions: [
          {
            entityKind: "message",
            localEntityId: null,
            externalId: b.sourceGuid,
            deletedAt: "2026-08-21T12:03:00.000Z",
            expectedConversationId: BUNDLE_CONVERSATION_ID,
            reason: "tombstone",
          },
          {
            entityKind: "reaction",
            localEntityId: "bundle-reaction-r",
            externalId: "provider-reaction-r",
            deletedAt: "2026-08-21T12:03:00.000Z",
            expectedConversationId: BUNDLE_CONVERSATION_ID,
            reason: "tombstone",
          },
        ],
      })], "2026-08-21T12:03:01.000Z");
      expect(store.contactCorpus(BUNDLE_CONVERSATION_ID)).toMatchObject({
        messages: [{ id: a.id }],
        reactions: [],
      });
      expect(store.source(BUNDLE_SOURCE_ID)).toMatchObject({ conversations: 1, messages: 1 });

      const reappeared = bundleSnapshot({
        revision: "4".repeat(64),
        generatedAt: "2026-08-21T12:04:00.000Z",
        messages: [a, b],
        reactions: [bundleReaction()],
      });
      store.replaceSources([reappeared], "2026-08-21T12:04:01.000Z");
      expect(store.contactCorpus(BUNDLE_CONVERSATION_ID)).toMatchObject({
        messages: [{ id: a.id }, { id: b.id }],
        reactions: [{ id: "bundle-reaction-r", state: "active" }],
      });
      expect(store.source(BUNDLE_SOURCE_ID)).toMatchObject({ conversations: 1, messages: 2 });
      expect(() => store.replaceSources([first], "2026-08-21T12:05:00.000Z"))
        .toThrow("older than stored state");
      expect(() => store.replaceSources([bundleSnapshot({
        ...reappeared,
        revision: "5".repeat(64),
        generatedAt: "2026-08-21T12:04:00.000Z",
        messages: [a, b],
      })], "2026-08-21T12:05:00.000Z")).toThrow("reuses generatedAt");
      expect(store.replaceSources([reappeared], "2026-08-21T12:05:00.000Z").sources[0])
        .toMatchObject({ changed: false, conversations: 1, messages: 2 });
    } finally {
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("groups exact X archive overlap without losing archive-only history on later Beeper ingest", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-x-equivalence-"));
    const store = LocalStore.open(join(root, "store.sqlite3"));
    try {
      store.replaceSources([xBeeperSnapshot()], "2026-08-21T00:01:00.000Z");
      const overlap = store.sourceOverlapEvidence(X_BEEPER_SOURCE_ID);
      expect(overlap.source).toMatchObject({
        kind: "bundle",
        provider: "beeper",
        network: "x",
        identity: { account: { handle: "@synthetic-self", network: "x" } },
      });
      expect(overlap.auxiliaryRecords).toContainEqual({
        kind: "account",
        externalId: "self",
        record: { isSelf: true, handle: "@synthetic-self" },
      });
      expect(() => store.sourceOverlapEvidence(X_BEEPER_SOURCE_ID, 1)).toThrow("record overlap evidence bound");

      const result = store.replaceSources(
        [xArchiveSnapshot()],
        "2026-08-26T04:00:00.000Z",
        undefined,
        {
          duplicateSourceId: X_ARCHIVE_SOURCE_ID,
          preferredSourceId: X_BEEPER_SOURCE_ID,
          basis: "exact-message-overlap",
          evidenceSha256: "d".repeat(64),
          conversations: [{
            duplicateConversationId: X_ARCHIVE_CONVERSATION_ID,
            preferredConversationId: X_BEEPER_CONVERSATION_ID,
          }],
          messages: [{
            duplicateMessageId: "x-archive-message-overlap",
            preferredMessageId: "x-beeper-message-overlap",
          }],
          reactions: [{
            duplicateReactionId: "x-beeper-reaction",
            preferredReactionId: "x-archive-reaction",
          }],
        },
      );
      expect(result.sources).toEqual([{
        id: X_ARCHIVE_SOURCE_ID,
        changed: true,
        conversations: 1,
        messages: 1,
      }]);
      expect(store.listContacts({ privateLabels: false, minimumOutgoing: 1, limit: 10 }))
        .toEqual([expect.objectContaining({
          id: X_BEEPER_CONVERSATION_ID,
          conversationCount: 1,
          messageCount: 3,
          incomingCount: 1,
          outgoingCount: 2,
        })]);
      expect(store.messages(X_ARCHIVE_CONVERSATION_ID).map(({ id, replyState }) => ({ id, replyState })))
        .toEqual([
          { id: "x-beeper-message-overlap", replyState: "none" },
          { id: "x-beeper-message-unique", replyState: "explicit" },
          { id: "x-archive-message-unique", replyState: "unavailable" },
        ]);
      expect(store.conversation(X_ARCHIVE_CONVERSATION_ID, false)).toMatchObject({
        id: X_BEEPER_CONVERSATION_ID,
        conversationCount: 1,
        messageCount: 3,
      });
      expect(store.contactCorpus(X_BEEPER_CONVERSATION_ID)?.reactions).toEqual([{
        id: "x-archive-reaction",
        externalId: "x-archive-reaction-external",
        targetExternalId: "x-archive-external-overlap",
        conversationId: X_ARCHIVE_CONVERSATION_ID,
        direction: "outgoing",
        body: "heart",
        reactedAt: "2026-08-20T10:00:30.000Z",
        state: "active",
      }]);
      expect(store.source(X_ARCHIVE_SOURCE_ID)).toMatchObject({
        kind: "x-archive",
        messages: 1,
        reactions: 1,
      });
      expect(store.source(X_BEEPER_SOURCE_ID)).toMatchObject({ reactions: 0 });

      store.replaceSources([xBeeperSnapshot(true)], "2026-08-21T01:01:00.000Z");
      expect(store.listContacts({ privateLabels: false, minimumOutgoing: 1, limit: 10 }))
        .toEqual([expect.objectContaining({
          id: X_BEEPER_CONVERSATION_ID,
          conversationCount: 1,
          messageCount: 4,
          incomingCount: 1,
          outgoingCount: 3,
        })]);
      expect(store.messages(X_BEEPER_CONVERSATION_ID).map(({ id }) => id)).toEqual([
        "x-beeper-message-overlap",
        "x-beeper-message-unique",
        "x-archive-message-unique",
        "x-beeper-message-later",
      ]);
      expect(store.replaceSources(
        [xBeeperSnapshot(true)],
        "2026-08-21T01:02:00.000Z",
      ).sources[0]?.changed).toBeFalse();
      expect(store.doctor()).toMatchObject({
        quickCheck: "ok",
        foreignKeyViolations: 0,
        messages: 5,
        activeMessages: 4,
        conversationEquivalences: 1,
        messageEquivalences: 1,
        reactionEquivalences: 1,
      });
    } finally {
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("reactivates a reaction when a later source moves its target away from the proven message", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-x-reaction-rebind-"));
    const store = LocalStore.open(join(root, "store.sqlite3"));
    try {
      store.replaceSources([xBeeperSnapshot()], "2026-08-21T00:01:00.000Z");
      store.replaceSources(
        [xArchiveSnapshot()],
        "2026-08-26T04:00:00.000Z",
        undefined,
        {
          duplicateSourceId: X_ARCHIVE_SOURCE_ID,
          preferredSourceId: X_BEEPER_SOURCE_ID,
          basis: "exact-message-overlap",
          evidenceSha256: "d".repeat(64),
          conversations: [{
            duplicateConversationId: X_ARCHIVE_CONVERSATION_ID,
            preferredConversationId: X_BEEPER_CONVERSATION_ID,
          }],
          messages: [{
            duplicateMessageId: "x-archive-message-overlap",
            preferredMessageId: "x-beeper-message-overlap",
          }],
          reactions: [{
            duplicateReactionId: "x-beeper-reaction",
            preferredReactionId: "x-archive-reaction",
          }],
        },
      );
      expect(store.contactCorpus(X_BEEPER_CONVERSATION_ID)?.reactions.map(({ id }) => id))
        .toEqual(["x-archive-reaction"]);

      const retargeted = xBeeperSnapshot(true);
      store.replaceSources([{
        ...retargeted,
        reactionFacts: retargeted.reactionFacts!.map((reaction) => ({
          ...reaction,
          targetExternalId: "x-beeper-external-later",
        })),
      }], "2026-08-21T01:01:00.000Z");
      expect(store.contactCorpus(X_BEEPER_CONVERSATION_ID)?.reactions.map(({ id }) => id).sort())
        .toEqual(["x-archive-reaction", "x-beeper-reaction"]);
    } finally {
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects conversation equivalence without exact message overlap atomically", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-x-equivalence-reject-"));
    const store = LocalStore.open(join(root, "store.sqlite3"));
    try {
      store.replaceSources([xBeeperSnapshot()], "2026-08-21T00:01:00.000Z");
      const archive = xArchiveSnapshot();
      const plan = {
        duplicateSourceId: X_ARCHIVE_SOURCE_ID,
        preferredSourceId: X_BEEPER_SOURCE_ID,
        basis: "exact-message-overlap" as const,
        evidenceSha256: "d".repeat(64),
        conversations: [{
          duplicateConversationId: X_ARCHIVE_CONVERSATION_ID,
          preferredConversationId: X_BEEPER_CONVERSATION_ID,
        }],
        messages: [{
          duplicateMessageId: "x-archive-message-overlap",
          preferredMessageId: "x-beeper-message-overlap",
        }],
      };
      const changed = {
        ...archive,
        messages: archive.messages.map((message) => message.id === "x-archive-message-overlap"
          ? { ...message, body: "Different synthetic body." }
          : message),
      };
      expect(() => store.replaceSources(
        [changed],
        "2026-08-26T04:00:00.000Z",
        undefined,
        plan,
      )).toThrow("lacks an exact preferred-source fingerprint");
      expect(store.source(X_ARCHIVE_SOURCE_ID)).toBeNull();
      const duplicate = {
        ...archive.messages[0]!,
        id: "x-archive-message-ambiguous",
        sourceRowId: 3,
        sourceGuid: "x-archive-external-ambiguous",
      };
      expect(() => store.replaceSources(
        [{
          ...archive,
          messages: [...archive.messages, duplicate],
          messageProvenance: [
            ...archive.messageProvenance,
            {
              messageId: duplicate.id,
              externalId: duplicate.sourceGuid,
              providerSortKey: null,
              replyToExternalId: null,
              attachments: [],
            },
          ],
        }],
        "2026-08-26T04:00:00.000Z",
        undefined,
        plan,
      )).toThrow("ambiguous cross-source fingerprint");
      expect(store.source(X_ARCHIVE_SOURCE_ID)).toBeNull();
      const duplicateReaction = {
        ...archive.reactionFacts![0]!,
        id: "x-archive-reaction-ambiguous",
        externalId: "x-archive-reaction-external-ambiguous",
      };
      expect(() => store.replaceSources(
        [{
          ...archive,
          reactionFacts: [...archive.reactionFacts!, duplicateReaction],
        }],
        "2026-08-26T04:00:00.000Z",
        undefined,
        {
          ...plan,
          reactions: [{
            duplicateReactionId: "x-beeper-reaction",
            preferredReactionId: "x-archive-reaction",
          }],
        },
      )).toThrow("ambiguous actor evidence");
      expect(store.source(X_ARCHIVE_SOURCE_ID)).toBeNull();
      expect(store.doctor()).toMatchObject({ sources: 1, foreignKeyViolations: 0 });
    } finally {
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects group equivalence even when direction, time, and body collide", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-x-group-equivalence-reject-"));
    const store = LocalStore.open(join(root, "store.sqlite3"));
    try {
      const asGroup = (snapshot: SourceCorpusSnapshot): SourceCorpusSnapshot => ({
        ...snapshot,
        conversations: snapshot.conversations.map((conversation) => ({
          ...conversation,
          participantCount: 2,
          participantIds: [...conversation.participantIds, `${conversation.id}-second-peer`],
          group: true,
        })),
      });
      store.replaceSources([asGroup(xBeeperSnapshot())], "2026-08-21T00:01:00.000Z");
      expect(() => store.replaceSources(
        [asGroup(xArchiveSnapshot())],
        "2026-08-26T04:00:00.000Z",
        undefined,
        {
          duplicateSourceId: X_ARCHIVE_SOURCE_ID,
          preferredSourceId: X_BEEPER_SOURCE_ID,
          basis: "exact-message-overlap",
          evidenceSha256: "d".repeat(64),
          conversations: [{
            duplicateConversationId: X_ARCHIVE_CONVERSATION_ID,
            preferredConversationId: X_BEEPER_CONVERSATION_ID,
          }],
          messages: [{
            duplicateMessageId: "x-archive-message-overlap",
            preferredMessageId: "x-beeper-message-overlap",
          }],
        },
      )).toThrow("requires exact direct-peer identity");
      expect(store.source(X_ARCHIVE_SOURCE_ID)).toBeNull();
    } finally {
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("converges provider order across bounded backfill, omission, and replay", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-provider-order-"));
    const incremental = LocalStore.open(join(root, "incremental.sqlite3"));
    const fresh = LocalStore.open(join(root, "fresh.sqlite3"));
    const omitted = LocalStore.open(join(root, "omitted.sqlite3"));
    const sentAt = "2026-08-20T10:00:00.000Z";
    const incoming = bundleMessage("a", 1, sentAt);
    const outgoing = bundleMessage("b", 2, sentAt);
    const first = bundleSnapshot({
      revision: "1".repeat(64),
      generatedAt: "2026-08-21T12:01:00.000Z",
      messages: [outgoing],
      providerSortKeys: { [outgoing.id]: "b" },
    });
    const complete = bundleSnapshot({
      revision: "2".repeat(64),
      generatedAt: "2026-08-21T12:02:00.000Z",
      messages: [incoming, outgoing],
      providerSortKeys: { [incoming.id]: "a", [outgoing.id]: "b" },
    });
    try {
      incremental.replaceSources([first], "2026-08-21T12:01:01.000Z");
      incremental.replaceSources([complete], "2026-08-21T12:02:01.000Z");
      fresh.replaceSources([complete], "2026-08-21T12:02:01.000Z");

      const incrementalCorpus = incremental.contactCorpus(BUNDLE_CONVERSATION_ID)!;
      const freshCorpus = fresh.contactCorpus(BUNDLE_CONVERSATION_ID)!;
      expect(incrementalCorpus.messages.map(({ id }) => id)).toEqual([incoming.id, outgoing.id]);
      expect(incrementalCorpus.messages).toEqual(freshCorpus.messages);
      expect(incrementalCorpus.evidenceRevision).toBe(freshCorpus.evidenceRevision);
      expect(incremental.source(BUNDLE_SOURCE_ID)?.revision)
        .toBe(fresh.source(BUNDLE_SOURCE_ID)?.revision);
      expect(incremental.corpusRevision()).toBe(fresh.corpusRevision());
      expect(analyzeContact(
        incrementalCorpus.messages,
        incrementalCorpus.corpusRevision,
        BUNDLE_CONVERSATION_ID,
        { reactionFacts: incrementalCorpus.reactions },
      ).tempo.responseEpisodes).toBe(1);

      const stableRevision = incremental.corpusRevision();
      expect(incremental.replaceSources([complete], "2026-08-21T12:03:00.000Z").sources[0])
        .toMatchObject({ changed: false, conversations: 1, messages: 2 });
      expect(incremental.corpusRevision()).toBe(stableRevision);

      omitted.replaceSources([first], "2026-08-21T12:01:01.000Z");
      omitted.replaceSources([bundleSnapshot({
        revision: "3".repeat(64),
        generatedAt: "2026-08-21T12:03:00.000Z",
        messages: [incoming],
        providerSortKeys: { [incoming.id]: "a" },
      })], "2026-08-21T12:03:01.000Z");
      const omittedCorpus = omitted.contactCorpus(BUNDLE_CONVERSATION_ID)!;
      expect(omittedCorpus.messages.map(({ id }) => id)).toEqual([incoming.id, outgoing.id]);
      expect(omittedCorpus.messages).toEqual(freshCorpus.messages);
      expect(omittedCorpus.evidenceRevision).toBe(freshCorpus.evidenceRevision);
      expect(omitted.source(BUNDLE_SOURCE_ID)?.revision)
        .toBe(fresh.source(BUNDLE_SOURCE_ID)?.revision);
      expect(omitted.corpusRevision()).toBe(fresh.corpusRevision());
    } finally {
      omitted.close();
      fresh.close();
      incremental.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("clears external-only conversation, message, and reaction tombstones on reappearance", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-external-reappearance-"));
    const incremental = LocalStore.open(join(root, "incremental.sqlite3"));
    const fresh = LocalStore.open(join(root, "fresh.sqlite3"));
    const message = bundleMessage("a", 1, "2026-08-20T10:00:00.000Z");
    const tombstones = bundleSnapshot({
      revision: "1".repeat(64),
      generatedAt: "2026-08-21T12:01:00.000Z",
      includeConversation: false,
      messages: [],
      deletions: [
        {
          entityKind: "conversation",
          localEntityId: null,
          externalId: "provider-conversation-bundle",
          deletedAt: "2026-08-21T12:01:00.000Z",
          reason: "tombstone",
        },
        {
          entityKind: "message",
          localEntityId: null,
          externalId: message.sourceGuid,
          deletedAt: "2026-08-21T12:01:00.000Z",
          reason: "tombstone",
        },
        {
          entityKind: "reaction",
          localEntityId: null,
          externalId: "provider-reaction-r",
          deletedAt: "2026-08-21T12:01:00.000Z",
          reason: "tombstone",
        },
      ],
    });
    const active = bundleSnapshot({
      revision: "2".repeat(64),
      generatedAt: "2026-08-21T12:02:00.000Z",
      messages: [message],
      reactions: [bundleReaction()],
    });
    try {
      incremental.replaceSources([tombstones], "2026-08-21T12:01:01.000Z");
      expect(incremental.source(BUNDLE_SOURCE_ID)).toMatchObject({
        conversations: 0,
        messages: 0,
        reactions: 0,
      });
      incremental.replaceSources([active], "2026-08-21T12:02:01.000Z");
      fresh.replaceSources([active], "2026-08-21T12:02:01.000Z");

      const incrementalCorpus = incremental.contactCorpus(BUNDLE_CONVERSATION_ID)!;
      const freshCorpus = fresh.contactCorpus(BUNDLE_CONVERSATION_ID)!;
      expect(incrementalCorpus).toMatchObject({
        messages: [{ id: message.id }],
        reactions: [{ id: "bundle-reaction-r" }],
      });
      expect(incrementalCorpus.messages).toEqual(freshCorpus.messages);
      expect(incrementalCorpus.reactions).toEqual(freshCorpus.reactions);
      expect(incrementalCorpus.evidenceRevision).toBe(freshCorpus.evidenceRevision);
      expect(incremental.source(BUNDLE_SOURCE_ID)?.revision)
        .toBe(fresh.source(BUNDLE_SOURCE_ID)?.revision);
      expect(incremental.corpusRevision()).toBe(fresh.corpusRevision());
      expect(incremental.replaceSources([active], "2026-08-21T12:03:00.000Z").sources[0]?.changed)
        .toBeFalse();
    } finally {
      fresh.close();
      incremental.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("reports native iMessage reactions consistently with contact metrics", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-imessage-reaction-health-"));
    const store = LocalStore.open(join(root, "store.sqlite3"));
    const base = snapshot("a".repeat(64));
    const reaction: CorpusMessage = {
      ...base.messages[1]!,
      id: "message_reaction",
      sourceRowId: 3,
      sourceGuid: "synthetic-reaction-guid",
      sentAt: "2026-08-21T11:02:00.000Z",
      body: null,
      bodySource: "unavailable",
      kind: "reaction",
      replyToSourceGuid: base.messages[0]!.sourceGuid,
      replyState: "explicit",
    };
    try {
      store.replaceCorpus({ ...base, messages: [...base.messages, reaction] }, "2026-08-21T12:00:00.000Z");
      expect(store.source(IMESSAGE_SOURCE_ID)).toMatchObject({
        conversations: 1,
        messages: 3,
        reactions: 1,
        undatedReactions: 0,
      });
      const corpus = store.contactCorpus(base.conversations[0]!.id)!;
      const metrics = analyzeContact(
        corpus.messages,
        corpus.corpusRevision,
        base.conversations[0]!.id,
        { reactionFacts: corpus.reactions },
      );
      expect(metrics.reactions).toMatchObject({
        total: 1,
        incoming: 0,
        outgoing: 1,
        dated: 1,
        undated: 0,
      });
    } finally {
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("hides source reaction health with a conversation tombstone and restores it on reappearance", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-source-conversation-suppression-"));
    const store = LocalStore.open(join(root, "store.sqlite3"));
    const message = bundleMessage("a", 1, "2026-08-20T10:00:00.000Z");
    try {
      store.replaceSources([bundleSnapshot({
        revision: "1".repeat(64),
        generatedAt: "2026-08-21T12:01:00.000Z",
        messages: [message],
        reactions: [bundleReaction()],
      })], "2026-08-21T12:01:01.000Z");
      expect(store.source(BUNDLE_SOURCE_ID)).toMatchObject({
        conversations: 1,
        messages: 1,
        reactions: 1,
        undatedReactions: 1,
      });

      store.replaceSources([bundleSnapshot({
        revision: "2".repeat(64),
        generatedAt: "2026-08-21T12:02:00.000Z",
        messages: [message],
        reactions: [bundleReaction()],
        deletions: [{
          entityKind: "conversation",
          localEntityId: BUNDLE_CONVERSATION_ID,
          externalId: "provider-conversation-bundle",
          deletedAt: "2026-08-21T12:02:00.000Z",
          reason: "tombstone",
        }],
      })], "2026-08-21T12:02:01.000Z");
      expect(store.source(BUNDLE_SOURCE_ID)).toMatchObject({
        conversations: 0,
        messages: 0,
        reactions: 0,
        undatedReactions: 0,
      });
      expect(store.contactCorpus(BUNDLE_CONVERSATION_ID)).toBeNull();

      store.replaceSources([bundleSnapshot({
        revision: "3".repeat(64),
        generatedAt: "2026-08-21T12:03:00.000Z",
        messages: [message],
        reactions: [bundleReaction()],
      })], "2026-08-21T12:03:01.000Z");
      expect(store.source(BUNDLE_SOURCE_ID)).toMatchObject({
        conversations: 1,
        messages: 1,
        reactions: 1,
        undatedReactions: 1,
      });
      expect(store.contactCorpus(BUNDLE_CONVERSATION_ID)).toMatchObject({
        messages: [{ id: message.id }],
        reactions: [{ id: "bundle-reaction-r" }],
      });
    } finally {
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("authoritative reaction absence and reappearance affect only that source", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-reaction-reappearance-"));
    const store = LocalStore.open(join(root, "store.sqlite3"));
    const a = bundleMessage("a", 1, "2026-08-20T10:00:00.000Z");
    const reactionMessage = {
      ...bundleMessage("reaction-r", 2, "2026-08-20T10:00:30.000Z", "reaction"),
      sourceGuid: "provider-reaction-r",
    };
    const reaction = { ...bundleReaction(), id: reactionMessage.id };
    try {
      store.replaceSources([bundleSnapshot({
        revision: "1".repeat(64),
        generatedAt: "2026-08-21T12:01:00.000Z",
        messages: [a, reactionMessage],
        reactions: [reaction],
        history: "complete-current-local",
      })], "2026-08-21T12:01:01.000Z");
      expect(store.contactCorpus(BUNDLE_CONVERSATION_ID)?.reactions).toHaveLength(1);

      store.replaceSources([bundleSnapshot({
        revision: "2".repeat(64),
        generatedAt: "2026-08-21T12:02:00.000Z",
        messages: [a],
        reactions: [],
        history: "complete-current-local",
      })], "2026-08-21T12:02:01.000Z");
      expect(store.contactCorpus(BUNDLE_CONVERSATION_ID)).toMatchObject({
        messages: [{ id: a.id }],
        reactions: [],
      });

      store.replaceSources([bundleSnapshot({
        revision: "3".repeat(64),
        generatedAt: "2026-08-21T12:03:00.000Z",
        messages: [a, reactionMessage],
        reactions: [reaction],
        history: "complete-current-local",
      })], "2026-08-21T12:03:01.000Z");
      expect(store.contactCorpus(BUNDLE_CONVERSATION_ID)?.reactions).toHaveLength(1);
      expect(store.contactCorpus(BUNDLE_CONVERSATION_ID)?.messages.map(({ id }) => id))
        .toEqual([a.id, reactionMessage.id]);
    } finally {
      store.close();
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
      expect(store.doctor()).toMatchObject({ storeSchemaVersion: 4, profiles: 1 });
      expect(store.profile("contact_0123456789abcdef")).toMatchObject({
        state: "current",
        profile: { schemaVersion: 1, corpusRevision: "a".repeat(64) },
      });
    } finally {
      store.close();
    }

    const migrated = new Database(path, { strict: true });
    try {
      expect(migrated.query("PRAGMA user_version").get()).toEqual({ user_version: 4 });
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

  test("upgrades a populated v0.2 store in place without rebuilding evidence rows", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-v2-upgrade-"));
    const path = join(root, "store.sqlite3");
    createLegacyV2Store(path);
    const store = LocalStore.open(path);
    try {
      expect(store.doctor()).toMatchObject({
        storeSchemaVersion: 4,
        conversations: 1,
        messages: 1,
        profiles: 1,
        sources: 1,
      });
      expect(store.corpusRevision()).toBe("a".repeat(64));
      expect(store.profile("contact_0123456789abcdef")).toMatchObject({
        state: "current",
        profile: { schemaVersion: 1, corpusRevision: "a".repeat(64) },
      });
    } finally {
      store.close();
    }
    const migrated = new Database(path, { readonly: true, strict: true });
    try {
      expect(migrated.query("PRAGMA user_version").get()).toEqual({ user_version: 4 });
      expect(migrated.query("SELECT count(*) AS value FROM conversations").get())
        .toEqual({ value: 1 });
      expect(migrated.query("SELECT count(*) AS value FROM messages").get())
        .toEqual({ value: 1 });
      expect(migrated.query("SELECT count(*) AS value FROM profiles").get())
        .toEqual({ value: 1 });
      expect(migrated.query("SELECT count(*) AS value FROM study_packets").get())
        .toEqual({ value: 1 });
      expect(migrated.query(`SELECT source_id,external_id FROM conversation_sources`).get())
        .toEqual({ source_id: "source_imessage_local", external_id: "legacy-conversation" });
      expect(migrated.query(`SELECT source_id,external_id FROM message_provenance`).get())
        .toEqual({ source_id: "source_imessage_local", external_id: "legacy-guid" });
      expect(migrated.query(`SELECT evidence_revision IS NOT NULL AS value FROM profiles`).get())
        .toEqual({ value: 1 });
      expect(migrated.query(`SELECT evidence_revision IS NOT NULL AS value FROM study_packets`).get())
        .toEqual({ value: 1 });
    } finally {
      migrated.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("upgrades a populated v3 store additively and accepts x-archive through its legacy CHECK", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-v3-upgrade-"));
    const path = join(root, "store.sqlite3");
    createLegacyV3Store(path);
    const store = LocalStore.open(path);
    try {
      expect(store.doctor()).toMatchObject({
        storeSchemaVersion: 4,
        conversations: 1,
        messages: 2,
        sources: 1,
        foreignKeyViolations: 0,
      });
      expect(store.messages("contact_0123456789abcdef").map(({ id, replyState }) => ({
        id,
        replyState,
      }))).toEqual([
        { id: "legacy-message", replyState: "explicit" },
        { id: "legacy-message-none", replyState: "none" },
      ]);
      store.replaceSources([xArchiveSnapshot()], "2026-08-26T04:00:00.000Z");
      expect(store.source(X_ARCHIVE_SOURCE_ID)).toMatchObject({
        kind: "x-archive",
        provider: "x",
        conversations: 1,
        messages: 2,
      });
      expect(store.doctor()).toMatchObject({
        storeSchemaVersion: 4,
        sources: 2,
        foreignKeyViolations: 0,
      });
    } finally {
      store.close();
    }
    const migrated = new Database(path, { readonly: true, strict: true });
    try {
      expect(migrated.query("PRAGMA user_version").get()).toEqual({ user_version: 4 });
      expect(migrated.query(`SELECT kind,kind_v4 FROM corpus_sources WHERE id=?`)
        .get(X_ARCHIVE_SOURCE_ID)).toEqual({ kind: "bundle", kind_v4: "x-archive" });
      expect(migrated.query(`SELECT reply_state,count(*) AS value FROM messages
        WHERE id LIKE 'legacy-message%' GROUP BY reply_state ORDER BY reply_state`).all())
        .toEqual([
          { reply_state: "explicit", value: 1 },
          { reply_state: "none", value: 1 },
        ]);
      expect(migrated.query("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      migrated.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
