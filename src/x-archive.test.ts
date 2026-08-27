import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readXArchive } from "./x-archive.ts";

const temporaryDirectories: string[] = [];

function syntheticWebUrl(host: string, path: string): string {
  return `https:${"/".repeat(2)}${host}${path}`;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC32_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

type ZipEntry = Readonly<{ name: string; value: string }>;

function storedZip(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.value, "utf8");
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((0o100600 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function zip64StoredZip(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.value, "utf8");
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(45, 4);
    local.writeUInt16LE(0x0808, 6);
    local.writeUInt32LE(0xffffffff, 18);
    local.writeUInt32LE(0xffffffff, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(20, 28);
    const localExtra = Buffer.alloc(20);
    localExtra.writeUInt16LE(0x0001, 0);
    localExtra.writeUInt16LE(16, 2);
    const descriptor = Buffer.alloc(24);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(checksum, 4);
    descriptor.writeBigUInt64LE(BigInt(data.length), 8);
    descriptor.writeBigUInt64LE(BigInt(data.length), 16);
    locals.push(local, name, localExtra, data, descriptor);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x032d, 4);
    central.writeUInt16LE(45, 6);
    central.writeUInt16LE(0x0808, 8);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(0xffffffff, 20);
    central.writeUInt32LE(0xffffffff, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(28, 30);
    central.writeUInt32LE((0o100600 << 16) >>> 0, 38);
    central.writeUInt32LE(0xffffffff, 42);
    const centralExtra = Buffer.alloc(28);
    centralExtra.writeUInt16LE(0x0001, 0);
    centralExtra.writeUInt16LE(24, 2);
    centralExtra.writeBigUInt64LE(BigInt(data.length), 4);
    centralExtra.writeBigUInt64LE(BigInt(data.length), 12);
    centralExtra.writeBigUInt64LE(BigInt(offset), 20);
    centrals.push(central, name, centralExtra);
    offset += local.length + name.length + localExtra.length + data.length + descriptor.length;
  }
  const directory = Buffer.concat(centrals);
  const zip64EndOffset = offset + directory.length;
  const zip64End = Buffer.alloc(56);
  zip64End.writeUInt32LE(0x06064b50, 0);
  zip64End.writeBigUInt64LE(44n, 4);
  zip64End.writeUInt16LE(0x032d, 12);
  zip64End.writeUInt16LE(45, 14);
  zip64End.writeBigUInt64LE(BigInt(entries.length), 24);
  zip64End.writeBigUInt64LE(BigInt(entries.length), 32);
  zip64End.writeBigUInt64LE(BigInt(directory.length), 40);
  zip64End.writeBigUInt64LE(BigInt(offset), 48);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeBigUInt64LE(BigInt(zip64EndOffset), 8);
  locator.writeUInt32LE(1, 16);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0xffff, 8);
  end.writeUInt16LE(0xffff, 10);
  end.writeUInt32LE(0xffffffff, 12);
  end.writeUInt32LE(0xffffffff, 16);
  return Buffer.concat([...locals, directory, zip64End, locator, end]);
}

function zip64CentralEntryOffset(archive: Buffer, ordinal: number): number {
  const zip64EndOffset = archive.length - 22 - 20 - 56;
  let position = Number(archive.readBigUInt64LE(zip64EndOffset + 48));
  for (let index = 0; index < ordinal; index += 1) {
    position += 46
      + archive.readUInt16LE(position + 28)
      + archive.readUInt16LE(position + 30)
      + archive.readUInt16LE(position + 32);
  }
  return position;
}

function assignment(binding: string, value: unknown): string {
  return `window.YTD.${binding}.part0 = ${JSON.stringify(value)}`;
}

function manifest(
  options: Readonly<{
    headers?: boolean;
    directCount?: string;
    groupCount?: string;
    directFiles?: readonly Record<string, string>[];
  }> = {},
): string {
  const headers = options.headers ?? true;
  const dataTypes: Record<string, unknown> = {
    account: {
      files: [{ fileName: "data/account.js", globalName: "YTD.account.part0", count: "1" }],
    },
    directMessages: {
      mediaDirectory: "data/direct_messages_media",
      files: options.directFiles ?? [{
        fileName: "data/direct-messages.js",
        globalName: "YTD.direct_messages.part0",
        count: options.directCount ?? "1",
      }],
    },
    directMessagesGroup: {
      mediaDirectory: "data/direct_messages_group_media",
      files: [{
        fileName: "data/direct-messages-group.js",
        globalName: "YTD.direct_messages_group.part0",
        count: options.groupCount ?? "1",
      }],
    },
  };
  if (headers) {
    dataTypes.directMessageHeaders = {
      files: [{
        fileName: "data/direct-message-headers.js",
        globalName: "YTD.direct_message_headers.part0",
        count: "1",
      }],
    };
    dataTypes.directMessageGroupHeaders = {
      files: [{
        fileName: "data/direct-message-group-headers.js",
        globalName: "YTD.direct_message_group_headers.part0",
        count: "1",
      }],
    };
  }
  return `window.__THAR_CONFIG = ${JSON.stringify({
    userInfo: { accountId: "999", userName: "Owner", displayName: "Archive Owner" },
    archiveInfo: {
      sizeBytes: "12345",
      generationDate: "2026-08-26T03:02:10.221Z",
      isPartialArchive: false,
      maxPartSizeBytes: "53687091200",
    },
    readmeInfo: { fileName: "data/README.txt", directory: "data/", name: "README.txt" },
    dataTypes,
  })}`;
}

function directConversation(): Record<string, unknown> {
  return {
    dmConversation: {
      conversationId: "999-1002",
      messages: [
        {
          messageCreate: {
            recipientId: "1002",
            text: "outgoing body",
            reactions: [{
              senderId: "1002",
              reactionKey: "like",
              eventId: "9001",
              createdAt: "2026-08-01T12:02:00.000Z",
            }],
            urls: [{
              url: syntheticWebUrl("t.co", "/private"),
              expanded: syntheticWebUrl("example.test", "/private"),
              display: "example.test",
            }],
            mediaUrls: [
              syntheticWebUrl("media.test", "/one"),
              syntheticWebUrl("media.test", "/two"),
            ],
            senderId: "999",
            id: "8002",
            createdAt: "2026-08-01T12:01:00.000Z",
            editHistory: [{ createdAtSec: "1785585720", editedText: "edited outgoing body" }],
          },
        },
        {
          messageCreate: {
            recipientId: "999",
            text: "incoming body",
            reactions: [],
            urls: [],
            mediaUrls: [],
            senderId: "1002",
            id: "8001",
            createdAt: "2026-08-01T12:00:00.000Z",
          },
        },
      ],
    },
  };
}

function groupConversation(): Record<string, unknown> {
  return {
    dmConversation: {
      conversationId: "7000",
      messages: [
        {
          conversationNameUpdate: {
            initiatingUserId: "1003",
            name: "Synthetic group",
            createdAt: "2026-08-03T12:02:00.000Z",
          },
        },
        {
          messageCreate: {
            text: "group body",
            reactions: [],
            urls: [],
            mediaUrls: [],
            senderId: "1003",
            id: "8101",
            createdAt: "2026-08-03T12:01:00.000Z",
          },
        },
        {
          joinConversation: {
            initiatingUserId: "1003",
            participantsSnapshot: ["999", "1003"],
            userIds: ["1003"],
            createdAt: "2026-08-03T12:00:00.000Z",
          },
        },
      ],
    },
  };
}

function directHeader(): Record<string, unknown> {
  return {
    dmConversation: {
      conversationId: "999-1002",
      messages: [
        { messageCreate: { id: "8002", senderId: "999", recipientId: "1002", createdAt: "2026-08-01T12:01:00.000Z" } },
        { messageCreate: { id: "8001", senderId: "1002", recipientId: "999", createdAt: "2026-08-01T12:00:00.000Z" } },
      ],
    },
  };
}

function groupHeader(): Record<string, unknown> {
  return {
    dmConversation: {
      conversationId: "7000",
      messages: [
        { messageCreate: { id: "8101", senderId: "1003", createdAt: "2026-08-03T12:01:00.000Z" } },
        { joinConversation: {
          initiatingUserId: "1003",
          participantsSnapshot: ["999", "1003"],
          userIds: ["1003"],
          createdAt: "2026-08-03T12:00:00.000Z",
        } },
        { conversationNameUpdate: {
          initiatingUserId: "1003",
          name: "Synthetic group",
          createdAt: "2026-08-03T12:02:00.000Z",
        } },
      ],
    },
  };
}

function tweet(): Record<string, unknown> {
  return {
    tweet: {
      created_at: "2026-07-01T00:00:00.000Z",
      in_reply_to_user_id: "1002",
      in_reply_to_user_id_str: "1002",
      in_reply_to_screen_name: "Peer",
      entities: {
        hashtags: [],
        symbols: [],
        urls: [],
        user_mentions: [
          { id: "1003", id_str: "1003", indices: [0, 5], name: "Group Peer", screen_name: "GroupPeer" },
          { id: "-1", id_str: "-1", indices: [6, 10], name: "Removed", screen_name: "Removed" },
        ],
      },
    },
  };
}

function archiveEntries(
  options: Readonly<{
    headers?: boolean;
    directCount?: string;
    groupCount?: string;
    directFiles?: readonly Record<string, string>[];
    direct?: Record<string, unknown>;
    group?: readonly Record<string, unknown>[];
    directHeader?: Record<string, unknown>;
    includeExtraPart?: boolean;
  }> = {},
): ZipEntry[] {
  const headers = options.headers ?? true;
  const entries: ZipEntry[] = [
    { name: "data/manifest.js", value: manifest({
      headers,
      ...(options.directCount === undefined ? {} : { directCount: options.directCount }),
      ...(options.groupCount === undefined ? {} : { groupCount: options.groupCount }),
      ...(options.directFiles === undefined ? {} : { directFiles: options.directFiles }),
    }) },
    { name: "data/account.js", value: assignment("account", [{ account: {
      email: "owner@example.test",
      createdVia: "web",
      username: "Owner",
      accountId: "999",
      createdAt: "2020-01-01T00:00:00.000Z",
      accountDisplayName: "Archive Owner",
    } }]) },
    { name: "data/direct-messages.js", value: assignment("direct_messages", [options.direct ?? directConversation()]) },
    { name: "data/direct-messages-group.js", value: assignment("direct_messages_group", options.group ?? [groupConversation()]) },
    { name: "data/tweets.js", value: assignment("tweets", [tweet()]) },
    { name: "media/inert.bin", value: "" },
  ];
  if (headers) {
    entries.push(
      { name: "data/direct-message-headers.js", value: assignment("direct_message_headers", [options.directHeader ?? directHeader()]) },
      { name: "data/direct-message-group-headers.js", value: assignment("direct_message_group_headers", [groupHeader()]) },
    );
  }
  if (options.includeExtraPart === true) {
    entries.push({ name: "data/direct-messages-part1.js", value: assignment("direct_messages", []) });
  }
  return entries;
}

function setup(): { directory: string; archivePath: string } {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), "message-like-me-x-test-"));
  temporaryDirectories.push(directory);
  return { directory, archivePath: join(directory, "archive.zip") };
}

