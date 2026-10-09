import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { AccountStatementsRepository } from '../data/account-statements.repository.js';
import type {
  AccountStatementLedgerFacts,
  StatementAccountRef,
  StatementAreaRef,
  StatementPeriodRef,
  StatementYearRef,
} from '../data/account-statements.repository.js';
import type { LedgerEntry } from '../domain/ledger-entry.js';
import { ACCOUNT_STATEMENT_PERMISSIONS } from '../domain/accounting-permissions.js';
import { AccountStatementsService } from './account-statements.service.js';
import { parseDateOnly } from '../domain/date-range.js';

/**
 * AccountStatementsService — the statement's application boundary (Task 17B,
 * Owner decisions D1–D7).
 *
 * This suite pins the things a reviewer must be able to check without a
 * database: the permission is required (and is the NEW statement code, not a
 * borrowed reader code — D6); the organization scope is server-derived and
 * answers 404/422 per the established posture; every scope key is resolved
 * organization-first with the AC-I-16 error matrix (foreign/unknown → 404,
 * scope contradiction → 422); `sort` is refused 400 (the running balance
 * defines the order — §11); the opening is intra-year/sequence-based (D2);
 * totals come from the full-window aggregates and the running base continues
 * across pages; and the read surface exposes NO write path (D7, AC-I-19).
 */

const ORG = '01H0000000000000000000001';
const AREA = '01H0000000000000000000002';
const YEAR = '01H0000000000000000000003';
const PERIOD = '01H0000000000000000000004';
const PERIOD_PRIOR = '01H0000000000000000000014';
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

const ACCOUNT_REF: StatementAccountRef = {
  id: ACCOUNT,
  code: '1101',
  title: 'صندوق',
  isPostable: true,
  isActive: true,
};
const AREA_REF: StatementAreaRef = { id: AREA, code: 'MAIN', title: 'اصلی' };
const YEAR_REF: StatementYearRef = {
  id: YEAR,
  financialAreaId: AREA,
  code: '1404',
  title: 'سال ۱۴۰۴',
  startDate: parseDateOnly('2026-03-21')!,
  endDate: parseDateOnly('2027-03-20')!,
  status: 'open',
};
const PERIOD_REF: StatementPeriodRef = {
  id: PERIOD,
  sequence: 2,
  title: 'اردیبهشت',
  startDate: parseDateOnly('2026-04-21')!,
  endDate: parseDateOnly('2026-05-21')!,
  status: 'closed',
};
const PERIOD_REF_PRIOR: StatementPeriodRef = {
  id: PERIOD_PRIOR,
  sequence: 1,
  title: 'فروردین',
  startDate: parseDateOnly('2026-03-21')!,
  endDate: parseDateOnly('2026-04-20')!,
  status: 'sealed',
};

function emptyFacts(
  overrides: Partial<AccountStatementLedgerFacts> = {},
): AccountStatementLedgerFacts {
  return {
    total: 0,
    debitTotal: '0',
    creditTotal: '0',
    priorPeriodDebit: '0',
    priorPeriodCredit: '0',
    prePageAmounts: [],
    rows: [],
    ...overrides,
  };
}

interface CapturedFactsCall {
  params: {
    window: Record<string, unknown>;
    priorPeriodIds: readonly string[];
  };
  skip: number;
  take: number;
}

