import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Wakes the poll loop as soon as Messages writes its database instead of on a
 * fixed timer. It carries no message data: a change only means "poll now".
 * Missed or unavailable signals degrade to the caller's heartbeat. */
export type MessagesActivity = Readonly<{
  /** Resolves true on database activity since the last wait, false after maxMs. */
  wait(maxMs: number): Promise<boolean>;
  close(): void;
}>;

type Stat = (path: string) => Readonly<{ ino: bigint; size: bigint; mtimeNs: bigint }>;
const FILES = ["chat.db-wal", "chat.db"] as const;
const INTERVAL_MS = 100;

/**
 * File-system watchers do not report SQLite's in-place writes to chat.db and
 * its WAL on macOS, so this samples both files' inode, size and modification
 * time instead. A sample costs tens of microseconds and sees every committed
 * write within one interval, including a WAL that was replaced or reset.
 */
export function createMessagesActivity(options: { directory?: string; intervalMs?: number; stat?: Stat } = {}): MessagesActivity {
  const directory = options.directory ?? join(homedir(), "Library", "Messages");
  const stat: Stat = options.stat ?? (path => statSync(path, { bigint: true }));
  const waiters = new Set<(changed: boolean) => void>();
  let dirty = false, closed = false;
  const signature = (): string => FILES.map(name => {
    try { const value = stat(join(directory, name)); return `${value.ino}:${value.size}:${value.mtimeNs}`; }
    catch { return "absent"; }
  }).join("|");
  let last = signature();
  const sample = setInterval(() => {
    const current = signature();
    if (current === last) return;
    last = current;
    dirty = true;
    for (const resolve of waiters) resolve(true);
    waiters.clear();
  }, options.intervalMs ?? INTERVAL_MS);
  (sample as unknown as { unref?: () => void }).unref?.();
  return Object.freeze({
    wait(maxMs: number): Promise<boolean> {
      if (closed) return Promise.resolve(false);
      if (dirty) { dirty = false; return Promise.resolve(true); }
      return new Promise<boolean>(resolve => {
        const settle = (changed: boolean): void => { clearTimeout(timer); waiters.delete(settle); if (changed) dirty = false; resolve(changed); };
        const timer = setTimeout(() => settle(false), maxMs);
        (timer as unknown as { unref?: () => void }).unref?.();
        waiters.add(settle);
      });
    },
    close(): void {
      closed = true;
      clearInterval(sample);
      for (const resolve of waiters) resolve(false);
      waiters.clear();
    },
  });
}
