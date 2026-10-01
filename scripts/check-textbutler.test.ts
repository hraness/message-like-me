import { expect, test } from "bun:test";

import { packageTestFiles, planLanes, runLanes } from "./check-textbutler.ts";

test("check:textbutler lanes run every package test file exactly once", () => {
  const files = packageTestFiles();
  expect(files.length).toBeGreaterThan(0);
  const lanes = planLanes(files, false);
  const scheduled = lanes.flatMap(lane => lane.commands.filter(command => command[1] === "test").flatMap(command => command.slice(2)));
  expect([...scheduled].sort()).toEqual(files.map(file => `./${file}`));
  expect(lanes.map(lane => lane.label)).toContain("types");
  expect(lanes.find(lane => lane.label === "types")?.commands).toEqual([
    ["tsc", "--noEmit", "-p", "packages/transport/tsconfig.json"],
    ["tsc", "--noEmit", "-p", "packages/textbutler/tsconfig.json"],
  ]);
});

test("check:textbutler --tests-only drops only the platform-independent typechecks", () => {
  const files = packageTestFiles();
  const full = planLanes(files, false);
  const testsOnly = planLanes(files, true);
  expect(testsOnly).toEqual(full.filter(lane => lane.label !== "types"));
});

test("check:textbutler refuses a stale balanced-lane file", () => {
  expect(() => planLanes(["packages/textbutler/src/other.test.ts"], false)).toThrow("no longer exists");
});


test("resource-boundary tests are isolated without omitting any package tests", () => {
  const lanes = planLanes(packageTestFiles(), false);
  expect(lanes.filter(lane => lane.exclusive).flatMap(lane => lane.commands[0]?.slice(2))).toEqual([
    "./packages/textbutler/src/javascript-tool.test.ts",
  ]);
});

test("exclusive lanes wait for all parallel work even when a parallel lane fails", async () => {
  const active = new Set<string>();
  const started: string[] = [];
  const lanes = [
    { label: "exclusive", exclusive: true, commands: [] },
    { label: "parallel-a", commands: [] },
    { label: "parallel-b", commands: [] },
  ];
  const results = await runLanes(lanes, async lane => {
    if (lane.exclusive) expect(active.size).toBe(0);
    active.add(lane.label);
    started.push(lane.label);
    await Promise.resolve();
    if (!lane.exclusive) expect(started).toEqual(["parallel-a", "parallel-b"]);
    active.delete(lane.label);
    return { label: lane.label, ok: lane.label !== "parallel-a", seconds: 0 };
  });
  expect(started).toEqual(["parallel-a", "parallel-b", "exclusive"]);
  expect(results.map(result => result.ok)).toEqual([false, true, true]);
  expect(active.size).toBe(0);
});
