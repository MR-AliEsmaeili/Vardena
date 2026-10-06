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
import { InventoryPricingService } from '../application/inventory-pricing.service.js';
import { VALUATION_PERMISSIONS } from '../domain/inventory-valuation-permissions.js';
import {
  ListPricingRunsQueryDto,
  PricingRunResponseDto,
  PricingRunScopeQueryDto,
  ReversePricingDto,
  RunPricingDto,
} from './dto/inventory-pricing.dto.js';

const PaginatedPricingRunDto = paginatedResponseOf(PricingRunResponseDto);

/**
 * The Periodic Pricing Operation and its reverse (C-59E / C-59E+).
 *
 * Transport-only (AR-03). Four routes, three permissions:
 *
 * - **Run** the batch — `Inventory.Valuation.RunPricing`. A strictly bigger
 *   authority than the one-key `Recalculate`, hence its own code.
 * - **Reverse** a run — `Inventory.Valuation.ReversePricing`. Un-pricing
 *   already-published figures is a different act from computing them
 *   (OD-RVP-08).
 * - **Read** the run history and its per-key outcomes —
 *   `Inventory.Valuation.View`.
 *
 * The pricing run is deliberately NOT part of any document lifecycle: it
 * changes no quantity, posts no accounting document and blocks no stock
 * movement (OD-PDP-05). It is an operator command over a SCOPE, and its
 * report (per-key outcome, named failing movements) is the audit surface
 * (OD-PRC-07).
 */
@ApiTags('inventory-pricing')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@ApiBadRequestResponse({ description: 'Validation failed.' })
@ApiUnprocessableEntityResponse({
  description: 'A domain rule refused the command (stable code in details).',
})
@Controller({ path: 'inventory/pricing', version: '1' })
export class InventoryPricingController {
  constructor(private readonly pricing: InventoryPricingService) {}

  @Post('runs')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(VALUATION_PERMISSIONS.RUN_PRICING)
  @ApiOperation({
    summary:
      'Run the Periodic Pricing Operation: an explicit, transactional batch repricing over a scope (warehouse(s), document kinds, date range). The range start is automatic; runs per scope are contiguous and non-overlapping.',
  })
  @ApiCreatedResponse({
    type: PricingRunResponseDto,
    description:
      'The run report: per-key outcomes with named failing movements (OD-PRC-07).',
  })
  @ApiConflictResponse({
    description:
      'The operationKey was reused with a different request, or the scope\u2019s run history does not extend (range_not_extending).',
  })
  async runPricing(
    @Body() body: RunPricingDto,
  ): Promise<PricingRunResponseDto> {
    return this.pricing.runPricing({
      organizationId: body.organizationId,
      operationKey: body.operationKey,
      warehouseId: body.warehouseId ?? null,
      documentKinds: body.documentKinds,
      toDate: body.toDate,
      reason: body.reason ?? null,
    });
  }

  @Post('runs/reverse')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(VALUATION_PERMISSIONS.REVERSE_PRICING)
  @ApiOperation({
    summary:
      'Reverse ONE named pricing run with a compensating run. Value-preserving: quantities never change, the run\u2019s movements become unvalued and the affected keys require repricing. Blocked fail-closed while any affected document is accounting-posted.',
  })
  @ApiCreatedResponse({
    type: PricingRunResponseDto,
    description: 'The compensating run report (kind = reverse_pricing).',
  })
  @ApiConflictResponse({
    description:
      'The run was already reversed, or the operationKey was reused with a different request.',
  })
  @ApiNotFoundResponse({ description: 'The run does not exist.' })
  async reversePricing(
    @Body() body: ReversePricingDto,
  ): Promise<PricingRunResponseDto> {
    return this.pricing.reversePricing({
      organizationId: body.organizationId,
      pricingRunId: body.pricingRunId,
      operationKey: body.operationKey,
      reason: body.reason ?? null,
    });
  }

  @Get('runs')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(VALUATION_PERMISSIONS.VIEW)
  @ApiOperation({
    summary:
      'List pricing runs (both kinds) with their per-key outcomes. Filterable by warehouse and kind.',
  })
  @ApiExtraModels(PaginatedPricingRunDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedPricingRunDto) }] },
  })
  async listRuns(@Query() query: ListPricingRunsQueryDto): Promise<{
    items: PricingRunResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.pricing.listRuns({
      organizationId: query.organizationId,
      warehouseId: query.warehouseId,
      kind: query.kind,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  @Get('runs/:id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(VALUATION_PERMISSIONS.VIEW)
  @ApiOperation({
    summary: 'Get one pricing run with its full per-key outcome report.',
  })
  @ApiOkResponse({ type: PricingRunResponseDto })
  @ApiNotFoundResponse({ description: 'The run does not exist.' })
  async getRun(
    @Param('id') id: string,
    @Query() query: PricingRunScopeQueryDto,
  ): Promise<PricingRunResponseDto> {
    return this.pricing.getRun(query.organizationId, id);
  }
}
