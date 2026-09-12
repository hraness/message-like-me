import { describe, expect, test } from "bun:test";
import { BROKER_TOOL_NAMES, type BrokerToolName } from "../src/broker.ts";
import { CODEX_TOOL_NAMES, codexResponseTools, codexTools } from "../src/codex-config.ts";
import { CodexApiResponseError, normalizeCodexApiResponse, type CodexApiJson, type CodexApiResponseBinding } from "../src/codex-api-response.ts";

const MODEL = "gpt-4.1-mini-2025-04-14";
const binding = (names: readonly BrokerToolName[] = BROKER_TOOL_NAMES): CodexApiResponseBinding => ({
  modelSnapshot: MODEL, purpose: names.length ? "respond" : "classify", tools: codexTools(names), maxOutputTokens: 2048,
});
const final = () => ({ type: "message", id: "msg_1", status: "completed", role: "assistant",
  content: [{ type: "output_text", text: '{"answer":"hello"}', annotations: [], logprobs: [] }] });
const argumentsFor: Record<BrokerToolName, Record<string, CodexApiJson>> = {
  "files.read": { path: "MEMORY.md" }, "files.write": { path: "MEMORY.md", text: "Synthetic", expectedRevision: "sha256-old" },
  "web.fetch": { url: "https://example.com", maxBytes: 128 },
  "messages.propose_text": { text: "Synthetic", idempotencyKey: "text-1" },
  "messages.propose_reaction": { messageId: "message-1", reaction: "like", idempotencyKey: "reaction-1" },
  "messages.propose_attachment": { path: "outbox/hello.txt", caption: "Synthetic", idempotencyKey: "attachment-1" },
};
const tool = (name: BrokerToolName = "files.read") => ({ type: "function_call", id: "fc_1", call_id: "call_1",
  name: CODEX_TOOL_NAMES[name], arguments: JSON.stringify(argumentsFor[name]), status: "completed" });
