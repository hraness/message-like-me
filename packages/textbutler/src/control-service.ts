import { constants } from "node:fs";
import { link, lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import type { ControlRequest, ControlResponse, DesktopSnapshot } from "../../control/src/index.ts";
import { configureContact, DEFAULT_ACTIVE_LIMIT, parseSettings, type Settings } from "./config.ts";
import { ContactWorkspace } from "./workspace.ts";
import { RunJournal } from "./journal.ts";

export const TEXTBUTLER_CONTROL_PROTOCOL = "textbutler.control.v1" as const;
const MAX_SETTINGS_BYTES = 524_288;
const MAX_CONTACTS = 200;
const CONTACT_KEYS = ["id", "label", "routeId", "enabled", "mode", "keyword", "provider", "accountId", "replyModel", "classifierModel", "disclosure", "revision", "pausedUntil", "humanCooldownMs", "debounceMs", "maxRepliesPerHour"];
type FailureCode = "invalid-request" | "conflict" | "capacity" | "unavailable";
class ControlFailure extends Error { constructor(readonly code: FailureCode, message: string) { super(message); } }
function fail(code: FailureCode, message: string): never { throw new ControlFailure(code, message); }
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail("invalid-request", "Expected a plain control object.");
  if (Reflect.ownKeys(value).length !== Object.keys(value).length || Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor => !("value" in descriptor))) fail("invalid-request", "Control objects must contain JSON data only.");
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, fields: readonly string[]): void {
  if (Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field))) fail("invalid-request", "Unsupported or missing control fields.");
}
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) fail("invalid-request", "Invalid bounded control number.");
  return value;
}
function text(value: unknown, max = 256): string {
  if (typeof value !== "string" || !value.length || Buffer.byteLength(value) > max || /[\u0000-\u001f\u007f]/u.test(value)) fail("invalid-request", "Invalid bounded control text.");
  return value;
}
function contactId(value: unknown): string { const id = text(value, 80); if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(id)) fail("invalid-request", "Invalid contact identifier."); return id; }
function bool(value: unknown): boolean { if (typeof value !== "boolean") fail("invalid-request", "Invalid control flag."); return value; }
function parseUiSettings(value: unknown) {
  const settings = record(value); exact(settings, ["enabled", "responseMode", "keyword", "provider", "disclosure"]);
  const disclosure = record(settings.disclosure); exact(disclosure, ["character", "begin", "end"]);
  if (settings.responseMode !== "smart" && settings.responseMode !== "keyword" || settings.provider !== "codex" && settings.provider !== "claude") fail("invalid-request", "Unknown reply mode or provider.");
  const keyword = text(settings.keyword, 160);
  if (keyword.length > 40) fail("invalid-request", "The trigger keyword is limited to 40 characters.");
  return { enabled: bool(settings.enabled), responseMode: settings.responseMode as "smart" | "keyword", keyword, provider: settings.provider as "codex" | "claude", disclosure: { character: text(disclosure.character, 64), begin: text(disclosure.begin, 64), end: text(disclosure.end, 64) } };
}
/** This is an owner control channel. Requests cannot create message sends or change routes. */
export function parseControlRequest(value: unknown): ControlRequest {
  const item = record(value);
  if (item.protocol !== TEXTBUTLER_CONTROL_PROTOCOL) fail("invalid-request", "Unsupported control protocol.");
  if (item.command === "snapshot" || item.command === "activity.list") {
    exact(item, ["protocol", "command"]); return { protocol: TEXTBUTLER_CONTROL_PROTOCOL, command: item.command };
  }
  if (item.command === "contact.memory.read") {
    exact(item, ["protocol", "command", "contactId"]); return { protocol: TEXTBUTLER_CONTROL_PROTOCOL, command: item.command, contactId: contactId(item.contactId) };
  }
  if (item.command === "contact.memory.write") {
    exact(item, ["protocol", "command", "contactId", "expectedRevision", "content"]);
    const revision = text(item.expectedRevision, 64);
    if (!/^[a-f0-9]{64}$/u.test(revision) || typeof item.content !== "string" || Buffer.byteLength(item.content) > 65_536 || item.content.includes("\0")) fail("invalid-request", "Memory needs a SHA-256 revision and at most 65,536 bytes.");
    return { protocol: TEXTBUTLER_CONTROL_PROTOCOL, command: item.command, contactId: contactId(item.contactId), expectedRevision: revision, content: item.content };
  }
  if (item.command === "contact.settings.update") {
    exact(item, ["protocol", "command", "contactId", "expectedRevision", "settings"]);
    return { protocol: TEXTBUTLER_CONTROL_PROTOCOL, command: item.command, contactId: contactId(item.contactId), expectedRevision: integer(item.expectedRevision, 1), settings: parseUiSettings(item.settings) };
  }
  if (item.command === "global.settings.update") {
    exact(item, ["protocol", "command", "expectedRevision", "settings"]);
    const settings = record(item.settings); exact(settings, ["paused", "activeContactLimit"]);
    return { protocol: TEXTBUTLER_CONTROL_PROTOCOL, command: item.command, expectedRevision: integer(item.expectedRevision, 1), settings: { paused: bool(settings.paused), activeContactLimit: integer(settings.activeContactLimit, 1, 50) } };
  }
  return fail("invalid-request", "Unknown owner control command.");
}

