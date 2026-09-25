import { Injectable } from '@nestjs/common';
import { toOffset } from '../../../kernel/pagination/paginated-result.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import {
  AccountStatementsRepository,
  type StatementAccountRef,
  type StatementAreaRef,
  type StatementPeriodRef,
  type StatementYearRef,
} from '../data/account-statements.repository.js';
import { ACCOUNT_STATEMENT_PERMISSIONS } from '../domain/accounting-permissions.js';
import {
  buildAccountStatement,
  netAmountOf,
  renderAccountRef,
  renderAreaRef,
  renderPeriodRef,
  renderYearRef,
  type AccountStatementDto,
} from '../domain/account-statement.js';
import { sumAmounts } from '../domain/money.js';
import { parseOptionalDocumentDate } from './accounting-document-support.js';

/**
 * Account Statement — the bounded, read-only account-movement inquiry
 * (Task 17B Account Statement slice; Owner decisions D1–D7).
 *
 * WHAT IT ANSWERS
 *
 * «این حساب چه گردشی داشته است؟» for ONE postable account of ONE fiscal year
 * (optional ONE accounting period), from the immutable ledger only: opening,
 * debit/credit/net movement rows with running balances, and closing. It is
 * the canonical account-movement calculation (prompt §19–§20) — future
 * presentation variants («مرور حساب», performance views) must consume this
 * same read surface rather than re-deriving balances.
 *
 * AUTHORIZATION AND SCOPE (prompt §15; ADR-0016/0025, AC-I-01/16)
 *
 * Checked in this order, before any window read:
 *
 * 1. `Accounting.AccountStatement.View` (decision D6) — service-level
 *    enforcement on top of the route guard (ADR-0016: authorized twice).
 * 2. Organization: deployment pin asserted first (`assertOrganizationInScope`
 *    → 404, never 403), then `requireUsableOrganization` (unknown → 404,
 *    disabled → 422 — the established `requireUsableOrganization` posture).
 * 3. Account / fiscal year / period / financial area are scope KEYS resolved
 *    BY ID INSIDE the organization: a foreign or unknown key answers **404**
 *    (never 403 — the API must not confirm that a foreign id exists,
 *    AC-I-16), matching the Task 12 balance-read precedent. A key that
 *    exists but points OUTSIDE the requested scope (period of another year,
 *    area ≠ the year's area) answers **422** (a business-rule violation, not
 *    an existence leak). This is the structural-area posture of OQ-40 (no
 *    per-user area grants exist; decision D4 keeps it that way).
 *
 * SEMANTICS (prompt §8–§11; ADR-0031 §2/§4/§9)
 *
 * - Opening is intra-fiscal-year: period-only statements use SEQUENCE-based
 *   lower periods of the SAME year (`0` for a whole-year statement or the
 *   first period; no prior-year carry-forward), while an explicit `dateFrom`
 *   uses Document Date rows before that boundary. Opening vouchers posted
 *   inside the selected window appear as ordinary movement rows.
 * - Movement rows follow the fixed legal-book order
 *   (`documentDate, voucherNumber, lineNo, id`) with the running balance
 *   `opening + Σ net` across the WHOLE window (a page's first row continues
 *   the previous page — the caller measures the pre-page net over the same
 *   predicate and snapshot).
 * - Totals are window-wide (never page sums): net = Σdebit − Σcredit
 *   (debit-positive), closing = opening + net (§9), exact decimal strings.
 * - Readable in `open`, `closed` and `sealed` periods alike (decision D5):
 *   status is echoed on the scope, never a read filter and never revalidated.
 *   The call mutates nothing.
 *
 * FILTER SURFACE (prompt §12)
 *
 * Exactly the decided scope keys: `organizationId`, `accountId`,
 * `fiscalYearId`, optional `accountingPeriodId`, optional `financialAreaId`,
 * optional hierarchy/code/name filters and an inclusive Document Date range,
 * plus the shared `page`/`pageSize`. There is NO client sort (the running
 * balance defines the order), NO voucher/serial/status filters and NO generic
 * filter engine — anything undeclared is rejected 400 by the global whitelist
 * validation, and an explicitly-sent `sort` is rejected here.
 */
@Injectable()
export class AccountStatementsService {
  constructor(
    private readonly statements: AccountStatementsRepository,
    private readonly organizations: OrganizationsService,
    private readonly authorization: AuthorizationService,
  ) {}

