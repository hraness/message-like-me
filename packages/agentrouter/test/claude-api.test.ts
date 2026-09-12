import { expect, test } from "bun:test";
import { createClaudeApiAdapter, apiAdapter } from "../src/claude-api.ts";
import { claudeApiClient, type ClaudeApiClient } from "../src/claude-api-transport.ts";
import { createToolBroker, BROKER_TOOL_NAMES } from "../src/broker.ts";
import { createEnvironmentClaudeApiKeyResolver } from "../src/claude-credentials.ts";
import { AgentRouter, type AgentRunRequest, type RuntimeQualification } from "../src/runtime.ts";
import type { ModelCatalog } from "../src/models.ts";
import type { MessageCreateParams } from "@anthropic-ai/sdk/resources/messages";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const key = ["sk", "ant", "api03", "synthetic", "fixture", "credential"].join("-");
const credentials = createEnvironmentClaudeApiKeyResolver({ owner: "SYNTHETIC_KEY" }, () => key);
const now = 1_000_000;
const modelCatalog: ModelCatalog = { provider: "claude", observedAt: now, models: [{ id: "synthetic-model", available: true,
  supportsStructuredOutput: true, classifierEligible: true, inputUsdPerMillion: 1, outputUsdPerMillion: 2 }] };
const qualification: RuntimeQualification = { status: "qualified", profile: "agentrouter.scoped-tools.v1", runtimeVersion: "synthetic-api",
  runtimeDigest: "1".repeat(64), evidenceDigest: "2".repeat(64), expiresAt: now + 1000,
  controls: { noCommandTools: true, exactToolInventory: true, contactReadIsolation: true, contactWriteIsolation: true,
    isolatedConfiguration: true, authOutsideWorkspace: true, hostBrokerOnly: true } };
const text = (value: unknown) => ({ type: "text", text: JSON.stringify(value) });
const call = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input });
function response(content: unknown[], stop = "end_turn") { return { id: "msg_fixture", type: "message", role: "assistant", model: "synthetic-model", content,
  stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }; }
function fixture(purpose: "classify" | "respond" = "respond") {
  const controller = new AbortController(); let active = true;
  const effects: unknown[] = [];
  const broker = createToolBroker({ workspaceId: "contact", runId: "run", allowedTools: purpose === "classify" ? [] : BROKER_TOOL_NAMES,
    signal: controller.signal, isActive: () => active,
    files: { read: async (id, path) => { effects.push(["read", id, path]); return { text: "memory", revision: "rev" }; },
      write: async (id, path, value, rev) => { effects.push(["write", id, path, value, rev]); if (rev !== "rev") throw new Error("stale"); return { revision: "new" }; } },
    web: { fetchPublic: async url => { effects.push(["web", url]); return { url, text: "public" }; } },
    messaging: { stage: async (id, run, action) => { effects.push(["stage", id, run, action]); return { intentId: "staged" }; } } });
  const request: AgentRunRequest = { provider: "claude", accountId: "owner", workspaceId: "contact", runId: "run", prompt: "Return JSON.",
    model: "synthetic-model", purpose, signal: controller.signal };
  return { broker, request, controller, effects, revoke: () => { active = false; controller.abort(); } };
}
function adapter(responses: unknown[], seen: unknown[] = []) {
  let index = 0;
  const client = { messages: { create: async (value: MessageCreateParams) => { seen.push(structuredClone(value)); return responses[index++]; } } } as unknown as ClaudeApiClient;
  return apiAdapter({ credentials, modelCatalog: async () => modelCatalog, now: () => now }, qualification, () => client);
}

test("API profile admits its pinned host executor and classifier has zero tools", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "agentrouter-artifact-")));
  try {
    const entrypoint = join(directory, "synthetic-compiled-entry.js"), bytes = "synthetic compiled host fixture";
    await writeFile(entrypoint, bytes, { mode: 0o600 });
    const runtimeArtifact = { entrypoint, sha256: createHash("sha256").update(bytes).digest("hex") };
    const installed = await createClaudeApiAdapter({ runtimeArtifact, credentials, modelCatalog: async () => modelCatalog, now: () => now });
    expect(installed.qualification.status).toBe("qualified");
    if (installed.qualification.status === "qualified") expect(installed.qualification.runtimeVersion).toContain("claude-api/");
    await writeFile(entrypoint, "changed fixture");
    await expect(createClaudeApiAdapter({ runtimeArtifact, credentials, modelCatalog: async () => modelCatalog })).rejects.toThrow("ARTIFACT_CHANGED");
  } finally { await rm(directory, { recursive: true, force: true }); }
  const f = fixture("classify"), seen: unknown[] = [];
  const result = await adapter([response([text({ respond: false, confidence: 1, reason: "not_needed" })])], seen).run(f.request, f.broker);
  expect(result.processStopped).toBe(true);
  expect((seen[0] as MessageCreateParams).tools).toEqual([]);
  expect((seen[0] as MessageCreateParams).max_tokens).toBe(512);
  expect(f.effects).toEqual([]);
});