/** Creates only the last component; symlinked or non-private existing roots fail closed. */
export async function ensurePrivateDirectory(path: string): Promise<string> {
  const absolute = resolve(path);
  const parent = dirname(absolute);
  if (await realpath(parent) !== parent) throw new Error("Data directory parent must be physical");
  try { await mkdir(absolute, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const info = await lstat(absolute);
  if (await realpath(absolute) !== absolute || !info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) throw new Error("Data directory must be physical, owned, and private");
  return absolute;
}
async function privateText(path: string): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 || info.size > MAX_SETTINGS_BYTES) throw new Error("Unsafe owner settings file");
    const data = Buffer.alloc(MAX_SETTINGS_BYTES + 1);
    const { bytesRead } = await handle.read(data, 0, data.length, 0);
    if (bytesRead > MAX_SETTINGS_BYTES) throw new Error("Owner settings exceeds size bound");
    return new TextDecoder("utf-8", { fatal: true }).decode(data.subarray(0, bytesRead));
  } finally { await handle.close(); }
}
type OwnerState = Readonly<{ schemaVersion: 1; revision: number; settings: Settings }>;
function parseOwnerState(value: unknown): OwnerState {
  const item = record(value); exact(item, ["schemaVersion", "revision", "settings"]);
  if (item.schemaVersion !== 1) throw new Error("Unsupported owner state version");
  const settings = record(item.settings); exact(settings, ["schemaVersion", "paused", "maxActiveContacts", "contacts"]);
  if (!Array.isArray(settings.contacts) || settings.contacts.length > MAX_CONTACTS) throw new Error("Too many configured contacts");
  for (const contact of settings.contacts) { const entry = record(contact); exact(entry, CONTACT_KEYS); exact(record(entry.disclosure), ["character", "begin", "end"]); }
  return { schemaVersion: 1, revision: integer(item.revision, 1), settings: parseSettings(settings) };
}
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

