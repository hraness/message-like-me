import { chmod, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";

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

function storedZip(entries: readonly Readonly<{ name: string; value: string }>[]): Buffer {
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

function assignment(binding: string, value: unknown): string {
  return `window.YTD.${binding}.part0 = ${JSON.stringify(value)}`;
}

export async function writeSyntheticXArchive(
  parent: string,
  options: Readonly<{ mismatchedDirectHeader?: boolean }> = {},
): Promise<string> {
  const path = join(parent, "synthetic-x-archive.zip");
  const dataTypes: Record<string, unknown> = {
    account: {
      files: [{ fileName: "data/account.js", globalName: "YTD.account.part0", count: "1" }],
    },
    directMessages: {
      mediaDirectory: "data/direct_messages_media",
      files: [{
        fileName: "data/direct-messages.js",
        globalName: "YTD.direct_messages.part0",
        count: "1",
      }],
    },
  };
  if (options.mismatchedDirectHeader === true) {
    dataTypes.directMessageHeaders = {
      files: [{
        fileName: "data/direct-message-headers.js",
        globalName: "YTD.direct_message_headers.part0",
        count: "1",
      }],
    };
  }
  const manifest = `window.__THAR_CONFIG = ${JSON.stringify({
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
  const account = assignment("account", [{ account: {
    email: "owner@example.test",
    createdVia: "web",
    username: "Owner",
    accountId: "999",
    createdAt: "2010-01-01T00:00:00.000Z",
    accountDisplayName: "Archive Owner",
  } }]);
  const directMessages = assignment("direct_messages", [{ dmConversation: {
    conversationId: "999-1002",
    messages: [
      { messageCreate: {
        recipientId: "999",
        text: "private incoming body",
        reactions: [],
        urls: [],
        mediaUrls: [],
        senderId: "1002",
        id: "8001",
        createdAt: "2026-08-01T12:00:00.000Z",
      } },
      { messageCreate: {
        recipientId: "1002",
        text: "private outgoing body",
        reactions: [],
        urls: [],
        mediaUrls: [],
        senderId: "999",
        id: "8002",
        createdAt: "2026-08-01T12:01:00.000Z",
      } },
    ],
  } }]);
  const entries = [
    { name: "data/manifest.js", value: manifest },
    { name: "data/account.js", value: account },
    { name: "data/direct-messages.js", value: directMessages },
  ];
  if (options.mismatchedDirectHeader === true) {
    entries.push({
      name: "data/direct-message-headers.js",
      value: assignment("direct_message_headers", [{ dmConversation: {
        conversationId: "999-424242",
        messages: [
          { messageCreate: {
            recipientId: "999",
            senderId: "1002",
            id: "8001",
            createdAt: "2026-08-01T12:00:00.000Z",
          } },
          { messageCreate: {
            recipientId: "1002",
            senderId: "999",
            id: "8002",
            createdAt: "2026-08-01T12:01:00.000Z",
          } },
        ],
      } }]),
    });
  }
  await writeFile(path, storedZip(entries), { mode: 0o600 });
  await chmod(path, 0o600);
  return realpath(path);
}
