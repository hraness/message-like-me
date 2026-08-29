import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const WORKFLOWS = join(import.meta.dir, "..", ".github", "workflows");
const ROOT_GUIDE = join(import.meta.dir, "..", "AGENTS.md");
const SITE_GUIDE = join(import.meta.dir, "..", "site", "AGENTS.md");
const CODEOWNERS = join(import.meta.dir, "..", ".github", "CODEOWNERS");
const PUBLISHING_GUIDE = join(import.meta.dir, "..", "docs", "publishing.md");
const APP_TOKEN_HELPER = join(import.meta.dir, "release-app-token.mjs");
const PROVIDER_HELPER = join(import.meta.dir, "release-provider-outcome.mjs");

test("CI runs the standalone package on Ubuntu and only synthetic local-data fixtures on macOS", async () => {
  const workflow = await readFile(join(WORKFLOWS, "ci.yml"), "utf8");

  expect(workflow).toContain("runs-on: ubuntu-24.04");
  expect(workflow).toContain("runs-on: macos-15");
  expect(workflow.match(/bun-version: "1\.3\.14"/gu)?.length).toBe(2);
  expect(workflow).toContain("bun run check");
  expect(workflow).toContain("bun test src/imessage.test.ts src/contacts.test.ts src/metrics.test.ts");
  expect(workflow).toContain("HOME: ${{ runner.temp }}/message-like-me-fixture-home");
  expect(workflow).toContain("git status --porcelain --untracked-files=all -- dist bun.lock");
  expect(workflow).toContain("persist-credentials: false");
  expect(workflow).not.toContain("workflow_dispatch:");
  expect(workflow).not.toContain("Library/Messages/chat.db");
});

test("tag releases verify current main and can only publish the immutable GitHub Release", async () => {
  const workflow = await readFile(join(WORKFLOWS, "release.yml"), "utf8");

  for (const required of [
    'tags:\n      - "v*"',
    "permissions:\n  contents: read",
    "group: stable-release",
    "cancel-in-progress: false",
    "fetch-depth: 0",
    "persist-credentials: false",
    "ref: refs/tags/${{ steps.request.outputs.tag }}",
    'site_version="$(bun -e',
    "Site version $site_version does not match package version $package_version",
    'tag_commit="$(git rev-parse --verify "refs/tags/$REQUESTED_TAG^{commit}")"',
    'head_commit="$(git rev-parse --verify "HEAD^{commit}")"',
    'default_head="$(git rev-parse --verify "origin/$DEFAULT_BRANCH^{commit}")"',
    "Tag release commit $tag_commit is not current $DEFAULT_BRANCH head $default_head",
    "newest_stable_tag=\"$(git tag --list",
    "bun run check",
    "bun pm pack --dry-run --ignore-scripts",
    "working-directory: site",
    "bun run sync:readme",
    "bun run test",
    "bun run lint",
    "bun run build",
    "git diff --exit-code -- site/app/readme.generated.ts",
    "bun test src/imessage.test.ts src/contacts.test.ts src/metrics.test.ts",
    "publish:",
    "name: Publish immutable GitHub Release",
    "contents: write",
    "-F generate_release_notes=true",
    "-f make_latest=true",
    '-f name="Message Like Me $VERIFIED_TAG"',
    "-f target_commitish=\"$VERIFIED_SHA\"",
    "/commits/refs%2Ftags%2F$VERIFIED_TAG",
  ] as const) {
    expect(workflow).toContain(required);
  }

  expect(workflow).not.toContain("workflow_dispatch:");
  expect(workflow).not.toContain("environment:");
  expect(workflow).not.toContain("create-github-app-token");
  expect(workflow).not.toContain("MLM_RELEASE_APP_PRIVATE_KEY");
  expect(workflow).not.toContain("provider_baseline:");
  expect(workflow).not.toContain("provider_outcome:");
  expect(workflow).not.toContain("release-provider-outcome.mjs promote");
  expect(workflow).not.toContain("deployments: read");
  expect(workflow).not.toContain("pull_request:");
  expect(workflow).not.toContain("npm publish");
  expect(workflow).not.toContain("VERCEL_TOKEN");
  expect(workflow).not.toContain("/commits/tags/");
  expect(workflow).not.toContain("--clobber");
  expect(workflow.match(/contents: write/gu)).toHaveLength(1);

  const releaseCreation = workflow.indexOf('"/repos/$GITHUB_REPOSITORY/releases"');
  const releaseReadback = workflow.indexOf('release_readback="$(gh api "$release_endpoint")"');
  expect(releaseCreation).toBeGreaterThan(0);
  expect(releaseReadback).toBeGreaterThan(releaseCreation);
});

