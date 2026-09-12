import type { ToolBroker } from "./broker.ts";
import { CODEX_BASE_INSTRUCTIONS, CODEX_DEVELOPER_INSTRUCTIONS, CODEX_PROVIDER, codexConfiguration, codexTools } from "./codex-config.ts";
import type { CodexProcessHandle, CodexProcessLauncher, CodexProcessReceipt } from "./codex-process.ts";
import { codexAssert, codexBounded, codexLimits, codexRecord, startCodexRelay,
  type CodexLimits, type CodexRelay, type CodexRelayReceipt, type CodexResponsesUpstream } from "./codex-relay.ts";
import type { AgentRunRequest } from "./runtime.ts";
import { boundedText, identifier, object } from "./validation.ts";

export type CodexSessionReceipt = Readonly<{
  status: "completed" | "failed"; productionQualified: false; initialized: boolean; turnCompleted: boolean;
  process: CodexProcessReceipt | null; relay: CodexRelayReceipt | null;
  handlersJoined: boolean; processStopped: boolean; failures: readonly string[]; frames: number; stdoutBytes: number;
  unexpectedNotification: string | null;
  failureStage: "prepare" | "initialize" | "thread/start" | "turn/start" | "turn" | "cleanup" | null;
  deniedNativeRequest: string | null;
}>;
// Diagnostic names are the finite pinned ServerRequest schema, never arbitrary native text.
const NATIVE_REQUEST_METHODS = ["item/commandExecution/requestApproval", "item/fileChange/requestApproval", "item/tool/requestUserInput",
  "mcpServer/elicitation/request", "item/permissions/requestApproval", "item/tool/call", "account/chatgptAuthTokens/refresh",
  "attestation/generate", "currentTime/read", "applyPatchApproval", "execCommandApproval"];
export class CodexSessionError extends Error {
  constructor(readonly receipt: CodexSessionReceipt) { super("CODEX_SESSION_FAILED"); }
}
/** Low-level unqualified driver. Native ownership and upstream access are explicit trusted ports.
 * No module import, account discovery, adapter registration or credential-bearing network operation.
 */
