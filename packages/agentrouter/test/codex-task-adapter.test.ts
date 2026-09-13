import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { PassThrough, Writable } from "node:stream";
import { SqliteAccountLeases } from "../src/accounts.ts";
import { createCapabilityBroker, createCapabilityProfile } from "../src/capabilities.ts";
import { createCodexTaskAdapter } from "../src/codex-task-adapter.ts";
import type { CodexProcessLauncher, CodexProcessReceipt } from "../src/codex-process.ts";
import { runAgentTask, type AgentTaskExecutionRequest, type AgentTaskModel, type AgentTaskRequest, type TaskRuntimeQualification } from "../src/task-runtime.ts";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
const profile = createCapabilityProfile({ id: "codex-adapter-custody-fixture", version: 1, tools: [] });
const identity = { id: profile.id, version: profile.version, digest: profile.digest };
const route = { id: "codex-subscription", provider: "codex", authentication: "subscription" } as const;
const runtime = { version: "synthetic-only", digest: "a".repeat(64) };
const instructions = { base: "Return the synthetic finding.", developer: "Use only supplied synthetic evidence." };
const model = { id: "synthetic-model", reasoningEffort: null, serviceTier: null };

/** A zero-tool JSON-RPC peer crosses the real adapter, session, relay and lease
 * boundaries. No native executable, provider account or remote HTTP is used. */
