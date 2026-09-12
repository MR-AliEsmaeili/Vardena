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
import { WorkflowTransitionsService } from '../application/workflow-transitions.service.js';
import { WORKFLOW_VERSION_PERMISSIONS } from '../domain/workflow-permissions.js';
import {
  CreateWorkflowTransitionDto,
  ListWorkflowTransitionsQueryDto,
  UpdateWorkflowTransitionDto,
  WorkflowTransitionQueryDto,
  WorkflowTransitionResponseDto,
} from './dto/workflow-transition.dto.js';

const PaginatedWorkflowTransitionDto = paginatedResponseOf(
  WorkflowTransitionResponseDto,
);

/**
 * Workflow transition configuration (Task 9 §8/§22).
 *
 * Transport-only (AR-03). Transitions are configured inside DRAFT
 * versions only — writes to active or superseded versions are rejected.
 * Codes and the (source → target) endpoints are immutable after creation;
 * permissions must be registered RBAC codes.
 */
@ApiTags('workflow-transitions')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'workflow', version: '1' })
export class WorkflowTransitionsController {
  constructor(private readonly transitions: WorkflowTransitionsService) {}

  @Get('versions/:versionId/transitions')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(WORKFLOW_VERSION_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'List the transitions of one workflow version.' })
  @ApiExtraModels(PaginatedWorkflowTransitionDto)
  @ApiOkResponse({
    schema: {
      allOf: [{ $ref: getSchemaPath(PaginatedWorkflowTransitionDto) }],
    },
  })
  @ApiNotFoundResponse({ description: 'Workflow version does not exist.' })
  async list(
    @Param('versionId') versionId: string,
    @Query() query: ListWorkflowTransitionsQueryDto,
  ): Promise<{
    items: WorkflowTransitionResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.transitions.listTransitions({
      organizationId: query.organizationId,
      versionId,
      page: query.page,
      pageSize: query.pageSize,
      sourceStateId: query.sourceStateId,
      isActive: query.isActive,
      sort: query.sort,
    });
  }

  @Get('transitions/:id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(WORKFLOW_VERSION_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'Get one workflow transition.' })
  @ApiOkResponse({ type: WorkflowTransitionResponseDto })
  @ApiNotFoundResponse({ description: 'Workflow transition does not exist.' })
  async get(
    @Param('id') id: string,
    @Query() query: WorkflowTransitionQueryDto,
  ): Promise<WorkflowTransitionResponseDto> {
    return this.transitions.getTransition(query.organizationId, id);
  }

  @Post('versions/:versionId/transitions')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(WORKFLOW_VERSION_PERMISSIONS.EDIT)
  @ApiOperation({ summary: 'Create a transition in a draft workflow version.' })
  @ApiCreatedResponse({ type: WorkflowTransitionResponseDto })
  @ApiNotFoundResponse({
    description: 'Workflow version or state does not exist.',
  })
  @ApiConflictResponse({
    description: 'Transition code already exists in this version.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async create(
    @Param('versionId') versionId: string,
    @Query() query: WorkflowTransitionQueryDto,
    @Body() body: CreateWorkflowTransitionDto,
  ): Promise<WorkflowTransitionResponseDto> {
    return this.transitions.createTransition({
      organizationId: query.organizationId,
      versionId,
      code: body.code,
      name: body.name,
      description: body.description,
      sourceStateId: body.sourceStateId,
      targetStateId: body.targetStateId,
      requiredPermission: body.requiredPermission,
      requiresApproval: body.requiresApproval,
      approvalPermission: body.approvalPermission,
      requiresComment: body.requiresComment,
      requireDifferentActor: body.requireDifferentActor,
      isActive: body.isActive,
      sortOrder: body.sortOrder,
    });
  }

  @Patch('transitions/:id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(WORKFLOW_VERSION_PERMISSIONS.EDIT)
  @ApiOperation({ summary: 'Edit a transition of a draft workflow version.' })
  @ApiOkResponse({ type: WorkflowTransitionResponseDto })
  @ApiNotFoundResponse({ description: 'Workflow transition does not exist.' })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async update(
    @Param('id') id: string,
    @Query() query: WorkflowTransitionQueryDto,
    @Body() body: UpdateWorkflowTransitionDto,
  ): Promise<WorkflowTransitionResponseDto> {
    return this.transitions.updateTransition(query.organizationId, id, {
      name: body.name,
      description: body.description,
      requiredPermission: body.requiredPermission,
      requiresApproval: body.requiresApproval,
      approvalPermission: body.approvalPermission,
      requiresComment: body.requiresComment,
      requireDifferentActor: body.requireDifferentActor,
      isActive: body.isActive,
      sortOrder: body.sortOrder,
    });
  }

  @Delete('transitions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(WORKFLOW_VERSION_PERMISSIONS.EDIT)
  @ApiOperation({
    summary:
      'Delete a transition of a draft workflow version, with its draft automation bindings.',
  })
  @ApiOkResponse({ description: 'Deleted.' })
  @ApiNotFoundResponse({ description: 'Workflow transition does not exist.' })
  async remove(
    @Param('id') id: string,
    @Query() query: WorkflowTransitionQueryDto,
  ): Promise<void> {
    await this.transitions.deleteTransition(query.organizationId, id);
  }
}
