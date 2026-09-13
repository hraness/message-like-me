import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { SqliteAccountLeases } from "../src/accounts.ts";
import { createCapabilityBroker, createCapabilityProfile } from "../src/capabilities.ts";
import { createCodexManagedTaskAdapter, type CodexManagedTaskAdapterOptions } from "../src/codex-managed-task-adapter.ts";
import { runAgentTask, type AgentTaskExecutionRequest, type AgentTaskRequest, type TaskRuntimeQualification } from "../src/task-runtime.ts";
import { managedPeer, type ManagedPeerOptions } from "./codex-managed-test-peer.ts";

function setup() {
  const profile = createCapabilityProfile({ id: "synthetic-managed", version: 1, tools: [] });
  const request: AgentTaskRequest = { route: { id: "managed-codex", provider: "codex", authentication: "subscription" },
    accountId: "synthetic-account", workspaceId: "synthetic-workspace", runId: "synthetic-run",
    profile: { id: profile.id, version: profile.version, digest: profile.digest },
    model: { id: "synthetic-model", reasoningEffort: "medium", serviceTier: "default" },
    purpose: "synthetic", prompt: "No real data.", signal: new AbortController().signal,
    limits: { maxRunMs: 10_000, maxCleanupMs: 1_000, maxOutputBytes: 128 } };
  let launches = 0;
  const options: CodexManagedTaskAdapterOptions = { route: request.route,
    runtime: { version: "synthetic-only", digest: "a".repeat(64) },
    instructions: { base: "Use the fixture.", developer: "Synthetic only." }, now: () => 1_000,
    launcher: { async launch() { launches++; throw Error("NO_NATIVE_LAUNCH"); } } };
  const execution: AgentTaskExecutionRequest = { ...request, admittedAtUnixMs: 1_000, executionDeadlineUnixMs: 11_000,
    cleanupDeadlineUnixMs: 12_000, runtime: { runtimeVersion: options.runtime.version, runtimeDigest: options.runtime.digest,
      evidenceDigest: "b".repeat(64), qualificationExpiresAt: 100_000 } };
  const qualification: TaskRuntimeQualification = { status: "qualified", route: request.route, profile: request.profile,
    runtimeVersion: options.runtime.version, runtimeDigest: options.runtime.digest, evidenceDigest: "b".repeat(64), expiresAt: 100_000,
    controls: { noCommandTools: true, exactToolInventory: true, workspaceReadIsolation: true, workspaceWriteIsolation: true,
      isolatedConfiguration: true, authOutsideWorkspace: true, hostBrokerOnly: true } };
  return { request, options, execution, qualification, launches: () => launches,
    broker: () => createCapabilityBroker({ profile, workspaceId: request.workspaceId, runId: request.runId, isActive: () => true }) };
}

test("managed subscription factory rejects API and foreign provider routes", () => {
  const f = setup();
  for (const route of [{ ...f.request.route, authentication: "api" as const }, { ...f.request.route, provider: "claude" as const }]) {
    expect(() => createCodexManagedTaskAdapter({ ...f.options, route })).toThrow("CODEX_MANAGED_ROUTE_INVALID");
  }
  expect(f.launches()).toBe(0);
});

test("default managed adapter refuses task admission before lease or native launch", async () => {
  const f = setup(), broker = f.broker(), db = new Database(":memory:"), leases = new SqliteAccountLeases(db);
  try {
    const adapter = createCodexManagedTaskAdapter(f.options);
    expect(adapter.qualification.status).toBe("unqualified");
    expect(Object.isFrozen(adapter)).toBe(true);
    await expect(runAgentTask({ adapters: [adapter], leases, now: f.options.now }, f.request, broker)).rejects.toThrow("TASK_ADAPTER_UNQUALIFIED");
    expect(leases.inspect("codex", f.request.accountId)).toBeNull();
    expect(f.launches()).toBe(0);
    expect(() => broker.assertActive()).toThrow("REVOKED");
  } finally { await broker.close(); db.close(); }
});

test("direct calls cannot activate an unqualified managed adapter", async () => {
  const f = setup(), broker = f.broker(), adapter = createCodexManagedTaskAdapter(f.options);
  try {
    await expect(adapter.run(f.execution, broker)).rejects.toThrow("CODEX_MANAGED_ADAPTER_UNQUALIFIED");
    expect(f.launches()).toBe(0);
  } finally { await broker.close(); }
});

