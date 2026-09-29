import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, resolve } from "node:path";
import { CONTROL_PROTOCOL, type ControlRequest, type ControlResponse, type DesktopSnapshot } from "../../control/src/index.ts";
import { awaitOwnerJob, OwnerCliError, type OwnerControlClient } from "./owner-cli.ts";
import { readOwnerInputFile } from "./messages-cli.ts";
import { parseXcbJson } from "./xcb-client.ts";

/**
 * Paced operator campaigns. Every message is the owner's own text, sent
 * verbatim to an enrolled contact through the daemon's operator send path.
 * The daemon journal keys each send by an idempotency key, so a resumed or
 * repeated run reports the first outcome and never dispatches twice. This
 * file keeps only per-recipient progress and pacing: no message text.
 */

export const CAMPAIGN_HELP = `Paced owner-authored sends (JSON output):
  campaign run FILE.jsonl [--dry-run] [--min-interval 60s] [--jitter 120s]
      [--max-per-hour 15] [--max-per-day 30] [--quiet-hours 19:30-10:00]
      [--burst 6] [--burst-pause 10m] [--recipient-gap 24h]
      [--time-zone ZONE] [--campaign NAME] [--state /absolute/state.json]
  campaign status FILE.jsonl [--campaign NAME] [--state /absolute/state.json]

Each line of FILE.jsonl is one message. contact is a contact ID or exact
name; vars fills {{first}}; timeZone is optional:
  {"id":"a1","contact":"ID","text":"Hi {{first}}","vars":{"first":"Sam"}}

Text is sent exactly as written, without the butler disclosure, because you
are its author. Only enrolled contacts can receive it. The runner waits between
sends, honors the hourly and daily caps and quiet hours in each recipient's
time zone, and stops a recipient after any reply. It halts on any send that is
not confirmed. Rerun the same command to resume; sent messages are never sent
again. After an uncertain send, check Messages, run
textbutler replies reconcile CONTACT --sent or --failed, then rerun.`;

export const CAMPAIGN_DEFAULTS = {
  minIntervalMs: 60_000, jitterMs: 120_000, maxPerHour: 15, maxPerDay: 30,
  quietStart: 19 * 60 + 30, quietEnd: 10 * 60, burst: 6, burstPauseMs: 600_000, burstPauseJitterMs: 900_000,
  recipientGapMs: 86_400_000,
} as const;
/** Floors no flag can go below. */
const LIMITS = { minIntervalMs: 20_000, minJitterMs: 10_000, maxPerHour: 60, maxPerDay: 200, maxBurst: 20, minBurstPauseMs: 5 * 60_000,
  minRecipientGapMs: 3_600_000, minQuietMinutes: 6 * 60, maxEntries: 2000, maxFileBytes: 4 * 1024 * 1024 } as const;

export interface CampaignOptions {
  readonly minIntervalMs: number; readonly jitterMs: number; readonly maxPerHour: number; readonly maxPerDay: number;
  /** Minutes after local midnight; start === end disables quiet hours. */
  readonly quietStart: number; readonly quietEnd: number;
  readonly burst: number; readonly burstPauseMs: number; readonly burstPauseJitterMs: number; readonly recipientGapMs: number;
  readonly timeZone: string; readonly campaign: string; readonly statePath: string; readonly dryRun: boolean;
}
export interface CampaignEntry { readonly id: string; readonly contact: string; readonly template: string; readonly vars: Readonly<Record<string, string>>; readonly timeZone: string | null }
export type EntryStatus = "pending" | "sending" | "sent" | "failed" | "uncertain" | "skipped";
export interface EntryState {
  status: EntryStatus; contactId: string; textDigest: string; key: string; attempts: number;
  sentAt: number | null; runId: string | null; detail: string | null;
}
export interface RecipientState { firstSentAt: number | null; lastSentAt: number | null; stopped: string | null }
export interface CampaignState {
  version: 1; campaign: string; entries: Record<string, EntryState>; recipients: Record<string, RecipientState>;
  /** Submitted send times, for the hourly and daily caps. */
  sends: number[]; burstCount: number; nextSlotAt: number | null;
}

const ENTRY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/u;
const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/gu;

/** Fills {{name}} placeholders from the entry's vars. Every placeholder must
 * be defined, and no braces may survive, so no half-rendered text is sent. */
