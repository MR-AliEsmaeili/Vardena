import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import {
  businessDateFromDbDate,
  businessDateToDbDate,
  isGregorianBusinessDate,
  type BusinessDate,
} from '../../../kernel/datetime/business-date.js';
import { canonicalizeAmount, subtractAmounts } from '../domain/money.js';
import type { LedgerEntry } from '../domain/ledger-entry.js';
import type { LedgerEntryRow, OrderBy } from './accounting-rows.js';
import {
  storedAmountToString,
  toLedgerEntryFromRow,
} from './ledger-entries.repository.js';

/**
 * Shared Accounting Read/Query Layer for bounded Accounting reports (Task 18).
 * Account Statement, General Ledger and Trial Balance all consume this
 * Accounting-owned read boundary over the immutable ledger and chart/calendar.
 * It is not a generic reporting engine: filters, joins, ordering and aggregates
 * are fixed by the explicit report contracts.
 *
 * WHAT IT READS
 *
 * - scope rows of Accounting-owned master data — `accounting.accounts`,
 *   `accounting.financial_areas`, `accounting.fiscal_years`,
 *   `accounting.accounting_periods` — for validation, labels and the period
 *   `sequence` the accepted intra-year opening is ordered by (ADR-0031 §4);
 * - the immutable `accounting.ledger_entries` window itself: the page rows,
 *   the row count, the exact window aggregates, the prior-SEQUENCE opening
 *   aggregates and the pre-page nets the running balance needs.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * - NO write path of any kind. Every delegate below is typed read-only
 *   (`findFirst` / `findMany` / `count` / `aggregate`): no `create`, no
 *   `update`, no `delete`, no `FOR UPDATE`/`FOR SHARE` — the statement must
 *   not mutate ledger entries, vouchers, accounts, periods or projections
 *   (prompt §24 "Regression", ADR-0032 read posture, decision D5).
 * - NO second truth and NO persistence. Opening/running/closing are derived
 *   per request from ledger facts exactly as ADR-0031 §2/§4 derives them;
 *   the Task 12 projection is never read here (reconciliation to
 *   `vw_account_balance_derived` is a TEST obligation, not a runtime input).
 * - NO arbitrary client-controlled SQL ordering. Each report accepts only its
 *   small code-defined sort allow-list; the primary sort is emitted with
 *   bound CASE values and deterministic Accounting-owned tie-breakers (prompt
 *   §11). The account statement retains its legal-book order because running
 *   balances depend on it.
 * - NO cross-module read (AR-07/AR-16): Accounting-owned tables only.
 *
 * SNAPSHOT (prompt §13 "consistent predicates"; gate R-6)
 *
 * The five window statements (count, window sums, opening sums, pre-page
 * nets, page) run inside ONE read-only interactive transaction at
 * `REPEATABLE READ`, so every figure of one response derives from one
 * snapshot even while an open period receives postings. The transaction is
 * per-request and short-lived; it never spans requests (gate RB-6).
 */

/** The fixed statement order — `ACCOUNT_STATEMENT_ORDER_BASIS`, as clauses. */
export const STATEMENT_ORDER: OrderBy = [
  { documentDate: 'asc' },
  { voucherNumber: 'asc' },
  { lineNo: 'asc' },
  { id: 'asc' },
];

/**
 * The statement window predicate: ONE account of ONE fiscal year inside ONE
 * organization and the year's single financial area (decisions D1/D4), plus
 * either the requested period or the lower-SEQUENCE period set used solely to
 * measure the intra-year opening (decision D2).
 */
export interface StatementLedgerWhere {
  organizationId: string;
  financialAreaId: string;
  fiscalYearId: string;
  accountId: string;
  /** A single period (movement window) or a set (opening window). */
  accountingPeriodId?: string | { in: string[] };
  /** Optional primary financial reporting date bounds (BusinessDate days). */
  documentDate?: {
    gte?: BusinessDate;
    lte?: BusinessDate;
    lt?: BusinessDate;
  };
}

type StatementLedgerDbWhere = Omit<StatementLedgerWhere, 'documentDate'> & {
  documentDate?: { gte?: Date; lte?: Date; lt?: Date };
};

/** Account identity + flags needed for scope validation (never nature). */
export interface StatementAccountRef {
  id: string;
  code: string;
  title: string;
  isPostable: boolean;
  isActive: boolean;
  /** Optional parent edge used to validate an explicit hierarchy root. */
  parentId?: string | null;
}

/** Explicit account filters shared by General Ledger and Trial Balance. */
export interface AccountingReportAccountFilter {
  accountHierarchyId?: string | undefined;
  accountCode?: string | undefined;
  accountName?: string | undefined;
}

export interface AccountingReportScopeFilter extends AccountingReportAccountFilter {
  organizationId: string;
  financialAreaId: string;
  accountId?: string | undefined;
  fiscalYearId: string;
  accountingPeriodId?: string | undefined;
  dateFrom?: BusinessDate | undefined;
  dateTo?: BusinessDate | undefined;
  /** Use the explicit dateFrom boundary instead of sequence-based opening. */
  dateFromExplicit?: boolean | undefined;
  /** Apply the explicit dateTo boundary to movement rows. */
  dateToExplicit?: boolean | undefined;
}

export interface GeneralLedgerReadRow {
  id: string;
  organizationId: string;
  financialAreaId: string;
  fiscalYearId: string;
  accountingPeriodId: string;
  documentDate: BusinessDate;
  postingTimestamp: string;
  documentType: string;
  documentId: string;
  ledgerLineId: string;
  voucherLineId: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  reference: string | null;
  description: string | null;
  debit: string;
  credit: string;
  net: string;
  voucherNumber: string;
  lineNo: number;
  origin: string;
  sourceModule: string | null;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  sourceOperation: string | null;
}

