import { createHash } from "node:crypto";
import type { CapabilityBroker } from "./capabilities.ts";
import { createCodexCapabilityMapping, codexTaskSettings } from "./codex-config.ts";
import type { CodexProcessLauncher } from "./codex-process.ts";
import type { CodexResponsesUpstream } from "./codex-relay.ts";
import { CodexSessionError, runCodexSession } from "./codex-session.ts";
import type {
  AgentTaskAdapter, AgentTaskCompletion, AgentTaskExecutionRequest, AgentTaskRoute,
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
  controller: AbortController;
  promise: Promise<{ output: unknown; receipt: import("./codex-session.ts").CodexSessionReceipt }>;
  receipt: import("./codex-session.ts").CodexSessionReceipt | null;
};

const proof = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/**
 * Native Codex task adapter. It receives a capability broker from AgentRouter,
 * maps that exact profile into the relay, and retains the native stop receipt
 * until the task runtime has joined the process and broker cleanup.
 */
export function createCodexTaskAdapter(options: CodexTaskAdapterOptions): AgentTaskAdapter {
  let active: Active | null = null;
  const adapter = {
    route: Object.freeze({ ...options.route }),
    runtime: Object.freeze({ ...options.runtime }),
    qualification: options.qualification,
    async run(request: AgentTaskExecutionRequest, broker: CapabilityBroker): Promise<AgentTaskCompletion> {
      if (active) throw Error("CODEX_TASK_ALREADY_RUNNING");
      const mapping = createCodexCapabilityMapping(broker.profile);
      const settings = codexTaskSettings({ model: request.model, instructions: options.instructions });
      const controller = new AbortController();
      const signal = AbortSignal.any([request.signal, controller.signal]);
      const remaining = Math.max(1, request.executionDeadlineUnixMs - options.now());
      const promise = runCodexSession({
        request: Object.freeze({ runId: request.runId, accountId: request.accountId, workspaceId: request.workspaceId,
          prompt: request.prompt, model: request.model.id, purpose: "respond", provider: "codex", signal }),
        broker, upstream: options.upstream, launcher: options.launcher,
        limits: { deadlineMs: remaining, ioMs: Math.min(10_000, remaining), cleanupMs: Math.max(1, request.cleanupDeadlineUnixMs - options.now()) },
        task: { mapping, settings, executionDeadlineUnixMs: request.executionDeadlineUnixMs, maxOutputBytes: request.limits.maxOutputBytes,
          now: options.now },
      });
      const slot: Active = { controller, promise, receipt: null };
      active = slot;
      try {
        let result: { output: unknown; receipt: import("./codex-session.ts").CodexSessionReceipt };
        try { result = await promise; }
        catch (error) {
          if (error instanceof CodexSessionError) { slot.receipt = error.receipt; }
          throw error;
        }
        slot.receipt = result.receipt;
        const binding = { route: request.route, accountId: request.accountId, workspaceId: request.workspaceId, runId: request.runId,
          profile: request.profile, model: request.model, runtime: request.runtime };
        return Object.freeze({ ...binding, output: typeof result.output === "string" ? result.output : null,
          usage: Object.freeze({ ...result.receipt.usage, costUsd: null }), outcome: Object.freeze({ status: "completed" as const, code: null }) });
      } catch (error) {
        const receipt = slot.receipt;
        const binding = { route: request.route, accountId: request.accountId, workspaceId: request.workspaceId, runId: request.runId,
          profile: request.profile, model: request.model, runtime: request.runtime };
        return Object.freeze({ ...binding, output: null,
          usage: Object.freeze({ inputTokens: receipt?.usage.inputTokens ?? null, outputTokens: receipt?.usage.outputTokens ?? null,
            totalTokens: receipt?.usage.totalTokens ?? null, costUsd: null }),
          outcome: Object.freeze({ status: "failed" as const, code: error instanceof CodexSessionError ? "CODEX_SESSION_FAILED" : "CODEX_ADAPTER_FAILED" }) });
      }
    },
    async stop(request: AgentTaskExecutionRequest, _reason: AgentTaskStopReason): Promise<AgentTaskStopEvidence> {
      const slot = active;
      if (!slot) throw Error("CODEX_TASK_NOT_RUNNING");
      slot.controller.abort();
      await slot.promise.catch(() => undefined);
      const receipt = slot.receipt;
      if (!receipt?.processStopped) throw Error("CODEX_TASK_PROCESS_STOP_UNPROVEN");
      active = null;
      return Object.freeze({ route: request.route, accountId: request.accountId, workspaceId: request.workspaceId, runId: request.runId,
        profile: request.profile, model: request.model, runtime: request.runtime, processStopped: true, controllersStopped: true, joined: true,
        stoppedAtUnixMs: options.now(), proofDigest: proof(receipt) });
    },
  } satisfies AgentTaskAdapter;
  return Object.freeze(adapter);
}
