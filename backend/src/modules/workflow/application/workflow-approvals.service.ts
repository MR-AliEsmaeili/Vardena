import { Inject, Injectable } from '@nestjs/common';
import {
  DOMAIN_EVENT_BUS,
  type DomainEventBus,
} from '../../../kernel/events/domain-event-bus.js';
import { generateId } from '../../../kernel/ids/ulid.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { getPrincipal } from '../../../kernel/correlation/request-context.js';
import {
  toOffset,
  toPaginatedResult,
  type PaginatedResult,
} from '../../../kernel/pagination/paginated-result.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { WorkflowApprovalsRepository } from '../data/workflow-approvals.repository.js';
import type {
  WorkflowApproval,
  WorkflowApprovalDecision,
  WorkflowApprovalDto,
} from '../domain/workflow-approval.js';
import {
  isWorkflowApprovalDecision,
  planApprovalComment,
  toWorkflowApprovalDto,
  workflowApprovalProblemMessage,
} from '../domain/workflow-approval.js';
import { effectiveApprovalPermission } from '../domain/workflow-transition.js';
import { WORKFLOW_INSTANCE_PERMISSIONS } from '../domain/workflow-permissions.js';
import { WORKFLOW_APPROVAL_DECIDED_EVENT } from '../domain/workflow.events.js';
import { normalizeWorkflowText } from '../domain/workflow-codes.js';
import { WorkflowInstancesService } from './workflow-instances.service.js';
import { WorkflowTransitionsService } from './workflow-transitions.service.js';
import {
  mapExecutionError,
  publishEvent,
  resolveSort,
} from './workflow-support.js';

/** Sortable list fields; anything else is rejected (`architecture.md` §9). */
const SORTABLE_FIELDS: Record<string, string> = {
  requestedAt: 'requestedAt',
  decidedAt: 'decidedAt',
  status: 'status',
};

export interface ListWorkflowApprovalsQuery {
  organizationId: string;
  instanceId: string;
  page: number;
  pageSize: number;
  status?: string | undefined;
  sort?: string | undefined;
}

export interface RequestWorkflowApprovalInput {
  organizationId: string;
  instanceId: string;
  transitionId: string;
  comment?: string | null | undefined;
}

export interface DecideWorkflowApprovalInput {
  organizationId: string;
  approvalId: string;
  decision: string;
  comment?: string | null | undefined;
}

/**
 * Single-level approval foundation (Task 9 §16).
 *
 * One request, one decision, recorded — never a boolean on the instance.
 * Requesting requires the transition's own permission (an approval is part
 * of YOUR execution attempt — fail fast instead of approving something you
 * cannot execute); deciding requires the transition's effective approval
 * permission. Both checks run in this layer (AR-04/AR-21) on top of the
 * guard's `Workflow.Instance.Execute`.
 *
 * Freshness is structural: the request pins `base_sequence` under the
 * instance lock, and decisions/executions reject stale approvals, so an
 * approval can never authorize a state it was not requested in.
 * Multi-level chains, delegation and escalation are out of v1 (OQ-26).
 */
