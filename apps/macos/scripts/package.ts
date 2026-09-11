import { chmod, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { command, inventory, requireValue, sha256 } from "../distribution/common.ts";

export const appRoot = resolve(import.meta.dir, "..");
export const repository = resolve(appRoot, "../..");
export const bundlePath = join(appRoot, "src-tauri/target/release/bundle/macos/Textbutler.app");
export function sourceCoordinate(): { schema: "textbutler.desktop-build.v1"; sourceSha: string; sourceTree: string; clean: boolean } {
  return { schema: "textbutler.desktop-build.v1", sourceSha: command("git", ["rev-parse", "HEAD"], { cwd: repository }).toString("utf8").trim(), sourceTree: command("git", ["rev-parse", "HEAD^{tree}"], { cwd: repository }).toString("utf8").trim(), clean: command("git", ["status", "--porcelain"], { cwd: repository }).length === 0 };
}

export async function stageRuntime(source = sourceCoordinate()): Promise<string> {
  requireValue(Bun.version === "1.3.14" && process.platform === "darwin" && process.arch === "arm64", "Packaging requires Bun1.3.14 on Apple Silicon macOS");
  const root = join(appRoot, "out/runtime");
  await rm(root, { recursive: true, force: true }); await mkdir(root, { recursive: true });
  const build = await Bun.build({ entrypoints: [join(appRoot, "scripts/runtime-entry.ts")], outdir: root, naming: "cli.ts", target: "bun", minify: false, sourcemap: "none" });
  requireValue(build.success && build.outputs.length === 1, "Textbutler CLI bundle failed");
  const bundledSource = await readFile(join(root, "cli.ts"), "utf8");
  requireValue(!bundledSource.includes(repository) && !bundledSource.includes("node_modules/") && !bundledSource.includes("/Users/"), "Runtime bundle contains an unportable path");
  await copyFile(process.execPath, join(root, "textbutler-bun")); await chmod(join(root, "textbutler-bun"), 0o755);
  await copyFile(join(repository, "LICENSE"), join(root, "LICENSE.txt"));
  const notices = join(root, "notices"); await mkdir(notices);
  for (const name of ["README.md", "BUN-LICENSE.md", "RUST-LICENSES.md", "RUST-LICENSES.json", "RUST-1.97.1-COPYRIGHT-library.html", "RUST-1.97.1-LICENSE-MIT", "RUST-1.97.1-LICENSE-APACHE"]) await copyFile(join(appRoot, "distribution/notices", name), join(notices, name));
  for (const [input, output] of [["@anthropic-ai/sdk/LICENSE", "ANTHROPIC-SDK-LICENSE.txt"], ["@anthropic-ai/sdk/src/internal/qs/LICENSE.md", "SDK-QS-LICENSE.md"], ["zod/LICENSE", "ZOD-LICENSE.txt"]]) await copyFile(join(repository, "node_modules", input!), join(notices, output!));
  await copyFile(join(appRoot, "src-tauri/Cargo.lock"), join(notices, "Cargo.lock"));
  await writeFile(join(root, "build-source.json"), `${JSON.stringify(source)}\n`);
  await writeFile(join(root, "runtime-manifest.json"), `${JSON.stringify({ schema: "textbutler.runtime.v1", bunVersion: Bun.version, files: inventory(root) })}\n`);
  return root;
}

if (import.meta.main) {
  requireValue(process.argv.length === 2 || process.argv.length === 3 && process.argv[2] === "--stage-only", "Expected no arguments or --stage-only");
  // No signing credential reaches the build or package-manager toolchain.
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !key.startsWith("APPLE_") && !key.startsWith("TAURI_SIGNING_") && key !== "GITHUB_TOKEN")) as Record<string, string>;
  requireValue(command("rustc", ["--version"], { environment }).toString("utf8").startsWith("rustc 1.97.1 "), "Packaging requires the reviewed Rust1.97.1 toolchain");
  command(process.execPath, [join(appRoot, "distribution/rust-notices.ts")], { cwd: repository, environment, timeout: 180_000 });
  const source = sourceCoordinate();
  command(process.execPath, [join(appRoot, "scripts/build.ts")], { cwd: repository, environment });
  const staged = await stageRuntime(source);
  if (process.argv[2] !== "--stage-only") {
    command(process.execPath, [join(repository, "node_modules/@tauri-apps/cli/tauri.js"), "build", "--config", JSON.stringify({ bundle: { resources: { "../out/runtime/": "textbutler-runtime/" }, macOS: { signingIdentity: null } } }), "--", "--locked"], { cwd: join(appRoot, "src-tauri"), environment, timeout: 1_200_000, maximum: 8 * 1024 * 1024 });
    const resource = join(bundlePath, "Contents/Resources/textbutler-runtime");
    requireValue(sha256(JSON.stringify(inventory(resource))) === sha256(JSON.stringify(inventory(staged))), "Bundled runtime differs from staged resources");
    command("/usr/bin/codesign", ["--force", "--sign", "-", "--timestamp=none", "--identifier", "app.textbutler.desktop", bundlePath]);
    requireValue(sha256(JSON.stringify(inventory(resource))) === sha256(JSON.stringify(inventory(staged))), "Local sealing changed nested runtime bytes");
    command("/usr/bin/codesign", ["--verify", "--deep", "--strict", bundlePath]);
    requireValue(!source.clean || JSON.stringify(sourceCoordinate()) === JSON.stringify(source), "Admitted source changed during package build");
    console.log("Built an unsigned local Textbutler app. Developer ID signing and notarization remain required for distribution.");
  }
}
