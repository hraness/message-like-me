import { createHash } from "node:crypto";
import { assertCapabilityProfile, type CapabilityBroker } from "./capabilities.ts";
import { canonicalJson, codexTaskSettings } from "./codex-config.ts";
import type { CodexManagedProcessLauncher } from "./codex-managed-config.ts";
import { CodexManagedSessionError, runCodexManagedSession, type CodexManagedSessionReceipt } from "./codex-managed-session.ts";
import type { AgentTaskAdapter, AgentTaskBinding, AgentTaskCompletion, AgentTaskExecutionRequest,
  AgentTaskRoute, AgentTaskStopEvidence, TaskRuntimeQualification } from "./task-runtime.ts";
import { boundedText, identifier, safeInteger } from "./validation.ts";

export type CodexManagedTaskAdapterOptions = Readonly<{
  route: AgentTaskRoute;
  runtime: Readonly<{ version: string; digest: string }>;
  /** Independent host evidence; callback filtering cannot establish native tool confinement. */
  qualification?: TaskRuntimeQualification;
  instructions: Readonly<{ base: string; developer: string }>;
  launcher: CodexManagedProcessLauncher;
  now(): number;
}>;

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const proof = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
function freezeCopy<T>(value: T): T {
  const copy = structuredClone(value);
  function freeze(v: unknown): void {
    if (v !== null && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); }
  }
  freeze(copy); return copy;
}
function binding(request: AgentTaskExecutionRequest): AgentTaskBinding {
  return freezeCopy({ route: request.route, accountId: request.accountId, workspaceId: request.workspaceId, runId: request.runId,
    profile: request.profile, model: request.model, runtime: request.runtime });
}
// The router preserves the execution's original signal and may only narrow its
// cleanup deadline for stop. Hash content instead of retaining another prompt.
const requestDigest = (request: AgentTaskExecutionRequest) => proof({ ...binding(request), purpose: request.purpose, prompt: request.prompt,
  limits: request.limits, admittedAtUnixMs: request.admittedAtUnixMs, executionDeadlineUnixMs: request.executionDeadlineUnixMs });
type Active = {
  binding: AgentTaskBinding;
  requestDigest: string;
  cleanupDeadlineUnixMs: number;
  controller: AbortController;
  promise: Promise<AgentTaskCompletion>;
  sessionStarted: boolean;
  receipt: CodexManagedSessionReceipt | null;
  stopping?: Promise<AgentTaskStopEvidence>;
};

/** Opt-in native-managed transport. No default launcher, auth discovery, API
 * fallback or qualification receipt is supplied. Use through runAgentTask so
 * the shared account lease and broker custody remain authoritative. */
