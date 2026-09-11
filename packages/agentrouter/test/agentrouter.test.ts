import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentRouter, CONTACT_TOOL_PROFILE, SqliteAccountLeases, createProviderLaunchPlan,
  createToolBroker, parseClassification, publicHttpsUrl, relativeFile, selectClassifierModel,
  unqualifiedAdapter, type AgentAdapter, type RuntimeQualification, type ToolBroker,
} from "../src/index.ts";

const tempDirectories: string[] = [];
afterEach(() => { for (const path of tempDirectories.splice(0)) rmSync(path, { recursive: true, force: true }); });

function broker(overrides: Partial<Parameters<typeof createToolBroker>[0]> = {}): ToolBroker {
  return createToolBroker({ workspaceId: "contact-one", runId: "run-one", isActive: () => true,
    files: { read: async () => ({ text: "hello", revision: "v1" }), write: async () => ({ revision: "v2" }) },
    web: { fetchPublic: async (url) => ({ text: "public", url }) },
    messaging: { stage: async () => ({ intentId: "receipt-1" }) }, ...overrides });
}

const model = (id: string, input: number, output: number) => ({ id, inputUsdPerMillion: input,
  outputUsdPerMillion: output, supportsStructuredOutput: true, available: true, classifierEligible: true });

describe("classification", () => {
  test("selects the cheapest eligible observed model, not a provider's expensive preset", () => {
    const selected = selectClassifierModel({ provider: "claude", observedAt: 100,
      models: [{ ...model("not-available", 0, 0), available: false }, model("large", 10, 50), model("small", 1, 5)] }, 200);
    expect(selected.id).toBe("small");
  });
  test("refuses stale catalogs, unknown availability and unusable providers", () => {
    expect(() => selectClassifierModel({ provider: "codex", observedAt: 1, models: [model("small", 1, 2)] }, 86_400_002)).toThrow("STALE");
    expect(() => selectClassifierModel({ provider: "codex", observedAt: 1, models: [{ ...model("small", 1, 2), available: null }] }, 2)).toThrow("CAPABILITY");
    expect(() => selectClassifierModel({ provider: "unknown", observedAt: 1, models: [] }, 2)).toThrow("PROVIDER");
    expect(() => selectClassifierModel({ provider: "codex", observedAt: 1, models: [] }, 2)).toThrow("NO_CLASSIFIER_MODEL");
  });
  test("rejects injected fields, prose and contradictory classifications", () => {
    expect(parseClassification('{"respond":false,"confidence":0.9,"reason":"human_active"}')).toEqual({ respond: false, confidence: 0.9, reason: "human_active" });
    expect(() => parseClassification({ respond: true, confidence: 1, reason: "human_active" })).toThrow("CONTRADICTORY");
    expect(() => parseClassification({ respond: true, confidence: 1, reason: "helpful", command: "send" })).toThrow("UNKNOWN_FIELD");
    expect(() => parseClassification('```json\n{"respond":true}\n```')).toThrow();
  });
});

describe("shared account custody", () => {
  test("separate connections cannot acquire one account, even after heartbeat expiry", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentrouter-")); tempDirectories.push(dir);
    const a = new Database(join(dir, "leases.db")), b = new Database(join(dir, "leases.db"));
    try {
      const first = new SqliteAccountLeases(a), second = new SqliteAccountLeases(b);
      const lease = first.acquire({ provider: "codex", accountId: "shared", owner: "textbutler", now: 10, ttlMs: 1000 });
      expect(() => second.acquire({ provider: "codex", accountId: "shared", owner: "other-app", now: 10_000, ttlMs: 1000 })).toThrow("RECOVERY_REQUIRED");
      expect(first.release(lease)).toBe(true);
      const next = second.acquire({ provider: "codex", accountId: "shared", owner: "other-app", now: 10_000, ttlMs: 1000 });
      expect(next.generation).toBe(2);
      expect(first.release(lease)).toBe(false);
      expect(() => first.renew(lease, 10_001, 1000)).toThrow("STALE");
    } finally { a.close(); b.close(); }
  });
  test("recovery requires independent stopped-process evidence and exact lease", async () => {
    const db = new Database(":memory:");
    try {
      const leases = new SqliteAccountLeases(db);
      const lease = leases.acquire({ provider: "claude", accountId: "shared", owner: "worker", now: 0, ttlMs: 1000 });
      await expect(leases.recover(lease, async () => false)).rejects.toThrow("UNPROVEN");
      expect(leases.inspect("claude", "shared")).toEqual(lease);
      expect(await leases.recover(lease, async () => true)).toBe(true);
    } finally { db.close(); }
  });
});

