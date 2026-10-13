import { describe, expect, it } from 'vitest';
import { testAccountBalances } from '@/test/fixtures';
import { buildTurnoverSeries } from './chart-series';

describe('buildTurnoverSeries', () => {
  it('sums every account row in a period with exact decimal arithmetic', () => {
    const rows = [
      { ...testAccountBalances[0]!, periodDebitAmount: '10.125' },
      {
        ...testAccountBalances[1]!,
        periodDebitAmount: '0.875',
        periodCreditAmount: '2.50',
      },
    ];

    expect(buildTurnoverSeries(rows)).toEqual({
      sequences: [1],
      debit: ['11.000'],
      credit: ['3003.00'],
    });
  });
});
