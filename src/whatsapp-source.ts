import { canonicalJson, sha256 } from "./canonical-json.ts";
import { CliError } from "./errors.ts";
import type {
  CrossSourceEquivalencePlan,
  SourceOverlapEvidence,
} from "./store.ts";
import type { CorpusMessage, SourceCorpusSnapshot } from "./types.ts";

type JsonRecord = Record<string, unknown>;

type DirectProof = Readonly<{
  peerHandle: string;
  selfActorId: string;
  peerActorId: string;
}>;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function exactE164(value: unknown): string | null {
  return typeof value === "string" && /^\+[1-9][0-9]{4,14}$/u.test(value) ? value : null;
}

function exactStringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10_000) return null;
  const result: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return null;
    const item = value[index];
    if (typeof item !== "string" || item.length < 1 || item.length > 1_024) return null;
    result.push(item);
  }
  return new Set(result).size === result.length ? Object.freeze(result) : null;
}

function accountProof(value: Readonly<{
  kind: "imessage" | "bundle" | "x-archive";
  provider: string;
  network: string | null;
  identity: unknown;
}>, provider: "beeper" | "whatsapp"): Readonly<{
  handle: string;
  selfParticipantId: string;
}> {
  if (value.kind !== "bundle" || value.provider !== provider || value.network !== "whatsapp") {
    throw new CliError(
      "conflict",
      provider === "beeper"
        ? "The overlap source must be an existing Beeper WhatsApp source"
        : "The imported source must be a native Wacli WhatsApp bundle",
    );
  }
  const identity = record(value.identity);
  const account = record(identity?.account);
  const providerCoordinate = record(identity?.provider);
  if (
    provider === "whatsapp"
    && (
      providerCoordinate?.id !== "whatsapp"
      || providerCoordinate.version !== "0.15.0"
    )
  ) {
    throw new CliError(
      "conflict",
      "The imported source is not the exact native WhatsApp provider coordinate",
    );
  }
  const handle = exactE164(account?.handle);
  const selfParticipantId = account?.selfParticipantId;
  if (handle === null || typeof selfParticipantId !== "string" || selfParticipantId.length < 1) {
    throw new CliError(
      "conflict",
      `${provider === "beeper" ? "Beeper" : "Wacli"} WhatsApp source has no exact self E.164 and participant identity`,
    );
  }
  return Object.freeze({ handle, selfParticipantId });
}

/** Check exact self-account identity only; conversation equivalence still needs message proof. */
export function wacliBundleMatchesBeeperWhatsAppSource(
  snapshot: SourceCorpusSnapshot,
  evidence: SourceOverlapEvidence,
): boolean {
  try {
    const native = accountProof(snapshot.source, "whatsapp");
    const beeper = accountProof(evidence.source, "beeper");
    return native.handle === beeper.handle;
  } catch {
    return false;
  }
}

function participantMap(
  auxiliary: readonly Readonly<{ kind: string; record: unknown }>[],
): ReadonlyMap<string, Readonly<{ handle: string; isSelf: boolean }>> {
  const result = new Map<string, Readonly<{ handle: string; isSelf: boolean }>>();
  const ambiguous = new Set<string>();
  for (const value of auxiliary) {
    if (value.kind !== "participant") continue;
    const participant = record(value.record);
    const id = participant?.id;
    const handle = exactE164(participant?.handle);
    const isSelf = participant?.isSelf;
    if (
      typeof id !== "string"
      || handle === null
      || typeof isSelf !== "boolean"
      || participant?.network !== "whatsapp"
    ) continue;
    if (result.has(id)) ambiguous.add(id);
    result.set(id, Object.freeze({ handle, isSelf }));
  }
  for (const id of ambiguous) result.delete(id);
  return result;
}

function directProofs(
  source: Readonly<{
    conversations: readonly Readonly<{
      id: string;
      group: boolean;
      metadata?: unknown;
    }>[];
    auxiliaryRecords: readonly Readonly<{ kind: string; record: unknown }>[];
  }>,
  account: Readonly<{ handle: string; selfParticipantId: string }>,
): ReadonlyMap<string, DirectProof> {
  const participants = participantMap(source.auxiliaryRecords);
  const self = participants.get(account.selfParticipantId);
  if (self?.isSelf !== true || self.handle !== account.handle) {
    throw new CliError("conflict", "WhatsApp source self participant does not prove its exact account");
  }
  const result = new Map<string, DirectProof>();
  for (const conversation of source.conversations) {
    const metadata = record(conversation.metadata);
    const participantIds = exactStringArray(metadata?.participantIds);
    if (
      conversation.group
      || metadata?.type !== "direct"
      || metadata.participantsComplete !== true
      || participantIds?.length !== 2
      || !participantIds.includes(account.selfParticipantId)
    ) continue;
    const peerActorId = participantIds.find((id) => id !== account.selfParticipantId)!;
    const peer = participants.get(peerActorId);
    if (peer?.isSelf !== false) continue;
    result.set(conversation.id, Object.freeze({
      peerHandle: peer.handle,
      selfActorId: account.selfParticipantId,
      peerActorId,
    }));
  }
  return result;
}

