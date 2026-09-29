import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandsJson, type CliIO } from "@hraness/desktop-foundation/registry";
import { renderSnapshot } from "@hraness/desktop-foundation/tui";
import { CONTROL_PROTOCOL, type ControlRequest, type ControlResponse, type DesktopSnapshot, type ReplyDraftDetail } from "../../control/src/index.ts";
import { digestOf, GRAMMAR_FAMILIES, legacyLoginItems, LEGACY_MENU_LOGIN_ITEM, PRODUCT_VERBS, runGrammar, STATUS_VIEWS, statusFromSnapshot, textbutlerRegistry, type GrammarDeps } from "./grammar.ts";
import type { LaunchAgentLifecycle, LaunchAgentStatus } from "./launch-agent.ts";
import type { Readiness } from "./onboarding.ts";

const AT = new Date("2026-09-29T12:00:00.000Z");
const DIGEST = "d".repeat(64);

// ── Fixture states: every state the retired menu bar showed ─────────────────
function base(): DesktopSnapshot {
  return { protocol: CONTROL_PROTOCOL, revision: 7, connection: "connected", detail: "Synthetic owner state",
    settings: { paused: false, activeContactLimit: 5 }, contacts: [], capabilities: [], activity: [],
    automation: { state: "running", detail: "Automatic replies are running." }, messagingProviders: [] };
}
const contact = (id: string, name: string, enabled: boolean, responseMode: "smart" | "keyword" = "smart") => ({ id, name, subtitle: "Synthetic contact",
  settings: { enabled, responseMode, keyword: "butler", provider: "claude" as const, accountId: "owner-api", disclosure: { character: "🤖", begin: "{", end: "}" } } });
function populated(): DesktopSnapshot {
  return { ...base(), messagingProviders: ["imessage", "whatsapp", "beeper"],
    contacts: [contact("contact-1", "Alice Example", true), contact("contact-2", "Bob ‮evil‬ Example", false, "keyword"),
      contact("contact-3", "A very long synthetic contact name that must be cut to fit its column", true)],
    providerAccounts: [{ id: "owner-api", label: "Owner API", provider: "claude", route: "claude-api", status: "ready", detail: "Synthetic", defaultReplyModel: "m", classifierModel: null }],
    replies: { scannedAt: "2026-09-29T11:58:00.000Z",
      pending: [{ contactId: "contact-1", name: "Alice Example", provider: "imessage", enabled: true, pendingCount: 2, lastInboundAt: "2026-09-29T11:57:00.000Z", preview: "hi", sendable: true, reason: null }],
      drafts: [{ id: "draft-1", contactId: "contact-1", name: "Alice Example", summary: "Say yes to dinner\nat eight", preview: "Yes!", actionCount: 1, expiresAt: "2026-09-29T12:30:00.000Z" }] },
    activity: [{ id: "a1", at: "2026-09-29T11:59:00.000Z", contactId: "contact-1", title: "Reply sent", detail: "Alice Example" }] };
}
const FIXTURES: Record<string, DesktopSnapshot | null> = {
  stopped: null,
  "running-empty": base(),
  paused: { ...base(), settings: { paused: true, activeContactLimit: 5 }, automation: { state: "paused", detail: "Paused." } },
  "access-needed": { ...base(), automation: { state: "unavailable", detail: "Full Disk Access is needed." } },
  populated: populated(),
};

