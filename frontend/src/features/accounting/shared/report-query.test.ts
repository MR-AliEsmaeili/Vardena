import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildAccountStatementQuery } from '../account-statement/use-account-statement';
import { buildGeneralLedgerQuery } from '../general-ledger/use-general-ledger';
import { buildTrialBalanceQuery } from '../trial-balance/use-trial-balance';
import {
  emptyLedgerScope,
  ledgerScopeSchema,
  optionalParam,
  statementScopeSchema,
} from './report-filters';
import { sortingToParam, useReportQueryState } from './use-report-query-state';

describe('report filter schemas', () => {
  it('requires the scope the backend requires', () => {
    const result = ledgerScopeSchema.safeParse(emptyLedgerScope);
    expect(result.success).toBe(false);
    const issues = result.success
      ? []
      : result.error.issues.map((i) => i.path[0]);
    expect(issues).toContain('financialAreaId');
    expect(issues).toContain('fiscalYearId');
  });

  it('accepts only the backend date-only format', () => {
    const base = {
      ...emptyLedgerScope,
      financialAreaId: 'area-1',
      fiscalYearId: 'year-1',
    };

    expect(
      ledgerScopeSchema.safeParse({ ...base, dateFrom: '2026-04-01' }).success,
    ).toBe(true);
    expect(ledgerScopeSchema.safeParse({ ...base, dateFrom: '' }).success).toBe(
      true,
    );
    expect(
      ledgerScopeSchema.safeParse({ ...base, dateFrom: '1405/01/12' }).success,
    ).toBe(false);
    expect(
      ledgerScopeSchema.safeParse({ ...base, dateTo: '2026-4-1' }).success,
    ).toBe(false);
  });

  it('requires an account and a fiscal year for a statement', () => {
    const result = statementScopeSchema.safeParse({
      financialAreaId: '',
      fiscalYearId: '',
      accountingPeriodId: '',
      accountId: '',
    });
    expect(result.success).toBe(false);
  });

  it('turns an untouched filter into "not sent"', () => {
    expect(optionalParam('')).toBeUndefined();
    expect(optionalParam('   ')).toBeUndefined();
    expect(optionalParam(' 1010 ')).toBe('1010');
  });
});

describe('query building', () => {
  const filters = {
    ...emptyLedgerScope,
    financialAreaId: 'area-1',
    fiscalYearId: 'year-1',
    accountCode: '1010',
  };

  it('sends only the parameters the General Ledger endpoint declares', () => {
    const query = buildGeneralLedgerQuery('org-1', filters, 2, 50, [
      { id: 'documentDate', desc: true },
    ]) as Record<string, unknown>;

    expect(query['organizationId']).toBe('org-1');
    expect(query['financialAreaId']).toBe('area-1');
    expect(query['fiscalYearId']).toBe('year-1');
    expect(query['accountCode']).toBe('1010');
    expect(query['sort']).toBe('documentDate:desc');
    expect(query['page']).toBe(2);
    expect(query['accountId']).toBeUndefined();
    expect(query['dateFrom']).toBeUndefined();
  });

  it('builds the same scope for the Trial Balance with its own sort field', () => {
    const query = buildTrialBalanceQuery('org-1', filters, 1, 100, [
      { id: 'closing', desc: true },
    ]) as Record<string, unknown>;

    expect(query['sort']).toBe('closing:desc');
    expect(query['pageSize']).toBe(100);
  });

  it('never sends a sort for the account statement (fixed server order)', () => {
    const query = buildAccountStatementQuery(
      'org-1',
      {
        financialAreaId: '',
        fiscalYearId: 'year-1',
        accountingPeriodId: '',
        accountId: 'acc-2',
      },
      1,
      50,
    ) as Record<string, unknown>;

    expect(query).not.toHaveProperty('sort');
    expect(query['accountId']).toBe('acc-2');
    expect(query['fiscalYearId']).toBe('year-1');
    expect(query['financialAreaId']).toBeUndefined();
    expect(query['accountingPeriodId']).toBeUndefined();
  });
});

describe('sortingToParam', () => {
  it('serializes the table sort into the backend format', () => {
    expect(sortingToParam([])).toBeUndefined();
    expect(sortingToParam([{ id: 'accountCode', desc: false }])).toBe(
      'accountCode:asc',
    );
    expect(
      sortingToParam([
        { id: 'documentDate', desc: false },
        { id: 'accountCode', desc: true },
      ]),
    ).toBe('documentDate:asc,accountCode:desc');
  });
});

describe('useReportQueryState', () => {
  it('returns to page 1 whenever filters, sort or page size change', () => {
    const { result } = renderHook(() => useReportQueryState<{ a: string }>());

    act(() => result.current.setPage(4));
    expect(result.current.page).toBe(4);

    act(() => result.current.apply({ a: 'x' }));
    expect(result.current.page).toBe(1);
    expect(result.current.applied).toEqual({ a: 'x' });

    act(() => result.current.setPage(3));
    act(() => result.current.setSorting([{ id: 'accountCode', desc: true }]));
    expect(result.current.page).toBe(1);

    act(() => result.current.setPage(2));
    act(() => result.current.setPageSize(200));
    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(200);

    act(() => result.current.clear());
    expect(result.current.applied).toBeNull();
  });
});
