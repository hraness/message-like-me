import { Database } from "bun:sqlite";
import {
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fstatSync,
  lstatSync,
  openSync,
} from "node:fs";
import { canonicalJson, sha256 } from "./canonical-json.ts";
import {
  contactHandleMatchId,
  normalizeContactHandle,
  normalizeContactLabelQuery,
} from "./contacts.ts";
import { CliError } from "./errors.ts";
import { parseStyleProfile } from "./profile.ts";
import type {
  ContactsSnapshot,
  ContactSummary,
  CorpusConversation,
  CorpusMessage,
  CorpusSnapshot,
  ProfileEvidenceV2,
  StyleProfile,
  StyleProfileV2,
} from "./types.ts";

type Binding = string | number | bigint | Uint8Array | null;
type Row = Record<string, unknown>;

const STORE_SCHEMA_VERSION = 2;
const PERSON_SCOPE_PREFIX = "person_";

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
    scope_id TEXT,
    evidence_revision TEXT,
    example_ids_json TEXT,
    evidence_json TEXT,
    created_at TEXT NOT NULL,
    private_path TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS study_packets_scope ON study_packets(scope_id, created_at);
  CREATE TABLE IF NOT EXISTS profiles (
    contact_id TEXT PRIMARY KEY,
    corpus_revision TEXT NOT NULL,
    scope_id TEXT,
    evidence_revision TEXT,
    packet_sha256 TEXT NOT NULL,
    analyzed_at TEXT NOT NULL,
    profile_json TEXT NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS profiles_scope ON profiles(scope_id, applied_at);
  CREATE TABLE IF NOT EXISTS addressbook_contacts (
    id TEXT PRIMARY KEY,
    private_label TEXT,
    normalized_label TEXT,
    label_basis TEXT CHECK (label_basis IN ('display-name', 'name-parts', 'organization')),
    contacts_revision TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS addressbook_handles (
    contact_id TEXT NOT NULL REFERENCES addressbook_contacts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('email', 'phone')),
    match_id TEXT NOT NULL,
    PRIMARY KEY (contact_id, kind, match_id)
  ) WITHOUT ROWID, STRICT;
  CREATE INDEX IF NOT EXISTS addressbook_handles_lookup
    ON addressbook_handles(kind, match_id, contact_id);
  CREATE TABLE IF NOT EXISTS conversation_contact_scopes (
    conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
    contact_id TEXT NOT NULL REFERENCES addressbook_contacts(id) ON DELETE CASCADE,
    contacts_revision TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS conversation_contact_scopes_lookup
    ON conversation_contact_scopes(contact_id, conversation_id);
  CREATE TABLE IF NOT EXISTS conversation_contact_labels (
    conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
    contact_id TEXT NOT NULL REFERENCES addressbook_contacts(id) ON DELETE CASCADE,
    private_label TEXT NOT NULL,
    normalized_label TEXT NOT NULL,
    label_basis TEXT NOT NULL CHECK (label_basis IN ('display-name', 'name-parts', 'organization')),
    contacts_revision TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS conversation_contact_labels_lookup
    ON conversation_contact_labels(normalized_label, conversation_id);
`;

const CONTACT_SCOPE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS conversation_contact_scopes (
    conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
    contact_id TEXT NOT NULL REFERENCES addressbook_contacts(id) ON DELETE CASCADE,
    contacts_revision TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS conversation_contact_scopes_lookup
    ON conversation_contact_scopes(contact_id, conversation_id);
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

function stringArray(value: string, label: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch (error) {
    throw new CliError("invalid-data", `${label} is malformed JSON`, { cause: error });
  }
  if (
    !Array.isArray(parsed)
    || parsed.length > 1_000
    || parsed.some((item) => typeof item !== "string" || Buffer.byteLength(item, "utf8") > 4_096)
  ) {
    throw new CliError("invalid-data", `${label} must be a bounded text array`);
  }
  return parsed as string[];
}

type StudyPacketEvidenceManifest = Readonly<Omit<ProfileEvidenceV2, "evidenceRevision">>;

function parsedJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new CliError("invalid-data", `${label} is malformed JSON`, { cause: error });
  }
}

function studyExampleIds(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 50) {
    throw new CliError("invalid-data", `${label} must contain at most 50 IDs`);
  }
  const result = value.map((item, index) => {
    if (
      typeof item !== "string"
      || item.length < 1
      || item !== item.trim()
      || item.includes("\u0000")
      || Buffer.byteLength(item, "utf8") > 1_024
    ) {
      throw new CliError("invalid-data", `${label}[${index}] must be a bounded text ID`);
    }
    return item;
  });
  if (new Set(result).size !== result.length) {
    throw new CliError("invalid-data", `${label} must not contain duplicate IDs`);
  }
  return result;
}

function canonicalTimestampOrNull(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 64) {
    throw new CliError("invalid-data", `${label} must be a canonical ISO timestamp or null`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new CliError("invalid-data", `${label} must be a canonical ISO timestamp or null`);
  }
  return value;
}

function boundedCount(value: unknown, label: string, maximum = 10_000_000): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw new CliError("invalid-data", `${label} must be an integer from 0 through ${maximum}`);
  }
  return value as number;
}

function studyEvidenceManifest(value: unknown, label: string): StudyPacketEvidenceManifest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CliError("invalid-data", `${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const keys = [
    "firstMessageAt",
    "lastMessageAt",
    "messageCount",
    "outgoingTextMessages",
    "responseEpisodes",
    "studyExamples",
    "selectionAlgorithm",
    "after",
    "before",
  ] as const;
  const expected = new Set<string>(keys);
  if (
    Object.keys(record).some((key) => !expected.has(key))
    || keys.some((key) => !(key in record))
  ) {
    throw new CliError("invalid-data", `${label} has unsupported or missing fields`);
  }
  if (record.selectionAlgorithm !== "bounded-diverse-response-contexts-v1") {
    throw new CliError(
      "invalid-data",
      `${label}.selectionAlgorithm must be bounded-diverse-response-contexts-v1`,
    );
  }
  const firstMessageAt = canonicalTimestampOrNull(record.firstMessageAt, `${label}.firstMessageAt`);
  const lastMessageAt = canonicalTimestampOrNull(record.lastMessageAt, `${label}.lastMessageAt`);
  const after = canonicalTimestampOrNull(record.after, `${label}.after`);
  const before = canonicalTimestampOrNull(record.before, `${label}.before`);
  if (firstMessageAt !== null && lastMessageAt !== null && firstMessageAt > lastMessageAt) {
    throw new CliError("invalid-data", `${label}.firstMessageAt must not follow lastMessageAt`);
  }
  if (after !== null && before !== null && after >= before) {
    throw new CliError("invalid-data", `${label}.after must be earlier than before`);
  }
  const messageCount = boundedCount(record.messageCount, `${label}.messageCount`);
  const outgoingTextMessages = boundedCount(
    record.outgoingTextMessages,
    `${label}.outgoingTextMessages`,
  );
  if (outgoingTextMessages > messageCount) {
    throw new CliError("invalid-data", `${label}.outgoingTextMessages exceeds messageCount`);
  }
  return Object.freeze({
    firstMessageAt,
    lastMessageAt,
    messageCount,
    outgoingTextMessages,
    responseEpisodes: boundedCount(record.responseEpisodes, `${label}.responseEpisodes`),
    studyExamples: boundedCount(record.studyExamples, `${label}.studyExamples`, 50),
    selectionAlgorithm: "bounded-diverse-response-contexts-v1",
    after,
    before,
  });
}

function profileEvidenceManifest(profile: StyleProfileV2): StudyPacketEvidenceManifest {
  return {
    firstMessageAt: profile.evidence.firstMessageAt,
    lastMessageAt: profile.evidence.lastMessageAt,
    messageCount: profile.evidence.messageCount,
    outgoingTextMessages: profile.evidence.outgoingTextMessages,
    responseEpisodes: profile.evidence.responseEpisodes,
    studyExamples: profile.evidence.studyExamples,
    selectionAlgorithm: profile.evidence.selectionAlgorithm,
    after: profile.evidence.after,
    before: profile.evidence.before,
  };
}

function assertProfileEvidenceIds(profile: StyleProfileV2, exampleIds: ReadonlySet<string>): void {
  const references = [
    ...profile.contexts.flatMap(({ evidenceExampleIds }) => evidenceExampleIds),
    ...profile.claims.flatMap(({ supportExampleIds, counterexampleIds }) => [
      ...supportExampleIds,
      ...counterexampleIds,
    ]),
  ];
  const unknown = references.find((id) => !exampleIds.has(id));
  if (unknown !== undefined) {
    throw new CliError(
      "conflict",
      `Profile cites study example ${unknown} that is not present in its recorded packet`,
    );
  }
}

type AnalysisScope = Readonly<{
  id: string;
  kind: "person" | "conversation";
  addressBookContactId: string | null;
  conversationIds: readonly string[];
}>;

type EvidenceWindow = Readonly<{
  after: string | null;
  before: string | null;
}>;

const UNBOUNDED_EVIDENCE_WINDOW: EvidenceWindow = Object.freeze({
  after: null,
  before: null,
});

function evidenceWindow(value: unknown, label: string): EvidenceWindow {
  if (value === undefined) return UNBOUNDED_EVIDENCE_WINDOW;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CliError("invalid-data", `${label} must contain after and before bounds`);
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => key !== "after" && key !== "before")
    || !("after" in record)
    || !("before" in record)
  ) {
    throw new CliError("invalid-data", `${label} must contain only after and before bounds`);
  }
  const after = canonicalTimestampOrNull(record.after, `${label}.after`);
  const before = canonicalTimestampOrNull(record.before, `${label}.before`);
  if (after !== null && before !== null && after >= before) {
    throw new CliError("invalid-data", `${label}.after must be earlier than before`);
  }
  return Object.freeze({ after, before });
}

type StoredMessageRow = Readonly<{
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
}>;

function personScopeId(addressBookContactId: string): string {
  return `${PERSON_SCOPE_PREFIX}${addressBookContactId}`;
}

function tableExists(database: Database, name: string): boolean {
  return get<{ value: number }>(
    database,
    "SELECT 1 AS value FROM sqlite_master WHERE type='table' AND name=?",
    name,
  ) !== null;
}

function tableColumns(database: Database, name: string): ReadonlySet<string> {
  return new Set(all<{ name: string }>(database, `PRAGMA table_info(${name})`).map((row) => row.name));
}

function userVersion(database: Database): number {
  return get<{ user_version: number }>(database, "PRAGMA user_version")?.user_version ?? 0;
}

function personScope(
  database: Database,
  addressBookContactId: string,
): AnalysisScope | null {
  const rows = all<{ conversation_id: string }>(database, `
    SELECT association.conversation_id
    FROM conversation_contact_scopes association
    JOIN conversations conversation ON conversation.id=association.conversation_id
    WHERE association.contact_id=? AND conversation.is_group=0
    ORDER BY association.conversation_id
  `, addressBookContactId);
  if (rows.length === 0) return null;
  return Object.freeze({
    id: personScopeId(addressBookContactId),
    kind: "person",
    addressBookContactId,
    conversationIds: Object.freeze(rows.map((row) => row.conversation_id)),
  });
}

function analysisScope(database: Database, contactId: string): AnalysisScope | null {
  if (contactId.startsWith(PERSON_SCOPE_PREFIX)) {
    const addressBookContactId = contactId.slice(PERSON_SCOPE_PREFIX.length);
    if (/^[a-f0-9]{64}$/u.test(addressBookContactId)) {
      return personScope(database, addressBookContactId);
    }
  }
  const conversation = get<{ id: string }>(
    database,
    "SELECT id FROM conversations WHERE id=?",
    contactId,
  );
  if (conversation === null) return null;
  const matched = get<{ contact_id: string }>(database, `
    SELECT contact_id FROM conversation_contact_scopes WHERE conversation_id=?
  `, contactId);
  if (matched !== null) return personScope(database, matched.contact_id);
  return Object.freeze({
    id: contactId,
    kind: "conversation",
    addressBookContactId: null,
    conversationIds: Object.freeze([contactId]),
  });
}

function messageRowsForScope(
  database: Database,
  scope: AnalysisScope,
  exactConversationId?: string,
  window: EvidenceWindow = UNBOUNDED_EVIDENCE_WINDOW,
): StoredMessageRow[] {
  if (exactConversationId !== undefined) {
    return all<StoredMessageRow>(database, `
      SELECT * FROM messages WHERE conversation_id=?
        AND (? IS NULL OR sent_at>=?) AND (? IS NULL OR sent_at<?)
      ORDER BY sent_at,source_row_id,id
    `, exactConversationId, window.after, window.after, window.before, window.before);
  }
  if (scope.kind === "person") {
    return all<StoredMessageRow>(database, `
      SELECT message.*
      FROM messages message
      JOIN conversation_contact_scopes association
        ON association.conversation_id=message.conversation_id
      WHERE association.contact_id=?
        AND (? IS NULL OR message.sent_at>=?)
        AND (? IS NULL OR message.sent_at<?)
      ORDER BY message.sent_at,message.source_row_id,message.id
    `,
    scope.addressBookContactId,
    window.after,
    window.after,
    window.before,
    window.before);
  }
  return all<StoredMessageRow>(database, `
    SELECT * FROM messages WHERE conversation_id=?
      AND (? IS NULL OR sent_at>=?) AND (? IS NULL OR sent_at<?)
    ORDER BY sent_at,source_row_id,id
  `,
  scope.conversationIds[0]!,
  window.after,
  window.after,
  window.before,
  window.before);
}

function corpusMessage(row: StoredMessageRow): CorpusMessage {
  return {
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
  };
}

function scopeEvidenceRevision(
  database: Database,
  scope: AnalysisScope,
  exactConversationId?: string,
  window: EvidenceWindow = UNBOUNDED_EVIDENCE_WINDOW,
): string {
  const conversationIds = exactConversationId === undefined
    ? scope.conversationIds
    : Object.freeze([exactConversationId]);
  const messages = messageRowsForScope(database, scope, exactConversationId, window).map(corpusMessage);
  return sha256(canonicalJson(
    window.after === null && window.before === null
      ? {
        schemaVersion: 1,
        scopeId: scope.id,
        conversationIds,
        messages,
      }
      : {
        schemaVersion: 2,
        scopeId: scope.id,
        evidenceWindow: window,
        messages,
      },
  ));
}

function storedProfileIsCurrent(
  database: Database,
  scope: AnalysisScope,
  evidenceRevision: string,
  profile: StyleProfile,
): boolean {
  const window = profile.schemaVersion === 2
    ? Object.freeze({
      after: profile.evidence.after,
      before: profile.evidence.before,
    })
    : UNBOUNDED_EVIDENCE_WINDOW;
  if (
    profile.schemaVersion === 2
    && profile.evidence.evidenceRevision !== evidenceRevision
  ) return false;
  return evidenceRevision === scopeEvidenceRevision(database, scope, undefined, window);
}

function scopeMessageCounts(database: Database, scope: AnalysisScope): Readonly<{
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  messageCount: number;
  incomingCount: number;
  outgoingCount: number;
}> {
  const select = `SELECT min(message.sent_at) AS first_message_at,
    max(message.sent_at) AS last_message_at,count(message.id) AS message_count,
    coalesce(sum(CASE WHEN message.direction='incoming' THEN 1 ELSE 0 END),0) AS incoming_count,
    coalesce(sum(CASE WHEN message.direction='outgoing' THEN 1 ELSE 0 END),0) AS outgoing_count`;
  const row = scope.kind === "person"
    ? get<{
      first_message_at: string | null;
      last_message_at: string | null;
      message_count: number;
      incoming_count: number;
      outgoing_count: number;
    }>(database, `${select}
      FROM messages message
      JOIN conversation_contact_scopes association
        ON association.conversation_id=message.conversation_id
      WHERE association.contact_id=?`, scope.addressBookContactId)
    : get<{
      first_message_at: string | null;
      last_message_at: string | null;
      message_count: number;
      incoming_count: number;
      outgoing_count: number;
    }>(database, `${select} FROM messages message WHERE message.conversation_id=?`, scope.conversationIds[0]!);
  return {
    firstMessageAt: row?.first_message_at ?? null,
    lastMessageAt: row?.last_message_at ?? null,
    messageCount: row?.message_count ?? 0,
    incomingCount: row?.incoming_count ?? 0,
    outgoingCount: row?.outgoing_count ?? 0,
  };
}

function addColumn(database: Database, table: string, definition: string): void {
  const name = definition.split(/\s+/u)[0];
  if (name !== undefined && !tableColumns(database, table).has(name)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

function backfillLegacyEvidence(database: Database): void {
  const currentCorpusRevision = scalarText(database, "corpus_revision");
  for (const table of ["study_packets", "profiles"] as const) {
    const rows = all<{
      rowid: number;
      contact_id: string;
      corpus_revision: string;
      scope_id: string | null;
      evidence_revision: string | null;
    }>(database, `
      SELECT rowid,contact_id,corpus_revision,scope_id,evidence_revision
      FROM ${table}
      WHERE scope_id IS NULL OR evidence_revision IS NULL
      ORDER BY rowid
    `);
    const update = database.query(`
      UPDATE ${table} SET scope_id=?,evidence_revision=? WHERE rowid=?
    `);
    for (const row of rows) {
      const scope = analysisScope(database, row.contact_id);
      if (scope === null) continue;
      const exactConversation = get<{ value: number }>(database, `
        SELECT 1 AS value FROM conversations WHERE id=?
      `, row.contact_id) === null ? undefined : row.contact_id;
      const evidenceRevision = row.evidence_revision ?? (
        currentCorpusRevision === row.corpus_revision
          ? scopeEvidenceRevision(database, scope, exactConversation)
          : null
      );
      update.run(row.scope_id ?? scope.id, evidenceRevision, row.rowid);
    }
  }
}

function initializeStoreSchema(database: Database): void {
  const existingStore = tableExists(database, "metadata");
  const version = userVersion(database);
  if (version > STORE_SCHEMA_VERSION) {
    throw new CliError(
      "invalid-data",
      `Local store schema ${version} is newer than supported schema ${STORE_SCHEMA_VERSION}`,
    );
  }
  if (!existingStore) {
    database.exec(SCHEMA);
    database.exec(`PRAGMA user_version=${STORE_SCHEMA_VERSION}`);
    return;
  }
  for (const table of ["study_packets", "profiles"] as const) {
    if (!tableExists(database, table)) {
      throw new CliError("invalid-data", `Local store is missing required table ${table}`);
    }
  }
  transaction(database, () => {
    database.exec(CONTACT_SCOPE_SCHEMA);
    database.exec(`
      INSERT OR IGNORE INTO conversation_contact_scopes(
        conversation_id,contact_id,contacts_revision
      )
      SELECT conversation_id,contact_id,contacts_revision
      FROM conversation_contact_labels
    `);
    addColumn(database, "study_packets", "scope_id TEXT");
    addColumn(database, "study_packets", "evidence_revision TEXT");
    addColumn(database, "study_packets", "example_ids_json TEXT");
    addColumn(database, "study_packets", "evidence_json TEXT");
    addColumn(database, "profiles", "scope_id TEXT");
    addColumn(database, "profiles", "evidence_revision TEXT");
    backfillLegacyEvidence(database);
    database.exec(`PRAGMA user_version=${STORE_SCHEMA_VERSION}`);
  });
  database.exec(SCHEMA);
}

type LabelProjectionResult = Readonly<{
  directConversations: number;
  eligibleConversations: number;
  matched: number;
  enriched: number;
  unmatched: number;
  ambiguous: number;
  matchedWithoutLabel: number;
}>;

function rebuildConversationLabels(
  database: Database,
  hmacKey?: string | Uint8Array,
): LabelProjectionResult {
  database.exec("DELETE FROM conversation_contact_labels; DELETE FROM conversation_contact_scopes;");
  const contacts = new Map(all<{
    id: string;
    private_label: string | null;
    normalized_label: string | null;
    label_basis: "display-name" | "name-parts" | "organization" | null;
    contacts_revision: string;
  }>(database, `SELECT id,private_label,normalized_label,label_basis,contacts_revision
    FROM addressbook_contacts ORDER BY id`).map((row) => [row.id, row]));
  const owners = new Map<string, Set<string>>();
  for (const row of all<{
    contact_id: string;
    kind: "email" | "phone";
    match_id: string;
  }>(database, `SELECT contact_id,kind,match_id FROM addressbook_handles
    ORDER BY kind,match_id,contact_id`)) {
    const key = `${row.kind}\0${row.match_id}`;
    const values = owners.get(key) ?? new Set<string>();
    values.add(row.contact_id);
    owners.set(key, values);
  }
  const conversations = all<{ id: string; private_participants_json: string }>(database, `
    SELECT id,private_participants_json FROM conversations WHERE is_group=0 ORDER BY id
  `);
  const insertScope = database.query(`INSERT INTO conversation_contact_scopes(
    conversation_id,contact_id,contacts_revision
  ) VALUES (?,?,?)`);
  const insertLabel = database.query(`INSERT INTO conversation_contact_labels(
    conversation_id,contact_id,private_label,normalized_label,label_basis,contacts_revision
  ) VALUES (?,?,?,?,?,?)`);
  let eligibleConversations = 0;
  let matched = 0;
  let enriched = 0;
  let unmatched = 0;
  let ambiguous = 0;
  let matchedWithoutLabel = 0;
  for (const conversation of conversations) {
    const normalizedHandles = stringArray(
      conversation.private_participants_json,
      `conversation ${conversation.id} participants`,
    ).map(normalizeContactHandle).filter((handle) => handle !== null);
    if (normalizedHandles.length > 0 && owners.size > 0 && hmacKey === undefined) {
      throw new CliError("internal", "The installation key is required to rebuild contact labels");
    }
    const keys = hmacKey === undefined
      ? new Set<string>()
      : new Set(normalizedHandles.map((handle) =>
        `${handle.kind}\0${contactHandleMatchId(hmacKey, handle)}`));
    if (keys.size > 0) eligibleConversations += 1;
    const candidates = new Set<string>();
    for (const key of keys) for (const contactId of owners.get(key) ?? []) candidates.add(contactId);
    if (candidates.size === 0) {
      unmatched += 1;
      continue;
    }
    if (candidates.size > 1) {
      ambiguous += 1;
      continue;
    }
    matched += 1;
    const contactId = [...candidates][0]!;
    const contact = contacts.get(contactId);
    if (contact === undefined) {
      throw new CliError("invalid-data", "A contact handle references an unknown contact");
    }
    insertScope.run(conversation.id, contact.id, contact.contacts_revision);
    if (
      contact.private_label === null
      || contact.normalized_label === null
      || contact.label_basis === null
    ) {
      matchedWithoutLabel += 1;
      continue;
    }
    insertLabel.run(
      conversation.id,
      contact.id,
      contact.private_label,
      contact.normalized_label,
      contact.label_basis,
      contact.contacts_revision,
    );
    enriched += 1;
  }
  return {
    directConversations: conversations.length,
    eligibleConversations,
    matched,
    enriched,
    unmatched,
    ambiguous,
    matchedWithoutLabel,
  };
}

export type ContactsEnrichmentResult = Readonly<{
  contactsRevision: string;
  sources: number;
  sourceContacts: number;
  directConversations: number;
  eligibleConversations: number;
  matched: number;
  enriched: number;
  unmatched: number;
  ambiguous: number;
  matchedWithoutLabel: number;
}>;

function assertSafeDatabaseFileIfPresent(path: string): void {
  const existing = (() => {
    try {
      return lstatSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  })();
  if (existing === null) return;
  if (existing.isSymbolicLink() || !existing.isFile()) {
    throw new CliError("unsafe-path", `${path} must be a physical regular file`);
  }
  if (typeof process.getuid === "function" && existing.uid !== process.getuid()) {
    throw new CliError("unsafe-path", `${path} is not owned by the current user`);
  }
}

function hardenDatabaseFiles(path: string): void {
  for (const [candidate, required] of [
    [path, true],
    [`${path}-wal`, false],
    [`${path}-shm`, false],
  ] as const) {
    let descriptor: number;
    try {
      descriptor = openSync(candidate, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!required && code === "ENOENT") continue;
      if (code === "ELOOP") {
        throw new CliError("unsafe-path", `${candidate} must not be a symbolic link`, { cause: error });
      }
      throw error;
    }
    try {
      const status = fstatSync(descriptor);
      if (!status.isFile()) {
        throw new CliError("unsafe-path", `${candidate} must be a physical regular file`);
      }
      if (typeof process.getuid === "function" && status.uid !== process.getuid()) {
        throw new CliError("unsafe-path", `${candidate} is not owned by the current user`);
      }
      fchmodSync(descriptor, 0o600);
    } finally {
      closeSync(descriptor);
    }
  }
}

export class LocalStore {
  readonly #database: Database;

  private constructor(database: Database) {
    this.#database = database;
  }

  static open(path: string): LocalStore {
    for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
      assertSafeDatabaseFileIfPresent(candidate);
    }
    const database = new Database(path, { create: true, strict: true });
    try {
      hardenDatabaseFiles(path);
      database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");
      initializeStoreSchema(database);
      hardenDatabaseFiles(path);
      return new LocalStore(database);
    } catch (error) {
      try {
        database.close();
      } catch {
        // Preserve the original open, migration, or path-safety failure.
      }
      throw error;
    }
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

  contactsRevision(): string | null {
    return scalarText(this.#database, "contacts_revision");
  }

  enrichContacts(
    snapshot: ContactsSnapshot,
    ingestedAt: string,
    hmacKey: string | Uint8Array,
  ): ContactsEnrichmentResult {
    if (snapshot.schemaVersion !== 1 || !/^[a-f0-9]{64}$/u.test(snapshot.snapshotSha256)) {
      throw new CliError("invalid-data", "The Contacts reader returned an invalid snapshot revision");
    }
    if (snapshot.sources.length < 1 || snapshot.sources.length > 64) {
      throw new CliError("invalid-data", "The Contacts reader returned an invalid source count");
    }
    if (snapshot.contacts.length > 100_000 || snapshot.warnings.length > 16) {
      throw new CliError("invalid-data", "The Contacts reader exceeded its result bounds");
    }
    const ids = new Set<string>();
    let handleCount = 0;
    for (const contact of snapshot.contacts) {
      if (!/^[a-f0-9]{64}$/u.test(contact.id) || ids.has(contact.id)) {
        throw new CliError("invalid-data", "The Contacts reader returned duplicate or invalid contact IDs");
      }
      ids.add(contact.id);
      if (
        contact.privateLabel !== null
        && (
          Buffer.byteLength(contact.privateLabel, "utf8") < 1
          || Buffer.byteLength(contact.privateLabel, "utf8") > 4_096
          || /\p{Cc}/u.test(contact.privateLabel)
        )
      ) throw new CliError("invalid-data", "The Contacts reader returned an invalid private label");
      if (
        (contact.privateLabel === null) !== (contact.privateLabelBasis === null)
        || (
          contact.privateLabelBasis !== null
          && contact.privateLabelBasis !== "display-name"
          && contact.privateLabelBasis !== "name-parts"
          && contact.privateLabelBasis !== "organization"
        )
      ) throw new CliError("invalid-data", "The Contacts reader returned an invalid label basis");
      handleCount += contact.handles.length;
      if (handleCount > 1_000_000) {
        throw new CliError("invalid-data", "The Contacts reader returned too many handles");
      }
      const handles = new Set<string>();
      for (const handle of contact.handles) {
        const canonical = normalizeContactHandle(handle.normalizedValue);
        if (
          canonical === null
          || canonical.kind !== handle.kind
          || canonical.normalizedValue !== handle.normalizedValue
          || handle.matchId !== contactHandleMatchId(hmacKey, canonical)
          || !/^[a-f0-9]{64}$/u.test(handle.matchId)
        ) throw new CliError("invalid-data", "The Contacts reader returned a non-canonical handle");
        const key = `${handle.kind}\0${handle.matchId}`;
        if (handles.has(key)) {
          throw new CliError("invalid-data", "The Contacts reader returned duplicate contact handles");
        }
        handles.add(key);
      }
    }
    for (const warning of snapshot.warnings) {
      if (Buffer.byteLength(warning, "utf8") > 1_024 || warning.includes("\u0000")) {
        throw new CliError("invalid-data", "The Contacts reader returned an invalid warning");
      }
    }

    return transaction(this.#database, () => {
      this.#database.exec("DELETE FROM addressbook_contacts");
      const insertContact = this.#database.query(`INSERT INTO addressbook_contacts(
        id,private_label,normalized_label,label_basis,contacts_revision
      ) VALUES (?,?,?,?,?)`);
      const insertHandle = this.#database.query(`INSERT INTO addressbook_handles(
        contact_id,kind,match_id
      ) VALUES (?,?,?)`);
      for (const contact of snapshot.contacts) {
        insertContact.run(
          contact.id,
          contact.privateLabel,
          contact.privateLabel === null ? null : normalizeContactLabelQuery(contact.privateLabel),
          contact.privateLabelBasis,
          snapshot.snapshotSha256,
        );
        for (const handle of contact.handles) {
          insertHandle.run(contact.id, handle.kind, handle.matchId);
        }
      }
      const projection = rebuildConversationLabels(this.#database, hmacKey);
      const setMetadata = this.#database.query(`
        INSERT INTO metadata (key,value) VALUES (?,?)
        ON CONFLICT (key) DO UPDATE SET value=excluded.value
      `);
      for (const [key, value] of [
        ["contacts_revision", snapshot.snapshotSha256],
        ["contacts_source_identity", canonicalJson(snapshot.sources.map((source) => ({
          device: source.device,
          inode: source.inode,
          bytes: source.bytes,
          modifiedAt: source.modifiedAt,
          schemaSha256: source.schemaSha256,
        })))],
        ["contacts_ingested_at", ingestedAt],
        ["contacts_warnings", canonicalJson(snapshot.warnings)],
        ["contacts_schema_version", String(snapshot.schemaVersion)],
      ] as const) setMetadata.run(key, value);
      return {
        contactsRevision: snapshot.snapshotSha256,
        sources: snapshot.sources.length,
        sourceContacts: snapshot.contacts.length,
        ...projection,
      };
    });
  }

  resolvePrivateContacts(query: string, limit: number): ReadonlyArray<Readonly<{
    id: string;
    privateLabel: string;
  }>> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      throw new CliError("usage", "Contact resolution limit must be between 1 and 50");
    }
    const normalized = normalizeContactLabelQuery(query);
    return all<{ id: string; private_label: string }>(this.#database, `
      SELECT label.contact_id AS id,min(label.private_label) AS private_label
      FROM conversation_contact_labels label
      JOIN conversations conversation ON conversation.id=label.conversation_id
      WHERE conversation.is_group=0 AND label.normalized_label=?
      GROUP BY label.contact_id
      ORDER BY label.contact_id LIMIT ?
    `, normalized, limit).map((row) => ({
      id: personScopeId(row.id),
      privateLabel: row.private_label,
    }));
  }

  replaceCorpus(
    snapshot: CorpusSnapshot,
    ingestedAt: string,
    hmacKey?: string | Uint8Array,
  ): Readonly<{
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
      rebuildConversationLabels(this.#database, hmacKey);
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
    if (this.corpusRevision() === null) return [];
    const rows = all<{
      id: string;
      private_label: string | null;
      scope_kind: "person" | "conversation";
      conversation_count: number;
      is_group: number;
      participant_count: number;
      first_message_at: string | null;
      last_message_at: string | null;
      message_count: number;
      incoming_count: number;
      outgoing_count: number;
    }>(this.#database, `
      WITH scope_conversations AS (
        SELECT '${PERSON_SCOPE_PREFIX}' || association.contact_id AS id,
          coalesce(label.private_label,conversation.private_label) AS private_label,
          'person' AS scope_kind,0 AS is_group,1 AS participant_count,
          conversation.id AS conversation_id
        FROM conversation_contact_scopes association
        JOIN conversations conversation ON conversation.id=association.conversation_id
        LEFT JOIN conversation_contact_labels label
          ON label.conversation_id=association.conversation_id
        WHERE conversation.is_group=0
        UNION ALL
        SELECT conversation.id,conversation.private_label,'conversation',conversation.is_group,
          conversation.participant_count,conversation.id
        FROM conversations conversation
        LEFT JOIN conversation_contact_scopes association
          ON association.conversation_id=conversation.id
        WHERE association.conversation_id IS NULL
      )
      SELECT scope.id,min(scope.private_label) AS private_label,
        max(scope.scope_kind) AS scope_kind,
        count(distinct scope.conversation_id) AS conversation_count,
        max(scope.is_group) AS is_group,max(scope.participant_count) AS participant_count,
        min(message.sent_at) AS first_message_at,max(message.sent_at) AS last_message_at,
        count(message.id) AS message_count,
        sum(CASE WHEN message.direction = 'incoming' THEN 1 ELSE 0 END) AS incoming_count,
        sum(CASE WHEN message.direction = 'outgoing' THEN 1 ELSE 0 END) AS outgoing_count
      FROM scope_conversations scope
      JOIN messages message ON message.conversation_id=scope.conversation_id
      GROUP BY scope.id
      HAVING outgoing_count >= ?
      ORDER BY outgoing_count DESC,last_message_at DESC,scope.id
      LIMIT ?
    `, options.minimumOutgoing, options.limit);
    const storedProfiles = new Map<string, Array<Readonly<{
      evidenceRevision: string;
      profile: StyleProfile;
    }>>>();
    for (const row of all<{
      scope_id: string;
      evidence_revision: string;
      profile_json: string;
    }>(this.#database, `
      SELECT scope_id,evidence_revision,profile_json FROM profiles
      WHERE scope_id IS NOT NULL AND evidence_revision IS NOT NULL
      ORDER BY scope_id,applied_at DESC,contact_id
    `)) {
      const profiles = storedProfiles.get(row.scope_id) ?? [];
      profiles.push({
        evidenceRevision: row.evidence_revision,
        profile: parseStyleProfile(parsedJson(row.profile_json, "Stored profile")),
      });
      storedProfiles.set(row.scope_id, profiles);
    }
    return rows.map((row) => ({
      id: row.id,
      ...(options.privateLabels ? { privateLabel: row.private_label } : {}),
      scopeKind: row.scope_kind,
      conversationCount: row.conversation_count,
      group: row.is_group === 1,
      participantCount: row.participant_count,
      firstMessageAt: row.first_message_at,
      lastMessageAt: row.last_message_at,
      messageCount: row.message_count,
      incomingCount: row.incoming_count,
      outgoingCount: row.outgoing_count,
      profileState: (() => {
        const profiles = storedProfiles.get(row.id);
        if (profiles === undefined) return "missing";
        const scope = analysisScope(this.#database, row.id);
        if (scope === null) return "stale";
        return profiles.some(({ evidenceRevision, profile }) =>
          storedProfileIsCurrent(this.#database, scope, evidenceRevision, profile))
          ? "current"
          : "stale";
      })(),
    }));
  }

  conversation(contactId: string, privateLabels: boolean): (CorpusConversation & {
    scopeKind: "person" | "conversation";
    conversationCount: number;
    firstMessageAt: string | null;
    lastMessageAt: string | null;
    messageCount: number;
    incomingCount: number;
    outgoingCount: number;
  }) | null {
    const scope = analysisScope(this.#database, contactId);
    if (scope === null) return null;
    const rows = scope.kind === "person"
      ? all<{
        id: string;
        source_key: string;
        private_label: string | null;
        service: string | null;
        participant_count: number;
        participant_ids_json: string;
        private_participants_json: string;
        is_group: number;
      }>(this.#database, `
        SELECT conversation.id,conversation.source_key,
          coalesce(label.private_label,conversation.private_label) AS private_label,
          conversation.service,conversation.participant_count,
          conversation.participant_ids_json,conversation.private_participants_json,
          conversation.is_group
        FROM conversations conversation
        JOIN conversation_contact_scopes association
          ON association.conversation_id=conversation.id
        LEFT JOIN conversation_contact_labels label
          ON label.conversation_id=conversation.id
        WHERE association.contact_id=? ORDER BY conversation.id
      `, scope.addressBookContactId)
      : all<{
      id: string;
      source_key: string;
      private_label: string | null;
      service: string | null;
      participant_count: number;
      participant_ids_json: string;
      private_participants_json: string;
      is_group: number;
    }>(this.#database, `
      SELECT conversation.id,conversation.source_key,
        coalesce(contact_label.private_label,conversation.private_label) AS private_label,
        conversation.service,conversation.participant_count,conversation.participant_ids_json,
        conversation.private_participants_json,conversation.is_group
      FROM conversations conversation
      LEFT JOIN conversation_contact_labels contact_label
        ON contact_label.conversation_id = conversation.id
      WHERE conversation.id = ?
    `, scope.conversationIds[0]!);
    const first = rows[0];
    if (first === undefined) return null;
    const services = [...new Set(rows.map((row) => row.service).filter((value): value is string => value !== null))];
    const participants = [...new Set(rows.flatMap((row) =>
      stringArray(row.participant_ids_json, `conversation ${row.id} participant IDs`)))].sort();
    const privateParticipants = privateLabels
      ? [...new Set(rows.flatMap((row) =>
        stringArray(row.private_participants_json, `conversation ${row.id} private participants`)))].sort()
      : [];
    const counts = scopeMessageCounts(this.#database, scope);
    return {
      id: scope.id,
      sourceKey: scope.kind === "person" ? scope.id : first.source_key,
      privateLabel: privateLabels ? first.private_label : null,
      scopeKind: scope.kind,
      conversationCount: scope.conversationIds.length,
      service: services.length === 1 ? services[0]! : null,
      participantCount: scope.kind === "person" ? 1 : first.participant_count,
      participantIds: participants,
      privateParticipants,
      group: scope.kind === "person" ? false : first.is_group === 1,
      ...counts,
    };
  }

  messages(contactId: string): CorpusMessage[] {
    const scope = analysisScope(this.#database, contactId);
    return scope === null ? [] : messageRowsForScope(this.#database, scope).map(corpusMessage);
  }

  contactCorpus(contactId: string, options?: Readonly<{
    after: string | null;
    before: string | null;
  }>): Readonly<{
    corpusRevision: string;
    evidenceRevision: string;
    messages: CorpusMessage[];
  }> | null {
    const window = evidenceWindow(options, "Evidence window");
    return readTransaction(this.#database, () => {
      // The first read pins a single SQLite snapshot for revision, identity,
      // and bodies even when another process ingests a new corpus concurrently.
      const corpusRevision = scalarText(this.#database, "corpus_revision");
      const scope = analysisScope(this.#database, contactId);
      if (scope === null) return null;
      if (corpusRevision === null) {
        throw new CliError("invalid-data", "Stored conversations have no corpus revision");
      }
      return {
        corpusRevision,
        evidenceRevision: scopeEvidenceRevision(this.#database, scope, undefined, window),
        messages: messageRowsForScope(this.#database, scope, undefined, window).map(corpusMessage),
      };
    });
  }

  recordStudyPacket(receipt: Readonly<{
    sha256: string;
    contactId: string;
    corpusRevision: string;
    evidenceRevision?: string;
    createdAt: string;
    privatePath: string;
    exampleIds?: readonly string[];
    evidence?: StudyPacketEvidenceManifest;
  }>): void {
    if ((receipt.exampleIds === undefined) !== (receipt.evidence === undefined)) {
      throw new CliError(
        "invalid-data",
        "Study packet example IDs and evidence manifest must be recorded together",
      );
    }
    const manifest = receipt.exampleIds === undefined || receipt.evidence === undefined
      ? null
      : {
        exampleIds: studyExampleIds(receipt.exampleIds, "study packet exampleIds"),
        evidence: studyEvidenceManifest(receipt.evidence, "study packet evidence"),
      };
    if (manifest !== null && manifest.evidence.studyExamples !== manifest.exampleIds.length) {
      throw new CliError(
        "invalid-data",
        "Study packet evidence.studyExamples must equal the number of example IDs",
      );
    }
    transaction(this.#database, () => {
      const revision = scalarText(this.#database, "corpus_revision");
      const scope = analysisScope(this.#database, receipt.contactId);
      if (scope === null) throw new CliError("not-found", `Unknown contact ${receipt.contactId}`);
      const window = manifest === null
        ? UNBOUNDED_EVIDENCE_WINDOW
        : Object.freeze({
          after: manifest.evidence.after,
          before: manifest.evidence.before,
        });
      const currentEvidenceRevision = scopeEvidenceRevision(
        this.#database,
        scope,
        undefined,
        window,
      );
      if (
        revision !== receipt.corpusRevision
        && receipt.evidenceRevision === undefined
      ) {
        throw new CliError(
          "conflict",
          "Corpus changed while the study packet was prepared; prepare it again",
        );
      }
      if (
        receipt.evidenceRevision !== undefined
        && receipt.evidenceRevision !== currentEvidenceRevision
      ) {
        throw new CliError(
          "conflict",
          "Contact evidence changed while the study packet was prepared; prepare it again",
        );
      }
      this.#database.query(`
        INSERT INTO study_packets (
          sha256,contact_id,corpus_revision,scope_id,evidence_revision,
          example_ids_json,evidence_json,created_at,private_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (sha256) DO UPDATE SET
          contact_id = excluded.contact_id,
          corpus_revision = excluded.corpus_revision,
          scope_id = excluded.scope_id,
          evidence_revision = excluded.evidence_revision,
          example_ids_json = excluded.example_ids_json,
          evidence_json = excluded.evidence_json,
          created_at = excluded.created_at,
          private_path = excluded.private_path
      `).run(
        receipt.sha256,
        receipt.contactId,
        receipt.corpusRevision,
        scope.id,
        currentEvidenceRevision,
        manifest === null ? null : canonicalJson(manifest.exampleIds),
        manifest === null ? null : canonicalJson(manifest.evidence),
        receipt.createdAt,
        receipt.privatePath,
      );
    });
  }

  applyProfile(profile: StyleProfile, appliedAt: string): void {
    const parsedProfile = parseStyleProfile(profile);
    transaction(this.#database, () => {
      const revision = scalarText(this.#database, "corpus_revision");
      if (revision === null) throw new CliError("conflict", "Ingest iMessage before applying a profile");
      const scope = analysisScope(this.#database, parsedProfile.contactId);
      if (scope === null) throw new CliError("not-found", `Unknown contact ${parsedProfile.contactId}`);
      const packet = get<{
        scope_id: string | null;
        evidence_revision: string | null;
        example_ids_json: string | null;
        evidence_json: string | null;
      }>(this.#database, `
        SELECT scope_id,evidence_revision,example_ids_json,evidence_json
        FROM study_packets
        WHERE sha256 = ? AND contact_id = ? AND corpus_revision = ?
      `, parsedProfile.packetSha256, parsedProfile.contactId, parsedProfile.corpusRevision);
      if (packet === null) {
        throw new CliError("conflict", "Profile does not bind a study packet prepared by this installation");
      }
      if (packet.scope_id !== scope.id || packet.evidence_revision === null) {
        throw new CliError("conflict", "Profile study scope changed; prepare and analyze a new study packet");
      }
      let window = UNBOUNDED_EVIDENCE_WINDOW;
      if (parsedProfile.schemaVersion === 2) {
        if (parsedProfile.evidence.evidenceRevision !== packet.evidence_revision) {
          throw new CliError("conflict", "Profile evidence revision does not match its study packet");
        }
        if (packet.example_ids_json === null || packet.evidence_json === null) {
          throw new CliError(
            "conflict",
            "Profile requires a study packet with a recorded evidence manifest",
          );
        }
        const exampleIds = studyExampleIds(
          parsedJson(packet.example_ids_json, "Stored study packet example IDs"),
          "Stored study packet example IDs",
        );
        const evidence = studyEvidenceManifest(
          parsedJson(packet.evidence_json, "Stored study packet evidence"),
          "Stored study packet evidence",
        );
        if (evidence.studyExamples !== exampleIds.length) {
          throw new CliError("invalid-data", "Stored study packet evidence manifest is inconsistent");
        }
        if (canonicalJson(evidence) !== canonicalJson(profileEvidenceManifest(parsedProfile))) {
          throw new CliError("conflict", "Profile evidence summary does not match its study packet");
        }
        window = Object.freeze({ after: evidence.after, before: evidence.before });
        assertProfileEvidenceIds(parsedProfile, new Set(exampleIds));
      }
      const currentEvidenceRevision = scopeEvidenceRevision(
        this.#database,
        scope,
        undefined,
        window,
      );
      if (packet.evidence_revision !== currentEvidenceRevision) {
        throw new CliError("conflict", "Profile evidence is stale; prepare and analyze a new study packet");
      }
      this.#database.query("DELETE FROM profiles WHERE scope_id=?").run(scope.id);
      this.#database.query(`
        INSERT INTO profiles (
          contact_id,corpus_revision,scope_id,evidence_revision,
          packet_sha256,analyzed_at,profile_json,applied_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (contact_id) DO UPDATE SET
          corpus_revision = excluded.corpus_revision,
          scope_id = excluded.scope_id,
          evidence_revision = excluded.evidence_revision,
          packet_sha256 = excluded.packet_sha256,
          analyzed_at = excluded.analyzed_at,
          profile_json = excluded.profile_json,
          applied_at = excluded.applied_at
      `).run(
        parsedProfile.contactId,
        parsedProfile.corpusRevision,
        scope.id,
        currentEvidenceRevision,
        parsedProfile.packetSha256,
        parsedProfile.analyzedAt,
        canonicalJson(parsedProfile),
        appliedAt,
      );
    });
  }

  profile(contactId: string): Readonly<{
    state: "current" | "stale";
    profile: StyleProfile;
    appliedAt: string;
  }> | null {
    const scope = analysisScope(this.#database, contactId);
    if (scope === null) return null;
    const rows = all<{
      evidence_revision: string | null;
      profile_json: string;
      applied_at: string;
    }>(this.#database, `
      SELECT evidence_revision,profile_json,applied_at
      FROM profiles
      WHERE scope_id=?
      ORDER BY applied_at DESC,CASE WHEN contact_id=? THEN 0 ELSE 1 END,contact_id
    `, scope.id, contactId);
    const fallback = rows.length === 0 ? get<{
      evidence_revision: string | null;
      profile_json: string;
      applied_at: string;
    }>(this.#database, `
      SELECT evidence_revision,profile_json,applied_at FROM profiles WHERE contact_id=?
    `, contactId) : null;
    const candidates = (fallback === null ? rows : [fallback]).map((row) => ({
      row,
      profile: parseStyleProfile(parsedJson(row.profile_json, "Stored profile")),
    }));
    if (candidates.length === 0) return null;
    const selected = candidates.find(({ row, profile }) =>
      row.evidence_revision !== null
      && storedProfileIsCurrent(this.#database, scope, row.evidence_revision, profile))
      ?? candidates[0]!;
    return {
      state: selected.row.evidence_revision !== null
        && storedProfileIsCurrent(
          this.#database,
          scope,
          selected.row.evidence_revision,
          selected.profile,
        )
        ? "current"
        : "stale",
      profile: selected.profile,
      appliedAt: selected.row.applied_at,
    };
  }

  doctor(): Readonly<{
    storeSchemaVersion: number;
    quickCheck: string;
    foreignKeyViolations: number;
    corpusRevision: string | null;
    contactsRevision: string | null;
    conversations: number;
    messages: number;
    profiles: number;
    addressBookContacts: number;
    enrichedLabels: number;
  }> {
    const quick = get<{ quick_check: string }>(this.#database, "PRAGMA quick_check")?.quick_check ?? "unknown";
    const foreignKeys = all<Row>(this.#database, "PRAGMA foreign_key_check").length;
    const count = (table: "conversations" | "messages" | "profiles" | "addressbook_contacts" | "conversation_contact_labels") =>
      get<{ value: number }>(this.#database, `SELECT count(*) AS value FROM ${table}`)?.value ?? 0;
    return {
      storeSchemaVersion: userVersion(this.#database),
      quickCheck: quick,
      foreignKeyViolations: foreignKeys,
      corpusRevision: this.corpusRevision(),
      contactsRevision: this.contactsRevision(),
      conversations: count("conversations"),
      messages: count("messages"),
      profiles: count("profiles"),
      addressBookContacts: count("addressbook_contacts"),
      enrichedLabels: count("conversation_contact_labels"),
    };
  }
}
