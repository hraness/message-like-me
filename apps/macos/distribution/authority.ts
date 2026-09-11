import { appendFileSync } from "node:fs";
import { command, digest, object, requireValue, TAG } from "./common.ts";

export const REPOSITORY = "hraness/message-like-me";
export const REPOSITORY_ID = 1342143606;
export const WORKFLOW = ".github/workflows/desktop-release.yml";
const PREFIX = `repos/${REPOSITORY}`;
export const positive = (value: unknown): number => { const number = Number(value); requireValue(typeof value === "number" || typeof value === "string" && /^[1-9][0-9]*$/u.test(value), "Invalid positive identity"); requireValue(Number.isSafeInteger(number) && number > 0, "Invalid positive identity"); return number; };
export type DesktopAuthority = Readonly<{ source: string; workflowId: number; runId: number; attempt: number; ciRunId: number; ciAttempt: number }>;
export type Reader = (path: string) => unknown;
export function environmentAuthority(environment = process.env): DesktopAuthority {
  const source = digest(environment.GITHUB_SHA, 40);
  requireValue(environment.GITHUB_REPOSITORY === REPOSITORY && environment.GITHUB_REPOSITORY_ID === String(REPOSITORY_ID)
    && environment.GITHUB_REF === "refs/heads/main" && environment.GITHUB_EVENT_NAME === "workflow_dispatch"
    && environment.GITHUB_WORKFLOW_REF === `${REPOSITORY}/${WORKFLOW}@refs/heads/main` && environment.GITHUB_WORKFLOW_SHA === source
    && environment.GITHUB_ACTOR_ID === "894119" && environment.RUNNER_ENVIRONMENT === "github-hosted"
    && environment.DESKTOP_TAG === TAG, "Exact owner-dispatched main desktop workflow required");
  return { source, workflowId: positive(environment.DESKTOP_RELEASE_WORKFLOW_ID), runId: positive(environment.GITHUB_RUN_ID), attempt: positive(environment.GITHUB_RUN_ATTEMPT), ciRunId: positive(environment.DESKTOP_CI_RUN_ID), ciAttempt: positive(environment.DESKTOP_CI_RUN_ATTEMPT) };
}
export function githubEnvironment(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !/^(APPLE_|TAURI_SIGNING_)/u.test(key) && !["GH_HOST", "GH_DEBUG", "GH_FORCE_TTY"].includes(key))) as Record<string, string>;
}
export function githubReader(): Reader {
  let requests = 0; const until = performance.now() + 600_000;
  return path => {
    requireValue((path === PREFIX || path.startsWith(`${PREFIX}/`)) && !/[\r\n#]/u.test(path) && ++requests <= 150 && performance.now() < until, "GitHub read is outside desktop scope or bound");
    return JSON.parse(command("gh", ["api", "--hostname", "github.com", "--method", "GET", path], { environment: githubEnvironment(), maximum: 4 * 1024 * 1024, timeout: Math.min(30_000, Math.max(1, Math.ceil(until - performance.now()))) }).toString("utf8")) as unknown;
  };
}
export async function authorizeDesktop(authority: DesktopAuthority, read: Reader): Promise<void> {
  const a = authority, repo = object(read(PREFIX));
  requireValue(repo.id === REPOSITORY_ID && repo.full_name === REPOSITORY && repo.private === false && repo.default_branch === "main", "Desktop repository identity differs");
  const workflow = object(read(`${PREFIX}/actions/workflows/${a.workflowId}`));
  requireValue(workflow.id === a.workflowId && workflow.path === WORKFLOW && workflow.state === "active", "Desktop workflow identity differs");
  for (const path of [`actions/runs/${a.runId}`, `actions/runs/${a.runId}/attempts/${a.attempt}`]) {
    const run = object(read(`${PREFIX}/${path}`));
    requireValue(run.id === a.runId && run.run_attempt === a.attempt && run.workflow_id === a.workflowId && run.path === WORKFLOW && run.head_sha === a.source && run.head_branch === "main" && run.event === "workflow_dispatch" && run.status === "in_progress" && run.conclusion === null, "Desktop run or attempt identity differs");
    for (const value of [run.repository, run.head_repository]) { const repository = object(value); requireValue(repository.id === REPOSITORY_ID && repository.full_name === REPOSITORY && repository.private === false, "Foreign desktop run repository"); }
    for (const value of [run.actor, run.triggering_actor]) { const actor = object(value); requireValue(actor.id === 894119 && actor.type === "User", "Desktop attempt requires its exact owner"); }
  }
  const tag = object(read(`${PREFIX}/git/ref/tags/${TAG}`));
  requireValue(tag.ref === `refs/tags/${TAG}` && object(tag.object).type === "commit" && object(tag.object).sha === a.source, "Existing direct desktop tag must match exact main");
  admitSourceCi(a, read);
}
/** Same complete job union as current source CI, independent of package/site publication. */
export function admitSourceCi(a: DesktopAuthority, read: Reader): void {
  const main = object(read(`${PREFIX}/git/ref/heads/main`));
  requireValue(main.ref === "refs/heads/main" && object(main.object).type === "commit" && object(main.object).sha === a.source, "Desktop source is no longer current main");
  const workflow = object(read(`${PREFIX}/actions/workflows/ci.yml`));
  requireValue(Number.isSafeInteger(workflow.id) && Number(workflow.id) > 0 && workflow.path === ".github/workflows/ci.yml" && workflow.name === "CI" && workflow.state === "active", "Source CI workflow differs");
  for (const path of [`actions/runs/${a.ciRunId}`, `actions/runs/${a.ciRunId}/attempts/${a.ciAttempt}`]) {
    const run = object(read(`${PREFIX}/${path}`));
    requireValue(run.id === a.ciRunId && run.run_attempt === a.ciAttempt && run.workflow_id === workflow.id && run.path === workflow.path && run.name === "CI" && run.head_sha === a.source && run.head_branch === "main" && run.event === "push" && run.status === "completed" && run.conclusion === "success", "Exact successful current-main CI attempt required");
    for (const value of [run.repository, run.head_repository]) { const repo = object(value); requireValue(repo.id === REPOSITORY_ID && repo.full_name === REPOSITORY, "Foreign CI source"); }
  }
  const result = object(read(`${PREFIX}/actions/runs/${a.ciRunId}/attempts/${a.ciAttempt}/jobs?per_page=100`)), expected = ["Standalone package", "macOS synthetic Messages and Contacts fixtures"].sort();
  requireValue(result.total_count === 2 && Array.isArray(result.jobs) && result.jobs.length === 2 && result.jobs.map(job => object(job).name).sort().join() === expected.join(), "Incomplete source CI job inventory");
  for (const value of result.jobs) { const job = object(value); requireValue(job.run_id === a.ciRunId && job.run_attempt === a.ciAttempt && job.head_sha === a.source && job.status === "completed" && job.conclusion === "success" && typeof job.completed_at === "string" && Number.isFinite(Date.parse(job.completed_at)), "Source CI job failed, skipped or changed"); }
}
export function admitDesktopArtifact(read: Reader, a: DesktopAuthority, stage: "unsigned" | "signed" | "verified" | "attested", id: number): void {
  const artifact = object(read(`${PREFIX}/actions/artifacts/${positive(id)}`)); const run = object(artifact.workflow_run);
  requireValue(artifact.id === id && artifact.name === `textbutler-desktop-${stage}-${a.runId}-${a.attempt}` && artifact.expired === false && /^sha256:[a-f0-9]{64}$/u.test(String(artifact.digest)) && Number.isSafeInteger(artifact.size_in_bytes) && Number(artifact.size_in_bytes) > 0 && Number(artifact.size_in_bytes) <= 800 * 1024 * 1024 && run.id === a.runId && run.head_sha === a.source && run.head_branch === "main", "Desktop artifact belongs to another source/run/attempt or is unavailable");
}
if (import.meta.main) {
  const a = environmentAuthority(), read = githubReader(); await authorizeDesktop(a, read);
  requireValue(command("git", ["rev-parse", "HEAD"]).toString("utf8").trim() === a.source, "Desktop checkout differs");
  const [stage, rawId] = process.argv.slice(2);
  if (stage !== undefined) { requireValue(["unsigned", "signed", "verified", "attested"].includes(stage) && process.argv.length === 4, "Expected exact artifact stage and ID"); admitDesktopArtifact(read, a, stage as "unsigned" | "signed" | "verified" | "attested", positive(rawId)); }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `source=${a.source}\n`);
  console.log("Exact desktop source, CI, owner workflow and independent tag admitted.");
}
