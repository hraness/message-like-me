#!/usr/bin/env bun
// Runs the TextButler package gate (`bun test packages` plus both package
// typechecks) as balanced parallel lanes. The package tests are wall-clock
// bound (real child processes, grace periods, watchdogs), so one serial
// `bun test` leaves most runner cores idle. Every discovered package test file
// runs in exactly one lane. The QuickJS resource-boundary tests run after
// those lanes finish so gate contention cannot consume their fixed guest budget.
// `--tests-only` skips the platform-independent
// typechecks (used by the macOS fixture job, whose Linux sibling runs them).
import { Glob } from "bun";

/** Files that take most of the serial package-test time, split into balanced lanes. */
const HEAVY_LANES: readonly (readonly string[])[] = [
  ["packages/textbutler/src/imessage-setup.test.ts"],
  [
    "packages/textbutler/src/ghostget-automation-process.test.ts",
    "packages/textbutler/src/control-service.test.ts",
  ],
];
const EXCLUSIVE_TESTS = ["packages/textbutler/src/javascript-tool.test.ts"] as const;
const TYPECHECK_PROJECTS = ["packages/transport/tsconfig.json", "packages/textbutler/tsconfig.json"] as const;
// Matches Bun's default test-file discovery for `bun test packages`.
const TEST_FILES = new Glob("packages/**/*{.test,_test,.spec,_spec}.{ts,tsx,js,jsx,mjs,cjs,mts,cts}");

type Lane = Readonly<{ label: string; commands: readonly (readonly string[])[]; exclusive?: boolean }>;
type LaneResult = { label: string; ok: boolean; seconds: number };

export function packageTestFiles(root = process.cwd()): string[] {
  const files: string[] = [];
  for (const file of TEST_FILES.scanSync({ cwd: root, onlyFiles: true })) {
    if (file.split("/").includes("node_modules")) continue;
    files.push(file);
  }
  return files.sort();
}

export function planLanes(files: readonly string[], testsOnly: boolean): Lane[] {
  const available = new Set(files);
  const assigned = new Set<string>();
  const lanes: Lane[] = [];
  HEAVY_LANES.forEach((lane, index) => {
    for (const file of lane) {
      if (!available.has(file)) throw new Error(`check:textbutler lane file ${file} no longer exists; update scripts/check-textbutler.ts`);
      assigned.add(file);
    }
    lanes.push({ label: `tests-${String(index + 1)}`, commands: [[process.execPath, "test", ...lane.map(file => `./${file}`)]] });
  });
  for (const file of EXCLUSIVE_TESTS) {
    if (!available.has(file)) throw new Error(`check:textbutler exclusive file ${file} no longer exists; update scripts/check-textbutler.ts`);
    assigned.add(file);
  }
  const rest = files.filter(file => !assigned.has(file));
  if (rest.length > 0) {
    lanes.push({ label: `tests-${String(lanes.length + 1)}`, commands: [[process.execPath, "test", ...rest.map(file => `./${file}`)]] });
  }
  if (!testsOnly) {
    lanes.push({ label: "types", commands: TYPECHECK_PROJECTS.map(project => ["tsc", "--noEmit", "-p", project]) });
  }
  lanes.push({ label: "tests-resource-boundaries", exclusive: true, commands: [[process.execPath, "test", ...EXCLUSIVE_TESTS.map(file => `./${file}`)]] });
  return lanes;
}

async function pipeWithPrefix(stream: ReadableStream<Uint8Array>, prefix: string, sink: NodeJS.WriteStream): Promise<void> {
  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of stream) {
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    if (lines.length > 0) sink.write(lines.map(line => `${prefix}${line}\n`).join(""));
  }
  pending += decoder.decode();
  if (pending.length > 0) sink.write(`${prefix}${pending}\n`);
}

async function runLane(lane: Lane): Promise<LaneResult> {
  const started = performance.now();
  const prefix = `[${lane.label}] `;
  for (const command of lane.commands) {
    process.stdout.write(`${prefix}$ ${command.join(" ")}\n`);
    const child = Bun.spawn([...command], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [code] = await Promise.all([
      child.exited,
      pipeWithPrefix(child.stdout, prefix, process.stdout),
      pipeWithPrefix(child.stderr, prefix, process.stderr),
    ]);
    if (code !== 0) return { label: lane.label, ok: false, seconds: (performance.now() - started) / 1000 };
  }
  return { label: lane.label, ok: true, seconds: (performance.now() - started) / 1000 };
}

/** Exclusive lanes start only after every parallel child and its output are joined. */
export async function runLanes(lanes: readonly Lane[], execute: (lane: Lane) => Promise<LaneResult> = runLane): Promise<LaneResult[]> {
  const results = await Promise.all(lanes.filter(lane => !lane.exclusive).map(execute));
  for (const lane of lanes.filter(lane => lane.exclusive)) results.push(await execute(lane));
  return results;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const unknown = args.filter(arg => arg !== "--tests-only");
  if (unknown.length > 0) {
    process.stderr.write(`usage: bun scripts/check-textbutler.ts [--tests-only]\n`);
    process.exit(2);
  }
  const files = packageTestFiles();
  if (files.length === 0) throw new Error("check:textbutler found no package test files");
  const lanes = planLanes(files, args.includes("--tests-only"));
  const results = await runLanes(lanes);
  for (const result of results) {
    process.stdout.write(`check:textbutler ${result.label}: ${result.ok ? "pass" : "FAIL"} in ${result.seconds.toFixed(1)}s\n`);
  }
  process.exit(results.every(result => result.ok) ? 0 : 1);
}
