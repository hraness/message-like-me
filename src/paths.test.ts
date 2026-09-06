import { describe, expect, spyOn, test } from "bun:test";
import { chmod, link, lstat, mkdir, readdir, rename, writeFile, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import * as nativeFs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  atomicWritePrivate,
  publishPrivateArtifact,
  discardPrivatePublication,
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
      expect((await lstat(path)).nlink).toBe(1);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test("creates a missing output parent privately", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-output-parent-"));
    const parent = join(root, "private-output");
    const path = join(parent, "packet.json");
    try {
      await atomicWritePrivate(path, "private");
      expect((await lstat(parent)).mode & 0o777).toBe(0o700);
      expect((await lstat(path)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects an existing non-private output parent without changing it", async () => {
    const parent = await mkdtemp(join(tmpdir(), "message-like-me-public-output-"));
    const path = join(parent, "packet.json");
    try {
      await chmod(parent, 0o755);
      await expect(atomicWritePrivate(path, "private")).rejects.toThrow(
        "refusing to change a caller-owned directory",
      );
      expect((await lstat(parent)).mode & 0o777).toBe(0o755);
      await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});

describe("private publication custody", () => {
  test("discards only a publication obtained from the native publisher", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-custody-"));
    try {
      const file = join(root, "packet.json");
      const publication = await publishPrivateArtifact(file, "synthetic packet");
      expect(Object.keys(publication).sort()).toEqual(["bytesSha256", "pathSha256"]);
      expect(await discardPrivatePublication({ ...publication })).toBe("retained-unproven");
      expect(await readFile(file, "utf8")).toBe("synthetic packet");
      expect(await discardPrivatePublication(publication)).toBe("removed");
      expect(await discardPrivatePublication(publication)).toBe("missing");
      expect(await readdir(root)).toEqual([]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  for (const replacement of ["inode", "symlink", "content", "mode", "hardlink", "directory"] as const) {
    test(`retains an observed ${replacement} change without deleting the replacement`, async () => {
      const root = await mkdtemp(join(tmpdir(), "message-like-me-custody-change-"));
      const parent = join(root, "private");
      const file = join(parent, "packet.json");
      try {
        const publication = await publishPrivateArtifact(file, "synthetic packet");
        const sentinel = join(root, "sentinel");
        await writeFile(sentinel, "unchanged sentinel", { mode: 0o600 });
        if (replacement === "inode") {
          await rename(file, join(parent, "original"));
          await writeFile(file, "replacement", { mode: 0o600 });
        } else if (replacement === "symlink") {
          await rm(file); await symlink(sentinel, file);
        } else if (replacement === "content") {
          await writeFile(file, "changed packet!!");
        } else if (replacement === "mode") {
          await chmod(file, 0o644);
        } else if (replacement === "hardlink") {
          await link(file, join(parent, "additional-link"));
        } else {
          await rename(parent, join(root, "original-parent"));
          await mkdir(parent, { mode: 0o700 });
          await writeFile(file, "replacement", { mode: 0o600 });
        }
        expect(await discardPrivatePublication(publication)).toBe("retained-changed");
        expect(await lstat(file)).toBeDefined();
        expect(await readFile(sentinel, "utf8")).toBe("unchanged sentinel");
      } finally { await rm(root, { recursive: true, force: true }); }
    });
  }
});

test("bounds the cleanup hash read when a file grows after the identity sample", async () => {
  const root = await mkdtemp(join(tmpdir(), "message-like-me-custody-growth-"));
  const file = join(root, "packet.json");
  const body = "s".repeat(70_000);
  let grew = false;
  let bytesRequested = 0;
  const originalRead = nativeFs.readSync;
  try {
    const publication = await publishPrivateArtifact(file, body);
    const read = spyOn(nativeFs, "readSync").mockImplementation((descriptor: number, buffer: NodeJS.ArrayBufferView,
      offset?: number | nativeFs.ReadOptions, length?: number, position?: nativeFs.ReadPosition | null) => {
      if (typeof offset !== "number") return originalRead(descriptor, buffer, offset);
      if (length === undefined) throw new Error("Synthetic bounded-read fixture requires a length");
      if (!grew) {
        grew = true;
        nativeFs.appendFileSync(file, "extra bytes");
      }
      expect(buffer.byteLength).toBeLessThanOrEqual(64 * 1024);
      bytesRequested += length;
      return originalRead(descriptor, buffer, offset, length, position ?? null);
    });
    try {
      expect(await discardPrivatePublication(publication)).toBe("retained-changed");
      expect(grew).toBe(true);
      expect(bytesRequested).toBe(body.length + 1);
      expect(await readFile(file, "utf8")).toBe(`${body}extra bytes`);
    } finally { read.mockRestore(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
