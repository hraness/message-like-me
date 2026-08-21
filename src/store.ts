import { Database } from "bun:sqlite";
import { chmodSync, lstatSync } from "node:fs";
import { canonicalJson } from "./canonical-json.ts";
import { CliError } from "./errors.ts";
import type {
  ContactSummary,
  CorpusConversation,
  CorpusMessage,
  CorpusSnapshot,
  StyleProfileV1,
} from "./types.ts";

type Binding = string | number | bigint | Uint8Array | null;
type Row = Record<string, unknown>;

const SCHEMA = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    source_key TEXT NOT NULL,
    private_label TEXT,
    service TEXT,
    participant_count INTEGER NOT NULL CHECK (participant_count >= 0),
    participant_ids_json TEXT NOT NULL,
    private_participants_json TEXT NOT NULL,
    is_group INTEGER NOT NULL CHECK (is_group IN (0, 1))
  ) STRICT;
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    source_row_id INTEGER NOT NULL,
    source_guid TEXT NOT NULL,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sent_at TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
    body TEXT,
    body_source TEXT NOT NULL CHECK (body_source IN ('text', 'attributed-body', 'unavailable')),
    kind TEXT NOT NULL CHECK (kind IN ('text', 'attachment', 'reaction', 'system', 'unknown')),
    reply_to_source_guid TEXT,
    edited_at TEXT,
    retracted_at TEXT,
    service TEXT,
    attachment_count INTEGER NOT NULL CHECK (attachment_count >= 0),
    UNIQUE (source_row_id, conversation_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS messages_conversation_time
    ON messages(conversation_id, sent_at, source_row_id, id);
  CREATE INDEX IF NOT EXISTS messages_source_guid ON messages(source_guid);
  CREATE TABLE IF NOT EXISTS study_packets (
    sha256 TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL,
    corpus_revision TEXT NOT NULL,
    created_at TEXT NOT NULL,
    private_path TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS profiles (
    contact_id TEXT PRIMARY KEY,
    corpus_revision TEXT NOT NULL,
    packet_sha256 TEXT NOT NULL,
    analyzed_at TEXT NOT NULL,
    profile_json TEXT NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT;
`;

function get<T extends Row>(database: Database, sql: string, ...bindings: Binding[]): T | null {
  return database.query(sql).get(...bindings) as T | null;
}

function all<T extends Row>(database: Database, sql: string, ...bindings: Binding[]): T[] {
  return database.query(sql).all(...bindings) as T[];
}

function scalarText(database: Database, key: string): string | null {
  return get<{ value: string }>(database, "SELECT value FROM metadata WHERE key = ?", key)?.value ?? null;
}

function transaction<T>(database: Database, operation: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function readTransaction<T>(database: Database, operation: () => T): T {
  database.exec("BEGIN");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export class LocalStore {
  readonly #database: Database;

  private constructor(database: Database) {
    this.#database = database;
  }

  static open(path: string): LocalStore {
    const existing = (() => {
      try {
        return lstatSync(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    })();
    if (existing?.isSymbolicLink() || (existing !== null && !existing.isFile())) {
      throw new CliError("unsafe-path", `${path} must be a physical regular file`);
    }
    if (
      existing !== null
      && typeof process.getuid === "function"
      && existing.uid !== process.getuid()
    ) {
      throw new CliError("unsafe-path", `${path} is not owned by the current user`);
    }
    const database = new Database(path, { create: true, strict: true });
    database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");
    database.exec(SCHEMA);
    chmodSync(path, 0o600);
    return new LocalStore(database);
  }

  close(): void {
    this.#database.close();
  }

  corpusRevision(): string | null {
    return scalarText(this.#database, "corpus_revision");
  }

  sourceIdentity(): unknown | null {
    const encoded = scalarText(this.#database, "source_identity");
    return encoded === null ? null : JSON.parse(encoded) as unknown;
  }

  replaceCorpus(snapshot: CorpusSnapshot, ingestedAt: string): Readonly<{
    corpusRevision: string;
    conversations: number;
    messages: number;
  }> {
    const corpusRevision = snapshot.source.snapshotSha256;
    if (!/^[a-f0-9]{64}$/u.test(corpusRevision)) {
      throw new CliError("invalid-data", "The iMessage reader returned an invalid corpus revision");
    }
    const conversationIds = new Set(snapshot.conversations.map((conversation) => conversation.id));
    if (conversationIds.size !== snapshot.conversations.length) {
      throw new CliError("invalid-data", "The iMessage reader returned duplicate conversation IDs");
    }
    const messageIds = new Set<string>();
    for (const message of snapshot.messages) {
      if (!conversationIds.has(message.conversationId)) {
        throw new CliError("invalid-data", `Message ${message.id} references an unknown conversation`);
      }
      if (messageIds.has(message.id)) throw new CliError("invalid-data", `Duplicate message ID ${message.id}`);
      messageIds.add(message.id);
    }

    transaction(this.#database, () => {
      this.#database.exec("DELETE FROM messages; DELETE FROM conversations;");
      const insertConversation = this.#database.query(`
        INSERT INTO conversations (
          id, source_key, private_label, service, participant_count,
          participant_ids_json, private_participants_json, is_group
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const conversation of snapshot.conversations) {
        insertConversation.run(
          conversation.id,
          conversation.sourceKey,
          conversation.privateLabel,
          conversation.service,
          conversation.participantCount,
          canonicalJson(conversation.participantIds),
          canonicalJson(conversation.privateParticipants),
          conversation.group ? 1 : 0,
        );
      }
      const insertMessage = this.#database.query(`
        INSERT INTO messages (
          id, source_row_id, source_guid, conversation_id, sent_at, direction,
          body, body_source, kind, reply_to_source_guid, edited_at, retracted_at,
          service, attachment_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const message of snapshot.messages) {
        insertMessage.run(
          message.id,
          message.sourceRowId,
          message.sourceGuid,
          message.conversationId,
          message.sentAt,
          message.direction,
          message.body,
          message.bodySource,
          message.kind,
          message.replyToSourceGuid,
          message.editedAt,
          message.retractedAt,
          message.service,
          message.attachmentCount,
        );
      }
      const setMetadata = this.#database.query(`
        INSERT INTO metadata (key, value) VALUES (?, ?)
        ON CONFLICT (key) DO UPDATE SET value = excluded.value
      `);
      for (const [key, value] of [
        ["corpus_revision", corpusRevision],
        ["source_identity", canonicalJson(snapshot.source)],
        ["ingested_at", ingestedAt],
        ["warnings", canonicalJson(snapshot.warnings)],
        ["corpus_schema_version", String(snapshot.schemaVersion)],
      ] as const) setMetadata.run(key, value);
    });

    return {
      corpusRevision,
      conversations: snapshot.conversations.length,
      messages: snapshot.messages.length,
    };
  }

  listContacts(options: Readonly<{
    privateLabels: boolean;
    minimumOutgoing: number;
    limit: number;
  }>): ContactSummary[] {
    const revision = this.corpusRevision();
    if (revision === null) return [];
    const rows = all<{
      id: string;
      private_label: string | null;
      is_group: number;
      participant_count: number;
      first_message_at: string | null;
      last_message_at: string | null;
      message_count: number;
      incoming_count: number;
      outgoing_count: number;
      profile_revision: string | null;
    }>(this.#database, `
      SELECT conversation.id, conversation.private_label, conversation.is_group,
        conversation.participant_count, min(message.sent_at) AS first_message_at,
        max(message.sent_at) AS last_message_at, count(message.id) AS message_count,
        sum(CASE WHEN message.direction = 'incoming' THEN 1 ELSE 0 END) AS incoming_count,
        sum(CASE WHEN message.direction = 'outgoing' THEN 1 ELSE 0 END) AS outgoing_count,
        profile.corpus_revision AS profile_revision
      FROM conversations conversation
      JOIN messages message ON message.conversation_id = conversation.id
      LEFT JOIN profiles profile ON profile.contact_id = conversation.id
      GROUP BY conversation.id
      HAVING outgoing_count >= ?
      ORDER BY outgoing_count DESC, last_message_at DESC, conversation.id
      LIMIT ?
    `, options.minimumOutgoing, options.limit);
    return rows.map((row) => ({
      id: row.id,
      ...(options.privateLabels ? { privateLabel: row.private_label } : {}),
      group: row.is_group === 1,
      participantCount: row.participant_count,
      firstMessageAt: row.first_message_at,
      lastMessageAt: row.last_message_at,
      messageCount: row.message_count,
      incomingCount: row.incoming_count,
      outgoingCount: row.outgoing_count,
      profileState: row.profile_revision === null
        ? "missing"
        : row.profile_revision === revision ? "current" : "stale",
    }));
  }

  conversation(contactId: string, privateLabels: boolean): (CorpusConversation & {
    firstMessageAt: string | null;
    lastMessageAt: string | null;
    messageCount: number;
    incomingCount: number;
    outgoingCount: number;
  }) | null {
    const row = get<{
      id: string;
      source_key: string;
      private_label: string | null;
      service: string | null;
      participant_count: number;
      participant_ids_json: string;
      private_participants_json: string;
      is_group: number;
      first_message_at: string | null;
      last_message_at: string | null;
      message_count: number;
      incoming_count: number;
      outgoing_count: number;
    }>(this.#database, `
      SELECT conversation.*,
        min(message.sent_at) AS first_message_at,
        max(message.sent_at) AS last_message_at,
        count(message.id) AS message_count,
        sum(CASE WHEN message.direction = 'incoming' THEN 1 ELSE 0 END) AS incoming_count,
        sum(CASE WHEN message.direction = 'outgoing' THEN 1 ELSE 0 END) AS outgoing_count
      FROM conversations conversation
      LEFT JOIN messages message ON message.conversation_id = conversation.id
      WHERE conversation.id = ?
      GROUP BY conversation.id
    `, contactId);
    if (row === null) return null;
    return {
      id: row.id,
      sourceKey: row.source_key,
      privateLabel: privateLabels ? row.private_label : null,
      service: row.service,
      participantCount: row.participant_count,
      participantIds: JSON.parse(row.participant_ids_json) as string[],
      privateParticipants: privateLabels
        ? JSON.parse(row.private_participants_json) as string[]
        : [],
      group: row.is_group === 1,
      firstMessageAt: row.first_message_at,
      lastMessageAt: row.last_message_at,
      messageCount: row.message_count,
      incomingCount: row.incoming_count,
      outgoingCount: row.outgoing_count,
    };
  }

  messages(contactId: string): CorpusMessage[] {
    return all<{
      id: string;
      source_row_id: number;
      source_guid: string;
      conversation_id: string;
      sent_at: string;
      direction: "incoming" | "outgoing";
      body: string | null;
      body_source: "text" | "attributed-body" | "unavailable";
      kind: "text" | "attachment" | "reaction" | "system" | "unknown";
      reply_to_source_guid: string | null;
      edited_at: string | null;
      retracted_at: string | null;
      service: string | null;
      attachment_count: number;
    }>(this.#database, `
      SELECT * FROM messages WHERE conversation_id = ?
      ORDER BY sent_at, source_row_id, id
    `, contactId).map((row) => ({
      id: row.id,
      sourceRowId: row.source_row_id,
      sourceGuid: row.source_guid,
      conversationId: row.conversation_id,
      sentAt: row.sent_at,
      direction: row.direction,
      body: row.body,
      bodySource: row.body_source,
      kind: row.kind,
      replyToSourceGuid: row.reply_to_source_guid,
      editedAt: row.edited_at,
      retractedAt: row.retracted_at,
      service: row.service,
      attachmentCount: row.attachment_count,
    }));
  }

  contactCorpus(contactId: string): Readonly<{
    corpusRevision: string;
    messages: CorpusMessage[];
  }> | null {
    return readTransaction(this.#database, () => {
      // The first read pins a single SQLite snapshot for revision, identity,
      // and bodies even when another process ingests a new corpus concurrently.
      const corpusRevision = scalarText(this.#database, "corpus_revision");
      const contact = get<{ value: number }>(
        this.#database,
        "SELECT 1 AS value FROM conversations WHERE id = ?",
        contactId,
      );
      if (contact === null) return null;
      if (corpusRevision === null) {
        throw new CliError("invalid-data", "Stored conversations have no corpus revision");
      }
      return {
        corpusRevision,
        messages: this.messages(contactId),
      };
    });
  }

  recordStudyPacket(receipt: Readonly<{
    sha256: string;
    contactId: string;
    corpusRevision: string;
    createdAt: string;
    privatePath: string;
  }>): void {
    transaction(this.#database, () => {
      const revision = scalarText(this.#database, "corpus_revision");
      if (revision !== receipt.corpusRevision) {
        throw new CliError(
          "conflict",
          "Corpus changed while the study packet was prepared; prepare it again",
        );
      }
      const contact = get<{ value: number }>(
        this.#database,
        "SELECT 1 AS value FROM conversations WHERE id = ?",
        receipt.contactId,
      );
      if (contact === null) throw new CliError("not-found", `Unknown contact ${receipt.contactId}`);
      this.#database.query(`
        INSERT INTO study_packets (sha256, contact_id, corpus_revision, created_at, private_path)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (sha256) DO UPDATE SET
          contact_id = excluded.contact_id,
          corpus_revision = excluded.corpus_revision,
          created_at = excluded.created_at,
          private_path = excluded.private_path
      `).run(
        receipt.sha256,
        receipt.contactId,
        receipt.corpusRevision,
        receipt.createdAt,
        receipt.privatePath,
      );
    });
  }

  applyProfile(profile: StyleProfileV1, appliedAt: string): void {
    const revision = this.corpusRevision();
    if (revision === null) throw new CliError("conflict", "Ingest iMessage before applying a profile");
    if (profile.corpusRevision !== revision) {
      throw new CliError("conflict", "Profile corpus revision is stale; prepare and analyze a new study packet");
    }
    if (this.conversation(profile.contactId, false) === null) {
      throw new CliError("not-found", `Unknown contact ${profile.contactId}`);
    }
    const packet = get<{ value: number }>(this.#database, `
      SELECT 1 AS value FROM study_packets
      WHERE sha256 = ? AND contact_id = ? AND corpus_revision = ?
    `, profile.packetSha256, profile.contactId, profile.corpusRevision);
    if (packet === null) {
      throw new CliError("conflict", "Profile does not bind a study packet prepared by this installation");
    }
    this.#database.query(`
      INSERT INTO profiles (
        contact_id, corpus_revision, packet_sha256, analyzed_at, profile_json, applied_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (contact_id) DO UPDATE SET
        corpus_revision = excluded.corpus_revision,
        packet_sha256 = excluded.packet_sha256,
        analyzed_at = excluded.analyzed_at,
        profile_json = excluded.profile_json,
        applied_at = excluded.applied_at
    `).run(
      profile.contactId,
      profile.corpusRevision,
      profile.packetSha256,
      profile.analyzedAt,
      canonicalJson(profile),
      appliedAt,
    );
  }

  profile(contactId: string): Readonly<{
    state: "current" | "stale";
    profile: StyleProfileV1;
    appliedAt: string;
  }> | null {
    const row = get<{ corpus_revision: string; profile_json: string; applied_at: string }>(
      this.#database,
      "SELECT corpus_revision, profile_json, applied_at FROM profiles WHERE contact_id = ?",
      contactId,
    );
    if (row === null) return null;
    return {
      state: row.corpus_revision === this.corpusRevision() ? "current" : "stale",
      profile: JSON.parse(row.profile_json) as StyleProfileV1,
      appliedAt: row.applied_at,
    };
  }

  doctor(): Readonly<{
    quickCheck: string;
    foreignKeyViolations: number;
    corpusRevision: string | null;
    conversations: number;
    messages: number;
    profiles: number;
  }> {
    const quick = get<{ quick_check: string }>(this.#database, "PRAGMA quick_check")?.quick_check ?? "unknown";
    const foreignKeys = all<Row>(this.#database, "PRAGMA foreign_key_check").length;
    const count = (table: "conversations" | "messages" | "profiles") =>
      get<{ value: number }>(this.#database, `SELECT count(*) AS value FROM ${table}`)?.value ?? 0;
    return {
      quickCheck: quick,
      foreignKeyViolations: foreignKeys,
      corpusRevision: this.corpusRevision(),
      conversations: count("conversations"),
      messages: count("messages"),
      profiles: count("profiles"),
    };
  }
}
