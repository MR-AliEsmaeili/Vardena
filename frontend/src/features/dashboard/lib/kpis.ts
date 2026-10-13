import { formatAmount, formatCount } from '@/lib/format';
import type { AccountBalance } from '@/api/contracts';

/**
 * KPI aggregation over the Balance Projection rows.
 *
 * **These are display summaries of backend-derived data, not business
 * calculations.** Every row carries exact decimal strings derived by the
 * backend (`periodDebitAmount`, `periodCreditAmount`, `periodNetAmount` —
 * §19.3, ADR-0031). Summing is a pure string transformation here: digits are
 * never parsed into a float, and the result is again an exact decimal string
 * rendered through the central formatter. This mirrors what the backend's
 * own reports would return for the same window; the backend remains the
 * authority over every balance.
 */

/** Add two signed decimal strings digit-exactly (no float parsing). */
export function sumDecimalStrings(a: string, b: string): string {
  const parse = (value: string) => {
    const trimmed = value.trim();
    const negative = trimmed.startsWith('-');
    const unsigned = trimmed.replace(/^[+-]/, '');
    const [integer = '0', fraction = ''] = unsigned.split('.');
    return { negative, integer: integer || '0', fraction };
  };

  const left = parse(a);
  const right = parse(b);
  const fractionLength = Math.max(left.fraction.length, right.fraction.length);
  const scale = (value: ReturnType<typeof parse>) => {
    const digits = value.integer + value.fraction.padEnd(fractionLength, '0');
    const magnitude = BigInt(digits || '0');
    return value.negative ? -magnitude : magnitude;
  };

  const scaledSum = scale(left) + scale(right);
  const negative = scaledSum < 0n;
  const magnitude = (negative ? -scaledSum : scaledSum)
    .toString()
    .padStart(fractionLength + 1, '0');
  const integer =
    fractionLength === 0
      ? magnitude
      : magnitude.slice(0, -fractionLength) || '0';
  const fraction =
    fractionLength === 0 ? '' : `.${magnitude.slice(-fractionLength)}`;

  return `${negative ? '-' : ''}${integer}${fraction}`;
}

export interface DashboardKpis {
  /** Σ debit turnover of the scoped periods. */
  totalDebit: string;
  /** Σ credit turnover of the scoped periods. */
  totalCredit: string;
  /** Σ of the backend-derived period nets. */
  totalNet: string;
  /** Grouped turnover per accounting period, ordered by period sequence. */
  periodTurnover: Array<{
    periodId: string;
    periodSequence: number;
    debit: string;
    credit: string;
    net: string;
  }>;
}

function addDecimal(value: string, into: string): string {
  return value === '' ? into : sumDecimalStrings(into, value);
}

/**
 * Aggregate the projection rows into the dashboard KPI set. The input is the
 * backend page (`items`) — absence of rows is absence of turnover (AC-I-19c),
 * so an empty chart reads as zeros rather than an error.
 */
export function aggregateKpis(rows: AccountBalance[]): DashboardKpis {
  const byPeriod = new Map<
    string,
    { periodSequence: number; debit: string; credit: string; net: string }
  >();

  let totalDebit = '0';
  let totalCredit = '0';
  let totalNet = '0';

  for (const row of rows) {
    totalDebit = addDecimal(row.periodDebitAmount, totalDebit);
    totalCredit = addDecimal(row.periodCreditAmount, totalCredit);
    totalNet = addDecimal(row.periodNetAmount, totalNet);

    const bucket = byPeriod.get(row.accountingPeriodId);
    if (bucket === undefined) {
      byPeriod.set(row.accountingPeriodId, {
        periodSequence: row.periodSequence,
        debit: row.periodDebitAmount,
        credit: row.periodCreditAmount,
        net: row.periodNetAmount,
      });
    } else {
      bucket.debit = addDecimal(row.periodDebitAmount, bucket.debit);
      bucket.credit = addDecimal(row.periodCreditAmount, bucket.credit);
      bucket.net = addDecimal(row.periodNetAmount, bucket.net);
    }
  }

  const periodTurnover = [...byPeriod.values()]
    .sort((a, b) => a.periodSequence - b.periodSequence)
    .map((bucket) => ({ periodId: String(bucket.periodSequence), ...bucket }));

  return { totalDebit, totalCredit, totalNet, periodTurnover };
}

/** Grouped presentation for the KPI cards — formatted at the edge only. */
export interface KpiPresentation {
  debit: string;
  credit: string;
  net: string;
  netNegative: boolean;
}

export function presentKpis(kpis: DashboardKpis): KpiPresentation {
  return {
    debit: formatAmount(kpis.totalDebit),
    credit: formatAmount(kpis.totalCredit),
    net: formatAmount(kpis.totalNet),
    netNegative: kpis.totalNet.trim().startsWith('-'),
  };
}

/** Top accounts by absolute turnover magnitude for the ranked chart. */
export function topAccountsByTurnover(
  rows: AccountBalance[],
  limit = 5,
): Array<{ accountId: string; total: string }> {
  const byAccount = new Map<string, string>();
  for (const row of rows) {
    const debit = row.periodDebitAmount === '' ? '0' : row.periodDebitAmount;
    const credit = row.periodCreditAmount === '' ? '0' : row.periodCreditAmount;
    const current = byAccount.get(row.accountId) ?? '0';
    byAccount.set(
      row.accountId,
      addDecimal(debit, addDecimal(credit, current)),
    );
  }
  return [...byAccount.entries()]
    .sort((a, b) => {
      const [aInteger = '0', aFraction = ''] = a[1]
        .replace(/^[+-]/, '')
        .split('.');
      const [bInteger = '0', bFraction = ''] = b[1]
        .replace(/^[+-]/, '')
        .split('.');
      const fractionLength = Math.max(aFraction.length, bFraction.length);
      const aMagnitude = BigInt(
        aInteger + aFraction.padEnd(fractionLength, '0'),
      );
      const bMagnitude = BigInt(
        bInteger + bFraction.padEnd(fractionLength, '0'),
      );
      return aMagnitude === bMagnitude ? 0 : aMagnitude > bMagnitude ? -1 : 1;
    })
    .slice(0, limit)
    .map(([accountId, total]) => ({ accountId, total }));
}

/** Human-safe count formatting for sub-labels (never money). */
export function formatKpiCount(value: number): string {
  return formatCount(value);
}