export async function initializeOwnerState(dataDir: string, initialSettings?: Settings): Promise<{ dataDir: string; settingsPath: string }> {
  const root = await ensurePrivateDirectory(dataDir);
  const state = await ensurePrivateDirectory(join(root, "state"));
  await ensurePrivateDirectory(join(root, "contacts"));
  const settingsPath = join(state, "settings.json");
  const initial = parseOwnerState({ schemaVersion: 1, revision: 1, settings: initialSettings ?? { schemaVersion: 1, paused: true, maxActiveContacts: DEFAULT_ACTIVE_LIMIT, contacts: [] } });
  try { await lstat(settingsPath); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const staged = join(state, `.settings-init-${randomUUID()}`);
    const handle = await open(staged, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(initial, null, 2)}\n`); await handle.sync(); await handle.close();
      try { await link(staged, settingsPath); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    } finally { await handle.close().catch(() => {}); await unlink(staged); }
  }
  parseOwnerState(JSON.parse(await privateText(settingsPath)));
  return { dataDir: root, settingsPath };
}

export class TextbutlerControlService {
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private constructor(readonly dataDir: string, private readonly settingsPath: string, private readonly journal: RunJournal) {}
  static async open(options: { dataDir: string; initialSettings?: Settings; recoverRuns?: boolean }): Promise<TextbutlerControlService> {
    const state = await initializeOwnerState(options.dataDir, options.initialSettings);
    const journal = await RunJournal.open(join(state.dataDir, "state", "runs.sqlite"));
    if (options.recoverRuns === true) journal.recover(Date.now());
    return new TextbutlerControlService(state.dataDir, state.settingsPath, journal);
  }
  private async current(): Promise<{ state: OwnerState; bytes: string }> {
    await ensurePrivateDirectory(this.dataDir);
    await ensurePrivateDirectory(dirname(this.settingsPath));
    const bytes = await privateText(this.settingsPath);
    return { state: parseOwnerState(JSON.parse(bytes)), bytes };
  }
  async settings(): Promise<Settings> { return (await this.current()).state.settings; }
  private async publish(current: { state: OwnerState; bytes: string }, settings: Settings): Promise<void> {
    if (current.state.revision >= Number.MAX_SAFE_INTEGER) fail("unavailable", "Settings revision capacity is exhausted.");
    const bytes = `${JSON.stringify(parseOwnerState({ schemaVersion: 1, revision: current.state.revision + 1, settings }), null, 2)}\n`;
    if (Buffer.byteLength(bytes) > MAX_SETTINGS_BYTES) fail("capacity", "Settings exceed the private storage limit.");
    const staged = join(dirname(this.settingsPath), `.settings-${randomUUID()}`);
    const handle = await open(staged, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      await handle.writeFile(bytes); await handle.sync(); await handle.close();
      if (hash(await privateText(this.settingsPath)) !== hash(current.bytes)) fail("conflict", "Settings changed. Reload before saving.");
      await rename(staged, this.settingsPath);
      const directory = await open(dirname(this.settingsPath), constants.O_RDONLY);
      try { await directory.sync(); } finally { await directory.close(); }
    } catch (error) { await handle.close().catch(() => {}); await unlink(staged).catch(() => {}); throw error; }
  }
  async snapshot(): Promise<DesktopSnapshot> {
    const { state } = await this.current();
    const activity = state.settings.contacts.flatMap(contact => this.journal.recent(contact.id, 50)).sort((a, b) => b.startedAt - a.startedAt).slice(0, 200).map(run => ({ id: run.id, at: new Date(run.updatedAt).toISOString(), contactId: run.contactId, title: run.state, detail: run.reason }));
    return {
      protocol: TEXTBUTLER_CONTROL_PROTOCOL, revision: state.revision, connection: "connected",
      detail: "The local control daemon is connected. Automatic replies remain unavailable until messaging, contact grants, and the agent sandbox are qualified.",
      settings: { paused: state.settings.paused, activeContactLimit: state.settings.maxActiveContacts },
      contacts: state.settings.contacts.map(contact => ({ id: contact.id, name: contact.label, subtitle: "Owner-configured workspace · sending unavailable", settings: { enabled: contact.enabled, responseMode: contact.mode, keyword: contact.keyword, provider: contact.provider, disclosure: { ...contact.disclosure } } })),
      capabilities: [
        { id: "messages", status: "setup-required", detail: "No qualified durable Ghostget message subscription or contact-scoped send grant is connected." },
        { id: "contacts", status: "unsupported", detail: "The current Ghostget contract has no native Contacts directory. No contacts are imported automatically." },
        { id: "agent", status: "setup-required", detail: "Codex and Claude execution is disabled until its installed tool and file isolation is qualified." },
        { id: "attachments", status: "unsupported", detail: "No qualified attachment transport is connected." },
        { id: "reactions", status: "unsupported", detail: "No qualified reaction transport is connected." },
        { id: "stickers", status: "unsupported", detail: "No qualified sticker transport is connected." },
        { id: "mini-apps", status: "unsupported", detail: "No qualified App Clip or iMessage experience transport is connected." },
      ], activity,
    };
  }
  private async execute(request: ControlRequest): Promise<ControlResponse> {
    if (this.closed) fail("unavailable", "The control service is closing.");
    const current = await this.current();
    if (request.command === "snapshot" || request.command === "activity.list") return { protocol: TEXTBUTLER_CONTROL_PROTOCOL, ok: true, kind: "snapshot", snapshot: await this.snapshot() };
    const contact = "contactId" in request ? current.state.settings.contacts.find(contact => contact.id === request.contactId) : undefined;
    if ("contactId" in request && contact === undefined) fail("invalid-request", "This contact is not configured by the owner.");
    if (request.command === "contact.memory.read" || request.command === "contact.memory.write") {
      await ensurePrivateDirectory(join(this.dataDir, "contacts"));
      const workspace = await ContactWorkspace.create(join(this.dataDir, "contacts", request.contactId));
      if (request.command === "contact.memory.write") {
        const memory = await workspace.readVersioned("MEMORY.md");
        if (memory.revision !== request.expectedRevision) fail("conflict", "Memory changed. Reload before saving.");
        try { await workspace.writeVersioned("MEMORY.md", request.content, request.expectedRevision); } catch (error) { if (error instanceof Error && error.message === "Contact file revision conflict") fail("conflict", "Memory changed. Reload before saving."); throw error; }
      }
      const memory = await workspace.readVersioned("MEMORY.md");
      if (Buffer.byteLength(memory.text) > 65_536) fail("capacity", "Memory exceeds the control editor's 65,536-byte limit.");
      return { protocol: TEXTBUTLER_CONTROL_PROTOCOL, ok: true, kind: "memory", contactId: request.contactId, revision: memory.revision, content: memory.text };
    }
    if (request.expectedRevision !== current.state.revision) fail("conflict", "Settings changed. Reload before saving.");
    let updated: Settings;
    if (request.command === "global.settings.update") {
      if (current.state.settings.contacts.filter(contact => contact.enabled).length > request.settings.activeContactLimit) fail("capacity", "Disable contacts before reducing the active limit.");
      updated = parseSettings({ ...current.state.settings, paused: request.settings.paused, maxActiveContacts: request.settings.activeContactLimit });
    } else {
      if (request.settings.enabled && !contact!.enabled && current.state.settings.contacts.filter(contact => contact.enabled).length >= current.state.settings.maxActiveContacts) fail("capacity", "The active contact limit has been reached.");
      try { updated = configureContact(current.state.settings, request.contactId, { enabled: request.settings.enabled, mode: request.settings.responseMode, keyword: request.settings.keyword, provider: request.settings.provider, disclosure: request.settings.disclosure }); } catch { fail("invalid-request", "Invalid contact settings."); }
    }
    await this.publish(current, updated);
    return { protocol: TEXTBUTLER_CONTROL_PROTOCOL, ok: true, kind: "snapshot", snapshot: await this.snapshot() };
  }
  request(value: unknown): Promise<ControlResponse> {
    const result = this.queue.catch(() => {}).then(async (): Promise<ControlResponse> => {
      try { return await this.execute(parseControlRequest(value)); }
      catch (error) { return { protocol: TEXTBUTLER_CONTROL_PROTOCOL, ok: false, code: error instanceof ControlFailure ? error.code : "unavailable", message: error instanceof ControlFailure ? error.message : "The private control operation could not complete. Reload before retrying a change." }; }
    });
    this.queue = result;
    return result;
  }
  async close(): Promise<void> { this.closed = true; await this.queue.catch(() => {}); this.journal.close(); }
}
