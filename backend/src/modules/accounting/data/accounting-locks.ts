import type { AccountingTxClient } from './accounting-rows.js';

/**
 * Row locking for the fiscal-calendar guard transactions (Task 10.2,
 * AC-I-03/AC-I-04).
 *
 * Every calendar write holds a parent-row lock from BEFORE its guard check
 * until commit; that single rule is what makes the overlap, boundary and
 * lifecycle guards race-safe:
 *
 * - two year writes for one area serialize on the area lock; the overlap
 *   check reads the winner's committed years, so check-then-act is atomic;
 * - two period writes for one year serialize on the year lock;
 * - a year close/seal holding the year lock sees exactly the committed
 *   periods — a concurrent period transition either committed before and
 *   is observed, or waits and evaluates after;
 * - an area disable holding the area lock (plus the area's year locks)
 *   sees every open year; a concurrent year create/reopen either committed
 *   first and blocks the disable, or waits and is refused against the
 *   disabled area.
 *
 * Lock ORDER is fixed everywhere and never reversed — area → year →
 * period — so no deadlock cycle exists: no transaction holding a year lock
 * ever waits on an area lock (year transitions lock the year only; period
 * writes lock the year, then the period), and multi-row locks always
 * ascend by id.
 *
 * Prisma cannot express `SELECT … FOR UPDATE`, hence the parameterized raw
 * statements below — the documented concurrency-critical path
 * (docs/modules.md §Accounting, AR-11).
 */

/** A locked financial-area row: the scope + usability the guards need. */
export interface LockedFinancialArea {
  id: string;
  organizationId: string;
  isDefault: boolean;
  isActive: boolean;
}

/** A locked fiscal-year row: scope + status + range the guards need. */
export interface LockedFiscalYear {
  id: string;
  organizationId: string;
  financialAreaId: string;
  status: string;
  isActive: boolean;
  startDate: Date;
  endDate: Date;
}

/** A locked accounting-period row: the routing + status the guards need. */
export interface LockedAccountingPeriod {
  id: string;
  fiscalYearId: string;
  status: string;
}

/**
 * Lock one financial-area row. The lock is held until the surrounding
 * transaction commits or rolls back, so the year-overlap check and the
 * year insert that follow are atomic for the area.
 *
 * @throws Error when the area row does not exist (an area deleted
 *   mid-flight is a bug — the service resolves the area inside the same
 *   operation boundary and areas are never deleted).
 */
export async function lockFinancialAreaRow(
  tx: AccountingTxClient,
  financialAreaId: string,
): Promise<LockedFinancialArea> {
  const rows = await tx.$queryRaw<LockedFinancialArea>`
    SELECT "id",
           "organization_id" AS "organizationId",
           "is_default"      AS "isDefault",
           "is_active"       AS "isActive"
      FROM "accounting"."financial_areas"
     WHERE "id" = ${financialAreaId}
     FOR UPDATE`;
  const [row] = rows;
  if (row === undefined) {
    throw new Error(`Financial area "${financialAreaId}" no longer exists.`);
  }
  return row;
}

/**
 * Lock every financial-area row of one organization, ascending by id.
 * Serializes concurrent "set default area" operations for the org so two
 * areas can never both end up flagged default.
 */
export async function lockFinancialAreasOfOrganization(
  tx: AccountingTxClient,
  organizationId: string,
): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }>`
    SELECT "id"
      FROM "accounting"."financial_areas"
     WHERE "organization_id" = ${organizationId}
     ORDER BY "id" ASC
     FOR UPDATE`;
  return rows.map((row) => row.id);
}

/**
 * Lock one fiscal-year row. The lock is held until commit, so the
 * period-overlap/boundary check and the period insert that follow are
 * atomic for the year, and so concurrent lifecycle moves of one year
 * serialize.
 *
 * @throws Error when the year row does not exist (same bug posture as the
 *   area lock above — the service pre-resolves, and years are never
 *   deleted).
 */
export async function lockFiscalYearRow(
  tx: AccountingTxClient,
  fiscalYearId: string,
): Promise<LockedFiscalYear> {
  const rows = await tx.$queryRaw<LockedFiscalYear>`
    SELECT "id",
           "organization_id"   AS "organizationId",
           "financial_area_id" AS "financialAreaId",
           "status"            AS "status",
           "is_active"         AS "isActive",
           "start_date"        AS "startDate",
           "end_date"          AS "endDate"
      FROM "accounting"."fiscal_years"
     WHERE "id" = ${fiscalYearId}
     FOR UPDATE`;
  const [row] = rows;
  if (row === undefined) {
    throw new Error(`Fiscal year "${fiscalYearId}" no longer exists.`);
  }
  return row;
}

/**
 * Lock every fiscal-year row of one area, ascending by id. The area
 * disable takes this (after the area lock) so its "no open years" guard
 * cannot miss a concurrent year reopen.
 */
export async function lockFiscalYearsOfArea(
  tx: AccountingTxClient,
  financialAreaId: string,
): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }>`
    SELECT "id"
      FROM "accounting"."fiscal_years"
     WHERE "financial_area_id" = ${financialAreaId}
     ORDER BY "id" ASC
     FOR UPDATE`;
  return rows.map((row) => row.id);
}

/**
 * Lock one accounting-period row. Period transitions take the year lock
 * first (for the year-level gate), then this lock — always in that order.
 *
 * @throws Error when the period row does not exist (same bug posture as
 *   above — the service pre-resolves, and periods are never deleted).
 */
export async function lockAccountingPeriodRow(
  tx: AccountingTxClient,
  periodId: string,
): Promise<LockedAccountingPeriod> {
  const rows = await tx.$queryRaw<LockedAccountingPeriod>`
    SELECT "id",
           "fiscal_year_id" AS "fiscalYearId",
           "status"         AS "status"
      FROM "accounting"."accounting_periods"
     WHERE "id" = ${periodId}
     FOR UPDATE`;
  const [row] = rows;
  if (row === undefined) {
    throw new Error(`Accounting period "${periodId}" no longer exists.`);
  }
  return row;
}

/**
 * Lock the open periods of one year, ascending by id. The year close
 * takes this (after the year lock) and closes exactly the locked rows in
 * the same transaction (contract §7.2 rule 6). The sequences come along
 * so the close events carry the true ordinals without a second read.
 */
export async function lockOpenPeriodsOfYear(
  tx: AccountingTxClient,
  fiscalYearId: string,
): Promise<Array<{ id: string; sequence: number }>> {
  const rows = await tx.$queryRaw<{ id: string; sequence: number }>`
    SELECT "id",
           "sequence" AS "sequence"
      FROM "accounting"."accounting_periods"
     WHERE "fiscal_year_id" = ${fiscalYearId}
       AND "status" = 'open'
     ORDER BY "id" ASC
     FOR UPDATE`;
  return rows.map((row) => ({ id: row.id, sequence: row.sequence }));
}
