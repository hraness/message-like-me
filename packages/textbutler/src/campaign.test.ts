import { expect, test } from "bun:test";
import { CONTROL_PROTOCOL, type ControlRequest, type ControlResponse } from "../../control/src/index.ts";
import {
  CAMPAIGN_DEFAULTS, capsAllowAt, emptyState, idempotencyKey, inQuietHours, parseCampaign, parseCampaignArgs, parseDuration,
  parseQuietHours, quietHoursEnd, renderTemplate, runCampaignCommand, type CampaignPorts, type CampaignState,
} from "./campaign.ts";
import { OwnerCliError } from "./owner-cli.ts";
import { OPERATOR_KEY_PATTERN } from "./owner-replies.ts";

const START = Date.parse("2026-09-28T16:00:00.000Z"); // 12:00 in New York
const ZONE = "America/New_York";

/** A simulated daemon: sends are keyed by idempotency key, exactly as the
 * journal keys them, so a repeated key reports the first outcome. */
function daemon(options: { contacts?: { id: string; name: string; selfChat?: boolean }[]; failKeys?: Set<string>; loseKeys?: Set<string>; busyOnce?: Set<string>; exhausted?: Set<string>; replies?: Map<string, number> } = {}) {
  const contacts = options.contacts ?? [{ id: "c-1", name: "Synthetic One" }, { id: "c-2", name: "Synthetic Two" }];
  const journal = new Map<string, { runId: string; state: "submitted" | "failed" | "indeterminate"; text: string; contactId: string }>();
  const dispatched: { contactId: string; text: string; key: string; minimumIntervalMs: number }[] = [];
  const requests: ControlRequest[] = [];
  let clock = START;
  const request = async (item: ControlRequest): Promise<ControlResponse> => {
    requests.push(item);
    if (item.command === "snapshot") return { protocol: CONTROL_PROTOCOL, ok: true, kind: "snapshot",
      snapshot: { contacts: contacts.map(contact => ({ id: contact.id, name: contact.name, settings: { selfChat: contact.selfChat ?? false } })) } } as never;
    if (item.command === "messages.history") {
      const replyAt = options.replies?.get(item.contactId);
      return { protocol: CONTROL_PROTOCOL, ok: true, kind: "message-history", contactId: item.contactId, provider: "imessage", ready: true,
        messages: replyAt === undefined ? [] : [{ id: "r", at: replyAt, author: "contact", kind: "message", text: "hi" }] } as never;
    }
    if (item.command === "replies.send" && "operator" in item) {
      const key = item.operator.idempotencyKey, prior = journal.get(key);
      if (prior) return { protocol: CONTROL_PROTOCOL, ok: true, kind: "reply-sent", contactId: prior.contactId, runId: prior.runId, state: prior.state, detail: "replayed" };
      if (item.operator.replayOnly) return { protocol: CONTROL_PROTOCOL, ok: false, code: "invalid-request", message: "Nothing was sent under this idempotency key." };
      if (options.exhausted?.has(key)) return { protocol: CONTROL_PROTOCOL, ok: false, code: "conflict", message: "This idempotency key has been attempted too many times." };
      if (options.busyOnce?.delete(key)) return { protocol: CONTROL_PROTOCOL, ok: false, code: "conflict", message: "This conversation already has a reply in progress." };
      const state = options.failKeys?.has(key) ? "failed" : "submitted";
      const runId = `run-${journal.size + 1}`;
      journal.set(key, { runId, state, text: item.text, contactId: item.contactId });
      if (state === "submitted") dispatched.push({ contactId: item.contactId, text: item.text, key, minimumIntervalMs: item.operator.minimumIntervalMs });
      if (options.loseKeys?.has(key)) { options.loseKeys.delete(key); throw new Error("connection lost after dispatch"); }
      return { protocol: CONTROL_PROTOCOL, ok: true, kind: "reply-sent", contactId: item.contactId, runId, state, detail: "Reply sent." };
    }
    throw new Error(`unexpected ${item.command}`);
  };
  return { request, journal, dispatched, requests, now: () => clock, advance: (ms: number) => { clock += ms; } };
}

