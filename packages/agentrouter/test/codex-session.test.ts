import { describe, expect, test } from "bun:test";
import { PassThrough, Writable } from "node:stream";
import { BROKER_TOOL_NAMES, type BrokerToolName, type ToolBroker } from "../src/broker.ts";
import { CODEX_BASE_INSTRUCTIONS, CODEX_TOOL_NAMES, codexConfiguration, codexResponseTools, codexTools } from "../src/codex-config.ts";
import type { CodexProcessLauncher, CodexProcessReceipt } from "../src/codex-process.ts";
import { CodexSessionError, runCodexSession, type CodexSessionReceipt } from "../src/codex-session.ts";
import type { CodexResponsesUpstream } from "../src/codex-relay.ts";

const MODEL = "gpt-5", PROMPT = "Synthetic contact only; return JSON.";
const sse = (index: number, item: unknown) => new Response([
  { type: "response.created", response: { id: `response-${index}` } },
  { type: "response.output_item.done", item },
  { type: "response.completed", response: { id: `response-${index}`, usage: { input_tokens: 11, output_tokens: 2, total_tokens: 13 } } },
].map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
const final = { type: "message", role: "assistant", id: "final-1", content: [{ type: "output_text", text: '{"answer":"done"}' }] };
const defaultArgs: Record<BrokerToolName, unknown> = {
  "files.read": { path: "MEMORY.md" }, "files.write": { path: "MEMORY.md", text: "new", expectedRevision: "old" },
  "web.fetch": { url: "https://example.com", maxBytes: 128 }, "messages.propose_text": { text: "hello", idempotencyKey: "text-1" },
  "messages.propose_reaction": { messageId: "message-1", reaction: "like", idempotencyKey: "reaction-1" },
  "messages.propose_attachment": { path: "outbox/note.txt", caption: "note", idempotencyKey: "attachment-1" },
};
type PeerOptions = {
  names?: readonly BrokerToolName[]; classify?: boolean;
  mutateBody?(body: Record<string, any>, request: number): void;
  mutateCall?(params: Record<string, any>): void;
  mutateItem?(item: Record<string, any>, index: number): void;
  unknownRequest?: boolean; duplicateRpcId?: boolean; groupAbsent?: boolean; truncated?: boolean;
  invoke?(name: unknown, input: unknown): Promise<unknown>;
  maxRequests?: number; deadlineMs?: number;
  ioMs?: number; runtimeError?: boolean; response?: () => Promise<Response>;
  mutateEnvelope?(envelope: Record<string, any>): void; malformedThreadReply?: boolean;
  earlyTurnStarts?: readonly string[]; orphanTurnStart?: boolean; earlyForbiddenRequest?: boolean; turnStartedAfterReply?: boolean;
  startupNotifications?: readonly Record<string, unknown>[];
  terminalNotifications?: readonly Record<string, unknown>[]; terminalPartial?: string; abortAtTerminalWrite?: boolean;
};
/** Synthetic streams exercise the protocol driver. They make no native/confinement claim. */
function peer(options: PeerOptions = {}) {
  const names = options.names ?? (options.classify ? [] : ["files.read"]), invocations: unknown[] = [], submitted: unknown[] = [];
  let upstreamRequests = 0, revoked = false, stopped = false, endpoint = "", httpIndex = 0, callbackId = 100;
  let currentItem: Record<string, any> | null = null, currentParams: Record<string, any> | null = null;
  let resolveExit!: () => void; const exited = new Promise<void>(resolve => { resolveExit = resolve; });
  const stdout = new PassThrough(), network = new Set<Promise<unknown>>();
  const controller = new AbortController();
  const receipt = (): CodexProcessReceipt => ({ nativeVersion: "synthetic", executableSha256: "fixture", runtimeSnapshotSha256: "fixture",
    parentRuntimeSha256: "a".repeat(64), scratchContentSha256: "b".repeat(64), scratchIdentitySha256: "c".repeat(64),
    configSha256: "fixture", profileSha256: "fixture", custodyPath: "fixture", pid: 1, pgid: 1, rootExited: stopped,
    groupAbsent: stopped && options.groupAbsent !== false, stdioJoined: stopped, scratchRetained: !stopped,
    nativeExitCode: stopped ? 0 : null, nativeExitSignal: null, cleanupErrors: [], runtimeErrors: options.runtimeError ? ["CODEX_STDOUT_BOUND"] : [] });
  const input: unknown[] = [{ type: "message", role: "user", content: [{ type: "input_text", text: PROMPT }] }];
  const emit = (value: Record<string, any>) => { options.mutateEnvelope?.(value); if (!stdout.destroyed) stdout.write(JSON.stringify(value) + "\n"); };
  const scoped = (item: unknown) => ({ threadId: "thread-1", turnId: "turn-1", item });
  function nextResponse() {
    const operation = (async () => {
      const number = ++httpIndex;
      const body: Record<string, any> = { model: MODEL, instructions: CODEX_BASE_INSTRUCTIONS, input: structuredClone(input),
        tools: codexResponseTools(codexTools(names)), tool_choice: "auto", parallel_tool_calls: true, reasoning: null,
        store: false, stream: true, include: [] };
      options.mutateBody?.(body, number);
      const response = await fetch(`${endpoint}/responses`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
      const bytes = await response.text(); if (!response.ok || stopped) return;
      const events = bytes.trim().split("\n\n").map(block => JSON.parse(block.split("\ndata: ")[1]!));
      const item = events[1].item;
      if (item.type === "function_call") {
        currentItem = item; input.push(item);
        const params = { threadId: "thread-1", turnId: "turn-1", callId: item.call_id, tool: item.name, arguments: JSON.parse(item.arguments), namespace: null };
        currentParams = params;
        emit({ method: "item/started", params: scoped({ type: "dynamicToolCall", id: item.call_id, tool: item.name, arguments: params.arguments,
          namespace: null, status: "inProgress" }) });
        const changed = structuredClone(params); options.mutateCall?.(changed);
        emit({ id: options.duplicateRpcId ? 100 : callbackId++, method: options.unknownRequest ? "item/commandExecution/requestApproval" : "item/tool/call", params: changed });
      } else {
        emit({ method: "item/completed", params: scoped({ type: "agentMessage", id: item.id, text: item.content[0].text }) });
        const terminal = { method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed", error: null } } };
        if (options.terminalNotifications || options.terminalPartial !== undefined || options.abortAtTerminalWrite) {
          const frames = [terminal, ...structuredClone(options.terminalNotifications ?? [])];
          for (const frame of frames) options.mutateEnvelope?.(frame);
          // One actual stream write reproduces receipt-before-handler completion.
          stdout.write(frames.map(frame => JSON.stringify(frame) + "\n").join("") + (options.terminalPartial ?? ""));
          if (options.abortAtTerminalWrite) controller.abort(new Error("synthetic terminal cancellation"));
          if (options.terminalPartial !== undefined) stdout.end();
        } else emit(terminal);
      }
    })();
    network.add(operation); void operation.finally(() => network.delete(operation)).catch(() => {});
  }
  const stdin = new Writable({ write(chunk, _encoding, callback) {
    const message = JSON.parse(chunk.toString());
    if (message.method === "initialize") {
      emit({ id: message.id, result: { userAgent: "synthetic" } });
      for (const notification of options.startupNotifications ?? []) emit(structuredClone(notification));
    }
    if (message.method === "thread/start") {
      expect(message.params.cwd).toBe("/synthetic/scratch"); expect(message.params.environments).toEqual([]);
      if (options.orphanTurnStart) emit({ method: "turn/started", params: { threadId: "thread-1", turn: { id: "turn-1" } } });
      if (options.malformedThreadReply) stdout.write("{invalid-json}\n");
      else emit({ id: message.id, result: { thread: { id: "thread-1" } } });
    }
    if (message.method === "turn/start") {
      for (const id of options.earlyTurnStarts ?? []) emit({ method: "turn/started", params: { threadId: "thread-1", turn: { id } } });
      if (options.earlyForbiddenRequest) emit({ id: 999, method: "item/commandExecution/requestApproval", params: { threadId: "thread-1", turnId: "turn-1" } });
      emit({ id: message.id, result: { turn: { id: "turn-1" } } });
      if (options.turnStartedAfterReply) emit({ method: "turn/started", params: { threadId: "thread-1", turn: { id: "turn-1" } } });
      if (options.truncated) { stdout.write('{"method":'); stdout.end(); } else setTimeout(nextResponse, 0);
    }
    if (message.result?.contentItems) {
      const text = message.result.contentItems[0].text; submitted.push(message.result);
      input.push({ type: "function_call_output", call_id: currentItem!.call_id, output: text });
      emit({ method: "item/completed", params: scoped({ type: "dynamicToolCall", id: currentItem!.call_id, tool: currentItem!.name,
        arguments: currentParams!.arguments, namespace: null, status: message.result.success ? "completed" : "failed", success: message.result.success, contentItems: message.result.contentItems }) });
      // Deliberately issue HTTP before the host's response write callback to test that race.
      nextResponse(); setTimeout(callback, 5); return;
    }
    callback();
  } });
  const launcher: CodexProcessLauncher = { async launch(config) {
    endpoint = JSON.parse(config.configuration.split("\n").find(line => line.startsWith("base_url = "))!.slice(11));
    expect(config.relayPort).toBe(Number(new URL(endpoint).port));
    return { cwd: "/synthetic/scratch", stdin, stdout, ready: Promise.resolve(), exited, receipt,
      async stopAndJoin() { stopped = true; stdin.end(); stdout.end(); resolveExit(); await Promise.allSettled([...network]); return receipt(); } };
  } };
  const upstream: CodexResponsesUpstream = { async request(body, signal) {
    signal.throwIfAborted(); const index = ++upstreamRequests;
    expect(body.model).toBe(MODEL); expect(body.parallel_tool_calls).toBe(false);
    expect(body.tools).toEqual(codexResponseTools(codexTools(names)));
    const name = names[index - 1];
    const item = name ? { type: "function_call", call_id: `call-${index}`, name: CODEX_TOOL_NAMES[name], arguments: JSON.stringify(defaultArgs[name]) } : structuredClone(final);
    options.mutateItem?.(item, index); return options.response ? options.response() : sse(index, item);
  } };
  const broker: ToolBroker = { workspaceId: "contact-1", runId: "run-1", tools: names, revoke() { revoked = true; },
    async invoke(name, value) { invocations.push({ name, value }); return options.invoke ? options.invoke(name, value) : { revision: "revision-1", text: "synthetic" }; } };
  async function run() {
    return runCodexSession({ launcher, upstream, broker, request: { runId: "run-1", workspaceId: "contact-1", accountId: "account-1", provider: "codex",
      purpose: options.classify ? "classify" : "respond", model: MODEL, prompt: PROMPT, signal: controller.signal },
      limits: { deadlineMs: options.deadlineMs ?? 2000, ioMs: options.ioMs ?? 500, cleanupMs: 100, ...(options.maxRequests ? { maxRequests: options.maxRequests } : {}) } });
  }
  return { run, invocations, submitted, count: () => upstreamRequests, revoked: () => revoked, stopped: () => stopped };
}
async function failure(run: () => Promise<unknown>): Promise<CodexSessionReceipt> {
  try { await run(); throw new Error("Expected session rejection"); }
  catch (error) { expect(error).toBeInstanceOf(CodexSessionError); return (error as CodexSessionError).receipt; }
}
describe("Codex closed driver", () => {
  const terminalInert = () => Array.from({ length: 8 }, (_, index) => index % 2 === 0
    ? { method: "thread/status/changed", params: { threadId: "thread-1", status: { type: "idle" } } }
    : { method: "thread/tokenUsage/updated", params: { threadId: "thread-1", turnId: "turn-1", tokenUsage: {
      total: { inputTokens: 11, cachedInputTokens: 0, outputTokens: 2, reasoningOutputTokens: 0, totalTokens: 13 },
      last: { inputTokens: 11, cachedInputTokens: 0, outputTokens: 2, reasoningOutputTokens: 0, totalTokens: 13 }, modelContextWindow: null,
    } } });
  test("drains eight already-received inert notifications after terminal completion", async () => {
    const fixture = peer({ terminalNotifications: terminalInert() }); const result = await fixture.run();
    expect(result.output).toEqual({ answer: "done" }); expect(result.receipt.turnCompleted).toBe(true);
    expect(result.receipt.failures).toEqual([]); expect(result.receipt.handlersJoined).toBe(true);
    expect(result.receipt.processStopped).toBe(true); expect(fixture.invocations).toHaveLength(1);
  });
  test.each([
    { kind: "warning", expected: "CODEX_UNREVIEWED_NOTIFICATION" },
    { kind: "foreign-thread", expected: "CODEX_THREAD_NOTIFICATION_MISMATCH" },
    { kind: "forbidden-request", expected: "CODEX_FORBIDDEN_SERVER_REQUEST" },
    { kind: "tool-request", expected: "CODEX_REQUEST_AFTER_TURN_COMPLETION" },
  ])("terminal drain retains fatal validation for $kind", async ({ kind, expected }) => {
    const denied: Record<string, unknown> = kind === "warning"
      ? { method: "warning", params: { threadId: "thread-1", message: "synthetic terminal warning" } }
      : kind === "foreign-thread" ? { method: "thread/status/changed", params: { threadId: "foreign", status: { type: "idle" } } }
      : { id: 999, method: kind === "tool-request" ? "item/tool/call" : "item/commandExecution/requestApproval",
        params: { threadId: "thread-1", turnId: "turn-1", callId: "call-1", tool: CODEX_TOOL_NAMES["files.read"], arguments: { path: "MEMORY.md" }, namespace: null } };
    const fixture = peer({ terminalNotifications: [...terminalInert(), denied] }); const receipt = await failure(fixture.run);
    expect(receipt.failures).toContain(expected); expect(receipt.turnCompleted).toBe(true);
    expect(receipt.handlersJoined).toBe(true); expect(receipt.processStopped).toBe(true);
    expect(fixture.invocations).toHaveLength(1); expect(fixture.submitted).toHaveLength(1);
  });
  test("cancellation with a buffered terminal batch remains fatal and joined", async () => {
    const fixture = peer({ terminalNotifications: terminalInert(), abortAtTerminalWrite: true }); const receipt = await failure(fixture.run);
    expect(receipt.failures).toContain("CODEX_CANCELLED"); expect(receipt.status).toBe("failed");
    expect(receipt.handlersJoined).toBe(true); expect(receipt.processStopped).toBe(true); expect(fixture.invocations).toHaveLength(1);
  });
  test("a truncated trailing frame cannot turn completion into success", async () => {
    const fixture = peer({ terminalNotifications: terminalInert(), terminalPartial: '{"method":' }); const receipt = await failure(fixture.run);
    expect(receipt.failures).toContain("CODEX_TRUNCATED_FRAME"); expect(receipt.status).toBe("failed");
    expect(receipt.handlersJoined).toBe(true); expect(receipt.processStopped).toBe(true); expect(fixture.invocations).toHaveLength(1);
  });
  test.each(["before", "after"])("correlates turn/started %s the exact RPC reply", async ordering => {
    const fixture = peer(ordering === "before" ? { earlyTurnStarts: ["turn-1"] } : { turnStartedAfterReply: true });
    const result = await fixture.run(); expect(result.output).toEqual({ answer: "done" });
    expect(result.receipt.processStopped).toBe(true); expect(result.receipt.failures).toEqual([]);
  });
  test("early turn notification cannot override the RPC reply's turn ID", async () => {
    const fixture = peer({ earlyTurnStarts: ["turn-other"] }); const receipt = await failure(fixture.run);
    expect(receipt.failures).toContain("CODEX_EARLY_TURN_REPLY_MISMATCH"); expect(fixture.invocations).toHaveLength(0);
    expect(receipt.handlersJoined).toBe(true); expect(receipt.processStopped).toBe(true);
  });
  test("early turn observations must have one consistent identifier", async () => {
    const fixture = peer({ earlyTurnStarts: ["turn-1", "turn-other"] }); const receipt = await failure(fixture.run);
    expect(receipt.failures).toContain("CODEX_EARLY_TURN_SCOPE_MISMATCH"); expect(fixture.invocations).toHaveLength(0);
    expect(receipt.processStopped).toBe(true);
  });
  test("notification without an exact pending turn/start cannot bind a turn", async () => {
    const fixture = peer({ orphanTurnStart: true }); const receipt = await failure(fixture.run);
    expect(receipt.failures).toContain("CODEX_EARLY_TURN_WITHOUT_REQUEST"); expect(fixture.invocations).toHaveLength(0);
    expect(receipt.processStopped).toBe(true);
  });
  test("an early notification from another thread is never deferred", async () => {
    const fixture = peer({ earlyTurnStarts: ["turn-1"], mutateEnvelope(value) {
      if (value.method === "turn/started") value.params.threadId = "thread-foreign";
    } });
    const receipt = await failure(fixture.run); expect(receipt.failures).toContain("CODEX_EARLY_TURN_WITHOUT_REQUEST");
    expect(fixture.invocations).toHaveLength(0); expect(receipt.processStopped).toBe(true);
  });
  test("early notification retention is bounded to eight frames", async () => {
    const accepted = await peer({ earlyTurnStarts: Array.from({ length: 8 }, () => "turn-1") }).run();
    expect(accepted.receipt.processStopped).toBe(true);
    const fixture = peer({ earlyTurnStarts: Array.from({ length: 9 }, () => "turn-1") }); const receipt = await failure(fixture.run);
    expect(receipt.failures).toContain("CODEX_EARLY_TURN_BOUND"); expect(fixture.invocations).toHaveLength(0); expect(receipt.processStopped).toBe(true);
  });
  test("forbidden requests are denied immediately while turn/start is pending", async () => {
    const fixture = peer({ earlyTurnStarts: ["turn-1"], earlyForbiddenRequest: true }); const receipt = await failure(fixture.run);
    expect(receipt.failures).toContain("CODEX_FORBIDDEN_SERVER_REQUEST"); expect(receipt.deniedNativeRequest).toBe("item/commandExecution/requestApproval");
    expect(fixture.invocations).toHaveLength(0); expect(receipt.processStopped).toBe(true);
  });
  test("unknown notifications are not admitted by the pending turn/start window", async () => {
    const fixture = peer({ earlyTurnStarts: ["turn-1"], mutateEnvelope(value) {
      if (value.method === "turn/started") value.method = "turn/unknown";
    } });
    const receipt = await failure(fixture.run); expect(receipt.failures).toContain("CODEX_UNREVIEWED_NOTIFICATION");
    expect(receipt.unexpectedNotification).toBe("turn/unknown"); expect(fixture.invocations).toHaveLength(0); expect(receipt.processStopped).toBe(true);
  });
  test("six serial broker tools, exact results, strict JSON and joined stop", async () => {
    const fixture = peer({ names: BROKER_TOOL_NAMES }); const result = await fixture.run();
    expect(result.output).toEqual({ answer: "done" }); expect(fixture.invocations).toHaveLength(6);
    expect(result.receipt.relay).toMatchObject({ calls: 6, requests: 7, completed: 6, outputsObserved: 6, joined: true });
    expect(result.receipt.processStopped).toBe(true); expect(result.receipt.productionQualified).toBe(false); expect(fixture.revoked()).toBe(true);
  });
  test.each([null, undefined])("timestamped disabled remote control is inert with environment %s", async environmentId => {
    const fixture = peer({ startupNotifications: [{ method: "remoteControl/status/changed", emittedAtMs: 1789210000000,
      params: { status: "disabled", serverName: "synthetic-private-host", installationId: "synthetic-installation", environmentId } }],
      mutateEnvelope(value) { if (value.method && value.id === undefined) value.emittedAtMs = 0; } });
    const result = await fixture.run(); expect(result.receipt.processStopped).toBe(true); expect(fixture.invocations).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("synthetic-private-host");
    expect(JSON.stringify(fixture.invocations)).not.toContain("synthetic-installation");
  });
  test.each(["connecting", "connected", "errored", "unknown", "environment", "extra", "identity"])("remote control remains denied: %s", async kind => {
    const params: Record<string, unknown> = { status: "disabled", serverName: "synthetic", installationId: "synthetic", environmentId: null };
    if (kind === "environment") params.environmentId = "environment-1";
    else if (kind === "extra") params.authority = true;
    else if (kind === "identity") params.installationId = " ";
    else params.status = kind;
    const fixture = peer({ startupNotifications: [{ method: "remoteControl/status/changed", params, emittedAtMs: 1 }] });
    const receipt = await failure(fixture.run); expect(receipt.processStopped).toBe(true); expect(fixture.count()).toBe(0);
    expect(fixture.invocations).toHaveLength(0);
  });
  test.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, "1"])("rejects invalid native timestamp %s", async emittedAtMs => {
    const fixture = peer({ startupNotifications: [{ method: "remoteControl/status/changed", emittedAtMs,
      params: { status: "disabled", serverName: "synthetic", installationId: "synthetic" } }] });
    const receipt = await failure(fixture.run); expect(receipt.failures).toContain("CODEX_NOTIFICATION_TIMESTAMP_INVALID");
    expect(receipt.processStopped).toBe(true); expect(fixture.count()).toBe(0);
  });
  test.each(["response", "request"])("timestamp cannot extend native %s", async kind => {
    const fixture = peer({ mutateEnvelope(value) {
      if (kind === "response" ? value.id === 1 : value.method === "item/tool/call") value.emittedAtMs = 1;
    } });
    const receipt = await failure(fixture.run); expect(receipt.failures).toContain("CODEX_TIMESTAMP_ON_NONNOTIFICATION");
    expect(fixture.invocations).toHaveLength(0); expect(receipt.processStopped).toBe(true);
  });
  test("timestamps do not admit unknown notifications or MCP servers", async () => {
    const fixture = peer({ startupNotifications: [{ method: "mcpServer/startup/status", emittedAtMs: 1, params: {} }] });
    const receipt = await failure(fixture.run); expect(receipt.failures).toContain("CODEX_UNREVIEWED_NOTIFICATION");
    expect(fixture.count()).toBe(0); expect(receipt.processStopped).toBe(true);
  });
  test("classifier accepts absent native tools, forwards explicit empty inventory", async () => {
    const fixture = peer({ classify: true, mutateBody(body) { delete body.tools; } });
    const result = await fixture.run(); expect(result.output).toEqual({ answer: "done" }); expect(fixture.invocations).toHaveLength(0);
  });
  test.each(["manifest", "model", "prompt", "instructions"])("rejects changed %s before upstream", async change => {
    const fixture = peer({ mutateBody(body) {
      if (change === "manifest") body.tools.push({ type: "function", name: "shell" });
      if (change === "model") body.model = "different";
      if (change === "prompt") body.input[0].content[0].text = "different";
      if (change === "instructions") body.instructions = "different";
    } });
    const receipt = await failure(fixture.run); expect(fixture.count()).toBe(0); expect(fixture.invocations).toHaveLength(0); expect(receipt.processStopped).toBe(true);
  });
  test.each(["threadId", "turnId", "callId", "tool", "namespace", "arguments"])("rejects forged callback %s", async key => {
    const fixture = peer({ mutateCall(params) { params[key] = key === "arguments" ? { path: "other.md" } : "forged"; } });
    const receipt = await failure(fixture.run); expect(fixture.invocations).toHaveLength(0); expect(receipt.processStopped).toBe(true);
  });
  test("unknown native request never reaches the broker", async () => {
    const fixture = peer({ unknownRequest: true }); const receipt = await failure(fixture.run);
    expect(receipt.failures).toContain("CODEX_FORBIDDEN_SERVER_REQUEST"); expect(fixture.invocations).toHaveLength(0);
  });
  test.each(["unknown", "duplicate"])("rejects %s model tool before releasing bytes", async mode => {
    const fixture = peer({ names: ["files.read", "files.write"], mutateItem(item, index) {
      if (mode === "unknown") item.name = "shell";
      else if (index === 2) item.call_id = "call-1";
    } });
    const receipt = await failure(fixture.run); expect(fixture.invocations).toHaveLength(mode === "unknown" ? 0 : 1);
    expect(receipt.relay?.failure).toBe("CODEX_MODEL_TOOL_DENIED");
  });
  test("duplicate native request ID fails even for a separately admitted call", async () => {
    const fixture = peer({ names: ["files.read", "files.write"], duplicateRpcId: true });
    const receipt = await failure(fixture.run); expect(receipt.failures).toContain("CODEX_DUPLICATE_SERVER_REQUEST_ID"); expect(fixture.invocations).toHaveLength(1);
  });
  test("host file denial returns a closed error and can complete honestly", async () => {
    const fixture = peer({ invoke: async () => { throw new Error("private path must never cross IPC"); } });
    const result = await fixture.run(); expect(result.receipt.processStopped).toBe(true);
    expect(fixture.submitted).toEqual([{ success: false, contentItems: [{ type: "inputText", text: '{"error":"TOOL_REQUEST_DENIED"}' }] }]);
  });
  test("changed previous broker result is rejected before the next upstream request", async () => {
    const fixture = peer({ mutateBody(body, index) { if (index === 2) body.input.at(-1).output = "changed"; } });
    const receipt = await failure(fixture.run); expect(fixture.count()).toBe(1); expect(receipt.relay?.failure).toBe("CODEX_BROKER_OUTPUT_MISMATCH");
  });
  test("native output IDs and exact tool names stay bound across the full history", async () => {
    const fixture = peer({ names: ["files.read", "files.write"], mutateBody(body) {
      for (const item of body.input) if (item.type === "function_call_output") {
        item.id = `fco-${item.call_id}`;
        item.name = item.call_id === "call-1" ? CODEX_TOOL_NAMES["files.read"] : CODEX_TOOL_NAMES["files.write"];
      }
    } });
    const result = await fixture.run(); expect(result.output).toEqual({ answer: "done" });
    expect(result.receipt.relay?.outputsObserved).toBe(2); expect(result.receipt.processStopped).toBe(true);
  });
  test.each(["changed-id", "removed-id", "added-id", "removed-name"])("rejects native history identity drift: %s", async kind => {
    const fixture = peer({ names: ["files.read", "files.write"], mutateBody(body, index) {
      const item = body.input.find((value: Record<string, unknown>) => value.type === "function_call_output");
      if (!item) return;
      if (kind !== "added-id" || index === 3) item.id = "fco-1";
      item.name = CODEX_TOOL_NAMES["files.read"];
      if (index === 3) {
        if (kind === "changed-id") item.id = "fco-forged";
        if (kind === "removed-id") delete item.id;
        if (kind === "removed-name") delete item.name;
      }
    } });
    const receipt = await failure(fixture.run); expect(fixture.count()).toBe(2);
    expect(receipt.relay?.failure).toBe("CODEX_OUTPUT_IDENTITY_CHANGED"); expect(receipt.processStopped).toBe(true);
  });
  test.each(["wrong-name", "null-name", "null-id", "invalid-id", "long-id", "namespace", "unknown-field", "wrong-call"])("rejects forged output metadata: %s", async kind => {
    const fixture = peer({ mutateBody(body, index) {
      if (index !== 2) return;
      const item = body.input.at(-1);
      if (kind === "wrong-name") item.name = CODEX_TOOL_NAMES["files.write"];
      if (kind === "null-name") item.name = null;
      if (kind === "null-id") item.id = null;
      if (kind === "invalid-id") item.id = "/private/path";
      if (kind === "long-id") item.id = "x".repeat(161);
      if (kind === "namespace") item.namespace = "forged";
      if (kind === "unknown-field") item.unreviewed = true;
      if (kind === "wrong-call") item.call_id = "foreign-call";
    } });
    const receipt = await failure(fixture.run); expect(fixture.count()).toBe(1);
    expect(receipt.status).toBe("failed"); expect(receipt.processStopped).toBe(true);
  });
  test("truncated native frame cannot count as completed", async () => {
    const receipt = await failure(peer({ truncated: true }).run); expect(receipt.failures).toContain("CODEX_TRUNCATED_FRAME");
  });
  test("unknown group absence keeps custody even after a successful answer", async () => {
    const receipt = await failure(peer({ groupAbsent: false }).run); expect(receipt.turnCompleted).toBe(true); expect(receipt.processStopped).toBe(false);
  });
  test("pending broker work that ignores cancellation prevents stopped proof", async () => {
    const fixture = peer({ invoke: () => new Promise(() => {}), deadlineMs: 40 });
    const receipt = await failure(fixture.run); expect(fixture.stopped()).toBe(true); expect(receipt.handlersJoined).toBe(false); expect(receipt.processStopped).toBe(false);
  });
  test("cancelled broker work that joins permits stopped proof", async () => {
    const fixture = peer({ invoke: async () => { await Bun.sleep(50); throw new Error("cancelled"); }, deadlineMs: 30 });
    const receipt = await failure(fixture.run); expect(receipt.handlersJoined).toBe(true); expect(receipt.processStopped).toBe(true);
    expect(receipt.turnCompleted).toBe(false);
  });
  test("native runtime failure remains a failure after proved cleanup", async () => {
    const receipt = await failure(peer({ runtimeError: true }).run);
    expect(receipt.failures).toContain("CODEX_NATIVE_RUNTIME_FAILED"); expect(receipt.processStopped).toBe(true);
  });
  test.each(["invalid", "late"])("joins the body of an %s upstream response", async kind => {
    let cancelled = false;
    const fixture = peer({ ioMs: 30, response: async () => {
      if (kind === "late") await Bun.sleep(50);
      return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 403 });
    } });
    const receipt = await failure(fixture.run); expect(cancelled).toBe(true); expect(receipt.relay?.joined).toBe(true); expect(receipt.processStopped).toBe(true);
  });
  test("an upstream body that cannot join keeps custody", async () => {
    const fixture = peer({ response: async () => new Response(new ReadableStream({ cancel() { return new Promise(() => {}); } }), { status: 403 }), deadlineMs: 80 });
    const receipt = await failure(fixture.run); expect(receipt.relay?.joined).toBe(false); expect(receipt.processStopped).toBe(false);
  });
  test("abort cancellation rejection of a stalled successful response remains latched", async () => {
    let cancellations = 0;
    const fixture = peer({ deadlineMs: 40, response: async () => new Response(new ReadableStream({
      cancel() { cancellations++; return Promise.reject(new Error("synthetic cancellation fault")); },
    }), { headers: { "content-type": "text/event-stream" } }) });
    const receipt = await failure(fixture.run); expect(cancellations).toBe(1);
    expect(receipt.relay?.joined).toBe(false); expect(receipt.processStopped).toBe(false);
  });
  test("an already locked upstream body cannot disappear from cleanup custody", async () => {
    const response = new Response(new ReadableStream<Uint8Array>(), { headers: { "content-type": "text/event-stream" } });
    const foreignReader = response.body!.getReader();
    try {
      const receipt = await failure(peer({ response: async () => response }).run);
      expect(receipt.relay?.joined).toBe(false); expect(receipt.processStopped).toBe(false);
    } finally { foreignReader.releaseLock(); await response.body!.cancel(); }
  });
  test("request cap reserves room for final response and cannot hide a retry", async () => {
    const fixture = peer({ maxRequests: 1 }); const receipt = await failure(fixture.run);
    expect(receipt.relay?.failure).toBe("CODEX_TOOL_CALL_BOUND"); expect(fixture.invocations).toHaveLength(0);
  });
  test("configuration denies executable built-ins and credentials, with only the owned relay target", () => {
    const configuration = codexConfiguration(MODEL, `http://127.0.0.1:1234/relay/${"a".repeat(48)}`);
    expect(configuration).toContain('[orchestrator.skills]\nenabled = false');
    expect(configuration).toContain('[tools.experimental_request_user_input]\nenabled = false');
    expect(configuration).toContain('requires_openai_auth = false');
    for (const bad of ["https://example.com/relay/" + "a".repeat(48), "http://localhost:1234/relay/" + "a".repeat(48)]) expect(() => codexConfiguration(MODEL, bad)).toThrow();
  });
  test("pinned native request trace metadata is bounded and never forwarded", async () => {
    const fixture = peer({ mutateEnvelope(value) { if (value.method === "item/tool/call") value.trace = { traceparent: "synthetic-parent", tracestate: "synthetic-state" }; } });
    const result = await fixture.run(); expect(result.receipt.processStopped).toBe(true);
    expect(JSON.stringify(fixture.invocations)).not.toContain("synthetic-parent");
    expect(JSON.stringify(result.receipt)).not.toContain("synthetic-state");
  });
  test.each(["extra", "size", "control"])("invalid trace metadata remains denied: %s", async kind => {
    const fixture = peer({ mutateEnvelope(value) {
      if (value.method === "item/tool/call") value.trace = kind === "extra" ? { authority: true } : { traceparent: kind === "size" ? "a".repeat(513) : "line\nbreak" };
    } });
    const receipt = await failure(fixture.run); expect(fixture.invocations).toHaveLength(0); expect(receipt.processStopped).toBe(true);
  });
  test("trace cannot extend the native response schema", async () => {
    const fixture = peer({ mutateEnvelope(value) { if (value.id === 2) value.trace = null; } });
    const receipt = await failure(fixture.run); expect(receipt.failures).toContain("CODEX_TRACE_ON_NONREQUEST");
    expect(receipt.failureStage).toBe("thread/start"); expect(receipt.processStopped).toBe(true);
  });
  test("traced forbidden startup requests remain denied with only an enumerated name", async () => {
    const fixture = peer({ unknownRequest: true, mutateEnvelope(value) { if (value.id === 100) value.trace = {}; } });
    const receipt = await failure(fixture.run); expect(receipt.deniedNativeRequest).toBe("item/commandExecution/requestApproval");
    expect(receipt.failures).toContain("CODEX_FORBIDDEN_SERVER_REQUEST"); expect(fixture.invocations).toHaveLength(0);
  });
  test.each(["identifier", "extra", "json"])("startup diagnostics distinguish %s without raw frame values", async kind => {
    const fixture = peer({ malformedThreadReply: kind === "json", mutateEnvelope(value) {
      if (value.id === 2 && kind === "identifier") value.result.thread.id = "private/invalid-id";
      if (value.id === 2 && kind === "extra") value.unreviewed = "private debug value";
    } });
    const receipt = await failure(fixture.run);
    expect(receipt.failures).toContain(kind === "identifier" ? "CODEX_INVALID_IDENTIFIER" : kind === "extra" ? "CODEX_UNKNOWN_FIELD" : "CODEX_INVALID_JSON");
    expect(receipt.failureStage).toBe("thread/start"); expect(receipt.processStopped).toBe(true);
    expect(JSON.stringify(receipt)).not.toContain("private"); expect(fixture.count()).toBe(0);
  });
});