test("site promotion is current-main-only and isolates its dedicated App credential", async () => {
  const [workflow, appTokenHelper, providerHelper] = await Promise.all([
    readFile(join(WORKFLOWS, "website-production.yml"), "utf8"),
    readFile(APP_TOKEN_HELPER, "utf8"),
    readFile(PROVIDER_HELPER, "utf8"),
  ]);

  for (const required of [
    "workflow_run:",
    "workflows: [Release]",
    "types: [completed]",
    "workflow_dispatch:",
    "release_tag:",
    "permissions:\n  contents: read",
    "group: website-production-promotion",
    "cancel-in-progress: false",
    'DEFAULT_BRANCH" != "main"',
    'EVENT_REF" != "refs/heads/main"',
    "EXPECTED_RELEASE_WORKFLOW_ID: ${{ vars.MLM_RELEASE_WORKFLOW_ID }}",
    'UPSTREAM_WORKFLOW_ID" != "$EXPECTED_RELEASE_WORKFLOW_ID"',
    'UPSTREAM_WORKFLOW_NAME" != "Release"',
    'UPSTREAM_PATH" != ".github/workflows/release.yml"',
    'UPSTREAM_EVENT" != "push"',
    'UPSTREAM_RUN_ATTEMPT" != "1"',
    'UPSTREAM_CONCLUSION" != "success"',
    'UPSTREAM_HEAD_REPOSITORY" != "$GITHUB_REPOSITORY"',
    'current_main_sha="$(gh api',
    "Promotion workflow source $EVENT_SHA is not exact current main",
    "Verify exact immutable release coordinate",
    "release-provider-outcome.mjs revalidate-authority",
    "provider_baseline:",
    "advance_required: ${{ steps.baseline.outputs.advance_required }}",
    "release-provider-outcome.mjs baseline",
    "advance_production_ref:",
    "if: needs.provider_baseline.outputs.advance_required == 'true'",
    "environment: { name: production-ref-writer-key, deployment: false }",
    "permissions:\n      contents: read",
    "GITHUB_REPOSITORY_ID: ${{ github.repository_id }}",
    "GITHUB_REPOSITORY_OWNER: ${{ github.repository_owner }}",
    "MLM_RELEASE_APP_CLIENT_ID: ${{ vars.MLM_RELEASE_APP_CLIENT_ID }}",
    "MLM_RELEASE_APP_ID: ${{ vars.MLM_RELEASE_APP_ID }}",
    "MLM_RELEASE_APP_INSTALLATION_ID: ${{ vars.MLM_RELEASE_APP_INSTALLATION_ID }}",
    "MLM_RELEASE_APP_PRIVATE_KEY: ${{ secrets.MLM_RELEASE_APP_PRIVATE_KEY }}",
    "MLM_RELEASE_APP_SLUG: ${{ vars.MLM_RELEASE_APP_SLUG }}",
    "GH_TOKEN: ${{ github.token }}",
    "PROMOTION_EXPECTED_MODE: advanced",
    "release-provider-outcome.mjs promote",
    "Revalidate authority after production-ref mutation",
    "confirm_existing_production_ref:",
    "if: needs.provider_baseline.outputs.advance_required == 'false'",
    "PROMOTION_EXPECTED_MODE: already-exact",
    "select_promotion:",
    "Bind exactly one promotion path",
    "provider_outcome:",
    "deployments: read",
    "timeout-minutes: 20",
    "release-provider-outcome.mjs wait",
  ] as const) {
    expect(workflow).toContain(required);
  }

  expect(workflow).not.toContain('tags:\n      - "v*"');
  expect(workflow.match(/^\s+contents: write$/gmu)).toBeNull();
  expect(workflow).not.toContain("--method POST");
  expect(workflow).not.toContain("/releases\"");
  expect(workflow).not.toContain("Integration `15368`");
  expect(workflow).not.toContain("actions/create-github-app-token");
  expect(appTokenHelper).toContain("repository_ids");
  expect(appTokenHelper).toContain("MESSAGE_LIKE_ME_REPOSITORY_ID = 1_342_143_606");
  expect(appTokenHelper).toContain("/app/installations/${String(input.installationId)}");
  expect(appTokenHelper).toContain('method: "DELETE"');
  expect(appTokenHelper).toContain("/installation/token");
  expect(providerHelper).toContain('key.startsWith("MLM_RELEASE_APP_")');
  expect(workflow.match(/release-provider-outcome\.mjs revalidate-authority/gu)?.length).toBe(6);

  const promotion = workflow.indexOf("release-provider-outcome.mjs promote");
  const terminalAuthority = workflow.indexOf("Revalidate authority after production-ref mutation");
  expect(promotion).toBeGreaterThan(0);
  expect(terminalAuthority).toBeGreaterThan(promotion);

  const existingStart = workflow.indexOf("\n  confirm_existing_production_ref:\n");
  const selectStart = workflow.indexOf("\n  select_promotion:\n");
  const existingJob = workflow.slice(existingStart, selectStart);
  expect(existingJob).not.toContain("environment:");
  expect(existingJob).not.toContain("MLM_RELEASE_APP_");
});

