import { join, resolve } from "node:path";
import { ARCHIVE, command, digest, object, readPhysical, requireValue, sha256, TAG, VERSION } from "./common.ts";
import { authorizeDesktop, environmentAuthority, githubEnvironment, githubReader, positive, REPOSITORY, REPOSITORY_ID, WORKFLOW, type DesktopAuthority } from "./authority.ts";
import { inspectVerified } from "./workflow-artifact.ts";

export const ASSETS = [ARCHIVE, "desktop-manifest.json", "SHA256SUMS", "provenance.jsonl"] as const;
const PREFIX = `repos/${REPOSITORY}`;
export function verifyProvenance(value: unknown, a: DesktopAuthority, hashes: Readonly<Record<string, string>>): void {
  requireValue(Array.isArray(value) && value.length === 1, "Expected one verified provenance statement");
  const result = object(object(value[0]).verificationResult), signature = object(result.signature), certificate = object(signature.certificate);
  const uri = `https://github.com/${REPOSITORY}/${WORKFLOW}@refs/heads/main`;
  const expected = { issuer: "https://token.actions.githubusercontent.com", buildSignerURI: uri, buildSignerDigest: a.source, runnerEnvironment: "github-hosted", sourceRepositoryURI: `https://github.com/${REPOSITORY}`, sourceRepositoryIdentifier: String(REPOSITORY_ID), sourceRepositoryOwnerIdentifier: "307125679", sourceRepositoryOwnerURI: "https://github.com/hraness", sourceRepositoryVisibilityAtSigning: "public", buildConfigURI: uri, buildConfigDigest: a.source, sourceRepositoryDigest: a.source, sourceRepositoryRef: "refs/heads/main", buildTrigger: "workflow_dispatch", runInvocationURI: `https://github.com/${REPOSITORY}/actions/runs/${a.runId}/attempts/${a.attempt}` };
  requireValue(Object.entries(expected).every(([key, expected]) => certificate[key] === expected) && Array.isArray(result.verifiedTimestamps) && result.verifiedTimestamps.length > 0, "Provenance certificate source, workflow or attempt differs");
  const statement = object(result.statement), names = ASSETS.slice(0, 3);
  requireValue(statement._type === "https://in-toto.io/Statement/v1" && statement.predicateType === "https://slsa.dev/provenance/v1" && Array.isArray(statement.subject) && statement.subject.length === names.length, "Provenance subject inventory differs");
  const seen = new Set<string>();
  for (const raw of statement.subject) { const subject = object(raw), name = String(subject.name), hash = object(subject.digest); requireValue(names.includes(name as typeof names[number]) && !seen.has(name) && Object.keys(hash).join() === "sha256" && hash.sha256 === hashes[name], "Provenance subject bytes differ"); seen.add(name); }
}
export function releaseBody(a: DesktopAuthority): string {
  return `textbutler-desktop-release-v1 source=${a.source} workflow=${WORKFLOW} run=${a.runId} attempt=${a.attempt}\n\nDeveloper ID signed, notarized and stapled macOS 14.5+ app for Apple Silicon.\n\nDownload ${ARCHIVE}, extract it and move Textbutler.app to Applications. Background service installation is explicit; new settings start paused. Configure Ghostget and a supported agent account before enabling a contact.\n\nThis desktop prerelease does not change the legacy package release or Latest.\n`;
}
export type PublicationPorts = Readonly<{ read: (path: string) => unknown; authorize: () => Promise<void>; mutate: (method: "POST" | "PATCH", path: string, body: unknown) => unknown; upload: (id: number, name: string, bytes: Buffer) => unknown; download: (id: number, bytes: number) => Promise<Buffer> }>;
function validateRelease(value: unknown, a: DesktopAuthority, files: Readonly<Record<string, Buffer>>, published: boolean): { id: number; assets: { id: number; name: string; bytes: number }[] } {
  const r = object(value), id = positive(r.id);
  requireValue(r.tag_name === TAG && r.target_commitish === a.source && r.body === releaseBody(a) && r.prerelease === true && r.draft === !published && r.immutable === published && object(r.author).id === 41898282 && object(r.author).type === "Bot" && Array.isArray(r.assets) && r.assets.length <= ASSETS.length, "Desktop release authority differs; retained history cannot be overwritten");
  const seen = new Set<string>(), ids = new Set<number>();
  const assets = r.assets.map(raw => {
    const asset = object(raw), name = String(asset.name), id = positive(asset.id), bytes = files[name];
    requireValue(bytes !== undefined && !seen.has(name) && !ids.has(id) && asset.state === "uploaded" && asset.size === bytes.length && asset.digest === `sha256:${sha256(bytes)}`, "Desktop asset identity differs; no clobber permitted");
    const canonical = `https://github.com/${REPOSITORY}/releases/download/${TAG}/${name}`;
    const temporary = new RegExp(`^https://github\\.com/hraness/message-like-me/releases/download/untagged-[a-f0-9]{20}/${name.replaceAll(".", "\\.")}$`, "u");
    requireValue(asset.browser_download_url === canonical || (!published && typeof asset.browser_download_url === "string" && temporary.test(asset.browser_download_url)), "Desktop asset URL differs");
    seen.add(name); ids.add(id); return { id, name, bytes: bytes.length };
  });
  requireValue(!published || assets.length === ASSETS.length, "Published desktop inventory is incomplete");
  return { id, assets };
}
/** Each uncertain write stops this attempt. Reconciliation never deletes or overwrites history. */
export async function publishDesktop(a: DesktopAuthority, files: Readonly<Record<string, Buffer>>, ports: PublicationPorts): Promise<void> {
  requireValue(Object.keys(files).sort().join() === [...ASSETS].sort().join(), "Publication file inventory differs");
  await ports.authorize(); let found: Record<string, unknown> | undefined; const seen = new Set<number>(); let exhausted = false;
  for (let page = 1; page <= 6; page++) {
    const values = ports.read(`${PREFIX}/releases?per_page=100&page=${page}`);
    requireValue(Array.isArray(values) && values.length <= 100 && (page <= 5 || values.length === 0), "Retained release inventory is truncated");
    for (const raw of values) { const r = object(raw), id = positive(r.id); requireValue(!seen.has(id), "Duplicate release identity"); seen.add(id); if (r.tag_name === TAG) { requireValue(found === undefined, "Ambiguous desktop release"); found = r; } }
    if (values.length < 100) { exhausted = true; break; }
  }
  requireValue(exhausted, "Incomplete retained release inventory");
  if (found === undefined) {
    await ports.authorize(); found = object(ports.mutate("POST", `${PREFIX}/releases`, { tag_name: TAG, target_commitish: a.source, name: `Textbutler ${VERSION} for macOS (Apple Silicon)`, body: releaseBody(a), draft: true, prerelease: true, make_latest: "false" }));
  } else { const id = positive(found.id); found = object(ports.read(`${PREFIX}/releases/${id}`)); requireValue(found.id === id, "Listed release ID changed"); }
  const id = positive(found.id), published = found.draft === false;
  const readback = async (published: boolean) => {
    const r = object(ports.read(`${PREFIX}/releases/${id}`)); requireValue(r.id === id, "Release ID changed"); const checked = validateRelease(r, a, files, published);
    for (const asset of checked.assets) requireValue(sha256(await ports.download(asset.id, asset.bytes)) === sha256(files[asset.name]!), "Uploaded desktop bytes differ"); return checked;
  };
  let checked = validateRelease(found, a, files, published);
  if (!published) {
    for (const name of ASSETS) { if (checked.assets.some(asset => asset.name === name)) continue; await ports.authorize(); await readback(false); ports.upload(id, name, files[name]!); checked = await readback(false); }
    requireValue(checked.assets.length === ASSETS.length, "Desktop draft is incomplete"); await ports.authorize(); await readback(false);
    ports.mutate("PATCH", `${PREFIX}/releases/${id}`, { draft: false, prerelease: true, make_latest: "false" });
  }
  await readback(true); await ports.authorize(); await readback(true);
}