function login(installation: LaunchAgentStatus["installation"] = "absent"): LaunchAgentStatus {
  return { installation, service: installation === "installed" ? "running" : "absent", detail: installation } as LaunchAgentStatus;
}
type Harness = { deps: GrammarDeps; calls: ControlRequest[]; lifecycle: string[]; served: number };
function harness(state: DesktopSnapshot | null, respond?: (request: ControlRequest) => ControlResponse | undefined): Harness {
  const h: Harness = { calls: [], lifecycle: [], served: 0, deps: undefined as never };
  const agent = { status: async () => login(), install: async () => { h.lifecycle.push("install"); return login("installed"); }, uninstall: async () => { h.lifecycle.push("uninstall"); return login(); } } as unknown as LaunchAgentLifecycle;
  h.deps = {
    dataDir: "/nonexistent/textbutler", now: () => AT, home: "/nonexistent/home", stdoutIsTerminal: false,
    request: async request => {
      h.calls.push(request);
      if (state === null) throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
      const custom = respond?.(request);
      if (custom) return custom;
      if (request.command === "snapshot") return { protocol: CONTROL_PROTOCOL, ok: true, kind: "snapshot", snapshot: state };
      throw new Error(`unexpected ${request.command}`);
    },
    awaitJob: request => h.deps.request(request),
    launchAgent: () => agent,
    readiness: async () => ({ ok: true, steps: [] } as unknown as Readiness),
    readinessText: () => "ready\n",
    serve: async () => { h.served += 1; return 0; },
    interactiveTui: async () => { throw new Error("no terminal in tests"); },
  };
  return h;
}
function io(extra: Partial<CliIO> = {}): CliIO & { out: () => string; err: () => string } {
  let out = "", err = "";
  return { stdout: { write: (text: string) => { out += text; } }, stderr: { write: (text: string) => { err += text; } },
    env: {}, audience: "agent", ...extra, out: () => out, err: () => err };
}
const run = async (h: Harness, argv: string[], extra: Partial<CliIO> = {}) => {
  const sink = io(extra);
  const code = await runGrammar(argv, false, h.deps, sink);
  // generatedAt is the only field that varies between runs (plan § 8.2).
  return { code, out: sink.out(), err: sink.err(), json: (): Record<string, any> => ({ ...JSON.parse(sink.out()) as Record<string, any>, generatedAt: "<generatedAt>" }) };
};
const mutations = (h: Harness) => h.calls.filter(call => call.command !== "snapshot" && call.command !== "replies.draft.read");

// ── TUI goldens (plan § 8.2) ────────────────────────────────────────────────
describe("tui goldens for every former menu bar state", () => {
  for (const [name, state] of Object.entries(FIXTURES)) {
    for (const width of [40, 80, 120]) {
      test(`${name} snapshot at ${width} columns`, async () => {
        const result = await run(harness(state), ["tui", "--snapshot", "--width", String(width)]);
        expect(result.code).toBe(0);
        for (const line of result.out.split("\n")) expect([...line].length).toBeLessThanOrEqual(width);
        expect(result.out).not.toMatch(/[‪-‮⁦-⁩]/u);
        expect(result.out).toMatchSnapshot();
      });
    }
    test(`${name} tui --json equals status --json`, async () => {
      const tui = await run(harness(state), ["tui", "--json"]);
      const status = await run(harness(state), ["status", "--json"]);
      expect(tui.code).toBe(0);
      expect(tui.json()).toEqual(status.json());
      expect(tui.json()).toMatchSnapshot();
    });
  }
  test("the status text is the first snapshot view", () => {
    const state = statusFromSnapshot(populated());
    expect(renderSnapshot(STATUS_VIEWS, state)).toContain(renderSnapshot(STATUS_VIEWS.slice(0, 1), state).trimEnd());
  });
});

// ── Registry (plan § 8.3) ───────────────────────────────────────────────────
describe("commands --json", () => {
  test("every verb has an op class and every decide verb has a gate", async () => {
    const h = harness(null);
    const registry = textbutlerRegistry(h.deps);
    const contract = JSON.parse(await readFile(join(import.meta.dir, "../../../node_modules/@hraness/desktop-foundation/contract/op-classes.json"), "utf8")) as unknown;
    const classes = new Set(JSON.stringify(contract).match(/"(read|operate|decide|decide-legacy)"/gu)!.map(value => value.slice(1, -1)));
    const listed = commandsJson(registry, AT);
    expect(listed.ok).toBe(true);
    for (const verb of registry.verbs) {
      expect(classes.has(verb.opClass)).toBe(true);
      if (verb.opClass === "decide") expect(verb.gate).toBeDefined();
    }
    const result = await run(h, ["commands", "--json"]);
    expect(result.code).toBe(0);
    expect(result.json().schema).toBe("hraness.commands/1");
    expect(result.json()).toMatchSnapshot();
  });
  test("replies send stays decide-legacy and the product verbs are all listed", () => {
    const paths = PRODUCT_VERBS.map(verb => verb.path.join(" "));
    expect(PRODUCT_VERBS.find(verb => verb.path.join(" ") === "replies send")!.opClass).toBe("decide-legacy");
    expect(new Set(paths).size).toBe(paths.length);
    for (const family of GRAMMAR_FAMILIES) expect(paths.some(path => path.split(" ")[0] === family)).toBe(false);
  });
  test("docs/cli-parity.md names every former menu action and every registry verb", async () => {
    const doc = await readFile(join(import.meta.dir, "../../../docs/textbutler/cli-parity.md"), "utf8");
    for (const verb of textbutlerRegistry(harness(null).deps).verbs) expect(doc).toContain(`\`${verb.path.join(" ")}`);
  });
});

