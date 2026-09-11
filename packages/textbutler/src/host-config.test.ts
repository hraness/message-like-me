import { afterEach, expect, test } from "bun:test";
import { chmod, link, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadHostConfig, parseHostConfig } from "./host-config.ts";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(): Promise<{ root: string; file: string }> {
  const root = await mkdtemp(join(await realpath("/tmp"), "textbutler-host-")); roots.push(root);
  const state = join(root, "state"); await mkdir(state, { mode: 0o700 });
  return { root, file: join(state, "host.json") };
}
test("missing host config stays disabled, while explicit bounded config is loaded without provider work", async () => {
  const { root, file } = await fixture();
  expect(await loadHostConfig(root)).toEqual({ schemaVersion: 1 });
  const config = { schemaVersion: 1 as const, ghostget: { executable: "/opt/ghostget/src/index.ts", runtimeExecutable: "/opt/bin/bun", authId: "synthetic-account" } };
  await writeFile(file, JSON.stringify(config), { mode: 0o600 });
  expect(await loadHostConfig(root)).toEqual(config);
});
test("host configuration cannot include arbitrary commands, environment or unresolved relative paths", () => {
  for (const ghostget of [
    { executable: "ghostget", authId: "synthetic" },
    { executable: "/opt/ghostget", authId: "synthetic", argv: ["confirm"] },
    { executable: "/opt/ghostget", authId: "synthetic", env: { SECRET: "value" } },
    { executable: "/opt/ghostget", authId: "synthetic", stateHome: "/opt/../other" },
    { executable: "/opt/ghostget", authId: "synthetic\nchanged" },
  ]) expect(() => parseHostConfig({ schemaVersion: 1, ghostget })).toThrow("Invalid private");
  expect(() => parseHostConfig({ schemaVersion: 1, shell: "/bin/sh" })).toThrow("Invalid private");
});
test("owner configuration rejects linked or non-private files without exposing their contents", async () => {
  const { root, file } = await fixture(), other = join(root, "other.json");
  await writeFile(other, '{"schemaVersion":1}', { mode: 0o600 });
  await symlink(other, file); await expect(loadHostConfig(root)).rejects.toThrow();
  await rm(file); await link(other, file); await expect(loadHostConfig(root)).rejects.toThrow("Invalid private");
  await rm(file); await writeFile(file, '{"schemaVersion":1}', { mode: 0o644 });
  await expect(loadHostConfig(root)).rejects.toThrow("Invalid private");
  await chmod(file, 0o600); await writeFile(file, "do not echo this invalid content");
  await expect(loadHostConfig(root)).rejects.toThrow("Invalid private Textbutler host configuration");
});