test("explicit synthetic qualification is copied and frozen without acquiring runtime evidence", () => {
  const f = setup(), adapter = createCodexManagedTaskAdapter({ ...f.options, qualification: f.qualification });
  expect(adapter.qualification).not.toBe(f.qualification);
  expect(Object.isFrozen(adapter.qualification)).toBe(true);
  if (adapter.qualification.status !== "qualified") throw Error("FIXTURE_QUALIFICATION_MISSING");
  expect(Object.isFrozen(adapter.qualification.controls)).toBe(true);
  (f.qualification as { evidenceDigest: string }).evidenceDigest = "c".repeat(64);
  expect(adapter.qualification.evidenceDigest).toBe("b".repeat(64));
  expect(f.launches()).toBe(0);
});

test("direct managed admission rejects changed route, runtime, profile or expired evidence before launch", async () => {
  for (const change of [
    (r: AgentTaskExecutionRequest) => ({ ...r, route: { ...r.route, id: "foreign-route" } }),
    (r: AgentTaskExecutionRequest) => ({ ...r, runtime: { ...r.runtime, runtimeDigest: "c".repeat(64) } }),
    (r: AgentTaskExecutionRequest) => ({ ...r, profile: { ...r.profile, digest: "c".repeat(64) } }),
    (r: AgentTaskExecutionRequest) => ({ ...r, runtime: { ...r.runtime, evidenceDigest: "c".repeat(64) } }),
    (r: AgentTaskExecutionRequest) => ({ ...r, cleanupDeadlineUnixMs: 100_001 }),
  ]) {
    const f = setup(), broker = f.broker();
    try {
      const adapter = createCodexManagedTaskAdapter({ ...f.options, qualification: f.qualification });
      const rejected = change(f.execution);
      expect((await adapter.run(rejected, broker)).outcome).toEqual({ status: "failed", code: "CODEX_MANAGED_ADAPTER_FAILED" });
      expect((await adapter.stop(rejected, "failed")).joined).toBe(true);
      expect(f.launches()).toBe(0);
    } finally { await broker.close(); }
  }
});

function pipeline(options: ManagedPeerOptions = {}, clock: () => number = Date.now) {
  const peer = managedPeer(options), { request } = peer;
  const qualification: TaskRuntimeQualification = { status: "qualified", route: request.route, profile: request.profile,
    runtimeVersion: request.runtime.runtimeVersion, runtimeDigest: request.runtime.runtimeDigest,
    evidenceDigest: request.runtime.evidenceDigest, expiresAt: request.runtime.qualificationExpiresAt,
    controls: { noCommandTools: true, exactToolInventory: true, workspaceReadIsolation: true, workspaceWriteIsolation: true,
      isolatedConfiguration: true, authOutsideWorkspace: true, hostBrokerOnly: true } };
  const adapter = createCodexManagedTaskAdapter({ route: request.route,
    runtime: { version: request.runtime.runtimeVersion, digest: request.runtime.runtimeDigest },
    qualification, launcher: peer.launcher, instructions: peer.settings.instructions, now: clock });
  return { peer, adapter };
}
function publicRequest(r: AgentTaskExecutionRequest): AgentTaskRequest {
  return { route: r.route, accountId: r.accountId, workspaceId: r.workspaceId, runId: r.runId, profile: r.profile,
    model: r.model, purpose: r.purpose, prompt: r.prompt, limits: r.limits, signal: r.signal };
}

test("synthetic managed pipeline joins callback effects and releases the account with unknown cost", async () => {
  const { peer, adapter } = pipeline(), db = new Database(":memory:"), leases = new SqliteAccountLeases(db);
  try {
    const result = await runAgentTask({ adapters: [adapter], leases, now: Date.now }, publicRequest(peer.request), peer.broker);
    expect(result.outcome).toEqual({ status: "completed", code: null });
    expect(result.output).toBe("Synthetic final finding.");
    expect(result.usage).toEqual({ inputTokens: 21, outputTokens: 9, totalTokens: 30, costUsd: null });
    expect(result.stop.processStopped).toBe(true); expect(result.custody).toBe("released");
    expect(peer.counts()).toEqual({ invocations: 1, launches: 1, stopped: true });
    expect(leases.inspect("codex", peer.request.accountId)).toBeNull();
    expect(peer.methods.find(m => m.method === "turn/start")?.params).toMatchObject({ effort: "medium", serviceTier: "default" });
  } finally { await peer.broker.close(); db.close(); }
});

test("synthetic cancellation revokes and joins before releasing account custody", async () => {
  const { peer, adapter } = pipeline({ stalledTurn: true, onTurn: ({ controller }) => controller.abort() });
  const db = new Database(":memory:"), leases = new SqliteAccountLeases(db);
  try {
    const result = await runAgentTask({ adapters: [adapter], leases, now: Date.now }, publicRequest(peer.request), peer.broker);
    expect(result.outcome.status).toBe("cancelled"); expect(result.output).toBeNull();
    expect(result.stop.joined).toBe(true); expect(result.brokerJoined).toBe(true);
    expect(peer.counts()).toEqual({ invocations: 0, launches: 1, stopped: true });
    expect(leases.inspect("codex", peer.request.accountId)).toBeNull();
  } finally { await peer.broker.close(); db.close(); }
});

