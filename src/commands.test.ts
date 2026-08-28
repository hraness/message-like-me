import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "./cli.ts";
import {
  WRENCH_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_HASH,
  WRENCH_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_ID,
  WRENCH_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_HASH,
  WRENCH_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_ID,
} from "./agentic-messaging-v1.ts";
import { canonicalJson, sha256 } from "./canonical-json.ts";
import type { CommandIo } from "./io.ts";
import { dataPaths, initializeDataPaths, loadOrCreateInstallKey } from "./paths.ts";
import { LocalStore } from "./store.ts";
import { syntheticProfileV2 } from "./test-fixtures.ts";
import {
  syntheticBundleRecords,
  type SyntheticBundleRecords,
  writeSyntheticMessageBundle,
} from "./test-bundle-fixture.ts";
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

function syntheticXOverlapBundleRecords(): SyntheticBundleRecords {
  const base = syntheticBundleRecords();
  const network = (record: Record<string, unknown>): Record<string, unknown> => ({
    ...record,
    network: "x",
  });
  return {
    account: [{
      ...network(base.account[0]!),
      displayName: "Synthetic X Account",
      handle: "Owner",
    }],
    participant: [
      {
        ...network(base.participant[0]!),
        displayName: "Synthetic X Self",
        handle: "Owner",
      },
      {
        ...network(base.participant[1]!),
        displayName: "Synthetic X Peer",
        handle: "Peer",
      },
    ],
    conversation: [{
      ...network(base.conversation[0]!),
      title: "Synthetic X Direct",
      startedAt: "2026-08-01T12:00:00.000Z",
      lastMessageAt: "2026-08-01T12:01:00.000Z",
    }],
    message: [
      {
        ...network(base.message[0]!),
        sentAt: "2026-08-01T12:00:00.000Z",
        body: "private incoming body",
      },
      {
        ...network(base.message[1]!),
        sentAt: "2026-08-01T12:01:00.000Z",
        body: "private outgoing body",
        replyTo: null,
        attachments: [],
      },
    ],
    reaction: [],
    tombstone: [],
  };
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
  test("prepares, verifies, and records a private body-bearing handoff with a body-free audit", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-cli-handoff-"));
    const capture = ioCapture();
    const state = join(root, "state");
    const contextPath = join(root, "wrench-context.json");
    const routesPath = join(root, "routes.json");
    const requestPath = join(root, "handoff-request.json");
    const draftPath = join(root, "draft.json");
    const handoffPath = join(root, "handoff.json");
    const receiptPath = join(root, "wrench-receipt.json");
    const routeRef = "route_ref_private_synthetic_001";
    const contextRef = "context_ref_private_synthetic_001";
    const privateBody = "private synthetic response body";
    try {
      const paths = await initializeDataPaths(dataPaths(state));
      const store = LocalStore.open(paths.database);
      try {
        store.replaceCorpus(corpus(), "2026-08-21T11:59:00.000Z");
      } finally {
        store.close();
      }

      expect(await main([
        "--data-dir", state, "routes", "list", "contact_0123456789abcdef",
        "--output", routesPath, "--private", "--json",
      ], capture.io)).toBe(0);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        selectionState: "single-exact-candidate",
        candidates: 1,
        eligibleCandidates: 1,
        privateCoordinatesIncluded: true,
      });
      expect(capture.stdout()).not.toContain("contact_0123456789abcdef");
      const routes = JSON.parse(await readFile(routesPath, "utf8")) as {
        selection: { state: string; eligibleCandidateId: string };
        candidates: Array<{
          sourceId: string;
          conversationId: string;
          privateBinding: unknown;
          actionability: { state: string };
        }>;
      };
      expect(routes.selection.state).toBe("single-exact-candidate");
      expect(routes.candidates).toEqual([expect.objectContaining({
        privateBinding: {
          sourceAccountId: null,
          sourceExternalId: "local-imessage",
          coordinate: {
            kind: "imessageChat",
            chatGuid: "synthetic-private-chat-guid",
            service: "iMessage",
            observedChatRowId: null,
          },
        },
        actionability: { state: "wrench-binding-eligible", reason: "requires-exact-wrench-binding" },
      })]);
      expect((await stat(routesPath)).mode & 0o077).toBe(0);
      expect(capture.stdout()).not.toContain("local-imessage");
      expect(capture.stdout()).not.toContain("synthetic-private-chat-guid");
      const routeCandidateId = routes.selection.eligibleCandidateId;
      expect(capture.stdout()).not.toContain(routeCandidateId);
      capture.clear();

      await writeFile(requestPath, `${JSON.stringify({
        schemaVersion: 1,
        format: "message-like-me.agent-message-handoff-request",
        routeCandidateId,
      }, null, 2)}\n`, { mode: 0o600 });

      await writeFile(contextPath, `${JSON.stringify({
        schemaVersion: 1,
        format: "wrench.messaging-context-binding",
        contractId: WRENCH_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_ID,
        contractHash: WRENCH_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_HASH,
        routeRef,
        contextRef,
        exactDataRevision: "d".repeat(64),
        latestMessageRevision: "e".repeat(64),
        validatedAt: "2026-08-21T11:59:00.000Z",
        expiresAt: "2026-08-21T12:10:00.000Z",
      }, null, 2)}\n`, { mode: 0o600 });
      await writeFile(draftPath, `${JSON.stringify({
        schemaVersion: 1,
        format: "message-like-me.agent-message-draft",
        bubbles: [
          { id: "part_1", text: privateBody, replyToRef: null },
          { id: "part_2", text: "private synthetic follow-up", replyToRef: "message_ref_private_001" },
        ],
      }, null, 2)}\n`, { mode: 0o600 });

      expect(await main([
        "--data-dir", state, "handoff", "prepare", "contact_0123456789abcdef",
        "--request", requestPath,
        "--wrench-context", contextPath,
        "--draft", draftPath,
        "--output", handoffPath,
        "--json",
      ], capture.io)).toBe(0);
      const preparedOutput = capture.stdout();
      const prepared = JSON.parse(preparedOutput) as {
        handoffId: string;
        handoffSha256: string;
        turnDigest: string;
        partCount: number;
        state: string;
      };
      expect(prepared).toMatchObject({ partCount: 2, state: "prepared" });
      expect(prepared.handoffId).toMatch(/^handoff_[a-f0-9]{64}$/u);
      for (const privateValue of [
        privateBody, routeRef, contextRef, routeCandidateId, contextPath, draftPath, handoffPath,
        "contact_0123456789abcdef", routes.candidates[0]!.sourceId,
        routes.candidates[0]!.conversationId,
      ]) {
        expect(preparedOutput).not.toContain(privateValue);
      }
      expect((await stat(handoffPath)).mode & 0o077).toBe(0);
      const handoff = JSON.parse(await readFile(handoffPath, "utf8")) as {
        wrench: { routeRef: string; contextRef: string };
        turn: { bubbles: Array<{ text: string }> };
      };
      expect(handoff.wrench).toMatchObject({ routeRef, contextRef });
      expect(handoff.turn.bubbles[0]!.text).toBe(privateBody);

      capture.clear();
      expect(await main([
        "--data-dir", state, "handoff", "verify", handoffPath, "--json",
      ], capture.io)).toBe(0);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        valid: true,
        handoffId: prepared.handoffId,
        handoffSha256: prepared.handoffSha256,
        exactDataRevisionSha256: "d".repeat(64),
        latestMessageRevisionSha256: "e".repeat(64),
        partCount: 2,
        expired: false,
      });
      expect(capture.stdout()).not.toContain(privateBody);
      expect(capture.stdout()).not.toContain(routeRef);
      expect(capture.stdout()).not.toContain(contextRef);
      expect(capture.stdout()).not.toContain("contact_0123456789abcdef");
      expect(capture.stdout()).not.toContain(routes.candidates[0]!.sourceId);
      expect(capture.stdout()).not.toContain(routes.candidates[0]!.conversationId);

      const beforeReceipt = LocalStore.open(dataPaths(state).database);
      const before = beforeReceipt.doctor();
      const beforeRevision = beforeReceipt.corpusRevision();
      const beforeMessages = beforeReceipt.messages("contact_0123456789abcdef");
      beforeReceipt.close();
      const receiptCore = {
        schemaVersion: 1,
        format: "wrench.messaging-receipt-binding",
        contractId: WRENCH_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_ID,
        contractHash: WRENCH_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_HASH,
        clientIntentSha256: prepared.handoffSha256,
        routeRefSha256: sha256(routeRef),
        contextRefSha256: sha256(contextRef),
        turnDigest: prepared.turnDigest,
        previewDigest: "9".repeat(64),
        runId: "run_synthetic_private_001",
        state: "submitted",
        partCount: 2,
        provenPartCount: 2,
        recordedAt: "2026-08-21T12:01:00.000Z",
      };
      const receiptSha256 = sha256(canonicalJson(receiptCore));
      await writeFile(receiptPath, `${JSON.stringify({
        ...receiptCore,
        receiptSha256,
      }, null, 2)}\n`, { mode: 0o600 });
      capture.clear();
      expect(await main([
        "--data-dir", state, "handoff", "record", prepared.handoffId,
        "--wrench-receipt", receiptPath, "--json",
      ], capture.io)).toBe(0);
      const recordedOutput = capture.stdout();
      expect(JSON.parse(recordedOutput)).toMatchObject({
        handoffId: prepared.handoffId,
        state: "recorded",
        receipt: {
          contractHash: WRENCH_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_HASH,
          receiptSha256,
          previewDigest: "9".repeat(64),
          runIdSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          state: "submitted",
          provenPartCount: 2,
        },
      });
      for (const privateValue of [privateBody, routeRef, contextRef, receiptPath]) {
        expect(recordedOutput).not.toContain(privateValue);
      }

      const afterReceipt = LocalStore.open(dataPaths(state).database);
      try {
        expect(afterReceipt.corpusRevision()).toBe(beforeRevision);
        expect(afterReceipt.messages("contact_0123456789abcdef")).toEqual(beforeMessages);
        expect(afterReceipt.doctor()).toMatchObject({
          messages: before.messages,
          activeMessages: before.activeMessages,
          handoffs: 1,
        });
      } finally {
        afterReceipt.close();
      }
      const storedBytes = await readFile(dataPaths(state).database);
      for (const forbiddenStoredValue of [
        privateBody,
        routeRef,
        contextRef,
        "run_synthetic_private_001",
      ]) expect(storedBytes.includes(Buffer.from(forbiddenStoredValue))).toBeFalse();

      capture.clear();
      expect(await main([
        "--data-dir", state, "handoffs", "show", prepared.handoffId, "--json",
      ], capture.io)).toBe(0);
      expect(JSON.parse(capture.stdout())).toMatchObject({ state: "recorded", partCount: 2 });
      expect(capture.stdout()).not.toContain(privateBody);
      expect(capture.stdout()).not.toContain(routeRef);
      expect(capture.stdout()).not.toContain(contextRef);

      await chmod(contextPath, 0o644);
      capture.clear();
      expect(await main([
        "--data-dir", state, "handoff", "prepare", "contact_0123456789abcdef",
        "--request", requestPath,
        "--wrench-context", contextPath,
        "--draft", draftPath,
        "--output", join(root, "unsafe-output.json"),
        "--json",
      ], capture.io)).toBe(6);
      expect(capture.stderr()).toContain("owner-only permissions");
      expect(capture.stderr()).not.toContain(routeRef);
      await chmod(contextPath, 0o600);

      const linkedContext = join(root, "linked-context.json");
      await symlink(contextPath, linkedContext);
      capture.clear();
      expect(await main([
        "--data-dir", state, "handoff", "prepare", "contact_0123456789abcdef",
        "--request", requestPath,
        "--wrench-context", linkedContext,
        "--draft", draftPath,
        "--output", join(root, "linked-output.json"),
        "--json",
      ], capture.io)).toBe(6);
      expect(capture.stderr()).toContain("physical regular file");
      expect(capture.stderr()).not.toContain(routeRef);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

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

      capture.clear();
      expect(await main([
        "--data-dir", state, "contacts", "list", "--json",
      ], capture.io)).toBe(0);
      const contactId = (JSON.parse(capture.stdout()) as { contacts: Array<{ id: string }> })
        .contacts[0]!.id;
      capture.clear();
      expect(await main([
        "--data-dir", state, "inspect", "tempo", contactId, "--json",
      ], capture.io)).toBe(0);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        messageCount: 2,
        outgoingCount: 1,
        surface: { outgoingTextMessages: 1 },
        tempo: {
          responseEpisodes: 1,
          explicitReplyMessages: 0,
          explicitReplyEligibleMessages: 0,
          explicitReplyUnavailableMessages: 1,
          explicitReplyRatio: null,
        },
      });
      capture.clear();
      const xRoutesPath = join(root, "x-routes.json");
      expect(await main([
        "--data-dir", state, "routes", "list", contactId,
        "--output", xRoutesPath, "--json",
      ], capture.io)).toBe(0);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        selectionState: "unavailable",
        candidates: 1,
        eligibleCandidates: 0,
      });
      expect(capture.stdout()).not.toContain(contactId);
      expect(JSON.parse(await readFile(xRoutesPath, "utf8"))).toMatchObject({
        selection: { state: "unavailable", eligibleCandidateId: null },
        candidates: [{
          sourceKind: "x-archive",
          actionability: { state: "evidence-only", reason: "archive-source" },
        }],
      });
      const packetPath = join(root, "x-study-packet.json");
      capture.clear();
      expect(await main([
        "--data-dir", state, "study", "prepare", contactId,
        "--output", packetPath, "--json",
      ], capture.io)).toBe(0);
      const packet = JSON.parse(await readFile(packetPath, "utf8")) as StudyPacket;
      expect(packet.metrics).toMatchObject({
        messageCount: 2,
        outgoingCount: 1,
        tempo: {
          explicitReplyEligibleMessages: 0,
          explicitReplyUnavailableMessages: 1,
        },
      });
      expect(packet.examples).toHaveLength(1);
      expect(JSON.stringify(packet)).toContain("private outgoing body");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("replays exact X archive overlap idempotently and retains a later archive append", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-cli-x-overlap-replay-"));
    const capture = ioCapture();
    try {
      const state = join(root, "state");
      const bundlePath = await writeSyntheticMessageBundle(
        root,
        syntheticXOverlapBundleRecords(),
        { directoryName: "synthetic-x-beeper-bundle" },
      );
      expect(await main([
        "--data-dir", state, "ingest", "bundle", "--input", bundlePath, "--json",
      ], capture.io)).toBe(0);
      const beeperSourceId = (JSON.parse(capture.stdout()) as {
        sources: Array<{ id: string }>;
      }).sources[0]!.id;

      const archivePath = await writeSyntheticXArchive(root, { includeIdentityMetadata: true });
      const ingest = async (): Promise<Readonly<{
        active: { conversations: number; messages: number };
        corpusRevision: string;
        imported: { conversations: number; messages: number };
        reconciliation: { conversations: number; messages: number };
        source: { changed: boolean; id: string };
      }>> => {
        capture.clear();
        expect(await main([
          "--data-dir", state,
          "ingest", "x-archive",
          "--input", archivePath,
          "--overlap-source", beeperSourceId,
          "--json",
        ], capture.io)).toBe(0);
        for (const privateValue of [
          archivePath,
          bundlePath,
          "private incoming body",
          "private outgoing body",
          "private later outgoing body",
        ]) {
          expect(capture.stdout()).not.toContain(privateValue);
          expect(capture.stderr()).not.toContain(privateValue);
        }
        return JSON.parse(capture.stdout());
      };

      const first = await ingest();
      expect(first).toMatchObject({
        active: { conversations: 1, messages: 0 },
        imported: { conversations: 1, messages: 2 },
        reconciliation: { conversations: 1, messages: 2 },
        source: { changed: true },
      });

      const replay = await ingest();
      expect(replay).toMatchObject({
        active: first.active,
        imported: first.imported,
        reconciliation: first.reconciliation,
        source: { changed: false, id: first.source.id },
      });
      expect(replay.corpusRevision).toBe(first.corpusRevision);

      await writeSyntheticXArchive(root, {
        includeIdentityMetadata: true,
        laterOutgoingMessage: true,
      });
      const later = await ingest();
      expect(later).toMatchObject({
        active: { conversations: 1, messages: 1 },
        imported: { conversations: 1, messages: 3 },
        reconciliation: { conversations: 1, messages: 2 },
        source: { changed: true, id: first.source.id },
      });
      expect(later.corpusRevision).not.toBe(first.corpusRevision);

      capture.clear();
      expect(await main([
        "--data-dir", state, "doctor", "--json",
      ], capture.io)).toBe(0);
      expect(JSON.parse(capture.stdout())).toMatchObject({
        activeMessages: 3,
        conversationEquivalences: 1,
        foreignKeyViolations: 0,
        messageEquivalences: 2,
        quickCheck: "ok",
      });
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
