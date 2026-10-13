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
import { WorkflowInstancesService } from '../application/workflow-instances.service.js';
import { WORKFLOW_INSTANCE_PERMISSIONS } from '../domain/workflow-permissions.js';
import {
  AvailableTransitionsResponseDto,
  BindWorkflowInstanceDto,
  ExecuteTransitionResponseDto,
  ExecuteWorkflowTransitionDto,
  ListWorkflowHistoryQueryDto,
  ListWorkflowInstancesQueryDto,
  WorkflowInstanceQueryDto,
  WorkflowInstanceResponseDto,
  WorkflowTransitionHistoryResponseDto,
} from './dto/workflow-instance.dto.js';

const PaginatedWorkflowInstanceDto = paginatedResponseOf(
  WorkflowInstanceResponseDto,
);
const PaginatedWorkflowHistoryDto = paginatedResponseOf(
  WorkflowTransitionHistoryResponseDto,
);

/**
 * Workflow runtime (Task 9 §11/§12/§13/§22).
 *
 * Transport-only (AR-03). Binds entities to workflow versions (pinned
 * forever), reports current state + available transitions + history, and
 * executes transitions through the locked transaction. There is no generic
 * entity-mutation API: the bound entity stays owned by its module.
 */
@ApiTags('workflow-instances')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'workflow/instances', version: '1' })
export class WorkflowInstancesController {
  constructor(private readonly instances: WorkflowInstancesService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(WORKFLOW_INSTANCE_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'List the workflow bindings of one organization.' })
  @ApiExtraModels(PaginatedWorkflowInstanceDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedWorkflowInstanceDto) }] },
  })
  async list(@Query() query: ListWorkflowInstancesQueryDto): Promise<{
    items: WorkflowInstanceResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.instances.listInstances(query);
  }

  @Get(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(WORKFLOW_INSTANCE_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'Get one workflow binding with its current state.' })
  @ApiOkResponse({ type: WorkflowInstanceResponseDto })
  @ApiNotFoundResponse({ description: 'Workflow instance does not exist.' })
  async get(
    @Param('id') id: string,
    @Query() query: WorkflowInstanceQueryDto,
  ): Promise<WorkflowInstanceResponseDto> {
    return this.instances.getInstance(query.organizationId, id);
  }

  @Post()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(WORKFLOW_INSTANCE_PERMISSIONS.BIND)
  @ApiOperation({
    summary:
      'Bind a business entity to a workflow version. The binding pins the version forever.',
  })
  @ApiCreatedResponse({ type: WorkflowInstanceResponseDto })
  @ApiConflictResponse({ description: 'The entity is already bound.' })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async bind(
    @Body() body: BindWorkflowInstanceDto,
  ): Promise<WorkflowInstanceResponseDto> {
    return this.instances.bindInstance({
      organizationId: body.organizationId,
      definitionId: body.definitionId,
      versionId: body.versionId,
      entityModule: body.entityModule,
      entityType: body.entityType,
      entityId: body.entityId,
    });
  }

  @Get(':id/available-transitions')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(WORKFLOW_INSTANCE_PERMISSIONS.VIEW)
  @ApiOperation({
    summary:
      'List the enabled outgoing transitions of the current state, with the caller\u2019s permission preview.',
  })
  @ApiOkResponse({ type: AvailableTransitionsResponseDto })
  @ApiNotFoundResponse({ description: 'Workflow instance does not exist.' })
  async available(
    @Param('id') id: string,
    @Query() query: WorkflowInstanceQueryDto,
  ): Promise<AvailableTransitionsResponseDto> {
    return this.instances.listAvailableTransitions(query.organizationId, id);
  }

  @Post(':id/transitions')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(WORKFLOW_INSTANCE_PERMISSIONS.EXECUTE)
  @ApiOperation({
    summary:
      'Execute a workflow transition. The caller must also hold the transition\u2019s own permission.',
  })
  @ApiOkResponse({ type: ExecuteTransitionResponseDto })
  @ApiNotFoundResponse({
    description: 'Workflow instance or transition does not exist.',
  })
  @ApiConflictResponse({
    description: 'The workflow moved while the request was in flight.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async execute(
    @Param('id') id: string,
    @Query() query: WorkflowInstanceQueryDto,
    @Body() body: ExecuteWorkflowTransitionDto,
  ): Promise<ExecuteTransitionResponseDto> {
    return this.instances.executeTransition({
      organizationId: query.organizationId,
      instanceId: id,
      transitionId: body.transitionId,
      comment: body.comment,
      approvalId: body.approvalId,
    });
  }

  @Get(':id/history')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(WORKFLOW_INSTANCE_PERMISSIONS.VIEW)
  @ApiOperation({
    summary: 'List the append-only transition history of one binding.',
  })
  @ApiExtraModels(PaginatedWorkflowHistoryDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedWorkflowHistoryDto) }] },
  })
  @ApiNotFoundResponse({ description: 'Workflow instance does not exist.' })
  async history(
    @Param('id') id: string,
    @Query() query: ListWorkflowHistoryQueryDto,
  ): Promise<{
    items: WorkflowTransitionHistoryResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.instances.listHistory({
      organizationId: query.organizationId,
      instanceId: id,
      page: query.page,
      pageSize: query.pageSize,
      sort: query.sort,
    });
  }
}
