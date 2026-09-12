import type { AccountLeaseStore } from "./accounts.ts";
import { assertCapabilityProfile, type CapabilityBroker, type CapabilityProfileIdentity } from "./capabilities.ts";
import { AgentStoppedError } from "./runtime.ts";
import { boundedText, identifier, provider, safeInteger, type AgentProvider } from "./validation.ts";

export type AgentTaskRoute = Readonly<{ id: string; provider: AgentProvider; authentication: "subscription" | "api" }>;
export type AgentTaskModel = Readonly<{ id: string; reasoningEffort: string | null; serviceTier: string | null }>;
export type AgentTaskLimits = Readonly<{ maxRunMs: number; maxCleanupMs: number; maxOutputBytes: number }>;
export type TaskRuntimeQualification =
  | Readonly<{ status: "unqualified"; reason: string }>
  | Readonly<{ status: "qualified"; route: AgentTaskRoute; profile: CapabilityProfileIdentity;
      runtimeVersion: string; runtimeDigest: string; evidenceDigest: string; expiresAt: number;
      controls: Readonly<{ noCommandTools: true; exactToolInventory: true; workspaceReadIsolation: true;
        workspaceWriteIsolation: true; isolatedConfiguration: true; authOutsideWorkspace: true; hostBrokerOnly: true }> }>;
export type AgentTaskRequest = Readonly<{
  route: AgentTaskRoute; accountId: string; workspaceId: string; runId: string;
  profile: CapabilityProfileIdentity; model: AgentTaskModel; purpose: string; prompt: string;
  limits: AgentTaskLimits; signal: AbortSignal;
}>;
export type AgentTaskRuntimeProof = Readonly<{ runtimeVersion: string; runtimeDigest: string; evidenceDigest: string; qualificationExpiresAt: number }>;
export type AgentTaskBinding = Readonly<{ route: AgentTaskRoute; accountId: string; workspaceId: string; runId: string;
  profile: CapabilityProfileIdentity; model: AgentTaskModel; runtime: AgentTaskRuntimeProof }>;
export type AgentTaskExecutionRequest = AgentTaskRequest & Readonly<{ runtime: AgentTaskRuntimeProof;
  admittedAtUnixMs: number; executionDeadlineUnixMs: number; cleanupDeadlineUnixMs: number }>;
export type AgentTaskUsage = Readonly<{ inputTokens: number | null; outputTokens: number | null; totalTokens: number | null; costUsd: number | null }>;
export type AgentTaskOutcome = Readonly<{ status: "completed" | "failed" | "cancelled" | "deadline-exceeded"; code: string | null }>;
export type AgentTaskCompletion = AgentTaskBinding & Readonly<{ output: string | null; usage: AgentTaskUsage; outcome: AgentTaskOutcome }>;
export type AgentTaskStopReason = "completed" | "failed" | "cancelled" | "deadline-exceeded";
/** Trusted adapter evidence, never inferred from a signal, timeout or lease expiry. */
export type AgentTaskStopEvidence = AgentTaskBinding & Readonly<{ processStopped: true; controllersStopped: true;
  joined: true; stoppedAtUnixMs: number; proofDigest: string }>;
export type AgentTaskResult = AgentTaskCompletion & Readonly<{ stop: AgentTaskStopEvidence;
  timing: Readonly<{ admittedAtUnixMs: number; executionDeadlineUnixMs: number; cleanupDeadlineUnixMs: number; outerDeadlineUnixMs: number;
    joinedAtUnixMs: number; cleanupDeadlineExceeded: boolean }>; brokerJoined: true; custody: "released" }>;