test("API tool loop denies shell, cross-folder and private URL inputs, while conditional edits and staged actions use fixed scope", async () => {
  const f = fixture(), seen: unknown[] = [];
  const first = response([
    call("a", "Bash", { command: "touch forbidden" }),
    call("b", "agentrouter_files_read", { path: "../other" }),
    call("c", "agentrouter_web_fetch", { url: "http://localhost/", maxBytes: 100 }),
    call("d", "agentrouter_files_write", { path: "MEMORY.md", text: "edited", expectedRevision: "rev" }),
    call("e", "agentrouter_messages_propose_text", { text: "reply", idempotencyKey: "reply-1" }),
    call("f", "agentrouter_messages_propose_reaction", { messageId: "message-1", reaction: "like", idempotencyKey: "reaction-1" }),
    call("g", "agentrouter_messages_propose_attachment", { path: "outbox/file.txt", caption: "file", idempotencyKey: "file-1" }),
    call("h", "agentrouter_web_fetch", { url: "https://example.com/", maxBytes: 100 }),
  ], "tool_use");
  const result = await adapter([first, response([text({ summary: "done", actions: [] })])], seen).run(f.request, f.broker);
  expect(result.output).toEqual({ summary: "done", actions: [] });
  expect(f.effects).toHaveLength(5);
  expect(f.effects[0]).toEqual(["write", "contact", "MEMORY.md", "edited", "rev"]);
  expect(f.effects.slice(1, 4).every(effect => (effect as string[])[0] === "stage")).toBe(true);
  const replies = (seen[1] as MessageCreateParams).messages.at(-1)?.content as { type: string; is_error?: boolean; content: string }[];
  expect(replies.filter(block => block.is_error)).toHaveLength(3);
  expect(replies[4]?.content).toBe('{"intentId":"staged"}');
  expect((seen[0] as MessageCreateParams).tools?.every(tool => "name" in tool && tool.name.startsWith("agentrouter_") && !tool.type)).toBe(true);
});

test("unexpected server capabilities, mismatched model, duplicate tool IDs and incomplete output fail closed", async () => {
  for (const messages of [
    [response([{ type: "server_tool_use", id: "a", name: "bash", input: {} }])],
    [{ ...response([text({})]), model: "other-model" }],
    [response([text({})], "max_tokens")],
    [response([call("same", "Bash", {}), call("same", "Bash", {})], "tool_use")],
  ]) {
    const f = fixture(); await expect(adapter(messages).run(f.request, f.broker)).rejects.toThrow("CLAUDE_API_RUN_FAILED");
    expect(f.effects).toEqual([]);
  }
});

test("revocation during provider response prevents tools and releases the no-process account custody", async () => {
  const f = fixture(); let released = false;
  const client = { messages: { create: async () => { f.revoke(); return response([call("a", "agentrouter_files_write", { path: "MEMORY.md", text: "bad", expectedRevision: "rev" })], "tool_use"); } } } as unknown as ClaudeApiClient;
  const selected = apiAdapter({ credentials, modelCatalog: async () => modelCatalog, now: () => now }, qualification, () => client);
  const router = new AgentRouter({ adapters: [selected], now: () => now, leases: {
    acquire: input => ({ ...input, generation: 1, expiresAt: now + 1000 }),
    renew: lease => lease,
    release: () => { released = true; return true; },
  } });
  await expect(router.run(f.request, f.broker)).rejects.toThrow("CLAUDE_API_RUN_FAILED");
  expect(f.effects).toEqual([]); expect(released).toBe(true);
});

test("fixed API transport strips inherited headers and credentials, disables redirects/retries, and bounds raw responses", async () => {
  const f = fixture("classify"), seen: { url: string; init: RequestInit }[] = [];
  const network = async (url: string, init: RequestInit) => { seen.push({ url, init });
    return Response.json(response([text({ ok: true })])); };
  const prior = process.env.ANTHROPIC_CUSTOM_HEADERS;
  try {
    process.env.ANTHROPIC_CUSTOM_HEADERS = "authorization: unrelated\nx-host-secret: unrelated";
    const client = claudeApiClient(key, f.controller.signal, network);
    await client.messages.create({ model: "synthetic-model", max_tokens: 128, messages: [{ role: "user", content: "fixture" }] });
    expect(seen).toHaveLength(1); expect(seen[0]?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(new Headers(seen[0]?.init?.headers).get("authorization")).toBeNull();
    expect(new Headers(seen[0]?.init?.headers).get("x-host-secret")).toBeNull();
    expect(new Headers(seen[0]?.init?.headers).get("x-api-key")).toBe(key);
    expect(seen[0]?.init?.redirect).toBe("error"); expect(seen[0]?.init?.credentials).toBe("omit");
    const huge = claudeApiClient(key, f.controller.signal, async () => new Response("x".repeat(2 * 1024 * 1024 + 1), { headers: { "content-type": "application/json" } }));
    await expect(Promise.resolve(huge.messages.create({ model: "synthetic-model", max_tokens: 128, messages: [] }))).rejects.toThrow();
  } finally { if (prior === undefined) delete process.env.ANTHROPIC_CUSTOM_HEADERS; else process.env.ANTHROPIC_CUSTOM_HEADERS = prior; }
});

test("unqualified, stale models and exhausted budgets prevent requests and credentials are not a fallback", async () => {
  for (const variant of ["unqualified", "stale", "budget"] as const) {
    const f = fixture(); let calls = 0;
    const selected = apiAdapter({ credentials,
      modelCatalog: async () => variant === "stale" ? { ...modelCatalog, observedAt: now - 86_400_001 } : modelCatalog,
      now: () => now, ...(variant === "budget" ? { maxBudgetUsd: 0.0000001 } : {}),
    }, variant === "unqualified" ? { status: "unqualified", reason: "fixture" } : qualification,
    () => ({ messages: { create: async () => { calls++; return response([text({})]); } } }) as unknown as ClaudeApiClient);
    await expect(selected.run(f.request, f.broker)).rejects.toThrow("CLAUDE_API_RUN_FAILED");
    expect(calls).toBe(0); expect(f.effects).toEqual([]);
  }
});
