import { randomBytes } from "node:crypto";
import type { BrokerToolName } from "./broker.ts";
import { canonicalJson, CODEX_BASE_INSTRUCTIONS, CODEX_TOOL_NAMES, codexResponseTools, type CodexTool, type CodexCapabilityMapping, type CodexTaskSettings } from "./codex-config.ts";
import { boundedText, object, safeInteger } from "./validation.ts";

/** A trusted host port, deliberately without credential discovery or a live HTTP implementation.
 * A paid implementation must separately reserve/account usage and impose its own output-token cap.
 */
export interface CodexResponsesUpstream { request(body: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<Response> }
export type CodexLimits = Readonly<{
  deadlineMs: number; ioMs: number; cleanupMs: number; maxRequests: number;
  maxRequestBytes: number; maxResponseBytes: number; maxFrameBytes: number; maxFrames: number;
}>;
export function codexLimits(input: Partial<CodexLimits> = {}): CodexLimits {
  const defaults: CodexLimits = { deadlineMs: 120_000, ioMs: 10_000, cleanupMs: 10_000, maxRequests: 16,
    maxRequestBytes: 2 * 1024 * 1024, maxResponseBytes: 1024 * 1024, maxFrameBytes: 1024 * 1024, maxFrames: 2048 };
  object(input, Object.keys(defaults));
  return Object.freeze(Object.fromEntries(Object.entries(defaults).map(([key, max]) => [key,
    safeInteger(input[key as keyof CodexLimits] ?? max, 1, max)])) as CodexLimits);
}
export function codexAssert(value: unknown, code: string): asserts value { if (!value) throw new Error(code); }
export function codexRecord(value: unknown): Record<string, unknown> {
  codexAssert(value !== null && typeof value === "object" && !Array.isArray(value), "CODEX_EXPECTED_OBJECT");
  return value as Record<string, unknown>;
}
export async function codexBounded<T>(promise: Promise<T>, ms: number, code: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(code)), ms); })]); }
  finally { clearTimeout(timer); }
}
const equal = (a: unknown, b: unknown, code: string) => codexAssert(canonicalJson(a) === canonicalJson(b), code);
const checkedId = (value: unknown) => { const id = boundedText(value, 160); codexAssert(/^[A-Za-z0-9_.:-]+$/u.test(id), "CODEX_INVALID_ID"); return id; };
type RequestObjectScope = "REQUEST" | "REASONING" | "TEXT_CONTROL" | "STREAM_CONTROL" | "INPUT_MESSAGE" | "INPUT_CONTENT"
  | "FUNCTION_HISTORY" | "OUTPUT_HISTORY";
function requestObject(value: unknown, keys: readonly string[], scope: RequestObjectScope): Record<string, unknown> {
  try { return object(value, keys); }
  catch (error) {
    if (error instanceof Error && ["INVALID_OBJECT", "UNKNOWN_FIELD"].includes(error.message)) {
      if (error.message === "UNKNOWN_FIELD") {
        const unknown = Object.keys(value as Record<string, unknown>).filter(key => !keys.includes(key));
        // Only fixed schema names become diagnostic labels; never echo an arbitrary key or its value.
        if (unknown.length === 1) {
          if (scope === "REQUEST" && unknown[0] === "access_programs") throw new Error("CODEX_RELAY_ACCESS_PROGRAMS_UNSUPPORTED");
          if (scope === "INPUT_MESSAGE" && unknown[0] === "internal_chat_message_metadata_passthrough") throw new Error("CODEX_RELAY_MESSAGE_METADATA_UNSUPPORTED");
          if (scope === "INPUT_MESSAGE" && unknown[0] === "phase") throw new Error("CODEX_RELAY_MESSAGE_PHASE_UNSUPPORTED");
        }
      }
      throw new Error(`CODEX_RELAY_${scope}_${error.message}`);
    }
    throw error;
  }
}
function relayJson(text: string, scope: "REQUEST" | "RESPONSE" | "ARGUMENTS" | "FINAL" | "NATIVE_METADATA"): unknown {
  try { return JSON.parse(text) as unknown; }
  catch { throw new Error(`CODEX_RELAY_${scope}_INVALID_JSON`); }
}
type Call = { id: string; tool: string; brokerName: string; arguments: Record<string, unknown>; rawArguments: string;
  claimed: boolean; started: boolean; completed: boolean; output: string | null; success: boolean | null; write: Promise<void> | null; observed: boolean;
  outputIdentity?: string };