  /**
   * Read the account statement of one account for one fiscal year.
   *
   * @throws AppException.unauthorized (401) when anonymous.
   * @throws AppException.forbidden (403) without
   *   `Accounting.AccountStatement.View`.
   * @throws AppException.badRequest (400) when `sort` is supplied (the
   *   statement order is fixed) or a paging value is unusable.
   * @throws AppException.notFound (404) for a foreign/unknown organization,
   *   account, fiscal year, accounting period or financial area.
   * @throws AppException.businessRule (422) for a disabled organization, a
   *   non-postable account, a period outside the requested fiscal year, or a
   *   financial area that is not the year's area.
   */
  async getAccountStatement(
    query: GetAccountStatementQuery,
  ): Promise<AccountStatementDto> {
    await this.authorization.requireAllPermissions([
      ACCOUNT_STATEMENT_PERMISSIONS.VIEW,
    ]);
    this.organizations.assertOrganizationInScope(query.organizationId);
    await this.organizations.requireUsableOrganization(query.organizationId);

    // The statement order IS the running-balance order (prompt §11): a client
    // sort would silently redefine every balance on the page. `sort` is a
    // declared shared list parameter, so it is refused HERE rather than by
    // the whitelist pipe — explicitly, with the reason.
    if (query.sort !== undefined) {
      throw AppException.badRequest(
        'An account statement has a fixed order (documentDate, voucherNumber, lineNo, id) — the running balance depends on it. The sort parameter is not accepted.',
      );
    }

    const account = await this.requireAccount(
      query.organizationId,
      query.accountId,
    );
    if (!account.isPostable) {
      // A non-postable account holds no ledger rows of its own (AC-I-09) —
      // its "movement" would be a descendant rollup (§8.5), which this slice
      // deliberately does not compute (decision D1: one account). Refusing
      // beats returning an empty statement that reads like "no activity".
      throw AppException.businessRule(
        'An account statement exists only for a postable account (ancestor rollups are out of this slice).',
      );
    }

    const year = await this.requireYear(
      query.organizationId,
      query.fiscalYearId,
    );

    const dateFrom = parseOptionalDocumentDate(query.dateFrom, 'dateFrom');
    const dateTo = parseOptionalDocumentDate(query.dateTo, 'dateTo');
    if (dateFrom !== undefined && dateTo !== undefined && dateFrom > dateTo) {
      throw AppException.badRequest('dateFrom must not be after dateTo.');
    }
    const reportStart = dateFrom ?? year.startDate;
    const reportEnd = dateTo ?? year.endDate;
    if (
      reportStart.getTime() < year.startDate.getTime() ||
      reportEnd.getTime() > year.endDate.getTime()
    ) {
      throw AppException.businessRule(
        'The reporting date range must remain inside the requested fiscal year.',
      );
    }

    if (query.accountCode !== undefined && account.code !== query.accountCode) {
      throw AppException.businessRule(
        'The account code filter does not match the selected account.',
      );
    }
    if (
      query.accountName !== undefined &&
      !account.title
        .toLocaleLowerCase()
        .includes(query.accountName.toLocaleLowerCase())
    ) {
      throw AppException.businessRule(
        'The account name filter does not match the selected account.',
      );
    }
    if (query.accountHierarchyId !== undefined) {
      const hierarchy = await this.statements.findAccount(
        query.organizationId,
        query.accountHierarchyId,
      );
      if (hierarchy === null) {
        throw AppException.notFound('Account', query.accountHierarchyId);
      }
      // Account Statement still has exactly one permanent Account.id. The
      // hierarchy filter therefore narrows that identity; it never turns the
      // statement into a descendant roll-up report.
      let cursor = account;
      const visited = new Set<string>();
      while (cursor.id !== hierarchy.id) {
        if (visited.has(cursor.id) || cursor.parentId === undefined) {
          throw AppException.businessRule(
            'The selected account is outside the requested account hierarchy.',
          );
        }
        visited.add(cursor.id);
        if (cursor.parentId === null) {
          throw AppException.businessRule(
            'The selected account is outside the requested account hierarchy.',
          );
        }
        const parent = await this.statements.findAccount(
          query.organizationId,
          cursor.parentId,
        );
        if (parent === null) {
          throw AppException.businessRule(
            'The selected account is outside the requested account hierarchy.',
          );
        }
        cursor = parent;
      }
    }

    // One financial area per request (decision D4): the year's own area. An
    // optional client `financialAreaId` must exist in the organization (404
    // otherwise) and equal the year's area (422 on mismatch) — a foreign
    // area id is never treated as accessible.
    if (query.financialAreaId !== undefined) {
      const requestedArea = await this.statements.findFinancialArea(
        query.organizationId,
        query.financialAreaId,
      );
      if (requestedArea === null) {
        throw AppException.notFound('FinancialArea', query.financialAreaId);
      }
      if (requestedArea.id !== year.financialAreaId) {
        throw AppException.businessRule(
          'The financial area does not match the fiscal year’s financial area.',
        );
      }
    }
    const area = await this.requireArea(
      query.organizationId,
      year.financialAreaId,
    );

    let period: StatementPeriodRef | null = null;
    if (query.accountingPeriodId !== undefined) {
      period = await this.requirePeriod(
        query.organizationId,
        query.accountingPeriodId,
      );
    }
    const activePeriod: StatementPeriodRef | null = period;

    const periodsOfYear = await this.statements.listPeriodsOfYear(
      query.organizationId,
      year.id,
    );
    if (activePeriod !== null) {
      // The period must belong to the REQUESTED year (prompt §10): a period
      // of another year exists but is out of scope — 422 (business rule), not
      // 404, because its id resolved inside the organization already.
      const inYear = periodsOfYear.find((row) => row.id === activePeriod.id);
      if (inYear === undefined) {
        throw AppException.businessRule(
          'The accounting period does not belong to the requested fiscal year.',
        );
      }
    }

    // Intra-year, SEQUENCE-based opening (decision D2; ADR-0031 §4/§9).
    // `priorPeriodIds` are the lower-sequence periods of THIS year only —
    // never another year's rows (no carry-forward is ever synthesized).
    const priorPeriodIds =
      activePeriod === null
        ? []
        : periodsOfYear
            .filter((row) => row.sequence < activePeriod.sequence)
            .map((row) => row.id);

    const documentDate =
      dateFrom === undefined && dateTo === undefined
        ? undefined
        : {
            ...(dateFrom === undefined ? {} : { gte: dateFrom }),
            ...(dateTo === undefined ? {} : { lte: dateTo }),
          };

    const { skip, take } = toOffset(query.page, query.pageSize);
    const facts = await this.statements.readStatementLedgerFacts(
      {
        window: {
          organizationId: query.organizationId,
          financialAreaId: year.financialAreaId,
          fiscalYearId: year.id,
          accountId: account.id,
          ...(documentDate === undefined ? {} : { documentDate }),
          ...(activePeriod === null
            ? {}
            : { accountingPeriodId: activePeriod.id }),
        },
        priorPeriodIds,
        ...(dateFrom === undefined ? {} : { openingBefore: dateFrom }),
      },
      skip,
      take,
    );

    // An explicit date range uses Document Date as the primary financial axis.
    // The accepted Task 17B period-only contract remains sequence based when
    // no dateFrom is supplied; both paths remain inside this fiscal year.
    const openingBalanceAmount =
      dateFrom !== undefined
        ? netAmountOf(facts.priorPeriodDebit, facts.priorPeriodCredit)
        : activePeriod === null
          ? '0'
          : netAmountOf(facts.priorPeriodDebit, facts.priorPeriodCredit);

    // The running balance continues across pages: base = opening + Σ net of
    // every window row before this page (same predicate, same snapshot).
    const prePageNet = facts.prePageAmounts
      .map((row) => netAmountOf(row.debitAmount, row.creditAmount))
      .reduce((total, net) => sumAmounts([total, net]), '0');
    const runningBase = sumAmounts([openingBalanceAmount, prePageNet]);

    return buildAccountStatement({
      scope: {
        organizationId: query.organizationId,
        financialArea: renderAreaRef(area),
        fiscalYear: renderYearRef(year),
        account: renderAccountRef(account),
        accountingPeriod:
          activePeriod === null ? null : renderPeriodRef(activePeriod),
      },
      entries: facts.rows,
      runningBase,
      windowTotal: facts.total,
      page: query.page,
      pageSize: query.pageSize,
      openingBalanceAmount,
      debitTotalAmount: facts.debitTotal,
      creditTotalAmount: facts.creditTotal,
    });
  }