export function renderTemplate(template: string, vars: Readonly<Record<string, string>>): string {
  const rendered = template.replace(PLACEHOLDER, (_, name: string) => {
    if (!VAR_NAME.test(name) || !Object.hasOwn(vars, name)) throw new OwnerCliError(`The template uses {{${name.slice(0, 40)}}} but the entry does not define it.`);
    return vars[name]!;
  });
  if (/\{\{|\}\}/u.test(rendered)) throw new OwnerCliError("The rendered text still contains {{ or }}. Check the template.");
  return rendered;
}

export function parseCampaign(source: string): CampaignEntry[] {
  const entries: CampaignEntry[] = [], seen = new Set<string>();
  const lines = source.split(/\r?\n/u);
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    const where = `Line ${index + 1}`;
    let row: unknown;
    try { row = parseXcbJson(line); } catch { throw new OwnerCliError(`${where} is not valid JSON.`); }
    if (typeof row !== "object" || row === null || Array.isArray(row)) throw new OwnerCliError(`${where} must be a JSON object.`);
    const item = row as Record<string, unknown>;
    for (const key of Object.keys(item)) if (!["id", "contact", "text", "vars", "timeZone"].includes(key)) throw new OwnerCliError(`${where} has an unknown field "${key.slice(0, 40)}".`);
    if (typeof item.id !== "string" || !ENTRY_ID.test(item.id)) throw new OwnerCliError(`${where} needs an "id" of 1-64 letters, digits, dot, dash or underscore.`);
    if (seen.has(item.id)) throw new OwnerCliError(`${where} repeats id "${item.id}".`);
    if (typeof item.contact !== "string" || !item.contact.trim() || item.contact.length > 200 || /[\p{Cc}\p{Cf}]/u.test(item.contact)) throw new OwnerCliError(`${where} needs a "contact" ID or exact name.`);
    if (typeof item.text !== "string" || !item.text.trim()) throw new OwnerCliError(`${where} needs nonempty "text".`);
    const vars: Record<string, string> = {};
    if (item.vars !== undefined) {
      if (typeof item.vars !== "object" || item.vars === null || Array.isArray(item.vars)) throw new OwnerCliError(`${where} "vars" must be an object of strings.`);
      for (const [name, value] of Object.entries(item.vars)) {
        if (!VAR_NAME.test(name) || typeof value !== "string" || value.length > 2000) throw new OwnerCliError(`${where} "vars" must map simple names to strings.`);
        vars[name] = value;
      }
    }
    let timeZone: string | null = null;
    if (item.timeZone !== undefined) {
      if (typeof item.timeZone !== "string" || !validTimeZone(item.timeZone)) throw new OwnerCliError(`${where} has an unknown "timeZone".`);
      timeZone = item.timeZone;
    }
    const entry = { id: item.id, contact: item.contact, template: item.text, vars, timeZone };
    const text = renderTemplate(entry.template, vars);
    if (Buffer.byteLength(text) > 16_384 || text.includes("\0")) throw new OwnerCliError(`${where} renders to more than 16,384 bytes or contains NUL.`);
    seen.add(item.id); entries.push(entry);
  });
  if (!entries.length) throw new OwnerCliError("The campaign file has no messages.");
  if (entries.length > LIMITS.maxEntries) throw new OwnerCliError(`A campaign holds at most ${LIMITS.maxEntries} messages.`);
  return entries;
}

export function validTimeZone(zone: string): boolean {
  if (zone.length > 64) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return true; } catch { return false; }
}

/** 45s, 10m, 2h, 1500ms or plain milliseconds. */
export function parseDuration(value: string): number {
  const match = /^(\d{1,9})(ms|s|m|h)?$/u.exec(value);
  if (!match) throw new OwnerCliError(`"${value.slice(0, 20)}" is not a duration like 45s, 10m or 2h.`);
  const amount = Number(match[1]), unit = match[2] ?? "ms";
  const ms = amount * (unit === "h" ? 3_600_000 : unit === "m" ? 60_000 : unit === "s" ? 1000 : 1);
  if (!Number.isSafeInteger(ms) || ms > 7 * 86_400_000) throw new OwnerCliError("Durations must be at most 7 days.");
  return ms;
}

