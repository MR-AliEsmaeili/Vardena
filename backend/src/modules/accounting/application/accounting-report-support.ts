import { AppException } from '../../../kernel/errors/app-exception.js';
import type { BusinessDate } from '../../../kernel/datetime/business-date.js';
import { toOffset } from '../../../kernel/pagination/paginated-result.js';
import { parseOptionalDocumentDate } from './accounting-document-support.js';
import type {
  AccountingReadQueryRepository,
  AccountingReadOrderClause,
  StatementAccountRef,
  StatementAreaRef,
  StatementPeriodRef,
  StatementYearRef,
} from '../data/accounting-read-query.repository.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';

/** Hard result-window bound for every Task 18 report API. */
export const ACCOUNTING_REPORT_HARD_ROW_LIMIT = 50_000;

export interface ReportScopeQuery {
  organizationId: string;
  financialAreaId: string;
  fiscalYearId: string;
  accountingPeriodId?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  accountId?: string | undefined;
  accountHierarchyId?: string | undefined;
  accountCode?: string | undefined;
  accountName?: string | undefined;
}

export interface ResolvedAccountingReportScope {
  organizationId: string;
  financialArea: StatementAreaRef;
  fiscalYear: StatementYearRef;
  accountingPeriod: StatementPeriodRef | null;
  dateFrom: BusinessDate;
  dateTo: BusinessDate;
  /** True only when the caller supplied a lower date boundary. */
  dateFromExplicit: boolean;
  /** True only when the caller supplied an upper date boundary. */
  dateToExplicit: boolean;
  accountId?: string | undefined;
  accountHierarchyId?: string | undefined;
  accountCode?: string | undefined;
  accountName?: string | undefined;
}

/**
 * Resolve the common single-area/year/period/date/account boundary for report
 * services. The report services still perform their own permission check; this
 * helper only prevents the three contracts from drifting on scope semantics.
 */
export async function resolveAccountingReportScope(
  repository: AccountingReadQueryRepository,
  organizations: OrganizationsService,
  query: ReportScopeQuery,
): Promise<ResolvedAccountingReportScope> {
  await organizations.assertOrganizationInScope(query.organizationId);
  await organizations.requireUsableOrganization(query.organizationId);

  const area = await repository.findFinancialArea(
    query.organizationId,
    query.financialAreaId,
  );
  if (area === null) {
    throw AppException.notFound('FinancialArea', query.financialAreaId);
  }

  const year = await repository.findFiscalYear(
    query.organizationId,
    query.fiscalYearId,
  );
  if (year === null) {
    throw AppException.notFound('FiscalYear', query.fiscalYearId);
  }
  if (year.financialAreaId !== area.id) {
    throw AppException.businessRule(
      'The financial area does not match the fiscal year’s financial area.',
    );
  }

  let period: StatementPeriodRef | null = null;
  if (query.accountingPeriodId !== undefined) {
    period = await repository.findPeriod(
      query.organizationId,
      query.accountingPeriodId,
    );
    if (period === null) {
      throw AppException.notFound('AccountingPeriod', query.accountingPeriodId);
    }
    const periods = await repository.listPeriodsOfYear(
      query.organizationId,
      year.id,
    );
    if (!periods.some((candidate) => candidate.id === period?.id)) {
      throw AppException.businessRule(
        'The accounting period does not belong to the requested fiscal year.',
      );
    }
  }

  if (query.accountId !== undefined) {
    const account = await repository.findAccount(
      query.organizationId,
      query.accountId,
    );
    if (account === null) {
      throw AppException.notFound('Account', query.accountId);
    }
  }
  if (query.accountHierarchyId !== undefined) {
    const hierarchy = await repository.findAccount(
      query.organizationId,
      query.accountHierarchyId,
    );
    if (hierarchy === null) {
      throw AppException.notFound('Account', query.accountHierarchyId);
    }
  }

  const dateFrom = parseOptionalDocumentDate(query.dateFrom, 'dateFrom');
  const dateTo = parseOptionalDocumentDate(query.dateTo, 'dateTo');
  const start = dateFrom ?? period?.startDate ?? year.startDate;
  const end = dateTo ?? period?.endDate ?? year.endDate;
  if (start > end) {
    throw AppException.badRequest('dateFrom must not be after dateTo.');
  }
  if (start < year.startDate || end > year.endDate) {
    throw AppException.businessRule(
      'The reporting date range must remain inside the requested fiscal year.',
    );
  }

  return {
    organizationId: query.organizationId,
    financialArea: area,
    fiscalYear: year,
    accountingPeriod: period,
    dateFrom: start,
    dateTo: end,
    dateFromExplicit: dateFrom !== undefined,
    dateToExplicit: dateTo !== undefined,
    accountId: query.accountId,
    accountHierarchyId: query.accountHierarchyId,
    accountCode: query.accountCode,
    accountName: query.accountName,
  };
}

/** Refuse pages that would address rows beyond the server hard bound. */
export function assertReportPageBound(page: number, pageSize: number): void {
  const { skip, take } = toOffset(page, pageSize);
  if (skip >= ACCOUNTING_REPORT_HARD_ROW_LIMIT) {
    throw AppException.badRequest(
      `The requested page is beyond the ${ACCOUNTING_REPORT_HARD_ROW_LIMIT}-row report limit.`,
    );
  }
  if (skip + take > ACCOUNTING_REPORT_HARD_ROW_LIMIT) {
    throw AppException.badRequest(
      `A report request cannot read beyond the ${ACCOUNTING_REPORT_HARD_ROW_LIMIT}-row limit.`,
    );
  }
}

export type ReportSortField =
  | 'documentDate'
  | 'postingTimestamp'
  | 'documentId'
  | 'ledgerLineId'
  | 'accountCode'
  | 'accountName'
  | 'accountId'
  | 'opening'
  | 'debit'
  | 'credit'
  | 'periodNet'
  | 'closing';

/**
 * Resolve the explicit, small sort allow-list. One caller-selected primary
 * field is accepted; no caller value is ever used as a SQL identifier. A
 * report's deterministic tie-breakers are always appended.
 */
export function resolveReportSort(
  sort: string | undefined,
  allowed: readonly ReportSortField[],
  fallback: readonly AccountingReadOrderClause[],
): AccountingReadOrderClause[] {
  const allowedSet = new Set(allowed);
  const requested: AccountingReadOrderClause[] = [];
  if (sort !== undefined && sort !== '') {
    for (const entry of sort.split(',')) {
      const [field, direction] = entry.split(':');
      if (
        field === undefined ||
        !allowedSet.has(field as ReportSortField) ||
        (direction !== 'asc' && direction !== 'desc')
      ) {
        throw AppException.badRequest(
          `Unsupported report sort. Allowed fields: ${allowed.join(', ')}.`,
        );
      }
      requested.push({
        field,
        direction,
      });
    }
    if (requested.length > 1) {
      throw AppException.badRequest(
        'Only one primary report sort field is supported; deterministic tie-breakers are server-defined.',
      );
    }
  }
  const resolved = requested.length === 0 ? [...fallback] : requested;
  const seen = new Set(resolved.map((clause) => clause.field));
  for (const clause of fallback) {
    if (!seen.has(clause.field)) {
      resolved.push(clause);
      seen.add(clause.field);
    }
  }
  return resolved;
}

export function reportPage(
  page: number,
  pageSize: number,
): {
  skip: number;
  take: number;
} {
  assertReportPageBound(page, pageSize);
  return toOffset(page, pageSize);
}

export type {
  StatementAccountRef,
  StatementAreaRef,
  StatementPeriodRef,
  StatementYearRef,
};
