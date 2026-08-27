import { createHmac } from "node:crypto";

import { canonicalJson, sha256 } from "./canonical-json.ts";
import { CliError } from "./errors.ts";
import type {
  CrossSourceEquivalencePlan,
  SourceOverlapEvidence,
} from "./store.ts";
import type {
  CorpusAttachmentProvenance,
  CorpusConversation,
  CorpusMessage,
  CorpusMessageProvenance,
  CorpusReactionFact,
  CorpusSourceRecord,
  SourceCorpusSnapshot,
} from "./types.ts";
import type {
  XArchiveConversation,
  XArchiveEvidence,
  XArchiveIdentityObservation,
  XArchiveMessageCreate,
} from "./x-archive.ts";

const MAX_RETAINED_IDENTITY_LABELS = 64;

function keyBytes(value: string | Uint8Array): Uint8Array {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 16 || bytes.byteLength > 1_024) {
    throw new CliError("invalid-data", "X archive HMAC key must contain 16 through 1024 bytes");
  }
  return Uint8Array.from(bytes);
}

function hmac(key: Uint8Array, namespace: string, value: string): string {
  return createHmac("sha256", key)
    .update(`message-like-me\0${namespace}\0`, "utf8")
    .update(value, "utf8")
    .digest("hex");
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function messageEvents(conversation: XArchiveConversation): readonly XArchiveMessageCreate[] {
  return conversation.events.filter(
    (event): event is XArchiveMessageCreate => event.kind === "message-create",
  );
}

function latestGroupName(conversation: XArchiveConversation): string | null {
  const updates = conversation.events.filter((event) => event.kind === "conversation-name-update");
  return updates.at(-1)?.name ?? null;
}

function observationsByParticipant(
  observations: readonly XArchiveIdentityObservation[],
): ReadonlyMap<string, readonly XArchiveIdentityObservation[]> {
  const grouped = new Map<string, XArchiveIdentityObservation[]>();
  for (const observation of observations) {
    const values = grouped.get(observation.providerUserId) ?? [];
    values.push(observation);
    grouped.set(observation.providerUserId, values);
  }
  return new Map([...grouped].map(([id, values]) => {
    const unique = new Map<string, XArchiveIdentityObservation>();
    for (const value of values) {
      unique.set(`${value.username.toLowerCase()}\0${value.displayName ?? ""}`, value);
    }
    const ordered = [...unique.values()].sort((left, right) =>
      compareCodeUnits(left.observedAt, right.observedAt)
      || compareCodeUnits(left.username, right.username)
      || compareCodeUnits(left.displayName ?? "", right.displayName ?? ""));
    return [id, Object.freeze(ordered.slice(-MAX_RETAINED_IDENTITY_LABELS))] as const;
  }));
}

function latestParticipantLabel(
  observations: ReadonlyMap<string, readonly XArchiveIdentityObservation[]>,
  participantId: string,
): string | null {
  const latest = observations.get(participantId)?.at(-1);
  return latest?.displayName ?? latest?.username ?? null;
}

function attachmentProvenance(
  key: Uint8Array,
  namespace: string,
  message: XArchiveMessageCreate,
): readonly CorpusAttachmentProvenance[] {
  return Object.freeze(Array.from({ length: message.mediaCount }, (_, index) => Object.freeze({
    id: `attachment_${hmac(key, "attachment", `${namespace}\0${message.id}\0${index + 1}`)}`,
    kind: "x-media-reference",
    mimeType: null,
    fileName: null,
    bytes: null,
  })));
}

function currentBody(message: XArchiveMessageCreate): Readonly<{
  body: string | null;
  editedAt: string | null;
}> {
  const edit = message.editHistory.at(-1);
  return Object.freeze({
    body: edit?.editedText ?? message.text,
    editedAt: edit?.createdAt ?? null,
  });
}

/** Normalize strict X archive evidence into the common local source boundary. */
export function normalizeXArchive(
  evidence: XArchiveEvidence,
  hmacKey: string | Uint8Array,
): SourceCorpusSnapshot {
  const key = keyBytes(hmacKey);
  const namespace = `x\0${evidence.account.providerUserId}`;
  const sourceId = `source_${hmac(key, "source", namespace)}`;
  const observations = observationsByParticipant(evidence.identityObservations);
  const allParticipantIds = new Set<string>([evidence.account.providerUserId]);
  for (const conversation of evidence.conversations) {
    for (const participantId of conversation.participantIds) allParticipantIds.add(participantId);
  }
  const conversationIds = new Map(evidence.conversations.map((conversation) => [
    conversation.conversationId,
    `conversation_${hmac(key, "conversation", `${namespace}\0${conversation.conversationId}`)}`,
  ]));
  const participantIds = new Map([...allParticipantIds].map((participantId) => [
    participantId,
    `participant_${hmac(key, "participant", `${namespace}\0${participantId}`)}`,
  ]));
  const conversations: CorpusConversation[] = [];
  const conversationProvenance: SourceCorpusSnapshot["conversationProvenance"][number][] = [];
  const messages: CorpusMessage[] = [];
  const messageProvenance: CorpusMessageProvenance[] = [];
  const reactionFacts: CorpusReactionFact[] = [];
  const timeline: string[] = [];
  for (const conversation of evidence.conversations) {
    const peers = conversation.participantIds.filter((id) => id !== evidence.account.providerUserId);
    const directPeer = conversation.kind === "direct" && peers.length === 1 ? peers[0]! : null;
    const localConversationId = conversationIds.get(conversation.conversationId)!;
    conversations.push(Object.freeze({
      id: localConversationId,
      sourceKey: conversation.conversationId,
      privateLabel: directPeer === null
        ? latestGroupName(conversation)
        : latestParticipantLabel(observations, directPeer),
      service: "x",
      participantCount: peers.length,
      participantIds: Object.freeze(peers.map((id) => participantIds.get(id)!).sort(compareCodeUnits)),
      privateParticipants: Object.freeze([]),
      group: conversation.kind === "group",
    }));
    conversationProvenance.push(Object.freeze({
      conversationId: localConversationId,
      externalId: conversation.conversationId,
      metadata: Object.freeze({
        kind: conversation.kind,
        participantProviderIds: conversation.participantIds,
        nonMessageEvents: conversation.events.filter((event) => event.kind !== "message-create"),
      }),
    }));
    for (const [rowIndex, event] of messageEvents(conversation).entries()) {
      const localMessageId = `message_${hmac(key, "message", `${namespace}\0${event.id}`)}`;
      const current = currentBody(event);
      const attachments = attachmentProvenance(key, namespace, event);
      const direction = event.senderId === evidence.account.providerUserId ? "outgoing" : "incoming";
      messages.push(Object.freeze({
        id: localMessageId,
        sourceRowId: rowIndex + 1,
        sourceGuid: event.id,
        conversationId: localConversationId,
        sentAt: event.createdAt,
        direction,
        body: current.body,
        bodySource: current.body === null ? "unavailable" : "text",
        kind: current.body !== null ? "text" : event.mediaCount > 0 ? "attachment" : "unknown",
        replyToSourceGuid: null,
        replyState: "unavailable",
        editedAt: current.editedAt,
        retractedAt: null,
        service: "x",
        attachmentCount: event.mediaCount,
      }));
      messageProvenance.push(Object.freeze({
        messageId: localMessageId,
        externalId: event.id,
        providerSortKey: null,
        replyToExternalId: null,
        attachments,
        metadata: Object.freeze({
          senderProviderId: event.senderId,
          recipientProviderId: event.recipientId,
          urlCount: event.urlCount,
          mediaCount: event.mediaCount,
          editHistory: event.editHistory,
          replyCapability: "unavailable",
        }),
      }));
      timeline.push(event.createdAt);
      for (const reaction of event.activeReactions) {
        const reactionId = `reaction_${hmac(key, "reaction", `${namespace}\0${reaction.eventId}`)}`;
        reactionFacts.push(Object.freeze({
          id: reactionId,
          externalId: reaction.eventId,
          targetExternalId: event.id,
          conversationId: localConversationId,
          direction: reaction.senderId === evidence.account.providerUserId ? "outgoing" : "incoming",
          body: reaction.reactionKey,
          reactedAt: reaction.createdAt,
          state: "active",
        }));
        timeline.push(reaction.createdAt);
      }
    }
  }
  const auxiliaryRecords: CorpusSourceRecord[] = [{
    kind: "account",
    id: evidence.account.providerUserId,
    record: Object.freeze({
      providerUserId: evidence.account.providerUserId,
      username: evidence.account.username,
      displayName: evidence.account.displayName,
      email: evidence.account.email,
      createdAt: evidence.account.createdAt,
      createdVia: evidence.account.createdVia,
      network: "x",
      isSelf: true,
    }),
  }];
  for (const participantId of [...allParticipantIds].sort(compareCodeUnits)) {
    if (participantId === evidence.account.providerUserId) continue;
    auxiliaryRecords.push(Object.freeze({
      kind: "participant",
      id: participantId,
      record: Object.freeze({
        providerUserId: participantId,
        network: "x",
        isSelf: false,
        historicalLabels: observations.get(participantId) ?? Object.freeze([]),
      }),
    }));
  }
  const warnings = [
    "legacy-x-direct-message-export",
    "encrypted-x-chat-not-included",
    "reply-links-unavailable",
    "media-metadata-only",
    ...(evidence.archive.isPartialArchive ? ["partial-official-archive"] : []),
    ...(evidence.identityObservations.length > 0 ? ["historical-identity-labels"] : []),
  ].sort(compareCodeUnits);
  const bounds = timeline.sort(compareCodeUnits);
  return Object.freeze({
    source: Object.freeze({
      id: sourceId,
      kind: "x-archive",
      provider: "x",
      network: "x",
      accountId: evidence.account.providerUserId,
      externalId: evidence.account.providerUserId,
      revision: evidence.archive.sha256,
      generatedAt: evidence.archive.generationDate,
      producer: Object.freeze({ id: "x-official-archive", version: "1" }),
      coverage: Object.freeze({
        history: evidence.archive.isPartialArchive ? "unknown" : "bounded",
        observedFrom: bounds[0] ?? null,
        observedTo: bounds.at(-1) ?? null,
        kind: evidence.archive.isPartialArchive
          ? "partial-official-archive"
          : "complete-produced-official-archive",
        reason: evidence.archive.isPartialArchive ? "producer-declared-partial" : "legacy-dm-export",
      }),
      manifestSha256: evidence.archive.manifestSha256,
      identity: Object.freeze({
        account: evidence.account,
        archiveSha256: evidence.archive.sha256,
        replyCapability: "unavailable",
      }),
      warnings: Object.freeze(warnings),
    }),
    conversations: Object.freeze(conversations),
    conversationProvenance: Object.freeze(conversationProvenance),
    messages: Object.freeze(messages),
    messageProvenance: Object.freeze(messageProvenance),
    reactionFacts: Object.freeze(reactionFacts),
    auxiliaryRecords: Object.freeze(auxiliaryRecords),
    deletions: Object.freeze([]),
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactXHandle(value: unknown): string | null {
  return typeof value === "string" && /^@?[A-Za-z0-9_]{1,15}$/u.test(value)
    ? value.replace(/^@/u, "").toLowerCase()
    : null;
}

type ExactBeeperAccount = Readonly<{
  handle: string;
  selfParticipantId: string;
}>;

function exactBeeperAccount(evidence: SourceOverlapEvidence): ExactBeeperAccount {
  if (
    evidence.source.kind !== "bundle"
    || evidence.source.provider !== "beeper"
    || evidence.source.network !== "x"
  ) throw new CliError("conflict", "The overlap source must be an existing Beeper X source");
  const identity = record(evidence.source.identity);
  const account = record(identity?.account);
  const handle = exactXHandle(account?.handle);
  const selfParticipantId = account?.selfParticipantId;
  if (handle === null || typeof selfParticipantId !== "string" || selfParticipantId.length < 1) {
    throw new CliError(
      "conflict",
      "The Beeper X source has no exact self handle and participant identity for account proof",
    );
  }
  return Object.freeze({ handle, selfParticipantId });
}

/** Check only exact self-account identity; this does not establish conversation equivalence. */
export function xArchiveMatchesBeeperSource(
  archive: XArchiveEvidence,
  value: unknown,
): boolean {
  const source = record(value);
  if (
    source?.kind !== "bundle"
    || source.provider !== "beeper"
    || source.network !== "x"
  ) return false;
  const identity = record(source.identity);
  const account = record(identity?.account);
  return exactXHandle(account?.handle) === archive.account.username.toLowerCase();
}

type ExactDirectIdentityProof = Readonly<{
  peerHandle: string;
  selfActorId: string;
  peerActorId: string;
}>;

function exactStringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10_000) return null;
  const values: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return null;
    const item = value[index];
    if (typeof item !== "string" || item.length < 1 || item.length > 1_024) return null;
    values.push(item);
  }
  return new Set(values).size === values.length ? Object.freeze(values) : null;
}

function archiveDirectIdentityProofs(
  archive: XArchiveEvidence,
  snapshot: SourceCorpusSnapshot,
): ReadonlyMap<string, ExactDirectIdentityProof> {
  const observedHandles = new Map<string, Set<string>>();
  for (const observation of archive.identityObservations) {
    const handle = exactXHandle(observation.username);
    if (handle === null) continue;
    const values = observedHandles.get(observation.providerUserId) ?? new Set<string>();
    values.add(handle);
    observedHandles.set(observation.providerUserId, values);
  }
  const uniqueHandleByParticipant = new Map<string, string>();
  for (const [participantId, handles] of observedHandles) {
    if (handles.size === 1) uniqueHandleByParticipant.set(participantId, [...handles][0]!);
  }
  const archiveConversations = new Map(archive.conversations.map((conversation) => [
    conversation.conversationId,
    conversation,
  ]));
  const normalizedConversations = new Map(snapshot.conversations.map((conversation) => [
    conversation.id,
    conversation,
  ]));
  const proofs = new Map<string, ExactDirectIdentityProof>();
  for (const provenance of snapshot.conversationProvenance) {
    const normalized = normalizedConversations.get(provenance.conversationId);
    const conversation = archiveConversations.get(provenance.externalId);
    if (normalized?.group !== false || conversation?.kind !== "direct") continue;
    const peers = conversation.participantIds.filter((id) => id !== archive.account.providerUserId);
    if (peers.length !== 1) continue;
    const peerActorId = peers[0]!;
    const peerHandle = uniqueHandleByParticipant.get(peerActorId);
    if (peerHandle === undefined) continue;
    proofs.set(provenance.conversationId, Object.freeze({
      peerHandle,
      selfActorId: archive.account.providerUserId,
      peerActorId,
    }));
  }
  return proofs;
}

function preferredDirectIdentityProofs(
  evidence: SourceOverlapEvidence,
  account: ExactBeeperAccount,
): ReadonlyMap<string, ExactDirectIdentityProof> {
  const participants = new Map<string, Readonly<{
    handle: string;
    isSelf: boolean;
  }>>();
  const ambiguousIds = new Set<string>();
  for (const auxiliary of evidence.auxiliaryRecords) {
    if (auxiliary.kind !== "participant") continue;
    const participant = record(auxiliary.record);
    const id = participant?.id;
    const handle = exactXHandle(participant?.handle);
    const isSelf = participant?.isSelf;
    if (
      typeof id !== "string"
      || id.length < 1
      || handle === null
      || typeof isSelf !== "boolean"
      || participant?.network !== "x"
    ) continue;
    if (participants.has(id)) ambiguousIds.add(id);
    participants.set(id, Object.freeze({ handle, isSelf }));
  }
  for (const id of ambiguousIds) participants.delete(id);

  const proofs = new Map<string, ExactDirectIdentityProof>();
  for (const conversation of evidence.conversations) {
    const metadata = record(conversation.metadata);
    const participantIds = exactStringArray(metadata?.participantIds);
    if (
      conversation.group
      || metadata?.type !== "direct"
      || metadata.participantsComplete !== true
      || participantIds?.length !== 2
      || !participantIds.includes(account.selfParticipantId)
    ) continue;
    const self = participants.get(account.selfParticipantId);
    const peerActorId = participantIds.find((id) => id !== account.selfParticipantId)!;
    const peer = participants.get(peerActorId);
    if (
      self?.isSelf !== true
      || self.handle !== account.handle
      || peer?.isSelf !== false
    ) continue;
    proofs.set(conversation.id, Object.freeze({
      peerHandle: peer.handle,
      selfActorId: account.selfParticipantId,
      peerActorId,
    }));
  }
  return proofs;
}

function messageFingerprint(message: Readonly<{
  sentAt: string;
  direction: "incoming" | "outgoing";
  body: string | null;
  kind: CorpusMessage["kind"];
  attachmentCount: number;
}>, proof: ExactDirectIdentityProof, senderActorId: string): string | null {
  // A bodyless media placeholder proves only time, direction, and attachment
  // count. Those coordinates cannot establish exact cross-source identity.
  if (message.body === null) return null;
  const actorHandle = senderActorId === proof.selfActorId && message.direction === "outgoing"
    ? "self"
    : senderActorId === proof.peerActorId && message.direction === "incoming"
      ? proof.peerHandle
      : null;
  if (actorHandle === null) return null;
  return sha256(canonicalJson({
    schemaVersion: 2,
    conversationKind: "direct",
    peerHandle: proof.peerHandle,
    actorHandle,
    sentAt: message.sentAt,
    direction: message.direction,
    body: message.body,
    kind: message.kind,
    attachmentCount: message.attachmentCount,
  }));
}

function messageFingerprints<T extends Readonly<{
  id: string;
  conversationId: string;
  sentAt: string;
  direction: "incoming" | "outgoing";
  body: string | null;
  kind: CorpusMessage["kind"];
  attachmentCount: number;
}>>(
  messages: readonly T[],
  proofs: ReadonlyMap<string, ExactDirectIdentityProof>,
  senderActorId: (message: T) => string | null,
): ReadonlyMap<string, string> {
  const fingerprints = new Map<string, string>();
  for (const message of messages) {
    if (message.kind === "reaction") continue;
    const proof = proofs.get(message.conversationId);
    const sender = senderActorId(message);
    if (proof === undefined || sender === null) continue;
    const fingerprint = messageFingerprint(message, proof, sender);
    if (fingerprint !== null) fingerprints.set(message.id, fingerprint);
  }
  return fingerprints;
}

function groupedBy<T>(values: readonly T[], key: (value: T) => string): ReadonlyMap<string, readonly T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values) {
    const coordinate = key(value);
    const rows = grouped.get(coordinate) ?? [];
    rows.push(value);
    grouped.set(coordinate, rows);
  }
  return grouped;
}

