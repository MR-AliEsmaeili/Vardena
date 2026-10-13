import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { AuthGuard } from '../../identity/application/auth.guard.js';
import { AuthorizationGuard } from '../../rbac/application/authorization.guard.js';
import { RequirePermission } from '../../rbac/application/require-permission.decorator.js';
import { InventoryKardexService } from '../application/inventory-kardex.service.js';
import { MOVEMENT_PERMISSIONS } from '../domain/inventory-core-permissions.js';
import {
  InventoryKardexQueryDto,
  InventoryKardexResponseDto,
} from './dto/inventory-kardex.dto.js';

@ApiTags('inventory-kardex')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({ description: 'Missing Inventory.Movement.View.' })
@Controller({ path: 'inventory/kardex', version: '1' })
export class InventoryKardexController {
  constructor(private readonly kardex: InventoryKardexService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(MOVEMENT_PERMISSIONS.VIEW)
  @ApiOperation({
    summary: 'Read a quantity-only Kardex for one item and warehouse.',
  })
  @ApiOkResponse({ type: InventoryKardexResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid range or missing page snapshot.',
  })
  @ApiUnprocessableEntityResponse({
    description: 'Display conversion is missing or not exactly representable.',
  })
  read(
    @Query() query: InventoryKardexQueryDto,
  ): Promise<InventoryKardexResponseDto> {
    return this.kardex.read(query);
  }
}
