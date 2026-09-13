import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ARCHIVE, BUN_VERSION, command, digest, inventory, loadUnsigned, readPhysical, requireValue, sha256 } from "./common.ts";
import { entitlements, nativePaths, plist, assertSignature } from "./native.ts";

const PREVIEW_ARCHIVE = ARCHIVE.replace(/\.zip$/u, "-preview.zip");

if (import.meta.main) {
  requireValue(process.argv.length === 6 && process.platform === "darwin" && process.arch === "arm64", "Expected unsigned directory, receipt SHA, source SHA, and output directory on Apple Silicon macOS");
  const input = resolve(process.argv[2]!), receiptDigest = digest(process.argv[3]), source = digest(process.argv[4], 40), out = resolve(process.argv[5]!);
  const receipt = loadUnsigned(input, receiptDigest, source);
  const team = process.env.APPLE_TEAM_ID ?? "", identity = (process.env.APPLE_SIGNING_IDENTITY_SHA1 ?? "").toLowerCase();
  requireValue(/^[A-Z0-9]{10}$/u.test(team), "A Developer ID team is required"); digest(identity, 40);
  const certificate = (process.env.APPLE_CERTIFICATE_BASE64 ?? "").replace(/[\r\n\t ]/gu, ""), password = (process.env.APPLE_CERTIFICATE_PASSWORD ?? "").replace(/[\r\n]+$/u, "");
  const certificateBytes = Buffer.from(certificate, "base64");
  requireValue(certificate.length > 0 && certificate.length <= 128 * 1024 && certificateBytes.length > 0 && certificateBytes.length <= 96 * 1024 && password.length > 0 && password.length <= 1024, "Complete protected signing secrets are required");
  mkdirSync(out, { mode: 0o700 });
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "textbutler-preview-"))), tree = join(scratch, "tree"); mkdirSync(tree, { mode: 0o700 });
  const keychain = join(scratch, "preview.keychain-db"), keychainPassword = randomBytes(32).toString("hex"), environment = { HOME: process.env.HOME ?? "", TMPDIR: scratch, PATH: "/usr/bin:/bin:/usr/sbin:/sbin" };
  let keychainAttempted = false;
  const apple = (stage: "keychain-create" | "keychain-configure" | "keychain-unlock" | "certificate-import" | "keychain-partition" | "signing-identity" | "runtime-sign" | "app-sign" | "signature-verify" | "signed-archive" | "keychain-delete", program: string, args: readonly string[], timeout = 60_000) => command(program, args, { environment, timeout, stage });
  try {
    command("/usr/bin/python3", ["-I", join(import.meta.dir, "archive.py"), "unsigned", join(input, "unsigned.zip"), tree], { timeout: 180_000, stage: "unsigned-archive-extract" });
    const app = join(tree, "Textbutler.app"), paths = nativePaths(app);
    requireValue(sha256(JSON.stringify(inventory(app))) === receipt.bundleSha256, "Extracted unsigned app differs");
    writeFileSync(join(scratch, "certificate.p12"), certificateBytes, { flag: "wx", mode: 0o600 }); keychainAttempted = true;
    apple("keychain-create", "/usr/bin/security", ["create-keychain", "-p", keychainPassword, keychain]);
    apple("keychain-configure", "/usr/bin/security", ["set-keychain-settings", "-lut", "3600", keychain]);
    apple("keychain-unlock", "/usr/bin/security", ["unlock-keychain", "-p", keychainPassword, keychain]);
    apple("certificate-import", "/usr/bin/security", ["import", join(scratch, "certificate.p12"), "-k", keychain, "-P", password, "-T", "/usr/bin/codesign"]);
    apple("keychain-partition", "/usr/bin/security", ["set-key-partition-list", "-S", "apple-tool:,apple:,codesign:", "-s", "-k", keychainPassword, keychain]);
    const identities = apple("signing-identity", "/usr/bin/security", ["find-identity", "-v", "-p", "codesigning", keychain]).toString("utf8");
    requireValue(identities.split("\n").some(line => line.includes(identity.toUpperCase()) && line.includes('"Developer ID Application:') && line.includes(`(${team})`)), "Certificate is not the exact selected Developer ID Application identity");
    const runtimePath = paths.find(path => path.endsWith("/textbutler-bun"))!, entitlementPath = join(scratch, "entitlements.plist"); writeFileSync(entitlementPath, plist(entitlements(runtimePath)), { mode: 0o600 });
    apple("runtime-sign", "/usr/bin/codesign", ["--force", "--sign", identity, "--keychain", keychain, "--timestamp", "--options", "runtime", "--entitlements", entitlementPath, join(app, runtimePath)]);
    assertSignature(join(app, runtimePath), team);
    const runtime = join(app, "Contents/Resources/textbutler-runtime");
    writeFileSync(join(runtime, "runtime-manifest.json"), `${JSON.stringify({ schema: "textbutler.runtime.v1", bunVersion: BUN_VERSION, files: inventory(runtime).filter(file => file.path !== "runtime-manifest.json") })}\n`);
    apple("app-sign", "/usr/bin/codesign", ["--force", "--sign", identity, "--keychain", keychain, "--timestamp", "--options", "runtime", "--identifier", "app.textbutler.desktop", app]);
    apple("signature-verify", "/usr/bin/codesign", ["--verify", "--deep", "--strict", app]); assertSignature(app, team, "app.textbutler.desktop");
    apple("signed-archive", "/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, join(out, PREVIEW_ARCHIVE)], 180_000);
    const archive = readPhysical(join(out, PREVIEW_ARCHIVE));
    const manifest = { schema: "textbutler.desktop-preview.v1", unsigned: receipt, unsignedReceiptSha256: receiptDigest, teamId: team, signingIdentitySha1: identity, notarization: { status: "not-run", stapled: false }, archive: { name: PREVIEW_ARCHIVE, sha256: sha256(archive), bytes: archive.length }, runtimeManifestSha256: sha256(readPhysical(join(runtime, "runtime-manifest.json"))), warning: "Preview artifact is Developer ID signed but not notarized. macOS Gatekeeper may block it; use only for local testing." };
    writeFileSync(join(out, "preview-manifest.json"), `${JSON.stringify(manifest)}\n`, { flag: "wx", mode: 0o600 });
    writeFileSync(join(out, "SHA256SUMS"), `${sha256(archive)}  ${PREVIEW_ARCHIVE}\n${sha256(readPhysical(join(out, "preview-manifest.json")))}  preview-manifest.json\n`, { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ status: "developer-id-signed-preview", sourceSha: source, archiveSha256: sha256(archive) }));
  } finally {
    try { if (keychainAttempted) apple("keychain-delete", "/usr/bin/security", ["delete-keychain", keychain]); }
    finally { rmSync(scratch, { recursive: true, force: true }); }
  }
}
