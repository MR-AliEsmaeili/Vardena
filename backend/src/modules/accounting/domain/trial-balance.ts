import { canonicalizeAmount, subtractAmounts, sumAmounts } from './money.js';
import type { TrialBalanceReadRow } from '../data/accounting-read-query.repository.js';

/** One explicit POSTING or AGGREGATION trial-balance row. */
export interface TrialBalanceRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  role: 'POSTING' | 'AGGREGATION';
  opening: string;
  debitTurnover: string;
  creditTurnover: string;
  periodNet: string;
  closing: string;
}

/**
 * Derive the public measures from exact database aggregates. This is shared by
 * every Trial Balance presentation and never uses JavaScript floating point.
 */
export function toTrialBalanceRow(row: TrialBalanceReadRow): TrialBalanceRow {
  const openingDebit = canonicalizeAmount(row.openingDebit);
  const openingCredit = canonicalizeAmount(row.openingCredit);
  const debitTurnover = canonicalizeAmount(row.debit);
  const creditTurnover = canonicalizeAmount(row.credit);
  const opening = subtractAmounts(openingDebit, openingCredit);
  const periodNet = subtractAmounts(debitTurnover, creditTurnover);
  const closing = sumAmounts([opening, periodNet]);
  return {
    accountId: row.accountId,
    accountCode: row.accountCode,
    accountName: row.accountName,
    role: row.role,
    opening,
    debitTurnover,
    creditTurnover,
    periodNet,
    closing,
  };
}

export function toTrialBalanceRows(
  rows: readonly TrialBalanceReadRow[],
): TrialBalanceRow[] {
  return rows.map(toTrialBalanceRow);
}