test("synthetic unproven native group retains lease and adapter slot", async () => {
  const { peer, adapter } = pipeline({ groupAbsent: false }), db = new Database(":memory:"), leases = new SqliteAccountLeases(db);
  try {
    await expect(runAgentTask({ adapters: [adapter], leases, now: Date.now }, publicRequest(peer.request), peer.broker))
      .rejects.toThrow("TASK_CUSTODY_UNPROVEN");
    expect(leases.inspect("codex", peer.request.accountId)?.owner).toBe(peer.request.runId);
    expect((await adapter.run(peer.request, peer.broker)).outcome).toEqual({ status: "failed", code: "CODEX_MANAGED_TASK_ALREADY_RUNNING" });
    expect((await adapter.stop(peer.request, "failed")).joined).toBe(true);
    expect(leases.inspect("codex", peer.request.accountId)?.owner).toBe(peer.request.runId);
    expect(peer.counts().launches).toBe(1);
  } finally { await peer.broker.close(); db.close(); }
});

test("wrong-run stop cannot revoke another run or consume its stop receipt", async () => {
  const { peer, adapter } = pipeline();
  try {
    await adapter.run(peer.request, peer.broker);
    await expect(adapter.stop({ ...peer.request, runId: "foreign-run" }, "completed")).rejects.toThrow("CODEX_MANAGED_STOP_BINDING_MISMATCH");
    expect((await adapter.stop(peer.request, "completed")).runId).toBe(peer.request.runId);
  } finally { await peer.broker.close(); }
});

test("reentrant host clock cannot overwrite another managed session's custody slot", async () => {
  let reentered: Promise<unknown> | undefined;
  const { peer, adapter } = pipeline({}, () => {
    reentered ??= adapter.run(peer.request, peer.broker).catch(error => error.message);
    return Date.now();
  });
  try {
    const result = await adapter.run(peer.request, peer.broker);
    expect(await reentered).toBe("CODEX_MANAGED_REQUEST_ALREADY_ADMITTED");
    expect(result.outcome.status).toBe("completed");
    expect(peer.counts().launches).toBe(1);
    expect((await adapter.stop(peer.request, "completed")).joined).toBe(true);
  } finally { await peer.broker.close(); }
});

test("busy second-account admission owns an empty receipt and cannot disturb the running account", async () => {
  let entered!: () => void, release!: (value: unknown) => void;
  const entering = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<unknown>(resolve => { release = resolve; });
  const { peer, adapter } = pipeline({ async invoke() { entered(); return held; } });
  const db = new Database(":memory:"), leases = new SqliteAccountLeases(db);
  const secondRequest: AgentTaskRequest = { ...publicRequest(peer.request), accountId: "second-account", workspaceId: "second-workspace",
    runId: "second-run", signal: new AbortController().signal };
  const secondBroker = createCapabilityBroker({ profile: peer.broker.profile, workspaceId: secondRequest.workspaceId,
    runId: secondRequest.runId, isActive: () => true });
  const first = runAgentTask({ adapters: [adapter], leases, now: Date.now }, publicRequest(peer.request), peer.broker);
  try {
    await entering;
    const rejected = await runAgentTask({ adapters: [adapter], leases, now: Date.now }, secondRequest, secondBroker);
    expect(rejected.outcome).toEqual({ status: "failed", code: "CODEX_MANAGED_TASK_ALREADY_RUNNING" });
    expect(rejected.stop.accountId).toBe("second-account"); expect(rejected.stop.runId).toBe("second-run");
    expect(rejected.custody).toBe("released"); expect(leases.inspect("codex", "second-account")).toBeNull();
    expect(leases.inspect("codex", peer.request.accountId)?.owner).toBe(peer.request.runId);
    expect(peer.counts()).toEqual({ invocations: 1, launches: 1, stopped: false });
    release({ finding: "synthetic retained evidence" });
    expect((await first).outcome.status).toBe("completed");
    expect(leases.inspect("codex", peer.request.accountId)).toBeNull();
  } finally { release(null); await first.catch(() => undefined); await secondBroker.close(); await peer.broker.close(); db.close(); }
});

