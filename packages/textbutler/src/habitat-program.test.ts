import { expect, test } from "bun:test";
import { MemoryStore, manifestToJson, verifyReceipt, type JsonValue } from "@hraness/algal";
import { DEFAULT_HABITAT_PLAN } from "./contact-habitat.ts";
import { executeHabitatProgram } from "./habitat-program.ts";

test("the contact driver executes a real bounded Algal organism with replayable evidence", async () => {
  let calls = 0;
  const result = await executeHabitatProgram({ phase: "respond", plan: DEFAULT_HABITAT_PLAN, context: { message: "Synthetic request" }, signal: new AbortController().signal,
    executor: { id: "synthetic-driver", async execute() { calls++; return { summary: "Synthetic", actions: [{ kind: "text", text: "Hello" }] }; } } });
  expect(calls).toBe(1); expect(result.receipt.outcome).toBe("complete");
  expect(result.receipt.work.agentCalls).toBe(1);
  expect(result.output).toEqual({ summary: "Synthetic", actions: [{ kind: "text", text: "Hello" }] });
  const replay = await verifyReceipt(result.receipt as unknown as JsonValue, manifestToJson(result.manifest), new MemoryStore(), new Map());
  expect(replay.ok).toBe(true); expect(calls).toBe(1);
  const stored = JSON.parse(JSON.stringify(result));
  expect((await verifyReceipt(stored.receipt, stored.manifest, new MemoryStore(), new Map())).ok).toBe(true);
  const changed = await executeHabitatProgram({ phase: "respond", plan: { ...DEFAULT_HABITAT_PLAN, guidance: "Prefer a short example." }, context: { message: "Synthetic request" }, signal: new AbortController().signal,
    executor: { id: "synthetic-driver", async execute() { return { answer: "Example" }; } } });
  expect(changed.receipt.manifestDigest).not.toBe(result.receipt.manifestDigest);
});

test("cancellation before dispatch starts no model and over-bound inputs fail closed", async () => {
  let calls = 0;
  const controller = new AbortController(); controller.abort();
  const options = { phase: "respond" as const, plan: DEFAULT_HABITAT_PLAN, context: {}, signal: controller.signal, executor: { id: "synthetic", async execute() { calls++; return {}; } } };
  await expect(executeHabitatProgram(options)).rejects.toThrow();
  await expect(executeHabitatProgram({ ...options, signal: new AbortController().signal, context: { text: "x".repeat(200_000) } })).rejects.toThrow();
  expect(calls).toBe(0);
});

test("the respond instructions require an explicit ask and treat shares without one as context", async () => {
  const result = await executeHabitatProgram({ phase: "respond", plan: DEFAULT_HABITAT_PLAN, context: {}, signal: new AbortController().signal,
    executor: { id: "synthetic-silence", async execute(request) {
      expect(request.prompt).toContain("explicitly asks a question, requests a task, or directly addresses");
      expect(request.prompt).toContain("bare link, document, media item, or forwarded material");
      expect(request.prompt).toContain("keeps confidence below 0.85");
      return { respond: false, confidence: 0.2, reason: "not_needed", actions: [] };
    } } });
  expect(result.output).toMatchObject({ respond: false });
});

test("structured personality remains style data and is bound into the replayable manifest", async () => {
  const personality = { tone: "warm" as const, formality: "casual" as const };
  const result = await executeHabitatProgram({ phase: "respond", plan: { ...DEFAULT_HABITAT_PLAN, personality }, context: {}, signal: new AbortController().signal,
    executor: { id: "synthetic-personality", async execute(request) {
      expect(request.prompt).toContain("personality tone/formality adjust style only");
      expect(request.prompt).toContain(JSON.stringify(personality));
      return { text: "Hello" };
    } } });
  const stored = JSON.parse(JSON.stringify(result));
  expect((await verifyReceipt(stored.receipt, stored.manifest, new MemoryStore(), new Map())).ok).toBe(true);
});

for (const phase of ["respond", "reflect", "judge"] as const) test(`${phase} binds its task inputs, object output and effective host budgets`, async () => {
  let calls = 0;
  const context = { synthetic: phase };
  const result = await executeHabitatProgram({ phase, context, plan: DEFAULT_HABITAT_PLAN, signal: new AbortController().signal,
    executor: { id: `synthetic-${phase}`, cacheable: true, retryable: true, async execute(request) {
      calls++;
      expect(request.kind).toBe("agent");
      expect(request.context.inputs).toEqual({ context: { evidence: context, preferences: DEFAULT_HABITAT_PLAN } });
      expect(request.output).toEqual({ kind: "json", schema: { type: "object" } });
      expect(request.budget).toEqual({ maxContextBytes: phase === "respond" ? 40_960 : 106_496, maxOutputBytes: 16_384 });
      return { phase };
    } } });
  expect(result.manifest.interface).toMatchObject({ inputs: { context: { cell: "input", port: "context" } }, outputs: { result: { cell: "task", port: "out" } } });
  expect(result.manifest.budgets).toMatchObject({ maxSteps: 4, maxAgentCalls: 1, maxWork: 200_000, maxOutputBytes: 65_536, maxDepth: 4 });
  const cell = result.manifest.cells.find(cell => cell.id === "task");
  if (cell?.kind !== "agent") throw Error("Expected task agent");
  expect(cell.budget?.maxEffectMs).toBe(phase === "respond" ? 25_000 : 120_000);
  expect(result.output).toEqual({ phase });
  expect((await verifyReceipt(result.receipt as unknown as JsonValue, manifestToJson(result.manifest), new MemoryStore(), new Map())).ok).toBe(true);
  expect(calls).toBe(1);
});

test("task cancellation joins provider cleanup before rejecting and never repeats an unknown result", async () => {
  let entered!: () => void, release!: () => void, calls = 0;
  const started = new Promise<void>(resolve => { entered = resolve; }), released = new Promise<void>(resolve => { release = resolve; });
  const controller = new AbortController();
  let settled = false;
  const pending = executeHabitatProgram({ phase: "reflect", plan: DEFAULT_HABITAT_PLAN, context: {}, signal: controller.signal,
    executor: { id: "synthetic-unknown", retryable: true, async execute(_request, signal) {
      calls++; entered(); await released; expect(signal?.aborted).toBe(true); throw Error("Unknown provider completion");
    } } }).then(() => { settled = true; }, () => { settled = true; });
  await started; controller.abort();
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(settled).toBe(false); release(); await pending;
  expect(settled).toBe(true); expect(calls).toBe(1);
});

test("task object outputs remain enforced and provider failures are not retried", async () => {
  for (const mode of ["invalid-object", "unknown-completion"] as const) {
    let calls = 0;
    await expect(executeHabitatProgram({ phase: "judge", plan: DEFAULT_HABITAT_PLAN, context: {}, signal: new AbortController().signal,
      executor: { id: `synthetic-${mode}`, retryable: true, async execute() {
        calls++; if (mode === "unknown-completion") throw Error("Provider completion is unknown"); return "not an object";
      } } })).rejects.toThrow("Habitat inference did not complete");
    expect(calls).toBe(1);
  }
});
