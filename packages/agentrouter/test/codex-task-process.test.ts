import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { PassThrough } from "node:stream";
import { SqliteAccountLeases } from "../src/accounts.ts";
import { createCodexManagedTaskAdapter } from "../src/codex-managed-task-adapter.ts";
import type { CodexProcessReceipt } from "../src/codex-process.ts";
import { bindCodexTaskProcess } from "../src/codex-task-process.ts";
import type { ProviderProcessPort, ProviderProcessSettlement, ProviderProcessWriteResult } from "../src/process-port.ts";
import { runAgentTask, type TaskRuntimeQualification } from "../src/task-runtime.ts";
import { managedPeer } from "./codex-managed-test-peer.ts";

const invocation = Object.freeze({ version: 1 as const, nonce: "a".repeat(32), scope: "posix-process-group" as const });
const binding = Object.freeze({ accountId: "account-one", owner: "host-owner", leaseGeneration: 2, processGeneration: 3 });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

/** Runs the real managed task session and account lease flow over a scripted
 * app-server. The native port is synthetic; this is consumer compatibility,
 * never provider, native artifact or restricted-runtime qualification. */
for (const outcome of ["accepted-full", "partial-known", "indeterminate", "refused-before-write"] as const) {
  test(`real managed task consumes ${outcome} at the host process boundary`, async () => {
    const peer = managedPeer({ noTools: true }), request = peer.request;
    const db = new Database(":memory:"), leases = new SqliteAccountLeases(db);
    let finalizations = 0, assertions = 0;
    const qualification: TaskRuntimeQualification = { status: "qualified", route: request.route, profile: request.profile,
      runtimeVersion: request.runtime.runtimeVersion, runtimeDigest: request.runtime.runtimeDigest,
      evidenceDigest: request.runtime.evidenceDigest, expiresAt: request.runtime.qualificationExpiresAt,
      controls: { noCommandTools: true, exactToolInventory: true, workspaceReadIsolation: true, workspaceWriteIsolation: true,
        isolatedConfiguration: true, authOutsideWorkspace: true, hostBrokerOnly: true } };
    const adapter = createCodexManagedTaskAdapter({ route: request.route,
      runtime: { version: request.runtime.runtimeVersion, digest: request.runtime.runtimeDigest },
      qualification, instructions: peer.settings.instructions, now: Date.now, launcher: { async launch(input) {
        const owned = await peer.launcher.launch(input), stderr = new PassThrough();
        const joined = deferred<ProviderProcessSettlement>(), completed = deferred<void>();
        let stop: Promise<CodexProcessReceipt> | undefined, writes = 0;
        const source: ProviderProcessPort = { ready: owned.ready, rootExited: owned.exited,
          stdout: owned.stdout, stderr, joined: joined.promise, transportCompleted: completed.promise,
          async write(bytes) {
            writes++;
            // Even an early matching RPC response cannot promote an uncertain
            // write into accepted input or authorize the next request.
            await owned.write(bytes);
            return writes === 1 && outcome !== "accepted-full"
              ? { outcome, acceptedBytes: outcome === "partial-known" ? 1 : 0 }
              : { outcome: "accepted-full", acceptedBytes: bytes.byteLength };
          }, async closeInput() {}, forceStop() { this.requestStop(); },
          requestStop() {
            stop ??= owned.stopAndJoin();
            void stop.then(() => { stderr.end(); joined.resolve({ kind: "joined", binding: invocation }); completed.resolve(); });
          },
        };
        return bindCodexTaskProcess({ cwd: owned.cwd, binding, invocation, process: source, joinTimeoutMs: 1_000,
          assertWriteAuthority(actual, native) { assertions++; expect(actual).toEqual(binding); expect(native).toEqual(invocation); },
          receipt: owned.receipt, async finalize(observation) {
            finalizations++; expect(peer.counts().stopped).toBe(true); expect(observation.physical.binding).toEqual(binding);
            expect(observation.operationCompleted).toBe(outcome === "accepted-full");
            const value = await stop!;
            return { ...value, runtimeErrors: observation.operationCompleted ? [] : ["SYNTHETIC_OPERATION_FAILED"] };
          } });
      } } });
    try {
      const result = await runAgentTask({ adapters: [adapter], leases, now: Date.now }, {
        route: request.route, accountId: request.accountId, workspaceId: request.workspaceId, runId: request.runId,
        profile: request.profile, model: request.model, purpose: request.purpose, prompt: request.prompt,
        limits: request.limits, signal: request.signal,
      }, peer.broker);
      expect(result.outcome.status).toBe(outcome === "accepted-full" ? "completed" : "failed");
      expect(result.custody).toBe("released"); expect(result.stop.processStopped).toBe(true);
      expect(leases.inspect("codex", request.accountId)).toBeNull(); expect(finalizations).toBe(1);
      if (outcome !== "accepted-full") { expect(assertions).toBe(1); expect(peer.methods.map(value => value.method)).toEqual(["initialize"]); }
    } finally { await peer.broker.close(); db.close(); }
  });
}

