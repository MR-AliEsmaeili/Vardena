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
import { FinancialAreasService } from '../application/financial-areas.service.js';
import { FINANCIAL_AREA_PERMISSIONS } from '../domain/accounting-permissions.js';
import { AccountingScopeQueryDto } from './dto/accounting-scope.dto.js';
import {
  CreateFinancialAreaDto,
  FinancialAreaResponseDto,
  ListFinancialAreasQueryDto,
  UpdateFinancialAreaDto,
} from './dto/financial-area.dto.js';

const PaginatedFinancialAreaDto = paginatedResponseOf(FinancialAreaResponseDto);

/**
 * Financial area administration (contract §5, ADR-0026).
 *
 * Transport-only (AR-03). The list requires `organizationId`, so no
 * endpoint ever returns areas across organizations. An area is a
 * bookkeeping scope — not an organization, branch, department or company —
 * and disabling one blocks new fiscal years in it while history stays
 * readable (contract §5.6).
 */
@ApiTags('financial-areas')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'financial-areas', version: '1' })
export class FinancialAreasController {
  constructor(private readonly areas: FinancialAreasService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(FINANCIAL_AREA_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'List the financial areas of one organization.' })
  @ApiExtraModels(PaginatedFinancialAreaDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedFinancialAreaDto) }] },
  })
  @ApiNotFoundResponse({
    description: 'Organization does not exist or is outside the caller scope.',
  })
  async list(@Query() query: ListFinancialAreasQueryDto): Promise<{
    items: FinancialAreaResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.areas.listFinancialAreas(query);
  }

  @Get(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(FINANCIAL_AREA_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'Get one financial area.' })
  @ApiOkResponse({ type: FinancialAreaResponseDto })
  @ApiNotFoundResponse({ description: 'Financial area does not exist.' })
  async get(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
  ): Promise<FinancialAreaResponseDto> {
    return this.areas.getFinancialArea(scope.organizationId, id);
  }

  @Post()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(FINANCIAL_AREA_PERMISSIONS.CREATE)
  @ApiOperation({ summary: 'Create a financial area in an organization.' })
  @ApiCreatedResponse({ type: FinancialAreaResponseDto })
  @ApiConflictResponse({
    description: 'Financial area code already exists in this organization.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async create(
    @Body() body: CreateFinancialAreaDto,
  ): Promise<FinancialAreaResponseDto> {
    return this.areas.createFinancialArea({
      organizationId: body.organizationId,
      code: body.code,
      title: body.title,
    });
  }

  @Patch(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(FINANCIAL_AREA_PERMISSIONS.EDIT)
  @ApiOperation({ summary: 'Edit a financial area.' })
  @ApiOkResponse({ type: FinancialAreaResponseDto })
  @ApiNotFoundResponse({ description: 'Financial area does not exist.' })
  @ApiConflictResponse({
    description: 'Financial area code already exists in this organization.',
  })
  async update(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
    @Body() body: UpdateFinancialAreaDto,
  ): Promise<FinancialAreaResponseDto> {
    return this.areas.updateFinancialArea(scope.organizationId, id, {
      code: body.code,
      title: body.title,
      isDefault: body.isDefault,
    });
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(FINANCIAL_AREA_PERMISSIONS.ENABLE)
  @ApiOperation({ summary: 'Enable a disabled financial area.' })
  @ApiOkResponse({ type: FinancialAreaResponseDto })
  @ApiNotFoundResponse({ description: 'Financial area does not exist.' })
  async enable(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
  ): Promise<FinancialAreaResponseDto> {
    return this.areas.enableFinancialArea(scope.organizationId, id);
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(FINANCIAL_AREA_PERMISSIONS.DISABLE)
  @ApiOperation({
    summary:
      'Disable a financial area (blocks new fiscal years in it, keeps history readable). Refused while the area has an open fiscal year.',
  })
  @ApiOkResponse({ type: FinancialAreaResponseDto })
  @ApiNotFoundResponse({ description: 'Financial area does not exist.' })
  async disable(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
  ): Promise<FinancialAreaResponseDto> {
    return this.areas.disableFinancialArea(scope.organizationId, id);
  }
}
