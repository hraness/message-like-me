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

type Watcher = Pick<FSWatcher, "close" | "on">;
type Watch = (path: string, listener: (event: string, name: string | null) => void) => Watcher;
const FILES = ["chat.db-wal", "chat.db"] as const;

export function createMessagesActivity(options: { directory?: string; watch?: Watch } = {}): MessagesActivity {
  const directory = options.directory ?? join(homedir(), "Library", "Messages");
  const watchPath: Watch = options.watch ?? ((path, listener) => watch(path, { persistent: false }, (event, name) => listener(event, typeof name === "string" ? name : null)));
  const watchers = new Map<string, { watcher: Watcher; identity: string }>();
  let directoryWatcher: Watcher | undefined;
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
  // SQLite may replace or truncate the WAL. File watchers see writes (macOS
  // reports none for a directory); the directory watcher sees an entry being
  // deleted or recreated, which drops that file's watcher so the next wait
  // re-arms it even when the filesystem reuses the old inode number.
  const arm = (): void => {
    if (closed) return;
    if (directoryWatcher === undefined) {
      try {
        const watcher = watchPath(directory, (event, name) => {
          if (name === null || !(FILES as readonly string[]).includes(name)) return;
          if (event === "rename") drop(name);
          fire();
        });
        watcher.on("error", () => { try { watcher.close(); } catch { /* Already closed. */ } if (directoryWatcher === watcher) directoryWatcher = undefined; fire(); });
        directoryWatcher = watcher;
      } catch { /* Absent or unwatchable store: file watchers and the heartbeat remain. */ }
    }
    for (const name of FILES) {
      const path = join(directory, name);
      let identity: string;
      try { const stats = statSync(path); identity = `${stats.dev}:${stats.ino}`; }
      catch { drop(name); continue; }
      if (watchers.get(name)?.identity === identity) continue;
      drop(name);
      try {
        const watcher = watchPath(path, event => { if (event === "rename") drop(name); fire(); });
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
      try { directoryWatcher?.close(); } catch { /* Already closed. */ }
      directoryWatcher = undefined;
      for (const resolve of waiters) resolve(false);
      waiters.clear();
    },
  });
}
