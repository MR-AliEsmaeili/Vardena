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
import { ItemGroupsService } from '../application/item-groups.service.js';
import { ITEM_GROUP_PERMISSIONS } from '../domain/inventory-permissions.js';
import { InventoryScopeQueryDto } from './dto/organization-scope.dto.js';
import {
  CreateItemGroupDto,
  ItemGroupResponseDto,
  ListItemGroupsQueryDto,
  UpdateItemGroupDto,
} from './dto/item-group.dto.js';

const PaginatedItemGroupDto = paginatedResponseOf(ItemGroupResponseDto);

/**
 * Item group administration (master-data-strategy.md §3.2).
 *
 * Transport-only (AR-03). Item groups are a *classification* hierarchy, not a
 * storage hierarchy: they carry no stock, no accounting and no default unit.
 * Hierarchy violations (cross-organization parent, self-parenting, cycle) are
 * rejected by the application service with 422.
 */
@ApiTags('inventory-item-groups')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'inventory/item-groups', version: '1' })
export class ItemGroupsController {
  constructor(private readonly itemGroups: ItemGroupsService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ITEM_GROUP_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'List the item groups of one organization.' })
  @ApiExtraModels(PaginatedItemGroupDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedItemGroupDto) }] },
  })
  async list(
    @Query() query: ListItemGroupsQueryDto,
  ): Promise<{
    items: ItemGroupResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.itemGroups.listItemGroups(query);
  }

  @Get(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ITEM_GROUP_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'Get one item group.' })
  @ApiOkResponse({ type: ItemGroupResponseDto })
  @ApiNotFoundResponse({ description: 'Item group does not exist.' })
  async get(
    @Param('id') id: string,
    @Query() scope: InventoryScopeQueryDto,
  ): Promise<ItemGroupResponseDto> {
    return this.itemGroups.getItemGroup(scope.organizationId, id);
  }

  @Post()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ITEM_GROUP_PERMISSIONS.CREATE)
  @ApiOperation({
    summary: 'Create an item group, optionally under a parent group.',
  })
  @ApiCreatedResponse({ type: ItemGroupResponseDto })
  @ApiConflictResponse({
    description: 'Item group code already exists in this organization.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'Parent group is in another organization, is disabled, or is the group itself.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async create(
    @Body() body: CreateItemGroupDto,
  ): Promise<ItemGroupResponseDto> {
    return this.itemGroups.createItemGroup({
      organizationId: body.organizationId,
      parentId: body.parentId,
      code: body.code,
      name: body.name,
    });
  }

  @Patch(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ITEM_GROUP_PERMISSIONS.EDIT)
  @ApiOperation({
    summary:
      'Edit an item group. Re-parenting to `null` makes it a root group.',
  })
  @ApiOkResponse({ type: ItemGroupResponseDto })
  @ApiNotFoundResponse({ description: 'Item group does not exist.' })
  @ApiConflictResponse({
    description: 'Item group code already exists in this organization.',
  })
  @ApiUnprocessableEntityResponse({
    description: 'The requested parent would create a cycle or crosses organizations.',
  })
  async update(
    @Param('id') id: string,
    @Query() scope: InventoryScopeQueryDto,
    @Body() body: UpdateItemGroupDto,
  ): Promise<ItemGroupResponseDto> {
    return this.itemGroups.updateItemGroup(scope.organizationId, id, {
      parentId: body.parentId,
      code: body.code,
      name: body.name,
    });
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ITEM_GROUP_PERMISSIONS.ENABLE)
  @ApiOperation({ summary: 'Enable a disabled item group.' })
  @ApiOkResponse({ type: ItemGroupResponseDto })
  @ApiNotFoundResponse({ description: 'Item group does not exist.' })
  async enable(
    @Param('id') id: string,
    @Query() scope: InventoryScopeQueryDto,
  ): Promise<ItemGroupResponseDto> {
    return this.itemGroups.enableItemGroup(scope.organizationId, id);
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ITEM_GROUP_PERMISSIONS.DISABLE)
  @ApiOperation({
    summary:
      'Disable an item group (blocks new items from being classified under it; existing items and child groups stay readable).',
  })
  @ApiOkResponse({ type: ItemGroupResponseDto })
  @ApiNotFoundResponse({ description: 'Item group does not exist.' })
  async disable(
    @Param('id') id: string,
    @Query() scope: InventoryScopeQueryDto,
  ): Promise<ItemGroupResponseDto> {
    return this.itemGroups.disableItemGroup(scope.organizationId, id);
  }
}
