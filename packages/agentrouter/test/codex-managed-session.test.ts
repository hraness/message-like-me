import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexTaskSettings } from "../src/codex-config.ts";
import { codexManagedAccountConfiguration } from "../src/codex-managed-baseline.ts";
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

test("distinct tasks reuse unchanged persistent bytes and select their own thread and turn settings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentrouter-baseline-fixture-")), file = join(directory, "config.toml");
  const baseline = codexManagedAccountConfiguration();
  await writeFile(file, baseline, { flag: "wx", mode: 0o600 });
  const before = await stat(file, { bigint: true });
  const peers = [managedPeer({ noTools: true }), managedPeer({ noTools: true, settings: codexTaskSettings({
    model: { id: "second-synthetic-model", reasoningEffort: "high", serviceTier: "priority" },
    instructions: { base: "A separate synthetic task.", developer: "Use a different retained source." },
  }) })];
  try {
    for (const peer of peers) {
      const launch = peer.launcher.launch.bind(peer.launcher);
      peer.launcher.launch = async input => {
        // Synthetic persistent-home contract: a mismatch refuses the launch;
        // the task driver has no file-writing or account-credential port.
        expect(input.configuration).toBe(await readFile(file, "utf8"));
        return launch(input);
      };
      const result = await run(peer);
      expect(result.receipt.observedSettings).toEqual(peer.settings.model.id === "synthetic-model"
        ? { model: "synthetic-model", reasoningEffort: "medium", serviceTier: "default" }
        : { model: "second-synthetic-model", reasoningEffort: "high", serviceTier: "priority" });
      expect(peer.methods.find(value => value.method === "thread/start")?.params).toMatchObject({
        model: peer.settings.model.id, serviceTier: peer.settings.model.serviceTier,
        config: { model_reasoning_effort: peer.settings.model.reasoningEffort,
          features: { remote_control: false, browser_use_external: false, goals: false, sleep_tool: false },
          tools: { update_plan: { enabled: false }, experimental_request_user_input: { enabled: false } } },
        baseInstructions: peer.settings.instructions.base, developerInstructions: peer.settings.instructions.developer,
      });
      expect(peer.methods.find(value => value.method === "turn/start")?.params).toMatchObject({
        model: peer.settings.model.id, effort: peer.settings.model.reasoningEffort, serviceTier: peer.settings.model.serviceTier,
      });
      expect(peer.methods.find(value => value.method === "thread/start")?.params.config.model).toBeUndefined();
      expect(peer.methods.find(value => value.method === "thread/start")?.params.config.service_tier).toBeUndefined();
      expect(peer.methods.find(value => value.method === "thread/start")?.params.config.instructions).toBeUndefined();
    }
    expect(peers[0]!.launchInputs[0]!.configuration).toBe(peers[1]!.launchInputs[0]!.configuration);
    expect(await readFile(file, "utf8")).toBe(baseline);
    const after = await stat(file, { bigint: true });
    expect([after.dev, after.ino, after.size, after.mtimeNs, after.ctimeNs]).toEqual([before.dev, before.ino, before.size, before.mtimeNs, before.ctimeNs]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("unset task effort and tier use native thread observations without adding overrides", async () => {
  const peer = managedPeer({ noTools: true, settings: codexTaskSettings({
    model: { id: "synthetic-default-model", reasoningEffort: null, serviceTier: null },
    instructions: { base: "Use synthetic defaults.", developer: "Use only the retained evidence." },
  }) });
  const result = await run(peer), thread = peer.methods.find(value => value.method === "thread/start")!.params;
  const turn = peer.methods.find(value => value.method === "turn/start")!.params;
  expect(result.receipt.observedSettings).toEqual({ model: "synthetic-default-model", reasoningEffort: "medium", serviceTier: "default" });
  expect(thread.config.model_reasoning_effort).toBeUndefined(); expect(thread.serviceTier).toBeUndefined();
  expect(turn.effort).toBeUndefined(); expect(turn.serviceTier).toBeUndefined();
});

test.each(["settings", "model", "effort", "instructions", "digest"])("a %s accessor is refused without reading it or launching", async kind => {
  const peer = managedPeer(); let reads = 0;
  await withTaskLease(peer.request, peer.broker.profile, async request => {
    const settings = { ...peer.settings, model: { ...peer.settings.model }, instructions: { ...peer.settings.instructions } };
    const options = { ...peer, request, settings };
    const [target, key] = kind === "settings" ? [options, "settings"] : kind === "effort" ? [settings.model, "reasoningEffort"]
      : kind === "model" ? [settings, "model"] : kind === "instructions" ? [settings.instructions, "base"] : [settings, "instructionDigest"];
    Object.defineProperty(target, key, { enumerable: true, get() { reads++; throw Error("Synthetic accessor executed"); } });
    await expect(runCodexManagedSession(options)).rejects.toBeInstanceOf(CodexManagedSessionError);
  });
  expect(reads).toBe(0); expect(peer.counts()).toEqual({ invocations: 0, launches: 0, stopped: false });
  expect(peer.methods).toEqual([]);
});

test("native settings before the turn reply preserve requested defaults and record resolved settings", async () => {
  const order: string[] = [];
  const peer = managedPeer({ nativeSettings: true, serviceTier: null, mutateFrame(frame) {
    if (frame.result?.thread) order.push("thread reply");
    if (frame.method === "thread/started") order.push("thread started");
    if (frame.method === "thread/settings/updated") order.push("settings updated");
    if (frame.result?.turn) order.push("turn reply");
  } });
  const result = await run(peer);
  expect(order).toEqual(["thread reply", "thread started", "settings updated", "turn reply"]);
  expect(result.receipt.observedSettings).toEqual({ model: "synthetic-model", reasoningEffort: "medium", serviceTier: "default" });
  expect(peer.settings.model.serviceTier).toBeNull(); expect(peer.request.model.serviceTier).toBeNull();
  expect(peer.methods.find(value => value.method === "turn/start")?.params).not.toHaveProperty("serviceTier");
  expect(result.receipt.processStopped).toBe(true); expect(peer.counts().invocations).toBe(1);
});

test.each(["model", "effort", "tier", "cwd", "sandbox", "thread"])("native settings %s drift fails before broker effects", async which => {
  const peer = managedPeer({ nativeSettings: true, mutateFrame(frame) {
    if (frame.method !== "thread/settings/updated") return;
    const value = frame.params.threadSettings;
    if (which === "model") value.model = "changed-model";
    if (which === "effort") value.effort = "high";
    if (which === "tier") value.serviceTier = "priority";
    if (which === "cwd") value.cwd = "/foreign";
    if (which === "sandbox") value.sandboxPolicy.networkAccess = true;
    if (which === "thread") frame.params.threadId = "foreign-thread";
  } });
  const receipt = await failed(peer);
  expect(receipt.turnCompleted).toBe(false); expect(receipt.processStopped).toBe(true); expect(peer.counts().invocations).toBe(0);
});

test("pending settings repeats are bounded and cannot change a newly observed default", async () => {
  expect((await run(managedPeer({ nativeSettings: true, settingsCopies: 8 }))).receipt.turnCompleted).toBe(true);
  const excess = managedPeer({ nativeSettings: true, settingsCopies: 9 });
  expect((await failed(excess)).failures).toContain("CODEX_MANAGED_SETTINGS_UPDATE_CHANGED");
  expect(excess.counts().invocations).toBe(0);
  let seen = 0;
  const changed = managedPeer({ nativeSettings: true, settingsCopies: 2, serviceTier: null, mutateFrame(frame) {
    if (frame.method === "thread/settings/updated" && ++seen === 2) frame.params.threadSettings.personality = "friendly";
  } });
  const receipt = await failed(changed);
  expect(receipt.failures).toContain("CODEX_MANAGED_SETTINGS_UPDATE_CHANGED");
  expect(receipt.observedSettings?.serviceTier).toBe("default"); expect(changed.counts().invocations).toBe(0);
});

test("matching settings outside the pending turn RPC are rejected", async () => {
  let beforeThread!: ReturnType<typeof managedPeer>;
  beforeThread = managedPeer({ mutateConfig() { beforeThread.emit(beforeThread.settingsUpdate()); } });
  expect((await failed(beforeThread)).failures).toContain("CODEX_MANAGED_SETTINGS_UPDATE_SCOPE");
  expect(beforeThread.methods.some(value => value.method === "turn/start")).toBe(false);
  let afterReply!: ReturnType<typeof managedPeer>;
  afterReply = managedPeer({ onTurn({ emit }) { emit(afterReply.settingsUpdate()); } });
  expect((await failed(afterReply)).failures).toContain("CODEX_MANAGED_SETTINGS_UPDATE_SCOPE");
  expect(afterReply.counts().invocations).toBe(0);
  const afterFinal: Record<string, any>[] = [], terminal = managedPeer({ afterFinal });
  afterFinal.push(terminal.settingsUpdate());
  const receipt = await failed(terminal);
  expect(receipt.turnCompleted).toBe(true); expect(receipt.failures).toContain("CODEX_MANAGED_SETTINGS_UPDATE_SCOPE");
});

test("pending settings cannot authorize a callback or survive a mismatched turn reply", async () => {
  const callback = managedPeer({ nativeSettings: true, serviceTier: null, earlyCallback: true });
  const callbackReceipt = await failed(callback);
  expect(callback.counts().invocations).toBe(0); expect(callback.answers).toHaveLength(0);
  expect(callbackReceipt.observedSettings?.serviceTier).toBe("default");
  const wrongReply = managedPeer({ nativeSettings: true, serviceTier: null, mutateFrame(frame) {
    if (frame.result?.turn) frame.id = 999;
  } });
  const replyReceipt = await failed(wrongReply);
  expect(replyReceipt.failures).toContain("CODEX_MANAGED_UNEXPECTED_RPC_ID");
  expect(replyReceipt.observedSettings?.serviceTier).toBe("default"); expect(wrongReply.counts().invocations).toBe(0);
});

test("selected IO deadline revokes an unacknowledged write and cleanup joins its eventual outcome", async () => {
  const peer = managedPeer({ noTools: true });
  let settle!: (value: import("../src/process-port.ts").ProviderProcessWriteResult) => void;
  const write = new Promise<import("../src/process-port.ts").ProviderProcessWriteResult>(resolve => { settle = resolve; });
  let stopStarted = false;
  const task = withTaskLease(peer.request, peer.broker.profile, request => runCodexManagedSession({ ...peer, request, limits: { ioMs: 10 }, launcher: { async launch(input) {
    const owned = await peer.launcher.launch(input);
    return { ...owned, write: () => write, async stopAndJoin() {
      stopStarted = true; settle({ outcome: "indeterminate", acceptedBytes: 0 }); return owned.stopAndJoin();
    } };
  } } }), Date.now);
  try { await task; throw Error("Expected failed session"); }
  catch (error) {
    expect(error).toBeInstanceOf(CodexManagedSessionError);
    const receipt = (error as CodexManagedSessionError).receipt;
    expect(receipt.failures).toContain("CODEX_MANAGED_WRITE_FAILED");
    expect(receipt.failures).not.toContain("CODEX_MANAGED_EXECUTION_DEADLINE");
    expect(receipt.handlersJoined).toBe(true); expect(receipt.processStopped).toBe(true); expect(stopStarted).toBe(true);
    expect(peer.methods).toHaveLength(0);
  }
});

test.each(["account", "config", "thread"])("changed %s admission fails before a model turn or broker effect", async which => {
  const peer = managedPeer(which === "account" ? { mutateAccount(value) { value.account.type = "apiKey"; } }
    : which === "config" ? { mutateConfig(value) { value.config.model_provider = "foreign"; } }
    : { mutateThread(value) { value.serviceTier = "priority"; } });
  const receipt = await failed(peer);
  expect(receipt.processStopped).toBe(true); expect(peer.methods.some(value => value.method === "turn/start")).toBe(false);
  expect(peer.counts().invocations).toBe(0);
});

test.each(["model", "reasoningEffort", "serviceTier"])("wrong selected thread %s fails before a turn despite valid baseline defaults", async field => {
  const peer = managedPeer({ mutateThread(value) { value[field] = "different-from-selected"; } });
  const receipt = await failed(peer);
  expect(receipt).toMatchObject({ configurationObserved: true, threadObserved: false, turnCompleted: false, processStopped: true });
  expect(peer.methods.some(value => value.method === "thread/start")).toBe(true);
  expect(peer.methods.some(value => value.method === "turn/start")).toBe(false);
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
