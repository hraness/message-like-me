import { Database } from "bun:sqlite";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type RunState = "running" | "dispatching" | "submitted" | "failed" | "partial" | "indeterminate" | "cancelled" | "ignored" | "abandoned";
export type RunRecord = Readonly<{ id: string; contactId: string; eventId: string; state: RunState; reason: string; planDigest: string | null; startedAt: number; updatedAt: number }>;

/** Trusted daemon state, outside agent workspaces. One process owns recovery. */
export class RunJournal {
  private constructor(private readonly database: Database) {
    database.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, contactId TEXT NOT NULL, eventId TEXT NOT NULL,
        state TEXT NOT NULL, reason TEXT NOT NULL, planDigest TEXT, startedAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL,
        UNIQUE(contactId, eventId)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_contact ON runs(contactId) WHERE state IN ('running','dispatching');`);
  }
  static async open(path: string): Promise<RunJournal> {
    const absolute = resolve(path);
    const parent = dirname(absolute);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const dir = await lstat(parent);
    if (await realpath(parent) !== parent || !dir.isDirectory() || dir.uid !== process.getuid?.() || (dir.mode & 0o077) !== 0) throw new Error("Journal directory must be owned and private");
    // SQLite opens sibling sidecars itself; preflight every existing path before opening.
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      try {
        const info = await lstat(`${absolute}${suffix}`);
        if (!info.isFile() || info.isSymbolicLink() || info.uid !== dir.uid || info.nlink !== 1 || (info.mode & 0o077) !== 0) throw new Error("Unsafe journal file");
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    const handle = await open(absolute, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
    await handle.close();
    return new RunJournal(new Database(absolute, { strict: true }));
  }
  static memory(): RunJournal { return new RunJournal(new Database(":memory:", { strict: true })); }
  claim(id: string, contactId: string, eventId: string, now: number): boolean {
    // Check uncertainty in the same statement that claims the contact. Another run
    // may settle while this caller awaits provider readiness or account admission.
    return this.database.query(`INSERT OR IGNORE INTO runs
      SELECT ?, ?, ?, 'running', 'claimed', NULL, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM runs WHERE contactId = ? AND state IN ('partial','indeterminate'))`)
      .run(id, contactId, eventId, now, now, contactId).changes === 1;
  }
  transition(id: string, expected: RunState, state: RunState, reason: string, now: number, planDigest: string | null = null): void {
    if (reason.length > 400 || (planDigest !== null && !/^[a-f0-9]{64}$/u.test(planDigest))) throw new Error("Invalid journal transition");
    const result = this.database.query("UPDATE runs SET state = ?, reason = ?, updatedAt = ?, planDigest = COALESCE(?, planDigest) WHERE id = ? AND state = ?").run(state, reason, now, planDigest, id, expected);
    if (result.changes !== 1) throw new Error("Run state changed");
  }
  recover(now: number): void {
    this.database.transaction(() => {
      this.database.query("UPDATE runs SET state = 'abandoned', reason = 'daemon-restarted', updatedAt = ? WHERE state = 'running'").run(now);
      this.database.query("UPDATE runs SET state = 'indeterminate', reason = 'restart-during-dispatch', updatedAt = ? WHERE state = 'dispatching'").run(now);
    })();
  }
  hasUncertainSend(contactId: string): boolean {
    return this.database.query("SELECT 1 FROM runs WHERE contactId = ? AND state IN ('partial','indeterminate') LIMIT 1").get(contactId) !== null;
  }
  repliesSince(contactId: string, since: number): number {
    const row = this.database.query<{ count: number }, [string, number]>("SELECT COUNT(*) AS count FROM runs WHERE contactId = ? AND startedAt >= ? AND state IN ('dispatching','submitted','partial','indeterminate')").get(contactId, since);
    return row?.count ?? 0;
  }
  recent(contactId: string, limit = 50): readonly RunRecord[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error("Invalid activity limit");
    return this.database.query<RunRecord, [string, number]>("SELECT * FROM runs WHERE contactId = ? ORDER BY startedAt DESC, id DESC LIMIT ?").all(contactId, limit);
  }
  close(): void { this.database.close(); }
}
