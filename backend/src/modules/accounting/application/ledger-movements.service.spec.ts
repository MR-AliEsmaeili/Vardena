import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { LedgerEntriesRepository } from '../data/ledger-entries.repository.js';
import type { LedgerMovementFilter } from '../data/ledger-entries.repository.js';
import type { OrderBy } from '../data/accounting-rows.js';
import type { LedgerEntry } from '../domain/ledger-entry.js';
import { LEDGER_MOVEMENT_PERMISSIONS } from '../domain/accounting-permissions.js';
import { LedgerMovementsService } from './ledger-movements.service.js';
import { parseDateOnly } from '../domain/date-range.js';

/**
 * LedgerMovementsService — the Task 17A read source's application boundary.
 *
 * This suite pins the four things a reviewer must be able to check without a
 * database: the permission is required (and is the new movement code, not a
 * borrowed one), the organization scope is mandatory and resolved
 * server-side, every filter reaches the ONE read statement unchanged and
 * parameter-ready, and the ordering is whitelisted, total and paginated.
 */

const ORG = '01H0000000000000000000001';
const AREA = '01H0000000000000000000002';
const YEAR = '01H0000000000000000000003';
const PERIOD = '01H0000000000000000000004';
const ACCOUNT = '01H0000000000000000000005';
const VOUCHER = '01H0000000000000000000006';

function makeLedgerEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: '01H0000000000000000000009',
    organizationId: ORG,
    financialAreaId: AREA,
    fiscalYearId: YEAR,
    accountingPeriodId: PERIOD,
    voucherId: VOUCHER,
    voucherNumber: '00007',
    voucherLineId: '01H000000000000000000000A',
    lineNo: 1,
    accountId: ACCOUNT,
    debitAmount: '1250.5',
    creditAmount: '0',
    description: 'Rent',
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

interface CapturedListCall {
  filter: LedgerMovementFilter;
  orderBy: OrderBy;
  skip: number;
  take: number;
}

function makeService(
  options: {
    items?: LedgerEntry[];
    total?: number;
    authThrows?: unknown;
    orgs?: Record<string, unknown>;
  } = {},
): {
  service: LedgerMovementsService;
  ledger: { listMovements: ReturnType<typeof vi.fn> };
  capture: () => CapturedListCall;
} {
  const calls: CapturedListCall[] = [];
  const ledger = {
    listMovements: vi.fn(async (params: CapturedListCall) => {
      calls.push(params);
      return { items: options.items ?? [], total: options.total ?? 0 };
    }),
  };
  const authorization = {
    requireAllPermissions: vi.fn(async (codes: readonly string[]) => {
      if (options.authThrows !== undefined) throw options.authThrows;
      void codes;
    }),
  };
  const organizations = {
    assertOrganizationInScope: vi.fn(),
    requireUsableOrganization: vi.fn(async () => undefined),
  };
  if (options.orgs !== undefined) Object.assign(organizations, options.orgs);
  const service = new LedgerMovementsService(
    ledger as unknown as LedgerEntriesRepository,
    organizations as never,
    authorization as never,
  );
  return {
    service,
    ledger,
    capture: () => {
      const first = calls[0];
      if (first === undefined)
        throw new Error('no listMovements call captured');
      return first;
    },
  };
}

