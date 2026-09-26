import { Inject, Injectable } from '@nestjs/common';
import {
  DOMAIN_EVENT_BUS,
  type DomainEventBus,
} from '../../../kernel/events/domain-event-bus.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { getPrincipal } from '../../../kernel/correlation/request-context.js';
import {
  toOffset,
  toPaginatedResult,
  type PaginatedResult,
} from '../../../kernel/pagination/paginated-result.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { BALANCE_PERMISSIONS } from '../domain/accounting-permissions.js';
import { deriveBalances } from '../domain/balance-projection.js';
import { canonicalizeAmount } from '../domain/money.js';
import { ACCOUNT_BALANCE_REBUILT_EVENT } from '../domain/accounting.events.js';
import { publishEvent, resolveSort } from './accounting-support.js';
import { AccountBalanceProjectionsRepository } from '../data/account-balance-projections.repository.js';

// ---------------------------------------------------------------------------
// DTO shapes (service-internal, mirrors api/dto/account-balance.dto.ts but
// framework-free — the controller maps to wire format).
// ---------------------------------------------------------------------------

export interface ListBalancesQuery {
  organizationId: string;
  page: number;
  pageSize: number;
  financialAreaId?: string | undefined;
  fiscalYearId?: string | undefined;
  accountingPeriodId?: string | undefined;
  accountId?: string | undefined;
  sort?: string | undefined;
}

