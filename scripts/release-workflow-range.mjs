#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const WORKFLOW_PATH = ".github/workflows";
const PRODUCTION_REF = "refs/heads/website-production";
const CANARY_REF = "refs/heads/website-production-writer-canary";
const PRODUCTION_RECEIPT_SCHEMA = "message-like-me-workflow-range-v1";
const CANARY_RECEIPT_SCHEMA = "message-like-me-canary-workflow-range-v1";
const MAXIMUM_GIT_OUTPUT_BYTES = 256 * 1024;
const GIT_TIMEOUT_MILLISECONDS = 120_000;
const WORKFLOW_TREE_CHUNK_SIZE = 64;
const MAXIMUM_ENCODED_RECEIPT_BYTES = 4 * 1024;
export const MAXIMUM_WORKFLOW_RANGE_COMMITS = 250;

const SHA = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;

function fail(message) {
  throw new Error(message);
}

function decode(bytes, label) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail(`${label} is not valid UTF-8.`);
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectRecord(value, label) {
  if (!isRecord(value)) fail(`${label} is not an object.`);
  return value;
}

function expectExactKeys(value, keys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} has an unexpected shape.`);
  }
}

function expectSha(value, label) {
  if (typeof value !== "string" || !SHA.test(value)) fail(`${label} is not one exact commit SHA.`);
  return value;
}

function exactProtectedRef(value = PRODUCTION_REF) {
  if (value !== PRODUCTION_REF && value !== CANARY_REF) {
    fail("workflow-range protected ref is not exact production or canary");
  }
  return value;
}

function schemaForProtectedRef(value) {
  return exactProtectedRef(value) === PRODUCTION_REF
    ? PRODUCTION_RECEIPT_SCHEMA
    : CANARY_RECEIPT_SCHEMA;
}

function exactCommandOutput(result, label) {
  if (
    result === null
    || typeof result !== "object"
    || !Number.isSafeInteger(result.exitCode)
    || !(result.stdout instanceof Uint8Array)
    || !(result.stderr instanceof Uint8Array)
  ) {
    fail(`${label} returned a malformed Git result.`);
  }
  if (result.exitCode !== 0) fail(`${label} failed closed.`);
  return result.stdout;
}

function createDefaultGitRunner(workingDirectory) {
  return (arguments_) => {
    const result = spawnSync(
      "git",
      [
        "-c",
        "credential.helper=",
        "-c",
        "core.hooksPath=/dev/null",
        ...arguments_,
      ],
      {
        cwd: workingDirectory,
        encoding: "buffer",
        env: {
          GIT_ASKPASS: "/bin/false",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_SYSTEM: "/dev/null",
          GIT_NO_REPLACE_OBJECTS: "1",
          GIT_TERMINAL_PROMPT: "0",
          LC_ALL: "C",
          PATH: "/usr/bin:/bin",
          SSH_ASKPASS: "/bin/false",
        },
        maxBuffer: MAXIMUM_GIT_OUTPUT_BYTES,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: GIT_TIMEOUT_MILLISECONDS,
      },
    );
    if (result.error !== undefined || result.status === null) {
      return fail("Git command could not complete within its fixed resource bounds.");
    }
    return Object.freeze({
      exitCode: result.status,
      stderr: new Uint8Array(result.stderr),
      stdout: new Uint8Array(result.stdout),
    });
  };
}

function command(runner, arguments_, label) {
  return exactCommandOutput(runner(arguments_), label);
}

function exactSingleLine(value, label, pattern) {
  const text = decode(value, label);
  if (!text.endsWith("\n") || text.includes("\r") || text.includes("\0")) {
    fail(`${label} is not one canonical line.`);
  }
  const line = text.slice(0, -1);
  if (line.includes("\n") || !pattern.test(line)) fail(`${label} is malformed.`);
  return line;
}

function exactCommit(runner, sha, label) {
  const commit = exactSingleLine(
    command(runner, ["rev-parse", "--verify", `${sha}^{commit}`], label),
    label,
    SHA,
  );
  if (commit !== sha) fail(`${label} did not resolve to the expected exact commit.`);
}

function parseNewCommits(value, verifiedSha) {
  const text = decode(value, "Newly reachable commit inventory");
  if (text.length === 0 || !text.endsWith("\n") || text.includes("\r") || text.includes("\0")) {
    fail("Newly reachable commit inventory is empty or malformed.");
  }
  const commits = text.slice(0, -1).split("\n");
  if (commits.length === 0 || commits.length > MAXIMUM_WORKFLOW_RANGE_COMMITS) {
    fail(`Newly reachable commit inventory exceeds the ${String(MAXIMUM_WORKFLOW_RANGE_COMMITS)}-commit bound.`);
  }
  const unique = new Set();
  for (const commit of commits) {
    if (!SHA.test(commit) || unique.has(commit)) {
      fail("Newly reachable commit inventory is noncanonical.");
    }
    unique.add(commit);
  }
  if (!unique.has(verifiedSha)) fail("Newly reachable commit inventory omits the verified release commit.");
  return Object.freeze(commits);
}

function parseWorkflowTrees(value, expectedCount, label) {
  const text = decode(value, label);
  if (!text.endsWith("\n") || text.includes("\r") || text.includes("\0")) {
    fail(`${label} is not canonical line-oriented output.`);
  }
  const rows = text.slice(0, -1).split("\n");
  if (rows.length !== expectedCount || rows.some((row) => !SHA.test(row))) {
    fail(`${label} has an unexpected shape.`);
  }
  return Object.freeze(rows);
}

function readWorkflowTreeOids(runner, commits) {
  const oids = [];
  for (let index = 0; index < commits.length; index += WORKFLOW_TREE_CHUNK_SIZE) {
    const chunk = commits.slice(index, index + WORKFLOW_TREE_CHUNK_SIZE);
    const output = command(
      runner,
      ["rev-parse", ...chunk.map((commit) => `${commit}:${WORKFLOW_PATH}`)],
      "Workflow tree inventory",
    );
    oids.push(...parseWorkflowTrees(output, chunk.length, "Workflow tree inventory"));
  }
  return Object.freeze(oids);
}

function normalizedWorkflowRangeReceipt(value) {
  const receipt = expectRecord(value, "workflow-range receipt");
  expectExactKeys(receipt, [
    "newCommitCount",
    "newCommitDigest",
    "previousSha",
    "productionRef",
    "schema",
    "verifiedSha",
    "workflowTreeOid",
  ], "workflow-range receipt");
  const productionRef = exactProtectedRef(receipt.productionRef);
  if (receipt.schema !== schemaForProtectedRef(productionRef)) {
    fail("workflow-range receipt has the wrong schema or production ref.");
  }
  if (
    !Number.isSafeInteger(receipt.newCommitCount)
    || receipt.newCommitCount <= 0
    || receipt.newCommitCount > MAXIMUM_WORKFLOW_RANGE_COMMITS
  ) {
    fail("workflow-range receipt has an invalid commit count.");
  }
  if (typeof receipt.newCommitDigest !== "string" || !SHA256.test(receipt.newCommitDigest)) {
    fail("workflow-range receipt has an invalid commit digest.");
  }
  return Object.freeze({
    newCommitCount: receipt.newCommitCount,
    newCommitDigest: receipt.newCommitDigest,
    previousSha: expectSha(receipt.previousSha, "workflow-range receipt previousSha"),
    productionRef,
    schema: receipt.schema,
    verifiedSha: expectSha(receipt.verifiedSha, "workflow-range receipt verifiedSha"),
    workflowTreeOid: expectSha(receipt.workflowTreeOid, "workflow-range receipt workflowTreeOid"),
  });
}

function verifyProtectedWorkflowRange({
  previousSha,
  productionRef,
  runner,
  verifiedSha,
  workingDirectory = process.cwd(),
}) {
  const oldCommit = expectSha(previousSha, "workflow-range previous SHA");
  const newCommit = expectSha(verifiedSha, "workflow-range verified SHA");
  const protectedRef = exactProtectedRef(productionRef);
  if (oldCommit === newCommit) fail("workflow-range verification requires one advancing transition.");
  const git = runner ?? createDefaultGitRunner(workingDirectory);

  const shallow = exactSingleLine(
    command(git, ["rev-parse", "--is-shallow-repository"], "Repository shallow-state check"),
    "Repository shallow-state check",
    /^(?:false|true)$/u,
  );
  if (shallow !== "false") fail("Workflow range requires complete, non-shallow Git history.");
  exactCommit(git, oldCommit, "Previous production commit identity");
  exactCommit(git, newCommit, "Verified release commit identity");

  const ancestry = git(["merge-base", "--is-ancestor", oldCommit, newCommit]);
  if (ancestry.exitCode !== 0) {
    fail("Workflow range does not prove complete fast-forward ancestry.");
  }
  const commits = parseNewCommits(command(
    git,
    ["rev-list", "--topo-order", "--reverse", `${oldCommit}..${newCommit}`],
    "Newly reachable commit inventory",
  ), newCommit);
  const allCommits = Object.freeze([oldCommit, ...commits]);
  const trees = readWorkflowTreeOids(git, allCommits);
  const baselineTree = trees[0];
  if (baselineTree === undefined) fail("Baseline workflow tree is unavailable.");
  const type = exactSingleLine(
    command(git, ["cat-file", "-t", baselineTree], "Baseline workflow tree type"),
    "Baseline workflow tree type",
    /^[a-z]+$/u,
  );
  if (type !== "tree") fail("Baseline workflow path is not a Git tree.");
  const changedIndex = trees.findIndex((tree) => tree !== baselineTree);
  if (changedIndex >= 0) {
    const changedCommit = allCommits[changedIndex];
    fail(`Commit ${String(changedCommit)} changes ${WORKFLOW_PATH}; use the reviewed control-epoch bootstrap.`);
  }

  return normalizedWorkflowRangeReceipt(Object.freeze({
    newCommitCount: commits.length,
    newCommitDigest: createHash("sha256").update(`${commits.join("\n")}\n`, "utf8").digest("hex"),
    previousSha: oldCommit,
    productionRef: protectedRef,
    schema: schemaForProtectedRef(protectedRef),
    verifiedSha: newCommit,
    workflowTreeOid: baselineTree,
  }));
}

export function verifyWorkflowRange(input) {
  return verifyProtectedWorkflowRange({ ...input, productionRef: PRODUCTION_REF });
}

export function verifyCanaryWorkflowRange(input) {
  return verifyProtectedWorkflowRange({ ...input, productionRef: CANARY_REF });
}

function assertProtectedWorkflowRangeReceipt(value, {
  previousSha,
  productionRef,
  verifiedSha,
}) {
  const receipt = normalizedWorkflowRangeReceipt(value);
  const oldCommit = expectSha(previousSha, "expected workflow-range previous SHA");
  const newCommit = expectSha(verifiedSha, "expected workflow-range verified SHA");
  const protectedRef = exactProtectedRef(productionRef);
  if (
    receipt.previousSha !== oldCommit ||
    receipt.productionRef !== protectedRef ||
    receipt.verifiedSha !== newCommit
  ) {
    fail("workflow-range receipt does not bind the leased production transition.");
  }
  return receipt;
}

export function assertWorkflowRangeReceipt(value, expected) {
  return assertProtectedWorkflowRangeReceipt(
    value,
    { ...expected, productionRef: PRODUCTION_REF },
  );
}

export function assertCanaryWorkflowRangeReceipt(value, expected) {
  return assertProtectedWorkflowRangeReceipt(
    value,
    { ...expected, productionRef: CANARY_REF },
  );
}

export function encodeWorkflowRangeReceipt(value) {
  const receipt = normalizedWorkflowRangeReceipt(value);
  const encoded = Buffer.from(JSON.stringify(receipt), "utf8").toString("base64url");
  if (Buffer.byteLength(encoded, "utf8") > MAXIMUM_ENCODED_RECEIPT_BYTES) {
    fail("Encoded workflow-range receipt exceeds its byte bound.");
  }
  return encoded;
}

export function decodeWorkflowRangeReceipt(value) {
  if (
    typeof value !== "string"
    || value.length === 0
    || Buffer.byteLength(value, "utf8") > MAXIMUM_ENCODED_RECEIPT_BYTES
    || !BASE64URL.test(value)
  ) {
    fail("Encoded workflow-range receipt is missing or malformed.");
  }
  let decoded;
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) fail("Encoded workflow-range receipt is noncanonical.");
    decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Encoded workflow-range")) throw error;
    fail("Encoded workflow-range receipt is not canonical JSON.");
  }
  return normalizedWorkflowRangeReceipt(decoded);
}

function main() {
  const [previousSha, verifiedSha, mode, ...extra] = process.argv.slice(2);
  if (previousSha === undefined || verifiedSha === undefined || extra.length > 0) {
    fail("Usage: release-workflow-range.mjs PREVIOUS_SHA VERIFIED_SHA [--canary]");
  }
  if (process.env.GITHUB_REPOSITORY !== "hraness/message-like-me") {
    fail("Workflow range must run for exact repository hraness/message-like-me.");
  }
  if (mode !== undefined && mode !== "--canary") {
    fail("workflow-range mode is not exact production or canary");
  }
  const receipt = mode === "--canary"
    ? verifyCanaryWorkflowRange({ previousSha, verifiedSha })
    : verifyWorkflowRange({ previousSha, verifiedSha });
  process.stdout.write(`receipt=${encodeWorkflowRangeReceipt(receipt)}\n`);
}

const invokedPath = process.argv[1];
if (typeof invokedPath === "string" && pathToFileURL(invokedPath).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`::error::${message}\n`);
    process.exitCode = 1;
  }
}
