import { assertCapabilityProfile, type CapabilityBroker } from "./capabilities.ts";
import { canonicalJson, createCodexCapabilityMapping, codexTaskSettings, type CodexTaskSettings } from "./codex-config.ts";
import { assertCodexManagedAccountResponse, assertCodexManagedConfigResponse, assertCodexManagedThreadResponse,
  codexManagedTaskConfiguration, type CodexManagedProcessLauncher } from "./codex-managed-config.ts";
import { CodexManagedCallLedger } from "./codex-managed-ledger.ts";
import type { CodexProcessHandle, CodexProcessReceipt } from "./codex-process.ts";
import { codexBounded, codexTaskLimits, type CodexLimits } from "./codex-relay.ts";
import type { AgentTaskExecutionRequest } from "./task-runtime.ts";
import { boundedText, identifier, object, safeInteger } from "./validation.ts";

/** Only native protocol limits observable by this transport. Provider request
 * count, HTTP body sizes and billed costs are not observed or capped here. */
export type CodexManagedSessionLimits = Pick<CodexLimits, "deadlineMs" | "cleanupMs" | "ioMs" | "maxFrames" | "maxFrameBytes">;
export type CodexManagedSessionReceipt = Readonly<{
  status: "completed" | "failed"; productionQualified: false; exactToolInventoryObserved: false;
  initialized: boolean; chatgptAccountObserved: boolean; configurationObserved: boolean; threadObserved: boolean; turnCompleted: boolean;
  observedSettings: Readonly<{ model: string; reasoningEffort: string | null; serviceTier: string | null }> | null;
  usage: Readonly<{ inputTokens: number | null; outputTokens: number | null; totalTokens: number | null }>;
  calls: ReturnType<CodexManagedCallLedger["receipt"]>; process: CodexProcessReceipt | null;
  handlersJoined: boolean; brokerJoined: boolean; processJoined: boolean; processStopped: boolean; launchAttempted: boolean;
  failures: readonly string[]; frames: number; stdoutBytes: number;
}>;
export class CodexManagedSessionError extends Error {
  constructor(readonly receipt: CodexManagedSessionReceipt) { super("CODEX_MANAGED_SESSION_FAILED"); }
}
function assert(value: unknown, code: string): asserts value { if (!value) throw Error(code); }
const record = (value: unknown) => {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), "CODEX_MANAGED_OBJECT_INVALID");
  return value as Record<string, unknown>;
};
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

/** Experimental app-server driver. The trusted launcher owns native managed
 * authentication and process isolation. No token, service endpoint or upstream
 * transport is supplied here. Observing allowed callbacks is not proof that
 * the native model had no other tools; every receipt remains unqualified. */
