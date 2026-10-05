import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { chooseNpmWriterTransition } from "./publish-npm-release";

const WORKFLOWS = join(import.meta.dir, "..", ".github", "workflows");
const CODEOWNERS = join(import.meta.dir, "..", ".github", "CODEOWNERS");
const NPM_PUBLISHER = join(import.meta.dir, "publish-npm-release.ts");
const NPM_PROVENANCE = join(import.meta.dir, "npm-provenance-verification.ts");
const NPM_RETRY = join(import.meta.dir, "check-npm-retry-state.ts");
const PUBLIC_ADMISSION = join(import.meta.dir, "check-public-release.ts");
const GITHUB_ADMISSION = join(import.meta.dir, "check-github-release.ts");
const GITHUB_PUBLISHER = join(import.meta.dir, "publish-github-release.ts");
const REF_AUTHORITY = join(import.meta.dir, "release-ref-authority.ts");
const SIGNER_VERIFIER = join(import.meta.dir, "verify-npm-provenance-signer.mjs");
const PACKAGE_MANIFEST = join(import.meta.dir, "..", "package.json");

test("CI runs the standalone package on Ubuntu and only synthetic local-data fixtures on macOS", async () => {
  const [workflow, packageManifest] = await Promise.all([
    readFile(join(WORKFLOWS, "ci.yml"), "utf8"),
    readFile(PACKAGE_MANIFEST, "utf8"),
  ]);

  expect(workflow).toContain("runs-on: ubuntu-24.04");
  expect(workflow).toContain("runs-on: macos-15");
  const bunInstalls = workflow.match(/uses: oven-sh\/setup-bun@/gu)?.length ?? 0;
  expect(bunInstalls).toBeGreaterThanOrEqual(2);
  expect(workflow.match(/bun-version: "1\.3\.14"/gu)?.length).toBe(bunInstalls);
  expect(workflow).toContain("bun run check");
  // The complete gate is split across parallel Linux jobs; every command of `bun run check`
  // must still run somewhere in the workflow.
  const checkScript = (JSON.parse(packageManifest) as { scripts: Record<string, string> }).scripts.check;
  if (checkScript === undefined) throw new Error("package.json has no check script");
  const scripts = (JSON.parse(packageManifest) as { scripts: Record<string, string> }).scripts;
  for (const command of checkScript.split(" && ")) {
    if (command === "bun run check:textbutler") {
      // CI runs the same package gate as balanced parallel lanes. package.json stays
      // byte-identical (it is a digest-bound XCB admission source), so pin the serial
      // script the lane runner reproduces (scripts/check-textbutler.test.ts proves coverage).
      expect(scripts["check:textbutler"]).toBe("bun test packages && tsc --noEmit -p packages/transport/tsconfig.json && tsc --noEmit -p packages/textbutler/tsconfig.json");
      expect(workflow).toContain("- run: bun scripts/check-textbutler.ts\n");
      continue;
    }
    expect(workflow).toContain(command);
  }
  expect(workflow).toContain("name: Required");
  expect(workflow).toContain("bun test src/imessage.test.ts src/contacts.test.ts src/metrics.test.ts");
  expect(workflow).toContain("HOME: ${{ runner.temp }}/message-like-me-fixture-home");
  expect(workflow).toContain("git status --porcelain --untracked-files=all -- dist bun.lock");
  expect(workflow).toContain("persist-credentials: false");
  expect(workflow).not.toContain("workflow_dispatch:");
  expect(workflow).not.toContain("Library/Messages/chat.db");
});