function makeService(
  options: {
    facts?: Partial<AccountStatementLedgerFacts>;
    authThrows?: unknown;
    orgs?: Record<string, unknown>;
    account?: StatementAccountRef | null;
    area?: StatementAreaRef | null;
    year?: StatementYearRef | null;
    period?: StatementPeriodRef | null;
    periods?: StatementPeriodRef[];
  } = {},
): {
  service: AccountStatementsService;
  repository: Record<string, ReturnType<typeof vi.fn>>;
  factsCalls: () => CapturedFactsCall[];
} {
  const factsCalls: CapturedFactsCall[] = [];
  const repository: Record<string, ReturnType<typeof vi.fn>> = {
    findAccount: vi.fn(async () =>
      options.account === undefined ? ACCOUNT_REF : options.account,
    ),
    findFinancialArea: vi.fn(async () =>
      options.area === undefined ? AREA_REF : options.area,
    ),
    findFiscalYear: vi.fn(async () =>
      options.year === undefined ? YEAR_REF : options.year,
    ),
    findPeriod: vi.fn(async () =>
      options.period === undefined ? PERIOD_REF : options.period,
    ),
    listPeriodsOfYear: vi.fn(async () =>
      options.periods === undefined
        ? [PERIOD_REF_PRIOR, PERIOD_REF]
        : options.periods,
    ),
    readStatementLedgerFacts: vi.fn(
      async (
        params: CapturedFactsCall['params'],
        skip: number,
        take: number,
      ) => {
        factsCalls.push({ params, skip, take });
        return emptyFacts(options.facts);
      },
    ),
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
  const service = new AccountStatementsService(
    repository as unknown as AccountStatementsRepository,
    organizations as never,
    authorization as never,
  );
  return { service, repository, factsCalls: () => factsCalls };
}

const BASE_QUERY = {
  organizationId: ORG,
  accountId: ACCOUNT,
  fiscalYearId: YEAR,
  page: 1,
  pageSize: 100,
};

describe('AccountStatementsService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires Accounting.AccountStatement.View and answers 403 without it', async () => {
    const { service, repository } = makeService({
      authThrows: AppException.forbidden(),
    });
    await expect(service.getAccountStatement(BASE_QUERY)).rejects.toMatchObject(
      {
        status: 403,
      },
    );
    // The denial happens BEFORE any data access: no query is issued.
    expect(repository.readStatementLedgerFacts).not.toHaveBeenCalled();
    expect(repository.findAccount).not.toHaveBeenCalled();
  });

  it('is not satisfied by the ledger-movement or balance read codes (D6)', async () => {
    const seen: string[][] = [];
    const { service } = makeService();
    const authorization = {
      requireAllPermissions: vi.fn(async (codes: readonly string[]) => {
        seen.push([...codes]);
      }),
    };
    const withSeenAuth = new AccountStatementsService(
      {
        findAccount: vi.fn(async () => ACCOUNT_REF),
        findFinancialArea: vi.fn(async () => AREA_REF),
        findFiscalYear: vi.fn(async () => YEAR_REF),
        findPeriod: vi.fn(async () => PERIOD_REF),
        listPeriodsOfYear: vi.fn(async () => [PERIOD_REF_PRIOR, PERIOD_REF]),
        readStatementLedgerFacts: vi.fn(async () => emptyFacts()),
      } as never,
      {
        assertOrganizationInScope: vi.fn(),
        requireUsableOrganization: vi.fn(async () => undefined),
      } as never,
      authorization as never,
    );
    await withSeenAuth.getAccountStatement(BASE_QUERY);
    void service;
    expect(seen).toEqual([[ACCOUNT_STATEMENT_PERMISSIONS.VIEW]]);
    expect(seen[0]).toEqual(['Accounting.AccountStatement.View']);
    expect(seen[0]).not.toContain('Accounting.LedgerMovement.View');
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
    await service.getAccountStatement(BASE_QUERY);
    expect(assertInScope).toHaveBeenCalledWith(ORG);
    expect(requireUsable).toHaveBeenCalledWith(ORG);
  });

  it('refuses an organization outside the deployment pin with 404 (never 403)', async () => {
    const { service, repository } = makeService({
      orgs: {
        assertOrganizationInScope: vi.fn(() => {
          throw AppException.notFound('Organization', ORG);
        }),
      },
    });
    await expect(service.getAccountStatement(BASE_QUERY)).rejects.toMatchObject(
      {
        status: 404,
      },
    );
    expect(repository.readStatementLedgerFacts).not.toHaveBeenCalled();
  });

  it('refuses a disabled organization with 422 before any scope read', async () => {
    const { service, repository } = makeService({
      orgs: {
        requireUsableOrganization: vi.fn(async () => {
          throw AppException.businessRule('Organization is disabled.');
        }),
      },
    });
    await expect(service.getAccountStatement(BASE_QUERY)).rejects.toMatchObject(
      {
        status: 422,
      },
    );
    expect(repository.findAccount).not.toHaveBeenCalled();
    expect(repository.readStatementLedgerFacts).not.toHaveBeenCalled();
  });

  it('refuses an explicit sort with 400 — the statement order is fixed (§11)', async () => {
    const { service, repository } = makeService();
    await expect(
      service.getAccountStatement({ ...BASE_QUERY, sort: 'documentDate:desc' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(repository.readStatementLedgerFacts).not.toHaveBeenCalled();
  });

  it('treats the hierarchy filter as a narrowing identity filter, not a roll-up', async () => {
    const { service, repository } = makeService();
    await expect(
      service.getAccountStatement({
        ...BASE_QUERY,
        accountHierarchyId: ACCOUNT,
      }),
    ).resolves.toBeDefined();
    expect(repository.readStatementLedgerFacts).toHaveBeenCalledTimes(1);
  });

  // ---- scope-key error matrix (AC-I-16 / the implementation gate) ---------

  it('answers 404 for an unknown/foreign account (never 403 — existence must not leak)', async () => {
    const { service, repository } = makeService({ account: null });
    await expect(service.getAccountStatement(BASE_QUERY)).rejects.toMatchObject(
      {
        status: 404,
      },
    );
    expect(repository.readStatementLedgerFacts).not.toHaveBeenCalled();
  });

  it('answers 422 for a non-postable account (its rollup is not this slice)', async () => {
    const { service } = makeService({
      account: { ...ACCOUNT_REF, isPostable: false },
    });
    await expect(service.getAccountStatement(BASE_QUERY)).rejects.toMatchObject(
      {
        status: 422,
      },
    );
  });

  it('answers 404 for an unknown/foreign fiscal year', async () => {
    const { service } = makeService({ year: null });
    await expect(service.getAccountStatement(BASE_QUERY)).rejects.toMatchObject(
      {
        status: 404,
      },
    );
  });

  it('answers 404 for an unknown/foreign accounting period', async () => {
    const { service } = makeService({ period: null });
    await expect(
      service.getAccountStatement({
        ...BASE_QUERY,
        accountingPeriodId: PERIOD,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('answers 422 for a period of ANOTHER fiscal year (it exists; it is out of scope)', async () => {
    const { service, repository } = makeService({
      // The year's own periods do not include the requested foreign-period.
      periods: [PERIOD_REF_PRIOR],
    });
    await expect(
      service.getAccountStatement({
        ...BASE_QUERY,
        accountingPeriodId: PERIOD,
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(repository.readStatementLedgerFacts).not.toHaveBeenCalled();
  });

  it('answers 404 for a foreign financial-area id (never treated as accessible)', async () => {
    const findArea = vi.fn(async (org: string, id: string) =>
      id === AREA ? AREA_REF : null,
    );
    const { service, repository } = makeService();
    repository.findFinancialArea = findArea as never;
    await expect(
      service.getAccountStatement({
        ...BASE_QUERY,
        financialAreaId: '01H00000000000000000000EE',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('answers 422 when the requested area is real but not the year’s area (D4)', async () => {
    const otherArea: StatementAreaRef = {
      id: '01H00000000000000000000FF',
      code: 'OTHER',
      title: 'دیگر',
    };
    const { service, repository } = makeService();
    repository.findFinancialArea = vi.fn(async (_org: string, id: string) =>
      id === otherArea.id ? otherArea : AREA_REF,
    ) as never;
    await expect(
      service.getAccountStatement({
        ...BASE_QUERY,
        financialAreaId: otherArea.id,
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('accepts the year’s own area id (decision D4 — no new area-auth system)', async () => {
    const { service, repository } = makeService();
    const statement = await service.getAccountStatement({
      ...BASE_QUERY,
      financialAreaId: AREA,
    });
    expect(statement.scope.financialArea).toEqual({
      id: AREA,
      code: 'MAIN',
      title: 'اصلی',
    });
    expect(repository.readStatementLedgerFacts).toHaveBeenCalledTimes(1);
  });

  // ---- window construction: opening (D2), running base, totals (§13) ------

  it('builds the whole-year window with opening 0 and no prior-period ids (D2)', async () => {
    const { service, factsCalls } = makeService();
    const statement = await service.getAccountStatement(BASE_QUERY);
    const call = factsCalls()[0];
    expect(call?.params.window).toEqual({
      organizationId: ORG,
      financialAreaId: AREA,
      fiscalYearId: YEAR,
      accountId: ACCOUNT,
    });
    expect(call?.params.priorPeriodIds).toEqual([]);
    expect(statement.totals.openingBalanceAmount).toBe('0');
    expect(statement.scope.accountingPeriod).toBeNull();
    expect(statement.openingBasis).toBe('intra-fiscal-year');
    expect(statement.signConvention).toBe('debit-positive');
  });

  it('opens a period statement at the prior-SEQUENCE periods only (D2 — gaps skipped, no carry-forward)', async () => {
    const { service, factsCalls } = makeService({
      period: PERIOD_REF, // sequence 2
      periods: [PERIOD_REF_PRIOR, PERIOD_REF], // sequences 1, 2
      facts: { priorPeriodDebit: '300.5', priorPeriodCredit: '100.25' },
    });
    const statement = await service.getAccountStatement({
      ...BASE_QUERY,
      accountingPeriodId: PERIOD,
    });
    const call = factsCalls()[0];
    // Movement window = the ONE period; opening input = sequence 1 only.
    expect(call?.params.window).toEqual({
      organizationId: ORG,
      financialAreaId: AREA,
      fiscalYearId: YEAR,
      accountId: ACCOUNT,
      accountingPeriodId: PERIOD,
    });
    expect(call?.params.priorPeriodIds).toEqual([PERIOD_PRIOR]);
    // 300.5 − 100.25 = 200.25 — exact, never 200.24999999999997.
    expect(statement.totals.openingBalanceAmount).toBe('200.25');
    expect(statement.scope.accountingPeriod?.id).toBe(PERIOD);
  });

  it('opens the first period (or a gap-sequence first) at 0 — nothing prior in-year', async () => {
    const { service, factsCalls } = makeService({
      period: PERIOD_REF_PRIOR, // sequence 1 — nothing lower
      periods: [PERIOD_REF_PRIOR, PERIOD_REF],
    });
    const statement = await service.getAccountStatement({
      ...BASE_QUERY,
      accountingPeriodId: PERIOD_PRIOR,
    });
    expect(factsCalls()[0]?.params.priorPeriodIds).toEqual([]);
    expect(statement.totals.openingBalanceAmount).toBe('0');
  });

  it('never lets another year’s rows enter the opening (D2 — window is year-pinned)', async () => {
    const { service, factsCalls } = makeService({
      period: PERIOD_REF,
      periods: [PERIOD_REF_PRIOR, PERIOD_REF],
    });
    await service.getAccountStatement({
      ...BASE_QUERY,
      accountingPeriodId: PERIOD,
    });
    // Both the movement window and the opening input pin the SAME year and
    // account — the repository receives no year-less or account-less shape.
    const call = factsCalls()[0];
    expect(call?.params.window.fiscalYearId).toBe(YEAR);
    expect(call?.params.window.accountId).toBe(ACCOUNT);
    expect(call?.params.priorPeriodIds).not.toContain(YEAR);
  });

  it('continues the running balance across pages (base = opening + pre-page net)', async () => {
    const { service, factsCalls } = makeService({
      facts: {
        total: 3,
        prePageAmounts: [
          { debitAmount: '10', creditAmount: '0' },
          { debitAmount: '0', creditAmount: '3.5' },
        ],
        rows: [makeEntry({ debitAmount: '5', creditAmount: '0' })],
        debitTotal: '15',
        creditTotal: '3.5',
        priorPeriodDebit: '100',
        priorPeriodCredit: '40',
      },
    });
    const statement = await service.getAccountStatement({
      ...BASE_QUERY,
      accountingPeriodId: PERIOD,
      page: 3,
      pageSize: 1,
    });
    // Offset math is bounded and shared with the repo convention.
    expect(factsCalls()[0]?.skip).toBe(2);
    expect(factsCalls()[0]?.take).toBe(1);
    // Opening = 100 − 40 = 60; pre-page net = (10 − 0) + (0 − 3.5) = 6.5;
    // base = 66.5; row net 5 → running 71.5 — exact decimal strings.
    expect(statement.totals.openingBalanceAmount).toBe('60');
    expect(statement.movements.items[0]?.runningBalanceAmount).toBe('71.5');
  });

  it('computes totals over the full window — page-independent (§13)', async () => {
    const { service } = makeService({
      facts: {
        total: 50,
        // The page holds ONE zero row, yet the totals report the window sums.
        rows: [makeEntry()],
        debitTotal: '9999999999999999.99',
        creditTotal: '0.01',
        prePageAmounts: [],
      },
    });
    const statement = await service.getAccountStatement({
      ...BASE_QUERY,
      page: 2,
      pageSize: 1,
    });
    expect(statement.totals.debitTotalAmount).toBe('9999999999999999.99');
    expect(statement.totals.creditTotalAmount).toBe('0.01');
    expect(statement.totals.netChangeAmount).toBe('9999999999999999.98');
    expect(statement.totals.closingBalanceAmount).toBe('9999999999999999.98');
    expect(statement.movements.total).toBe(50);
  });

  it('keeps opening + net = closing for every period-status read (D5 — statuses are echoed only)', async () => {
    for (const status of ['open', 'closed', 'sealed']) {
      const { service } = makeService({
        period: { ...PERIOD_REF, status },
        periods: [PERIOD_REF_PRIOR, { ...PERIOD_REF, status }],
        facts: {
          priorPeriodDebit: '7',
          priorPeriodCredit: '2',
          debitTotal: '3',
          creditTotal: '1',
          total: 1,
          rows: [makeEntry({ debitAmount: '3', creditAmount: '1' })],
        },
      });
      const statement = await service.getAccountStatement({
        ...BASE_QUERY,
        accountingPeriodId: PERIOD,
      });
      expect(statement.totals.openingBalanceAmount).toBe('5');
      expect(statement.totals.netChangeAmount).toBe('2');
      expect(statement.totals.closingBalanceAmount).toBe('7');
      expect(statement.movements.items[0]?.runningBalanceAmount).toBe('7');
      expect(statement.scope.accountingPeriod?.status).toBe(status);
      expect(statement.scope.fiscalYear.status).toBe('open');
    }
  });

  it('returns exact decimal strings untouched by the service layer', async () => {
    const { service } = makeService({
      facts: {
        total: 1,
        rows: [
          makeEntry({ debitAmount: '9999999999999999.99', creditAmount: '0' }),
        ],
        debitTotal: '9999999999999999.99',
      },
    });
    const statement = await service.getAccountStatement(BASE_QUERY);
    expect(statement.movements.items[0]?.debitAmount).toBe(
      '9999999999999999.99',
    );
    expect(statement.totals.debitTotalAmount).toBe('9999999999999999.99');
    expect(statement.totals.closingBalanceAmount).toBe('9999999999999999.99');
  });

  // ---- read-only surface (D7, AC-I-19, prompt §24 "Regression") -----------

  it('exposes no write path at all — repository and service alike', () => {
    const prototype =
      AccountStatementsRepository.prototype as unknown as Record<
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
      'insert',
      'insertMany',
      'save',
    ]) {
      expect(prototype[method], method).toBeUndefined();
    }
    // …and the class owns exactly its reads.
    const repositoryMethods = Object.getOwnPropertyNames(prototype)
      .filter((name) => name !== 'constructor')
      .sort();
    expect(repositoryMethods).toEqual([
      'client',
      'findAccount',
      'findFinancialArea',
      'findFiscalYear',
      'findPeriod',
      'listPeriodsOfYear',
      'readStatementLedgerFacts',
    ]);
    // The service owns exactly one public operation: the statement read.
    const serviceMethods = Object.getOwnPropertyNames(
      AccountStatementsService.prototype,
    )
      .filter((name) => name !== 'constructor')
      .sort();
    expect(serviceMethods).toEqual([
      'getAccountStatement',
      'requireAccount',
      'requireArea',
      'requirePeriod',
      'requireYear',
    ]);
  });

  it('mutates nothing: a successful read touches only the declared read verbs', async () => {
    const { service, repository } = makeService({
      facts: {
        total: 1,
        rows: [makeEntry({ debitAmount: '1', creditAmount: '0' })],
        debitTotal: '1',
      },
    });
    await service.getAccountStatement({
      ...BASE_QUERY,
      accountingPeriodId: PERIOD,
    });
    // Exactly the six declared reads — nothing else on the repository.
    expect(
      Object.keys(repository).filter((k) => repository[k]?.mock?.calls?.length),
    ).toEqual([
      'findAccount',
      'findFinancialArea',
      'findFiscalYear',
      'findPeriod',
      'listPeriodsOfYear',
      'readStatementLedgerFacts',
    ]);
  });
});
