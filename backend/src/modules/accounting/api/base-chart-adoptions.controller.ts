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
import { BaseChartAdoptionsService } from '../application/base-chart-adoptions.service.js';
import { BASE_CHART_PERMISSIONS } from '../domain/accounting-permissions.js';
import { AccountingScopeQueryDto } from './dto/accounting-scope.dto.js';
import {
  AdoptBaseChartDto,
  BaseChartAdoptionPreviewResponseDto,
  BaseChartAdoptionResponseDto,
  ListBaseChartAdoptionsQueryDto,
} from './dto/base-chart.dto.js';

const PaginatedAdoptionDto = paginatedResponseOf(BaseChartAdoptionResponseDto);

/**
 * Explicit Base Chart adoption (Task 23, task §18/§19/§20).
 *
 * Transport-only (AR-03). Organization scoping, the PUBLISHED gate,
 * compatibility, ancestor-closure + mandatory-inclusion, the non-empty-chart
 * refusal and the deterministic duplicate conflict all live in the
 * application service and are re-decided UNDER locks inside the guarded
 * write transaction.
 *
 * The DTO deliberately separates the organization's identity (scope) from
 * the request: a cross-organization adoption id answers 404, a missing
 * organization is 404, a disabled one 422 (the Organization boundary), and a
 * repeated adoption of the same published version is a DETERMINISTIC 409 —
 * never a duplicate chart and never a silent no-op. There is no merge,
 * upsert or overwrite path, by design (task §20).
 */
@ApiTags('accounting-base-chart')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'accounting', version: '1' })
export class BaseChartAdoptionsController {
  constructor(private readonly adoptions: BaseChartAdoptionsService) {}

  @Post('adopt-base-chart')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(BASE_CHART_PERMISSIONS.ADOPT)
  @ApiOperation({
    summary:
      'Adopt a PUBLISHED base chart version: materialize its nodes as organization-owned accounts (snapshot copy), pinned to the organization’s active configuration. Atomic — a failed adoption writes nothing.',
  })
  @ApiCreatedResponse({ type: BaseChartAdoptionResponseDto })
  @ApiNotFoundResponse({
    description:
      'Organization, template version or other addressed entity does not exist.',
  })
  @ApiConflictResponse({
    description:
      'Deterministic refusal: already adopted (idempotency), or the organization’s chart is not empty (no merge/overwrite).',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'Not published, missing/incoherent active pins, template ↔ organization incompatibility, or an invalid selection (ancestor-closure / mandatory-inclusion / unknown keys).',
  })
  async adopt(
    @Body() body: AdoptBaseChartDto,
  ): Promise<BaseChartAdoptionResponseDto> {
    return this.adoptions.adopt({
      organizationId: body.organizationId,
      templateVersionId: body.templateVersionId,
      selectedNodeKeys: body.selectedNodeKeys ?? null,
    });
  }

  @Post('adopt-base-chart/preview')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(BASE_CHART_PERMISSIONS.ADOPT)
  @ApiOperation({
    summary:
      'Read-only evaluation of an adoption request (R8): compatibility verdict + the FINAL adoption set (requested ∪ ancestors ∪ mandatory) — never writes anything.',
  })
  @ApiOkResponse({ type: BaseChartAdoptionPreviewResponseDto })
  async preview(
    @Body() body: AdoptBaseChartDto,
  ): Promise<BaseChartAdoptionPreviewResponseDto> {
    return this.adoptions.preview({
      organizationId: body.organizationId,
      templateVersionId: body.templateVersionId,
      selectedNodeKeys: body.selectedNodeKeys ?? null,
    });
  }

  @Get('base-chart-adoptions')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(BASE_CHART_PERMISSIONS.VIEW)
  @ApiOperation({
    summary: 'List the base chart adoptions of one organization.',
  })
  @ApiExtraModels(PaginatedAdoptionDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedAdoptionDto) }] },
  })
  async list(@Query() query: ListBaseChartAdoptionsQueryDto): Promise<{
    items: BaseChartAdoptionResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.adoptions.listAdoptions(
      query.organizationId,
      query.page,
      query.pageSize,
    );
  }

  @Get('base-chart-adoptions/:id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(BASE_CHART_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'Get one base chart adoption.' })
  @ApiOkResponse({ type: BaseChartAdoptionResponseDto })
  @ApiNotFoundResponse({
    description: 'Adoption does not exist (or is not of this organization).',
  })
  async get(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
  ): Promise<BaseChartAdoptionResponseDto> {
    return this.adoptions.getAdoption(scope.organizationId, id);
  }
}
