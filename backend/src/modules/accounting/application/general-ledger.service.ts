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
import { GENERAL_LEDGER_PERMISSIONS } from '../domain/accounting-permissions.js';
import {
  toGeneralLedgerRow,
  type GeneralLedgerRow,
} from '../domain/general-ledger.js';

/**
 * General Ledger application boundary. It performs the independent report
 * authorization and common scope resolution, then delegates all reads to the
 * shared Accounting Read/Query Layer.
 */
@Injectable()
export class GeneralLedgerService {
  constructor(
    private readonly read: AccountingReadQueryRepository,
    private readonly organizations: OrganizationsService,
    private readonly authorization: AuthorizationService,
  ) {}

  async list(
    query: GeneralLedgerQuery,
  ): Promise<PaginatedResult<GeneralLedgerRow>> {
    await this.authorization.requireAllPermissions([
      GENERAL_LEDGER_PERMISSIONS.VIEW,
    ]);
    const orderBy = resolveReportSort(
      query.sort,
      [
        'documentDate',
        'postingTimestamp',
        'documentId',
        'ledgerLineId',
        'accountCode',
        'accountName',
        'accountId',
      ],
      [
        { field: 'documentDate', direction: 'asc' },
        { field: 'postingTimestamp', direction: 'asc' },
        { field: 'documentId', direction: 'asc' },
        { field: 'ledgerLineId', direction: 'asc' },
      ],
    );

    const scope = await resolveAccountingReportScope(
      this.read,
      this.organizations,
      query,
    );
    const { skip, take } = reportPage(query.page, query.pageSize);
    const result = await this.read.readGeneralLedger(
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
      result.items.map(toGeneralLedgerRow),
      result.total,
      query.page,
      query.pageSize,
    );
  }
}

export interface GeneralLedgerQuery extends ReportScopeQuery {
  page: number;
  pageSize: number;
  sort?: string | undefined;
}