export async function runCodexManagedSession(options: {
  request: AgentTaskExecutionRequest; broker: CapabilityBroker; launcher: CodexManagedProcessLauncher;
  settings: CodexTaskSettings; limits?: Partial<CodexManagedSessionLimits>; now?: () => number;
}): Promise<{ output: string; receipt: CodexManagedSessionReceipt }> {
  const request = Object.freeze({ ...options.request, route: Object.freeze({ ...options.request.route }),
    profile: Object.freeze({ ...options.request.profile }), model: Object.freeze({ ...options.request.model }),
    runtime: Object.freeze({ ...options.request.runtime }), limits: Object.freeze({ ...options.request.limits }) });
  const broker = options.broker, mapping = createCodexCapabilityMapping(broker.profile);
  const now = options.now ?? Date.now;
  const ledger = new CodexManagedCallLedger(mapping, 1024);
  const controller = new AbortController(), signal = AbortSignal.any([request.signal, controller.signal]);
  let limits = codexTaskLimits(), settings = options.settings;
  const failures: string[] = [];
  let resolveFatal!: () => void, resolveDone!: () => void;
  const fatal = new Promise<void>(resolve => { resolveFatal = resolve; }), done = new Promise<void>(resolve => { resolveDone = resolve; });
  let process: CodexProcessHandle | null = null, processReceipt: CodexProcessReceipt | null = null;
  let initialized = false, chatgptAccountObserved = false, configurationObserved = false, threadObserved = false;
  let turnCompleted = false, launchAttempted = false, closing = false, handlersJoined = false, brokerJoined = false, processJoined = false;
  let observedSettings: CodexManagedSessionReceipt["observedSettings"] = null;
  let threadId: string | null = null, turnId: string | null = null, output: string | null = null, unknownFinal: string | null = null;
  let usage: CodexManagedSessionReceipt["usage"] = { inputTokens: null, outputTokens: null, totalTokens: null };
  let frames = 0, stdoutBytes = 0, line = "", requestId = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queue = Promise.resolve(), workflow = Promise.resolve();
  const pending = new Map<number, { method: string; resolve(value: Record<string, unknown>): void; reject(error: Error): void }>();
  const serverIds = new Set<string>(), itemStates = new Map<string, { type: string; started: boolean; completed: boolean }>();
  let earlyTurnStarts: { rpcId: number; turnId: string; count: number } | null = null;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  function fail(code: string) {
    if (failures.length < 16 && !failures.includes(code)) failures.push(code);
    controller.abort(new Error(code)); resolveFatal();
  }
  function failureCode(error: unknown) {
    if (error instanceof SyntaxError) return "CODEX_MANAGED_INVALID_JSON";
    if (error instanceof Error && /^CODEX_[A-Z_]+$/u.test(error.message)) return error.message;
    return "CODEX_MANAGED_OPERATION_FAILED";
  }
  function active() {
    signal.throwIfAborted();
    assert(safeInteger(now(), 0, Number.MAX_SAFE_INTEGER) < request.executionDeadlineUnixMs, "CODEX_MANAGED_EXECUTION_DEADLINE");
  }
  async function write(value: unknown) {
    active(); assert(process && !process.stdin.destroyed, "CODEX_MANAGED_STDIN_UNAVAILABLE");
    const text = JSON.stringify(value) + "\n";
    assert(Buffer.byteLength(text) <= limits.maxFrameBytes, "CODEX_MANAGED_WRITE_BOUND");
    await codexBounded(new Promise<void>((resolve, reject) => process!.stdin.write(text,
      error => error ? reject(Error("CODEX_MANAGED_WRITE_FAILED")) : resolve())), limits.ioMs, "CODEX_MANAGED_WRITE_DEADLINE");
  }
  async function rpc(method: string, params: unknown) {
    active(); assert(pending.size < 4, "CODEX_MANAGED_PENDING_BOUND");
    const id = ++requestId;
    const reply = new Promise<Record<string, unknown>>((resolve, reject) => pending.set(id, { method, resolve, reject }));
    void reply.catch(() => undefined);
    try { await write({ id, method, params }); return await codexBounded(reply, limits.ioMs, "CODEX_MANAGED_RPC_DEADLINE"); }
    finally { pending.delete(id); }
  }
  function scope(params: Record<string, unknown>) {
    assert(threadId !== null && turnId !== null && params.threadId === threadId && params.turnId === turnId, "CODEX_MANAGED_NOTIFICATION_SCOPE");
  }
  function observeUsage(params: Record<string, unknown>) {
    object(params, ["threadId", "turnId", "tokenUsage"]); scope(params);
    const total = object(params.tokenUsage, ["total", "last", "modelContextWindow"]);
    if (total.modelContextWindow != null) safeInteger(total.modelContextWindow, 0, Number.MAX_SAFE_INTEGER);
    function breakdown(value: unknown) {
      const v = object(value, ["inputTokens", "outputTokens", "totalTokens", "cachedInputTokens", "reasoningOutputTokens", "cacheWriteInputTokens"]);
      for (const key of ["inputTokens", "outputTokens", "totalTokens", "cachedInputTokens", "reasoningOutputTokens"])
        safeInteger(v[key], 0, Number.MAX_SAFE_INTEGER);
      if (v.cacheWriteInputTokens !== undefined) safeInteger(v.cacheWriteInputTokens, 0, Number.MAX_SAFE_INTEGER);
      assert(Number(v.cachedInputTokens) <= Number(v.inputTokens) && Number(v.reasoningOutputTokens) <= Number(v.outputTokens)
        && Number(v.inputTokens) + Number(v.outputTokens) === v.totalTokens, "CODEX_MANAGED_USAGE_INVALID");
      return { inputTokens: Number(v.inputTokens), outputTokens: Number(v.outputTokens), totalTokens: Number(v.totalTokens) };
    }
    const next = breakdown(total.total), last = breakdown(total.last);
    for (const key of ["inputTokens", "outputTokens", "totalTokens"] as const)
      assert(next[key] >= (usage[key] ?? 0) && last[key] <= next[key], "CODEX_MANAGED_USAGE_REGRESSED");
    usage = Object.freeze(next);
  }
  async function message(raw: unknown) {
    assert(!closing, "CODEX_MANAGED_MESSAGE_AFTER_STOP"); active();
    const value = object(raw, ["id", "method", "params", "result", "error", "jsonrpc", "trace", "emittedAtMs"]);
    assert(value.jsonrpc === undefined || value.jsonrpc === "2.0", "CODEX_MANAGED_RPC_VERSION");
    if (value.emittedAtMs !== undefined) {
      assert(value.id === undefined && typeof value.method === "string", "CODEX_MANAGED_TIMESTAMP_SCOPE");
      safeInteger(value.emittedAtMs, 0, Number.MAX_SAFE_INTEGER);
    }
    if (value.trace !== undefined) {
      assert(value.id !== undefined && typeof value.method === "string", "CODEX_MANAGED_TRACE_SCOPE");
      if (value.trace !== null) for (const part of Object.values(object(value.trace, ["traceparent", "tracestate"]))) {
        if (part != null) assert(/^[\x20-\x7e]*$/u.test(boundedText(part, 512, true)), "CODEX_MANAGED_TRACE_INVALID");
      }
    }
    if (value.method === undefined) {
      assert(Number.isSafeInteger(value.id) && value.params === undefined && value.error === undefined && value.result !== undefined,
        "CODEX_MANAGED_RPC_RESPONSE");
      const entry = pending.get(Number(value.id)); assert(entry, "CODEX_MANAGED_UNEXPECTED_RPC_ID");
      const result = record(value.result);
      if (entry.method === "thread/start") {
        assert(threadId === null && process, "CODEX_MANAGED_DUPLICATE_THREAD");
        observedSettings = assertCodexManagedThreadResponse(result, { settings, cwd: process.cwd });
        threadId = identifier(record(result.thread).id); threadObserved = true;
      } else if (entry.method === "turn/start") {
        assert(threadId !== null && turnId === null, "CODEX_MANAGED_DUPLICATE_TURN");
        const id = identifier(record(result.turn).id);
        assert(earlyTurnStarts === null || earlyTurnStarts.rpcId === value.id && earlyTurnStarts.turnId === id, "CODEX_MANAGED_EARLY_TURN_MISMATCH");
        turnId = id; ledger.bind(threadId, id); earlyTurnStarts = null;
      }
      pending.delete(Number(value.id)); entry.resolve(result); return;
    }
    assert(typeof value.method === "string" && value.result === undefined && value.error === undefined, "CODEX_MANAGED_NATIVE_MESSAGE");
    const params = record(value.params ?? {});
    if (value.id !== undefined) {
      assert(typeof value.id === "string" || Number.isSafeInteger(value.id), "CODEX_MANAGED_SERVER_ID");
      const key = JSON.stringify(value.id);
      assert(key.length <= 180 && !serverIds.has(key) && serverIds.size < 1024, "CODEX_MANAGED_SERVER_ID_DUPLICATE");
      serverIds.add(key);
      assert(value.method === "item/tool/call", "CODEX_MANAGED_NATIVE_REQUEST_DENIED");
      assert(!turnCompleted && output === null, "CODEX_MANAGED_LATE_CALLBACK");
      const call = ledger.claim(params); unknownFinal = null;
      let text: string, success: boolean;
      try { text = JSON.stringify(await broker.invoke(call.name, call.input)); active(); boundedText(text, 512 * 1024); success = true; }
      catch { active(); text = JSON.stringify({ error: "TOOL_REQUEST_DENIED" }); success = false; }
      const result = ledger.respond(call.id, text, success);
      await write({ id: value.id, result }); ledger.written(call.id); return;
    }
    if (value.method === "remoteControl/status/changed") {
      const status = object(params, ["status", "serverName", "installationId", "environmentId"]);
      assert(status.status === "disabled" && status.environmentId == null, "CODEX_MANAGED_REMOTE_CONTROL_ACTIVE");
      boundedText(status.serverName, 512); boundedText(status.installationId, 512); return;
    }
    if (value.method === "item/started" || value.method === "item/completed") {
      const timestamp = value.method === "item/started" ? "startedAtMs" : "completedAtMs";
      object(params, ["threadId", "turnId", "item", timestamp]); scope(params);
      // Current native notifications carry lifecycle timestamps. Older native
      // schema omitted them; either shape has the same operation authority.
      if (params[timestamp] !== undefined) safeInteger(params[timestamp], 0, Number.MAX_SAFE_INTEGER);
      assert(!turnCompleted, "CODEX_MANAGED_ITEM_AFTER_COMPLETION");
      const item = record(params.item), id = identifier(item.id), phase = value.method === "item/started" ? "started" : "completed";
      assert(typeof item.type === "string", "CODEX_MANAGED_ITEM_TYPE");
      const prior = itemStates.get(id);
      assert(!prior || prior.type === item.type && !prior.completed && !prior[phase], "CODEX_MANAGED_ITEM_DUPLICATE");
      assert(itemStates.size < 1024 || prior, "CODEX_MANAGED_ITEM_BOUND");
      itemStates.set(id, { type: item.type, started: prior?.started ?? false, completed: prior?.completed ?? false, [phase]: true });
      if (item.type === "dynamicToolCall") {
        assert(output === null, "CODEX_MANAGED_TOOL_AFTER_FINAL"); ledger.observe(params, phase); unknownFinal = null;
      } else if (item.type === "agentMessage") {
        object(item, ["type", "id", "text", "phase", "memoryCitation", "questions", "delivery"]);
        assert(item.memoryCitation == null && item.questions == null && item.delivery == null
          && (item.phase == null || item.phase === "commentary" || item.phase === "final_answer"), "CODEX_MANAGED_MESSAGE_EXTENSION");
        const text = boundedText(item.text, request.limits.maxOutputBytes, true);
        if (phase === "completed" && item.phase !== "commentary") {
          if (item.phase === "final_answer") { assert(output === null, "CODEX_MANAGED_DUPLICATE_FINAL"); output = boundedText(text, request.limits.maxOutputBytes); }
          else { assert(output === null, "CODEX_MANAGED_MESSAGE_AFTER_FINAL"); unknownFinal = text; }
        }
      } else if (item.type === "userMessage") {
        object(item, ["type", "id", "content", "clientId"]);
        assert(Array.isArray(item.content) && item.content.length === 1, "CODEX_MANAGED_USER_CONTENT");
        const content = object(item.content[0], ["type", "text", "text_elements"]);
        assert(content.type === "text" && content.text === request.prompt
          && (content.text_elements === undefined || same(content.text_elements, [])), "CODEX_MANAGED_USER_PROMPT_CHANGED");
      } else if (item.type === "reasoning") {
        object(item, ["type", "id", "summary", "content"]);
        for (const parts of [item.summary, item.content]) if (parts !== undefined) {
          assert(Array.isArray(parts) && parts.length <= 256, "CODEX_MANAGED_REASONING_BOUND");
          for (const part of parts) boundedText(part, limits.maxFrameBytes, true);
        }
      } else throw Error("CODEX_MANAGED_NATIVE_ITEM_DENIED");
      return;
    }
    if (value.method === "turn/completed") {
      object(params, ["threadId", "turn"]); const turn = record(params.turn);
      assert(!turnCompleted && threadId !== null && turnId !== null && params.threadId === threadId
        && turn.id === turnId && turn.status === "completed" && turn.error == null, "CODEX_MANAGED_TURN_COMPLETION");
      ledger.finish(); output = boundedText(output ?? unknownFinal, request.limits.maxOutputBytes);
      turnCompleted = true; resolveDone(); return;
    }
    if (["item/agentMessage/delta", "item/reasoning/summaryTextDelta", "item/reasoning/textDelta", "item/reasoning/summaryPartAdded"].includes(value.method)) {
      object(params, ["threadId", "turnId", "itemId", "delta", "summaryIndex", "contentIndex"]); scope(params);
      assert(!turnCompleted, "CODEX_MANAGED_DELTA_AFTER_COMPLETION");
      const state = itemStates.get(identifier(params.itemId));
      assert(state?.started && !state.completed && state.type === (value.method === "item/agentMessage/delta" ? "agentMessage" : "reasoning"),
        "CODEX_MANAGED_DELTA_ITEM");
      if (params.delta !== undefined) boundedText(params.delta, limits.maxFrameBytes, true);
      for (const key of ["summaryIndex", "contentIndex"]) if (params[key] !== undefined) safeInteger(params[key], 0, 255);
      return;
    }
    if (value.method === "turn/started") {
      object(params, ["threadId", "turn"]); const id = identifier(record(params.turn).id);
      assert(!turnCompleted && threadId !== null && params.threadId === threadId, "CODEX_MANAGED_TURN_START_SCOPE");
      if (turnId === null) {
        const starts = [...pending.entries()].filter(([, entry]) => entry.method === "turn/start");
        assert(starts.length === 1, "CODEX_MANAGED_EARLY_TURN_WITHOUT_RPC");
        earlyTurnStarts ??= { rpcId: starts[0]![0], turnId: id, count: 0 };
        assert(earlyTurnStarts.rpcId === starts[0]![0] && earlyTurnStarts.turnId === id && ++earlyTurnStarts.count <= 8, "CODEX_MANAGED_EARLY_TURN_BOUND");
      } else assert(id === turnId, "CODEX_MANAGED_TURN_START_CHANGED");
      return;
    }
    if (value.method === "thread/started") { assert(threadId !== null && record(params.thread).id === threadId, "CODEX_MANAGED_THREAD_START_CHANGED"); return; }
    if (value.method === "thread/tokenUsage/updated") { observeUsage(params); return; }
    if (value.method === "thread/status/changed") {
      object(params, ["threadId", "status"]);
      assert(threadId !== null && params.threadId === threadId, "CODEX_MANAGED_THREAD_STATUS_SCOPE");
      const status = object(params.status, ["type", "activeFlags"]);
      assert(["idle", "active"].includes(String(status.type)), "CODEX_MANAGED_THREAD_STATUS");
      if (status.activeFlags !== undefined) assert(Array.isArray(status.activeFlags) && status.activeFlags.length === 0, "CODEX_MANAGED_THREAD_ACTIVE_FLAGS");
      return;
    }
    if (value.method === "account/rateLimits/updated") return;
    // Includes model rerouting, auth recovery/external-token requests, errors,
    // warnings, built-ins, approval prompts, hooks and unreviewed extensions.
    throw Error("CODEX_MANAGED_NOTIFICATION_DENIED");
  }
  const onData = (chunk: Buffer | string) => {
    if (closing || signal.aborted) return;
    try {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); stdoutBytes += bytes.length;
      assert(stdoutBytes <= 16 * 1024 * 1024, "CODEX_MANAGED_STDOUT_BOUND");
      line += decoder.decode(bytes, { stream: true });
      for (;;) {
        const end = line.indexOf("\n"); if (end === -1) break;
        const frame = line.slice(0, end); line = line.slice(end + 1);
        assert(frame.length > 0 && Buffer.byteLength(frame) <= limits.maxFrameBytes && ++frames <= limits.maxFrames, "CODEX_MANAGED_FRAME_BOUND");
        queue = queue.then(() => message(JSON.parse(frame))).catch(error => { fail(failureCode(error)); });
      }
      assert(Buffer.byteLength(line) <= limits.maxFrameBytes, "CODEX_MANAGED_PARTIAL_FRAME_BOUND");
    } catch (error) { fail(failureCode(error)); }
  };
  const onEnd = () => { if (!closing) try { line += decoder.decode(); assert(line.length === 0, "CODEX_MANAGED_TRUNCATED_FRAME"); }
    catch (error) { fail(failureCode(error)); } };
  const onError = () => fail("CODEX_MANAGED_STDIO_ERROR"), onAbort = () => fail("CODEX_MANAGED_CANCELLED");
  request.signal.addEventListener("abort", onAbort, { once: true });
  try {
    assertCapabilityProfile(broker.profile, request.profile);
    assert(request.route.provider === "codex" && request.route.authentication === "subscription"
      && request.workspaceId === broker.workspaceId && request.runId === broker.runId, "CODEX_MANAGED_REQUEST_BINDING");
    for (const value of [request.runId, request.accountId, request.workspaceId]) identifier(value);
    boundedText(request.prompt, 512 * 1024);
    safeInteger(request.limits.maxOutputBytes, 1, 64 * 1024 * 1024);
    settings = codexTaskSettings({ model: options.settings.model, instructions: options.settings.instructions });
    assert(same(settings.model, request.model) && settings.instructionDigest === options.settings.instructionDigest, "CODEX_MANAGED_SETTINGS_CHANGED");
    active();
    const remaining = safeInteger(request.executionDeadlineUnixMs - now(), 1, 3_599_999);
    const cleanup = safeInteger(request.cleanupDeadlineUnixMs - request.executionDeadlineUnixMs, 1, 3_599_999);
    object(options.limits ?? {}, ["deadlineMs", "cleanupMs", "ioMs", "maxFrames", "maxFrameBytes"]);
    const selected = codexTaskLimits({ ...options.limits, deadlineMs: options.limits?.deadlineMs ?? remaining,
      cleanupMs: options.limits?.cleanupMs ?? cleanup });
    assert(selected.deadlineMs <= request.limits.maxRunMs && selected.cleanupMs <= cleanup
      && selected.cleanupMs <= request.limits.maxCleanupMs, "CODEX_MANAGED_LIMITS_EXCEED_TASK");
    limits = Object.freeze({ ...selected, deadlineMs: Math.min(selected.deadlineMs, remaining) });
    timer = setTimeout(() => fail("CODEX_MANAGED_EXECUTION_DEADLINE"), limits.deadlineMs);
    launchAttempted = true;
    process = await options.launcher.launch({ runId: request.runId, accountId: request.accountId, workspaceId: request.workspaceId,
      configuration: codexManagedTaskConfiguration(settings), signal });
    process.stdout.on("data", onData); process.stdout.on("end", onEnd); process.stdout.on("error", onError); process.stdin.on("error", onError);
    workflow = (async () => {
      await process!.ready; active();
      await rpc("initialize", { clientInfo: { name: "agentrouter", version: "0.1.0" }, capabilities: { experimentalApi: true } });
      initialized = true; await write({ method: "initialized" });
      assertCodexManagedAccountResponse(await rpc("account/read", { refreshToken: false })); chatgptAccountObserved = true;
      assertCodexManagedConfigResponse(await rpc("config/read", { cwd: process!.cwd, includeLayers: false }), { settings, cwd: process!.cwd });
      configurationObserved = true;
      await rpc("thread/start", { model: settings.model.id, modelProvider: "openai", cwd: process!.cwd, approvalPolicy: "never",
        sandbox: "read-only", ephemeral: true, environments: [], runtimeWorkspaceRoots: [], selectedCapabilityRoots: [],
        dynamicTools: mapping.tools, baseInstructions: settings.instructions.base, developerInstructions: settings.instructions.developer,
        allowProviderModelFallback: false, ...(settings.model.serviceTier === null ? {} : { serviceTier: settings.model.serviceTier }) });
      await rpc("turn/start", { threadId, input: [{ type: "text", text: request.prompt }], model: settings.model.id,
        ...(settings.model.reasoningEffort === null ? {} : { effort: settings.model.reasoningEffort }),
        ...(settings.model.serviceTier === null ? {} : { serviceTier: settings.model.serviceTier }) });
      await Promise.race([done, fatal.then(() => { throw Error("CODEX_MANAGED_FATAL"); })]);
    })();
    await Promise.race([workflow, fatal.then(() => { throw Error("CODEX_MANAGED_FATAL"); }),
      process.exited.then(() => { if (!turnCompleted) throw Error("CODEX_MANAGED_PREMATURE_EXIT"); })]);
    assert(turnCompleted, "CODEX_MANAGED_TURN_INCOMPLETE");
    const receivedQueue = queue;
    await Promise.race([codexBounded(receivedQueue, limits.ioMs, "CODEX_MANAGED_TERMINAL_DRAIN"), fatal.then(() => { throw Error("CODEX_MANAGED_FATAL"); })]);
    assert(line.length === 0, "CODEX_MANAGED_TRUNCATED_FRAME");
    active();
  } catch (error) { fail(failureCode(error)); }
  finally {
    if (timer) clearTimeout(timer); closing = true; controller.abort(); broker.revoke();
    for (const entry of pending.values()) entry.reject(Error("CODEX_MANAGED_SESSION_CLOSED")); pending.clear();
    let allowance = 1;
    try { allowance = Math.max(1, Math.min(limits.cleanupMs, request.cleanupDeadlineUnixMs - safeInteger(now(), 0, Number.MAX_SAFE_INTEGER))); }
    catch { fail("CODEX_MANAGED_CLEANUP_CLOCK_INVALID"); }
    const begin = (action: () => Promise<unknown>) => Promise.resolve().then(action);
    const cleanups = await Promise.allSettled([
      begin(async () => { if (process) {
        processReceipt = await codexBounded(process.stopAndJoin(), allowance, "CODEX_MANAGED_PROCESS_JOIN_DEADLINE"); processJoined = true;
      } }),
      begin(async () => { await codexBounded(Promise.allSettled([workflow, queue]), allowance, "CODEX_MANAGED_HANDLER_JOIN_DEADLINE"); handlersJoined = true; }),
      begin(async () => { await codexBounded(broker.close(), allowance, "CODEX_MANAGED_BROKER_JOIN_DEADLINE"); brokerJoined = true; }),
    ]);
    for (const result of cleanups) if (result.status === "rejected") fail(failureCode(result.reason));
    if (process && processReceipt === null) try { processReceipt = process.receipt(); } catch { fail("CODEX_MANAGED_PROCESS_RECEIPT_FAILED"); }
    process?.stdout.off("data", onData); process?.stdout.off("end", onEnd); process?.stdout.off("error", onError); process?.stdin.off("error", onError);
    request.signal.removeEventListener("abort", onAbort);
  }
  const processStopped = (!launchAttempted || processJoined && processReceipt !== null && processReceipt.rootExited && processReceipt.groupAbsent
    && processReceipt.stdioJoined && processReceipt.cleanupErrors.length === 0) && handlersJoined && brokerJoined;
  if (!processStopped) fail("CODEX_MANAGED_CUSTODY_UNPROVEN");
  if (processReceipt?.runtimeErrors.length) fail("CODEX_MANAGED_NATIVE_RUNTIME_FAILED");
  const receipt: CodexManagedSessionReceipt = Object.freeze({ status: failures.length ? "failed" : "completed", productionQualified: false,
    exactToolInventoryObserved: false, initialized, chatgptAccountObserved, configurationObserved, threadObserved, turnCompleted,
    observedSettings, usage: Object.freeze(usage), calls: ledger.receipt(), process: processReceipt,
    handlersJoined, brokerJoined, processJoined, processStopped, launchAttempted, failures: Object.freeze([...failures]), frames, stdoutBytes });
  if (failures.length) throw new CodexManagedSessionError(receipt);
  return { output: output!, receipt };
}