export interface TrialBalanceReadRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  role: 'POSTING' | 'AGGREGATION';
  openingDebit: string;
  openingCredit: string;
  debit: string;
  credit: string;
}

export interface StatementAreaRef {
  id: string;
  code: string;
  title: string;
}

export interface StatementYearRef {
  id: string;
  financialAreaId: string;
  code: string;
  title: string;
  startDate: BusinessDate;
  endDate: BusinessDate;
  status: string;
}

export interface StatementPeriodRef {
  id: string;
  sequence: number;
  title: string;
  startDate: BusinessDate;
  endDate: BusinessDate;
  status: string;
}

/**
 * Everything the statement math needs, measured over ONE window predicate in
 * ONE snapshot. Money fields are already canonical decimal strings.
 */
export interface AccountStatementLedgerFacts {
  /** Row count of the movement window. */
  total: number;
  /** Σ debit over the movement window (never the current page). */
  debitTotal: string;
  /** Σ credit over the movement window (never the current page). */
  creditTotal: string;
  /** Σ debit over the prior-SEQUENCE periods (opening input; `0` if none). */
  priorPeriodDebit: string;
  /** Σ credit over the prior-SEQUENCE periods (opening input; `0` if none). */
  priorPeriodCredit: string;
  /**
   * The `(debit, credit)` of every window row BEFORE the requested page, in
   * statement order — the running balance's page base (O(offset) fetch of two
   * columns; bounded by one account-year, gate SCL-3).
   */
  prePageAmounts: Array<{ debitAmount: string; creditAmount: string }>;
  /** The requested page of window rows, in statement order. */
  rows: LedgerEntry[];
}

type StatementWhere = {
  organizationId: string;
  id: string;
};

type LedgerWindowClient = {
  ledgerEntry: {
    findMany(args: {
      where: StatementLedgerDbWhere;
      orderBy: OrderBy;
      skip: number;
      take: number;
    }): Promise<LedgerEntryRow[]>;
    count(args: { where: StatementLedgerDbWhere }): Promise<number>;
    aggregate(args: {
      where: StatementLedgerDbWhere;
      _sum: { debitAmount: true; creditAmount: true };
    }): Promise<{
      _sum: { debitAmount: unknown | null; creditAmount: unknown | null };
    }>;
  };
};

type RawQueryClient = {
  $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $transaction<T>(
    fn: (tx: RawQueryClient) => Promise<T>,
    options?: { isolationLevel?: string; timeout?: number },
  ): Promise<T>;
};

type StatementClient = LedgerWindowClient & {
  account: {
    findFirst(args: { where: StatementWhere }): Promise<{
      id: string;
      code: string;
      title: string;
      isPostable: boolean;
      isActive: boolean;
      parentId: string | null;
    } | null>;
  };
  financialArea: {
    findFirst(args: { where: StatementWhere }): Promise<{
      id: string;
      code: string;
      title: string;
    } | null>;
  };
  fiscalYear: {
    findFirst(args: { where: StatementWhere }): Promise<{
      id: string;
      financialAreaId: string;
      code: string;
      title: string;
      startDate: Date;
      endDate: Date;
      status: string;
    } | null>;
  };
  accountingPeriod: {
    findFirst(args: { where: StatementWhere }): Promise<{
      id: string;
      sequence: number;
      title: string;
      startDate: Date;
      endDate: Date;
      status: string;
    } | null>;
    findMany(args: {
      where: { organizationId: string; fiscalYearId: string };
      orderBy: OrderBy;
    }): Promise<
      Array<{
        id: string;
        sequence: number;
        title: string;
        startDate: Date;
        endDate: Date;
        status: string;
      }>
    >;
  };
  $transaction<T>(
    fn: (tx: LedgerWindowClient) => Promise<T>,
    options?: { isolationLevel?: string; timeout?: number },
  ): Promise<T>;
};

@Injectable()
export class AccountingReadQueryRepository {
  constructor(private readonly prisma: PrismaService) {}

  protected client(): Promise<StatementClient> {
    return this.prisma.getClient<StatementClient>();
  }

  private rawClient(): Promise<RawQueryClient> {
    return this.prisma.getClient<RawQueryClient>();
  }

  // ---- scope reads (organization-first, labels only) ----------------------

  async findAccount(
    organizationId: string,
    accountId: string,
  ): Promise<StatementAccountRef | null> {
    const { account } = await this.client();
    const row = await account.findFirst({
      where: { organizationId, id: accountId },
    });
    return row === null
      ? null
      : {
          id: row.id,
          code: row.code,
          title: row.title,
          isPostable: row.isPostable,
          isActive: row.isActive,
          parentId: row.parentId,
        };
  }

  async findFinancialArea(
    organizationId: string,
    financialAreaId: string,
  ): Promise<StatementAreaRef | null> {
    const { financialArea } = await this.client();
    const row = await financialArea.findFirst({
      where: { organizationId, id: financialAreaId },
    });
    return row === null
      ? null
      : { id: row.id, code: row.code, title: row.title };
  }

  async findFiscalYear(
    organizationId: string,
    fiscalYearId: string,
  ): Promise<StatementYearRef | null> {
    const { fiscalYear } = await this.client();
    const row = await fiscalYear.findFirst({
      where: { organizationId, id: fiscalYearId },
    });
    return row === null
      ? null
      : {
          id: row.id,
          financialAreaId: row.financialAreaId,
          code: row.code,
          title: row.title,
          startDate: businessDateFromDbDate(row.startDate),
          endDate: businessDateFromDbDate(row.endDate),
          status: row.status,
        };
  }

  async findPeriod(
    organizationId: string,
    accountingPeriodId: string,
  ): Promise<StatementPeriodRef | null> {
    const { accountingPeriod } = await this.client();
    const row = await accountingPeriod.findFirst({
      where: { organizationId, id: accountingPeriodId },
    });
    return row === null ? null : toPeriodRef(row);
  }

