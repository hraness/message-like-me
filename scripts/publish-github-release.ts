import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import {
  assertReleaseAssetBytes,
  parseGitHubRelease,
  publicRepository,
  releaseArchiveName,
} from "./release-distribution-policy";
import { parseGitHubIncludedJsonResponse } from "./release-included-response";
import { publicReleaseEnvironment } from "./release-process-environment";

const [tagArgument, tarballArgument, checksumArgument] = process.argv.slice(2);
if (tagArgument === undefined || tarballArgument === undefined || checksumArgument === undefined) {
  throw new Error("Usage: publish-github-release.ts TAG ARTIFACT.tgz SHA256SUMS");
}
if (process.env.GITHUB_REPOSITORY !== publicRepository) {
  throw new Error(`GitHub Release publication must run in ${publicRepository}.`);
}
const verifiedSha = process.env.VERIFIED_SHA;
if (verifiedSha === undefined || !/^[0-9a-f]{40}$/u.test(verifiedSha)) {
  throw new Error("GitHub Release publication requires one verified release commit.");
}
const defaultBranch = process.env.DEFAULT_BRANCH;
if (defaultBranch === undefined || !/^[A-Za-z0-9._/-]+$/u.test(defaultBranch)) {
  throw new Error("GitHub Release publication requires one verified default branch.");
}

const manifest = JSON.parse(readFileSync(resolve(import.meta.dir, "..", "package.json"), "utf8")) as Readonly<{
  name?: unknown;
  version?: unknown;
}>;
if (manifest.name !== "@hraness/message-like-me" || typeof manifest.version !== "string") {
  throw new Error("The public package manifest identity is invalid.");
}
const expectedTag = `v${manifest.version}`;
if (tagArgument !== expectedTag) throw new Error(`Release tag must be ${expectedTag}.`);
const releaseTag = tagArgument;
const releaseVersion = manifest.version;

const tarball = resolve(tarballArgument);
const checksum = resolve(checksumArgument);
if (basename(tarball) !== releaseArchiveName(manifest.version) || basename(checksum) !== "SHA256SUMS") {
  throw new Error("Release artifact names do not match the public package coordinate.");
}
const tarballBytes = readFileSync(tarball);
const checksumBytes = readFileSync(checksum);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const expectedTitle = `Message Like Me ${tagArgument}`;
const expectedBody =
  `Automated public release of @hraness/message-like-me@${manifest.version} from ${tagArgument}.`;

async function readBoundedCommandOutput(
  stream: ReadableStream<Uint8Array>,
  kill: () => void,
): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.byteLength;
      if (length > 32 * 1_024 * 1_024) {
        kill();
        throw new Error("GitHub release command output exceeded its bound.");
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length);
}

