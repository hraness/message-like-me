import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { ARCHIVE, BUN_VERSION, command, digest, IDENTIFIER, inventory, loadUnsigned, object, readPhysical, requireValue, sha256 } from "./common.ts";
import { assertSignature, entitlements, nativePaths, plist } from "./native.ts";

// Dependency-free Apple-secret consumer. Run on a clean signing host after
// reviewed source/artifact admission; no package install, build hook or app run.
if (import.meta.main) {
  requireValue(process.argv.length === 6 && process.platform === "darwin" && process.arch === "arm64", "Expected unsigned directory, receipt SHA, admitted source SHA, and new signed directory");
  const input = resolve(process.argv[2]!), receiptDigest = digest(process.argv[3]), source = digest(process.argv[4], 40), out = resolve(process.argv[5]!);
  const receipt = loadUnsigned(input, receiptDigest, source);
  mkdirSync(out, { mode: 0o700 });
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "textbutler-signing-"))), tree = join(scratch, "tree"); mkdirSync(tree, { mode: 0o700 });
  const keychain = join(scratch, "signing.keychain-db"), keychainPassword = randomBytes(32).toString("hex");
  let keychainAttempted = false;
  const environment = { HOME: process.env.HOME ?? "", TMPDIR: scratch, PATH: "/usr/bin:/bin:/usr/sbin:/sbin" };
  const apple = (program: string, args: readonly string[], timeout = 60_000, input?: string) => command(program, args, { environment, timeout, ...(input === undefined ? {} : { input }) });
  try {
    command("/usr/bin/python3", ["-I", join(import.meta.dir, "archive.py"), "unsigned", join(input, "unsigned.zip"), tree], { timeout: 180_000 });
    const app = join(tree, "Textbutler.app");
    requireValue(sha256(JSON.stringify(inventory(app))) === receipt.bundleSha256, "Extracted unsigned app differs");
    const paths = nativePaths(app);
    const team = process.env.APPLE_TEAM_ID ?? "", identity = (process.env.APPLE_SIGNING_IDENTITY_SHA1 ?? "").toLowerCase(), keyId = process.env.APPLE_API_KEY_ID ?? "", issuer = process.env.APPLE_API_ISSUER ?? "";
    const privateKey = process.env.APPLE_API_PRIVATE_KEY ?? "";
    const appleId = process.env.APPLE_NOTARY_APPLE_ID ?? "", appPassword = process.env.APPLE_NOTARY_APP_PASSWORD ?? "";
    const apiMode = keyId.length > 0 || issuer.length > 0 || privateKey.length > 0;
    const appMode = appleId.length > 0 || appPassword.length > 0;
    requireValue(!(apiMode && appMode), "Choose one notarization credential mode");
    requireValue((apiMode && /^[A-Z0-9]{10}$/u.test(keyId) && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(issuer))
      || (appMode && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(appleId) && appPassword.length > 0 && appPassword.length <= 1024), "Complete notarization credentials are required");
    requireValue(/^[A-Z0-9]{10}$/u.test(team), "A Developer ID team is required"); digest(identity, 40);
    const certificate = (process.env.APPLE_CERTIFICATE_BASE64 ?? "").replace(/[\r\n\t ]/gu, ""), password = (process.env.APPLE_CERTIFICATE_PASSWORD ?? "").replace(/[\r\n]+$/u, "");
    requireValue(certificate.length > 0 && certificate.length <= 128 * 1024 && /^[A-Za-z0-9+/]+={0,2}$/u.test(certificate) && password.length > 0 && password.length <= 1024 && (!apiMode || (privateKey.length <= 16 * 1024 && privateKey.startsWith("-----BEGIN PRIVATE KEY-----\n"))), "Complete protected signing secrets are required");
    writeFileSync(join(scratch, "certificate.p12"), Buffer.from(certificate, "base64"), { flag: "wx", mode: 0o600 });
    if (apiMode) writeFileSync(join(scratch, "notary.p8"), privateKey, { flag: "wx", mode: 0o600 });
    keychainAttempted = true;
    apple("/usr/bin/security", ["create-keychain", "-p", keychainPassword, keychain]);
    apple("/usr/bin/security", ["set-keychain-settings", "-lut", "3600", keychain]);
    apple("/usr/bin/security", ["unlock-keychain", "-p", keychainPassword, keychain]);
    apple("/usr/bin/security", ["import", join(scratch, "certificate.p12"), "-k", keychain, "-P", password, "-T", "/usr/bin/codesign"]);
    apple("/usr/bin/security", ["set-key-partition-list", "-S", "apple-tool:,apple:,codesign:", "-s", "-k", keychainPassword, keychain]);
    if (appMode) apple("/usr/bin/xcrun", ["notarytool", "store-credentials", "textbutler-notary", "--apple-id", appleId, "--team-id", team, "--keychain", keychain], 120_000, `${appPassword}\n`);
    const identities = apple("/usr/bin/security", ["find-identity", "-v", "-p", "codesigning", keychain]).toString("utf8");
    requireValue(identities.split("\n").some(line => line.includes(identity.toUpperCase()) && line.includes('"Developer ID Application:') && line.includes(`(${team})`)), "Certificate is not the exact selected Developer ID Application identity");
    const runtimePath = paths.find(path => path.endsWith("/textbutler-bun"))!;
    const entitlementPath = join(scratch, "entitlements.plist"); writeFileSync(entitlementPath, plist(entitlements(runtimePath)), { mode: 0o600 });
    apple("/usr/bin/codesign", ["--force", "--sign", identity, "--keychain", keychain, "--timestamp", "--options", "runtime", "--entitlements", entitlementPath, join(app, runtimePath)]);
    assertSignature(join(app, runtimePath), team);
    const runtime = join(app, "Contents/Resources/textbutler-runtime");
    writeFileSync(join(runtime, "runtime-manifest.json"), `${JSON.stringify({ schema: "textbutler.runtime.v1", bunVersion: BUN_VERSION, files: inventory(runtime).filter(file => file.path !== "runtime-manifest.json") })}\n`);
    apple("/usr/bin/codesign", ["--force", "--sign", identity, "--keychain", keychain, "--timestamp", "--options", "runtime", "--identifier", IDENTIFIER, app]);
    apple("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]); assertSignature(app, team, IDENTIFIER);
    const submission = join(scratch, "submission.zip"); apple("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, submission], 180_000);
    writeFileSync(join(out, "notary-attempt.json"), `${JSON.stringify({ schema: "textbutler.notary-attempt.v1", sourceSha: source, unsignedReceiptSha256: receiptDigest, submissionSha256: sha256(readPhysical(submission)), startedAt: new Date().toISOString(), status: "submission-outcome-pending" })}\n`, { flag: "wx", mode: 0o600 });
    const auth = apiMode ? ["--key", join(scratch, "notary.p8"), "--key-id", keyId, "--issuer", issuer]
      : ["--keychain-profile", "textbutler-notary", "--keychain", keychain];
    const submitted = object(JSON.parse(apple("/usr/bin/xcrun", ["notarytool", "submit", submission, ...auth, "--output-format", "json"], 180_000).toString("utf8")));
    requireValue(typeof submitted.id === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(submitted.id), "Notary submission identity is missing");
    writeFileSync(join(out, "notary-submission.json"), `${JSON.stringify({ sourceSha: source, unsignedReceiptSha256: receiptDigest, id: submitted.id })}\n`, { flag: "wx", mode: 0o600 });
    const accepted = object(JSON.parse(apple("/usr/bin/xcrun", ["notarytool", "wait", submitted.id, ...auth, "--timeout", "30m", "--output-format", "json"], 1_850_000).toString("utf8")));
    requireValue(accepted.id === submitted.id && accepted.status === "Accepted", "Exact notarization submission was not accepted");
    apple("/usr/bin/xcrun", ["stapler", "staple", app], 120_000); apple("/usr/bin/xcrun", ["stapler", "validate", app]);
    apple("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, join(out, ARCHIVE)], 180_000);
    const archive = readPhysical(join(out, ARCHIVE));
    const manifest = { schema: "textbutler.desktop-signed.v1", unsigned: receipt, unsignedReceiptSha256: receiptDigest, teamId: team, signingIdentitySha1: identity, notarization: { id: accepted.id, status: "Accepted", stapled: true }, archive: { name: ARCHIVE, sha256: sha256(archive), bytes: archive.length }, runtimeManifestSha256: sha256(readPhysical(join(runtime, "runtime-manifest.json"))) };
    const bytes = `${JSON.stringify(manifest)}\n`; writeFileSync(join(out, "signed-manifest.json"), bytes, { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ status: "signed-awaiting-independent-verification", sourceSha: source, receiptSha256: sha256(bytes), archiveSha256: sha256(archive) }));
  } finally {
    try { if (keychainAttempted) apple("/usr/bin/security", ["delete-keychain", keychain]); }
    finally { rmSync(scratch, { recursive: true, force: true }); }
  }
}