test("npm writer recovery admits only ordered, unambiguous rerun transitions", () => {
  expect(chooseNpmWriterTransition({
    currentAttempt: 1,
    preflightAttempt: 1,
    preflightState: "absent",
    releaseExists: false,
  })).toBe("publish");
  expect(chooseNpmWriterTransition({
    currentAttempt: 3,
    preflightAttempt: 1,
    preflightState: "absent",
    releaseExists: false,
  })).toBe("publish");
  expect(chooseNpmWriterTransition({
    currentAttempt: 2,
    preflightAttempt: 1,
    preflightState: "absent",
    releaseExists: true,
  })).toBe("observe_existing");
  expect(chooseNpmWriterTransition({
    currentAttempt: 3,
    preflightAttempt: 1,
    preflightState: "exact_same_run",
    releaseExists: true,
  })).toBe("observe_existing");
  expect(() => chooseNpmWriterTransition({
    currentAttempt: 1,
    preflightAttempt: 1,
    preflightState: "absent",
    releaseExists: true,
  })).toThrow("appeared during the admitted attempt");
  expect(() => chooseNpmWriterTransition({
    currentAttempt: 2,
    preflightAttempt: 3,
    preflightState: "absent",
    releaseExists: false,
  })).toThrow("ordered positive preflight and writer attempt");
  expect(() => chooseNpmWriterTransition({
    currentAttempt: 2,
    preflightAttempt: 1,
    preflightState: "exact_same_run",
    releaseExists: false,
  })).toThrow("disappeared after retry admission");
});

