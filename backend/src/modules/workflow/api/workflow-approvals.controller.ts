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
import { WorkflowApprovalsService } from '../application/workflow-approvals.service.js';
import { WORKFLOW_INSTANCE_PERMISSIONS } from '../domain/workflow-permissions.js';
import {
  DecideWorkflowApprovalDto,
  ListWorkflowApprovalsQueryDto,
  RequestWorkflowApprovalDto,
  WorkflowApprovalQueryDto,
  WorkflowApprovalResponseDto,
} from './dto/workflow-approval.dto.js';

const PaginatedWorkflowApprovalDto = paginatedResponseOf(
  WorkflowApprovalResponseDto,
);

/**
 * Single-level workflow approvals (Task 9 §16).
 *
 * Transport-only (AR-03). Requesting requires the transition's own
 * permission; deciding requires the effective approval permission — both
 * enforced in the service on top of the guard. Multi-level chains,
 * delegation and escalation are out of v1 scope (OQ-26).
 */
@ApiTags('workflow-approvals')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'workflow', version: '1' })
export class WorkflowApprovalsController {
  constructor(private readonly approvals: WorkflowApprovalsService) {}

  @Get('instances/:instanceId/approvals')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(WORKFLOW_INSTANCE_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'List the approvals of one workflow binding.' })
  @ApiExtraModels(PaginatedWorkflowApprovalDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedWorkflowApprovalDto) }] },
  })
  @ApiNotFoundResponse({ description: 'Workflow instance does not exist.' })
  async list(
    @Param('instanceId') instanceId: string,
    @Query() query: ListWorkflowApprovalsQueryDto,
  ): Promise<{
    items: WorkflowApprovalResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.approvals.listApprovals({
      organizationId: query.organizationId,
      instanceId,
      page: query.page,
      pageSize: query.pageSize,
      status: query.status,
      sort: query.sort,
    });
  }

  @Post('instances/:instanceId/approvals')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(WORKFLOW_INSTANCE_PERMISSIONS.EXECUTE)
  @ApiOperation({
    summary: 'Request an approval for an approval-gated transition.',
  })
  @ApiCreatedResponse({ type: WorkflowApprovalResponseDto })
  @ApiNotFoundResponse({
    description: 'Workflow instance or transition does not exist.',
  })
  @ApiConflictResponse({
    description: 'A pending approval already exists for this transition.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async request(
    @Param('instanceId') instanceId: string,
    @Query() query: WorkflowApprovalQueryDto,
    @Body() body: RequestWorkflowApprovalDto,
  ): Promise<WorkflowApprovalResponseDto> {
    return this.approvals.requestApproval({
      organizationId: query.organizationId,
      instanceId,
      transitionId: body.transitionId,
      comment: body.comment,
    });
  }

  @Post('approvals/:approvalId/decide')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(WORKFLOW_INSTANCE_PERMISSIONS.EXECUTE)
  @ApiOperation({ summary: 'Approve or reject a pending approval.' })
  @ApiOkResponse({ type: WorkflowApprovalResponseDto })
  @ApiNotFoundResponse({ description: 'Workflow approval does not exist.' })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async decide(
    @Param('approvalId') approvalId: string,
    @Query() query: WorkflowApprovalQueryDto,
    @Body() body: DecideWorkflowApprovalDto,
  ): Promise<WorkflowApprovalResponseDto> {
    return this.approvals.decideApproval({
      organizationId: query.organizationId,
      approvalId,
      decision: body.decision,
      comment: body.comment,
    });
  }
}
