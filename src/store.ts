import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
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
  agentMessageRouteCandidateId,
  parseAgentMessageHandoffV1,
  parseWrenchMessagingReceiptBindingV1,
  wrenchMessagingTurnDigestV1,
  type AgentMessageRouteCandidateV1,
} from "./agentic-messaging-v1.ts";
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
  CorpusReactionFact,
  CorpusSnapshot,
  CorpusSourceDescriptor,
  ProfileEvidenceV2,
  SourceCorpusSnapshot,
  StyleProfile,
  StyleProfileV2,
} from "./types.ts";

type Binding = string | number | bigint | Uint8Array | null;
type Row = Record<string, unknown>;

const STORE_SCHEMA_VERSION = 5;
const PERSON_SCOPE_PREFIX = "person_";
export const IMESSAGE_SOURCE_ID = "source_imessage_local";

const SCHEMA = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS corpus_sources (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('imessage', 'bundle', 'x-archive')),
    kind_v4 TEXT CHECK (kind_v4 IN ('imessage', 'bundle', 'x-archive')),
    provider TEXT NOT NULL,
    network TEXT,
    account_id TEXT,
    external_id TEXT NOT NULL,
    input_revision TEXT NOT NULL,
    revision TEXT NOT NULL,
    generated_at TEXT,
    producer_json TEXT NOT NULL,
    coverage_json TEXT NOT NULL,
    manifest_sha256 TEXT,
    identity_json TEXT NOT NULL,
    warnings_json TEXT NOT NULL,
    ingested_at TEXT NOT NULL
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
  CREATE TABLE IF NOT EXISTS conversation_sources (
    conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES corpus_sources(id) ON DELETE RESTRICT,
    external_id TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    UNIQUE (source_id, external_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS conversation_sources_lookup
    ON conversation_sources(source_id, conversation_id);
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
    reply_state TEXT NOT NULL CHECK (reply_state IN ('explicit','none','unavailable')),
    edited_at TEXT,
    retracted_at TEXT,
    service TEXT,
    attachment_count INTEGER NOT NULL CHECK (attachment_count >= 0),
    UNIQUE (source_row_id, conversation_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS messages_conversation_time
    ON messages(conversation_id, sent_at, source_row_id, id);
  CREATE INDEX IF NOT EXISTS messages_source_guid ON messages(source_guid);
  CREATE TABLE IF NOT EXISTS message_provenance (
    message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES corpus_sources(id) ON DELETE RESTRICT,
    external_id TEXT NOT NULL,
    reply_to_external_id TEXT,
    attachments_json TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    UNIQUE (source_id, external_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS message_provenance_source
    ON message_provenance(source_id, message_id);
  CREATE TABLE IF NOT EXISTS corpus_reaction_facts (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES corpus_sources(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    target_external_id TEXT NOT NULL,
    conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
    direction TEXT CHECK (direction IN ('incoming','outgoing')),
    body TEXT NOT NULL,
    reacted_at TEXT,
    state TEXT NOT NULL CHECK (state IN ('active','removed')),
    UNIQUE (source_id, external_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS corpus_reaction_facts_source
    ON corpus_reaction_facts(source_id,conversation_id,id);
  CREATE TABLE IF NOT EXISTS corpus_source_records (
    source_id TEXT NOT NULL REFERENCES corpus_sources(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (
      kind IN ('account','participant','reaction','tombstone','excluded-message')
    ),
    external_id TEXT NOT NULL,
    record_json TEXT NOT NULL,
    PRIMARY KEY (source_id, kind, external_id)
  ) WITHOUT ROWID, STRICT;
  CREATE TABLE IF NOT EXISTS corpus_source_suppressions (
    source_id TEXT NOT NULL REFERENCES corpus_sources(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (
      kind IN ('conversation','message','reaction','reaction-timeline','participant','account')
    ),
    local_id TEXT NOT NULL,
    external_id TEXT NOT NULL,
    suppressed_at TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (
      reason IN ('authoritative-absence','tombstone','explicit-exclusion','replacement','reappeared')
    ),
    suppressed INTEGER NOT NULL CHECK (suppressed IN (0,1)),
    PRIMARY KEY (source_id, kind, local_id)
  ) WITHOUT ROWID, STRICT;
  CREATE TABLE IF NOT EXISTS conversation_equivalences (
    duplicate_conversation_id TEXT PRIMARY KEY
      REFERENCES conversations(id) ON DELETE CASCADE,
    preferred_conversation_id TEXT NOT NULL
      REFERENCES conversations(id) ON DELETE RESTRICT,
    duplicate_source_id TEXT NOT NULL
      REFERENCES corpus_sources(id) ON DELETE CASCADE,
    preferred_source_id TEXT NOT NULL
      REFERENCES corpus_sources(id) ON DELETE RESTRICT,
    basis TEXT NOT NULL CHECK (basis='exact-message-overlap'),
    plan_evidence_sha256 TEXT NOT NULL,
    match_sha256 TEXT NOT NULL,
    established_at TEXT NOT NULL,
    CHECK (duplicate_conversation_id <> preferred_conversation_id),
    CHECK (duplicate_source_id <> preferred_source_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS conversation_equivalences_preferred
    ON conversation_equivalences(preferred_conversation_id,duplicate_conversation_id);
  CREATE TABLE IF NOT EXISTS message_equivalences (
    duplicate_message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    preferred_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
    duplicate_source_id TEXT NOT NULL
      REFERENCES corpus_sources(id) ON DELETE CASCADE,
    preferred_source_id TEXT NOT NULL
      REFERENCES corpus_sources(id) ON DELETE RESTRICT,
    basis TEXT NOT NULL CHECK (basis='exact-message-overlap'),
    plan_evidence_sha256 TEXT NOT NULL,
    match_sha256 TEXT NOT NULL,
    established_at TEXT NOT NULL,
    UNIQUE (preferred_message_id),
    CHECK (duplicate_message_id <> preferred_message_id),
    CHECK (duplicate_source_id <> preferred_source_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS message_equivalences_sources
    ON message_equivalences(duplicate_source_id,preferred_source_id);
  CREATE TABLE IF NOT EXISTS reaction_equivalences (
    duplicate_reaction_id TEXT PRIMARY KEY
      REFERENCES corpus_reaction_facts(id) ON DELETE CASCADE,
    preferred_reaction_id TEXT NOT NULL
      REFERENCES corpus_reaction_facts(id) ON DELETE RESTRICT,
    duplicate_source_id TEXT NOT NULL
      REFERENCES corpus_sources(id) ON DELETE CASCADE,
    preferred_source_id TEXT NOT NULL
      REFERENCES corpus_sources(id) ON DELETE RESTRICT,
    basis TEXT NOT NULL CHECK (basis='exact-message-overlap'),
    plan_evidence_sha256 TEXT NOT NULL,
    match_sha256 TEXT NOT NULL,
    established_at TEXT NOT NULL,
    UNIQUE (preferred_reaction_id),
    CHECK (duplicate_reaction_id <> preferred_reaction_id),
    CHECK (duplicate_source_id <> preferred_source_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS reaction_equivalences_sources
    ON reaction_equivalences(duplicate_source_id,preferred_source_id);
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
  CREATE TABLE IF NOT EXISTS agent_message_handoffs (
    handoff_id TEXT PRIMARY KEY,
    handoff_sha256 TEXT NOT NULL CHECK (length(handoff_sha256)=64),
    contact_id_sha256 TEXT NOT NULL CHECK (length(contact_id_sha256)=64),
    route_candidate_id_sha256 TEXT NOT NULL CHECK (length(route_candidate_id_sha256)=64),
    source_id_sha256 TEXT NOT NULL CHECK (length(source_id_sha256)=64),
    conversation_id_sha256 TEXT NOT NULL CHECK (length(conversation_id_sha256)=64),
    corpus_revision TEXT NOT NULL CHECK (length(corpus_revision)=64),
    source_revision TEXT NOT NULL CHECK (length(source_revision)=64),
    profile_state TEXT NOT NULL CHECK (profile_state IN ('current','missing','stale')),
    profile_evidence_revision TEXT,
    wrench_contract_hash TEXT NOT NULL CHECK (length(wrench_contract_hash)=64),
    route_ref_sha256 TEXT NOT NULL CHECK (length(route_ref_sha256)=64),
    context_ref_sha256 TEXT NOT NULL CHECK (length(context_ref_sha256)=64),
    exact_data_revision_sha256 TEXT NOT NULL CHECK (length(exact_data_revision_sha256)=64),
    latest_message_revision_sha256 TEXT NOT NULL CHECK (length(latest_message_revision_sha256)=64),
    turn_digest_sha256 TEXT NOT NULL CHECK (length(turn_digest_sha256)=64),
    part_count INTEGER NOT NULL CHECK (part_count BETWEEN 1 AND 8),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('prepared','recorded')),
    receipt_sha256 TEXT CHECK (receipt_sha256 IS NULL OR length(receipt_sha256)=64),
    receipt_contract_hash TEXT CHECK (receipt_contract_hash IS NULL OR length(receipt_contract_hash)=64),
    preview_digest_sha256 TEXT CHECK (preview_digest_sha256 IS NULL OR length(preview_digest_sha256)=64),
    run_id_sha256 TEXT CHECK (run_id_sha256 IS NULL OR length(run_id_sha256)=64),
    receipt_state TEXT CHECK (receipt_state IN ('submitted','failed','partial','indeterminate')),
    proven_part_count INTEGER,
    recorded_at TEXT,
    CHECK (
      (state='prepared' AND receipt_sha256 IS NULL AND receipt_contract_hash IS NULL
        AND preview_digest_sha256 IS NULL AND run_id_sha256 IS NULL AND receipt_state IS NULL
        AND proven_part_count IS NULL AND recorded_at IS NULL)
      OR
      (state='recorded' AND receipt_sha256 IS NOT NULL AND receipt_contract_hash IS NOT NULL
        AND preview_digest_sha256 IS NOT NULL AND run_id_sha256 IS NOT NULL
        AND receipt_state IS NOT NULL AND proven_part_count IS NOT NULL AND recorded_at IS NOT NULL)
    ),
    CHECK (
      state='prepared'
      OR (receipt_state='submitted' AND proven_part_count=part_count)
      OR (receipt_state='failed' AND proven_part_count=0)
      OR (receipt_state='partial' AND proven_part_count BETWEEN 1 AND part_count-1)
      OR (receipt_state='indeterminate' AND proven_part_count BETWEEN 0 AND part_count-1)
    )
  ) STRICT;
  CREATE INDEX IF NOT EXISTS agent_message_handoffs_contact
    ON agent_message_handoffs(contact_id_sha256,created_at,handoff_id);
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

const SOURCE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS corpus_sources (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('imessage', 'bundle', 'x-archive')),
    kind_v4 TEXT CHECK (kind_v4 IN ('imessage', 'bundle', 'x-archive')),
    provider TEXT NOT NULL,
    network TEXT,
    account_id TEXT,
    external_id TEXT NOT NULL,
    input_revision TEXT NOT NULL,
    revision TEXT NOT NULL,
    generated_at TEXT,
    producer_json TEXT NOT NULL,
    coverage_json TEXT NOT NULL,
    manifest_sha256 TEXT,
    identity_json TEXT NOT NULL,
    warnings_json TEXT NOT NULL,
    ingested_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS conversation_sources (
    conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES corpus_sources(id) ON DELETE RESTRICT,
    external_id TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    UNIQUE (source_id, external_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS conversation_sources_lookup
    ON conversation_sources(source_id, conversation_id);
  CREATE TABLE IF NOT EXISTS message_provenance (
    message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES corpus_sources(id) ON DELETE RESTRICT,
    external_id TEXT NOT NULL,
    reply_to_external_id TEXT,
    attachments_json TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    UNIQUE (source_id, external_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS message_provenance_source
    ON message_provenance(source_id, message_id);
  CREATE TABLE IF NOT EXISTS corpus_reaction_facts (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES corpus_sources(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    target_external_id TEXT NOT NULL,
    conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
    direction TEXT CHECK (direction IN ('incoming','outgoing')),
    body TEXT NOT NULL,
    reacted_at TEXT,
    state TEXT NOT NULL CHECK (state IN ('active','removed')),
    UNIQUE (source_id, external_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS corpus_reaction_facts_source
    ON corpus_reaction_facts(source_id,conversation_id,id);
  CREATE TABLE IF NOT EXISTS corpus_source_records (
    source_id TEXT NOT NULL REFERENCES corpus_sources(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (
      kind IN ('account','participant','reaction','tombstone','excluded-message')
    ),
    external_id TEXT NOT NULL,
    record_json TEXT NOT NULL,
    PRIMARY KEY (source_id, kind, external_id)
  ) WITHOUT ROWID, STRICT;
  CREATE TABLE IF NOT EXISTS corpus_source_suppressions (
    source_id TEXT NOT NULL REFERENCES corpus_sources(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (
      kind IN ('conversation','message','reaction','reaction-timeline','participant','account')
    ),
    local_id TEXT NOT NULL,
    external_id TEXT NOT NULL,
    suppressed_at TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (
      reason IN ('authoritative-absence','tombstone','explicit-exclusion','replacement','reappeared')
    ),
    suppressed INTEGER NOT NULL CHECK (suppressed IN (0,1)),
    PRIMARY KEY (source_id, kind, local_id)
  ) WITHOUT ROWID, STRICT;
  CREATE TABLE IF NOT EXISTS conversation_equivalences (
    duplicate_conversation_id TEXT PRIMARY KEY
      REFERENCES conversations(id) ON DELETE CASCADE,
    preferred_conversation_id TEXT NOT NULL
      REFERENCES conversations(id) ON DELETE RESTRICT,
    duplicate_source_id TEXT NOT NULL
      REFERENCES corpus_sources(id) ON DELETE CASCADE,
    preferred_source_id TEXT NOT NULL
      REFERENCES corpus_sources(id) ON DELETE RESTRICT,
    basis TEXT NOT NULL CHECK (basis='exact-message-overlap'),
    plan_evidence_sha256 TEXT NOT NULL,
    match_sha256 TEXT NOT NULL,
    established_at TEXT NOT NULL,
    CHECK (duplicate_conversation_id <> preferred_conversation_id),
    CHECK (duplicate_source_id <> preferred_source_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS conversation_equivalences_preferred
    ON conversation_equivalences(preferred_conversation_id,duplicate_conversation_id);
  CREATE TABLE IF NOT EXISTS message_equivalences (
    duplicate_message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    preferred_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
    duplicate_source_id TEXT NOT NULL
      REFERENCES corpus_sources(id) ON DELETE CASCADE,
    preferred_source_id TEXT NOT NULL
      REFERENCES corpus_sources(id) ON DELETE RESTRICT,
    basis TEXT NOT NULL CHECK (basis='exact-message-overlap'),
    plan_evidence_sha256 TEXT NOT NULL,
    match_sha256 TEXT NOT NULL,
    established_at TEXT NOT NULL,
    UNIQUE (preferred_message_id),
    CHECK (duplicate_message_id <> preferred_message_id),
    CHECK (duplicate_source_id <> preferred_source_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS message_equivalences_sources
    ON message_equivalences(duplicate_source_id,preferred_source_id);
  CREATE TABLE IF NOT EXISTS reaction_equivalences (
    duplicate_reaction_id TEXT PRIMARY KEY
      REFERENCES corpus_reaction_facts(id) ON DELETE CASCADE,
    preferred_reaction_id TEXT NOT NULL
      REFERENCES corpus_reaction_facts(id) ON DELETE RESTRICT,
    duplicate_source_id TEXT NOT NULL
      REFERENCES corpus_sources(id) ON DELETE CASCADE,
    preferred_source_id TEXT NOT NULL
      REFERENCES corpus_sources(id) ON DELETE RESTRICT,
    basis TEXT NOT NULL CHECK (basis='exact-message-overlap'),
    plan_evidence_sha256 TEXT NOT NULL,
    match_sha256 TEXT NOT NULL,
    established_at TEXT NOT NULL,
    UNIQUE (preferred_reaction_id),
    CHECK (duplicate_reaction_id <> preferred_reaction_id),
    CHECK (duplicate_source_id <> preferred_source_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS reaction_equivalences_sources
    ON reaction_equivalences(duplicate_source_id,preferred_source_id);
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

function sourceMessageMetadata(value: string, label: string): unknown {
  const stored = parsedJson(value, label);
  if (stored === null || typeof stored !== "object" || Array.isArray(stored)) return stored;
  const record = stored as Record<string, unknown>;
  if (
    Object.hasOwn(record, "metadata")
    && (Object.hasOwn(record, "providerSortKey") || Object.hasOwn(record, "sortKey"))
  ) return record.metadata;
  return stored;
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
  reply_state: "explicit" | "none" | "unavailable";
  edited_at: string | null;
  retracted_at: string | null;
  service: string | null;
  attachment_count: number;
}>;

function personScopeId(addressBookContactId: string): string {
  return `${PERSON_SCOPE_PREFIX}${addressBookContactId}`;
}

const ACTIVE_MESSAGE_EQUIVALENCE_EXCLUSION = `NOT EXISTS (
  SELECT 1 FROM message_equivalences equivalence
  JOIN message_provenance duplicate_provenance
    ON duplicate_provenance.message_id=equivalence.duplicate_message_id
  JOIN message_provenance preferred_provenance
    ON preferred_provenance.message_id=equivalence.preferred_message_id
  JOIN messages preferred_message
    ON preferred_message.id=equivalence.preferred_message_id
  JOIN conversation_equivalences current_conversation_equivalence
    ON current_conversation_equivalence.duplicate_conversation_id=message.conversation_id
      AND current_conversation_equivalence.preferred_conversation_id=preferred_message.conversation_id
      AND current_conversation_equivalence.duplicate_source_id=duplicate_provenance.source_id
      AND current_conversation_equivalence.preferred_source_id=preferred_provenance.source_id
  WHERE equivalence.duplicate_message_id=message.id
    AND equivalence.duplicate_source_id=duplicate_provenance.source_id
    AND equivalence.preferred_source_id=preferred_provenance.source_id
    AND preferred_message.sent_at=message.sent_at
    AND preferred_message.direction=message.direction
    AND preferred_message.body IS message.body
    AND preferred_message.kind=message.kind
    AND preferred_message.attachment_count=message.attachment_count
    AND NOT EXISTS (
      SELECT 1 FROM corpus_source_suppressions preferred_suppression
      WHERE preferred_suppression.source_id=preferred_provenance.source_id
        AND preferred_suppression.local_id=equivalence.preferred_message_id
        AND preferred_suppression.kind IN ('message','reaction','reaction-timeline')
        AND preferred_suppression.suppressed=1
    )
    AND NOT EXISTS (
      SELECT 1 FROM corpus_source_suppressions preferred_conversation_suppression
      WHERE preferred_conversation_suppression.source_id=preferred_provenance.source_id
        AND preferred_conversation_suppression.kind='conversation'
        AND preferred_conversation_suppression.local_id=preferred_message.conversation_id
        AND preferred_conversation_suppression.suppressed=1
    )
)`;

const ACTIVE_REACTION_EQUIVALENCE_EXCLUSION = `NOT EXISTS (
  SELECT 1 FROM reaction_equivalences equivalence
  JOIN corpus_reaction_facts preferred_reaction
    ON preferred_reaction.id=equivalence.preferred_reaction_id
  JOIN message_provenance duplicate_target
    ON duplicate_target.source_id=reaction.source_id
      AND duplicate_target.external_id=reaction.target_external_id
  JOIN message_provenance preferred_target
    ON preferred_target.source_id=preferred_reaction.source_id
      AND preferred_target.external_id=preferred_reaction.target_external_id
  JOIN messages duplicate_current_target
    ON duplicate_current_target.id=duplicate_target.message_id
  JOIN messages preferred_current_target
    ON preferred_current_target.id=preferred_target.message_id
  JOIN message_equivalences target_equivalence
    ON (target_equivalence.duplicate_message_id=duplicate_target.message_id
        AND target_equivalence.preferred_message_id=preferred_target.message_id)
      OR (target_equivalence.duplicate_message_id=preferred_target.message_id
        AND target_equivalence.preferred_message_id=duplicate_target.message_id)
  JOIN messages target_duplicate_message
    ON target_duplicate_message.id=target_equivalence.duplicate_message_id
  JOIN messages target_preferred_message
    ON target_preferred_message.id=target_equivalence.preferred_message_id
  JOIN conversation_equivalences current_conversation_equivalence
    ON (
      current_conversation_equivalence.duplicate_source_id=reaction.source_id
      AND current_conversation_equivalence.duplicate_conversation_id=reaction.conversation_id
      AND current_conversation_equivalence.preferred_source_id=preferred_reaction.source_id
      AND current_conversation_equivalence.preferred_conversation_id=preferred_reaction.conversation_id
    ) OR (
      current_conversation_equivalence.duplicate_source_id=preferred_reaction.source_id
      AND current_conversation_equivalence.duplicate_conversation_id=preferred_reaction.conversation_id
      AND current_conversation_equivalence.preferred_source_id=reaction.source_id
      AND current_conversation_equivalence.preferred_conversation_id=reaction.conversation_id
    )
  WHERE equivalence.duplicate_reaction_id=reaction.id
    AND equivalence.duplicate_source_id=reaction.source_id
    AND equivalence.preferred_source_id=preferred_reaction.source_id
    AND duplicate_current_target.conversation_id=reaction.conversation_id
    AND preferred_current_target.conversation_id=preferred_reaction.conversation_id
    AND preferred_reaction.state='active'
    AND preferred_reaction.body=reaction.body
    AND preferred_reaction.direction IS reaction.direction
    AND target_preferred_message.sent_at=target_duplicate_message.sent_at
    AND target_preferred_message.direction=target_duplicate_message.direction
    AND target_preferred_message.body IS target_duplicate_message.body
    AND target_preferred_message.kind=target_duplicate_message.kind
    AND target_preferred_message.attachment_count=target_duplicate_message.attachment_count
    AND NOT EXISTS (
      SELECT 1 FROM corpus_source_suppressions target_suppression
      WHERE target_suppression.source_id=preferred_target.source_id
        AND target_suppression.local_id=preferred_target.message_id
        AND target_suppression.kind IN ('message','reaction','reaction-timeline')
        AND target_suppression.suppressed=1
    )
    AND NOT EXISTS (
      SELECT 1 FROM corpus_source_suppressions preferred_suppression
      WHERE preferred_suppression.source_id=preferred_reaction.source_id
        AND preferred_suppression.kind='reaction'
        AND preferred_suppression.local_id=preferred_reaction.id
        AND preferred_suppression.suppressed=1
    )
    AND NOT EXISTS (
      SELECT 1 FROM corpus_source_suppressions preferred_conversation_suppression
      WHERE preferred_conversation_suppression.source_id=preferred_reaction.source_id
        AND preferred_conversation_suppression.kind='conversation'
        AND preferred_conversation_suppression.local_id=preferred_reaction.conversation_id
        AND preferred_conversation_suppression.suppressed=1
    )
)`;

function canonicalConversationId(database: Database, conversationId: string): string {
  return get<{ preferred_conversation_id: string }>(database, `
    SELECT preferred_conversation_id FROM conversation_equivalences
    WHERE duplicate_conversation_id=?
  `, conversationId)?.preferred_conversation_id ?? conversationId;
}

function equivalentConversationIds(database: Database, conversationId: string): readonly string[] {
  const canonicalId = canonicalConversationId(database, conversationId);
  const rows = all<{ id: string }>(database, `
    SELECT ? AS id
    UNION ALL
    SELECT duplicate_conversation_id AS id FROM conversation_equivalences
    WHERE preferred_conversation_id=?
    ORDER BY id
  `, canonicalId, canonicalId);
  if (rows.length > 10_000) {
    throw new CliError("invalid-data", `Conversation equivalence group ${canonicalId} is oversized`);
  }
  return Object.freeze(rows.map((row) => row.id));
}

function idPlaceholders(ids: readonly string[]): string {
  if (ids.length < 1 || ids.length > 10_000) {
    throw new CliError("internal", "Analysis scope has an invalid conversation count");
  }
  return ids.map(() => "?").join(",");
}

function activeConversationIds(database: Database, ids: readonly string[]): readonly string[] {
  const placeholders = idPlaceholders(ids);
  return Object.freeze(all<{ id: string }>(database, `
    SELECT conversation.id
    FROM conversations conversation
    JOIN conversation_sources ownership ON ownership.conversation_id=conversation.id
    WHERE conversation.id IN (${placeholders})
      AND NOT EXISTS (
        SELECT 1 FROM corpus_source_suppressions suppression
        WHERE suppression.source_id=ownership.source_id
          AND suppression.kind='conversation'
          AND suppression.local_id=conversation.id
          AND suppression.suppressed=1
      )
    ORDER BY conversation.id
  `, ...ids).map((row) => row.id));
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
  const expanded = new Set<string>();
  for (const row of rows) {
    for (const id of equivalentConversationIds(database, row.conversation_id)) expanded.add(id);
  }
  if (expanded.size === 0) return null;
  const conversationIds = activeConversationIds(database, [...expanded]);
  if (conversationIds.length === 0) return null;
  return Object.freeze({
    id: personScopeId(addressBookContactId),
    kind: "person",
    addressBookContactId,
    conversationIds,
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
  const canonicalId = canonicalConversationId(database, contactId);
  const conversationIds = activeConversationIds(database, equivalentConversationIds(database, canonicalId));
  if (conversationIds.length === 0) return null;
  const placeholders = idPlaceholders(conversationIds);
  const matches = all<{ contact_id: string }>(database, `
    SELECT DISTINCT contact_id FROM conversation_contact_scopes
    WHERE conversation_id IN (${placeholders}) ORDER BY contact_id
  `, ...conversationIds);
  if (matches.length > 1) {
    throw new CliError("invalid-data", `Equivalent conversation ${canonicalId} spans multiple contacts`);
  }
  if (matches[0] !== undefined) return personScope(database, matches[0].contact_id);
  return Object.freeze({
    id: canonicalId,
    kind: "conversation",
    addressBookContactId: null,
    conversationIds,
  });
}

function hasExactNativeWhatsAppProviderIdentity(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const provider = (value as { provider?: unknown }).provider;
  return provider !== null && typeof provider === "object" && !Array.isArray(provider)
    && (provider as Record<string, unknown>).id === "whatsapp"
    && (provider as Record<string, unknown>).version === "0.15.0";
}

function routeCandidatesForScope(
  database: Database,
  scope: AnalysisScope,
  privateDetails: boolean,
): readonly AgentMessageRouteCandidateV1[] {
  const placeholders = idPlaceholders(scope.conversationIds);
  const rows = all<{
    conversation_id: string;
    service: string | null;
    is_group: number;
    source_id: string;
    source_kind: "bundle" | "imessage" | "x-archive";
    provider: string;
    network: string | null;
    account_id: string | null;
    source_external_id: string;
    source_revision: string;
    conversation_external_id: string;
    producer_json: string;
    identity_json: string;
    duplicate_route: number;
  }>(database, `
    SELECT conversation.id AS conversation_id,conversation.service,conversation.is_group,
      source.id AS source_id,coalesce(source.kind_v4,source.kind) AS source_kind,
      source.provider,source.network,source.account_id,
      source.external_id AS source_external_id,source.revision AS source_revision,
      ownership.external_id AS conversation_external_id,source.producer_json,source.identity_json,
      EXISTS (
        SELECT 1 FROM conversation_equivalences equivalence
        WHERE equivalence.duplicate_conversation_id=conversation.id
      ) AS duplicate_route
    FROM conversations conversation
    JOIN conversation_sources ownership ON ownership.conversation_id=conversation.id
    JOIN corpus_sources source ON source.id=ownership.source_id
    WHERE conversation.id IN (${placeholders})
      AND NOT EXISTS (
        SELECT 1 FROM corpus_source_suppressions suppression
        WHERE suppression.source_id=ownership.source_id
          AND suppression.kind='conversation'
          AND suppression.local_id=conversation.id
          AND suppression.suppressed=1
      )
    ORDER BY source.provider,source.network,source.id,conversation.id
  `, ...scope.conversationIds);
  if (rows.length > 10_000) throw new CliError("invalid-data", "Contact has too many source conversations");
  return Object.freeze(rows.map((row) => {
    const archive = row.source_kind === "x-archive";
    const group = row.is_group === 1;
    const sourceIdentity = parsedJson(row.identity_json, `Source ${row.source_id} identity`);
    const nativeWhatsApp = row.source_kind === "bundle"
      && row.provider === "whatsapp"
      && row.network === "whatsapp"
      && row.producer_json === canonicalJson({ id: "wacli-local", version: "1.0.0" })
      && hasExactNativeWhatsAppProviderIdentity(sourceIdentity);
    const supportedBeeper = row.source_kind === "bundle" && row.provider === "beeper";
    const unsupportedRoute = row.source_kind === "bundle" && !supportedBeeper && !nativeWhatsApp;
    const superseded = row.duplicate_route === 1;
    if (privateDetails && !archive && row.source_kind === "bundle" && row.network === null) {
      throw new CliError("invalid-data", "Bundle route candidate has no provider network");
    }
    if (
      privateDetails
      && nativeWhatsApp
      && !/^(?:[1-9][0-9]{4,14}@s\.whatsapp\.net|[1-9][0-9]{4,19}@lid)$/u
        .test(row.conversation_external_id)
    ) {
      throw new CliError("invalid-data", "Native WhatsApp route candidate has no exact direct JID");
    }
    return Object.freeze({
      schemaVersion: 1,
      format: "message-like-me.source-conversation-route" as const,
      id: agentMessageRouteCandidateId(row.source_id, row.conversation_id),
      contactId: scope.id,
      sourceId: row.source_id,
      conversationId: row.conversation_id,
      sourceKind: row.source_kind,
      provider: row.provider,
      network: row.network,
      service: row.service,
      group,
      sourceRevision: row.source_revision,
      actionability: Object.freeze(archive
        ? { state: "evidence-only" as const, reason: "archive-source" as const }
        // Handoff v1 is intentionally direct-conversation only. Wrench can
        // independently bind exact provider groups; this local evidence
        // candidate cannot authorize one through the v1 Message Like Me seam.
        : group
          ? { state: "evidence-only" as const, reason: "group-conversation" as const }
          : superseded
            ? { state: "evidence-only" as const, reason: "superseded-route" as const }
            : unsupportedRoute
              ? { state: "evidence-only" as const, reason: "unsupported-route" as const }
          : {
            state: "wrench-binding-eligible" as const,
            reason: "requires-exact-wrench-binding" as const,
          }),
      privateBinding: privateDetails && !archive && !unsupportedRoute
        ? Object.freeze({
          sourceAccountId: row.account_id,
          sourceExternalId: row.source_external_id,
          coordinate: row.source_kind === "imessage"
            ? Object.freeze({
              kind: "imessageChat" as const,
              chatGuid: row.conversation_external_id,
              service: row.service,
              observedChatRowId: null,
            })
            : nativeWhatsApp
              ? Object.freeze({
                kind: "whatsappJid" as const,
                jid: row.conversation_external_id,
              })
              : Object.freeze({
                kind: "beeperConversation" as const,
                network: row.network!,
                conversationId: row.conversation_external_id,
              }),
        })
        : null,
    });
  }));
}

function messageRowsForScope(
  database: Database,
  scope: AnalysisScope,
  exactConversationId?: string,
  window: EvidenceWindow = UNBOUNDED_EVIDENCE_WINDOW,
): StoredMessageRow[] {
  if (exactConversationId !== undefined) {
    return all<StoredMessageRow>(database, `
      SELECT message.* FROM messages message
      JOIN message_provenance provenance ON provenance.message_id=message.id
      WHERE message.conversation_id=?
        AND (? IS NULL OR message.sent_at>=?) AND (? IS NULL OR message.sent_at<?)
        AND NOT EXISTS (
          SELECT 1 FROM corpus_source_suppressions suppression
          WHERE suppression.source_id=provenance.source_id
            AND suppression.local_id=message.id
            AND suppression.kind IN ('message','reaction','reaction-timeline')
            AND suppression.suppressed=1
        ) AND ${ACTIVE_MESSAGE_EQUIVALENCE_EXCLUSION}
      ORDER BY message.sent_at,message.source_row_id,message.id
    `, exactConversationId, window.after, window.after, window.before, window.before);
  }
  const placeholders = idPlaceholders(scope.conversationIds);
  return all<StoredMessageRow>(database, `
    SELECT message.* FROM messages message
    JOIN message_provenance provenance ON provenance.message_id=message.id
    WHERE message.conversation_id IN (${placeholders})
      AND (? IS NULL OR message.sent_at>=?) AND (? IS NULL OR message.sent_at<?)
      AND NOT EXISTS (
        SELECT 1 FROM corpus_source_suppressions suppression
        WHERE suppression.source_id=provenance.source_id
          AND suppression.local_id=message.id
          AND suppression.kind IN ('message','reaction','reaction-timeline')
          AND suppression.suppressed=1
      ) AND ${ACTIVE_MESSAGE_EQUIVALENCE_EXCLUSION}
    ORDER BY message.sent_at,message.source_row_id,message.id
  `,
  ...scope.conversationIds,
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
    replyState: row.reply_state,
    editedAt: row.edited_at,
    retractedAt: row.retracted_at,
    service: row.service,
    attachmentCount: row.attachment_count,
  };
}

type StoredReactionFactRow = Readonly<{
  id: string;
  external_id: string;
  target_external_id: string;
  conversation_id: string | null;
  direction: "incoming" | "outgoing" | null;
  body: string;
  reacted_at: string | null;
  state: "active" | "removed";
}>;

function reactionFactsForScope(
  database: Database,
  scope: AnalysisScope,
  window: EvidenceWindow = UNBOUNDED_EVIDENCE_WINDOW,
): CorpusReactionFact[] {
  const select = `SELECT reaction.id,reaction.external_id,reaction.target_external_id,
    reaction.conversation_id,reaction.direction,reaction.body,reaction.reacted_at,reaction.state
    FROM corpus_reaction_facts reaction`;
  const suppression = `NOT EXISTS (
    SELECT 1 FROM corpus_source_suppressions suppression
    WHERE suppression.source_id=reaction.source_id
      AND suppression.kind='reaction'
      AND suppression.local_id=reaction.id
      AND suppression.suppressed=1
  )`;
  const placeholders = idPlaceholders(scope.conversationIds);
  const rows = all<StoredReactionFactRow>(database, `${select}
    WHERE reaction.conversation_id IN (${placeholders}) AND reaction.state='active'
      AND ${suppression} AND ${ACTIVE_REACTION_EQUIVALENCE_EXCLUSION}
    ORDER BY reaction.reacted_at IS NULL,reaction.reacted_at,reaction.id`, ...scope.conversationIds);
  return rows.filter((row) => row.reacted_at === null
    ? window.after === null && window.before === null
    : (window.after === null || row.reacted_at >= window.after)
      && (window.before === null || row.reacted_at < window.before)).map((row) => ({
    id: row.id,
    externalId: row.external_id,
    targetExternalId: row.target_external_id,
    conversationId: row.conversation_id,
    direction: row.direction,
    body: row.body,
    reactedAt: row.reacted_at,
    state: row.state,
  }));
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
  const reactions = reactionFactsForScope(database, scope, window);
  return sha256(canonicalJson(
    reactions.length > 0
      ? {
        schemaVersion: 3,
        scopeId: scope.id,
        conversationIds,
        evidenceWindow: window,
        messages,
        reactions,
      }
      : window.after === null && window.before === null
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
  const placeholders = idPlaceholders(scope.conversationIds);
  const row = get<{
    first_message_at: string | null;
    last_message_at: string | null;
    message_count: number;
    incoming_count: number;
    outgoing_count: number;
  }>(database, `${select}
    FROM messages message
    JOIN message_provenance provenance ON provenance.message_id=message.id
    WHERE message.conversation_id IN (${placeholders}) AND NOT EXISTS (
      SELECT 1 FROM corpus_source_suppressions suppression
      WHERE suppression.source_id=provenance.source_id
        AND suppression.local_id=message.id
        AND suppression.kind IN ('message','reaction','reaction-timeline')
        AND suppression.suppressed=1
    ) AND ${ACTIVE_MESSAGE_EQUIVALENCE_EXCLUSION}`, ...scope.conversationIds);
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

function migrateStoreV4Columns(database: Database): void {
  addColumn(
    database,
    "messages",
    "reply_state TEXT NOT NULL DEFAULT 'none' CHECK (reply_state IN ('explicit','none','unavailable'))",
  );
  database.exec(`
    UPDATE messages SET reply_state=CASE
      WHEN reply_to_source_guid IS NULL THEN 'none' ELSE 'explicit' END
    WHERE reply_state<>'unavailable'
  `);
  addColumn(
    database,
    "corpus_sources",
    "kind_v4 TEXT CHECK (kind_v4 IN ('imessage','bundle','x-archive'))",
  );
  database.exec("UPDATE corpus_sources SET kind_v4=kind WHERE kind_v4 IS NULL");
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

function backfillLegacySource(database: Database): void {
  const conversations = get<{ value: number }>(
    database,
    "SELECT count(*) AS value FROM conversations",
  )?.value ?? 0;
  const assigned = get<{ value: number }>(
    database,
    "SELECT count(*) AS value FROM conversation_sources",
  )?.value ?? 0;
  if (assigned !== 0 && assigned !== conversations) {
    throw new CliError("invalid-data", "Local store has partially assigned corpus source ownership");
  }
  if (conversations === 0 || assigned === conversations) return;
  const revision = scalarText(database, "corpus_revision");
  if (revision === null || !/^[a-f0-9]{64}$/u.test(revision)) {
    throw new CliError("invalid-data", "Legacy local store has no valid corpus revision");
  }
  const identity = scalarText(database, "source_identity") ?? canonicalJson({ migrated: true });
  const warnings = scalarText(database, "warnings") ?? canonicalJson([]);
  const ingestedAt = scalarText(database, "ingested_at") ?? "1970-01-01T00:00:00.000Z";
  database.query(`
    INSERT INTO corpus_sources(
      id,kind,kind_v4,provider,network,account_id,external_id,input_revision,revision,generated_at,
      producer_json,coverage_json,manifest_sha256,identity_json,warnings_json,ingested_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    IMESSAGE_SOURCE_ID,
    "imessage",
    "imessage",
    "apple",
    null,
    null,
    "local-imessage",
    revision,
    revision,
    null,
    canonicalJson({ id: "message-like-me", version: "legacy" }),
    canonicalJson({ history: "complete-current-local", observedFrom: null, observedTo: null }),
    null,
    identity,
    warnings,
    ingestedAt,
  );
  database.exec(`
    INSERT INTO conversation_sources(conversation_id,source_id,external_id,metadata_json)
    SELECT id,'${IMESSAGE_SOURCE_ID}',source_key,'{}' FROM conversations;
  `);
  const rows = all<{
    id: string;
    source_guid: string;
    reply_to_source_guid: string | null;
    attachment_count: number;
  }>(database, `
    SELECT id,source_guid,reply_to_source_guid,attachment_count
    FROM messages ORDER BY id
  `);
  const insert = database.query(`
    INSERT INTO message_provenance(
      message_id,source_id,external_id,reply_to_external_id,attachments_json,metadata_json
    ) VALUES (?,?,?,?,?,?)
  `);
  for (const row of rows) {
    insert.run(
      row.id,
      IMESSAGE_SOURCE_ID,
      row.source_guid,
      row.reply_to_source_guid,
      canonicalJson({ count: row.attachment_count, detailsAvailable: false }),
      canonicalJson({ migrated: true }),
    );
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
  database.exec(SOURCE_SCHEMA);
  transaction(database, () => {
    migrateStoreV4Columns(database);
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
    backfillLegacySource(database);
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
    SELECT conversation.id,conversation.private_participants_json
    FROM conversations conversation
    JOIN conversation_sources ownership ON ownership.conversation_id=conversation.id
    WHERE conversation.is_group=0 AND NOT EXISTS (
      SELECT 1 FROM corpus_source_suppressions suppression
      WHERE suppression.source_id=ownership.source_id
        AND suppression.kind='conversation'
        AND suppression.local_id=conversation.id
        AND suppression.suppressed=1
    )
    ORDER BY conversation.id
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
  const conflicting = get<{ preferred_conversation_id: string }>(database, `
    SELECT equivalence.preferred_conversation_id
    FROM conversation_equivalences equivalence
    JOIN conversation_contact_scopes duplicate_scope
      ON duplicate_scope.conversation_id=equivalence.duplicate_conversation_id
    JOIN conversation_contact_scopes preferred_scope
      ON preferred_scope.conversation_id=equivalence.preferred_conversation_id
    WHERE duplicate_scope.contact_id<>preferred_scope.contact_id
    ORDER BY equivalence.preferred_conversation_id LIMIT 1
  `);
  if (conflicting !== null) {
    throw new CliError(
      "conflict",
      `Equivalent conversation ${conflicting.preferred_conversation_id} resolves to multiple contacts`,
    );
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

export type CrossSourceEquivalencePlan = Readonly<{
  duplicateSourceId: string;
  preferredSourceId: string;
  basis: "exact-message-overlap";
  /** Digest of the command's account and overlap proof, retained as provenance. */
  evidenceSha256: string;
  conversations: readonly Readonly<{
    duplicateConversationId: string;
    preferredConversationId: string;
  }>[];
  messages: readonly Readonly<{
    duplicateMessageId: string;
    preferredMessageId: string;
  }>[];
  reactions?: readonly Readonly<{
    duplicateReactionId: string;
    preferredReactionId: string;
  }>[];
}>;

export type SourceOverlapEvidence = Readonly<{
  source: Readonly<{
    id: string;
    kind: "imessage" | "bundle" | "x-archive";
    provider: string;
    network: string | null;
    accountId: string | null;
    externalId: string;
    identity: unknown;
  }>;
  conversations: readonly Readonly<{
    id: string;
    externalId: string;
    privateLabel: string | null;
    service: string | null;
    participantIds: readonly string[];
    privateParticipants: readonly string[];
    group: boolean;
    metadata: unknown;
  }>[];
  messages: readonly Readonly<{
    id: string;
    externalId: string;
    conversationId: string;
    sentAt: string;
    direction: "incoming" | "outgoing";
    body: string | null;
    kind: CorpusMessage["kind"];
    replyToExternalId: string | null;
    replyState: CorpusMessage["replyState"];
    attachmentCount: number;
    attachments: unknown;
    metadata: unknown;
  }>[];
  reactions: readonly Readonly<{
    id: string;
    externalId: string;
    targetExternalId: string;
    conversationId: string | null;
    direction: "incoming" | "outgoing" | null;
    body: string;
    reactedAt: string | null;
  }>[];
  auxiliaryRecords: readonly Readonly<{
    kind: "account" | "participant";
    externalId: string;
    record: unknown;
  }>[];
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

function globalCorpusRevision(database: Database): string | null {
  const sources = all<{
    id: string;
    kind: "imessage" | "bundle" | "x-archive";
    input_revision: string;
    revision: string;
  }>(database, `SELECT id,coalesce(kind_v4,kind) AS kind,input_revision,revision
    FROM corpus_sources ORDER BY id`);
  if (sources.length === 0) return null;
  if (
    sources.length === 1
    && sources[0]!.id === IMESSAGE_SOURCE_ID
    && sources[0]!.kind === "imessage"
  ) return sources[0]!.input_revision;
  return sha256(canonicalJson({
    schemaVersion: 1,
    sources: sources.map(({ id, kind, revision }) => ({ id, kind, revision })),
  }));
}

function sourceStateRevision(database: Database, sourceId: string): string {
  const hash = createHash("sha256");
  hash.update("message-like-me\0stored-source-state-v1\0", "utf8");
  const append = (kind: string, row: Row): void => {
    const encoded = canonicalJson(row);
    hash.update(`${kind.length}:${kind}${encoded.length}:`, "utf8").update(encoded, "utf8");
  };
  const source = get<Row>(database, `
    SELECT coalesce(kind_v4,kind) AS kind,provider,network,account_id,external_id,producer_json,
      coverage_json,warnings_json
    FROM corpus_sources WHERE id=?
  `, sourceId);
  if (source === null) throw new CliError("internal", `Missing corpus source ${sourceId}`);
  append("source", source);
  for (const row of database.query(`
    SELECT conversation.id,conversation.source_key,conversation.private_label,
      conversation.service,conversation.participant_count,
      conversation.participant_ids_json,conversation.private_participants_json,
      conversation.is_group
    FROM conversation_sources ownership
    JOIN conversations conversation ON conversation.id=ownership.conversation_id
    WHERE ownership.source_id=?
    ORDER BY ownership.external_id,conversation.id
  `).iterate(sourceId) as Iterable<Row>) append("conversation", row);
  for (const row of database.query(`
    SELECT message.id,message.source_row_id,message.source_guid,message.conversation_id,
      message.sent_at,message.direction,message.body,message.body_source,message.kind,
      message.reply_to_source_guid,message.reply_state,
      message.edited_at,message.retracted_at,message.service,
      message.attachment_count,provenance.external_id,
      provenance.reply_to_external_id,provenance.attachments_json
    FROM message_provenance provenance
    JOIN messages message ON message.id=provenance.message_id
    WHERE provenance.source_id=?
    ORDER BY provenance.external_id,message.id
  `).iterate(sourceId) as Iterable<Row>) append("message", row);
  for (const row of database.query(`
    SELECT id,external_id,target_external_id,conversation_id,direction,body,reacted_at,state
    FROM corpus_reaction_facts WHERE source_id=? ORDER BY external_id,id
  `).iterate(sourceId) as Iterable<Row>) append("reaction-fact", row);
  for (const row of database.query(`
    SELECT kind,local_id,external_id,reason FROM corpus_source_suppressions
    WHERE source_id=? AND suppressed=1 ORDER BY kind,local_id
  `).iterate(sourceId) as Iterable<Row>) append("suppression", row);
  for (const row of database.query(`
    SELECT duplicate_conversation_id,preferred_conversation_id,basis,
      plan_evidence_sha256,match_sha256
    FROM conversation_equivalences WHERE duplicate_source_id=?
    ORDER BY duplicate_conversation_id
  `).iterate(sourceId) as Iterable<Row>) append("conversation-equivalence", row);
  for (const row of database.query(`
    SELECT duplicate_message_id,preferred_message_id,basis,
      plan_evidence_sha256,match_sha256
    FROM message_equivalences WHERE duplicate_source_id=?
    ORDER BY duplicate_message_id
  `).iterate(sourceId) as Iterable<Row>) append("message-equivalence", row);
  for (const row of database.query(`
    SELECT duplicate_reaction_id,preferred_reaction_id,duplicate_source_id,
      preferred_source_id,basis,plan_evidence_sha256,match_sha256
    FROM reaction_equivalences
    WHERE duplicate_source_id=? OR preferred_source_id=?
    ORDER BY duplicate_reaction_id
  `).iterate(sourceId, sourceId) as Iterable<Row>) append("reaction-equivalence", row);
  return hash.digest("hex");
}

type BundleMessageOrderRow = Readonly<{
  id: string;
  conversation_id: string;
  sent_at: string;
  kind: CorpusMessage["kind"];
  external_id: string;
  metadata_json: string;
}>;

type RankedBundleMessageOrderRow = BundleMessageOrderRow & Readonly<{
  provider_sort_key: string | null;
}>;

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function storedProviderSortKey(row: BundleMessageOrderRow): string | null {
  const parsed = parsedJson(row.metadata_json, `Message ${row.id} provenance`);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const value = "providerSortKey" in record ? record.providerSortKey : record.sortKey;
  return typeof value === "string" ? value : null;
}

function rerankBundleMessages(database: Database, sourceId: string): void {
  const rows = all<BundleMessageOrderRow>(database, `
    SELECT message.id,message.conversation_id,message.sent_at,message.kind,
      provenance.external_id,provenance.metadata_json
    FROM message_provenance provenance
    JOIN messages message ON message.id=provenance.message_id
    WHERE provenance.source_id=?
    ORDER BY message.conversation_id,message.id
  `, sourceId);
  const byConversation = new Map<string, RankedBundleMessageOrderRow[]>();
  for (const value of rows) {
    const row = Object.freeze({ ...value, provider_sort_key: storedProviderSortKey(value) });
    const values = byConversation.get(row.conversation_id) ?? [];
    values.push(row);
    byConversation.set(row.conversation_id, values);
  }
  const update = database.query("UPDATE messages SET source_row_id=? WHERE id=?");
  for (const values of byConversation.values()) {
    for (const [index, row] of values.entries()) update.run(-(index + 1), row.id);
    values.sort((left, right) => {
      const leftReaction = left.kind === "reaction";
      const rightReaction = right.kind === "reaction";
      if (leftReaction !== rightReaction) return leftReaction ? 1 : -1;
      if (!leftReaction) {
        const sort = compareCodeUnits(
          left.provider_sort_key ?? left.external_id,
          right.provider_sort_key ?? right.external_id,
        );
        if (sort !== 0) return sort;
      }
      return compareCodeUnits(left.sent_at, right.sent_at)
        || compareCodeUnits(left.external_id, right.external_id)
        || compareCodeUnits(left.id, right.id);
    });
    for (const [index, row] of values.entries()) update.run(index + 1, row.id);
  }
}

function setCorpusRevision(database: Database): string | null {
  const revision = globalCorpusRevision(database);
  if (revision === null) {
    database.query("DELETE FROM metadata WHERE key='corpus_revision'").run();
    return null;
  }
  database.query(`
    INSERT INTO metadata(key,value) VALUES ('corpus_revision',?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `).run(revision);
  return revision;
}

function validSourceDescriptor(source: CorpusSourceDescriptor): void {
  if (
    (source.id !== IMESSAGE_SOURCE_ID && !/^source_[a-f0-9]{64}$/u.test(source.id))
    || (source.kind !== "imessage" && source.kind !== "bundle" && source.kind !== "x-archive")
    || source.provider.length < 1
    || Buffer.byteLength(source.provider, "utf8") > 256
    || !/^[a-f0-9]{64}$/u.test(source.revision)
    || source.externalId.length < 1
    || Buffer.byteLength(source.externalId, "utf8") > 4_096
    || source.warnings.length > 130
  ) throw new CliError("invalid-data", `Corpus source ${source.id} is invalid`);
  canonicalTimestampOrNull(source.generatedAt, `Corpus source ${source.id} generatedAt`);
  if (source.kind !== "imessage" && source.generatedAt === null) {
    throw new CliError("invalid-data", `${source.kind} source ${source.id} requires generatedAt`);
  }
  canonicalTimestampOrNull(source.coverage.observedFrom, `Corpus source ${source.id} observedFrom`);
  canonicalTimestampOrNull(source.coverage.observedTo, `Corpus source ${source.id} observedTo`);
  if (
    (
      source.coverage.observedFrom !== null
      && source.coverage.observedTo !== null
      && source.coverage.observedFrom > source.coverage.observedTo
    )
  ) throw new CliError("invalid-data", `Corpus source ${source.id} has invalid coverage bounds`);
  if (
    source.coverage.history !== "complete-current-local"
    && source.coverage.history !== "bounded"
    && source.coverage.history !== "unknown"
  ) throw new CliError("invalid-data", `Corpus source ${source.id} has invalid history coverage`);
  if (
    (source.coverage.kind !== undefined && (
      source.coverage.kind.length < 1
      || Buffer.byteLength(source.coverage.kind, "utf8") > 128
      || /\p{Cc}/u.test(source.coverage.kind)
    ))
    || (source.coverage.reason !== undefined && source.coverage.reason !== null && (
      source.coverage.reason.length < 1
      || Buffer.byteLength(source.coverage.reason, "utf8") > 128
      || /\p{Cc}/u.test(source.coverage.reason)
    ))
  ) throw new CliError("invalid-data", `Corpus source ${source.id} has invalid coverage metadata`);
  if (
    source.manifestSha256 !== null
    && !/^[a-f0-9]{64}$/u.test(source.manifestSha256)
  ) throw new CliError("invalid-data", `Corpus source ${source.id} has an invalid manifest digest`);
  if (
    source.producer.id.length < 1
    || source.producer.version.length < 1
    || Buffer.byteLength(source.producer.id, "utf8") > 256
    || Buffer.byteLength(source.producer.version, "utf8") > 256
  ) throw new CliError("invalid-data", `Corpus source ${source.id} has invalid producer identity`);
  for (const warning of source.warnings) {
    if (Buffer.byteLength(warning, "utf8") > 1_024 || warning.includes("\u0000")) {
      throw new CliError("invalid-data", `Corpus source ${source.id} has an invalid warning`);
    }
  }
}

function validateSourceSnapshot(snapshot: SourceCorpusSnapshot): void {
  validSourceDescriptor(snapshot.source);
  if (
    snapshot.conversations.length > 2_000_000
    || snapshot.messages.length > 2_000_000
    || (snapshot.reactionFacts?.length ?? 0) > 2_000_000
    || snapshot.conversationProvenance.length !== snapshot.conversations.length
    || snapshot.messageProvenance.length !== snapshot.messages.length
  ) throw new CliError("invalid-data", `Corpus source ${snapshot.source.id} exceeds its result bounds`);
  const conversationIds = new Set(snapshot.conversations.map(({ id }) => id));
  if (conversationIds.size !== snapshot.conversations.length) {
    throw new CliError("invalid-data", `Corpus source ${snapshot.source.id} repeats conversation IDs`);
  }
  const conversationProvenance = new Map(
    snapshot.conversationProvenance.map((value) => [value.conversationId, value]),
  );
  if (
    conversationProvenance.size !== snapshot.conversationProvenance.length
    || [...conversationIds].some((id) => !conversationProvenance.has(id))
  ) throw new CliError("invalid-data", `Corpus source ${snapshot.source.id} has invalid conversation provenance`);
  const externalConversations = new Set<string>();
  for (const provenance of snapshot.conversationProvenance) {
    if (
      provenance.externalId.length < 1
      || Buffer.byteLength(provenance.externalId, "utf8") > 4_096
      || externalConversations.has(provenance.externalId)
    ) throw new CliError("invalid-data", `Corpus source ${snapshot.source.id} has invalid external conversation IDs`);
    externalConversations.add(provenance.externalId);
  }
  const messageIds = new Set(snapshot.messages.map(({ id }) => id));
  const messagesById = new Map(snapshot.messages.map((message) => [message.id, message]));
  if (messageIds.size !== snapshot.messages.length) {
    throw new CliError("invalid-data", `Corpus source ${snapshot.source.id} repeats message IDs`);
  }
  const messageRows = new Set<string>();
  for (const message of snapshot.messages) {
    if (!conversationIds.has(message.conversationId)) {
      throw new CliError("invalid-data", `Message ${message.id} references an unknown conversation`);
    }
    const rowCoordinate = `${message.conversationId}\0${message.sourceRowId}`;
    if (
      !Number.isSafeInteger(message.sourceRowId)
      || message.sourceRowId < 1
      || messageRows.has(rowCoordinate)
    ) throw new CliError("invalid-data", `Message ${message.id} has an invalid source row coordinate`);
    messageRows.add(rowCoordinate);
    if (
      (message.replyState === "explicit") !== (message.replyToSourceGuid !== null)
      || (
        message.replyState !== "explicit"
        && message.replyState !== "none"
        && message.replyState !== "unavailable"
      )
    ) throw new CliError("invalid-data", `Message ${message.id} has inconsistent reply observability`);
  }
  const messageProvenance = new Map(snapshot.messageProvenance.map((value) => [value.messageId, value]));
  if (
    messageProvenance.size !== snapshot.messageProvenance.length
    || [...messageIds].some((id) => !messageProvenance.has(id))
  ) throw new CliError("invalid-data", `Corpus source ${snapshot.source.id} has invalid message provenance`);
  const externalMessages = new Set<string>();
  for (const provenance of snapshot.messageProvenance) {
    const message = messagesById.get(provenance.messageId)!;
    if (
      provenance.externalId.length < 1
      || Buffer.byteLength(provenance.externalId, "utf8") > 4_096
      || externalMessages.has(provenance.externalId)
      || provenance.attachments.length > 256
      || (
        provenance.providerSortKey !== null
        && (
          provenance.providerSortKey.length < 1
          || Buffer.byteLength(provenance.providerSortKey, "utf8") > 1_024
          || /[\u0000-\u001f\u007f]/u.test(provenance.providerSortKey)
        )
      )
      || (
        snapshot.source.kind === "bundle"
          ? (message.kind === "reaction") === (provenance.providerSortKey !== null)
          : provenance.providerSortKey !== null
      )
    ) throw new CliError("invalid-data", `Corpus source ${snapshot.source.id} has invalid external message provenance`);
    externalMessages.add(provenance.externalId);
  }
  const auxiliaryIds = new Set<string>();
  for (const record of snapshot.auxiliaryRecords ?? []) {
    const key = `${record.kind}\0${record.id}`;
    if (
      !["account", "participant", "reaction", "tombstone", "excluded-message"].includes(record.kind)
      || record.id.length < 1
      || Buffer.byteLength(record.id, "utf8") > 4_096
      || auxiliaryIds.has(key)
    ) throw new CliError("invalid-data", `Corpus source ${snapshot.source.id} has invalid auxiliary records`);
    const encoded = canonicalJson(record.record);
    if (typeof encoded !== "string" || Buffer.byteLength(encoded, "utf8") > 2 * 1024 * 1024) {
      throw new CliError("invalid-data", `Corpus source ${snapshot.source.id} has an oversized auxiliary record`);
    }
    auxiliaryIds.add(key);
  }
  const reactionIds = new Set<string>();
  const externalReactionIds = new Set<string>();
  for (const reaction of snapshot.reactionFacts ?? []) {
    if (
      reaction.id.length < 1
      || reaction.externalId.length < 1
      || reaction.targetExternalId.length < 1
      || Buffer.byteLength(reaction.id, "utf8") > 4_096
      || Buffer.byteLength(reaction.externalId, "utf8") > 4_096
      || Buffer.byteLength(reaction.targetExternalId, "utf8") > 4_096
      || Buffer.byteLength(reaction.body, "utf8") > 8 * 1_024
      || reactionIds.has(reaction.id)
      || externalReactionIds.has(reaction.externalId)
      || (reaction.conversationId !== null && !conversationIds.has(reaction.conversationId))
      || (reaction.direction !== null && reaction.direction !== "incoming" && reaction.direction !== "outgoing")
      || (reaction.state !== "active" && reaction.state !== "removed")
    ) throw new CliError("invalid-data", `Corpus source ${snapshot.source.id} has invalid reaction facts`);
    canonicalTimestampOrNull(reaction.reactedAt, `Corpus source ${snapshot.source.id} reaction time`);
    reactionIds.add(reaction.id);
    externalReactionIds.add(reaction.externalId);
  }
  for (const deletion of snapshot.deletions ?? []) {
    if (
      ![
        "account", "participant", "conversation", "message", "reaction", "reaction-timeline",
      ].includes(deletion.entityKind)
      || deletion.externalId.length < 1
      || Buffer.byteLength(deletion.externalId, "utf8") > 4_096
      || (deletion.localEntityId !== null && Buffer.byteLength(deletion.localEntityId, "utf8") > 4_096)
      || (deletion.expectedConversationId !== undefined && (
        deletion.expectedConversationId.length < 1
        || Buffer.byteLength(deletion.expectedConversationId, "utf8") > 4_096
      ))
      || (deletion.reason !== undefined && ![
        "tombstone", "explicit-exclusion", "replacement",
      ].includes(deletion.reason))
    ) throw new CliError("invalid-data", `Corpus source ${snapshot.source.id} has an invalid deletion`);
    canonicalTimestampOrNull(deletion.deletedAt, `Corpus source ${snapshot.source.id} deletion time`);
  }
}

function validateEquivalencePlan(
  plan: CrossSourceEquivalencePlan,
  replacedSourceIds: ReadonlySet<string>,
): void {
  if (
    plan.basis !== "exact-message-overlap"
    || plan.duplicateSourceId === plan.preferredSourceId
    || !/^source_[a-f0-9]{64}$/u.test(plan.duplicateSourceId)
    || !/^source_[a-f0-9]{64}$/u.test(plan.preferredSourceId)
    || !/^[a-f0-9]{64}$/u.test(plan.evidenceSha256)
    || (
      !replacedSourceIds.has(plan.duplicateSourceId)
      && !replacedSourceIds.has(plan.preferredSourceId)
    )
    || plan.conversations.length < 1
    || plan.conversations.length > 100_000
    || plan.messages.length < 1
    || plan.messages.length > 2_000_000
    || (plan.reactions?.length ?? 0) > 2_000_000
  ) throw new CliError("invalid-data", "Cross-source equivalence plan is invalid or unbounded");
  const coordinates = (
    values: readonly Readonly<Record<string, string>>[],
    duplicateKey: string,
    preferredKey: string,
    label: string,
  ): void => {
    const duplicates = new Set<string>();
    const preferred = new Set<string>();
    for (const value of values) {
      const duplicateId = value[duplicateKey];
      const preferredId = value[preferredKey];
      if (
        duplicateId === undefined
        || preferredId === undefined
        || duplicateId.length < 1
        || preferredId.length < 1
        || Buffer.byteLength(duplicateId, "utf8") > 4_096
        || Buffer.byteLength(preferredId, "utf8") > 4_096
        || duplicateId === preferredId
        || duplicates.has(duplicateId)
        || preferred.has(preferredId)
      ) throw new CliError("invalid-data", `Cross-source equivalence repeats ${label} coordinates`);
      duplicates.add(duplicateId);
      preferred.add(preferredId);
    }
    if ([...duplicates].some((id) => preferred.has(id))) {
      throw new CliError("invalid-data", `Cross-source ${label} equivalence contains a chain`);
    }
  };
  coordinates(plan.conversations, "duplicateConversationId", "preferredConversationId", "conversation");
  coordinates(plan.messages, "duplicateMessageId", "preferredMessageId", "message");
  coordinates(plan.reactions ?? [], "duplicateReactionId", "preferredReactionId", "reaction");
}

type EquivalenceMessageRow = Readonly<{
  id: string;
  source_id: string;
  conversation_id: string;
  sent_at: string;
  direction: "incoming" | "outgoing";
  body: string | null;
  kind: CorpusMessage["kind"];
  attachment_count: number;
}>;

function applyEquivalencePlan(
  database: Database,
  plan: CrossSourceEquivalencePlan,
  establishedAt: string,
): void {
  const duplicateSource = get<{
    kind: string;
    network: string | null;
    provider: string;
    producer_json: string;
    identity_json: string;
  }>(database, `SELECT coalesce(kind_v4,kind) AS kind,network,provider,producer_json,identity_json
    FROM corpus_sources WHERE id=?`,
  plan.duplicateSourceId);
  const preferredSource = get<{
    kind: string;
    network: string | null;
    provider: string;
    producer_json: string;
    identity_json: string;
  }>(database, `SELECT coalesce(kind_v4,kind) AS kind,network,provider,producer_json,identity_json
    FROM corpus_sources WHERE id=?`,
  plan.preferredSourceId);
  const xArchivePair = (
    duplicateSource?.kind !== "x-archive"
    ? false
    : preferredSource?.kind === "bundle"
      && preferredSource.provider === "beeper"
      && duplicateSource.network === "x"
      && preferredSource.network === "x"
  );
  const whatsappPair = duplicateSource?.kind === "bundle"
    && duplicateSource.provider === "beeper"
    && duplicateSource.network === "whatsapp"
    && preferredSource?.kind === "bundle"
    && preferredSource.provider === "whatsapp"
    && preferredSource.network === "whatsapp"
    && preferredSource.producer_json === canonicalJson({ id: "wacli-local", version: "1.0.0" })
    && hasExactNativeWhatsAppProviderIdentity(parsedJson(
      preferredSource.identity_json,
      "Native WhatsApp source identity",
    ));
  if (!xArchivePair && !whatsappPair) {
    throw new CliError(
      "conflict",
      "Cross-source equivalence requires an allowed exact native-to-aggregate source pair",
    );
  }
  const conversationPairs = new Map(
    plan.conversations.map((pair) => [pair.duplicateConversationId, pair.preferredConversationId]),
  );
  const conversationMatchDigests = new Map<string, string[]>();
  const matchedMessages: Array<Readonly<{
    duplicate: EquivalenceMessageRow;
    preferred: EquivalenceMessageRow;
    matchSha256: string;
  }>> = [];
  for (const pair of plan.messages) {
    const message = (id: string): EquivalenceMessageRow | null => get<EquivalenceMessageRow>(database, `
      SELECT message.id,provenance.source_id,message.conversation_id,message.sent_at,
        message.direction,message.body,message.kind,message.attachment_count
      FROM messages message
      JOIN message_provenance provenance ON provenance.message_id=message.id
      WHERE message.id=?
    `, id);
    const duplicate = message(pair.duplicateMessageId);
    const preferred = message(pair.preferredMessageId);
    if (
      duplicate === null
      || preferred === null
      || duplicate.source_id !== plan.duplicateSourceId
      || preferred.source_id !== plan.preferredSourceId
      || conversationPairs.get(duplicate.conversation_id) !== preferred.conversation_id
      || duplicate.sent_at !== preferred.sent_at
      || duplicate.direction !== preferred.direction
      || duplicate.body !== preferred.body
      || duplicate.kind !== preferred.kind
      || duplicate.attachment_count !== preferred.attachment_count
    ) {
      throw new CliError(
        "conflict",
        `Message ${pair.duplicateMessageId} lacks an exact preferred-source fingerprint`,
      );
    }
    const fingerprintCounts = all<{ conversation_id: string; value: number }>(database, `
      SELECT conversation_id,count(*) AS value FROM messages
      WHERE conversation_id IN (?,?) AND sent_at=? AND direction=? AND body IS ?
        AND kind=? AND attachment_count=?
      GROUP BY conversation_id ORDER BY conversation_id
    `,
    duplicate.conversation_id,
    preferred.conversation_id,
    duplicate.sent_at,
    duplicate.direction,
    duplicate.body,
    duplicate.kind,
    duplicate.attachment_count);
    if (
      fingerprintCounts.length !== 2
      || fingerprintCounts.some((row) => row.value !== 1)
    ) throw new CliError(
      "conflict",
      `Message ${pair.duplicateMessageId} has an ambiguous cross-source fingerprint`,
    );
    const existingDuplicate = get<{ preferred_message_id: string }>(database, `
      SELECT preferred_message_id FROM message_equivalences WHERE duplicate_message_id=?
    `, duplicate.id);
    const existingPreferred = get<{ duplicate_message_id: string }>(database, `
      SELECT duplicate_message_id FROM message_equivalences WHERE preferred_message_id=?
    `, preferred.id);
    if (
      (existingDuplicate !== null && existingDuplicate.preferred_message_id !== preferred.id)
      || (existingPreferred !== null && existingPreferred.duplicate_message_id !== duplicate.id)
    ) throw new CliError("conflict", "A message already has a different equivalence coordinate");
    const matchSha256 = sha256(canonicalJson({
      schemaVersion: 1,
      duplicateMessageId: duplicate.id,
      preferredMessageId: preferred.id,
      sentAt: duplicate.sent_at,
      direction: duplicate.direction,
      body: duplicate.body,
      kind: duplicate.kind,
      attachmentCount: duplicate.attachment_count,
    }));
    const digests = conversationMatchDigests.get(duplicate.conversation_id) ?? [];
    digests.push(matchSha256);
    conversationMatchDigests.set(duplicate.conversation_id, digests);
    matchedMessages.push(Object.freeze({ duplicate, preferred, matchSha256 }));
  }
  const matchedConversations: Array<Readonly<{
    duplicateId: string;
    preferredId: string;
    matchSha256: string;
  }>> = [];
  for (const pair of plan.conversations) {
    const rows = all<{
      id: string;
      source_id: string;
      is_group: number;
      contact_id: string | null;
    }>(database, `
      SELECT conversation.id,ownership.source_id,conversation.is_group,association.contact_id
      FROM conversations conversation
      JOIN conversation_sources ownership ON ownership.conversation_id=conversation.id
      LEFT JOIN conversation_contact_scopes association
        ON association.conversation_id=conversation.id
      WHERE conversation.id IN (?,?) ORDER BY conversation.id
    `, pair.duplicateConversationId, pair.preferredConversationId);
    const duplicate = rows.find((row) => row.id === pair.duplicateConversationId);
    const preferred = rows.find((row) => row.id === pair.preferredConversationId);
    const digests = conversationMatchDigests.get(pair.duplicateConversationId) ?? [];
    if (
      duplicate === undefined
      || preferred === undefined
      || duplicate.source_id !== plan.duplicateSourceId
      || preferred.source_id !== plan.preferredSourceId
      || duplicate.is_group !== preferred.is_group
      || duplicate.is_group !== 0
      || digests.length < 1
      || (
        duplicate.contact_id !== null
        && preferred.contact_id !== null
        && duplicate.contact_id !== preferred.contact_id
      )
    ) throw new CliError(
      "conflict",
      "Conversation equivalence requires exact direct-peer identity and message overlap",
    );
    const existingDuplicate = get<{ preferred_conversation_id: string }>(database, `
      SELECT preferred_conversation_id FROM conversation_equivalences
      WHERE duplicate_conversation_id=?
    `, duplicate.id);
    const isExistingPreferred = get<{ value: number }>(database, `
      SELECT 1 AS value FROM conversation_equivalences WHERE duplicate_conversation_id=?
    `, preferred.id);
    const isExistingDuplicate = get<{ value: number }>(database, `
      SELECT 1 AS value FROM conversation_equivalences WHERE preferred_conversation_id=?
    `, duplicate.id);
    if (
      (existingDuplicate !== null && existingDuplicate.preferred_conversation_id !== preferred.id)
      || isExistingPreferred !== null
      || isExistingDuplicate !== null
    ) throw new CliError("conflict", "Conversation equivalence would form a chain");
    matchedConversations.push(Object.freeze({
      duplicateId: duplicate.id,
      preferredId: preferred.id,
      matchSha256: sha256(canonicalJson({
        schemaVersion: 1,
        duplicateConversationId: duplicate.id,
        preferredConversationId: preferred.id,
        messageMatches: digests.sort(),
      })),
    }));
  }
  const matchedReactions: Array<Readonly<{
    duplicateId: string;
    preferredId: string;
    duplicateSourceId: string;
    preferredSourceId: string;
    matchSha256: string;
  }>> = [];
  for (const pair of plan.reactions ?? []) {
    const rows = all<{
      id: string;
      source_id: string;
      target_external_id: string;
      direction: string | null;
      body: string;
      state: string;
    }>(database, `SELECT id,source_id,target_external_id,direction,body,state
      FROM corpus_reaction_facts WHERE id IN (?,?) ORDER BY id`,
    pair.duplicateReactionId, pair.preferredReactionId);
    const duplicate = rows.find((row) => row.id === pair.duplicateReactionId);
    const preferred = rows.find((row) => row.id === pair.preferredReactionId);
    if (
      duplicate === undefined
      || preferred === undefined
      || new Set([duplicate.source_id, preferred.source_id]).size !== 2
      || ![duplicate.source_id, preferred.source_id].includes(plan.duplicateSourceId)
      || ![duplicate.source_id, preferred.source_id].includes(plan.preferredSourceId)
      || duplicate.direction !== preferred.direction
      || duplicate.body !== preferred.body
      || duplicate.state !== "active"
      || preferred.state !== "active"
    ) throw new CliError("conflict", "Reaction equivalence lacks exact cross-source evidence");
    const duplicateTarget = get<{ message_id: string }>(database, `
      SELECT message_id FROM message_provenance WHERE source_id=? AND external_id=?
    `, duplicate.source_id, duplicate.target_external_id)?.message_id;
    const preferredTarget = get<{ message_id: string }>(database, `
      SELECT message_id FROM message_provenance WHERE source_id=? AND external_id=?
    `, preferred.source_id, preferred.target_external_id)?.message_id;
    const targetEquivalent = duplicateTarget !== undefined && preferredTarget !== undefined && (
      matchedMessages.some(({ duplicate: messageDuplicate, preferred: messagePreferred }) =>
        (messageDuplicate.id === duplicateTarget && messagePreferred.id === preferredTarget)
        || (messageDuplicate.id === preferredTarget && messagePreferred.id === duplicateTarget))
      || get<{ value: number }>(database, `SELECT 1 AS value FROM message_equivalences
          WHERE (duplicate_message_id=? AND preferred_message_id=?)
             OR (duplicate_message_id=? AND preferred_message_id=?)`,
        duplicateTarget, preferredTarget, preferredTarget, duplicateTarget) !== null
    );
    if (!targetEquivalent) {
      throw new CliError("conflict", "Reaction equivalence targets non-equivalent messages");
    }
    const duplicateMatches = get<{ value: number }>(database, `
      SELECT count(*) AS value FROM corpus_reaction_facts
      WHERE source_id=? AND target_external_id=? AND direction IS ? AND body=? AND state='active'
    `, duplicate.source_id, duplicate.target_external_id, duplicate.direction, duplicate.body)?.value ?? 0;
    const preferredMatches = get<{ value: number }>(database, `
      SELECT count(*) AS value FROM corpus_reaction_facts
      WHERE source_id=? AND target_external_id=? AND direction IS ? AND body=? AND state='active'
    `, preferred.source_id, preferred.target_external_id, preferred.direction, preferred.body)?.value ?? 0;
    if (duplicateMatches !== 1 || preferredMatches !== 1) {
      throw new CliError("conflict", "Reaction equivalence has ambiguous actor evidence");
    }
    matchedReactions.push(Object.freeze({
      duplicateId: duplicate.id,
      preferredId: preferred.id,
      duplicateSourceId: duplicate.source_id,
      preferredSourceId: preferred.source_id,
      matchSha256: sha256(canonicalJson({
        schemaVersion: 1,
        duplicateReactionId: duplicate.id,
        preferredReactionId: preferred.id,
        duplicateTarget,
        preferredTarget,
        direction: duplicate.direction,
        body: duplicate.body,
      })),
    }));
  }
  const upsertConversation = database.query(`
    INSERT INTO conversation_equivalences(
      duplicate_conversation_id,preferred_conversation_id,duplicate_source_id,
      preferred_source_id,basis,plan_evidence_sha256,match_sha256,established_at
    ) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(duplicate_conversation_id) DO UPDATE SET
      plan_evidence_sha256=excluded.plan_evidence_sha256,
      match_sha256=excluded.match_sha256,established_at=excluded.established_at
  `);
  for (const value of matchedConversations) upsertConversation.run(
    value.duplicateId,
    value.preferredId,
    plan.duplicateSourceId,
    plan.preferredSourceId,
    plan.basis,
    plan.evidenceSha256,
    value.matchSha256,
    establishedAt,
  );
  const upsertMessage = database.query(`
    INSERT INTO message_equivalences(
      duplicate_message_id,preferred_message_id,duplicate_source_id,
      preferred_source_id,basis,plan_evidence_sha256,match_sha256,established_at
    ) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(duplicate_message_id) DO UPDATE SET
      plan_evidence_sha256=excluded.plan_evidence_sha256,
      match_sha256=excluded.match_sha256,established_at=excluded.established_at
  `);
  for (const value of matchedMessages) upsertMessage.run(
    value.duplicate.id,
    value.preferred.id,
    plan.duplicateSourceId,
    plan.preferredSourceId,
    plan.basis,
    plan.evidenceSha256,
    value.matchSha256,
    establishedAt,
  );
  const upsertReaction = database.query(`
    INSERT INTO reaction_equivalences(
      duplicate_reaction_id,preferred_reaction_id,duplicate_source_id,
      preferred_source_id,basis,plan_evidence_sha256,match_sha256,established_at
    ) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(duplicate_reaction_id) DO UPDATE SET
      plan_evidence_sha256=excluded.plan_evidence_sha256,
      match_sha256=excluded.match_sha256,established_at=excluded.established_at
  `);
  for (const value of matchedReactions) upsertReaction.run(
    value.duplicateId,
    value.preferredId,
    value.duplicateSourceId,
    value.preferredSourceId,
    plan.basis,
    plan.evidenceSha256,
    value.matchSha256,
    establishedAt,
  );
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
    const encoded = get<{ identity_json: string }>(this.#database, `
      SELECT identity_json FROM corpus_sources WHERE id=?
    `, IMESSAGE_SOURCE_ID)?.identity_json ?? scalarText(this.#database, "source_identity");
    return encoded === null ? null : parsedJson(encoded, "Stored iMessage source identity");
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

  replaceSources(
    snapshots: readonly SourceCorpusSnapshot[],
    ingestedAt: string,
    hmacKey?: string | Uint8Array,
    equivalencePlan?: CrossSourceEquivalencePlan,
    progress?: (event: Readonly<{
      phase: "conversations" | "messages" | "reactions";
      completed: number;
      total: number;
    }>) => void,
  ): Readonly<{
    corpusRevision: string;
    sources: readonly Readonly<{
      id: string;
      changed: boolean;
      conversations: number;
      messages: number;
    }>[];
  }> {
    canonicalTimestampOrNull(ingestedAt, "Source ingest time");
    if (snapshots.length < 1) {
      throw new CliError("invalid-data", "A source replacement must contain at least one source");
    }
    const sourceIds = new Set<string>();
    for (const snapshot of snapshots) {
      if (sourceIds.has(snapshot.source.id)) {
        throw new CliError("invalid-data", `Source replacement repeats ${snapshot.source.id}`);
      }
      sourceIds.add(snapshot.source.id);
      validateSourceSnapshot(snapshot);
    }
    if (equivalencePlan !== undefined) validateEquivalencePlan(equivalencePlan, sourceIds);

    return transaction(this.#database, () => {
      const upsertSource = this.#database.query(`
        INSERT INTO corpus_sources(
          id,kind,kind_v4,provider,network,account_id,external_id,input_revision,revision,generated_at,
          producer_json,coverage_json,manifest_sha256,identity_json,warnings_json,ingested_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          kind=excluded.kind,kind_v4=excluded.kind_v4,
          provider=excluded.provider,network=excluded.network,
          account_id=excluded.account_id,external_id=excluded.external_id,
          input_revision=excluded.input_revision,generated_at=excluded.generated_at,
          producer_json=excluded.producer_json,coverage_json=excluded.coverage_json,
          manifest_sha256=excluded.manifest_sha256,identity_json=excluded.identity_json,
          warnings_json=excluded.warnings_json,ingested_at=excluded.ingested_at
      `);
      const relabelSourceConversations = this.#database.query(`
        UPDATE conversations SET service=?
        WHERE id IN (
          SELECT conversation_id FROM conversation_sources WHERE source_id=?
        )
      `);
      const relabelSourceMessages = this.#database.query(`
        UPDATE messages SET service=?
        WHERE id IN (
          SELECT message_id FROM message_provenance WHERE source_id=?
        )
      `);
      const upsertConversation = this.#database.query(`
        INSERT INTO conversations(
          id,source_key,private_label,service,participant_count,
          participant_ids_json,private_participants_json,is_group
        ) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          source_key=excluded.source_key,private_label=excluded.private_label,
          service=excluded.service,participant_count=excluded.participant_count,
          participant_ids_json=excluded.participant_ids_json,
          private_participants_json=excluded.private_participants_json,is_group=excluded.is_group
      `);
      const upsertConversationSource = this.#database.query(`
        INSERT INTO conversation_sources(conversation_id,source_id,external_id,metadata_json)
        VALUES (?,?,?,?)
        ON CONFLICT(conversation_id) DO UPDATE SET
          external_id=excluded.external_id,metadata_json=excluded.metadata_json
      `);
      const upsertMessage = this.#database.query(`
        INSERT INTO messages(
          id,source_row_id,source_guid,conversation_id,sent_at,direction,
          body,body_source,kind,reply_to_source_guid,reply_state,edited_at,retracted_at,
          service,attachment_count
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          source_guid=excluded.source_guid,conversation_id=excluded.conversation_id,
          sent_at=excluded.sent_at,direction=excluded.direction,body=excluded.body,
          body_source=excluded.body_source,kind=excluded.kind,
          reply_to_source_guid=excluded.reply_to_source_guid,reply_state=excluded.reply_state,
          edited_at=excluded.edited_at,
          retracted_at=excluded.retracted_at,service=excluded.service,
          attachment_count=excluded.attachment_count
      `);
      const upsertMessageProvenance = this.#database.query(`
        INSERT INTO message_provenance(
          message_id,source_id,external_id,reply_to_external_id,attachments_json,metadata_json
        ) VALUES (?,?,?,?,?,?)
        ON CONFLICT(message_id) DO UPDATE SET
          external_id=excluded.external_id,reply_to_external_id=excluded.reply_to_external_id,
          attachments_json=excluded.attachments_json,metadata_json=excluded.metadata_json
      `);
      const upsertReactionFact = this.#database.query(`
        INSERT INTO corpus_reaction_facts(
          id,source_id,external_id,target_external_id,conversation_id,
          direction,body,reacted_at,state
        ) VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          external_id=excluded.external_id,target_external_id=excluded.target_external_id,
          conversation_id=excluded.conversation_id,direction=excluded.direction,
          body=excluded.body,reacted_at=excluded.reacted_at,state=excluded.state
      `);
      const upsertSourceRecord = this.#database.query(`
        INSERT INTO corpus_source_records(source_id,kind,external_id,record_json)
        VALUES (?,?,?,?)
        ON CONFLICT(source_id,kind,external_id) DO UPDATE SET record_json=excluded.record_json
      `);
      const setSuppression = this.#database.query(`
        INSERT INTO corpus_source_suppressions(
          source_id,kind,local_id,external_id,suppressed_at,reason,suppressed
        ) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(source_id,kind,local_id) DO UPDATE SET
          external_id=excluded.external_id,suppressed_at=excluded.suppressed_at,
          reason=excluded.reason,suppressed=excluded.suppressed
      `);
      const clearExternalSuppression = this.#database.query(`
        UPDATE corpus_source_suppressions
        SET suppressed_at=?,reason='reappeared',suppressed=0
        WHERE source_id=? AND kind=? AND external_id=? AND suppressed=1
      `);
      const results: Array<Readonly<{
        id: string;
        changed: boolean;
        conversations: number;
        messages: number;
      }>> = [];
      let changedAny = false;
      for (const snapshot of snapshots) {
        const existing = get<{
          kind: string;
          network: string | null;
          input_revision: string;
          revision: string;
          generated_at: string | null;
          manifest_sha256: string | null;
        }>(this.#database, `
          SELECT coalesce(kind_v4,kind) AS kind,network,input_revision,revision,
            generated_at,manifest_sha256
          FROM corpus_sources WHERE id=?
        `, snapshot.source.id);
        if (existing !== null && existing.kind !== snapshot.source.kind) {
          throw new CliError("conflict", `Source ${snapshot.source.id} changed kind`);
        }
        if (existing !== null && snapshot.source.kind !== "imessage") {
          if (existing.generated_at === null || snapshot.source.generatedAt! < existing.generated_at) {
            throw new CliError("conflict", `Source ${snapshot.source.id} snapshot is older than stored state`);
          }
          if (
            snapshot.source.generatedAt === existing.generated_at
            && (
              snapshot.source.revision !== existing.input_revision
              || snapshot.source.manifestSha256 !== existing.manifest_sha256
            )
          ) throw new CliError("conflict", `Source ${snapshot.source.id} reuses generatedAt for different input`);
        }
        const authoritative = snapshot.source.kind === "imessage"
          || (
            snapshot.source.kind === "bundle"
            && snapshot.source.coverage.history === "complete-current-local"
          );
        if (authoritative) {
          for (const row of this.#database.query(`
            SELECT conversation_id,external_id FROM conversation_sources WHERE source_id=?
          `).iterate(snapshot.source.id) as Iterable<{
            conversation_id: string;
            external_id: string;
          }>) {
            setSuppression.run(
              snapshot.source.id,
              "conversation",
              row.conversation_id,
              row.external_id,
              ingestedAt,
              "authoritative-absence",
              1,
            );
          }
          for (const row of this.#database.query(`
            SELECT id,external_id FROM corpus_reaction_facts WHERE source_id=?
          `).iterate(snapshot.source.id) as Iterable<{ id: string; external_id: string }>) {
            setSuppression.run(
              snapshot.source.id,
              "reaction",
              row.id,
              row.external_id,
              ingestedAt,
              "authoritative-absence",
              1,
            );
          }
          for (const row of this.#database.query(`
            SELECT provenance.message_id,provenance.external_id,message.kind
            FROM message_provenance provenance
            JOIN messages message ON message.id=provenance.message_id
            WHERE provenance.source_id=?
          `).iterate(snapshot.source.id) as Iterable<{
            message_id: string;
            external_id: string;
            kind: string;
          }>) {
            setSuppression.run(
              snapshot.source.id,
              row.kind === "reaction" ? "reaction" : "message",
              row.message_id,
              row.external_id,
              ingestedAt,
              "authoritative-absence",
              1,
            );
          }
        }
        upsertSource.run(
          snapshot.source.id,
          snapshot.source.kind === "x-archive" ? "bundle" : snapshot.source.kind,
          snapshot.source.kind,
          snapshot.source.provider,
          snapshot.source.network,
          snapshot.source.accountId,
          snapshot.source.externalId,
          snapshot.source.revision,
          existing?.revision ?? snapshot.source.revision,
          snapshot.source.generatedAt,
          canonicalJson(snapshot.source.producer),
          canonicalJson(snapshot.source.coverage),
          snapshot.source.manifestSha256,
          canonicalJson(snapshot.source.identity),
          canonicalJson(snapshot.source.warnings),
          ingestedAt,
        );
        if (existing !== null && existing.network !== snapshot.source.network) {
          relabelSourceConversations.run(snapshot.source.network, snapshot.source.id);
          relabelSourceMessages.run(snapshot.source.network, snapshot.source.id);
        }
        const conversationProvenance = new Map(
          snapshot.conversationProvenance.map((value) => [value.conversationId, value]),
        );
        let completedConversations = 0;
        for (const conversation of snapshot.conversations) {
          const owner = get<{ source_id: string }>(this.#database, `
            SELECT source_id FROM conversation_sources WHERE conversation_id=?
          `, conversation.id);
          if (owner !== null && owner.source_id !== snapshot.source.id) {
            throw new CliError("conflict", `Conversation ${conversation.id} belongs to another source`);
          }
          upsertConversation.run(
            conversation.id,
            conversation.sourceKey,
            conversation.privateLabel,
            conversation.service,
            conversation.participantCount,
            canonicalJson(conversation.participantIds),
            canonicalJson(conversation.privateParticipants),
            conversation.group ? 1 : 0,
          );
          const provenance = conversationProvenance.get(conversation.id)!;
          upsertConversationSource.run(
            conversation.id,
            snapshot.source.id,
            provenance.externalId,
            canonicalJson(provenance.metadata ?? {}),
          );
          clearExternalSuppression.run(
            ingestedAt,
            snapshot.source.id,
            "conversation",
            provenance.externalId,
          );
          completedConversations += 1;
          if (
            progress !== undefined
            && (
              completedConversations === snapshot.conversations.length
              || completedConversations % 10_000 === 0
            )
          ) progress({
            phase: "conversations",
            completed: completedConversations,
            total: snapshot.conversations.length,
          });
        }
        const messageProvenance = new Map(
          snapshot.messageProvenance.map((value) => [value.messageId, value]),
        );
        let completedMessages = 0;
        for (const message of snapshot.messages) {
          const owner = get<{ source_id: string; source_row_id: number }>(this.#database, `
            SELECT provenance.source_id,message.source_row_id
            FROM message_provenance provenance
            JOIN messages message ON message.id=provenance.message_id
            WHERE provenance.message_id=?
          `, message.id);
          if (owner !== null && owner.source_id !== snapshot.source.id) {
            throw new CliError("conflict", `Message ${message.id} belongs to another source`);
          }
          const preferredRowId = authoritative || existing === null ? message.sourceRowId : null;
          const preferredCollision = preferredRowId === null ? null : get<{ id: string }>(
            this.#database,
            "SELECT id FROM messages WHERE conversation_id=? AND source_row_id=?",
            message.conversationId,
            preferredRowId,
          );
          const sourceRowId = owner?.source_row_id ?? (
            preferredRowId !== null && preferredCollision === null
              ? preferredRowId
              : (get<{ value: number | null }>(this.#database, `
                SELECT max(source_row_id) AS value FROM messages WHERE conversation_id=?
              `, message.conversationId)?.value ?? 0) + 1
          );
          upsertMessage.run(
            message.id,
            sourceRowId,
            message.sourceGuid,
            message.conversationId,
            message.sentAt,
            message.direction,
            message.body,
            message.bodySource,
            message.kind,
            message.replyToSourceGuid,
            message.replyState,
            message.editedAt,
            message.retractedAt,
            message.service,
            message.attachmentCount,
          );
          const provenance = messageProvenance.get(message.id)!;
          upsertMessageProvenance.run(
            message.id,
            snapshot.source.id,
            provenance.externalId,
            provenance.replyToExternalId,
            canonicalJson(provenance.attachments),
            canonicalJson({
              providerSortKey: provenance.providerSortKey,
              metadata: provenance.metadata ?? {},
            }),
          );
          clearExternalSuppression.run(
            ingestedAt,
            snapshot.source.id,
            message.kind === "reaction" ? "reaction" : "message",
            provenance.externalId,
          );
          if (message.kind === "reaction") {
            clearExternalSuppression.run(
              ingestedAt,
              snapshot.source.id,
              "reaction-timeline",
              provenance.externalId,
            );
          }
          completedMessages += 1;
          if (
            progress !== undefined
            && (
              completedMessages === snapshot.messages.length
              || completedMessages % 10_000 === 0
            )
          ) progress({
            phase: "messages",
            completed: completedMessages,
            total: snapshot.messages.length,
          });
        }
        const reactions = snapshot.reactionFacts ?? [];
        let completedReactions = 0;
        for (const reaction of reactions) {
          const existingReaction = get<{ source_id: string; external_id: string }>(this.#database, `
            SELECT source_id,external_id FROM corpus_reaction_facts WHERE id=?
          `, reaction.id);
          if (
            existingReaction !== null
            && (
              existingReaction.source_id !== snapshot.source.id
              || existingReaction.external_id !== reaction.externalId
            )
          ) throw new CliError("conflict", `Reaction ${reaction.id} belongs to another source coordinate`);
          const conversationId = reaction.conversationId ?? get<{ conversation_id: string }>(
            this.#database,
            `SELECT message.conversation_id
             FROM message_provenance provenance
             JOIN messages message ON message.id=provenance.message_id
             WHERE provenance.source_id=? AND provenance.external_id=?`,
            snapshot.source.id,
            reaction.targetExternalId,
          )?.conversation_id ?? null;
          upsertReactionFact.run(
            reaction.id,
            snapshot.source.id,
            reaction.externalId,
            reaction.targetExternalId,
            conversationId,
            reaction.direction,
            reaction.body,
            reaction.reactedAt,
            reaction.state,
          );
          if (reaction.state === "active") {
            clearExternalSuppression.run(
              ingestedAt,
              snapshot.source.id,
              "reaction",
              reaction.externalId,
            );
            clearExternalSuppression.run(
              ingestedAt,
              snapshot.source.id,
              "reaction-timeline",
              reaction.externalId,
            );
          }
          completedReactions += 1;
          if (
            progress !== undefined
            && (
              completedReactions === reactions.length
              || completedReactions % 10_000 === 0
            )
          ) progress({
            phase: "reactions",
            completed: completedReactions,
            total: reactions.length,
          });
        }
        this.#database.query(`
          UPDATE corpus_reaction_facts AS reaction
          SET conversation_id=(
            SELECT message.conversation_id
            FROM message_provenance provenance
            JOIN messages message ON message.id=provenance.message_id
            WHERE provenance.source_id=reaction.source_id
              AND provenance.external_id=reaction.target_external_id
          )
          WHERE reaction.source_id=? AND reaction.conversation_id IS NULL
            AND EXISTS (
              SELECT 1 FROM message_provenance provenance
              WHERE provenance.source_id=reaction.source_id
                AND provenance.external_id=reaction.target_external_id
            )
        `).run(snapshot.source.id);
        for (const record of snapshot.auxiliaryRecords ?? []) {
          upsertSourceRecord.run(
            snapshot.source.id,
            record.kind,
            record.id,
            canonicalJson(record.record),
          );
        }
        for (const deletion of snapshot.deletions ?? []) {
          let localId = deletion.localEntityId;
          if (deletion.entityKind === "conversation") {
            const specifiedLocal = localId !== null;
            const target = localId === null
              ? get<{ conversation_id: string; external_id: string }>(this.#database, `
              SELECT conversation_id,external_id FROM conversation_sources
              WHERE source_id=? AND external_id=?
            `, snapshot.source.id, deletion.externalId)
              : get<{ conversation_id: string; external_id: string }>(this.#database, `
                SELECT conversation_id,external_id FROM conversation_sources
                WHERE source_id=? AND conversation_id=?
              `, snapshot.source.id, localId);
            if (target !== null) {
              if (target.external_id !== deletion.externalId) {
                throw new CliError("invalid-data", "A conversation deletion has mismatched coordinates");
              }
              localId = target.conversation_id;
            } else if (specifiedLocal) {
              throw new CliError("invalid-data", "A conversation deletion references an unknown local entity");
            }
          }
          if (deletion.entityKind === "message") {
            const specifiedLocal = localId !== null;
            const target = localId === null
              ? get<{
                message_id: string;
                external_id: string;
                conversation_id: string;
                kind: string;
              }>(this.#database, `
                SELECT provenance.message_id,provenance.external_id,
                  message.conversation_id,message.kind
                FROM message_provenance provenance
                JOIN messages message ON message.id=provenance.message_id
                WHERE provenance.source_id=? AND provenance.external_id=?
              `, snapshot.source.id, deletion.externalId)
              : get<{
                message_id: string;
                external_id: string;
                conversation_id: string;
                kind: string;
              }>(this.#database, `
                SELECT provenance.message_id,provenance.external_id,
                  message.conversation_id,message.kind
                FROM message_provenance provenance
                JOIN messages message ON message.id=provenance.message_id
                WHERE provenance.source_id=? AND provenance.message_id=?
              `, snapshot.source.id, localId);
            if (target !== null) {
              if (
                target.external_id !== deletion.externalId
                || target.kind === "reaction"
                || (
                  deletion.expectedConversationId !== undefined
                  && deletion.expectedConversationId !== target.conversation_id
                )
              ) throw new CliError("invalid-data", "A message deletion has mismatched coordinates");
              localId = target.message_id;
            } else if (specifiedLocal) {
              throw new CliError("invalid-data", "A message deletion references an unknown local entity");
            }
          }
          if (
            deletion.entityKind === "reaction"
            || deletion.entityKind === "reaction-timeline"
          ) {
            const specifiedLocal = localId !== null;
            const target = localId === null
              ? get<{
                id: string;
                external_id: string;
                conversation_id: string | null;
              }>(this.#database, `
                SELECT id,external_id,conversation_id FROM corpus_reaction_facts
                WHERE source_id=? AND external_id=?
              `, snapshot.source.id, deletion.externalId)
              : get<{
                id: string;
                external_id: string;
                conversation_id: string | null;
              }>(this.#database, `
                SELECT id,external_id,conversation_id FROM corpus_reaction_facts
                WHERE source_id=? AND id=?
              `, snapshot.source.id, localId);
            if (target !== null) {
              if (
                target.external_id !== deletion.externalId
                || (
                  deletion.expectedConversationId !== undefined
                  && deletion.expectedConversationId !== target.conversation_id
                )
              ) throw new CliError("invalid-data", "A reaction deletion has mismatched coordinates");
              localId = target.id;
            } else if (specifiedLocal) {
              throw new CliError("invalid-data", "A reaction deletion references an unknown local entity");
            }
          }
          setSuppression.run(
            snapshot.source.id,
            deletion.entityKind,
            localId ?? `external:${deletion.externalId}`,
            deletion.externalId,
            deletion.deletedAt,
            deletion.reason ?? "tombstone",
            1,
          );
        }
        if (snapshot.source.kind === "bundle") {
          rerankBundleMessages(this.#database, snapshot.source.id);
        }
        const equivalenceTriggerSourceId = equivalencePlan === undefined
          ? null
          : sourceIds.has(equivalencePlan.preferredSourceId)
            ? equivalencePlan.preferredSourceId
            : equivalencePlan.duplicateSourceId;
        if (equivalencePlan !== undefined && equivalenceTriggerSourceId === snapshot.source.id) {
          applyEquivalencePlan(this.#database, equivalencePlan, ingestedAt);
          const otherSourceId = snapshot.source.id === equivalencePlan.preferredSourceId
            ? equivalencePlan.duplicateSourceId
            : equivalencePlan.preferredSourceId;
          const otherRevision = get<{ revision: string }>(this.#database, `
            SELECT revision FROM corpus_sources WHERE id=?
          `, otherSourceId)?.revision;
          const otherStateRevision = sourceStateRevision(
            this.#database,
            otherSourceId,
          );
          this.#database.query("UPDATE corpus_sources SET revision=? WHERE id=?")
            .run(otherStateRevision, otherSourceId);
          changedAny ||= otherRevision !== otherStateRevision;
        }
        const stateRevision = sourceStateRevision(this.#database, snapshot.source.id);
        this.#database.query("UPDATE corpus_sources SET revision=? WHERE id=?")
          .run(stateRevision, snapshot.source.id);
        const changed = existing?.revision !== stateRevision;
        changedAny ||= changed;
        const counts = get<{ conversations: number; messages: number }>(this.#database, `
          SELECT count(distinct conversation.id) AS conversations,
            count(message.id) AS messages
          FROM conversation_sources ownership
          JOIN conversations conversation ON conversation.id=ownership.conversation_id
          LEFT JOIN messages message ON message.conversation_id=conversation.id
            AND NOT EXISTS (
              SELECT 1 FROM corpus_source_suppressions suppression
              WHERE suppression.source_id=ownership.source_id
                AND suppression.local_id=message.id
                AND suppression.kind IN ('message','reaction','reaction-timeline')
                AND suppression.suppressed=1
            ) AND ${ACTIVE_MESSAGE_EQUIVALENCE_EXCLUSION}
          WHERE ownership.source_id=?
            AND NOT EXISTS (
              SELECT 1 FROM corpus_source_suppressions suppression
              WHERE suppression.source_id=ownership.source_id
                AND suppression.local_id=conversation.id
                AND suppression.kind='conversation'
                AND suppression.suppressed=1
            )
        `, snapshot.source.id) ?? { conversations: 0, messages: 0 };
        results.push(Object.freeze({ id: snapshot.source.id, changed, ...counts }));
      }
      if (changedAny) rebuildConversationLabels(this.#database, hmacKey);
      const corpusRevision = setCorpusRevision(this.#database);
      if (corpusRevision === null) throw new CliError("internal", "Source replacement produced no corpus revision");
      return Object.freeze({ corpusRevision, sources: Object.freeze(results) });
    });
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
    if (!/^[a-f0-9]{64}$/u.test(snapshot.source.snapshotSha256)) {
      throw new CliError("invalid-data", "The iMessage reader returned an invalid corpus revision");
    }
    const observed = snapshot.messages.map(({ sentAt }) => sentAt).sort();
    const sourceSnapshot: SourceCorpusSnapshot = Object.freeze({
      source: Object.freeze({
        id: IMESSAGE_SOURCE_ID,
        kind: "imessage",
        provider: "apple",
        network: null,
        accountId: null,
        externalId: "local-imessage",
        revision: snapshot.source.snapshotSha256,
        generatedAt: null,
        producer: Object.freeze({ id: "message-like-me", version: "imessage-reader-v1" }),
        coverage: Object.freeze({
          history: "complete-current-local",
          observedFrom: observed[0] ?? null,
          observedTo: observed.at(-1) ?? null,
        }),
        manifestSha256: null,
        identity: snapshot.source,
        warnings: snapshot.warnings,
      }),
      conversations: snapshot.conversations,
      conversationProvenance: Object.freeze(snapshot.conversations.map((conversation) => ({
        conversationId: conversation.id,
        externalId: conversation.sourceKey,
      }))),
      messages: snapshot.messages,
      messageProvenance: Object.freeze(snapshot.messages.map((message) => ({
        messageId: message.id,
        externalId: message.sourceGuid,
        providerSortKey: null,
        replyToExternalId: message.replyToSourceGuid,
        attachments: Object.freeze(Array.from({ length: message.attachmentCount }, (_value, index) => ({
          id: `unavailable-${index + 1}`,
          kind: null,
          mimeType: null,
          fileName: null,
          bytes: null,
        }))),
      }))),
    });
    const replaced = this.replaceSources([sourceSnapshot], ingestedAt, hmacKey);
    transaction(this.#database, () => {
      const setMetadata = this.#database.query(`
        INSERT INTO metadata(key,value) VALUES (?,?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value
      `);
      for (const [key, value] of [
        ["source_identity", canonicalJson(snapshot.source)],
        ["ingested_at", ingestedAt],
        ["warnings", canonicalJson(snapshot.warnings)],
        ["corpus_schema_version", String(snapshot.schemaVersion)],
      ] as const) setMetadata.run(key, value);
    });
    return {
      corpusRevision: replaced.corpusRevision,
      conversations: snapshot.conversations.length,
      messages: snapshot.messages.length,
    };
  }

  listSources(privateDetails = false): ReadonlyArray<Readonly<{
    id: string;
    kind: "imessage" | "bundle" | "x-archive";
    provider: string;
    network: string | null;
    revision: string;
    generatedAt: string | null;
    ingestedAt: string;
    coverage: unknown;
    warningCount: number;
    conversations: number;
    messages: number;
    reactions: number;
    undatedReactions: number;
    accountId?: string | null;
    externalId?: string;
    manifestSha256?: string | null;
    inputRevision?: string;
    identity?: unknown;
    warnings?: unknown;
  }>> {
    const rows = all<{
      id: string;
      kind: "imessage" | "bundle" | "x-archive";
      provider: string;
      network: string | null;
      account_id: string | null;
      external_id: string;
      input_revision: string;
      revision: string;
      generated_at: string | null;
      coverage_json: string;
      manifest_sha256: string | null;
      identity_json: string;
      warnings_json: string;
      ingested_at: string;
      conversations: number;
      messages: number;
      reactions: number;
      undated_reactions: number;
    }>(this.#database, `
      SELECT source.id,coalesce(source.kind_v4,source.kind) AS kind,
        source.provider,source.network,source.account_id,source.external_id,
        source.input_revision,source.revision,source.generated_at,source.coverage_json,
        source.manifest_sha256,source.identity_json,source.warnings_json,source.ingested_at,
        count(distinct ownership.conversation_id) AS conversations,
        count(message.id) AS messages,
        CASE WHEN coalesce(source.kind_v4,source.kind) IN ('bundle','x-archive') THEN
          (SELECT count(*) FROM corpus_reaction_facts reaction
            WHERE reaction.source_id=source.id AND reaction.state='active'
              AND NOT EXISTS (
                SELECT 1 FROM corpus_source_suppressions suppression
                WHERE suppression.source_id=source.id AND suppression.kind='reaction'
                  AND suppression.local_id=reaction.id AND suppression.suppressed=1
              )
              AND NOT EXISTS (
                SELECT 1 FROM corpus_source_suppressions suppression
                WHERE suppression.source_id=source.id AND suppression.kind='conversation'
                  AND suppression.local_id=reaction.conversation_id
                  AND suppression.suppressed=1
              ) AND ${ACTIVE_REACTION_EQUIVALENCE_EXCLUSION})
          ELSE
          (SELECT count(*) FROM messages reaction_message
            JOIN message_provenance reaction_provenance
              ON reaction_provenance.message_id=reaction_message.id
            WHERE reaction_provenance.source_id=source.id
              AND reaction_message.kind='reaction' AND reaction_message.retracted_at IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM corpus_source_suppressions suppression
                WHERE suppression.source_id=source.id
                  AND suppression.kind IN ('message','reaction','reaction-timeline')
                  AND suppression.local_id=reaction_message.id AND suppression.suppressed=1
              )
              AND NOT EXISTS (
                SELECT 1 FROM corpus_source_suppressions suppression
                WHERE suppression.source_id=source.id AND suppression.kind='conversation'
                  AND suppression.local_id=reaction_message.conversation_id
                  AND suppression.suppressed=1
              ))
        END AS reactions,
        CASE WHEN coalesce(source.kind_v4,source.kind) IN ('bundle','x-archive') THEN
          (SELECT count(*) FROM corpus_reaction_facts reaction
            WHERE reaction.source_id=source.id AND reaction.state='active'
              AND reaction.reacted_at IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM corpus_source_suppressions suppression
                WHERE suppression.source_id=source.id AND suppression.kind='reaction'
                  AND suppression.local_id=reaction.id AND suppression.suppressed=1
              )
              AND NOT EXISTS (
                SELECT 1 FROM corpus_source_suppressions suppression
                WHERE suppression.source_id=source.id AND suppression.kind='conversation'
                  AND suppression.local_id=reaction.conversation_id
                  AND suppression.suppressed=1
              ) AND ${ACTIVE_REACTION_EQUIVALENCE_EXCLUSION})
          ELSE 0
        END AS undated_reactions
      FROM corpus_sources source
      LEFT JOIN conversation_sources ownership ON ownership.source_id=source.id
        AND NOT EXISTS (
          SELECT 1 FROM corpus_source_suppressions suppression
          WHERE suppression.source_id=source.id
            AND suppression.kind='conversation'
            AND suppression.local_id=ownership.conversation_id
            AND suppression.suppressed=1
        )
      LEFT JOIN messages message ON message.conversation_id=ownership.conversation_id
        AND NOT EXISTS (
          SELECT 1 FROM corpus_source_suppressions suppression
          WHERE suppression.source_id=source.id
            AND suppression.kind IN ('message','reaction','reaction-timeline')
            AND suppression.local_id=message.id
            AND suppression.suppressed=1
        ) AND ${ACTIVE_MESSAGE_EQUIVALENCE_EXCLUSION}
      GROUP BY source.id
      ORDER BY source.provider,source.network,source.id
    `);
    return rows.map((row) => {
      const warnings = parsedJson(row.warnings_json, `Source ${row.id} warnings`);
      if (!Array.isArray(warnings)) throw new CliError("invalid-data", `Source ${row.id} warnings are invalid`);
      return {
        id: row.id,
        kind: row.kind,
        provider: row.provider,
        network: row.network,
        revision: row.revision,
        generatedAt: row.generated_at,
        ingestedAt: row.ingested_at,
        coverage: parsedJson(row.coverage_json, `Source ${row.id} coverage`),
        warningCount: warnings.length,
        conversations: row.conversations,
        messages: row.messages,
        reactions: row.reactions,
        undatedReactions: row.undated_reactions,
        ...(privateDetails ? {
          accountId: row.account_id,
          externalId: row.external_id,
          manifestSha256: row.manifest_sha256,
          inputRevision: row.input_revision,
          identity: parsedJson(row.identity_json, `Source ${row.id} identity`),
          warnings,
        } : {}),
      };
    });
  }

  source(sourceId: string, privateDetails = false): ReturnType<LocalStore["listSources"]>[number] | null {
    if (sourceId.length < 1 || sourceId.length > 256) {
      throw new CliError("usage", "Source ID must be bounded non-empty text");
    }
    return this.listSources(privateDetails).find(({ id }) => id === sourceId) ?? null;
  }

  sourceOverlapEvidence(sourceId: string, maximumRecords = 250_000): SourceOverlapEvidence {
    if (
      !/^source_[a-f0-9]{64}$/u.test(sourceId)
      || !Number.isSafeInteger(maximumRecords)
      || maximumRecords < 1
      || maximumRecords > 500_000
    ) throw new CliError("usage", "Overlap evidence requires a valid source and bounded record limit");
    const source = get<{
      id: string;
      kind: "imessage" | "bundle" | "x-archive";
      provider: string;
      network: string | null;
      account_id: string | null;
      external_id: string;
      identity_json: string;
    }>(this.#database, `
      SELECT id,coalesce(kind_v4,kind) AS kind,provider,network,account_id,external_id,identity_json
      FROM corpus_sources WHERE id=?
    `, sourceId);
    if (source === null) throw new CliError("not-found", `Unknown source ${sourceId}`);
    const counts = get<{
      conversations: number;
      messages: number;
      reactions: number;
      auxiliary_records: number;
    }>(this.#database, `
      SELECT
        (SELECT count(*) FROM conversation_sources WHERE source_id=?) AS conversations,
        (SELECT count(*) FROM message_provenance WHERE source_id=?) AS messages,
        (SELECT count(*) FROM corpus_reaction_facts WHERE source_id=? AND state='active') AS reactions,
        (SELECT count(*) FROM corpus_source_records
          WHERE source_id=? AND kind IN ('account','participant')) AS auxiliary_records
    `, sourceId, sourceId, sourceId, sourceId)!;
    if (
      counts.conversations + counts.messages + counts.reactions + counts.auxiliary_records
      > maximumRecords
    ) throw new CliError(
      "conflict",
      `Source ${sourceId} exceeds the ${maximumRecords}-record overlap evidence bound`,
    );
    const conversations = all<{
      id: string;
      external_id: string;
      private_label: string | null;
      service: string | null;
      participant_ids_json: string;
      private_participants_json: string;
      is_group: number;
      metadata_json: string;
    }>(this.#database, `
      SELECT conversation.id,ownership.external_id,conversation.private_label,
        conversation.service,conversation.participant_ids_json,
        conversation.private_participants_json,conversation.is_group,ownership.metadata_json
      FROM conversation_sources ownership
      JOIN conversations conversation ON conversation.id=ownership.conversation_id
      WHERE ownership.source_id=? AND NOT EXISTS (
        SELECT 1 FROM corpus_source_suppressions suppression
        WHERE suppression.source_id=ownership.source_id
          AND suppression.kind='conversation'
          AND suppression.local_id=conversation.id
          AND suppression.suppressed=1
      )
      ORDER BY ownership.external_id,conversation.id
    `, sourceId).map((row) => Object.freeze({
      id: row.id,
      externalId: row.external_id,
      privateLabel: row.private_label,
      service: row.service,
      participantIds: Object.freeze(stringArray(
        row.participant_ids_json,
        `Conversation ${row.id} participant IDs`,
      )),
      privateParticipants: Object.freeze(stringArray(
        row.private_participants_json,
        `Conversation ${row.id} private participants`,
      )),
      group: row.is_group === 1,
      metadata: parsedJson(row.metadata_json, `Conversation ${row.id} metadata`),
    }));
    const messages = all<{
      id: string;
      external_id: string;
      conversation_id: string;
      sent_at: string;
      direction: "incoming" | "outgoing";
      body: string | null;
      kind: CorpusMessage["kind"];
      reply_to_external_id: string | null;
      reply_state: CorpusMessage["replyState"];
      attachment_count: number;
      attachments_json: string;
      metadata_json: string;
    }>(this.#database, `
      SELECT message.id,provenance.external_id,message.conversation_id,message.sent_at,
        message.direction,message.body,message.kind,provenance.reply_to_external_id,
        message.reply_state,message.attachment_count,provenance.attachments_json,
        provenance.metadata_json
      FROM message_provenance provenance
      JOIN messages message ON message.id=provenance.message_id
      WHERE provenance.source_id=? AND NOT EXISTS (
        SELECT 1 FROM corpus_source_suppressions suppression
        WHERE suppression.source_id=provenance.source_id
          AND suppression.local_id=message.id
          AND suppression.kind IN ('message','reaction','reaction-timeline')
          AND suppression.suppressed=1
      )
      ORDER BY message.sent_at,message.source_row_id,message.id
    `, sourceId).map((row) => Object.freeze({
      id: row.id,
      externalId: row.external_id,
      conversationId: row.conversation_id,
      sentAt: row.sent_at,
      direction: row.direction,
      body: row.body,
      kind: row.kind,
      replyToExternalId: row.reply_to_external_id,
      replyState: row.reply_state,
      attachmentCount: row.attachment_count,
      attachments: parsedJson(row.attachments_json, `Message ${row.id} attachments`),
      metadata: sourceMessageMetadata(row.metadata_json, `Message ${row.id} metadata`),
    }));
    const reactions = all<{
      id: string;
      external_id: string;
      target_external_id: string;
      conversation_id: string | null;
      direction: "incoming" | "outgoing" | null;
      body: string;
      reacted_at: string | null;
    }>(this.#database, `
      SELECT reaction.id,reaction.external_id,reaction.target_external_id,
        reaction.conversation_id,reaction.direction,reaction.body,reaction.reacted_at
      FROM corpus_reaction_facts reaction
      WHERE reaction.source_id=? AND reaction.state='active' AND NOT EXISTS (
        SELECT 1 FROM corpus_source_suppressions suppression
        WHERE suppression.source_id=reaction.source_id
          AND suppression.kind='reaction'
          AND suppression.local_id=reaction.id
          AND suppression.suppressed=1
      ) ORDER BY reaction.external_id,reaction.id
    `, sourceId).map((row) => Object.freeze({
      id: row.id,
      externalId: row.external_id,
      targetExternalId: row.target_external_id,
      conversationId: row.conversation_id,
      direction: row.direction,
      body: row.body,
      reactedAt: row.reacted_at,
    }));
    const auxiliaryRecords = all<{
      kind: "account" | "participant";
      external_id: string;
      record_json: string;
    }>(this.#database, `
      SELECT kind,external_id,record_json FROM corpus_source_records
      WHERE source_id=? AND kind IN ('account','participant')
      ORDER BY kind,external_id
    `, sourceId).map((row) => Object.freeze({
      kind: row.kind,
      externalId: row.external_id,
      record: parsedJson(row.record_json, `Source ${sourceId} ${row.kind} record`),
    }));
    return Object.freeze({
      source: Object.freeze({
        id: source.id,
        kind: source.kind,
        provider: source.provider,
        network: source.network,
        accountId: source.account_id,
        externalId: source.external_id,
        identity: parsedJson(source.identity_json, `Source ${source.id} identity`),
      }),
      conversations: Object.freeze(conversations),
      messages: Object.freeze(messages),
      reactions: Object.freeze(reactions),
      auxiliaryRecords: Object.freeze(auxiliaryRecords),
    });
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
      WITH conversation_members AS (
        SELECT conversation.id AS conversation_id,
          coalesce(equivalence.preferred_conversation_id,conversation.id) AS root_id,
          conversation.private_label,conversation.is_group,conversation.participant_count
        FROM conversations conversation
        JOIN conversation_sources ownership ON ownership.conversation_id=conversation.id
        LEFT JOIN conversation_equivalences equivalence
          ON equivalence.duplicate_conversation_id=conversation.id
        WHERE NOT EXISTS (
          SELECT 1 FROM corpus_source_suppressions suppression
          WHERE suppression.source_id=ownership.source_id
            AND suppression.kind='conversation'
            AND suppression.local_id=conversation.id
            AND suppression.suppressed=1
        )
      ), group_contacts AS (
        SELECT member.root_id,
          CASE WHEN count(distinct association.contact_id)=1
            THEN min(association.contact_id) ELSE NULL END AS contact_id
        FROM conversation_members member
        LEFT JOIN conversation_contact_scopes association
          ON association.conversation_id=member.conversation_id
        GROUP BY member.root_id
      ), scope_conversations AS (
        SELECT CASE WHEN group_contact.contact_id IS NULL THEN member.root_id
            ELSE '${PERSON_SCOPE_PREFIX}' || group_contact.contact_id END AS id,
          coalesce(root_label.private_label,root.private_label,
            member_label.private_label,member.private_label) AS private_label,
          CASE WHEN group_contact.contact_id IS NULL THEN 'conversation' ELSE 'person' END
            AS scope_kind,
          CASE WHEN group_contact.contact_id IS NULL THEN member.is_group ELSE 0 END AS is_group,
          CASE WHEN group_contact.contact_id IS NULL THEN member.participant_count ELSE 1 END
            AS participant_count,
          member.root_id,member.conversation_id
        FROM conversation_members member
        JOIN group_contacts group_contact ON group_contact.root_id=member.root_id
        JOIN conversations root ON root.id=member.root_id
        LEFT JOIN conversation_contact_labels root_label
          ON root_label.conversation_id=member.root_id
        LEFT JOIN conversation_contact_labels member_label
          ON member_label.conversation_id=member.conversation_id
      )
      SELECT scope.id,min(scope.private_label) AS private_label,
        max(scope.scope_kind) AS scope_kind,
        count(distinct scope.root_id) AS conversation_count,
        max(scope.is_group) AS is_group,max(scope.participant_count) AS participant_count,
        min(message.sent_at) AS first_message_at,max(message.sent_at) AS last_message_at,
        count(message.id) AS message_count,
        sum(CASE WHEN message.direction = 'incoming' THEN 1 ELSE 0 END) AS incoming_count,
        sum(CASE WHEN message.direction = 'outgoing' THEN 1 ELSE 0 END) AS outgoing_count
      FROM scope_conversations scope
      JOIN messages message ON message.conversation_id=scope.conversation_id
      JOIN message_provenance provenance ON provenance.message_id=message.id
      WHERE NOT EXISTS (
        SELECT 1 FROM corpus_source_suppressions suppression
        WHERE suppression.source_id=provenance.source_id
          AND suppression.local_id=message.id
          AND suppression.kind IN ('message','reaction','reaction-timeline')
          AND suppression.suppressed=1
      ) AND ${ACTIVE_MESSAGE_EQUIVALENCE_EXCLUSION}
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
    services: readonly string[];
  }) | null {
    const scope = analysisScope(this.#database, contactId);
    if (scope === null) return null;
    const placeholders = idPlaceholders(scope.conversationIds);
    const rows = all<{
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
      WHERE conversation.id IN (${placeholders})
      ORDER BY CASE WHEN conversation.id=? THEN 0 ELSE 1 END,conversation.id
    `, ...scope.conversationIds, scope.kind === "conversation" ? scope.id : "");
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
      sourceKey: scope.kind === "person" || scope.conversationIds.length > 1
        ? scope.id
        : first.source_key,
      privateLabel: privateLabels ? first.private_label : null,
      scopeKind: scope.kind,
      conversationCount: new Set(scope.conversationIds.map((id) =>
        canonicalConversationId(this.#database, id))).size,
      service: services.length === 1 ? services[0]! : null,
      services: Object.freeze(services.sort((left, right) =>
        left < right ? -1 : left > right ? 1 : 0)),
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
    reactions: CorpusReactionFact[];
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
        reactions: reactionFactsForScope(this.#database, scope, window),
      };
    });
  }

  routeCandidates(contactId: string, privateDetails = false): Readonly<{
    contactId: string;
    candidates: readonly AgentMessageRouteCandidateV1[];
  }> | null {
    if (contactId.length < 1 || contactId.length > 256) {
      throw new CliError("usage", "Invalid contact ID");
    }
    return readTransaction(this.#database, () => {
      const scope = analysisScope(this.#database, contactId);
      if (scope === null) return null;
      return Object.freeze({
        contactId: scope.id,
        candidates: routeCandidatesForScope(this.#database, scope, privateDetails),
      });
    });
  }

  handoffPreparation(contactId: string, routeCandidateId: string): Readonly<{
    contactId: string;
    candidate: AgentMessageRouteCandidateV1;
    corpusRevision: string;
    profileState: "current" | "missing" | "stale";
    profileEvidenceRevision: string | null;
  }> {
    if (routeCandidateId.length < 1 || routeCandidateId.length > 256) {
      throw new CliError("usage", "Invalid source-conversation route ID");
    }
    return readTransaction(this.#database, () => {
      const scope = analysisScope(this.#database, contactId);
      if (scope === null) throw new CliError("not-found", `Unknown contact ${contactId}`);
      const candidate = routeCandidatesForScope(this.#database, scope, false)
        .find(({ id }) => id === routeCandidateId);
      if (candidate === undefined) {
        throw new CliError("not-found", "The selected source-conversation route does not belong to this contact");
      }
      if (candidate.actionability.state !== "wrench-binding-eligible") {
        throw new CliError(
          "conflict",
          `The selected source-conversation route is evidence-only (${candidate.actionability.reason})`,
        );
      }
      const corpusRevision = scalarText(this.#database, "corpus_revision");
      if (corpusRevision === null) throw new CliError("invalid-data", "Stored conversations have no corpus revision");
      const storedProfile = this.profile(scope.id);
      return Object.freeze({
        contactId: scope.id,
        candidate,
        corpusRevision,
        profileState: storedProfile?.state ?? "missing",
        profileEvidenceRevision: storedProfile?.profile.schemaVersion === 2
          ? storedProfile.profile.evidence.evidenceRevision
          : null,
      });
    });
  }

  recordPreparedHandoff(value: unknown): ReturnType<LocalStore["handoffAudit"]> {
    const handoff = parseAgentMessageHandoffV1(value);
    transaction(this.#database, () => {
      const scope = analysisScope(this.#database, handoff.contact.contactId);
      if (scope === null || scope.id !== handoff.contact.contactId) {
        throw new CliError("conflict", "Handoff contact scope is no longer current");
      }
      const candidate = routeCandidatesForScope(this.#database, scope, false)
        .find(({ id }) => id === handoff.contact.routeCandidateId);
      if (
        candidate === undefined
        || candidate.sourceId !== handoff.contact.sourceId
        || candidate.conversationId !== handoff.contact.conversationId
        || candidate.actionability.state !== "wrench-binding-eligible"
      ) throw new CliError("conflict", "Handoff source-conversation route is no longer actionable");
      const corpusRevision = scalarText(this.#database, "corpus_revision");
      if (
        corpusRevision !== handoff.evidence.corpusRevision
        || candidate.sourceRevision !== handoff.evidence.sourceRevision
      ) throw new CliError("conflict", "Message evidence changed while the handoff was prepared");
      const storedProfile = this.profile(scope.id);
      const currentProfileState = storedProfile?.state ?? "missing";
      const currentProfileEvidenceRevision = storedProfile?.profile.schemaVersion === 2
        ? storedProfile.profile.evidence.evidenceRevision
        : null;
      if (
        currentProfileState !== handoff.evidence.profileState
        || currentProfileEvidenceRevision !== handoff.evidence.profileEvidenceRevision
      ) throw new CliError("conflict", "Style profile evidence changed while the handoff was prepared");
      this.#database.query(`
        INSERT INTO agent_message_handoffs(
          handoff_id,handoff_sha256,contact_id_sha256,route_candidate_id_sha256,
          source_id_sha256,conversation_id_sha256,
          corpus_revision,source_revision,profile_state,profile_evidence_revision,
          wrench_contract_hash,route_ref_sha256,context_ref_sha256,
          exact_data_revision_sha256,latest_message_revision_sha256,
          turn_digest_sha256,part_count,created_at,expires_at,state
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'prepared')
        ON CONFLICT(handoff_id) DO NOTHING
      `).run(
        handoff.handoffId,
        handoff.integrity.canonicalSha256,
        sha256(handoff.contact.contactId),
        sha256(handoff.contact.routeCandidateId),
        sha256(handoff.contact.sourceId),
        sha256(handoff.contact.conversationId),
        handoff.evidence.corpusRevision,
        handoff.evidence.sourceRevision,
        handoff.evidence.profileState,
        handoff.evidence.profileEvidenceRevision,
        handoff.wrench.contractHash,
        handoff.wrench.routeRefSha256,
        handoff.wrench.contextRefSha256,
        handoff.wrench.exactDataRevision,
        handoff.wrench.latestMessageRevision,
        wrenchMessagingTurnDigestV1(handoff),
        handoff.turn.bubbles.length,
        handoff.createdAt,
        handoff.expiresAt,
      );
      const stored = get<{ handoff_sha256: string }>(this.#database, `
        SELECT handoff_sha256 FROM agent_message_handoffs WHERE handoff_id=?
      `, handoff.handoffId);
      if (stored?.handoff_sha256 !== handoff.integrity.canonicalSha256) {
        throw new CliError("conflict", "Handoff ID is already bound to different evidence");
      }
    });
    return this.handoffAudit(handoff.handoffId);
  }

  recordHandoffReceipt(
    handoffId: string,
    value: unknown,
  ): ReturnType<LocalStore["handoffAudit"]> {
    if (!/^handoff_[a-f0-9]{64}$/u.test(handoffId)) {
      throw new CliError("usage", "Invalid handoff ID");
    }
    const receipt = parseWrenchMessagingReceiptBindingV1(value);
    transaction(this.#database, () => {
      const stored = get<{
        handoff_sha256: string;
        route_ref_sha256: string;
        context_ref_sha256: string;
        turn_digest_sha256: string;
        part_count: number;
        created_at: string;
        state: "prepared" | "recorded";
        receipt_sha256: string | null;
      }>(this.#database, `
        SELECT handoff_sha256,route_ref_sha256,context_ref_sha256,turn_digest_sha256,
          part_count,created_at,state,receipt_sha256
        FROM agent_message_handoffs WHERE handoff_id=?
      `, handoffId);
      if (stored === null) throw new CliError("not-found", `Unknown handoff ${handoffId}`);
      if (
        receipt.clientIntentSha256 !== stored.handoff_sha256
        || receipt.routeRefSha256 !== stored.route_ref_sha256
        || receipt.contextRefSha256 !== stored.context_ref_sha256
        || receipt.turnDigest !== stored.turn_digest_sha256
        || receipt.partCount !== stored.part_count
        || receipt.recordedAt < stored.created_at
      ) throw new CliError("conflict", "Wrench receipt does not bind the recorded handoff");
      if (stored.state === "recorded") {
        if (stored.receipt_sha256 === receipt.receiptSha256) return;
        throw new CliError("conflict", "Handoff already has a different Wrench receipt");
      }
      this.#database.query(`
        UPDATE agent_message_handoffs SET
          state='recorded',receipt_sha256=?,receipt_contract_hash=?,preview_digest_sha256=?,
          run_id_sha256=?,receipt_state=?,proven_part_count=?,recorded_at=?
        WHERE handoff_id=? AND state='prepared'
      `).run(
        receipt.receiptSha256,
        receipt.contractHash,
        receipt.previewDigest,
        sha256(receipt.runId),
        receipt.state,
        receipt.provenPartCount,
        receipt.recordedAt,
        handoffId,
      );
    });
    return this.handoffAudit(handoffId);
  }

  handoffAudit(handoffId: string): Readonly<{
    schemaVersion: 1;
    format: "message-like-me.agent-message-handoff-audit";
    handoffId: string;
    handoffSha256: string;
    contactIdSha256: string;
    routeCandidateIdSha256: string;
    sourceIdSha256: string;
    conversationIdSha256: string;
    corpusRevision: string;
    sourceRevision: string;
    profileState: "current" | "missing" | "stale";
    profileEvidenceRevision: string | null;
    wrenchContractHash: string;
    routeRefSha256: string;
    contextRefSha256: string;
    exactDataRevisionSha256: string;
    latestMessageRevisionSha256: string;
    turnDigest: string;
    partCount: number;
    createdAt: string;
    expiresAt: string;
    state: "prepared" | "recorded";
    receipt: Readonly<{
      contractHash: string;
      receiptSha256: string;
      previewDigest: string;
      runIdSha256: string;
      state: "submitted" | "failed" | "partial" | "indeterminate";
      provenPartCount: number;
      recordedAt: string;
    }> | null;
  }> {
    if (!/^handoff_[a-f0-9]{64}$/u.test(handoffId)) {
      throw new CliError("usage", "Invalid handoff ID");
    }
    const row = get<{
      handoff_id: string;
      handoff_sha256: string;
      contact_id_sha256: string;
      route_candidate_id_sha256: string;
      source_id_sha256: string;
      conversation_id_sha256: string;
      corpus_revision: string;
      source_revision: string;
      profile_state: "current" | "missing" | "stale";
      profile_evidence_revision: string | null;
      wrench_contract_hash: string;
      route_ref_sha256: string;
      context_ref_sha256: string;
      exact_data_revision_sha256: string;
      latest_message_revision_sha256: string;
      turn_digest_sha256: string;
      part_count: number;
      created_at: string;
      expires_at: string;
      state: "prepared" | "recorded";
      receipt_sha256: string | null;
      receipt_contract_hash: string | null;
      preview_digest_sha256: string | null;
      run_id_sha256: string | null;
      receipt_state: "submitted" | "failed" | "partial" | "indeterminate" | null;
      proven_part_count: number | null;
      recorded_at: string | null;
    }>(this.#database, `SELECT * FROM agent_message_handoffs WHERE handoff_id=?`, handoffId);
    if (row === null) throw new CliError("not-found", `Unknown handoff ${handoffId}`);
    const receipt = row.state === "recorded"
      ? Object.freeze({
        contractHash: row.receipt_contract_hash!,
        receiptSha256: row.receipt_sha256!,
        previewDigest: row.preview_digest_sha256!,
        runIdSha256: row.run_id_sha256!,
        state: row.receipt_state!,
        provenPartCount: row.proven_part_count!,
        recordedAt: row.recorded_at!,
      })
      : null;
    return Object.freeze({
      schemaVersion: 1,
      format: "message-like-me.agent-message-handoff-audit" as const,
      handoffId: row.handoff_id,
      handoffSha256: row.handoff_sha256,
      contactIdSha256: row.contact_id_sha256,
      routeCandidateIdSha256: row.route_candidate_id_sha256,
      sourceIdSha256: row.source_id_sha256,
      conversationIdSha256: row.conversation_id_sha256,
      corpusRevision: row.corpus_revision,
      sourceRevision: row.source_revision,
      profileState: row.profile_state,
      profileEvidenceRevision: row.profile_evidence_revision,
      wrenchContractHash: row.wrench_contract_hash,
      routeRefSha256: row.route_ref_sha256,
      contextRefSha256: row.context_ref_sha256,
      exactDataRevisionSha256: row.exact_data_revision_sha256,
      latestMessageRevisionSha256: row.latest_message_revision_sha256,
      turnDigest: row.turn_digest_sha256,
      partCount: row.part_count,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      state: row.state,
      receipt,
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
    sources: number;
    conversations: number;
    messages: number;
    activeMessages: number;
    conversationEquivalences: number;
    messageEquivalences: number;
    reactionEquivalences: number;
    profiles: number;
    handoffs: number;
    addressBookContacts: number;
    enrichedLabels: number;
  }> {
    const quick = get<{ quick_check: string }>(this.#database, "PRAGMA quick_check")?.quick_check ?? "unknown";
    const foreignKeys = all<Row>(this.#database, "PRAGMA foreign_key_check").length;
    const count = (table: "corpus_sources" | "conversations" | "messages" | "profiles" | "agent_message_handoffs" | "addressbook_contacts" | "conversation_contact_labels" | "conversation_equivalences" | "message_equivalences" | "reaction_equivalences") =>
      get<{ value: number }>(this.#database, `SELECT count(*) AS value FROM ${table}`)?.value ?? 0;
    const activeMessages = get<{ value: number }>(this.#database, `
      SELECT count(*) AS value FROM messages message
      JOIN message_provenance provenance ON provenance.message_id=message.id
      JOIN conversation_sources ownership ON ownership.conversation_id=message.conversation_id
      WHERE NOT EXISTS (
        SELECT 1 FROM corpus_source_suppressions suppression
        WHERE suppression.source_id=provenance.source_id
          AND suppression.local_id=message.id
          AND suppression.kind IN ('message','reaction','reaction-timeline')
          AND suppression.suppressed=1
      ) AND NOT EXISTS (
        SELECT 1 FROM corpus_source_suppressions suppression
        WHERE suppression.source_id=ownership.source_id
          AND suppression.kind='conversation'
          AND suppression.local_id=message.conversation_id
          AND suppression.suppressed=1
      ) AND ${ACTIVE_MESSAGE_EQUIVALENCE_EXCLUSION}
    `)?.value ?? 0;
    return {
      storeSchemaVersion: userVersion(this.#database),
      quickCheck: quick,
      foreignKeyViolations: foreignKeys,
      corpusRevision: this.corpusRevision(),
      contactsRevision: this.contactsRevision(),
      sources: count("corpus_sources"),
      conversations: count("conversations"),
      messages: count("messages"),
      activeMessages,
      conversationEquivalences: count("conversation_equivalences"),
      messageEquivalences: count("message_equivalences"),
      reactionEquivalences: count("reaction_equivalences"),
      profiles: count("profiles"),
      handoffs: count("agent_message_handoffs"),
      addressBookContacts: count("addressbook_contacts"),
      enrichedLabels: count("conversation_contact_labels"),
    };
  }
}