test("tag releases use annotated-tag authority and split exact GitHub-first and npm writers", async () => {
  const [
    workflow,
    npmPublisher,
    npmProvenance,
    npmRetry,
    publicAdmission,
    githubAdmission,
    githubPublisher,
    refAuthority,
    signerVerifier,
    packageManifest,
  ] = await Promise.all([
    readFile(join(WORKFLOWS, "release.yml"), "utf8"),
    readFile(NPM_PUBLISHER, "utf8"),
    readFile(NPM_PROVENANCE, "utf8"),
    readFile(NPM_RETRY, "utf8"),
    readFile(PUBLIC_ADMISSION, "utf8"),
    readFile(GITHUB_ADMISSION, "utf8"),
    readFile(GITHUB_PUBLISHER, "utf8"),
    readFile(REF_AUTHORITY, "utf8"),
    readFile(SIGNER_VERIFIER, "utf8"),
    readFile(PACKAGE_MANIFEST, "utf8"),
  ]);

  for (const required of [
    'tags:\n      - "v*"',
    "permissions:\n  contents: read",
    "group: stable-release",
    "cancel-in-progress: false",
    "fetch-depth: 1",
    "fetch-tags: false",
    "persist-credentials: false",
    "ref: refs/tags/${{ steps.request.outputs.tag }}",
    'node --experimental-strip-types ./scripts/release-ref-authority.ts release "$REQUESTED_TAG"',
    'site_version="$(bun -e',
    "Site version $site_version does not match package version $package_version",
    "bun run check",
    "working-directory: site",
    "bun run sync:readme",
    "bun run test",
    "bun run lint",
    "bun run build",
    "git diff --exit-code -- site/app/readme.generated.ts",
    "bun test src/imessage.test.ts src/contacts.test.ts src/metrics.test.ts",
    "npm pack --ignore-scripts --pack-destination artifacts .",
    "release-artifact-checksum.ts write artifacts/*.tgz artifacts/SHA256SUMS",
    "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    "id: release_artifact",
    "name: message-like-me-release-${{ github.run_attempt }}",
    "release_artifact_digest: ${{ steps.release_artifact.outputs.artifact-digest }}",
    "release_artifact_id: ${{ steps.release_artifact.outputs.artifact-id }}",
    "github_writer_artifact_digest: ${{ steps.github_writer_artifact.outputs.artifact-digest }}",
    "github_writer_artifact_id: ${{ steps.github_writer_artifact.outputs.artifact-id }}",
    "writer_artifact_digest: ${{ steps.writer_artifact.outputs.artifact-digest }}",
    "writer_artifact_id: ${{ steps.writer_artifact.outputs.artifact-id }}",
    "retention-days: 30",
    "Stage exact dependency-free release writers from reviewed source",
    'npm_writer_root="$(mktemp -d "$RUNNER_TEMP/message-like-me-npm-writer.XXXXXX")"',
    'github_writer_root="$(mktemp -d "$RUNNER_TEMP/message-like-me-github-writer.XXXXXX")"',
    "copy_regular_source",
    '[[ ! -f "$source" || -L "$source" ]]',
    "Release writer closure is not the exact regular-file allowlist",
    "path: ${{ steps.writer_roots.outputs.npm_path }}",
    "path: ${{ steps.writer_roots.outputs.github_path }}",
    "name: message-like-me-github-release-writer-${{ github.run_attempt }}",
    "artifact-ids: ${{ needs.verify.outputs.release_artifact_id }}",
    "merge-multiple: true",
    "Release artifact has no exact immutable identity",
    "exact_artifact:",
    "matrix:\n        os: [ubuntu-24.04, macos-15]",
    "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
    "release-artifact-checksum.ts check artifacts/*.tgz artifacts/SHA256SUMS",
    "package-smoke.ts artifacts/*.tgz",
    "publish_github:",
    "name: Publish immutable GitHub Release",
    "Download the reviewed GitHub Release writer by numeric artifact ID",
    "artifact-ids: ${{ needs.verify.outputs.github_writer_artifact_id }}",
    "pre_npm:",
    "name: Admit immutable GitHub bytes and npm retry state",
    "publish_npm:",
    "name: Publish exact npm package through OIDC only",
    "admit:",
    "name: Admit exact public npm and GitHub distributions",
    "contents: write",
    "id-token: write",
    "contents: none",
    "check-github-release.ts artifacts/*.tgz artifacts/SHA256SUMS",
    "check-npm-retry-state.ts artifacts/*.tgz",
    "preflight_run_id: ${{ steps.npm_state.outputs.preflight_run_id }}",
    "preflight_run_attempt: ${{ steps.npm_state.outputs.preflight_run_attempt }}",
    "PRE_NPM_RUN_ID: ${{ needs.pre_npm.outputs.preflight_run_id }}",
    "PRE_NPM_RUN_ATTEMPT: ${{ needs.pre_npm.outputs.preflight_run_attempt }}",
    "npm_completion: ${{ steps.npm_publish.outputs.npm_completion }}",
    "npm_completion_run_id: ${{ steps.npm_publish.outputs.npm_completion_run_id }}",
    "npm_completion_run_attempt: ${{ steps.npm_publish.outputs.npm_completion_run_attempt }}",
    "NPM_WRITER_RESULT: ${{ needs.publish_npm.outputs.npm_completion }}",
    'NPM_WRITER_RESULT_REQUIRED: "true"',
    "NPM_COMPLETION_RUN_ID: ${{ needs.publish_npm.outputs.npm_completion_run_id }}",
    "NPM_COMPLETION_RUN_ATTEMPT: ${{ needs.publish_npm.outputs.npm_completion_run_attempt }}",
    "PRE_NPM_STATE: ${{ needs.pre_npm.outputs.npm_state }}",
    "writer/scripts/publish-npm-release.ts artifacts/*.tgz",
    "github-release-writer/scripts/publish-github-release.ts \"$VERIFIED_TAG\" artifacts/*.tgz artifacts/SHA256SUMS",
    "Install the pinned Sigstore verifier",
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
  expect(workflow).not.toContain("VERCEL_TOKEN");
  expect(workflow).not.toContain("/commits/tags/");
  expect(workflow).not.toContain("--clobber");
  expect(workflow).not.toContain("fetch-depth: 0");
  expect(workflow).not.toContain("git fetch --force");
  expect(workflow).not.toContain("git tag --list");
  expect(workflow).not.toContain("mkdir -p release-writer");
  expect(workflow).not.toContain("mkdir -p github-release-writer");
  for (const source of [workflow, npmPublisher]) {
    expect(source).not.toMatch(/\bnpm\s+stage\b/iu);
    expect(source).not.toMatch(/\bstage\s+publish\b/iu);
  }
  expect(workflow.match(/fetch-depth: 1/gu)).toHaveLength(5);
  expect(workflow.match(/fetch-tags: false/gu)).toHaveLength(5);
  expect(workflow.match(/persist-credentials: false/gu)).toHaveLength(5);
  expect(workflow.match(/contents: write/gu)).toHaveLength(1);
  expect(workflow.match(/id-token: write/gu)).toHaveLength(1);
  expect(workflow.match(/name: message-like-me-release-\$\{\{ github\.run_attempt \}\}/gu)).toHaveLength(1);
  expect(workflow.match(/artifact-ids: \$\{\{ needs\.verify\.outputs\.release_artifact_id \}\}/gu)?.length).toBeGreaterThanOrEqual(4);
  const writerStageIndex = workflow.indexOf("Stage exact dependency-free release writers from reviewed source");
  expect(writerStageIndex).toBeGreaterThan(0);
  expect(writerStageIndex).toBeLessThan(workflow.indexOf("oven-sh/setup-bun"));
  expect(writerStageIndex).toBeLessThan(workflow.indexOf("Verify exact release identity"));
  expect(writerStageIndex).toBeLessThan(workflow.indexOf("bun install --frozen-lockfile"));
  const githubWriter = workflow.slice(
    workflow.indexOf("\n  publish_github:\n"),
    workflow.indexOf("\n  pre_npm:\n"),
  );
  const npmWriter = workflow.slice(
    workflow.indexOf("\n  publish_npm:\n"),
    workflow.indexOf("\n  admit:\n"),
  );
  const finalAdmission = workflow.slice(workflow.indexOf("\n  admit:\n"));
  expect(githubWriter).toContain("contents: write");
  expect(githubWriter).not.toContain("id-token: write");
  expect(githubWriter).not.toContain("actions/checkout");
  expect(githubWriter).not.toContain("bun install");
  expect(githubWriter).not.toContain("release-ref-authority.ts checkout");
  expect(githubWriter).not.toContain("    env:\n      GH_TOKEN:");
  expect(githubWriter).toContain(
    "Create and prove the immutable GitHub Release from exact bytes\n        env:\n          GH_TOKEN: ${{ github.token }}",
  );
  expect(githubPublisher).toContain('from "./release-distribution-policy.ts"');
  expect(githubPublisher).toContain('from "./release-included-response.ts"');
  expect(githubPublisher).toContain('from "./release-process-environment.ts"');
  expect(githubPublisher).toContain('from "./release-ref-authority.ts"');
  expect(githubPublisher).not.toMatch(/from "\.\/[^".]+"/u);
  expect(npmPublisher).toContain('from "./npm-release-policy.ts"');
  expect(npmPublisher).toContain('from "./release-distribution-policy.ts"');
  expect(npmPublisher).toContain('from "./release-process-environment.ts"');
  expect(npmPublisher).not.toMatch(/from "\.\/[^".]+"/u);
  expect(npmPublisher).toContain([
    '          "npm",',
    '          "publish",',
    "          tarball,",
    '          "--access",',
    '          "public",',
  ].join("\n"));
  expect(npmWriter).toContain("contents: none");
  expect(npmWriter).toContain("id-token: write");
  expect(npmWriter).not.toContain("actions/checkout");
  expect(npmWriter).not.toContain("bun install");
  expect(npmWriter).not.toContain("GH_TOKEN");
  expect(finalAdmission).not.toContain("PRE_NPM_STATE:");
  expect(finalAdmission).not.toContain("GITHUB_RUN_ATTEMPT");
  expect(finalAdmission).toContain("needs.publish_npm.outputs.npm_completion_run_attempt");
  expect(npmPublisher).toContain("registryLatestUrl");
  expect(npmPublisher).toContain("parseNpmRelease(latestPayload");
  expect(npmPublisher).toContain("expectedShasum");
  expect(npmPublisher).toContain("provenance-bearing npm latest");
  expect(npmPublisher).toContain('preNpmState !== "absent"');
  expect(npmPublisher).toContain('preNpmState !== "exact_same_run"');
  expect(npmPublisher).toContain("preNpmRunId !== runId");
  expect(npmPublisher).toContain('recordCompletion("observed_existing")');
  expect(npmPublisher).toContain('recordCompletion("published")');
  expect(npmPublisher).toContain("existing tarball differs from the reviewed workflow artifact");
  expect(npmPublisher).toContain("refusing an ambiguous same-attempt race");
  expect(npmPublisher).toContain("Date.now() + 180_000");
  expect(npmPublisher).toContain("}, 120_000)");
  expect(npmPublisher).not.toContain('runAttempt !== "1"');
  expect(npmPublisher).not.toContain("verifyNpmProvenance");
  expect(npmPublisher).not.toContain("process.stdout.write");
  expect(npmPublisher).not.toContain("process.stderr.write");
  expect(npmProvenance).toContain('"audit",\n      "signatures"');
  expect(npmProvenance).toContain("workflow.path !== coordinate.releasePackage.workflowPath");
  expect(npmProvenance).toContain("sourceDigest.gitCommit !== coordinate.verifiedSha");
  expect(npmProvenance).toContain("await verifyReleaseSigner(provenance.bundle");
  expect(npmProvenance).toContain("invocation: provenance.invocation");
  expect(npmProvenance).toContain("maximumAttempt");
  expect(npmProvenance).toContain("requiredAttempt");
  expect(npmProvenance).toContain("requiredRunId");
  expect(npmRetry).toContain("exact_same_run");
  expect(npmRetry).toContain("maximumAttempt");
  expect(npmRetry).toContain("requiredRunId");
  expect(publicAdmission).toContain("verifyNpmProvenance(npmTarball");
  expect(publicAdmission).toContain("EXPECTED_RELEASE_RUN_ID");
  expect(publicAdmission).toContain('npmWriterResult === "published"');
  expect(publicAdmission).toContain('npmWriterResult === "observed_existing"');
  expect(publicAdmission).toContain('npmWriterResultRequired === "true" && !writerConstraint');
  expect(publicAdmission).toContain("requiredAttempt: Number(npmCompletionRunAttempt)");
  expect(publicAdmission).toContain("maximumAttempt: Number(npmCompletionRunAttempt)");
  expect(githubAdmission).toContain("reviewed-main ancestry");
  for (const admission of [githubAdmission, publicAdmission]) {
    expect(admission).toContain("const maximumComparisonBytes = 8 * 1_024 * 1_024;");
    expect(admission).toMatch(
      /"GitHub reviewed-main ancestry",\n\s+(?:githubHeaders|headers),\n\s+maximumComparisonBytes,\n/u,
    );
  }
  expect(githubAdmission).toContain("releases/latest");
  expect(githubAdmission).toContain("GitHub Release bytes differ from the reviewed workflow artifact");
  expect(githubPublisher.match(/verifyRemoteAnnotatedTag\(\);/gu)).toHaveLength(2);
  expect(githubPublisher).toContain("/git/ref/tags/${tagArgument}");
  expect(githubPublisher).toContain("/git/tags/${tagObject.sha}");
  expect(githubPublisher).toContain("Bun.spawn(command");
  expect(githubPublisher).toContain("}, 120_000)");
  expect(githubPublisher).toContain("with redacted diagnostic output");
  expect(githubPublisher).toContain("parseGitHubIncludedJsonResponse(existing.stdout)");
  expect(githubPublisher).toContain('"--draft"');
  expect(githubPublisher).toContain("exactDraft");
  expect(githubPublisher).toContain("verifyDraftAssets");
  expect(githubPublisher).toContain("readDraftById");
  expect(githubPublisher).toContain(
    [
      '      "--input", source,',
      '      `https://uploads.github.com/repos/${publicRepository}/releases/${String(current.id)}/assets?name=${encodeURIComponent(basename(source))}`,',
      "    ]);",
      "    current = await readDraftById(draft.id);",
      "    await verifyDraftAssets(current);",
    ].join("\n"),
  );
  expect(githubPublisher).not.toContain('"gh", "release", "upload"');
  expect(githubPublisher).toContain('"-F", "draft=false"');
  expect(githubPublisher).not.toContain("--target");
  expect(githubPublisher).not.toContain("target_commitish");
  expect(githubPublisher).toContain("existingResponse.status !== 404");
  expect(githubPublisher).toContain('existingResponse.body.message !== "Not Found"');
  expect(githubPublisher).toContain('existingResponse.body.status !== "404"');
  for (const source of [githubPublisher, githubAdmission, publicAdmission]) {
    expect(source).not.toContain(".head_commit");
  }
  for (const required of [
    "https://github.com/hraness/textbutler.git",
    '["ls-remote", "--refs", REPOSITORY_URL, MAIN_REF]',
    '["ls-remote", "--refs", "--tags", REPOSITORY_URL, `refs/tags/${namespace}*`]',
    '`refs/tags/${namespace}*`',
    '`${MAIN_REF}:${LOCAL_MAIN_REF}`',
    '`${localTagRef}:${localTagRef}`',
    '"--no-tags"',
    '"--no-write-fetch-head"',
    '"--no-recurse-submodules"',
    '"--unshallow"',
    "MAXIMUM_SNAPSHOT_BYTES = 64 * 1_024",
    "MAXIMUM_SNAPSHOT_ROWS = 500",
    "parseGovernedRemoteSnapshot",
    "Combined governed remote ref inventory exceeds its byte bound",
    "Combined governed remote ref inventory exceeds its row bound",
    'input.mode === "release" ? [localTagRef] : []',
    "[LOCAL_MAIN_REF, localTagRef]",
    "Remote release-ref inventory changed during verification",
  ] as const) expect(refAuthority).toContain(required);
  for (const forbidden of [
    '"fetch", "--tags"',
    '"fetch", "--force"',
    '"tag", "--list"',
    '"--refmap"',
    "refs/message-like-me-release-authority",
  ] as const) expect(refAuthority).not.toContain(forbidden);
  expect(githubPublisher).not.toContain("spawnSync");
  expect(githubPublisher).not.toContain("exists.\\n${failure}");
  expect(signerVerifier).toContain('certificateIssuer: GITHUB_OIDC_ISSUER');
  expect(signerVerifier).toContain('certificateIdentityURI: `^${escapeRegularExpression(identity)}$`');
  expect(signerVerifier).toContain("certificateOIDs: Object.freeze");
  expect(signerVerifier).toContain("tufForceCache: true");
  expect(signerVerifier).toContain("ctLogThreshold: 1");
  expect(signerVerifier).toContain("tlogThreshold: 1");
  expect(JSON.parse(packageManifest).devDependencies.sigstore).toBe("4.1.1");

  const npmPublish = workflow.indexOf("publish-npm-release.ts artifacts/*.tgz");
  const githubPublish = workflow.indexOf(
    'publish-github-release.ts "$VERIFIED_TAG" artifacts/*.tgz artifacts/SHA256SUMS',
  );
  expect(githubPublish).toBeGreaterThan(0);
  expect(npmPublish).toBeGreaterThan(githubPublish);
});



test("workflow changes have one explicit code owner", async () => {
  const value = await readFile(CODEOWNERS, "utf8");
  expect(value).toBe(
    "/.github/workflows/** @0thernet\n" +
    "/.github/CODEOWNERS @0thernet\n" +
    "/scripts/check-github-release.ts @0thernet\n" +
    "/scripts/check-npm-retry-state.ts @0thernet\n" +
    "/scripts/check-npm-trusted-publishing.ts @0thernet\n" +
    "/scripts/check-public-release.ts @0thernet\n" +
    "/scripts/npm-provenance-* @0thernet\n" +
    "/scripts/verify-npm-provenance-* @0thernet\n" +
    "/scripts/npm-release-policy* @0thernet\n" +
    "/scripts/package-smoke* @0thernet\n" +
    "/scripts/publish-* @0thernet\n" +
    "/scripts/release-* @0thernet\n" +
    "/docs/publishing.md @0thernet\n" +
    "/package.json @0thernet\n" +
    "/bun.lock @0thernet\n",
  );
});