export async function runCodexSession(options: {
  request: AgentRunRequest; broker: ToolBroker; upstream: CodexResponsesUpstream;
  launcher: CodexProcessLauncher; limits?: Partial<CodexLimits>;
}): Promise<{ output: unknown; receipt: CodexSessionReceipt }> {
  const request = Object.freeze({ ...options.request }), broker = options.broker, launcher = options.launcher, upstream = options.upstream;
  const limits = codexLimits(options.limits), controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, request.signal]);
  const failures: string[] = []; let resolveFatal!: () => void;
  const fatal = new Promise<void>(resolve => { resolveFatal = resolve; });
  let stage: NonNullable<CodexSessionReceipt["failureStage"]> = "prepare", failureStage: CodexSessionReceipt["failureStage"] = null;
  let deniedNativeRequest: string | null = null;
  function fail(code: string) {
    failureStage ??= stage;
    if (failures.length < 16 && !failures.includes(code)) failures.push(code); controller.abort(new Error(code)); resolveFatal();
  }
  function failureCode(error: unknown) {
    if (error instanceof SyntaxError) return "CODEX_INVALID_JSON";
    if (error instanceof Error) {
      if (/^CODEX_[A-Z_]+$/u.test(error.message)) return error.message;
      if (["INVALID_OBJECT", "UNKNOWN_FIELD", "INVALID_TEXT", "INVALID_IDENTIFIER", "INVALID_INTEGER"].includes(error.message)) return `CODEX_${error.message}`;
    }
    return "CODEX_OPERATION_FAILED";
  }
  let process: CodexProcessHandle | null = null, relay: CodexRelay | null = null, output: unknown;
  let processReceipt: CodexProcessReceipt | null = null, relayReceipt: CodexRelayReceipt | null = null;
  let initialized = false, turnCompleted = false, handlersJoined = false, closing = false;
  let threadId: string | null = null, turnId: string | null = null, resolveDone!: () => void;
  const done = new Promise<void>(resolve => { resolveDone = resolve; });
  let frames = 0, stdoutBytes = 0, line = "", requestId = 0;
  let unexpectedNotification: string | null = null;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const pending = new Map<number, { method: string; resolve(value: Record<string, unknown>): void; reject(error: Error): void }>();
  // Core can emit turn/started from its task before the turn/start RPC reply.
  // Retain bounded observations, never derive active turn authority from them.
  let earlyTurnStarts: { rpcId: number; turnId: string; notifications: Record<string, unknown>[] } | null = null;
  const serverIds = new Set<string>(), itemIds = new Set<string>();
  let queue: Promise<void> = Promise.resolve(), workflow: Promise<void> = Promise.resolve();
  const onAbort = () => fail("CODEX_CANCELLED");
  request.signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => fail("CODEX_SESSION_DEADLINE"), limits.deadlineMs);
  async function write(value: unknown) {
    signal.throwIfAborted(); codexAssert(process && !process.stdin.destroyed, "CODEX_STDIN_UNAVAILABLE");
    const encoded = JSON.stringify(value) + "\n"; codexAssert(Buffer.byteLength(encoded) <= limits.maxFrameBytes, "CODEX_WRITE_FRAME_BOUND");
    await codexBounded(new Promise<void>((resolve, reject) => process!.stdin.write(encoded,
      error => error ? reject(new Error("CODEX_STDIN_WRITE_FAILED")) : resolve())), limits.ioMs, "CODEX_WRITE_DEADLINE");
  }
  async function rpc(method: string, params: unknown): Promise<Record<string, unknown>> {
    codexAssert(pending.size < 4, "CODEX_PENDING_RPC_BOUND"); const id = ++requestId;
    const reply = new Promise<Record<string, unknown>>((resolve, reject) => pending.set(id, { method, resolve, reject }));
    void reply.catch(() => {});
    try { await write({ id, method, params }); return await codexBounded(reply, limits.ioMs, "CODEX_RPC_DEADLINE"); }
    finally { pending.delete(id); }
  }
  function boundNotification(params: Record<string, unknown>) {
    codexAssert(threadId !== null && params.threadId === threadId && turnId !== null && params.turnId === turnId, "CODEX_NOTIFICATION_SCOPE_MISMATCH");
  }
  async function message(raw: unknown) {
    codexAssert(!closing && !signal.aborted, "CODEX_MESSAGE_AFTER_STOP");
    const value = object(raw, ["id", "method", "params", "result", "error", "jsonrpc", "trace", "emittedAtMs"]);
    codexAssert(value.jsonrpc === undefined || value.jsonrpc === "2.0", "CODEX_RPC_VERSION_INVALID");
    // The pinned app-server timestamps ServerNotificationEnvelope only. This
    // metadata grants no operation and never supplies ordering or scope authority.
    if (value.emittedAtMs !== undefined) {
      codexAssert(value.id === undefined && typeof value.method === "string" && value.result === undefined && value.error === undefined,
        "CODEX_TIMESTAMP_ON_NONNOTIFICATION");
      codexAssert(typeof value.emittedAtMs === "number" && Number.isSafeInteger(value.emittedAtMs) && value.emittedAtMs >= 0,
        "CODEX_NOTIFICATION_TIMESTAMP_INVALID");
    }
    // Pinned JSONRPCRequest alone permits W3C trace metadata. It grants no operation
    // and is never forwarded into the broker, upstream request or diagnostic receipt.
    if (value.trace !== undefined) {
      codexAssert(value.id !== undefined && typeof value.method === "string", "CODEX_TRACE_ON_NONREQUEST");
      if (value.trace !== null) {
        const trace = object(value.trace, ["traceparent", "tracestate"]);
        for (const field of [trace.traceparent, trace.tracestate]) if (field != null) {
          const text = boundedText(field, 512, true);
          codexAssert(/^[\x20-\x7e]*$/u.test(text), "CODEX_TRACE_FIELD_INVALID");
        }
      }
    }
    if (value.method === undefined) {
      codexAssert(Number.isSafeInteger(value.id) && value.params === undefined && value.error === undefined && value.result !== undefined,
        "CODEX_RPC_RESPONSE_INVALID");
      const entry = pending.get(value.id as number); codexAssert(entry, "CODEX_UNEXPECTED_RPC_ID");
      const result = codexRecord(value.result);
      // Bind synchronously in the response handler, before a following frame can claim this scope.
      if (entry.method === "thread/start") {
        codexAssert(threadId === null, "CODEX_DUPLICATE_THREAD"); threadId = identifier(codexRecord(result.thread).id);
      } else if (entry.method === "turn/start") {
        codexAssert(threadId !== null && turnId === null, "CODEX_DUPLICATE_TURN");
        const confirmedTurnId = identifier(codexRecord(result.turn).id);
        const deferred = earlyTurnStarts;
        codexAssert(deferred === null || (deferred.rpcId === value.id && deferred.turnId === confirmedTurnId), "CODEX_EARLY_TURN_REPLY_MISMATCH");
        turnId = confirmedTurnId; relay!.bindTurn(threadId, turnId); earlyTurnStarts = null;
        // The pending RPC stays reachable for cleanup if validation/replay fails.
        for (const notification of deferred?.notifications ?? []) await message(notification);
      }
      pending.delete(value.id as number); entry.resolve(result); return;
    }
    codexAssert(typeof value.method === "string" && value.result === undefined && value.error === undefined, "CODEX_NATIVE_MESSAGE_INVALID");
    const params = codexRecord(value.params ?? {});
    if (value.id !== undefined) {
      codexAssert(typeof value.id === "string" || Number.isSafeInteger(value.id), "CODEX_SERVER_REQUEST_ID_INVALID");
      const key = JSON.stringify(value.id); codexAssert(key.length <= 180 && !serverIds.has(key), "CODEX_DUPLICATE_SERVER_REQUEST_ID"); serverIds.add(key);
      if (value.method !== "item/tool/call") {
        deniedNativeRequest = NATIVE_REQUEST_METHODS.includes(value.method) ? value.method : "unrecognized";
        throw new Error("CODEX_FORBIDDEN_SERVER_REQUEST");
      }
      // A terminal turn cannot acquire another broker effect while queued frames drain.
      codexAssert(!turnCompleted, "CODEX_REQUEST_AFTER_TURN_COMPLETION");
      const call = relay!.claimCall(params);
      let text: string, success: boolean;
      try {
        const result = await broker.invoke(call.name, call.input); signal.throwIfAborted();
        text = JSON.stringify(result); boundedText(text, 512 * 1024); success = true;
      } catch {
        signal.throwIfAborted(); text = JSON.stringify({ error: "TOOL_REQUEST_DENIED" }); success = false;
      }
      await relay!.completeCall(call.id, text, success, () => write({ id: value.id,
        result: { success, contentItems: [{ type: "inputText", text }] } }));
      return;
    }
    // Emitted immediately after initialize even with remote control disabled.
    // Active/error states stay fatal; identities are validated then discarded.
    if (value.method === "remoteControl/status/changed") {
      const status = object(params, ["status", "serverName", "installationId", "environmentId"]);
      codexAssert(status.status === "disabled" && status.environmentId == null, "CODEX_REMOTE_CONTROL_NOT_DISABLED");
      boundedText(status.serverName, 512); boundedText(status.installationId, 512);
      return;
    }
    if (value.method === "item/started" || value.method === "item/completed") {
      boundNotification(params); const item = codexRecord(params.item);
      const phase = value.method === "item/started" ? "started" : "completed";
      if (item.type === "dynamicToolCall") relay!.observeTool(params, phase);
      else if (item.type === "agentMessage" || item.type === "userMessage") {
        const key = `${phase}:${identifier(item.id)}`; codexAssert(!itemIds.has(key), "CODEX_DUPLICATE_ITEM"); itemIds.add(key);
        if (item.type === "agentMessage" && phase === "completed") relay!.observeFinal(item.text);
      } else throw new Error("CODEX_FORBIDDEN_NATIVE_ITEM");
      return;
    }
    if (value.method === "turn/completed") {
      const turn = codexRecord(params.turn);
      codexAssert(!turnCompleted && params.threadId === threadId && turn.id === turnId && turn.status === "completed" && turn.error == null,
        "CODEX_TURN_COMPLETION_INVALID");
      output = relay!.result(); turnCompleted = true; resolveDone(); return;
    }
    if (value.method === "item/agentMessage/delta") { boundNotification(params); boundedText(params.delta, limits.maxFrameBytes, true); return; }
    if (value.method === "turn/started") {
      const turn = codexRecord(params.turn);
      if (turnId === null) {
        const starts = [...pending.entries()].filter(([, entry]) => entry.method === "turn/start");
        codexAssert(starts.length === 1 && threadId !== null && params.threadId === threadId, "CODEX_EARLY_TURN_WITHOUT_REQUEST");
        const candidateTurnId = identifier(turn.id), rpcId = starts[0]![0];
        earlyTurnStarts ??= { rpcId, turnId: candidateTurnId, notifications: [] };
        codexAssert(earlyTurnStarts.rpcId === rpcId && earlyTurnStarts.turnId === candidateTurnId, "CODEX_EARLY_TURN_SCOPE_MISMATCH");
        codexAssert(earlyTurnStarts.notifications.length < 8, "CODEX_EARLY_TURN_BOUND");
        earlyTurnStarts.notifications.push(value); return;
      }
      codexAssert(params.threadId === threadId && turn.id === turnId, "CODEX_TURN_STARTED_MISMATCH"); return;
    }
    if (value.method === "thread/started") {
      codexAssert(codexRecord(params.thread).id === threadId, "CODEX_THREAD_STARTED_MISMATCH"); return;
    }
    if (value.method === "thread/status/changed" || value.method === "thread/tokenUsage/updated") {
      codexAssert(params.threadId === threadId, "CODEX_THREAD_NOTIFICATION_MISMATCH"); return;
    }
    // These notifications carry no operations. Bounds still cover their whole frames.
    if (["account/rateLimits/updated", "model/rerouted"].includes(value.method)) {
      codexAssert(value.method !== "model/rerouted", "CODEX_MODEL_REROUTED"); return;
    }
    unexpectedNotification ??= /^[a-zA-Z][a-zA-Z_/]{0,119}$/u.test(value.method) ? value.method : "invalid-method";
    throw new Error("CODEX_UNREVIEWED_NOTIFICATION");
  }
  const onData = (chunk: Buffer | string) => {
    if (closing || signal.aborted) return;
    try {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); stdoutBytes += bytes.length;
      codexAssert(stdoutBytes <= 16 * 1024 * 1024, "CODEX_STDOUT_TOTAL_BOUND");
      try { line += decoder.decode(bytes, { stream: true }); } catch { throw new Error("CODEX_INVALID_UTF8"); }
      while (line.includes("\n")) {
        const end = line.indexOf("\n"), frame = line.slice(0, end); line = line.slice(end + 1);
        codexAssert(frame.length > 0 && Buffer.byteLength(frame) <= limits.maxFrameBytes && ++frames <= limits.maxFrames, "CODEX_READ_FRAME_BOUND");
        queue = queue.then(() => message(JSON.parse(frame))).catch(error => { fail(failureCode(error)); });
      }
      codexAssert(Buffer.byteLength(line) <= limits.maxFrameBytes, "CODEX_PARTIAL_FRAME_BOUND");
    } catch (error) { fail(failureCode(error)); }
  };
  const onEnd = () => { try { line += decoder.decode(); if (line) fail("CODEX_TRUNCATED_FRAME"); } catch { fail("CODEX_INVALID_UTF8"); } };
  const onError = () => fail("CODEX_STDIO_ERROR");
  try {
    identifier(request.runId); identifier(request.accountId); identifier(request.workspaceId); boundedText(request.prompt, 512 * 1024); boundedText(request.model, 160);
    codexAssert(request.provider === "codex" && ["classify", "respond"].includes(request.purpose), "CODEX_REQUEST_INVALID");
    codexAssert(request.workspaceId === broker.workspaceId && request.runId === broker.runId, "CODEX_BROKER_SCOPE_MISMATCH");
    codexAssert(request.purpose !== "classify" || broker.tools.length === 0, "CODEX_CLASSIFIER_TOOLS_FORBIDDEN"); signal.throwIfAborted();
    const tools = codexTools([...broker.tools]);
    relay = startCodexRelay({ model: request.model, prompt: request.prompt, tools, upstream, signal, limits, fail });
    // The launcher owns preparation cancellation and must return an owned handle once it spawns.
    process = await launcher.launch({ runId: request.runId, accountId: request.accountId, workspaceId: request.workspaceId,
      configuration: codexConfiguration(request.model, relay.baseUrl), relayPort: relay.port, signal });
    process.stdout.on("data", onData); process.stdout.on("end", onEnd); process.stdout.on("error", onError); process.stdin.on("error", onError);
    workflow = (async () => {
      await process!.ready; signal.throwIfAborted();
      stage = "initialize";
      await rpc("initialize", { clientInfo: { name: "agentrouter", version: "0.1.0" }, capabilities: { experimentalApi: true } }); initialized = true;
      await write({ method: "initialized", params: {} });
      stage = "thread/start";
      await rpc("thread/start", { model: request.model, modelProvider: CODEX_PROVIDER, cwd: process!.cwd, approvalPolicy: "never",
        sandbox: "read-only", ephemeral: true, environments: [], dynamicTools: tools,
        baseInstructions: CODEX_BASE_INSTRUCTIONS, developerInstructions: CODEX_DEVELOPER_INSTRUCTIONS,
        allowProviderModelFallback: false });
      stage = "turn/start";
      await rpc("turn/start", { threadId, input: [{ type: "text", text: request.prompt }] });
      stage = "turn";
      await Promise.race([done, fatal.then(() => { throw new Error("CODEX_FATAL"); })]);
    })();
    await Promise.race([workflow, fatal.then(() => { throw new Error("CODEX_FATAL"); }),
      process.exited.then(() => { if (!turnCompleted) throw new Error("CODEX_PREMATURE_EXIT"); })]);
    codexAssert(turnCompleted, "CODEX_TURN_NOT_COMPLETED");
    // Completion may share a stdout chunk with trailing notifications. Drain the
    // queue already received at this point before setting closing/aborting it.
    // Snapshot once: no self-queue await and no loop following future input.
    const receivedQueue = queue;
    await Promise.race([codexBounded(receivedQueue, limits.ioMs, "CODEX_TERMINAL_DRAIN_DEADLINE"),
      fatal.then(() => { throw new Error("CODEX_FATAL"); })]);
    signal.throwIfAborted();
  } catch (error) { fail(failureCode(error)); }
  finally {
    clearTimeout(timer); stage = "cleanup"; closing = true; controller.abort(new Error("CODEX_SESSION_CLOSED")); broker.revoke();
    earlyTurnStarts = null;
    for (const entry of pending.values()) entry.reject(new Error("CODEX_SESSION_CLOSED")); pending.clear();
    // Attempt every cleanup independently; a blocked provider read never prevents child/server stop.
    const cleanups = await Promise.allSettled([
      process ? process.stopAndJoin().then(value => { processReceipt = value; }) : Promise.resolve(),
      relay ? relay.close().then(value => { relayReceipt = value; }) : Promise.resolve(),
      codexBounded(Promise.allSettled([workflow, queue]), limits.cleanupMs, "CODEX_HANDLER_JOIN_DEADLINE").then(() => { handlersJoined = true; }),
    ]);
    cleanups.forEach(result => { if (result.status === "rejected") fail(failureCode(result.reason)); });
    if (process && processReceipt === null) processReceipt = process.receipt();
    if (relay && relayReceipt === null) relayReceipt = relay.receipt();
    process?.stdout.off("data", onData); process?.stdout.off("end", onEnd); process?.stdout.off("error", onError); process?.stdin.off("error", onError);
    request.signal.removeEventListener("abort", onAbort);
  }
  const stopped = processReceipt !== null && processReceipt.rootExited && processReceipt.groupAbsent && processReceipt.stdioJoined
    && processReceipt.cleanupErrors.length === 0 && relayReceipt?.joined === true && handlersJoined;
  if (processReceipt?.runtimeErrors.length) fail("CODEX_NATIVE_RUNTIME_FAILED");
  if (!stopped) fail("CODEX_CUSTODY_UNPROVEN");
  const receipt: CodexSessionReceipt = Object.freeze({ status: failures.length === 0 ? "completed" : "failed", productionQualified: false,
    initialized, turnCompleted, process: processReceipt, relay: relayReceipt, handlersJoined, processStopped: stopped,
    failures: Object.freeze([...failures]), frames, stdoutBytes, unexpectedNotification, failureStage, deniedNativeRequest });
  if (failures.length) throw new CodexSessionError(receipt);
  return { output, receipt };
}
