import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import {
  assertWorkflowRangeReceipt,
  decodeWorkflowRangeReceipt,
  encodeWorkflowRangeReceipt,
  MAXIMUM_WORKFLOW_RANGE_COMMITS,
  verifyWorkflowRange,
  type WorkflowRangeGitResult,
  type WorkflowRangeGitRunner,
} from "./release-workflow-range.mjs";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function git(cwd: string, arguments_: readonly string[]): Uint8Array {
  const result = spawnSync("git", arguments_, {
    cwd,
    encoding: "buffer",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", LC_ALL: "C" },
    maxBuffer: 512 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  });
  if (result.status !== 0) {
    throw new Error(`git ${arguments_.join(" ")} failed: ${result.stderr.toString("utf8")}`);
  }
  return new Uint8Array(result.stdout);
}

function text(cwd: string, arguments_: readonly string[]): string {
  return new TextDecoder().decode(git(cwd, arguments_)).trim();
}

type Fixture = Readonly<{
  oldSha: string;
  repository: string;
  root: string;
  workflow: string;
}>;

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "mlm-workflow-range-"));
  temporaryRoots.push(root);
  const repository = join(root, "repository");
  git(root, ["init", "--initial-branch=main", repository]);
  git(repository, ["config", "user.email", "workflow-range@example.invalid"]);
  git(repository, ["config", "user.name", "Workflow Range Fixture"]);
  const workflowDirectory = join(repository, ".github", "workflows");
  mkdirSync(workflowDirectory, { recursive: true });
  const workflow = join(workflowDirectory, "release.yml");
  writeFileSync(workflow, "name: release\n", "utf8");
  writeFileSync(join(repository, "product.txt"), "baseline\n", "utf8");
  commit(repository, "baseline");
  return Object.freeze({
    oldSha: text(repository, ["rev-parse", "HEAD"]),
    repository,
    root,
    workflow,
  });
}

function commit(repository: string, message: string): string {
  git(repository, ["add", "--all"]);
  git(repository, ["commit", "--no-gpg-sign", "-m", message]);
  return text(repository, ["rev-parse", "HEAD"]);
}

function result(exitCode: number, stdout = "", stderr = ""): WorkflowRangeGitResult {
  return Object.freeze({
    exitCode,
    stderr: new TextEncoder().encode(stderr),
    stdout: new TextEncoder().encode(stdout),
  });
}

