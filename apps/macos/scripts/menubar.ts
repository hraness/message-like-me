import { access, chmod, constants, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { command } from "../distribution/common.ts";

const root = resolve(import.meta.dir, "..");
const repository = resolve(root, "../..");
const output = join(root, "out/textbutler-menubar");
const mode = process.argv[2];
if (mode === "--build") {
  await mkdir(resolve(root, "out"), { recursive: true });
  command("/usr/bin/swiftc", ["-O", "-framework", "AppKit", "menubar.swift", "-o", output], { cwd: root, timeout: 120_000 });
  await chmod(output, 0o755);
  console.log(`Built unbundled Textbutler menu bar binary: ${output}`);
} else if (mode === "--run") {
  // Running the companion is deliberately build-free. Distribution and local
  // development builds must invoke --build explicitly before this command.
  try { await access(output, constants.X_OK); } catch { throw new Error(`Prebuilt menu-bar binary is missing at ${output}; run menubar:build first.`); }
  command(output, [], { cwd: repository });
} else {
  throw new Error("Usage: bun scripts/menubar.ts --build|--run");
}
