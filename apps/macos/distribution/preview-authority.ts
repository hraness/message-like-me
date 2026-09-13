import { appendFileSync } from "node:fs";
import { admitSourceCi, githubReader, positive, REPOSITORY, REPOSITORY_ID } from "./authority.ts";
import { command, digest, object, requireValue } from "./common.ts";

/**
 * Authority for the disposable preview workflow. It binds the build to current
 * main and a complete successful CI attempt, but deliberately has no tag,
 * release, notarization, provenance, or publication authority.
 */
export function previewAuthority(environment = process.env) {
  const source = digest(environment.GITHUB_SHA, 40);
  requireValue(environment.GITHUB_REPOSITORY === REPOSITORY && environment.GITHUB_REPOSITORY_ID === String(REPOSITORY_ID)
    && environment.GITHUB_REF === "refs/heads/main" && environment.GITHUB_EVENT_NAME === "workflow_dispatch"
    && environment.GITHUB_WORKFLOW_REF === `${REPOSITORY}/.github/workflows/desktop-preview.yml@refs/heads/main`
    && environment.GITHUB_WORKFLOW_SHA === source && environment.GITHUB_ACTOR_ID === "894119"
    && environment.RUNNER_ENVIRONMENT === "github-hosted", "Exact owner-dispatched main preview workflow required");
  const ciRunId = positive(environment.PREVIEW_CI_RUN_ID), ciAttempt = positive(environment.PREVIEW_CI_RUN_ATTEMPT);
  requireValue(environment.PREVIEW_SOURCE_SHA === source, "Preview source input differs from workflow SHA");
  return { source, ciRunId, ciAttempt };
}

export function authorizePreview(environment = process.env): void {
  const authority = previewAuthority(environment), read = githubReader();
  const main = object(read(`repos/${REPOSITORY}/git/ref/heads/main`));
  requireValue(main.ref === "refs/heads/main" && object(main.object).type === "commit" && object(main.object).sha === authority.source, "Preview source is no longer current main");
  admitSourceCi({ source: authority.source, workflowId: positive(object(read(`repos/${REPOSITORY}/actions/workflows/ci.yml`)).id), runId: positive(environment.GITHUB_RUN_ID), attempt: positive(environment.GITHUB_RUN_ATTEMPT), ciRunId: authority.ciRunId, ciAttempt: authority.ciAttempt }, read);
  requireValue(command("git", ["rev-parse", "HEAD"]).toString("utf8").trim() === authority.source, "Preview checkout differs");
  if (environment.GITHUB_OUTPUT) appendFileSync(environment.GITHUB_OUTPUT, `source=${authority.source}\n`);
}

if (import.meta.main) {
  const [stage, rawId] = process.argv.slice(2);
  authorizePreview();
  if (stage !== undefined) {
    requireValue(stage === "unsigned" && process.argv.length === 4, "Expected unsigned artifact stage and artifact ID");
    const artifact = object(githubReader()(`repos/${REPOSITORY}/actions/artifacts/${positive(rawId)}`));
    const run = object(artifact.workflow_run);
    requireValue(artifact.id === positive(rawId) && artifact.name === `textbutler-desktop-preview-unsigned-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`
      && artifact.expired === false && run.id === positive(process.env.GITHUB_RUN_ID) && run.head_sha === digest(process.env.GITHUB_SHA, 40), "Preview artifact belongs to another run");
  }
  console.log("Exact current-main CI and owner preview source admitted.");
}
