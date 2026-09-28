import { afterEach, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMessagesActivity } from "./messages-activity.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function messages() { const root = mkdtempSync(join(tmpdir(), "tb-activity-")); roots.push(root); writeFileSync(join(root, "chat.db"), "db"); writeFileSync(join(root, "chat.db-wal"), ""); return root; }
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

test("a database write wakes the waiter well before its heartbeat", async () => {
  const activity = createMessagesActivity({ directory: messages() });
  try {
    const started = performance.now();
    const woke = activity.wait(5_000);
    await wait(50); appendFileSync(join(roots[0]!, "chat.db-wal"), "frame");
    expect(await woke).toBe(true);
    expect(performance.now() - started).toBeLessThan(2_000);
  } finally { activity.close(); }
});

test("activity between waits is remembered, and a quiet database times out", async () => {
  const activity = createMessagesActivity({ directory: messages() });
  try {
    appendFileSync(join(roots[0]!, "chat.db-wal"), "frame"); await wait(100);
    expect(await activity.wait(5_000)).toBe(true);
    expect(await activity.wait(150)).toBe(false);
  } finally { activity.close(); }
});

test("a replaced WAL is watched again, and a missing store only falls back to the heartbeat", async () => {
  const root = messages();
  const activity = createMessagesActivity({ directory: root });
  try {
    rmSync(join(root, "chat.db-wal")); writeFileSync(join(root, "chat.db-wal"), "");
    await activity.wait(50); await activity.wait(50);
    const woke = activity.wait(5_000);
    await wait(50); appendFileSync(join(root, "chat.db-wal"), "frame");
    expect(await woke).toBe(true);
  } finally { activity.close(); }
  const missing = createMessagesActivity({ directory: join(root, "absent") });
  expect(await missing.wait(50)).toBe(false);
  missing.close();
  expect(await missing.wait(5_000)).toBe(false);
});

test("a recreated WAL that reuses its inode number is re-armed from the directory event", async () => {
  // Linux can reuse a deleted file's inode number: the old file watcher goes
  // silent, the identity looks unchanged, and only the directory reports it.
  const root = messages();
  const watchers = new Map<string, { listener: (event: string, name: string | null) => void; closed: boolean }[]>();
  const fakeWatch = (path: string, listener: (event: string, name: string | null) => void) => {
    const entry = { listener, closed: false };
    watchers.set(path, [...(watchers.get(path) ?? []), entry]);
    return { close() { entry.closed = true; }, on() { return this; } } as never;
  };
  const live = (path: string) => (watchers.get(path) ?? []).filter(entry => !entry.closed);
  const activity = createMessagesActivity({ directory: root, watch: fakeWatch });
  try {
    const wal = join(root, "chat.db-wal");
    expect(live(wal)).toHaveLength(1);
    const dead = live(wal)[0]!;
    live(root)[0]!.listener("rename", "chat.db-wal");
    expect(dead.closed).toBe(true);
    expect(await activity.wait(50)).toBe(true);
    expect(live(wal)).toHaveLength(1);
    const woke = activity.wait(5_000);
    live(wal)[0]!.listener("change", "chat.db-wal");
    expect(await woke).toBe(true);
    // Unrelated directory entries never wake the loop.
    live(root)[0]!.listener("change", "unrelated.db");
    expect(await activity.wait(50)).toBe(false);
  } finally { activity.close(); }
});
