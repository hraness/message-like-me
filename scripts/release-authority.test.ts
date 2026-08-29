import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { revalidateReleaseAuthority } from "./release-provider-outcome.mjs";

const repository = "hraness/message-like-me";
const tag = "v0.8.0";
const tagResolutionFixture = JSON.parse(readFileSync(
  new URL("./fixtures/github-v0.8.0-tag-resolution.json", import.meta.url),
  "utf8",
)) as Readonly<{
  resolvedCommit: Readonly<Record<string, unknown> & { sha: string }>;
  resolvedCommitEndpoint: string;
  tag: string;
  tagRef: Readonly<Record<string, unknown>>;
}>;
const sha = tagResolutionFixture.resolvedCommit.sha;

type ApiValue = unknown | readonly unknown[];

function apiFrom(entries: Readonly<Record<string, ApiValue>>) {
  const offsets = new Map<string, number>();
  const calls: string[] = [];
  return Object.freeze({
    calls,
    api: {
      get: async (endpoint: string): Promise<unknown> => {
        calls.push(endpoint);
        const entry = entries[endpoint];
        if (entry === undefined) throw new Error(`unexpected endpoint ${endpoint}`);
        if (!Array.isArray(entry)) return entry;
        const offset = offsets.get(endpoint) ?? 0;
        const value = entry[offset];
        if (value === undefined) throw new Error(`exhausted endpoint ${endpoint}`);
        offsets.set(endpoint, offset + 1);
        return value;
      },
    },
  });
}

function ref(branch: string, commit: string) {
  return { object: { sha: commit, type: "commit" }, ref: `refs/heads/${branch}` };
}

function release(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    assets: [],
    draft: false,
    id: 123,
    immutable: true,
    prerelease: false,
    published_at: "2026-08-29T20:00:00Z",
    tag_name: tag,
    target_commitish: sha,
    ...overrides,
  };
}

function authorityApi(overrides: Readonly<Record<string, ApiValue>> = {}) {
  return apiFrom({
    [`/repos/${repository}`]: [{ default_branch: "main" }, { default_branch: "main" },
      { default_branch: "main" }, { default_branch: "main" }],
    [`/repos/${repository}/git/ref/heads/main`]: [ref("main", sha), ref("main", sha)],
    [tagResolutionFixture.resolvedCommitEndpoint]: [
      tagResolutionFixture.resolvedCommit,
      tagResolutionFixture.resolvedCommit,
    ],
    [`/repos/${repository}/releases/tags/${tag}`]: [release(), release()],
    [`/repos/${repository}/releases/latest`]: [{ tag_name: tag }, { tag_name: tag }],
    ...overrides,
  });
}

function verify(api: ReturnType<typeof authorityApi>["api"], input = {}) {
  return revalidateReleaseAuthority({
    api,
    defaultBranch: "main",
    eventName: "workflow_dispatch",
    recoveryWorkflowSha: sha,
    repository,
    verifiedSha: sha,
    verifiedTag: tag,
    ...input,
  });
}

describe("promotion authority revalidation", () => {
  test("sandwiches exact main, tag, immutable release, and Latest reads", async () => {
    const fixture = authorityApi();
    await verify(fixture.api);

    expect(fixture.calls).toEqual([
      `/repos/${repository}`,
      `/repos/${repository}/git/ref/heads/main`,
      `/repos/${repository}`,
      tagResolutionFixture.resolvedCommitEndpoint,
      `/repos/${repository}/releases/tags/${tag}`,
      `/repos/${repository}/releases/latest`,
      `/repos/${repository}`,
      `/repos/${repository}/git/ref/heads/main`,
      `/repos/${repository}`,
      tagResolutionFixture.resolvedCommitEndpoint,
      `/repos/${repository}/releases/tags/${tag}`,
      `/repos/${repository}/releases/latest`,
    ]);
  });

  test("requires a dispatch whose exact current main is the release commit", async () => {
    const fixture = authorityApi();
    await expect(verify(fixture.api, { eventName: "push" })).rejects.toThrow(
      "must be an exact current-main release workflow",
    );
    await expect(verify(fixture.api, { recoveryWorkflowSha: "2".repeat(40) })).rejects.toThrow(
      "must be an exact current-main release workflow",
    );
    expect(fixture.calls).toEqual([]);

    const moved = authorityApi({
      [`/repos/${repository}/git/ref/heads/main`]: [ref("main", "2".repeat(40))],
    });
    await expect(verify(moved.api)).rejects.toThrow("no longer current main");
  });

  test("rejects moved tags, mutable or asset-bearing releases, and a non-Latest tag", async () => {
    const movedTag = authorityApi({
      [tagResolutionFixture.resolvedCommitEndpoint]: [{
        ...tagResolutionFixture.resolvedCommit,
        sha: "2".repeat(40),
      }],
    });
    await expect(verify(movedTag.api)).rejects.toThrow("moved from the verified release commit");

    const assets = authorityApi({
      [`/repos/${repository}/releases/tags/${tag}`]: [release({ assets: [{ id: 1 }] })],
    });
    await expect(verify(assets.api)).rejects.toThrow("not exact, published, immutable, and asset-free");

    const latest = authorityApi({
      [`/repos/${repository}/releases/latest`]: [{ tag_name: "v0.7.0" }],
    });
    await expect(verify(latest.api)).rejects.toThrow("Latest Release is not v0.8.0");
  });

  test("rejects a changed or indirectly targeted release on the terminal readback", async () => {
    const indirect = authorityApi({
      [`/repos/${repository}/releases/tags/${tag}`]: [release({ target_commitish: "main" })],
    });
    await expect(verify(indirect.api)).rejects.toThrow("target_commitish is not the verified release commit");

    const changed = authorityApi({
      [`/repos/${repository}/releases/tags/${tag}`]: [
        release(),
        release({ id: 124 }),
      ],
    });
    await expect(verify(changed.api)).rejects.toThrow("changed during authority verification");
  });
});
