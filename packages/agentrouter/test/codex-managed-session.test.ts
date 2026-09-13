import { expect, test } from "bun:test";
import { CodexManagedSessionError, runCodexManagedSession } from "../src/codex-managed-session.ts";
import { managedPeer } from "./codex-managed-test-peer.ts";
import { withTaskLease } from "./task-lease-test-fixture.ts";
import type { AgentTaskExecutionRequest } from "../src/task-runtime.ts";

const run = (peer: ReturnType<typeof managedPeer>, options: Pick<Parameters<typeof runCodexManagedSession>[0], "now" | "limits"> = {},
  change: (request: AgentTaskExecutionRequest) => AgentTaskExecutionRequest = request => request) =>
  withTaskLease(peer.request, peer.broker.profile, request => {
    peer.request = request;
    return runCodexManagedSession({ ...peer, ...options, request: change(request) });
  }, options.now ?? Date.now);
async function failed(peer: ReturnType<typeof managedPeer>, change?: (request: AgentTaskExecutionRequest) => AgentTaskExecutionRequest) {
  try { await run(peer, {}, change); throw Error("Expected failed session"); }
  catch (error) { expect(error).toBeInstanceOf(CodexManagedSessionError); return (error as CodexManagedSessionError).receipt; }
}

test("managed session binds native account/config/thread, tool lifecycle, final phase, usage and closure", async () => {
  const peer = managedPeer({ earlyTurn: true }), result = await run(peer);
  expect(result.output).toBe("Synthetic final finding.");
  expect(result.receipt).toMatchObject({ status: "completed", productionQualified: false, exactToolInventoryObserved: false,
    initialized: true, chatgptAccountObserved: true, configurationObserved: true, threadObserved: true,
    turnCompleted: true, handlersJoined: true, brokerJoined: true, processStopped: true,
    calls: { started: 1, claimed: 1, responsesWritten: 1, completed: 1, closed: true },
    usage: { inputTokens: 21, outputTokens: 9, totalTokens: 30 },
    observedSettings: { model: "synthetic-model", reasoningEffort: "medium", serviceTier: "default" } });
  expect(peer.methods.map(value => value.method)).toEqual(["initialize", "initialized", "account/read", "config/read", "thread/start", "turn/start"]);
  expect(peer.methods.find(value => value.method === "account/read")?.params).toEqual({ refreshToken: false });
  expect(peer.methods.find(value => value.method === "thread/start")?.params).toMatchObject({ modelProvider: "openai",
    environments: [], runtimeWorkspaceRoots: [], selectedCapabilityRoots: [], allowProviderModelFallback: false });
  expect(peer.methods.find(value => value.method === "turn/start")?.params).toMatchObject({ effort: "medium", serviceTier: "default" });
  expect(peer.counts()).toEqual({ invocations: 1, launches: 1, stopped: true });
  expect(JSON.stringify(result.receipt)).not.toContain("synthetic-private");
  expect(JSON.stringify(result.receipt)).not.toContain("Synthetic reasoning");
});

test.each(["account", "config", "thread"])("changed %s admission fails before a model turn or broker effect", async which => {
  const peer = managedPeer(which === "account" ? { mutateAccount(value) { value.account.type = "apiKey"; } }
    : which === "config" ? { mutateConfig(value) { value.config.model_provider = "foreign"; } }
    : { mutateThread(value) { value.serviceTier = "priority"; } });
  const receipt = await failed(peer);
  expect(receipt.processStopped).toBe(true); expect(peer.methods.some(value => value.method === "turn/start")).toBe(false);
  expect(peer.counts().invocations).toBe(0);
});

test.each(["thread", "turn", "tool", "arguments", "namespace", "call"])("forged callback %s is denied before its broker effect", async which => {
  const peer = managedPeer({ mutateFrame(frame) {
    if (frame.method !== "item/tool/call") return;
    if (which === "thread") frame.params.threadId = "other-thread";
    if (which === "turn") frame.params.turnId = "other-turn";
    if (which === "tool") frame.params.tool = "shell";
    if (which === "arguments") frame.params.arguments.id = "other-source";
    if (which === "namespace") frame.params.namespace = "foreign";
    if (which === "call") frame.params.callId = "other-call";
  } });
  expect((await failed(peer)).processStopped).toBe(true); expect(peer.counts().invocations).toBe(0);
});

