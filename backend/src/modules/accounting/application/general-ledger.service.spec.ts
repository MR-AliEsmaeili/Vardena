import { describe, expect, it, vi } from 'vitest';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { GENERAL_LEDGER_PERMISSIONS } from '../domain/accounting-permissions.js';
import { GeneralLedgerService } from './general-ledger.service.js';

const ORG = '01H0000000000000000000001';
const AREA = '01H0000000000000000000002';
const YEAR = '01H0000000000000000000003';
const PERIOD = '01H0000000000000000000004';
const ACCOUNT = '01H0000000000000000000005';

const area = { id: AREA, code: 'MAIN', title: 'Main' };
const year = {
  id: YEAR,
  financialAreaId: AREA,
  code: '2026',
  title: '2026',
  startDate: new Date('2026-01-01T00:00:00.000Z'),
  endDate: new Date('2026-12-31T00:00:00.000Z'),
  status: 'sealed',
};
const period = {
  id: PERIOD,
  sequence: 1,
  title: 'January',
  startDate: new Date('2026-01-01T00:00:00.000Z'),
  endDate: new Date('2026-01-31T00:00:00.000Z'),
  status: 'closed',
};

function makeService(overrides: Record<string, unknown> = {}) {
  const read = {
    findFinancialArea: vi.fn(async () => area),
    findFiscalYear: vi.fn(async () => year),
    findPeriod: vi.fn(async () => period),
    listPeriodsOfYear: vi.fn(async () => [period]),
    findAccount: vi.fn(async () => ({
      id: ACCOUNT,
      code: '1101',
      title: 'Cash',
      isPostable: true,
      isActive: true,
    })),
    readGeneralLedger: vi.fn(async () => ({
      total: 1,
      items: [
        {
          id: '01H0000000000000000000006',
          organizationId: ORG,
          financialAreaId: AREA,
          fiscalYearId: YEAR,
          accountingPeriodId: PERIOD,
          documentDate: '2026-01-02',
          postingTimestamp: '2026-01-02T10:00:00.000Z',
          documentType: 'accounting_voucher',
          documentId: '01H0000000000000000000007',
          ledgerLineId: '01H0000000000000000000008',
          voucherLineId: '01H0000000000000000000008',
          accountId: ACCOUNT,
          accountCode: '1101',
          accountName: 'Cash',
          reference: null,
          description: 'Opening movement',
          debit: '0.10',
          credit: '0.20',
          net: '-0.1',
          voucherNumber: '00001',
          sourceModule: null,
          sourceEntityType: null,
          sourceEntityId: null,
          sourceOperation: null,
          lineNo: 1,
          origin: 'manual',
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
    service: new GeneralLedgerService(
      read as never,
      organizations as never,
      authorization as never,
    ),
    read,
    organizations,
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

describe('GeneralLedgerService', () => {
  it('uses its independent permission and preserves exact source references', async () => {
    const { service, authorization } = makeService();
    const result = await service.list(query);

    expect(authorization.requireAllPermissions).toHaveBeenCalledWith([
      GENERAL_LEDGER_PERMISSIONS.VIEW,
    ]);
    expect(result.items[0]).toMatchObject({
      documentType: 'accounting_voucher',
      documentId: '01H0000000000000000000007',
      ledgerEntryId: '01H0000000000000000000006',
      ledgerLineId: '01H0000000000000000000008',
      voucherLineId: '01H0000000000000000000008',
      lineNo: 1,
      origin: 'manual',
      debit: '0.1',
      credit: '0.2',
      net: '-0.1',
    });
  });

  it('accepts an allow-listed sort and rejects arbitrary SQL fields', async () => {
    const { service, read } = makeService();
    await service.list({ ...query, sort: 'accountCode:desc' });
    expect(read.readGeneralLedger).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([{ field: 'accountCode', direction: 'desc' }]),
      0,
      100,
    );

    read.readGeneralLedger.mockClear();
    await expect(
      service.list({ ...query, sort: 'createdAt:desc' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(read.readGeneralLedger).not.toHaveBeenCalled();
  });

  it('does not read when the requested area is outside the resolved year', async () => {
    const { service, read } = makeService({
      findFinancialArea: vi.fn(async () => ({
        id: '01H0000000000000000000009',
        code: 'OTHER',
        title: 'Other',
      })),
    });
    await expect(service.list(query)).rejects.toMatchObject({ status: 422 });
    expect(read.readGeneralLedger).not.toHaveBeenCalled();
  });

  it('rejects a date range that crosses the fiscal-year boundary', async () => {
    const { service } = makeService();
    await expect(
      service.list({ ...query, dateFrom: '2025-12-31' }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('does not bypass the organization scope before the shared read query', async () => {
    const { service, read, organizations } = makeService({
      findFinancialArea: vi.fn(async () => area),
    });
    organizations.assertOrganizationInScope.mockImplementation(() => {
      throw AppException.notFound('Organization', ORG);
    });
    await expect(service.list(query)).rejects.toMatchObject({ status: 404 });
    expect(read.readGeneralLedger).not.toHaveBeenCalled();
  });

  it('enforces the shared hard row bound before any report read', async () => {
    const { service, read } = makeService();
    await expect(
      service.list({ ...query, page: 101, pageSize: 500 }),
    ).rejects.toMatchObject({ status: 400 });
    expect(read.readGeneralLedger).not.toHaveBeenCalled();
  });
});
