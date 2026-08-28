import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { canonicalJson } from "./canonical-json.ts";
import {
  LOCAL_MESSAGE_BUNDLE_V2_ARTIFACTS,
  LOCAL_MESSAGE_BUNDLE_V2_FORMAT,
  LOCAL_MESSAGE_BUNDLE_V2_NETWORK,
  LOCAL_MESSAGE_BUNDLE_V2_PROVIDER_ID,
  LOCAL_MESSAGE_BUNDLE_V2_SCHEMA_VERSION,
  LOCAL_MESSAGE_BUNDLE_V2_SOURCE_ID,
  LOCAL_MESSAGE_BUNDLE_V2_SOURCE_TRANSFORM_VERSION,
  MessageBundleV2ContractError,
  localMessageBundleV2BundleSha256,
  localMessageBundleV2ManifestProjection,
  parseLocalMessageBundleV2Manifest,
  parseLocalMessageBundleV2Record,
  parseLocalMessageBundleV2WhatsAppJid,
} from "./message-bundle-v2.ts";
import {
  syntheticWhatsAppBundleRecords,
  writeSyntheticMessageBundle,
} from "./test-bundle-fixture.ts";

describe("local message bundle v2 public contract", () => {
  test("parses one canonical synthetic Wrench/Wacli fixture", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-wacli-contract-"));
    try {
      const records = syntheticWhatsAppBundleRecords();
      const path = await writeSyntheticMessageBundle(root, records, { schemaVersion: 2 });
      const manifestBytes = await readFile(join(path, "manifest.json"), "utf8");
      const manifest = parseLocalMessageBundleV2Manifest(JSON.parse(manifestBytes) as unknown);
      expect(manifest).toMatchObject({
        schemaVersion: LOCAL_MESSAGE_BUNDLE_V2_SCHEMA_VERSION,
        format: LOCAL_MESSAGE_BUNDLE_V2_FORMAT,
        source: {
          id: LOCAL_MESSAGE_BUNDLE_V2_SOURCE_ID,
          version: LOCAL_MESSAGE_BUNDLE_V2_SOURCE_TRANSFORM_VERSION,
        },
        provider: { id: LOCAL_MESSAGE_BUNDLE_V2_PROVIDER_ID },
      });
      expect(`${canonicalJson(manifest)}\n`).toBe(manifestBytes);
      expect(localMessageBundleV2BundleSha256(localMessageBundleV2ManifestProjection(manifest)))
        .toBe(manifest.integrity.bundleSha256);
      for (const artifact of LOCAL_MESSAGE_BUNDLE_V2_ARTIFACTS) {
        const text = await readFile(join(path, artifact.path), "utf8");
        const lines = text === "" ? [] : text.slice(0, -1).split("\n");
        const parsed = lines.map((line, index) => parseLocalMessageBundleV2Record(
          JSON.parse(line) as unknown,
          artifact.kind,
          `${artifact.path}:${index + 1}`,
        ));
        expect(parsed.map((record) => `${canonicalJson(record)}\n`).join("")).toBe(text);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("admits only canonical user, LID, and group JIDs", () => {
    expect(parseLocalMessageBundleV2WhatsAppJid("15555550100@s.whatsapp.net"))
      .toEqual({ jid: "15555550100@s.whatsapp.net", kind: "user", e164: "+15555550100" });
    expect(parseLocalMessageBundleV2WhatsAppJid("123456789012345@lid"))
      .toEqual({ jid: "123456789012345@lid", kind: "lid", e164: null });
    expect(parseLocalMessageBundleV2WhatsAppJid("120363123456789012@g.us"))
      .toEqual({ jid: "120363123456789012@g.us", kind: "group", e164: null });
    for (const rejected of [
      "status@broadcast",
      "15555550100@broadcast",
      "120363123456789012@newsletter",
      "15555550100@S.WHATSAPP.NET",
      "+15555550100@s.whatsapp.net",
    ]) {
      expect(() => parseLocalMessageBundleV2WhatsAppJid(rejected)).toThrow(
        MessageBundleV2ContractError,
      );
    }
  });

  test("fails closed on network, handle, surface, and source drift", () => {
    const records = syntheticWhatsAppBundleRecords();
    records.account[0]!.network = "whatsapp-business";
    expect(() => parseLocalMessageBundleV2Record(records.account[0], "account"))
      .toThrow(`network must be ${LOCAL_MESSAGE_BUNDLE_V2_NETWORK}`);

    const participant = syntheticWhatsAppBundleRecords().participant[1]!;
    participant.handle = "+15555550999";
    expect(() => parseLocalMessageBundleV2Record(participant, "participant"))
      .toThrow("exact E.164 projection");

    const conversation = syntheticWhatsAppBundleRecords().conversation[0]!;
    conversation.type = "channel";
    expect(() => parseLocalMessageBundleV2Record(conversation, "conversation"))
      .toThrow("must be one of: direct, group");

    const incompleteDirect = syntheticWhatsAppBundleRecords().conversation[0]!;
    incompleteDirect.participantsComplete = false;
    expect(() => parseLocalMessageBundleV2Record(incompleteDirect, "conversation"))
      .toThrow("direct roster must contain exactly two proven participants");
  });
});
