import { Pool, type PoolClient } from "pg";
import { ulid } from "ulid";
export class Database {
  readonly pool: Pool;
  constructor(url: string) {
    this.pool = new Pool({
      connectionString: url,
      max: 10,
      connectionTimeoutMillis: 3000,
      statement_timeout: 10000,
    });
    // Never log connection strings or query parameters.
    this.pool.on("error", () =>
      console.error("Owner database connection error."),
    );
  }
  async transaction<T>(work: (tx: PoolClient) => Promise<T>): Promise<T> {
    const tx = await this.pool.connect();
    try {
      await tx.query("BEGIN");
      const value = await work(tx);
      await tx.query("COMMIT");
      return value;
    } catch (error) {
      await tx.query("ROLLBACK");
      throw error;
    } finally {
      tx.release();
    }
  }
  async close() {
    await this.pool.end();
  }
}
export interface Audit {
  actor: string | null;
  type: string;
  targetType: string;
  targetId: string | null;
  outcome?: "SUCCESS" | "DENIED";
  reason?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}
// Callers pass explicitly selected safe fields, never body/user/session objects.
export async function audit(tx: PoolClient, e: Audit) {
  await tx.query(
    `INSERT INTO owner.audit_events(id,actor_id,event_type,target_type,target_id,outcome,reason,before_state,after_state)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      ulid(),
      e.actor,
      e.type,
      e.targetType,
      e.targetId,
      e.outcome ?? "SUCCESS",
      e.reason ?? null,
      e.before ?? null,
      e.after ?? null,
    ],
  );
}
