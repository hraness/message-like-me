import { statSync, watch, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Wakes the poll loop as soon as Messages writes its database instead of on a
 * fixed timer. It carries no message data: a change only means "poll now".
 * Missed or unavailable events degrade to the caller's heartbeat. */
export type MessagesActivity = Readonly<{
  /** Resolves true on database activity since the last wait, false after maxMs. */
  wait(maxMs: number): Promise<boolean>;
  close(): void;
}>;

type Watch = (path: string, listener: (event: string) => void) => FSWatcher;
const FILES = ["chat.db-wal", "chat.db"] as const;

export function createMessagesActivity(options: { directory?: string; watch?: Watch } = {}): MessagesActivity {
  const directory = options.directory ?? join(homedir(), "Library", "Messages");
  const watchFile: Watch = options.watch ?? ((path, listener) => watch(path, { persistent: false }, event => listener(event)));
  const watchers = new Map<string, { watcher: FSWatcher; identity: string }>();
  const waiters = new Set<(changed: boolean) => void>();
  let dirty = false, closed = false;
  const fire = (): void => {
    dirty = true;
    for (const resolve of waiters) resolve(true);
    waiters.clear();
  };
  const drop = (name: string): void => {
    const entry = watchers.get(name);
    if (entry === undefined) return;
    watchers.delete(name);
    try { entry.watcher.close(); } catch { /* Already closed. */ }
  };
  // SQLite may replace or truncate the WAL. A watcher reporting "rename" (the
  // file was deleted or moved) is dropped, and any identity change re-arms,
  // so a recreated file is watched again even when its inode number is reused.
  const arm = (): void => {
    if (closed) return;
    for (const name of FILES) {
      const path = join(directory, name);
      let identity: string;
      try { const stats = statSync(path); identity = `${stats.dev}:${stats.ino}`; }
      catch { drop(name); continue; }
      if (watchers.get(name)?.identity === identity) continue;
      drop(name);
      try {
        const watcher = watchFile(path, event => { if (event === "rename") drop(name); fire(); });
        watcher.on("error", () => { drop(name); fire(); });
        watchers.set(name, { watcher, identity });
      } catch { /* Unwatchable (e.g. no access): the heartbeat still polls. */ }
    }
  };
  arm();
  return Object.freeze({
    wait(maxMs: number): Promise<boolean> {
      arm();
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
      for (const name of [...watchers.keys()]) drop(name);
      for (const resolve of waiters) resolve(false);
      waiters.clear();
    },
  });
}
