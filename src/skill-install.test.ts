import { describe, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installSkill } from "./skill-install.ts";

describe("skill installation", () => {
  test("installs both bundled skills and refuses accidental replacement", async () => {
    const project = await mkdtemp(join(tmpdir(), "message-like-me-skill-"));
    try {
      const destinations = await installSkill({
        target: "agents",
        scope: "project",
        projectDirectory: project,
      });
      expect((await lstat(join(destinations.messageLikeMe, "SKILL.md"))).isFile()).toBe(true);
      expect((await lstat(join(destinations.ensoul, "SKILL.md"))).isFile()).toBe(true);
      await expect(installSkill({
        target: "agents",
        scope: "project",
        projectDirectory: project,
      })).rejects.toThrow("already exists");
      const replaced = await installSkill({
        target: "agents",
        scope: "project",
        projectDirectory: project,
        force: true,
      });
      expect((await lstat(join(replaced.messageLikeMe, "SKILL.md"))).isFile()).toBe(true);
      expect((await lstat(join(replaced.ensoul, "SKILL.md"))).isFile()).toBe(true);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  test("preflights conflicts before installing either skill", async () => {
    const project = await mkdtemp(join(tmpdir(), "message-like-me-skill-preflight-"));
    try {
      const skillRoot = join(project, ".agents", "skills");
      await mkdir(join(skillRoot, "ensoul"), { recursive: true });
      await expect(installSkill({
        target: "agents",
        scope: "project",
        projectDirectory: project,
      })).rejects.toThrow("already exists");
      await expect(lstat(join(skillRoot, "message-like-me"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });
});
