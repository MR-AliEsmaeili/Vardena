import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { InventoryBalancesService } from '../application/inventory-balances.service.js';
import {
  BALANCE_PERMISSIONS,
  RECONCILIATION_PERMISSIONS,
} from '../domain/inventory-core-permissions.js';
import {
  InventoryAvailabilityQueryDto,
  InventoryAvailabilityResponseDto,
  InventoryBalanceResponseDto,
  ItemAvailabilityAcrossWarehousesQueryDto,
  ItemWarehouseAvailabilityResponseDto,
  ListInventoryBalancesQueryDto,
  RebuildInventoryBalancesDto,
  RebuildReportDto,
  ReconcileInventoryBalancesDto,
  ReconciliationReportDto,
} from './dto/inventory-core.dto.js';

const PaginatedBalanceDto = paginatedResponseOf(InventoryBalanceResponseDto);

/**
 * Stock balances, availability, and ledger reconciliation (D-04, ADR-0022).
 *
 * Transport-only (AR-03). Balances are a read projection of the movement
 * ledger — there is no endpoint that writes them directly. `available` is
 * always derived (`onHand − reserved`), never stored; a key with no stored
 * row reads as zero. Drift between projection and ledger is a defect, never
 * a business event: the reconcile report only reports, and the rebuild runs
 * only under its own maintenance permission, returning every correction it
 * applied.
 */
@ApiTags('inventory-balances')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'inventory/balances', version: '1' })
export class InventoryBalancesController {
  constructor(private readonly balances: InventoryBalancesService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(BALANCE_PERMISSIONS.VIEW)
  @ApiOperation({
    summary: 'List the stored balance rows of one organization.',
  })
  @ApiExtraModels(PaginatedBalanceDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedBalanceDto) }] },
  })
  async list(@Query() query: ListInventoryBalancesQueryDto): Promise<{
    items: InventoryBalanceResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.balances.listBalances(query);
  }

  @Get('availability')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(BALANCE_PERMISSIONS.VIEW)
  @ApiOperation({
    summary:
      'Read availability for one warehouse/item key. A key with no stored row reads as zero.',
  })
  @ApiOkResponse({ type: InventoryAvailabilityResponseDto })
  @ApiNotFoundResponse({
    description: 'Organization, warehouse or item does not exist.',
  })
  async availability(
    @Query() query: InventoryAvailabilityQueryDto,
  ): Promise<InventoryAvailabilityResponseDto> {
    return this.balances.getAvailability(query);
  }

  @Get('availability-across-warehouses')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(BALANCE_PERMISSIONS.VIEW)
  @ApiOperation({
    summary:
      "Stock visibility for one item across every active warehouse of the organization (C-50 §3.2) — lets a caller inspect availability before manually choosing a warehouse for a Material Request line. The system never picks or splits a warehouse on the caller's behalf.",
  })
  @ApiOkResponse({ type: [ItemWarehouseAvailabilityResponseDto] })
  @ApiNotFoundResponse({ description: 'Organization or item does not exist.' })
  async availabilityAcrossWarehouses(
    @Query() query: ItemAvailabilityAcrossWarehousesQueryDto,
  ): Promise<ItemWarehouseAvailabilityResponseDto[]> {
    return this.balances.listItemAvailabilityAcrossWarehouses(
      query.organizationId,
      query.itemId,
    );
  }

  @Post('reconcile')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(RECONCILIATION_PERMISSIONS.VIEW)
  @ApiOperation({
    summary:
      'Compare the stored projection against the ledger-derived truth key by key. Read-only: reports drift, changes nothing.',
  })
  @ApiOkResponse({ type: ReconciliationReportDto })
  @ApiNotFoundResponse({
    description: 'Organization, warehouse or item does not exist.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async reconcile(
    @Body() body: ReconcileInventoryBalancesDto,
  ): Promise<ReconciliationReportDto> {
    const report = await this.balances.reconcile({
      organizationId: body.organizationId,
      warehouseId: body.warehouseId,
      itemId: body.itemId,
    });
    return {
      checked: report.checked,
      matched: report.matched,
      mismatched: report.mismatched,
      mismatches: report.mismatches.map((mismatch) => ({
        warehouseId: mismatch.warehouseId,
        itemId: mismatch.itemId,
        expectedOnHand: mismatch.expectedOnHand,
        expectedReserved: mismatch.expectedReserved,
        expectedLastMovementAt:
          mismatch.expectedLastMovementAt?.toISOString() ?? null,
        stored: mismatch.stored,
        matches: mismatch.matches,
      })),
    };
  }

  @Post('rebuild')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(RECONCILIATION_PERMISSIONS.EXECUTE)
  @ApiOperation({
    summary:
      'Rebuild stored balances from the ledger and open reservations. Maintenance operation: every correction is returned in the report.',
  })
  @ApiOkResponse({ type: RebuildReportDto })
  @ApiNotFoundResponse({
    description: 'Organization, warehouse or item does not exist.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async rebuild(
    @Body() body: RebuildInventoryBalancesDto,
  ): Promise<RebuildReportDto> {
    const report = await this.balances.rebuild({
      organizationId: body.organizationId,
      warehouseId: body.warehouseId,
      itemId: body.itemId,
    });
    return {
      checked: report.checked,
      rebuilt: report.rebuilt,
      corrections: report.corrections.map((correction) => ({
        warehouseId: correction.warehouseId,
        itemId: correction.itemId,
        expectedOnHand: correction.expectedOnHand,
        expectedReserved: correction.expectedReserved,
        expectedLastMovementAt:
          correction.expectedLastMovementAt?.toISOString() ?? null,
        storedBefore: correction.storedBefore,
        action: correction.action,
      })),
    };
  }
}