// ── Human gates (plan § 8.4) ────────────────────────────────────────────────
const DECIDE_ARGV: string[][] = [
  ["control", "install"], ["control", "uninstall"],
  // The older names take the same gate, so they are no way around it.
  ["daemon", "install"], ["daemon", "uninstall"],
  ["approvals", "decide", "draft-1", "--digest", DIGEST, "allow-once"],
  ["permissions", "set", "Alice Example", "--expected-revision", "7", "loosen"],
];
describe("human gates", () => {
  for (const argv of DECIDE_ARGV) {
    test(`${argv.slice(0, 2).join(" ")} refuses an agent with human-required and changes nothing`, async () => {
      const h = harness(populated());
      const result = await run(h, [...argv, "--json"], { env: { CLAUDECODE: "1", PATH: "", HOME: "/nonexistent/home" } });
      expect(result.code).toBe(3);
      expect(result.json().error.code).toBe("human-required");
      expect(mutations(h)).toEqual([]);
      expect(h.lifecycle).toEqual([]);
    });
  }
  test("deny and tighten run without a person", async () => {
    const draft: ReplyDraftDetail = { id: "draft-1", contactId: "contact-1", name: "Alice Example", provider: "imessage", conversationId: "c", summary: "s", actions: [{ kind: "text", text: "hi" }], assets: [], digest: DIGEST, expiresAt: "2026-09-29T12:30:00.000Z" };
    const h = harness(populated(), request => {
      if (request.command === "replies.draft.read") return { protocol: CONTROL_PROTOCOL, ok: true, kind: "reply-draft", draft };
      if (request.command === "replies.discard") return { protocol: CONTROL_PROTOCOL, ok: true, kind: "reply-discarded", discarded: true } as ControlResponse;
      if (request.command === "contact.settings.update") return { protocol: CONTROL_PROTOCOL, ok: true, kind: "snapshot", snapshot: { ...populated(), revision: 8 } };
      return undefined;
    });
    const deny = await run(h, ["approvals", "decide", "draft-1", "--digest", DIGEST, "deny", "--json"], { env: { CLAUDECODE: "1" } });
    expect(deny.code).toBe(0);
    expect(deny.json().data).toEqual({ decision: "deny", discarded: true });
    const tighten = await run(h, ["permissions", "set", "Alice Example", "--expected-revision", "7", "tighten", "--json"], { env: { CLAUDECODE: "1" } });
    expect(tighten.code).toBe(0);
    expect(tighten.json().data).toEqual({ contactId: "contact-1", automaticReplies: "off", state: "applied", revision: 8 });
    expect(mutations(h).map(call => call.command)).toEqual(["replies.discard", "contact.settings.update"]);
    expect((mutations(h)[1] as { settings: { enabled: boolean } }).settings.enabled).toBe(false);
  });
  test("a gated allow-once re-checks the digest before it sends", async () => {
    const draft = { id: "draft-1", contactId: "contact-1", name: "Alice", provider: "imessage", conversationId: "c", summary: "s", actions: [], assets: [], digest: "e".repeat(64), expiresAt: "x" } as ReplyDraftDetail;
    const h = harness(populated(), request => request.command === "replies.draft.read" ? { protocol: CONTROL_PROTOCOL, ok: true, kind: "reply-draft", draft } : undefined);
    const passed = (async () => ({ ok: true, tier: "T1T2" })) as unknown as NonNullable<CliIO["gate"]>;
    const result = await run(h, ["approvals", "decide", "draft-1", "--digest", DIGEST, "allow-once", "--json"], { audience: "human", gate: passed });
    expect(result.json().error?.code).toBe("digest-mismatch");
    expect(mutations(h)).toEqual([]);
  });
  test("a person who passes the gate installs the login item", async () => {
    const h = harness(null);
    const passed = (async () => ({ ok: true, tier: "T1T2" })) as unknown as NonNullable<CliIO["gate"]>;
    const result = await run(h, ["control", "install", "--json"], { audience: "human", gate: passed });
    expect(result.code).toBe(0);
    expect(h.lifecycle).toEqual(["install"]);
  });
  test("a loosen that is still running is reported pending, not applied", async () => {
    const h = harness(populated(), request => request.command === "contact.settings.update" ? { protocol: CONTROL_PROTOCOL, ok: true, kind: "job", jobId: "job-1" } as ControlResponse : undefined);
    const passed = (async () => ({ ok: true, tier: "T1T2" })) as unknown as NonNullable<CliIO["gate"]>;
    const result = await run(h, ["permissions", "set", "Alice Example", "--expected-revision", "7", "loosen", "--json"], { audience: "human", gate: passed });
    expect(result.code).toBe(0);
    expect(result.json().data).toEqual({ contactId: "contact-1", automaticReplies: "on", state: "pending", jobId: "job-1", nextCommand: ["textbutler", "jobs", "show", "job-1"] });
    expect((mutations(h)[0] as { settings: { enabled: boolean } }).settings.enabled).toBe(true);
  });
  test("a lost answer after allow-once is indeterminate, never a retry invitation", async () => {
    const draft = { id: "draft-1", contactId: "contact-1", name: "Alice", provider: "imessage", conversationId: "c", summary: "s", actions: [], assets: [], digest: DIGEST, expiresAt: "x" } as ReplyDraftDetail;
    const h = harness(populated(), request => request.command === "replies.draft.read" ? { protocol: CONTROL_PROTOCOL, ok: true, kind: "reply-draft", draft } : undefined);
    h.deps.awaitJob = async request => { h.calls.push(request); throw new Error("Control request timed out."); };
    const passed = (async () => ({ ok: true, tier: "T1T2" })) as unknown as NonNullable<CliIO["gate"]>;
    const result = await run(h, ["approvals", "decide", "draft-1", "--digest", DIGEST, "allow-once", "--json"], { audience: "human", gate: passed });
    expect(result.code).toBe(1);
    expect(result.json().error.code).toBe("textbutler.indeterminate");
    expect(mutations(h).map(call => call.command)).toEqual(["replies.send"]);
  });
  test("permissions set refuses a stale revision", async () => {
    const h = harness(populated());
    const result = await run(h, ["permissions", "set", "Alice Example", "--expected-revision", "6", "tighten", "--json"]);
    expect(result.code).toBe(5);
    expect(result.json().error.code).toBe("conflict");
    expect(mutations(h)).toEqual([]);
  });
});