test.each([
  { name: "duplicate callback", options: { duplicateCallback: true }, effects: 1 },
  { name: "callback without start", options: { callbackWithoutStart: true }, effects: 0 },
  { name: "missing completion", options: { missingCompletion: true }, effects: 1 },
] as const)("$name cannot produce successful accounting", async ({ options, effects }) => {
  const peer = managedPeer(options), receipt = await failed(peer);
  expect(receipt.processStopped).toBe(true); expect(peer.counts().invocations).toBe(effects);
});

test.each(["arguments", "output", "success", "status"])("changed completed tool %s is rejected", async which => {
  const peer = managedPeer({ mutateFrame(frame) {
    if (frame.method !== "item/completed" || frame.params.item.type !== "dynamicToolCall") return;
    if (which === "arguments") frame.params.item.arguments.id = "other-source";
    if (which === "output") frame.params.item.contentItems[0].text = "forged result";
    if (which === "success") frame.params.item.success = false;
    if (which === "status") frame.params.item.status = "failed";
  } });
  expect((await failed(peer)).failures).toContain("CODEX_MANAGED_COMPLETION_CHANGED"); expect(peer.counts().invocations).toBe(1);
});

test.each(["commandExecution", "fileChange", "mcpToolCall", "webSearch", "collabAgentToolCall"])("native %s item is rejected before broker work", async type => {
  const peer = managedPeer({ beforeCall: [{ method: "item/started", params: { threadId: "thread-one", turnId: "turn-one", item: { type, id: "forbidden-one" } } }] });
  expect((await failed(peer)).failures).toContain("CODEX_MANAGED_NATIVE_ITEM_DENIED"); expect(peer.counts().invocations).toBe(0);
});

test("external token refresh and native approval callbacks remain refused", async () => {
  for (const method of ["account/chatgptAuthTokens/refresh", "item/commandExecution/requestApproval", "item/permissions/requestApproval"]) {
    const peer = managedPeer({ beforeCall: [{ id: "denied-one", method, params: {} }] });
    expect((await failed(peer)).failures).toContain("CODEX_MANAGED_NATIVE_REQUEST_DENIED"); expect(peer.counts().invocations).toBe(0);
  }
});

test("broker denial remains a matched failed tool response without leaking its raw error", async () => {
  const peer = managedPeer({ failBroker: true }), result = await run(peer);
  expect(result.receipt.calls.completed).toBe(1);
  expect(peer.answers).toEqual([{ success: false, contentItems: [{ type: "inputText", text: '{"error":"TOOL_REQUEST_DENIED"}' }] }]);
  expect(JSON.stringify(result)).not.toContain("private synthetic message");
});

test("unknown message phase has a final fallback, but commentary cannot become a final answer", async () => {
  expect((await run(managedPeer({ unknownFinal: true }))).output).toBe("Synthetic final finding.");
  expect((await failed(managedPeer({ commentaryOnly: true }))).turnCompleted).toBe(false);
});

test("already-buffered late callbacks and settings drift remain fatal after terminal completion", async () => {
  for (const frame of [
    { id: "late-one", method: "item/tool/call", params: {} },
    { method: "thread/settings/updated", params: { threadId: "thread-one", threadSettings: { model: "changed" } } },
    { method: "model/rerouted", params: {} },
  ]) {
    const peer = managedPeer({ afterFinal: [frame] }), receipt = await failed(peer);
    expect(receipt.turnCompleted).toBe(true); expect(receipt.processStopped).toBe(true); expect(peer.counts().invocations).toBe(1);
  }
});

test("malformed or regressing native token accounting cannot count as a successful run", async () => {
  const peer = managedPeer({ mutateFrame(frame) {
    if (frame.method === "thread/tokenUsage/updated") frame.params.tokenUsage.total.totalTokens = 1;
  } });
  expect((await failed(peer)).failures).toContain("CODEX_MANAGED_USAGE_INVALID");
});

test("cancellation joins the process and a cancellable broker handler", async () => {
  let peer!: ReturnType<typeof managedPeer>;
  peer = managedPeer({ invoke() { return new Promise((_resolve, reject) => {
    peer.controller.signal.addEventListener("abort", () => reject(Error("stopped")), { once: true });
    peer.controller.abort();
  }); } });
  const receipt = await failed(peer);
  expect(receipt.processStopped).toBe(true); expect(receipt.brokerJoined).toBe(true); expect(receipt.handlersJoined).toBe(true);
  expect(peer.answers).toHaveLength(0);
});