  /**
   * The year's periods in `sequence` order — the accepted opening order
   * (ADR-0031 §4). Deliberately the FULL set (not a filter result): the
   * prior-SEQUENCE opening and the period-sequence-vs-calendar caveat are
   * derived from it, and gaps in the sequence are legal (§7.1).
   */
  async listPeriodsOfYear(
    organizationId: string,
    fiscalYearId: string,
  ): Promise<StatementPeriodRef[]> {
    const { accountingPeriod } = await this.client();
    const rows = await accountingPeriod.findMany({
      where: { organizationId, fiscalYearId },
      orderBy: [{ sequence: 'asc' }],
    });
    return rows.map(toPeriodRef);
  }

  // ---- the window reads (ONE snapshot) ------------------------------------

  /**
   * Measure the statement window in ONE `REPEATABLE READ` read-only
   * transaction: count + window sums + prior-SEQUENCE opening sums +
   * pre-page nets + the page, all over the SAME predicate and the SAME fixed
   * order. The caller supplies `priorPeriodIds` (lower-sequence periods of
   * the same year — never another year's, decision D2) and the page offset.
   */
  async readStatementLedgerFacts(
    params: {
      window: StatementLedgerWhere;
      priorPeriodIds: readonly string[];
      /** Explicit Document Date opening boundary, when supplied. */
      openingBefore?: BusinessDate | undefined;
    },
    skip: number,
    take: number,
  ): Promise<AccountStatementLedgerFacts> {
    const client = await this.client();
    return client.$transaction(
      async (tx) => {
        const window = statementWhereToDbWhere(params.window);
        const [total, windowSums, priorSums, prePageAmounts, rows] =
          await Promise.all([
            tx.ledgerEntry.count({ where: window }),
            tx.ledgerEntry.aggregate({
              where: window,
              _sum: { debitAmount: true, creditAmount: true },
            }),
            params.openingBefore !== undefined
              ? tx.ledgerEntry.aggregate({
                  where: {
                    organizationId: window.organizationId,
                    financialAreaId: window.financialAreaId,
                    fiscalYearId: window.fiscalYearId,
                    accountId: window.accountId,
                    documentDate: { lt: dbBusinessDate(params.openingBefore) },
                  },
                  _sum: { debitAmount: true, creditAmount: true },
                })
              : params.priorPeriodIds.length === 0
                ? Promise.resolve(null)
                : tx.ledgerEntry.aggregate({
                    where: {
                      organizationId: window.organizationId,
                      financialAreaId: window.financialAreaId,
                      fiscalYearId: window.fiscalYearId,
                      accountId: window.accountId,
                      accountingPeriodId: { in: [...params.priorPeriodIds] },
                    },
                    _sum: { debitAmount: true, creditAmount: true },
                  }),
            skip === 0
              ? Promise.resolve([])
              : tx.ledgerEntry.findMany({
                  where: window,
                  orderBy: STATEMENT_ORDER,
                  skip: 0,
                  take: skip,
                }),
            tx.ledgerEntry.findMany({
              where: window,
              orderBy: STATEMENT_ORDER,
              skip,
              take,
            }),
          ]);

        return {
          total,
          debitTotal: sumOrZero(windowSums._sum.debitAmount),
          creditTotal: sumOrZero(windowSums._sum.creditAmount),
          priorPeriodDebit:
            priorSums === null ? '0' : sumOrZero(priorSums._sum.debitAmount),
          priorPeriodCredit:
            priorSums === null ? '0' : sumOrZero(priorSums._sum.creditAmount),
          prePageAmounts: prePageAmounts.map((row) => ({
            debitAmount: canonicalizeAmount(
              storedAmountToString(row.debitAmount),
            ),
            creditAmount: canonicalizeAmount(
              storedAmountToString(row.creditAmount),
            ),
          })),
          rows: rows.map(toLedgerEntryFromRow),
        };
      },
      // One snapshot for every figure of the response (gate R-6): a posting
      // committed mid-request can never make the totals disagree with the
      // page. Read-only by construction — the block writes nothing.
      {
        isolationLevel: 'RepeatableRead',
        timeout: REPORT_QUERY_TIMEOUT_MS,
      },
    );
  }