export function parseQuietHours(value: string): { start: number; end: number } {
  const match = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/u.exec(value);
  if (!match) throw new OwnerCliError("Quiet hours look like 19:30-10:00 (24-hour, start-end).");
  return { start: Number(match[1]) * 60 + Number(match[2]), end: Number(match[3]) * 60 + Number(match[4]) };
}

function minuteOfDay(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(at));
  return Number(parts.find(part => part.type === "hour")!.value) * 60 + Number(parts.find(part => part.type === "minute")!.value);
}
export function inQuietHours(at: number, timeZone: string, start: number, end: number): boolean {
  if (start === end) return false;
  const minute = minuteOfDay(at, timeZone);
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}
/** The first moment at or after `at` outside quiet hours, to the minute. */
export function quietHoursEnd(at: number, timeZone: string, start: number, end: number): number {
  if (!inQuietHours(at, timeZone, start, end)) return at;
  const minute = minuteOfDay(at, timeZone);
  let candidate = at - (at % 60_000) + ((end - minute + 1440) % 1440) * 60_000;
  // Daylight-saving shifts can land a minute early or late; walk forward.
  for (let step = 0; step < 180 && inQuietHours(candidate, timeZone, start, end); step++) candidate += 60_000;
  return candidate;
}

/** Earliest time the caps allow the next send. Caps count this campaign's
 * submitted sends; replies and other traffic are not counted. */
export function capsAllowAt(sends: readonly number[], now: number, maxPerHour: number, maxPerDay: number): number {
  const sorted = [...sends].sort((a, b) => a - b);
  let at = now;
  const hour = sorted.filter(time => time > now - 3_600_000);
  if (hour.length >= maxPerHour) at = Math.max(at, hour[hour.length - maxPerHour]! + 3_600_000);
  const day = sorted.filter(time => time > now - 86_400_000);
  if (day.length >= maxPerDay) at = Math.max(at, day[day.length - maxPerDay]! + 86_400_000);
  return at;
}

export function idempotencyKey(campaign: string, entryId: string, contactId: string): string {
  return `c${createHash("sha256").update(`textbutler-campaign/v1\n${campaign}\n${entryId}\n${contactId}`).digest("hex").slice(0, 47)}`;
}
const digest = (text: string): string => createHash("sha256").update(text).digest("hex");

/** Campaign contacts resolve by exact ID or exact name, never a substring. */
export function resolveCampaignContact(snapshot: DesktopSnapshot, target: string): { id: string; name: string } {
  const exact = snapshot.contacts.find(contact => contact.id === target);
  if (exact) return { id: exact.id, name: exact.name };
  const lowered = target.trim().toLowerCase();
  const matches = snapshot.contacts.filter(contact => contact.name.trim().toLowerCase() === lowered);
  if (matches.length === 1) return { id: matches[0]!.id, name: matches[0]!.name };
  if (!matches.length) throw new OwnerCliError(`No enrolled contact is exactly "${target.slice(0, 80)}". Use an ID from textbutler contacts list.`);
  throw new OwnerCliError(`"${target.slice(0, 80)}" names more than one contact. Use an exact ID from textbutler contacts list.`);
}

export function emptyState(campaign: string): CampaignState {
  return { version: 1, campaign, entries: {}, recipients: {}, sends: [], burstCount: 0, nextSlotAt: null };
}
export function parseState(raw: string, campaign: string): CampaignState {
  const value = JSON.parse(raw) as CampaignState;
  if (value?.version !== 1 || typeof value.entries !== "object" || typeof value.recipients !== "object" || !Array.isArray(value.sends)) throw new OwnerCliError("The campaign state file is not readable. Move it aside only if you are sure nothing was sent.");
  if (value.campaign !== campaign) throw new OwnerCliError(`The state file belongs to campaign "${String(value.campaign).slice(0, 80)}". Pass --campaign with that name or use another --state.`);
  return value;
}

async function loadState(path: string, campaign: string): Promise<CampaignState> {
  let raw: string;
  try { raw = await readFile(path, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState(campaign); throw error; }
  try { return parseState(raw, campaign); }
  catch (error) { if (error instanceof OwnerCliError) throw error; throw new OwnerCliError("The campaign state file is not valid JSON. Move it aside only if you are sure nothing was sent."); }
}
/** Write-ahead state: a private temporary file, synced, then renamed. */
export async function saveState(path: string, state: CampaignState): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try { await file.writeFile(`${JSON.stringify(state)}\n`); await file.sync(); } finally { await file.close(); }
  await rename(temporary, path);
  const directory = await open(dirname(path), constants.O_RDONLY);
  try { await directory.sync(); } catch { /* best effort on filesystems without directory sync */ } finally { await directory.close(); }
}