describe("complete workflow-control range", () => {
  test("admits linear and merged product-only histories", () => {
    const linear = fixture();
    writeFileSync(join(linear.repository, "product.txt"), "linear\n", "utf8");
    const linearSha = commit(linear.repository, "linear product");
    expect(verifyWorkflowRange({
      previousSha: linear.oldSha,
      verifiedSha: linearSha,
      workingDirectory: linear.repository,
    })).toMatchObject({
      newCommitCount: 1,
      previousSha: linear.oldSha,
      verifiedSha: linearSha,
    });

    const merged = fixture();
    git(merged.repository, ["switch", "--create", "product-side"]);
    writeFileSync(join(merged.repository, "side.txt"), "side\n", "utf8");
    commit(merged.repository, "side product");
    git(merged.repository, ["switch", "main"]);
    writeFileSync(join(merged.repository, "main.txt"), "main\n", "utf8");
    commit(merged.repository, "main product");
    git(merged.repository, ["merge", "--no-ff", "product-side", "-m", "merge product"]);
    const mergedSha = text(merged.repository, ["rev-parse", "HEAD"]);
    expect(verifyWorkflowRange({
      previousSha: merged.oldSha,
      verifiedSha: mergedSha,
      workingDirectory: merged.repository,
    })).toMatchObject({
      newCommitCount: 3,
      previousSha: merged.oldSha,
      verifiedSha: mergedSha,
    });
  });

  test("rejects workflow add, delete, rename, mode, and content changes", () => {
    const mutations = [
      ["add", (input: Fixture) => {
        writeFileSync(join(input.repository, ".github", "workflows", "added.yml"), "name: added\n", "utf8");
      }],
      ["delete", (input: Fixture) => rmSync(input.workflow)],
      ["rename", (input: Fixture) => {
        renameSync(input.workflow, join(input.repository, ".github", "workflows", "renamed.yml"));
      }],
      ["mode", (input: Fixture) => chmodSync(input.workflow, 0o755)],
      ["edit", (input: Fixture) => writeFileSync(input.workflow, "name: changed\n", "utf8")],
    ] as const;

    for (const [name, mutate] of mutations) {
      const input = fixture();
      mutate(input);
      const verifiedSha = commit(input.repository, `workflow ${name}`);
      expect(() => verifyWorkflowRange({
        previousSha: input.oldSha,
        verifiedSha,
        workingDirectory: input.repository,
      })).toThrow(name === "delete" ? "Workflow tree inventory failed closed" : ".github/workflows");
    }
  });

  test("rejects a workflow touch-and-revert hidden on a merged side branch", () => {
    const input = fixture();
    git(input.repository, ["switch", "--create", "workflow-side"]);
    writeFileSync(input.workflow, "name: transient-change\n", "utf8");
    commit(input.repository, "touch workflow");
    writeFileSync(input.workflow, "name: release\n", "utf8");
    commit(input.repository, "revert workflow");
    git(input.repository, ["switch", "main"]);
    writeFileSync(join(input.repository, "product.txt"), "main product\n", "utf8");
    commit(input.repository, "main product");
    git(input.repository, ["merge", "--no-ff", "workflow-side", "-m", "merge reverted workflow side"]);
    const verifiedSha = text(input.repository, ["rev-parse", "HEAD"]);

    expect(text(input.repository, ["rev-parse", `${input.oldSha}:.github/workflows`]))
      .toBe(text(input.repository, ["rev-parse", `${verifiedSha}:.github/workflows`]));
    expect(() => verifyWorkflowRange({
      previousSha: input.oldSha,
      verifiedSha,
      workingDirectory: input.repository,
    })).toThrow("changes .github/workflows");
  });

  test("fails closed for shallow, incomplete, non-ancestor, and malformed ranges", () => {
    const shallowSource = fixture();
    writeFileSync(join(shallowSource.repository, "product.txt"), "new\n", "utf8");
    const shallowNew = commit(shallowSource.repository, "new");
    const remote = join(shallowSource.root, "remote.git");
    git(shallowSource.root, ["init", "--bare", remote]);
    git(shallowSource.repository, ["remote", "add", "origin", remote]);
    git(shallowSource.repository, ["push", "origin", "main"]);
    const shallow = join(shallowSource.root, "shallow");
    git(shallowSource.root, ["clone", "--depth=1", "--branch", "main", `file://${remote}`, shallow]);
    expect(() => verifyWorkflowRange({
      previousSha: shallowSource.oldSha,
      verifiedSha: shallowNew,
      workingDirectory: shallow,
    })).toThrow("complete, non-shallow Git history");

    const incompleteOld = "1".repeat(40);
    const incompleteNew = "2".repeat(40);
    const incompleteRunner: WorkflowRangeGitRunner = (arguments_) => {
      if (arguments_[0] === "rev-parse" && arguments_[1] === "--is-shallow-repository") {
        return result(0, "false\n");
      }
      if (arguments_[0] === "rev-parse" && arguments_[1] === "--verify") {
        const sha = arguments_[2]?.slice(0, 40) ?? "";
        return result(0, `${sha}\n`);
      }
      if (arguments_[0] === "merge-base") return result(0);
      if (arguments_[0] === "rev-list") return result(128, "", "missing commit object");
      return result(127);
    };
    expect(() => verifyWorkflowRange({
      previousSha: incompleteOld,
      runner: incompleteRunner,
      verifiedSha: incompleteNew,
    })).toThrow("Newly reachable commit inventory failed closed");

    const malformedInventoryRunner: WorkflowRangeGitRunner = (arguments_) => {
      if (arguments_[0] === "rev-list") return result(0, "not-an-object-id\n");
      return incompleteRunner(arguments_);
    };
    expect(() => verifyWorkflowRange({
      previousSha: incompleteOld,
      runner: malformedInventoryRunner,
      verifiedSha: incompleteNew,
    })).toThrow("commit inventory is noncanonical");

    const divergent = fixture();
    git(divergent.repository, ["switch", "--create", "candidate"]);
    writeFileSync(join(divergent.repository, "candidate.txt"), "candidate\n", "utf8");
    const candidateSha = commit(divergent.repository, "candidate");
    git(divergent.repository, ["switch", "main"]);
    writeFileSync(join(divergent.repository, "production.txt"), "production\n", "utf8");
    const currentProductionSha = commit(divergent.repository, "production");
    expect(() => verifyWorkflowRange({
      previousSha: currentProductionSha,
      verifiedSha: candidateSha,
      workingDirectory: divergent.repository,
    })).toThrow("complete fast-forward ancestry");

    let malformedCalls = 0;
    expect(() => verifyWorkflowRange({
      previousSha: "A".repeat(40),
      runner: () => {
        malformedCalls += 1;
        return result(127);
      },
      verifiedSha: "b".repeat(40),
    })).toThrow("previous SHA");
    expect(malformedCalls).toBe(0);
  });

  test("rejects a newly reachable history over the fixed commit bound", () => {
    const commits = Array.from(
      { length: MAXIMUM_WORKFLOW_RANGE_COMMITS + 1 },
      (_, index) => (index + 3).toString(16).padStart(40, "0"),
    );
    const oldSha = "1".repeat(40);
    const verifiedSha = commits.at(-1) as string;
    const runner: WorkflowRangeGitRunner = (arguments_) => {
      if (arguments_[0] === "rev-parse" && arguments_[1] === "--is-shallow-repository") {
        return result(0, "false\n");
      }
      if (arguments_[0] === "rev-parse" && arguments_[1] === "--verify") {
        const sha = arguments_[2]?.slice(0, 40) ?? "";
        return result(0, `${sha}\n`);
      }
      if (arguments_[0] === "merge-base") return result(0);
      if (arguments_[0] === "rev-list") return result(0, `${commits.join("\n")}\n`);
      return result(127);
    };
    expect(() => verifyWorkflowRange({ previousSha: oldSha, runner, verifiedSha }))
      .toThrow(`${String(MAXIMUM_WORKFLOW_RANGE_COMMITS)}-commit bound`);
  });

  test("binds a canonical receipt and models the canary contract", () => {
    const positiveCanary = fixture();
    writeFileSync(join(positiveCanary.repository, "canary.txt"), "non-workflow\n", "utf8");
    const positiveSha = commit(positiveCanary.repository, "positive canary");
    const receipt = verifyWorkflowRange({
      previousSha: positiveCanary.oldSha,
      verifiedSha: positiveSha,
      workingDirectory: positiveCanary.repository,
    });
    const encoded = encodeWorkflowRangeReceipt(receipt);
    expect(decodeWorkflowRangeReceipt(encoded)).toEqual(receipt);
    expect(assertWorkflowRangeReceipt(decodeWorkflowRangeReceipt(encoded), {
      previousSha: positiveCanary.oldSha,
      verifiedSha: positiveSha,
    })).toEqual(receipt);
    expect(() => assertWorkflowRangeReceipt(receipt, {
      previousSha: "f".repeat(40),
      verifiedSha: positiveSha,
    })).toThrow("does not bind");
    for (const malformed of ["", "***", encoded.toUpperCase(), "a".repeat(4 * 1024 + 1)]) {
      expect(() => decodeWorkflowRangeReceipt(malformed)).toThrow();
    }

    const negativeCanary = fixture();
    writeFileSync(negativeCanary.workflow, "name: forbidden-canary-change\n", "utf8");
    const negativeSha = commit(negativeCanary.repository, "negative canary");
    expect(() => verifyWorkflowRange({
      previousSha: negativeCanary.oldSha,
      verifiedSha: negativeSha,
      workingDirectory: negativeCanary.repository,
    })).toThrow("changes .github/workflows");
  });
});