export interface GetAccountBalanceQuery {
  organizationId: string;
  accountId: string;
  financialAreaId?: string | undefined;
  fiscalYearId?: string | undefined;
  accountingPeriodId?: string | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

export interface ReconciliationQuery {
  organizationId: string;
  financialAreaId?: string | undefined;
  fiscalYearId?: string | undefined;
  accountingPeriodId?: string | undefined;
  accountId?: string | undefined;
  mismatchKind?: string | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

export interface RebuildBalancesInput {
  organizationId: string;
  financialAreaId?: string | undefined;
  fiscalYearId?: string | undefined;
  reason?: string | undefined;
}

export interface BalanceDerivedDto {
  id: string;
  organizationId: string;
  financialAreaId: string;
  fiscalYearId: string;
  accountingPeriodId: string;
  periodSequence: number;
  accountId: string;
  periodDebitAmount: string;
  periodCreditAmount: string;
  periodNetAmount: string;
  openingBalanceAmount: string;
  closingBalanceAmount: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReconciliationItem {
  organizationId: string;
  financialAreaId: string;
  fiscalYearId: string;
  accountingPeriodId: string;
  accountId: string;
  mismatchKind: string;
  ledgerDebitAmount: string | null;
  ledgerCreditAmount: string | null;
  projectionDebitAmount: string | null;
  projectionCreditAmount: string | null;
}

export interface RebuildResult {
  organizationId: string;
  financialAreaId: string | null;
  fiscalYearId: string | null;
  deleted: number;
  inserted: number;
}

const LIST_SORTABLE: Record<string, string> = {
  periodSequence: 'periodSequence',
  accountId: 'accountId',
  periodDebitAmount: 'periodDebitAmount',
  periodCreditAmount: 'periodCreditAmount',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

/**
 * Balance projection application service (Task 12, ADR-0031).
 *
 * Reads are org-scoped (AC-I-01/16) and permission-gated (`Balance.View`).
 * Writes are one explicit operation — `rebuild` (`Balance.Rebuild`) — audited
 * and published. The ledger is never mutated here (the projection is
 * rebuildable, not authoritative).
 *
 * Every read that touches a foreign key answers 404 (not 403) when the key is
 * foreign (AC-I-16). A disabled organization answers 422 via
 * `requireUsableOrganization`; a disabled area/year is NOT re-validated on
 * read — balances of a closed period remain readable (the ledger's stored scope
 * is immutable, so so is the projection).
 */
@Injectable()
export class AccountingBalancesService {
  constructor(
    private readonly balances: AccountBalanceProjectionsRepository,
    private readonly prisma: PrismaService,
    private readonly organizations: OrganizationsService,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  // ---- list (paginated, with derived opening/closing) ---------------------

  async listBalances(
    query: ListBalancesQuery,
  ): Promise<PaginatedResult<BalanceDerivedDto>> {
    await this.authorization.requireAllPermissions([BALANCE_PERMISSIONS.VIEW]);
    await this.organizations.assertOrganizationInScope(query.organizationId);
    await this.organizations.requireUsableOrganization(query.organizationId);

    // Validate optional scope keys belong to the org (404 otherwise).
    await this.assertScopeKeysInOrganization(query);

    const { skip, take } = toOffset(query.page, query.pageSize);

    // Primary path — query the authoritative derived view. Pagination, sorting
    // and derivation all happen in SQL, so opening/closing remain correct even
    // when prior periods live off-page (the window precedes the outer LIMIT).
    try {
      const result = await this.listBalancesViaView(query, skip, take);
      if (result !== null) return result;
    } catch (error) {
      // Fall through to in-memory derive-before-pagination. In production
      // this only trips when the view probe itself throws (e.g. view absent
      // in a test fake or a transient `$queryRaw` wiring failure) — never
      // on empty results, which the view path returns as {items: [], total:0}.
      this.logger.warn(
        'Balance list fell back to derive-before-pagination',
        { organizationId: query.organizationId, error: String(error) },
        AccountingBalancesService.name,
      );
    }

    // Fallback path — derive-before-pagination over the full filtered set.
    // Mirrors `getAccountBalances`' correct logic: fetch ALL matching rows
    // (within a guard cap), derive over the full year-partitioned context,
    // then sort + paginate the derived series so opening is exact.
    return this.listBalancesDeriveBeforePagination(query, skip, take);
  }

  private async listBalancesViaView(
    query: ListBalancesQuery,
    skip: number,
    take: number,
  ): Promise<PaginatedResult<BalanceDerivedDto> | null> {
    const client = await this.prisma.getClient<{
      $queryRaw: <T>(
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => Promise<T>;
    }>();

    // Resolve sort → whitelisted SQL ORDER BY. Validate eagerly so a bad
    // sort answers 422 regardless of which fetch path wins.
    const orderBy = query.sort
      ? resolveSort(query.sort, LIST_SORTABLE, [])
      : [];
    const orderBySql = this.buildViewOrderBySql(orderBy);

    type CountRow = { count: string | number | bigint };
    type ViewRow = {
      id: string;
      organizationId: string;
      financialAreaId: string;
      fiscalYearId: string;
      accountingPeriodId: string;
      periodSequence: number;
      accountId: string;
      periodDebitAmount: unknown;
      periodCreditAmount: unknown;
      periodNetAmount: unknown;
      openingBalanceAmount: unknown;
      closingBalanceAmount: unknown;
      createdAt: Date | string;
      updatedAt: Date | string;
    };

    const countRows = (await client.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::text AS "count"
        FROM "accounting"."vw_account_balance_derived"
       WHERE "organization_id" = ${query.organizationId}
         AND (${query.financialAreaId as string | undefined}::text IS NULL
              OR "financial_area_id" = ${query.financialAreaId as string | undefined})
         AND (${query.fiscalYearId as string | undefined}::text IS NULL
              OR "fiscal_year_id" = ${query.fiscalYearId as string | undefined})
         AND (${query.accountingPeriodId as string | undefined}::text IS NULL
              OR "accounting_period_id" = ${query.accountingPeriodId as string | undefined})
         AND (${query.accountId as string | undefined}::text IS NULL
              OR "account_id" = ${query.accountId as string | undefined})
    `) as CountRow[];

    const totalRaw = countRows[0]?.count;
    const total = totalRaw === undefined ? 0 : Number(totalRaw);

    if (total === 0) {
      return toPaginatedResult([], 0, query.page, query.pageSize);
    }

    const dataRows = (await this.queryViewPage(
      query,
      orderBySql,
      take,
      skip,
    )) as ViewRow[];

    const dtos: BalanceDerivedDto[] = dataRows.map((r) => ({
      id: r.id,
      organizationId: r.organizationId,
      financialAreaId: r.financialAreaId,
      fiscalYearId: r.fiscalYearId,
      accountingPeriodId: r.accountingPeriodId,
      periodSequence: Number(r.periodSequence),
      accountId: r.accountId,
      periodDebitAmount: canonicalizeAmount(
        toAmountString(r.periodDebitAmount),
      ),
      periodCreditAmount: canonicalizeAmount(
        toAmountString(r.periodCreditAmount),
      ),
      periodNetAmount: canonicalizeAmount(toAmountString(r.periodNetAmount)),
      openingBalanceAmount: canonicalizeAmount(
        toAmountString(r.openingBalanceAmount),
      ),
      closingBalanceAmount: canonicalizeAmount(
        toAmountString(r.closingBalanceAmount),
      ),
      createdAt: new Date(r.createdAt).toISOString(),
      updatedAt: new Date(r.updatedAt).toISOString(),
    }));

    return toPaginatedResult(dtos, total, query.page, query.pageSize);
  }

  private async queryViewPage(
    query: ListBalancesQuery,
    orderBySql: string,
    take: number,
    skip: number,
  ): Promise<unknown[]> {
    const client = await this.prisma.getClient<{
      $queryRawUnsafe: (sql: string, ...values: unknown[]) => Promise<unknown>;
    }>();
    if (typeof client.$queryRawUnsafe === 'function') {
      const sql = `
        SELECT "id", "organization_id" AS "organizationId",
               "financial_area_id" AS "financialAreaId",
               "fiscal_year_id" AS "fiscalYearId",
               "accounting_period_id" AS "accountingPeriodId",
               "period_sequence" AS "periodSequence",
               "account_id" AS "accountId",
               "period_debit_amount" AS "periodDebitAmount",
               "period_credit_amount" AS "periodCreditAmount",
               "period_net_amount" AS "periodNetAmount",
               "opening_balance_amount" AS "openingBalanceAmount",
               "closing_balance_amount" AS "closingBalanceAmount",
               "created_at" AS "createdAt",
               "updated_at" AS "updatedAt"
          FROM "accounting"."vw_account_balance_derived"
         WHERE "organization_id" = $1
           AND ($2::text IS NULL OR "financial_area_id" = $2)
           AND ($3::text IS NULL OR "fiscal_year_id" = $3)
           AND ($4::text IS NULL OR "accounting_period_id" = $4)
           AND ($5::text IS NULL OR "account_id" = $5)
         ORDER BY ${orderBySql}
         LIMIT $6 OFFSET $7
      `;
      return (await client.$queryRawUnsafe(
        sql,
        query.organizationId,
        query.financialAreaId ?? null,
        query.fiscalYearId ?? null,
        query.accountingPeriodId ?? null,
        query.accountId ?? null,
        take,
        skip,
      )) as unknown[];
    }
    const tagged = await this.prisma.getClient<{
      $queryRaw: <T>(s: TemplateStringsArray, ...v: unknown[]) => Promise<T>;
    }>();
    return (await tagged.$queryRaw`
      SELECT "id", "organization_id" AS "organizationId",
             "financial_area_id" AS "financialAreaId",
             "fiscal_year_id" AS "fiscalYearId",
             "accounting_period_id" AS "accountingPeriodId",
             "period_sequence" AS "periodSequence",
             "account_id" AS "accountId",
             "period_debit_amount" AS "periodDebitAmount",
             "period_credit_amount" AS "periodCreditAmount",
             "period_net_amount" AS "periodNetAmount",
             "opening_balance_amount" AS "openingBalanceAmount",
             "closing_balance_amount" AS "closingBalanceAmount",
             "created_at" AS "createdAt",
             "updated_at" AS "updatedAt"
        FROM "accounting"."vw_account_balance_derived"
       WHERE "organization_id" = ${query.organizationId}
         AND (${query.financialAreaId as string | undefined}::text IS NULL
              OR "financial_area_id" = ${query.financialAreaId as string | undefined})
         AND (${query.fiscalYearId as string | undefined}::text IS NULL
              OR "fiscal_year_id" = ${query.fiscalYearId as string | undefined})
         AND (${query.accountingPeriodId as string | undefined}::text IS NULL
              OR "accounting_period_id" = ${query.accountingPeriodId as string | undefined})
         AND (${query.accountId as string | undefined}::text IS NULL
              OR "account_id" = ${query.accountId as string | undefined})
       ORDER BY "fiscal_year_id" ASC, "period_sequence" ASC, "account_id" ASC
       LIMIT ${take} OFFSET ${skip}
    `) as unknown[];
  }

  private buildViewOrderBySql(
    orderBy: Array<Record<string, 'asc' | 'desc'>>,
  ): string {
    if (orderBy.length === 0) {
      return '"financial_area_id" ASC, "fiscal_year_id" ASC, "period_sequence" ASC, "account_id" ASC';
    }
    const colOf: Record<string, string> = {
      periodSequence: 'period_sequence',
      accountId: 'account_id',
      periodDebitAmount: 'period_debit_amount',
      periodCreditAmount: 'period_credit_amount',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    };
    const parts: string[] = [];
    for (const clause of orderBy) {
      const [field, dir] = Object.entries(clause)[0] as [
        string,
        'asc' | 'desc',
      ];
      const col = colOf[field];
      if (col === undefined) continue;
      const d = dir === 'asc' ? 'ASC' : 'DESC';
      parts.push(`"${col}" ${d}`);
    }
    if (parts.length === 0) {
      return '"financial_area_id" ASC, "fiscal_year_id" ASC, "period_sequence" ASC, "account_id" ASC';
    }
    parts.push(
      '"financial_area_id" ASC',
      '"fiscal_year_id" ASC',
      '"period_sequence" ASC',
      '"account_id" ASC',
    );
    return parts.join(', ');
  }

  private async listBalancesDeriveBeforePagination(
    query: ListBalancesQuery,
    skip: number,
    take: number,
  ): Promise<PaginatedResult<BalanceDerivedDto>> {
    // Fallback path is TEST-ONLY: production always succeeds via the view (no cap).
    // When the view is unavailable (fake Prisma in unit tests), we must derive
    // over the FULL filtered set before paginating — otherwise opening resets
    // to 0 on later pages (R-02). We fetch in batches without a 10000 cap so
    // org-wide multi-account/year queries are not silently truncated (review
    // §5 risk). A warning is emitted if the result grows beyond 50000 rows,
    // which signals a caller should narrow its scope or rely on the view path.
    const allItems: Awaited<ReturnType<typeof this.balances.list>>['items'] =
      [];
    const batchSize = 5000;
    let offset = 0;
    while (true) {
      const page = await this.balances.list({
        where: {
          organizationId: query.organizationId,
          financialAreaId: query.financialAreaId,
          fiscalYearId: query.fiscalYearId,
          accountingPeriodId: query.accountingPeriodId,
          accountId: query.accountId,
        },
        orderBy: [{ organizationId: 'asc' }],
        skip: offset,
        take: batchSize,
      });
      allItems.push(...page.items);
      if (page.items.length < batchSize) break;
      offset += batchSize;
      if (allItems.length >= 50000) {
        this.logger.warn(
          'Balance fallback fetch reached 50000 rows — consider narrowing scope or using the view path',
          { organizationId: query.organizationId },
          AccountingBalancesService.name,
        );
        break;
      }
    }
    const all = { items: allItems, total: allItems.length } as const;

    if (all.items.length === 0) {
      return toPaginatedResult([], 0, query.page, query.pageSize);
    }

    const fiscalYearIds = [...new Set(all.items.map((r) => r.fiscalYearId))];
    const periodsByYear = await this.loadPeriodsByYear(
      query.organizationId,
      fiscalYearIds,
    );

    const projectionsForDerive = all.items.map((r) => ({
      id: r.id,
      organizationId: r.organizationId,
      financialAreaId: r.financialAreaId,
      fiscalYearId: r.fiscalYearId,
      accountingPeriodId: r.accountingPeriodId,
      accountId: r.accountId,
      periodDebitAmount: toAmountString(r.periodDebitAmount),
      periodCreditAmount: toAmountString(r.periodCreditAmount),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      createdBy: r.createdBy,
      updatedBy: r.updatedBy,
    }));

    const derived = deriveBalances(projectionsForDerive, periodsByYear);

    const orderBy = query.sort
      ? resolveSort(query.sort, LIST_SORTABLE, [])
      : [];
    let ordered = derived;
    if (orderBy.length > 0) ordered = sortDerived([...derived], orderBy);

    const total = ordered.length;
    const pageSlice = ordered.slice(skip, skip + take);

    const byKey = new Map<string, (typeof all.items)[number]>();
    for (const r of all.items) {
      byKey.set(
        `${r.organizationId}|${r.financialAreaId}|${r.fiscalYearId}|${r.accountingPeriodId}|${r.accountId}`,
        r,
      );
    }

    const dtos: BalanceDerivedDto[] = pageSlice.map((d) => {
      const key = `${d.organizationId}|${d.financialAreaId}|${d.fiscalYearId}|${d.accountingPeriodId}|${d.accountId}`;
      const raw = byKey.get(key);
      return {
        id:
          raw?.id ??
          `${d.organizationId}|${d.accountingPeriodId}|${d.accountId}`,
        organizationId: d.organizationId,
        financialAreaId: d.financialAreaId,
        fiscalYearId: d.fiscalYearId,
        accountingPeriodId: d.accountingPeriodId,
        periodSequence: d.periodSequence,
        accountId: d.accountId,
        periodDebitAmount: canonicalizeAmount(d.periodDebitAmount),
        periodCreditAmount: canonicalizeAmount(d.periodCreditAmount),
        periodNetAmount: canonicalizeAmount(d.periodNetAmount),
        openingBalanceAmount: canonicalizeAmount(d.openingBalanceAmount),
        closingBalanceAmount: canonicalizeAmount(d.closingBalanceAmount),
        createdAt: (raw?.createdAt ?? new Date()).toISOString(),
        updatedAt: (raw?.updatedAt ?? new Date()).toISOString(),
      };
    });

    return toPaginatedResult(dtos, total, query.page, query.pageSize);
  }

  // ---- get one account (scoped) -------------------------------------------

  async getAccountBalances(
    query: GetAccountBalanceQuery,
  ): Promise<PaginatedResult<BalanceDerivedDto>> {
    await this.authorization.requireAllPermissions([BALANCE_PERMISSIONS.VIEW]);
    await this.organizations.assertOrganizationInScope(query.organizationId);
    await this.organizations.requireUsableOrganization(query.organizationId);
    await this.assertScopeKeysInOrganization({
      organizationId: query.organizationId,
      financialAreaId: query.financialAreaId,
      fiscalYearId: query.fiscalYearId,
      accountingPeriodId: query.accountingPeriodId,
      accountId: query.accountId,
    });

    // Validate the addressed account belongs to the org (404 otherwise).
    await this.assertAccountInOrganization(
      query.accountId,
      query.organizationId,
    );

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const { skip, take } = toOffset(page, pageSize);

    // For single-account, we want full-year derived series so opening is exact.
    // Fetch ALL projections for this account+org+optional filters (not just page),
    // derive over the full year-partitioned context, then paginate the derived
    // series. This ensures opening stays exact even when paginating.
    const all = await this.balances.list({
      where: {
        organizationId: query.organizationId,
        financialAreaId: query.financialAreaId,
        fiscalYearId: query.fiscalYearId,
        accountingPeriodId: undefined, // fetch all periods for derivation
        accountId: query.accountId,
      },
      orderBy: [{ organizationId: 'asc' }],
      skip: 0,
      take: 10000, // cap — an account's year rarely has > 13 periods; pagination still slices.
    });

    const fiscalYearIds = [...new Set(all.items.map((r) => r.fiscalYearId))];
    const periodsByYear = await this.loadPeriodsByYear(
      query.organizationId,
      fiscalYearIds,
    );

    const allProjections = all.items.map((r) => ({
      id: r.id,
      organizationId: r.organizationId,
      financialAreaId: r.financialAreaId,
      fiscalYearId: r.fiscalYearId,
      accountingPeriodId: r.accountingPeriodId,
      accountId: r.accountId,
      periodDebitAmount: toAmountString(r.periodDebitAmount),
      periodCreditAmount: toAmountString(r.periodCreditAmount),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      createdBy: r.createdBy,
      updatedBy: r.updatedBy,
    }));

    const allDerived = deriveBalances(allProjections, periodsByYear);
    // Filter to requested period when present (post-derivation, so opening stays correct).
    let filtered = allDerived;
    if (query.accountingPeriodId !== undefined) {
      filtered = allDerived.filter(
        (d) => d.accountingPeriodId === query.accountingPeriodId,
      );
    }

    const totalDerived = filtered.length;
    const pageSlice = filtered.slice(skip, skip + take);

    const dtos: BalanceDerivedDto[] = pageSlice.map((d) => {
      const raw = all.items.find(
        (r) =>
          r.organizationId === d.organizationId &&
          r.financialAreaId === d.financialAreaId &&
          r.fiscalYearId === d.fiscalYearId &&
          r.accountingPeriodId === d.accountingPeriodId &&
          r.accountId === d.accountId,
      );
      return {
        id:
          raw?.id ??
          `${d.organizationId}|${d.accountingPeriodId}|${d.accountId}`,
        organizationId: d.organizationId,
        financialAreaId: d.financialAreaId,
        fiscalYearId: d.fiscalYearId,
        accountingPeriodId: d.accountingPeriodId,
        periodSequence: d.periodSequence,
        accountId: d.accountId,
        periodDebitAmount: canonicalizeAmount(d.periodDebitAmount),
        periodCreditAmount: canonicalizeAmount(d.periodCreditAmount),
        periodNetAmount: canonicalizeAmount(d.periodNetAmount),
        openingBalanceAmount: canonicalizeAmount(d.openingBalanceAmount),
        closingBalanceAmount: canonicalizeAmount(d.closingBalanceAmount),
        createdAt: (raw?.createdAt ?? new Date()).toISOString(),
        updatedAt: (raw?.updatedAt ?? new Date()).toISOString(),
      };
    });

    return toPaginatedResult(dtos, totalDerived, page, pageSize);
  }

  // ---- reconciliation -------------------------------------------------------

  async getReconciliation(
    query: ReconciliationQuery,
  ): Promise<PaginatedResult<ReconciliationItem>> {
    await this.authorization.requireAllPermissions([BALANCE_PERMISSIONS.VIEW]);
    await this.organizations.assertOrganizationInScope(query.organizationId);
    await this.organizations.requireUsableOrganization(query.organizationId);
    await this.assertScopeKeysInOrganization(query);

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;

    // Read mismatches from the reconciliation view (or equivalent aggregation)
    // via a transaction-scoped helper — we need a tx for $queryRaw.
    const client = await this.prisma.getClient<{
      $transaction: <T>(fn: (tx: any) => Promise<T>) => Promise<T>;
    }>();

    const allMismatches: ReconciliationItem[] = await client.$transaction(
      async (tx: any) => {
        const { readReconciliationMismatchesInTx } =
          await import('../data/account-balance-projections.repository.js');
        const rows = await readReconciliationMismatchesInTx(tx, {
          organizationId: query.organizationId,
          financialAreaId: query.financialAreaId,
          fiscalYearId: query.fiscalYearId,
          accountingPeriodId: query.accountingPeriodId,
          accountId: query.accountId,
        });
        return rows.map((r) => ({
          organizationId: r.organizationId,
          financialAreaId: r.financialAreaId,
          fiscalYearId: r.fiscalYearId,
          accountingPeriodId: r.accountingPeriodId,
          accountId: r.accountId,
          mismatchKind: r.mismatchKind,
          ledgerDebitAmount: r.ledgerDebit,
          ledgerCreditAmount: r.ledgerCredit,
          projectionDebitAmount: r.projDebit,
          projectionCreditAmount: r.projCredit,
        }));
      },
    );

    let filtered = allMismatches;
    if (query.mismatchKind !== undefined) {
      filtered = allMismatches.filter(
        (m) => m.mismatchKind === query.mismatchKind,
      );
    }

    const { skip } = toOffset(page, pageSize);
    const total = filtered.length;
    const items = filtered.slice(skip, skip + pageSize);

    return toPaginatedResult(items, total, page, pageSize);
  }

  // ---- rebuild (explicit, audited, atomic) --------------------------------

  async rebuildBalances(input: RebuildBalancesInput): Promise<RebuildResult> {
    await this.authorization.requireAllPermissions([
      BALANCE_PERMISSIONS.REBUILD,
    ]);
    await this.organizations.assertOrganizationInScope(input.organizationId);
    await this.organizations.requireUsableOrganization(input.organizationId);
    await this.assertScopeKeysInOrganization(input);

    const actorId = getPrincipal()?.userId ?? null;
    const { deleted, inserted } = await this.balances.rebuildScoped({
      organizationId: input.organizationId,
      financialAreaId: input.financialAreaId,
      fiscalYearId: input.fiscalYearId,
      actorId,
    });

    await publishEvent(this.events, {
      type: ACCOUNT_BALANCE_REBUILT_EVENT,
      aggregateType: 'AccountBalanceProjection',
      aggregateId: input.organizationId,
      payload: {
        organizationId: input.organizationId,
        financialAreaId: input.financialAreaId ?? null,
        fiscalYearId: input.fiscalYearId ?? null,
        deleted,
        inserted,
        reason: input.reason ?? null,
        rebuiltBy: actorId,
        rebuiltAt: new Date().toISOString(),
      },
    });

    this.logger.log(
      'Balance projection rebuilt',
      {
        organizationId: input.organizationId,
        financialAreaId: input.financialAreaId ?? null,
        fiscalYearId: input.fiscalYearId ?? null,
        deleted,
        inserted,
        reason: input.reason ?? null,
      },
      AccountingBalancesService.name,
    );

    return {
      organizationId: input.organizationId,
      financialAreaId: input.financialAreaId ?? null,
      fiscalYearId: input.fiscalYearId ?? null,
      deleted,
      inserted,
    };
  }

  // ---- helpers --------------------------------------------------------------

  private async assertScopeKeysInOrganization(input: {
    organizationId: string;
    financialAreaId?: string | undefined;
    fiscalYearId?: string | undefined;
    accountingPeriodId?: string | undefined;
    accountId?: string | undefined;
  }): Promise<void> {
    // Generic Prisma client for ad-hoc reads — module-owned tables only,
    // organization boundary checks already validated org usability above.
    const client = await this.prisma.getClient<{
      financialArea: { findFirst(a: any): Promise<any> };
      fiscalYear: { findFirst(a: any): Promise<any> };
      accountingPeriod: { findFirst(a: any): Promise<any> };
      account: { findFirst(a: any): Promise<any> };
    }>();

    if (input.financialAreaId !== undefined) {
      const area = await client.financialArea.findFirst({
        where: {
          id: input.financialAreaId,
          organizationId: input.organizationId,
        },
      });
      if (area === null)
        throw AppException.notFound('FinancialArea', input.financialAreaId);
    }
    if (input.fiscalYearId !== undefined) {
      const year = await client.fiscalYear.findFirst({
        where: { id: input.fiscalYearId, organizationId: input.organizationId },
      });
      if (year === null)
        throw AppException.notFound('FiscalYear', input.fiscalYearId);
      if (
        input.financialAreaId !== undefined &&
        year.financialAreaId !== input.financialAreaId
      ) {
        throw AppException.businessRule(
          'The fiscal year does not belong to the requested financial area.',
        );
      }
    }
    if (input.accountingPeriodId !== undefined) {
      const period = await client.accountingPeriod.findFirst({
        where: {
          id: input.accountingPeriodId,
          organizationId: input.organizationId,
        },
      });
      if (period === null)
        throw AppException.notFound(
          'AccountingPeriod',
          input.accountingPeriodId,
        );
      if (
        input.fiscalYearId !== undefined &&
        period.fiscalYearId !== input.fiscalYearId
      ) {
        throw AppException.businessRule(
          'The accounting period does not belong to the requested fiscal year.',
        );
      }
    }
    if (input.accountId !== undefined) {
      await this.assertAccountInOrganization(
        input.accountId,
        input.organizationId,
      );
    }
  }

  private async assertAccountInOrganization(
    accountId: string,
    organizationId: string,
  ): Promise<void> {
    const client = await this.prisma.getClient<{
      account: { findFirst(a: any): Promise<any> };
    }>();
    const account = await client.account.findFirst({
      where: { id: accountId, organizationId },
    });
    if (account === null) throw AppException.notFound('Account', accountId);
  }

  private async loadPeriodsByYear(
    organizationId: string,
    fiscalYearIds: readonly string[],
  ): Promise<Map<string, readonly { id: string; sequence: number }[]>> {
    const client = await this.prisma.getClient<{
      accountingPeriod: {
        findMany(
          args: any,
        ): Promise<
          Array<{ id: string; fiscalYearId: string; sequence: number }>
        >;
      };
    }>();

    // When no fiscalYearIds were touched (empty page), return empty map.
    if (fiscalYearIds.length === 0) return new Map();

    // For single-year account views we still want all periods of those years;
    // otherwise we only need periods of the years on the page — both are correct
    // because derivation is partitioned by year.
    const periods = await client.accountingPeriod.findMany({
      where: {
        organizationId,
        fiscalYearId:
          fiscalYearIds.length === 1
            ? fiscalYearIds[0]
            : { in: [...fiscalYearIds] },
      } as never,
      orderBy: [{ sequence: 'asc' }],
      skip: 0,
      take: 1000,
    });

    const byYear = new Map<string, Array<{ id: string; sequence: number }>>();
    for (const p of periods) {
      let arr = byYear.get(p.fiscalYearId);
      if (arr === undefined) {
        arr = [];
        byYear.set(p.fiscalYearId, arr);
      }
      arr.push({ id: p.id, sequence: p.sequence });
    }
    for (const arr of byYear.values())
      arr.sort((a, b) => a.sequence - b.sequence);
    return byYear as Map<string, readonly { id: string; sequence: number }[]>;
  }
}

function sortDerived(
  rows: ReturnType<typeof deriveBalances>,
  orderBy: Array<Record<string, 'asc' | 'desc'>>,
): ReturnType<typeof deriveBalances> {
  // Compose comparator for up to N orderBy entries (small N).
  return rows.sort((a, b) => {
    for (const clause of orderBy) {
      const [field, dir] = Object.entries(clause)[0] as [
        string,
        'asc' | 'desc',
      ];
      let av: string | number = '';
      let bv: string | number = '';
      switch (field) {
        case 'periodSequence':
          av = a.periodSequence;
          bv = b.periodSequence;
          break;
        case 'accountId':
          av = a.accountId;
          bv = b.accountId;
          break;
        case 'periodDebitAmount':
          av = a.periodDebitAmount;
          bv = b.periodDebitAmount;
          break;
        case 'periodCreditAmount':
          av = a.periodCreditAmount;
          bv = b.periodCreditAmount;
          break;
        case 'createdAt':
        case 'updatedAt':
          // No stored timestamp on derived — treat as op.
          continue;
        default:
          continue;
      }
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1 : -1;
    }
    return 0;
  });
}

function toAmountString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { toString?: unknown }).toString === 'function'
  ) {
    return (value as { toString(): string }).toString();
  }
  throw new Error(
    `Cannot map balance amount of type "${typeof value}" to a decimal string.`,
  );
}
