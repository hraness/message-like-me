import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { planAutostart, validateSnapshot, type CompanionOptions, type MenuItem, type Snapshot } from "@hraness/desktop-foundation";
import { runTextbutlerCli } from "./cli.ts";
import { startDaemon, type RunningDaemon } from "./daemon.ts";
import { companionForeground, companionOptions, exitSoon, localAppEnabled, menuApp, menuLabel, menuTime, runMenuBarCommand, snapshotItems } from "./menubar.ts";
import { ACTION_ERROR_MS, describeMenuFailure, MenuFailure, MenuPending } from "./menu-errors.ts";
import { TRAY_ICON } from "./menubar-icon.ts";
import { disconnectedSnapshot, type DesktopSnapshot } from "../../control/src/index.ts";
/** Textbutler returns the v1 item list; 0.8 widened the snapshot type. */
const v1 = async (options: CompanionOptions, signal: AbortSignal): Promise<readonly MenuItem[]> => (await options.snapshot(signal)) as readonly MenuItem[];

const roots: string[] = [], daemons: RunningDaemon[] = [];
afterEach(async () => { for (const daemon of daemons.splice(0)) await daemon.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function root(): Promise<string> { const path = await mkdtemp(join(await realpath("/tmp"), "textbutler-menubar-")); roots.push(path); return path; }
async function start(dataDir: string): Promise<RunningDaemon> { const daemon = await startDaemon({ dataDir }); daemons.push(daemon); return daemon; }

/** The produced items must satisfy the shared runner's wire contract. */
function wire(items: readonly MenuItem[]): ReadonlyMap<string, boolean> {
  return validateSnapshot({ version: 1, type: "snapshot", appId: "textbutler", name: "Textbutler", title: "\u{1f916}", icon: TRAY_ICON, revision: 1, items } satisfies Snapshot);
}
function labels(items: readonly MenuItem[]): string[] {
  return items.flatMap(item => item.kind === "separator" ? [] : item.kind === "submenu" ? [item.label, ...labels(item.items)] : [item.label]);
}
function action(items: readonly MenuItem[], id: string): Extract<MenuItem, { kind: "action" }> {
  const found = items.find(item => item.kind === "action" && item.id === id);
  if (!found || found.kind !== "action") throw new Error(`missing action ${id}`);
  return found;
}
function submenu(items: readonly MenuItem[], label: string): Extract<MenuItem, { kind: "submenu" }> {
  const found = items.find(item => item.kind === "submenu" && item.label === label);
  if (found?.kind !== "submenu") throw new Error(`missing submenu ${label}`);
  return found;
}
function base(overrides: Partial<DesktopSnapshot> = {}): DesktopSnapshot {
  return { ...disconnectedSnapshot(), connection: "connected", revision: 7, ...overrides };
}

describe("menu label presentation", () => {
  test("sanitizes control, newline and bidi text before it reaches a menu row", () => {
    expect(menuLabel("a\u202Ab\nc\u0000d\u2066e")).toBe("a b c d e");
    expect(menuLabel("  spaced   out ")).toBe("spaced out");
    expect(menuLabel("\u202e\u2067\u0007")).toBe("");
  });
  test("truncates by unicode scalar values at the bound", () => {
    const result = menuLabel("x".repeat(100));
    expect([...result].length).toBe(72);
    expect(result.endsWith("…")).toBe(true);
    expect(menuLabel("emoji 😀 ".repeat(30), 10)).toBe("emoji 😀 e…");
  });
});

describe("companion identity", () => {
  test("carries the robot status mark and bundled 32x32 tray art", () => {
    const options = companionOptions(join(roots[0] ?? "/tmp/tb-menubar-test", "data"), () => Promise.resolve());
    expect(options.title).toBe("\u{1f916}");
    expect(options.icon).toBe(TRAY_ICON);
    expect(TRAY_ICON.width).toBe(32);
    expect(TRAY_ICON.height).toBe(32);
    expect(Buffer.from(TRAY_ICON.rgba, "base64").length).toBe(32 * 32 * 4);
  });
  test("immediate and login restarts share isolated argv despite planted Bun configuration", async () => {
    const directory = await root(), home = join(directory, "home"), cwd = join(directory, "untrusted-cwd"), dataDir = join(directory, "data");
    await mkdir(home); await mkdir(cwd);
    const entrypoint = join(directory, "synthetic-entrypoint.mjs"), injected = join(directory, "injected.js");
    await writeFile(injected, 'process.stdout.write("UNSAFE-PRELOAD\\n");');
    await writeFile(entrypoint, 'process.stdout.write(JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2), home: process.env.HOME, inherited: process.env.TEXTBUTLER_INJECTED }) + "\\n");');
    for (const file of [join(cwd, "bunfig.toml"), join(home, ".bunfig.toml")]) await writeFile(file, `preload = [${JSON.stringify(injected)}]\n`);
    await writeFile(join(cwd, ".env"), "TEXTBUTLER_INJECTED=from-file\n");
    const command = companionForeground(dataDir, entrypoint, { home, runtime: await realpath(process.execPath) });
    const plan = planAutostart({ id: "textbutler", label: "Textbutler", platform: "darwin", home, executable: command.executable, args: [...command.args] });
    const array = /<key>ProgramArguments<\/key><array>(.*?)<\/array>/su.exec(plan.contents)?.[1];
    const args = [...array!.matchAll(/<string>(.*?)<\/string>/gsu)].map(match => match[1]!.replaceAll("&apos;", "'").replaceAll("&quot;", '"').replaceAll("&gt;", ">").replaceAll("&lt;", "<").replaceAll("&amp;", "&"));
    expect(args).toEqual([command.executable, ...command.args]);
    const child = Bun.spawn(args, { cwd, env: { HOME: home, BUN_OPTIONS: `--preload=${injected}`, NODE_OPTIONS: `--require=${injected}`, TEXTBUTLER_INJECTED: "from-environment" }, stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(code).toBe(0); expect(stderr).toBe(""); expect(stdout).not.toContain("UNSAFE-PRELOAD");
    expect(JSON.parse(stdout)).toEqual({ cwd: "/", home, args: ["menubar", "--foreground", "--data-dir", dataDir] });
  });
});

describe("snapshot menu mapping (T5)", () => {
  const running = { settings: { paused: false, activeContactLimit: 5 }, automation: { state: "running" as const, detail: "Replies are live." }, messagingProviders: ["imessage" as const] };
  const contact = (index: number, enabled = false) => ({ id: `contact-${index}`, name: `Contact ${index}\u202a`, subtitle: `Subtitle ${index}`,
    settings: { enabled, responseMode: "smart" as const, keyword: "butler", provider: "codex" as const, disclosure: { character: "🤖", begin: "{", end: "}" } } });
  test("a status line leads, one primary action follows, and the pause toggle reads as a verb", () => {
    for (const [snapshot, status, primary, toggle] of [
      [base({ ...running, contacts: [contact(1, true)] }), "● Automatic replies on in 1 of 1 chats", "replies.scan", "Pause automatic replies"],
      [base({ messagingProviders: ["imessage"], contacts: [contact(1)] }), "⏸︎ Automatic replies paused", "replies.scan", "Resume automatic replies"],
      [base(), "◐ Getting started", "open-guide", "Resume automatic replies"],
      [disconnectedSnapshot(), "⊘ Textbutler isn't running", "daemon.install", null],
    ] as const) {
      const items = snapshotItems(snapshot, { confirmedAgeSeconds: 3, fresh: true });
      const actions = wire(items);
      expect(items[0]).toEqual({ kind: "label", label: status });
      expect(items[1]).toEqual({ kind: "separator" });
      expect(items[2]).toMatchObject({ kind: "action", id: primary });
      if (toggle === null) expect(actions.has("toggle-pause")).toBe(false);
      else expect(action(items, "toggle-pause")).toEqual({ kind: "action", id: "toggle-pause", label: toggle });
      expect(actions.get("product.support")).toBe(true);
      expect(items.at(-1)).toEqual({ kind: "quit", label: "Quit Textbutler" });
    }
  });
  test("macOS access needs replace the primary action with the Settings pane", async () => {
    const opened: string[] = [];
    for (const [needs, status, id] of [["full-disk-access", "🔒︎ Needs Full Disk Access · Then finish setup in the guided terminal", "settings.full-disk-access"],
      ["automation", "🔒︎ Needs Automation for Messages · Then run app setup again", "settings.automation"]] as const) {
      const items = snapshotItems(base({ ...running, contacts: [contact(1, true)] }), { confirmedAgeSeconds: 0, fresh: true }, { access: { needs } });
      expect(items[0]).toEqual({ kind: "label", label: status });
      expect(items[2]).toMatchObject({ kind: "action", id });
      // The record changes only when app setup runs again, so checking stays reachable.
      expect(items[3]).toMatchObject({ kind: "action", id: "replies.scan" });
    }
    const options = companionOptions("/unused", async () => {}, "/unused/cli.ts", { access: async () => ({ needs: "full-disk-access" }), openSettings: async url => { opened.push(url); return true; },
      request: async () => ({ protocol: "textbutler.control.v1", ok: true, kind: "snapshot", snapshot: base(running) }) as never });
    const signal = new AbortController().signal;
    expect(labels(await v1(options, signal))[0]!.startsWith("🔒︎ Needs Full Disk Access")).toBe(true);
    await options.onAction("settings.full-disk-access", signal);
    await options.onAction("settings.automation", signal);
    expect(opened).toEqual(["x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles", "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation"]);
  });
  test("conversations are bounded, sanitized and toggled per contact", () => {
    const contacts = Array.from({ length: 23 }, (_, index) => contact(index, index % 2 === 0));
    const items = snapshotItems(base({ ...running, contacts }), { confirmedAgeSeconds: 0, fresh: true });
    wire(items);
    const menu = submenu(items, "Conversations");
    expect(menu.items.filter(item => item.kind === "submenu").length).toBe(20);
    expect(labels(menu.items)).toContain("3 more in the guided terminal");
    expect(labels(items).some(label => /[\u202a-\u202e]/u.test(label))).toBe(false);
    const first = submenu(menu.items, "Contact 0");
    expect(action(first.items, "contact.toggle:contact-0")).toMatchObject({ label: "Automatic replies", checked: true });
    expect(items[0]).toEqual({ kind: "label", label: "● Automatic replies on in 12 of 23 chats" });
  });
  test("diagnostics sit under Details with local times and plain activity", () => {
    const items = snapshotItems(base({
      providerAccounts: [
        { id: "claude-main", label: "Claude primary", provider: "claude", route: "claude-api", status: "ready", detail: "Ready detail", defaultReplyModel: "m", classifierModel: "c" },
        { id: "codex-main", label: "Codex primary", provider: "codex", route: "codex", status: "setup-required", detail: "Setup detail", defaultReplyModel: null, classifierModel: null },
      ],
      activity: [
        { id: "old", at: "2026-01-01T00:00:00Z", contactId: null, title: "ignored", detail: "No keyword." },
        { id: "new", at: "2026-03-01T15:48:00Z", contactId: null, title: "submitted", detail: "Sent." },
      ],
    }), { confirmedAgeSeconds: 61, fresh: true });
    wire(items);
    const details = submenu(items, "Details");
    const all = labels(details.items);
    expect(all).toContain("Claude primary · Ready");
    expect(all).toContain("Codex primary · Needs setup");
    expect(all).toContain("Messages · Needs setup");
    expect(all).toContain("Updated 1m ago");
    expect(all.findIndex(label => label.startsWith("✓ Replied · "))).toBeLessThan(all.findIndex(label => label.startsWith("– Skipped · ")));
    expect(all.some(label => /\d{4}-\d{2}-\d{2}T/u.test(label))).toBe(false);
    expect(labels(items.filter(item => item.kind !== "submenu" || item.label !== "Details")).some(label => /Capabilities|Agent accounts|Updated/u.test(label))).toBe(false);
  });
  test("local clock times, never ISO timestamps", () => {
    expect(menuTime("2026-03-01T15:48:00Z", "UTC")).toBe("3:48 PM");
    expect(menuTime("not a time")).toBe("");
  });
  test("marks unconfirmed and stale states distinctly", () => {
    expect(labels(submenu(snapshotItems(disconnectedSnapshot(), { confirmedAgeSeconds: null, fresh: false }), "Details").items)).toContain("Status not confirmed yet");
    expect(labels(submenu(snapshotItems(disconnectedSnapshot(), { confirmedAgeSeconds: 90, fresh: false }), "Details").items)).toContain("Last confirmed 1m ago");
  });
});

describe("replies waiting", () => {
  const replies = (overrides: Partial<import("../../control/src/index.ts").RepliesView> = {}) => ({
    scannedAt: "2026-03-01T00:00:00Z", pending: [], drafts: [], ...overrides,
  });
  const pending = {
    contactId: "contact-1", name: "Alice Example", provider: "imessage" as const, enabled: true,
    pendingCount: 2, lastInboundAt: "2026-03-01T00:00:00Z", preview: "Dinner at 7?\u202e", sendable: true, reason: null,
  };
  const draft = {
    id: "draft:abc", contactId: "contact-1", name: "Alice Example", summary: "Suggestion",
    preview: "\ud83e\udd16{ Yes, 7 works. }", actionCount: 1, expiresAt: "2026-03-01T00:15:00Z",
  };
  const ready = { messagingProviders: ["imessage" as const], contacts: [{ id: "contact-1", name: "Alice Example", subtitle: "iMessage",
    settings: { enabled: true, responseMode: "smart" as const, keyword: "butler", provider: "codex" as const, disclosure: { character: "🤖", begin: "{", end: "}" } } }] };
  test("the primary row carries the waiting count and a suggest action only when sendable", () => {
    const items = snapshotItems(base({ ...ready, replies: replies({ pending: [pending] }) }), { confirmedAgeSeconds: 0, fresh: true });
    wire(items);
    expect(items[2]).toEqual({ kind: "action", id: "replies.scan", label: "Check for replies · 2 waiting" });
    const menu = submenu(items, "Replies waiting");
    const all = labels(menu.items);
    expect(all).toContain("Alice Example · 2 to answer");
    expect(all.some(label => label.includes("\u202e"))).toBe(false);
    expect(all.some(label => label.includes("Dinner at 7?"))).toBe(true);
    expect(submenu(menu.items, "Alice Example · 2 to answer").items.some(item => item.kind === "action" && item.id === "replies.suggest:contact-1")).toBe(true);
    const blocked = submenu(snapshotItems(base({ ...ready, replies: replies({ pending: [{ ...pending, sendable: false, reason: "A previous send needs reconciliation." }] }) }), { confirmedAgeSeconds: 0, fresh: true }), "Replies waiting");
    const row = submenu(blocked.items, "Alice Example · 2 to answer");
    expect(labels(row.items)).toContain("A previous send needs reconciliation.");
    expect(row.items.some(item => item.kind === "action" && item.id === "replies.suggest:contact-1")).toBe(false);
  });
  test("suggestions need the full terminal review and only expose discard", () => {
    const items = snapshotItems(base({ ...ready, replies: replies({ pending: [pending], drafts: [draft] }) }), { confirmedAgeSeconds: 0, fresh: true });
    wire(items);
    const row = submenu(submenu(items, "Replies waiting").items, "Suggestion for Alice Example");
    expect(labels(row.items)).toContain("\ud83e\udd16{ Yes, 7 works. }");
    expect(labels(row.items)).toContain("Review and send it in the guided terminal");
    expect(row.items.some(item => item.kind === "action" && item.id === "replies.discard:draft:abc")).toBe(true);
    const ids = JSON.stringify(items);
    expect(ids).not.toContain("replies.text");
    expect(ids.match(/"replies.send:[^"]*"/g)).toBeNull();
  });
  test("nothing waiting shows no replies submenu, only the check action", () => {
    const items = snapshotItems(base({ ...ready, replies: replies() }), { confirmedAgeSeconds: 0, fresh: true });
    expect(items.some(item => item.kind === "submenu" && item.label === "Replies waiting")).toBe(false);
    expect(items[2]).toEqual({ kind: "action", id: "replies.scan", label: "Check for replies" });
  });
  test("stale menu send actions cannot bypass full draft review", async () => {
    const dataDir = await root();
    await start(dataDir);
    const options = companionOptions(dataDir);
    const signal = new AbortController().signal;
    // No messaging automation: every replies action fails closed at the daemon.
    await expect(options.onAction("replies.send:draft:abc", signal)).rejects.toThrow("full-draft-review-required");
    await expect(options.onAction("replies.suggest:contact-1", signal)).rejects.toThrow("replies-suggest-unconfirmed");
    await expect(options.onAction("replies.discard:draft:abc", signal)).rejects.toThrow("replies-discard-unavailable");
  });
});

describe("daemon-backed companion options", () => {
  test("support stays available offline and opens only after an explicit action", async () => {
    const dataDir = await root();
    const destinations: string[] = [];
    const options = companionOptions(dataDir, async address => { destinations.push(address); });
    const signal = new AbortController().signal;
    const items = await v1(options, signal);
    expect(wire(items).get("product.support")).toBe(true);
    expect(destinations).toEqual([]);
    await options.onAction("unknown.action", signal);
    expect(destinations).toEqual([]);
    await options.onAction("product.support", signal);
    expect(destinations).toEqual(["https://account.hraness.com/support?product=message-like-me&source=desktop#support"]);
    expect(items.some(item => item.kind === "action" && item.id === "product.updates")).toBe(false);
  });
  test("snapshot maps a live owner daemon response and marks it fresh", async () => {
    const dataDir = await root();
    const daemon = await start(dataDir);
    const options = companionOptions(dataDir);
    const items = await v1(options, new AbortController().signal);
    wire(items);
    expect(items[0]).toMatchObject({ label: "◐ Getting started" });
    expect(labels(submenu(items, "Details").items)).toContain("Updated 0s ago");
    expect((await daemon.service.snapshot()).revision).toBe(1);
  });
  test("an unreachable daemon degrades to a bounded disconnected menu", async () => {
    const dataDir = await root();
    const options = companionOptions(dataDir);
    const items = await v1(options, new AbortController().signal);
    wire(items);
    expect(items[0]).toMatchObject({ label: "⊘ Textbutler isn't running" });
    expect(items.some(item => item.kind === "action" && item.id === "toggle-pause")).toBe(false);
    expect(action(items, "daemon.install").label).toBe("Start Textbutler at login");
    expect(labels(submenu(items, "Details").items)).toContain("Status not confirmed yet");
  });
  test("toggle-pause applies one revision-checked daemon mutation and never retries", async () => {
    const dataDir = await root();
    const daemon = await start(dataDir);
    const options = companionOptions(dataDir);
    const signal = new AbortController().signal;
    await v1(options, signal);
    expect((await daemon.service.snapshot()).settings.paused).toBe(true);
    await options.onAction("toggle-pause", signal);
    expect((await daemon.service.snapshot()).settings.paused).toBe(false);
    // A stale in-memory revision is rejected by the daemon, not retried.
    await expect(options.onAction("toggle-pause", signal)).rejects.toThrow("settings-update-conflict");
    expect((await daemon.service.snapshot()).settings.paused).toBe(false);
    await v1(options, signal); // the runner re-reads state after an action
    await options.onAction("toggle-pause", signal);
    expect((await daemon.service.snapshot()).settings.paused).toBe(true);
  });
});

describe("menubar CLI routing", () => {
  test("status reports the shared companion lifecycle, not a LaunchAgent", async () => {
    const dataDir = await root();
    const lines: string[] = [];
    // The kit renders human text on stdout; agents get the JSON status object.
    const prior = process.env.HRANESS_AUDIENCE;
    process.env.HRANESS_AUDIENCE = "agent";
    try {
      expect(await runTextbutlerCli(["menubar", "status", "--data-dir", dataDir], { write: text => lines.push(text) })).toBe(0);
    } finally {
      if (prior === undefined) delete process.env.HRANESS_AUDIENCE;
      else process.env.HRANESS_AUDIENCE = prior;
    }
    expect(JSON.parse(lines[0]!)).toMatchObject({ appId: "textbutler", running: false, state: "stopped" });
    expect(lines[0]).not.toContain("launchAgent");
  });
  test("unknown menubar verbs and extra arguments are rejected", async () => {
    await expect(runTextbutlerCli(["menubar", "bogus"], { write: () => {} })).rejects.toThrow();
    await expect(runTextbutlerCli(["menubar", "status", "extra"], { write: () => {} })).rejects.toThrow();
  });
});

test("fully populated menu stays within the native runner's total node budget", () => {
  const contacts = Array.from({ length: 20 }, (_, index) => ({ id: `contact-${index}`, name: `Contact ${index}`, subtitle: "Long relationship detail ".repeat(15),
    settings: { enabled: false, responseMode: "smart" as const, keyword: "butler", provider: "claude" as const, disclosure: { character: "🤖", begin: "{", end: "}" } } }));
  const accounts = Array.from({ length: 10 }, (_, index) => ({ id: `account-${index}`, label: `Account ${index}`, provider: "claude" as const, route: "claude-api" as const,
    status: "ready" as const, detail: "Long account diagnostic ".repeat(15), defaultReplyModel: "model", classifierModel: "model" }));
  const items = snapshotItems(base({ contacts, providerAccounts: accounts, messagingProviders: ["imessage", "whatsapp", "beeper"], replies: { scannedAt: "2026-09-19T00:00:00Z",
    pending: contacts.slice(0, 10).map(contact => ({ contactId: contact.id, name: contact.name, provider: "beeper", enabled: false, pendingCount: 2,
      lastInboundAt: "2026-09-19T00:00:00Z", preview: "long preview ".repeat(40), sendable: true, reason: null })),
    drafts: contacts.slice(0, 10).map(contact => ({ id: `draft:${contact.id}`, contactId: contact.id, name: contact.name, summary: "Reply", preview: "long draft ".repeat(40), actionCount: 3, expiresAt: "2026-09-19T01:00:00Z" })) },
    activity: Array.from({ length: 8 }, (_, index) => ({ id: `event-${index}`, at: "2026-09-19T00:00:00Z", contactId: null, title: "Activity", detail: "Long detail ".repeat(40) })) }),
    { confirmedAgeSeconds: 0, fresh: true });
  const actions = wire(items);
  expect(actions.get("toggle-pause")).toBe(true);
  expect(items.at(-1)?.kind).toBe("quit");
  expect(labels(items)).toContain("More in the guided terminal");
});

test("pending menu operations keep the job ID and a terminal failure clears the busy state", async () => {
  const calls: string[] = [], signal = new AbortController().signal;
  const options = companionOptions("/unused", async () => {}, "/unused/cli.ts", { jobWaitMs: 0, request: async request => {
    calls.push(request.command);
    if (request.command === "snapshot") return { protocol: "textbutler.control.v1", ok: true, kind: "snapshot", snapshot: base() };
    if (request.command === "owner.job.read") return { protocol: "textbutler.control.v1", ok: false, code: "conflict", message: "The contact changed." };
    return { protocol: "textbutler.control.v1", ok: true, kind: "job", jobId: "job-123" };
  } });
  await v1(options, signal);
  await expect(options.onAction("contacts.discover", signal)).rejects.toThrow("unconfirmed");
  const pending = await v1(options, signal);
  expect(action(pending, "job.refresh").label).toBe("↻ An action is still running · Check again");
  expect(JSON.stringify(pending)).not.toContain("job-123");
  await expect(options.onAction("contacts.discover", signal)).rejects.toThrow("previous-operation-pending");
  expect(calls.filter(command => command === "conversations.list")).toHaveLength(1);
  await options.onAction("job.refresh", signal);
  const settled = await v1(options, signal);
  expect(settled.some(item => item.kind === "action" && item.id === "job.refresh")).toBe(false);
  expect(labels(settled)[1]).toBe("⚠︎ The last action didn't finish · The contact changed.");
  // The result shows once: the next action clears it.
  await options.onAction("refresh", signal);
  expect(labels(await v1(options, signal))).not.toContain("⚠︎ The last action didn't finish · The contact changed.");
  await expect(options.onAction("contacts.discover", signal)).rejects.toThrow("unconfirmed");
  expect(calls.filter(command => command === "conversations.list")).toHaveLength(2);
});

describe("failed menu actions (T6)", () => {
  const signal = new AbortController().signal;
  function fake(respond: (command: string) => unknown) {
    let clock = 1_000_000;
    const options = companionOptions("/unused", async () => { throw new Error("no browser at /secret/path"); }, "/unused/cli.ts", { jobWaitMs: 0, now: () => clock,
      request: async request => (request.command === "snapshot"
        ? { protocol: "textbutler.control.v1", ok: true, kind: "snapshot", snapshot: base({ messagingProviders: ["imessage"] }) }
        : respond(request.command)) as never });
    return { options, advance: (ms: number) => { clock += ms; } };
  }
  test("a daemon refusal shows a ⚠︎ row with its plain sentence until the next action", async () => {
    const { options } = fake(() => ({ protocol: "textbutler.control.v1", ok: false, code: "unavailable",
      message: "Textbutler can't read your Messages: macOS access is off for Textbutler." }));
    await v1(options, signal);
    await expect(options.onAction("messaging.start:imessage", signal)).rejects.toThrow("messaging-connection-unconfirmed");
    const items = await v1(options, signal);
    wire(items);
    expect(labels(items).slice(0, 2)).toEqual(["◐ Getting started",
      "⚠︎ Couldn't connect iMessage · Textbutler can't read your Messages: macOS access is off for Textbutler."]);
    await options.onAction("refresh", signal);
    expect(labels(await v1(options, signal)).some(label => label.startsWith("⚠︎"))).toBe(false);
  });
  test("the row goes away at the first refresh after thirty seconds", async () => {
    const { options, advance } = fake(() => ({ protocol: "textbutler.control.v1", ok: false, code: "unavailable", message: "No automation." }));
    await v1(options, signal);
    await expect(options.onAction("replies.scan", signal)).rejects.toThrow("replies-scan-unconfirmed");
    advance(ACTION_ERROR_MS - 1);
    expect(labels(await v1(options, signal))).toContain("⚠︎ Couldn't check for replies · No automation.");
    advance(1);
    expect(labels(await v1(options, signal)).some(label => label.startsWith("⚠︎"))).toBe(false);
  });
  test("a job that is still running shows the pending row, not a ⚠︎ row", async () => {
    const { options } = fake(() => ({ protocol: "textbutler.control.v1", ok: true, kind: "job", jobId: "job-9" }));
    await v1(options, signal);
    await expect(options.onAction("replies.scan", signal)).rejects.toThrow("replies-scan-unconfirmed");
    const shown = labels(await v1(options, signal));
    expect(shown).toContain("↻ An action is still running · Check again");
    expect(shown.some(label => label.startsWith("⚠︎"))).toBe(false);
  });
  test("unexpected errors never show their own text", async () => {
    const { options } = fake(() => ({}));
    await v1(options, signal);
    await expect(options.onAction("open-website", signal)).rejects.toThrow("open-failed");
    const shown = labels(await v1(options, signal));
    expect(shown).toContain("⚠︎ Couldn't open the page · Check your default browser, then try again.");
    expect(shown.join("\n")).not.toContain("/secret/path");
    expect(describeMenuFailure(new Error("ENOENT /var/private/x"))).toEqual({ sentence: "That didn't work",
      detail: "Try again. Setup & readiness in the guided terminal shows what's missing." });
    expect(describeMenuFailure(new MenuPending("x"))).toBeNull();
    expect(describeMenuFailure(new MenuFailure("code", "Couldn't do it"))).toEqual({ sentence: "Couldn't do it" });
  });
  test("every failure row is short, sentence case and free of codes", async () => {
    const sentences = [...(await Bun.file(new URL("./menubar.ts", import.meta.url)).text()).matchAll(/new MenuFailure\([^,]+, "([^"]+)"/gu), 
      ...(await Bun.file(new URL("./menubar.ts", import.meta.url)).text()).matchAll(/unconfirmed\(response, "[^"]+", "([^"]+)"\)/gu)].map(match => match[1]!);
    expect(sentences.length).toBeGreaterThan(8);
    expect(sentences).toMatchSnapshot();
    for (const sentence of sentences) {
      expect([...sentence].length).toBeLessThanOrEqual(48);
      expect(sentence).not.toMatch(/[.…]$|\b[a-z]+-[a-z]+-|\//u); // no final period, kebab code or path
      expect(sentence.slice(1).replace(/System Settings|Messages|iMessage|WhatsApp|Beeper|Textbutler/gu, "")).not.toMatch(/ [A-Z]/u); // sentence case
    }
  });
});

describe("Quit Textbutler ends the menu process", () => {
  test("the foreground menu exits once the runner closes, even with a daemon wait still open", async () => {
    const exits: number[] = [];
    const code = await runMenuBarCommand(["--foreground"], "/unused", "/unused/cli.ts", () => {}, { handle: async () => 0, exit: value => { exits.push(value); } });
    expect(code).toBe(0);
    await Bun.sleep(1_100);
    expect(exits).toEqual([0]);
  });
  test("lifecycle verbs return normally and never exit the caller", async () => {
    const exits: number[] = [];
    for (const verb of ["start", "stop", "status", "install"]) {
      await runMenuBarCommand([verb], "/unused", "/unused/cli.ts", () => {}, { handle: async () => 0, exit: value => { exits.push(value); } });
    }
    await Bun.sleep(1_100);
    expect(exits).toEqual([]);
  });
  test("the exit timer never holds the process open by itself", () => {
    const child = Bun.spawnSync([process.execPath, "-e", `import(${JSON.stringify(new URL("./menubar.ts", import.meta.url).href)}).then(m => { m.exitSoon(0, () => { console.log("forced"); process.exit(7); }, 60_000); console.log("done"); })`]);
    expect(child.stdout.toString().trim()).toBe("done");
    expect(child.exitCode).toBe(0);
    let fired = false;
    exitSoon(3, () => { fired = true; }, 0);
    return Bun.sleep(10).then(() => expect(fired).toBe(true));
  });
});

describe("menu through TextButler.app (T7)", () => {
  const identity = { appPath: "/Volumes/Owner/Applications/TextButler.app" } as import("./macos-app.ts").MacosAppIdentity;
  test("the switch is off unless HRANESS_LOCAL_APP=1", async () => {
    expect(localAppEnabled({})).toBe(false);
    expect(localAppEnabled({ HRANESS_LOCAL_APP: "true" })).toBe(false);
    expect(localAppEnabled({ HRANESS_LOCAL_APP: "1" })).toBe(true);
    let reads = 0;
    const read = async () => { reads++; return identity; };
    expect(await menuApp("/data", "/cli.ts", { env: {}, read })).toBeNull();
    expect(reads).toBe(0);
    expect(await menuApp("/data", "/cli.ts", { env: { HRANESS_LOCAL_APP: "1" }, read })).toBe(identity);
    expect(await menuApp("/data", "/cli.ts", { env: { HRANESS_LOCAL_APP: "1" }, read: async () => null })).toBeNull();
    // An app built from another version is an error, never a silent Bun login item.
    await expect(menuApp("/data", "/cli.ts", { env: { HRANESS_LOCAL_APP: "1" }, read: async () => { throw new Error("receipt mismatch"); } })).rejects.toThrow("TextButler.app was built from a different Textbutler version");
  });
  test("with a verified app, start and login run the app's menu role with no arguments", async () => {
    expect(companionForeground("/data", "/cli.ts", { home: "/home", runtime: "/bun" }, identity))
      .toEqual({ executable: "/Volumes/Owner/Applications/TextButler.app/Contents/MacOS/TextButler", args: [] });
    const seen: { executable: string; args: readonly string[] }[] = [];
    await runMenuBarCommand(["install"], "/data", "/cli.ts", () => {}, { app: async () => identity,
      handle: async (_options, invocation) => { seen.push(invocation.foreground!); return 0; } });
    expect(seen[0]!.executable).toEndWith("/TextButler.app/Contents/MacOS/TextButler");
  });
  test("only start and install look up the app; its own foreground run never relaunches it", async () => {
    let asked = false;
    for (const verb of ["stop", "status"]) await runMenuBarCommand([verb], "/data", "/cli.ts", () => {}, { app: async () => { asked = true; return identity; }, handle: async () => 0 });
    await runMenuBarCommand(["--foreground"], "/data", "/cli.ts", () => {}, { app: async () => { asked = true; return identity; },
      handle: async (_options, invocation) => { expect(invocation.foreground!.args).toContain("--foreground"); return 0; }, exit: () => {} });
    expect(asked).toBe(false);
  });
});
