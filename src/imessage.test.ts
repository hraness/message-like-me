import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decodeAttributedBody, readIMessageDatabase } from "./imessage.ts";

const APPLE_EPOCH_MILLISECONDS = Date.UTC(2001, 0, 1);
const TEST_HMAC_KEY = "synthetic-test-install-key-32-bytes";
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "message-like-me-imessage-"));
  temporaryDirectories.push(directory);
  return join(directory, "chat.db");
}

function bytes(...parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function encodedLength(length: number, width: 0 | 2 | 4 | 8): Uint8Array {
  if (width === 0) return Uint8Array.of(length);
  const marker = width === 2 ? 0x81 : width === 4 ? 0x82 : 0x83;
  const result = new Uint8Array(width + 1);
  result[0] = marker;
  let remaining = BigInt(length);
  for (let index = 0; index < width; index += 1) {
    result[index + 1] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return result;
}

function typedstreamPayload(payload: Uint8Array, width: 0 | 2 | 4 | 8 = 0): Uint8Array {
  const encoder = new TextEncoder();
  return bytes(
    Uint8Array.of(0x04, 0x0b),
    encoder.encode("streamtyped"),
    Uint8Array.of(0x81, 0xe8, 0x03),
    encoder.encode("NSString"),
    Uint8Array.of(0x01, 0x02, 0x03, 0x04, 0x2b),
    encodedLength(payload.byteLength, width),
    payload,
    Uint8Array.of(0x86),
  );
}

function typedstreamBody(text: string, width: 0 | 2 | 4 | 8 = 0): Uint8Array {
  return typedstreamPayload(new TextEncoder().encode(text), width);
}

function fileFingerprint(path: string): unknown {
  const metadata = statSync(path, { bigint: true });
  return {
    bytes: metadata.size,
    modified: metadata.mtimeNs,
    changed: metadata.ctimeNs,
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
  };
}

function appleNanoseconds(timestamp: string): bigint {
  return BigInt(Date.parse(timestamp) - APPLE_EPOCH_MILLISECONDS) * 1_000_000n;
}

type FixtureMessage = Readonly<{
  guid: string;
  service?: string | null;
  handleId?: number | null;
  sentAt: string;
  fromMe: 0 | 1;
  text?: string | null;
  attributedBody?: Uint8Array | null;
  itemType?: number;
  associatedType?: number;
  associatedGuid?: string | null;
  threadGuid?: string | null;
  replyGuid?: string | null;
  system?: 0 | 1;
  serviceMessage?: 0 | 1;
  spam?: 0 | 1;
  corrupt?: 0 | 1;
  editedAt?: string | null;
  retractedAt?: string | null;
  rawRetractedAt?: bigint;
  hasAttachments?: 0 | 1;
}>;

function insertMessage(database: Database, message: FixtureMessage): number {
  const result = database.query(`INSERT INTO message (
    guid,service,handle_id,date,is_from_me,text,attributedBody,item_type,
    associated_message_type,associated_message_guid,thread_originator_guid,
    reply_to_guid,is_system_message,is_service_message,is_spam,is_corrupt,
    date_edited,date_retracted,cache_has_attachments
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    message.guid,
    message.service ?? "iMessage",
    message.handleId ?? null,
    appleNanoseconds(message.sentAt),
    message.fromMe,
    message.text ?? null,
    message.attributedBody ?? null,
    message.itemType ?? 0,
    message.associatedType ?? 0,
    message.associatedGuid ?? null,
    message.threadGuid ?? null,
    message.replyGuid ?? null,
    message.system ?? 0,
    message.serviceMessage ?? 0,
    message.spam ?? 0,
    message.corrupt ?? 0,
    message.editedAt === undefined || message.editedAt === null
      ? null
      : appleNanoseconds(message.editedAt),
    message.rawRetractedAt
      ?? (message.retractedAt === undefined || message.retractedAt === null
        ? null
        : appleNanoseconds(message.retractedAt)),
    message.hasAttachments ?? 0,
  );
  return Number(result.lastInsertRowid);
}

function createFixture(path: string): void {
  const database = new Database(path, { create: true, strict: true });
  try {
    database.exec(`
      CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT NOT NULL, service TEXT);
      CREATE TABLE chat (
        ROWID INTEGER PRIMARY KEY,
        guid TEXT NOT NULL,
        style INTEGER NOT NULL,
        display_name TEXT,
        service_name TEXT
      );
      CREATE TABLE chat_handle_join (chat_id INTEGER NOT NULL, handle_id INTEGER NOT NULL);
      CREATE TABLE chat_message_join (chat_id INTEGER NOT NULL, message_id INTEGER NOT NULL);
      CREATE TABLE message (
        ROWID INTEGER PRIMARY KEY,
        guid TEXT NOT NULL,
        service TEXT,
        handle_id INTEGER,
        date INTEGER NOT NULL,
        is_from_me INTEGER NOT NULL,
        text TEXT,
        attributedBody BLOB,
        item_type INTEGER,
        associated_message_type INTEGER,
        associated_message_guid TEXT,
        thread_originator_guid TEXT,
        reply_to_guid TEXT,
        is_system_message INTEGER,
        is_service_message INTEGER,
        is_spam INTEGER,
        is_corrupt INTEGER,
        date_edited INTEGER,
        date_retracted INTEGER,
        cache_has_attachments INTEGER
      );
      CREATE TABLE message_attachment_join (message_id INTEGER NOT NULL, attachment_id INTEGER NOT NULL);
    `);
    database.query("INSERT INTO handle (ROWID,id,service) VALUES (?,?,?)")
      .run(1, "alice@example.com", "iMessage");
    database.query("INSERT INTO handle (ROWID,id,service) VALUES (?,?,?)")
      .run(2, "+15555550123", "iMessage");
    database.query("INSERT INTO chat (ROWID,guid,style,display_name,service_name) VALUES (?,?,?,?,?)")
      .run(1, "chat-direct-guid", 45, null, "iMessage");
    database.query("INSERT INTO chat (ROWID,guid,style,display_name,service_name) VALUES (?,?,?,?,?)")
      .run(2, "chat-group-guid", 43, "Weekend plans", "iMessage");
    database.query("INSERT INTO chat_handle_join (chat_id,handle_id) VALUES (?,?)").run(1, 1);
    database.query("INSERT INTO chat_handle_join (chat_id,handle_id) VALUES (?,?)").run(2, 1);
    database.query("INSERT INTO chat_handle_join (chat_id,handle_id) VALUES (?,?)").run(2, 2);

    const messages = [
      insertMessage(database, {
        guid: "direct-incoming-guid",
        handleId: 1,
        sentAt: "2024-01-01T00:00:00.000Z",
        fromMe: 0,
        text: "Are you free? And dinner?",
      }),
      insertMessage(database, {
        guid: "direct-attributed-guid",
        sentAt: "2024-01-01T00:00:30.000Z",
        fromMe: 1,
        attributedBody: typedstreamBody("yeah\ncould do seven"),
        threadGuid: "direct-incoming-guid",
        editedAt: "2024-01-01T00:01:00.000Z",
      }),
      insertMessage(database, {
        guid: "direct-reaction-guid",
        sentAt: "2024-01-01T00:00:40.000Z",
        fromMe: 1,
        text: "Loved “Are you free?”",
        associatedType: 2000,
        associatedGuid: "p:0/direct-incoming-guid",
      }),
      insertMessage(database, {
        guid: "direct-retracted-guid",
        sentAt: "2024-01-01T00:00:50.000Z",
        fromMe: 1,
        text: "PRIVATE RETRACTED BODY",
        retractedAt: "2024-01-01T00:01:10.000Z",
      }),
      insertMessage(database, {
        guid: "direct-malformed-retraction-guid",
        sentAt: "2024-01-01T00:00:55.000Z",
        fromMe: 1,
        text: "PRIVATE MALFORMED RETRACTION BODY",
        rawRetractedAt: -1n,
      }),
      insertMessage(database, {
        guid: "group-incoming-guid",
        handleId: 2,
        sentAt: "2024-01-02T10:00:00.000Z",
        fromMe: 0,
        text: "1. brunch?\n2. beach?",
      }),
      insertMessage(database, {
        guid: "group-reply-guid",
        sentAt: "2024-01-02T10:02:00.000Z",
        fromMe: 1,
        text: "brunch yes, beach maybe",
        replyGuid: "group-incoming-guid",
      }),
      insertMessage(database, {
        guid: "group-attachment-guid",
        handleId: 1,
        sentAt: "2024-01-02T10:03:00.000Z",
        fromMe: 0,
        hasAttachments: 1,
      }),
      insertMessage(database, {
        guid: "group-system-guid",
        sentAt: "2024-01-02T10:04:00.000Z",
        fromMe: 0,
        text: "PRIVATE SYSTEM BODY",
        itemType: 1,
        system: 1,
      }),
      insertMessage(database, {
        guid: "ambiguous-guid",
        sentAt: "2024-01-02T10:05:00.000Z",
        fromMe: 1,
        text: "lowest chat wins",
      }),
      insertMessage(database, {
        guid: "missing-sender-handle-guid",
        handleId: 999,
        sentAt: "2024-01-02T10:05:30.000Z",
        fromMe: 0,
        text: "synthetic orphaned sender handle",
      }),
      insertMessage(database, {
        guid: "spam-guid",
        handleId: 1,
        sentAt: "2024-01-02T10:06:00.000Z",
        fromMe: 0,
        text: "DO NOT LEAK THIS BODY",
        spam: 1,
      }),
      insertMessage(database, {
        guid: "corrupt-guid",
        handleId: 1,
        sentAt: "2024-01-02T10:07:00.000Z",
        fromMe: 0,
        text: "ANOTHER PRIVATE EXCLUDED BODY",
        corrupt: 1,
      }),
    ];
    const join = database.query("INSERT INTO chat_message_join (chat_id,message_id) VALUES (?,?)");
    join.run(1, messages[0]!);
    join.run(1, messages[1]!);
    join.run(1, messages[1]!); // A duplicate join must not duplicate the message.
    join.run(1, messages[2]!);
    join.run(1, messages[3]!);
    join.run(1, messages[4]!);
    join.run(2, messages[5]!);
    join.run(2, messages[6]!);
    join.run(2, messages[7]!);
    join.run(2, messages[8]!);
    join.run(2, messages[9]!);
    join.run(1, messages[9]!); // Lowest chat ROWID is selected deterministically.
    join.run(1, messages[10]!);
    join.run(1, messages[11]!);
    join.run(1, messages[12]!);
    const attachment = database.query(
      "INSERT INTO message_attachment_join (message_id,attachment_id) VALUES (?,?)",
    );
    attachment.run(messages[7]!, 91);
    attachment.run(messages[7]!, 91);
    attachment.run(messages[7]!, 92);
  } finally {
    database.close();
    chmodSync(path, 0o600);
  }
}

describe("decodeAttributedBody", () => {
  test("decodes literal and 0x81, 0x82, and 0x83 little-endian widths", () => {
    expect(decodeAttributedBody(typedstreamBody("literal"))).toBe("literal");
    expect(decodeAttributedBody(typedstreamBody("short", 2))).toBe("short");
    expect(decodeAttributedBody(typedstreamBody("medium", 4))).toBe("medium");
    expect(decodeAttributedBody(typedstreamBody("wide", 8))).toBe("wide");
    expect(decodeAttributedBody(typedstreamBody("x".repeat(130), 2))).toBe("x".repeat(130));
  });

  test("fails closed for malformed, untyped, and over-bound payloads", () => {
    expect(decodeAttributedBody(new TextEncoder().encode("NSString++++secret"))).toBeNull();
    expect(decodeAttributedBody(typedstreamBody("bounded"), 8)).toBeNull();
    expect(decodeAttributedBody(typedstreamBody("bounded"), 1_000, 3)).toBeNull();
    const truncated = typedstreamBody("truncated", 4).subarray(0, -4);
    expect(decodeAttributedBody(truncated)).toBeNull();
  });

  test("enforces the UTF-8 body bound after UTF-16 decoding", () => {
    const utf16 = Uint8Array.of(0xff, 0xfe, 0xac, 0x20, 0xac, 0x20, 0xac, 0x20);
    expect(decodeAttributedBody(typedstreamPayload(utf16), 1_000, 8)).toBeNull();
    expect(decodeAttributedBody(typedstreamPayload(utf16), 1_000, 9)).toBe("€€€");
  });
});

describe("readIMessageDatabase", () => {
  test("reads direct and group conversations with private provenance and deterministic joins", () => {
    const path = temporaryDatabasePath();
    createFixture(path);

    const snapshot = readIMessageDatabase(path, {
      hmacKey: TEST_HMAC_KEY,
      pageSize: 2,
    });
    const repeated = readIMessageDatabase(path, {
      hmacKey: TEST_HMAC_KEY,
      pageSize: 3,
    });

    expect(repeated).toEqual(snapshot);
    expect(snapshot.conversations).toHaveLength(2);
    expect(snapshot.messages).toHaveLength(11);
    expect(snapshot.source.physicalPath).toBe(realpathSync(path));
    expect(snapshot.source.schemaSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.source.snapshotSha256).toMatch(/^[a-f0-9]{64}$/);

    const direct = snapshot.conversations.find(({ sourceKey }) => sourceKey === "chat-direct-guid")!;
    const group = snapshot.conversations.find(({ sourceKey }) => sourceKey === "chat-group-guid")!;
    expect(direct).toMatchObject({ group: false, participantCount: 1, privateLabel: null });
    expect(group).toMatchObject({ group: true, participantCount: 2, privateLabel: "Weekend plans" });
    expect(direct.id).not.toContain("chat-direct-guid");
    expect(group.privateParticipants).toEqual(["alice@example.com", "+15555550123"]);
    expect(group.participantIds.every((id) => /^[a-f0-9]{64}$/u.test(id))).toBeTrue();

    const attributed = snapshot.messages.find(({ sourceGuid }) => sourceGuid === "direct-attributed-guid")!;
    expect(attributed).toMatchObject({
      body: "yeah\ncould do seven",
      bodySource: "attributed-body",
      kind: "text",
      replyToSourceGuid: "direct-incoming-guid",
      editedAt: "2024-01-01T00:01:00.000Z",
    });
    const fallbackReply = snapshot.messages.find(({ sourceGuid }) => sourceGuid === "group-reply-guid")!;
    expect(fallbackReply.replyToSourceGuid).toBe("group-incoming-guid");
    const reaction = snapshot.messages.find(({ sourceGuid }) => sourceGuid === "direct-reaction-guid")!;
    expect(reaction).toMatchObject({ kind: "reaction", body: null, bodySource: "unavailable" });
    expect(reaction.replyToSourceGuid).toBeNull();
    const retracted = snapshot.messages.find(({ sourceGuid }) => sourceGuid === "direct-retracted-guid")!;
    expect(retracted).toMatchObject({
      kind: "text",
      body: null,
      bodySource: "unavailable",
      retractedAt: "2024-01-01T00:01:10.000Z",
    });
    const malformedRetraction = snapshot.messages.find(({ sourceGuid }) =>
      sourceGuid === "direct-malformed-retraction-guid")!;
    expect(malformedRetraction).toMatchObject({
      kind: "text",
      body: null,
      bodySource: "unavailable",
      retractedAt: null,
    });
    const attachment = snapshot.messages.find(({ sourceGuid }) => sourceGuid === "group-attachment-guid")!;
    expect(attachment).toMatchObject({ kind: "attachment", attachmentCount: 2, body: null });
    const system = snapshot.messages.find(({ sourceGuid }) => sourceGuid === "group-system-guid")!;
    expect(system).toMatchObject({ kind: "system", body: null, bodySource: "unavailable" });
    const ambiguous = snapshot.messages.find(({ sourceGuid }) => sourceGuid === "ambiguous-guid")!;
    expect(ambiguous.conversationId).toBe(direct.id);
    const missingHandle = snapshot.messages.find(({ sourceGuid }) =>
      sourceGuid === "missing-sender-handle-guid")!;
    expect(missingHandle.direction).toBe("incoming");

    expect(snapshot.warnings).toEqual([
      "excluded spam or corrupt messages: 2",
      "messages joined to multiple conversations (lowest chat ROWID selected): 1",
      "incoming messages referencing missing sender handles: 1",
    ]);
    const warnings = JSON.stringify(snapshot.warnings);
    expect(warnings).not.toContain("DO NOT LEAK THIS BODY");
    expect(warnings).not.toContain("ANOTHER PRIVATE EXCLUDED BODY");
    expect(warnings).not.toContain("alice@example.com");
    expect(warnings).not.toContain("spam-guid");
    expect(warnings).not.toContain("corrupt-guid");
    expect(warnings).not.toMatch(/[a-f0-9]{64}/u);
    expect(JSON.stringify(snapshot.messages)).not.toContain("Loved “Are you free?”");
    expect(JSON.stringify(snapshot.messages)).not.toContain("PRIVATE RETRACTED BODY");
    expect(JSON.stringify(snapshot.messages)).not.toContain("PRIVATE MALFORMED RETRACTION BODY");
    expect(JSON.stringify(snapshot.messages)).not.toContain("PRIVATE SYSTEM BODY");

    const otherInstall = readIMessageDatabase(path, { hmacKey: "another-synthetic-install-key-32" });
    expect(otherInstall.messages.map(({ sourceGuid }) => sourceGuid)).toEqual(
      snapshot.messages.map(({ sourceGuid }) => sourceGuid),
    );
    expect(otherInstall.messages.map(({ id }) => id)).not.toEqual(snapshot.messages.map(({ id }) => id));
    expect(otherInstall.source.snapshotSha256).not.toBe(snapshot.source.snapshotSha256);
  });

  test("rejects symlinks and required-schema drift", () => {
    const path = temporaryDatabasePath();
    createFixture(path);
    const link = join(path, "..", "linked-chat.db");
    symlinkSync(path, link);
    expect(() => readIMessageDatabase(link, { hmacKey: TEST_HMAC_KEY })).toThrow("non-symlink");

    const malformed = temporaryDatabasePath();
    const database = new Database(malformed, { create: true });
    database.exec("CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT)");
    database.close();
    chmodSync(malformed, 0o600);
    expect(() => readIMessageDatabase(malformed, { hmacKey: TEST_HMAC_KEY }))
      .toThrow("message is missing required column service");
  });

  test("rejects a relative source path", () => {
    expect(() => readIMessageDatabase("relative-chat.db", { hmacKey: TEST_HMAC_KEY }))
      .toThrow("path must be absolute");
  });

  test("retains the schema warning alongside fixed aggregate categories", () => {
    const path = temporaryDatabasePath();
    createFixture(path);
    const database = new Database(path, { strict: true });
    database.exec("DROP TABLE message_attachment_join");
    database.close();

    expect(readIMessageDatabase(path, { hmacKey: TEST_HMAC_KEY }).warnings).toEqual([
      "message_attachment_join is unavailable; attachment counts are presence lower bounds",
      "excluded spam or corrupt messages: 2",
      "messages joined to multiple conversations (lowest chat ROWID selected): 1",
      "incoming messages referencing missing sender handles: 1",
    ]);
  });

  test("rejects weak installation keys and configured source bounds", () => {
    const path = temporaryDatabasePath();
    createFixture(path);
    expect(() => readIMessageDatabase(path, { hmacKey: "short" })).toThrow("HMAC key");
    expect(() => readIMessageDatabase(path, {
      hmacKey: TEST_HMAC_KEY,
      maxDatabaseBytes: 1,
    })).toThrow("size bound");
  });

  test("reads a live WAL snapshot without mutating the source database or sidecars", () => {
    const path = temporaryDatabasePath();
    createFixture(path);
    const writer = new Database(path, { strict: true });
    try {
      writer.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0");
      const rowId = insertMessage(writer, {
        guid: "wal-only-guid",
        sentAt: "2024-01-03T00:00:00.000Z",
        fromMe: 1,
        text: "visible from the WAL",
      });
      writer.query("INSERT INTO chat_message_join (chat_id,message_id) VALUES (?,?)").run(1, rowId);

      const members = [path, `${path}-wal`, `${path}-shm`];
      const before = members.map(fileFingerprint);
      const snapshot = readIMessageDatabase(path, { hmacKey: TEST_HMAC_KEY });
      const after = members.map(fileFingerprint);

      expect(snapshot.messages.some(({ sourceGuid }) => sourceGuid === "wal-only-guid")).toBeTrue();
      expect(after).toEqual(before);
    } finally {
      writer.close();
    }
  });

  test("does not create a missing shared-memory sidecar on a WAL source", () => {
    const path = temporaryDatabasePath();
    createFixture(path);
    const writer = new Database(path, { strict: true });
    try {
      writer.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0");
      const rowId = insertMessage(writer, {
        guid: "wal-without-shm-guid",
        sentAt: "2024-01-03T00:00:00.000Z",
        fromMe: 1,
        text: "the source SHM stays absent",
      });
      writer.query("INSERT INTO chat_message_join (chat_id,message_id) VALUES (?,?)").run(1, rowId);
      rmSync(`${path}-shm`);
      expect(existsSync(`${path}-shm`)).toBeFalse();

      const beforeDatabase = fileFingerprint(path);
      const beforeWal = fileFingerprint(`${path}-wal`);
      const snapshot = readIMessageDatabase(path, { hmacKey: TEST_HMAC_KEY });

      expect(snapshot.messages.some(({ sourceGuid }) => sourceGuid === "wal-without-shm-guid"))
        .toBeTrue();
      expect(existsSync(`${path}-shm`)).toBeFalse();
      expect(fileFingerprint(path)).toEqual(beforeDatabase);
      expect(fileFingerprint(`${path}-wal`)).toEqual(beforeWal);
    } finally {
      writer.close();
    }
  });

  test("rejects oversized SQL text and attributed-body values before returning them", () => {
    const textPath = temporaryDatabasePath();
    createFixture(textPath);
    const textDatabase = new Database(textPath, { strict: true });
    textDatabase.query("UPDATE message SET text = ? WHERE guid = ?")
      .run("x".repeat(65), "direct-incoming-guid");
    textDatabase.close();
    expect(() => readIMessageDatabase(textPath, {
      hmacKey: TEST_HMAC_KEY,
      maxBodyBytes: 64,
    })).toThrow("exceeds the configured body bound");

    const attributedPath = temporaryDatabasePath();
    createFixture(attributedPath);
    const attributedDatabase = new Database(attributedPath, { strict: true });
    attributedDatabase.query("UPDATE message SET attributedBody = ? WHERE guid = ?")
      .run(new Uint8Array(65), "direct-attributed-guid");
    attributedDatabase.close();
    expect(() => readIMessageDatabase(attributedPath, {
      hmacKey: TEST_HMAC_KEY,
      maxAttributedBodyBytes: 64,
    })).toThrow("exceeds the configured attributed-body bound");
  });
});
