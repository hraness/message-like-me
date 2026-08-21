import { describe, expect, test } from "bun:test";
import { lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installSkill } from "./skill-install.ts";

describe("skill installation", () => {
  test("installs the bundled hyphenated skill and refuses accidental replacement", async () => {
    const project = await mkdtemp(join(tmpdir(), "message-like-me-skill-"));
    try {
      const destination = await installSkill({
        target: "agents",
        scope: "project",
        projectDirectory: project,
      });
      expect((await lstat(join(destination, "SKILL.md"))).isFile()).toBe(true);
      await expect(installSkill({
        target: "agents",
        scope: "project",
        projectDirectory: project,
      })).rejects.toThrow("already exists");
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });
});
