import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { paginatedResponseOf } from '../../../kernel/pagination/paginated-result.js';
import { AuthGuard } from '../../identity/application/auth.guard.js';
import { AuthorizationGuard } from '../../rbac/application/authorization.guard.js';
import { RequirePermission } from '../../rbac/application/require-permission.decorator.js';
import { InventoryValuationService } from '../application/inventory-valuation.service.js';
import { VALUATION_PERMISSIONS } from '../domain/inventory-valuation-permissions.js';
import { MOVEMENT_PERMISSIONS } from '../domain/inventory-core-permissions.js';
import {
  AssignMovementCostDto,
  BackdateCheckQueryDto,
  BackdateCheckResponseDto,
  ConfigureValuationMethodDto,
  InventoryValuationRunResponseDto,
  InventoryValuationStateResponseDto,
  ItemValuationMethodResponseDto,
  ListValuationMethodsQueryDto,
  ListValuationRunsQueryDto,
  ListValuationStatesQueryDto,
  RecalculateValuationDto,
  RecalculationResponseDto,
  ResolvedValuationMethodResponseDto,
  ResolveValuationMethodQueryDto,
  ValuationCommandResponseDto,
  ValuationStateKeyQueryDto,
} from './dto/inventory-valuation.dto.js';

const PaginatedMethodDto = paginatedResponseOf(ItemValuationMethodResponseDto);
const PaginatedStateDto = paginatedResponseOf(
  InventoryValuationStateResponseDto,
);
const PaginatedRunDto = paginatedResponseOf(InventoryValuationRunResponseDto);

/**
 * Inventory valuation (PDR-05, ADR-0039).
 *
 * Transport-only (AR-03). The endpoints here are the Inventory Accounting
 * half of the two workspaces the brief describes: Warehouse Operations posts
 * quantities through `/inventory/movements` and never needs this controller,
 * while accounting configures the method, sees what still has no cost,
 * prices it, and decides when values are restated.
 *
 * Three contracts hold across every route:
 *
 * - **No endpoint recalculates more than one item in one warehouse.** The
 *   key is a required input on the only command that reprices.
 * - **No endpoint recalculates implicitly.** `repricing` is required and has
 *   no default wherever a decision could restate existing values.
 * - **Money is permission-gated.** Reading value needs
 *   `Inventory.Valuation.View`; entering it needs
 *   `Inventory.Valuation.AssignCost`; restating it needs
 *   `Inventory.Valuation.Recalculate`.
 */
@ApiTags('inventory-valuation')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'inventory/valuation', version: '1' })
export class InventoryValuationController {
  constructor(private readonly valuation: InventoryValuationService) {}

  // ---- method configuration ----------------------------------------------

