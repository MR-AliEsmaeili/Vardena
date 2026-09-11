import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
import { ItemsService } from '../application/items.service.js';
import { ITEM_PERMISSIONS } from '../domain/inventory-permissions.js';
import {
  CreateItemDto,
  ItemResponseDto,
  ListItemsQueryDto,
  UpdateItemDto,
} from './dto/item.dto.js';

const PaginatedItemDto = paginatedResponseOf(ItemResponseDto);

/**
 * Item administration (D-25, master-data-strategy.md §3).
 *
 * Transport-only (AR-03). One resource, one shape: `itemKind` selects the
 * creation-time defaults and the capability booleans are the truth, so there is
 * no `/products`, `/services` or `/stock-items` endpoint and no attributes bag.
 *
 * There is no POST for `itemKind`: it is immutable after creation, because
 * re-applying a kind's defaults over flags a user set deliberately is a rule
 * nobody has approved. Wrong kind means disable and recreate.
 *
 * No stock, price, cost or accounting data is returned — those come from the
 * future Inventory/Accounting modules.
 */
@ApiTags('inventory-items')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'inventory/items', version: '1' })
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ITEM_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'List the items of one organization.' })
  @ApiExtraModels(PaginatedItemDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedItemDto) }] },
  })
  async list(
    @Query() query: ListItemsQueryDto,
  ): Promise<{
    items: ItemResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.items.listItems(query);
  }

  @Get(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ITEM_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'Get one item.' })
  @ApiOkResponse({ type: ItemResponseDto })
  @ApiNotFoundResponse({ description: 'Item does not exist.' })
  async get(@Param('id') id: string): Promise<ItemResponseDto> {
    return this.items.getItem(id);
  }

  @Post()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ITEM_PERMISSIONS.CREATE)
  @ApiOperation({
    summary:
      'Create an item. Capability flags may be omitted to take the defaults of `itemKind`.',
  })
  @ApiCreatedResponse({ type: ItemResponseDto })
  @ApiConflictResponse({
    description: 'Item code already exists in this organization.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'Unknown item kind, or a capability combination that contradicts the behaviour table (e.g. a non-stockable item that requires lot tracking).',
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async create(@Body() body: CreateItemDto): Promise<ItemResponseDto> {
    return this.items.createItem({
      organizationId: body.organizationId,
      code: body.code,
      name: body.name,
      description: body.description,
      itemKind: body.itemKind,
      itemGroupId: body.itemGroupId,
      baseUnitId: body.baseUnitId,
      barcode: body.barcode,
      isStockable: body.isStockable,
      isPurchasable: body.isPurchasable,
      isSellable: body.isSellable,
      isValued: body.isValued,
      requiresLot: body.requiresLot,
      requiresSerial: body.requiresSerial,
      requiresExpiry: body.requiresExpiry,
    });
  }

  @Patch(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ITEM_PERMISSIONS.EDIT)
  @ApiOperation({
    summary:
      'Edit an item. Omitted capability flags keep their stored value; `itemKind` cannot be changed.',
  })
  @ApiOkResponse({ type: ItemResponseDto })
  @ApiNotFoundResponse({ description: 'Item does not exist.' })
  @ApiConflictResponse({
    description: 'Item code already exists in this organization.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'The resulting capability combination contradicts the behaviour table.',
  })
  async update(
    @Param('id') id: string,
    @Body() body: UpdateItemDto,
  ): Promise<ItemResponseDto> {
    return this.items.updateItem(id, {
      code: body.code,
      name: body.name,
      description: body.description,
      itemGroupId: body.itemGroupId,
      baseUnitId: body.baseUnitId,
      barcode: body.barcode,
      isStockable: body.isStockable,
      isPurchasable: body.isPurchasable,
      isSellable: body.isSellable,
      isValued: body.isValued,
      requiresLot: body.requiresLot,
      requiresSerial: body.requiresSerial,
      requiresExpiry: body.requiresExpiry,
    });
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ITEM_PERMISSIONS.ENABLE)
  @ApiOperation({ summary: 'Enable a disabled item.' })
  @ApiOkResponse({ type: ItemResponseDto })
  @ApiNotFoundResponse({ description: 'Item does not exist.' })
  async enable(@Param('id') id: string): Promise<ItemResponseDto> {
    return this.items.enableItem(id);
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ITEM_PERMISSIONS.DISABLE)
  @ApiOperation({
    summary:
      'Disable an item (blocks new documents from referencing it; existing documents and history stay readable).',
  })
  @ApiOkResponse({ type: ItemResponseDto })
  @ApiNotFoundResponse({ description: 'Item does not exist.' })
  async disable(@Param('id') id: string): Promise<ItemResponseDto> {
    return this.items.disableItem(id);
  }
}
