import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const WORKFLOWS = join(import.meta.dir, "..", ".github", "workflows");
const PUBLISHING_GUIDE = join(import.meta.dir, "..", "docs", "publishing.md");

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

test("stable releases bind the exact current main source, immutable Release, and provider outcome", async () => {
  const workflow = await readFile(join(WORKFLOWS, "release.yml"), "utf8");

  for (const required of [
    'tags:\n      - "v*"',
    "workflow_dispatch:",
    "release_tag:",
    "permissions:\n  contents: read",
    "group: stable-release",
    "cancel-in-progress: false",
    "fetch-depth: 0",
    "persist-credentials: false",
    "ref: refs/tags/${{ steps.request.outputs.tag }}",
    "recovery_workflow_sha: ${{ steps.recovery_source.outputs.sha }}",
    'current_default_sha="$(gh api',
    "Release recovery workflow source $EVENT_SHA is not current $DEFAULT_BRANCH head",
    'site_version="$(bun -e',
    "Site version $site_version does not match package version $package_version",
    'tag_commit="$(git rev-parse --verify "refs/tags/$REQUESTED_TAG^{commit}")"',
    'head_commit="$(git rev-parse --verify "HEAD^{commit}")"',
    'git merge-base --is-ancestor "$tag_commit" "origin/$DEFAULT_BRANCH"',
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
    "provider_baseline:",
    "publish:",
    "provider_outcome:",
    "timeout-minutes: 20",
    "contents: write",
    "deployments: read",
    "release-provider-outcome.mjs baseline",
    "release-provider-outcome.mjs promote",
    "release-provider-outcome.mjs wait",
    "Release recovery requires an existing immutable Latest release",
    "-F generate_release_notes=true",
    "-f make_latest=true",
    '-f name="Message Like Me $VERIFIED_TAG"',
    "-f target_commitish=\"$VERIFIED_SHA\"",
  ] as const) {
    expect(workflow).toContain(required);
  }

  expect(workflow).not.toContain("pull_request:");
  expect(workflow).not.toContain("npm publish");
  expect(workflow).not.toContain("VERCEL_TOKEN");
  expect(workflow).not.toContain("--clobber");
  expect(workflow.match(/contents: write/gu)).toHaveLength(1);

  const releaseCreation = workflow.indexOf('"/repos/$GITHUB_REPOSITORY/releases"');
  const releaseReadback = workflow.indexOf('release_readback="$(gh api "$release_endpoint")"');
  const promotion = workflow.indexOf("release-provider-outcome.mjs promote");
  expect(releaseCreation).toBeGreaterThan(0);
  expect(releaseReadback).toBeGreaterThan(releaseCreation);
  expect(promotion).toBeGreaterThan(releaseReadback);

  const recoveryGuard = workflow.indexOf('if [[ "$EVENT_NAME" != "push" ]]');
  expect(recoveryGuard).toBeGreaterThan(0);
  expect(recoveryGuard).toBeLessThan(releaseCreation);
});

test("publishing documents the exact one-time provider and ref controls", async () => {
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
    "Integration `15368`",
    "`update_allows_fetch_and_merge=false`",
    "requiring pull requests",
    "a later `main` push creates no Vercel Production deployment",
    "product pull request must not change\n`.github/workflows/`",
    "does not require a personal access token, a Vercel\ntoken",
    "Recovery never creates\nor replaces a GitHub Release",
    "Do not retag",
  ] as const) {
    expect(guide).toContain(required);
  }
});
