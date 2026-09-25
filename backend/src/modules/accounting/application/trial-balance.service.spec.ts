import { describe, expect, it, vi } from 'vitest';
import { TRIAL_BALANCE_PERMISSIONS } from '../domain/accounting-permissions.js';
import { TrialBalanceService } from './trial-balance.service.js';

const ORG = '01H0000000000000000000001';
const AREA = '01H0000000000000000000002';
const YEAR = '01H0000000000000000000003';
const ACCOUNT = '01H0000000000000000000004';
const ROOT = '01H0000000000000000000005';

function makeService(overrides: Record<string, unknown> = {}) {
  const read = {
    findFinancialArea: vi.fn(async () => ({
      id: AREA,
      code: 'MAIN',
      title: 'Main',
    })),
    findFiscalYear: vi.fn(async () => ({
      id: YEAR,
      financialAreaId: AREA,
      code: '2026',
      title: '2026',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      endDate: new Date('2026-12-31T00:00:00.000Z'),
      status: 'open',
    })),
    findPeriod: vi.fn(async () => null),
    listPeriodsOfYear: vi.fn(async () => []),
    findAccount: vi.fn(async (_organizationId: string, id: string) => ({
      id,
      code: id === ROOT ? '11' : '1101',
      title: id === ROOT ? 'Current assets' : 'Cash',
      isPostable: id !== ROOT,
      isActive: true,
    })),
    readTrialBalance: vi.fn(async () => ({
      total: 2,
      items: [
        {
          accountId: ACCOUNT,
          accountCode: '1101',
          accountName: 'Cash',
          role: 'POSTING' as const,
          openingDebit: '0.10',
          openingCredit: '0.00',
          debit: '0.10',
          credit: '0.20',
        },
        {
          accountId: ROOT,
          accountCode: '11',
          accountName: 'Current assets',
          role: 'AGGREGATION' as const,
          openingDebit: '0.10',
          openingCredit: '0.00',
          debit: '0.10',
          credit: '0.20',
        },
      ],
    })),
    ...overrides,
  };
  const organizations = {
    assertOrganizationInScope: vi.fn(),
    requireUsableOrganization: vi.fn(async () => undefined),
  };
  const authorization = {
    requireAllPermissions: vi.fn(async () => undefined),
  };
  return {
    service: new TrialBalanceService(
      read as never,
      organizations as never,
      authorization as never,
    ),
    read,
    authorization,
  };
}

const query = {
  organizationId: ORG,
  financialAreaId: AREA,
  fiscalYearId: YEAR,
  page: 1,
  pageSize: 100,
};

describe('TrialBalanceService', () => {
  it('uses the independent permission and returns posting plus aggregation rows', async () => {
    const { service, authorization } = makeService();
    const result = await service.list({ ...query, accountHierarchyId: ROOT });

    expect(authorization.requireAllPermissions).toHaveBeenCalledWith([
      TRIAL_BALANCE_PERMISSIONS.VIEW,
    ]);
    expect(result.items.map((item) => item.role)).toEqual([
      'POSTING',
      'AGGREGATION',
    ]);
    expect(result.items[1]?.closing).toBe('0');
  });

  it('accepts an allow-listed sort and rejects unsupported sorting before any read', async () => {
    const { service, read } = makeService();
    await service.list({ ...query, sort: 'closing:desc' });
    expect(read.readTrialBalance).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([{ field: 'closing', direction: 'desc' }]),
      0,
      100,
    );

    read.readTrialBalance.mockClear();
    await expect(
      service.list({ ...query, sort: 'accountCode;DROP TABLE ledger_entries' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(read.readTrialBalance).not.toHaveBeenCalled();
  });

  it('supports an empty, bounded result without inventing zero rows', async () => {
    const { service } = makeService({
      readTrialBalance: vi.fn(async () => ({ items: [], total: 0 })),
    });
    await expect(service.list(query)).resolves.toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
    });
  });
});
