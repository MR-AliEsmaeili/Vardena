import { describe, expect, it } from 'vitest';
import { sumAmounts } from './money.js';
import { toTrialBalanceRow } from './trial-balance.js';

describe('Trial Balance exact derivation', () => {
  it('reconciles authoritative Ledger aggregates to opening, turnover and closing without floating point', () => {
    // These are the exact debit/credit aggregates returned by the
    // ledger-native Task 18 query: opening facts plus the selected-period
    // turnover facts. The Task 12 projection is not a runtime input here.
    const ledgerFacts = {
      openingDebit: '100.10',
      openingCredit: '0.10',
      debit: '25.25',
      credit: '5.05',
    };
    const row = toTrialBalanceRow({
      accountId: '01H0000000000000000000001',
      accountCode: '1101',
      accountName: 'Cash',
      role: 'POSTING',
      ...ledgerFacts,
    });

    expect(row).toMatchObject({
      opening: '100',
      debitTurnover: '25.25',
      creditTurnover: '5.05',
      periodNet: '20.2',
      closing: '120.2',
    });
    expect(sumAmounts([row.opening, row.periodNet])).toBe(row.closing);
  });

  it('keeps the aggregation role explicit for descendant roll-up rows', () => {
    const row = toTrialBalanceRow({
      accountId: '01H0000000000000000000002',
      accountCode: '11',
      accountName: 'Current assets',
      role: 'AGGREGATION',
      openingDebit: '100.00',
      openingCredit: '0.00',
      debit: '25.00',
      credit: '5.00',
    });

    expect(row.role).toBe('AGGREGATION');
    expect(row.periodNet).toBe('20');
    expect(row.closing).toBe('120');
  });
});