function fixture(options: { holdResponse?: boolean; invalidInstructions?: boolean; uncertainLaunch?: boolean; model?: AgentTaskModel;
  omitReasoning?: "absent" | "null" } = {}) {
  const db = new Database(":memory:"), leases = new SqliteAccountLeases(db);
  const selectedModel = options.model ?? model, turnStarts: Record<string, unknown>[] = [];
  const qualification: Extract<TaskRuntimeQualification, { status: "qualified" }> = { status: "qualified", route, profile: identity,
    runtimeVersion: runtime.version, runtimeDigest: runtime.digest, evidenceDigest: "b".repeat(64), expiresAt: Date.now() + 3_600_000,
    controls: { noCommandTools: true, exactToolInventory: true, workspaceReadIsolation: true, workspaceWriteIsolation: true,
      isolatedConfiguration: true, authOutsideWorkspace: true, hostBrokerOnly: true } };
  let upstreamEntered = deferred<void>(), responseGate = deferred<void>(), holdResponse = options.holdResponse === true;
  let onLaunch: (() => void) | undefined;
  const networks = new Set<Promise<void>>(), networkErrors: unknown[] = [];
  let launchCalls = 0, stopCalls = 0, launchAborts = 0, upstreamCalls = 0;
  const launcher: CodexProcessLauncher = { async launch(input) {
    launchCalls++;
    const callback = onLaunch; onLaunch = undefined; callback?.();
    if (options.uncertainLaunch) throw Error("SYNTHETIC_UNKNOWN_LAUNCH_OUTCOME");
    let stopped = false;
    const stdout = new PassThrough(), exited = deferred<void>();
    const endpoint = JSON.parse(input.configuration.split("\n").find(line => line.startsWith("base_url = "))!.slice(11)) as string;
    const receipt = (): CodexProcessReceipt => ({ nativeVersion: "synthetic-only", executableSha256: "fixture", runtimeSnapshotSha256: "fixture",
      parentRuntimeSha256: "a".repeat(64), scratchContentSha256: "b".repeat(64), scratchIdentitySha256: "c".repeat(64),
      configSha256: "fixture", profileSha256: "fixture", custodyPath: "fixture", pid: 1, pgid: 1,
      rootExited: stopped, groupAbsent: stopped, stdioJoined: stopped, scratchRetained: !stopped,
      nativeExitCode: stopped ? 0 : null, nativeExitSignal: null, cleanupErrors: [], runtimeErrors: [] });
    const onAbort = () => { launchAborts++; };
    input.signal.addEventListener("abort", onAbort, { once: true });
    const emit = (frame: unknown) => { if (!stdout.destroyed) stdout.write(JSON.stringify(frame) + "\n"); };
    function respond(params: { input: { text: string }[]; effort?: string; serviceTierForTurn?: string }) {
      const operation = (async () => {
        const response = await fetch(`${endpoint}/responses`, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: selectedModel.id, instructions: instructions.base,
            input: [{ type: "message", role: "user", content: [{ type: "input_text", text: params.input[0]!.text }] }], tools: [],
            tool_choice: "auto", parallel_tool_calls: false,
            ...(options.omitReasoning === "absent" ? {} : {
              reasoning: options.omitReasoning === "null" || params.effort === undefined ? null : { effort: params.effort, summary: "auto" } }),
            ...(params.serviceTierForTurn === undefined ? {} : { service_tier: params.serviceTierForTurn }),
            store: false, stream: true, include: [] }) });
        const body = await response.text();
        if (!response.ok || stopped) return;
        const events = body.trim().split("\n\n").map(block => JSON.parse(block.split("\ndata: ")[1]!));
        const item = events[1].item;
        emit({ method: "item/completed", params: { threadId: "thread-fixture", turnId: "turn-fixture",
          item: { type: "agentMessage", id: item.id, text: item.content[0].text } } });
        emit({ method: "turn/completed", params: { threadId: "thread-fixture", turn: { id: "turn-fixture", status: "completed", error: null } } });
      })().catch(error => { networkErrors.push(error); });
      networks.add(operation); void operation.finally(() => networks.delete(operation));
    }
    const stdin = new Writable({ write(chunk, _encoding, callback) {
      const message = JSON.parse(chunk.toString());
      if (message.method === "initialize") emit({ id: message.id, result: { userAgent: "synthetic-only" } });
      if (message.method === "thread/start") emit({ id: message.id, result: { thread: { id: "thread-fixture" } } });
      if (message.method === "turn/start") {
        turnStarts.push(structuredClone(message.params));
        emit({ id: message.id, result: { turn: { id: "turn-fixture" } } });
        queueMicrotask(() => respond(message.params));
      }
      callback();
    } });
    return { cwd: "/synthetic/scratch", stdin, stdout, ready: Promise.resolve(), exited: exited.promise, receipt,
      async stopAndJoin() {
        stopCalls++; stopped = true; stdin.end(); stdout.end(); exited.resolve();
        await Promise.allSettled([...networks]); input.signal.removeEventListener("abort", onAbort); return receipt();
      } };
  } };
  const adapter = createCodexTaskAdapter({ route, runtime, qualification,
    instructions: options.invalidInstructions ? { ...instructions, base: "" } : instructions, launcher, now: Date.now,
    upstream: { async request(_body, signal) {
      upstreamCalls++; upstreamEntered.resolve();
      if (holdResponse) {
        const aborted = deferred<void>(), onAbort = () => aborted.resolve();
        signal.addEventListener("abort", onAbort, { once: true });
        try { if (!signal.aborted) await Promise.race([responseGate.promise, aborted.promise]); }
        finally { signal.removeEventListener("abort", onAbort); }
        signal.throwIfAborted();
      }
      return new Response([
        { type: "response.created", response: { id: "response-fixture" } },
        { type: "response.output_item.done", item: { type: "message", role: "assistant", id: "message-fixture",
          content: [{ type: "output_text", text: "Synthetic finding." }] } },
        { type: "response.completed", response: { id: "response-fixture", usage: { input_tokens: 11, output_tokens: 2, total_tokens: 13 } } },
      ].map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
    } } });
  function task(accountId = "account-one", maxRunMs = 2_000, maxCleanupMs = 1_000) {
    const controller = new AbortController();
    const request: AgentTaskRequest = { route, accountId, workspaceId: `workspace-${accountId}`, runId: `run-${accountId}`,
      profile: identity, model: selectedModel, purpose: "synthetic-test", prompt: "Return one synthetic finding.",
      limits: { maxRunMs, maxCleanupMs, maxOutputBytes: 1024 }, signal: controller.signal };
    const broker = createCapabilityBroker({ profile, workspaceId: request.workspaceId, runId: request.runId, isActive: () => true });
    const began = Date.now();
    const execution: AgentTaskExecutionRequest = { ...request, runtime: { runtimeVersion: runtime.version, runtimeDigest: runtime.digest,
      evidenceDigest: "b".repeat(64), qualificationExpiresAt: qualification.expiresAt }, admittedAtUnixMs: began,
      executionDeadlineUnixMs: began + maxRunMs, cleanupDeadlineUnixMs: began + maxRunMs + maxCleanupMs };
    return { request, execution, broker, controller, run: () => runAgentTask({ adapters: [adapter], leases, now: Date.now }, request, broker) };
  }
  return { adapter, task, leases, db, get upstreamEntered() { return upstreamEntered.promise; }, releaseResponse: () => responseGate.resolve(),
    holdNextResponse() { holdResponse = true; upstreamEntered = deferred<void>(); responseGate = deferred<void>(); },
    onNextLaunch(callback: () => void) { onLaunch = callback; },
    counts: () => ({ launchCalls, stopCalls, launchAborts, upstreamCalls }), networkErrors, turnStarts };
}

