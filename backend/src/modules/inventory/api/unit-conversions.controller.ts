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
import { UnitConversionsService } from '../application/unit-conversions.service.js';
import { UNIT_CONVERSION_PERMISSIONS } from '../domain/inventory-permissions.js';
import {
  CreateUnitConversionDto,
  ListUnitConversionsQueryDto,
  ResolveUnitConversionQueryDto,
  ResolveUnitConversionResponseDto,
  UnitConversionResponseDto,
} from './dto/unit-conversion.dto.js';

const PaginatedUnitConversionDto = paginatedResponseOf(
  UnitConversionResponseDto,
);

/**
 * Unit conversion administration (D-26, ADR-0020 §4, OQ-29).
 *
 * Transport-only (AR-03). Note what is **absent**: there is no `PATCH` and no
 * `enable`/`disable`. Conversions are effective-dated configuration, and used
 * configuration is never edited in place — changing a conversion means creating
 * a new version, which closes the previous one.
 *
 * `factor` is a decimal string end to end, never a JSON number.
 */
@ApiTags('inventory-unit-conversions')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'inventory/unit-conversions', version: '1' })
export class UnitConversionsController {
  constructor(
    private readonly unitConversions: UnitConversionsService,
  ) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(UNIT_CONVERSION_PERMISSIONS.VIEW)
  @ApiOperation({
    summary:
      'List conversion versions of one scope (`global`, or one item with `itemId`). Historical versions are included.',
  })
  @ApiExtraModels(PaginatedUnitConversionDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedUnitConversionDto) }] },
  })
  async list(
    @Query() query: ListUnitConversionsQueryDto,
  ): Promise<{
    items: UnitConversionResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.unitConversions.listConversions(query);
  }

  /**
   * Declared before `:id` on purpose: otherwise `resolve` would be captured by
   * the id route and fail as a malformed identifier.
   */
  @Get('resolve')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(UNIT_CONVERSION_PERMISSIONS.VIEW)
  @ApiOperation({
    summary:
      'Resolve the conversion version in force at an instant: item-specific first, then global.',
  })
  @ApiOkResponse({ type: ResolveUnitConversionResponseDto })
  async resolve(
    @Query() query: ResolveUnitConversionQueryDto,
  ): Promise<ResolveUnitConversionResponseDto> {
    const conversion = await this.unitConversions.resolveConversion({
      organizationId: query.organizationId,
      itemId: query.itemId ?? null,
      fromUnitId: query.fromUnitId,
      toUnitId: query.toUnitId,
      asOf: query.asOf,
    });
    return { conversion };
  }

  @Get(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(UNIT_CONVERSION_PERMISSIONS.VIEW)
  @ApiOperation({
    summary: 'Get one conversion version, including a superseded one.',
  })
  @ApiOkResponse({ type: UnitConversionResponseDto })
  @ApiNotFoundResponse({ description: 'Conversion version does not exist.' })
  async get(@Param('id') id: string): Promise<UnitConversionResponseDto> {
    return this.unitConversions.getConversion(id);
  }

  @Post()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(UNIT_CONVERSION_PERMISSIONS.CREATE)
  @ApiOperation({
    summary:
      'Create a new conversion version. An open-ended version supersedes the previous open-ended one for the same unit pair.',
  })
  @ApiCreatedResponse({ type: UnitConversionResponseDto })
  @ApiConflictResponse({
    description:
      'A version already exists for this unit pair covering part of the requested validity window.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'Invalid factor (non-positive, more than 6 decimal places), `validTo` before `validFrom`, or a unit that belongs to another organization.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async create(
    @Body() body: CreateUnitConversionDto,
  ): Promise<UnitConversionResponseDto> {
    return this.unitConversions.createConversion({
      organizationId: body.organizationId,
      itemId: body.itemId ?? null,
      fromUnitId: body.fromUnitId,
      toUnitId: body.toUnitId,
      factor: body.factor,
      validFrom: body.validFrom,
      validTo: body.validTo,
    });
  }
}