test("workflow changes have one explicit code owner", async () => {
  const value = await readFile(CODEOWNERS, "utf8");
  expect(value).toBe(
    "/.github/workflows/** @0thernet\n" +
    "/.github/CODEOWNERS @0thernet\n" +
    "/scripts/release-* @0thernet\n" +
    "/docs/publishing.md @0thernet\n",
  );
});

test("repository guides describe the separate release and production writers", async () => {
  const [rootGuide, siteGuide] = await Promise.all([
    readFile(ROOT_GUIDE, "utf8"),
    readFile(SITE_GUIDE, "utf8"),
  ]);
  expect(rootGuide).toContain("separate current-`main` promotion workflow");
  expect(rootGuide).toContain("Already-exact recovery must not\n  enter the key environment");
  expect(siteGuide).toContain("dedicated\n  current-`main` production workflow is the sole routine writer");
  expect(siteGuide).toContain("Already-exact recovery stays read-only and outside the\n  key environment");
  expect(siteGuide).not.toContain("Release\n  workflow is the sole routine writer");
});

test("publishing documents the exact App, environment, canary, and ref controls", async () => {
  const guide = await readFile(PUBLISHING_GUIDE, "utf8");

  for (const required of [
    "167738fcc40e523d2696e2ff2bdbe29d502ba7df",
    "`refs/heads/website-production` is absent",
    "repository ruleset inventory is exactly empty",
    "prj_K7VHB2ELASGF1OxTCxG8bfxOEoQJ",
    "`link.productionBranch=main`",
    "`READY` and\n  `PROMOTED`",
    "appgprj_6a88baf1c6388191af90b2e1d7b846ee",
    "do not create a replacement Sites project",
    "Create the missing `website-production` ref once",
    "Require `link.productionBranch` to equal",
    "production-ref-writer-key",
    "environment: { name: production-ref-writer-key, deployment: false }",
    "MLM_RELEASE_APP_PRIVATE_KEY",
    "MLM_RELEASE_APP_CLIENT_ID",
    "MLM_RELEASE_APP_ID",
    "MLM_RELEASE_APP_INSTALLATION_ID",
    "MLM_RELEASE_APP_SLUG",
    "MLM_RELEASE_WORKFLOW_ID",
    "exactly `contents:write` plus `metadata:read`",
    "{hraness/message-like-me}",
    "actor type\n     `Integration`",
    "GitHub Actions Integration\n     `15368`",
    "one `always` bypass",
    "`update_allows_fetch_and_merge=false`",
    "requiring pull requests",
    "code-owner",
    "precreate persistent ref",
    "website-production-writer-canary",
    "--force-with-lease",
    "GIT_ASKPASS",
    "stale\n   lease fails without mutation",
    "completed\n`workflow_run`",
    "first attempt",
    "result `bypass`",
    "failed evaluation",
    "do not attempt deletion",
    "repository ID `1342143606`",
    "repository_ids: [1342143606]",
    "DELETE /installation/token",
    "skips the\nentire `production-ref-writer-key` job, and mints no App token",
    "a later `main` push creates no Vercel Production deployment",
    "product pull request must not change\n`.github/workflows/`, `.github/CODEOWNERS`",
    "No personal access token, deploy key, Vercel token",
    "The tag workflow has no environment, App credential",
    "A tag cannot enter\n`production-ref-writer-key`",
    "Recovery uses the same `Promote website production` workflow dispatch",
    "It never creates, replaces, or edits a\nGitHub Release",
    "Do not retag",
  ] as const) {
    expect(guide).toContain(required);
  }
});
