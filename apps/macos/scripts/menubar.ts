import { chmod, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { command } from "../distribution/common.ts";

const root = resolve(import.meta.dir, "..");
const repository = resolve(root, "../..");
const output = join(root, "out/textbutler-menubar");
await mkdir(resolve(root, "out"), { recursive: true });
command("/usr/bin/swiftc", ["-O", "-framework", "AppKit", "menubar.swift", "-o", output], { cwd: root, timeout: 120_000 });
await chmod(output, 0o755);
console.log(`Built unbundled Textbutler menu bar binary: ${output}`);
if (process.argv.includes("--run")) command(output, [], { cwd: repository });