export type CodexRelayReceipt = Readonly<{ requests: number; calls: number; started: number; completed: number;
  outputsObserved: number; finalObserved: boolean; joined: boolean; failure: string | null }>;
export type CodexTaskRelayOptions = Readonly<{ mapping: CodexCapabilityMapping; settings: CodexTaskSettings;
  executionDeadlineUnixMs: number; maxOutputBytes: number; now?: () => number }>;
export interface CodexRelay {
  readonly baseUrl: string; readonly port: number;
  bindTurn(threadId: string, turnId: string): void;
  claimCall(params: Record<string, unknown>): { id: string; name: BrokerToolName; input: Record<string, unknown> };
  claimTaskCall(params: Record<string, unknown>): { id: string; name: string; input: Record<string, unknown> };
  completeCall(id: string, text: string, success: boolean, write: () => Promise<void>): Promise<void>;
  observeTool(params: Record<string, unknown>, phase: "started" | "completed"): void;
  observeFinal(text: unknown): void;
  result(): unknown;
  resultText(): string | null;
  usage(): Readonly<{ inputTokens: number | null; outputTokens: number | null; totalTokens: number | null }>;
  receipt(): CodexRelayReceipt;
  close(): Promise<CodexRelayReceipt>;
}

export function startCodexRelay(options: { model: string; prompt: string; tools: readonly CodexTool[];
  upstream: CodexResponsesUpstream; signal: AbortSignal; limits: CodexLimits; fail(code: string): void; task?: CodexTaskRelayOptions }): CodexRelay {
  boundedText(options.model, 160); boundedText(options.prompt, 512 * 1024);
  const task = options.task;
  if (task) {
    safeInteger(task.executionDeadlineUnixMs, 1, Number.MAX_SAFE_INTEGER);
    safeInteger(task.maxOutputBytes, 1, 64 * 1024 * 1024);
    if (task.settings.model.id !== options.model) throw new Error("CODEX_TASK_MODEL_MISMATCH");
    if (task.mapping.tools.length !== options.tools.length) throw new Error("CODEX_TASK_MAPPING_MISMATCH");
  }
  const { limits } = options, controller = new AbortController(), signal = AbortSignal.any([controller.signal, options.signal]);
  const calls = new Map<string, Call>(), responses = new Set<string>(), activities = new Set<Promise<unknown>>();
  const ownedBodies = new Set<Response>(); let bodyCleanupFailed = false;
  const tools = codexResponseTools(task?.mapping.tools ?? options.tools), prefix = `/relay/${randomBytes(24).toString("hex")}`;
  let threadId: string | null = null, turnId: string | null = null, requests = 0, active = 0;
  let failure: string | null = null, closed = false, joined = false, initial: unknown[] | null = null;
  let finalText: string | null = null, finalObserved = false, result: unknown, responseUsage = { inputTokens: null as number | null, outputTokens: null as number | null, totalTokens: null as number | null }, resolveTurn!: () => void;
  const turnReady = new Promise<void>(resolve => { resolveTurn = resolve; });
  function assertTaskDeadline() {
    if (task && (task.now?.() ?? Date.now()) >= task.executionDeadlineUnixMs) throw new Error("CODEX_TASK_DEADLINE");
  }
  function fail(code: string) { failure ??= code; controller.abort(new Error(code)); options.fail(code); }
  function track<T>(promise: Promise<T>): Promise<T> {
    activities.add(promise); void promise.finally(() => activities.delete(promise)).catch(() => {}); return promise;
  }
  async function cancelBody(response: Response): Promise<void> {
    try { if (response.body) await track(response.body.cancel()); }
    catch { bodyCleanupFailed = true; throw new Error("CODEX_RESPONSE_BODY_JOIN_FAILED"); }
    finally { ownedBodies.delete(response); }
  }
  async function upstreamResponse(body: Readonly<Record<string, unknown>>): Promise<Response> {
    assertTaskDeadline();
    const response = await options.upstream.request(body, signal);
    ownedBodies.add(response);
    // Also owns responses that arrive after the caller's request deadline/abort.
    if (signal.aborted) { await cancelBody(response); signal.throwIfAborted(); }
    return response;
  }
  async function bodyText(stream: ReadableStream<Uint8Array> | null, max: number, acquired?: () => void): Promise<string> {
    codexAssert(stream, "CODEX_HTTP_BODY_REQUIRED"); const reader = stream.getReader(), chunks: Uint8Array[] = [];
    acquired?.();
    let bytes = 0; const until = performance.now() + limits.ioMs;
    let cancellation: Promise<void> | null = null;
    const cancelReader = () => cancellation ??= track(Promise.resolve().then(() => reader.cancel()).catch(() => {
      bodyCleanupFailed = true; throw new Error("CODEX_HTTP_READER_JOIN");
    }));
    const cancel = () => { void cancelReader().catch(() => {}); };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      while (true) {
        signal.throwIfAborted();
        const part = await codexBounded(track(reader.read()), Math.max(1, until - performance.now()), "CODEX_HTTP_BODY_DEADLINE");
        if (part.done) break;
        bytes += part.value.byteLength; codexAssert(bytes <= max, "CODEX_HTTP_BODY_BOUND"); chunks.push(part.value);
      }
      try { return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)); }
      catch { throw new Error("CODEX_HTTP_ENCODING_INVALID"); }
    } finally {
      signal.removeEventListener("abort", cancel);
      try { await codexBounded(cancelReader(), limits.ioMs, "CODEX_HTTP_READER_JOIN"); reader.releaseLock(); }
      catch { bodyCleanupFailed = true; throw new Error("CODEX_HTTP_READER_JOIN"); }
    }
  }
  function assertBinding(params: Record<string, unknown>) {
    codexAssert(threadId !== null && turnId !== null && params.threadId === threadId && params.turnId === turnId, "CODEX_CALL_SCOPE_MISMATCH");
  }
  async function validateInput(body: Record<string, unknown>) {
    assertTaskDeadline();
    requestObject(body, ["model", "instructions", "input", "tools", "tool_choice", "parallel_tool_calls", "reasoning", "store", "stream",
      "stream_options", "include", "service_tier", "prompt_cache_key", "text", "client_metadata"], "REQUEST");
    codexAssert(body.model === options.model && body.stream === true && body.store === false && body.tool_choice === "auto"
      && typeof body.parallel_tool_calls === "boolean", "CODEX_MODEL_ENVELOPE_MISMATCH");
    codexAssert(body.instructions === (task?.settings.instructions.base ?? CODEX_BASE_INSTRUCTIONS), "CODEX_INSTRUCTIONS_MISMATCH");
    codexAssert(canonicalJson(body.include) === "[]" || canonicalJson(body.include) === '["reasoning.encrypted_content"]', "CODEX_INCLUDE_INVALID");
    if (body.prompt_cache_key !== undefined) {
      try { boundedText(body.prompt_cache_key, 160); }
      catch { throw new Error("CODEX_RELAY_PROMPT_CACHE_KEY_INVALID"); }
    }
    if (body.client_metadata !== undefined) {
      codexAssert(body.client_metadata !== null && typeof body.client_metadata === "object" && !Array.isArray(body.client_metadata), "CODEX_RELAY_CLIENT_METADATA_INVALID");
      const metadata = body.client_metadata; codexAssert(Object.keys(metadata).length <= 16, "CODEX_METADATA_BOUND");
      for (const [key, value] of Object.entries(metadata)) {
        try { boundedText(key, 80); } catch { throw new Error("CODEX_RELAY_CLIENT_METADATA_KEY_INVALID"); }
        if (key === "x-codex-turn-metadata") {
          // rust-v0.153.4 puts workspace/tool inventory JSON in this one telemetry string.
          // 64KiB is 1/32 of the default full request bound; it is parsed, discarded, and never authority.
          let text: string;
          try { text = boundedText(value, 64 * 1024); } catch { throw new Error("CODEX_RELAY_NATIVE_METADATA_BOUND"); }
          const parsed = relayJson(text, "NATIVE_METADATA");
          codexAssert(parsed !== null && typeof parsed === "object" && !Array.isArray(parsed), "CODEX_RELAY_NATIVE_METADATA_INVALID");
        } else {
          try { boundedText(value, 512, true); } catch { throw new Error("CODEX_RELAY_CLIENT_METADATA_VALUE_INVALID"); }
        }
      }
    }
    equal(body.tools ?? [], tools, "CODEX_TOOL_MANIFEST_MISMATCH");
    // Native model catalog defaults are data, not executable tools. No arbitrary extension/context.
    if (body.reasoning != null) {
      const reasoning = requestObject(body.reasoning, ["effort", "summary", "context"], "REASONING");
      codexAssert(reasoning.effort === undefined || ["none", "minimal", "low", "medium", "high", "xhigh"].includes(String(reasoning.effort)), "CODEX_REASONING_EFFORT_INVALID");
      if (task && task.settings.model.reasoningEffort !== null) codexAssert(reasoning.effort === task.settings.model.reasoningEffort, "CODEX_TASK_REASONING_MISMATCH");
      codexAssert(reasoning.summary === undefined || ["auto", "concise", "detailed", "none"].includes(String(reasoning.summary)), "CODEX_REASONING_SUMMARY_INVALID");
      codexAssert(reasoning.context === undefined || ["auto", "current_turn", "all_turns"].includes(String(reasoning.context)), "CODEX_REASONING_CONTEXT_INVALID");
    }
    if (body.text !== undefined) {
      const text = requestObject(body.text, ["verbosity"], "TEXT_CONTROL");
      codexAssert(text.verbosity === undefined || ["low", "medium", "high"].includes(String(text.verbosity)), "CODEX_TEXT_CONTROL_INVALID");
    }
    if (body.stream_options !== undefined) {
      const stream = requestObject(body.stream_options, ["reasoning_summary_delivery"], "STREAM_CONTROL");
      codexAssert(stream.reasoning_summary_delivery === "sequential_cutoff", "CODEX_STREAM_CONTROL_INVALID");
    }
    if (task?.settings.model.serviceTier === null) codexAssert(body.service_tier === undefined, "CODEX_TASK_SERVICE_TIER_MISMATCH");
    else if (task) codexAssert(body.service_tier === task.settings.model.serviceTier, "CODEX_TASK_SERVICE_TIER_MISMATCH");
    else codexAssert(body.service_tier === undefined, "CODEX_RESPONSE_EXTENSION_UNSUPPORTED");
    codexAssert(Array.isArray(body.input) && body.input.length <= 256, "CODEX_INPUT_BOUND");
    const input = body.input;
    if (initial === null) {
      // Pinned native-generated environment/developer messages remain untrusted context.
      // Bind their exact prefix after the first read; this is not a host-only prompt claim.
      // Any paid transport needs its own context/credential/budget admission before installation.
      codexAssert(calls.size === 0 && input.length > 0, "CODEX_INITIAL_INPUT_INVALID");
      for (const raw of input) {
        const item = requestObject(raw, ["type", "id", "role", "content"], "INPUT_MESSAGE");
        codexAssert((item.type === undefined || item.type === "message") && ["user", "developer", "system"].includes(String(item.role))
          && Array.isArray(item.content), "CODEX_INITIAL_MESSAGE_INVALID");
        for (const value of item.content) { const part = requestObject(value, ["type", "text"], "INPUT_CONTENT"); codexAssert(part.type === "input_text", "CODEX_INITIAL_CONTENT_INVALID"); boundedText(part.text, limits.maxRequestBytes, true); }
      }
      const last = codexRecord(input.at(-1));
      codexAssert(last.role === "user", "CODEX_PROMPT_ROLE_MISMATCH");
      equal(last.content, [{ type: "input_text", text: options.prompt }], "CODEX_PROMPT_MISMATCH");
      initial = structuredClone(input);
    } else {
      equal(input.slice(0, initial.length), initial, "CODEX_INPUT_PREFIX_CHANGED");
      const tail = input.slice(initial.length);
      codexAssert(tail.length === calls.size * 2 && calls.size > 0, "CODEX_TOOL_HISTORY_LENGTH_MISMATCH");
      let index = 0;
      for (const call of calls.values()) {
        codexAssert(call.claimed && call.write !== null, "CODEX_OUTPUT_WITHOUT_BROKER");
        await codexBounded(call.write, limits.ioMs, "CODEX_TOOL_WRITE_JOIN");
        signal.throwIfAborted();
        const issued = requestObject(tail[index++], ["type", "id", "call_id", "name", "arguments"], "FUNCTION_HISTORY");
        codexAssert(issued.type === "function_call" && issued.call_id === call.id && issued.name === call.tool
          && issued.arguments === call.rawArguments, "CODEX_FUNCTION_HISTORY_MISMATCH");
        const output = requestObject(tail[index++], ["type", "id", "name", "call_id", "output"], "OUTPUT_HISTORY");
        codexAssert(output.type === "function_call_output" && output.call_id === call.id && output.output === call.output,
          "CODEX_BROKER_OUTPUT_MISMATCH");
        // The pinned native history can stamp an item ID and tool name. Neither
        // chooses authority; call_id and the exact broker output remain binding.
        if (output.id !== undefined) checkedId(output.id);
        codexAssert(output.name === undefined || output.name === call.tool, "CODEX_OUTPUT_TOOL_MISMATCH");
        const identity = canonicalJson({ id: output.id ?? null, name: output.name ?? null });
        if (call.outputIdentity === undefined) call.outputIdentity = identity;
        else codexAssert(call.outputIdentity === identity, "CODEX_OUTPUT_IDENTITY_CHANGED");
        call.observed = true;
      }
    }
  }
  function responseEvents(text: string): Response {
    const events: Record<string, unknown>[] = [];
    for (const block of text.replaceAll("\r\n", "\n").split("\n\n")) {
      if (!block.trim()) continue;
      const lines = block.split("\n"), data = lines.filter(line => line.startsWith("data: "));
      codexAssert(data.length === 1 && lines.length === 2 && lines[0]?.startsWith("event: "), "CODEX_SSE_FRAMING_INVALID");
      const event = codexRecord(relayJson(data[0]!.slice(6), "RESPONSE"));
      codexAssert(lines[0]!.slice(7) === event.type && events.length < 512, "CODEX_SSE_EVENT_INVALID"); events.push(event);
    }
    // Buffer and validate the whole response before any executable call reaches the child.
    codexAssert(events.length === 3, "CODEX_SSE_SHAPE_UNSUPPORTED");
    const [created, itemEvent, complete] = events as [Record<string, unknown>, Record<string, unknown>, Record<string, unknown>];
    codexAssert(created.type === "response.created" && itemEvent.type === "response.output_item.done" && complete.type === "response.completed", "CODEX_SSE_SEQUENCE_INVALID");
    const id = checkedId(codexRecord(created.response).id), end = codexRecord(complete.response);
    codexAssert(end.id === id && !responses.has(id), "CODEX_RESPONSE_ID_MISMATCH");
    const item = codexRecord(itemEvent.item);
    if (item.type === "function_call") {
      object(item, ["type", "id", "call_id", "name", "arguments"]);
      const callId = checkedId(item.call_id), name = boundedText(item.name, 160), args = boundedText(item.arguments, 512 * 1024);
      const brokerName = task?.mapping.capabilityName(name) ?? (Object.entries(CODEX_TOOL_NAMES) as [BrokerToolName, string][]).find(([, value]) => value === name)?.[0];
      codexAssert(brokerName && options.tools.some(tool => tool.name === name) && !calls.has(callId), "CODEX_MODEL_TOOL_DENIED");
      codexAssert(finalText === null && calls.size < limits.maxRequests - 1, "CODEX_TOOL_CALL_BOUND");
      calls.set(callId, { id: callId, tool: name, brokerName, arguments: codexRecord(relayJson(args, "ARGUMENTS")), rawArguments: args,
        claimed: false, started: false, completed: false, output: null, success: null, write: null, observed: false });
    } else {
      object(item, ["type", "role", "id", "content"]);
      codexAssert(item.type === "message" && item.role === "assistant" && Array.isArray(item.content) && item.content.length === 1 && finalText === null,
        "CODEX_MODEL_OUTPUT_DENIED");
      const part = object(item.content[0], ["type", "text"]); codexAssert(part.type === "output_text", "CODEX_FINAL_TYPE_INVALID");
      finalText = boundedText(part.text, task?.maxOutputBytes ?? 256 * 1024);
      result = task ? finalText : relayJson(finalText, "FINAL");
    }
    responses.add(id);
    // Reconstruct only the reviewed events. Extra provider envelope fields never grant authority.
    const usage = codexRecord(end.usage);
    for (const key of ["input_tokens", "output_tokens", "total_tokens"]) safeInteger(usage[key], 0, 100_000_000);
    responseUsage = { inputTokens: usage.input_tokens as number, outputTokens: usage.output_tokens as number, totalTokens: usage.total_tokens as number };
    const canonical = [{ type: "response.created", response: { id } }, { type: "response.output_item.done", item },
      { type: "response.completed", response: { id, usage } }];
    return new Response(canonical.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
      { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "close" } });
  }
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, maxRequestBodySize: limits.maxRequestBytes,
    idleTimeout: 10, development: false,
    fetch(request) {
      const operation = (async () => {
        active++;
        try {
          codexAssert(!closed && !failure && active === 1 && ++requests <= limits.maxRequests && finalText === null, "CODEX_REQUEST_STATE_INVALID");
          assertTaskDeadline();
          codexAssert(request.method === "POST" && request.url === `${baseUrl}/responses`
            && !request.headers.has("authorization") && !request.headers.has("cookie"), "CODEX_RELAY_REQUEST_DENIED");
          const body = codexRecord(relayJson(await bodyText(request.body, limits.maxRequestBytes), "REQUEST"));
          await validateInput(body); await codexBounded(turnReady, limits.ioMs, "CODEX_TURN_BINDING_DEADLINE"); signal.throwIfAborted();
          const forwarded = structuredClone(body);
          // Native installation/workspace/tool telemetry is not needed by the model-facing host port.
          delete forwarded.client_metadata;
          const response = await codexBounded(track(upstreamResponse(Object.freeze({ ...forwarded, tools,
            parallel_tool_calls: false }))), limits.ioMs, "CODEX_UPSTREAM_DEADLINE");
          try {
            codexAssert(response.status === 200 && response.headers.get("content-type")?.split(";")[0] === "text/event-stream", "CODEX_UPSTREAM_RESPONSE_INVALID");
            // Transfer ownership only after getReader succeeds; a pre-locked body stays fenced.
            return responseEvents(await bodyText(response.body, limits.maxResponseBytes, () => ownedBodies.delete(response)));
          } finally { if (ownedBodies.has(response)) await cancelBody(response); }
        } catch (error) {
          fail(error instanceof Error && /^CODEX_[A-Z_]+$/u.test(error.message) ? error.message
            : error instanceof Error && ["INVALID_OBJECT", "UNKNOWN_FIELD", "INVALID_TEXT", "INVALID_INTEGER"].includes(error.message)
              ? `CODEX_RELAY_${error.message}` : "CODEX_RELAY_VALIDATION_FAILED");
          return Response.json({ error: { message: "Host relay rejected request" } }, { status: 400 });
        }
        finally { active--; }
      })();
      return track(operation);
    },
    error() { fail("CODEX_RELAY_SERVER_FAILED"); return new Response("Host relay failed", { status: 400 }); },
  });
  const port = safeInteger(server.port, 1, 65535), baseUrl = `http://127.0.0.1:${port}${prefix}`;
  function receipt(): CodexRelayReceipt { return { requests, calls: calls.size, started: [...calls.values()].filter(call => call.started).length,
    completed: [...calls.values()].filter(call => call.completed).length, outputsObserved: [...calls.values()].filter(call => call.observed).length,
    finalObserved, joined, failure }; }
  return {
    baseUrl, port,
    bindTurn(thread, turn) { codexAssert(threadId === null && turnId === null, "CODEX_TURN_ALREADY_BOUND"); threadId = checkedId(thread); turnId = checkedId(turn); resolveTurn(); },
    claimCall(params) {
      codexAssert(!task, "CODEX_CONTACT_CALL_ON_TASK_RELAY");
      assertTaskDeadline();
      signal.throwIfAborted(); object(params, ["threadId", "turnId", "callId", "tool", "namespace", "arguments"]); assertBinding(params);
      const call = calls.get(String(params.callId));
      codexAssert(call && !call.claimed && params.tool === call.tool && params.namespace == null, "CODEX_CALLBACK_DENIED");
      equal(params.arguments, call.arguments, "CODEX_CALLBACK_ARGUMENTS_CHANGED"); call.claimed = true;
      return { id: call.id, name: call.brokerName as BrokerToolName, input: structuredClone(call.arguments) };
    },
    claimTaskCall(params) {
      codexAssert(task, "CODEX_TASK_CALL_ON_CONTACT_RELAY");
      assertTaskDeadline();
      signal.throwIfAborted(); object(params, ["threadId", "turnId", "callId", "tool", "namespace", "arguments"]); assertBinding(params);
      const call = calls.get(String(params.callId));
      codexAssert(call && !call.claimed && params.tool === call.tool && params.namespace == null, "CODEX_CALLBACK_DENIED");
      equal(params.arguments, call.arguments, "CODEX_CALLBACK_ARGUMENTS_CHANGED"); call.claimed = true;
      return { id: call.id, name: call.brokerName, input: structuredClone(call.arguments) };
    },
    async completeCall(id, text, success, write) {
      assertTaskDeadline();
      const call = calls.get(id); codexAssert(call?.claimed && call.write === null, "CODEX_CALL_COMPLETION_INVALID");
      call.output = boundedText(text, 512 * 1024, true); call.success = success;
      // Publish the exact promise before native can consume bytes and issue its follow-up request.
      call.write = Promise.resolve().then(write); await call.write;
    },
    observeTool(params, phase) {
      assertBinding(params); const item = codexRecord(params.item), call = calls.get(String(item.id));
      codexAssert(call && item.tool === call.tool && item.namespace == null, "CODEX_TOOL_ITEM_MISMATCH");
      equal(item.arguments, call.arguments, "CODEX_TOOL_ITEM_ARGUMENTS_CHANGED");
      if (phase === "started") { codexAssert(!call.started && item.status === "inProgress", "CODEX_TOOL_STARTED_INVALID"); call.started = true; }
      else {
        codexAssert(call.started && call.claimed && !call.completed && item.status === (call.success ? "completed" : "failed") && item.success === call.success
          && call.output !== null, "CODEX_TOOL_COMPLETED_INVALID");
        equal(item.contentItems, [{ type: "inputText", text: call.output }], "CODEX_TOOL_RESULT_CHANGED"); call.completed = true;
      }
    },
    observeFinal(text) { codexAssert(!finalObserved && finalText !== null && text === finalText, "CODEX_FINAL_MESSAGE_MISMATCH"); finalObserved = true; },
    result() {
      codexAssert(!failure && finalObserved && [...calls.values()].every(call => call.claimed && call.started && call.completed && call.observed), "CODEX_INCOMPLETE_ROUND_TRIP");
      return result;
    },
    resultText() { return finalText; },
    usage() { return Object.freeze({ ...responseUsage }); },
    receipt,
    async close() {
      closed = true; controller.abort(new Error("CODEX_RELAY_CLOSED"));
      try {
        await codexBounded(server.stop(true), limits.cleanupMs, "CODEX_SERVER_JOIN_DEADLINE");
        for (const response of ownedBodies) void track(cancelBody(response)).catch(() => {});
        const until = performance.now() + limits.cleanupMs;
        while (activities.size) await codexBounded(Promise.allSettled([...activities]), Math.max(1, until - performance.now()), "CODEX_RELAY_HANDLERS_JOIN_DEADLINE");
        joined = !bodyCleanupFailed && ownedBodies.size === 0 && active === 0 && server.pendingRequests === 0;
      } catch { failure ??= "CODEX_RELAY_JOIN_UNPROVEN"; }
      return receipt();
    },
  };
}
