import type { DocumentsTxClient } from './documents-rows.js';

/**
 * Row locking for the numbering allocation path (Task 8 §11, ADR-0023).
 *
 * Allocation serializes on the series row: the counter is read and advanced
 * under `SELECT … FOR UPDATE`, so two concurrent allocations for one series
 * never receive the same serial. The `(series_id, number)` unique index on
 * `numbering_allocations` is the hard backstop — the lock makes collisions
 * impossible, the index makes a bug visible instead of silent.
 *
 * This is the module's documented concurrency-critical SQL path
 * (docs/database-strategy.md §13, AR-11): Prisma cannot express `SELECT … FOR
 * UPDATE`, hence the parameterized raw statement below.
 */

interface LockedSeriesRow {
  lastValue: bigint;
  strategy: string;
  width: number;
}

/** A locked series row, mapped from its aliased columns. */
interface LockedSeriesColumns {
  lastValue: bigint;
  strategy: string;
  width: number;
}

/**
 * Lock a series row and return the values the allocator needs. The lock is
 * held until the surrounding transaction commits or rolls back, so the
 * check-then-act (`last_value` → next serial → insert allocation → update
 * counter) is atomic for the series.
 *
 * @throws Error when the series row does not exist (a series deleted mid-flight
 *   is a bug — the service resolves the series inside the same transaction
 *   boundary and FK RESTRICT would prevent the delete).
 */
export async function lockSeriesRow(
  tx: DocumentsTxClient,
  seriesId: string,
): Promise<LockedSeriesRow> {
  const rows = await tx.$queryRaw<LockedSeriesColumns>`
    SELECT "last_value"  AS "lastValue",
           "strategy"    AS "strategy",
           "width"       AS "width"
      FROM "documents"."numbering_series"
     WHERE "id" = ${seriesId}
     FOR UPDATE`;
  const [row] = rows;
  if (row === undefined) {
    throw new Error(`Numbering series "${seriesId}" no longer exists.`);
  }
  return {
    lastValue: row.lastValue,
    strategy: row.strategy,
    width: row.width,
  };
}