describe("standalone X archive evidence reader", () => {
  test("reads standard ZIP evidence with bodies, tempo metadata, labels, and no inferred reply target", async () => {
    const { archivePath } = setup();
    writeFileSync(archivePath, storedZip(archiveEntries()), { mode: 0o600 });

    const evidence = await readXArchive(archivePath);

    expect(evidence).toEqual(expect.objectContaining({
      format: "message-like-me.x-archive-evidence",
      version: 1,
      account: {
        providerUserId: "999",
        username: "Owner",
        displayName: "Archive Owner",
        email: "owner@example.test",
        createdAt: "2020-01-01T00:00:00.000Z",
        createdVia: "web",
      },
      archive: expect.objectContaining({
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
        manifestSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
        declaredSizeBytes: 12345,
        generationDate: "2026-08-26T03:02:10.221Z",
        isPartialArchive: false,
      }),
    }));
    expect(evidence.conversations.map(({ conversationId }) => conversationId)).toEqual(["7000", "999-1002"]);
    const direct = evidence.conversations[1]!;
    expect(direct.participantIds).toEqual(["1002", "999"]);
    expect(direct.events.map(({ kind }) => kind)).toEqual(["message-create", "message-create"]);
    const incoming = direct.events[0]!;
    const outgoing = direct.events[1]!;
    expect(incoming).toEqual(expect.objectContaining({ id: "8001", text: "incoming body", replyToMessageId: null }));
    expect(outgoing).toEqual(expect.objectContaining({
      id: "8002",
      text: "outgoing body",
      urlCount: 1,
      mediaCount: 2,
      replyToMessageId: null,
      editHistory: [expect.objectContaining({ editedText: "edited outgoing body" })],
      activeReactions: [expect.objectContaining({ eventId: "9001", senderId: "1002" })],
    }));
    expect(JSON.stringify(evidence)).not.toContain(syntheticWebUrl("example.test", "/private"));
    expect(evidence.identityObservations).toEqual([
      expect.objectContaining({ kind: "reply", providerUserId: "1002", username: "Peer", displayName: null }),
      expect.objectContaining({ kind: "mention", providerUserId: "1003", username: "GroupPeer", displayName: "Group Peer" }),
    ]);
  });

  test("reads strict ZIP64 descriptor metadata without relationship files or optional headers", async () => {
    const { archivePath } = setup();
    const inert = Array.from({ length: 10_001 }, (_, index): ZipEntry => ({
      name: `media/inert-${index}.bin`,
      value: "",
    }));
    inert[0] = { name: "media//official-empty-component.bin", value: "" };
    inert[1] = { name: "root//data/account.js", value: "must remain inert" };
    writeFileSync(archivePath, zip64StoredZip([...archiveEntries({ headers: false }), ...inert]), { mode: 0o600 });

    const evidence = await readXArchive(archivePath);

    expect(evidence.conversations).toHaveLength(2);
    expect(evidence.account.providerUserId).toBe("999");
  });

  test("merges repeated group-conversation fragments while manifest counts raw rows", async () => {
    const { archivePath } = setup();
    const first = groupConversation();
    const second = {
      dmConversation: {
        conversationId: "7000",
        messages: [{ messageCreate: {
          text: "later fragment",
          reactions: [],
          urls: [],
          mediaUrls: [],
          senderId: "1004",
          id: "8102",
          createdAt: "2026-08-03T12:03:00.000Z",
        } }],
      },
    };
    writeFileSync(archivePath, storedZip(archiveEntries({
      headers: false,
      groupCount: "2",
      group: [first, second],
    })), { mode: 0o600 });

    const evidence = await readXArchive(archivePath);
    const group = evidence.conversations.find(({ conversationId }) => conversationId === "7000")!;

    expect(evidence.conversations).toHaveLength(2);
    expect(group.participantIds).toEqual(["1003", "1004", "999"]);
    expect(group.events.filter(({ kind }) => kind === "message-create")).toHaveLength(2);
  });

  test("rejects selected-member CRC corruption", async () => {
    const { archivePath } = setup();
    const archive = storedZip(archiveEntries());
    const marker = archive.indexOf(Buffer.from("Archive Owner", "utf8"));
    expect(marker).toBeGreaterThan(0);
    archive[marker] = "B".charCodeAt(0);
    writeFileSync(archivePath, archive, { mode: 0o600 });

    await expect(readXArchive(archivePath)).rejects.toThrow("CRC-32");
  });

  test("rejects ZIP64 local-offset drift before reading an oversized descriptor", async () => {
    const { archivePath } = setup();
    const archive = zip64StoredZip(archiveEntries({ headers: false }));
    const central = zip64CentralEntryOffset(archive, 1);
    const nameLength = archive.readUInt16LE(central + 28);
    const localOffsetPosition = central + 46 + nameLength + 4 + 16;
    archive.writeBigUInt64LE(archive.readBigUInt64LE(localOffsetPosition) + 1n, localOffsetPosition);
    writeFileSync(archivePath, archive, { mode: 0o600 });

    await expect(readXArchive(archivePath)).rejects.toThrow("invalid width");
  });

  test("rejects manifest count drift and header coordinate drift", async () => {
    const count = setup();
    writeFileSync(count.archivePath, storedZip(archiveEntries({ directCount: "2" })), { mode: 0o600 });
    await expect(readXArchive(count.archivePath)).rejects.toThrow("directMessages count disagrees");

    const header = setup();
    const mismatched = directHeader();
    const conversation = (mismatched.dmConversation as Record<string, unknown>);
    const messages = conversation.messages as Array<Record<string, unknown>>;
    (messages[0]!.messageCreate as Record<string, unknown>).senderId = "1002";
    writeFileSync(header.archivePath, storedZip(archiveEntries({ directHeader: mismatched })), { mode: 0o600 });
    await expect(readXArchive(header.archivePath)).rejects.toThrow("disagrees with its DM body");
  });

  test("rejects manifest and ZIP declarations of unsupported additional DM parts", async () => {
    const { archivePath } = setup();
    writeFileSync(archivePath, storedZip(archiveEntries({
      directFiles: [
        { fileName: "data/direct-messages.js", globalName: "YTD.direct_messages.part0", count: "1" },
        { fileName: "data/direct-messages-part1.js", globalName: "YTD.direct_messages.part1", count: "0" },
      ],
      includeExtraPart: true,
    })), { mode: 0o600 });

    await expect(readXArchive(archivePath)).rejects.toThrow("unsupported additional direct-message part");
  });

  test("rejects executable assignment suffixes and unreviewed message fields", async () => {
    const executable = setup();
    const entries = archiveEntries({ headers: false });
    const tweetIndex = entries.findIndex(({ name }) => name === "data/tweets.js");
    entries[tweetIndex] = {
      name: "data/tweets.js",
      value: `${entries[tweetIndex]!.value};globalThis.compromised=true`,
    };
    writeFileSync(executable.archivePath, storedZip(entries), { mode: 0o600 });
    await expect(readXArchive(executable.archivePath)).rejects.toThrow("invalid assignment JSON");

    const unreviewed = setup();
    const direct = directConversation();
    const conversation = direct.dmConversation as Record<string, unknown>;
    const messages = conversation.messages as Array<Record<string, unknown>>;
    (messages[0]!.messageCreate as Record<string, unknown>).unreviewed = true;
    writeFileSync(unreviewed.archivePath, storedZip(archiveEntries({ direct, headers: false })), { mode: 0o600 });
    await expect(readXArchive(unreviewed.archivePath)).rejects.toThrow("unreviewed property unreviewed");
  });

  test("rejects group-readable files and symlinked paths", async () => {
    const permissions = setup();
    writeFileSync(permissions.archivePath, storedZip(archiveEntries()), { mode: 0o600 });
    chmodSync(permissions.archivePath, 0o640);
    await expect(readXArchive(permissions.archivePath)).rejects.toThrow("private current-user-owned physical file");

    const symlink = setup();
    const target = join(symlink.directory, "target.zip");
    writeFileSync(target, storedZip(archiveEntries()), { mode: 0o600 });
    symlinkSync(target, symlink.archivePath);
    await expect(readXArchive(symlink.archivePath)).rejects.toThrow("must not traverse a symbolic link");
  });
});