  /**
   * General Ledger rows. The joins remain inside Accounting: document type
   * comes from the authoritative voucher, reference from the authoritative
   * line reference, and account labels are joined by permanent Account.id.
   * The query is parameterized; the primary sort is selected from a
   * code-defined allow-list and never interpolated as an identifier.
   */
  async readGeneralLedger(
    filter: AccountingReportScopeFilter,
    orderBy: readonly AccountingReadOrderClause[],
    skip: number,
    take: number,
  ): Promise<{ items: GeneralLedgerReadRow[]; total: number }> {
    const client = await this.rawClient();
    return client.$transaction(
      async (tx) => {
        const hierarchyId = filter.accountHierarchyId ?? null;
        const accountId = filter.accountId ?? null;
        const accountCode = filter.accountCode ?? null;
        const accountName = filter.accountName ?? null;
        const periodId = filter.accountingPeriodId ?? null;
        const dateFrom = filter.dateFrom ?? null;
        const dateTo = filter.dateTo ?? null;
        const dateFromExplicit =
          filter.dateFromExplicit ?? filter.dateFrom !== undefined;
        const dateToExplicit =
          filter.dateToExplicit ?? filter.dateTo !== undefined;
        const primarySort = orderBy[0] ?? {
          field: 'documentDate',
          direction: 'asc' as const,
        };

        const [rows, countRows] = await Promise.all([
          tx.$queryRaw<GeneralLedgerRawRow[]>`
            WITH RECURSIVE hierarchy_accounts AS (
              SELECT a."id", a."parent_id"
                FROM "accounting"."accounts" a
               WHERE a."organization_id" = ${filter.organizationId}
                 AND a."id" = ${hierarchyId}
              UNION ALL
              SELECT child."id", child."parent_id"
                FROM "accounting"."accounts" child
                JOIN hierarchy_accounts parent
                  ON parent."id" = child."parent_id"
               WHERE child."organization_id" = ${filter.organizationId}
            ), account_scope AS (
              SELECT a."id", a."code", a."title"
                FROM "accounting"."accounts" a
               WHERE a."organization_id" = ${filter.organizationId}
                 AND (${hierarchyId}::text IS NULL OR EXISTS (
                   SELECT 1 FROM hierarchy_accounts h WHERE h."id" = a."id"
                 ))
                 AND (${accountId}::text IS NULL OR a."id" = ${accountId})
                 AND (${accountCode}::text IS NULL OR a."code" = ${accountCode})
                 AND (${accountName}::text IS NULL OR
                      STRPOS(LOWER(a."title"), LOWER(${accountName})) > 0)
            )
            SELECT le."id" AS "id",
                   le."organization_id" AS "organizationId",
                   le."financial_area_id" AS "financialAreaId",
                   le."fiscal_year_id" AS "fiscalYearId",
                   le."accounting_period_id" AS "accountingPeriodId",
                   le."document_date" AS "documentDate",
                   le."posting_timestamp" AS "postingTimestamp",
                   ad."document_type" AS "documentType",
                   le."voucher_id" AS "documentId",
                   le."voucher_line_id" AS "ledgerLineId",
                   le."voucher_line_id" AS "voucherLineId",
                   le."line_no" AS "lineNo",
                   le."origin" AS "origin",
                   le."account_id" AS "accountId",
                   a."code" AS "accountCode",
                   a."title" AS "accountName",
                   dl."source_line_reference" AS "reference",
                   le."description" AS "description",
                   le."debit_amount" AS "debit",
                   le."credit_amount" AS "credit",
                   le."voucher_number" AS "voucherNumber",
                   le."source_module" AS "sourceModule",
                   le."source_entity_type" AS "sourceEntityType",
                   le."source_entity_id" AS "sourceEntityId",
                   le."source_operation" AS "sourceOperation"
              FROM "accounting"."ledger_entries" le
              JOIN account_scope a ON a."id" = le."account_id"
              JOIN "accounting"."accounting_documents" ad
                ON ad."id" = le."voucher_id"
               AND ad."organization_id" = le."organization_id"
              JOIN "accounting"."accounting_document_lines" dl
                ON dl."id" = le."voucher_line_id"
               AND dl."organization_id" = le."organization_id"
             WHERE le."organization_id" = ${filter.organizationId}
               AND le."financial_area_id" = ${filter.financialAreaId}
               AND le."fiscal_year_id" = ${filter.fiscalYearId}
               AND (${periodId}::text IS NULL OR le."accounting_period_id" = ${periodId})
               AND (${dateFromExplicit} = false OR le."document_date" >= ${dateFrom}::date)
               AND (${dateToExplicit} = false OR le."document_date" <= ${dateTo}::date)
             ORDER BY
               CASE WHEN ${primarySort.field} = 'documentDate'
                          AND ${primarySort.direction} = 'asc'
                    THEN le."document_date" END ASC,
               CASE WHEN ${primarySort.field} = 'documentDate'
                          AND ${primarySort.direction} = 'desc'
                    THEN le."document_date" END DESC,
               CASE WHEN ${primarySort.field} = 'postingTimestamp'
                          AND ${primarySort.direction} = 'asc'
                    THEN le."posting_timestamp" END ASC,
               CASE WHEN ${primarySort.field} = 'postingTimestamp'
                          AND ${primarySort.direction} = 'desc'
                    THEN le."posting_timestamp" END DESC,
               CASE WHEN ${primarySort.field} = 'documentId'
                          AND ${primarySort.direction} = 'asc'
                    THEN le."voucher_id" END ASC,
               CASE WHEN ${primarySort.field} = 'documentId'
                          AND ${primarySort.direction} = 'desc'
                    THEN le."voucher_id" END DESC,
               CASE WHEN ${primarySort.field} = 'ledgerLineId'
                          AND ${primarySort.direction} = 'asc'
                    THEN le."voucher_line_id" END ASC,
               CASE WHEN ${primarySort.field} = 'ledgerLineId'
                          AND ${primarySort.direction} = 'desc'
                    THEN le."voucher_line_id" END DESC,
               CASE WHEN ${primarySort.field} = 'accountCode'
                          AND ${primarySort.direction} = 'asc'
                    THEN a."code" END ASC,
               CASE WHEN ${primarySort.field} = 'accountCode'
                          AND ${primarySort.direction} = 'desc'
                    THEN a."code" END DESC,
               CASE WHEN ${primarySort.field} = 'accountName'
                          AND ${primarySort.direction} = 'asc'
                    THEN a."title" END ASC,
               CASE WHEN ${primarySort.field} = 'accountName'
                          AND ${primarySort.direction} = 'desc'
                    THEN a."title" END DESC,
               CASE WHEN ${primarySort.field} = 'accountId'
                          AND ${primarySort.direction} = 'asc'
                    THEN le."account_id" END ASC,
               CASE WHEN ${primarySort.field} = 'accountId'
                          AND ${primarySort.direction} = 'desc'
                    THEN le."account_id" END DESC,
               le."document_date" ASC, le."posting_timestamp" ASC,
               le."voucher_id" ASC, le."voucher_line_id" ASC, le."id" ASC
             LIMIT ${take} OFFSET ${skip}
          `,
          tx.$queryRaw<CountRawRow[]>`
            WITH RECURSIVE hierarchy_accounts AS (
              SELECT a."id", a."parent_id"
                FROM "accounting"."accounts" a
               WHERE a."organization_id" = ${filter.organizationId}
                 AND a."id" = ${hierarchyId}
              UNION ALL
              SELECT child."id", child."parent_id"
                FROM "accounting"."accounts" child
                JOIN hierarchy_accounts parent
                  ON parent."id" = child."parent_id"
               WHERE child."organization_id" = ${filter.organizationId}
            ), account_scope AS (
              SELECT a."id"
                FROM "accounting"."accounts" a
               WHERE a."organization_id" = ${filter.organizationId}
                 AND (${hierarchyId}::text IS NULL OR EXISTS (
                   SELECT 1 FROM hierarchy_accounts h WHERE h."id" = a."id"
                 ))
                 AND (${accountId}::text IS NULL OR a."id" = ${accountId})
                 AND (${accountCode}::text IS NULL OR a."code" = ${accountCode})
                 AND (${accountName}::text IS NULL OR
                      STRPOS(LOWER(a."title"), LOWER(${accountName})) > 0)
            )
            SELECT COUNT(*)::bigint AS "total"
              FROM "accounting"."ledger_entries" le
              JOIN account_scope a ON a."id" = le."account_id"
             WHERE le."organization_id" = ${filter.organizationId}
               AND le."financial_area_id" = ${filter.financialAreaId}
               AND le."fiscal_year_id" = ${filter.fiscalYearId}
               AND (${periodId}::text IS NULL OR le."accounting_period_id" = ${periodId})
               AND (${dateFromExplicit} = false OR le."document_date" >= ${dateFrom}::date)
               AND (${dateToExplicit} = false OR le."document_date" <= ${dateTo}::date)
          `,
        ]);
        return {
          items: rows.map(toGeneralLedgerRow),
          total: countFrom(countRows),
        };
      },
      { isolationLevel: 'RepeatableRead', timeout: REPORT_QUERY_TIMEOUT_MS },
    );
  }