function harness(file: string, fake: ReturnType<typeof daemon>, stateRef: { value: CampaignState | null } = { value: null }) {
  const printed: Record<string, unknown>[] = [], sleeps: number[] = [];
  const ports: CampaignPorts = {
    request: fake.request, now: fake.now, random: () => 0.5, print: value => { printed.push(value as Record<string, unknown>); },
    sleep: async milliseconds => { sleeps.push(milliseconds); fake.advance(milliseconds); },
    readCampaign: async () => file,
    loadState: async (_path, campaign) => structuredClone(stateRef.value ?? emptyState(campaign)),
    saveState: async (_path, state) => { stateRef.value = structuredClone(state); },
    lock: async () => async () => undefined,
  };
  return { ports, printed, sleeps, stateRef };
}

const line = (value: Record<string, unknown>): string => JSON.stringify(value);
const ARGS = ["run", "/campaigns/launch.jsonl", "--time-zone", ZONE];

test("templates fill every placeholder or refuse to render", () => {
  expect(renderTemplate("Hi {{first}}, {{ first }}!", { first: "Sam" })).toBe("Hi Sam, Sam!");
  expect(() => renderTemplate("Hi {{first}}", {})).toThrow(OwnerCliError);
  expect(() => renderTemplate("Hi {{first}", { first: "x" })).toThrow(OwnerCliError);
  expect(() => renderTemplate("Hi {{a}}", { a: "{{b}}" })).toThrow(OwnerCliError);
});

test("campaign files are strict JSON lines with unique ids", () => {
  expect(parseCampaign(`${line({ id: "a", contact: "c-1", text: "Hi {{n}}", vars: { n: "x" } })}\n\n`)).toHaveLength(1);
  for (const bad of ["{", "[]", line({ id: "a", contact: "c-1", text: "x", extra: 1 }), line({ id: "", contact: "c", text: "x" }),
    line({ id: "a", contact: "c", text: " " }), line({ id: "a", contact: "c", text: "x", timeZone: "Mars/Olympus" }),
    `${line({ id: "a", contact: "c", text: "x" })}\n${line({ id: "a", contact: "c", text: "y" })}`, ""])
    expect(() => parseCampaign(bad)).toThrow(OwnerCliError);
});

test("flags are bounded and defaults are conservative", () => {
  const { options } = parseCampaignArgs(["run", "/x/a.jsonl"], ZONE);
  expect(options).toMatchObject({ minIntervalMs: CAMPAIGN_DEFAULTS.minIntervalMs, maxPerHour: 15, maxPerDay: 30, dryRun: false, campaign: "a", statePath: "/x/a.jsonl.state.json" });
  expect(parseCampaignArgs(["run", "/x/a.jsonl", "--min-interval", "45s", "--jitter", "30s", "--max-per-hour", "8", "--max-per-day", "20", "--quiet-hours", "21:00-09:00", "--dry-run"], ZONE).options)
    .toMatchObject({ minIntervalMs: 45_000, jitterMs: 30_000, maxPerHour: 8, maxPerDay: 20, quietStart: 21 * 60, quietEnd: 9 * 60, dryRun: true });
  for (const bad of [["--min-interval", "5s"], ["--max-per-hour", "0"], ["--max-per-hour", "61"], ["--max-per-day", "201"], ["--quiet-hours", "9-5"], ["--state", "relative.json"], ["--bogus"],
    ["--jitter", "0s"], ["--burst", "21"], ["--burst-pause", "1m"], ["--recipient-gap", "0"], ["--quiet-hours", "00:00-00:00"], ["--quiet-hours", "22:00-03:00"]])
    expect(() => parseCampaignArgs(["run", "/x/a.jsonl", ...bad], ZONE)).toThrow(OwnerCliError);
  expect(parseDuration("2h")).toBe(7_200_000);
  expect(() => parseDuration("8d")).toThrow(OwnerCliError);
  expect(parseQuietHours("19:30-10:00")).toEqual({ start: 1170, end: 600 });
});

