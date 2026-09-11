import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createServer } from "node:net";
import { chmod, lstat, mkdtemp, readFile, realpath, rename, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { daemonSocketPath, requestDaemon, startDaemon, type RunningDaemon } from "./daemon.ts";
import { TEXTBUTLER_CONTROL_PROTOCOL as protocol } from "./control-service.ts";

const roots: string[] = [], daemons: RunningDaemon[] = [];
afterEach(async () => { for (const daemon of daemons.splice(0)) await daemon.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(): Promise<string> { const dir = await mkdtemp(join(await realpath("/tmp"), "tb-dc-")); roots.push(dir); return dir; }
function editRecord(dataDir: string, update: (value: Record<string, unknown>) => Record<string, unknown> | null): Record<string, unknown> {
  const db = new Database(join(dataDir, "state", "daemon-custody.sqlite"), { strict: true });
  try {
    const row = db.query("SELECT value FROM ownership WHERE id=1").get() as { value: string };
    const record = JSON.parse(row.value) as Record<string, unknown>, next = update(record);
    if (next === null) db.exec("DELETE FROM ownership"); else db.query("UPDATE ownership SET value=? WHERE id=1").run(JSON.stringify(next));
    return record;
  } finally { db.close(); }
}
async function crashOwnedChild(dataDir: string): Promise<{ pid: number; ino: number }> {
  const source = `import { startDaemon } from ${JSON.stringify(new URL("./daemon.ts", import.meta.url).href)}; await startDaemon({dataDir:process.argv[1]}); process.stdout.write("ready\\n"); setInterval(()=>{},1000);`;
  const child = Bun.spawn([process.execPath, "--no-env-file", "-e", source, dataDir], { cwd: dataDir, env: { HOME: dataDir, PATH: "/usr/bin:/bin:/usr/sbin:/sbin" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const ready = await Promise.race([child.stdout.getReader().read(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Synthetic daemon child readiness timed out")), 4_000); })]);
    if (ready.done || new TextDecoder().decode(ready.value) !== "ready\n") throw new Error("Synthetic daemon child did not become ready");
    expect((await requestDaemon({ dataDir, request: { protocol, command: "global.settings.update", expectedRevision: 1, settings: { paused: false, activeContactLimit: 3 } } })).ok).toBe(true);
    // The committed custody row is protected by the lifetime exclusive OS lock.
    await expect(startDaemon({ dataDir })).rejects.toThrow("already exists");
    const info = await lstat(daemonSocketPath(dataDir)); return { pid: child.pid, ino: info.ino };
  } finally { clearTimeout(timer); child.kill("SIGKILL"); await child.exited; }
}

test("a real owned child crash releases its OS lock and one concurrent restart recovers its committed socket", async () => {
  const dataDir = await fixture(), old = await crashOwnedChild(dataDir);
  expect((await lstat(daemonSocketPath(dataDir))).ino).toBe(old.ino);
  const record = editRecord(dataDir, value => value); expect(record.pid).toBe(old.pid); expect(record.ino).toBe(old.ino);
  const results = await Promise.allSettled([startDaemon({ dataDir }), startDaemon({ dataDir })]);
  const accepted = results.filter((item): item is PromiseFulfilledResult<RunningDaemon> => item.status === "fulfilled");
  expect(accepted).toHaveLength(1); expect(results.filter(item => item.status === "rejected")).toHaveLength(1);
  daemons.push(accepted[0]!.value);
  expect((await requestDaemon({ dataDir, request: { protocol, command: "snapshot" } }))).toMatchObject({ ok: true, snapshot: { revision: 2, settings: { paused: false, activeContactLimit: 3 } } });
  await accepted[0]!.value.close(); daemons.pop();
  await expect(lstat(daemonSocketPath(dataDir))).rejects.toMatchObject({ code: "ENOENT" });
});

test("custody also recovers a crash between durable recording and canonical socket publication", async () => {
  const dataDir = await fixture(); await crashOwnedChild(dataDir);
  const record = editRecord(dataDir, value => value), staged = join(dataDir, String(record.staging));
  await rename(daemonSocketPath(dataDir), staged);
  const daemon = await startDaemon({ dataDir }); daemons.push(daemon);
  await expect(lstat(staged)).rejects.toMatchObject({ code: "ENOENT" });
  expect((await daemon.service.snapshot()).revision).toBe(2);
});

test("a replaced crash socket or a socket without custody is preserved", async () => {
  const dataDir = await fixture(); await crashOwnedChild(dataDir);
  const path = daemonSocketPath(dataDir); await unlink(path); await writeFile(path, "owner replacement", { mode: 0o600 });
  await expect(startDaemon({ dataDir })).rejects.toThrow("unknown or unsafe"); expect(await readFile(path, "utf8")).toBe("owner replacement");
  const other = await fixture(), old = await crashOwnedChild(other);
  editRecord(other, () => null);
  await expect(startDaemon({ dataDir: other })).rejects.toThrow("unrecorded"); expect((await lstat(daemonSocketPath(other))).ino).toBe(old.ino);
});

test("a recorded living PID or a matching socket that still accepts connections prevents recovery", async () => {
  const dataDir = await fixture(), old = await crashOwnedChild(dataDir);
  editRecord(dataDir, record => ({ ...record, pid: process.pid }));
  await expect(startDaemon({ dataDir })).rejects.toThrow("still active or uncertain"); expect((await lstat(daemonSocketPath(dataDir))).ino).toBe(old.ino);
  const path = daemonSocketPath(dataDir); await unlink(path);
  const server = createServer(socket => socket.end());
  await new Promise<void>((resolve_, reject) => { server.once("error", reject); server.listen(path, resolve_); });
  try {
    await chmod(path, 0o600); const info = await lstat(path);
    editRecord(dataDir, record => ({ ...record, pid: old.pid, ino: info.ino, dev: info.dev }));
    await expect(startDaemon({ dataDir })).rejects.toThrow("replaced, served, or uncertain"); expect((await lstat(path)).ino).toBe(info.ino);
  } finally { await new Promise<void>(resolve_ => server.close(() => resolve_())); }
});

test("graceful shutdown preserves a replacement at the canonical socket pathname", async () => {
  const dataDir = await fixture(), daemon = await startDaemon({ dataDir });
  await rename(daemon.socketPath, join(dataDir, "moved.sock")); await writeFile(daemon.socketPath, "replacement", { mode: 0o600 });
  await expect(daemon.close()).rejects.toThrow("unknown or unsafe");
  expect(await readFile(daemon.socketPath, "utf8")).toBe("replacement");
});