  /**
   * Trial Balance aggregate. `account_rollup` maps every valid POSTING leaf to
   * itself and each AGGREGATION ancestor. This is the only roll-up path; an
   * aggregation node's own ledger activity is intentionally not treated as a
   * second source, preserving POSTING XOR AGGREGATION and avoiding double
   * counting.
   */
  async readTrialBalance(
    filter: AccountingReportScopeFilter,
    orderBy: readonly AccountingReadOrderClause[],
    skip: number,
    take: number,
  ): Promise<{ items: TrialBalanceReadRow[]; total: number }> {
    const client = await this.rawClient();
    return client.$transaction(
      async (tx) => {
        const hierarchyId = filter.accountHierarchyId ?? null;
        const accountId = filter.accountId ?? null;
        const accountCode = filter.accountCode ?? null;
        const accountName = filter.accountName ?? null;
        const periodId = filter.accountingPeriodId ?? null;
        const dateFrom = filter.dateFrom;
        const dateTo = filter.dateTo;
        const dateFromExplicit =
          filter.dateFromExplicit ?? filter.dateFrom !== undefined;
        const dateToExplicit =
          filter.dateToExplicit ?? filter.dateTo !== undefined;
        const primarySort = orderBy[0] ?? {
          field: 'accountCode',
          direction: 'asc' as const,
        };

        const [rows, countRows] = await Promise.all([
          tx.$queryRaw<TrialBalanceRawRow[]>`
            WITH RECURSIVE scoped_accounts AS (
              SELECT a."id", a."parent_id", a."code", a."title", a."is_postable"
                FROM "accounting"."accounts" a
               WHERE a."organization_id" = ${filter.organizationId}
                 AND (${hierarchyId}::text IS NULL OR a."id" IN (
                   WITH RECURSIVE descendants AS (
                     SELECT root."id"
                       FROM "accounting"."accounts" root
                      WHERE root."organization_id" = ${filter.organizationId}
                        AND root."id" = ${hierarchyId}
                     UNION ALL
                     SELECT child."id"
                       FROM "accounting"."accounts" child
                       JOIN descendants parent ON parent."id" = child."parent_id"
                      WHERE child."organization_id" = ${filter.organizationId}
                   ) SELECT "id" FROM descendants
                 ))
            ), posting_accounts AS (
              SELECT "id" FROM scoped_accounts WHERE "is_postable" = true
            ), period_opening AS (
              SELECT p."id"
                FROM "accounting"."accounting_periods" p
               WHERE p."organization_id" = ${filter.organizationId}
                 AND p."fiscal_year_id" = ${filter.fiscalYearId}
                 AND ${periodId}::text IS NOT NULL
                 AND p."sequence" < (
                   SELECT selected."sequence"
                     FROM "accounting"."accounting_periods" selected
                    WHERE selected."organization_id" = ${filter.organizationId}
                      AND selected."fiscal_year_id" = ${filter.fiscalYearId}
                      AND selected."id" = ${periodId}
                 )
            ), account_rollup AS (
              SELECT p."id" AS "posting_account_id", p."id" AS "report_account_id"
                FROM posting_accounts p
              UNION ALL
              SELECT ar."posting_account_id", parent."id" AS "report_account_id"
                FROM account_rollup ar
                JOIN scoped_accounts current_node
                  ON current_node."id" = ar."report_account_id"
                JOIN scoped_accounts parent
                  ON parent."id" = current_node."parent_id"
            ), activity AS (
              SELECT le."account_id",
                     SUM(CASE
                       WHEN ${dateFromExplicit} = true
                        AND le."document_date" < ${dateFrom}::date
                       THEN le."debit_amount"
                       WHEN ${dateFromExplicit} = false
                        AND ${periodId}::text IS NOT NULL
                        AND le."accounting_period_id" IN (
                          SELECT "id" FROM period_opening
                        )
                       THEN le."debit_amount"
                       ELSE 0
                     END) AS "openingDebit",
                     SUM(CASE
                       WHEN ${dateFromExplicit} = true
                        AND le."document_date" < ${dateFrom}::date
                       THEN le."credit_amount"
                       WHEN ${dateFromExplicit} = false
                        AND ${periodId}::text IS NOT NULL
                        AND le."accounting_period_id" IN (
                          SELECT "id" FROM period_opening
                        )
                       THEN le."credit_amount"
                       ELSE 0
                     END) AS "openingCredit",
                     SUM(CASE
                       WHEN (${dateFromExplicit} = false OR
                             le."document_date" >= ${dateFrom}::date)
                        AND (${dateToExplicit} = false OR
                             le."document_date" <= ${dateTo}::date)
                        AND (${periodId}::text IS NULL OR
                             le."accounting_period_id" = ${periodId})
                       THEN le."debit_amount"
                       ELSE 0
                     END) AS "debit",
                     SUM(CASE
                       WHEN (${dateFromExplicit} = false OR
                             le."document_date" >= ${dateFrom}::date)
                        AND (${dateToExplicit} = false OR
                             le."document_date" <= ${dateTo}::date)
                        AND (${periodId}::text IS NULL OR
                             le."accounting_period_id" = ${periodId})
                       THEN le."credit_amount"
                       ELSE 0
                     END) AS "credit"
                FROM "accounting"."ledger_entries" le
                JOIN posting_accounts p ON p."id" = le."account_id"
               WHERE le."organization_id" = ${filter.organizationId}
                 AND le."financial_area_id" = ${filter.financialAreaId}
                 AND le."fiscal_year_id" = ${filter.fiscalYearId}
               GROUP BY le."account_id"
            ), trial_rows AS (
              SELECT ar."report_account_id" AS "accountId",
                     a."code" AS "accountCode",
                     a."title" AS "accountName",
                     a."is_postable" AS "isPostable",
                     COALESCE(SUM(activity."openingDebit"), 0) AS "openingDebit",
                     COALESCE(SUM(activity."openingCredit"), 0) AS "openingCredit",
                     COALESCE(SUM(activity."debit"), 0) AS "debit",
                     COALESCE(SUM(activity."credit"), 0) AS "credit"
                FROM account_rollup ar
                JOIN scoped_accounts a ON a."id" = ar."report_account_id"
                LEFT JOIN activity ON activity."account_id" = ar."posting_account_id"
               WHERE (${accountId}::text IS NULL OR a."id" = ${accountId})
                 AND (${accountCode}::text IS NULL OR a."code" = ${accountCode})
                 AND (${accountName}::text IS NULL OR
                      STRPOS(LOWER(a."title"), LOWER(${accountName})) > 0)
               GROUP BY ar."report_account_id", a."code", a."title", a."is_postable"
              HAVING COALESCE(SUM(activity."openingDebit"), 0) <> 0
                  OR COALESCE(SUM(activity."openingCredit"), 0) <> 0
                  OR COALESCE(SUM(activity."debit"), 0) <> 0
                  OR COALESCE(SUM(activity."credit"), 0) <> 0
            )
            SELECT "accountId", "accountCode", "accountName",
                   CASE WHEN "isPostable" THEN 'POSTING' ELSE 'AGGREGATION' END AS "role",
                   "openingDebit", "openingCredit", "debit", "credit"
              FROM trial_rows
             ORDER BY
               CASE WHEN ${primarySort.field} = 'accountCode'
                          AND ${primarySort.direction} = 'asc'
                    THEN trial_rows."accountCode" END ASC,
               CASE WHEN ${primarySort.field} = 'accountCode'
                          AND ${primarySort.direction} = 'desc'
                    THEN trial_rows."accountCode" END DESC,
               CASE WHEN ${primarySort.field} = 'accountName'
                          AND ${primarySort.direction} = 'asc'
                    THEN trial_rows."accountName" END ASC,
               CASE WHEN ${primarySort.field} = 'accountName'
                          AND ${primarySort.direction} = 'desc'
                    THEN trial_rows."accountName" END DESC,
               CASE WHEN ${primarySort.field} = 'accountId'
                          AND ${primarySort.direction} = 'asc'
                    THEN trial_rows."accountId" END ASC,
               CASE WHEN ${primarySort.field} = 'accountId'
                          AND ${primarySort.direction} = 'desc'
                    THEN trial_rows."accountId" END DESC,
               CASE WHEN ${primarySort.field} = 'opening'
                          AND ${primarySort.direction} = 'asc'
                    THEN trial_rows."openingDebit" - trial_rows."openingCredit" END ASC,
               CASE WHEN ${primarySort.field} = 'opening'
                          AND ${primarySort.direction} = 'desc'
                    THEN trial_rows."openingDebit" - trial_rows."openingCredit" END DESC,
               CASE WHEN ${primarySort.field} = 'debit'
                          AND ${primarySort.direction} = 'asc'
                    THEN trial_rows."debit" END ASC,
               CASE WHEN ${primarySort.field} = 'debit'
                          AND ${primarySort.direction} = 'desc'
                    THEN trial_rows."debit" END DESC,
               CASE WHEN ${primarySort.field} = 'credit'
                          AND ${primarySort.direction} = 'asc'
                    THEN trial_rows."credit" END ASC,
               CASE WHEN ${primarySort.field} = 'credit'
                          AND ${primarySort.direction} = 'desc'
                    THEN trial_rows."credit" END DESC,
               CASE WHEN ${primarySort.field} = 'periodNet'
                          AND ${primarySort.direction} = 'asc'
                    THEN trial_rows."debit" - trial_rows."credit" END ASC,
               CASE WHEN ${primarySort.field} = 'periodNet'
                          AND ${primarySort.direction} = 'desc'
                    THEN trial_rows."debit" - trial_rows."credit" END DESC,
               CASE WHEN ${primarySort.field} = 'closing'
                          AND ${primarySort.direction} = 'asc'
                    THEN trial_rows."openingDebit" - trial_rows."openingCredit"
                       + trial_rows."debit" - trial_rows."credit" END ASC,
               CASE WHEN ${primarySort.field} = 'closing'
                          AND ${primarySort.direction} = 'desc'
                    THEN trial_rows."openingDebit" - trial_rows."openingCredit"
                       + trial_rows."debit" - trial_rows."credit" END DESC,
               trial_rows."accountCode" ASC, trial_rows."accountId" ASC
             LIMIT ${take} OFFSET ${skip}
          `,
          tx.$queryRaw<CountRawRow[]>`
            WITH RECURSIVE scoped_accounts AS (
              SELECT a."id", a."parent_id", a."code", a."title", a."is_postable"
                FROM "accounting"."accounts" a
               WHERE a."organization_id" = ${filter.organizationId}
                 AND (${hierarchyId}::text IS NULL OR a."id" IN (
                   WITH RECURSIVE descendants AS (
                     SELECT root."id"
                       FROM "accounting"."accounts" root
                      WHERE root."organization_id" = ${filter.organizationId}
                        AND root."id" = ${hierarchyId}
                     UNION ALL
                     SELECT child."id"
                       FROM "accounting"."accounts" child
                       JOIN descendants parent ON parent."id" = child."parent_id"
                      WHERE child."organization_id" = ${filter.organizationId}
                   ) SELECT "id" FROM descendants
                 ))
            ), period_opening AS (
              SELECT p."id"
                FROM "accounting"."accounting_periods" p
               WHERE p."organization_id" = ${filter.organizationId}
                 AND p."fiscal_year_id" = ${filter.fiscalYearId}
                 AND ${periodId}::text IS NOT NULL
                 AND p."sequence" < (
                   SELECT selected."sequence"
                     FROM "accounting"."accounting_periods" selected
                    WHERE selected."organization_id" = ${filter.organizationId}
                      AND selected."fiscal_year_id" = ${filter.fiscalYearId}
                      AND selected."id" = ${periodId}
                 )
            ), posting_accounts AS (
              SELECT "id" FROM scoped_accounts WHERE "is_postable" = true
            ), account_rollup AS (
              SELECT p."id" AS "posting_account_id", p."id" AS "report_account_id"
                FROM posting_accounts p
              UNION ALL
              SELECT ar."posting_account_id", parent."id"
                FROM account_rollup ar
                JOIN scoped_accounts current_node
                  ON current_node."id" = ar."report_account_id"
                JOIN scoped_accounts parent
                  ON parent."id" = current_node."parent_id"
            ), activity AS (
              SELECT le."account_id",
                     SUM(CASE
                       WHEN ${dateFromExplicit} = true
                        AND le."document_date" < ${dateFrom}::date
                       THEN le."debit_amount"
                       WHEN ${dateFromExplicit} = false
                        AND ${periodId}::text IS NOT NULL
                        AND le."accounting_period_id" IN (
                          SELECT "id" FROM period_opening
                        )
                       THEN le."debit_amount"
                       ELSE 0
                     END) AS "openingDebit",
                     SUM(CASE
                       WHEN ${dateFromExplicit} = true
                        AND le."document_date" < ${dateFrom}::date
                       THEN le."credit_amount"
                       WHEN ${dateFromExplicit} = false
                        AND ${periodId}::text IS NOT NULL
                        AND le."accounting_period_id" IN (
                          SELECT "id" FROM period_opening
                        )
                       THEN le."credit_amount"
                       ELSE 0
                     END) AS "openingCredit",
                     SUM(CASE
                       WHEN (${dateFromExplicit} = false OR
                             le."document_date" >= ${dateFrom}::date)
                        AND (${dateToExplicit} = false OR
                             le."document_date" <= ${dateTo}::date)
                        AND (${periodId}::text IS NULL OR
                             le."accounting_period_id" = ${periodId})
                       THEN le."debit_amount"
                       ELSE 0
                     END) AS "debit",
                     SUM(CASE
                       WHEN (${dateFromExplicit} = false OR
                             le."document_date" >= ${dateFrom}::date)
                        AND (${dateToExplicit} = false OR
                             le."document_date" <= ${dateTo}::date)
                        AND (${periodId}::text IS NULL OR
                             le."accounting_period_id" = ${periodId})
                       THEN le."credit_amount"
                       ELSE 0
                     END) AS "credit"
                FROM "accounting"."ledger_entries" le
                JOIN posting_accounts p ON p."id" = le."account_id"
               WHERE le."organization_id" = ${filter.organizationId}
                 AND le."financial_area_id" = ${filter.financialAreaId}
                 AND le."fiscal_year_id" = ${filter.fiscalYearId}
               GROUP BY le."account_id"
            ), trial_rows AS (
              SELECT ar."report_account_id" AS "accountId"
                FROM account_rollup ar
                JOIN scoped_accounts a ON a."id" = ar."report_account_id"
                LEFT JOIN activity ON activity."account_id" = ar."posting_account_id"
               WHERE (${accountId}::text IS NULL OR a."id" = ${accountId})
                 AND (${accountCode}::text IS NULL OR a."code" = ${accountCode})
                 AND (${accountName}::text IS NULL OR
                      STRPOS(LOWER(a."title"), LOWER(${accountName})) > 0)
               GROUP BY ar."report_account_id"
              HAVING COALESCE(SUM(activity."openingDebit"), 0) <> 0
                  OR COALESCE(SUM(activity."openingCredit"), 0) <> 0
                  OR COALESCE(SUM(activity."debit"), 0) <> 0
                  OR COALESCE(SUM(activity."credit"), 0) <> 0
            )
            SELECT COUNT(*)::bigint AS "total" FROM trial_rows
          `,
        ]);
        return {
          items: rows.map(toTrialBalanceRow),
          total: countFrom(countRows),
        };
      },
      { isolationLevel: 'RepeatableRead', timeout: REPORT_QUERY_TIMEOUT_MS },
    );
  }
}