// ── Owner verbs (plan § 8.5) ────────────────────────────────────────────────
describe("control", () => {
  test("a second control serve reports control-already-running and does not start", async () => {
    const h = harness(base());
    const result = await run(h, ["control", "serve", "--json"]);
    expect(result.code).toBe(5);
    expect(result.json().error.code).toBe("control-already-running");
    expect(h.served).toBe(0);
  });
  test("a custody refusal maps to control-already-running", async () => {
    const h = harness(null);
    h.deps.serve = async () => { throw new Error("A Textbutler daemon or lifecycle owner already exists."); };
    const result = await run(h, ["control", "serve", "--json"]);
    expect(result.json().error.code).toBe("control-already-running");
  });
  test("control serve starts the owner when none answers", async () => {
    const h = harness(null);
    expect((await run(h, ["control", "serve"])).code).toBe(0);
    expect(h.served).toBe(1);
  });
  test("control stop asks the owner over its socket", async () => {
    const h = harness(base(), request => request.command === "owner.stop" ? { protocol: CONTROL_PROTOCOL, ok: true, kind: "stopping" } as ControlResponse : undefined);
    const result = await run(h, ["control", "stop", "--json"]);
    expect(result.json().data).toEqual({ state: "stopping" });
    expect(h.calls.map(call => call.command)).toEqual(["owner.stop"]);
  });
  test("control stop with no socket reports not running", async () => {
    const result = await run(harness(null), ["control", "stop", "--json"]);
    expect(result.code).toBe(0);
    expect(result.json().data).toEqual({ state: "not-running" });
  });
  test("control stop that times out does not claim the service stopped", async () => {
    const h = harness(base());
    h.deps.request = async () => { throw new Error("Control request timed out."); };
    const result = await run(h, ["control", "stop", "--json"]);
    expect(result.code).toBe(4);
    expect(result.json().error.code).toBe("owner-unavailable");
  });
  test("control status only reads", async () => {
    const h = harness(null);
    const result = await run(h, ["control", "status", "--json"]);
    expect(result.code).toBe(0);
    expect(result.json().data).toEqual({ state: "stopped", automaticReplies: "unavailable", loginItem: { installation: "absent", service: "absent", detail: "absent" } });
    expect(h.lifecycle).toEqual([]);
  });
  test("owner-only verbs report owner-unavailable when nothing answers", async () => {
    const result = await run(harness(null), ["approvals", "list", "--json"]);
    expect(result.code).toBe(4);
    expect(result.json().error.code).toBe("owner-unavailable");
  });
});

