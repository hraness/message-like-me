import { access, chmod, constants, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const repository = resolve(root, "../..");
const output = join(root, "out/textbutler-menubar");
const mode = process.argv[2];

function run(program: string, args: string[], cwd: string): void {
  const result = spawnSync(program, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${program} exited with status ${result.status ?? "unknown"}`);
}

if (mode === "--build") {
  await mkdir(resolve(root, "out"), { recursive: true });
  run("/usr/bin/swiftc", ["-O", "-framework", "AppKit", "menubar.swift", "-o", output], root);
  await chmod(output, 0o755);
  console.log(`Built unbundled Textbutler menu bar binary: ${output}`);
} else if (mode === "--run") {
  try { await access(output, constants.X_OK); } catch { throw new Error(`Prebuilt menu-bar binary is missing at ${output}; run menubar:build first.`); }
  run(output, [], repository);
} else {
  throw new Error("Usage: bun scripts/menubar.ts --build|--run");
}