function toPeriodRef(row: {
  id: string;
  sequence: number;
  title: string;
  startDate: Date;
  endDate: Date;
  status: string;
}): StatementPeriodRef {
  return {
    id: row.id,
    sequence: row.sequence,
    title: row.title,
    startDate: businessDateFromDbDate(row.startDate),
    endDate: businessDateFromDbDate(row.endDate),
    status: row.status,
  };
}

/** `SUM` over zero rows is SQL `NULL` — the exact neutral `0`. */
function sumOrZero(value: unknown | null): string {
  return value === null || value === undefined
    ? '0'
    : canonicalizeAmount(storedAmountToString(value));
}

/** Bounded interactive read timeout shared by all Task 18 raw report queries. */
export const REPORT_QUERY_TIMEOUT_MS = 5_000;

export interface AccountingReadOrderClause {
  field: string;
  direction: 'asc' | 'desc';
}

type CountRawRow = { total: bigint | number | string };

type GeneralLedgerRawRow = Omit<
  GeneralLedgerReadRow,
  'documentDate' | 'postingTimestamp' | 'debit' | 'credit' | 'net'
> & {
  documentDate: Date | string;
  postingTimestamp: Date | string;
  debit: unknown;
  credit: unknown;
};

type TrialBalanceRawRow = {
  accountId: string;
  accountCode: string;
  accountName: string;
  role: string;
  openingDebit: unknown;
  openingCredit: unknown;
  debit: unknown;
  credit: unknown;
};

