import { afterEach, expect, test } from "bun:test";
import { chmod, link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadOwnerExtensions } from "./plugins.ts";
import { Hooks, type Extension } from "./hooks.ts";

const roots: string[] = [];
afterEach(async () => { for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true }); });
async function fixture(): Promise<{ root: string; directory: string }> {
  const root = await mkdtemp(join(await realpath("/tmp"), "textbutler-plugins-")); roots.push(root);
  const directory = join(root, "plugins"); await mkdir(directory, { mode: 0o700 });
  return { root, directory };
}
async function install(directory: string, code = 'export default { id: "quiet-hours", version: "1.0.0", hooks: { "reply.before-send": async () => ({ veto: true, note: "Quiet hours" }) } };'): Promise<void> {
  await writeFile(join(directory, "extensions.json"), JSON.stringify({ schemaVersion: 1, extensions: [{ id: "quiet-hours", version: "1.0.0", entry: "quiet-hours.ts" }] }), { mode: 0o600 });
  await writeFile(join(directory, "quiet-hours.ts"), code, { mode: 0o600 });
}
test("loads only explicitly listed owner code and executes its lifecycle veto", async () => {
  const { root, directory } = await fixture(); await install(directory);
  await writeFile(join(directory, "unlisted.ts"), 'throw new Error("Unlisted code must not execute")', { mode: 0o600 });
  const loaded = await loadOwnerExtensions(root);
  expect(loaded.extensions).toHaveLength(1);
  expect(loaded.extensions[0]).toMatchObject({ id: "quiet-hours", version: "1.0.0" });
  expect(loaded.extensions[0]?.sha256).toMatch(/^[a-f0-9]{64}$/u);
  expect(await loaded.hooks.emit("reply.before-send", { contactId: "synthetic", runId: "r1", eventId: "m1", signal: new AbortController().signal })).toEqual({ veto: true, note: "Quiet hours" });
});
test("absent extension directory does not install or execute anything", async () => {
  const { root, directory } = await fixture(); await rm(directory, { recursive: true });
  expect((await loadOwnerExtensions(root)).extensions).toEqual([]);
  await expect(readFile(join(directory, "extensions.json"))).rejects.toThrow();
});
test("all manifest paths and entries are admitted before importing any module", async () => {
  const { root, directory } = await fixture(); await install(directory, 'throw new Error("Module executed before complete admission")');
  for (const entry of ["../contacts/agent.ts", "/outside.ts", "https://example.com/plugin.ts"]) {
    await writeFile(join(directory, "extensions.json"), JSON.stringify({ schemaVersion: 1, extensions: [{ id: "quiet-hours", version: "1.0.0", entry: "quiet-hours.ts" }, { id: "second", version: "1.0.0", entry }] }));
    await expect(loadOwnerExtensions(root)).rejects.toThrow("Invalid or duplicate");
  }
  await writeFile(join(directory, "extensions.json"), JSON.stringify({ schemaVersion: 1, extensions: [{ id: "quiet-hours", version: "1.0.0", entry: "quiet-hours.ts" }, { id: "second", version: "1.0.0", entry: "missing.ts" }] }));
  await expect(loadOwnerExtensions(root)).rejects.toThrow("ENOENT");
});
test("private files cannot be redirected to contact code or shared aliases", async () => {
  const { root, directory } = await fixture(); await install(directory);
  const target = join(root, "outside.ts"), entry = join(directory, "quiet-hours.ts");
  await writeFile(target, 'throw new Error("Outside code executed")', { mode: 0o600 });
  await rm(entry); await symlink(target, entry);
  await expect(loadOwnerExtensions(root)).rejects.toThrow();
  await rm(entry); await link(target, entry);
  await expect(loadOwnerExtensions(root)).rejects.toThrow("unlinked");
  await rm(entry); await install(directory); await chmod(entry, 0o644);
  await expect(loadOwnerExtensions(root)).rejects.toThrow("private");
  await chmod(entry, 0o600); await chmod(directory, 0o755);
  await expect(loadOwnerExtensions(root)).rejects.toThrow("private");
});
test("manifest identity mismatch and unknown lifecycle names cannot enter the hook collection", async () => {
  const { root, directory } = await fixture();
  await install(directory, 'export default { id: "different", version: "1.0.0", hooks: {} };');
  await expect(loadOwnerExtensions(root)).rejects.toThrow("identity does not match");
  const next = await fixture();
  await install(next.directory, 'export default { id: "quiet-hours", version: "1.0.0", hooks: { "send.anywhere": async () => {} } };');
  await expect(loadOwnerExtensions(next.root)).rejects.toThrow("Invalid extension hook");
  const hooks = new Hooks();
  expect(() => hooks.register({ id: "a", version: "1.0.0", hooks: { "reply.sent": "invalid" } } as unknown as Extension)).toThrow("Invalid extension hook");
});
test("source changes require a process restart and cannot mislabel Bun's cached module", async () => {
  const { root, directory } = await fixture(); await install(directory);
  const first = await loadOwnerExtensions(root);
  await install(directory, 'export default { id: "quiet-hours", version: "1.0.0", hooks: { "reply.before-send": async () => ({ veto: true, note: "Updated owner rule" }) } };');
  await expect(loadOwnerExtensions(root)).rejects.toThrow("restart the daemon process");
  const context = { contactId: "c", runId: "r", eventId: "m", signal: new AbortController().signal };
  expect((await first.hooks.emit("reply.before-send", context)).note).toBe("Quiet hours");
  const child = Bun.spawn([process.execPath, "--eval", `const { loadOwnerExtensions } = await import(${JSON.stringify(join(import.meta.dir, "plugins.ts"))}); const loaded = await loadOwnerExtensions(${JSON.stringify(root)}); console.log((await loaded.hooks.emit("reply.before-send", {contactId:"c", runId:"r", eventId:"m", signal:new AbortController().signal})).note);`], { stdout: "pipe", stderr: "pipe" });
  expect(await child.exited).toBe(0);
  expect((await new Response(child.stdout).text()).trim()).toBe("Updated owner rule");
});
