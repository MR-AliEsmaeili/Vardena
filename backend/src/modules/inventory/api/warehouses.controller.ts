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
  getSchemaPath,
} from '@nestjs/swagger';
import { paginatedResponseOf } from '../../../kernel/pagination/paginated-result.js';
import { AuthGuard } from '../../identity/application/auth.guard.js';
import { AuthorizationGuard } from '../../rbac/application/authorization.guard.js';
import { RequirePermission } from '../../rbac/application/require-permission.decorator.js';
import { WarehousesService } from '../application/warehouses.service.js';
import { WAREHOUSE_PERMISSIONS } from '../domain/inventory-permissions.js';
import { InventoryScopeQueryDto } from './dto/organization-scope.dto.js';
import {
  CreateWarehouseDto,
  ListWarehousesQueryDto,
  UpdateWarehouseDto,
  WarehouseResponseDto,
} from './dto/warehouse.dto.js';

const PaginatedWarehouseDto = paginatedResponseOf(WarehouseResponseDto);

/**
 * Warehouse administration (master-data-strategy.md §4, ADR-0020 §1).
 *
 * Transport-only (AR-03). Master data only: a warehouse is a named stock
 * location under a branch. No locations, zones, stock balances, movements,
 * reservations or valuation are created or returned here — those are future
 * Inventory work (ADR-0017, OQ-24).
 */
@ApiTags('inventory-warehouses')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'inventory/warehouses', version: '1' })
export class WarehousesController {
  constructor(private readonly warehouses: WarehousesService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(WAREHOUSE_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'List the warehouses of one organization.' })
  @ApiExtraModels(PaginatedWarehouseDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedWarehouseDto) }] },
  })
  async list(@Query() query: ListWarehousesQueryDto): Promise<{
    items: WarehouseResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.warehouses.listWarehouses(query);
  }

  @Get(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(WAREHOUSE_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'Get one warehouse.' })
  @ApiOkResponse({ type: WarehouseResponseDto })
  @ApiNotFoundResponse({ description: 'Warehouse does not exist.' })
  async get(
    @Param('id') id: string,
    @Query() scope: InventoryScopeQueryDto,
  ): Promise<WarehouseResponseDto> {
    return this.warehouses.getWarehouse(scope.organizationId, id);
  }

  @Post()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(WAREHOUSE_PERMISSIONS.CREATE)
  @ApiOperation({ summary: 'Create a warehouse under a branch.' })
  @ApiCreatedResponse({ type: WarehouseResponseDto })
  @ApiConflictResponse({
    description: 'Warehouse code already exists in this organization.',
  })
  @ApiNotFoundResponse({
    description:
      'Organization or branch does not exist, or the branch belongs to another organization.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async create(
    @Body() body: CreateWarehouseDto,
  ): Promise<WarehouseResponseDto> {
    return this.warehouses.createWarehouse({
      organizationId: body.organizationId,
      branchId: body.branchId,
      code: body.code,
      name: body.name,
      allowNegativeStock: body.allowNegativeStock,
    });
  }

  @Patch(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(WAREHOUSE_PERMISSIONS.EDIT)
  @ApiOperation({
    summary: 'Edit a warehouse, optionally moving it to another branch.',
  })
  @ApiOkResponse({ type: WarehouseResponseDto })
  @ApiNotFoundResponse({ description: 'Warehouse does not exist.' })
  @ApiConflictResponse({
    description: 'Warehouse code already exists in this organization.',
  })
  async update(
    @Param('id') id: string,
    @Query() scope: InventoryScopeQueryDto,
    @Body() body: UpdateWarehouseDto,
  ): Promise<WarehouseResponseDto> {
    return this.warehouses.updateWarehouse(scope.organizationId, id, {
      branchId: body.branchId,
      code: body.code,
      name: body.name,
      allowNegativeStock: body.allowNegativeStock,
    });
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(WAREHOUSE_PERMISSIONS.ENABLE)
  @ApiOperation({ summary: 'Enable a disabled warehouse.' })
  @ApiOkResponse({ type: WarehouseResponseDto })
  @ApiNotFoundResponse({ description: 'Warehouse does not exist.' })
  async enable(
    @Param('id') id: string,
    @Query() scope: InventoryScopeQueryDto,
  ): Promise<WarehouseResponseDto> {
    return this.warehouses.enableWarehouse(scope.organizationId, id);
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(WAREHOUSE_PERMISSIONS.DISABLE)
  @ApiOperation({
    summary:
      'Disable a warehouse (blocks new movements against it once inventory transactions exist; existing history stays readable).',
  })
  @ApiOkResponse({ type: WarehouseResponseDto })
  @ApiNotFoundResponse({ description: 'Warehouse does not exist.' })
  async disable(
    @Param('id') id: string,
    @Query() scope: InventoryScopeQueryDto,
  ): Promise<WarehouseResponseDto> {
    return this.warehouses.disableWarehouse(scope.organizationId, id);
  }
}
