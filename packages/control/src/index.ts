/** Owner-only desktop control protocol. Messaging authority is never a UI command. */
export const CONTROL_PROTOCOL = "textbutler.control.v1" as const;
export type CapabilityId = "messages" | "contacts" | "agent" | "attachments" | "reactions" | "stickers" | "links" | "polls" | "mini-apps";
export interface Capability { id: CapabilityId; status: "available" | "setup-required" | "unsupported"; detail: string }
export interface ContactSettings {
  enabled: boolean;
  responseMode: "smart" | "keyword";
  keyword: string;
  provider: "codex" | "claude";
  accountId?: string;
  disclosure: { character: string; begin: string; end: string };
}
export interface Contact { id: string; name: string; subtitle: string; settings: ContactSettings;
  messaging?: { provider: "imessage" | "whatsapp"; state: "active" | "missing" | "revocation-pending" | "recovery-required"; detail: string; grantExpiresAt: string | null } }
export interface Activity { id: string; at: string; contactId: string | null; title: string; detail: string }
export interface ProviderAccountDiagnostic {
  id: string; label: string; provider: "claude" | "codex"; route: "claude-api" | "claude-code" | "codex";
  status: "ready" | "setup-required" | "unavailable"; detail: string; defaultReplyModel: string | null; classifierModel: string | null;
}
export interface DesktopSnapshot {
  protocol: typeof CONTROL_PROTOCOL;
  revision: number;
  connection: "connected" | "disconnected" | "demo";
  detail: string;
  settings: { paused: boolean; activeContactLimit: number };
  contacts: Contact[];
  capabilities: Capability[];
  activity: Activity[];
  providerAccounts?: readonly ProviderAccountDiagnostic[];
  automation?: { state: "running" | "paused" | "unavailable"; detail: string };
  messagingProviders?: readonly ("imessage" | "whatsapp")[];
}
export interface ConversationCandidate { id: string; name: string; subtitle: string; eligible: boolean; reason: string }
export type ControlRequest =
  | { protocol: typeof CONTROL_PROTOCOL; command: "conversations.list" }
  | { protocol: typeof CONTROL_PROTOCOL; command: "contact.enroll"; candidateId: string; expectedRevision: number; initializeHistory: boolean }
  | { protocol: typeof CONTROL_PROTOCOL; command: "owner.job.read"; jobId: string }
  | { protocol: typeof CONTROL_PROTOCOL; command: "snapshot" }
  | { protocol: typeof CONTROL_PROTOCOL; command: "provider.accounts.check"; accountId: string }
  | { protocol: typeof CONTROL_PROTOCOL; command: "messaging.start"; provider: "imessage" | "whatsapp" }
  | { protocol: typeof CONTROL_PROTOCOL; command: "contact.settings.update"; contactId: string; expectedRevision: number; settings: ContactSettings }
  | { protocol: typeof CONTROL_PROTOCOL; command: "contact.memory.read"; contactId: string }
  | { protocol: typeof CONTROL_PROTOCOL; command: "contact.memory.write"; contactId: string; expectedRevision: string; content: string }
  | { protocol: typeof CONTROL_PROTOCOL; command: "global.settings.update"; expectedRevision: number; settings: DesktopSnapshot["settings"] }
  | { protocol: typeof CONTROL_PROTOCOL; command: "activity.list" };
