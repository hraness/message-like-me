import { expect, test } from "bun:test";
import { createCapabilityProfile } from "../src/capabilities.ts";
import { createCodexCapabilityMapping, codexTaskSettings } from "../src/codex-config.ts";
import { codexLimits, startCodexRelay } from "../src/codex-relay.ts";

const model = "research-model", prompt = "Return the retained finding.", profile = createCapabilityProfile({
  id: "sponge-task-relay-fixture", version: 1, tools: [],
});
const mapping = createCodexCapabilityMapping(profile);
const settings = codexTaskSettings({ model: { id: model, reasoningEffort: "high", serviceTier: "default" },
  instructions: { base: "Use only the retained evidence.", developer: "Do not invent sources." } });
const events = (text: string) => [
  { type: "response.created", response: { id: "task-response-1" } },
  { type: "response.output_item.done", item: { type: "message", role: "assistant", id: "task-message-1", content: [{ type: "output_text", text }] } },
  { type: "response.completed", response: { id: "task-response-1", usage: { input_tokens: 31, output_tokens: 7, total_tokens: 38 } } },
];
const sse = (value: unknown) => new Response((value as Record<string, unknown>[]).map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
  { headers: { "content-type": "text/event-stream" } });

test("task relay binds generic profile, instructions, effort and service tier and returns text usage", async () => {
  const received: Record<string, unknown>[] = [];
  const relay = startCodexRelay({ model, prompt, tools: mapping.tools, signal: new AbortController().signal,
    limits: codexLimits({ ioMs: 1000, cleanupMs: 1000 }),
    task: { mapping, settings, executionDeadlineUnixMs: Date.now() + 120_000, maxOutputBytes: 4096 },
    fail: code => { throw new Error(code); },
    upstream: { async request(body) { received.push(structuredClone(body)); return sse(events("A retained finding.")); } },
  });
  relay.bindTurn("task-thread", "task-turn");
  try {
    const response = await fetch(`${relay.baseUrl}/responses`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, instructions: settings.instructions.base,
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: prompt }] }], tools: [], tool_choice: "auto",
        parallel_tool_calls: false, reasoning: { effort: "high", summary: "auto" }, service_tier: "default", store: false, stream: true,
        include: [], text: { verbosity: "low" } }) });
    expect(response.status).toBe(200);
    expect(relay.resultText()).toBe("A retained finding.");
    expect(relay.result()).toBe("A retained finding.");
    expect(relay.usage()).toEqual({ inputTokens: 31, outputTokens: 7, totalTokens: 38 });
    expect(received[0]).toMatchObject({ model, instructions: settings.instructions.base, service_tier: "default" });
  } finally {
    const receipt = await relay.close();
    expect(receipt.joined).toBe(true);
  }
});

test("task relay refuses a changed effort or service tier without an upstream call", async () => {
  let calls = 0;
  const relay = startCodexRelay({ model, prompt, tools: mapping.tools, signal: new AbortController().signal,
    limits: codexLimits({ ioMs: 1000, cleanupMs: 1000 }), task: { mapping, settings, executionDeadlineUnixMs: Date.now() + 120_000, maxOutputBytes: 4096 },
    fail: () => {}, upstream: { async request() { calls++; return sse(events("unused")); } } });
  relay.bindTurn("task-thread", "task-turn");
  try {
    const response = await fetch(`${relay.baseUrl}/responses`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, instructions: settings.instructions.base,
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: prompt }] }], tools: [], tool_choice: "auto",
        parallel_tool_calls: false, reasoning: { effort: "low", summary: "auto" }, service_tier: "default", store: false, stream: true, include: [] }) });
    expect(response.status).toBe(400); expect(calls).toBe(0);
  } finally { expect((await relay.close()).joined).toBe(true); }
});
