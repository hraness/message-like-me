import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PackagedCustodyUncertain, smokePackagedRuntime } from "../scripts/package-smoke.ts";
import { ARCHIVE, assertRuntime, command, digest, object, parseUnsigned, readPhysical, requireValue, sha256 } from "./common.ts";
import { verifySignedBundle } from "./native.ts";

// Credential-free verifier. Runs the final extracted artifact, never a rebuild.
if (import.meta.main) {
  requireValue(process.argv.length === 6 && process.platform === "darwin" && process.arch === "arm64", "Expected signed directory, signer receipt SHA, admitted source SHA, and new verified directory");
  const input = resolve(process.argv[2]!), expected = digest(process.argv[3]), source = digest(process.argv[4], 40), out = resolve(process.argv[5]!);
  const bytes = readPhysical(join(input, "signed-manifest.json"), 1024 * 1024); requireValue(sha256(bytes) === expected, "Signer handoff digest differs");
  const signed = object(JSON.parse(bytes.toString("utf8"))), unsigned = parseUnsigned(signed.unsigned), archive = object(signed.archive), notary = object(signed.notarization);
  requireValue(signed.schema === "textbutler.desktop-signed.v1" && unsigned.sourceSha === source && typeof signed.teamId === "string" && /^[A-Z0-9]{10}$/u.test(signed.teamId), "Signed source/team differs");
  requireValue(digest(signed.unsignedReceiptSha256) === sha256(`${JSON.stringify(unsigned)}\n`), "Signer unsigned receipt cross-binding differs"); digest(signed.runtimeManifestSha256); const identity = digest(signed.signingIdentitySha1, 40);
  requireValue(notary.status === "Accepted" && notary.stapled === true && typeof notary.id === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(notary.id), "Notarization receipt is incomplete");
  const archiveBytes = readPhysical(join(input, ARCHIVE));
  requireValue(archive.name === ARCHIVE && archive.bytes === archiveBytes.length && archive.sha256 === sha256(archiveBytes), "Signed archive differs");
  command("/usr/bin/python3", ["-I", join(import.meta.dir, "archive.py"), "signed", join(input, ARCHIVE)], { timeout: 180_000 });
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "textbutler-verify-"))), app = join(scratch, "Textbutler.app");
  let clean = true;
  try {
    command("/usr/bin/ditto", ["-x", "-k", join(input, ARCHIVE), scratch], { timeout: 180_000 });
    verifySignedBundle(app, signed.teamId, identity);
    const runtime = join(app, "Contents/Resources/textbutler-runtime"); assertRuntime(runtime);
    const build = object(JSON.parse(readPhysical(join(runtime, "build-source.json"), 4096).toString("utf8")));
    requireValue(build.schema === "textbutler.desktop-build.v1" && build.clean === true && build.sourceSha === source && build.sourceTree === unsigned.sourceTree, "Signed app build-source identity differs");
    requireValue(sha256(readPhysical(join(runtime, "runtime-manifest.json"))) === signed.runtimeManifestSha256, "Signed runtime manifest differs");
    await smokePackagedRuntime(app);
    mkdirSync(out, { mode: 0o700 }); copyFileSync(join(input, ARCHIVE), join(out, ARCHIVE));
    const manifest = `${JSON.stringify({ ...signed, schema: "textbutler.desktop-release.v1", verification: ["bounded-archive", "developer-id", "exact-team-and-leaf", "hardened-runtime", "minimal-entitlements", "arm64", "stapled-notarization", "gatekeeper", "syspolicy", "packaged-runtime", "paused-empty-control", "clean-shutdown"] })}\n`;
    writeFileSync(join(out, "desktop-manifest.json"), manifest, { flag: "wx", mode: 0o600 });
    writeFileSync(join(out, "SHA256SUMS"), `${archive.sha256}  ${ARCHIVE}\n${sha256(manifest)}  desktop-manifest.json\n`, { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ status: "verified-awaiting-provenance-and-publication", sourceSha: source, archiveSha256: archive.sha256, manifestSha256: sha256(manifest) }));
  } catch (error) { if (error instanceof PackagedCustodyUncertain) clean = false; throw error; }
  finally { if (clean) rmSync(scratch, { recursive: true, force: true }); }
}
