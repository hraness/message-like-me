import { appendFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ARCHIVE, digest, object, parseUnsigned, readPhysical, requireValue, sha256 } from "./common.ts";
import { environmentAuthority, WORKFLOW, REPOSITORY, REPOSITORY_ID } from "./authority.ts";

/** No app execution. Binds downloaded bytes and stage outputs to this attempt. */
export function inspectVerified(directory: string, source: string, provenance = false): Record<string, string> {
  const names = [ARCHIVE, "desktop-manifest.json", "SHA256SUMS"];
  requireValue(readdirSync(directory).sort().join() === [...names, ...(provenance ? ["provenance.jsonl"] : [])].sort().join(), "Verified desktop artifact has unexpected files");
  const hashes = Object.fromEntries(names.map(name => [name, sha256(readPhysical(join(directory, name), name === ARCHIVE ? 768 * 1024 * 1024 : 1024 * 1024))]));
  const manifest = object(JSON.parse(readPhysical(join(directory, "desktop-manifest.json"), 1024 * 1024).toString("utf8"))), receipt = parseUnsigned(manifest.unsigned), archive = object(manifest.archive), notary = object(manifest.notarization);
  requireValue(manifest.schema === "textbutler.desktop-release.v1" && receipt.sourceSha === source && archive.name === ARCHIVE && archive.sha256 === hashes[ARCHIVE] && archive.bytes === readPhysical(join(directory, ARCHIVE), 768 * 1024 * 1024).length && notary.status === "Accepted" && notary.stapled === true && Array.isArray(manifest.verification) && manifest.verification.includes("packaged-runtime") && manifest.verification.includes("clean-shutdown"), "Verified desktop identity is incomplete");
  requireValue(readPhysical(join(directory, "SHA256SUMS"), 1024 * 1024).toString("utf8") === `${hashes[ARCHIVE]}  ${ARCHIVE}\n${hashes["desktop-manifest.json"]}  desktop-manifest.json\n`, "Verified desktop checksums differ");
  return hashes;
}
if (import.meta.main) {
  const [mode, directoryArg] = process.argv.slice(2); requireValue(process.argv.length === 4 && directoryArg !== undefined, "Expected artifact stage and directory");
  const directory = resolve(directoryArg), a = environmentAuthority();
  const output = process.env.GITHUB_OUTPUT; requireValue(typeof output === "string", "Missing workflow output");
  if (mode === "unsigned" || mode === "signed") {
    const name = `${mode}-manifest.json`, bytes = readPhysical(join(directory, name), 1024 * 1024);
    const parsed = object(JSON.parse(bytes.toString("utf8"))); const unsigned = parseUnsigned(mode === "unsigned" ? parsed : parsed.unsigned);
    requireValue(unsigned.sourceSha === a.source, "Stage source differs");
    requireValue(typeof process.env.GITHUB_OUTPUT === "string", "Missing workflow output");
    appendFileSync(process.env.GITHUB_OUTPUT, `receipt_sha256=${sha256(bytes)}\n`);
  } else if (mode === "verified") {
    const hashes = inspectVerified(directory, a.source);
    const manifestPath = join(directory, "desktop-manifest.json"), current = object(JSON.parse(readPhysical(manifestPath).toString("utf8")));
    // This is the credential-free verifier's source/run attestation subject.
    const bytes = `${JSON.stringify({ ...current, workflowAuthority: { repository: REPOSITORY, repositoryId: REPOSITORY_ID, workflow: WORKFLOW, workflowSha: a.source, workflowId: a.workflowId, runId: a.runId, runAttempt: a.attempt, ciRunId: a.ciRunId, ciRunAttempt: a.ciAttempt } })}\n`;
    writeFileSync(manifestPath, bytes, { mode: 0o600 }); hashes["desktop-manifest.json"] = sha256(bytes);
    const sums = `${hashes[ARCHIVE]}  ${ARCHIVE}\n${hashes["desktop-manifest.json"]}  desktop-manifest.json\n`; writeFileSync(join(directory, "SHA256SUMS"), sums, { mode: 0o600 }); hashes.SHA256SUMS = sha256(sums);
    appendFileSync(output, `hashes=${JSON.stringify(hashes)}\narchive=${ARCHIVE}\n`);
  } else if (mode === "attest") {
    const hashes = inspectVerified(directory, a.source), expected = object(JSON.parse(process.env.DESKTOP_HASHES ?? "null"));
    requireValue(Object.keys(expected).sort().join() === Object.keys(hashes).sort().join() && Object.entries(hashes).every(([name, hash]) => digest(expected[name]) === hash), "Attestation subject differs from verifier outputs");
    const manifest = object(JSON.parse(readPhysical(join(directory, "desktop-manifest.json")).toString("utf8"))), bound = object(manifest.workflowAuthority);
    requireValue(bound.repository === REPOSITORY && bound.repositoryId === REPOSITORY_ID && bound.workflow === WORKFLOW && bound.workflowSha === a.source && bound.workflowId === a.workflowId && bound.runId === a.runId && bound.runAttempt === a.attempt && bound.ciRunId === a.ciRunId && bound.ciRunAttempt === a.ciAttempt, "Attestation workflow attempt differs");
  } else throw new Error("Unknown artifact stage");
}
