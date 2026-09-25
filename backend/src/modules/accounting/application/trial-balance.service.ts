import { Injectable } from '@nestjs/common';
import {
  toPaginatedResult,
  type PaginatedResult,
} from '../../../kernel/pagination/paginated-result.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { AccountingReadQueryRepository } from '../data/accounting-read-query.repository.js';
import {
  resolveAccountingReportScope,
  reportPage,
  resolveReportSort,
  type ReportScopeQuery,
} from './accounting-report-support.js';
import { TRIAL_BALANCE_PERMISSIONS } from '../domain/accounting-permissions.js';
import {
  toTrialBalanceRows,
  type TrialBalanceRow,
} from '../domain/trial-balance.js';

/**
 * Trial Balance application boundary. Values are produced by the shared
 * hierarchy-aware read query and finalized by the exact Accounting money
 * value object; this service does not maintain a second balance engine.
 */
@Injectable()
export class TrialBalanceService {
  constructor(
    private readonly read: AccountingReadQueryRepository,
    private readonly organizations: OrganizationsService,
    private readonly authorization: AuthorizationService,
  ) {}

  async list(
    query: TrialBalanceQuery,
  ): Promise<PaginatedResult<TrialBalanceRow>> {
    await this.authorization.requireAllPermissions([
      TRIAL_BALANCE_PERMISSIONS.VIEW,
    ]);
    const orderBy = resolveReportSort(
      query.sort,
      [
        'accountCode',
        'accountName',
        'accountId',
        'opening',
        'debit',
        'credit',
        'periodNet',
        'closing',
      ],
      [
        { field: 'accountCode', direction: 'asc' },
        { field: 'accountId', direction: 'asc' },
      ],
    );

    const scope = await resolveAccountingReportScope(
      this.read,
      this.organizations,
      query,
    );
    const { skip, take } = reportPage(query.page, query.pageSize);
    const result = await this.read.readTrialBalance(
      {
        organizationId: scope.organizationId,
        financialAreaId: scope.financialArea.id,
        fiscalYearId: scope.fiscalYear.id,
        accountingPeriodId: scope.accountingPeriod?.id,
        dateFrom: scope.dateFrom,
        dateTo: scope.dateTo,
        dateFromExplicit: scope.dateFromExplicit,
        dateToExplicit: scope.dateToExplicit,
        accountId: scope.accountId,
        accountHierarchyId: scope.accountHierarchyId,
        accountCode: scope.accountCode,
        accountName: scope.accountName,
      },
      orderBy,
      skip,
      take,
    );
    return toPaginatedResult(
      toTrialBalanceRows(result.items),
      result.total,
      query.page,
      query.pageSize,
    );
  }
}

export interface TrialBalanceQuery extends ReportScopeQuery {
  page: number;
  pageSize: number;
  sort?: string | undefined;
}