describe("tool broker", () => {
  test("denies command tools and cannot be redirected to another contact", async () => {
    const received: unknown[] = [];
    const toolBroker = broker({ messaging: { stage: async (...args) => { received.push(args.slice(0, 3)); return { intentId: "r1" }; } } });
    await expect(toolBroker.invoke("exec", { command: "cat /etc/passwd" })).rejects.toThrow("TOOL_DENIED");
    await expect(toolBroker.invoke("messages.propose_text", { text: "hello", idempotencyKey: "key", workspaceId: "other" })).rejects.toThrow("UNKNOWN_FIELD");
    await toolBroker.invoke("messages.propose_text", { text: "hello", idempotencyKey: "key" });
    expect(received).toEqual([["contact-one", "run-one", { kind: "text", text: "hello", idempotencyKey: "key" }]]);
  });
  test("forwards conditional writes with its fixed workspace and rejects traversal", async () => {
    const received: unknown[] = [];
    const toolBroker = broker({ files: { read: async () => ({ text: "", revision: "v1" }),
      write: async (...args) => { received.push(args.slice(0, 4)); return { revision: "v2" }; } } });
    for (const path of ["../sibling/notes.md", "/etc/passwd", "notes/../../x", ".codex/config.toml", "notes\\escape", "notes//x"]) {
      await expect(toolBroker.invoke("files.write", { path, text: "x", expectedRevision: null })).rejects.toThrow("PATH_OUTSIDE");
    }
    await toolBroker.invoke("files.write", { path: "notes/context.md", text: "x", expectedRevision: "v1" });
    expect(received).toEqual([["contact-one", "notes/context.md", "x", "v1"]]);
    expect(relativeFile("notes/café.md")).toBe("notes/café.md");
  });
  test("bounds public requests and rejects local URLs before host dispatch", async () => {
    for (const url of ["http://example.com", "https://localhost", "https://127.0.0.1", "https://2130706433", "https://[::1]", "https://printer.local", "https://a:b@example.com", "https://example.com:8443"]) {
      expect(() => publicHttpsUrl(url)).toThrow();
    }
    await expect(broker().invoke("web.fetch", { url: "https://example.com", maxBytes: 999999 })).rejects.toThrow("INTEGER");
  });
  test("revocation stops queued calls and prevents returning private reads", async () => {
    let resolveRead!: () => void;
    const blocked = new Promise<void>((resolve) => { resolveRead = resolve; });
    let writes = 0;
    const toolBroker = broker({ files: { read: async () => { await blocked; return { text: "private", revision: "v1" }; },
      write: async () => { writes += 1; return { revision: "v2" }; } } });
    const reading = toolBroker.invoke("files.read", { path: "memory.md" });
    const writing = toolBroker.invoke("files.write", { path: "memory.md", text: "x", expectedRevision: "v1" });
    toolBroker.revoke(); resolveRead();
    await expect(reading).rejects.toThrow("RUN_REVOKED");
    await expect(writing).rejects.toThrow("RUN_REVOKED");
    expect(writes).toBe(0);
  });
  test("queued input cannot be changed after its invocation", async () => {
    const received: string[] = [];
    const toolBroker = broker({ files: {
      read: async (_workspaceId, path) => { received.push(path); return { text: "", revision: "v1" }; },
      write: async () => ({ revision: "v2" }),
    } });
    const input = { path: "memory.md" };
    const reading = toolBroker.invoke("files.read", input);
    input.path = "another.md";
    await reading;
    expect(received).toEqual(["memory.md"]);
  });
});