export interface AgentTaskAdapter {
  readonly route: AgentTaskRoute;
  readonly runtime: Readonly<{ version: string; digest: string }>;
  readonly qualification: TaskRuntimeQualification;
  run(request: AgentTaskExecutionRequest, broker: CapabilityBroker): Promise<AgentTaskCompletion>;
  /** Must work while run is pending; settle only after every owned controller/process joins.
   * This request copy carries the actual cleanup deadline, capped by the original outer deadline. */
  stop(request: AgentTaskExecutionRequest, reason: AgentTaskStopReason): Promise<AgentTaskStopEvidence>;
}
export type AgentTaskOptions = Readonly<{ adapters: readonly AgentTaskAdapter[]; leases: AccountLeaseStore; now(): number }>;
const HASH = /^[a-f0-9]{64}$/u;
const BINDING_KEYS = ["route", "accountId", "workspaceId", "runId", "profile", "model", "runtime"];
const CONTROLS = ["noCommandTools", "exactToolInventory", "workspaceReadIsolation", "workspaceWriteIsolation",
  "isolatedConfiguration", "authOutsideWorkspace", "hostBrokerOnly"] as const;
const UNKNOWN_USAGE: AgentTaskUsage = Object.freeze({ inputTokens: null, outputTokens: null, totalTokens: null, costUsd: null });

