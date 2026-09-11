import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { bundlePath, repository } from "../scripts/package.ts";
import { assertRuntime, command, digest, inventory, parseUnsigned, readPhysical, requireValue, sha256, TAG, VERSION } from "./common.ts";

// Runs only after the exact source's required CI and independent review. The
// signing runner receives this immutable artifact, not the builder's workspace.
if (import.meta.main) {
  requireValue(process.argv.length === 4 && process.platform === "darwin" && process.arch === "arm64", "Expected reviewed source SHA and new output directory on Apple Silicon macOS");
  const source = digest(process.argv[2], 40), out = resolve(process.argv[3]!);
  requireValue(command("git", ["rev-parse", "HEAD"], { cwd: repository }).toString("utf8").trim() === source && command("git", ["status", "--porcelain"], { cwd: repository }).length === 0, "Source checkout must be clean at the admitted SHA");
  for (const path of ["apps/macos/package.json", "apps/macos/src-tauri/tauri.conf.json"]) requireValue(JSON.parse(readPhysical(join(repository, path)).toString("utf8")).version === VERSION, "Desktop version fields differ");
  requireValue(command("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleShortVersionString", join(bundlePath, "Contents/Info.plist")]).toString("utf8").trim() === VERSION, "Built app version differs");
  assertRuntime(join(bundlePath, "Contents/Resources/textbutler-runtime"));
  const build = JSON.parse(readPhysical(join(bundlePath, "Contents/Resources/textbutler-runtime/build-source.json"), 4096).toString("utf8"));
  requireValue(build.schema === "textbutler.desktop-build.v1" && build.clean === true && build.sourceSha === source && build.sourceTree === command("git", ["rev-parse", "HEAD^{tree}"], { cwd: repository }).toString("utf8").trim(), "App was not built from this exact clean source; rebuild before release admission");
  mkdirSync(out, { mode: 0o700 });
  command("/usr/bin/python3", ["-I", join(import.meta.dir, "archive.py"), "pack", bundlePath, join(out, "unsigned.zip")], { timeout: 180_000 });
  const archive = readPhysical(join(out, "unsigned.zip"));
  const receipt = parseUnsigned({ schema: "textbutler.desktop-unsigned.v1", repository: "hraness/message-like-me", sourceSha: source, sourceTree: digest(command("git", ["rev-parse", "HEAD^{tree}"], { cwd: repository }).toString("utf8").trim(), 40), version: VERSION, tag: TAG, architecture: "arm64", minimumMacOS: "14.5", archive: { name: "unsigned.zip", sha256: sha256(archive), bytes: archive.length }, bundleSha256: sha256(JSON.stringify(inventory(bundlePath))) });
  const bytes = `${JSON.stringify(receipt)}\n`; writeFileSync(join(out, "unsigned-manifest.json"), bytes, { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ status: "unsigned", sourceSha: source, receiptSha256: sha256(bytes), archiveSha256: receipt.archive.sha256 }));
}