const qualification: RuntimeQualification = { status: "qualified", profile: CONTACT_TOOL_PROFILE,
  runtimeVersion: "synthetic-test", runtimeDigest: "a".repeat(64), evidenceDigest: "b".repeat(64), expiresAt: 100_000,
  controls: { noCommandTools: true, exactToolInventory: true, contactReadIsolation: true, contactWriteIsolation: true,
    isolatedConfiguration: true, authOutsideWorkspace: true, hostBrokerOnly: true } };
const request = { runId: "run-one", provider: "codex" as const, accountId: "shared", workspaceId: "contact-one",
  prompt: "Synthetic message", model: "synthetic-model", purpose: "respond" as const, signal: new AbortController().signal };

describe("routing qualification", () => {
  test("both bundled provider adapters refuse execution before account custody", async () => {
    const db = new Database(":memory:");
    try {
      const leases = new SqliteAccountLeases(db);
      const router = new AgentRouter({ adapters: [unqualifiedAdapter("codex"), unqualifiedAdapter("claude")], leases, now: () => 100 });
      for (const provider of ["codex", "claude"] as const) {
        const tools = broker();
        await expect(router.run({ ...request, provider }, tools)).rejects.toThrow("PROVIDER_UNQUALIFIED");
        await expect(tools.invoke("files.read", { path: "memory.md" })).rejects.toThrow("RUN_REVOKED");
        expect(leases.inspect(provider, "shared")).toBeNull();
      }
      expect(createProviderLaunchPlan({ provider: "claude", accountId: "shared", authBindingId: "opaque-1" }, "contact-one").status).toBe("unqualified");
    } finally { db.close(); }
  });
  test("rejects a broker for another contact before dispatch", async () => {
    const db = new Database(":memory:");
    try {
      let ran = false;
      const adapter: AgentAdapter = { provider: "codex", qualification, run: async () => { ran = true; return { output: "", processStopped: true }; } };
      const router = new AgentRouter({ adapters: [adapter], leases: new SqliteAccountLeases(db), now: () => 100 });
      await expect(router.run(request, broker({ workspaceId: "other-contact" }))).rejects.toThrow("BINDING_MISMATCH");
      expect(ran).toBe(false);
    } finally { db.close(); }
  });
  test("only proven process stop releases account; uncertain errors preserve it", async () => {
    const db = new Database(":memory:");
    try {
      const leases = new SqliteAccountLeases(db);
      const adapter: AgentAdapter = { provider: "codex", qualification, run: async () => ({ output: "hello", processStopped: true }) };
      expect((await new AgentRouter({ adapters: [adapter], leases, now: () => 100 }).run(request, broker())).output).toBe("hello");
      expect(leases.inspect("codex", "shared")).toBeNull();
      const failed = { ...adapter, run: async () => { throw new Error("connection-lost"); } };
      await expect(new AgentRouter({ adapters: [failed], leases, now: () => 100 }).run(request, broker())).rejects.toThrow("connection-lost");
      expect(leases.inspect("codex", "shared")?.owner).toBe("run-one");
    } finally { db.close(); }
  });
  test("classifiers receive no tools", async () => {
    const db = new Database(":memory:");
    try {
      let ran = false;
      const adapter: AgentAdapter = { provider: "codex", qualification, run: async () => { ran = true; return { output: "{}", processStopped: true }; } };
      const router = new AgentRouter({ adapters: [adapter], leases: new SqliteAccountLeases(db), now: () => 100 });
      await expect(router.run({ ...request, purpose: "classify" }, broker())).rejects.toThrow("NO_TOOLS");
      expect(ran).toBe(false);
    } finally { db.close(); }
  });
});