test("nonjoining broker work preserves unproven custody after cancellation", async () => {
  let release!: (value: unknown) => void, peer!: ReturnType<typeof managedPeer>;
  peer = managedPeer({ invoke() { peer.controller.abort(); return new Promise(resolve => { release = resolve; }); } });
  const receipt = await failed(peer);
  expect(receipt.processStopped).toBe(false); expect(receipt.brokerJoined).toBe(false); expect(receipt.handlersJoined).toBe(false);
  expect(peer.counts().stopped).toBe(true); expect(peer.answers).toHaveLength(0);
  release(null); await peer.broker.close();
});

test("unproven process group closure retains custody despite a completed answer", async () => {
  const receipt = await failed(managedPeer({ groupAbsent: false }));
  expect(receipt.turnCompleted).toBe(true); expect(receipt.processStopped).toBe(false);
});

test("a stopped process snapshot cannot replace settlement of its cleanup promise", async () => {
  const peer = managedPeer(), launch = peer.launcher.launch.bind(peer.launcher);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  peer.launcher.launch = async input => {
    const handle = await launch(input);
    return { ...handle, async stopAndJoin() { const receipt = await handle.stopAndJoin(); await pending; return receipt; } };
  };
  const receipt = await failed(peer);
  expect(receipt.process).toMatchObject({ rootExited: true, groupAbsent: true, stdioJoined: true });
  expect(receipt.processJoined).toBe(false); expect(receipt.processStopped).toBe(false);
  expect(receipt.failures).toContain("CODEX_MANAGED_PROCESS_JOIN_DEADLINE");
  release();
});

test("the supplied clock closes a turn at the original deadline before broker effects", async () => {
  let now = 0, peer!: ReturnType<typeof managedPeer>;
  peer = managedPeer({ onTurn() { now = peer.request.executionDeadlineUnixMs; } });
  now = peer.request.admittedAtUnixMs;
  const receipt = await run(peer, { now: () => now }).then(
    () => { throw Error("Expected deadline failure"); },
    error => { expect(error).toBeInstanceOf(CodexManagedSessionError); return (error as CodexManagedSessionError).receipt; },
  );
  expect(receipt.failures).toContain("CODEX_MANAGED_EXECUTION_DEADLINE");
  expect(receipt).toMatchObject({ launchAttempted: true, processStopped: true });
  expect(peer.counts()).toEqual({ invocations: 0, launches: 1, stopped: true });
});

test("low-level invalid output or cleanup allocation cannot launch", async () => {
  for (const kind of ["output", "cleanup"]) {
    const peer = managedPeer();
    await expect(run(peer, {}, request => ({ ...request,
      limits: { ...request.limits, ...(kind === "output" ? { maxOutputBytes: 0 } : { maxCleanupMs: 10 }) } }))).rejects.toThrow();
    expect(peer.counts().launches).toBe(0);
  }
  const peer = managedPeer();
  await expect(run(peer, { limits: { maxRequests: 1 } as never })).rejects.toBeInstanceOf(CodexManagedSessionError);
  expect(peer.counts().launches).toBe(0);
});

test("native lifecycle timestamps are inert and bounded to their own phase", async () => {
  expect((await run(managedPeer({ mutateFrame(frame) {
    if (frame.method === "item/started") delete frame.params.startedAtMs;
    if (frame.method === "item/completed") delete frame.params.completedAtMs;
  } }))).receipt.processStopped).toBe(true);
  for (const wrong of [-1, 1.5, "now", null]) {
    const peer = managedPeer({ mutateFrame(frame) {
      if (frame.method === "item/started") frame.params.startedAtMs = wrong;
    } });
    expect((await failed(peer)).processStopped).toBe(true); expect(peer.counts().invocations).toBe(0);
  }
  const peer = managedPeer({ mutateFrame(frame) {
    if (frame.method === "item/started") frame.params.completedAtMs = 1;
  } });
  expect((await failed(peer)).processStopped).toBe(true); expect(peer.counts().invocations).toBe(0);
});

test("altering an admitted execution deadline never launches", async () => {
  const peer = managedPeer();
  await expect(run(peer, {}, request => ({ ...request, executionDeadlineUnixMs: Date.now() - 1 }))).rejects.toThrow("TASK_ACCOUNT_LEASE_BINDING_MISMATCH");
  expect(peer.counts().launches).toBe(0);
});
