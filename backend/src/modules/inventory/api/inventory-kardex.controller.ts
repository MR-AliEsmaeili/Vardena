import { Controller, Get, HttpCode, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
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
import { KARDEX_PERMISSIONS } from '../domain/inventory-kardex-permissions.js';
import {
  InventoryKardexQueryDto,
  InventoryKardexResponseDto,
} from './dto/inventory-kardex.dto.js';
import {
  KardexQuantityQueryDto,
  QuantityKardexResponseDto,
} from './dto/kardex-quantity-query.dto.js';

@ApiTags('inventory-kardex')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({ description: 'Missing Inventory.Movement.View.' })
@Controller({ path: 'inventory/kardex', version: '1' })
export class InventoryKardexController {
  constructor(private readonly kardex: InventoryKardexService) {}

  @Get('quantity')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(KARDEX_PERMISSIONS.VIEW)
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Read a paginated quantity-only Kardex for one item and warehouse.',
  })
  @ApiOkResponse({ type: QuantityKardexResponseDto })
  @ApiBadRequestResponse({
    description:
      'Invalid range, unsupported ordering, page limit, or missing page snapshot.',
  })
  @ApiForbiddenResponse({ description: 'Missing Inventory.Kardex.View.' })
  @ApiNotFoundResponse({
    description:
      'The organization, item, or warehouse is not available in the requested scope.',
  })
  quantity(
    @Query() query: KardexQuantityQueryDto,
  ): Promise<QuantityKardexResponseDto> {
    return this.kardex.readQuantity(query);
  }

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
