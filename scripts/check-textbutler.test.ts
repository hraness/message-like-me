import { expect, test } from "bun:test";

import { packageTestFiles, planLanes } from "./check-textbutler.ts";

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