function messageFingerprint(
  message: Readonly<{
    sentAt: string;
    direction: "incoming" | "outgoing";
    body: string | null;
    kind: CorpusMessage["kind"];
    attachmentCount: number;
  }>,
  proof: DirectProof,
  senderActorId: string,
): string | null {
  if (message.body === null || message.kind === "reaction") return null;
  const actor = senderActorId === proof.selfActorId && message.direction === "outgoing"
    ? "self"
    : senderActorId === proof.peerActorId && message.direction === "incoming"
      ? proof.peerHandle
      : null;
  if (actor === null) return null;
  return sha256(canonicalJson({
    schemaVersion: 1,
    network: "whatsapp",
    conversationKind: "direct",
    peerHandle: proof.peerHandle,
    actor,
    sentAt: message.sentAt,
    direction: message.direction,
    body: message.body,
    kind: message.kind,
    attachmentCount: message.attachmentCount,
  }));
}

function fingerprints<T extends Readonly<{
  id: string;
  conversationId: string;
  sentAt: string;
  direction: "incoming" | "outgoing";
  body: string | null;
  kind: CorpusMessage["kind"];
  attachmentCount: number;
  metadata?: unknown;
}>>(
  messages: readonly T[],
  proofs: ReadonlyMap<string, DirectProof>,
): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const message of messages) {
    const sender = record(message.metadata)?.senderParticipantId;
    const proof = proofs.get(message.conversationId);
    if (typeof sender !== "string" || proof === undefined) continue;
    const fingerprint = messageFingerprint(message, proof, sender);
    if (fingerprint !== null) result.set(message.id, fingerprint);
  }
  return result;
}

function grouped<T>(values: readonly T[], key: (value: T) => string): ReadonlyMap<string, readonly T[]> {
  const result = new Map<string, T[]>();
  for (const value of values) {
    const coordinate = key(value);
    const rows = result.get(coordinate) ?? [];
    rows.push(value);
    result.set(coordinate, rows);
  }
  return result;
}