function fixture(options: { write?: ProviderProcessPort["write"]; joinTimeoutMs?: number } = {}) {
  const stdout = new PassThrough(), stderr = new PassThrough();
  const joined = deferred<ProviderProcessSettlement>(), completed = deferred<void>(), exited = deferred<void>();
  const finalized = deferred<void>();
  let finalizations = 0, stopped = false;
  const receipt = (): CodexProcessReceipt => ({ nativeVersion: "synthetic", executableSha256: "fixture", runtimeSnapshotSha256: "fixture",
    configSha256: "fixture", profileSha256: "fixture", custodyPath: "fixture", parentRuntimeSha256: "fixture",
    scratchContentSha256: "fixture", scratchIdentitySha256: "fixture", pid: 2, pgid: 2,
    rootExited: stopped, groupAbsent: stopped, stdioJoined: stopped, scratchRetained: !stopped,
    nativeExitCode: stopped ? 0 : null, nativeExitSignal: null, cleanupErrors: [], runtimeErrors: [] });
  const source: ProviderProcessPort = { ready: Promise.resolve(), rootExited: exited.promise, joined: joined.promise,
    transportCompleted: completed.promise, stdout, stderr,
    write: options.write ?? (async bytes => ({ outcome: "accepted-full", acceptedBytes: bytes.byteLength })),
    async closeInput() {}, requestStop() {}, forceStop() {} };
  const process = bindCodexTaskProcess({ cwd: "/synthetic/work", binding, invocation, process: source,
    joinTimeoutMs: options.joinTimeoutMs ?? 1_000, assertWriteAuthority: () => undefined, receipt,
    async finalize(observation) { finalizations++; finalized.resolve();
      return { ...receipt(), runtimeErrors: observation.operationCompleted ? [] : ["SYNTHETIC_OPERATION_FAILED"] }; } });
  function settle(native = invocation) { stopped = true; stdout.end(); stderr.end();
    joined.resolve({ kind: "joined", binding: native }); completed.resolve(); }
  return { process, source, settle, joined, finalized: finalized.promise, finalizations: () => finalizations };
}

test("task finalization waits for the outstanding write after exact physical join", async () => {
  const write = deferred<ProviderProcessWriteResult>(), f = fixture({ write: () => write.promise });
  await f.process.ready;
  const pending = f.process.write(new Uint8Array([1, 2]));
  const stopping = f.process.stopAndJoin(); f.settle();
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(f.finalizations()).toBe(0);
  expect(await f.process.write(new Uint8Array([3]))).toEqual({ outcome: "refused-before-write", acceptedBytes: 0 });
  write.resolve({ outcome: "indeterminate", acceptedBytes: 0 }); await pending;
  expect((await stopping).runtimeErrors).toEqual(["SYNTHETIC_OPERATION_FAILED"]);
  expect(f.finalizations()).toBe(1);
});

test("foreign invocation cannot finalize task custody", async () => {
  const f = fixture(); await f.process.ready;
  const stopping = f.process.stopAndJoin(); f.settle({ ...invocation, nonce: "b".repeat(32) });
  await expect(stopping).rejects.toThrow("CODEX_ACCOUNT_PROCESS_JOIN_MISMATCH");
  expect(f.finalizations()).toBe(0);
});

test("late physical join cannot start product finalization after the cleanup deadline", async () => {
  const f = fixture({ joinTimeoutMs: 20 }); await f.process.ready;
  const stopping = f.process.stopAndJoin();
  await expect(stopping).rejects.toThrow(); f.settle();
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(f.finalizations()).toBe(0); expect(f.process.stopAndJoin()).toBe(stopping);
});
