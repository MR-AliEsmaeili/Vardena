import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
  getSchemaPath,
} from '@nestjs/swagger';
import { paginatedResponseOf } from '../../../kernel/pagination/paginated-result.js';
import { AuthGuard } from '../../identity/application/auth.guard.js';
import { AuthorizationGuard } from '../../rbac/application/authorization.guard.js';
import { RequirePermission } from '../../rbac/application/require-permission.decorator.js';
import { WorkflowVersionsService } from '../application/workflow-versions.service.js';
import { WORKFLOW_VERSION_PERMISSIONS } from '../domain/workflow-permissions.js';
import {
  CreateWorkflowVersionDto,
  ListWorkflowVersionsQueryDto,
  WorkflowVersionQueryDto,
  WorkflowVersionResponseDto,
} from './dto/workflow-version.dto.js';

const PaginatedWorkflowVersionDto = paginatedResponseOf(
  WorkflowVersionResponseDto,
);

/**
 * Workflow version administration (Task 9 §6/§22/§23).
 *
 * Transport-only (AR-03). Versions are created as drafts and published
 * exactly once after deterministic validation; there is no update
 * endpoint — active and superseded versions are immutable, and behaviour
 * changes ship as a NEW version, never as an edit.
 */
@ApiTags('workflow-versions')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'workflow', version: '1' })
export class WorkflowVersionsController {
  constructor(private readonly versions: WorkflowVersionsService) {}

  @Get('definitions/:definitionId/versions')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(WORKFLOW_VERSION_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'List the versions of one workflow definition.' })
  @ApiExtraModels(PaginatedWorkflowVersionDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedWorkflowVersionDto) }] },
  })
  @ApiNotFoundResponse({ description: 'Workflow definition does not exist.' })
  async list(
    @Param('definitionId') definitionId: string,
    @Query() query: ListWorkflowVersionsQueryDto,
  ): Promise<{
    items: WorkflowVersionResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.versions.listVersions({
      organizationId: query.organizationId,
      definitionId,
      page: query.page,
      pageSize: query.pageSize,
      status: query.status,
      sort: query.sort,
    });
  }

  @Get('versions/:id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(WORKFLOW_VERSION_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'Get one workflow version.' })
  @ApiOkResponse({ type: WorkflowVersionResponseDto })
  @ApiNotFoundResponse({ description: 'Workflow version does not exist.' })
  async get(
    @Param('id') id: string,
    @Query() query: WorkflowVersionQueryDto,
  ): Promise<WorkflowVersionResponseDto> {
    return this.versions.getVersion(query.organizationId, id);
  }

  @Post('definitions/:definitionId/versions')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(WORKFLOW_VERSION_PERMISSIONS.CREATE)
  @ApiOperation({ summary: 'Create a draft workflow version.' })
  @ApiCreatedResponse({ type: WorkflowVersionResponseDto })
  @ApiNotFoundResponse({ description: 'Workflow definition does not exist.' })
  @ApiConflictResponse({
    description: 'A version was created concurrently; retry the request.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async create(
    @Param('definitionId') definitionId: string,
    @Query() query: WorkflowVersionQueryDto,
    @Body() body: CreateWorkflowVersionDto,
  ): Promise<WorkflowVersionResponseDto> {
    return this.versions.createVersion({
      organizationId: query.organizationId,
      definitionId,
      effectiveFrom: body.effectiveFrom,
    });
  }

  @Post('versions/:id/publish')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(WORKFLOW_VERSION_PERMISSIONS.PUBLISH)
  @ApiOperation({
    summary:
      'Validate and publish a draft workflow version, superseding the previously active version.',
  })
  @ApiOkResponse({ type: WorkflowVersionResponseDto })
  @ApiNotFoundResponse({ description: 'Workflow version does not exist.' })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async publish(
    @Param('id') id: string,
    @Query() query: WorkflowVersionQueryDto,
  ): Promise<WorkflowVersionResponseDto> {
    return this.versions.publishVersion(query.organizationId, id);
  }
}
