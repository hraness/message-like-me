import { access, chmod, constants, mkdir, mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const root = resolve(import.meta.dir, "..");
const repository = resolve(root, "../..");
const output = join(root, "out/textbutler-menubar");
const mode = process.argv[2];

function run(program: string, args: string[], cwd: string): void {
  const result = spawnSync(program, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${program} exited with status ${result.status ?? "unknown"}`);
}

if (mode === "--build" || mode === "--test") {
  // A fresh explicit cache avoids inherited Xcode/CLT SDK module caches.
  const scratch = await mkdtemp(join(tmpdir(), "textbutler-native-"));
  try {
    const architecture = process.arch === "arm64" ? "arm64" : "x86_64";
    const common = ["-O", "-target", `${architecture}-apple-macos14.5`, "-module-cache-path", join(scratch, "modules"), "MenuControl.swift"];
    if (mode === "--build") {
      await mkdir(resolve(root, "out"), { recursive: true });
      run("/usr/bin/swiftc", [...common, "-framework", "AppKit", "menubar.swift", "-o", output], root);
      const metadata = spawnSync("/usr/bin/xcrun", ["vtool", "-show-build", output], { encoding: "utf8" });
      if (metadata.status !== 0 || !/platform\s+MACOS\b/u.test(metadata.stdout) || !/minos\s+14\.5(?:\.0)?(?:\s|$)/u.test(metadata.stdout)) throw new Error("Menu companion deployment target differs from macOS 14.5");
      await chmod(output, 0o755);
      console.log(`Built unbundled Textbutler menu bar binary: ${output}`);
    } else {
      const tests = join(scratch, "menu-control-tests");
      run("/usr/bin/swiftc", [...common, "tests/MenuControlTests.swift", "-o", tests], root);
      run(tests, [], root);
    }
  } finally { await rm(scratch, { recursive: true, force: true }); }
} else if (mode === "--run") {
  try { await access(output, constants.X_OK); } catch { throw new Error(`Prebuilt menu-bar binary is missing at ${output}; run menubar:build first.`); }
  run(output, [], repository);
} else {
  throw new Error("Usage: bun scripts/menubar.ts --build|--run|--test");
}