function response(b = binding()): Record<string, any> {
  return { id: "resp_1", object: "response", created_at: 100, completed_at: 101, status: "completed", background: false,
    error: null, incomplete_details: null, instructions: null, max_output_tokens: b.maxOutputTokens,
    max_tool_calls: null, model: b.modelSnapshot, output: [final()], parallel_tool_calls: false, previous_response_id: null,
    reasoning: { effort: null, summary: null }, store: false, temperature: 1, text: { format: { type: "text" } },
    tool_choice: "auto", tools: structuredClone(codexResponseTools(b.tools)), top_p: 1, truncation: "disabled", service_tier: "default",
    usage: { input_tokens: 53, input_tokens_details: { cached_tokens: 7, cache_write_tokens: 3 }, output_tokens: 11,
      output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 64 }, user: null, metadata: {} };
}
function rejected(raw: Record<string, any> | string, b = binding()): CodexApiResponseError {
  try { normalizeCodexApiResponse(typeof raw === "string" ? raw : JSON.stringify(raw), b); }
  catch (error) { expect(error).toBeInstanceOf(CodexApiResponseError); return error as CodexApiResponseError; }
  throw new Error("Expected rejection");
}
function events(sse: string): Record<string, any>[] {
  return sse.trim().split("\n\n").map(block => {
    const [name, data] = block.split("\n"); const value = JSON.parse(data!.slice(6));
    expect(name).toBe(`event: ${value.type}`); return value;
  });
}
describe("pure Codex API response admission (synthetic; no transport or runtime qualification)", () => {
  test("constructs only three canonical events, preserving exact final bytes and all real usage", () => {
    const input = response(), admitted = normalizeCodexApiResponse(JSON.stringify(input), binding());
    expect(admitted.productionQualified).toBe(false); expect(admitted.result).toEqual({ kind: "final", text: '{"answer":"hello"}', value: { answer: "hello" } });
    expect(admitted.usage).toEqual(input.usage); expect(admitted.model).toBe(MODEL);
    const sequence = events(admitted.sse);
    expect(sequence).toEqual([
      { type: "response.created", response: { id: "resp_1" } },
      { type: "response.output_item.done", item: { type: "message", id: "msg_1", role: "assistant", content: [{ type: "output_text", text: '{"answer":"hello"}' }] } },
      { type: "response.completed", response: { id: "resp_1", usage: input.usage } },
    ]);
    expect(Object.isFrozen(admitted)).toBe(true); expect(Object.isFrozen(admitted.usage.input_tokens_details)).toBe(true);
    expect(Object.isFrozen(admitted.result)).toBe(true);
  });
  test.each([...BROKER_TOOL_NAMES])("admits exact %s descriptor and arguments without executing it", name => {
    const b = binding([name]), input = response(b); input.output = [tool(name)];
    const admitted = normalizeCodexApiResponse(JSON.stringify(input), b);
    expect(admitted.result).toEqual({ kind: "tool", callId: "call_1", tool: name, arguments: argumentsFor[name] });
    const item = events(admitted.sse)[1]!.item;
    expect(item).toEqual({ type: "function_call", id: "fc_1", call_id: "call_1", name: CODEX_TOOL_NAMES[name], arguments: input.output[0].arguments });
  });
  test("accepts documented optional function ID/status and inert direct-caller fields", () => {
    const input = response(); input.output = [{ ...tool(), caller: { type: "direct" }, namespace: null, async: false }];
    delete input.output[0].id; delete input.output[0].status;
    const item = events(normalizeCodexApiResponse(JSON.stringify(input), binding()).sse)[1]!.item;
    expect(Object.keys(item).sort()).toEqual(["arguments", "call_id", "name", "type"]);
  });
  test("zero-tool classifier can only return a JSON value", () => {
    const b = binding([]), input = response(b);
    expect(normalizeCodexApiResponse(JSON.stringify(input), b).result.kind).toBe("final");
    input.output = [tool()]; expect(rejected(input, b).code).toBe("CODEX_API_TOOL_DENIED");
  });
  test.each(["alias", "different", "schema", "description", "extra-tool", "classifier-tools"])("rejects changed owner binding: %s", kind => {
    const b = structuredClone(binding());
    if (kind === "alias") (b as any).modelSnapshot = "gpt-4.1-mini";
    if (kind === "different") (b as any).modelSnapshot = "gpt-4.1-2025-04-14";
    if (kind === "schema") (b.tools[0]!.inputSchema as any).additionalProperties = true;
    if (kind === "description") (b.tools[0] as any).description = "Run arbitrary shell commands";
    if (kind === "extra-tool") (b.tools as any).push({ type: "function", name: "shell", inputSchema: {} });
    if (kind === "classifier-tools") (b as any).purpose = "classify";
    expect(rejected(response(), b).code).toBe(kind === "different" ? "CODEX_API_MODEL_MISMATCH" : "CODEX_API_BINDING_INVALID");
  });
  test.each(["name", "parameters", "strict", "description", "order", "extra"])("rejects provider tool echo change: %s", kind => {
    const input = response();
    if (kind === "name") input.tools[0].name = "shell";
    if (kind === "parameters") input.tools[0].parameters.additionalProperties = true;
    if (kind === "strict") input.tools[0].strict = true;
    if (kind === "description") input.tools[0].description = "changed";
    if (kind === "order") input.tools.reverse();
    if (kind === "extra") input.tools.push({ type: "web_search" });
    expect(rejected(input).code).toBe("CODEX_API_MANIFEST_MISMATCH");
  });
  test.each(["failed", "incomplete", "cancelled", "queued", "in_progress"])("preserves actual %s provider error and usage without success SSE", status => {
    const input = response(); input.status = status; input.output = [];
    input.error = { code: "server_error", message: "private synthetic diagnosis", misalignment: { steer: { message: "untrusted text" } } };
    input.incomplete_details = { reason: "max_output_tokens" };
    const error = rejected(input);
    expect(error.code).toBe("CODEX_API_PROVIDER_NOT_COMPLETED"); expect(error.details.status).toBe(status);
    expect(error.details.providerError).toEqual(input.error); expect(error.details.incompleteDetails).toEqual(input.incomplete_details);
    expect(error.details.usage).toEqual(input.usage); expect(error.details.usageStatus).toBe("validated");
    expect(error.message).not.toContain("private"); expect(JSON.stringify(error)).not.toContain("private"); expect(Object.isFrozen(error.details.providerError)).toBe(true);
    expect("sse" in error).toBe(false);
  });
  test.each(["error", "incomplete_details"])("completed status cannot override %s", key => {
    const input = response(); input[key] = { code: "server_error" };
    expect(rejected(input).code).toBe("CODEX_API_PROVIDER_NOT_COMPLETED");
  });
  test.each(["background", "store", "parallel_tool_calls", "conversation", "previous_response_id", "tool_choice", "service_tier", "truncation", "max_output_tokens", "prompt_cache_retention"])("rejects unsupported policy %s", key => {
    const input = response();
    input[key] = ({ background: true, store: true, parallel_tool_calls: true, conversation: { id: "conv_1" },
      previous_response_id: "resp_0", tool_choice: "required", service_tier: "priority", truncation: "auto", max_output_tokens: 9999,
      prompt_cache_retention: "24h" } as Record<string, unknown>)[key];
    expect(rejected(input).code).toBe("CODEX_API_POLICY_MISMATCH");
  });
  test.each(["reasoning-item", "reasoning-setting", "reasoning-usage", "refusal", "two-tools", "tool-plus-final", "web-search", "commentary", "annotations", "logprobs"])("rejects extra or unrepresentable output: %s", kind => {
    const input = response();
    if (kind === "reasoning-item") input.output = [{ type: "reasoning", id: "rs_1", summary: [] }];
    if (kind === "reasoning-setting") input.reasoning.effort = "low";
    if (kind === "reasoning-usage") input.usage.output_tokens_details.reasoning_tokens = 1;
    if (kind === "refusal") input.output[0].content = [{ type: "refusal", refusal: "Synthetic refusal" }];
    if (kind === "two-tools") input.output = [tool(), tool("files.write")];
    if (kind === "tool-plus-final") input.output = [tool(), final()];
    if (kind === "web-search") input.output = [{ type: "web_search_call", id: "ws_1", status: "completed" }];
    if (kind === "commentary") input.output[0].phase = "commentary";
    if (kind === "annotations") input.output[0].content[0].annotations = [{ type: "file_citation", file_id: "file_1" }];
    if (kind === "logprobs") input.output[0].content[0].logprobs = [{ token: "private", logprob: -1 }];
    expect(rejected(input).details.usage).toEqual(input.usage);
  });
  test.each(["tool", "namespace", "async", "caller", "status", "extra", "args-extra", "args-missing", "args-type", "args-bound", "args-prototype"])("rejects forbidden function detail: %s", kind => {
    const input = response(); input.output = [tool()]; const call = input.output[0];
    if (kind === "tool") call.name = "Bash";
    if (kind === "namespace") call.namespace = "functions";
    if (kind === "async") call.async = true;
    if (kind === "caller") call.caller = { type: "program", caller_id: "program_1" };
    if (kind === "status") call.status = "in_progress";
    if (kind === "extra") call.execute = true;
    if (kind === "args-extra") call.arguments = '{"path":"MEMORY.md","workspaceId":"foreign"}';
    if (kind === "args-missing") call.arguments = '{}';
    if (kind === "args-type") call.arguments = '{"path":123}';
    if (kind === "args-bound") call.arguments = JSON.stringify({ path: "x".repeat(1025) });
    if (kind === "args-prototype") call.arguments = '{"path":"MEMORY.md","__proto__":{}}';
    expect(rejected(input)).toBeInstanceOf(CodexApiResponseError);
  });
  test("conditional creation preserves null revision; broker remains the filesystem authority", () => {
    const input = response(); input.output = [tool("files.write")];
    input.output[0].arguments = '{"path":"MEMORY.md","text":"","expectedRevision":null}';
    const admitted = normalizeCodexApiResponse(JSON.stringify(input), binding());
    expect(admitted.result.kind === "tool" && admitted.result.arguments.expectedRevision).toBeNull();
  });
  test.each(["missing", "null", "extra", "fraction", "negative", "total", "cached", "overflow", "cap", "detail"])("does not synthesize valid usage from %s", kind => {
    const input = response();
    if (kind === "missing") delete input.usage;
    if (kind === "null") input.usage = null;
    if (kind === "extra") input.usage.audio_tokens = 10;
    if (kind === "fraction") input.usage.output_tokens = 1.5;
    if (kind === "negative") input.usage.input_tokens = -1;
    if (kind === "total") input.usage.total_tokens++;
    if (kind === "cached") input.usage.input_tokens_details.cached_tokens = 999;
    if (kind === "overflow") input.usage.total_tokens = Number.MAX_SAFE_INTEGER + 1;
    if (kind === "cap") { input.usage.output_tokens = 2049; input.usage.total_tokens = 2102; }
    if (kind === "detail") delete input.usage.output_tokens_details;
    const error = rejected(input); expect(error.code).toBe("CODEX_API_USAGE_INVALID");
    expect(error.details.usageStatus).toBe(kind === "missing" || kind === "null" ? "missing" : kind === "cap" ? "validated" : "invalid");
  });
  test("older cache-write omission stays omitted, not invented as zero", () => {
    const input = response(); delete input.usage.input_tokens_details.cache_write_tokens;
    expect(normalizeCodexApiResponse(JSON.stringify(input), binding()).usage).toEqual(input.usage);
  });
  test.each(["not-json", "duplicate", "escaped-duplicate", "deep", "nodes", "bytes", "nonfinite"])("bounds and disambiguates raw JSON: %s", kind => {
    let raw = JSON.stringify(response());
    if (kind === "not-json") raw = "{";
    if (kind === "duplicate") raw = raw.replace('"store":false', '"store":true,"store":false');
    if (kind === "escaped-duplicate") raw = raw.replace('"store":false', '"st\\u006fre":true,"store":false');
    if (kind === "deep") raw = "[".repeat(34) + "0" + "]".repeat(34);
    if (kind === "nodes") raw = JSON.stringify(Array.from({ length: 32_769 }, () => 0));
    if (kind === "bytes") raw = " ".repeat(2 * 1024 * 1024 + 1);
    if (kind === "nonfinite") raw = raw.replace('"temperature":1', '"temperature":1e999');
    expect(rejected(raw)).toBeInstanceOf(CodexApiResponseError);
  });
  test.each(["duplicate", "deep", "bytes", "not-json", "two-values"])("final JSON rejects %s without returning partial text", kind => {
    const input = response(); input.output[0].content[0].text = ({ duplicate: '{"x":1,"x":2}', deep: "[".repeat(34) + "0" + "]".repeat(34),
      bytes: JSON.stringify("a".repeat(512 * 1024)), "not-json": "hello", "two-values": "{} {}" } as Record<string, string>)[kind];
    expect(rejected(input).code).toBe("CODEX_API_FINAL_INVALID");
  });
  test("duplicate function arguments and unknown envelope effects fail closed", () => {
    const input = response(); input.output = [tool()]; input.output[0].arguments = '{"path":"foreign","path":"MEMORY.md"}';
    expect(rejected(input).code).toBe("CODEX_API_ARGUMENTS_INVALID");
    const extra = response(); extra.execute = { command: "forbidden" }; expect(rejected(extra).code).toBe("CODEX_API_UNKNOWN_FIELD");
  });
});
