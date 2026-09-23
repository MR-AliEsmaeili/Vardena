import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { paginatedResponseOf } from '../../../kernel/pagination/paginated-result.js';
import { AuthGuard } from '../../identity/application/auth.guard.js';
import { AuthorizationGuard } from '../../rbac/application/authorization.guard.js';
import { RequirePermission } from '../../rbac/application/require-permission.decorator.js';
import { BALANCE_PERMISSIONS } from '../domain/accounting-permissions.js';
import { AccountingBalancesService } from '../application/accounting-balances.service.js';
import {
  BalanceDto,
  GetAccountBalanceQueryDto,
  ListBalancesQueryDto,
  RebuildBalancesDto,
  RebuildResultDto,
  ReconciliationItemDto,
  ReconciliationQueryDto,
} from './dto/account-balance.dto.js';

const PaginatedBalanceDto = paginatedResponseOf(BalanceDto);
const PaginatedReconciliationDto = paginatedResponseOf(ReconciliationItemDto);

/**
 * Balance projection — the rebuildable turnover view (Task 12, ADR-0031,
 * contract §19.3 AC-D-31, §25 AC-I-19).
 *
 * This controller is transport-only (AR-03): every rule is decided by
 * `AccountingBalancesService` and the guarded repositories. Reads are
 * org-scoped (AC-I-01/16 → 404 for foreign keys) and permission-gated
 * (`Balance.View` for reads, `Balance.Rebuild` for the explicit
 * maintenance operation).
 *
 * Stored measures are ONLY period turnover (debit/credit); opening/closing
 * are DERIVED and never requested from clients. Absence = zero turnover
 * (AC-I-19c) — the API never synthesizes zero rows.
 *
 * Balance enumeration mirrors the ledger's scope guards: a year/period/account
 * scoped read may not cross a year boundary (ADR-0031 § Derived only), so
 * `fiscalYearId` narrows `financialAreaId`, and `accountingPeriodId` narrows
 * `fiscalYearId` — validated in the service.
 */
@ApiTags('accounting-balances')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'accounting/balances', version: '1' })
export class AccountingBalancesController {
  constructor(private readonly balances: AccountingBalancesService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(BALANCE_PERMISSIONS.VIEW)
  @ApiOperation({
    summary:
      'List balance projections (turnover per period × account) with derived opening/closing.',
    description:
      'Rebuildable, report-only projection over finalized ledger entries (Task 12, AC-D-31). Stored turnover only; opening/closing are derived in-period and never cross fiscal years.',
  })
  @ApiExtraModels(PaginatedBalanceDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedBalanceDto) }] },
  })
  @ApiNotFoundResponse({
    description:
      'Organization, financial area, fiscal year, period, or account not found in scope.',
  })
  @ApiBadRequestResponse({ description: 'Invalid sort, page, or pageSize.' })
  async list(@Query() query: ListBalancesQueryDto): Promise<{
    items: BalanceDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const result = await this.balances.listBalances({
      organizationId: query.organizationId,
      financialAreaId: query.financialAreaId,
      fiscalYearId: query.fiscalYearId,
      accountingPeriodId: query.accountingPeriodId,
      accountId: query.accountId,
      sort: query.sort,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 50,
    });
    return {
      items: result.items as unknown as BalanceDto[],
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  @Get('reconciliation')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(BALANCE_PERMISSIONS.VIEW)
  @ApiOperation({
    summary: 'Reconcile ledger aggregates vs balance projections.',
    description:
      'FULL OUTER JOIN between ledger-derived turnover and projection rows, excluding matched groups. Surfaced mismatch kinds: missing_projection, extra_projection, debit_mismatch, credit_mismatch, both_mismatch (task §7). The ledger is the source of truth — a non-empty result means the projection must be rebuilt.',
  })
  @ApiExtraModels(PaginatedReconciliationDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedReconciliationDto) }] },
  })
  async reconciliation(@Query() query: ReconciliationQueryDto): Promise<{
    items: ReconciliationItemDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const result = await this.balances.getReconciliation({
      organizationId: query.organizationId,
      financialAreaId: query.financialAreaId,
      fiscalYearId: query.fiscalYearId,
      accountingPeriodId: query.accountingPeriodId,
      accountId: query.accountId,
      mismatchKind: query.mismatchKind,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 50,
    });
    return {
      items: result.items as unknown as ReconciliationItemDto[],
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  @Get(':accountId')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(BALANCE_PERMISSIONS.VIEW)
  @ApiOperation({
    summary:
      'Get derived balances for one account (across periods, correctly windowed).',
    description:
      'Account-scoped read — opening is computed over the whole year (not paginated), so it stays exact even when paging. Without filters, returns the account’s turnover across all periods that have it.',
  })
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedBalanceDto) }] },
  })
  @ApiNotFoundResponse({
    description: 'Organization or account not found in scope.',
  })
  async getByAccount(
    @Param('accountId') accountId: string,
    @Query() query: GetAccountBalanceQueryDto,
  ): Promise<{
    items: BalanceDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const result = await this.balances.getAccountBalances({
      organizationId: query.organizationId,
      accountId,
      financialAreaId: query.financialAreaId,
      fiscalYearId: query.fiscalYearId,
      accountingPeriodId: query.accountingPeriodId,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 50,
    });
    return {
      items: result.items as unknown as BalanceDto[],
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  @Post('rebuild')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(BALANCE_PERMISSIONS.REBUILD)
  @ApiOperation({
    summary:
      'Rebuild balance projections from the ledger (explicit audited maintenance, AC-I-19e).',
    description:
      'Atomic, idempotent-by-replacement slice replacement: deletes the scoped slice and re-derives it from finalized ledger entries. Scope is always org-wide, optionally narrowed to one financial area and/or one fiscal year. The ledger remains the source of truth; this operation is the sole remediation for drift.',
  })
  @ApiOkResponse({ type: RebuildResultDto })
  @ApiNotFoundResponse({
    description:
      'Organization, financial area, or fiscal year not found in scope.',
  })
  async rebuild(@Body() body: RebuildBalancesDto): Promise<RebuildResultDto> {
    const result = await this.balances.rebuildBalances({
      organizationId: body.organizationId,
      financialAreaId: body.financialAreaId,
      fiscalYearId: body.fiscalYearId,
      reason: body.reason,
    });
    return {
      organizationId: result.organizationId,
      financialAreaId: result.financialAreaId,
      fiscalYearId: result.fiscalYearId,
      deleted: result.deleted,
      inserted: result.inserted,
    };
  }
}
