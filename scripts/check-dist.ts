import {
  lstat,
  mkdtemp,
  readdir,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";

const PACKAGE_ROOT = resolve(import.meta.dir, "..");
const COMMITTED_DIST = join(PACKAGE_ROOT, "dist");

type FileRecord = Readonly<{
  executable: boolean;
  path: string;
}>;

async function filesUnder(root: string): Promise<FileRecord[]> {
  const files: FileRecord[] = [];
  async function visit(path: string): Promise<void> {
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      throw new Error(`Built output must not contain a symlink: ${path}`);
    }
    if (info.isDirectory()) {
      const entries = await readdir(path, { withFileTypes: true });
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        await visit(join(path, entry.name));
      }
      return;
    }
    if (!info.isFile()) throw new Error(`Built output contains a non-file entry: ${path}`);
    files.push({
      executable: (info.mode & 0o111) !== 0,
      path: relative(root, path).split(sep).join("/"),
    });
  }
  try {
    await visit(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("dist is missing; run bun run build before bun run check:dist");
    }
    throw error;
  }
  return files;
}

async function runBuild(outdir: string): Promise<void> {
  const child = Bun.spawn([
    process.execPath,
    "scripts/build-dist.ts",
    "--outdir",
    outdir,
  ], {
    cwd: PACKAGE_ROOT,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error([
      `Fresh dist build failed with exit code ${String(exitCode)}`,
      stdout.trim(),
      stderr.trim(),
    ].filter((line) => line !== "").join("\n"));
  }
}

export async function distFreshnessProblems(): Promise<string[]> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "message-like-me-dist-"));
  const expectedDist = join(temporaryRoot, "dist");
  try {
    await runBuild(expectedDist);
    const [committed, expected] = await Promise.all([
      filesUnder(COMMITTED_DIST),
      filesUnder(expectedDist),
    ]);
    const problems: string[] = [];
    const committedByPath = new Map(committed.map((file) => [file.path, file]));
    const expectedByPath = new Map(expected.map((file) => [file.path, file]));
    for (const path of [...new Set([
      ...committedByPath.keys(),
      ...expectedByPath.keys(),
    ])].sort((left, right) => left.localeCompare(right))) {
      const committedFile = committedByPath.get(path);
      const expectedFile = expectedByPath.get(path);
      if (committedFile === undefined) {
        problems.push(`dist/${path} is missing from committed output`);
        continue;
      }
      if (expectedFile === undefined) {
        problems.push(`dist/${path} is stale output from an earlier build`);
        continue;
      }
      const [committedBytes, expectedBytes] = await Promise.all([
        readFile(join(COMMITTED_DIST, path)),
        readFile(join(expectedDist, path)),
      ]);
      if (!committedBytes.equals(expectedBytes)) {
        problems.push(`dist/${path} does not match a fresh Bun build`);
      }
      if (committedFile.executable !== expectedFile.executable) {
        problems.push(`dist/${path} has stale executable permissions`);
      }
    }
    for (const required of [
      "canonical-json.d.ts",
      "cli.js",
      "index.d.ts",
      "index.js",
      "types.d.ts",
    ]) {
      if (!expectedByPath.has(required)) problems.push(`fresh build did not emit dist/${required}`);
    }
    return problems;
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

if (import.meta.main) {
  const problems = await distFreshnessProblems();
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    process.exitCode = 1;
  } else {
    console.log("Committed dist matches a fresh Bun build.");
  }
}
