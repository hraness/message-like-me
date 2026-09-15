import { expect, test } from "bun:test";
import { PassThrough, Writable } from "node:stream";
import { createCapabilityBroker, createCapabilityProfile } from "../src/capabilities.ts";
import type { CodexProcessLauncher, CodexProcessReceipt } from "../src/codex-process.ts";
import { codexLimits, codexTaskLimits } from "../src/codex-relay.ts";
import { createCodexTaskAdapter } from "../src/codex-task-adapter.ts";
import type { AgentTaskExecutionRequest } from "../src/task-runtime.ts";

test("task durations admit twenty minutes without extending legacy or IO/byte limits", () => {
  expect(codexTaskLimits({ deadlineMs: 1_200_000, cleanupMs: 90_000 })).toMatchObject({
    deadlineMs: 1_200_000, cleanupMs: 90_000, ioMs: 10_000, maxRequests: 16,
  });
  expect(codexLimits()).toMatchObject({ deadlineMs: 120_000, cleanupMs: 10_000 });
  expect(() => codexLimits({ deadlineMs: 120_001 })).toThrow();
  expect(() => codexLimits({ cleanupMs: 10_001 })).toThrow();
  for (const input of [
    { deadlineMs: 3_599_999, cleanupMs: 2 }, { deadlineMs: 0 }, { cleanupMs: -1 },
    { deadlineMs: 1.5 }, { ioMs: 10_001 }, { maxRequests: 17 }, { maxFrameBytes: 1024 * 1024 + 1 },
  ]) expect(() => codexTaskLimits(input)).toThrow();
});

/** A scripted native peer exercises the real adapter/session/relay pipeline.
 * It opens only a loopback fixture; it launches no agent or provider process. */
