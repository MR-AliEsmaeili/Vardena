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
  getSchemaPath,
} from '@nestjs/swagger';
import { paginatedResponseOf } from '../../../kernel/pagination/paginated-result.js';
import { AuthGuard } from '../../identity/application/auth.guard.js';
import { AuthorizationGuard } from '../../rbac/application/authorization.guard.js';
import { RequirePermission } from '../../rbac/application/require-permission.decorator.js';
import { WorkflowDefinitionsService } from '../application/workflow-definitions.service.js';
import { WORKFLOW_DEFINITION_PERMISSIONS } from '../domain/workflow-permissions.js';
import {
  CreateWorkflowDefinitionDto,
  ListWorkflowDefinitionsQueryDto,
  UpdateWorkflowDefinitionDto,
  WorkflowDefinitionQueryDto,
  WorkflowDefinitionResponseDto,
} from './dto/workflow-definition.dto.js';

const PaginatedWorkflowDefinitionDto = paginatedResponseOf(
  WorkflowDefinitionResponseDto,
);

/**
 * Workflow definition administration (Task 9 §5/§22).
 *
 * Transport-only (AR-03). Every operation carries `organizationId`, so no
 * endpoint ever reads or writes definitions across organizations. Codes
 * are immutable after creation; behaviour changes ship as new versions.
 */
@ApiTags('workflow-definitions')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'workflow/definitions', version: '1' })
export class WorkflowDefinitionsController {
  constructor(private readonly definitions: WorkflowDefinitionsService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(WORKFLOW_DEFINITION_PERMISSIONS.VIEW)
  @ApiOperation({
    summary: 'List the workflow definitions of one organization.',
  })
  @ApiExtraModels(PaginatedWorkflowDefinitionDto)
  @ApiOkResponse({
    schema: {
      allOf: [{ $ref: getSchemaPath(PaginatedWorkflowDefinitionDto) }],
    },
  })
  async list(@Query() query: ListWorkflowDefinitionsQueryDto): Promise<{
    items: WorkflowDefinitionResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.definitions.listDefinitions(query);
  }

  @Get(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(WORKFLOW_DEFINITION_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'Get one workflow definition.' })
  @ApiOkResponse({ type: WorkflowDefinitionResponseDto })
  @ApiNotFoundResponse({ description: 'Workflow definition does not exist.' })
  async get(
    @Param('id') id: string,
    @Query() query: WorkflowDefinitionQueryDto,
  ): Promise<WorkflowDefinitionResponseDto> {
    return this.definitions.getDefinition(query.organizationId, id);
  }

  @Post()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(WORKFLOW_DEFINITION_PERMISSIONS.CREATE)
  @ApiOperation({ summary: 'Create a workflow definition in an organization.' })
  @ApiCreatedResponse({ type: WorkflowDefinitionResponseDto })
  @ApiConflictResponse({
    description: 'Definition code already exists in this organization.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async create(
    @Body() body: CreateWorkflowDefinitionDto,
  ): Promise<WorkflowDefinitionResponseDto> {
    return this.definitions.createDefinition({
      organizationId: body.organizationId,
      code: body.code,
      name: body.name,
      description: body.description,
    });
  }

  @Patch(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(WORKFLOW_DEFINITION_PERMISSIONS.EDIT)
  @ApiOperation({ summary: 'Edit a workflow definition.' })
  @ApiOkResponse({ type: WorkflowDefinitionResponseDto })
  @ApiNotFoundResponse({ description: 'Workflow definition does not exist.' })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async update(
    @Param('id') id: string,
    @Query() query: WorkflowDefinitionQueryDto,
    @Body() body: UpdateWorkflowDefinitionDto,
  ): Promise<WorkflowDefinitionResponseDto> {
    return this.definitions.updateDefinition(query.organizationId, id, {
      name: body.name,
      description: body.description,
      isActive: body.isActive,
    });
  }
}
