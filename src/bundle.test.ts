import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readMessageBundle } from "./bundle.ts";
import { canonicalJson, sha256 } from "./canonical-json.ts";
import { CliError } from "./errors.ts";
import { LocalStore } from "./store.ts";
import {
  syntheticBundleRecords,
  writeSyntheticMessageBundle,
} from "./test-bundle-fixture.ts";

const TEST_KEY = "synthetic-bundle-test-key-32-bytes";
const GOLDEN_MANIFEST_SHA256 = "e46f4a524d53f849cfac594fb5bc8cf28e7a9743c138039b81a0aad4ff4830ef";
const GOLDEN_FILES = Object.freeze([
  "accounts.ndjson",
  "participants.ndjson",
  "conversations.ndjson",
  "messages.ndjson",
  "reactions.ndjson",
  "tombstones.ndjson",
  "manifest.json",
]);

async function materializeWrenchGoldenBundle(parent: string): Promise<string> {
  const source = join(import.meta.dir, "fixtures", "beeper-message-like-me-v1");
  const target = join(parent, "beeper-message-like-me-v1");
  await mkdir(target, { mode: 0o700 });
  await chmod(target, 0o700);
  for (const file of GOLDEN_FILES) {
    const bytes = await readFile(join(source, file));
    await writeFile(join(target, file), bytes, { mode: 0o600 });
    await chmod(join(target, file), 0o600);
  }
  return realpath(target);
}

async function replaceArtifactBytes(
  bundlePath: string,
  artifactPath: string,
  bytes: Uint8Array,
): Promise<void> {
  await writeFile(join(bundlePath, artifactPath), bytes, { mode: 0o600 });
  await chmod(join(bundlePath, artifactPath), 0o600);
  const manifestPath = join(bundlePath, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    artifacts: Array<{ path: string; records: number; bytes: number; sha256: string }>;
    integrity: { algorithm: "sha256"; bundleSha256: string };
    [key: string]: unknown;
  };
  const artifact = manifest.artifacts.find(({ path }) => path === artifactPath);
  if (artifact === undefined) throw new Error("Synthetic artifact is absent from its manifest");
  artifact.bytes = bytes.byteLength;
  artifact.sha256 = sha256(bytes);
  const { integrity: _integrity, ...projection } = manifest;
  manifest.integrity = { algorithm: "sha256", bundleSha256: sha256(canonicalJson(projection)) };
  await writeFile(manifestPath, `${canonicalJson(manifest)}\n`, { mode: 0o600 });
  await chmod(manifestPath, 0o600);
}