describe("Codex task adapter custody", () => {
  test("a 60-second execution and 10-second cleanup reaches the launcher and releases joined custody", async () => {
    const f = fixture(), task = f.task("account-one", 60_000, 10_000);
    try {
      const result = await task.run();
      expect(result.outcome.status).toBe("completed"); expect(result.output).toBe("Synthetic finding.");
      expect(result.stop.runId).toBe(task.request.runId); expect(result.stop.accountId).toBe(task.request.accountId);
      expect(result.brokerJoined).toBe(true); expect(result.custody).toBe("released");
      expect(f.counts()).toMatchObject({ launchCalls: 1, stopCalls: 1, upstreamCalls: 1 });
      expect(f.turnStarts[0]).not.toHaveProperty("effort"); expect(f.turnStarts[0]).not.toHaveProperty("serviceTierForTurn");
      expect(f.leases.inspect("codex", task.request.accountId)).toBeNull(); expect(f.networkErrors).toEqual([]);
    } finally { task.controller.abort(); f.releaseResponse(); await task.broker.close(); f.db.close(); }
  });

  test.each([{ effort: "high", tier: "default" }, { effort: "ultra", tier: "priority" }])(
    "selected $effort effort and $tier service tier reach the native turn unchanged", async ({ effort, tier }) => {
    const f = fixture({ model: { ...model, reasoningEffort: effort, serviceTier: tier } }), task = f.task();
    try {
      const result = await task.run();
      expect(f.turnStarts[0]).toMatchObject({ effort, serviceTierForTurn: tier });
      expect(result.outcome.status).toBe("completed"); expect(result.output).toBe("Synthetic finding.");
      expect(result.model).toEqual(task.request.model); expect(f.counts().upstreamCalls).toBe(1);
      expect(f.leases.inspect("codex", task.request.accountId)).toBeNull();
    } finally { task.controller.abort(); f.releaseResponse(); await task.broker.close(); f.db.close(); }
  });

  test.each(["absent", "null"] as const)("an explicit effort cannot become %s in the native model request", async omitReasoning => {
    const f = fixture({ model: { ...model, reasoningEffort: "high", serviceTier: "default" }, omitReasoning }), task = f.task();
    try {
      const result = await task.run();
      expect(f.turnStarts[0]).toMatchObject({ effort: "high", serviceTierForTurn: "default" });
      expect(result.outcome.status).toBe("failed"); expect(result.output).toBeNull(); expect(f.counts().upstreamCalls).toBe(0);
      expect(f.leases.inspect("codex", task.request.accountId)).toBeNull(); expect(f.counts().stopCalls).toBe(1);
    } finally { task.controller.abort(); f.releaseResponse(); await task.broker.close(); f.db.close(); }
  });

  test("an unsupported execution budget fails before launch and releases its own account", async () => {
    const f = fixture(), task = f.task("account-one", 121_000, 10_000);
    try {
      const result = await task.run();
      expect(result.outcome.status).toBe("failed"); expect(result.output).toBeNull(); expect(result.custody).toBe("released");
      expect(f.counts()).toEqual({ launchCalls: 0, stopCalls: 0, launchAborts: 0, upstreamCalls: 0 });
      expect(f.leases.inspect("codex", task.request.accountId)).toBeNull();
    } finally { await task.broker.close(); f.db.close(); }
  });

  test("a larger host cleanup allowance still permits normal execution under the pinned cleanup cap", async () => {
    const f = fixture(), task = f.task("account-one", 60_000, 30_000);
    try {
      const result = await task.run();
      expect(result.outcome.status).toBe("completed"); expect(result.output).toBe("Synthetic finding.");
      expect(f.counts()).toMatchObject({ launchCalls: 1, stopCalls: 1, upstreamCalls: 1 });
      expect(f.leases.inspect("codex", task.request.accountId)).toBeNull();
    } finally { task.controller.abort(); f.releaseResponse(); await task.broker.close(); f.db.close(); }
  });

  test("immediate cancellation before deferred execution avoids launch and releases custody", async () => {
    const f = fixture(), task = f.task();
    try {
      const running = task.run(); task.controller.abort();
      const result = await running;
      expect(result.outcome.status).toBe("cancelled"); expect(result.output).toBeNull(); expect(result.custody).toBe("released");
      expect(f.counts()).toEqual({ launchCalls: 0, stopCalls: 0, launchAborts: 0, upstreamCalls: 0 });
      expect(f.leases.inspect("codex", task.request.accountId)).toBeNull(); expect(() => task.broker.assertActive()).toThrow("REVOKED");
    } finally { await task.broker.close(); f.db.close(); }
  });

  test("a busy second account cannot abort the first or reuse its cleanup receipt", async () => {
    const f = fixture({ holdResponse: true }), first = f.task(), second = f.task("account-two");
    const running = first.run();
    try {
      await Promise.race([f.upstreamEntered, running.then(() => { throw Error("First task ended before the held response"); })]);
      const rejected = await second.run();
      expect(rejected.outcome.status).toBe("failed"); expect(rejected.output).toBeNull();
      expect(rejected.stop.accountId).toBe(second.request.accountId); expect(rejected.stop.runId).toBe(second.request.runId);
      expect(f.counts()).toMatchObject({ launchCalls: 1, stopCalls: 0, launchAborts: 0, upstreamCalls: 1 });
      expect(f.leases.inspect("codex", second.request.accountId)).toBeNull();
      expect(f.leases.inspect("codex", first.request.accountId)?.owner).toBe(first.request.runId);
      f.releaseResponse(); const completed = await running;
      expect(completed.outcome.status).toBe("completed"); expect(completed.stop.runId).toBe(first.request.runId);
      expect(completed.stop.proofDigest).not.toBe(rejected.stop.proofDigest);
      expect(f.leases.inspect("codex", first.request.accountId)).toBeNull(); expect(f.counts().stopCalls).toBe(1);
    } finally {
      first.controller.abort(); second.controller.abort(); f.releaseResponse(); await running.catch(() => undefined);
      await Promise.all([first.broker.close(), second.broker.close()]); f.db.close();
    }
  });

  test.each(["account", "run", "workspace", "route", "profile", "model", "runtime", "signal", "prompt", "purpose", "limits",
    "admission-time", "execution-deadline", "extended-cleanup", "fractional-cleanup", "nonfinite-cleanup", "past-admission-cleanup"] as const)(
    "a mismatched stop %s binding is rejected before aborting the active task", async kind => {
      const f = fixture({ holdResponse: true }), task = f.task();
      const running = f.adapter.run(task.execution, task.broker);
      try {
        await Promise.race([f.upstreamEntered, running.then(() => { throw Error("Task ended before the held response"); })]);
        const changed: AgentTaskExecutionRequest = { ...task.execution,
          ...(kind === "account" ? { accountId: "other-account" } : {}), ...(kind === "run" ? { runId: "other-run" } : {}),
          ...(kind === "workspace" ? { workspaceId: "other-workspace" } : {}),
          ...(kind === "route" ? { route: { ...route, authentication: "api" as const } } : {}),
          ...(kind === "profile" ? { profile: { ...identity, version: 2 } } : {}),
          ...(kind === "model" ? { model: { ...model, reasoningEffort: "high" } } : {}),
          ...(kind === "runtime" ? { runtime: { ...task.execution.runtime, evidenceDigest: "c".repeat(64) } } : {}),
          ...(kind === "signal" ? { signal: new AbortController().signal } : {}),
          ...(kind === "prompt" ? { prompt: "Changed task" } : {}), ...(kind === "purpose" ? { purpose: "changed-purpose" } : {}),
          ...(kind === "limits" ? { limits: { ...task.execution.limits, maxOutputBytes: 2048 } } : {}),
          ...(kind === "admission-time" ? { admittedAtUnixMs: task.execution.admittedAtUnixMs + 1 } : {}),
          ...(kind === "execution-deadline" ? { executionDeadlineUnixMs: task.execution.executionDeadlineUnixMs + 1 } : {}),
          ...(kind === "extended-cleanup" ? { cleanupDeadlineUnixMs: task.execution.cleanupDeadlineUnixMs + 1 } : {}),
          ...(kind === "fractional-cleanup" ? { cleanupDeadlineUnixMs: task.execution.cleanupDeadlineUnixMs - 0.5 } : {}),
          ...(kind === "nonfinite-cleanup" ? { cleanupDeadlineUnixMs: Number.NaN } : {}),
          ...(kind === "past-admission-cleanup" ? { cleanupDeadlineUnixMs: task.execution.admittedAtUnixMs - 1 } : {}),
        };
        await expect(f.adapter.stop(changed, "cancelled")).rejects.toThrow();
        expect(f.counts()).toMatchObject({ launchCalls: 1, stopCalls: 0, launchAborts: 0 });
        f.releaseResponse(); const result = await running; expect(result.outcome.status).toBe("completed");
        const stopped = await f.adapter.stop(task.execution, "completed");
        expect(stopped.runId).toBe(task.request.runId); expect(stopped.accountId).toBe(task.request.accountId);
        expect(f.counts().stopCalls).toBe(1);
      } finally {
        task.controller.abort(); f.releaseResponse(); await running.catch(() => undefined);
        await f.adapter.stop(task.execution, "cancelled").catch(() => undefined); await task.broker.close(); f.db.close();
      }
    });

  test("repeating a known execution signal cannot overwrite its active slot", async () => {
    const f = fixture({ holdResponse: true }), task = f.task();
    const running = f.adapter.run(task.execution, task.broker);
    try {
      await Promise.race([f.upstreamEntered, running.then(() => { throw Error("Task ended before the held response"); })]);
      await expect(f.adapter.run(task.execution, task.broker)).rejects.toThrow();
      expect(f.counts()).toMatchObject({ launchCalls: 1, stopCalls: 0, launchAborts: 0 });
      f.releaseResponse(); expect((await running).outcome.status).toBe("completed");
      expect((await f.adapter.stop(task.execution, "completed")).runId).toBe(task.request.runId);
      await expect(f.adapter.run(task.execution, task.broker)).rejects.toThrow();
      expect(f.counts().launchCalls).toBe(1);
    } finally {
      task.controller.abort(); f.releaseResponse(); await running.catch(() => undefined);
      await f.adapter.stop(task.execution, "cancelled").catch(() => undefined); await task.broker.close(); f.db.close();
    }
  });

  test("a stale stop from a completed task cannot stop a later task", async () => {
    const f = fixture(), first = f.task(), second = f.task("account-two");
    let running: ReturnType<typeof f.adapter.run> | undefined;
    try {
      expect((await f.adapter.run(first.execution, first.broker)).outcome.status).toBe("completed");
      const firstProof = await f.adapter.stop(first.execution, "completed");
      f.holdNextResponse(); running = f.adapter.run(second.execution, second.broker);
      await Promise.race([f.upstreamEntered, running.then(() => { throw Error("Task ended before the held response"); })]);
      const before = f.counts();
      const stale = await f.adapter.stop(first.execution, "cancelled").catch(() => null);
      if (stale) expect(stale).toEqual(firstProof);
      expect(f.counts()).toEqual(before);
      f.releaseResponse(); expect((await running).outcome.status).toBe("completed");
      expect((await f.adapter.stop(second.execution, "completed")).accountId).toBe(second.request.accountId);
      expect(f.counts().stopCalls).toBe(2);
    } finally {
      first.controller.abort(); second.controller.abort(); f.releaseResponse(); await running?.catch(() => undefined);
      await f.adapter.stop(second.execution, "cancelled").catch(() => undefined);
      await Promise.all([first.broker.close(), second.broker.close()]); f.db.close();
    }
  });

  test("the exact task may narrow its cleanup deadline and join cancellation", async () => {
    const f = fixture({ holdResponse: true }), task = f.task();
    const running = f.adapter.run(task.execution, task.broker);
    try {
      await Promise.race([f.upstreamEntered, running.then(() => { throw Error("Task ended before the held response"); })]);
      const stopRequest = { ...task.execution, cleanupDeadlineUnixMs: Date.now() + 500 };
      expect(stopRequest.cleanupDeadlineUnixMs).toBeLessThan(task.execution.cleanupDeadlineUnixMs);
      const stopped = await f.adapter.stop(stopRequest, "cancelled");
      expect(stopped.runId).toBe(task.request.runId); expect(stopped.processStopped).toBe(true);
      expect((await running).outcome.status).toBe("failed"); expect(f.counts().stopCalls).toBe(1);
    } finally {
      task.controller.abort(); f.releaseResponse(); await running.catch(() => undefined);
      await f.adapter.stop(task.execution, "cancelled").catch(() => undefined); await task.broker.close(); f.db.close();
    }
  });

  test("synchronous launcher reentry cannot admit a second native process", async () => {
    const f = fixture({ holdResponse: true }), first = f.task(), second = f.task("account-two");
    let reentered: ReturnType<typeof f.adapter.run> | undefined;
    f.onNextLaunch(() => { reentered = f.adapter.run(second.execution, second.broker); });
    const running = f.adapter.run(first.execution, first.broker);
    try {
      await Promise.race([f.upstreamEntered, running.then(() => { throw Error("Task ended before the held response"); })]);
      expect(f.counts().launchCalls).toBe(1); expect(reentered).toBeDefined();
      expect((await reentered!).outcome.status).toBe("failed");
      expect((await f.adapter.stop(second.execution, "failed")).accountId).toBe(second.request.accountId);
      expect(f.counts()).toMatchObject({ launchCalls: 1, stopCalls: 0, launchAborts: 0 });
      f.releaseResponse(); expect((await running).outcome.status).toBe("completed");
      expect((await f.adapter.stop(first.execution, "completed")).accountId).toBe(first.request.accountId);
    } finally {
      first.controller.abort(); second.controller.abort(); f.releaseResponse();
      await Promise.allSettled([running, reentered]);
      await f.adapter.stop(first.execution, "cancelled").catch(() => undefined);
      await f.adapter.stop(second.execution, "cancelled").catch(() => undefined);
      await Promise.all([first.broker.close(), second.broker.close()]); f.db.close();
    }
  });

  test("a failed preflight with no launcher call closes the broker and releases the account", async () => {
    const f = fixture({ invalidInstructions: true }), task = f.task();
    try {
      const result = await task.run();
      expect(result.outcome.status).toBe("failed"); expect(result.output).toBeNull();
      expect(result.stop.accountId).toBe(task.request.accountId); expect(result.stop.processStopped).toBe(true);
      expect(result.brokerJoined).toBe(true); expect(result.custody).toBe("released");
      expect(f.counts()).toEqual({ launchCalls: 0, stopCalls: 0, launchAborts: 0, upstreamCalls: 0 });
      expect(f.leases.inspect("codex", task.request.accountId)).toBeNull();
      expect(() => task.broker.assertActive()).toThrow("REVOKED");
    } finally { await task.broker.close(); f.db.close(); }
  });

  test("a rejecting launcher with unknown process state retains account custody", async () => {
    const f = fixture({ uncertainLaunch: true }), task = f.task();
    try {
      await expect(task.run()).rejects.toThrow("CUSTODY");
      expect(f.counts()).toEqual({ launchCalls: 1, stopCalls: 0, launchAborts: 0, upstreamCalls: 0 });
      expect(f.leases.inspect("codex", task.request.accountId)?.owner).toBe(task.request.runId);
      expect(() => task.broker.assertActive()).toThrow("REVOKED");
    } finally { await task.broker.close(); f.db.close(); }
  });
});