/** One runner per state file. A lock left by a dead process is taken over. */
async function lockState(path: string): Promise<() => Promise<void>> {
  const lock = `${path}.lock`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const file = await open(lock, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      await file.writeFile(String(process.pid)); await file.close();
      return async () => { await unlink(lock).catch(() => undefined); };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const pid = Number((await readFile(lock, "utf8").catch(() => "")).trim());
      let alive = false;
      if (Number.isSafeInteger(pid) && pid > 0) { try { process.kill(pid, 0); alive = true; } catch (probe) { alive = (probe as NodeJS.ErrnoException).code === "EPERM"; } }
      if (alive) throw new OwnerCliError("Another campaign runner is using this state file.");
      await unlink(lock).catch(() => undefined);
    }
  }
  throw new OwnerCliError("The campaign state lock could not be taken.");
}

export interface CampaignPorts {
  request: OwnerControlClient;
  now(): number;
  /** Resolves after the delay, or early when the signal aborts. */
  sleep(milliseconds: number, signal?: AbortSignal): Promise<void>;
  random(): number;
  print(value: unknown): void;
  signal?: AbortSignal;
  /** Test seam; production reads an owned physical file. */
  readCampaign?: (path: string) => Promise<string>;
  loadState?: (path: string, campaign: string) => Promise<CampaignState>;
  saveState?: (path: string, state: CampaignState) => Promise<void>;
  lock?: (path: string) => Promise<() => Promise<void>>;
}

export function parseCampaignArgs(args: readonly string[], defaultTimeZone: string): { verb: "run" | "status"; file: string; options: CampaignOptions } {
  const [verb, file, ...rest] = args;
  if ((verb !== "run" && verb !== "status") || !file) throw new OwnerCliError(CAMPAIGN_HELP);
  if (file.includes("\0")) throw new OwnerCliError("Use a campaign file path.");
  const path = resolve(file);
  let dryRun = false, campaign = basename(path, extname(path)), statePath = `${path}.state.json`, timeZone = defaultTimeZone;
  let minIntervalMs: number = CAMPAIGN_DEFAULTS.minIntervalMs, jitterMs: number = CAMPAIGN_DEFAULTS.jitterMs, maxPerHour: number = CAMPAIGN_DEFAULTS.maxPerHour, maxPerDay: number = CAMPAIGN_DEFAULTS.maxPerDay;
  let quietStart: number = CAMPAIGN_DEFAULTS.quietStart, quietEnd: number = CAMPAIGN_DEFAULTS.quietEnd, burst: number = CAMPAIGN_DEFAULTS.burst, burstPauseMs: number = CAMPAIGN_DEFAULTS.burstPauseMs;
  let recipientGapMs: number = CAMPAIGN_DEFAULTS.recipientGapMs;
  const count = (value: string | undefined, flag: string, max: number): number => {
    if (!value || !/^[1-9]\d{0,3}$/u.test(value) || Number(value) > max) throw new OwnerCliError(`${flag} takes a whole number from 1 to ${max}.`);
    return Number(value);
  };
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index]!, value = rest[index + 1];
    const take = (): string => { if (value === undefined) throw new OwnerCliError(`${flag} needs a value.`); index++; return value; };
    if (flag === "--dry-run" && verb === "run") dryRun = true;
    else if (flag === "--min-interval" && verb === "run") minIntervalMs = parseDuration(take());
    else if (flag === "--jitter" && verb === "run") jitterMs = parseDuration(take());
    else if (flag === "--max-per-hour" && verb === "run") maxPerHour = count(take(), flag, LIMITS.maxPerHour);
    else if (flag === "--max-per-day" && verb === "run") maxPerDay = count(take(), flag, LIMITS.maxPerDay);
    else if (flag === "--quiet-hours" && verb === "run") ({ start: quietStart, end: quietEnd } = parseQuietHours(take()));
    else if (flag === "--burst" && verb === "run") burst = count(take(), flag, LIMITS.maxBurst);
    else if (flag === "--burst-pause" && verb === "run") burstPauseMs = parseDuration(take());
    else if (flag === "--recipient-gap" && verb === "run") recipientGapMs = parseDuration(take());
    else if (flag === "--time-zone" && verb === "run") { timeZone = take(); if (!validTimeZone(timeZone)) throw new OwnerCliError("--time-zone needs an IANA zone such as America/New_York."); }
    else if (flag === "--campaign") { campaign = take(); }
    else if (flag === "--state") { statePath = take(); if (!isAbsolute(statePath)) throw new OwnerCliError("--state needs an absolute path."); }
    else throw new OwnerCliError(`Unknown campaign option "${flag.slice(0, 40)}".\n\n${CAMPAIGN_HELP}`);
  }
  if (!ENTRY_ID.test(campaign)) throw new OwnerCliError("--campaign takes 1-64 letters, digits, dot, dash or underscore.");
  if (minIntervalMs < LIMITS.minIntervalMs) throw new OwnerCliError(`--min-interval must be at least ${LIMITS.minIntervalMs / 1000}s.`);
  if (jitterMs < LIMITS.minJitterMs) throw new OwnerCliError(`--jitter must be at least ${LIMITS.minJitterMs / 1000}s.`);
  if (burstPauseMs < LIMITS.minBurstPauseMs) throw new OwnerCliError(`--burst-pause must be at least ${LIMITS.minBurstPauseMs / 60_000}m.`);
  if (recipientGapMs < LIMITS.minRecipientGapMs) throw new OwnerCliError(`--recipient-gap must be at least ${LIMITS.minRecipientGapMs / 3_600_000}h.`);
  if ((quietEnd - quietStart + 1440) % 1440 < LIMITS.minQuietMinutes)
    throw new OwnerCliError(`--quiet-hours must cover at least ${LIMITS.minQuietMinutes / 60} hours.`);
  return { verb, file: path, options: { minIntervalMs, jitterMs, maxPerHour, maxPerDay, quietStart, quietEnd, burst, burstPauseMs,
    burstPauseJitterMs: CAMPAIGN_DEFAULTS.burstPauseJitterMs, recipientGapMs, timeZone, campaign, statePath, dryRun } };
}

