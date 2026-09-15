import { chmod, link, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { installMenuBarBinary, installedMenuBarBinary, resolveMenuBarBinary } from "./menubar.ts";
import { renderMenuBarLaunchAgentPlist } from "./launch-agent.ts";
import { runTextbutlerCli } from "./cli.ts";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

test("resolves only an owned, private, physical prebuilt binary", async () => {
  const root = await mkdtemp(join(await realpath("/tmp"), "textbutler-menubar-")); roots.push(root);
  const binary = join(root, "textbutler-menubar");
  await writeFile(binary, "synthetic prebuilt binary", { mode: 0o700 });
  expect(await resolveMenuBarBinary([binary])).toBe(binary);
  await chmod(binary, 0o755);
  expect(await resolveMenuBarBinary([binary])).toBe(binary);
  await chmod(binary, 0o777);
  await expect(resolveMenuBarBinary([binary])).rejects.toThrow("not installed");
});

test("does not build or select a missing development binary", async () => {
  await expect(resolveMenuBarBinary(["/tmp/does-not-exist/textbutler-menubar"])).rejects.toThrow("Install the prebuilt CLI companion");
});

test("stages a verified prebuilt binary in the stable private user location", async () => {
  const root = await mkdtemp(join(await realpath("/tmp"), "textbutler-menubar-")); roots.push(root);
  const source = join(root, "source-menubar"); await writeFile(source, "prebuilt", { mode: 0o700 });
  const target = await installMenuBarBinary(source, root);
  expect(target).toBe(installedMenuBarBinary(root));
  expect(await readFile(target, "utf8")).toBe("prebuilt");
  const info = await lstat(target); expect(info.mode & 0o077).toBe(0);
  expect(await installMenuBarBinary(target, root)).toBe(target);
  await chmod(source, 0o777);
  await expect(installMenuBarBinary(source, root)).rejects.toThrow("unsafe");
});

test("menu launchd artifact runs at login without an auto-restart loop", () => {
  const plist = renderMenuBarLaunchAgentPlist({ home: "/fixture/user", dataDir: "/fixture/user/Library/Application Support/Textbutler", binary: "/fixture/user/Library/Application Support/Textbutler/bin/textbutler-menubar", generation: "12345678-1234-1234-1234-123456789abc" });
  expect(plist).toContain("<key>Label</key><string>app.textbutler.menubar</string>");
  expect(plist).toContain("<key>RunAtLoad</key><true/>");
  expect(plist).not.toContain("<key>KeepAlive</key>");
  expect(plist).toContain("<string>--data-dir</string>");
  expect(plist).toContain("<string>/fixture/user/Library/Application Support/Textbutler/bin/textbutler-menubar</string>");
});

test("installation rejects symlinked parents without writing through them", async () => {
  const root = await mkdtemp(join(await realpath("/tmp"), "textbutler-menubar-")); roots.push(root);
  const home = join(root, "home"), outside = join(root, "outside");
  await mkdir(home, { mode: 0o700 }); await mkdir(outside, { mode: 0o700 });
  await symlink(outside, join(home, "Library"));
  const source = join(root, "source"); await writeFile(source, "fixture", { mode: 0o700 });
  await expect(installMenuBarBinary(source, home)).rejects.toThrow("unsafe");
  await expect(lstat(join(outside, "Application Support"))).rejects.toThrow();
});

test("installation rejects aliased source bytes and preserves an installed binary", async () => {
  const root = await mkdtemp(join(await realpath("/tmp"), "textbutler-menubar-")); roots.push(root);
  const source = join(root, "source"); await writeFile(source, "first", { mode: 0o700 });
  const installed = await installMenuBarBinary(source, root);
  await link(source, join(root, "alias"));
  await expect(installMenuBarBinary(source, root)).rejects.toThrow("unsafe");
  expect(await readFile(installed, "utf8")).toBe("first");
});

test("protected root-owned distribution bytes install into a user-owned private destination", async () => {
  const source = "/usr/bin/true";
  expect((await lstat(source)).uid).toBe(0);
  const root = await mkdtemp(join(await realpath("/tmp"), "textbutler-menubar-")); roots.push(root);
  const target = await installMenuBarBinary(source, root);
  const info = await lstat(target);
  expect(info.uid).toBe(process.getuid?.());
  expect(info.mode & 0o077).toBe(0);
  expect(await readFile(target)).toEqual(await readFile(source));
});

test("the menu-bar CLI delegates install without building a binary", async () => {
  const lines: string[] = []; let installedDataDir: string | undefined;
  const lifecycle = {
    async install(dataDir: string) { installedDataDir = dataDir; return { label: "app.textbutler.menubar" as const, installation: "installed" as const, service: "loaded" as const, plistPath: "/fixture/user/Library/LaunchAgents/app.textbutler.menubar.plist", pid: null, detail: "installed", automaticReplies: "unavailable" as const }; },
    async uninstall() { throw new Error("not used"); },
    async status() { throw new Error("not used"); },
  };
  expect(await runTextbutlerCli(["menubar", "install", "--data-dir", "/fixture/user/Library/Application Support/Textbutler"], { write: (text: string) => { lines.push(text); } }, { menuBarLaunchAgent: lifecycle, menuBarBinary: "/fixture/user/Library/Application Support/Textbutler/bin/textbutler-menubar" })).toBe(0);
  expect(installedDataDir).toBe("/fixture/user/Library/Application Support/Textbutler");
  expect(JSON.parse(lines[0]!)).toMatchObject({ ok: true, binary: "/fixture/user/Library/Application Support/Textbutler/bin/textbutler-menubar", launchAgent: { label: "app.textbutler.menubar" } });
});