test("idempotency keys are stable, distinct and accepted by the daemon", () => {
  const key = idempotencyKey("launch", "a1", "c-1");
  expect(key).toBe(idempotencyKey("launch", "a1", "c-1"));
  expect(key).not.toBe(idempotencyKey("launch", "a1", "c-2"));
  expect(key).not.toBe(idempotencyKey("launch2", "a1", "c-1"));
  expect(OPERATOR_KEY_PATTERN.test(key)).toBe(true);
});

test("quiet hours are evaluated in the recipient's zone and end at the right minute", () => {
  const night = Date.parse("2026-09-29T02:00:00.000Z"); // 22:00 New York
  expect(inQuietHours(night, ZONE, 21 * 60, 9 * 60)).toBe(true);
  expect(inQuietHours(night, "Europe/London", 21 * 60, 9 * 60)).toBe(true); // 03:00 London
  expect(inQuietHours(night, "America/Los_Angeles", 21 * 60, 9 * 60)).toBe(false); // 19:00
  expect(new Date(quietHoursEnd(night, ZONE, 21 * 60, 9 * 60)).toISOString()).toBe("2026-09-29T13:00:00.000Z");
  expect(quietHoursEnd(START, ZONE, 21 * 60, 9 * 60)).toBe(START);
  expect(inQuietHours(night, ZONE, 600, 600)).toBe(false);
});

test("property: quiet-hours end is never earlier, never inside quiet hours, and within a day", () => {
  let seed = 7;
  const next = (): number => { seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31; return seed / 2 ** 31; };
  const zones = [ZONE, "Europe/London", "Asia/Kolkata", "Australia/Lord_Howe", "UTC"];
  for (let index = 0; index < 400; index++) {
    const at = START + Math.floor(next() * 400 * 86_400_000), zone = zones[Math.floor(next() * zones.length)]!;
    const start = Math.floor(next() * 1440), end = Math.floor(next() * 1440);
    const result = quietHoursEnd(at, zone, start, end);
    expect(result).toBeGreaterThanOrEqual(at);
    expect(inQuietHours(result, zone, start, end)).toBe(false);
    expect(result - at).toBeLessThanOrEqual(86_400_000 + 3 * 3_600_000);
  }
});

test("property: the caps are never exceeded over any sliding window", () => {
  let seed = 11;
  const next = (): number => { seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31; return seed / 2 ** 31; };
  for (let run = 0; run < 40; run++) {
    const perHour = 1 + Math.floor(next() * 10), perDay = perHour + Math.floor(next() * 30);
    const sends: number[] = [];
    let now = START;
    for (let index = 0; index < 120; index++) {
      now = capsAllowAt(sends, now + Math.floor(next() * 600_000), perHour, perDay);
      sends.push(now);
    }
    for (const time of sends) {
      expect(sends.filter(other => other > time - 3_600_000 && other <= time).length).toBeLessThanOrEqual(perHour);
      expect(sends.filter(other => other > time - 86_400_000 && other <= time).length).toBeLessThanOrEqual(perDay);
    }
  }
});

test("a dry run renders every message and sends nothing", async () => {
  const fake = daemon();
  const file = [line({ id: "a", contact: "c-1", text: "Hi {{first}}", vars: { first: "One" } }), line({ id: "b", contact: "Synthetic Two", text: "Hello" })].join("\n");
  const { ports, printed, stateRef } = harness(file, fake);
  expect(await runCampaignCommand([...ARGS, "--dry-run"], ports)).toBe(0);
  expect(fake.dispatched).toEqual([]);
  expect(fake.requests.some(item => item.command === "replies.send")).toBe(false);
  expect(stateRef.value).toBeNull();
  expect(printed[0]).toMatchObject({ ok: true, dryRun: true, entries: [{ id: "a", contactId: "c-1", text: "Hi One" }, { id: "b", contactId: "c-2", text: "Hello" }] });
});

