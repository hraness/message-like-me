import type { Database } from "bun:sqlite";
import { identifier, provider, safeInteger, type AgentProvider } from "./validation.ts";

export type AccountLease = Readonly<{ provider: AgentProvider; accountId: string; owner: string; generation: number; expiresAt: number }>;
export interface AccountLeaseStore {
  acquire(input: { provider: AgentProvider; accountId: string; owner: string; now: number; ttlMs: number }): AccountLease;
  renew(lease: AccountLease, now: number, ttlMs: number): AccountLease;
  release(lease: AccountLease): boolean;
}

type Row = { provider: AgentProvider; account_id: string; owner: string | null; generation: number; expires_at: number };

/**
 * Shared host database, outside every agent workspace. A heartbeat deadline is
 * diagnostic, never permission to steal custody from a possibly live process.
 */
export class SqliteAccountLeases implements AccountLeaseStore {
  constructor(private readonly db: Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS agentrouter_account_leases (
      provider TEXT NOT NULL, account_id TEXT NOT NULL, owner TEXT,
      generation INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      PRIMARY KEY(provider, account_id)
    )`);
  }

  acquire(input: { provider: AgentProvider; accountId: string; owner: string; now: number; ttlMs: number }): AccountLease {
    const p = provider(input.provider), id = identifier(input.accountId), owner = identifier(input.owner);
    const expiresAt = expiry(input.now, input.ttlMs);
    const row = this.db.query<Row, [string, string, string, number]>(`INSERT INTO agentrouter_account_leases
      (provider, account_id, owner, generation, expires_at) VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(provider, account_id) DO UPDATE SET owner=excluded.owner,
        generation=generation+1, expires_at=excluded.expires_at
      WHERE agentrouter_account_leases.owner IS NULL RETURNING *`).get(p, id, owner, expiresAt);
    if (row === null) throw new Error("ACCOUNT_BUSY_OR_RECOVERY_REQUIRED");
    return leaseFrom(row);
  }

  renew(lease: AccountLease, now: number, ttlMs: number): AccountLease {
    validateLease(lease);
    const expiresAt = expiry(now, ttlMs);
    const row = this.db.query<Row, [number, string, string, string, number, number]>(`UPDATE agentrouter_account_leases
      SET expires_at=? WHERE provider=? AND account_id=? AND owner=? AND generation=? AND expires_at=? RETURNING *`)
      .get(expiresAt, lease.provider, lease.accountId, lease.owner, lease.generation, lease.expiresAt);
    if (row === null) throw new Error("STALE_ACCOUNT_LEASE");
    return leaseFrom(row);
  }

  /** Call only after the adapter proves its provider process/controller stopped. */
  release(lease: AccountLease): boolean {
    validateLease(lease);
    const result = this.db.query(`UPDATE agentrouter_account_leases SET owner=NULL, expires_at=0
      WHERE provider=? AND account_id=? AND owner=? AND generation=? AND expires_at=?`)
      .run(lease.provider, lease.accountId, lease.owner, lease.generation, lease.expiresAt);
    return result.changes === 1;
  }

  inspect(providerValue: AgentProvider, accountId: string): AccountLease | null {
    const row = this.db.query<Row, [string, string]>("SELECT * FROM agentrouter_account_leases WHERE provider=? AND account_id=?")
      .get(provider(providerValue), identifier(accountId));
    return row === null || row.owner === null ? null : leaseFrom(row);
  }

  /** Host recovery supplies independent process custody evidence; no automatic TTL recovery. */
  async recover(lease: AccountLease, proveStopped: (lease: AccountLease) => Promise<boolean>): Promise<boolean> {
    validateLease(lease);
    if (!(await proveStopped(Object.freeze({ ...lease })))) throw new Error("ACCOUNT_PROCESS_STOP_UNPROVEN");
    return this.release(lease);
  }
}

function expiry(now: number, ttlMs: number): number {
  safeInteger(now, 0, Number.MAX_SAFE_INTEGER - 3_600_000);
  return now + safeInteger(ttlMs, 1_000, 3_600_000);
}
function validateLease(lease: AccountLease): void {
  provider(lease.provider); identifier(lease.accountId); identifier(lease.owner);
  safeInteger(lease.generation, 1, Number.MAX_SAFE_INTEGER); safeInteger(lease.expiresAt, 0, Number.MAX_SAFE_INTEGER);
}
function leaseFrom(row: Row): AccountLease {
  if (row.owner === null) throw new Error("ACCOUNT_LEASE_RELEASED");
  const lease = { provider: row.provider, accountId: row.account_id, owner: row.owner, generation: row.generation, expiresAt: row.expires_at };
  validateLease(lease);
  return Object.freeze(lease);
}
