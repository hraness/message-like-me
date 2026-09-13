import { expect, test } from "bun:test";
import { createCodexManagedTaskAdapter } from "../src/codex-managed-task-adapter.ts";
import { CodexManagedSessionError, runCodexManagedSession } from "../src/codex-managed-session.ts";
import { assertAgentTaskAccountLease, type AgentTaskExecutionRequest } from "../src/task-runtime.ts";
import { managedPeer } from "./codex-managed-test-peer.ts";
import { withTaskLease } from "./task-lease-test-fixture.ts";

test("managed launcher receives the runtime request by reference through adapter and session", async () => {
  const peer = managedPeer(), native = peer.launcher.launch.bind(peer.launcher);
  let original!: AgentTaskExecutionRequest, verified = false;
  peer.launcher.launch = async input => {
    expect(input.request).toBe(original);
    expect(assertAgentTaskAccountLease(input.request)).toBe(original.accountLease);
    expect(input.request.signal).toBe(original.signal);
    expect(input.accountLease).toBe(original.accountLease);
    expect([input.runId, input.accountId, input.workspaceId]).toEqual([original.runId, original.accountId, original.workspaceId]);
    expect(input.cancellationSignal).not.toBe(original.signal);
    expect(input.cancellationSignal.aborted).toBe(false);
    expect(Object.isFrozen(input)).toBe(true);
    // Equivalent request copies remain valid; copying the lease or replacing
    // the runtime signal cannot manufacture another launch authority.
    expect(assertAgentTaskAccountLease({ ...input.request })).toBe(original.accountLease);
    expect(() => assertAgentTaskAccountLease({ ...input.request, accountLease: { ...input.accountLease } })).toThrow("TASK_ACCOUNT_LEASE_UNTRUSTED");
    expect(() => assertAgentTaskAccountLease({ ...input.request, signal: input.cancellationSignal })).toThrow("TASK_ACCOUNT_LEASE_BINDING_MISMATCH");
    verified = true;
    return native(input);
  };
  await withTaskLease(peer.request, peer.broker.profile, async request => {
    original = request;
    const adapter = createCodexManagedTaskAdapter({ route: request.route,
      runtime: { version: request.runtime.runtimeVersion, digest: request.runtime.runtimeDigest },
      qualification: { status: "qualified", route: request.route, profile: request.profile,
        runtimeVersion: request.runtime.runtimeVersion, runtimeDigest: request.runtime.runtimeDigest,
        evidenceDigest: request.runtime.evidenceDigest, expiresAt: request.runtime.qualificationExpiresAt,
        controls: { noCommandTools: true, exactToolInventory: true, workspaceReadIsolation: true,
          workspaceWriteIsolation: true, isolatedConfiguration: true, authOutsideWorkspace: true, hostBrokerOnly: true } },
      launcher: peer.launcher, instructions: peer.settings.instructions, now: Date.now });
    expect((await adapter.run(request, peer.broker)).outcome.status).toBe("completed");
    expect((await adapter.stop(request, "completed")).joined).toBe(true);
  });
  expect(verified).toBe(true);
  expect(peer.counts()).toEqual({ launches: 1, invocations: 1, stopped: true });
  expect(() => assertAgentTaskAccountLease(original)).toThrow("TASK_ACCOUNT_LEASE_UNTRUSTED");
});

test("host cancellation reaches the launcher without replacing or aborting runtime identity", async () => {
  const hostCancellation = new AbortController();
  let entering!: () => void;
  const entered = new Promise<void>(resolve => { entering = resolve; });
  const peer = managedPeer({ stalledTurn: true, onTurn() { entering(); } });
  await withTaskLease(peer.request, peer.broker.profile, async request => {
    const running = runCodexManagedSession({ ...peer, request, cancellationSignal: hostCancellation.signal })
      .then(() => { throw Error("Expected cancellation"); }, error => error);
    try {
      await Promise.race([entered, running.then(error => { throw error; })]);
      const launched = peer.launchInputs[0]!;
      expect(launched.request).toBe(request);
      expect(assertAgentTaskAccountLease(launched.request)).toBe(request.accountLease);
      expect(launched.cancellationSignal.aborted).toBe(false);
      hostCancellation.abort();
      const error = await running;
      expect(error).toBeInstanceOf(CodexManagedSessionError);
      expect((error as CodexManagedSessionError).receipt.processStopped).toBe(true);
      expect(launched.cancellationSignal.aborted).toBe(true);
      expect(request.signal.aborted).toBe(false);
    } finally { hostCancellation.abort(); await running; }
  });
  expect(peer.counts()).toEqual({ launches: 1, invocations: 0, stopped: true });
});

test.each(["lease-copy", "foreign-signal", "foreign-run"] as const)("%s cannot reach the managed launcher", async kind => {
  const peer = managedPeer();
  await withTaskLease(peer.request, peer.broker.profile, async request => {
    const changed = { ...request, ...(kind === "lease-copy" ? { accountLease: { ...request.accountLease } }
      : kind === "foreign-signal" ? { signal: new AbortController().signal } : { runId: "other-run" }) };
    await expect(runCodexManagedSession({ ...peer, request: changed })).rejects.toThrow(
      kind === "lease-copy" ? "TASK_ACCOUNT_LEASE_UNTRUSTED" : "TASK_ACCOUNT_LEASE_BINDING_MISMATCH");
  });
  expect(peer.counts()).toEqual({ launches: 0, invocations: 0, stopped: false });
  await peer.broker.close();
});
