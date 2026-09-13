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
import { UnitsService } from '../application/units.service.js';
import { UNIT_PERMISSIONS } from '../domain/inventory-permissions.js';
import { InventoryScopeQueryDto } from './dto/organization-scope.dto.js';
import {
  CreateUnitDto,
  ListUnitsQueryDto,
  UnitResponseDto,
  UpdateUnitDto,
} from './dto/unit.dto.js';

const PaginatedUnitDto = paginatedResponseOf(UnitResponseDto);

/**
 * Unit of measure administration (docs/modules.md §Inventory, D-26).
 *
 * Transport-only (AR-03). A unit is an organization-level definition: code,
 * name, optional symbol. Conversion factors live in the separate unit
 * conversion resource, and per-unit precision is expert-gated and unresolved
 * (OQ-29), so it is not part of this contract.
 */
@ApiTags('inventory-units')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'inventory/units', version: '1' })
export class UnitsController {
  constructor(private readonly units: UnitsService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(UNIT_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'List the units of one organization.' })
  @ApiExtraModels(PaginatedUnitDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedUnitDto) }] },
  })
  async list(
    @Query() query: ListUnitsQueryDto,
  ): Promise<{
    items: UnitResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.units.listUnits(query);
  }

  @Get(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(UNIT_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'Get one unit.' })
  @ApiOkResponse({ type: UnitResponseDto })
  @ApiNotFoundResponse({ description: 'Unit does not exist.' })
  async get(
    @Param('id') id: string,
    @Query() scope: InventoryScopeQueryDto,
  ): Promise<UnitResponseDto> {
    return this.units.getUnit(scope.organizationId, id);
  }

  @Post()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(UNIT_PERMISSIONS.CREATE)
  @ApiOperation({ summary: 'Create a unit in an organization.' })
  @ApiCreatedResponse({ type: UnitResponseDto })
  @ApiConflictResponse({
    description: 'Unit code already exists in this organization.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async create(@Body() body: CreateUnitDto): Promise<UnitResponseDto> {
    return this.units.createUnit({
      organizationId: body.organizationId,
      code: body.code,
      name: body.name,
      symbol: body.symbol,
    });
  }

  @Patch(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(UNIT_PERMISSIONS.EDIT)
  @ApiOperation({ summary: 'Edit a unit.' })
  @ApiOkResponse({ type: UnitResponseDto })
  @ApiNotFoundResponse({ description: 'Unit does not exist.' })
  @ApiConflictResponse({
    description: 'Unit code already exists in this organization.',
  })
  async update(
    @Param('id') id: string,
    @Query() scope: InventoryScopeQueryDto,
    @Body() body: UpdateUnitDto,
  ): Promise<UnitResponseDto> {
    return this.units.updateUnit(scope.organizationId, id, {
      code: body.code,
      name: body.name,
      symbol: body.symbol,
    });
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(UNIT_PERMISSIONS.ENABLE)
  @ApiOperation({ summary: 'Enable a disabled unit.' })
  @ApiOkResponse({ type: UnitResponseDto })
  @ApiNotFoundResponse({ description: 'Unit does not exist.' })
  async enable(
    @Param('id') id: string,
    @Query() scope: InventoryScopeQueryDto,
  ): Promise<UnitResponseDto> {
    return this.units.enableUnit(scope.organizationId, id);
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(UNIT_PERMISSIONS.DISABLE)
  @ApiOperation({
    summary:
      'Disable a unit (blocks new usage, keeps history readable). Items and conversions already using it stay readable.',
  })
  @ApiOkResponse({ type: UnitResponseDto })
  @ApiNotFoundResponse({ description: 'Unit does not exist.' })
  async disable(
    @Param('id') id: string,
    @Query() scope: InventoryScopeQueryDto,
  ): Promise<UnitResponseDto> {
    return this.units.disableUnit(scope.organizationId, id);
  }
}