test("a run sends each message verbatim once, paced, and a rerun sends nothing", async () => {
  const fake = daemon();
  const file = [line({ id: "a", contact: "c-1", text: "Hi {{first}}", vars: { first: "One" } }), line({ id: "b", contact: "c-2", text: "Hello two" })].join("\n");
  const first = harness(file, fake);
  expect(await runCampaignCommand(ARGS, first.ports)).toBe(0);
  expect(fake.dispatched.map(item => [item.contactId, item.text])).toEqual([["c-1", "Hi One"], ["c-2", "Hello two"]]);
  expect(fake.dispatched.every(item => item.minimumIntervalMs === CAMPAIGN_DEFAULTS.minIntervalMs)).toBe(true);
  // Default pacing: at least the minimum interval plus jitter between sends.
  expect(first.sleeps.reduce((sum, value) => sum + value, 0)).toBeGreaterThanOrEqual(CAMPAIGN_DEFAULTS.minIntervalMs);
  expect(first.printed.at(-1)).toMatchObject({ status: "complete", counts: { sent: 2 } });
  const again = harness(file, fake, first.stateRef);
  expect(await runCampaignCommand(ARGS, again.ports)).toBe(0);
  expect(fake.dispatched).toHaveLength(2);
});

test("a crash after dispatch resumes by replaying the key, never sending twice", async () => {
  const fake = daemon({ loseKeys: new Set([idempotencyKey("launch", "a", "c-1")]) });
  const file = [line({ id: "a", contact: "c-1", text: "Once" }), line({ id: "b", contact: "c-2", text: "Twice?" })].join("\n");
  const first = harness(file, fake);
  expect(await runCampaignCommand(ARGS, first.ports)).toBe(1);
  expect(first.printed.at(-1)).toMatchObject({ status: "halted", reason: "uncertain-send", id: "a" });
  expect(first.stateRef.value!.entries.a!.status).toBe("uncertain");
  // The rerun asks the daemon for the journaled outcome with a replay-only request.
  const resumed = harness(file, fake, first.stateRef);
  expect(await runCampaignCommand(ARGS, resumed.ports)).toBe(0);
  const sends = fake.requests.filter((item): item is Extract<ControlRequest, { operator: unknown }> => item.command === "replies.send" && "operator" in item);
  expect(sends.filter(item => item.operator.idempotencyKey === idempotencyKey("launch", "a", "c-1")).map(item => item.operator.replayOnly ?? false)).toEqual([false, true]);
  expect(fake.dispatched.map(item => item.text)).toEqual(["Once", "Twice?"]);
  expect(resumed.printed.some(value => value.status === "reconciled")).toBe(true);
});

test("a write-ahead entry the daemon never journaled returns to pending and sends once", async () => {
  const fake = daemon();
  const file = line({ id: "a", contact: "c-1", text: "Crashed before request" });
  const state = emptyState("launch");
  state.entries.a = { status: "sending", contactId: "c-1", textDigest: new Bun.CryptoHasher("sha256").update("Crashed before request").digest("hex"),
    key: idempotencyKey("launch", "a", "c-1"), attempts: 1, sentAt: null, runId: null, detail: null };
  const run = harness(file, fake, { value: state });
  expect(await runCampaignCommand(ARGS, run.ports)).toBe(0);
  expect(fake.dispatched.map(item => item.text)).toEqual(["Crashed before request"]);
});

test("a reply stops that recipient; an unanswered inbound holds the first touch", async () => {
  const fake = daemon({ replies: new Map([["c-2", START - 60_000]]) });
  const file = [line({ id: "a", contact: "c-1", text: "One" }), line({ id: "b", contact: "c-2", text: "Two" }), line({ id: "c", contact: "c-2", text: "Two again" })].join("\n");
  const run = harness(file, fake);
  expect(await runCampaignCommand([...ARGS, "--recipient-gap", "1h"], run.ports)).toBe(0);
  expect(fake.dispatched.map(item => item.contactId)).toEqual(["c-1"]);
  expect(run.stateRef.value!.recipients["c-2"]!.stopped).toBe("unanswered-inbound");
  expect(run.printed.at(-1)).toMatchObject({ status: "complete", counts: { sent: 1, skipped: 2 } });
});