/** Prefer native Wacli evidence over an exact, proven Beeper WhatsApp duplicate. */
export function planWacliBeeperWhatsAppEquivalence(
  native: SourceCorpusSnapshot,
  beeper: SourceOverlapEvidence,
): CrossSourceEquivalencePlan {
  const nativeAccount = accountProof(native.source, "whatsapp");
  const beeperAccount = accountProof(beeper.source, "beeper");
  if (nativeAccount.handle !== beeperAccount.handle) {
    throw new CliError("conflict", "The Wacli and Beeper WhatsApp sources belong to different exact E.164 accounts");
  }
  const nativeConversations = native.conversationProvenance.map((provenance) => ({
    id: provenance.conversationId,
    group: native.conversations.find(({ id }) => id === provenance.conversationId)?.group ?? true,
    metadata: provenance.metadata,
  }));
  const nativeProofs = directProofs({
    conversations: nativeConversations,
    auxiliaryRecords: (native.auxiliaryRecords ?? []).map((value) => ({
      kind: value.kind,
      record: value.record,
    })),
  }, nativeAccount);
  const beeperProofs = directProofs(beeper, beeperAccount);
  const nativeProvenance = new Map(native.messageProvenance.map((value) => [value.messageId, value]));
  const nativeMessages = native.messages.map((message) => ({
    ...message,
    metadata: nativeProvenance.get(message.id)?.metadata,
  }));
  const nativeFingerprints = fingerprints(nativeMessages, nativeProofs);
  const beeperFingerprints = fingerprints(beeper.messages, beeperProofs);
  const nativeByFingerprint = grouped(
    nativeMessages.filter(({ id }) => nativeFingerprints.has(id)),
    ({ id }) => nativeFingerprints.get(id)!,
  );
  const beeperByFingerprint = grouped(
    beeper.messages.filter(({ id }) => beeperFingerprints.has(id)),
    ({ id }) => beeperFingerprints.get(id)!,
  );
  const candidates = new Map<string, Set<string>>();
  for (const [fingerprint, nativeRows] of nativeByFingerprint) {
    const beeperRows = beeperByFingerprint.get(fingerprint) ?? [];
    if (nativeRows.length !== 1 || beeperRows.length !== 1) continue;
    const values = candidates.get(beeperRows[0]!.conversationId) ?? new Set<string>();
    values.add(nativeRows[0]!.conversationId);
    candidates.set(beeperRows[0]!.conversationId, values);
  }
  const conversationPairs: Array<{
    duplicateConversationId: string;
    preferredConversationId: string;
  }> = [];
  const usedNative = new Set<string>();
  for (const [beeperConversationId, nativeCandidates] of [...candidates].sort()) {
    if (nativeCandidates.size !== 1) {
      throw new CliError("conflict", "Exact WhatsApp evidence maps one Beeper chat to multiple Wacli chats");
    }
    const nativeConversationId = [...nativeCandidates][0]!;
    if (usedNative.has(nativeConversationId)) {
      throw new CliError("conflict", "Exact WhatsApp evidence maps multiple Beeper chats to one Wacli chat");
    }
    usedNative.add(nativeConversationId);
    conversationPairs.push({
      duplicateConversationId: beeperConversationId,
      preferredConversationId: nativeConversationId,
    });
  }
  const nativeConversationByBeeper = new Map(conversationPairs.map((pair) => [
    pair.duplicateConversationId,
    pair.preferredConversationId,
  ]));
  const messagePairs: Array<{ duplicateMessageId: string; preferredMessageId: string }> = [];
  for (const [fingerprint, beeperRows] of beeperByFingerprint) {
    const nativeRows = nativeByFingerprint.get(fingerprint) ?? [];
    if (
      beeperRows.length === 1
      && nativeRows.length === 1
      && nativeConversationByBeeper.get(beeperRows[0]!.conversationId)
        === nativeRows[0]!.conversationId
    ) {
      messagePairs.push({
        duplicateMessageId: beeperRows[0]!.id,
        preferredMessageId: nativeRows[0]!.id,
      });
    }
  }
  const coveredBeeperConversations = new Set(messagePairs.map(({ duplicateMessageId }) =>
    beeper.messages.find(({ id }) => id === duplicateMessageId)!.conversationId));
  const filteredConversations = conversationPairs.filter(({ duplicateConversationId }) =>
    coveredBeeperConversations.has(duplicateConversationId));
  if (filteredConversations.length === 0 || messagePairs.length === 0) {
    throw new CliError("conflict", "The WhatsApp sources have no unambiguous exact message overlap");
  }
  const beeperExternalToLocal = new Map(beeper.messages.map((message) => [message.externalId, message.id]));
  const nativeExternalToLocal = new Map(native.messageProvenance.map((message) => [
    message.externalId,
    message.messageId,
  ]));
  const preferredMessageByDuplicate = new Map(messagePairs.map((pair) => [
    pair.duplicateMessageId,
    pair.preferredMessageId,
  ]));
  const beeperReactionCoordinates = beeper.reactions.flatMap((reaction) => {
    const target = beeperExternalToLocal.get(reaction.targetExternalId);
    const preferredTarget = target === undefined ? undefined : preferredMessageByDuplicate.get(target);
    return preferredTarget === undefined ? [] : [{ reaction, preferredTarget }];
  });
  const nativeReactionCoordinates = (native.reactionFacts ?? []).flatMap((reaction) => {
    const target = nativeExternalToLocal.get(reaction.targetExternalId);
    return target === undefined ? [] : [{ reaction, preferredTarget: target }];
  });
  const reactionKey = (value: Readonly<{
    preferredTarget: string;
    reaction: Readonly<{ direction: "incoming" | "outgoing" | null; body: string }>;
  }>): string => canonicalJson([value.preferredTarget, value.reaction.direction, value.reaction.body]);
  const beeperReactions = grouped(beeperReactionCoordinates, reactionKey);
  const nativeReactions = grouped(nativeReactionCoordinates, reactionKey);
  const reactionPairs: Array<{ duplicateReactionId: string; preferredReactionId: string }> = [];
  for (const [coordinate, beeperRows] of beeperReactions) {
    const nativeRows = nativeReactions.get(coordinate) ?? [];
    if (beeperRows.length === 1 && nativeRows.length === 1) {
      reactionPairs.push({
        duplicateReactionId: beeperRows[0]!.reaction.id,
        preferredReactionId: nativeRows[0]!.reaction.id,
      });
    }
  }
  const sortedConversations = filteredConversations.sort((left, right) =>
    left.duplicateConversationId.localeCompare(right.duplicateConversationId));
  const sortedMessages = messagePairs.sort((left, right) =>
    left.duplicateMessageId.localeCompare(right.duplicateMessageId));
  const sortedReactions = reactionPairs.sort((left, right) =>
    left.duplicateReactionId.localeCompare(right.duplicateReactionId));
  const evidenceSha256 = sha256(canonicalJson({
    schemaVersion: 1,
    network: "whatsapp",
    duplicateSourceId: beeper.source.id,
    preferredSourceId: native.source.id,
    selfE164Sha256: sha256(nativeAccount.handle),
    conversations: sortedConversations,
    messages: sortedMessages.map((pair) => ({
      ...pair,
      fingerprint: beeperFingerprints.get(pair.duplicateMessageId),
    })),
    reactions: sortedReactions,
  }));
  return Object.freeze({
    duplicateSourceId: beeper.source.id,
    preferredSourceId: native.source.id,
    basis: "exact-message-overlap",
    evidenceSha256,
    conversations: Object.freeze(sortedConversations.map((value) => Object.freeze(value))),
    messages: Object.freeze(sortedMessages.map((value) => Object.freeze(value))),
    reactions: Object.freeze(sortedReactions.map((value) => Object.freeze(value))),
  });
}
