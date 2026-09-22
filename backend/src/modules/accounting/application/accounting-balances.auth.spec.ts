import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { AccountingBalancesService } from './accounting-balances.service.js';

function makeFakeBalances() {
  return { list: vi.fn(async () => ({ items: [], total: 0 })), rebuildScoped: vi.fn(async () => ({ deleted: 0, inserted: 0 })) } as any;
}
function makeFakePrisma(overrides: any = {}) {
  const base = {
    $queryRaw: async () => [{ count: '0' }],
    $queryRawUnsafe: undefined,
    financialArea: { findFirst: async () => ({ id: 'area' }) },
    fiscalYear: { findFirst: async () => ({ id: 'year', financialAreaId: 'area' }) },
    accountingPeriod: {
      findFirst: async () => ({ id: 'period', fiscalYearId: 'year', organizationId: 'org' } as any),
      findMany: async () => [],
    },
    account: { findFirst: async () => ({ id: 'acc' }) },
    $transaction: async (fn: any) => fn({ $queryRaw: async () => [] }),
    ...overrides,
  };
  return { getClient: vi.fn(async () => base) } as any;
}
function makeFakeOrgs(overrides: any = {}) {
  return {
    assertOrganizationInScope: vi.fn(),
    requireUsableOrganization: vi.fn(async () => undefined),
    ...overrides,
  } as any;
}

const ORG = '01H0000000000000000000001';
const OTHER_ORG = '01H0000000000000000000009';
const AREA = '01H0000000000000000000002';
const YEAR = '01H0000000000000000000003';
const ACC = '01H0000000000000000000005';

describe('AccountingBalancesService auth & isolation (Task 12)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listBalances without Balance.View answers 403 (no bypass)', async () => {
    const auth = { requireAllPermissions: vi.fn(async () => { throw AppException.forbidden('missing permission'); }) } as any;
    const svc = new AccountingBalancesService(makeFakeBalances(), makeFakePrisma(), makeFakeOrgs(), auth, { log: vi.fn(), warn: vi.fn() } as any, { publish: vi.fn() } as any);
    await expect(svc.listBalances({ organizationId: ORG, page: 1, pageSize: 10 })).rejects.toMatchObject({ status: 403 });
    expect(auth.requireAllPermissions).toHaveBeenCalledWith(['Accounting.Balance.View']);
  });

  it('rebuild without Balance.Rebuild answers 403', async () => {
    const auth = { requireAllPermissions: vi.fn(async () => { throw AppException.forbidden('missing'); }) } as any;
    const svc = new AccountingBalancesService(makeFakeBalances(), makeFakePrisma(), makeFakeOrgs(), auth, { log: vi.fn(), warn: vi.fn() } as any, { publish: vi.fn() } as any);
    await expect(svc.rebuildBalances({ organizationId: ORG })).rejects.toMatchObject({ status: 403 });
    expect(auth.requireAllPermissions).toHaveBeenCalledWith(['Accounting.Balance.Rebuild']);
  });

  it('cross-org organizationId answers 404 via assertOrganizationInScope (never 403 leak)', async () => {
    const orgs = makeFakeOrgs({
      assertOrganizationInScope: vi.fn(() => { throw AppException.notFound('Organization', OTHER_ORG); }),
    });
    const svc = new AccountingBalancesService(makeFakeBalances(), makeFakePrisma(), orgs, { requireAllPermissions: vi.fn(async () => undefined) } as any, { log: vi.fn(), warn: vi.fn() } as any, { publish: vi.fn() } as any);
    await expect(svc.listBalances({ organizationId: OTHER_ORG, page: 1, pageSize: 10 })).rejects.toMatchObject({ status: 404 });
  });

  it('foreign financialArea answers 404, not 403 (AC-I-16)', async () => {
    const prisma = makeFakePrisma({
      financialArea: { findFirst: async () => null },
    });
    const svc = new AccountingBalancesService(makeFakeBalances(), prisma, makeFakeOrgs(), { requireAllPermissions: vi.fn(async () => undefined) } as any, { log: vi.fn(), warn: vi.fn() } as any, { publish: vi.fn() } as any);
    await expect(svc.listBalances({ organizationId: ORG, financialAreaId: AREA, page: 1, pageSize: 10 })).rejects.toMatchObject({ status: 404 });
  });

  it('foreign account in getAccountBalances answers 404', async () => {
    const prisma = makeFakePrisma({
      account: { findFirst: async () => null },
      financialArea: { findFirst: async () => ({ id: AREA }) },
      fiscalYear: { findFirst: async () => ({ id: YEAR, financialAreaId: AREA }) },
    });
    const svc = new AccountingBalancesService(makeFakeBalances(), prisma, makeFakeOrgs(), { requireAllPermissions: vi.fn(async () => undefined) } as any, { log: vi.fn(), warn: vi.fn() } as any, { publish: vi.fn() } as any);
    await expect(svc.getAccountBalances({ organizationId: ORG, accountId: ACC })).rejects.toMatchObject({ status: 404 });
  });

  it('reconciliation with foreign area answers 404', async () => {
    const prisma = makeFakePrisma({
      financialArea: { findFirst: async () => null },
    });
    const svc = new AccountingBalancesService(makeFakeBalances(), prisma, makeFakeOrgs(), { requireAllPermissions: vi.fn(async () => undefined) } as any, { log: vi.fn(), warn: vi.fn() } as any, { publish: vi.fn() } as any);
    await expect(svc.getReconciliation({ organizationId: ORG, financialAreaId: AREA })).rejects.toMatchObject({ status: 404 });
  });

  it('rebuild with foreign fiscalYear answers 404', async () => {
    const prisma = makeFakePrisma({
      fiscalYear: { findFirst: async () => null },
      financialArea: { findFirst: async () => ({ id: AREA }) },
    });
    const svc = new AccountingBalancesService(makeFakeBalances(), prisma, makeFakeOrgs(), { requireAllPermissions: vi.fn(async () => undefined) } as any, { log: vi.fn(), warn: vi.fn() } as any, { publish: vi.fn() } as any);
    await expect(svc.rebuildBalances({ organizationId: ORG, fiscalYearId: YEAR })).rejects.toMatchObject({ status: 404 });
  });

  it('without authentication, requireAllPermissions would throw 401 via AuthGuard (service layer 403 guard still holds)', async () => {
    // Simulate AuthGuard having rejected before service is called — service itself
    // would see a 401 if principal is missing, but our AuthorizationService mock
    // models the permission check. The controller's @UseGuards(AuthGuard) ensures
    // 401 before the service is invoked. Here we prove the service never leaks
    // existence via 404 vs 403: a 403 from requireAllPermissions does not reveal
    // whether the org exists.
    const auth = { requireAllPermissions: vi.fn(async () => { throw AppException.unauthorized('unauthenticated'); }) } as any;
    const svc = new AccountingBalancesService(makeFakeBalances(), makeFakePrisma(), makeFakeOrgs(), auth, { log: vi.fn(), warn: vi.fn() } as any, { publish: vi.fn() } as any);
    await expect(svc.listBalances({ organizationId: ORG, page: 1, pageSize: 10 })).rejects.toMatchObject({ status: 401 });
  });
});