  @Get('methods')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(VALUATION_PERMISSIONS.VIEW)
  @ApiOperation({
    summary:
      'List the effective-dated valuation-method versions configured for items.',
  })
  @ApiExtraModels(PaginatedMethodDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedMethodDto) }] },
  })
  async listMethods(@Query() query: ListValuationMethodsQueryDto): Promise<{
    items: ItemValuationMethodResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.valuation.listMethods(query);
  }

  @Get('methods/resolve')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(VALUATION_PERMISSIONS.VIEW)
  @ApiOperation({
    summary:
      'Resolve which valuation method governs one item at one instant, and whether it came from configuration or the default.',
  })
  @ApiOkResponse({ type: ResolvedValuationMethodResponseDto })
  @ApiNotFoundResponse({ description: 'Organization or item does not exist.' })
  @ApiUnprocessableEntityResponse({
    description:
      'The configured method is not implemented (inventory.valuation_method_not_implemented).',
  })
  async resolveMethod(
    @Query() query: ResolveValuationMethodQueryDto,
  ): Promise<ResolvedValuationMethodResponseDto> {
    return this.valuation.resolveMethod({
      organizationId: query.organizationId,
      itemId: query.itemId,
      asOf: query.asOf ?? new Date(),
    });
  }

  @Post('methods')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(VALUATION_PERMISSIONS.CONFIGURE)
  @ApiOperation({
    summary:
      'Configure the valuation method of an item from an instant. The previous open-ended version is closed, never edited.',
  })
  @ApiCreatedResponse({ type: ItemValuationMethodResponseDto })
  @ApiConflictResponse({
    description: 'A version with the same start date already exists.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'The method is known but not implemented, or the window overlaps an existing version.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async configureMethod(
    @Body() body: ConfigureValuationMethodDto,
  ): Promise<ItemValuationMethodResponseDto> {
    return this.valuation.configureMethod({
      organizationId: body.organizationId,
      itemId: body.itemId,
      method: body.method,
      validFrom: body.validFrom,
      validTo: body.validTo,
      note: body.note,
    });
  }

  // ---- state --------------------------------------------------------------

  @Get('states')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(VALUATION_PERMISSIONS.VIEW)
  @ApiOperation({
    summary:
      'List valuation states. Filter by status to get the Inventory Accounting worklist: stock waiting for a cost, or values waiting for a recalculation.',
  })
  @ApiExtraModels(PaginatedStateDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedStateDto) }] },
  })
  async listStates(@Query() query: ListValuationStatesQueryDto): Promise<{
    items: InventoryValuationStateResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.valuation.listStates(query);
  }

  @Get('states/current')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(VALUATION_PERMISSIONS.VIEW)
  @ApiOperation({
    summary: 'Get the valuation state of one item in one warehouse.',
  })
  @ApiOkResponse({ type: InventoryValuationStateResponseDto })
  @ApiNotFoundResponse({
    description:
      'No valuation state exists yet for this item and warehouse (nothing has ever moved there).',
  })
  async getState(
    @Query() query: ValuationStateKeyQueryDto,
  ): Promise<InventoryValuationStateResponseDto> {
    return this.valuation.getState(query);
  }

  // ---- backdating ---------------------------------------------------------

  @Get('backdate-check')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(MOVEMENT_PERMISSIONS.CREATE)
  @ApiOperation({
    summary:
      'Preview what posting with this business date would disturb, so the UI can explain the consequence BEFORE the operator commits.',
    description:
      'Gated by Inventory.Movement.Create, not by a valuation permission: the person about to post must see the consequence even if they may not see money. The response carries counts and dates only — no amounts.',
  })
  @ApiOkResponse({ type: BackdateCheckResponseDto })
  @ApiNotFoundResponse({
    description: 'Organization, warehouse or item does not exist.',
  })
  async checkBackdate(
    @Query() query: BackdateCheckQueryDto,
  ): Promise<BackdateCheckResponseDto> {
    return this.valuation.checkBackdate({
      organizationId: query.organizationId,
      warehouseId: query.warehouseId,
      itemId: query.itemId,
      movementDate: query.movementDate,
    });
  }

  // ---- commands -----------------------------------------------------------

  @Post('movements/:id/cost')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(VALUATION_PERMISSIONS.ASSIGN_COST)
  @ApiOperation({
    summary:
      'Assign a cost to an inbound movement that was posted without one, then either reprice the key or leave it marked inconsistent.',
    description:
      'Only an addition: a movement that already carries a value is refused with 409 — correcting a wrong cost goes through a reversal, exactly like a wrong quantity.',
  })
  @ApiCreatedResponse({ type: ValuationCommandResponseDto })
  @ApiConflictResponse({
    description:
      'The movement already carries a cost, or the operationKey was used with different intent.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'The movement is an issue (its value comes from the method), or the key exceeds the bounded recalculation limit.',
  })
  @ApiNotFoundResponse({ description: 'Movement does not exist.' })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async assignCost(
    @Param('id') id: string,
    @Body() body: AssignMovementCostDto,
  ): Promise<ValuationCommandResponseDto> {
    const result = await this.valuation.assignCost({
      organizationId: body.organizationId,
      movementId: id,
      operationKey: body.operationKey,
      totalCost: body.totalCost,
      repricing: body.repricing,
      reason: body.reason,
    });
    return {
      movement: result.movement as unknown as Record<string, unknown> | null,
      state: result.state,
      run: result.run,
    };
  }

  @Get('recalculations')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(VALUATION_PERMISSIONS.VIEW)
  @ApiOperation({
    summary:
      'List recalculation runs: what was repriced, when, why, and how many rows actually changed.',
  })
  @ApiExtraModels(PaginatedRunDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedRunDto) }] },
  })
  async listRuns(@Query() query: ListValuationRunsQueryDto): Promise<{
    items: InventoryValuationRunResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.valuation.listRuns(query);
  }

  @Post('recalculations')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(VALUATION_PERMISSIONS.RECALCULATE)
  @ApiOperation({
    summary:
      'Reprice ONE item in ONE warehouse by replaying its movements in the canonical ledger order.',
    description:
      'Bounded by construction: the key is required, the replay runs in a single transaction, and a key with more movements than the limit is refused rather than run. Human-entered costs, transfer legs and reversals keep their values; only average-derived issue values are recomputed, so the command is idempotent.',
  })
  @ApiCreatedResponse({ type: RecalculationResponseDto })
  @ApiConflictResponse({
    description: 'The operationKey was already used with different intent.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'The key exceeds the bounded recalculation limit (inventory.recalculation_too_large), or its configured method is not implemented.',
  })
  @ApiNotFoundResponse({
    description: 'Organization, warehouse or item does not exist.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async recalculate(
    @Body() body: RecalculateValuationDto,
  ): Promise<RecalculationResponseDto> {
    return this.valuation.recalculate({
      organizationId: body.organizationId,
      warehouseId: body.warehouseId,
      itemId: body.itemId,
      operationKey: body.operationKey,
      trigger: body.trigger,
      fromDate: body.fromDate,
      reason: body.reason,
    });
  }
}
