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
import { FiscalYearsService } from '../application/fiscal-years.service.js';
import { FISCAL_YEAR_PERMISSIONS } from '../domain/accounting-permissions.js';
import { AccountingScopeQueryDto } from './dto/accounting-scope.dto.js';
import {
  CreateFiscalYearDto,
  FiscalYearResponseDto,
  ListFiscalYearsQueryDto,
  TransitionFiscalYearDto,
  UpdateFiscalYearDto,
} from './dto/fiscal-year.dto.js';

const PaginatedFiscalYearDto = paginatedResponseOf(FiscalYearResponseDto);

/**
 * Fiscal year administration (contract §6, ADR-0026).
 *
 * Transport-only (AR-03). The list requires `organizationId`, so no
 * endpoint ever returns years across organizations. Lifecycle moves
 * (`close`, `reopen`, `seal`, `unseal`) are separate endpoints with
 * separate permissions and a mandatory reason each (contract §6.3/§6.6).
 */
@ApiTags('fiscal-years')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'fiscal-years', version: '1' })
export class FiscalYearsController {
  constructor(private readonly years: FiscalYearsService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(FISCAL_YEAR_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'List the fiscal years of one organization.' })
  @ApiExtraModels(PaginatedFiscalYearDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedFiscalYearDto) }] },
  })
  async list(@Query() query: ListFiscalYearsQueryDto): Promise<{
    items: FiscalYearResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.years.listFiscalYears(query);
  }

  @Get(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(FISCAL_YEAR_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'Get one fiscal year.' })
  @ApiOkResponse({ type: FiscalYearResponseDto })
  @ApiNotFoundResponse({ description: 'Fiscal year does not exist.' })
  async get(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
  ): Promise<FiscalYearResponseDto> {
    return this.years.getFiscalYear(scope.organizationId, id);
  }

  @Post()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(FISCAL_YEAR_PERMISSIONS.CREATE)
  @ApiOperation({ summary: 'Create a fiscal year in a financial area.' })
  @ApiCreatedResponse({ type: FiscalYearResponseDto })
  @ApiConflictResponse({
    description: 'Fiscal year code already exists in this financial area.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async create(
    @Body() body: CreateFiscalYearDto,
  ): Promise<FiscalYearResponseDto> {
    return this.years.createFiscalYear({
      organizationId: body.organizationId,
      financialAreaId: body.financialAreaId,
      code: body.code,
      title: body.title,
      startDate: body.startDate,
      endDate: body.endDate,
      priorYearId: body.priorYearId,
    });
  }

  @Patch(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(FISCAL_YEAR_PERMISSIONS.EDIT)
  @ApiOperation({
    summary: 'Edit a fiscal year. Date changes require an open year.',
  })
  @ApiOkResponse({ type: FiscalYearResponseDto })
  @ApiNotFoundResponse({ description: 'Fiscal year does not exist.' })
  @ApiConflictResponse({
    description: 'Fiscal year code already exists in this financial area.',
  })
  async update(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
    @Body() body: UpdateFiscalYearDto,
  ): Promise<FiscalYearResponseDto> {
    return this.years.updateFiscalYear(scope.organizationId, id, {
      code: body.code,
      title: body.title,
      startDate: body.startDate,
      endDate: body.endDate,
      isActive: body.isActive,
      priorYearId: body.priorYearId,
    });
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(FISCAL_YEAR_PERMISSIONS.CLOSE)
  @ApiOperation({
    summary:
      'Close an open fiscal year. Also closes its open periods in the same transaction.',
  })
  @ApiOkResponse({ type: FiscalYearResponseDto })
  @ApiNotFoundResponse({ description: 'Fiscal year does not exist.' })
  @ApiConflictResponse({
    description: 'The fiscal year moved while the request was in flight.',
  })
  async close(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
    @Body() body: TransitionFiscalYearDto,
  ): Promise<FiscalYearResponseDto> {
    return this.years.transitionFiscalYear({
      organizationId: scope.organizationId,
      id,
      transition: 'close',
      reason: body.reason,
    });
  }

  @Post(':id/reopen')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(FISCAL_YEAR_PERMISSIONS.REOPEN)
  @ApiOperation({ summary: 'Reopen a closed fiscal year.' })
  @ApiOkResponse({ type: FiscalYearResponseDto })
  @ApiNotFoundResponse({ description: 'Fiscal year does not exist.' })
  @ApiConflictResponse({
    description: 'The fiscal year moved while the request was in flight.',
  })
  async reopen(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
    @Body() body: TransitionFiscalYearDto,
  ): Promise<FiscalYearResponseDto> {
    return this.years.transitionFiscalYear({
      organizationId: scope.organizationId,
      id,
      transition: 'reopen',
      reason: body.reason,
    });
  }

  @Post(':id/seal')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(FISCAL_YEAR_PERMISSIONS.SEAL)
  @ApiOperation({
    summary:
      'Seal a closed fiscal year. Refused while the year has an open period.',
  })
  @ApiOkResponse({ type: FiscalYearResponseDto })
  @ApiNotFoundResponse({ description: 'Fiscal year does not exist.' })
  @ApiConflictResponse({
    description: 'The fiscal year moved while the request was in flight.',
  })
  async seal(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
    @Body() body: TransitionFiscalYearDto,
  ): Promise<FiscalYearResponseDto> {
    return this.years.transitionFiscalYear({
      organizationId: scope.organizationId,
      id,
      transition: 'seal',
      reason: body.reason,
    });
  }

  @Post(':id/unseal')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(FISCAL_YEAR_PERMISSIONS.UNSEAL)
  @ApiOperation({
    summary: 'Unseal a sealed fiscal year back to closed.',
  })
  @ApiOkResponse({ type: FiscalYearResponseDto })
  @ApiNotFoundResponse({ description: 'Fiscal year does not exist.' })
  @ApiConflictResponse({
    description: 'The fiscal year moved while the request was in flight.',
  })
  async unseal(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
    @Body() body: TransitionFiscalYearDto,
  ): Promise<FiscalYearResponseDto> {
    return this.years.transitionFiscalYear({
      organizationId: scope.organizationId,
      id,
      transition: 'unseal',
      reason: body.reason,
    });
  }
}
