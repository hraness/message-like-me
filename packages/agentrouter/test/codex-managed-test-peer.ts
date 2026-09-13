import { PassThrough, Writable } from "node:stream";
import { createCapabilityBroker, createCapabilityProfile } from "../src/capabilities.ts";
import { createCodexCapabilityMapping, codexTaskSettings, type CodexTaskSettings } from "../src/codex-config.ts";
import type { CodexManagedProcessLauncher } from "../src/codex-managed-config.ts";
import type { CodexProcessReceipt } from "../src/codex-process.ts";
import type { AgentTaskExecutionRequest } from "../src/task-runtime.ts";

export type ManagedPeerOptions = {
  settings?: CodexTaskSettings;
  invoke?(): Promise<unknown>; groupAbsent?: boolean; stalledTurn?: boolean; noTools?: boolean;
  mutateAccount?(value: Record<string, any>): void; mutateConfig?(value: Record<string, any>): void;
  mutateThread?(value: Record<string, any>): void;
  mutateFrame?(value: Record<string, any>): void;
  beforeCall?: readonly Record<string, any>[]; afterFinal?: readonly Record<string, any>[];
  duplicateCallback?: boolean; callbackWithoutStart?: boolean; missingCompletion?: boolean;
  failBroker?: boolean; unknownFinal?: boolean; commentaryOnly?: boolean; earlyTurn?: boolean;
  onTurn?(control: { emit(value: unknown): void; controller: AbortController }): void;
};

/** Scripted app-server streams only. No subprocess, listener, credentials or
 * provider connection is involved, so this is not native qualification. */
