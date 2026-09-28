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
