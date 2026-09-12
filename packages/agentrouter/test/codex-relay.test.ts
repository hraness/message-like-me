import { expect, test } from "bun:test";
import { BROKER_TOOL_NAMES, type BrokerToolName } from "../src/broker.ts";
import { CODEX_BASE_INSTRUCTIONS, codexResponseTools, codexTools } from "../src/codex-config.ts";
import { codexLimits, startCodexRelay, type CodexRelayReceipt } from "../src/codex-relay.ts";

const marker = "untrusted-body-marker-do-not-log", prompt = "Synthetic request; return JSON.", model = "gpt-5.5";
function requestBody(): Record<string, any> {
  return { model, instructions: CODEX_BASE_INSTRUCTIONS, input: [{ type: "message", role: "user", content: [{ type: "input_text", text: prompt }] }],
    tools: [], tool_choice: "auto", parallel_tool_calls: false, reasoning: { effort: "medium", summary: "auto" },
    store: false, stream: true, include: ["reasoning.encrypted_content"], text: { verbosity: "low" },
    prompt_cache_key: "thread-1", client_metadata: { "synthetic-field": "synthetic-value" } };
}
function response(): Response {
  const events = [{ type: "response.created", response: { id: "response-1" } },
    { type: "response.output_item.done", item: { type: "message", role: "assistant", id: "message-1", content: [{ type: "output_text", text: '{"ok":true}' }] } },
    { type: "response.completed", response: { id: "response-1", usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 } } }];
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream" } });
}
async function send(body: string | Uint8Array, names: readonly BrokerToolName[] = []): Promise<{ status: number; publicError: string; receipt: CodexRelayReceipt; received: unknown[]; failures: string[] }> {
  const received: unknown[] = [], failures: string[] = [];
  const relay = startCodexRelay({ model, prompt, tools: codexTools(names), signal: new AbortController().signal,
    limits: codexLimits({ ioMs: 1000, cleanupMs: 1000 }), fail: code => { failures.push(code); },
    upstream: { async request(value) { received.push(structuredClone(value)); return response(); } } });
  relay.bindTurn("thread-1", "turn-1");
  let status = 0, publicError = "", receipt!: CodexRelayReceipt;
  try {
    const payload = typeof body === "string" ? body : new Uint8Array(body).buffer;
    const result = await fetch(`${relay.baseUrl}/responses`, { method: "POST", headers: { "content-type": "application/json" }, body: payload });
    status = result.status; publicError = await result.text();
  } finally { receipt = await relay.close(); }
  return { status, publicError, receipt, received, failures };
}

test("pinned basic native request fields keep their existing admission behavior", async () => {
  const body = requestBody(), result = await send(JSON.stringify(body));
  expect(result.status).toBe(200); expect(result.received).toHaveLength(1);
  const expected = structuredClone(body); delete expected.client_metadata;
  expect(result.received[0]).toEqual(expected); expect(result.receipt.failure).toBeNull(); expect(result.receipt.joined).toBe(true);
});

test("all six exactly projected native descriptors reach upstream in their fixed order", async () => {
  const body = requestBody(); body.tools = codexResponseTools(codexTools(BROKER_TOOL_NAMES));
  const result = await send(JSON.stringify(body), BROKER_TOOL_NAMES);
  expect(result.status).toBe(200); expect(result.received).toHaveLength(1);
  expect(result.received[0]).toHaveProperty("tools", body.tools);
  expect(result.receipt.failure).toBeNull(); expect(result.receipt.joined).toBe(true);
});

