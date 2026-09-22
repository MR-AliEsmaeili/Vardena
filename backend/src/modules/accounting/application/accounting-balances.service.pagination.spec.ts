import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AccountingBalancesService } from './accounting-balances.service.js';

// Minimal fakes for service constructor
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

function makeProjection(periodId: string, debit: string, credit: string, _seq?: number) {
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

describe('AccountingBalancesService pagination (Task 12 view vs derive)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('derive-before-pagination keeps opening exact when page 2 is requested (fallback path)', async () => {
    const all = [makeProjection(P1, '100.00', '0'), makeProjection(P2, '50.00', '0'), makeProjection(P3, '25.00', '0')];
    const balances = makeFakeBalances(
      vi.fn(async ({ skip, take }: any) => {
        // fallback path fetches skip 0 take 10000 => return all
        if (skip === 0 && take === 10000) return { items: all, total: all.length };
        // the initial view-probe would have been attempted, but we force it to fail
        return { items: [], total: 0 };
      }),
    );
    // Prisma that throws on view probe (no view in fake), forcing fallback
    const prisma = makeFakePrisma(async () => ({
      $queryRaw: async () => { throw new Error('view not available in fake'); },
      $queryRawUnsafe: undefined,
      accountingPeriod: { findMany: async () => [{ id: P1, fiscalYearId: YEAR, sequence: 1 }, { id: P2, fiscalYearId: YEAR, sequence: 2 }, { id: P3, fiscalYearId: YEAR, sequence: 3 }] },
    }));
    // Mock scope checks to pass (they call findFirst on financialArea etc.)
    // Add those to the getClient result as well
    const baseClient = await prisma.getClient();
    const extendedGetClient = async () => ({
      ...baseClient,
      financialArea: { findFirst: async () => ({ id: AREA }) },
      fiscalYear: { findFirst: async () => ({ id: YEAR, financialAreaId: AREA }) },
      accountingPeriod: {
        findMany: async () => [{ id: P1, fiscalYearId: YEAR, sequence: 1 }, { id: P2, fiscalYearId: YEAR, sequence: 2 }, { id: P3, fiscalYearId: YEAR, sequence: 3 }],
        findFirst: async () => ({ id: P1 }),
      },
      account: { findFirst: async () => ({ id: ACC }) },
      $queryRaw: async () => { throw new Error('view not available'); },
    });
    prisma.getClient = extendedGetClient;

    const service = new AccountingBalancesService(balances, prisma, makeFakeOrgs(), makeFakeAuth(), { log: vi.fn(), warn: vi.fn() } as any, { publish: vi.fn() } as any);

    const result = await service.listBalances({ organizationId: ORG, page: 2, pageSize: 1 });
    // Page 2 with size 1 => second period (P2) should have opening 100 (from P1), not 0
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.accountingPeriodId).toBe(P2);
    expect(result.items[0]!.openingBalanceAmount).toBe('100');
    expect(result.items[0]!.closingBalanceAmount).toBe('150');
    expect(result.total).toBe(3);
  });

  it('view path returns already-derived opening/closing with correct SQL pagination', async () => {
    // Mock view rows as PG would return (window already applied)
    const viewRows = [
      { id: `id-${P1}`, organizationId: ORG, financialAreaId: AREA, fiscalYearId: YEAR, accountingPeriodId: P1, periodSequence: 1, accountId: ACC, periodDebitAmount: '100.00', periodCreditAmount: '0', periodNetAmount: '100.00', openingBalanceAmount: '0', closingBalanceAmount: '100.00', createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z') },
      { id: `id-${P2}`, organizationId: ORG, financialAreaId: AREA, fiscalYearId: YEAR, accountingPeriodId: P2, periodSequence: 2, accountId: ACC, periodDebitAmount: '50.00', periodCreditAmount: '0', periodNetAmount: '50.00', openingBalanceAmount: '100.00', closingBalanceAmount: '150.00', createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z') },
      { id: `id-${P3}`, organizationId: ORG, financialAreaId: AREA, fiscalYearId: YEAR, accountingPeriodId: P3, periodSequence: 3, accountId: ACC, periodDebitAmount: '25.00', periodCreditAmount: '0', periodNetAmount: '25.00', openingBalanceAmount: '150.00', closingBalanceAmount: '175.00', createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z') },
    ];
    const prisma = makeFakePrisma(async () => ({
      $queryRaw: async (strings: any, ..._vals: any[]) => {
        const sql = String(strings[0] ?? '');
        if (sql.includes('COUNT(*)')) return [{ count: '3' }];
        // data page - return slice based on LIMIT/OFFSET via _vals? Our service uses $queryRawUnsafe for data page,
        // but the fallback $queryRaw path also exists. Make $queryRaw return empty to force $queryRawUnsafe path?
        return [];
      },
      $queryRawUnsafe: async (sql: string, ...vals: any[]) => {
        if (sql.includes('COUNT(*)')) return [{ count: '3' }];
        // LIMIT $6 OFFSET $7 are vals[5], vals[6]
        const take = vals[5] as number;
        const skip = vals[6] as number;
        return viewRows.slice(skip, skip + take);
      },
      financialArea: { findFirst: async () => ({ id: AREA }) },
      fiscalYear: { findFirst: async () => ({ id: YEAR, financialAreaId: AREA }) },
      accountingPeriod: { findFirst: async () => ({ id: P1 }) },
      account: { findFirst: async () => ({ id: ACC }) },
    }));
    // Ensure getClient returns same for both calls (count + data share same impl)
    const balances = makeFakeBalances(vi.fn());
    const service = new AccountingBalancesService(balances, prisma, makeFakeOrgs(), makeFakeAuth(), { log: vi.fn(), warn: vi.fn() } as any, { publish: vi.fn() } as any);

    const page2 = await service.listBalances({ organizationId: ORG, page: 2, pageSize: 1 });
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0]!.accountingPeriodId).toBe(P2);
    expect(page2.items[0]!.openingBalanceAmount).toBe('100');
    expect(page2.total).toBe(3);

    const page3 = await service.listBalances({ organizationId: ORG, page: 3, pageSize: 1 });
    expect(page3.items[0]!.openingBalanceAmount).toBe('150');
  });
});
