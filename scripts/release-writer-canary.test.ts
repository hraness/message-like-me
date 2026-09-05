import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import {
  advanceWriterCanary,
  attestWriterCanary,
  consumeWriterCanary,
  createWriterCanaryPreflight,
  decodeWriterCanaryPhaseReceipt,
  decodeWriterCanaryPreflightReceipt,
  denyWriterCanaryWithoutStatus,
  encodeWriterCanaryPhaseReceipt,
  encodeWriterCanaryPreflightReceipt,
  finalizeWriterCanary,
  parseWriterCanaryEnvironment,
  parseWriterCanaryRef,
  parseWriterCanaryRun,
  terminalizeWriterCanary,
  type WriterCanaryStatusEvidence,
  WriterCanaryWorkflowDeltaError,
} from "./release-writer-canary.mjs";
import {
  RELEASE_CANARY_STATUS_CONTEXT,
} from "./release-status-attester.mjs";

const roots: string[] = [];
const repositoryId = 1_342_143_606;
const workflowId = 350_746_736;
const httpDate = "Sat, 05 Sep 2026 04:00:00 GMT";

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function git(cwd: string, arguments_: readonly string[]): string {
  const result = spawnSync("git", arguments_, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", LC_ALL: "C" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function fixture(workflowChange = false) {
  const root = mkdtempSync(join(tmpdir(), "mlm-writer-canary-"));
  roots.push(root);
  const repository = join(root, "repository");
  git(root, ["init", "--initial-branch=main", repository]);
  git(repository, ["config", "user.email", "canary@example.invalid"]);
  git(repository, ["config", "user.name", "Writer Canary"]);
  mkdirSync(join(repository, ".github", "workflows"), { recursive: true });
  writeFileSync(
    join(repository, ".github", "workflows", "production-writer-canary.yml"),
    "name: Prove production ref writer canary\n",
    "utf8",
  );
  writeFileSync(join(repository, "baseline.txt"), "baseline\n", "utf8");
  git(repository, ["add", "--all"]);
  git(repository, ["commit", "--no-gpg-sign", "-m", "baseline"]);
  const oldSha = git(repository, ["rev-parse", "HEAD"]);
  if (workflowChange) {
    writeFileSync(
      join(repository, ".github", "workflows", "production-writer-canary.yml"),
      "name: changed\n",
      "utf8",
    );
  } else {
    writeFileSync(join(repository, "marker.txt"), "marker\n", "utf8");
  }
  git(repository, ["add", "--all"]);
  git(repository, ["commit", "--no-gpg-sign", "-m", "candidate"]);
  return Object.freeze({ oldSha, repository, targetSha: git(repository, ["rev-parse", "HEAD"]) });
}

function environment(targetSha: string) {
  return Object.freeze({
    GITHUB_ACTIONS: "true",
    GITHUB_API_URL: "https://api.github.com",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: "hraness/message-like-me",
    GITHUB_REPOSITORY_ID: String(repositoryId),
    GITHUB_REPOSITORY_OWNER: "hraness",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_RUN_ID: "9001",
    GITHUB_SHA: targetSha,
    GITHUB_WORKFLOW: "Prove production ref writer canary",
    GITHUB_WORKFLOW_REF:
      "hraness/message-like-me/.github/workflows/production-writer-canary.yml@refs/heads/main",
    GITHUB_WORKFLOW_SHA: targetSha,
  });
}

function ref(refName: string, sha: string) {
  return {
    object: {
      sha,
      type: "commit",
      url: `https://api.github.com/repos/hraness/message-like-me/git/commits/${sha}`,
    },
    ref: refName,
    url: `https://api.github.com/repos/hraness/message-like-me/git/${refName}`,
  };
}

function run(targetSha: string) {
  return {
    event: "workflow_dispatch",
    head_branch: "main",
    head_sha: targetSha,
    id: 9001,
    name: `Prove writer canary target ${targetSha}`,
    path: ".github/workflows/production-writer-canary.yml",
    repository: { full_name: "hraness/message-like-me", id: repositoryId },
    run_attempt: 1,
    workflow_id: workflowId,
  };
}

function apiReceipt(body: unknown, date = httpDate) {
  return { body, serverDate: date };
}

function lifecycleRuleset() {
  return {
    _links: {
      html: { href: "https://github.com/hraness/message-like-me/rules/21826586" },
      self: { href: "https://api.github.com/repos/hraness/message-like-me/rulesets/21826586" },
    },
    conditions: {
      ref_name: { exclude: [], include: ["refs/heads/website-production-writer-canary"] },
    },
    current_user_can_bypass: "never",
    enforcement: "active",
    id: 21826586,
    name: "Immutable production-writer canary lifecycle",
    bypass_actors: [],
    rules: [{ type: "creation" }, { type: "deletion" }, { type: "non_fast_forward" }],
    source: "hraness/message-like-me",
    source_type: "Repository",
    target: "branch",
  };
}

function authorityRuleset() {
  const parameters = {
    do_not_enforce_on_create: false,
    required_status_checks: [{
      context: RELEASE_CANARY_STATUS_CONTEXT,
      integration_id: 4_830_612,
    }],
    strict_required_status_checks_policy: false,
  };
  return {
    _links: {
      html: { href: "https://github.com/hraness/message-like-me/rules/22290941" },
      self: { href: "https://api.github.com/repos/hraness/message-like-me/rulesets/22290941" },
    },
    bypass_actors: [],
    conditions: {
      ref_name: { exclude: [], include: ["refs/heads/website-production-writer-canary"] },
    },
    current_user_can_bypass: "never",
    enforcement: "active",
    id: 22290941,
    name: "Message Like Me writer canary status authority",
    rules: [{ parameters, type: "required_status_checks" }],
    source: "hraness/message-like-me",
    source_type: "Repository",
    target: "branch",
  };
}

function effectiveRules() {
  const parameters = authorityRuleset().rules[0]?.parameters;
  return [
    { ruleset_id: 21826586, ruleset_source: "hraness/message-like-me", ruleset_source_type: "Repository", type: "creation" },
    { ruleset_id: 21826586, ruleset_source: "hraness/message-like-me", ruleset_source_type: "Repository", type: "deletion" },
    { ruleset_id: 21826586, ruleset_source: "hraness/message-like-me", ruleset_source_type: "Repository", type: "non_fast_forward" },
    { parameters, ruleset_id: 22290941, ruleset_source: "hraness/message-like-me", ruleset_source_type: "Repository", type: "required_status_checks" },
  ];
}

function api(oldSha: string, targetSha: string) {
  return Object.freeze({
    async getRef(refName: string) {
      return apiReceipt(ref(
        refName,
        refName === "refs/heads/main" ? targetSha : oldSha,
      ));
    },
    async getRules() {
      return {
        authority: apiReceipt(authorityRuleset()),
        effective: apiReceipt(effectiveRules()),
        lifecycle: apiReceipt(lifecycleRuleset()),
      };
    },
    async getRun() {
      return apiReceipt(run(targetSha));
    },
  });
}

function revocation(deletionServerDate: string, lastObservationServerDate = deletionServerDate) {
  return {
    converged: true as const,
    deletionServerDate,
    lastObservationServerDate,
    observationCount: 2,
    propagationObserved: false,
    stableDenials: 2 as const,
  };
}

function status<State extends "error" | "success">(
  state: State,
  id: number,
  targetSha: string,
  serverDate: string,
): Readonly<WriterCanaryStatusEvidence<State>> {
  return {
    appId: 4_830_612,
    appSlug: "mlm-prod-ref-writer-1342143606",
    context: RELEASE_CANARY_STATUS_CONTEXT,
    createdAt: serverDate.replace(".000Z", "Z"),
    creator: {
      id: 123,
      login: "mlm-prod-ref-writer-1342143606[bot]",
      nodeId: "MDM6Qm90MTIz",
    },
    description: state === "success"
      ? "Exact canary authority admitted for one canary-ref attempt"
      : "Canary authority consumed after the canary-ref attempt",
    installationId: 159_058_102,
    repository: "hraness/message-like-me",
    repositoryId: repositoryId,
    serverDate,
    state,
    statusId: id,
    statusNodeId: `SC_status_${String(id)}`,
    statusUrl: `https://api.github.com/repos/hraness/message-like-me/statuses/${targetSha}`,
    targetSha,
  };
}

function terminalReadback(id: number, targetSha: string, serverDate: string) {
  return {
    context: RELEASE_CANARY_STATUS_CONTEXT,
    serverDate,
    state: "failure" as const,
    statusCount: 1,
    targetSha,
    terminalStatusId: id,
    terminalStatusNodeId: `SC_status_${String(id)}`,
  };
}

function combinedSuccess(attestation: ReturnType<typeof status>, targetSha: string) {
  return {
    commit_url: `https://api.github.com/repos/hraness/message-like-me/commits/${targetSha}`,
    repository: { full_name: "hraness/message-like-me", id: repositoryId },
    sha: targetSha,
    state: "failure",
    statuses: [{
      context: RELEASE_CANARY_STATUS_CONTEXT,
      created_at: attestation.createdAt,
      description: attestation.description,
      id: attestation.statusId,
      node_id: attestation.statusNodeId,
      state: "success",
      target_url: null,
      updated_at: attestation.createdAt,
      url: `https://api.github.com/repos/hraness/message-like-me/statuses/${targetSha}`,
    }, {
      context: "message-like-me/unrelated-check",
      created_at: attestation.createdAt,
      description: "Unrelated failure must not override the exact authority context",
      id: attestation.statusId + 1,
      node_id: `SC_status_${String(attestation.statusId + 1)}`,
      state: "failure",
      target_url: null,
      updated_at: attestation.createdAt,
      url: `https://api.github.com/repos/hraness/message-like-me/statuses/${targetSha}`,
    }],
    total_count: 2,
    url: `https://api.github.com/repos/hraness/message-like-me/commits/${targetSha}/status`,
  };
}

function combinedTerminal(consumption: ReturnType<typeof status>, targetSha: string) {
  return {
    commit_url: `https://api.github.com/repos/hraness/message-like-me/commits/${targetSha}`,
    repository: { full_name: "hraness/message-like-me", id: repositoryId },
    sha: targetSha,
    state: "success",
    statuses: [{
      context: RELEASE_CANARY_STATUS_CONTEXT,
      created_at: consumption.createdAt,
      description: consumption.description,
      id: consumption.statusId,
      node_id: consumption.statusNodeId,
      state: "error",
      target_url: null,
      updated_at: consumption.createdAt,
      url: `https://api.github.com/repos/hraness/message-like-me/statuses/${targetSha}`,
    }, {
      context: "message-like-me/unrelated-check",
      created_at: consumption.createdAt,
      description: "Unrelated success must not override terminal authority",
      id: consumption.statusId + 1,
      node_id: `SC_status_${String(consumption.statusId + 1)}`,
      state: "success",
      target_url: null,
      updated_at: consumption.createdAt,
      url: `https://api.github.com/repos/hraness/message-like-me/statuses/${targetSha}`,
    }],
    total_count: 2,
    url: `https://api.github.com/repos/hraness/message-like-me/commits/${targetSha}/status`,
  };
}

describe("persistent production-ref writer canary", () => {
  test("binds one attempt of the literal current-main workflow", () => {
    const targetSha = "1".repeat(40);
    expect(parseWriterCanaryEnvironment(environment(targetSha))).toMatchObject({
      repository: "hraness/message-like-me",
      repositoryId,
      runAttempt: 1,
      runId: 9001,
      workflowSha: targetSha,
    });
    for (const mutation of [
      { GITHUB_ACTIONS: "false" },
      { GITHUB_EVENT_NAME: "push" },
      { GITHUB_REF: "refs/heads/other" },
      { GITHUB_REPOSITORY_ID: "1" },
      { GITHUB_RUN_ATTEMPT: "2" },
      { GITHUB_WORKFLOW_SHA: "2".repeat(40) },
      { GITHUB_WORKFLOW_REF: "hraness/message-like-me/.github/workflows/other.yml@refs/heads/main" },
    ]) {
      expect(() => parseWriterCanaryEnvironment({
        ...environment(targetSha),
        ...mutation,
      })).toThrow();
    }
  });

  test("parses only exact ref and run identities", () => {
    const targetSha = "1".repeat(40);
    expect(parseWriterCanaryRef(ref("refs/heads/main", targetSha), "refs/heads/main"))
      .toBe(targetSha);
    expect(parseWriterCanaryRun(run(targetSha), { runId: 9001, workflowSha: targetSha }))
      .toEqual({ runAttempt: 1, runId: 9001, workflowId });
    expect(() => parseWriterCanaryRef(
      ref("refs/heads/website-production", targetSha),
      "refs/heads/main",
    )).toThrow("does not bind");
    expect(() => parseWriterCanaryRun(
      { ...run(targetSha), workflow_id: 0 },
      { runId: 9001, workflowSha: targetSha },
    )).toThrow("positive integer");
    expect(() => parseWriterCanaryRun(
      { ...run(targetSha), workflow_id: 345_585_865 },
      { runId: 9001, workflowSha: targetSha },
    )).toThrow("does not bind");
    expect(parseWriterCanaryRun(
      { ...run(targetSha), name: "Presentation metadata is not workflow identity" },
      { runId: 9001, workflowSha: targetSha },
    )).toEqual({ runAttempt: 1, runId: 9001, workflowId });
  });

  test("creates a canary-specific complete-range receipt and rejects workflow drift", async () => {
    const input = fixture();
    const receipt = await createWriterCanaryPreflight({
      api: api(input.oldSha, input.targetSha),
      environment: environment(input.targetSha),
      workingDirectory: input.repository,
    });
    expect(receipt).toMatchObject({
      context: RELEASE_CANARY_STATUS_CONTEXT,
      expectedOldSha: input.oldSha,
      productionRef: "refs/heads/website-production-writer-canary",
      repositoryId,
      schema: "message-like-me-production-writer-canary-v1",
      targetSha: input.targetSha,
      workflowId,
      workflowSha: input.targetSha,
    });
    expect(receipt.range).toMatchObject({
      productionRef: "refs/heads/website-production-writer-canary",
      schema: "message-like-me-canary-workflow-range-v1",
    });
    const encoded = encodeWriterCanaryPreflightReceipt(receipt);
    expect(decodeWriterCanaryPreflightReceipt(encoded)).toEqual(receipt);

    const changed = fixture(true);
    let workflowDelta: unknown;
    try {
      await createWriterCanaryPreflight({
        api: api(changed.oldSha, changed.targetSha),
        environment: environment(changed.targetSha),
        workingDirectory: changed.repository,
      });
    } catch (error) {
      workflowDelta = error;
    }
    expect(workflowDelta).toBeInstanceOf(WriterCanaryWorkflowDeltaError);
    expect((workflowDelta as WriterCanaryWorkflowDeltaError).receipt).toMatchObject({
      expectedOldSha: changed.oldSha,
      finalSha: changed.oldSha,
      offendingCommit: changed.targetSha,
      schema: "message-like-me-production-writer-canary-workflow-delta-v1",
      targetSha: changed.targetSha,
    });
  });

  test("runs the isolated terminalize, deny, attest, advance, consume, and final phases", async () => {
    const input = fixture();
    const admitted = await createWriterCanaryPreflight({
      api: api(input.oldSha, input.targetSha),
      environment: environment(input.targetSha),
      workingDirectory: input.repository,
    });
    const terminalized = await terminalizeWriterCanary({
      admitted,
      async proveAppRefDenied() {
        return {
          app: { appId: 4_830_612, installationId: 159_058_102 },
          rateLimitRemaining: 99,
          revocation: revocation("2026-09-05T04:00:02.000Z"),
          serverDate: "2026-09-05T04:00:01.000Z",
          status: 403,
        };
      },
      async terminalizeStatus() {
        return {
          consumption: status("error", 200, input.targetSha, "2026-09-05T04:00:03.000Z"),
          readback: terminalReadback(200, input.targetSha, "2026-09-05T04:00:04.000Z"),
          revocation: revocation("2026-09-05T04:00:05.000Z"),
        };
      },
    });
    const deniedApi = {
      ...api(input.oldSha, input.targetSha),
      async getRules() {
        return {
          authority: apiReceipt(authorityRuleset(), "Sat, 05 Sep 2026 04:00:06 GMT"),
          effective: apiReceipt(effectiveRules(), "Sat, 05 Sep 2026 04:00:06 GMT"),
          lifecycle: apiReceipt(lifecycleRuleset(), "Sat, 05 Sep 2026 04:00:06 GMT"),
        };
      },
      async getRefSha() {
        return { serverDate: "2026-09-05T04:00:06.000Z", sha: input.oldSha };
      },
    };
    const writerDenied = await denyWriterCanaryWithoutStatus({
      admitted,
      async advanceRef() {
        throw new Error(
          'website-production writer canary Git push failed: remote: error: GH013: Repository rule violations found for refs/heads/website-production-writer-canary. Required status check "message-like-me/website-production-writer-canary-authority" is expected',
        );
      },
      api: deniedApi,
      environment: environment(input.targetSha),
      workingDirectory: input.repository,
    });
    const attestationStatus = status(
      "success",
      201,
      input.targetSha,
      "2026-09-05T04:00:07.000Z",
    );
    const attested = await attestWriterCanary({
      admitted,
      async attestStatus() {
        return {
          revocation: revocation("2026-09-05T04:00:08.000Z"),
          status: attestationStatus,
        };
      },
    });
    let refReads = 0;
    const advanceApi = {
      ...api(input.oldSha, input.targetSha),
      async getRules() {
        return {
          authority: apiReceipt(authorityRuleset(), "Sat, 05 Sep 2026 04:00:09 GMT"),
          effective: apiReceipt(effectiveRules(), "Sat, 05 Sep 2026 04:00:09 GMT"),
          lifecycle: apiReceipt(lifecycleRuleset(), "Sat, 05 Sep 2026 04:00:09 GMT"),
        };
      },
      async getCombinedStatus() {
        return apiReceipt(
          combinedSuccess(attestationStatus, input.targetSha),
          "Sat, 05 Sep 2026 04:00:09 GMT",
        );
      },
      async getRefSha() {
        refReads += 1;
        return {
          serverDate: refReads === 1
            ? "2026-09-05T04:00:10.000Z"
            : "2026-09-05T04:00:11.000Z",
          sha: input.targetSha,
        };
      },
    };
    let staleAuthorityPushes = 0;
    await expect(advanceWriterCanary({
      admitted,
      async advanceRef() {
        staleAuthorityPushes += 1;
        throw new Error("stale authority reached the ref writer");
      },
      api: {
        ...advanceApi,
        async getCombinedStatus() {
          return apiReceipt(
            combinedSuccess(attestationStatus, input.targetSha),
            "Sat, 05 Sep 2026 04:00:07 GMT",
          );
        },
      },
      attestationReceipt: encodeWriterCanaryPhaseReceipt(attested),
      environment: environment(input.targetSha),
      async proveStaleLease() {
        throw new Error("stale authority reached the stale-lease probe");
      },
      workingDirectory: input.repository,
    })).rejects.toThrow("causal post-revocation authority");
    expect(staleAuthorityPushes).toBe(0);
    const advanced = await advanceWriterCanary({
      admitted,
      async advanceRef() {
        return {
          classification: "fast-forward" as const,
          fromSha: input.oldSha,
          protectedRef: "refs/heads/website-production-writer-canary" as const,
          summarySha256: "a".repeat(64),
          toSha: input.targetSha,
        };
      },
      api: advanceApi,
      attestationReceipt: encodeWriterCanaryPhaseReceipt(attested),
      environment: environment(input.targetSha),
      async proveStaleLease() {
        return { classification: "stale-info" as const, diagnosticSha256: "b".repeat(64) };
      },
      workingDirectory: input.repository,
    });
    const consumed = await consumeWriterCanary({
      admitted,
      async terminalizeStatus() {
        return {
          consumption: status("error", 202, input.targetSha, "2026-09-05T04:00:12.000Z"),
          readback: terminalReadback(202, input.targetSha, "2026-09-05T04:00:13.000Z"),
          revocation: revocation("2026-09-05T04:00:14.000Z"),
        };
      },
    });
    let finalRefReads = 0;
    const final = await finalizeWriterCanary({
      admitted,
      api: {
        ...api(input.targetSha, input.targetSha),
        async getCombinedStatus() {
          return apiReceipt(
            combinedTerminal(consumed.status, input.targetSha),
            "Sat, 05 Sep 2026 04:00:15 GMT",
          );
        },
        async getRefSha() {
          finalRefReads += 1;
          return {
            serverDate: finalRefReads === 1
              ? "2026-09-05T04:00:16.000Z"
              : "2026-09-05T04:00:18.000Z",
            sha: input.targetSha,
          };
        },
        async getRules() {
          return {
            authority: apiReceipt(authorityRuleset(), "Sat, 05 Sep 2026 04:00:17 GMT"),
            effective: apiReceipt(effectiveRules(), "Sat, 05 Sep 2026 04:00:17 GMT"),
            lifecycle: apiReceipt(lifecycleRuleset(), "Sat, 05 Sep 2026 04:00:17 GMT"),
          };
        },
      },
      phases: { advanced, attested, consumed, terminalized, writerDenied },
    });
    expect(final).toMatchObject({
      finalRef: { sha: input.targetSha },
      postStatusRef: { sha: input.targetSha },
      schema: "message-like-me-production-writer-canary-final-v1",
      terminalRules: {
        rules: {
          authority: { doNotEnforceOnCreate: false, strict: false },
        },
      },
    });
    for (const phase of [terminalized, writerDenied, attested, advanced, consumed]) {
      expect(decodeWriterCanaryPhaseReceipt(encodeWriterCanaryPhaseReceipt(phase))).toEqual(phase);
    }

    await expect(finalizeWriterCanary({
      admitted,
      api: {
        ...api(input.targetSha, input.targetSha),
        async getCombinedStatus() {
          return apiReceipt(
            combinedTerminal(consumed.status, input.targetSha),
            "Sat, 05 Sep 2026 04:00:15 GMT",
          );
        },
        async getRefSha() {
          return { serverDate: "2026-09-05T04:00:15.000Z", sha: input.targetSha };
        },
      },
      phases: {
        advanced,
        attested,
        consumed: {
          ...consumed,
          statusReadback: { ...consumed.statusReadback, serverDate: "2026-09-05T04:00:01.000Z" },
        },
        terminalized,
        writerDenied,
      },
    })).rejects.toThrow("regressing authenticated Date");

    await expect(finalizeWriterCanary({
      admitted,
      api: {
        ...api(input.targetSha, input.targetSha),
        async getCombinedStatus() {
          return apiReceipt(
            combinedSuccess(attestationStatus, input.targetSha),
            "Sat, 05 Sep 2026 04:00:15 GMT",
          );
        },
        async getRefSha() {
          return { serverDate: "2026-09-05T04:00:16.000Z", sha: input.targetSha };
        },
      },
      phases: { advanced, attested, consumed, terminalized, writerDenied },
    })).rejects.toThrow("terminal authority is not the exact consumed status");
  });
});