export function createCodexManagedTaskAdapter(options: CodexManagedTaskAdapterOptions): AgentTaskAdapter {
  if (options.route.provider !== "codex" || options.route.authentication !== "subscription") throw Error("CODEX_MANAGED_ROUTE_INVALID");
  const route = Object.freeze({ id: identifier(options.route.id), provider: "codex" as const, authentication: "subscription" as const });
  const runtime = Object.freeze({ version: boundedText(options.runtime.version, 160), digest: boundedText(options.runtime.digest, 64) });
  if (!/^[a-f0-9]{64}$/u.test(runtime.digest)) throw Error("CODEX_MANAGED_RUNTIME_INVALID");
  const qualification: TaskRuntimeQualification = freezeCopy(options.qualification ?? {
    status: "unqualified", reason: "Native managed authentication, exact tool inventory and host confinement require independent qualification.",
  });
  const instructions = Object.freeze({ base: boundedText(options.instructions.base, 64 * 1024),
    developer: boundedText(options.instructions.developer, 64 * 1024) });
  const launcher = Object.freeze({ launch: options.launcher.launch.bind(options.launcher) });
  const now = options.now.bind(options);
  let active: Active | null = null;
  const slots = new WeakMap<AbortSignal, Active>();

  const adapter: AgentTaskAdapter = {
    route, runtime, qualification,
    async run(input, broker: CapabilityBroker): Promise<AgentTaskCompletion> {
      // Unqualified direct invocation must remain unavailable. Once a qualified
      // execution enters, even a busy/preflight refusal owns its own stop proof.
      if (qualification.status !== "qualified") throw Error("CODEX_MANAGED_ADAPTER_UNQUALIFIED");
      const qualified = qualification;
      if (slots.has(input.signal)) throw Error("CODEX_MANAGED_REQUEST_ALREADY_ADMITTED");
      const request: AgentTaskExecutionRequest = Object.freeze({ ...input, ...binding(input), limits: freezeCopy(input.limits) });
      const busy = active !== null, controller = new AbortController();
      // Publish both the slot and its join promise before any host callback can
      // reenter run/stop, including broker admission and the host clock.
      const slot: Active = { binding: binding(request), requestDigest: requestDigest(request), cleanupDeadlineUnixMs: request.cleanupDeadlineUnixMs,
        controller, promise: Promise.resolve().then(execute), sessionStarted: false, receipt: null };
      slots.set(request.signal, slot);
      if (!busy) active = slot;
      async function execute(): Promise<AgentTaskCompletion> {
        try {
          if (busy) throw Error("CODEX_MANAGED_TASK_ALREADY_RUNNING");
          if (!same(request.route, route) || !same(qualified.route, route) || !same(qualified.profile, request.profile)
            || qualified.runtimeVersion !== runtime.version || qualified.runtimeDigest !== runtime.digest
            || request.runtime.runtimeVersion !== runtime.version || request.runtime.runtimeDigest !== runtime.digest
            || request.runtime.evidenceDigest !== qualified.evidenceDigest
            || request.runtime.qualificationExpiresAt !== qualified.expiresAt
            || qualified.expiresAt < request.cleanupDeadlineUnixMs
            || ["noCommandTools", "exactToolInventory", "workspaceReadIsolation", "workspaceWriteIsolation",
              "isolatedConfiguration", "authOutsideWorkspace", "hostBrokerOnly"].some(key =>
              (qualified.controls as unknown as Record<string, unknown>)[key] !== true)) throw Error("CODEX_MANAGED_QUALIFICATION_MISMATCH");
          assertCapabilityProfile(broker.profile, request.profile);
          if (broker.runId !== request.runId || broker.workspaceId !== request.workspaceId) throw Error("CODEX_MANAGED_BROKER_MISMATCH");
          broker.assertActive(); request.signal.throwIfAborted();
          const remaining = safeInteger(request.executionDeadlineUnixMs - now(), 1, request.limits.maxRunMs);
          const cleanupMs = safeInteger(request.cleanupDeadlineUnixMs - request.executionDeadlineUnixMs, 1, request.limits.maxCleanupMs);
          const settings = codexTaskSettings({ model: request.model, instructions });
          const signal = AbortSignal.any([request.signal, controller.signal]);
          signal.throwIfAborted(); slot.sessionStarted = true;
          const result = await runCodexManagedSession({
            request: Object.freeze({ ...request, signal }),
            broker, launcher, settings, now, limits: { deadlineMs: remaining, cleanupMs, ioMs: Math.min(10_000, remaining) },
          });
          slot.receipt = result.receipt;
          return Object.freeze({ ...slot.binding, output: result.output,
            usage: Object.freeze({ ...result.receipt.usage, costUsd: null }),
            outcome: Object.freeze({ status: "completed", code: null }) });
        } catch (error) {
          if (error instanceof CodexManagedSessionError) slot.receipt = error.receipt;
          return Object.freeze({ ...slot.binding, output: null,
            usage: Object.freeze({ inputTokens: slot.receipt?.usage.inputTokens ?? null, outputTokens: slot.receipt?.usage.outputTokens ?? null,
              totalTokens: slot.receipt?.usage.totalTokens ?? null, costUsd: null }),
            outcome: Object.freeze({ status: "failed", code: busy ? "CODEX_MANAGED_TASK_ALREADY_RUNNING" : error instanceof CodexManagedSessionError
              ? "CODEX_MANAGED_SESSION_FAILED" : "CODEX_MANAGED_ADAPTER_FAILED" }) });
        }
      }
      return slot.promise;
    },
    async stop(request): Promise<AgentTaskStopEvidence> {
      const slot = slots.get(request.signal);
      if (!slot) throw Error("CODEX_MANAGED_TASK_NOT_RUNNING");
      if (requestDigest(request) !== slot.requestDigest || !Number.isSafeInteger(request.cleanupDeadlineUnixMs)
        || request.cleanupDeadlineUnixMs < request.admittedAtUnixMs || request.cleanupDeadlineUnixMs > slot.cleanupDeadlineUnixMs)
        throw Error("CODEX_MANAGED_STOP_BINDING_MISMATCH");
      // Keep one stop promise and publish it before abort listeners can reenter.
      return slot.stopping ??= Promise.resolve().then(async () => {
        slot.controller.abort();
        await slot.promise;
        const receipt = slot.receipt;
        if (slot.sessionStarted && (!receipt?.processStopped || !receipt.handlersJoined || !receipt.brokerJoined))
          throw Error("CODEX_MANAGED_TASK_STOP_UNPROVEN");
        const evidence = Object.freeze({ ...slot.binding, processStopped: true as const, controllersStopped: true as const, joined: true as const,
          stoppedAtUnixMs: safeInteger(now(), request.admittedAtUnixMs, Number.MAX_SAFE_INTEGER),
          proofDigest: proof({ requestDigest: slot.requestDigest, custody: slot.sessionStarted ? receipt : { sessionStarted: false } }) });
        if (active === slot) active = null;
        return evidence;
      });
    },
  };
  return Object.freeze(adapter);
}
