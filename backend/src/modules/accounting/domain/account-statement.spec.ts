import { describe, expect, it } from 'vitest';
import type { LedgerEntry } from './ledger-entry.js';
import { parseDateOnly } from './date-range.js';
import {
  ACCOUNT_STATEMENT_OPENING_BASIS,
  ACCOUNT_STATEMENT_ORDER_BASIS,
  ACCOUNT_STATEMENT_SIGN_CONVENTION,
  buildAccountStatement,
  buildStatementEntries,
  buildStatementTotals,
  netAmountOf,
  renderAccountRef,
  renderAreaRef,
  renderPeriodRef,
  renderYearRef,
  type AccountStatementScope,
} from './account-statement.js';

/**
 * Account Statement semantics (contract §8/§9/§13, AC-D-30/AC-D-31;
 * Owner decisions D1–D7).
 *
 * The rules under test are the ones a float or a page-local implementation
 * would silently break: `net = debit − credit` exactly (`0.3 − 0.1` is `0.2`,
 * not `0.19999999999999998`), the running balance continuing across pages
 * from `opening + Σ net` of every earlier row, `opening + net = closing` as an
 * asserted identity, totals over the whole window (never the current page),
 * and the three disclosures pinned to their decided values (D2/D3).
 */

const ORG = '01H0000000000000000000001';
const AREA = '01H0000000000000000000002';
const YEAR = '01H0000000000000000000003';
const PERIOD = '01H0000000000000000000004';
const ACCOUNT = '01H0000000000000000000005';

function makeEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: '01H0000000000000000000009',
    organizationId: ORG,
    financialAreaId: AREA,
    fiscalYearId: YEAR,
    accountingPeriodId: PERIOD,
    voucherId: '01H0000000000000000000006',
    voucherNumber: '00007',
    voucherLineId: '01H000000000000000000000A',
    lineNo: 1,
    accountId: ACCOUNT,
    debitAmount: '0',
    creditAmount: '0',
    description: null,
    documentDate: parseDateOnly('2026-04-05')!,
    postingTimestamp: new Date('2026-04-05T10:00:00.000Z'),
    branchId: null,
    origin: 'manual',
    source: null,
    correlationId: null,
    finalizedBy: null,
    dimensionAssignments: [],
    ...overrides,
  };
}

const SCOPE: AccountStatementScope = {
  organizationId: ORG,
  financialArea: renderAreaRef({ id: AREA, code: 'MAIN', title: 'اصلی' }),
  fiscalYear: renderYearRef({
    id: YEAR,
    code: '1404',
    title: 'سال ۱۴۰۴',
    startDate: parseDateOnly('2026-03-21')!,
    endDate: parseDateOnly('2027-03-20')!,
    status: 'open',
  }),
  account: renderAccountRef({
    id: ACCOUNT,
    code: '1101',
    title: 'صندوق',
  }),
  accountingPeriod: renderPeriodRef({
    id: PERIOD,
    sequence: 2,
    title: 'اردیبهشت',
    startDate: parseDateOnly('2026-04-21')!,
    endDate: parseDateOnly('2026-05-21')!,
    status: 'closed',
  }),
};

describe('account-statement net movement (debit-positive)', () => {
  it('is exactly debit − credit — never a binary float', () => {
    expect(netAmountOf('0.3', '0.1')).toBe('0.2');
    expect(netAmountOf('1250.5', '250.5')).toBe('1000');
    expect(netAmountOf('9999999999999999.99', '0')).toBe('9999999999999999.99');
  });

  it('signs a credit-only entry negative and a debit-only entry positive (D3)', () => {
    expect(netAmountOf('0', '1250.5')).toBe('-1250.5');
    expect(netAmountOf('1250.5', '0')).toBe('1250.5');
  });

  it('nets a zero entry to the canonical zero', () => {
    expect(netAmountOf('0', '0.00')).toBe('0');
    expect(netAmountOf('0.00', '0')).toBe('0');
  });
});