interface Planned { entry: CampaignEntry; contactId: string; name: string; text: string; key: string; timeZone: string }

function recipient(state: CampaignState, contactId: string): RecipientState {
  return state.recipients[contactId] ??= { firstSentAt: null, lastSentAt: null, stopped: null };
}

/** Reconciles the file with saved progress. A message already attempted may
 * not change its text or recipient, since the first attempt may have landed. */
function plan(entries: readonly CampaignEntry[], snapshot: DesktopSnapshot, state: CampaignState, options: CampaignOptions): Planned[] {
  return entries.map(entry => {
    const contact = resolveCampaignContact(snapshot, entry.contact);
    const full = snapshot.contacts.find(value => value.id === contact.id);
    if (full?.settings.selfChat) throw new OwnerCliError(`Entry "${entry.id}" targets your own self chat. Campaigns go to other people.`);
    const text = renderTemplate(entry.template, entry.vars), key = idempotencyKey(options.campaign, entry.id, contact.id);
    const saved = state.entries[entry.id];
    if (saved && saved.status !== "pending" && (saved.contactId !== contact.id || saved.textDigest !== digest(text)))
      throw new OwnerCliError(`Entry "${entry.id}" changed after it was attempted. Give changed messages a new id.`);
    if (!saved || saved.status === "pending") state.entries[entry.id] = { status: "pending", contactId: contact.id, textDigest: digest(text), key, attempts: saved?.attempts ?? 0, sentAt: null, runId: null, detail: null };
    return { entry, contactId: contact.id, name: contact.name, text, key, timeZone: entry.timeZone ?? options.timeZone };
  });
}

function summary(state: CampaignState, planned: readonly Planned[]): Record<EntryStatus, number> {
  const counts: Record<EntryStatus, number> = { pending: 0, sending: 0, sent: 0, failed: 0, uncertain: 0, skipped: 0 };
  for (const item of planned) counts[state.entries[item.entry.id]!.status]++;
  return counts;
}