if (import.meta.main) {
  requireValue(process.argv.length === 3, "Expected downloaded desktop artifact directory");
  const directory = resolve(process.argv[2]!), a = environmentAuthority(), read = githubReader();
  const hashes = inspectVerified(directory, a.source, true), expected = object(JSON.parse(process.env.DESKTOP_HASHES ?? "null"));
  requireValue(Object.keys(expected).sort().join() === Object.keys(hashes).sort().join() && Object.entries(hashes).every(([name, hash]) => digest(expected[name]) === hash), "Verified artifact handoff differs");
  const manifest = object(JSON.parse(readPhysical(join(directory, "desktop-manifest.json")).toString("utf8"))), bound = object(manifest.workflowAuthority);
  requireValue(bound.repository === REPOSITORY && bound.repositoryId === REPOSITORY_ID && bound.workflow === WORKFLOW && bound.workflowSha === a.source && bound.workflowId === a.workflowId && bound.runId === a.runId && bound.runAttempt === a.attempt && bound.ciRunId === a.ciRunId && bound.ciRunAttempt === a.ciAttempt, "Publication workflow attempt differs");
  const files = Object.fromEntries(ASSETS.map(name => [name, readPhysical(join(directory, name), name === ARCHIVE ? 768 * 1024 * 1024 : 1024 * 1024)]));
  requireValue(sha256(files["provenance.jsonl"]!) === digest(process.env.DESKTOP_PROVENANCE_SHA256), "Provenance artifact handoff differs");
  const environment = githubEnvironment();
  for (const name of ASSETS.slice(0, 3)) verifyProvenance(JSON.parse(command("gh", ["attestation", "verify", join(directory, name), "--repo", REPOSITORY, "--signer-workflow", `${REPOSITORY}/${WORKFLOW}`, "--signer-digest", a.source, "--source-digest", a.source, "--source-ref", "refs/heads/main", "--deny-self-hosted-runners", "--bundle", join(directory, "provenance.jsonl"), "--format=json"], { environment, timeout: 60_000, maximum: 4 * 1024 * 1024 }).toString("utf8")), a, hashes);
  const token = process.env.GH_TOKEN; requireValue(typeof token === "string" && token.length > 0, "Publication token is required");
  let writes = 0; const until = performance.now() + 1_500_000;
  const writing = () => requireValue(++writes <= 6 && performance.now() < until, "Desktop writer bound exceeded");
  await publishDesktop(a, files, {
    read, authorize: () => authorizeDesktop(a, read),
    mutate: (method, path, body) => { writing(); return JSON.parse(command("gh", ["api", "--hostname", "github.com", "--method", method, path, "--input", "-"], { environment, input: JSON.stringify(body) }).toString("utf8")); },
    upload: (id, name, bytes) => { writing(); return JSON.parse(command("gh", ["api", "--hostname", "github.com", "--method", "POST", `https://uploads.github.com/repos/${REPOSITORY}/releases/${id}/assets?name=${encodeURIComponent(name)}`, "--header", "Content-Type: application/octet-stream", "--input", "-"], { environment, input: bytes, timeout: 180_000 }).toString("utf8")); },
    download: async (id, maximum) => {
      const signal = AbortSignal.timeout(180_000);
      let response = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases/assets/${id}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/octet-stream", "X-GitHub-Api-Version": "2022-11-28" }, redirect: "manual", signal });
      if (response.status === 302) { const next = new URL(response.headers.get("location") ?? ""); await response.body?.cancel(); requireValue(next.protocol === "https:" && next.hostname === "release-assets.githubusercontent.com" && next.username === "" && next.password === "", "Foreign artifact redirect"); response = await fetch(next, { redirect: "error", signal }); }
      requireValue(response.status === 200 && response.body !== null, "Desktop asset download failed");
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try { for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.length; requireValue(size <= maximum, "Desktop asset exceeded exact bound"); chunks.push(next.value); } } finally { await reader.cancel(); }
      requireValue(size === maximum, "Desktop asset length differs"); return Buffer.concat(chunks);
    },
  });
  console.log(`Verified immutable desktop prerelease: https://github.com/${REPOSITORY}/releases/tag/${TAG}`);
}