@Injectable()
export class WorkflowApprovalsService {
  constructor(
    private readonly repository: WorkflowApprovalsRepository,
    private readonly instances: WorkflowInstancesService,
    private readonly transitions: WorkflowTransitionsService,
    private readonly organizations: OrganizationsService,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  async listApprovals(
    query: ListWorkflowApprovalsQuery,
  ): Promise<PaginatedResult<WorkflowApprovalDto>> {
    await this.authorization.requireAllPermissions([
      WORKFLOW_INSTANCE_PERMISSIONS.VIEW,
    ]);
    await this.instances.requireInstanceInOrganization(
      query.organizationId,
      query.instanceId,
    );
    if (
      query.status !== undefined &&
      query.status !== 'pending' &&
      query.status !== 'approved' &&
      query.status !== 'rejected'
    ) {
      throw AppException.badRequest(
        'Status must be one of: pending, approved, rejected.',
      );
    }
    const { skip, take } = toOffset(query.page, query.pageSize);
    const { items, total } = await this.repository.list({
      where: {
        organizationId: query.organizationId,
        instanceId: query.instanceId,
        status: query.status,
      },
      orderBy: resolveSort(query.sort, SORTABLE_FIELDS, [
        { requestedAt: 'desc' },
      ]),
      skip,
      take,
    });
    return toPaginatedResult(
      items.map(toWorkflowApprovalDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  async requestApproval(
    input: RequestWorkflowApprovalInput,
  ): Promise<WorkflowApprovalDto> {
    await this.authorization.requireAllPermissions([
      WORKFLOW_INSTANCE_PERMISSIONS.EXECUTE,
    ]);
    await this.organizations.requireUsableOrganization(input.organizationId);
    const instance = await this.instances.requireInstanceInOrganization(
      input.organizationId,
      input.instanceId,
    );
    const transition = await this.transitions.requireTransitionInOrganization(
      input.organizationId,
      input.transitionId,
    );
    if (transition.versionId !== instance.versionId) {
      throw AppException.businessRule(
        'The transition does not belong to the workflow version this entity is bound to.',
      );
    }
    if (!transition.requiresApproval) {
      throw AppException.businessRule(
        'The transition does not require approval, so no approval can be requested for it.',
      );
    }
    if (!transition.isActive) {
      throw AppException.businessRule('The transition is disabled.');
    }
    await this.authorization.requireAllPermissions([
      transition.requiredPermission,
    ]);

    const comment = normalizeWorkflowText(input.comment);
    const { problem } = planApprovalComment(comment);
    if (problem !== null) {
      throw AppException.badRequest(workflowApprovalProblemMessage(problem));
    }

    try {
      const created = await this.repository.requestInLock({
        organizationId: input.organizationId,
        instanceId: instance.id,
        versionId: instance.versionId,
        transitionId: transition.id,
        sourceStateId: transition.sourceStateId,
        approvalId: generateId(),
        actorId: getPrincipal()?.userId ?? null,
        comment,
        now: new Date(),
      });
      if (created === null) {
        throw AppException.notFound('Workflow instance', input.instanceId);
      }
      this.logger.log(
        'Workflow approval requested',
        { approvalId: created.id, instanceId: instance.id },
        WorkflowApprovalsService.name,
      );
      return toWorkflowApprovalDto(created);
    } catch (error) {
      // A fresh request for an unavailable transition is client validation
      // (422), not a race (409) — the caller never held a valid attempt.
      mapExecutionError(error, { staleStateStatus: 'businessRule' });
    }
  }

  async decideApproval(
    input: DecideWorkflowApprovalInput,
  ): Promise<WorkflowApprovalDto> {
    await this.authorization.requireAllPermissions([
      WORKFLOW_INSTANCE_PERMISSIONS.EXECUTE,
    ]);
    await this.organizations.requireUsableOrganization(input.organizationId);
    if (!isWorkflowApprovalDecision(input.decision)) {
      throw AppException.badRequest(
        workflowApprovalProblemMessage('invalid_decision'),
      );
    }
    const decision = input.decision as WorkflowApprovalDecision;
    const comment = normalizeWorkflowText(input.comment);
    const { problem } = planApprovalComment(comment);
    if (problem !== null) {
      throw AppException.badRequest(workflowApprovalProblemMessage(problem));
    }

    const approval = await this.mustFindInOrganization(
      input.organizationId,
      input.approvalId,
    );
    if (approval.status !== 'pending') {
      throw AppException.businessRule(
        workflowApprovalProblemMessage('already_decided'),
      );
    }
    const transition = await this.transitions.requireTransitionInOrganization(
      input.organizationId,
      approval.transitionId,
    );
    // The approver check (AR-04/AR-21): the explicit approval permission
    // when configured, otherwise the transition permission itself.
    await this.authorization.requireAllPermissions([
      effectiveApprovalPermission(transition),
    ]);

    try {
      const decided = await this.repository.decideInLock({
        organizationId: input.organizationId,
        approvalId: approval.id,
        decision,
        actorId: getPrincipal()?.userId ?? null,
        comment,
        now: new Date(),
      });
      if (decided === null) {
        throw AppException.notFound('Workflow approval', input.approvalId);
      }
      await publishEvent(this.events, {
        type: WORKFLOW_APPROVAL_DECIDED_EVENT,
        aggregateType: 'WorkflowApproval',
        aggregateId: decided.id,
        payload: {
          approvalId: decided.id,
          instanceId: decided.instanceId,
          organizationId: decided.organizationId,
          transitionId: decided.transitionId,
          decision,
          decidedBy: decided.decidedBy,
        },
      });
      this.logger.log(
        'Workflow approval decided',
        { approvalId: decided.id, decision },
        WorkflowApprovalsService.name,
      );
      return toWorkflowApprovalDto(decided);
    } catch (error) {
      mapExecutionError(error);
    }
  }

  // ---- internals ----------------------------------------------------------

  private async mustFindInOrganization(
    organizationId: string,
    id: string,
  ): Promise<WorkflowApproval> {
    const approval = await this.repository.findById(id);
    if (approval === null || approval.organizationId !== organizationId) {
      throw AppException.notFound('Workflow approval', id);
    }
    return approval;
  }
}