export type ControlResponse =
  | { protocol: typeof CONTROL_PROTOCOL; ok: true; kind: "job"; jobId: string }
  | { protocol: typeof CONTROL_PROTOCOL; ok: true; kind: "conversations"; candidates: ConversationCandidate[]; detail: string }
  | { protocol: typeof CONTROL_PROTOCOL; ok: true; kind: "enrolled"; snapshot: DesktopSnapshot; contactId: string; historyCount: number; historyOmittedCount: number; historyShortenedCount: number; historyInitialized: boolean }
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
  if (settings.accountId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(settings.accountId)) return "Choose a configured account.";
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
      { id: "links", status: "setup-required", detail: "Connect messaging to check rich link support." },
      { id: "polls", status: "setup-required", detail: "Connect messaging to check native poll support." },
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
    ...(row.accountId === undefined ? {} : { accountId: text(row.accountId, 80) }),
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
  if (row.kind === "job") return { protocol: CONTROL_PROTOCOL, ok: true, kind: "job", jobId: text(row.jobId, 80) };
  if (row.kind === "conversations") {
    const candidates = list(row.candidates, 200).map(value => { const item = record(value); return { id: text(item.id, 80), name: text(item.name, 200), subtitle: text(item.subtitle, 512), eligible: bool(item.eligible), reason: text(item.reason, 512) }; });
    if (new Set(candidates.map(candidate => candidate.id)).size !== candidates.length) throw new Error("Duplicate conversation candidate.");
    return { protocol: CONTROL_PROTOCOL, ok: true, kind: "conversations", candidates, detail: text(row.detail) };
  }
  if (row.kind === "enrolled") {
    const response = parseControlResponse({ protocol: CONTROL_PROTOCOL, ok: true, kind: "snapshot", snapshot: row.snapshot });
    if (!response.ok || response.kind !== "snapshot") throw new Error("Invalid enrollment snapshot.");
    const contactId = text(row.contactId, 80);
    if (!response.snapshot.contacts.some(contact => contact.id === contactId && !contact.settings.enabled)) throw new Error("Enrollment must create a disabled contact.");
    return { protocol: CONTROL_PROTOCOL, ok: true, kind: "enrolled", snapshot: response.snapshot, contactId, historyCount: integer(row.historyCount, 0, 200), historyOmittedCount: integer(row.historyOmittedCount, 0, 200), historyShortenedCount: integer(row.historyShortenedCount, 0, 200), historyInitialized: bool(row.historyInitialized) };
  }
  if (row.kind === "memory") return { protocol: CONTROL_PROTOCOL, ok: true, kind: "memory", contactId: text(row.contactId, 256), revision: digest(row.revision), content: text(row.content, 65_536) };
  if (row.kind !== "snapshot") throw new Error("Unknown control response kind.");
  const source = record(row.snapshot); const global = record(source.settings);
  if (source.protocol !== CONTROL_PROTOCOL) throw new Error("Incompatible snapshot protocol.");
  const snapshot: DesktopSnapshot = {
    protocol: CONTROL_PROTOCOL, revision: integer(source.revision), connection: oneOf(source.connection, ["connected", "disconnected", "demo"]),
    detail: text(source.detail), settings: { paused: bool(global.paused), activeContactLimit: integer(global.activeContactLimit, 1, 50) },
    contacts: list(source.contacts, 1_000).map(value => { const row = record(value); return { id: text(row.id, 256), name: text(row.name, 256), subtitle: text(row.subtitle, 512), settings: settings(row.settings),
      ...(row.messaging === undefined ? {} : { messaging: { provider: oneOf(record(row.messaging).provider, ["imessage", "whatsapp"]), state: oneOf(record(row.messaging).state, ["active", "missing", "revocation-pending", "recovery-required"]), detail: text(record(row.messaging).detail, 512), grantExpiresAt: record(row.messaging).grantExpiresAt === null ? null : text(record(row.messaging).grantExpiresAt, 32) } }) }; }),
    capabilities: list(source.capabilities, 9).map(value => { const row = record(value); return { id: oneOf(row.id, ["messages", "contacts", "agent", "attachments", "reactions", "stickers", "links", "polls", "mini-apps"]), status: oneOf(row.status, ["available", "setup-required", "unsupported"]), detail: text(row.detail) }; }),
    activity: list(source.activity, 200).map(value => { const row = record(value); return { id: text(row.id, 256), at: text(row.at, 64), contactId: row.contactId === null ? null : text(row.contactId, 256), title: text(row.title, 256), detail: text(row.detail) }; }),
    ...(source.providerAccounts === undefined ? {} : { providerAccounts: list(source.providerAccounts, 10).map(value => {
      const account = record(value);
      return { id: text(account.id, 80), label: text(account.label, 100), provider: oneOf(account.provider, ["claude", "codex"]),
        route: oneOf(account.route, ["claude-api", "claude-code", "codex"]), status: oneOf(account.status, ["ready", "setup-required", "unavailable"]),
        detail: text(account.detail, 512), defaultReplyModel: account.defaultReplyModel === null ? null : text(account.defaultReplyModel, 160),
        classifierModel: account.classifierModel === null ? null : text(account.classifierModel, 160) };
    }) }),
    ...(source.automation === undefined ? {} : { automation: { state: oneOf(record(source.automation).state, ["running", "paused", "unavailable"]), detail: text(record(source.automation).detail, 512) } }),
    ...(source.messagingProviders === undefined ? {} : { messagingProviders: list(source.messagingProviders, 2).map(value => oneOf(value, ["imessage", "whatsapp"])) }),
  };
  if (new Set(snapshot.contacts.map(contact => contact.id)).size !== snapshot.contacts.length
    || new Set(snapshot.capabilities.map(capability => capability.id)).size !== snapshot.capabilities.length
    || snapshot.providerAccounts && new Set(snapshot.providerAccounts.map(account => account.id)).size !== snapshot.providerAccounts.length) throw new Error("Duplicate identity in control response.");
  for (const account of snapshot.providerAccounts ?? []) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(account.id) || account.provider !== (account.route === "codex" ? "codex" : "claude")) throw new Error("Invalid provider account identity.");
    if (account.status === "ready" && (account.route !== "claude-api" || !account.classifierModel || !account.defaultReplyModel)) throw new Error("Invalid provider readiness.");
  }
  return { protocol: CONTROL_PROTOCOL, ok: true, kind: "snapshot", snapshot };
}
