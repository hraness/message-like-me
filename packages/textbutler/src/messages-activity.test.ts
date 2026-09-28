import { afterEach, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMessagesActivity } from "./messages-activity.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function messages() { const root = mkdtempSync(join(tmpdir(), "tb-activity-")); roots.push(root); writeFileSync(join(root, "chat.db"), "db"); writeFileSync(join(root, "chat.db-wal"), ""); return root; }
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

test("a database write wakes the waiter within one sample, well before its heartbeat", async () => {
  const root = messages();
  const activity = createMessagesActivity({ directory: root, intervalMs: 20 });
  try {
    const started = performance.now();
    const woke = activity.wait(5_000);
    await wait(50); appendFileSync(join(root, "chat.db-wal"), "frame");
    expect(await woke).toBe(true);
    expect(performance.now() - started).toBeLessThan(1_000);
  } finally { activity.close(); }
});

test("activity between waits is remembered, and a quiet database times out", async () => {
  const root = messages();
  const activity = createMessagesActivity({ directory: root, intervalMs: 20 });
  try {
    appendFileSync(join(root, "chat.db-wal"), "frame"); await wait(100);
    expect(await activity.wait(5_000)).toBe(true);
    expect(await activity.wait(150)).toBe(false);
  } finally { activity.close(); }
});

test("a replaced or reset WAL still wakes, even when its inode number and size are unchanged", async () => {
  const root = messages();
  const activity = createMessagesActivity({ directory: root, intervalMs: 20 });
  try {
    rmSync(join(root, "chat.db-wal")); writeFileSync(join(root, "chat.db-wal"), "");
    expect(await activity.wait(5_000)).toBe(true);
  } finally { activity.close(); }
  // A reused inode with identical size is still distinguished by its modification time.
  let mtimeNs = 1n;
  const reused = createMessagesActivity({ directory: root, intervalMs: 20, stat: () => ({ ino: 7n, size: 0n, mtimeNs }) });
  try {
    expect(await reused.wait(100)).toBe(false);
    const woke = reused.wait(5_000); mtimeNs = 2n;
    expect(await woke).toBe(true);
  } finally { reused.close(); }
});

test("a missing store only falls back to the heartbeat, and a closed source never wakes", async () => {
  const activity = createMessagesActivity({ directory: join(messages(), "absent"), intervalMs: 20 });
  expect(await activity.wait(100)).toBe(false);
  activity.close();
  expect(await activity.wait(5_000)).toBe(false);
});