const rejectedManifests: readonly { name: string; change(tools: Record<string, any>[]): void }[] = [
  { name: "description", change: tools => { tools[0]!.description = "different"; } },
  { name: "parameter type", change: tools => { tools[0]!.parameters.properties.path.type = "integer"; } },
  { name: "unknown descriptor field", change: tools => { tools[0]!.unknown = true; } },
  { name: "unknown schema field", change: tools => { tools[0]!.parameters.properties.path.pattern = ".*"; } },
  { name: "unprojected raw schema", change: tools => { tools[0]!.parameters = codexTools(BROKER_TOOL_NAMES)[0]!.inputSchema; } },
  { name: "omitted tool", change: tools => { tools.pop(); } },
  { name: "duplicate tool", change: tools => { tools[1] = structuredClone(tools[0]!); } },
  { name: "unknown name", change: tools => { tools[0]!.name = "Bash"; } },
  { name: "reversed order", change: tools => { tools.reverse(); } },
];
for (const { name, change } of rejectedManifests) test(`projected manifest equality still rejects ${name}`, async () => {
  const body = requestBody(); body.tools = codexResponseTools(codexTools(BROKER_TOOL_NAMES)); change(body.tools);
  const result = await send(JSON.stringify(body), BROKER_TOOL_NAMES);
  expect(result.status).toBe(400); expect(result.received).toHaveLength(0);
  expect(result.receipt.failure).toBe("CODEX_TOOL_MANIFEST_MISMATCH"); expect(result.receipt.joined).toBe(true);
});

test("one bounded native turn telemetry object may exceed 512 bytes but no client metadata reaches upstream", async () => {
  const body = requestBody();
  body.client_metadata["x-codex-turn-metadata"] = JSON.stringify({ workspaces: { [marker]: { label: marker.repeat(50) } },
    tool_namespaces_info: { synthetic: { tool_names: [marker] } } });
  expect(Buffer.byteLength(body.client_metadata["x-codex-turn-metadata"])).toBeGreaterThan(512);
  const result = await send(JSON.stringify(body));
  expect(result.status).toBe(200); expect(result.received).toHaveLength(1); expect(result.receipt.joined).toBe(true);
  expect(result.received[0]).not.toHaveProperty("client_metadata");
  expect(JSON.stringify({ upstream: result.received, receipt: result.receipt })).not.toContain(marker);
});

test("native telemetry's exact 64KiB boundary is accepted only for the fixed parsed-object key", async () => {
  const body = requestBody(), text = JSON.stringify({ padding: "a".repeat(64 * 1024 - 14) });
  expect(Buffer.byteLength(text)).toBe(64 * 1024);
  body.client_metadata["x-codex-turn-metadata"] = text;
  const result = await send(JSON.stringify(body)); expect(result.status).toBe(200); expect(result.receipt.joined).toBe(true);
});