async function taskFixture(settings: { reasoningEffort: string | null; serviceTier: string | null }, maxRunMs: number) {
  const now = Date.now(), profile = createCapabilityProfile({ id: "task-settings-fixture", version: 1, tools: [] });
  const broker = createCapabilityBroker({ profile, workspaceId: "workspace-one", runId: "run-one", isActive: () => true });
  const request: AgentTaskExecutionRequest = {
    route: { id: "synthetic-subscription", provider: "codex", authentication: "subscription" },
    accountId: "account-one", workspaceId: "workspace-one", runId: "run-one",
    accountLease: { provider: "codex", accountId: "account-one", owner: "run-one", generation: 1, expiresAt: now + maxRunMs + 90_000 },
    profile: { id: profile.id, version: profile.version, digest: profile.digest },
    model: { id: "synthetic-model", ...settings }, purpose: "research", prompt: "Use the retained evidence.",
    limits: { maxRunMs, maxCleanupMs: 90_000, maxOutputBytes: 4096 }, signal: new AbortController().signal,
    runtime: { runtimeVersion: "synthetic-only", runtimeDigest: "a".repeat(64), evidenceDigest: "b".repeat(64),
      qualificationExpiresAt: now + 3_600_000 },
    admittedAtUnixMs: now, executionDeadlineUnixMs: now + maxRunMs, cleanupDeadlineUnixMs: now + maxRunMs + 90_000,
  };
  const instructions = { base: "Use only retained evidence.", developer: "Do not invent sources." };
  const stdout = new PassThrough();
  let stopped = false, endpoint = "";
  const turnParams: Record<string, any>[] = [];
  let upstreamCalls = 0, transport: Promise<void> = Promise.resolve();
  let resolveExit!: () => void;
  const exited = new Promise<void>(resolve => { resolveExit = resolve; });
  const receipt = (): CodexProcessReceipt => ({ nativeVersion: "synthetic", executableSha256: "fixture", runtimeSnapshotSha256: "fixture",
    parentRuntimeSha256: "a".repeat(64), scratchContentSha256: "b".repeat(64), scratchIdentitySha256: "c".repeat(64),
    configSha256: "fixture", profileSha256: "fixture", custodyPath: "fixture", pid: 1, pgid: 1,
    rootExited: stopped, groupAbsent: stopped, stdioJoined: stopped, scratchRetained: !stopped,
    nativeExitCode: stopped ? 0 : null, nativeExitSignal: null, cleanupErrors: [], runtimeErrors: [] });
  const emit = (message: unknown) => stdout.write(JSON.stringify(message) + "\n");
  async function respond(params: Record<string, any>) {
    const body = { model: request.model.id, instructions: instructions.base,
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: request.prompt }] }],
      tools: [], tool_choice: "auto", parallel_tool_calls: false, store: false, stream: true, include: [],
      ...(params.effort === undefined ? {} : { reasoning: { effort: params.effort } }),
      ...(params.serviceTierForTurn === undefined ? {} : { service_tier: params.serviceTierForTurn }),
    };
    const response = await fetch(`${endpoint}/responses`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const wire = await response.text();
    expect(response.status).toBe(200);
    const events = wire.trim().split("\n\n").map(block => JSON.parse(block.split("\ndata: ")[1]!));
    const item = events.find(event => event.type === "response.output_item.done")!.item;
    emit({ method: "item/completed", params: { threadId: "thread-one", turnId: "turn-one",
      item: { type: "agentMessage", id: item.id, text: item.content[0].text } } });
    emit({ method: "turn/completed", params: { threadId: "thread-one", turn: { id: "turn-one", status: "completed", error: null } } });
  }
  const stdin = new Writable({ write(chunk, _encoding, callback) {
    const message = JSON.parse(chunk.toString());
    if (message.method === "initialize") emit({ id: message.id, result: { userAgent: "synthetic" } });
    if (message.method === "thread/start") {
      expect(message.params.baseInstructions).toBe(instructions.base);
      expect(message.params.developerInstructions).toBe(instructions.developer);
      emit({ id: message.id, result: { thread: { id: "thread-one" } } });
    }
    if (message.method === "turn/start") {
      turnParams.push(message.params);
      emit({ id: message.id, result: { turn: { id: "turn-one" } } });
      transport = new Promise<void>(resolve => setTimeout(resolve, 0)).then(() => respond(message.params));
      void transport.catch(() => stdout.emit("error", new Error("synthetic transport failed")));
    }
    callback();
  } });
  const launcher: CodexProcessLauncher = { async launch(input) {
    endpoint = JSON.parse(input.configuration.split("\n").find(line => line.startsWith("base_url = "))!.slice(11));
    return { cwd: "/synthetic/scratch", write: (bytes: Uint8Array) => new Promise<import("../src/process-port.ts").ProviderProcessWriteResult>((resolve, reject) => {
      stdin.write(bytes, error => error ? reject(error) : resolve({ outcome: "accepted-full", acceptedBytes: bytes.byteLength }));
    }), stdout, ready: Promise.resolve(), exited, receipt,
      async stopAndJoin() { stopped = true; stdin.end(); stdout.end(); resolveExit(); await transport; return receipt(); } };
  } };
  const adapter = createCodexTaskAdapter({ route: request.route,
    runtime: { version: "synthetic-only", digest: "a".repeat(64) }, qualification: { status: "unqualified", reason: "synthetic test only" },
    instructions, launcher, now: () => now,
    upstream: { async request(body) {
      upstreamCalls++;
      expect(body.reasoning).toEqual(settings.reasoningEffort === null ? undefined : { effort: settings.reasoningEffort });
      expect(body.service_tier).toBe(settings.serviceTier ?? undefined);
      const events = [
        { type: "response.created", response: { id: "response-one" } },
        { type: "response.output_item.done", item: { type: "message", role: "assistant", id: "answer-one", content: [{ type: "output_text", text: "Retained finding." }] } },
        { type: "response.completed", response: { id: "response-one", usage: { input_tokens: 12, output_tokens: 4, total_tokens: 16 } } },
      ];
      return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
        { headers: { "content-type": "text/event-stream" } });
    } },
  });
  try {
    const result = await adapter.run(request, broker);
    expect(result.outcome).toEqual({ status: "completed", code: null });
    expect(result.output).toBe("Retained finding.");
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 4, totalTokens: 16, costUsd: null });
    const stop = await adapter.stop(request, "completed");
    expect(stop.processStopped).toBe(true); expect(stop.joined).toBe(true); expect(upstreamCalls).toBe(1);
    expect(turnParams).toHaveLength(1);
    return turnParams[0]!;
  } finally { await broker.close(); }
}

test("task adapter preserves a twenty-minute run, separate cleanup, effort and service tier", async () => {
  const turn = await taskFixture({ reasoningEffort: "medium", serviceTier: "default" }, 1_200_000);
  expect(turn.effort).toBe("medium"); expect(turn.serviceTierForTurn).toBe("default");
});

test("task adapter fits the one-hour total and leaves null native settings unset", async () => {
  const turn = await taskFixture({ reasoningEffort: null, serviceTier: null }, 3_510_000);
  expect(Object.hasOwn(turn, "effort")).toBe(false); expect(Object.hasOwn(turn, "serviceTierForTurn")).toBe(false);
});