async function snapshotOf(request: OwnerControlClient): Promise<DesktopSnapshot> {
  const response = await request({ protocol: CONTROL_PROTOCOL, command: "snapshot" });
  if (!response.ok || response.kind !== "snapshot") throw new OwnerCliError("The Textbutler daemon is unavailable. Run textbutler doctor.");
  return response.snapshot;
}

/** Any contact message after the campaign first reached them stops them. On a
 * first touch, an unanswered message from them holds the send for a hand reply. */
async function replyCheck(ports: CampaignPorts, contactId: string, firstSentAt: number | null): Promise<string | null | "unreadable"> {
  const response = await awaitOwnerJob({ protocol: CONTROL_PROTOCOL, command: "messages.history", contactId, limit: 30 }, ports.request);
  if (!response.ok || response.kind !== "message-history" || !response.ready) return "unreadable";
  const messages = [...response.messages].filter(message => message.kind === "message").sort((a, b) => a.at - b.at);
  if (firstSentAt !== null && messages.some(message => message.author === "contact" && message.at >= firstSentAt)) return "replied";
  if (firstSentAt === null && messages.at(-1)?.author === "contact") return "unanswered-inbound";
  return null;
}

export async function runCampaignCommand(args: readonly string[], ports: CampaignPorts): Promise<number> {
  const defaultZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { verb, file, options } = parseCampaignArgs(args, defaultZone);
  const source = await (ports.readCampaign ?? (async (path: string) => new TextDecoder("utf-8", { fatal: true }).decode(await readOwnerInputFile(path, LIMITS.maxFileBytes))))(file);
  const entries = parseCampaign(source);
  const load = ports.loadState ?? loadState, save = ports.saveState ?? saveState;
  if (verb === "status" || options.dryRun) {
    const state = await load(options.statePath, options.campaign);
    const planned = plan(entries, await snapshotOf(ports.request), state, options);
    ports.print({ ok: true, campaign: options.campaign, dryRun: options.dryRun, state: options.statePath, counts: summary(state, planned),
      ...(options.dryRun ? { pacing: pacingView(options), estimate: estimate(planned, state, options) } : {}),
      entries: planned.map(item => {
        const saved = state.entries[item.entry.id]!, who = state.recipients[item.contactId];
        return { id: item.entry.id, contactId: item.contactId, name: item.name, status: saved.status, timeZone: item.timeZone,
          ...(who?.stopped ? { recipientStopped: who.stopped } : {}), ...(saved.detail ? { detail: saved.detail } : {}),
          ...(options.dryRun ? { text: item.text } : { sentAt: saved.sentAt === null ? null : new Date(saved.sentAt).toISOString() }) };
      }) });
    return 0;
  }
  const unlock = await (ports.lock ?? lockState)(options.statePath);
  try { return await runLoop(entries, options, ports, load, save); }
  finally { await unlock(); }
}

function pacingView(options: CampaignOptions): unknown {
  const clock = (minute: number): string => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  return { minIntervalSeconds: options.minIntervalMs / 1000, jitterSeconds: options.jitterMs / 1000, maxPerHour: options.maxPerHour, maxPerDay: options.maxPerDay,
    quietHours: options.quietStart === options.quietEnd ? null : `${clock(options.quietStart)}-${clock(options.quietEnd)}`, burst: options.burst,
    burstPauseSeconds: options.burstPauseMs / 1000, recipientGapSeconds: options.recipientGapMs / 1000, timeZone: options.timeZone };
}
/** Rough duration ignoring quiet hours: the binding cap, or the average gap. */
function estimate(planned: readonly Planned[], state: CampaignState, options: CampaignOptions): unknown {
  const remaining = planned.filter(item => state.entries[item.entry.id]!.status === "pending").length;
  const perHour = Math.min(options.maxPerHour, 3_600_000 / (options.minIntervalMs + options.jitterMs / 2));
  return { remaining, days: Math.ceil(remaining / options.maxPerDay), hoursAtFullPace: Math.round(remaining / perHour * 10) / 10 };
}