async function run(command: string[], allowFailure = false) {
  const token = process.env.GH_TOKEN;
  if (token === undefined || token.length === 0) {
    throw new Error("GitHub Release publication requires one GitHub token.");
  }
  const environment = publicReleaseEnvironment({
    GH_PROMPT_DISABLED: "1",
    GH_TOKEN: token,
    NO_COLOR: "1",
  });
  const child = Bun.spawn(command, { env: environment, stdout: "pipe", stderr: "pipe" });
  const kill = () => child.kill(9);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    kill();
  }, 120_000);
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      readBoundedCommandOutput(child.stdout, kill),
      readBoundedCommandOutput(child.stderr, kill),
    ]);
    if (timedOut) throw new Error(`GitHub ${command[1] ?? "command"} timed out.`);
    if (exitCode !== 0 && !allowFailure) {
      const diagnosticState = stderr.byteLength === 0
        ? "without diagnostic output"
        : "with redacted diagnostic output";
      throw new Error(`GitHub ${command[1] ?? "command"} failed ${diagnosticState}.`);
    }
    return Object.freeze({ exitCode, stderr, stdout });
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(command: string[]): Promise<Readonly<Record<string, unknown>>> {
  const value = JSON.parse((await run(command)).stdout.toString()) as unknown;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Command did not return one JSON object: ${command.join(" ")}`);
  }
  return value as Readonly<Record<string, unknown>>;
}

async function readJsonValue(command: string[]): Promise<unknown> {
  return JSON.parse((await run(command)).stdout.toString()) as unknown;
}

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be one JSON object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

async function verifyRemoteAnnotatedTag(): Promise<void> {
  const tagRef = await readJson([
    "gh", "api", `/repos/${publicRepository}/git/ref/tags/${tagArgument}`,
  ]);
  const tagObject = record(tagRef.object, `Remote release ref ${tagArgument} object`);
  if (
    tagRef.ref !== `refs/tags/${tagArgument}`
    || tagObject.type !== "tag"
    || typeof tagObject.sha !== "string"
    || !/^[0-9a-f]{40}$/u.test(tagObject.sha)
  ) throw new Error(`Remote release ref ${tagArgument} is not one annotated tag object.`);
  const annotated = await readJson([
    "gh", "api", `/repos/${publicRepository}/git/tags/${tagObject.sha}`,
  ]);
  const target = record(annotated.object, `Remote annotated tag ${tagArgument} target`);
  if (
    annotated.tag !== tagArgument
    || target.type !== "commit"
    || target.sha !== verifiedSha
  ) throw new Error(`Remote annotated tag ${tagArgument} does not target ${verifiedSha}.`);
  const head = await readJson([
    "gh", "api", `/repos/${publicRepository}/git/ref/heads/${defaultBranch}`,
  ]);
  const headObject = record(head.object, `Remote ${defaultBranch} ref object`);
  if (
    head.ref !== `refs/heads/${defaultBranch}`
    || headObject.type !== "commit"
    || typeof headObject.sha !== "string"
    || !/^[0-9a-f]{40}$/u.test(headObject.sha)
  ) throw new Error(`Remote ${defaultBranch} ref is invalid.`);
  const comparison = await readJson([
    "gh", "api", `/repos/${publicRepository}/compare/${verifiedSha}...${defaultBranch}`,
  ]);
  const base = record(comparison.base_commit, "Reviewed-main comparison base");
  const mergeBase = record(comparison.merge_base_commit, "Reviewed-main merge base");
  const comparisonHead = record(comparison.head_commit, "Reviewed-main comparison head");
  if (
    !["ahead", "identical"].includes(String(comparison.status))
    || base.sha !== verifiedSha
    || mergeBase.sha !== verifiedSha
    || comparisonHead.sha !== headObject.sha
  ) throw new Error(`Reviewed release commit is not an ancestor of current ${defaultBranch}.`);
}

async function readRelease(): Promise<unknown> {
  return JSON.parse((await run([
    "gh", "api", `/repos/${publicRepository}/releases/tags/${tagArgument}`,
  ])).stdout.toString()) as unknown;
}

type ExactDraft = Readonly<{
  assets: readonly Readonly<Record<string, unknown>>[];
  id: number;
}>;

function exactDraft(value: unknown): ExactDraft {
  const draft = record(value, `Residual GitHub Release draft ${tagArgument}`);
  if (
    draft.tag_name !== tagArgument
    || draft.name !== expectedTitle
    || draft.body !== expectedBody
    || draft.draft !== true
    || draft.prerelease !== false
    || !Number.isSafeInteger(draft.id)
    || Number(draft.id) <= 0
    || !Array.isArray(draft.assets)
    || draft.assets.length > 2
  ) throw new Error(`Residual draft for ${tagArgument} does not match the exact recoverable release.`);
  const assets = draft.assets.map((asset) => record(asset, "Residual draft asset"));
  const names = new Set(assets.map((asset) => asset.name));
  if (
    names.size !== assets.length
    || [...names].some((name) => name !== basename(tarball) && name !== basename(checksum))
  ) throw new Error(`Residual draft for ${tagArgument} contains ambiguous assets.`);
  return Object.freeze({ assets: Object.freeze(assets), id: Number(draft.id) });
}

async function findDraft(): Promise<ExactDraft | null> {
  const inventory = await readJsonValue([
    "gh", "api", `/repos/${publicRepository}/releases?per_page=100&page=1`,
  ]);
  if (!Array.isArray(inventory) || inventory.length >= 100) {
    throw new Error("GitHub Release draft inventory is malformed or incomplete.");
  }
  const matches = inventory.filter((item) => {
    const candidate = record(item, "GitHub Release inventory item");
    return candidate.draft === true && candidate.tag_name === tagArgument;
  });
  if (matches.length > 1) throw new Error(`Multiple residual drafts exist for ${tagArgument}.`);
  return matches.length === 0 ? null : exactDraft(matches[0]);
}

async function verifyDraftAssets(draft: ExactDraft): Promise<readonly string[]> {
  const missing: string[] = [];
  for (const source of [tarball, checksum]) {
    const expectedName = basename(source);
    const asset = draft.assets.find((candidate) => candidate.name === expectedName);
    if (asset === undefined) {
      missing.push(source);
      continue;
    }
    if (
      asset.state !== "uploaded"
      || !Number.isSafeInteger(asset.id)
      || Number(asset.id) <= 0
      || asset.size !== readFileSync(source).byteLength
      || asset.digest !== `sha256:${sha256(readFileSync(source))}`
    ) throw new Error(`Residual draft asset ${expectedName} has different immutable metadata.`);
    const downloaded = await run([
      "gh", "api",
      "-H", "Accept: application/octet-stream",
      `/repos/${publicRepository}/releases/assets/${String(asset.id)}`,
    ]);
    if (!downloaded.stdout.equals(readFileSync(source))) {
      throw new Error(`Residual draft asset ${expectedName} has different bytes.`);
    }
  }
  return Object.freeze(missing);
}

async function verifyPublishedRelease(): Promise<void> {
  let lastError: unknown;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const coordinate = parseGitHubRelease(await readRelease(), releaseVersion);
      assertReleaseAssetBytes(coordinate, tarballBytes, checksumBytes, sha256);
      const directory = mkdtempSync(join(tmpdir(), "message-like-me-release-assets-"));
      try {
        await run([
          "gh", "release", "download", releaseTag,
          "--repo", publicRepository,
          "--dir", directory,
          "--pattern", basename(tarball),
          "--pattern", basename(checksum),
        ]);
        for (const source of [tarball, checksum]) {
          if (!readFileSync(source).equals(readFileSync(join(directory, basename(source))))) {
            throw new Error(`GitHub Release ${tagArgument} contains different ${basename(source)} bytes.`);
          }
        }
      } finally {
        rmSync(directory, { force: true, recursive: true });
      }
      return;
    } catch (error) {
      lastError = error;
      await Bun.sleep(3_000);
    }
  }
  const detail = lastError instanceof Error ? ` ${lastError.message}` : "";
  throw new Error(`GitHub Release ${tagArgument} did not become exact and immutable.${detail}`);
}

await verifyRemoteAnnotatedTag();

const existing = await run([
  "gh", "api", "--include", `/repos/${publicRepository}/releases/tags/${tagArgument}`,
], true);
const existingResponse = parseGitHubIncludedJsonResponse(existing.stdout);
if (existing.exitCode === 0 && existingResponse.status === 200) {
  if (existingResponse.body.draft === true) {
    const draft = exactDraft(existingResponse.body);
    const missing = await verifyDraftAssets(draft);
    if (missing.length > 0) await run([
      "gh", "release", "upload", tagArgument, ...missing, "--repo", publicRepository,
    ]);
    const completeDraft = await findDraft();
    if (completeDraft === null || (await verifyDraftAssets(completeDraft)).length !== 0) {
      throw new Error(`Residual draft ${tagArgument} could not be completed exactly.`);
    }
    await run([
      "gh", "api", "--method", "PATCH",
      `/repos/${publicRepository}/releases/${String(completeDraft.id)}`,
      "-F", "draft=false", "-f", "make_latest=true",
    ]);
    await verifyPublishedRelease();
    console.log(`Completed exact residual GitHub Release draft ${tagArgument}.`);
  } else {
    await verifyPublishedRelease();
    console.log(`GitHub Release ${tagArgument} already contains the exact verified artifacts.`);
  }
} else {
  if (
    existing.exitCode === 0
    || existingResponse.status !== 404
    || existingResponse.body.message !== "Not Found"
    || existingResponse.body.status !== "404"
  ) {
    const diagnosticState = existing.stderr.byteLength === 0
      ? "without diagnostic output"
      : "with redacted diagnostic output";
    throw new Error(
      `Could not determine whether GitHub Release ${tagArgument} exists ${diagnosticState}.`,
    );
  }
  let draft = await findDraft();
  if (draft === null) {
    await run([
      "gh", "release", "create", tagArgument,
      "--draft",
      "--notes", expectedBody,
      "--repo", publicRepository,
      "--title", expectedTitle,
      "--verify-tag",
    ]);
    draft = await findDraft();
    if (draft === null) throw new Error(`GitHub did not create the exact draft for ${tagArgument}.`);
  }
  const missing = await verifyDraftAssets(draft);
  if (missing.length > 0) await run([
    "gh", "release", "upload", tagArgument, ...missing, "--repo", publicRepository,
  ]);
  const completeDraft = await findDraft();
  if (completeDraft === null || (await verifyDraftAssets(completeDraft)).length !== 0) {
    throw new Error(`GitHub Release draft ${tagArgument} did not acquire the exact artifacts.`);
  }
  await run([
    "gh", "api", "--method", "PATCH",
    `/repos/${publicRepository}/releases/${String(completeDraft.id)}`,
    "-F", "draft=false", "-f", "make_latest=true",
  ]);
  await verifyPublishedRelease();
  console.log(`Created immutable GitHub Release ${tagArgument} from the exact verified artifacts.`);
}

const latest = JSON.parse((await run([
  "gh", "api", `/repos/${publicRepository}/releases/latest`,
])).stdout.toString()) as Readonly<{ tag_name?: unknown }>;
if (latest.tag_name !== tagArgument) throw new Error(`Latest GitHub Release is not ${tagArgument}.`);
await verifyRemoteAnnotatedTag();