const rejectedShapes: readonly { name: string; change(body: Record<string, any>): void; code: string }[] = [
  { name: "request envelope", change: body => { body[marker] = marker; }, code: "CODEX_RELAY_REQUEST_UNKNOWN_FIELD" },
  { name: "reasoning object", change: body => { body.reasoning[marker] = marker; }, code: "CODEX_RELAY_REASONING_UNKNOWN_FIELD" },
  { name: "text format", change: body => { body.text.format = { type: "json_schema", schema: { description: marker } }; }, code: "CODEX_RELAY_TEXT_CONTROL_UNKNOWN_FIELD" },
  { name: "stream extension", change: body => { body.stream_options = { reasoning_summary_delivery: "sequential_cutoff", [marker]: marker }; }, code: "CODEX_RELAY_STREAM_CONTROL_UNKNOWN_FIELD" },
  { name: "access programs", change: body => { body.access_programs = { [marker]: marker }; }, code: "CODEX_RELAY_ACCESS_PROGRAMS_UNSUPPORTED" },
  { name: "message metadata", change: body => { body.input[0].internal_chat_message_metadata_passthrough = { turn_id: "turn-1" }; }, code: "CODEX_RELAY_MESSAGE_METADATA_UNSUPPORTED" },
  { name: "message phase", change: body => { body.input[0].phase = "commentary"; }, code: "CODEX_RELAY_MESSAGE_PHASE_UNSUPPORTED" },
  { name: "unknown message field", change: body => { body.input[0][marker] = marker; }, code: "CODEX_RELAY_INPUT_MESSAGE_UNKNOWN_FIELD" },
  { name: "content extension", change: body => { body.input[0].content[0][marker] = marker; }, code: "CODEX_RELAY_INPUT_CONTENT_UNKNOWN_FIELD" },
  { name: "null text controls", change: body => { body.text = null; }, code: "CODEX_RELAY_TEXT_CONTROL_INVALID_OBJECT" },
  { name: "nonobject message", change: body => { body.input[0] = marker; }, code: "CODEX_RELAY_INPUT_MESSAGE_INVALID_OBJECT" },
  { name: "nonobject content", change: body => { body.input[0].content[0] = marker; }, code: "CODEX_RELAY_INPUT_CONTENT_INVALID_OBJECT" },
  { name: "metadata string bound", change: body => { body.client_metadata[marker] = "a".repeat(513); }, code: "CODEX_RELAY_CLIENT_METADATA_VALUE_INVALID" },
  { name: "metadata key bound", change: body => { body.client_metadata["a".repeat(81)] = marker; }, code: "CODEX_RELAY_CLIENT_METADATA_KEY_INVALID" },
  { name: "metadata null object", change: body => { body.client_metadata = null; }, code: "CODEX_RELAY_CLIENT_METADATA_INVALID" },
  { name: "prompt cache key bound", change: body => { body.prompt_cache_key = "a".repeat(161); }, code: "CODEX_RELAY_PROMPT_CACHE_KEY_INVALID" },
  { name: "oversized known telemetry", change: body => { body.client_metadata["x-codex-turn-metadata"] = JSON.stringify({ value: "a".repeat(64 * 1024) }); }, code: "CODEX_RELAY_NATIVE_METADATA_BOUND" },
  { name: "invalid telemetry JSON", change: body => { body.client_metadata["x-codex-turn-metadata"] = marker; }, code: "CODEX_RELAY_NATIVE_METADATA_INVALID_JSON" },
  { name: "null telemetry JSON", change: body => { body.client_metadata["x-codex-turn-metadata"] = "null"; }, code: "CODEX_RELAY_NATIVE_METADATA_INVALID" },
  { name: "array telemetry JSON", change: body => { body.client_metadata["x-codex-turn-metadata"] = "[]"; }, code: "CODEX_RELAY_NATIVE_METADATA_INVALID" },
  { name: "scalar telemetry JSON", change: body => { body.client_metadata["x-codex-turn-metadata"] = JSON.stringify(marker); }, code: "CODEX_RELAY_NATIVE_METADATA_INVALID" },
  { name: "nonstrings telemetry", change: body => { body.client_metadata["x-codex-turn-metadata"] = {}; }, code: "CODEX_RELAY_NATIVE_METADATA_BOUND" },
  { name: "similar unknown telemetry key", change: body => { body.client_metadata["x-codex-turn-metadata-extra"] = "a".repeat(513); }, code: "CODEX_RELAY_CLIENT_METADATA_VALUE_INVALID" },
];
for (const { name, change, code } of rejectedShapes) test(`finite diagnostics locate ${name} without copying its contents`, async () => {
  const body = requestBody(); change(body);
  const result = await send(JSON.stringify(body));
  expect(result.status).toBe(400); expect(result.received).toHaveLength(0);
  expect(result.receipt.failure).toBe(code); expect(result.failures).toEqual([code]); expect(result.receipt.joined).toBe(true);
  expect(JSON.stringify({ receipt: result.receipt, publicError: result.publicError })).not.toContain(marker);
});

test("invalid JSON and UTF-8 keep distinct bounded diagnostics without payload logging", async () => {
  for (const [body, code] of [[`{"${marker}":`, "CODEX_RELAY_REQUEST_INVALID_JSON"],
    [new Uint8Array([0xff, 0xfe, 0xfd]), "CODEX_HTTP_ENCODING_INVALID"]] as const) {
    const result = await send(body);
    expect(result.status).toBe(400); expect(result.received).toHaveLength(0); expect(result.receipt.failure).toBe(code);
    expect(result.receipt.joined).toBe(true); expect(result.publicError).not.toContain(marker);
  }
});
