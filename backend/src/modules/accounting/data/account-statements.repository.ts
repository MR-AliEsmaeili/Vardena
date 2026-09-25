import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { canonicalizeAmount } from '../domain/money.js';
import type { LedgerEntry } from '../domain/ledger-entry.js';
import type { LedgerEntryRow, OrderBy } from './accounting-rows.js';
import {
  storedAmountToString,
  toLedgerEntryFromRow,
} from './ledger-entries.repository.js';

/**
 * Data access for the Account Statement (Task 17B Account Statement slice,
 * Owner decisions D1–D7 — `docs/tasks/task-17/task-17b-prompt.md` §4).
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
 * - NO client-controlled ordering. The window is always read in the fixed
 *   statement order (the Task 17A legal-book default terminated by the unique
 *   entry id) — the running balance depends on that order, and arbitrary
 *   client SQL ordering is forbidden (prompt §11).
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
}

/** Account identity + flags needed for scope validation (never nature). */
export interface StatementAccountRef {
  id: string;
  code: string;
  title: string;
  isPostable: boolean;
  isActive: boolean;
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
  startDate: Date;
  endDate: Date;
  status: string;
}

export interface StatementPeriodRef {
  id: string;
  sequence: number;
  title: string;
  startDate: Date;
  endDate: Date;
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
      where: StatementLedgerWhere;
      orderBy: OrderBy;
      skip: number;
      take: number;
    }): Promise<LedgerEntryRow[]>;
    count(args: { where: StatementLedgerWhere }): Promise<number>;
    aggregate(args: {
      where: StatementLedgerWhere;
      _sum: { debitAmount: true; creditAmount: true };
    }): Promise<{
      _sum: { debitAmount: unknown | null; creditAmount: unknown | null };
    }>;
  };
};

type StatementClient = LedgerWindowClient & {
  account: {
    findFirst(args: { where: StatementWhere }): Promise<{
      id: string;
      code: string;
      title: string;
      isPostable: boolean;
      isActive: boolean;
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
    options?: { isolationLevel?: string },
  ): Promise<T>;
};

@Injectable()
export class AccountStatementsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<StatementClient> {
    return this.prisma.getClient<StatementClient>();
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
          startDate: row.startDate,
          endDate: row.endDate,
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
    },
    skip: number,
    take: number,
  ): Promise<AccountStatementLedgerFacts> {
    const client = await this.client();
    return client.$transaction(
      async (tx) => {
        const window = params.window;
        const [total, windowSums, priorSums, prePageAmounts, rows] =
          await Promise.all([
            tx.ledgerEntry.count({ where: window }),
            tx.ledgerEntry.aggregate({
              where: window,
              _sum: { debitAmount: true, creditAmount: true },
            }),
            params.priorPeriodIds.length === 0
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
      { isolationLevel: 'RepeatableRead' },
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
    startDate: row.startDate,
    endDate: row.endDate,
    status: row.status,
  };
}

/** `SUM` over zero rows is SQL `NULL` — the exact neutral `0`. */
function sumOrZero(value: unknown | null): string {
  return value === null || value === undefined
    ? '0'
    : canonicalizeAmount(storedAmountToString(value));
}
