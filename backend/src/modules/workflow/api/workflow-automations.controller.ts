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
import { WorkflowAutomationsService } from '../application/workflow-automations.service.js';
import { WORKFLOW_VERSION_PERMISSIONS } from '../domain/workflow-permissions.js';
import {
  CreateWorkflowAutomationDto,
  ListWorkflowAutomationsQueryDto,
  UpdateWorkflowAutomationDto,
  WorkflowAutomationQueryDto,
  WorkflowAutomationResponseDto,
} from './dto/workflow-automation.dto.js';

const PaginatedWorkflowAutomationDto = paginatedResponseOf(
  WorkflowAutomationResponseDto,
);

/**
 * Workflow automation bindings (Task 9 §18).
 *
 * Transport-only (AR-03). Bindings are draft configuration: WHICH
 * catalogue action a transition binds, with typed parameters. Actions
 * must be registered application code; action and parameters are
 * immutable after creation. v1 REPORTS bound actions on the transition
 * event; it runs none.
 */
@ApiTags('workflow-automations')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'workflow', version: '1' })
export class WorkflowAutomationsController {
  constructor(private readonly automations: WorkflowAutomationsService) {}

  @Get('transitions/:transitionId/automations')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(WORKFLOW_VERSION_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'List the automation bindings of one transition.' })
  @ApiExtraModels(PaginatedWorkflowAutomationDto)
  @ApiOkResponse({
    schema: {
      allOf: [{ $ref: getSchemaPath(PaginatedWorkflowAutomationDto) }],
    },
  })
  @ApiNotFoundResponse({ description: 'Workflow transition does not exist.' })
  async list(
    @Param('transitionId') transitionId: string,
    @Query() query: ListWorkflowAutomationsQueryDto,
  ): Promise<{
    items: WorkflowAutomationResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.automations.listAutomations({
      organizationId: query.organizationId,
      transitionId,
      page: query.page,
      pageSize: query.pageSize,
      isActive: query.isActive,
      sort: query.sort,
    });
  }

  @Get('automations/:id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(WORKFLOW_VERSION_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'Get one automation binding.' })
  @ApiOkResponse({ type: WorkflowAutomationResponseDto })
  @ApiNotFoundResponse({ description: 'Workflow automation does not exist.' })
  async get(
    @Param('id') id: string,
    @Query() query: WorkflowAutomationQueryDto,
  ): Promise<WorkflowAutomationResponseDto> {
    return this.automations.getAutomation(query.organizationId, id);
  }

  @Post('transitions/:transitionId/automations')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(WORKFLOW_VERSION_PERMISSIONS.EDIT)
  @ApiOperation({
    summary: 'Bind a registered automation action to a draft transition.',
  })
  @ApiCreatedResponse({ type: WorkflowAutomationResponseDto })
  @ApiNotFoundResponse({ description: 'Workflow transition does not exist.' })
  @ApiConflictResponse({
    description: 'The action is already bound to this transition.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async create(
    @Param('transitionId') transitionId: string,
    @Query() query: WorkflowAutomationQueryDto,
    @Body() body: CreateWorkflowAutomationDto,
  ): Promise<WorkflowAutomationResponseDto> {
    return this.automations.createAutomation({
      organizationId: query.organizationId,
      transitionId,
      action: body.action,
      parameters: body.parameters,
      sortOrder: body.sortOrder,
      isActive: body.isActive,
    });
  }

  @Patch('automations/:id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(WORKFLOW_VERSION_PERMISSIONS.EDIT)
  @ApiOperation({ summary: 'Edit an automation binding of a draft version.' })
  @ApiOkResponse({ type: WorkflowAutomationResponseDto })
  @ApiNotFoundResponse({ description: 'Workflow automation does not exist.' })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async update(
    @Param('id') id: string,
    @Query() query: WorkflowAutomationQueryDto,
    @Body() body: UpdateWorkflowAutomationDto,
  ): Promise<WorkflowAutomationResponseDto> {
    return this.automations.updateAutomation(query.organizationId, id, {
      sortOrder: body.sortOrder,
      isActive: body.isActive,
    });
  }

  @Delete('automations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(WORKFLOW_VERSION_PERMISSIONS.EDIT)
  @ApiOperation({
    summary: 'Delete an automation binding of a draft version.',
  })
  @ApiOkResponse({ description: 'Deleted.' })
  @ApiNotFoundResponse({ description: 'Workflow automation does not exist.' })
  async remove(
    @Param('id') id: string,
    @Query() query: WorkflowAutomationQueryDto,
  ): Promise<void> {
    await this.automations.deleteAutomation(query.organizationId, id);
  }
}
