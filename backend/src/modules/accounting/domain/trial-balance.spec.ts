import { describe, expect, it } from 'vitest';
import { toTrialBalanceRow } from './trial-balance.js';

describe('Trial Balance exact derivation', () => {
  it('reconciles opening, turnover, net and closing without floating point', () => {
    const row = toTrialBalanceRow({
      accountId: '01H0000000000000000000001',
      accountCode: '1101',
      accountName: 'Cash',
      role: 'POSTING',
      openingDebit: '0.10',
      openingCredit: '0.00',
      debit: '0.10',
      credit: '0.20',
    });

    expect(row).toMatchObject({
      opening: '0.1',
      debitTurnover: '0.1',
      creditTurnover: '0.2',
      periodNet: '-0.1',
      closing: '0',
    });
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
