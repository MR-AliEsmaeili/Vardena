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
import { InventoryMovementsService } from '../application/inventory-movements.service.js';
import { MOVEMENT_PERMISSIONS } from '../domain/inventory-core-permissions.js';
import { InventoryScopeQueryDto } from './dto/organization-scope.dto.js';
import {
  InventoryMovementResponseDto,
  ListInventoryMovementsQueryDto,
  PostInventoryMovementDto,
  ReverseInventoryMovementDto,
} from './dto/inventory-core.dto.js';

const PaginatedMovementDto = paginatedResponseOf(InventoryMovementResponseDto);

/**
 * Inventory movement ledger (ADR-0022).
 *
 * Transport-only (AR-03). Movements are immutable facts: there is no PUT,
 * PATCH or DELETE — a posted movement is corrected with a full-amount
 * reversal, never edited. Every mutating call carries a client-supplied
 * `operationKey`: retrying with the same key replays the stored row, while
 * the same key with different intent is rejected with 409.
 */
@ApiTags('inventory-movements')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'inventory/movements', version: '1' })
export class InventoryMovementsController {
  constructor(private readonly movements: InventoryMovementsService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(MOVEMENT_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'List the movements of one organization.' })
  @ApiExtraModels(PaginatedMovementDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedMovementDto) }] },
  })
  async list(@Query() query: ListInventoryMovementsQueryDto): Promise<{
    items: InventoryMovementResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.movements.listMovements(query);
  }

  @Get(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(MOVEMENT_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'Get one movement.' })
  @ApiOkResponse({ type: InventoryMovementResponseDto })
  @ApiNotFoundResponse({ description: 'Movement does not exist.' })
  async get(
    @Param('id') id: string,
    @Query() scope: InventoryScopeQueryDto,
  ): Promise<InventoryMovementResponseDto> {
    return this.movements.getMovement(scope.organizationId, id);
  }

  @Post()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(MOVEMENT_PERMISSIONS.CREATE)
  @ApiOperation({
    summary:
      'Post a receipt, issue or adjustment. Replaying an operationKey returns the original movement.',
  })
  @ApiCreatedResponse({ type: InventoryMovementResponseDto })
  @ApiConflictResponse({
    description:
      'The operationKey was already used with different intent (never applied).',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'Negative-stock policy violation, a non-stockable or disabled item/warehouse, an adjustment without a reason, or no unit conversion covering the movement date.',
  })
  @ApiNotFoundResponse({
    description: 'Organization, warehouse, item or unit does not exist.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async post(
    @Body() body: PostInventoryMovementDto,
  ): Promise<InventoryMovementResponseDto> {
    return this.movements.postMovement({
      organizationId: body.organizationId,
      operationKey: body.operationKey,
      warehouseId: body.warehouseId,
      itemId: body.itemId,
      movementType: body.movementType,
      quantity: body.quantity,
      unitId: body.unitId,
      movementDate: body.movementDate,
      reason: body.reason,
      referenceType: body.referenceType,
      referenceId: body.referenceId,
    });
  }

  @Post(':id/reverse')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(MOVEMENT_PERMISSIONS.REVERSE)
  @ApiOperation({
    summary:
      'Post a full-amount reversal of a movement. Transfer legs and already-reversed movements cannot be reversed.',
  })
  @ApiCreatedResponse({ type: InventoryMovementResponseDto })
  @ApiConflictResponse({
    description:
      'The movement is already reversed (or is a transfer leg), or the operationKey was already used with different intent.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'The reversal date precedes the original movement, or the reversal would violate the negative-stock policy.',
  })
  @ApiNotFoundResponse({ description: 'Movement does not exist.' })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async reverse(
    @Param('id') id: string,
    @Query() scope: InventoryScopeQueryDto,
    @Body() body: ReverseInventoryMovementDto,
  ): Promise<InventoryMovementResponseDto> {
    return this.movements.reverseMovement(scope.organizationId, id, {
      operationKey: body.operationKey,
      movementDate: body.movementDate,
    });
  }
}
