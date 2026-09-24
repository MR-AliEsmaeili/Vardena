import { Injectable } from '@nestjs/common';
import {
  toOffset,
  toPaginatedResult,
  type PaginatedResult,
} from '../../../kernel/pagination/paginated-result.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { LedgerEntriesRepository } from '../data/ledger-entries.repository.js';
import type { OrderBy } from '../data/accounting-rows.js';
import { LEDGER_MOVEMENT_PERMISSIONS } from '../domain/accounting-permissions.js';
import {
  toLedgerMovementDto,
  type LedgerMovementDto,
} from '../domain/ledger-movement.js';
import { parseOptionalDocumentDate } from './accounting-document-support.js';
import { resolveSort } from './accounting-support.js';

/**
 * Ledger movements — the Accounting-owned, READ-ONLY source of posted
 * accounting movements (Task 17A, contract §19.1/§19.2 AC-D-30, §12/§13/§15).
 *
 * WHAT IT IS FOR
 *
 * Future reports — account ledger, general ledger, subsidiary ledger, account
 * movements, and (in a later, separately authorized slice) trial-balance
 * inputs — read movements through here instead of joining Accounting tables
 * themselves (AR-07). This is a source contract, not a report: no layout, no
 * grouping, no subtotal, no export, no print, no aggregation.
 *
 * SOURCE OF TRUTH (AC-D-30)
 *
 * One movement = one row of `accounting.ledger_entries`, the immutable posted
 * evidence materialized atomically with finalization (Task 10.7). Nothing else
 * is read, nothing is recomputed from operational modules, no projection is
 * consulted (the Task 12 balance projection is derived and rebuildable, never
 * authority), and no write path exists in this service — the only repository
 * method it uses is the read-only `listMovements`.
 *
 * POSTED-ONLY (AC-I-05/06)
 *
 * The source cannot return a non-posted record: ledger rows exist only for
 * `final` vouchers. There is no `status` filter because there is no status
 * column and no draft twin of a movement; a filter would imply a lifecycle the
 * ledger does not have.
 *
 * SCOPE AND TENANT SAFETY (AC-I-01/16, ADR-0021 §4, ADR-0025)
 *
 * - `organizationId` is mandatory and resolved server-side: the deployment
 *   organization pin is asserted first (a pinned deployment answers 404 for any
 *   other organization — never 403, so the API never confirms that an
 *   out-of-pin id exists), then the organization must exist and be usable.
 * - Every other filter is a PREDICATE INSIDE that organization. A foreign
 *   area/year/period/account/voucher id therefore cannot return another
 *   organization's rows; it matches nothing, exactly like an unknown id — the
 *   response is a legitimate empty page and never an existence oracle.
 * - No client input reaches a SQL identifier: filters are Prisma `where`
 *   values (bound parameters) and the sort is whitelisted below.
 *
 * ORDER AND PAGINATION
 *
 * The default order is the legal-book reading order — business date, then the
 * voucher serial, then the line ordinal — and a UNIQUE tie-breaker (the entry
 * id) is always last, so the order is total and paging is stable even when
 * every business key repeats. A client may only CHOOSE among the whitelisted
 * fields; the tie-breakers are appended by the server and cannot be removed.
 * `page`/`pageSize` come from the shared list convention (bounded at 500), and
 * `total` is counted over the same predicate as the page.
 */
@Injectable()
export class LedgerMovementsService {
  constructor(
    private readonly ledger: LedgerEntriesRepository,
    private readonly organizations: OrganizationsService,
    private readonly authorization: AuthorizationService,
  ) {}