  private async requireAccount(
    organizationId: string,
    accountId: string,
  ): Promise<StatementAccountRef> {
    const account = await this.statements.findAccount(
      organizationId,
      accountId,
    );
    if (account === null) throw AppException.notFound('Account', accountId);
    return account;
  }

  private async requireYear(
    organizationId: string,
    fiscalYearId: string,
  ): Promise<StatementYearRef> {
    const year = await this.statements.findFiscalYear(
      organizationId,
      fiscalYearId,
    );
    if (year === null) throw AppException.notFound('FiscalYear', fiscalYearId);
    return year;
  }

  private async requireArea(
    organizationId: string,
    financialAreaId: string,
  ): Promise<StatementAreaRef> {
    const area = await this.statements.findFinancialArea(
      organizationId,
      financialAreaId,
    );
    if (area === null) {
      throw AppException.notFound('FinancialArea', financialAreaId);
    }
    return area;
  }

  private async requirePeriod(
    organizationId: string,
    accountingPeriodId: string,
  ): Promise<StatementPeriodRef> {
    const period = await this.statements.findPeriod(
      organizationId,
      accountingPeriodId,
    );
    if (period === null) {
      throw AppException.notFound('AccountingPeriod', accountingPeriodId);
    }
    return period;
  }
}

export interface GetAccountStatementQuery {
  /** Mandatory tenant scope — the statement is never cross-organization. */
  organizationId: string;
  /** Mandatory: one postable account (decision D1). */
  accountId: string;
  /** Mandatory: one fiscal year (decision D1/D2 — multi-year is impossible). */
  fiscalYearId: string;
  /** Optional: one period of that year (decision D1). */
  accountingPeriodId?: string | undefined;
  /** Optional: must equal the fiscal year's financial area (decision D4). */
  financialAreaId?: string | undefined;
  /** Optional hierarchy/code/name display filters. */
  accountHierarchyId?: string | undefined;
  accountCode?: string | undefined;
  accountName?: string | undefined;
  /** Optional inclusive Document Date range within the fiscal year. */
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  page: number;
  pageSize: number;
  /** Never accepted — the statement order is fixed (prompt §11). */
  sort?: string | undefined;
}
