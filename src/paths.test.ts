import { describe, expect, test } from "bun:test";
import { lstat, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  atomicWritePrivate,
  dataPaths,
  defaultDataDirectory,
  initializeDataPaths,
  loadOrCreateInstallKey,
} from "./paths.ts";

describe("private local paths", () => {
  test("rejects raw relative explicit and XDG data roots", () => {
    expect(() => dataPaths("relative/state")).toThrow("absolute");
    const original = process.env.XDG_DATA_HOME;
    try {
      process.env.XDG_DATA_HOME = "relative/xdg";
      expect(() => defaultDataDirectory()).toThrow("XDG_DATA_HOME must be absolute");
      expect(() => dataPaths()).toThrow("XDG_DATA_HOME must be absolute");
    } finally {
      if (original === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = original;
    }
  });

  test("creates stable private state and one installation key", async () => {
    const parent = await mkdtemp(join(tmpdir(), "message-like-me-paths-"));
    const root = join(parent, "state");
    try {
      const paths = await initializeDataPaths(dataPaths(root));
      const first = await loadOrCreateInstallKey(paths.installKey);
      const second = await loadOrCreateInstallKey(paths.installKey);
      expect(first).toEqual(second);
      expect((await lstat(paths.root)).mode & 0o777).toBe(0o700);
      expect((await lstat(paths.installKey)).mode & 0o777).toBe(0o600);
      expect((await readFile(paths.installKey, "utf8")).trim()).toMatch(/^[a-f0-9]{64}$/u);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test("rejects a symbolic-link data root", async () => {
    const parent = await mkdtemp(join(tmpdir(), "message-like-me-link-"));
    const physical = join(parent, "physical");
    const linked = join(parent, "linked");
    try {
      await initializeDataPaths(dataPaths(physical));
      await symlink(physical, linked);
      await expect(initializeDataPaths(dataPaths(linked))).rejects.toThrow("symbolic link");
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test("publishes a private file without overwriting an existing target", async () => {
    const parent = await mkdtemp(join(tmpdir(), "message-like-me-write-"));
    const path = join(parent, "packet.json");
    try {
      await atomicWritePrivate(path, "first");
      await expect(atomicWritePrivate(path, "second")).rejects.toMatchObject({ code: "EEXIST" });
      expect(await readFile(path, "utf8")).toBe("first");
      expect((await lstat(path)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