describe("private local message bundle", () => {
  test("imports the exact canonical bundle emitted by Wrench", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-wrench-golden-"));
    try {
      const vendoredManifest = await readFile(join(
        import.meta.dir,
        "fixtures",
        "beeper-message-like-me-v1",
        "manifest.json",
      ));
      expect(sha256(vendoredManifest)).toBe(GOLDEN_MANIFEST_SHA256);
      const path = await materializeWrenchGoldenBundle(root);
      const bundle = await readMessageBundle(path, { hmacKey: TEST_KEY });
      expect(bundle.manifestSha256).toBe(GOLDEN_MANIFEST_SHA256);
      expect(bundle.sources).toHaveLength(1);
      expect(bundle.sources[0]!.source).toMatchObject({
        provider: "beeper",
        network: "synthetic",
        producer: { id: "beeper-local", version: "1.0.0" },
        coverage: {
          kind: "truncated",
          reason: "explicit-source-limit",
        },
      });
      expect(bundle.sources[0]!.messages[0]).toMatchObject({
        body: "edited synthetic reply",
        editedAt: "2026-08-21T15:58:30.000Z",
        retractedAt: null,
        replyToSourceGuid: "beeper-message:synthetic-external-reply-target",
      });
      expect(bundle.sources[0]!.messages[1]).toMatchObject({
        body: null,
        retractedAt: "2026-08-21T15:59:00.000Z",
        direction: "incoming",
      });
      expect(bundle.sources[0]!.reactionFacts).toMatchObject([{
        body: "👍",
        reactedAt: null,
        direction: "incoming",
      }]);
      expect(bundle.sources[0]!.deletions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          entityKind: "message",
          externalId: "beeper-message:synthetic-deleted",
          deletedAt: "2026-08-21T15:59:00.000Z",
        }),
      ]));
      expect(bundle.sources[0]!.deletions?.some(({ externalId }) =>
        externalId === "beeper-message:synthetic-edited")).toBeFalse();

      const store = LocalStore.open(join(root, "golden-store.sqlite3"));
      try {
        store.replaceSources(bundle.sources, "2026-08-21T16:01:00.000Z", TEST_KEY);
        expect(store.listSources()).toMatchObject([{
          provider: "beeper",
          network: "synthetic",
          conversations: 1,
          messages: 1,
          reactions: 1,
          undatedReactions: 1,
          coverage: {
            kind: "truncated",
            reason: "explicit-source-limit",
          },
        }]);
      } finally {
        store.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("verifies and normalizes Wrench's six-artifact contract", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-bundle-"));
    try {
      const path = await writeSyntheticMessageBundle(root);
      const bundle = await readMessageBundle(path, { hmacKey: TEST_KEY });
      expect(bundle.schemaVersion).toBe(1);
      expect(bundle.manifestSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(bundle.sources).toHaveLength(1);
      const source = bundle.sources[0]!;
      expect(source.source).toMatchObject({
        kind: "bundle",
        provider: "beeper",
        network: "whatsapp",
        coverage: {
          history: "bounded",
          kind: "truncated",
          reason: "synthetic-limit",
        },
      });
      expect(source.source.id).toMatch(/^source_[a-f0-9]{64}$/u);
      expect(source.conversations[0]).toMatchObject({
        group: false,
        privateParticipants: ["peer@example.test"],
      });
      const outgoing = source.messages.find(({ sourceGuid }) =>
        sourceGuid === "message-provider-outgoing")!;
      expect(outgoing).toMatchObject({
        kind: "text",
        body: "Synthetic answer.",
        replyToSourceGuid: "message-provider-incoming",
        attachmentCount: 1,
      });
      expect(source.messageProvenance.find(({ messageId }) => messageId === outgoing.id))
        .toMatchObject({
          replyToExternalId: "message-provider-incoming",
          attachments: [{
            kind: "image",
            mimeType: "image/png",
            fileName: "synthetic.png",
            bytes: 1234,
          }],
        });
      expect(source.messages.find(({ sourceGuid }) => sourceGuid === "message-provider-truncated"))
        .toMatchObject({ kind: "text", body: null, bodySource: "unavailable" });
      expect(source.messages.find(({ sourceGuid }) => sourceGuid === "message-provider-deleted"))
        .toMatchObject({ body: null, retractedAt: "2026-08-20T12:04:00.000Z" });
      expect(source.deletions).toContainEqual(expect.objectContaining({
        entityKind: "message",
        externalId: "message-provider-deleted",
        deletedAt: "2026-08-20T12:04:00.000Z",
      }));
      expect(source.messages.filter(({ kind }) => kind === "reaction")).toHaveLength(1);
      expect(source.reactionFacts).toMatchObject([
        { body: "heart", reactedAt: "2026-08-20T12:01:30.000Z", direction: "incoming" },
        { body: "thumbs-up", reactedAt: null, direction: "outgoing" },
      ]);
      expect(source.auxiliaryRecords?.filter(({ kind }) => kind === "reaction")).toHaveLength(2);
      expect(source.source.warnings).toContain("undated-reactions:1");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("uses fatal UTF-8 decoding before canonical byte comparison", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-bundle-utf8-"));
    try {
      const path = await writeSyntheticMessageBundle(root);
      const accountsPath = join(path, "accounts.ndjson");
      const bytes = Buffer.from(await readFile(accountsPath));
      bytes[10] = 0xff;
      await writeFile(accountsPath, bytes, { mode: 0o600 });
      await expect(readMessageBundle(path, { hmacKey: TEST_KEY })).rejects.toThrow("valid UTF-8");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects deeply nested foreign fields before recursive canonicalization", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-bundle-depth-"));
    const deepValue = `${"[".repeat(20_000)}0${"]".repeat(20_000)}`;
    try {
      const artifactPath = await writeSyntheticMessageBundle(root, syntheticBundleRecords(), {
        directoryName: "deep-artifact",
      });
      const messagesPath = join(artifactPath, "messages.ndjson");
      const original = (await readFile(messagesPath, "utf8")).trimEnd();
      const bytes = Buffer.from(`${original.slice(0, -1)},"unexpected":${deepValue}}\n`, "utf8");
      await replaceArtifactBytes(artifactPath, "messages.ndjson", bytes);
      try {
        await readMessageBundle(artifactPath, { hmacKey: TEST_KEY });
        throw new Error("Expected deep artifact rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(CliError);
        expect(error).not.toBeInstanceOf(RangeError);
      }

      const manifestBundle = await writeSyntheticMessageBundle(root, syntheticBundleRecords(), {
        directoryName: "deep-manifest",
      });
      const manifestPath = join(manifestBundle, "manifest.json");
      const originalManifest = (await readFile(manifestPath, "utf8")).trimEnd();
      await writeFile(
        manifestPath,
        `${originalManifest.slice(0, -1)},"unexpected":${deepValue}}\n`,
        { mode: 0o600 },
      );
      await chmod(manifestPath, 0o600);
      try {
        await readMessageBundle(manifestBundle, { hmacKey: TEST_KEY });
        throw new Error("Expected deep manifest rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(CliError);
        expect(error).not.toBeInstanceOf(RangeError);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects incomplete identity joins before creating local coordinates", async () => {
    const cases: Array<Readonly<{
      name: string;
      mutate: (records: ReturnType<typeof syntheticBundleRecords>) => void;
      error: string;
    }>> = [
      {
        name: "unknown roster participant",
        mutate: (records) => {
          records.conversation[0]!.participantIds = ["participant-self", "participant-missing"];
        },
        error: "unknown participant",
      },
      {
        name: "complete direct roster without self",
        mutate: (records) => {
          records.conversation[0]!.participantIds = ["participant-peer"];
        },
        error: "one self and one non-self participant",
      },
      {
        name: "complete direct roster with only self",
        mutate: (records) => {
          records.conversation[0]!.participantIds = ["participant-self"];
        },
        error: "one self and one non-self participant",
      },
      {
        name: "sender direction mismatch",
        mutate: (records) => {
          records.message[0]!.direction = "outgoing";
        },
        error: "direction conflicts",
      },
      {
        name: "duplicate provider coordinate",
        mutate: (records) => {
          records.participant.push({
            ...records.participant[1]!,
            id: "participant-duplicate-local",
          });
        },
        error: "repeat a provider identity",
      },
      {
        name: "reply coordinate mismatch",
        mutate: (records) => {
          records.message[1]!.replyTo = {
            messageId: "message-incoming",
            providerId: "different-provider-message",
          };
        },
        error: "reply has mismatched target coordinates",
      },
      {
        name: "reaction coordinate mismatch",
        mutate: (records) => {
          records.reaction[0]!.messageProviderId = "different-provider-message";
        },
        error: "reaction has mismatched target coordinates",
      },
    ];
    for (const [index, candidate] of cases.entries()) {
      const root = await mkdtemp(join(tmpdir(), `message-like-me-bundle-join-${index}-`));
      try {
        const records = syntheticBundleRecords();
        candidate.mutate(records);
        const path = await writeSyntheticMessageBundle(root, records);
        await expect(readMessageBundle(path, { hmacKey: TEST_KEY }))
          .rejects.toThrow(candidate.error);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  test("rejects a tombstone whose local and provider coordinates disagree", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-bundle-tombstone-"));
    try {
      const records = syntheticBundleRecords();
      records.tombstone.push({
        schemaVersion: 1,
        kind: "tombstone",
        id: "tombstone-local",
        accountId: "account-local",
        network: "whatsapp",
        provenance: {
          providerId: "tombstone-provider",
          providerRevision: null,
          observedAt: "2026-08-20T12:05:00.000Z",
          connectedAccountProviderId: "synthetic-connected-account",
        },
        entityKind: "message",
        entityId: "message-incoming",
        entityProviderId: "different-message-provider",
        deletedAt: "2026-08-20T12:05:00.000Z",
        scope: "remote",
        providerRevision: null,
      });
      const path = await writeSyntheticMessageBundle(root, records);
      await expect(readMessageBundle(path, { hmacKey: TEST_KEY }))
        .rejects.toThrow("mismatched message identity");
      const missing = syntheticBundleRecords();
      missing.tombstone.push({
        ...records.tombstone[0]!,
        id: "tombstone-missing-local",
        provenance: {
          providerId: "tombstone-provider-missing",
          providerRevision: null,
          observedAt: "2026-08-20T12:05:00.000Z",
          connectedAccountProviderId: "synthetic-connected-account",
        },
        entityId: "private-missing-local-id",
        entityProviderId: "private-missing-provider-id",
      });
      const missingPath = await writeSyntheticMessageBundle(root, missing, {
        directoryName: "missing-tombstone-target",
      });
      try {
        await readMessageBundle(missingPath, { hmacKey: TEST_KEY });
        throw new Error("Expected unresolved tombstone rejection");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).toContain("unknown local message");
        expect(message).not.toContain("private-missing-local-id");
        expect(message).not.toContain("private-missing-provider-id");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("turns terminal edits and removed reactions into explicit suppressions", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-bundle-terminal-"));
    try {
      const records = syntheticBundleRecords();
      records.message.push({
        ...records.message[1]!,
        id: "message-edit-local",
        provenance: {
          providerId: "message-provider-edit",
          providerRevision: "revision-edit",
          observedAt: "2026-08-20T12:05:00.000Z",
          connectedAccountProviderId: "synthetic-connected-account",
        },
        sentAt: "2026-08-20T12:01:00.000Z",
        sortKey: "0002-edit",
        body: "Synthetic edited answer.",
        replyTo: null,
        edit: {
          kind: "replacement",
          replacesMessageId: "message-outgoing",
          replacesProviderId: "message-provider-outgoing",
          editedAt: "2026-08-20T12:02:00.000Z",
          providerRevision: "revision-edit",
        },
        attachments: [],
      });
      records.reaction.push({
        ...records.reaction[0]!,
        id: "reaction-removed",
        provenance: {
          providerId: "reaction-provider-removed",
          providerRevision: "reaction-revision",
          observedAt: "2026-08-20T12:05:00.000Z",
          connectedAccountProviderId: "synthetic-connected-account",
        },
        reactedAt: null,
        state: "removed",
      });
      const path = await writeSyntheticMessageBundle(root, records);
      const source = (await readMessageBundle(path, { hmacKey: TEST_KEY })).sources[0]!;
      expect(source.deletions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          entityKind: "message",
          externalId: "message-provider-outgoing",
          deletedAt: "2026-08-20T12:02:00.000Z",
        }),
        expect.objectContaining({
          entityKind: "reaction",
          externalId: "reaction-provider-removed",
          deletedAt: "2026-08-20T12:05:00.000Z",
        }),
      ]));
      const inPlaceRecords = syntheticBundleRecords();
      inPlaceRecords.message[1]!.edit = {
        kind: "in-place",
        editedAt: "2026-08-20T12:02:00.000Z",
        providerRevision: "revision-in-place",
      };
      const inPlacePath = await writeSyntheticMessageBundle(root, inPlaceRecords, {
        directoryName: "in-place-edit-bundle",
      });
      const inPlace = (await readMessageBundle(inPlacePath, { hmacKey: TEST_KEY })).sources[0]!;
      expect(inPlace.messages.find(({ sourceGuid }) => sourceGuid === "message-provider-outgoing"))
        .toMatchObject({ editedAt: "2026-08-20T12:02:00.000Z" });
      expect(inPlace.deletions?.some(({ externalId }) =>
        externalId === "message-provider-outgoing")).toBeFalse();

      const cyclic = syntheticBundleRecords();
      cyclic.message[0]!.edit = {
        kind: "replacement",
        replacesMessageId: "message-outgoing",
        replacesProviderId: "message-provider-outgoing",
        editedAt: "2026-08-20T12:02:00.000Z",
        providerRevision: "cycle-a",
      };
      cyclic.message[1]!.edit = {
        kind: "replacement",
        replacesMessageId: "message-incoming",
        replacesProviderId: "message-provider-incoming",
        editedAt: "2026-08-20T12:02:00.000Z",
        providerRevision: "cycle-b",
      };
      const cyclicPath = await writeSyntheticMessageBundle(root, cyclic, {
        directoryName: "cyclic-edit-bundle",
      });
      await expect(readMessageBundle(cyclicPath, { hmacKey: TEST_KEY }))
        .rejects.toThrow("contain a cycle");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("validates the private HMAC key before touching bundle input", async () => {
    await expect(readMessageBundle("/synthetic/does-not-exist", { hmacKey: "short" }))
      .rejects.toThrow("HMAC key");
  });

  test("orders opaque provider sort keys by code units", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-bundle-order-"));
    try {
      const records = syntheticBundleRecords();
      records.message[0]!.sortKey = "Z";
      records.message[1]!.sortKey = "a";
      records.message[2]!.sortKey = "b";
      records.message[3]!.sortKey = "c";
      records.message.reverse();
      const path = await writeSyntheticMessageBundle(root, records);
      const source = (await readMessageBundle(path, { hmacKey: TEST_KEY })).sources[0]!;
      expect(source.messages.filter(({ kind }) => kind !== "reaction").map(({ sourceGuid }) => sourceGuid))
        .toEqual([
          "message-provider-incoming",
          "message-provider-outgoing",
          "message-provider-truncated",
          "message-provider-deleted",
        ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("keeps one stable source and entity namespace when a network label changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-bundle-network-"));
    try {
      const firstPath = await writeSyntheticMessageBundle(root, syntheticBundleRecords(), {
        directoryName: "first-network",
      });
      const changedRecords = syntheticBundleRecords();
      for (const values of Object.values(changedRecords)) {
        for (const record of values) record.network = "whatsapp-business";
      }
      const changedPath = await writeSyntheticMessageBundle(root, changedRecords, {
        directoryName: "renamed-network",
        createdAt: "2026-08-20T12:06:00.000Z",
      });
      const first = (await readMessageBundle(firstPath, { hmacKey: TEST_KEY })).sources[0]!;
      const changed = (await readMessageBundle(changedPath, { hmacKey: TEST_KEY })).sources[0]!;
      expect(changed.source.id).toBe(first.source.id);
      expect(changed.conversations.map(({ id }) => id)).toEqual(first.conversations.map(({ id }) => id));
      expect(changed.messages.map(({ id }) => id).sort()).toEqual(first.messages.map(({ id }) => id).sort());

      const store = LocalStore.open(join(root, "network-store.sqlite3"));
      try {
        store.replaceSources([first], "2026-08-20T12:05:30.000Z", TEST_KEY);
        store.replaceSources([changed], "2026-08-20T12:06:30.000Z", TEST_KEY);
        expect(store.listSources()).toMatchObject([{
          id: first.source.id,
          network: "whatsapp-business",
          conversations: 1,
          messages: 4,
        }]);
      } finally {
        store.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("derives completeness time bounds independently for each account", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-bundle-account-bounds-"));
    try {
      const records = syntheticBundleRecords();
      records.account.push({
        schemaVersion: 1,
        kind: "account",
        id: "account-empty",
        accountId: "account-empty",
        network: "signal",
        provenance: {
          providerId: "synthetic-connected-account-empty",
          providerRevision: null,
          observedAt: "2026-08-20T12:05:00.000Z",
          connectedAccountProviderId: "synthetic-connected-account-empty",
        },
        displayName: "Synthetic Empty Account",
        handle: null,
        selfParticipantId: "participant-empty-self",
      });
      records.participant.push({
        schemaVersion: 1,
        kind: "participant",
        id: "participant-empty-self",
        accountId: "account-empty",
        network: "signal",
        provenance: {
          providerId: "participant-provider-empty-self",
          providerRevision: null,
          observedAt: "2026-08-20T12:05:00.000Z",
          connectedAccountProviderId: "synthetic-connected-account-empty",
        },
        displayName: "Synthetic Empty Self",
        handle: null,
        isSelf: true,
      });
      const path = await writeSyntheticMessageBundle(root, records);
      const bundle = await readMessageBundle(path, { hmacKey: TEST_KEY });
      expect(bundle.sources).toHaveLength(2);
      expect(bundle.sources.find(({ source }) => source.network === "whatsapp")?.source.coverage)
        .toMatchObject({
          observedFrom: "2026-08-20T12:00:00.000Z",
          observedTo: "2026-08-20T12:03:00.000Z",
        });
      expect(bundle.sources.find(({ source }) => source.network === "signal")?.source.coverage)
        .toMatchObject({ observedFrom: null, observedTo: null });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("domain-separates a reaction timeline coordinate from an equal message provider ID", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-bundle-cross-kind-id-"));
    try {
      const records = syntheticBundleRecords();
      const sharedProviderId = records.message[0]!.provenance as Record<string, unknown>;
      (records.reaction[0]!.provenance as Record<string, unknown>).providerId = sharedProviderId.providerId;
      const path = await writeSyntheticMessageBundle(root, records);
      const source = (await readMessageBundle(path, { hmacKey: TEST_KEY })).sources[0]!;
      const rawProviderId = String(sharedProviderId.providerId);
      const message = source.messages.find(({ kind, sourceGuid }) =>
        kind !== "reaction" && sourceGuid === rawProviderId);
      const timelineReaction = source.messages.find(({ kind }) => kind === "reaction");
      expect(message).toBeDefined();
      expect(timelineReaction).toBeDefined();
      expect(timelineReaction!.sourceGuid).not.toBe(rawProviderId);
      expect(timelineReaction!.sourceGuid.startsWith("\u001freaction-timeline:")).toBeTrue();
      expect(source.reactionFacts?.find(({ id }) => id === timelineReaction!.id)?.externalId)
        .toBe(rawProviderId);
      expect(source.messageProvenance.find(({ messageId }) => messageId === timelineReaction!.id))
        .toMatchObject({
          externalId: timelineReaction!.sourceGuid,
          metadata: { provenance: { providerId: rawProviderId } },
        });

      const store = LocalStore.open(join(root, "cross-kind-store.sqlite3"));
      try {
        expect(() => store.replaceSources(
          [source],
          "2026-08-20T12:06:00.000Z",
          TEST_KEY,
        )).not.toThrow();
        expect(store.listSources()).toMatchObject([{
          conversations: 1,
          messages: 4,
          reactions: 2,
          undatedReactions: 1,
        }]);
      } finally {
        store.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
