import { Database } from "bun:sqlite";
import { SqliteAccountLeases } from "../src/accounts.ts";
import { createCapabilityBroker, type CapabilityProfile } from "../src/capabilities.ts";
import { runAgentTask, type AgentTaskAdapter, type AgentTaskBinding, type AgentTaskExecutionRequest } from "../src/task-runtime.ts";

/** Synthetic admission envelope for protocol/adapter tests. Only runAgentTask
 * creates lease authority; fixtures have no minting or registration bypass.
 * The envelope's broker owns no effects. Tested protocol streams are synthetic
 * and their separate close evidence remains the subject of each test. */
export async function withTaskLease<T>(template: AgentTaskExecutionRequest, profile: CapabilityProfile,
  action: (request: AgentTaskExecutionRequest) => Promise<T>, now: () => number = Date.now): Promise<T> {
  const db = new Database(":memory:"), leases = new SqliteAccountLeases(db);
  // The test may exercise a nonempty broker separately. This envelope performs
  // no broker calls but must preserve the tested profile's exact identity.
  const broker = createCapabilityBroker({ profile, workspaceId: template.workspaceId, runId: template.runId, isActive: () => true });
  let value!: T, failure: unknown, failed = false;
  const binding = (request: AgentTaskExecutionRequest): AgentTaskBinding => ({ route: request.route, accountId: request.accountId,
    workspaceId: request.workspaceId, runId: request.runId, profile: request.profile, model: request.model, runtime: request.runtime,
    accountLease: request.accountLease });
  const adapter: AgentTaskAdapter = {
    route: template.route, runtime: { version: template.runtime.runtimeVersion, digest: template.runtime.runtimeDigest },
    qualification: { status: "qualified", route: template.route, profile: template.profile, runtimeVersion: template.runtime.runtimeVersion,
      runtimeDigest: template.runtime.runtimeDigest, evidenceDigest: template.runtime.evidenceDigest,
      expiresAt: template.runtime.qualificationExpiresAt,
      controls: { noCommandTools: true, exactToolInventory: true, workspaceReadIsolation: true, workspaceWriteIsolation: true,
        isolatedConfiguration: true, authOutsideWorkspace: true, hostBrokerOnly: true } },
    async run(request) {
      try { value = await action(request); } catch (error) { failed = true; failure = error; }
      return { ...binding(request), output: null, outcome: { status: "completed", code: null },
        usage: { inputTokens: null, outputTokens: null, totalTokens: null, costUsd: null } };
    },
    async stop(request) { return { ...binding(request), processStopped: true, controllersStopped: true, joined: true,
      stoppedAtUnixMs: now(), proofDigest: "f".repeat(64) }; },
  };
  try {
    await runAgentTask({ adapters: [adapter], leases, now }, { route: template.route, accountId: template.accountId,
      workspaceId: template.workspaceId, runId: template.runId, profile: template.profile, model: template.model,
      purpose: template.purpose, prompt: template.prompt, limits: template.limits, signal: template.signal }, broker);
    if (failed) throw failure;
    return value;
  } finally { db.close(); }
}
