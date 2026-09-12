import { expect, test } from "bun:test";
import { CAPABILITY_LIMITS, createCapabilityProfile, createCapabilityBroker, assertCapabilityProfile,
  type CapabilityTool, type CapabilityObject, type CapabilityJson, type CapabilityContext } from "../src/capabilities.ts";

const descriptor = () => ({ name: "document.read", description: "Read the assigned document.", inputSchema: {
  type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false,
} });
const tool = (execute: CapabilityTool["execute"] = value => value): CapabilityTool => ({ ...descriptor(),
  parseInput(input) { if (typeof input.value !== "string") throw Error("private parser detail"); return input; }, execute });
function makeBroker(tools: CapabilityTool[] = [tool()], extra: { signal?: AbortSignal; isActive?: () => boolean } = {}) {
  const profile = createCapabilityProfile({ id: "sponge.research", version: 1, tools });
  return createCapabilityBroker({ profile, workspaceId: "assigned-document", runId: "research-run-1",
    isActive: extra.isActive ?? (() => true), ...(extra.signal === undefined ? {} : { signal: extra.signal }) });
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test("workspace and run authority are captured from the host, never model input", async () => {
  let calls = 0;
  const broker = makeBroker([tool((value, context) => { calls++; return { value, workspaceId: context.workspaceId, runId: context.runId }; })]);
  expect(await broker.invoke("document.read", { value: "allowed" })).toEqual({ value: { value: "allowed" }, workspaceId: "assigned-document", runId: "research-run-1" });
  for (const input of [{ value: "bad", workspaceId: "foreign" }, { value: "bad", runId: "foreign" }, { value: "bad", unknown: true }])
    await expect(broker.invoke("document.read", input)).rejects.toThrow("CAPABILITY_INPUT_INVALID");
  await expect(broker.invoke("document.delete", { value: "bad" })).rejects.toThrow("CAPABILITY_TOOL_DENIED");
  expect(calls).toBe(1);
});

test("even a declared field named workspaceId cannot replace trusted context", async () => {
  const scopeTool: CapabilityTool = { name: "inspect.data", description: "Inspect scoped data.", inputSchema: {
    type: "object", properties: { workspaceId: { type: "string" }, runId: { type: "string" } }, additionalProperties: false,
  }, parseInput: input => input, execute: (_input, context) => ({ workspaceId: context.workspaceId, runId: context.runId }) };
  const profile = createCapabilityProfile({ id: "scope", version: 1, tools: [scopeTool] });
  const options = { profile, workspaceId: "one", runId: "run-one", isActive: () => true };
  const broker = createCapabilityBroker(options); options.workspaceId = "two"; options.runId = "run-two";
  expect(await broker.invoke("inspect.data", { workspaceId: "model-choice", runId: "model-run" })).toEqual({ workspaceId: "one", runId: "run-one" });
});

test("profile digest is stable for object key order and binds every descriptor and its order", () => {
  const first = createCapabilityProfile({ id: "sponge.research", version: 1, tools: [tool()] });
  const reordered = { ...tool(), inputSchema: { additionalProperties: false, required: ["value"], properties: { value: { type: "string" } }, type: "object" } };
  expect(createCapabilityProfile({ id: first.id, version: 1, tools: [reordered] }).digest).toBe(first.digest);
  for (const options of [
    { id: "other", version: 1, tools: [tool()] }, { id: first.id, version: 2, tools: [tool()] },
    { id: first.id, version: 1, tools: [{ ...tool(), description: "A changed tool." }] },
    { id: first.id, version: 1, tools: [{ ...tool(), inputSchema: { ...descriptor().inputSchema, required: [] } }] },
  ]) expect(createCapabilityProfile(options).digest).not.toBe(first.digest);
  const second = { ...tool(), name: "document.other" };
  expect(createCapabilityProfile({ id: "order", version: 1, tools: [tool(), second] }).digest)
    .not.toBe(createCapabilityProfile({ id: "order", version: 1, tools: [second, tool()] }).digest);
});

test("qualification must match the exact host-created profile, not a forged lookalike", () => {
  const profile = createCapabilityProfile({ id: "sponge.research", version: 1, tools: [tool()] });
  expect(() => assertCapabilityProfile(profile, { id: profile.id, version: profile.version, digest: profile.digest })).not.toThrow();
  for (const expected of [{ ...profile, id: "other" }, { ...profile, version: 2 }, { ...profile, digest: "0".repeat(64) }])
    expect(() => assertCapabilityProfile(profile, expected)).toThrow("CAPABILITY_PROFILE_MISMATCH");
  const forged = { ...profile };
  expect(() => assertCapabilityProfile(forged, profile)).toThrow("CAPABILITY_PROFILE_MISMATCH");
  expect(() => createCapabilityBroker({ profile: forged, workspaceId: "one", runId: "one", isActive: () => true })).toThrow("CAPABILITY_PROFILE_MISMATCH");
});

test("manifest and implementation aliases cannot alter an existing profile", async () => {
  const definition = { ...tool(), inputSchema: descriptor().inputSchema };
  const definitions = [definition];
  const profile = createCapabilityProfile({ id: "fixed", version: 1, tools: definitions });
  const digest = profile.digest;
  definition.inputSchema.properties.value.type = "number";
  definition.execute = () => ({ substituted: true }); definition.parseInput = () => ({ substituted: true }); definitions.length = 0;
  expect(profile.digest).toBe(digest); expect(profile.tools).toHaveLength(1);
  expect((profile.tools[0]!.inputSchema.properties as CapabilityObject).value).toEqual({ type: "string" });
  expect(Object.isFrozen(profile)).toBeTrue(); expect(Object.isFrozen(profile.tools)).toBeTrue();
  expect(Object.isFrozen(profile.tools[0]!.inputSchema.properties)).toBeTrue();
  const broker = createCapabilityBroker({ profile, workspaceId: "one", runId: "one", isActive: () => true });
  expect(await broker.invoke("document.read", { value: "original" })).toEqual({ value: "original" });
});

test("queued invocations snapshot input before waiting for the prior handler", async () => {
  const entered = deferred(), release = deferred(); const seen: string[] = [];
  const broker = makeBroker([tool(async input => {
    const value = (input as CapabilityObject).value as string; seen.push(value);
    if (value === "first") { entered.resolve(); await release.promise; } return input;
  })]);
  const first = broker.invoke("document.read", { value: "first" }); await entered.promise;
  const input = { value: "second" }, second = broker.invoke("document.read", input); input.value = "changed";
  expect(seen).toEqual(["first"]); release.resolve(); await first;
  expect(await second).toEqual({ value: "second" }); expect(seen).toEqual(["first", "second"]);
});

test("revocation cancels queued work and a cooperating handler rechecks before its effect", async () => {
  const entered = deferred(), release = deferred(); let sideEffects = 0, handlers = 0;
  const broker = makeBroker([tool(async (_input, context) => {
    handlers++; entered.resolve(); await release.promise;
    context.assertActive(); sideEffects++; return { done: true };
  })]);
  const first = broker.invoke("document.read", { value: "first" }); await entered.promise;
  const second = broker.invoke("document.read", { value: "second" }); broker.revoke(); release.resolve();
  await expect(first).rejects.toThrow("CAPABILITY_REVOKED"); await expect(second).rejects.toThrow("CAPABILITY_REVOKED");
  await expect(broker.invoke("document.read", { value: "third" })).rejects.toThrow("CAPABILITY_REVOKED");
  expect(handlers).toBe(1); expect(sideEffects).toBe(0);
});

test("external cancellation and changed host policy stop admission without using their private errors", async () => {
  const abort = new AbortController(); let handlers = 0;
  const broker = makeBroker([tool(() => { handlers++; return {}; })], { signal: abort.signal });
  abort.abort(Error("private cancellation detail"));
  await expect(broker.invoke("document.read", { value: "x" })).rejects.toThrow("CAPABILITY_REVOKED");
  const refused = makeBroker([tool(() => { handlers++; return {}; })], { isActive: () => { throw Error("private host detail"); } });
  await expect(refused.invoke("document.read", { value: "x" })).rejects.toThrow("CAPABILITY_REVOKED");
  expect(handlers).toBe(0);
});

test("close revokes immediately and joins the actual handler while refusing queued effects", async () => {
  const entered = deferred(), release = deferred();
  let handlers = 0, effects = 0, settled = false, closed = false;
  let context: CapabilityContext | undefined;
  const broker = makeBroker([tool(async (_input, value) => {
    handlers++; context = value; entered.resolve(); await release.promise;
    settled = true; value.assertActive(); effects++; return {};
  })]);
  const first = broker.invoke("document.read", { value: "first" }); await entered.promise;
  const queued = broker.invoke("document.read", { value: "queued" });
  const closing = broker.close().then(() => { closed = true; });
  expect(context?.signal.aborted).toBeTrue();
  await expect(broker.invoke("document.read", { value: "late" })).rejects.toThrow("CAPABILITY_REVOKED");
  await Promise.resolve();
  expect(closed).toBeFalse(); expect(settled).toBeFalse(); expect(handlers).toBe(1);
  release.resolve();
  await expect(first).rejects.toThrow("CAPABILITY_REVOKED");
  await expect(queued).rejects.toThrow("CAPABILITY_REVOKED");
  await closing;
  expect(closed).toBeTrue(); expect(settled).toBeTrue(); expect(handlers).toBe(1); expect(effects).toBe(0);
  await broker.close();
});

test("policy is rechecked after trusted parsing and late handler results are withheld", async () => {
  let active = true, handlers = 0;
  const definition = { ...tool(), parseInput(input: CapabilityObject) { active = false; return input; }, execute() { handlers++; return {}; } };
  const broker = makeBroker([definition], { isActive: () => active });
  await expect(broker.invoke("document.read", { value: "x" })).rejects.toThrow("CAPABILITY_REVOKED"); expect(handlers).toBe(0);
  const entered = deferred(), release = deferred(); let context: CapabilityContext | undefined;
  const late = makeBroker([tool(async (_input, value) => { context = value; entered.resolve(); await release.promise; return { completed: true }; })]);
  const running = late.invoke("document.read", { value: "x" }); await entered.promise;
  expect(Object.isFrozen(context)).toBeTrue(); late.revoke(); release.resolve();
  await expect(running).rejects.toThrow("CAPABILITY_REVOKED"); expect(context?.signal.aborted).toBeTrue();
});

test("input and parser output must remain bounded plain JSON, without getters or toJSON execution", async () => {
  let reads = 0, handlers = 0;
  const broker = makeBroker([tool(() => { handlers++; return {}; })]);
  const accessor = Object.defineProperty({}, "value", { enumerable: true, get() { reads++; return "hidden"; } });
  const serializer = { value: "valid", toJSON() { reads++; return { value: "changed" }; } };
  const circular: Record<string, unknown> = {}; circular.value = circular;
  for (const input of [accessor, serializer, circular, { value: undefined }, { value: 1n }, { value: NaN }, { value: new Date() },
    { value: "é".repeat(CAPABILITY_LIMITS.inputBytes / 2) }, Object.assign({ value: "x" }, { [Symbol("hidden")]: true })])
    await expect(broker.invoke("document.read", input)).rejects.toThrow();
  expect(reads).toBe(0); expect(handlers).toBe(0);
  const transformed = makeBroker([{ ...tool(), parseInput: () => "x".repeat(CAPABILITY_LIMITS.inputBytes + 1) }]);
  await expect(transformed.invoke("document.read", { value: "x" })).rejects.toThrow("CAPABILITY_INPUT_INVALID");
  await expect(broker.invoke("document.read", { value: 1 })).rejects.toThrow("CAPABILITY_INPUT_INVALID");
});

test("bounded handler output is an immutable copy and failures reveal no raw handler detail", async () => {
  const result = { nested: { retained: "original" } };
  const output = await makeBroker([tool(() => result)]).invoke("document.read", { value: "x" });
  result.nested.retained = "changed";
  expect(output).toEqual({ nested: { retained: "original" } }); expect(Object.isFrozen((output as CapabilityObject).nested)).toBeTrue();
  for (const invalid of [undefined, Infinity, "é".repeat(CAPABILITY_LIMITS.outputBytes / 2), { nested: () => null }])
    await expect(makeBroker([tool(() => invalid)]).invoke("document.read", { value: "x" })).rejects.toThrow("CAPABILITY_OUTPUT_INVALID");
  await expect(makeBroker([tool(() => { throw Error("private account detail"); })]).invoke("document.read", { value: "x" })).rejects.toThrow("CAPABILITY_TOOL_FAILED");
});

test("declarative schemas and inventories are closed, finite and contain only JSON", () => {
  for (const invalid of [
    { ...tool(), inputSchema: { type: "object", properties: {}, additionalProperties: true } },
    { ...tool(), inputSchema: { type: "object", properties: {}, additionalProperties: false, required: ["missing"] } },
    { ...tool(), inputSchema: { ...descriptor().inputSchema, description: "x".repeat(CAPABILITY_LIMITS.schemaBytes) } },
    { ...tool(), inputSchema: { ...descriptor().inputSchema, default: undefined } as unknown as CapabilityObject },
  ]) expect(() => createCapabilityProfile({ id: "invalid", version: 1, tools: [invalid] })).toThrow();
  expect(() => createCapabilityProfile({ id: "invalid", version: 1, tools: [tool(), tool()] })).toThrow("CAPABILITY_TOOL_INVALID");
  expect(() => createCapabilityProfile({ id: "invalid", version: 1, tools: Array.from({ length: CAPABILITY_LIMITS.tools + 1 }, (_, i) => ({ ...tool(), name: `tool.${i}` })) })).toThrow("CAPABILITY_TOOL_LIMIT");
  expect(() => createCapabilityProfile({ id: "invalid", version: 0, tools: [] })).toThrow();
  expect(createCapabilityProfile({ id: "classifier", version: 1, tools: [] }).tools).toEqual([]);
});

test("pending calls and total attempts are independently bounded", async () => {
  const entered = deferred(), release = deferred(); let handlers = 0;
  const broker = makeBroker([tool(async value => { handlers++; entered.resolve(); await release.promise; return value; })]);
  const pending = Array.from({ length: CAPABILITY_LIMITS.pendingCalls }, () => broker.invoke("document.read", { value: "x" }));
  await entered.promise;
  await expect(broker.invoke("document.read", { value: "x" })).rejects.toThrow("CAPABILITY_CALL_LIMIT");
  expect(handlers).toBe(1); release.resolve(); await Promise.all(pending);
  expect(handlers).toBe(CAPABILITY_LIMITS.pendingCalls);
  const finite = makeBroker();
  for (let i = 0; i < CAPABILITY_LIMITS.calls; i++) await finite.invoke("document.read", { value: "x" });
  await expect(finite.invoke("document.read", { value: "x" })).rejects.toThrow("CAPABILITY_CALL_LIMIT");
});

test("nested data limits stop cycles, excessive depth and non-JSON array structure", async () => {
  const definition = { ...tool(), parseInput: (input: CapabilityObject): CapabilityJson => input };
  const broker = makeBroker([definition]); let nested: unknown = "value";
  for (let i = 0; i < CAPABILITY_LIMITS.depth + 1; i++) nested = [nested];
  for (const value of [nested, new Array(2), Array.from({ length: CAPABILITY_LIMITS.arrayItems + 1 }, () => 1),
    Object.fromEntries(Array.from({ length: CAPABILITY_LIMITS.objectKeys + 1 }, (_, i) => [String(i), 1]))])
    await expect(broker.invoke("document.read", { value })).rejects.toThrow();
});
