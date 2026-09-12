import { expect, test } from "bun:test";
import { BROKER_TOOL_NAMES, createToolBroker, type BrokerToolName } from "../src/broker.ts";
import { CODEX_TOOL_NAMES, codexResponseTools, codexTools } from "../src/codex-config.ts";
import { assertCodexCapabilityMapping, createCodexCapabilityMapping, codexTaskSettings, codexTaskConfiguration } from "../src/codex-config.ts";
import { createCapabilityProfile, type CapabilityProfile } from "../src/capabilities.ts";

test("registered capability mappings preserve distinct names and recursive schemas", () => {
  const inputSchema = { type: "object", properties: { node: { $ref: "#/$defs/Node" } }, required: ["node"], additionalProperties: false,
    $defs: { Node: { type: "object", properties: { children: { type: "array", items: { $ref: "#/$defs/Node" } } }, additionalProperties: false } } };
  const profile = createCapabilityProfile({ id: "sponge-fixture", version: 1,
    tools: ["a.b", "a_b", "a-b", "A".repeat(128)].map(name => ({ name, description: name, inputSchema, parseInput: input => input, execute: () => null })) });
  const mapping = createCodexCapabilityMapping(profile);
  expect(new Set(mapping.tools.map(tool => tool.name)).size).toBe(4);
  for (const tool of profile.tools) expect(mapping.capabilityName(mapping.nativeName(tool.name)!)).toBe(tool.name);
  expect(mapping.nativeName("foreign")).toBeNull(); expect(mapping.capabilityName("foreign")).toBeNull();
  expect(mapping.tools.every(tool => tool.name.length <= 64)).toBe(true);
  expect(mapping.tools[0]!.inputSchema).toEqual(inputSchema);
  expect(codexResponseTools(mapping.tools)[0]!.parameters).toEqual(inputSchema);
  expect(Object.isFrozen(mapping.tools[0]!.inputSchema.$defs)).toBe(true);
  expect(createCodexCapabilityMapping(profile).descriptorDigest).toBe(mapping.descriptorDigest);
  expect(() => assertCodexCapabilityMapping(mapping, { ...mapping.profile, digest: "a".repeat(64) })).toThrow("CAPABILITY_PROFILE_MISMATCH");
  expect(() => assertCodexCapabilityMapping({ ...mapping }, mapping.profile)).toThrow("CODEX_CAPABILITY_MAPPING_UNREGISTERED");
  expect(() => createCodexCapabilityMapping({ ...profile } as CapabilityProfile)).toThrow("CAPABILITY_PROFILE_MISMATCH");
});

test("task settings snapshot model intent and keep TOML values inert", () => {
  const input = { model: { id: "synthetic-model", reasoningEffort: "high", serviceTier: "default" },
    instructions: { base: "Read the bound document.", developer: "Use only retained evidence." } };
  const settings = codexTaskSettings(input); input.model.id = "changed"; input.instructions.base = "changed";
  const config = codexTaskConfiguration(settings, `http://127.0.0.1:1234/relay/${"a".repeat(48)}`);
  expect(settings.model.id).toBe("synthetic-model"); expect(settings.instructions.base).toBe("Read the bound document.");
  expect(config).not.toContain("model_reasoning_effort"); expect(config).not.toContain("service_tier =");
  expect(config).toContain('requires_openai_auth = false');
  const defaulted = codexTaskSettings({ ...input, model: { id: "fixture", reasoningEffort: null, serviceTier: null } });
  expect(codexTaskConfiguration(defaulted, `http://127.0.0.1:1234/relay/${"a".repeat(48)}`)).not.toContain("service_tier =");
  expect(() => codexTaskConfiguration({ ...settings, instructionDigest: "a".repeat(64) }, `http://127.0.0.1:1234/relay/${"a".repeat(48)}`)).toThrow("CODEX_TASK_SETTINGS_CHANGED");
  expect(() => codexTaskSettings({ ...input, model: { ...input.model, serviceTier: undefined } } as any)).toThrow();
});

test("fixed native wire schemas match the pinned serde subset without mutating host descriptors", () => {
  const tools = codexTools(BROKER_TOOL_NAMES), before = structuredClone(tools);
  const string = { type: "string" };
  const expectedProperties = [
    { path: string },
    { path: string, text: string, expectedRevision: { anyOf: [string, { type: "null" }] } },
    { url: string, maxBytes: { type: "integer" } },
    { text: string, idempotencyKey: string },
    { messageId: string, reaction: { type: "string", enum: ["love", "like", "dislike", "laugh", "emphasize", "question"] }, idempotencyKey: string },
    { path: string, caption: string, idempotencyKey: string },
  ];
  expect(codexResponseTools(tools)).toEqual(tools.map((tool, i) => ({
    type: "function", name: CODEX_TOOL_NAMES[BROKER_TOOL_NAMES[i]!], description: tool.description, strict: false,
    parameters: { type: "object", properties: expectedProperties[i], required: Object.keys(expectedProperties[i]!), additionalProperties: false },
  })));
  expect(tools).toEqual(before);
  expect(tools[0]!.inputSchema).toHaveProperty("properties.path.maxLength", 1024);
  expect(tools[2]!.inputSchema).toHaveProperty("properties.maxBytes.maximum", 256 * 1024);
  expect(codexResponseTools(codexTools([]))).toEqual([]);
});