/** Closed records exclude accessors so validation cannot invoke provider-supplied getters. */
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error("TASK_RECORD_INVALID");
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => typeof key !== "string" || !keys.includes(key)
    || !Object.getOwnPropertyDescriptor(value, key)?.enumerable || !("value" in Object.getOwnPropertyDescriptor(value, key)!)))
    throw Error("TASK_RECORD_INVALID");
  return value as Record<string, unknown>;
}
function digest(value: unknown): string {
  if (typeof value !== "string" || !HASH.test(value)) throw Error("TASK_DIGEST_INVALID");
  return value;
}
function route(value: unknown): AgentTaskRoute {
  const r = record(value, ["id", "provider", "authentication"]);
  if (r.authentication !== "subscription" && r.authentication !== "api") throw Error("TASK_AUTHENTICATION_INVALID");
  return Object.freeze({ id: identifier(r.id), provider: provider(r.provider), authentication: r.authentication });
}
function model(value: unknown): AgentTaskModel {
  const m = record(value, ["id", "reasoningEffort", "serviceTier"]);
  return Object.freeze({ id: boundedText(m.id, 160), reasoningEffort: m.reasoningEffort === null ? null : boundedText(m.reasoningEffort, 160),
    serviceTier: m.serviceTier === null ? null : boundedText(m.serviceTier, 160) });
}
function profile(value: unknown): CapabilityProfileIdentity {
  const p = record(value, ["id", "version", "digest"]);
  return Object.freeze({ id: identifier(p.id), version: safeInteger(p.version, 1, Number.MAX_SAFE_INTEGER), digest: digest(p.digest) });
}
function runtime(value: unknown): AgentTaskRuntimeProof {
  const r = record(value, ["runtimeVersion", "runtimeDigest", "evidenceDigest", "qualificationExpiresAt"]);
  return Object.freeze({ runtimeVersion: boundedText(r.runtimeVersion, 160), runtimeDigest: digest(r.runtimeDigest), evidenceDigest: digest(r.evidenceDigest),
    qualificationExpiresAt: safeInteger(r.qualificationExpiresAt, 0, Number.MAX_SAFE_INTEGER) });
}
function binding(value: Record<string, unknown>): AgentTaskBinding {
  return Object.freeze({ route: route(value.route), accountId: identifier(value.accountId), workspaceId: identifier(value.workspaceId),
    runId: identifier(value.runId), profile: profile(value.profile), model: model(value.model), runtime: runtime(value.runtime) });
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function matchingBinding(value: Record<string, unknown>, expected: AgentTaskBinding): AgentTaskBinding {
  const actual = binding(value);
  if (!same(actual, expected)) throw Error("TASK_RECEIPT_BINDING_MISMATCH");
  return actual;
}
function qualified(adapter: AgentTaskAdapter, request: AgentTaskRequest, cleanupDeadline: number): AgentTaskRuntimeProof {
  const q = adapter.qualification;
  if (!q || q.status !== "qualified") throw Error("TASK_ADAPTER_UNQUALIFIED");
  record(q, ["status", "route", "profile", "runtimeVersion", "runtimeDigest", "evidenceDigest", "expiresAt", "controls"]);
  record(q.controls, CONTROLS);
  if (CONTROLS.some(control => q.controls[control] !== true)) throw Error("TASK_QUALIFICATION_INCOMPLETE");
  const identity = runtime({ runtimeVersion: q.runtimeVersion, runtimeDigest: q.runtimeDigest,
    evidenceDigest: q.evidenceDigest, qualificationExpiresAt: q.expiresAt });
  const installed = record(adapter.runtime, ["version", "digest"]);
  if (!same(route(q.route), request.route) || !same(profile(q.profile), request.profile)
    || identity.runtimeVersion !== installed.version || identity.runtimeDigest !== installed.digest
    || identity.qualificationExpiresAt < cleanupDeadline) throw Error("TASK_QUALIFICATION_MISMATCH");
  if (typeof adapter.run !== "function" || typeof adapter.stop !== "function") throw Error("TASK_ADAPTER_INVALID");
  return identity;
}
function completion(value: unknown, expected: AgentTaskBinding, limit: number): AgentTaskCompletion {
  const v = record(value, [...BINDING_KEYS, "output", "usage", "outcome"]), actual = matchingBinding(v, expected);
  const u = record(v.usage, ["inputTokens", "outputTokens", "totalTokens", "costUsd"]);
  const tokens = (n: unknown) => n === null ? null : safeInteger(n, 0, Number.MAX_SAFE_INTEGER);
  if (u.costUsd !== null && (typeof u.costUsd !== "number" || !Number.isFinite(u.costUsd) || u.costUsd < 0)) throw Error("TASK_USAGE_INVALID");
  const usage: AgentTaskUsage = Object.freeze({ inputTokens: tokens(u.inputTokens), outputTokens: tokens(u.outputTokens),
    totalTokens: tokens(u.totalTokens), costUsd: u.costUsd as number | null });
  const o = record(v.outcome, ["status", "code"]);
  if (!["completed", "failed", "cancelled", "deadline-exceeded"].includes(String(o.status))
    || (o.status === "completed" ? o.code !== null : typeof o.code !== "string")) throw Error("TASK_OUTCOME_INVALID");
  const outcome = Object.freeze({ status: o.status as AgentTaskOutcome["status"], code: o.code === null ? null : identifier(o.code) });
  return Object.freeze({ ...actual, output: v.output === null ? null : boundedText(v.output, limit, true), usage, outcome });
}
function stopEvidence(value: unknown, expected: AgentTaskBinding, began: number, now: number): AgentTaskStopEvidence {
  const v = record(value, [...BINDING_KEYS, "processStopped", "controllersStopped", "joined", "stoppedAtUnixMs", "proofDigest"]);
  const actual = matchingBinding(v, expected);
  if (v.processStopped !== true || v.controllersStopped !== true || v.joined !== true) throw Error("TASK_STOP_UNPROVEN");
  return Object.freeze({ ...actual, processStopped: true, controllersStopped: true, joined: true,
    stoppedAtUnixMs: safeInteger(v.stoppedAtUnixMs, began, now), proofDigest: digest(v.proofDigest) });
}

/** Admission only: no bundled live adapter, credential discovery or route fallback.
 * Native adapters must enforce supplied deadlines outside this JS event loop. This
 * owner never races past unresolved run/stop/handler promises or claims force-stop.
 */
export async function runAgentTask(options: AgentTaskOptions, input: AgentTaskRequest, broker: CapabilityBroker): Promise<AgentTaskResult> {
  let invoked = false;
  const now = options.now, leases = options.leases;
  const acquire = leases.acquire.bind(leases), release = leases.release.bind(leases);
  try {
    const began = safeInteger(now(), 0, Number.MAX_SAFE_INTEGER - 3_600_000);
    record(input, ["route", "accountId", "workspaceId", "runId", "profile", "model", "purpose", "prompt", "limits", "signal"]);
    const l = record(input.limits, ["maxRunMs", "maxCleanupMs", "maxOutputBytes"]);
    const limits = Object.freeze({ maxRunMs: safeInteger(l.maxRunMs, 1, 3_599_999), maxCleanupMs: safeInteger(l.maxCleanupMs, 1, 3_599_999),
      maxOutputBytes: safeInteger(l.maxOutputBytes, 1, 64 * 1024 * 1024) });
    const total = safeInteger(limits.maxRunMs + limits.maxCleanupMs, 1_000, 3_600_000);
    if (!(input.signal instanceof AbortSignal)) throw Error("TASK_SIGNAL_INVALID");
    const request: AgentTaskRequest = Object.freeze({ route: route(input.route), accountId: identifier(input.accountId),
      workspaceId: identifier(input.workspaceId), runId: identifier(input.runId), profile: profile(input.profile), model: model(input.model),
      purpose: boundedText(input.purpose, 160), prompt: boundedText(input.prompt, 512 * 1024), limits, signal: input.signal });
    assertCapabilityProfile(broker.profile, request.profile);
    if (request.runId !== broker.runId || request.workspaceId !== broker.workspaceId) throw Error("TASK_BROKER_BINDING_MISMATCH");
    if (request.signal.aborted) throw Error("TASK_CANCELLED_BEFORE_ADAPTER");
    broker.assertActive();
    if (!Array.isArray(options.adapters)) throw Error("TASK_ADAPTERS_INVALID");
    const routes = options.adapters.map(adapter => route(adapter.route));
    if (new Set(routes.map(r => r.id)).size !== routes.length) throw Error("TASK_DUPLICATE_ROUTE");
    const index = routes.findIndex(r => same(r, request.route));
    if (index === -1) throw Error("TASK_ROUTE_UNAVAILABLE");
    const adapter = options.adapters[index]!;
    const executionDeadlineUnixMs = began + limits.maxRunMs, cleanupDeadlineUnixMs = began + total;
    const proof = qualified(adapter, request, cleanupDeadlineUnixMs);
    const controller = new AbortController();
    const execution: AgentTaskExecutionRequest = Object.freeze({ ...request, signal: controller.signal, runtime: proof,
      admittedAtUnixMs: began, executionDeadlineUnixMs, cleanupDeadlineUnixMs });
    const expected = binding(execution as unknown as Record<string, unknown>);
    const run = adapter.run.bind(adapter), stop = adapter.stop.bind(adapter);
    // Preflight consumes the same finite budget; no model time is silently reset.
    const admittedNow = safeInteger(now(), began, Number.MAX_SAFE_INTEGER);
    if (admittedNow >= executionDeadlineUnixMs) throw Error("TASK_ADMISSION_DEADLINE");
    const lease = acquire({ provider: request.route.provider, accountId: request.accountId,
      owner: request.runId, now: began, ttlMs: total });
    let effectiveCleanupDeadline = cleanupDeadlineUnixMs;
    let cancelled: "cancelled" | "deadline-exceeded" | null = null;
    const currentCancellation = (): "cancelled" | "deadline-exceeded" | null => cancelled;
    let stopping: Promise<PromiseSettledResult<unknown>> | undefined;
    let closing: Promise<PromiseSettledResult<void>> | undefined;
    const close = () => closing ??= Promise.resolve().then(() => broker.close()).then(
      value => ({ status: "fulfilled" as const, value }), reason => ({ status: "rejected" as const, reason }));
    const stopOnce = (reason: AgentTaskStopReason) => {
      if (stopping) return stopping;
      effectiveCleanupDeadline = Math.min(cleanupDeadlineUnixMs, safeInteger(now(), began, Number.MAX_SAFE_INTEGER - limits.maxCleanupMs) + limits.maxCleanupMs);
      const stoppingRequest = Object.freeze({ ...execution, cleanupDeadlineUnixMs: effectiveCleanupDeadline });
      // Publish ownership before synchronous abort listeners can reenter stop.
      stopping = Promise.resolve().then(() => stop(stoppingRequest, reason)).then(
        value => ({ status: "fulfilled" as const, value }), error => ({ status: "rejected" as const, reason: error }));
      broker.revoke(); close();
      if (!controller.signal.aborted) controller.abort();
      return stopping;
    };
    const cancel = (reason: "cancelled" | "deadline-exceeded") => {
      cancelled ??= reason;
      if (invoked) stopOnce(reason); else { broker.revoke(); controller.abort(); }
    };
    const onAbort = () => cancel("cancelled");
    request.signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => cancel("deadline-exceeded"), Math.max(0, executionDeadlineUnixMs - now()));
    try {
      // No await occurs between this final cancellation check and run admission.
      if (request.signal.aborted) cancel("cancelled");
      if (now() >= executionDeadlineUnixMs) cancel("deadline-exceeded");
      if (cancelled) {
        await broker.close();
        if (!release(lease)) throw Error("STALE_ACCOUNT_LEASE");
        throw Error(cancelled === "cancelled" ? "TASK_CANCELLED_BEFORE_ADAPTER" : "TASK_ADMISSION_DEADLINE");
      }
      try { broker.assertActive(); } catch {
        await broker.close();
        if (!release(lease)) throw Error("STALE_ACCOUNT_LEASE");
        throw Error("TASK_BROKER_REVOKED_BEFORE_ADAPTER");
      }
      invoked = true;
      let running: Promise<AgentTaskCompletion>;
      try { running = Promise.resolve(run(execution, broker)); } catch (error) { running = Promise.reject(error); }
      const settled = await running.then(
        value => ({ status: "fulfilled" as const, value }), reason => ({ status: "rejected" as const, reason }));
      clearTimeout(timer);
      if (now() >= executionDeadlineUnixMs) cancelled ??= "deadline-exceeded";
      const stopped = await stopOnce(cancelled ?? (settled.status === "fulfilled" ? "completed" : "failed"));
      const closed = await close();
      const joinedAt = safeInteger(now(), began, Number.MAX_SAFE_INTEGER);
      if (stopped.status !== "fulfilled" || closed.status !== "fulfilled") throw Error("TASK_CUSTODY_UNPROVEN");
      const joined = stopEvidence(stopped.value, expected, began, joinedAt);
      let result: AgentTaskCompletion;
      if (settled.status === "fulfilled") result = completion(settled.value, expected, limits.maxOutputBytes);
      else if (cancelled || settled.reason instanceof AgentStoppedError) result = Object.freeze({ ...expected, output: null, usage: UNKNOWN_USAGE,
        outcome: Object.freeze({ status: "failed", code: "TASK_ADAPTER_STOPPED" }) });
      else throw Error("TASK_ADAPTER_FAILED_CUSTODY_RETAINED");
      const cleanupDeadlineExceeded = joinedAt > effectiveCleanupDeadline;
      const cancellation = currentCancellation();
      if (cleanupDeadlineExceeded) result = Object.freeze({ ...result, output: null,
        outcome: Object.freeze({ status: "failed", code: "TASK_CLEANUP_DEADLINE_EXCEEDED" }) });
      else if (cancellation) result = Object.freeze({ ...result, output: null,
        outcome: Object.freeze({ status: cancellation, code: cancellation === "cancelled" ? "TASK_CANCELLED" : "TASK_EXECUTION_DEADLINE" }) });
      if (!release(lease)) throw Error("STALE_ACCOUNT_LEASE");
      return Object.freeze({ ...result, stop: joined, timing: Object.freeze({ admittedAtUnixMs: began, executionDeadlineUnixMs,
        cleanupDeadlineUnixMs: effectiveCleanupDeadline, outerDeadlineUnixMs: cleanupDeadlineUnixMs, joinedAtUnixMs: joinedAt, cleanupDeadlineExceeded }), brokerJoined: true, custody: "released" });
    } finally {
      clearTimeout(timer); request.signal.removeEventListener("abort", onAbort);
    }
  } finally {
    // Preflight failures also revoke; after admission this cannot replace adapter
    // stop evidence and never releases uncertain account custody.
    await broker.close();
  }
}
