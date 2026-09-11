import type { GhostgetInvoker } from "./ghostget";
import type { Capability, Conversation, HistoryMessage, TextbutlerTransport } from "./types";
import { TRANSPORT_PROTOCOL } from "./types";
import { array, failure, integer, nullableString, object, string, success, timestamp } from "./validation";

export interface GhostgetWhatsAppOptions {
  /** Trusted Ghostget host boundary. Never a direct wacli or WPPConnect handle. */
  readonly invoke: GhostgetInvoker;
  readonly authId: string;
  readonly clock?: () => Date;
}
const adapterId = "whatsapp-web";
const capabilities: readonly Capability[] = ["history", "contacts", "events", "text", "attachment", "reaction", "sticker", "link", "app-clip", "experience", "autonomous-send"];
const readOperations = ["messaging.list", "messaging.read"];
function routeRef(value: unknown): string {
  const ref = string(value, 64);
  if (!/^wmroute_[A-Za-z0-9_-]{22}$/u.test(ref)) throw new Error("Invalid conversation reference");
  return ref;
}
function envelope(value: unknown, format: string, version: number) {
  const result = object(value);
  if (result.format !== format || result.schemaVersion !== version) throw new Error("Ghostget contract changed");
  return result;
}
function conversation(value: unknown): Conversation {
  const route = envelope(value, "wrench.messaging-route", 2);
  if (route.network !== "whatsapp") throw new Error("Cross-network conversation");
  const chat = object(route.conversation), readiness = object(route.readiness);
  if (!["single", "group", "unknown"].includes(String(chat.kind)) ||
      !["resolution-required", "historical-readable"].includes(String(readiness.context)) ||
      readiness.turn !== "unavailable" || readiness.reply !== "unsupported") throw new Error("Unreviewed WhatsApp route contract");
  return Object.freeze({ id: routeRef(route.routeRef), title: nullableString(chat.title), kind: chat.kind as Conversation["kind"],
    participantCount: integer(chat.participantCount, 0, 1024), expiresAt: timestamp(route.expiresAt) });
}
function message(value: unknown): HistoryMessage {
  const item = object(value);
  if (!["incoming", "outgoing", "unknown"].includes(String(item.direction)) || item.untrustedData !== true || typeof item.bodyTruncated !== "boolean") throw new Error("Unreviewed message");
  return { id: string(item.messageRef, 128), direction: item.direction as HistoryMessage["direction"],
    time: item.time === null ? null : timestamp(item.time), text: item.body === "" ? "" : nullableString(item.body, 65536), truncated: item.bodyTruncated, untrusted: true };
}

/** Admits only Ghostget's existing local WhatsApp history contract. Pairing,
 * synchronization, credentials, native processes and mutation stay in Ghostget.
 * Opaque routes expire and are never persisted as enrollment or send grants. */
