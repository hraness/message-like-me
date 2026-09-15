import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const PACKAGE_ROOT = resolve(import.meta.dir, "../packages/agentrouter");
const TYPESCRIPT_CLI = join(PACKAGE_ROOT, "../../node_modules/typescript/bin/tsc");

async function run(command: readonly string[]): Promise<void> {
  const child = Bun.spawn([...command], { cwd: PACKAGE_ROOT, stderr: "pipe", stdout: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error([
      `Command failed (${String(exitCode)}): ${command.join(" ")}`,
      stdout.trim(),
      stderr.trim(),
    ].filter((line) => line !== "").join("\n"));
  }
  if (stdout.trim() !== "") process.stdout.write(stdout);
  if (stderr.trim() !== "") process.stderr.write(stderr);
}

export async function buildAgentrouterDist(): Promise<void> {
  const outdir = join(PACKAGE_ROOT, "dist");
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  // Node-targeted ESM also runs under Bun; the package keeps no runtime-specific imports.
  await run([
    process.execPath,
    "build",
    "src/index.ts",
    "--outdir",
    outdir,
    "--root",
    "src",
    "--target",
    "node",
    "--format",
    "esm",
    "--splitting",
    "--packages",
    "external",
  ]);
  await run([
    process.execPath,
    TYPESCRIPT_CLI,
    "--project",
    join(PACKAGE_ROOT, "tsconfig.build.json"),
    "--outDir",
    outdir,
  ]);
}

if (import.meta.main) await buildAgentrouterDist();
