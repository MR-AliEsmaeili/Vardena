import type { AccountBalance } from '@/api/contracts';

/**
 * Chart input builders.
 *
 * The reference mockup draws six-period income/expense curves; the backend
 * exposes period-level turnover (projection), so the dashboard draws the
 * series the contract actually provides. Builders return NEUTRAL data — no
 * display strings — so the components compose labels from the i18n
 * dictionary and never inline literals (AR-F). Every numeric conversion at
 * the chart layer is display-only (chart coordinates), never a financial
 * result: the tooltip shows the exact decimal string via the central
 * formatter.
 */

export interface SeriesPoint {
  /** Exact decimal string — the authoritative value. */
  value: string;
}

/** Debit/credit per period, sequence-ordered, for the two-series chart. */
export function buildTurnoverSeries(rows: AccountBalance[]): {
  /** Period sequences in ascending order — labels are composed by the UI. */
  sequences: number[];
  debit: string[];
  credit: string[];
} {
  const byPeriod = new Map<number, { debit: string; credit: string }>();
  for (const row of rows) {
    const bucket = byPeriod.get(row.periodSequence);
    if (bucket === undefined) {
      byPeriod.set(row.periodSequence, {
        debit: row.periodDebitAmount,
        credit: row.periodCreditAmount,
      });
    } else {
      bucket.debit = bucket.debit === ''
        ? row.periodDebitAmount
        : bucket.debit;
      bucket.credit = bucket.credit === ''
        ? row.periodCreditAmount
        : bucket.credit;
    }
  }
  const ordered = [...byPeriod.entries()].sort((a, b) => a[0] - b[0]);
  return {
    sequences: ordered.map(([sequence]) => sequence),
    debit: ordered.map(([, bucket]) => bucket.debit),
    credit: ordered.map(([, bucket]) => bucket.credit),
  };
}
