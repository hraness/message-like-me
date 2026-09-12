import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Script } from "node:vm";
import { ARCHIVE, sha256, TAG } from "./common.ts";
import { admitDesktopArtifact, authorizeDesktop, environmentAuthority, REPOSITORY, REPOSITORY_ID, WORKFLOW, type DesktopAuthority } from "./authority.ts";
import { ASSETS, publishDesktop, releaseBody, verifyProvenance } from "./publish.ts";

const source = "a".repeat(40), prefix = `repos/${REPOSITORY}`;
const authority: DesktopAuthority = { source, workflowId: 50, runId: 60, attempt: 2, ciRunId: 70, ciAttempt: 1 };
const repository = { id: REPOSITORY_ID, full_name: REPOSITORY, private: false, default_branch: "main" };
function records(): Record<string, unknown> {
  const run = { id: 60, run_attempt: 2, workflow_id: 50, path: WORKFLOW, head_sha: source, head_branch: "main", event: "workflow_dispatch", status: "in_progress", conclusion: null, repository, head_repository: repository, actor: { id: 894119, type: "User" }, triggering_actor: { id: 894119, type: "User" } };
  const ci = { ...run, id: 70, run_attempt: 1, workflow_id: 80, path: ".github/workflows/ci.yml", name: "CI", event: "push", status: "completed", conclusion: "success" };
  return structuredClone({
    [prefix]: repository, [`${prefix}/actions/workflows/50`]: { id: 50, path: WORKFLOW, state: "active" },
    [`${prefix}/actions/runs/60`]: run, [`${prefix}/actions/runs/60/attempts/2`]: run,
    [`${prefix}/git/ref/tags/${TAG}`]: { ref: `refs/tags/${TAG}`, object: { type: "commit", sha: source } },
    [`${prefix}/git/ref/heads/main`]: { ref: "refs/heads/main", object: { type: "commit", sha: source } },
    [`${prefix}/actions/workflows/ci.yml`]: { id: 80, name: "CI", path: ".github/workflows/ci.yml", state: "active" },
    [`${prefix}/actions/runs/70`]: ci, [`${prefix}/actions/runs/70/attempts/1`]: ci,
    [`${prefix}/actions/runs/70/attempts/1/jobs?per_page=100`]: { total_count: 2, jobs: ["Standalone package", "macOS synthetic Messages and Contacts fixtures"].map(name => ({ name, run_id: 70, run_attempt: 1, head_sha: source, status: "completed", conclusion: "success", completed_at: "2026-09-11T12:00:00Z" })) },
  });
}
test("desktop authority requires exact owner, main, direct tag and entire successful CI attempt", async () => {
  const fixture = records(), reads: string[] = [];
  await authorizeDesktop(authority, path => { reads.push(path); return fixture[path]; });
  expect(reads.some(path => /releases|packages|website-production/u.test(path))).toBe(false);
  for (const [path, field, value] of [
    ["actions/runs/60", "run_attempt", 3], ["actions/runs/60/attempts/2", "actor", { id: 999, type: "User" }],
    ["actions/runs/60", "head_repository", { ...repository, id: 999 }], ["actions/workflows/50", "path", ".github/workflows/release.yml"],
    [`git/ref/tags/${TAG}`, "object", { type: "tag", sha: source }], ["git/ref/heads/main", "object", { type: "commit", sha: "b".repeat(40) }],
    ["actions/runs/70", "run_attempt", 2], ["actions/runs/70/attempts/1", "conclusion", "failure"],
    ["actions/runs/70/attempts/1/jobs?per_page=100", "total_count", 3],
  ] as const) {
    const changed = records(); (changed[`${prefix}/${path}`] as Record<string, unknown>)[field] = value;
    await expect(authorizeDesktop(authority, path => changed[path])).rejects.toThrow();
  }
});
test("desktop environment and artifact cannot cross attempts or workflows", () => {
  const environment = { GITHUB_SHA: source, GITHUB_REPOSITORY: REPOSITORY, GITHUB_REPOSITORY_ID: String(REPOSITORY_ID), GITHUB_REF: "refs/heads/main", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_WORKFLOW_REF: `${REPOSITORY}/${WORKFLOW}@refs/heads/main`, GITHUB_WORKFLOW_SHA: source, GITHUB_ACTOR_ID: "894119", RUNNER_ENVIRONMENT: "github-hosted", DESKTOP_TAG: TAG, DESKTOP_RELEASE_WORKFLOW_ID: "50", GITHUB_RUN_ID: "60", GITHUB_RUN_ATTEMPT: "2", DESKTOP_CI_RUN_ID: "70", DESKTOP_CI_RUN_ATTEMPT: "1" };
  expect(environmentAuthority(environment)).toEqual(authority);
  for (const [key, value] of Object.entries({ GITHUB_ACTOR_ID: "123", DESKTOP_TAG: "v0.1.0", GITHUB_WORKFLOW_SHA: "b".repeat(40), RUNNER_ENVIRONMENT: "self-hosted", DESKTOP_CI_RUN_ATTEMPT: "01" })) expect(() => environmentAuthority({ ...environment, [key]: value })).toThrow();
  const artifact = { id: 90, name: "textbutler-desktop-verified-60-2", expired: false, digest: `sha256:${"c".repeat(64)}`, size_in_bytes: 123, workflow_run: { id: 60, head_sha: source, head_branch: "main" } };
  admitDesktopArtifact(() => artifact, authority, "verified", 90);
  expect(() => admitDesktopArtifact(() => ({ ...artifact, name: "textbutler-desktop-verified-60-1" }), authority, "verified", 90)).toThrow();
  expect(() => admitDesktopArtifact(() => ({ ...artifact, workflow_run: { ...artifact.workflow_run, head_sha: "b".repeat(40) } }), authority, "verified", 90)).toThrow();
});
function provenance(hashes: Record<string, string>) {
  const uri = `https://github.com/${REPOSITORY}/${WORKFLOW}@refs/heads/main`;
  return [{ verificationResult: { signature: { certificate: { issuer: "https://token.actions.githubusercontent.com", buildSignerURI: uri, buildSignerDigest: source, runnerEnvironment: "github-hosted", sourceRepositoryURI: `https://github.com/${REPOSITORY}`, sourceRepositoryIdentifier: String(REPOSITORY_ID), sourceRepositoryOwnerIdentifier: "307125679", sourceRepositoryOwnerURI: "https://github.com/hraness", sourceRepositoryVisibilityAtSigning: "public", buildConfigURI: uri, buildConfigDigest: source, sourceRepositoryDigest: source, sourceRepositoryRef: "refs/heads/main", buildTrigger: "workflow_dispatch", runInvocationURI: `https://github.com/${REPOSITORY}/actions/runs/60/attempts/2` } }, verifiedTimestamps: [{}], statement: { _type: "https://in-toto.io/Statement/v1", predicateType: "https://slsa.dev/provenance/v1", subject: ASSETS.slice(0, 3).map(name => ({ name, digest: { sha256: hashes[name] } })) } } }];
}
test("verified provenance binds every certificate identity and exact subject inventory", () => {
  const hashes = Object.fromEntries(ASSETS.map(name => [name, sha256(name)])); verifyProvenance(provenance(hashes), authority, hashes);
  for (const key of Object.keys(provenance(hashes)[0]!.verificationResult.signature.certificate)) {
    const changed = provenance(hashes); (changed[0]!.verificationResult.signature.certificate as Record<string, unknown>)[key] = "foreign";
    expect(() => verifyProvenance(changed, authority, hashes)).toThrow();
  }
  const changed = provenance(hashes); changed[0]!.verificationResult.statement.subject[0]!.digest.sha256 = "f".repeat(64);
  expect(() => verifyProvenance(changed, authority, hashes)).toThrow();
  const duplicate = provenance(hashes); duplicate[0]!.verificationResult.statement.subject[1] = duplicate[0]!.verificationResult.statement.subject[0]!;
  expect(() => verifyProvenance(duplicate, authority, hashes)).toThrow();
});
function publicationFixture() {
  const files = Object.fromEntries(ASSETS.map(name => [name, Buffer.from(name)])), writes: string[] = [], downloads: number[] = [];
  let release: any = undefined; let next = 100; let uncertain = false;
  const ports = {
    authorize: async () => undefined,
    read: (path: string) => path.includes("?per_page=") ? (release ? [release] : []) : release,
    mutate: (method: "POST" | "PATCH", _path: string, body: unknown) => { writes.push(method); if (method === "POST") release = { ...body as object, id: 1, immutable: false, assets: [], author: { id: 41898282, type: "Bot" } }; else release = { ...release, ...body as object, immutable: true }; return release; },
    upload: (_id: number, name: string, bytes: Buffer) => { writes.push(name); release.assets.push({ id: next++, name, state: "uploaded", size: bytes.length, digest: `sha256:${sha256(bytes)}`, browser_download_url: `https://github.com/${REPOSITORY}/releases/download/${TAG}/${name}` }); if (uncertain) throw new Error("Uncertain upload"); },
    download: async (id: number) => { downloads.push(id); return files[release.assets.find((asset: any) => asset.id === id).name]!; },
  };
  return { files, ports, writes, downloads, release: () => release, setRelease: (value: unknown) => { release = value; }, uncertain: () => { uncertain = true; } };
}
test("publisher reads exact bytes, publishes immutable prerelease once and never changes Latest", async () => {
  const f = publicationFixture(); await publishDesktop(authority, f.files, f.ports);
  expect(f.writes).toEqual(["POST", ...ASSETS, "PATCH"]); expect(f.release()).toMatchObject({ immutable: true, draft: false, prerelease: true, make_latest: "false", body: releaseBody(authority) }); expect(f.downloads.length).toBeGreaterThan(ASSETS.length);
  f.writes.length = 0; await publishDesktop(authority, f.files, f.ports); expect(f.writes).toEqual([]);
});
test("uncertain upload stops and another attempt cannot adopt retained draft", async () => {
  const f = publicationFixture(); f.uncertain(); await expect(publishDesktop(authority, f.files, f.ports)).rejects.toThrow("Uncertain"); expect(f.writes).toEqual(["POST", ARCHIVE]);
  f.writes.length = 0; await expect(publishDesktop({ ...authority, attempt: 3 }, f.files, f.ports)).rejects.toThrow("authority"); expect(f.writes).toEqual([]);
  f.release().assets[0].digest = `sha256:${"f".repeat(64)}`;
  await expect(publishDesktop(authority, f.files, f.ports)).rejects.toThrow("asset"); expect(f.writes).toEqual([]);
});
test("workflow separates Apple secrets, credential-free checks, checkout-free OIDC and sole writer", () => {
  const source = readFileSync(join(import.meta.dir, "../../../.github/workflows/desktop-release.yml"), "utf8");
  const owners = readFileSync(join(import.meta.dir, "../../../.github/CODEOWNERS"), "utf8");
  expect(owners.split("\n")).toContain("/apps/macos/distribution/** @0thernet");
  const sign = source.split("\n  sign:\n")[1]!.split("\n  verify:\n")[0]!, attest = source.split("\n  attest:\n")[1]!.split("\n  publish:\n")[0]!;
  expect(source.match(/contents: write/gu)).toHaveLength(1); expect(source.match(/id-token: write/gu)).toHaveLength(1);
  expect(sign).toContain("environment: desktop-signing"); expect(sign).not.toMatch(/run:.*(?:bun install|native:package|native:smoke)/u); expect(sign).toContain("notary-submission.json");
  expect(attest).not.toContain("actions/checkout"); expect(attest).not.toContain("secrets."); expect(source).not.toContain("npm publish"); expect(source).not.toContain("production-ref-writer");
  const inline = attest.match(/node <<'NODE'\n([\s\S]+?)\n          NODE/u)![1]!.split("\n").map(line => line.slice(10)).join("\n"); expect(() => new Script(inline)).not.toThrow();
  expect(source).toContain("--no-env-file --no-install"); expect(source).toContain("artifact-ids: ${{ needs.attest.outputs.artifact_id }}");
});