export function createGhostgetWhatsAppTransport(options: GhostgetWhatsAppOptions): TextbutlerTransport {
  const authId = string(options.authId, 48);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(authId)) throw new Error("An explicit Ghostget auth ID is required");
  const invoke = options.invoke, clock = options.clock ?? (() => new Date());
  const routes = new Map<string, { conversation: Conversation; resolved: boolean }>();
  let busy = false;
  const unsupported = (capability: Capability) => failure("unsupported",
    capability === "events" ? "Ghostget WhatsApp history is a bounded local projection, not a durable event stream."
      : "This Ghostget WhatsApp integration admits conversation history only. Sending, enrollment grants and rich actions require separate upstream contracts.", capability);
  async function readReady(): Promise<boolean> {
    const catalog = object(await invoke({ command: "capabilities", adapterId }));
    if (catalog.ok !== true) return false;
    const adapters = array(catalog.adapters, 128).map(object).filter(value => value.id === adapterId);
    if (adapters.length !== 1 || adapters[0]!.surfaceId !== "whatsapp") return false;
    const operations = array(adapters[0]!.operations, 256).map(object);
    return readOperations.every(id => {
      const matches = operations.filter(value => value.id === id);
      return matches.length === 1 && matches[0]!.state === "observed" && matches[0]!.transport === "web-session-api" &&
        matches[0]!.site === "whatsapp" && matches[0]!.webSessionAction === id && matches[0]!.webSessionContractVersion === 1;
    });
  }
  function prune() { for (const [id, entry] of routes) if (Date.parse(entry.conversation.expiresAt) <= clock().getTime()) routes.delete(id); }
  return {
    async capabilities() {
      try {
        const ready = await readReady();
        return success({ protocol: TRANSPORT_PROTOCOL, provider: "ghostget-whatsapp", capabilities: capabilities.map(capability => ({
          capability, available: capability === "history" && ready,
          reason: capability === "history" && ready ? null : capability === "history" ? "The reviewed Ghostget WhatsApp read contract is unavailable." : "Not admitted by this WhatsApp integration.",
        })) });
      } catch { return failure("unavailable", "Ghostget WhatsApp capability discovery failed."); }
    },
    async conversations() {
      if (busy) return failure("unavailable", "A WhatsApp read is already in progress.");
      busy = true;
      // Invalidate prior candidates even if a refresh fails; never reuse a stale account selection.
      routes.clear();
      try {
        if (!await readReady()) return unsupported("history");
        const result = envelope(await invoke({ command: "messaging.routes", input: { schemaVersion: 1,
          format: "wrench.messaging-routes-request", source: { adapterId, authId, listInput: { limit: 100 } } } }), "wrench.messaging-routes", 2);
        const chats = array(result.routes, 100).map(conversation);
        if (new Set(chats.map(chat => chat.id)).size !== chats.length || chats.some(chat => Date.parse(chat.expiresAt) <= clock().getTime())) throw new Error("Invalid route inventory");
        for (const chat of chats) routes.set(chat.id, { conversation: chat, resolved: false });
        return success(chats);
      } catch { routes.clear(); return failure("contract-mismatch", "Ghostget did not return the expected bounded WhatsApp conversations."); }
      finally { busy = false; }
    },
    async history(request) {
      let id: string, limit: number;
      try { id = routeRef(request.conversationId); limit = integer(request.limit ?? 100, 1, 200); }
      catch { return failure("invalid-input", "Invalid bounded WhatsApp history request."); }
      if (request.cursor !== undefined) return unsupported("history");
      if (busy) return failure("unavailable", "A WhatsApp read is already in progress.");
      prune(); const entry = routes.get(id);
      if (!entry) return failure("stale-context", "Select a current conversation from this WhatsApp account first.");
      busy = true;
      try {
        if (!await readReady()) { routes.clear(); return unsupported("history"); }
        if (!entry.resolved) {
          const resolved = conversation(await invoke({ command: "messaging.resolve", input: { schemaVersion: 2, format: "wrench.messaging-route-resolve-request", routeRef: id } }));
          if (Date.parse(resolved.expiresAt) <= clock().getTime() || routes.has(resolved.id) && resolved.id !== id) throw new Error("Expired or reused resolved route");
          routes.delete(id); id = resolved.id; routes.set(id, { conversation: resolved, resolved: true });
        }
        const result = envelope(await invoke({ command: "messaging.context", input: { schemaVersion: 1, format: "wrench.messaging-context-request", routeRef: id, limit } }), "wrench.messaging-context", 1);
        if (result.network !== "whatsapp" || result.binding !== null || result.liveness !== "freshness-unproven" || typeof result.truncated !== "boolean" || object(result.completeness).kind !== "bounded-local") throw new Error("Unreviewed WhatsApp context authority");
        const messages = array(result.messages, limit).map(message);
        if (new Set(messages.map(item => item.id)).size !== messages.length) throw new Error("Repeated message");
        prune(); if (!routes.has(id)) return failure("stale-context", "The WhatsApp conversation expired during the read.");
        return success({ conversationId: id, contextId: null, revision: null, expiresAt: null, messages, complete: false, nextCursor: null });
      } catch { routes.clear(); return failure("contract-mismatch", "Ghostget did not return the expected account-bound local WhatsApp history."); }
      finally { busy = false; }
    },
    async contacts() { return unsupported("contacts"); },
    async events() { return unsupported("events"); },
    async prepare() { return unsupported("text"); },
    async submit() { return unsupported("autonomous-send"); },
  };
}
