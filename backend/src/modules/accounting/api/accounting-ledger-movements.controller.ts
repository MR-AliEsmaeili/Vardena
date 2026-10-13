import { Controller, Get, Query, UseGuards } from '@nestjs/common';
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
import { LEDGER_MOVEMENT_PERMISSIONS } from '../domain/accounting-permissions.js';
import { LedgerMovementsService } from '../application/ledger-movements.service.js';
import {
  LedgerMovementResponseDto,
  ListLedgerMovementsQueryDto,
} from './dto/ledger-movement.dto.js';

const PaginatedLedgerMovementDto = paginatedResponseOf(
  LedgerMovementResponseDto,
);

/**
 * Posted ledger movements — the Accounting-owned, read-only reporting source
 * (Task 17A, contract §19.1/§19.2 AC-D-30, ADR-0009/reporting-strategy §1).
 *
 * Transport-only (AR-03): every rule (authorization, organization scope,
 * filter translation, sort whitelist, pagination) is decided by
 * `LedgerMovementsService` and the guarded repository. The route is under the
 * module's existing `accounting/...` versioned resource family, alongside
 * `accounting/balances`, and it carries exactly ONE method: a `GET`. There is
 * no POST/PATCH/DELETE anywhere in this controller and no write permission —
 * ledger entries are insert-only accounting evidence (AC-I-05/06), and this
 * task exposes no path that could mutate accounting truth.
 *
 * Why an endpoint at all (rather than a view only): the source is a
 * single-table, organization-scoped read of the module's OWN table, so
 * ADR-0009's "view-first" rule is satisfied by a typed, parameterized query
 * with no join, no aggregation and no cross-module read; and the source is
 * consumed by future report surfaces that need the same authorization,
 * filters and paging this boundary already enforces. Anything heavier
 * (aggregation, statement layouts, exports) stays gated by OQ-25/OQ-43 and is
 * explicitly not part of this controller.
 */
@ApiTags('accounting-ledger-movements')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'accounting/ledger-movements', version: '1' })
export class AccountingLedgerMovementsController {
  constructor(private readonly movements: LedgerMovementsService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(LEDGER_MOVEMENT_PERMISSIONS.VIEW)
  @ApiOperation({
    summary: 'List posted ledger movements of one organization.',
    description:
      'Immutable posted ledger entries (one row per finalized voucher line), newest state only — never a draft, never a computed balance. Deterministic legal-book order with a unique tie-breaker, bounded page size, and an organization predicate that cannot be overridden by any filter.',
  })
  @ApiExtraModels(PaginatedLedgerMovementDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedLedgerMovementDto) }] },
  })
  @ApiNotFoundResponse({
    description: 'Organization does not exist in this deployment’s scope.',
  })
  @ApiBadRequestResponse({
    description:
      'Invalid filter (malformed id or date), page/pageSize, or a sort field outside the whitelist.',
  })
  async list(@Query() query: ListLedgerMovementsQueryDto): Promise<{
    items: LedgerMovementResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const result = await this.movements.listMovements({
      organizationId: query.organizationId,
      financialAreaId: query.financialAreaId,
      fiscalYearId: query.fiscalYearId,
      accountingPeriodId: query.accountingPeriodId,
      accountId: query.accountId,
      voucherId: query.voucherId,
      voucherNumber: query.voucherNumber,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      sort: query.sort,
      page: query.page,
      pageSize: query.pageSize,
    });
    return {
      items: result.items as unknown as LedgerMovementResponseDto[],
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }
}