test("projection visits schema nodes without erasing property names, enum data, or unrelated keywords", () => {
  const leaf = { type: "string", minLength: 1, maxLength: 5, minimum: 1, maximum: 5, pattern: "retained-unknown-keyword" };
  const projectedLeaf = { type: "string", pattern: "retained-unknown-keyword" };
  const schema = { type: "object", properties: { minLength: leaf, maximum: { type: "array", minItems: 1, items: leaf } },
    required: ["minLength", "maximum"], additionalProperties: leaf, $defs: { maximum: leaf }, definitions: { minLength: leaf },
    anyOf: [leaf, { type: "null" }], oneOf: [leaf], allOf: [leaf], enum: [{ minLength: 1, maximum: 5 }], description: "minLength" };
  const original = structuredClone(schema);
  expect(codexResponseTools([{ type: "function", name: "synthetic", description: "fixture", inputSchema: schema }])[0]!.parameters).toEqual({
    type: "object", properties: { minLength: projectedLeaf, maximum: { type: "array", minItems: 1, items: projectedLeaf } },
    required: ["minLength", "maximum"], additionalProperties: projectedLeaf, $defs: { maximum: projectedLeaf }, definitions: { minLength: projectedLeaf },
    anyOf: [projectedLeaf, { type: "null" }], oneOf: [projectedLeaf], allOf: [projectedLeaf], enum: [{ minLength: 1, maximum: 5 }], description: "minLength",
  });
  expect(schema).toEqual(original);
});

const rejectedInputs: readonly [string, BrokerToolName, unknown, string][] = [
  ["empty read path", "files.read", { path: "" }, "INVALID_TEXT"],
  ["oversized read path", "files.read", { path: "a".repeat(1025) }, "INVALID_TEXT"],
  ["relative escape", "files.read", { path: "../MEMORY.md" }, "PATH_OUTSIDE_WORKSPACE"],
  ["oversized write", "files.write", { path: "MEMORY.md", text: "a".repeat(256 * 1024 + 1), expectedRevision: null }, "INVALID_TEXT"],
  ["oversized revision", "files.write", { path: "MEMORY.md", text: "hello", expectedRevision: "a".repeat(161) }, "INVALID_TEXT"],
  ["zero web bound", "web.fetch", { url: "https://example.com/", maxBytes: 0 }, "INVALID_INTEGER"],
  ["oversized web bound", "web.fetch", { url: "https://example.com/", maxBytes: 256 * 1024 + 1 }, "INVALID_INTEGER"],
  ["oversized URL", "web.fetch", { url: `https://example.com/${"a".repeat(8192)}`, maxBytes: 1 }, "INVALID_TEXT"],
  ["empty text", "messages.propose_text", { text: "", idempotencyKey: "intent-1" }, "INVALID_TEXT"],
  ["oversized text", "messages.propose_text", { text: "a".repeat(16 * 1024 + 1), idempotencyKey: "intent-1" }, "INVALID_TEXT"],
  ["oversized message ID", "messages.propose_reaction", { messageId: "a".repeat(161), reaction: "like", idempotencyKey: "intent-1" }, "INVALID_TEXT"],
  ["unknown reaction", "messages.propose_reaction", { messageId: "message-1", reaction: "other", idempotencyKey: "intent-1" }, "UNSUPPORTED_REACTION"],
  ["oversized caption", "messages.propose_attachment", { path: "outbox/file.txt", caption: "a".repeat(16 * 1024 + 1), idempotencyKey: "intent-1" }, "INVALID_TEXT"],
  ["oversized idempotency key", "messages.propose_attachment", { path: "outbox/file.txt", caption: "", idempotencyKey: "a".repeat(161) }, "INVALID_TEXT"],
];
for (const [name, tool, input, code] of rejectedInputs) test(`broker still enforces ${name} after native schema hints are removed`, async () => {
  const calls: unknown[] = [];
  const broker = createToolBroker({ workspaceId: "contact-1", runId: "run-1", isActive: () => true,
    files: { async read(...args) { calls.push(args); return { text: "", revision: "revision-1" }; },
      async write(...args) { calls.push(args); return { revision: "revision-2" }; } },
    web: { async fetchPublic(...args) { calls.push(args); return { text: "", url: "https://example.com/" }; } },
    messaging: { async stage(...args) { calls.push(args); return { intentId: "intent-1" }; } },
  });
  expect(codexResponseTools(codexTools([tool]))).toHaveLength(1);
  await expect(broker.invoke(tool, input)).rejects.toThrow(code);
  expect(calls).toHaveLength(0);
});

test("a valid byte-boundary proposal still passes through the scoped staging port", async () => {
  const calls: unknown[] = [], text = "é".repeat(8 * 1024);
  const broker = createToolBroker({ workspaceId: "contact-1", runId: "run-1", isActive: () => true,
    files: { async read() { throw new Error("UNEXPECTED_READ"); }, async write() { throw new Error("UNEXPECTED_WRITE"); } },
    web: { async fetchPublic() { throw new Error("UNEXPECTED_WEB"); } },
    messaging: { async stage(workspaceId, runId, operation) { calls.push({ workspaceId, runId, operation }); return { intentId: "intent-1" }; } },
  });
  expect(Buffer.byteLength(text)).toBe(16 * 1024);
  await expect(broker.invoke("messages.propose_text", { text, idempotencyKey: "intent-1" })).resolves.toEqual({ intentId: "intent-1" });
  expect(calls).toEqual([{ workspaceId: "contact-1", runId: "run-1", operation: { kind: "text", text, idempotencyKey: "intent-1" } }]);
});
