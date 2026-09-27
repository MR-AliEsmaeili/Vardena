import {
  Body,
  Controller,
  Get,
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
import { BaseChartTemplatesService } from '../application/base-chart-templates.service.js';
import { BASE_CHART_PERMISSIONS } from '../domain/accounting-permissions.js';
import {
  BaseChartTemplateResponseDto,
  BaseChartTemplateVersionResponseDto,
  CreateBaseChartTemplateDto,
  ListBaseChartTemplatesQueryDto,
  RenameBaseChartTemplateDto,
} from './dto/base-chart.dto.js';

const PaginatedTemplateDto = paginatedResponseOf(BaseChartTemplateResponseDto);

/**
 * Base Chart template lifecycle (Task 23, task §17/§19).
 *
 * Transport-only (AR-03): every guard (draft-only editing, one-way
 * transitions, content shape, publish re-validation) is decided in the
 * application service and re-decided under the repositories' row locks.
 *
 * The store is a PRODUCT asset: these endpoints are deliberately NOT
 * organization-scoped. Permission enforcement is therefore of the standard
 * deployment-pin kind (\`Accounting.BaseChart.*\` codes, ADR-0025), never of
 * the tenant-chain kind — exactly the posture the RBAC permission
 * registration already sets for tenant-neutral product data. There is no
 * wildcards/admin bypass (OQ-21), and no DELETE endpoint exists anywhere in
 * the lifecycle (versions retire by supersession; drafts that must die are
 * kept as drafts — template history is product audit).
 */
@ApiTags('accounting-base-chart')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'base-chart-templates', version: '1' })
export class BaseChartTemplatesController {
  constructor(private readonly templates: BaseChartTemplatesService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(BASE_CHART_PERMISSIONS.VIEW)
  @ApiOperation({
    summary: 'List base chart templates (the product-delivered charts).',
  })
  @ApiExtraModels(PaginatedTemplateDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedTemplateDto) }] },
  })
  async list(@Query() query: ListBaseChartTemplatesQueryDto): Promise<{
    items: BaseChartTemplateResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.templates.listTemplates(query);
  }

  @Post()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(BASE_CHART_PERMISSIONS.CONFIGURE)
  @ApiOperation({
    summary:
      'Create a base chart template with version 1 as a DRAFT (full content supplied; validated before anything is stored).',
  })
  @ApiCreatedResponse({ type: BaseChartTemplateResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  @ApiConflictResponse({
    description: 'A template with that code already exists.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'The version content violates a template shape invariant (level shape, node keys/parents/cycles, code shape, postable parent, depth).',
  })
  async create(@Body() body: CreateBaseChartTemplateDto): Promise<{
    template: BaseChartTemplateResponseDto;
    versions: BaseChartTemplateVersionResponseDto[];
  }> {
    return this.templates.createTemplate({
      code: body.code,
      title: body.title,
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
  @ApiOperation({ summary: 'Get one template with all its versions.' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        template: { $ref: getSchemaPath(BaseChartTemplateResponseDto) },
        versions: {
          type: 'array',
          items: { $ref: getSchemaPath(BaseChartTemplateVersionResponseDto) },
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Template does not exist.' })
  async get(@Param('id') id: string): Promise<{
    template: BaseChartTemplateResponseDto;
    versions: BaseChartTemplateVersionResponseDto[];
  }> {
    return this.templates.getTemplate(id);
  }

  @Patch(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(BASE_CHART_PERMISSIONS.CONFIGURE)
  @ApiOperation({
    summary:
      'Rename a base chart template (title only — identity and code are stable).',
  })
  @ApiOkResponse({ type: BaseChartTemplateResponseDto })
  @ApiNotFoundResponse({ description: 'Template does not exist.' })
  async rename(
    @Param('id') id: string,
    @Body() body: RenameBaseChartTemplateDto,
  ): Promise<BaseChartTemplateResponseDto> {
    return this.templates.renameTemplate(id, body.title);
  }
}