test("stop binds original prompt, deadlines, limits and signal while allowing only cleanup narrowing", async () => {
  const { peer, adapter } = pipeline();
  try {
    expect((await adapter.run(peer.request, peer.broker)).outcome.status).toBe("completed");
    for (const changed of [
      { ...peer.request, prompt: "tampered prompt" }, { ...peer.request, purpose: "tampered purpose" },
      { ...peer.request, executionDeadlineUnixMs: peer.request.executionDeadlineUnixMs + 1 },
      { ...peer.request, admittedAtUnixMs: peer.request.admittedAtUnixMs - 1 },
      { ...peer.request, limits: { ...peer.request.limits, maxOutputBytes: peer.request.limits.maxOutputBytes + 1 } },
      { ...peer.request, cleanupDeadlineUnixMs: peer.request.cleanupDeadlineUnixMs + 1 },
      { ...peer.request, cleanupDeadlineUnixMs: peer.request.admittedAtUnixMs - 1 },
      { ...peer.request, cleanupDeadlineUnixMs: Number.NaN },
    ]) await expect(adapter.stop(changed, "completed")).rejects.toThrow("CODEX_MANAGED_STOP_BINDING_MISMATCH");
    await expect(adapter.stop({ ...peer.request, signal: new AbortController().signal }, "completed")).rejects.toThrow("CODEX_MANAGED_TASK_NOT_RUNNING");
    const narrow = { ...peer.request, cleanupDeadlineUnixMs: peer.request.cleanupDeadlineUnixMs - 1 };
    const stopped = await adapter.stop(narrow, "completed");
    expect(stopped.joined).toBe(true);
    expect(await adapter.stop(peer.request, "completed")).toBe(stopped);
    await expect(adapter.run(peer.request, peer.broker)).rejects.toThrow("CODEX_MANAGED_REQUEST_ALREADY_ADMITTED");
  } finally { await peer.broker.close(); }
});

test("preflight deadline refusal has independent no-session evidence and frees its adapter slot", async () => {
  let expired = true;
  const { peer, adapter } = pipeline({}, () => expired ? peer.request.executionDeadlineUnixMs + 1 : Date.now());
  try {
    const result = await adapter.run(peer.request, peer.broker);
    expect(result.outcome).toEqual({ status: "failed", code: "CODEX_MANAGED_ADAPTER_FAILED" });
    expect(peer.counts().launches).toBe(0);
    expect((await adapter.stop(peer.request, "failed")).joined).toBe(true);
    expired = false;
    const next = { ...peer.request, signal: new AbortController().signal };
    expect((await adapter.run(next, peer.broker)).outcome.status).toBe("completed");
    expect((await adapter.stop(next, "completed")).joined).toBe(true);
    expect(peer.counts().launches).toBe(1);
  } finally { await peer.broker.close(); }
});

test("concurrent pending stops share one settled evidence object", async () => {
  let started!: () => void;
  const entering = new Promise<void>(resolve => { started = resolve; });
  const { peer, adapter } = pipeline({ stalledTurn: true, onTurn() { started(); } });
  const run = adapter.run(peer.request, peer.broker);
  try {
    await entering;
    const first = adapter.stop(peer.request, "cancelled"), second = adapter.stop(peer.request, "cancelled");
    const [one, two] = await Promise.all([first, second]);
    expect(one).toBe(two); expect(one.joined).toBe(true); expect((await run).outcome.status).toBe("failed");
    expect(peer.counts()).toEqual({ invocations: 0, launches: 1, stopped: true });
  } finally { await run; await peer.broker.close(); }
});

test("stop evidence construction failure stays latched and cannot release the older slot", async () => {
  let failClock = false;
  const { peer, adapter } = pipeline({}, () => { if (failClock) throw Error("SYNTHETIC_STOP_CLOCK_FAILED"); return Date.now(); });
  try {
    await adapter.run(peer.request, peer.broker); failClock = true;
    await expect(adapter.stop(peer.request, "completed")).rejects.toThrow("SYNTHETIC_STOP_CLOCK_FAILED");
    failClock = false;
    await expect(adapter.stop(peer.request, "completed")).rejects.toThrow("SYNTHETIC_STOP_CLOCK_FAILED");
    const later = { ...peer.request, accountId: "later-account", signal: new AbortController().signal };
    expect((await adapter.run(later, peer.broker)).outcome.code).toBe("CODEX_MANAGED_TASK_ALREADY_RUNNING");
    expect((await adapter.stop(later, "failed")).accountId).toBe("later-account");
    expect(peer.counts().launches).toBe(1);
    await expect(adapter.stop(peer.request, "completed")).rejects.toThrow("SYNTHETIC_STOP_CLOCK_FAILED");
  } finally { await peer.broker.close(); }
});