  /**
   * List posted ledger movements of one organization.
   *
   * @throws AppException.unauthorized when the request is anonymous.
   * @throws AppException.forbidden when the principal lacks
   *   `Accounting.LedgerMovement.View`.
   * @throws AppException.notFound when the organization is outside the
   *   deployment pin, does not exist, or — for a foreign scope id used as an
   *   organization — is not readable by this caller.
   * @throws AppException.badRequest for a malformed `dateFrom`/`dateTo` or a
   *   sort field outside the whitelist.
   */
  async listMovements(
    query: ListLedgerMovementsQuery,
  ): Promise<PaginatedResult<LedgerMovementDto>> {
    await this.authorization.requireAllPermissions([
      LEDGER_MOVEMENT_PERMISSIONS.VIEW,
    ]);
    this.organizations.assertOrganizationInScope(query.organizationId);
    await this.organizations.requireUsableOrganization(query.organizationId);

    const { skip, take } = toOffset(query.page, query.pageSize);
    const { items, total } = await this.ledger.listMovements({
      filter: {
        organizationId: query.organizationId,
        financialAreaId: query.financialAreaId,
        fiscalYearId: query.fiscalYearId,
        accountingPeriodId: query.accountingPeriodId,
        accountId: query.accountId,
        voucherId: query.voucherId,
        voucherNumber: query.voucherNumber,
        dateFrom: parseOptionalDocumentDate(query.dateFrom, 'dateFrom'),
        dateTo: parseOptionalDocumentDate(query.dateTo, 'dateTo'),
      },
      orderBy: resolveMovementOrder(query.sort),
      skip,
      take,
    });

    return toPaginatedResult(
      items.map(toLedgerMovementDto),
      total,
      query.page,
      query.pageSize,
    );
  }
}

export interface ListLedgerMovementsQuery {
  /** Mandatory tenant scope — the list is never cross-organization. */
  organizationId: string;
  page: number;
  pageSize: number;
  financialAreaId?: string | undefined;
  fiscalYearId?: string | undefined;
  accountingPeriodId?: string | undefined;
  accountId?: string | undefined;
  /** Source voucher identity (traceability filter). */
  voucherId?: string | undefined;
  /** Exact serial match (the human-facing voucher number, §18). */
  voucherNumber?: string | undefined;
  /** Inclusive business-date bounds, `YYYY-MM-DD` (§12.3). */
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  sort?: string | undefined;
}

/**
 * Sortable movements fields (architecture.md §9: `sort` syntax is validated by
 * the DTO, the ALLOW-LIST lives here and anything else is rejected). Only the
 * two date axes are exposed: the legal-book grouping and the posting act. An
 * arbitrary ledger column (amounts, ids, serials as strings) would invite
 * "sorted" output that is not any accounting order, and no report definition
 * has authorized one.
 */
const SORTABLE_FIELDS: Record<string, string> = {
  documentDate: 'documentDate',
  postingTimestamp: 'postingTimestamp',
};

/**
 * The legal-book default: business date, then the voucher serial, then the
 * line ordinal — the same order a printed voucher body reads in (§12.5).
 */
const DEFAULT_ORDER: OrderBy = [
  { documentDate: 'asc' },
  { voucherNumber: 'asc' },
  { lineNo: 'asc' },
  { id: 'asc' },
];

/**
 * Tie-breakers appended to every resolved order. `id` is the entry's unique
 * identity, so the composed order is TOTAL: two pages of the same query can
 * never disagree about where a row belongs, even when date, serial and ordinal
 * all repeat.
 */
const STABLE_TIE_BREAKERS: OrderBy = [
  { voucherNumber: 'asc' },
  { lineNo: 'asc' },
  { id: 'asc' },
];

/** Resolve the whitelisted client sort (or the default) + stable tie-breakers. */
function resolveMovementOrder(sort: string | undefined): OrderBy {
  const resolved =
    sort === undefined || sort === ''
      ? DEFAULT_ORDER
      : resolveSort(sort, SORTABLE_FIELDS, DEFAULT_ORDER);
  const chosen = new Set(resolved.flatMap((clause) => Object.keys(clause)));
  return [
    ...resolved,
    ...STABLE_TIE_BREAKERS.filter(
      (clause) => !chosen.has(Object.keys(clause)[0] as string),
    ),
  ];
}