async function runLoop(entries: readonly CampaignEntry[], options: CampaignOptions, ports: CampaignPorts,
  load: (path: string, campaign: string) => Promise<CampaignState>, save: (path: string, state: CampaignState) => Promise<void>): Promise<number> {
  const state = await load(options.statePath, options.campaign);
  const planned = plan(entries, await snapshotOf(ports.request), state, options);
  await save(options.statePath, state);
  const halt = async (item: Planned | null, reason: string, detail: string): Promise<number> => {
    await save(options.statePath, state);
    ports.print({ ok: false, status: "halted", reason, ...(item ? { id: item.entry.id, contactId: item.contactId } : {}), detail, counts: summary(state, planned) });
    return 1;
  };
  for (;;) {
    if (ports.signal?.aborted) return halt(null, "interrupted", "Stopped before the next send. Rerun the same command to resume.");
    const now = ports.now();
    // Stopped recipients skip their remaining messages. An uncertain send only
    // holds them: it resolves first, and a confirmed outcome releases them.
    for (const item of planned) {
      const saved = state.entries[item.entry.id]!, who = state.recipients[item.contactId];
      if (saved.status === "pending" && who?.stopped && who.stopped !== "uncertain-send") { saved.status = "skipped"; saved.detail = `recipient stopped: ${who.stopped}`; }
    }
    // A write-ahead "sending" or earlier "uncertain" entry resolves first with
    // a replay-only request: the daemon reports the journaled outcome for the
    // key and never dispatches. A key it never journaled returns to pending
    // and goes through pacing and the reply check like any fresh message.
    const next = planned.find(item => ["sending", "uncertain"].includes(state.entries[item.entry.id]!.status))
      ?? planned.find(item => state.entries[item.entry.id]!.status === "pending"
        && (state.recipients[item.contactId]?.lastSentAt ?? -Infinity) + options.recipientGapMs <= now)
      ?? null;
    const waiting = planned.filter(item => state.entries[item.entry.id]!.status === "pending");
    if (!next && !waiting.length) {
      await save(options.statePath, state);
      ports.print({ ok: true, status: "complete", counts: summary(state, planned) });
      return 0;
    }
    const saved = next ? state.entries[next.entry.id]! : null;
    const resolving = saved !== null && saved.status !== "pending";
    // Pacing for fresh sends only. Resolving a prior attempt sends nothing new.
    let at = now;
    if (!resolving) {
      at = Math.max(at, state.nextSlotAt ?? now, capsAllowAt(state.sends, now, options.maxPerHour, options.maxPerDay));
      if (next) at = quietHoursEnd(at, next.timeZone, options.quietStart, options.quietEnd);
      else at = Math.max(at, Math.min(...waiting.map(item => (state.recipients[item.contactId]?.lastSentAt ?? 0) + options.recipientGapMs)));
    }
    if (at > now) {
      ports.print({ ok: true, status: "waiting", until: new Date(at).toISOString(), ...(next ? { next: next.entry.id } : {}) });
      await ports.sleep(at - now, ports.signal);
      continue;
    }
    if (!next || !saved) continue;
    const who = recipient(state, next.contactId);
    if (!resolving) {
      let check: string | null | "unreadable";
      try { check = await replyCheck(ports, next.contactId, who.firstSentAt); }
      catch { check = "unreadable"; }
      if (check === "unreadable") return halt(next, "history-unavailable", "The conversation could not be read, so a reply could not be ruled out. Nothing was sent. Run textbutler doctor, then rerun.");
      if (check !== null) {
        who.stopped = check; saved.status = "skipped"; saved.detail = `recipient stopped: ${check}`;
        await save(options.statePath, state);
        ports.print({ ok: true, status: "recipient-stopped", id: next.entry.id, contactId: next.contactId, reason: check });
        continue;
      }
      saved.status = "sending"; saved.attempts++; await save(options.statePath, state);
    }
    const request: ControlRequest = { protocol: CONTROL_PROTOCOL, command: "replies.send", contactId: next.contactId, text: next.text,
      operator: { idempotencyKey: saved.key, minimumIntervalMs: options.minIntervalMs, ...(resolving ? { replayOnly: true } : {}) } };
    let response: ControlResponse | null = null;
    try { response = await awaitOwnerJob(request, ports.request); } catch { response = null; }
    const sentAt = ports.now();
    if (response?.ok && response.kind === "reply-sent" && response.state === "submitted") {
      saved.status = "sent"; saved.runId = response.runId; saved.detail = null; saved.sentAt ??= sentAt;
      who.firstSentAt ??= saved.sentAt; who.lastSentAt = Math.max(who.lastSentAt ?? 0, saved.sentAt);
      // The uncertainty that stopped this recipient is now settled.
      if (resolving && who.stopped === "uncertain-send") who.stopped = null;
      // A reconciled send counts toward the caps too; it went out at some
      // point, and counting it can only slow the campaign down.
      state.sends = [...state.sends.filter(time => time > sentAt - 86_400_000), sentAt];
      if (!resolving) {
        const quiet = state.sends.length > 1 && sentAt - state.sends.at(-2)! >= options.burstPauseMs;
        state.burstCount = quiet ? 1 : state.burstCount + 1;
        const gap = options.minIntervalMs + Math.floor(ports.random() * (options.jitterMs + 1));
        const pause = state.burstCount >= options.burst ? options.burstPauseMs + Math.floor(ports.random() * (options.burstPauseJitterMs + 1)) : 0;
        if (pause) state.burstCount = 0;
        state.nextSlotAt = sentAt + Math.max(gap, pause);
      }
      await save(options.statePath, state);
      ports.print({ ok: true, status: resolving ? "reconciled" : "sent", id: next.entry.id, contactId: next.contactId, runId: response.runId,
        at: new Date(saved.sentAt).toISOString(), nextSlotAt: state.nextSlotAt === null ? null : new Date(state.nextSlotAt).toISOString() });
      continue;
    }
    if (response?.ok && response.kind === "reply-sent" && (response.state === "failed" || response.state === "cancelled")) {
      saved.status = "failed"; saved.runId = response.runId; saved.detail = response.detail.slice(0, 400); who.stopped = "send-failed";
      return halt(next, "send-failed", `${response.detail} The campaign halted; delivery problems can mean the account is being filtered. Rerun later to continue with the other recipients.`);
    }
    if (resolving && response && !response.ok && response.code === "invalid-request") {
      saved.status = "pending"; saved.detail = null;
      if (who.stopped === "uncertain-send") who.stopped = null;
      await save(options.statePath, state);
      continue;
    }
    if (response && !response.ok && ["invalid-request", "unavailable", "capacity"].includes(response.code) && !resolving) {
      // Refused as a whole. Returning the entry to pending is safe even if the
      // refusal came late: the retry reuses the key, and the daemon answers a
      // dispatched key from its journal instead of sending again.
      saved.status = "pending"; saved.detail = response.message.slice(0, 400);
      return halt(next, "rejected", `${response.message} Nothing was sent.`);
    }
    if (response && !response.ok && response.code === "conflict" && /still in progress/u.test(response.message)) {
      return halt(next, "in-progress", "A send under this entry's key is still in progress. Rerun shortly; it will report the outcome without sending again.");
    }
    if (response && !response.ok && response.code === "conflict" && /attempted too many times/u.test(response.message)) {
      // Eight attempts never reached dispatch. Retire the entry so reruns move on.
      saved.status = "failed"; saved.detail = response.message.slice(0, 400);
      return halt(next, "rejected", `${response.message} Nothing was sent. Give this message a new id to try again.`);
    }
    if (response && !response.ok && response.code === "conflict" && !resolving) {
      // The daemon answers a key it dispatched from its journal, so any other
      // conflict is a refusal before dispatch: another reply in flight, a grant
      // change, a stale conversation or an unrelated run awaiting reconcile.
      // The retry reuses the key, so a late refusal still cannot double-send.
      saved.status = "pending"; saved.detail = response.message.slice(0, 400);
      return halt(next, "busy", `${response.message} Nothing was sent under this entry. Rerun later to continue.`);
    }
    // Partial, indeterminate, disconnected, unconfirmed job or a conflict:
    // the recipient may have received it. Stop them and reconcile by hand.
    saved.status = "uncertain"; who.stopped = "uncertain-send";
    if (response?.ok && response.kind === "reply-sent") { saved.runId = response.runId; saved.detail = response.detail.slice(0, 400); }
    else saved.detail = response && !response.ok ? response.message.slice(0, 400) : "The send could not be confirmed.";
    return halt(next, "uncertain-send", `Check Messages for this conversation, run textbutler replies reconcile ${next.contactId} --sent or --failed, then rerun the campaign. It will not send this message again.`);
  }
}
