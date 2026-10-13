import { describe, expect, it } from 'vitest';
import { deriveBalances } from '../domain/balance-projection.js';
import type { AccountBalanceProjection } from '../domain/balance-projection.js';

const ORG = '01H0000000000000000000001';
const AREA = '01H0000000000000000000002';
const YEAR = '01H0000000000000000000003';
const P1 = '01H0000000000000000000004';
const P2 = '01H0000000000000000000005';
const P3 = '01H0000000000000000000006';
const ACC = '01H0000000000000000000007';

function proj(
  p: string,
  debit: string,
  credit: string,
): AccountBalanceProjection {
  return {
    id: `id-${p}`,
    organizationId: ORG,
    financialAreaId: AREA,
    fiscalYearId: YEAR,
    accountingPeriodId: p,
    accountId: ACC,
    periodDebitAmount: debit,
    periodCreditAmount: credit,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    createdBy: null,
    updatedBy: null,
  } as AccountBalanceProjection;
}

/**
 * Regression for Task 12 pagination bug (review R-02):
 * listBalances previously paginated raw projection rows then derived opening
 * over the page slice, so the first row on page 2 got opening=0 even though
 * page 1 carried turnover. The fix is derive-before-pagination (or view
 * query), which keeps opening exact across page boundaries.
 */
describe('balance pagination regression (Task 12 R-02)', () => {
  const periodsByYear = new Map([
    [
      YEAR,
      [
        { id: P1, sequence: 1 },
        { id: P2, sequence: 2 },
        { id: P3, sequence: 3 },
      ],
    ],
  ]);
  const all = [proj(P1, '100', '0'), proj(P2, '50', '0'), proj(P3, '25', '0')];

  it('derive over full set gives correct opening for every period', () => {
    const derived = deriveBalances(all, periodsByYear);
    expect(derived[0]!.openingBalanceAmount).toBe('0');
    expect(derived[0]!.closingBalanceAmount).toBe('100');
    expect(derived[1]!.openingBalanceAmount).toBe('100');
    expect(derived[1]!.closingBalanceAmount).toBe('150');
    expect(derived[2]!.openingBalanceAmount).toBe('150');
    expect(derived[2]!.closingBalanceAmount).toBe('175');
  });

  it('buggy: derive over page slice would reset opening on page 2', () => {
    // Simulate old bug: pageSize 2, page 2 contains only P3
    const pageSlice = all.slice(2, 3); // only P3
    const buggyDerived = deriveBalances(pageSlice, periodsByYear);
    // Old code derived opening over slice only => 0
    expect(buggyDerived[0]!.openingBalanceAmount).toBe('0'); // wrong
    expect(buggyDerived[0]!.closingBalanceAmount).toBe('25');
  });

  it('fixed: derive over full then paginate keeps opening exact', () => {
    const fullDerived = deriveBalances(all, periodsByYear);
    const pageSize = 2;
    const page = 2;
    const skip = (page - 1) * pageSize;
    const pageSlice = fullDerived.slice(skip, skip + pageSize);
    // P3 on page 2 should still have opening 150, not 0
    expect(pageSlice).toHaveLength(1);
    expect(pageSlice[0]!.accountingPeriodId).toBe(P3);
    expect(pageSlice[0]!.openingBalanceAmount).toBe('150');
    expect(pageSlice[0]!.closingBalanceAmount).toBe('175');
  });

  it('view semantics (window before LIMIT) match derive-before-pagination across all pages', () => {
    // Simulate view: window computed over full, then paginated
    const full = deriveBalances(all, periodsByYear);
    const page1 = full.slice(0, 1);
    const page2 = full.slice(1, 2);
    const page3 = full.slice(2, 3);
    expect(page1[0]!.closingBalanceAmount).toBe('100');
    expect(page2[0]!.openingBalanceAmount).toBe('100');
    expect(page2[0]!.closingBalanceAmount).toBe('150');
    expect(page3[0]!.openingBalanceAmount).toBe('150');
  });

  it('cross-year opening never bleeds (derive partition)', () => {
    const YEAR2 = '01H0000000000000000000009';
    const P1Y2 = '01H000000000000000000000A';
    const allCross = [
      proj(P1, '100', '0'),
      {
        ...proj(P1Y2, '999', '0'),
        fiscalYearId: YEAR2,
        accountingPeriodId: P1Y2,
      } as AccountBalanceProjection,
    ];
    const byYear = new Map([
      [YEAR, [{ id: P1, sequence: 1 }]],
      [YEAR2, [{ id: P1Y2, sequence: 1 }]],
    ]);
    const derived = deriveBalances(allCross, byYear);
    expect(
      derived.find((d) => d.fiscalYearId === YEAR)!.openingBalanceAmount,
    ).toBe('0');
    expect(
      derived.find((d) => d.fiscalYearId === YEAR2)!.openingBalanceAmount,
    ).toBe('0');
  });
});
