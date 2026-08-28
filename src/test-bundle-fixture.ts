import { chmod, mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { canonicalJson, sha256 } from "./canonical-json.ts";
import {
  LOCAL_MESSAGE_BUNDLE_V1_ARTIFACTS,
  LOCAL_MESSAGE_BUNDLE_V1_FORMAT,
  LOCAL_MESSAGE_BUNDLE_V1_PROVIDER_ID,
  LOCAL_MESSAGE_BUNDLE_V1_SCHEMA_VERSION,
  LOCAL_MESSAGE_BUNDLE_V1_SOURCE_ID,
  LOCAL_MESSAGE_BUNDLE_V1_SOURCE_TRANSFORM_VERSION,
} from "./message-bundle-v1.ts";
import {
  LOCAL_MESSAGE_BUNDLE_V2_FORMAT,
  LOCAL_MESSAGE_BUNDLE_V2_PROVIDER_ID,
  LOCAL_MESSAGE_BUNDLE_V2_PROVIDER_VERSION,
  LOCAL_MESSAGE_BUNDLE_V2_SCHEMA_VERSION,
  LOCAL_MESSAGE_BUNDLE_V2_SOURCE_ID,
  LOCAL_MESSAGE_BUNDLE_V2_SOURCE_TRANSFORM_VERSION,
} from "./message-bundle-v2.ts";

export const BUNDLE_ARTIFACTS = LOCAL_MESSAGE_BUNDLE_V1_ARTIFACTS;

export type BundleArtifactKind = typeof BUNDLE_ARTIFACTS[number]["kind"];
export type SyntheticBundleRecords = Record<BundleArtifactKind, Array<Record<string, unknown>>>;

const CONNECTED_ACCOUNT = "synthetic-connected-account";
const OBSERVED_AT = "2026-08-20T12:05:00.000Z";

function provenance(providerId: string): Record<string, unknown> {
  return {
    providerId,
    providerRevision: null,
    observedAt: OBSERVED_AT,
    connectedAccountProviderId: CONNECTED_ACCOUNT,
  };
}

function common(kind: BundleArtifactKind, id: string, providerId: string): Record<string, unknown> {
  return {
    schemaVersion: LOCAL_MESSAGE_BUNDLE_V1_SCHEMA_VERSION,
    kind,
    id,
    accountId: "account-local",
    network: "whatsapp",
    provenance: provenance(providerId),
  };
}

export function syntheticBundleRecords(): SyntheticBundleRecords {
  return {
    account: [{
      ...common("account", "account-local", CONNECTED_ACCOUNT),
      displayName: "Synthetic Account",
      handle: null,
      selfParticipantId: "participant-self",
    }],
    participant: [
      {
        ...common("participant", "participant-self", "participant-provider-self"),
        displayName: "Synthetic Self",
        handle: "+15555550100",
        isSelf: true,
      },
      {
        ...common("participant", "participant-peer", "participant-provider-peer"),
        displayName: "Synthetic Peer",
        handle: "peer@example.test",
        isSelf: false,
      },
    ],
    conversation: [{
      ...common("conversation", "conversation-local", "conversation-provider-1"),
      type: "direct",
      title: "Synthetic Direct",
      participantIds: ["participant-self", "participant-peer"],
      participantsComplete: true,
      startedAt: "2026-08-20T12:00:00.000Z",
      lastMessageAt: "2026-08-20T12:04:00.000Z",
    }],
    message: [
      {
        ...common("message", "message-incoming", "message-provider-incoming"),
        conversationId: "conversation-local",
        senderParticipantId: "participant-peer",
        direction: "incoming",
        sentAt: "2026-08-20T12:00:00.000Z",
        sortKey: "0001",
        body: "Synthetic question?",
        bodyTruncated: false,
        replyTo: null,
        edit: null,
        deletion: null,
        attachments: [],
      },
      {
        ...common("message", "message-outgoing", "message-provider-outgoing"),
        conversationId: "conversation-local",
        senderParticipantId: "participant-self",
        direction: "outgoing",
        sentAt: "2026-08-20T12:01:00.000Z",
        sortKey: "0002",
        body: "Synthetic answer.",
        bodyTruncated: false,
        replyTo: { messageId: "message-incoming", providerId: "message-provider-incoming" },
        edit: null,
        deletion: null,
        attachments: [{
          kind: "image",
          mimeType: "image/png",
          name: "synthetic.png",
          sizeBytes: 1234,
        }],
      },
      {
        ...common("message", "message-truncated", "message-provider-truncated"),
        conversationId: "conversation-local",
        senderParticipantId: "participant-self",
        direction: "outgoing",
        sentAt: "2026-08-20T12:02:00.000Z",
        sortKey: "0003",
        body: "Synthetic partial body",
        bodyTruncated: true,
        replyTo: null,
        edit: null,
        deletion: null,
        attachments: [],
      },
      {
        ...common("message", "message-deleted", "message-provider-deleted"),
        conversationId: "conversation-local",
        senderParticipantId: "participant-peer",
        direction: "incoming",
        sentAt: "2026-08-20T12:03:00.000Z",
        sortKey: "0004",
        body: null,
        bodyTruncated: null,
        replyTo: null,
        edit: null,
        deletion: {
          state: "revoked",
          observedAt: "2026-08-20T12:04:00.000Z",
          providerRevision: null,
        },
        attachments: [],
      },
    ],
    reaction: [
      {
        ...common("reaction", "reaction-dated", "reaction-provider-dated"),
        messageId: "message-outgoing",
        messageProviderId: "message-provider-outgoing",
        participantId: "participant-peer",
        body: "heart",
        reactedAt: "2026-08-20T12:01:30.000Z",
        state: "active",
      },
      {
        ...common("reaction", "reaction-undated", "reaction-provider-undated"),
        messageId: "message-incoming",
        messageProviderId: "message-provider-incoming",
        participantId: "participant-self",
        body: "thumbs-up",
        reactedAt: null,
        state: "active",
      },
    ],
    tombstone: [],
  };
}

export function syntheticWhatsAppBundleRecords(): SyntheticBundleRecords {
  const records = syntheticBundleRecords();
  const accountJid = "15555550100@s.whatsapp.net";
  const peerJid = "15555550101@s.whatsapp.net";
  for (const values of Object.values(records)) {
    for (const record of values) {
      record.schemaVersion = LOCAL_MESSAGE_BUNDLE_V2_SCHEMA_VERSION;
      record.network = "whatsapp";
      (record.provenance as Record<string, unknown>).connectedAccountProviderId = accountJid;
    }
  }
  (records.account[0]!.provenance as Record<string, unknown>).providerId = accountJid;
  records.account[0]!.handle = "+15555550100";
  (records.participant[0]!.provenance as Record<string, unknown>).providerId = accountJid;
  records.participant[0]!.handle = "+15555550100";
  (records.participant[1]!.provenance as Record<string, unknown>).providerId = peerJid;
  records.participant[1]!.handle = "+15555550101";
  (records.conversation[0]!.provenance as Record<string, unknown>).providerId = peerJid;
  return records;
}

export async function writeSyntheticMessageBundle(
  parent: string,
  records: SyntheticBundleRecords = syntheticBundleRecords(),
  options: Readonly<{
    directoryName?: string;
    completenessKind?: "bounded-local" | "truncated" | "unknown";
    completenessReason?: string | null;
    createdAt?: string;
    schemaVersion?: 1 | 2;
  }> = {},
): Promise<string> {
  const directory = join(parent, options.directoryName ?? "synthetic-message-bundle");
  await mkdir(directory, { mode: 0o700 });
  await chmod(directory, 0o700);
  const artifacts: Array<Record<string, unknown>> = [];
  const counts: Record<string, number> = {};
  for (const artifact of BUNDLE_ARTIFACTS) {
    const values = records[artifact.kind];
    const bytes = Buffer.from(values.map((value) => `${canonicalJson(value)}\n`).join(""), "utf8");
    const path = join(directory, artifact.path);
    await writeFile(path, bytes, { mode: 0o600 });
    await chmod(path, 0o600);
    counts[artifact.kind] = values.length;
    artifacts.push({
      path: artifact.path,
      mediaType: "application/x-ndjson",
      recordKind: artifact.kind,
      records: values.length,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    });
  }
  const schemaVersion = options.schemaVersion ?? LOCAL_MESSAGE_BUNDLE_V1_SCHEMA_VERSION;
  const v2 = schemaVersion === LOCAL_MESSAGE_BUNDLE_V2_SCHEMA_VERSION;
  const projection = {
    schemaVersion,
    format: v2 ? LOCAL_MESSAGE_BUNDLE_V2_FORMAT : LOCAL_MESSAGE_BUNDLE_V1_FORMAT,
    source: {
      id: v2 ? LOCAL_MESSAGE_BUNDLE_V2_SOURCE_ID : LOCAL_MESSAGE_BUNDLE_V1_SOURCE_ID,
      version: v2
        ? LOCAL_MESSAGE_BUNDLE_V2_SOURCE_TRANSFORM_VERSION
        : LOCAL_MESSAGE_BUNDLE_V1_SOURCE_TRANSFORM_VERSION,
    },
    provider: {
      id: v2 ? LOCAL_MESSAGE_BUNDLE_V2_PROVIDER_ID : LOCAL_MESSAGE_BUNDLE_V1_PROVIDER_ID,
      version: v2 ? LOCAL_MESSAGE_BUNDLE_V2_PROVIDER_VERSION : "1.2.3-test",
    },
    timestamps: {
      startedAt: "2026-08-20T12:00:00.000Z",
      finishedAt: "2026-08-20T12:05:00.000Z",
      createdAt: options.createdAt ?? "2026-08-20T12:05:01.000Z",
    },
    completeness: {
      kind: options.completenessKind ?? "truncated",
      reason: options.completenessReason === undefined ? "synthetic-limit" : options.completenessReason,
      observedFrom: "2026-08-20T12:00:00.000Z",
      observedThrough: "2026-08-20T12:04:00.000Z",
    },
    warnings: ["synthetic-fixture"],
    privacy: {
      classification: "private-local",
      attachments: "metadata-only",
      providerUrls: "excluded",
      credentials: "excluded",
    },
    counts,
    artifacts,
  };
  const manifest = {
    ...projection,
    integrity: { algorithm: "sha256", bundleSha256: sha256(canonicalJson(projection)) },
  };
  const path = join(directory, "manifest.json");
  await writeFile(path, `${canonicalJson(manifest)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
  return realpath(directory);
}