describe('buildStatementEntries', () => {
  it('stamps net and a running balance that continues from the page base', () => {
    const rows = buildStatementEntries(
      [
        makeEntry({
          id: '01H0000000000000000000001',
          debitAmount: '100.5',
          creditAmount: '0',
        }),
        makeEntry({
          id: '01H0000000000000000000002',
          debitAmount: '0',
          creditAmount: '40.25',
        }),
        makeEntry({
          id: '01H0000000000000000000003',
          debitAmount: '0.05',
          creditAmount: '0',
        }),
      ],
      '10',
    );
    expect(rows.map((row) => row.netAmount)).toEqual([
      '100.5',
      '-40.25',
      '0.05',
    ]);
    // 10 + 100.5 = 110.5; 110.5 − 40.25 = 70.25; 70.25 + 0.05 = 70.3 — exact.
    expect(rows.map((row) => row.runningBalanceAmount)).toEqual([
      '110.5',
      '70.25',
      '70.3',
    ]);
  });

  it('keeps one continuous history across pages (running base = opening + pre-page net)', () => {
    // Page 2 of the same window: its first running balance must equal the
    // last running balance of page 1 — no page-local reset.
    const page1 = buildStatementEntries(
      [makeEntry({ debitAmount: '30.1', creditAmount: '0' })],
      '0',
    );
    const page2 = buildStatementEntries(
      [
        makeEntry({ debitAmount: '0', creditAmount: '0.1' }),
        makeEntry({ debitAmount: '5', creditAmount: '0' }),
      ],
      page1[page1.length - 1]?.runningBalanceAmount ?? '0',
    );
    expect(page2[0]?.runningBalanceAmount).toBe('30');
    expect(page2[1]?.runningBalanceAmount).toBe('35');
  });

  it('handles the empty window and zero rows', () => {
    expect(buildStatementEntries([], '0')).toEqual([]);
    const zeroRows = buildStatementEntries(
      [makeEntry({ debitAmount: '0', creditAmount: '0' })],
      '0',
    );
    expect(zeroRows[0]?.netAmount).toBe('0');
    expect(zeroRows[0]?.runningBalanceAmount).toBe('0');
  });

  it('projects the accepted movement fields through unchanged', () => {
    const [row] = buildStatementEntries(
      [
        makeEntry({
          source: {
            module: 'treasury',
            entityType: 'cash_transaction',
            entityId: '01H00000000000000000000FF',
            operation: 'post_cash_transaction',
          },
          origin: 'system',
        }),
      ],
      '0',
    );
    expect(row).toMatchObject({
      id: '01H0000000000000000000009',
      organizationId: ORG,
      financialAreaId: AREA,
      fiscalYearId: YEAR,
      accountingPeriodId: PERIOD,
      voucherId: '01H0000000000000000000006',
      voucherNumber: '00007',
      voucherLineId: '01H000000000000000000000A',
      lineNo: 1,
      accountId: ACCOUNT,
      documentDate: '2026-04-05',
      postingTimestamp: '2026-04-05T10:00:00.000Z',
      description: null,
      debitAmount: '0',
      creditAmount: '0',
      // The source-document traceability snapshot travels intact.
      origin: 'system',
      sourceModule: 'treasury',
      sourceEntityType: 'cash_transaction',
      sourceEntityId: '01H00000000000000000000FF',
      sourceOperation: 'post_cash_transaction',
      netAmount: '0',
      runningBalanceAmount: '0',
    });
  });
});

describe('buildStatementTotals', () => {
  it('derives net and the closing identity opening + net = closing exactly', () => {
    const totals = buildStatementTotals({
      openingBalanceAmount: '1000.5',
      debitTotalAmount: '250.75',
      creditTotalAmount: '400.25',
    });
    expect(totals).toEqual({
      openingBalanceAmount: '1000.5',
      debitTotalAmount: '250.75',
      creditTotalAmount: '400.25',
      netChangeAmount: '-149.5',
      closingBalanceAmount: '851',
    });
  });

  it('zeroes an empty window (opening 0, no movement)', () => {
    expect(
      buildStatementTotals({
        openingBalanceAmount: '0',
        debitTotalAmount: '0',
        creditTotalAmount: '0',
      }),
    ).toEqual({
      openingBalanceAmount: '0',
      debitTotalAmount: '0',
      creditTotalAmount: '0',
      netChangeAmount: '0',
      closingBalanceAmount: '0',
    });
  });

  it('canonicalizes spellings and keeps exactness under mixed decimals', () => {
    const totals = buildStatementTotals({
      openingBalanceAmount: '12.00',
      debitTotalAmount: '0.30',
      creditTotalAmount: '0.10',
    });
    expect(totals.openingBalanceAmount).toBe('12');
    expect(totals.netChangeAmount).toBe('0.2');
    expect(totals.closingBalanceAmount).toBe('12.2');
  });

  it('uses the window sums — totals are page-independent by construction', () => {
    // The caller passes FULL-WINDOW aggregates; even when the page holds one
    // zero row, the totals report the window's exact sums (prompt §13).
    const statement = buildAccountStatement({
      scope: SCOPE,
      entries: [makeEntry({ debitAmount: '0', creditAmount: '0' })],
      runningBase: '40',
      windowTotal: 3,
      page: 2,
      pageSize: 1,
      openingBalanceAmount: '10',
      debitTotalAmount: '300',
      creditTotalAmount: '100',
    });
    expect(statement.totals.debitTotalAmount).toBe('300');
    expect(statement.totals.creditTotalAmount).toBe('100');
    expect(statement.totals.netChangeAmount).toBe('200');
    expect(statement.totals.closingBalanceAmount).toBe('210');
  });
});