function countFrom(rows: readonly CountRawRow[]): number {
  const value = rows[0]?.total ?? 0;
  const count = typeof value === 'bigint' ? Number(value) : Number(value);
  if (!Number.isSafeInteger(count)) {
    throw new Error(
      'Accounting report row count exceeded the safe integer range.',
    );
  }
  return count;
}

function toDateOnlyString(value: Date | string): BusinessDate {
  if (value instanceof Date) return businessDateFromDbDate(value);
  if (isGregorianBusinessDate(value)) return value;
  throw new Error('Accounting report returned an invalid date.');
}

function toTimestampString(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new Error('Accounting report returned an invalid timestamp.');
  return date.toISOString();
}

function toGeneralLedgerRow(row: GeneralLedgerRawRow): GeneralLedgerReadRow {
  const debit = canonicalizeAmount(storedAmountToString(row.debit));
  const credit = canonicalizeAmount(storedAmountToString(row.credit));
  // The net is deliberately derived by the Accounting money value object,
  // not by a JavaScript number. The database values are exact numeric values.
  return {
    id: row.id,
    organizationId: row.organizationId,
    financialAreaId: row.financialAreaId,
    fiscalYearId: row.fiscalYearId,
    accountingPeriodId: row.accountingPeriodId,
    documentDate: toDateOnlyString(row.documentDate),
    postingTimestamp: toTimestampString(row.postingTimestamp),
    documentType: row.documentType,
    documentId: row.documentId,
    ledgerLineId: row.ledgerLineId,
    voucherLineId: row.voucherLineId,
    accountId: row.accountId,
    accountCode: row.accountCode,
    accountName: row.accountName,
    reference: row.reference,
    description: row.description,
    debit,
    credit,
    net: subtractAmounts(debit, credit),
    voucherNumber: row.voucherNumber,
    sourceModule: row.sourceModule,
    sourceEntityType: row.sourceEntityType,
    sourceEntityId: row.sourceEntityId,
    sourceOperation: row.sourceOperation,
    lineNo: row.lineNo,
    origin: row.origin,
  };
}

