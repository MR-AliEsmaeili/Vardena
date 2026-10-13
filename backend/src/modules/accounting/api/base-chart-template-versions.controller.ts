import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
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
import { BaseChartTemplatesService } from '../application/base-chart-templates.service.js';
import { BASE_CHART_PERMISSIONS } from '../domain/accounting-permissions.js';
import {
  BaseChartTemplateVersionResponseDto,
  CreateBaseChartVersionDto,
  ListBaseChartVersionsQueryDto,
  TransitionBaseChartVersionDto,
  UpdateBaseChartVersionContentDto,
} from './dto/base-chart.dto.js';

const PaginatedVersionDto = paginatedResponseOf(
  BaseChartTemplateVersionResponseDto,
);

/**
 * Base Chart template versions (Task 23, task §17/§19): the authoring and
 * lifecycle surface of the product asset.
 *
 * One-way lifecycle — `draft → approved → published → superseded` — with no
 * reverse edges and no DELETE endpoint anywhere (published/superseded
 * versions are immutable; a draft that must die is simply never approved).
 * Every transition re-asserts its precondition UNDER the template-wide row
 * lock in the repository (see `data/base-chart-templates.repository.ts`), so
 * the HTTP shape can never out-run the lifecycle state machine.
 */
@ApiTags('accounting-base-chart')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'base-chart-template-versions', version: '1' })
export class BaseChartTemplateVersionsController {
  constructor(private readonly templates: BaseChartTemplatesService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(BASE_CHART_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'List the versions of one template.' })
  @ApiExtraModels(PaginatedVersionDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedVersionDto) }] },
  })
  async list(@Query() query: ListBaseChartVersionsQueryDto): Promise<{
    items: BaseChartTemplateVersionResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.templates.listVersions(query);
  }

  @Post()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(BASE_CHART_PERMISSIONS.CONFIGURE)
  @ApiOperation({
    summary:
      'Create the NEXT draft version of a template (full content supplied; the version number is assigned server-side).',
  })
  @ApiCreatedResponse({ type: BaseChartTemplateVersionResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  @ApiNotFoundResponse({ description: 'Template does not exist.' })
  @ApiConflictResponse({
    description:
      'Two draft versions were created concurrently (retry the request).',
  })
  @ApiUnprocessableEntityResponse({
    description: 'The version content violates a template shape invariant.',
  })
  async create(
    @Body() body: CreateBaseChartVersionDto,
  ): Promise<BaseChartTemplateVersionResponseDto> {
    return this.templates.createVersion({
      templateId: body.templateId,
      maxDepth: body.maxDepth,
      levels: body.levels.map((level) => ({
        levelIndex: level.levelIndex,
        digitLength: level.digitLength,
        defaultIsPostable: level.defaultIsPostable ?? true,
      })),
      nodes: body.nodes.map((node) => ({
        nodeKey: node.nodeKey,
        parentNodeKey: node.parentNodeKey ?? null,
        code: node.code,
        title: node.title,
        accountNature: node.accountNature,
        isPostable: node.isPostable,
        isMandatory: node.isMandatory ?? false,
        defaultIsActive: node.defaultIsActive ?? true,
      })),
    });
  }

  @Get(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(BASE_CHART_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'Get one base chart template version.' })
  @ApiOkResponse({ type: BaseChartTemplateVersionResponseDto })
  @ApiNotFoundResponse({ description: 'Template version does not exist.' })
  async get(
    @Param('id') id: string,
  ): Promise<BaseChartTemplateVersionResponseDto> {
    return this.templates.getVersion(id);
  }

  @Put(':id/content')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(BASE_CHART_PERMISSIONS.CONFIGURE)
  @ApiOperation({
    summary:
      'Replace a DRAFT version’s content (depth, levels and/or node tree; omitted fields keep the stored rows).',
  })
  @ApiOkResponse({ type: BaseChartTemplateVersionResponseDto })
  @ApiNotFoundResponse({ description: 'Template version does not exist.' })
  @ApiUnprocessableEntityResponse({
    description:
      'The version is no longer a draft, or the resulting content violates a template shape invariant.',
  })
  async updateDraftContent(
    @Param('id') id: string,
    @Body() body: UpdateBaseChartVersionContentDto,
  ): Promise<BaseChartTemplateVersionResponseDto> {
    return this.templates.updateVersionContent(id, {
      maxDepth: body.maxDepth,
      levels: body.levels?.map((level) => ({
        levelIndex: level.levelIndex,
        digitLength: level.digitLength,
        defaultIsPostable: level.defaultIsPostable ?? true,
      })),
      nodes: body.nodes?.map((node) => ({
        nodeKey: node.nodeKey,
        parentNodeKey: node.parentNodeKey ?? null,
        code: node.code,
        title: node.title,
        accountNature: node.accountNature,
        isPostable: node.isPostable,
        isMandatory: node.isMandatory ?? false,
        defaultIsActive: node.defaultIsActive ?? true,
      })),
    });
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(BASE_CHART_PERMISSIONS.CONFIGURE)
  @ApiOperation({ summary: 'Approve a DRAFT version (one-way).' })
  @ApiOkResponse({ type: BaseChartTemplateVersionResponseDto })
  @ApiNotFoundResponse({ description: 'Template version does not exist.' })
  @ApiUnprocessableEntityResponse({
    description: 'The version is not a draft.',
  })
  async approve(
    @Param('id') id: string,
  ): Promise<BaseChartTemplateVersionResponseDto> {
    return this.templates.approve(id);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(BASE_CHART_PERMISSIONS.CONFIGURE)
  @ApiOperation({
    summary:
      'Publish an APPROVED version (re-validates content under the template-wide lock; supersedes the previously published version if any).',
  })
  @ApiOkResponse({ type: BaseChartTemplateVersionResponseDto })
  @ApiNotFoundResponse({ description: 'Template version does not exist.' })
  @ApiUnprocessableEntityResponse({
    description:
      'The version is not approved, or its stored content failed publish re-validation.',
  })
  async publish(
    @Param('id') id: string,
  ): Promise<BaseChartTemplateVersionResponseDto> {
    return this.templates.publish(id);
  }

  @Post(':id/supersede')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(BASE_CHART_PERMISSIONS.CONFIGURE)
  @ApiOperation({
    summary:
      'Supersede a PUBLISHED version WITHOUT a replacement (retirement; the replacement linkage is recorded when known).',
  })
  @ApiOkResponse({ type: BaseChartTemplateVersionResponseDto })
  @ApiNotFoundResponse({ description: 'Template version does not exist.' })
  @ApiUnprocessableEntityResponse({
    description:
      'The version is not published (or the replacement is invalid).',
  })
  async supersede(
    @Param('id') id: string,
    @Body() body: TransitionBaseChartVersionDto,
  ): Promise<BaseChartTemplateVersionResponseDto> {
    return this.templates.supersede(id, body.supersededByVersionId ?? null);
  }
}
