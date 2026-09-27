import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { detectBun, detectConnector, needsBun } from "./connect-detect.ts";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function home(): Promise<string> {
  const path = await mkdtemp(join(await realpath("/tmp"), "textbutler-connect-")); roots.push(path);
  await mkdir(join(path, ".bun", "bin"), { recursive: true }); await mkdir(join(path, ".local", "bin"), { recursive: true });
  return path;
}
async function file(path: string, text: string, mode: number): Promise<string> { await writeFile(path, text); await chmod(path, mode); return path; }
const uid = process.getuid?.();

test("a Bun global install resolves to its physical entrypoint and the Bun that runs it", async () => {
  const root = await home();
  await mkdir(join(root, ".bun", "install", "global", "src"), { recursive: true });
  const entry = await file(join(root, ".bun", "install", "global", "src", "cli.ts"), "#!/usr/bin/env bun\n", 0o644);
  await symlink("../install/global/src/cli.ts", join(root, ".bun", "bin", "ghostget"));
  const bun = await file(join(root, ".bun", "bin", "bun"), "#!/bin/sh\n", 0o755);
  expect(await detectConnector({ home: root, path: "", uid })).toEqual({ ghostget: entry, runtime: bun, needsRuntime: false });
});

test("the running Bun wins over the usual folders, and PATH is searched first", async () => {
  const root = await home(), elsewhere = join(root, "tools");
  await mkdir(elsewhere);
  const first = await file(join(elsewhere, "ghostget"), "#!/usr/bin/env bun\n", 0o755);
  await file(join(root, ".local", "bin", "ghostget"), "#!/bin/sh\n", 0o755);
  const running = await file(join(elsewhere, "bun"), "#!/bin/sh\n", 0o755);
  await file(join(root, ".bun", "bin", "bun"), "#!/bin/sh\n", 0o755);
  expect(await detectConnector({ home: root, path: elsewhere, execPath: running, uid })).toEqual({ ghostget: first, runtime: running, needsRuntime: false });
});

test("a native Ghostget needs no Bun", async () => {
  const root = await home();
  const native = await file(join(root, ".local", "bin", "ghostget"), "\x7fELF-not-a-script", 0o755);
  expect(await detectConnector({ home: root, uid })).toEqual({ ghostget: native, needsRuntime: false });
  expect(await needsBun(native)).toBe(false);
});

test("a script Ghostget with no Bun around asks for Bun", async () => {
  const root = await home();
  const script = await file(join(root, ".local", "bin", "ghostget"), "#!/usr/bin/env bun\n", 0o755);
  // No Bun in the temporary folders; the system folders may have one, so check the shape only.
  const found = await detectConnector({ home: root, path: "", execPath: "/nonexistent/node", uid });
  expect(found.ghostget).toBe(script);
  expect(found.needsRuntime || found.runtime !== undefined).toBe(true);
});

test("a Ghostget that other users can change is reported, never offered", async () => {
  const root = await home();
  const unsafe = await file(join(root, ".bun", "bin", "ghostget"), "#!/usr/bin/env bun\n", 0o777);
  const found = await detectConnector({ home: root, path: "", uid });
  expect(found.ghostget === undefined || found.ghostget !== unsafe).toBe(true);
  if (found.ghostget === undefined) expect(found).toEqual({ needsRuntime: false, unsafe });
});

test("nothing installed finds nothing, and a missing or relative home is ignored", async () => {
  const root = await home();
  const found = await detectConnector({ home: root, path: "relative/bin", uid: -1 });
  expect(found.ghostget).toBeUndefined();
  expect(await detectBun({ home: "relative", path: "", execPath: join(root, "bun"), uid })).not.toBe(join(root, "bun"));
});