function toTrialBalanceRow(row: TrialBalanceRawRow): TrialBalanceReadRow {
  if (row.role !== 'POSTING' && row.role !== 'AGGREGATION') {
    throw new Error(
      `Accounting report returned an unknown account role: ${row.role}.`,
    );
  }
  return {
    accountId: row.accountId,
    accountCode: row.accountCode,
    accountName: row.accountName,
    role: row.role,
    openingDebit: canonicalizeAmount(storedAmountToString(row.openingDebit)),
    openingCredit: canonicalizeAmount(storedAmountToString(row.openingCredit)),
    debit: canonicalizeAmount(storedAmountToString(row.debit)),
    credit: canonicalizeAmount(storedAmountToString(row.credit)),
  };
}

/**
 * Sort identifiers are intentionally not interpolated into these queries.
 * Task 18 exposes only reviewed field names and directions; the raw queries
 * use bound CASE expressions plus fixed tie-breakers rather than a client SQL
 * fragment.
 */

function statementWhereToDbWhere(
  where: StatementLedgerWhere,
): StatementLedgerDbWhere {
  const { documentDate: bounds, ...base } = where;
  if (bounds === undefined) return base;
  const documentDate: { gte?: Date; lte?: Date; lt?: Date } = {};
  if (bounds.gte !== undefined) documentDate.gte = dbBusinessDate(bounds.gte);
  if (bounds.lte !== undefined) documentDate.lte = dbBusinessDate(bounds.lte);
  if (bounds.lt !== undefined) documentDate.lt = dbBusinessDate(bounds.lt);
  return { ...base, documentDate };
}

function dbBusinessDate(value: BusinessDate): Date {
  const carrier = businessDateToDbDate(value);
  if (carrier === null) {
    throw new Error(`Invalid canonical Accounting BusinessDate "${value}".`);
  }
  return carrier;
}
