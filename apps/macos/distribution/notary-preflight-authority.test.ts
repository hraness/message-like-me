import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPOSITORY, REPOSITORY_ID } from "./authority.ts";
import { authorizeNotaryPreflight, preflightEnvironment, PREFLIGHT_WORKFLOW } from "./notary-preflight-authority.ts";

const source = "a".repeat(40), prefix = `repos/${REPOSITORY}`;
const authority = { source, runId: 60, attempt: 2, ciRunId: 70, ciAttempt: 1 };
function records(): Record<string, any> {
  const repository = { id: REPOSITORY_ID, full_name: REPOSITORY, private: false, default_branch: "main" };
  const run = { id: 60, run_attempt: 2, workflow_id: 50, path: PREFLIGHT_WORKFLOW, head_sha: source, head_branch: "main", event: "workflow_dispatch", status: "in_progress", conclusion: null, repository, head_repository: repository, actor: { id: 894119, type: "User" }, triggering_actor: { id: 894119, type: "User" } };
  const ci = { ...run, id: 70, run_attempt: 1, workflow_id: 80, path: ".github/workflows/ci.yml", name: "CI", event: "push", status: "completed", conclusion: "success" };
  return structuredClone({
    [prefix]: repository,
    [`${prefix}/actions/workflows/desktop-notary-preflight.yml`]: { id: 50, path: PREFLIGHT_WORKFLOW, state: "active" },
    [`${prefix}/actions/runs/60`]: run, [`${prefix}/actions/runs/60/attempts/2`]: run,
    [`${prefix}/git/ref/heads/main`]: { ref: "refs/heads/main", object: { type: "commit", sha: source } },
    [`${prefix}/actions/workflows/ci.yml`]: { id: 80, name: "CI", path: ".github/workflows/ci.yml", state: "active" },
    [`${prefix}/actions/runs/70`]: ci, [`${prefix}/actions/runs/70/attempts/1`]: ci,
    [`${prefix}/actions/runs/70/attempts/1/jobs?per_page=100`]: { total_count: 2, jobs: ["Standalone package", "macOS synthetic Messages and Contacts fixtures"].map(name => ({ name, run_id: 70, run_attempt: 1, head_sha: source, status: "completed", conclusion: "success", completed_at: "2026-09-13T12:00:00Z" })) },
  });
}
test("notary preflight requires complete current main CI and its exact owner workflow, without tag or artifact authority", () => {
  const fixture = records(), reads: string[] = [];
  authorizeNotaryPreflight(authority, path => { reads.push(path); return fixture[path]; });
  expect(reads.some(path => /tags|releases|artifacts|packages/u.test(path))).toBe(false);
  for (const [path, field, value] of [
    ["actions/runs/60", "run_attempt", 3], ["actions/runs/60/attempts/2", "triggering_actor", { id: 999, type: "User" }],
    ["actions/runs/60", "head_sha", "b".repeat(40)], ["actions/runs/60", "workflow_id", 99],
    ["actions/runs/60", "head_repository", { id: 999, full_name: REPOSITORY, private: false }],
    ["actions/workflows/desktop-notary-preflight.yml", "path", ".github/workflows/desktop-release.yml"],
    ["git/ref/heads/main", "object", { type: "commit", sha: "b".repeat(40) }],
    ["actions/runs/70", "run_attempt", 2], ["actions/runs/70/attempts/1", "conclusion", "failure"],
    ["actions/runs/70/attempts/1/jobs?per_page=100", "total_count", 1],
  ] as const) {
    const changed = records(); changed[`${prefix}/${path}`][field] = value;
    expect(() => authorizeNotaryPreflight(authority, path => changed[path])).toThrow();
  }
  const skipped = records(); skipped[`${prefix}/actions/runs/70/attempts/1/jobs?per_page=100`].jobs[0].conclusion = "skipped";
  expect(() => authorizeNotaryPreflight(authority, path => skipped[path])).toThrow();
});
test("preflight environment rejects a branch, foreign workflow, actor, runner or ambiguous attempt", () => {
  const environment = { GITHUB_SHA: source, GITHUB_REPOSITORY: REPOSITORY, GITHUB_REPOSITORY_ID: String(REPOSITORY_ID), GITHUB_REF: "refs/heads/main", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_WORKFLOW_REF: `${REPOSITORY}/${PREFLIGHT_WORKFLOW}@refs/heads/main`, GITHUB_WORKFLOW_SHA: source, GITHUB_ACTOR_ID: "894119", RUNNER_ENVIRONMENT: "github-hosted", GITHUB_RUN_ID: "60", GITHUB_RUN_ATTEMPT: "2", DESKTOP_CI_RUN_ID: "70", DESKTOP_CI_RUN_ATTEMPT: "1" };
  expect(preflightEnvironment(environment)).toEqual(authority);
  for (const [key, value] of Object.entries({ GITHUB_ACTOR_ID: "123", GITHUB_REF: "refs/heads/feature", GITHUB_WORKFLOW_REF: `${REPOSITORY}/foreign.yml@refs/heads/main`, GITHUB_WORKFLOW_SHA: "b".repeat(40), RUNNER_ENVIRONMENT: "self-hosted", DESKTOP_CI_RUN_ATTEMPT: "01" })) expect(() => preflightEnvironment({ ...environment, [key]: value })).toThrow();
});
test("preflight workflow exposes only notary credentials after read-only admission", () => {
  const workflow = readFileSync(join(import.meta.dir, "../../../.github/workflows/desktop-notary-preflight.yml"), "utf8");
  const beforeEnvironment = workflow.split("\n  validate:\n")[0]!;
  expect(beforeEnvironment).not.toContain("secrets.");
  expect(workflow).toContain("environment: desktop-signing");
  expect(workflow).toContain("group: textbutler-desktop-release");
  expect(workflow).not.toMatch(/contents: write|id-token: write|APPLE_CERTIFICATE|APPLE_API_PRIVATE_KEY|bun install|upload-artifact|native:package|native:smoke|sign\.ts/u);
  expect(workflow.match(/\$\{\{ secrets\./gu)).toHaveLength(2);
  expect(workflow.match(/run: bun --no-env-file --no-install apps\/macos\/distribution\/notary-preflight-authority\.ts/gu)).toHaveLength(3);
  const step = workflow.split("- name: Validate Apple credentials")[1]!.split("- name: Confirm source")[0]!;
  expect(step).not.toContain("GH_TOKEN"); expect(step).toContain("notary-preflight.ts");
});
