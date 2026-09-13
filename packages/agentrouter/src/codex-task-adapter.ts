import { createHash } from "node:crypto";
import type { CapabilityBroker } from "./capabilities.ts";
import { canonicalJson, createCodexCapabilityMapping, codexTaskSettings } from "./codex-config.ts";
import type { CodexProcessLauncher } from "./codex-process.ts";
import { codexLimits, type CodexResponsesUpstream } from "./codex-relay.ts";
import { CodexSessionError, runCodexSession, type CodexSessionReceipt } from "./codex-session.ts";
import type {
  AgentTaskAdapter, AgentTaskBinding, AgentTaskCompletion, AgentTaskExecutionRequest, AgentTaskRoute,
  AgentTaskStopEvidence, AgentTaskStopReason, TaskRuntimeQualification,
} from "./task-runtime.ts";

export type CodexTaskAdapterOptions = Readonly<{
  route: AgentTaskRoute;
  runtime: Readonly<{ version: string; digest: string }>;
  qualification: TaskRuntimeQualification;
  instructions: Readonly<{ base: string; developer: string }>;
  upstream: CodexResponsesUpstream;
  launcher: CodexProcessLauncher;
  now(): number;
}>;

type Active = {
  binding: AgentTaskBinding;
  requestDigest: string;
  cleanupDeadlineUnixMs: number;
  controller: AbortController;
  promise: Promise<AgentTaskCompletion>;
  sessionStarted: boolean;
  receipt: CodexSessionReceipt | null;
  stopping?: Promise<AgentTaskStopEvidence>;
};

const proof = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const binding = (request: AgentTaskExecutionRequest): AgentTaskBinding => Object.freeze({
  route: Object.freeze({ ...request.route }), accountId: request.accountId, workspaceId: request.workspaceId, runId: request.runId,
  profile: Object.freeze({ ...request.profile }), model: Object.freeze({ ...request.model }), runtime: Object.freeze({ ...request.runtime }),
});
// stop receives the same admitted request, with only its cleanup deadline narrowed.
// Hash task content so retained custody does not keep another prompt copy.
const requestDigest = (request: AgentTaskExecutionRequest) => proof({ ...binding(request), purpose: request.purpose, prompt: request.prompt,
  limits: request.limits, admittedAtUnixMs: request.admittedAtUnixMs, executionDeadlineUnixMs: request.executionDeadlineUnixMs });

/**
 * Native Codex task adapter. It receives a capability broker from AgentRouter,
 * maps that exact profile into the relay, and retains the native stop receipt
 * until the task runtime has joined the process and broker cleanup.
 */
export function createCodexTaskAdapter(options: CodexTaskAdapterOptions): AgentTaskAdapter {
  let active: Active | null = null;
  // The router creates a distinct signal for each execution and preserves it in
  // the stop copy. A rejected admission needs its own receipt, never active's.
  const slots = new WeakMap<AbortSignal, Active>();
  const adapter = {
    route: Object.freeze({ ...options.route }),
    runtime: Object.freeze({ ...options.runtime }),
    qualification: options.qualification,
    async run(request: AgentTaskExecutionRequest, broker: CapabilityBroker): Promise<AgentTaskCompletion> {
      if (slots.has(request.signal)) throw Error("CODEX_TASK_REQUEST_ALREADY_ADMITTED");
      const busy = active !== null;
      const controller = new AbortController();
      // Defer all provider work until ownership and the join promise are visible,
      // including to a synchronous launcher callback or abort listener.
      const slot: Active = { binding: binding(request), requestDigest: requestDigest(request), cleanupDeadlineUnixMs: request.cleanupDeadlineUnixMs,
        controller, promise: Promise.resolve().then(execute), sessionStarted: false, receipt: null };
      slots.set(request.signal, slot);
      if (!busy) active = slot;
      async function execute(): Promise<AgentTaskCompletion> {
        try {
          if (busy) throw Error("CODEX_TASK_ALREADY_RUNNING");
          const mapping = createCodexCapabilityMapping(broker.profile);
          const settings = codexTaskSettings({ model: request.model, instructions: options.instructions });
          const signal = AbortSignal.any([request.signal, controller.signal]);
          signal.throwIfAborted();
          const remaining = request.executionDeadlineUnixMs - options.now();
          // Execution time is not cleanup time. Reject unsupported execution
          // budgets before starting a session; cleanup keeps the pinned 10s cap.
          const limits = codexLimits({ deadlineMs: remaining, ioMs: Math.min(10_000, remaining),
            cleanupMs: Math.min(10_000, request.limits.maxCleanupMs, request.cleanupDeadlineUnixMs - request.executionDeadlineUnixMs) });
          slot.sessionStarted = true;
          const result = await runCodexSession({
            request: Object.freeze({ runId: request.runId, accountId: request.accountId, workspaceId: request.workspaceId,
              prompt: request.prompt, model: request.model.id, purpose: "respond", provider: "codex", signal }),
            broker, upstream: options.upstream, launcher: options.launcher, limits,
            task: { mapping, settings, executionDeadlineUnixMs: request.executionDeadlineUnixMs,
              maxOutputBytes: request.limits.maxOutputBytes, now: options.now },
          });
          slot.receipt = result.receipt;
          return Object.freeze({ ...slot.binding, output: typeof result.output === "string" ? result.output : null,
            usage: Object.freeze({ ...result.receipt.usage, costUsd: null }), outcome: Object.freeze({ status: "completed" as const, code: null }) });
        } catch (error) {
          if (error instanceof CodexSessionError) slot.receipt = error.receipt;
          const receipt = slot.receipt;
          return Object.freeze({ ...slot.binding, output: null,
            usage: Object.freeze({ inputTokens: receipt?.usage.inputTokens ?? null, outputTokens: receipt?.usage.outputTokens ?? null,
              totalTokens: receipt?.usage.totalTokens ?? null, costUsd: null }),
            outcome: Object.freeze({ status: "failed" as const, code: busy ? "CODEX_TASK_ALREADY_RUNNING"
              : error instanceof CodexSessionError ? "CODEX_SESSION_FAILED" : "CODEX_ADAPTER_FAILED" }) });
        }
      }
      return slot.promise;
    },
    async stop(request: AgentTaskExecutionRequest, _reason: AgentTaskStopReason): Promise<AgentTaskStopEvidence> {
      const slot = slots.get(request.signal);
      if (!slot) throw Error("CODEX_TASK_NOT_RUNNING");
      if (requestDigest(request) !== slot.requestDigest || !Number.isSafeInteger(request.cleanupDeadlineUnixMs)
        || request.cleanupDeadlineUnixMs < request.admittedAtUnixMs || request.cleanupDeadlineUnixMs > slot.cleanupDeadlineUnixMs)
        throw Error("CODEX_TASK_STOP_BINDING_MISMATCH");
      // Publish the shared join before abort listeners can reenter stop().
      return slot.stopping ??= Promise.resolve().then(async () => {
        slot.controller.abort();
        await slot.promise;
        if (slot.sessionStarted && !slot.receipt?.processStopped) throw Error("CODEX_TASK_PROCESS_STOP_UNPROVEN");
        if (active === slot) active = null;
        return Object.freeze({ ...slot.binding, processStopped: true, controllersStopped: true, joined: true,
          stoppedAtUnixMs: options.now(), proofDigest: proof({ requestDigest: slot.requestDigest,
            custody: slot.sessionStarted ? slot.receipt : { sessionStarted: false } }) });
      });
    },
  } satisfies AgentTaskAdapter;
  return Object.freeze(adapter);
}
