import { createHash } from "node:crypto";

export class OwnerReadRecoveryError extends Error {
  constructor() { super("Ghostget read custody needs owner recovery. Inspect the private Textbutler custody record and reconcile Ghostget cleanup before explicitly restoring reads."); }
}

/** Owner custody only. This binding is never a transport send grant or an agent tool. */
export interface ConversationBinding {
  version: 1;
  authId: string;
  authIdentity: string;
  authHash: string;
  accountSubject: string;
  chatGuid: string;
  observedChatRowId: number;
  service: "iMessage";
  participants: string[];
  observedAccountId: string | null;
  observedAccountLogin: string | null;
  observedLastAddressedHandle: string | null;
}
export interface ObservedConversation { binding: ConversationBinding; title: string; kind: "single" | "group" }
export interface HistoryMessage { id: string; at: number; text: string; author: "owner" | "contact" | "butler" }
export interface OwnerConversationReadPort {
  /** Called only after the owner asks to list Messages conversations. */
  list(signal: AbortSignal): Promise<ObservedConversation[]>;
  /** Re-resolves the exact coordinate and account. History is read only when requested. */
  read(binding: ConversationBinding, initializeHistory: boolean, signal: AbortSignal): Promise<{ conversation: ObservedConversation; messages: HistoryMessage[] }>;
}
function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid conversation binding");
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 2048): string {
  if (typeof value !== "string" || !value.length || value.length > max || /[\p{Cc}\p{Cf}]/u.test(value)) throw new Error("Invalid conversation identity");
  return value;
}
export function parseConversationBinding(value: unknown): ConversationBinding {
  const source = row(value);
  const keys = ["version", "authId", "authIdentity", "authHash", "accountSubject", "chatGuid", "observedChatRowId", "service", "participants", "observedAccountId", "observedAccountLogin", "observedLastAddressedHandle"];
  if (Object.keys(source).length !== keys.length || keys.some(key => !Object.hasOwn(source, key)) || source.version !== 1 || source.service !== "iMessage") throw new Error("Unsupported conversation binding");
  if (!Number.isSafeInteger(source.observedChatRowId) || (source.observedChatRowId as number) < 1 || !Array.isArray(source.participants) || source.participants.length > 500) throw new Error("Invalid conversation coordinate");
  const authIdentity = text(source.authIdentity, 64), authHash = text(source.authHash, 64);
  if (!/^[a-f0-9]{64}$/u.test(authIdentity) || !/^[a-f0-9]{64}$/u.test(authHash)) throw new Error("Invalid Ghostget account lifetime");
  const participants = source.participants.map(value => text(value)).sort();
  if (new Set(participants).size !== participants.length) throw new Error("Duplicate conversation participant");
  const nullable = (value: unknown) => value === null ? null : text(value);
  return { version: 1, authId: text(source.authId, 256), authIdentity, authHash, accountSubject: text(source.accountSubject), chatGuid: text(source.chatGuid), observedChatRowId: source.observedChatRowId as number, service: "iMessage", participants, observedAccountId: nullable(source.observedAccountId), observedAccountLogin: nullable(source.observedAccountLogin), observedLastAddressedHandle: nullable(source.observedLastAddressedHandle) };
}
export function bindingDigest(binding: ConversationBinding): string { return createHash("sha256").update(JSON.stringify(parseConversationBinding(binding))).digest("hex"); }
export function assertSameConversation(expected: ConversationBinding, observed: ObservedConversation): void {
  if (observed.kind !== "single" || observed.binding.participants.length !== 1 || bindingDigest(expected) !== bindingDigest(observed.binding)) throw new Error("Conversation account or participants changed. List conversations again.");
}
/** Bootstrap is untrusted evidence, never an inbound event. Bound both text and aggregate JSON. */
export function boundedHistory(messages: readonly HistoryMessage[]): HistoryMessage[] {
  if (messages.length > 200) throw new Error("History exceeds 200 messages");
  const seen = new Set<string>();
  const result = messages.map(message => {
    if (!message.id || seen.has(message.id) || !Number.isSafeInteger(message.at) || message.at < 0 || !["owner", "contact", "butler"].includes(message.author) || typeof message.text !== "string") throw new Error("Invalid history evidence");
    seen.add(message.id);
    let value = message.text.replaceAll("\0", "");
    if (Buffer.byteLength(value) > 4096) {
      value = new TextDecoder().decode(Buffer.from(value).subarray(0, 4000)).replace(/\uFFFD$/u, "") + "\n[Text truncated for bootstrap]";
    }
    return { ...message, id: message.id.length <= 256 ? message.id : `sha256:${createHash("sha256").update(message.id).digest("hex")}`, text: value };
  }).sort((a, b) => a.at - b.at);
  while (Buffer.byteLength(JSON.stringify(result)) > 512_000) result.shift();
  return result;
}
