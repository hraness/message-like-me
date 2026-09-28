import { MemoryStore, runTask, type Executor, type JsonValue, type TaskDefinition } from "@hraness/algal";
import { assertEvaluatedTaskCompatible, parseEvaluatedTaskArtifact } from "@hraness/algal/task-artifact";
import { parseHabitatPlan, type HabitatPlan } from "./contact-habitat.ts";

import { compileHabitatTask, type HabitatPhase } from "./habitat-task.ts";
export type { HabitatPhase } from "./habitat-task.ts";

type ProgramOptions = { phase: HabitatPhase; plan: HabitatPlan; context: JsonValue; executor: Executor; signal: AbortSignal };
export async function executeHabitatProgram(options: ProgramOptions) {
  return executeProgram(options);
}
/** Explicit shadow entrypoint. It returns evidence only; the automatic reply
 * driver continues to call executeHabitatProgram and never selects an artifact. */
export async function executeHabitatShadow(options: Omit<ProgramOptions, "phase"> & { artifact: unknown }) {
  const plan = parseHabitatPlan(options.plan), artifact = parseEvaluatedTaskArtifact(options.artifact);
  const compilation = assertEvaluatedTaskCompatible(artifact, compileHabitatTask("respond", plan).task);
  if (compilation.task.examples.length !== 0) throw Error("Contact shadow artifacts must not contain conversation examples");
  return { mode: "shadow-only" as const, ...(await executeProgram({ ...options, plan, phase: "respond" }, compilation.task)) };
}
async function executeProgram(options: ProgramOptions, shadowTask?: TaskDefinition) {
  options.signal.throwIfAborted();
  const plan = parseHabitatPlan(options.plan), contextBytes = options.phase === "respond" ? 32_768 : 98_304;
  const context = { evidence: options.context, preferences: plan };
  if (Buffer.byteLength(JSON.stringify(context)) > contextBytes) throw Error("Habitat context budget exceeded");
  const task = shadowTask ?? compileHabitatTask(options.phase, plan).task;
  const pending = new Set<Promise<unknown>>();
  const executor: Executor = { id: options.executor.id, capabilities: { effects: ["agent"] }, cacheable: false, retryable: false,
    async execute(request, signal) {
      const scoped = AbortSignal.any([options.signal, ...(signal ? [signal] : [])]); scoped.throwIfAborted();
      const task = options.executor.execute(request, scoped); pending.add(task);
      try { const output = await task; scoped.throwIfAborted(); return output; } finally { pending.delete(task); }
    },
    ...(options.executor.executeEffect === undefined ? {} : { async executeEffect(request, signal) {
      const scoped = AbortSignal.any([options.signal, ...(signal ? [signal] : [])]); scoped.throwIfAborted();
      const task = options.executor.executeEffect!(request, scoped); pending.add(task);
      try { const output = await task; scoped.throwIfAborted(); return output; } finally { pending.delete(task); }
    } } satisfies Partial<Executor>),
  };
  // The provider may take time to release resources after cancellation. Join
  // it even when the task runner throws, before this host call can settle.
  let result: Awaited<ReturnType<typeof runTask>>;
  try { result = await runTask({ task, args: { context: context as JsonValue }, store: new MemoryStore(), executors: [executor] }); }
  finally { await Promise.allSettled([...pending]); }
  options.signal.throwIfAborted();
  if (result.receipt.outcome !== "complete" || result.outputs.result === undefined) throw Error("Habitat inference did not complete");
  return { output: result.outputs.result, receipt: result.receipt, manifest: result.compilation.manifest };
}
