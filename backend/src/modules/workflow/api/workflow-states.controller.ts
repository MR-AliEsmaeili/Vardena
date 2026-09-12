import {
  Body,
  Controller,
  Delete,
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
import { WorkflowStatesService } from '../application/workflow-states.service.js';
import { WORKFLOW_VERSION_PERMISSIONS } from '../domain/workflow-permissions.js';
import {
  CreateWorkflowStateDto,
  ListWorkflowStatesQueryDto,
  UpdateWorkflowStateDto,
  WorkflowStateQueryDto,
  WorkflowStateResponseDto,
} from './dto/workflow-state.dto.js';

const PaginatedWorkflowStateDto = paginatedResponseOf(WorkflowStateResponseDto);

/**
 * Workflow state configuration (Task 9 §7/§22).
 *
 * Transport-only (AR-03). States are configured inside DRAFT versions
 * only — writes to active or superseded versions are rejected, codes are
 * immutable after creation, and a state referenced by any transition
 * cannot be deleted.
 */
@ApiTags('workflow-states')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'workflow', version: '1' })
export class WorkflowStatesController {
  constructor(private readonly states: WorkflowStatesService) {}

  @Get('versions/:versionId/states')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(WORKFLOW_VERSION_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'List the states of one workflow version.' })
  @ApiExtraModels(PaginatedWorkflowStateDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedWorkflowStateDto) }] },
  })
  @ApiNotFoundResponse({ description: 'Workflow version does not exist.' })
  async list(
    @Param('versionId') versionId: string,
    @Query() query: ListWorkflowStatesQueryDto,
  ): Promise<{
    items: WorkflowStateResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.states.listStates({
      organizationId: query.organizationId,
      versionId,
      page: query.page,
      pageSize: query.pageSize,
      sort: query.sort,
    });
  }

  @Get('states/:id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(WORKFLOW_VERSION_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'Get one workflow state.' })
  @ApiOkResponse({ type: WorkflowStateResponseDto })
  @ApiNotFoundResponse({ description: 'Workflow state does not exist.' })
  async get(
    @Param('id') id: string,
    @Query() query: WorkflowStateQueryDto,
  ): Promise<WorkflowStateResponseDto> {
    return this.states.getState(query.organizationId, id);
  }

  @Post('versions/:versionId/states')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(WORKFLOW_VERSION_PERMISSIONS.EDIT)
  @ApiOperation({ summary: 'Create a state in a draft workflow version.' })
  @ApiCreatedResponse({ type: WorkflowStateResponseDto })
  @ApiNotFoundResponse({ description: 'Workflow version does not exist.' })
  @ApiConflictResponse({
    description: 'State code already exists in this version.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async create(
    @Param('versionId') versionId: string,
    @Query() query: WorkflowStateQueryDto,
    @Body() body: CreateWorkflowStateDto,
  ): Promise<WorkflowStateResponseDto> {
    return this.states.createState({
      organizationId: query.organizationId,
      versionId,
      code: body.code,
      name: body.name,
      description: body.description,
      isInitial: body.isInitial,
      isTerminal: body.isTerminal,
      isActive: body.isActive,
      sortOrder: body.sortOrder,
    });
  }

  @Patch('states/:id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(WORKFLOW_VERSION_PERMISSIONS.EDIT)
  @ApiOperation({ summary: 'Edit a state of a draft workflow version.' })
  @ApiOkResponse({ type: WorkflowStateResponseDto })
  @ApiNotFoundResponse({ description: 'Workflow state does not exist.' })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async update(
    @Param('id') id: string,
    @Query() query: WorkflowStateQueryDto,
    @Body() body: UpdateWorkflowStateDto,
  ): Promise<WorkflowStateResponseDto> {
    return this.states.updateState(query.organizationId, id, {
      name: body.name,
      description: body.description,
      isInitial: body.isInitial,
      isTerminal: body.isTerminal,
      isActive: body.isActive,
      sortOrder: body.sortOrder,
    });
  }

  @Delete('states/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(WORKFLOW_VERSION_PERMISSIONS.EDIT)
  @ApiOperation({
    summary:
      'Delete a state of a draft workflow version. States referenced by a transition cannot be deleted.',
  })
  @ApiOkResponse({ description: 'Deleted.' })
  @ApiNotFoundResponse({ description: 'Workflow state does not exist.' })
  async remove(
    @Param('id') id: string,
    @Query() query: WorkflowStateQueryDto,
  ): Promise<void> {
    await this.states.deleteState(query.organizationId, id);
  }
}
