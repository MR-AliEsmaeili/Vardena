import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AccountingBalancesService } from '../application/accounting-balances.service.js';
import { AccountingBalancesController } from './accounting-balances.controller.js';

// Reuse same helpers as service pagination spec — but now go through the controller
// to prove the HTTP contract (query DTO → service → DTO) also keeps opening exact.
function makeFakeBalances(listImpl: any) {
  return { list: listImpl, rebuildScoped: vi.fn() } as any;
}
function makeFakePrisma(getClientImpl: any) {
  return { getClient: getClientImpl } as any;
}
function makeFakeOrgs() {
  return {
    assertOrganizationInScope: vi.fn(),
    requireUsableOrganization: vi.fn().mockResolvedValue(undefined),
  } as any;
}
function makeFakeAuth() {
  return { requireAllPermissions: vi.fn().mockResolvedValue(undefined) } as any;
}

const ORG = '01H0000000000000000000001';
const AREA = '01H0000000000000000000002';
const YEAR = '01H0000000000000000000003';
const P1 = '01H0000000000000000000004';
const P2 = '01H0000000000000000000005';
const P3 = '01H0000000000000000000006';
const ACC = '01H0000000000000000000007';

function makeProjection(periodId: string, debit: string, credit: string) {
  return {
    id: `id-${periodId}`,
    organizationId: ORG,
    financialAreaId: AREA,
    fiscalYearId: YEAR,
    accountingPeriodId: periodId,
    accountId: ACC,
    periodDebitAmount: debit,
    periodCreditAmount: credit,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    createdBy: null,
    updatedBy: null,
  };
}

async function makeControllerVia(prisma: any, balances: any) {
  const service = new AccountingBalancesService(
    balances,
    prisma,
    makeFakeOrgs(),
    makeFakeAuth(),
    { log: vi.fn(), warn: vi.fn() } as any,
    { publish: vi.fn() } as any,
  );
  return new AccountingBalancesController(service as any);
}

describe('AccountingBalancesController pagination regression (Task 12 R-02 via controller)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('GET /balances paginated via controller keeps opening exact on page 2 (view primary path)', async () => {
    const viewRows = [
      { id: `id-${P1}`, organizationId: ORG, financialAreaId: AREA, fiscalYearId: YEAR, accountingPeriodId: P1, periodSequence: 1, accountId: ACC, periodDebitAmount: '100.00', periodCreditAmount: '0', periodNetAmount: '100.00', openingBalanceAmount: '0', closingBalanceAmount: '100.00', createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z') },
      { id: `id-${P2}`, organizationId: ORG, financialAreaId: AREA, fiscalYearId: YEAR, accountingPeriodId: P2, periodSequence: 2, accountId: ACC, periodDebitAmount: '50.00', periodCreditAmount: '0', periodNetAmount: '50.00', openingBalanceAmount: '100.00', closingBalanceAmount: '150.00', createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z') },
      { id: `id-${P3}`, organizationId: ORG, financialAreaId: AREA, fiscalYearId: YEAR, accountingPeriodId: P3, periodSequence: 3, accountId: ACC, periodDebitAmount: '25.00', periodCreditAmount: '0', periodNetAmount: '25.00', openingBalanceAmount: '150.00', closingBalanceAmount: '175.00', createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z') },
    ];

    const prisma = makeFakePrisma(async () => ({
      $queryRaw: async (strings: any) => {
        if (String(strings[0] ?? '').includes('COUNT(*)')) return [{ count: '3' }];
        return [];
      },
      $queryRawUnsafe: async (_sql: string, ...vals: any[]) => {
        const take = vals[5] as number;
        const skip = vals[6] as number;
        return viewRows.slice(skip, skip + take);
      },
      financialArea: { findFirst: async () => ({ id: AREA }) },
      fiscalYear: { findFirst: async () => ({ id: YEAR, financialAreaId: AREA }) },
      accountingPeriod: { findFirst: async () => ({ id: P1 }) },
      account: { findFirst: async () => ({ id: ACC }) },
    }));

    const balances = makeFakeBalances(vi.fn());
    const controller = await makeControllerVia(prisma, balances);

    // page 1
    const page1 = await controller.list({ organizationId: ORG, page: 1, pageSize: 1, sort: undefined, financialAreaId: undefined, fiscalYearId: undefined, accountingPeriodId: undefined, accountId: undefined } as any);
    expect(page1.items[0]!.accountingPeriodId).toBe(P1);
    expect(page1.items[0]!.openingBalanceAmount).toBe('0');
    expect(page1.items[0]!.closingBalanceAmount).toBe('100');
    expect(page1.total).toBe(3);

    // page 2 — opening must be cumulative prior (100), not 0
    const page2 = await controller.list({ organizationId: ORG, page: 2, pageSize: 1, sort: undefined, financialAreaId: undefined, fiscalYearId: undefined, accountingPeriodId: undefined, accountId: undefined } as any);
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0]!.accountingPeriodId).toBe(P2);
    expect(page2.items[0]!.openingBalanceAmount).toBe('100');
    expect(page2.items[0]!.closingBalanceAmount).toBe('150');

    // page 3 — opening 150
    const page3 = await controller.list({ organizationId: ORG, page: 3, pageSize: 1, sort: undefined, financialAreaId: undefined, fiscalYearId: undefined, accountingPeriodId: undefined, accountId: undefined } as any);
    expect(page3.items[0]!.accountingPeriodId).toBe(P3);
    expect(page3.items[0]!.openingBalanceAmount).toBe('150');
    expect(page3.items[0]!.closingBalanceAmount).toBe('175');
  });

  it('GET /balances fallback (no view) via controller keeps opening exact on page 2 (derive-before-pagination)', async () => {
    const all = [makeProjection(P1, '100.00', '0'), makeProjection(P2, '50.00', '0'), makeProjection(P3, '25.00', '0')];
    const balances = makeFakeBalances(
      vi.fn(async ({ skip, take }: any) => {
        if (skip === 0 && (take === 5000 || take === 10000)) return { items: all, total: all.length };
        return { items: [], total: 0 };
      }),
    );
    // Base client that has the period findMany and throws on view query
    const baseClient: any = {
      $queryRaw: async () => { throw new Error('view not available in fake'); },
      $queryRawUnsafe: undefined,
      accountingPeriod: {
        findMany: async () => [
          { id: P1, fiscalYearId: YEAR, sequence: 1 },
          { id: P2, fiscalYearId: YEAR, sequence: 2 },
          { id: P3, fiscalYearId: YEAR, sequence: 3 },
        ],
        findFirst: async () => ({ id: P1 }),
      },
      financialArea: { findFirst: async () => ({ id: AREA }) },
      fiscalYear: { findFirst: async () => ({ id: YEAR, financialAreaId: AREA }) },
      account: { findFirst: async () => ({ id: ACC }) },
    };
    const prisma = makeFakePrisma(async () => baseClient);

    const controller = await makeControllerVia(prisma, balances);

    const page2 = await controller.list({ organizationId: ORG, page: 2, pageSize: 1, sort: undefined, financialAreaId: undefined, fiscalYearId: undefined, accountingPeriodId: undefined, accountId: undefined } as any);
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0]!.accountingPeriodId).toBe(P2);
    expect(page2.items[0]!.openingBalanceAmount).toBe('100');
    expect(page2.items[0]!.closingBalanceAmount).toBe('150');
    expect(page2.total).toBe(3);
  });
});
