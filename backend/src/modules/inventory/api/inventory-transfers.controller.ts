import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { AuthGuard } from '../../identity/application/auth.guard.js';
import { AuthorizationGuard } from '../../rbac/application/authorization.guard.js';
import { RequirePermission } from '../../rbac/application/require-permission.decorator.js';
import { InventoryTransfersService } from '../application/inventory-transfers.service.js';
import { TRANSFER_PERMISSIONS } from '../domain/inventory-core-permissions.js';
import {
  InventoryTransferResponseDto,
  PostInventoryTransferDto,
} from './dto/inventory-core.dto.js';

/**
 * Warehouse-to-warehouse transfers (D-24, ADR-0022).
 *
 * Transport-only (AR-03). A transfer is an inventory-only operation: two
 * movement facts (`transfer_out` + `transfer_in`) sharing one `transferId`,
 * committed atomically. No accounting entry is created. There is no transfer
 * list endpoint — transfer legs are movements and are read through
 * GET /inventory/movements (filter by `transferId`).
 */
@ApiTags('inventory-transfers')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'inventory/transfers', version: '1' })
export class InventoryTransfersController {
  constructor(private readonly transfers: InventoryTransfersService) {}

  @Post()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(TRANSFER_PERMISSIONS.CREATE)
  @ApiOperation({
    summary:
      'Post an atomic transfer between two warehouses. Both legs commit together or not at all; replaying an operationKey returns the original pair.',
  })
  @ApiCreatedResponse({ type: InventoryTransferResponseDto })
  @ApiConflictResponse({
    description:
      'The operationKey was already used with different intent (never applied).',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'Source equals destination, negative-stock policy violation at the source, a non-stockable or disabled item/warehouse, no unit conversion covering the movement date, ' +
      'or a backdated transfer whose valuation would depend on the unresolved transfer-average convention (inventory.backdated_transfer_valuation_unresolved).',
  })
  @ApiNotFoundResponse({
    description: 'Organization, warehouse, item or unit does not exist.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async post(
    @Body() body: PostInventoryTransferDto,
  ): Promise<InventoryTransferResponseDto> {
    return this.transfers.postTransfer({
      organizationId: body.organizationId,
      operationKey: body.operationKey,
      sourceWarehouseId: body.sourceWarehouseId,
      destinationWarehouseId: body.destinationWarehouseId,
      itemId: body.itemId,
      quantity: body.quantity,
      unitId: body.unitId,
      movementDate: body.movementDate,
      reason: body.reason,
      referenceType: body.referenceType,
      referenceId: body.referenceId,
    });
  }
}
