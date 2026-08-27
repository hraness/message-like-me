import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "./cli.ts";
import type { CommandIo } from "./io.ts";
import { dataPaths, initializeDataPaths, loadOrCreateInstallKey } from "./paths.ts";
import { LocalStore } from "./store.ts";
import { syntheticProfileV2 } from "./test-fixtures.ts";
import { writeSyntheticMessageBundle } from "./test-bundle-fixture.ts";
import { writeSyntheticXArchive } from "./test-x-archive-fixture.ts";
import type { CorpusSnapshot, StudyPacket } from "./types.ts";

function corpus(): CorpusSnapshot {
  const contactId = "contact_0123456789abcdef";
  return {
    schemaVersion: 2,
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
        bodySource: "text", kind: "text", replyToSourceGuid: null, replyState: "none", editedAt: null,
        retractedAt: null, service: "iMessage", attachmentCount: 0,
      },
      {
        id: "outgoing_1", sourceRowId: 2, sourceGuid: "private-guid-2", conversationId: contactId,
        sentAt: "2026-08-21T10:01:00.000Z", direction: "outgoing", body: "yes",
        bodySource: "text", kind: "text", replyToSourceGuid: null, replyState: "none", editedAt: null,
        retractedAt: null, service: "iMessage", attachmentCount: 0,
      },
      {
        id: "outgoing_2", sourceRowId: 3, sourceGuid: "private-guid-3", conversationId: contactId,
        sentAt: "2026-08-21T10:01:20.000Z", direction: "outgoing", body: "that works",
        bodySource: "text", kind: "text", replyToSourceGuid: null, replyState: "none", editedAt: null,
        retractedAt: null, service: "iMessage", attachmentCount: 0,
      },
      {
        id: "incoming_2", sourceRowId: 4, sourceGuid: "private-guid-4", conversationId: contactId,
        sentAt: "2026-08-21T11:00:00.000Z", direction: "incoming", body: "What about the later check?",
        bodySource: "text", kind: "text", replyToSourceGuid: null, replyState: "none", editedAt: null,
        retractedAt: null, service: "iMessage", attachmentCount: 0,
      },
      {
        id: "outgoing_3", sourceRowId: 5, sourceGuid: "private-guid-5", conversationId: contactId,
        sentAt: "2026-08-21T11:01:00.000Z", direction: "outgoing", body: "later answer",
        bodySource: "text", kind: "text", replyToSourceGuid: null, replyState: "none", editedAt: null,
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

async function createContactsFixture(root: string): Promise<string> {
  const directory = join(root, "AddressBook", "Sources", "CLI-STORE");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "AddressBook-v22.abcddb");
  const database = new Database(path, { create: true, strict: true });
  try {
    database.exec(`
      CREATE TABLE Z_PRIMARYKEY(Z_ENT INTEGER PRIMARY KEY,Z_NAME TEXT NOT NULL);
      INSERT INTO Z_PRIMARYKEY VALUES (7,'ABCDContact');
      CREATE TABLE ZABCDRECORD(
        Z_PK INTEGER PRIMARY KEY,Z_ENT INTEGER NOT NULL,ZUNIQUEID TEXT,
        ZNAME TEXT,ZFIRSTNAME TEXT,ZLASTNAME TEXT,ZORGANIZATION TEXT
      );
      CREATE TABLE ZABCDEMAILADDRESS(
        Z_PK INTEGER PRIMARY KEY,ZOWNER INTEGER NOT NULL,ZADDRESS TEXT
      );
      INSERT INTO ZABCDRECORD VALUES (
        1,7,'cli-contact','CLI Private Name',NULL,NULL,NULL
      );
      INSERT INTO ZABCDEMAILADDRESS VALUES (1,1,'synthetic@example.test');
    `);
  } finally {
    database.close();
  }
  return join(root, "AddressBook");
}

describe("messagelikeme CLI", () => {
  test("ingests an official X archive with an aggregate-only receipt", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-cli-x-"));
    const capture = ioCapture();
    try {
      const archivePath = await writeSyntheticXArchive(root);
      const state = join(root, "state");
      expect(await main([
        "--data-dir", state, "ingest", "x-archive", "--input", archivePath, "--json",
      ], capture.io)).toBe(0);
      expect(capture.stderr()).toContain("Validating one private X archive locally");
      expect(capture.stderr()).toContain("Validated 2 messages across 1 conversation");
      expect(capture.stderr()).toContain("Updating the private local Message Like Me store atomically");
      expect(capture.stderr()).toContain("Processed 1 of 1 conversations inside the pending transaction");
      expect(capture.stderr()).toContain("Processed 2 of 2 messages inside the pending transaction");
      const output = capture.stdout();
      const receipt = JSON.parse(output) as {
        source: { id: string };
        imported: { conversations: number; messages: number; outgoingMessages: number };
        reconciliation: null;
      };
      expect(receipt.imported).toMatchObject({
        conversations: 1,
        messages: 2,
        outgoingMessages: 1,
        replyStateUnavailableMessages: 2,
      });
      expect(receipt.reconciliation).toBeNull();
      expect(receipt.source.id).toMatch(/^source_[a-f0-9]{64}$/u);
      expect(output).not.toContain(archivePath);
      expect(output).not.toContain("Archive Owner");
      expect(output).not.toContain("owner@example.test");
      expect(output).not.toContain("private incoming body");
      expect(output).not.toContain("private outgoing body");

      capture.clear();
      expect(await main([
        "--data-dir", state, "sources", "show", receipt.source.id, "--json",
      ], capture.io)).toBe(0);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        kind: "x-archive",
        provider: "x",
        network: "x",
        conversations: 1,
        messages: 2,
      });
      expect(capture.stdout()).not.toContain("Owner");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("redacts private X archive coordinates when validation fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-cli-x-redaction-"));
    const capture = ioCapture();
    try {
      const archivePath = await writeSyntheticXArchive(root, { mismatchedDirectHeader: true });
      expect(await main([
        "--data-dir", join(root, "state"),
        "ingest", "x-archive", "--input", archivePath, "--json",
      ], capture.io)).toBe(7);
      expect(capture.stdout()).toBe("");
      expect(capture.stderr()).toContain("The selected private X archive could not be validated safely");
      for (const privateValue of [
        archivePath,
        "999-1002",
        "999-424242",
        "8001",
        "Archive Owner",
        "owner@example.test",
        "private incoming body",
        "private outgoing body",
      ]) expect(capture.stderr()).not.toContain(privateValue);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("ingests a strict local bundle and exposes redacted source health", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-cli-bundle-"));
    const capture = ioCapture();
    try {
      const bundlePath = await writeSyntheticMessageBundle(root);
      const state = join(root, "state");
      expect(await main([
        "--data-dir", state, "ingest", "bundle", "--input", bundlePath, "--json",
      ], capture.io)).toBe(0);
      expect(capture.stderr()).toBe("");
      const receipt = JSON.parse(capture.stdout()) as {
        sources: Array<{ id: string }>;
        messages: number;
      };
      expect(receipt.messages).toBe(4);
      expect(receipt.sources[0]!.id).toMatch(/^source_[a-f0-9]{64}$/u);
      expect(capture.stdout()).not.toContain("Synthetic Peer");
      expect(capture.stdout()).not.toContain("peer@example.test");
      expect(capture.stdout()).not.toContain("Synthetic answer");

      capture.clear();
      expect(await main([
        "--data-dir", state, "sources", "list", "--json",
      ], capture.io)).toBe(0);
      const listed = JSON.parse(capture.stdout()) as {
        sources: Array<Record<string, unknown>>;
      };
      expect(listed.sources[0]).toMatchObject({
        id: receipt.sources[0]!.id,
        provider: "beeper",
        network: "whatsapp",
        conversations: 1,
        messages: 4,
        reactions: 2,
        undatedReactions: 1,
      });
      expect(listed.sources[0]).not.toHaveProperty("accountId");
      expect(capture.stdout()).not.toContain("synthetic-connected-account");

      capture.clear();
      expect(await main([
        "--data-dir", state, "contacts", "list", "--json",
      ], capture.io)).toBe(0);
      const contacts = JSON.parse(capture.stdout()) as { contacts: Array<{ id: string }> };
      expect(contacts.contacts).toHaveLength(1);
      capture.clear();
      expect(await main([
        "--data-dir", state, "inspect", "tempo", contacts.contacts[0]!.id, "--json",
      ], capture.io)).toBe(0);
      const tempoOutput = capture.stdout();
      expect(JSON.parse(tempoOutput)).toMatchObject({
        reactions: {
          total: 2,
          incoming: 1,
          outgoing: 1,
          undated: 1,
        },
      });
      expect(tempoOutput).not.toContain("heart");
      expect(tempoOutput).not.toContain("thumbs-up");
      expect(Object.hasOwn(
        (JSON.parse(tempoOutput) as { reactions: Record<string, unknown> }).reactions,
        "byBody",
      )).toBeFalse();

      capture.clear();
      expect(await main([
        "--data-dir", state, "context", contacts.contacts[0]!.id, "--json",
      ], capture.io)).toBe(0);
      const contextOutput = capture.stdout();
      expect(contextOutput).not.toContain("heart");
      expect(contextOutput).not.toContain("thumbs-up");
      expect(contextOutput).not.toContain("byBody");

      capture.clear();
      expect(await main([
        "--data-dir", state, "sources", "show", receipt.sources[0]!.id,
        "--private", "--json",
      ], capture.io)).toBe(0);
      expect(capture.stdout()).toContain("synthetic-connected-account");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("keeps aggregate views redacted and completes packet-to-profile flow", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-cli-"));
    const paths = await initializeDataPaths(dataPaths(join(root, "state")));
    await loadOrCreateInstallKey(paths.installKey);
    const store = LocalStore.open(paths.database);
    store.replaceCorpus(corpus(), "2026-08-21T11:00:00.000Z");
    store.close();
    const capture = ioCapture();
    try {
      const contactsRoot = await createContactsFixture(root);
      expect(await main([
        "--data-dir", paths.root, "ingest", "contacts",
        "--addressbook", contactsRoot, "--json",
      ], capture.io)).toBe(0);
      expect(capture.stderr()).toBe("");
      expect(capture.stdout()).toContain('"enriched": 1');
      expect(capture.stdout()).not.toContain("CLI Private Name");
      expect(capture.stdout()).not.toContain("synthetic@example.test");

      capture.clear();
      expect(await main(["--data-dir", paths.root, "contacts", "list", "--json"], capture.io)).toBe(0);
      expect(capture.stderr()).toBe("");
      expect(capture.stdout()).not.toContain("Synthetic Contact");
      expect(capture.stdout()).not.toContain("synthetic@example.test");
      expect(capture.stdout()).not.toContain("yes");
      expect(capture.stdout()).not.toContain("CLI Private Name");
      expect(capture.stdout()).toContain('"scopeKind": "person"');
      expect(capture.stdout()).toContain('"conversationCount": 1');

      capture.clear();
      expect(await main([
        "--data-dir", paths.root, "contacts", "resolve", "CLI Private Name", "--json",
      ], capture.io)).toBe(2);
      expect(capture.stderr()).toContain("requires --private");

      capture.clear();
      expect(await main([
        "--data-dir", paths.root, "contacts", "resolve", "cli private name",
        "--private", "--json",
      ], capture.io)).toBe(0);
      const resolved = JSON.parse(capture.stdout()) as {
        matches: Array<{ id: string; privateLabel: string }>;
      };
      expect(resolved.matches).toHaveLength(1);
      const personId = resolved.matches[0]!.id;
      expect(personId).toMatch(/^person_[a-f0-9]{64}$/u);
      expect(resolved.matches[0]!.privateLabel).toBe("CLI Private Name");
      expect(capture.stdout()).not.toContain("synthetic@example.test");

      capture.clear();
      const packetPath = join(root, "packet.json");
      expect(await main([
        "--data-dir", paths.root, "study", "prepare", personId,
        "--output", packetPath, "--before", "2026-08-21T11:00:00.000Z",
        "--limit", "4", "--json",
      ], capture.io)).toBe(0);
      const receipt = JSON.parse(capture.stdout()) as {
        packetSha256: string;
        evidenceRevision: string;
        examples: number;
      };
      expect(receipt.examples).toBe(1);
      const packet = JSON.parse(await readFile(packetPath, "utf8")) as StudyPacket;
      expect(JSON.stringify(packet)).toContain("that works");
      expect(JSON.stringify(packet)).not.toContain("later answer");
      expect(packet.evidenceWindow).toEqual({
        after: null,
        before: "2026-08-21T11:00:00.000Z",
      });

      const profilePath = join(root, "profile.json");
      const exampleId = packet.examples[0]!.id;
      const baseProfile = syntheticProfileV2() as Record<string, unknown>;
      const profile = {
        ...baseProfile,
        contactId: personId,
        corpusRevision: packet.corpusRevision,
        packetSha256: receipt.packetSha256,
        evidence: {
          evidenceRevision: receipt.evidenceRevision,
          firstMessageAt: packet.metrics.firstMessageAt,
          lastMessageAt: packet.metrics.lastMessageAt,
          messageCount: packet.metrics.messageCount,
          outgoingTextMessages: packet.metrics.surface.outgoingTextMessages,
          responseEpisodes: packet.metrics.tempo.responseEpisodes,
          studyExamples: packet.examples.length,
          selectionAlgorithm: packet.selection.algorithm,
          after: packet.evidenceWindow.after,
          before: packet.evidenceWindow.before,
        },
        contexts: [{
          when: "a concrete question arrives",
          incomingPattern: "one direct ask",
          responseStrategy: "answer it",
          prosePattern: "brief and literal",
          tempoPattern: "one or two bubbles",
          evidenceExampleIds: [exampleId],
        }],
        claims: [{
          dimension: "tempo",
          statement: "This response used two bubbles.",
          basis: "measured",
          appliesWhen: "within this synthetic response episode",
          supportExampleIds: [exampleId],
          counterexampleIds: [],
          supportCount: 1,
          confidence: "high",
          draftingConsequence: "Consider two bubbles for a comparable reply.",
        }],
      };
      await writeFile(profilePath, JSON.stringify(profile), { mode: 0o600 });
      capture.clear();
      expect(await main([
        "--data-dir", paths.root, "profile", "apply", profilePath, "--json",
      ], capture.io)).toBe(0);
      expect(capture.stdout()).toContain('"applied": true');

      capture.clear();
      expect(await main([
        "--data-dir", paths.root, "context", personId, "--json",
      ], capture.io)).toBe(0);
      expect(capture.stdout()).toContain('"state": "current"');
      expect(capture.stdout()).not.toContain("that works");
      expect(capture.stdout()).not.toContain("private-guid");

      const promptPath = join(root, "evaluation-prompts.json");
      const referencePath = join(root, "evaluation-references.json");
      capture.clear();
      expect(await main([
        "--data-dir", paths.root, "evaluate", "prepare", personId,
        "--after", "2026-08-21T11:00:00.000Z",
        "--prompt-output", promptPath,
        "--reference-output", referencePath,
        "--json",
      ], capture.io)).toBe(0);
      expect(capture.stdout()).toContain('"cases": 1');
      const prompt = await readFile(promptPath, "utf8");
      const reference = await readFile(referencePath, "utf8");
      expect(prompt).toContain("What about the later check?");
      expect(prompt).not.toContain("later answer");
      expect(reference).toContain("later answer");
      expect(reference).not.toContain("What about the later check?");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
