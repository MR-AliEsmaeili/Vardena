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
import { NumberingSeriesService } from '../application/numbering-series.service.js';
import { NumberingService } from '../application/numbering.service.js';
import {
  NUMBERING_PERMISSIONS,
  NUMBERING_SERIES_PERMISSIONS,
} from '../domain/document-permissions.js';
import {
  CreateNumberingSeriesDto,
  ListNumberingAllocationsQueryDto,
  ListNumberingSeriesQueryDto,
  NumberingAllocationResponseDto,
  NumberingSeriesResponseDto,
  UpdateNumberingSeriesDto,
} from './dto/numbering.dto.js';

const PaginatedNumberingSeriesDto = paginatedResponseOf(
  NumberingSeriesResponseDto,
);
const PaginatedNumberingAllocationDto = paginatedResponseOf(
  NumberingAllocationResponseDto,
);

/**
 * Numbering series configuration + the read-only numbering ledger
 * (Task 8 §11/§20).
 *
 * Series are configured here; allocations are inspected here. There is no
 * HTTP "allocate" endpoint — allocation is a module-internal service call made
 * inside the owning module's document transaction.
 */
@ApiTags('documents')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'documents/numbering-series', version: '1' })
export class NumberingSeriesController {
  constructor(
    private readonly series: NumberingSeriesService,
    private readonly numbering: NumberingService,
  ) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(NUMBERING_SERIES_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'List the numbering series of one organization.' })
  @ApiExtraModels(PaginatedNumberingSeriesDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedNumberingSeriesDto) }] },
  })
  async list(@Query() query: ListNumberingSeriesQueryDto): Promise<{
    items: NumberingSeriesResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.series.listNumberingSeries(query);
  }

  @Post()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(NUMBERING_SERIES_PERMISSIONS.CREATE)
  @ApiOperation({
    summary: 'Create a numbering series for a registered document type.',
  })
  @ApiCreatedResponse({ type: NumberingSeriesResponseDto })
  @ApiConflictResponse({
    description:
      'A series already exists for this organization, type and scope.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async create(
    @Body() body: CreateNumberingSeriesDto,
  ): Promise<NumberingSeriesResponseDto> {
    return this.series.createNumberingSeries({
      organizationId: body.organizationId,
      documentType: body.documentType,
      scopeKey: body.scopeKey,
      name: body.name,
      strategy: body.strategy,
      width: body.width,
      reusePolicy: body.reusePolicy,
    });
  }

  @Get(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(NUMBERING_SERIES_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'Get one numbering series.' })
  @ApiOkResponse({ type: NumberingSeriesResponseDto })
  @ApiNotFoundResponse({ description: 'Numbering series does not exist.' })
  async get(@Param('id') id: string): Promise<NumberingSeriesResponseDto> {
    return this.series.getNumberingSeries(id);
  }

  @Patch(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(NUMBERING_SERIES_PERMISSIONS.EDIT)
  @ApiOperation({
    summary:
      'Edit a numbering series (name, width, strategy, reuse policy, active state). The counter is never editable.',
  })
  @ApiOkResponse({ type: NumberingSeriesResponseDto })
  @ApiNotFoundResponse({ description: 'Numbering series does not exist.' })
  async update(
    @Param('id') id: string,
    @Body() body: UpdateNumberingSeriesDto,
  ): Promise<NumberingSeriesResponseDto> {
    return this.series.updateNumberingSeries(id, {
      name: body.name,
      strategy: body.strategy,
      width: body.width,
      reusePolicy: body.reusePolicy,
      isActive: body.isActive,
    });
  }

  @Get(':id/allocations')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(NUMBERING_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'Inspect the numbers allocated from one series.' })
  @ApiExtraModels(PaginatedNumberingAllocationDto)
  @ApiOkResponse({
    schema: {
      allOf: [{ $ref: getSchemaPath(PaginatedNumberingAllocationDto) }],
    },
  })
  @ApiNotFoundResponse({ description: 'Numbering series does not exist.' })
  async allocations(
    @Param('id') id: string,
    @Query() query: ListNumberingAllocationsQueryDto,
  ): Promise<{
    items: NumberingAllocationResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    // Resolve the series first so an unknown series is a 404 (not an empty list).
    await this.series.getNumberingSeries(id);
    return this.numbering.listAllocations({ ...query, seriesId: id });
  }
}