export function managedPeer(options: ManagedPeerOptions = {}) {
  let invocations = 0, launches = 0, stopped = false;
  const controller = new AbortController(), now = Date.now();
  const profile = createCapabilityProfile({ id: "managed-test-profile", version: 1, tools: options.noTools ? [] : [{
    name: "evidence.read", description: "Read one synthetic retained finding.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
    parseInput: value => value,
    async execute() { invocations++; if (options.failBroker) throw Error("private synthetic message");
      return options.invoke ? options.invoke() : { finding: "retained synthetic finding" }; },
  }] });
  const mapping = createCodexCapabilityMapping(profile), tools = mapping.tools;
  const settings = options.settings ?? codexTaskSettings({ model: { id: "synthetic-model", reasoningEffort: "medium", serviceTier: "default" },
    instructions: { base: "Use only retained evidence.", developer: "Do not invent sources." } });
  const request: AgentTaskExecutionRequest = {
    route: { id: "managed-test-subscription", provider: "codex", authentication: "subscription" },
    accountId: "account-one", workspaceId: "workspace-one", runId: "run-one", profile: { id: profile.id, version: profile.version, digest: profile.digest },
    // Template metadata only; withTaskLease/runAgentTask supplies real admission.
    accountLease: { provider: "codex", accountId: "account-one", owner: "run-one", generation: 1, expiresAt: now + 2_200 },
    model: settings.model, purpose: "research", prompt: "Synthetic task only.",
    limits: { maxRunMs: 2_000, maxCleanupMs: 200, maxOutputBytes: 4096 }, signal: controller.signal,
    runtime: { runtimeVersion: "synthetic-only", runtimeDigest: "a".repeat(64), evidenceDigest: "b".repeat(64), qualificationExpiresAt: now + 3_600_000 },
    admittedAtUnixMs: now, executionDeadlineUnixMs: now + 2_000, cleanupDeadlineUnixMs: now + 2_200,
  };
  const broker = createCapabilityBroker({ profile, workspaceId: request.workspaceId, runId: request.runId, isActive: () => true });
  const stdout = new PassThrough(); let resolveExit!: () => void;
  const exited = new Promise<void>(resolve => { resolveExit = resolve; });
  const methods: { method: string; params: any }[] = [], answers: unknown[] = [];
  const receipt = (): CodexProcessReceipt => ({ nativeVersion: "synthetic-only", executableSha256: "fixture", runtimeSnapshotSha256: "fixture",
    configSha256: "fixture", profileSha256: "fixture", custodyPath: "fixture", parentRuntimeSha256: "fixture",
    scratchContentSha256: "fixture", scratchIdentitySha256: "fixture", pid: 1, pgid: 1,
    rootExited: stopped, groupAbsent: stopped && options.groupAbsent !== false, stdioJoined: stopped, scratchRetained: !stopped,
    nativeExitCode: stopped ? 0 : null, nativeExitSignal: null, cleanupErrors: [], runtimeErrors: [] });
  function emit(value: unknown) { const changed = structuredClone(value) as Record<string, any>;
    if (changed.method === "item/started") changed.params.startedAtMs = now;
    if (changed.method === "item/completed") changed.params.completedAtMs = now + 1;
    options.mutateFrame?.(changed);
    if (!stdout.destroyed && !stopped) stdout.write(JSON.stringify(changed) + "\n"); }
  const scoped = (item: unknown) => ({ threadId: "thread-one", turnId: "turn-one", item });
  const started = { type: "dynamicToolCall", id: "call-one", tool: tools[0]?.name, arguments: { id: "source-one" }, namespace: null, status: "inProgress" };
  const callback = { id: "callback-one", method: "item/tool/call", params: { threadId: "thread-one", turnId: "turn-one", callId: "call-one",
    tool: tools[0]?.name, namespace: null, arguments: { id: "source-one" } } };
  function finish() {
    if (stopped) return;
    emit({ method: "item/completed", params: scoped({ type: "agentMessage", id: "answer-one", text: "Synthetic final finding.",
      phase: options.commentaryOnly ? "commentary" : options.unknownFinal ? null : "final_answer" }) });
    const total = { inputTokens: 21, outputTokens: 9, totalTokens: 30, cachedInputTokens: 3, reasoningOutputTokens: 2 };
    emit({ method: "thread/tokenUsage/updated", params: { threadId: "thread-one", turnId: "turn-one", tokenUsage: { total, last: total } } });
    const terminal = { method: "turn/completed", params: { threadId: "thread-one", turn: { id: "turn-one", status: "completed", error: null } } };
    // A single write exercises the driver's terminal queue drain.
    const batch = [terminal, ...(options.afterFinal ?? [])].map(value => { const frame = structuredClone(value); options.mutateFrame?.(frame); return frame; });
    stdout.write(batch.map(value => JSON.stringify(value) + "\n").join(""));
  }
  function turn() {
    if (stopped) return;
    options.onTurn?.({ emit, controller });
    if (options.stalledTurn) return;
    emit({ method: "item/completed", params: scoped({ type: "agentMessage", id: "commentary-one", text: "Reading evidence.", phase: "commentary" }) });
    emit({ method: "item/started", params: scoped({ type: "reasoning", id: "reason-one", summary: [], content: [] }) });
    emit({ method: "item/reasoning/summaryTextDelta", params: { threadId: "thread-one", turnId: "turn-one", itemId: "reason-one", summaryIndex: 0, delta: "Synthetic reasoning observation." } });
    emit({ method: "item/completed", params: scoped({ type: "reasoning", id: "reason-one", summary: ["Synthetic reasoning observation."], content: [] }) });
    for (const value of options.beforeCall ?? []) emit(value);
    if (!tools.length) { finish(); return; }
    if (!options.callbackWithoutStart) emit({ method: "item/started", params: scoped(started) });
    emit(callback); if (options.duplicateCallback) emit({ ...callback, id: "callback-two" });
  }
  const stdin = new Writable({ write(chunk, _encoding, complete) {
    const message = JSON.parse(chunk.toString());
    if (message.method) methods.push({ method: message.method, params: message.params });
    if (message.method === "initialize") emit({ id: message.id, result: { userAgent: "synthetic-only" } });
    if (message.method === "account/read") {
      const result = { account: { type: "chatgpt", email: "synthetic-private@example.invalid", planType: "pro" }, requiresOpenaiAuth: true };
      options.mutateAccount?.(result); emit({ id: message.id, result });
    }
    if (message.method === "config/read") {
      const result = { config: { model: null, model_provider: "openai", model_reasoning_effort: null, service_tier: null,
        forced_login_method: "chatgpt", approval_policy: "never", sandbox_mode: "read-only", web_search: "disabled",
        apps: { _default: { enabled: false, destructive_enabled: false, open_world_enabled: false } } }, origins: {}, layers: null };
      options.mutateConfig?.(result); emit({ id: message.id, result });
    }
    if (message.method === "thread/start") {
      const result = { model: message.params.model, modelProvider: "openai",
        reasoningEffort: message.params.config?.model_reasoning_effort ?? "medium", serviceTier: message.params.serviceTier ?? "default",
        cwd: "/synthetic/work", approvalPolicy: "never", approvalsReviewer: "user", sandbox: { type: "readOnly", networkAccess: false },
        runtimeWorkspaceRoots: [], instructionSources: [],
        thread: { id: "thread-one", cwd: "/synthetic/work", modelProvider: "openai", ephemeral: true, turns: [], environments: [] } };
      options.mutateThread?.(result); emit({ id: message.id, result });
    }
    if (message.method === "turn/start") {
      if (options.earlyTurn) emit({ method: "turn/started", params: { threadId: "thread-one", turn: { id: "turn-one" } } });
      emit({ id: message.id, result: { turn: { id: "turn-one", status: "inProgress" } } });
      setTimeout(turn, 0);
    }
    if (message.result?.contentItems) {
      answers.push(message.result);
      if (!options.missingCompletion) emit({ method: "item/completed", params: scoped({ ...started,
        status: message.result.success ? "completed" : "failed", success: message.result.success, contentItems: message.result.contentItems }) });
      setTimeout(finish, 0);
    }
    complete();
  } });
  const launchInputs: Parameters<CodexManagedProcessLauncher["launch"]>[0][] = [];
  const launcher: CodexManagedProcessLauncher = { async launch(input) {
    launchInputs.push(input);
    launches++;
    return { cwd: "/synthetic/work", stdin, stdout, ready: Promise.resolve(), exited, receipt,
      async stopAndJoin() { stopped = true; stdin.end(); stdout.end(); resolveExit(); return receipt(); } };
  } };
  return { request, settings, broker, launcher, launchInputs, controller, methods, answers, emit, counts: () => ({ invocations, launches, stopped }) };
}