// ── Legacy login item report (read-only) ────────────────────────────────────
describe("doctor legacy login items", () => {
  test("reports the retired menu login item without touching it", async () => {
    const home = await mkdtemp(join(tmpdir(), "tb-grammar-"));
    try {
      const agents = join(home, "Library", "LaunchAgents");
      await mkdir(agents, { recursive: true });
      expect(await legacyLoginItems(home)).toEqual([]);
      await writeFile(join(agents, `${LEGACY_MENU_LOGIN_ITEM}.plist`), "<plist/>");
      await symlink("/nonexistent", join(agents, "other.plist"));
      expect(await legacyLoginItems(home)).toEqual([{ label: LEGACY_MENU_LOGIN_ITEM, state: "present" }]);
      expect((await readdir(agents)).sort()).toEqual([`${LEGACY_MENU_LOGIN_ITEM}.plist`, "other.plist"]);
    } finally { await rm(home, { recursive: true, force: true }); }
  });
  test("doctor --json exits 0 with readiness in data.ok and the next setup step", async () => {
    const h = harness(null);
    h.deps.readiness = async () => ({ ok: false, platform: "darwin", dataDir: "/x", initialized: false, daemonConnected: false, automaticReplies: "unavailable",
      canReviewInbox: false, canGenerateReplies: false, snapshot: null,
      steps: [{ id: "done", title: "Done", status: "done", detail: "", command: "textbutler nope" }, { id: "configuration", title: "Private settings", status: "action-needed", detail: "", command: "textbutler setup" }] });
    const result = await run(h, ["doctor", "--json"]);
    expect(result.code).toBe(0);
    const json = result.json();
    expect(json).toMatchObject({ ok: true, schema: "textbutler.readiness/1", data: { ok: false, legacyLoginItems: [] } });
    expect(json.data.dataDir).toBeUndefined();
    expect(json.next).toEqual([{ command: "textbutler setup", why: "Private settings", audience: "human" }]);
    const ready = await run(harness(null), ["doctor", "--json"]);
    expect(ready.code).toBe(0);
    expect(ready.json().next).toBeUndefined();
  });
  test("digests are stable", () => {
    expect(digestOf({ a: 1 })).toBe(digestOf({ a: 1 }));
    expect(digestOf({ a: 1 })).toMatch(/^[0-9a-f]{64}$/u);
  });
});
