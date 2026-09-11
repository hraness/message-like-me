/** Owner-only desktop control protocol. Messaging authority is never a UI command. */
export const CONTROL_PROTOCOL = "textbutler.control.v1" as const;
export type CapabilityId = "messages" | "contacts" | "agent" | "attachments" | "reactions" | "stickers" | "mini-apps";
export interface Capability { id: CapabilityId; status: "available" | "setup-required" | "unsupported"; detail: string }
export interface ContactSettings {
  enabled: boolean;
  responseMode: "smart" | "keyword";
  keyword: string;
  provider: "codex" | "claude";
  disclosure: { character: string; begin: string; end: string };
}
export interface Contact { id: string; name: string; subtitle: string; settings: ContactSettings }
export interface Activity { id: string; at: string; contactId: string | null; title: string; detail: string }
export interface DesktopSnapshot {
  protocol: typeof CONTROL_PROTOCOL;
  revision: number;
  connection: "connected" | "disconnected" | "demo";
  detail: string;
  settings: { paused: boolean; activeContactLimit: number };
  contacts: Contact[];
  capabilities: Capability[];
  activity: Activity[];
}
export type ControlRequest =
  | { protocol: typeof CONTROL_PROTOCOL; command: "snapshot" }
  | { protocol: typeof CONTROL_PROTOCOL; command: "contact.settings.update"; contactId: string; expectedRevision: number; settings: ContactSettings }
  | { protocol: typeof CONTROL_PROTOCOL; command: "contact.memory.read"; contactId: string }
  | { protocol: typeof CONTROL_PROTOCOL; command: "contact.memory.write"; contactId: string; expectedRevision: string; content: string }
  | { protocol: typeof CONTROL_PROTOCOL; command: "global.settings.update"; expectedRevision: number; settings: DesktopSnapshot["settings"] }
  | { protocol: typeof CONTROL_PROTOCOL; command: "activity.list" };
export type ControlResponse =
  | { protocol: typeof CONTROL_PROTOCOL; ok: true; kind: "snapshot"; snapshot: DesktopSnapshot }
  | { protocol: typeof CONTROL_PROTOCOL; ok: true; kind: "memory"; contactId: string; revision: string; content: string }
  | { protocol: typeof CONTROL_PROTOCOL; ok: false; code: "disconnected" | "invalid-request" | "conflict" | "capacity" | "unavailable"; message: string };
export interface DesktopControlPort { request(request: ControlRequest): Promise<ControlResponse> }

export const DEFAULT_CONTACT_SETTINGS: ContactSettings = {
  enabled: false, responseMode: "smart", keyword: "butler", provider: "codex",
  disclosure: { character: "🤖", begin: "{", end: "}" },
};
export function disclosurePreview(settings: ContactSettings, text = "Hello, this is my response."): string {
  const { character, begin, end } = settings.disclosure;
  return `${character}${begin} ${text} ${end}`;
}
export function validateContactSettings(settings: ContactSettings): string | null {
  if (typeof settings.enabled !== "boolean" || !["smart", "keyword"].includes(settings.responseMode)
    || !["codex", "claude"].includes(settings.provider)) return "Choose a supported response mode and agent provider.";
  if (typeof settings.keyword !== "string" || !settings.keyword.trim() || settings.keyword.length > 40
    || /[\p{Cc}\p{Cf}]/u.test(settings.keyword)) return "Use a keyword between 1 and 40 characters without control characters.";
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  for (const [name, symbol] of Object.entries(settings.disclosure)) {
    if (typeof symbol !== "string" || symbol.length > 16 || [...segmenter.segment(symbol)].length !== 1
      || /[\p{White_Space}\p{Cc}]/u.test(symbol) || /[\u202A-\u202E\u2066-\u2069]/u.test(symbol) || /^[\p{Default_Ignorable_Code_Point}\p{Mark}]+$/u.test(symbol)) {
      return `Use one visible symbol for ${name}. Emoji sequences count as one symbol.`;
    }
  }
  return null;
}

