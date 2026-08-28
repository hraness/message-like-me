import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readMessageBundle } from "./bundle.ts";
import { LocalStore } from "./store.ts";
import {
  syntheticBundleRecords,
  syntheticWhatsAppBundleRecords,
  writeSyntheticMessageBundle,
} from "./test-bundle-fixture.ts";
import {
  planWacliBeeperWhatsAppEquivalence,
  wacliBundleMatchesBeeperWhatsAppSource,
} from "./whatsapp-source.ts";

const KEY = "synthetic-whatsapp-overlap-key";

function syntheticBeeperWhatsAppRecords() {
  const records = syntheticBundleRecords();
  records.account[0]!.handle = "+15555550100";
  records.participant[0]!.handle = "+15555550100";
  records.participant[1]!.handle = "+15555550101";
  return records;
}

describe("native WhatsApp and Beeper overlap", () => {
  test("prefers native Wacli evidence after exact account, peer, and message proof", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-whatsapp-overlap-"));
    try {
      const beeperPath = await writeSyntheticMessageBundle(root, syntheticBeeperWhatsAppRecords(), {
        directoryName: "beeper-whatsapp",
      });
      const nativePath = await writeSyntheticMessageBundle(root, syntheticWhatsAppBundleRecords(), {
        directoryName: "wacli-whatsapp",
        schemaVersion: 2,
      });
      const beeper = (await readMessageBundle(beeperPath, { hmacKey: KEY })).sources[0]!;
      const native = (await readMessageBundle(nativePath, { hmacKey: KEY })).sources[0]!;
      const store = LocalStore.open(join(root, "overlap.sqlite3"));
      try {
        store.replaceSources([beeper], "2026-08-20T12:06:00.000Z", KEY);
        const evidence = store.sourceOverlapEvidence(beeper.source.id);
        expect(wacliBundleMatchesBeeperWhatsAppSource(native, evidence)).toBeTrue();
        const plan = planWacliBeeperWhatsAppEquivalence(native, evidence);
        expect(plan).toMatchObject({
          duplicateSourceId: beeper.source.id,
          preferredSourceId: native.source.id,
          basis: "exact-message-overlap",
        });
        expect(plan.conversations).toHaveLength(1);
        expect(plan.messages).toHaveLength(2);
        expect(plan.reactions).toHaveLength(2);

        store.replaceSources([native], "2026-08-20T12:07:00.000Z", KEY, plan);
        const nativeConversationId = native.conversations[0]!.id;
        expect(store.contactCorpus(nativeConversationId)?.messages.filter(({ kind }) =>
          kind !== "reaction")).toHaveLength(4);
        const routes = store.routeCandidates(nativeConversationId, true)!.candidates;
        expect(routes).toHaveLength(2);
        expect(routes.find(({ provider }) => provider === "whatsapp")).toMatchObject({
          actionability: {
            state: "wrench-binding-eligible",
            reason: "requires-exact-wrench-binding",
          },
          privateBinding: {
            coordinate: { kind: "whatsappJid", jid: "15555550101@s.whatsapp.net" },
          },
        });
        expect(routes.find(({ provider }) => provider === "beeper")).toMatchObject({
          actionability: { state: "evidence-only", reason: "superseded-route" },
        });
        expect(store.doctor()).toMatchObject({
          conversationEquivalences: 1,
          messageEquivalences: 2,
          reactionEquivalences: 2,
          foreignKeyViolations: 0,
        });
      } finally {
        store.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects a different account instead of matching phone-like evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-whatsapp-overlap-reject-"));
    try {
      const beeperRecords = syntheticBeeperWhatsAppRecords();
      beeperRecords.account[0]!.handle = "+15555550999";
      beeperRecords.participant[0]!.handle = "+15555550999";
      const beeperPath = await writeSyntheticMessageBundle(root, beeperRecords, {
        directoryName: "different-account",
      });
      const nativePath = await writeSyntheticMessageBundle(root, syntheticWhatsAppBundleRecords(), {
        directoryName: "native",
        schemaVersion: 2,
      });
      const beeper = (await readMessageBundle(beeperPath, { hmacKey: KEY })).sources[0]!;
      const native = (await readMessageBundle(nativePath, { hmacKey: KEY })).sources[0]!;
      const store = LocalStore.open(join(root, "reject.sqlite3"));
      try {
        store.replaceSources([beeper], "2026-08-20T12:06:00.000Z", KEY);
        const evidence = store.sourceOverlapEvidence(beeper.source.id);
        expect(wacliBundleMatchesBeeperWhatsAppSource(native, evidence)).toBeFalse();
        expect(() => planWacliBeeperWhatsAppEquivalence(native, evidence))
          .toThrow("different exact E.164 accounts");
      } finally {
        store.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("does not use bodyless events as overlap proof", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-whatsapp-overlap-bodyless-"));
    try {
      const beeperRecords = syntheticBeeperWhatsAppRecords();
      const nativeRecords = syntheticWhatsAppBundleRecords();
      for (const message of beeperRecords.message) message.body = null;
      for (const message of nativeRecords.message) message.body = null;
      const beeperPath = await writeSyntheticMessageBundle(root, beeperRecords, {
        directoryName: "bodyless-beeper",
      });
      const nativePath = await writeSyntheticMessageBundle(root, nativeRecords, {
        directoryName: "bodyless-native",
        schemaVersion: 2,
      });
      const beeper = (await readMessageBundle(beeperPath, { hmacKey: KEY })).sources[0]!;
      const native = (await readMessageBundle(nativePath, { hmacKey: KEY })).sources[0]!;
      const store = LocalStore.open(join(root, "bodyless.sqlite3"));
      try {
        store.replaceSources([beeper], "2026-08-20T12:06:00.000Z", KEY);
        const evidence = store.sourceOverlapEvidence(beeper.source.id);
        expect(wacliBundleMatchesBeeperWhatsAppSource(native, evidence)).toBeTrue();
        expect(() => planWacliBeeperWhatsAppEquivalence(native, evidence))
          .toThrow("no unambiguous exact message overlap");
      } finally {
        store.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