/** Build a fail-closed, content-exact X archive to Beeper equivalence plan. */
export function planXArchiveEquivalence(
  archive: XArchiveEvidence,
  snapshot: SourceCorpusSnapshot,
  preferred: SourceOverlapEvidence,
): CrossSourceEquivalencePlan {
  if (snapshot.source.kind !== "x-archive" || snapshot.source.network !== "x") {
    throw new CliError("internal", "X overlap planning requires an X archive snapshot");
  }
  const preferredAccount = exactBeeperAccount(preferred);
  if (archive.account.username.toLowerCase() !== preferredAccount.handle) {
    throw new CliError("conflict", "The X archive and Beeper source belong to different exact handles");
  }
  const duplicateProofs = archiveDirectIdentityProofs(archive, snapshot);
  const preferredProofs = preferredDirectIdentityProofs(preferred, preferredAccount);
  const archiveProvenanceByMessage = new Map(snapshot.messageProvenance.map((value) => [
    value.messageId,
    value,
  ]));
  const duplicateFingerprints = messageFingerprints(
    snapshot.messages,
    duplicateProofs,
    (message) => {
      const metadata = record(archiveProvenanceByMessage.get(message.id)?.metadata);
      return typeof metadata?.senderProviderId === "string" ? metadata.senderProviderId : null;
    },
  );
  const preferredFingerprints = messageFingerprints(
    preferred.messages,
    preferredProofs,
    (message) => {
      const metadata = record(message.metadata);
      return typeof metadata?.senderParticipantId === "string" ? metadata.senderParticipantId : null;
    },
  );
  const duplicateByFingerprint = groupedBy(
    snapshot.messages.filter((message) => duplicateFingerprints.has(message.id)),
    (message) => duplicateFingerprints.get(message.id)!,
  );
  const preferredByFingerprint = groupedBy(
    preferred.messages.filter((message) => preferredFingerprints.has(message.id)),
    (message) => preferredFingerprints.get(message.id)!,
  );
  const preferredConversationCandidates = new Map<string, Set<string>>();
  for (const [fingerprint, duplicates] of duplicateByFingerprint) {
    const candidates = preferredByFingerprint.get(fingerprint) ?? [];
    if (duplicates.length !== 1 || candidates.length !== 1) continue;
    const values = preferredConversationCandidates.get(duplicates[0]!.conversationId) ?? new Set<string>();
    values.add(candidates[0]!.conversationId);
    preferredConversationCandidates.set(duplicates[0]!.conversationId, values);
  }
  const conversationPairs: Array<{
    duplicateConversationId: string;
    preferredConversationId: string;
  }> = [];
  const usedPreferredConversations = new Set<string>();
  for (const [duplicateConversationId, candidates] of [...preferredConversationCandidates]
    .sort(([left], [right]) => compareCodeUnits(left, right))) {
    if (candidates.size > 1) {
      throw new CliError("conflict", "Exact X message evidence maps one archive conversation to multiple Beeper conversations");
    }
    const preferredConversationId = [...candidates][0];
    if (preferredConversationId === undefined) continue;
    if (usedPreferredConversations.has(preferredConversationId)) {
      throw new CliError("conflict", "Exact X message evidence maps multiple archive conversations to one Beeper conversation");
    }
    usedPreferredConversations.add(preferredConversationId);
    conversationPairs.push({ duplicateConversationId, preferredConversationId });
  }
  const preferredConversationByDuplicate = new Map(conversationPairs.map((pair) => [
    pair.duplicateConversationId,
    pair.preferredConversationId,
  ]));
  const duplicateMessagesByConversation = groupedBy(snapshot.messages, ({ conversationId }) => conversationId);
  const preferredMessagesByConversation = groupedBy(preferred.messages, ({ conversationId }) => conversationId);
  const messagePairs: Array<{ duplicateMessageId: string; preferredMessageId: string }> = [];
  for (const pair of conversationPairs) {
    const duplicates = groupedBy(
      (duplicateMessagesByConversation.get(pair.duplicateConversationId) ?? [])
        .filter((message) => duplicateFingerprints.has(message.id)),
      (message) => duplicateFingerprints.get(message.id)!,
    );
    const candidates = groupedBy(
      (preferredMessagesByConversation.get(pair.preferredConversationId) ?? [])
        .filter((message) => preferredFingerprints.has(message.id)),
      (message) => preferredFingerprints.get(message.id)!,
    );
    for (const [fingerprint, duplicateRows] of duplicates) {
      const preferredRows = candidates.get(fingerprint) ?? [];
      if (duplicateRows.length === 1 && preferredRows.length === 1) {
        messagePairs.push({
          duplicateMessageId: duplicateRows[0]!.id,
          preferredMessageId: preferredRows[0]!.id,
        });
      }
    }
  }
  const duplicateMessageById = new Map(snapshot.messages.map((message) => [message.id, message]));
  const coveredConversations = new Set(messagePairs.map(({ duplicateMessageId }) =>
    duplicateMessageById.get(duplicateMessageId)!.conversationId));
  const filteredConversationPairs = conversationPairs.filter(({ duplicateConversationId }) =>
    coveredConversations.has(duplicateConversationId));
  if (filteredConversationPairs.length === 0 || messagePairs.length === 0) {
    throw new CliError("conflict", "The X archive has no unambiguous exact message overlap with this Beeper source");
  }
  const duplicateExternalToLocal = new Map(snapshot.messageProvenance.map((value) => [
    value.externalId,
    value.messageId,
  ]));
  const preferredExternalToLocal = new Map(preferred.messages.map((value) => [
    value.externalId,
    value.id,
  ]));
  const preferredMessageByDuplicate = new Map(messagePairs.map((pair) => [
    pair.duplicateMessageId,
    pair.preferredMessageId,
  ]));
  const archiveReactionCoordinates = snapshot.reactionFacts?.flatMap((reaction) => {
    const duplicateTarget = duplicateExternalToLocal.get(reaction.targetExternalId);
    const preferredTarget = duplicateTarget === undefined
      ? undefined
      : preferredMessageByDuplicate.get(duplicateTarget);
    return preferredTarget === undefined ? [] : [{ reaction, preferredTarget }];
  }) ?? [];
  const preferredReactionCoordinates = preferred.reactions.flatMap((reaction) => {
    const preferredTarget = preferredExternalToLocal.get(reaction.targetExternalId);
    return preferredTarget === undefined ? [] : [{ reaction, preferredTarget }];
  });
  const reactionKey = (value: Readonly<{
    preferredTarget: string;
    reaction: Readonly<{ direction: "incoming" | "outgoing" | null; body: string }>;
  }>): string => canonicalJson([
    value.preferredTarget,
    value.reaction.direction,
    value.reaction.body,
  ]);
  const archiveReactions = groupedBy(archiveReactionCoordinates, reactionKey);
  const preferredReactions = groupedBy(preferredReactionCoordinates, reactionKey);
  const reactionPairs: Array<{ duplicateReactionId: string; preferredReactionId: string }> = [];
  for (const [coordinate, archiveRows] of archiveReactions) {
    const preferredRows = preferredReactions.get(coordinate) ?? [];
    if (archiveRows.length !== 1 || preferredRows.length !== 1) continue;
    const archiveReaction = archiveRows[0]!.reaction;
    const preferredReaction = preferredRows[0]!.reaction;
    const preferArchive = archiveReaction.reactedAt !== null && preferredReaction.reactedAt === null;
    reactionPairs.push(preferArchive
      ? { duplicateReactionId: preferredReaction.id, preferredReactionId: archiveReaction.id }
      : { duplicateReactionId: archiveReaction.id, preferredReactionId: preferredReaction.id });
  }
  const sortedConversations = filteredConversationPairs.sort((left, right) =>
    compareCodeUnits(left.duplicateConversationId, right.duplicateConversationId));
  const sortedMessages = messagePairs
    .filter(({ duplicateMessageId }) => {
      const conversationId = duplicateMessageById.get(duplicateMessageId)!.conversationId;
      return preferredConversationByDuplicate.has(conversationId) && coveredConversations.has(conversationId);
    })
    .sort((left, right) => compareCodeUnits(left.duplicateMessageId, right.duplicateMessageId));
  const sortedReactions = reactionPairs.sort((left, right) =>
    compareCodeUnits(left.duplicateReactionId, right.duplicateReactionId));
  const evidenceSha256 = sha256(canonicalJson({
    schemaVersion: 2,
    archiveSha256: archive.archive.sha256,
    archiveSourceId: snapshot.source.id,
    preferredSourceId: preferred.source.id,
    accountProofSha256: sha256(archive.account.username.toLowerCase()),
    directPeerProofs: sortedConversations.map((pair) => ({
      duplicateConversationId: pair.duplicateConversationId,
      preferredConversationId: pair.preferredConversationId,
      peerHandleSha256: sha256(duplicateProofs.get(pair.duplicateConversationId)!.peerHandle),
    })),
    messageFingerprints: sortedMessages.map((pair) => ({
      duplicateMessageId: pair.duplicateMessageId,
      preferredMessageId: pair.preferredMessageId,
      fingerprint: duplicateFingerprints.get(pair.duplicateMessageId),
    })),
    conversations: sortedConversations,
    messages: sortedMessages,
    reactions: sortedReactions,
  }));
  return Object.freeze({
    duplicateSourceId: snapshot.source.id,
    preferredSourceId: preferred.source.id,
    basis: "exact-message-overlap",
    evidenceSha256,
    conversations: Object.freeze(sortedConversations.map((value) => Object.freeze(value))),
    messages: Object.freeze(sortedMessages.map((value) => Object.freeze(value))),
    reactions: Object.freeze(sortedReactions.map((value) => Object.freeze(value))),
  });
}