test("a failed send halts the campaign and skips that recipient on resume", async () => {
  const fake = daemon({ failKeys: new Set([idempotencyKey("launch", "a", "c-1")]) });
  const file = [line({ id: "a", contact: "c-1", text: "One" }), line({ id: "b", contact: "c-1", text: "One more" }), line({ id: "c", contact: "c-2", text: "Two" })].join("\n");
  const first = harness(file, fake);
  expect(await runCampaignCommand([...ARGS, "--recipient-gap", "1h"], first.ports)).toBe(1);
  expect(first.printed.at(-1)).toMatchObject({ reason: "send-failed" });
  const resumed = harness(file, fake, first.stateRef);
  expect(await runCampaignCommand([...ARGS, "--recipient-gap", "1h"], resumed.ports)).toBe(0);
  expect(fake.dispatched.map(item => item.text)).toEqual(["Two"]);
});

test("a changed message after an attempt is refused; self chats and ambiguous names are refused", async () => {
  const fake = daemon({ contacts: [{ id: "c-1", name: "Same" }, { id: "c-2", name: "Same" }, { id: "me", name: "Me", selfChat: true }] });
  const first = harness(line({ id: "a", contact: "c-1", text: "Original" }), fake);
  expect(await runCampaignCommand(ARGS, first.ports)).toBe(0);
  const changed = harness(line({ id: "a", contact: "c-1", text: "Edited" }), fake, first.stateRef);
  await expect(runCampaignCommand(ARGS, changed.ports)).rejects.toThrow("changed after it was attempted");
  await expect(runCampaignCommand(ARGS, harness(line({ id: "x", contact: "Same", text: "Hi" }), fake).ports)).rejects.toThrow("more than one");
  await expect(runCampaignCommand(ARGS, harness(line({ id: "x", contact: "me", text: "Hi" }), fake).ports)).rejects.toThrow("self chat");
  expect(fake.dispatched).toHaveLength(1);
});

test("quiet hours in the recipient's zone delay the send", async () => {
  const fake = daemon();
  fake.advance(Date.parse("2026-09-29T02:00:00.000Z") - START); // 22:00 New York
  const run = harness(line({ id: "a", contact: "c-1", text: "Morning" }), fake);
  expect(await runCampaignCommand([...ARGS, "--quiet-hours", "21:00-09:00"], run.ports)).toBe(0);
  expect(run.printed[0]).toMatchObject({ status: "waiting", until: "2026-09-29T13:00:00.000Z" });
  expect(fake.dispatched).toHaveLength(1);
});

test("a refusal before dispatch halts as busy, keeps the entry pending, and the rerun sends it once", async () => {
  const fake = daemon({ busyOnce: new Set([idempotencyKey("launch", "a", "c-1")]) });
  const file = line({ id: "a", contact: "c-1", text: "Only once" });
  const first = harness(file, fake);
  expect(await runCampaignCommand(ARGS, first.ports)).toBe(1);
  expect(first.printed.at(-1)).toMatchObject({ status: "halted", reason: "busy", id: "a" });
  expect(first.stateRef.value!.entries.a!.status).toBe("pending");
  expect(first.stateRef.value!.recipients["c-1"]?.stopped ?? null).toBeNull();
  const resumed = harness(file, fake, first.stateRef);
  expect(await runCampaignCommand(ARGS, resumed.ports)).toBe(0);
  expect(fake.dispatched.map(item => item.text)).toEqual(["Only once"]);
});

test("an exhausted key retires its entry so reruns move on to the rest", async () => {
  const fake = daemon({ exhausted: new Set([idempotencyKey("launch", "a", "c-1")]) });
  const file = [line({ id: "a", contact: "c-1", text: "Stuck" }), line({ id: "b", contact: "c-2", text: "Next" })].join("\n");
  const first = harness(file, fake);
  expect(await runCampaignCommand(ARGS, first.ports)).toBe(1);
  expect(first.printed.at(-1)).toMatchObject({ status: "halted", reason: "rejected", id: "a" });
  expect(first.stateRef.value!.entries.a!.status).toBe("failed");
  const resumed = harness(file, fake, first.stateRef);
  expect(await runCampaignCommand(ARGS, resumed.ports)).toBe(0);
  expect(fake.dispatched.map(item => item.text)).toEqual(["Next"]);
});
