import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "./cli.ts";
import type { CommandIo } from "./io.ts";
import { dataPaths, initializeDataPaths, loadOrCreateInstallKey } from "./paths.ts";
import { LocalStore } from "./store.ts";
import { syntheticProfile } from "./test-fixtures.ts";
import type { CorpusSnapshot } from "./types.ts";

function corpus(): CorpusSnapshot {
  const contactId = "contact_0123456789abcdef";
  return {
    schemaVersion: 1,
    source: {
      physicalPath: "/synthetic/messages.sqlite3",
      device: "1",
      inode: "2",
      bytes: 2048,
      modifiedAt: "2026-08-21T10:00:00.000Z",
      schemaSha256: "c".repeat(64),
      snapshotSha256: "a".repeat(64),
    },
    conversations: [{
      id: contactId,
      sourceKey: "synthetic-private-chat-guid",
      privateLabel: "Synthetic Contact",
      service: "iMessage",
      participantCount: 1,
      participantIds: ["participant_hmac"],
      privateParticipants: ["synthetic@example.test"],
      group: false,
    }],
    messages: [
      {
        id: "incoming_1", sourceRowId: 1, sourceGuid: "private-guid-1", conversationId: contactId,
        sentAt: "2026-08-21T10:00:00.000Z", direction: "incoming", body: "Can we use the synthetic plan?",
        bodySource: "text", kind: "text", replyToSourceGuid: null, editedAt: null,
        retractedAt: null, service: "iMessage", attachmentCount: 0,
      },
      {
        id: "outgoing_1", sourceRowId: 2, sourceGuid: "private-guid-2", conversationId: contactId,
        sentAt: "2026-08-21T10:01:00.000Z", direction: "outgoing", body: "yes",
        bodySource: "text", kind: "text", replyToSourceGuid: null, editedAt: null,
        retractedAt: null, service: "iMessage", attachmentCount: 0,
      },
      {
        id: "outgoing_2", sourceRowId: 3, sourceGuid: "private-guid-3", conversationId: contactId,
        sentAt: "2026-08-21T10:01:20.000Z", direction: "outgoing", body: "that works",
        bodySource: "text", kind: "text", replyToSourceGuid: null, editedAt: null,
        retractedAt: null, service: "iMessage", attachmentCount: 0,
      },
    ],
    warnings: [],
  };
}

function ioCapture() {
  let stdout = "";
  let stderr = "";
  const io: CommandIo = {
    stdout: (text) => { stdout += text; },
    stderr: (text) => { stderr += text; },
    now: () => new Date("2026-08-21T12:00:00.000Z"),
  };
  return { io, stdout: () => stdout, stderr: () => stderr, clear: () => { stdout = ""; stderr = ""; } };
}

describe("messagelikeme CLI", () => {
  test("keeps aggregate views redacted and completes packet-to-profile flow", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-cli-"));
    const paths = await initializeDataPaths(dataPaths(join(root, "state")));
    await loadOrCreateInstallKey(paths.installKey);
    const store = LocalStore.open(paths.database);
    store.replaceCorpus(corpus(), "2026-08-21T11:00:00.000Z");
    store.close();
    const capture = ioCapture();
    try {
      expect(await main(["--data-dir", paths.root, "contacts", "list", "--json"], capture.io)).toBe(0);
      expect(capture.stderr()).toBe("");
      expect(capture.stdout()).not.toContain("Synthetic Contact");
      expect(capture.stdout()).not.toContain("synthetic@example.test");
      expect(capture.stdout()).not.toContain("yes");

      capture.clear();
      const packetPath = join(root, "packet.json");
      expect(await main([
        "--data-dir", paths.root, "study", "prepare", "contact_0123456789abcdef",
        "--output", packetPath, "--limit", "4", "--json",
      ], capture.io)).toBe(0);
      const receipt = JSON.parse(capture.stdout()) as { packetSha256: string; examples: number };
      expect(receipt.examples).toBe(1);
      expect(await readFile(packetPath, "utf8")).toContain("that works");

      const profilePath = join(root, "profile.json");
      await writeFile(profilePath, JSON.stringify(syntheticProfile({ packetSha256: receipt.packetSha256 })), { mode: 0o600 });
      capture.clear();
      expect(await main([
        "--data-dir", paths.root, "profile", "apply", profilePath, "--json",
      ], capture.io)).toBe(0);
      expect(capture.stdout()).toContain('"applied": true');

      capture.clear();
      expect(await main([
        "--data-dir", paths.root, "context", "contact_0123456789abcdef", "--json",
      ], capture.io)).toBe(0);
      expect(capture.stdout()).toContain('"multiRatio": 1');
      expect(capture.stdout()).not.toContain("that works");
      expect(capture.stdout()).not.toContain("private-guid");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
