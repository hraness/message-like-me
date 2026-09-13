import { admitSourceCi, githubReader, positive, REPOSITORY, REPOSITORY_ID, type DesktopAuthority, type Reader } from "./authority.ts";
import { command, digest, object, requireValue } from "./common.ts";

export const PREFLIGHT_WORKFLOW = ".github/workflows/desktop-notary-preflight.yml";
const prefix = `repos/${REPOSITORY}`;
export function preflightEnvironment(environment = process.env): Omit<DesktopAuthority, "workflowId"> {
  const source = digest(environment.GITHUB_SHA, 40);
  requireValue(environment.GITHUB_REPOSITORY === REPOSITORY && environment.GITHUB_REPOSITORY_ID === String(REPOSITORY_ID)
    && environment.GITHUB_REF === "refs/heads/main" && environment.GITHUB_EVENT_NAME === "workflow_dispatch"
    && environment.GITHUB_WORKFLOW_REF === `${REPOSITORY}/${PREFLIGHT_WORKFLOW}@refs/heads/main`
    && environment.GITHUB_WORKFLOW_SHA === source && environment.GITHUB_ACTOR_ID === "894119"
    && environment.RUNNER_ENVIRONMENT === "github-hosted", "Exact owner-dispatched main notarization preflight required");
  return { source, runId: positive(environment.GITHUB_RUN_ID), attempt: positive(environment.GITHUB_RUN_ATTEMPT), ciRunId: positive(environment.DESKTOP_CI_RUN_ID), ciAttempt: positive(environment.DESKTOP_CI_RUN_ATTEMPT) };
}
export function authorizeNotaryPreflight(a: Omit<DesktopAuthority, "workflowId">, read: Reader): void {
  const repository = object(read(prefix));
  requireValue(repository.id === REPOSITORY_ID && repository.full_name === REPOSITORY && repository.private === false && repository.default_branch === "main", "Preflight repository differs");
  const workflow = object(read(`${prefix}/actions/workflows/desktop-notary-preflight.yml`));
  const workflowId = positive(workflow.id);
  requireValue(workflow.path === PREFLIGHT_WORKFLOW && workflow.state === "active", "Preflight workflow differs");
  for (const path of [`actions/runs/${a.runId}`, `actions/runs/${a.runId}/attempts/${a.attempt}`]) {
    const run = object(read(`${prefix}/${path}`));
    requireValue(run.id === a.runId && run.run_attempt === a.attempt && run.workflow_id === workflowId && run.path === PREFLIGHT_WORKFLOW
      && run.head_sha === a.source && run.head_branch === "main" && run.event === "workflow_dispatch"
      && run.status === "in_progress" && run.conclusion === null, "Preflight run or attempt differs");
    for (const value of [run.repository, run.head_repository]) {
      const repo = object(value); requireValue(repo.id === REPOSITORY_ID && repo.full_name === REPOSITORY && repo.private === false, "Foreign preflight repository");
    }
    for (const value of [run.actor, run.triggering_actor]) {
      const actor = object(value); requireValue(actor.id === 894119 && actor.type === "User", "Preflight requires its exact owner");
    }
  }
  // Credential checks have no artifact/tag authority. They still require every
  // source CI job at unchanged current main before accessing protected secrets.
  admitSourceCi({ ...a, workflowId }, read);
}
if (import.meta.main) {
  requireValue(process.argv.length === 2, "Preflight authority accepts no arguments");
  const a = preflightEnvironment(); authorizeNotaryPreflight(a, githubReader());
  requireValue(command("git", ["rev-parse", "HEAD"]).toString("utf8").trim() === a.source, "Preflight checkout differs");
  console.log("Exact main, source CI and owner notarization preflight admitted.");
}
