import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const WORKFLOWS = join(import.meta.dir, "..", ".github", "workflows");

test("CI runs the standalone package on Ubuntu and only synthetic iMessage fixtures on macOS", async () => {
  const workflow = await readFile(join(WORKFLOWS, "ci.yml"), "utf8");

  expect(workflow).toContain("runs-on: ubuntu-24.04");
  expect(workflow).toContain("runs-on: macos-15");
  expect(workflow.match(/bun-version: "1\.3\.14"/gu)?.length).toBe(2);
  expect(workflow).toContain("bun run check");
  expect(workflow).toContain("bun test src/imessage.test.ts src/metrics.test.ts");
  expect(workflow).toContain("HOME: ${{ runner.temp }}/message-like-me-fixture-home");
  expect(workflow).toContain("git status --porcelain --untracked-files=all -- dist bun.lock");
  expect(workflow).toContain("persist-credentials: false");
  expect(workflow).not.toContain("workflow_dispatch:");
  expect(workflow).not.toContain("Library/Messages/chat.db");
});

test("stable version tags pass an exact-main immutable release gate", async () => {
  const workflow = await readFile(join(WORKFLOWS, "release.yml"), "utf8");

  expect(workflow).toContain('tags:\n      - "v*"');
  expect(workflow).toContain("permissions:\n  contents: read");
  expect(workflow).toContain("group: stable-release");
  expect(workflow).toContain("cancel-in-progress: false");
  expect(workflow).toContain("fetch-depth: 0");
  expect(workflow).toContain("persist-credentials: false");
  expect(workflow).toContain('Tag $GITHUB_REF_NAME does not match package version $expected_tag');
  expect(workflow).toContain('tagged_commit="$(git rev-parse "$GITHUB_REF_NAME^{commit}")"');
  expect(workflow).toContain('git merge-base --is-ancestor "$GITHUB_SHA" origin/main');
  expect(workflow).toContain("verified_sha: ${{ steps.identity.outputs.sha }}");
  expect(workflow).toContain("VERIFIED_SHA: ${{ needs.verify.outputs.verified_sha }}");
  expect(workflow).toContain("newest_stable_tag=\"$(git tag --list");
  expect(workflow).toContain("bun run check");
  expect(workflow).toContain("bun pm pack --dry-run --ignore-scripts");
  expect(workflow).toContain("bun test src/imessage.test.ts src/metrics.test.ts");
  expect(workflow).toContain("needs: [verify, macos_fixtures]");
  expect(workflow).toContain("contents: write");
  expect(workflow).toContain('"/repos/$GITHUB_REPOSITORY/immutable-releases"');
  expect(workflow).toContain('X-GitHub-Api-Version: 2026-03-10');
  expect(workflow).toContain("Release immutability is not enabled; refusing to create a mutable release");
  expect(workflow).toContain('"/repos/$GITHUB_REPOSITORY/commits/$GITHUB_REF_NAME"');
  expect(workflow).toContain('[[ "$remote_tag_sha" != "$VERIFIED_SHA" ]]');
  expect(workflow).toContain('gh release create "$GITHUB_REF_NAME"');
  expect(workflow).toContain("--verify-tag");
  expect(workflow).toContain("--generate-notes");
  expect(workflow).toContain("--latest");
  expect(workflow).toContain("--json assets,isDraft,isImmutable,isPrerelease,tagName");
  expect(workflow).toContain("(.assets | length)");
  expect(workflow).toContain('"/repos/$GITHUB_REPOSITORY/releases/latest"');
  expect(workflow).not.toContain("pull_request:");
  expect(workflow).not.toContain("workflow_dispatch:");
  expect(workflow).not.toContain("npm publish");
  expect(workflow).not.toContain("messagelikeme.com");
  expect(workflow).not.toContain("homepage");
  expect(workflow).not.toContain("--clobber");
  const immutabilityPreflight = workflow.indexOf('"/repos/$GITHUB_REPOSITORY/immutable-releases"');
  const remoteTagCheck = workflow.indexOf('"/repos/$GITHUB_REPOSITORY/commits/$GITHUB_REF_NAME"');
  const releaseCreation = workflow.indexOf('gh release create "$GITHUB_REF_NAME"');
  expect(immutabilityPreflight).toBeGreaterThan(0);
  expect(remoteTagCheck).toBeGreaterThan(immutabilityPreflight);
  expect(releaseCreation).toBeGreaterThan(remoteTagCheck);
});