export function disconnectedSnapshot(detail = "The Textbutler daemon is not connected."): DesktopSnapshot {
  return {
    protocol: CONTROL_PROTOCOL, revision: 0, connection: "disconnected", detail,
    settings: { paused: true, activeContactLimit: 5 }, contacts: [], activity: [],
    capabilities: [
      { id: "messages", status: "setup-required", detail: "Connect the daemon to negotiate Ghostget Messages access." },
      { id: "contacts", status: "setup-required", detail: "Contacts appear after Ghostget grants scoped access." },
      { id: "agent", status: "setup-required", detail: "A qualified Codex or Claude account is required." },
      { id: "attachments", status: "setup-required", detail: "File sending must be reported by the connected provider." },
      { id: "reactions", status: "setup-required", detail: "Available only when the transport supports reactions." },
      { id: "stickers", status: "unsupported", detail: "No qualified sticker transport is connected." },
      { id: "mini-apps", status: "unsupported", detail: "No qualified iMessage app transport is connected." },
    ],
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid control response.");
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 4_096): string {
  if (typeof value !== "string" || value.length > max) throw new Error("Invalid text in control response.");
  return value;
}
function digest(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) throw new Error("Invalid memory revision digest.");
  return value;
}
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new Error("Invalid number in control response.");
  return value;
}
function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Invalid flag in control response.");
  return value;
}
function oneOf<T extends string>(value: unknown, options: readonly T[]): T {
  if (typeof value !== "string" || !options.includes(value as T)) throw new Error("Unknown control response value.");
  return value as T;
}
function list(value: unknown, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length > limit) throw new Error("Control response exceeds its list limit.");
  return value;
}
function settings(value: unknown): ContactSettings {
  const row = record(value); const symbols = record(row.disclosure);
  const result: ContactSettings = {
    enabled: bool(row.enabled), responseMode: oneOf(row.responseMode, ["smart", "keyword"]),
    keyword: text(row.keyword, 40), provider: oneOf(row.provider, ["codex", "claude"]),
    disclosure: { character: text(symbols.character, 16), begin: text(symbols.begin, 16), end: text(symbols.end, 16) },
  };
  const error = validateContactSettings(result); if (error) throw new Error(error);
  return result;
}
export function parseControlResponse(value: unknown): ControlResponse {
  const row = record(value);
  if (row.protocol !== CONTROL_PROTOCOL) throw new Error("The daemon uses an incompatible control protocol.");
  if (row.ok === false) return { protocol: CONTROL_PROTOCOL, ok: false,
    code: oneOf(row.code, ["disconnected", "invalid-request", "conflict", "capacity", "unavailable"]), message: text(row.message) };
  if (row.ok !== true) throw new Error("Invalid control response outcome.");
  if (row.kind === "memory") return { protocol: CONTROL_PROTOCOL, ok: true, kind: "memory", contactId: text(row.contactId, 256), revision: digest(row.revision), content: text(row.content, 65_536) };
  if (row.kind !== "snapshot") throw new Error("Unknown control response kind.");
  const source = record(row.snapshot); const global = record(source.settings);
  if (source.protocol !== CONTROL_PROTOCOL) throw new Error("Incompatible snapshot protocol.");
  const snapshot: DesktopSnapshot = {
    protocol: CONTROL_PROTOCOL, revision: integer(source.revision), connection: oneOf(source.connection, ["connected", "disconnected", "demo"]),
    detail: text(source.detail), settings: { paused: bool(global.paused), activeContactLimit: integer(global.activeContactLimit, 1, 50) },
    contacts: list(source.contacts, 1_000).map(value => { const row = record(value); return { id: text(row.id, 256), name: text(row.name, 256), subtitle: text(row.subtitle, 512), settings: settings(row.settings) }; }),
    capabilities: list(source.capabilities, 7).map(value => { const row = record(value); return { id: oneOf(row.id, ["messages", "contacts", "agent", "attachments", "reactions", "stickers", "mini-apps"]), status: oneOf(row.status, ["available", "setup-required", "unsupported"]), detail: text(row.detail) }; }),
    activity: list(source.activity, 200).map(value => { const row = record(value); return { id: text(row.id, 256), at: text(row.at, 64), contactId: row.contactId === null ? null : text(row.contactId, 256), title: text(row.title, 256), detail: text(row.detail) }; }),
  };
  if (new Set(snapshot.contacts.map(contact => contact.id)).size !== snapshot.contacts.length
    || new Set(snapshot.capabilities.map(capability => capability.id)).size !== snapshot.capabilities.length) throw new Error("Duplicate identity in control response.");
  return { protocol: CONTROL_PROTOCOL, ok: true, kind: "snapshot", snapshot };
}