describe('buildAccountStatement', () => {
  it('echoes the scope and pins the three disclosures (D2/D3)', () => {
    const statement = buildAccountStatement({
      scope: SCOPE,
      entries: [],
      runningBase: '0',
      windowTotal: 0,
      page: 1,
      pageSize: 100,
      openingBalanceAmount: '0',
      debitTotalAmount: '0',
      creditTotalAmount: '0',
    });
    expect(statement.scope).toEqual(SCOPE);
    expect(statement.signConvention).toBe(ACCOUNT_STATEMENT_SIGN_CONVENTION);
    expect(statement.signConvention).toBe('debit-positive');
    expect(statement.openingBasis).toBe(ACCOUNT_STATEMENT_OPENING_BASIS);
    expect(statement.openingBasis).toBe('intra-fiscal-year');
    expect(statement.orderBasis).toBe(ACCOUNT_STATEMENT_ORDER_BASIS);
    expect(statement.orderBasis).toBe('documentDate,voucherNumber,lineNo,id');
    expect(statement.movements).toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
    });
  });

  it('asserts the closing identity when the page covers the whole window', () => {
    // One row whose running balance lands exactly on closing: accepted.
    // (The service passes runningBase = opening + pre-page net = 100 here.)
    const statement = buildAccountStatement({
      scope: SCOPE,
      entries: [makeEntry({ debitAmount: '250', creditAmount: '50' })],
      runningBase: '100',
      windowTotal: 1,
      page: 1,
      pageSize: 100,
      openingBalanceAmount: '100',
      debitTotalAmount: '250',
      creditTotalAmount: '50',
    });
    expect(statement.movements.items[0]?.runningBalanceAmount).toBe('300');
    expect(statement.totals.closingBalanceAmount).toBe('300');
  });

  it('refuses to serialize a statement whose math disagrees (loudly, never silently)', () => {
    expect(() =>
      buildAccountStatement({
        scope: SCOPE,
        entries: [makeEntry({ debitAmount: '250', creditAmount: '50' })],
        runningBase: '100',
        windowTotal: 1,
        page: 1,
        pageSize: 100,
        openingBalanceAmount: '100',
        // Inconsistent window sums: closing would be 130 while the row runs to 300.
        debitTotalAmount: '80',
        creditTotalAmount: '50',
      }),
    ).toThrow(/closing identity/i);
  });

  it('does not demand last-row = closing on a partial page', () => {
    // Page 1 of 3 rows: the running balance legitimately stops short of the
    // closing balance — no assertion may fire here.
    const statement = buildAccountStatement({
      scope: SCOPE,
      entries: [makeEntry({ debitAmount: '250', creditAmount: '50' })],
      runningBase: '100',
      windowTotal: 3,
      page: 1,
      pageSize: 1,
      openingBalanceAmount: '100',
      debitTotalAmount: '750',
      creditTotalAmount: '50',
    });
    expect(statement.movements.items[0]?.runningBalanceAmount).toBe('300');
    expect(statement.totals.closingBalanceAmount).toBe('800');
  });
});

describe('scope rendering', () => {
  it('renders dates as YYYY-MM-DD and echoes status without re-validating it (D5)', () => {
    const year = renderYearRef({
      id: YEAR,
      code: '1404',
      title: 'سال ۱۴۰۴',
      startDate: parseDateOnly('2026-03-21')!,
      endDate: parseDateOnly('2027-03-20')!,
      status: 'sealed',
    });
    expect(year).toEqual({
      id: YEAR,
      code: '1404',
      title: 'سال ۱۴۰۴',
      startDate: '2026-03-21',
      endDate: '2027-03-20',
      status: 'sealed',
    });
    const period = renderPeriodRef({
      id: PERIOD,
      sequence: 1,
      title: 'فروردین',
      startDate: parseDateOnly('2026-03-21')!,
      endDate: parseDateOnly('2026-04-20')!,
      status: 'closed',
    });
    expect(period.startDate).toBe('2026-03-21');
    expect(period.sequence).toBe(1);
    expect(period.status).toBe('closed');
  });

  it('renders the account as code/title only — never a nature (D3)', () => {
    const account = renderAccountRef({
      id: ACCOUNT,
      code: '1101',
      title: 'صندوق',
    });
    expect(Object.keys(account).sort()).toEqual(['code', 'id', 'title']);
  });
});