describe('LedgerMovementsService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires Accounting.LedgerMovement.View and answers 403 without it', async () => {
    const { service, ledger } = makeService({
      authThrows: AppException.forbidden(),
    });
    await expect(
      service.listMovements({ organizationId: ORG, page: 1, pageSize: 50 }),
    ).rejects.toMatchObject({ status: 403 });
    // The denial happens BEFORE any data access: no query is issued.
    expect(ledger.listMovements).not.toHaveBeenCalled();
  });

  it('is not satisfied by the balance or document read codes', async () => {
    const seen: string[][] = [];
    const service = new LedgerMovementsService(
      { listMovements: vi.fn(async () => ({ items: [], total: 0 })) } as never,
      {
        assertOrganizationInScope: vi.fn(),
        requireUsableOrganization: vi.fn(async () => undefined),
      } as never,
      {
        requireAllPermissions: vi.fn(async (codes: readonly string[]) => {
          seen.push([...codes]);
        }),
      } as never,
    );
    await service.listMovements({
      organizationId: ORG,
      page: 1,
      pageSize: 50,
    });
    expect(seen).toEqual([[LEDGER_MOVEMENT_PERMISSIONS.VIEW]]);
    expect(seen[0]).not.toContain('Accounting.Balance.View');
    expect(seen[0]).not.toContain('Accounting.Document.View');
  });

  it('resolves the organization server-side (pin + existence + usability)', async () => {
    const assertInScope = vi.fn();
    const requireUsable = vi.fn(async () => undefined);
    const { service } = makeService({
      orgs: {
        assertOrganizationInScope: assertInScope,
        requireUsableOrganization: requireUsable,
      },
    });
    await service.listMovements({ organizationId: ORG, page: 1, pageSize: 50 });
    expect(assertInScope).toHaveBeenCalledWith(ORG);
    expect(requireUsable).toHaveBeenCalledWith(ORG);
  });

  it('refuses an organization outside the deployment pin with 404 (never 403)', async () => {
    const { service, ledger } = makeService({
      orgs: {
        assertOrganizationInScope: vi.fn(() => {
          throw AppException.notFound('Organization', ORG);
        }),
      },
    });
    await expect(
      service.listMovements({ organizationId: ORG, page: 1, pageSize: 50 }),
    ).rejects.toMatchObject({ status: 404 });
    expect(ledger.listMovements).not.toHaveBeenCalled();
  });

  it('passes every filter through with the organization predicate first', async () => {
    const { service, capture } = makeService();
    const result = await service.listMovements({
      organizationId: ORG,
      financialAreaId: AREA,
      fiscalYearId: YEAR,
      accountingPeriodId: PERIOD,
      accountId: ACCOUNT,
      voucherId: VOUCHER,
      voucherNumber: '00007',
      dateFrom: '2026-04-01',
      dateTo: '2026-04-30',
      page: 2,
      pageSize: 25,
    });

    const call = capture();
    expect(call.filter).toEqual({
      organizationId: ORG,
      financialAreaId: AREA,
      fiscalYearId: YEAR,
      accountingPeriodId: PERIOD,
      accountId: ACCOUNT,
      voucherId: VOUCHER,
      voucherNumber: '00007',
      // Inclusive date-only bounds, parsed to UTC midnight — no timezone,
      // no date arithmetic (§12.3, AC-I-03).
      dateFrom: parseDateOnly('2026-04-01')!,
      dateTo: parseDateOnly('2026-04-30')!,
    });
    expect(call.skip).toBe(25);
    expect(call.take).toBe(25);
    expect(result).toEqual({ items: [], total: 0, page: 2, pageSize: 25 });
  });

  it('keeps the organization predicate when NO other filter is given', async () => {
    const { service, capture } = makeService();
    await service.listMovements({ organizationId: ORG, page: 1, pageSize: 50 });
    expect(capture().filter).toEqual({ organizationId: ORG });
  });

  it('orders by business date, serial and line, always ending in the unique id', async () => {
    const { service, capture } = makeService();
    await service.listMovements({ organizationId: ORG, page: 1, pageSize: 50 });
    expect(capture().orderBy).toEqual([
      { documentDate: 'asc' },
      { voucherNumber: 'asc' },
      { lineNo: 'asc' },
      { id: 'asc' },
    ]);
  });

  it('lets a client pick a whitelisted field but never remove the tie-breakers', async () => {
    const { service, capture } = makeService();
    await service.listMovements({
      organizationId: ORG,
      page: 1,
      pageSize: 50,
      sort: 'postingTimestamp:desc',
    });
    expect(capture().orderBy).toEqual([
      { postingTimestamp: 'desc' },
      { voucherNumber: 'asc' },
      { lineNo: 'asc' },
      { id: 'asc' },
    ]);
  });

  it('rejects a sort field outside the allow-list with a 400', async () => {
    const { service, ledger } = makeService();
    await expect(
      service.listMovements({
        organizationId: ORG,
        page: 1,
        pageSize: 50,
        // A real column — the repository must never receive it as an order key.
        sort: 'debitAmount:desc',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(ledger.listMovements).not.toHaveBeenCalled();
  });

  it('rejects a malformed business date with a 400 before querying', async () => {
    const { service, ledger } = makeService();
    await expect(
      service.listMovements({
        organizationId: ORG,
        page: 1,
        pageSize: 50,
        dateFrom: '2026-02-30',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(ledger.listMovements).not.toHaveBeenCalled();
  });

  it('returns exact decimal strings untouched by the service layer', async () => {
    const { service } = makeService({
      items: [
        makeLedgerEntry({
          debitAmount: '9999999999999999.99',
          creditAmount: '0',
        }),
      ],
      total: 1,
    });
    const result = await service.listMovements({
      organizationId: ORG,
      page: 1,
      pageSize: 50,
    });
    expect(result.items[0]?.debitAmount).toBe('9999999999999999.99');
    expect(result.items[0]?.creditAmount).toBe('0');
  });

  it('exposes no write path at all (insert-only ledger, AC-I-05/06)', () => {
    // The read source's repository is the ledger repository, and it carries no
    // update/delete method a service could mutate accounting through.
    const prototype = LedgerEntriesRepository.prototype as unknown as Record<
      string,
      unknown
    >;
    for (const method of [
      'update',
      'updateMany',
      'delete',
      'deleteMany',
      'upsert',
      'create',
      'createMany',
      'insertLedgerEntries',
    ]) {
      expect(prototype[method], method).toBeUndefined();
    }
    // …and the service owns exactly one public operation: the read.
    const serviceMethods = Object.getOwnPropertyNames(
      LedgerMovementsService.prototype,
    ).filter((name) => name !== 'constructor');
    expect(serviceMethods).toEqual(['listMovements']);
  });
});
