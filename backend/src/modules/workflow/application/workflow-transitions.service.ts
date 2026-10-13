import { Injectable } from '@nestjs/common';
import { generateId } from '../../../kernel/ids/ulid.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { getPrincipal } from '../../../kernel/correlation/request-context.js';
import {
  toOffset,
  toPaginatedResult,
  type PaginatedResult,
} from '../../../kernel/pagination/paginated-result.js';
import { isUniqueViolation } from '../../../kernel/prisma/prisma-errors.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { PermissionRegistry } from '../../rbac/application/permission-registry.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { WorkflowTransitionsRepository } from '../data/workflow-transitions.repository.js';
import type {
  WorkflowTransition,
  WorkflowTransitionDto,
} from '../domain/workflow-transition.js';
import {
  planWorkflowTransition,
  toWorkflowTransitionDto,
  workflowTransitionProblemMessage,
} from '../domain/workflow-transition.js';
import { WORKFLOW_VERSION_PERMISSIONS } from '../domain/workflow-permissions.js';
import {
  normalizeWorkflowCode,
  normalizeWorkflowName,
  normalizeWorkflowText,
} from '../domain/workflow-codes.js';
import { WorkflowStatesService } from './workflow-states.service.js';
import { WorkflowVersionsService } from './workflow-versions.service.js';
import { mapExecutionError, resolveSort } from './workflow-support.js';

/** Sortable list fields; anything else is rejected (`architecture.md` §9). */
const SORTABLE_FIELDS: Record<string, string> = {
  code: 'code',
  name: 'name',
  sortOrder: 'sortOrder',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

export interface ListWorkflowTransitionsQuery {
  organizationId: string;
  versionId: string;
  page: number;
  pageSize: number;
  sourceStateId?: string | undefined;
  isActive?: boolean | undefined;
  sort?: string | undefined;
}

export interface CreateWorkflowTransitionInput {
  organizationId: string;
  versionId: string;
  code: string;
  name: string;
  description?: string | null | undefined;
  sourceStateId: string;
  targetStateId: string;
  requiredPermission: string;
  requiresApproval?: boolean | undefined;
  approvalPermission?: string | null | undefined;
  requiresComment?: boolean | undefined;
  requireDifferentActor?: boolean | undefined;
  isActive?: boolean | undefined;
  sortOrder?: number | undefined;
}

export interface UpdateWorkflowTransitionInput {
  name?: string | undefined;
  description?: string | null | undefined;
  requiredPermission?: string | undefined;
  requiresApproval?: boolean | undefined;
  approvalPermission?: string | null | undefined;
  requiresComment?: boolean | undefined;
  requireDifferentActor?: boolean | undefined;
  isActive?: boolean | undefined;
  sortOrder?: number | undefined;
}

/**
 * Workflow transition configuration (Task 9 §8).
 *
 * Transitions are configured inside DRAFT versions only
 * (`Workflow.Version.Edit`); active and superseded versions are immutable
 * and every write re-checks `draft` under the version lock. Codes and the
 * (source → target) endpoints are immutable after creation — redefining an
 * edge means deleting and recreating it, never silently repointing it.
 *
 * Permissions named here must be REGISTERED RBAC codes (ADR-0018: a
 * workflow may only reference declared codes): the format is validated by
 * the domain, membership by the permission registry. Evaluation always
 * goes through `AuthorizationService` — this module owns no authorization
 * logic of its own (Task 9 §9).
 */
@Injectable()
export class WorkflowTransitionsService {
  constructor(
    private readonly repository: WorkflowTransitionsRepository,
    private readonly versions: WorkflowVersionsService,
    private readonly states: WorkflowStatesService,
    private readonly organizations: OrganizationsService,
    private readonly authorization: AuthorizationService,
    private readonly permissions: PermissionRegistry,
    private readonly logger: JsonLogger,
  ) {}

  async listTransitions(
    query: ListWorkflowTransitionsQuery,
  ): Promise<PaginatedResult<WorkflowTransitionDto>> {
    await this.authorization.requireAllPermissions([
      WORKFLOW_VERSION_PERMISSIONS.VIEW,
    ]);
    await this.organizations.assertOrganizationInScope(query.organizationId);
    await this.versions.requireVersionInOrganization(
      query.organizationId,
      query.versionId,
    );
    const { skip, take } = toOffset(query.page, query.pageSize);
    const { items, total } = await this.repository.list({
      where: {
        organizationId: query.organizationId,
        versionId: query.versionId,
        sourceStateId: query.sourceStateId,
        isActive: query.isActive,
      },
      orderBy: resolveSort(query.sort, SORTABLE_FIELDS, [
        { sortOrder: 'asc' },
        { code: 'asc' },
      ]),
      skip,
      take,
    });
    return toPaginatedResult(
      items.map(toWorkflowTransitionDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  async getTransition(
    organizationId: string,
    id: string,
  ): Promise<WorkflowTransitionDto> {
    await this.authorization.requireAllPermissions([
      WORKFLOW_VERSION_PERMISSIONS.VIEW,
    ]);
    await this.organizations.assertOrganizationInScope(organizationId);
    return toWorkflowTransitionDto(
      await this.mustFindInOrganization(organizationId, id),
    );
  }

  async createTransition(
    input: CreateWorkflowTransitionInput,
  ): Promise<WorkflowTransitionDto> {
    await this.authorization.requireAllPermissions([
      WORKFLOW_VERSION_PERMISSIONS.EDIT,
    ]);
    await this.organizations.requireUsableOrganization(input.organizationId);
    const version = await this.versions.requireDraftVersionInOrganization(
      input.organizationId,
      input.versionId,
    );

    const code = normalizeWorkflowCode(input.code);
    const name = normalizeWorkflowName(input.name);
    const description = normalizeWorkflowText(input.description);
    const sortOrder = input.sortOrder ?? 0;
    const requiredPermission = input.requiredPermission.trim();
    const approvalPermission =
      input.approvalPermission === undefined ||
      input.approvalPermission === null
        ? null
        : input.approvalPermission.trim();
    const { problem } = planWorkflowTransition({
      code,
      name,
      description,
      sortOrder,
      sourceStateId: input.sourceStateId,
      targetStateId: input.targetStateId,
      requiredPermission,
      approvalPermission,
    });
    if (problem !== null) {
      throw AppException.badRequest(workflowTransitionProblemMessage(problem));
    }
    this.requireRegisteredPermission(requiredPermission);
    if (approvalPermission !== null) {
      this.requireRegisteredPermission(approvalPermission);
    }

    const source = await this.states.requireStateInOrganization(
      input.organizationId,
      input.sourceStateId,
    );
    const target = await this.states.requireStateInOrganization(
      input.organizationId,
      input.targetStateId,
    );
    if (source.versionId !== version.id || target.versionId !== version.id) {
      throw AppException.businessRule(
        'A transition\u2019s source and target states must belong to the same workflow version.',
      );
    }
    if (source.isTerminal) {
      throw AppException.businessRule(
        'A terminal state must not have outgoing transitions. Remove the transition or unmark the state as terminal.',
      );
    }

    const existing = await this.repository.findByCode(input.versionId, code);
    if (existing !== null) {
      throw AppException.conflict(
        'A workflow transition with that code already exists in this version.',
      );
    }

    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    try {
      const created = await this.repository.createInDraftVersion(version.id, {
        id: generateId(),
        organizationId: input.organizationId,
        versionId: version.id,
        code,
        name,
        description,
        sourceStateId: source.id,
        targetStateId: target.id,
        requiredPermission,
        requiresApproval: input.requiresApproval ?? false,
        approvalPermission,
        requiresComment: input.requiresComment ?? false,
        requireDifferentActor: input.requireDifferentActor ?? false,
        isActive: input.isActive ?? true,
        sortOrder,
        createdAt: now,
        updatedAt: now,
        createdBy: actorId,
        updatedBy: actorId,
      });
      this.logger.log(
        'Workflow transition created',
        { transitionId: created.id, versionId: version.id },
        WorkflowTransitionsService.name,
      );
      return toWorkflowTransitionDto(created);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppException.conflict(
          'A workflow transition with that code already exists in this version.',
        );
      }
      mapExecutionError(error);
    }
  }

  async updateTransition(
    organizationId: string,
    id: string,
    input: UpdateWorkflowTransitionInput,
  ): Promise<WorkflowTransitionDto> {
    await this.authorization.requireAllPermissions([
      WORKFLOW_VERSION_PERMISSIONS.EDIT,
    ]);
    await this.organizations.requireUsableOrganization(organizationId);
    const current = await this.mustFindInOrganization(organizationId, id);
    const version = await this.versions.requireDraftVersionInOrganization(
      organizationId,
      current.versionId,
    );

    const name =
      input.name === undefined
        ? current.name
        : normalizeWorkflowName(input.name);
    const description =
      input.description === undefined
        ? current.description
        : normalizeWorkflowText(input.description);
    const sortOrder = input.sortOrder ?? current.sortOrder;
    const requiredPermission =
      input.requiredPermission === undefined
        ? current.requiredPermission
        : input.requiredPermission.trim();
    const approvalPermission =
      input.approvalPermission === undefined
        ? current.approvalPermission
        : (normalizeWorkflowText(input.approvalPermission) ?? null);
    const { problem } = planWorkflowTransition({
      code: current.code,
      name,
      description,
      sortOrder,
      sourceStateId: current.sourceStateId,
      targetStateId: current.targetStateId,
      requiredPermission,
      approvalPermission,
    });
    if (problem !== null) {
      throw AppException.badRequest(workflowTransitionProblemMessage(problem));
    }
    this.requireRegisteredPermission(requiredPermission);
    if (approvalPermission !== null) {
      this.requireRegisteredPermission(approvalPermission);
    }

    try {
      const updated = await this.repository.updateInDraftVersion(
        version.id,
        id,
        {
          name,
          description,
          requiredPermission,
          requiresApproval: input.requiresApproval ?? current.requiresApproval,
          approvalPermission,
          requiresComment: input.requiresComment ?? current.requiresComment,
          requireDifferentActor:
            input.requireDifferentActor ?? current.requireDifferentActor,
          isActive: input.isActive ?? current.isActive,
          sortOrder,
          updatedAt: new Date(),
          updatedBy: getPrincipal()?.userId ?? null,
        },
      );
      if (updated === null) {
        throw AppException.notFound('Workflow transition', id);
      }
      this.logger.log(
        'Workflow transition updated',
        { transitionId: updated.id, versionId: version.id },
        WorkflowTransitionsService.name,
      );
      return toWorkflowTransitionDto(updated);
    } catch (error) {
      mapExecutionError(error);
    }
  }

  async deleteTransition(organizationId: string, id: string): Promise<void> {
    await this.authorization.requireAllPermissions([
      WORKFLOW_VERSION_PERMISSIONS.EDIT,
    ]);
    await this.organizations.requireUsableOrganization(organizationId);
    const current = await this.mustFindInOrganization(organizationId, id);
    const version = await this.versions.requireDraftVersionInOrganization(
      organizationId,
      current.versionId,
    );

    try {
      const deleted = await this.repository.deleteInDraftVersion(
        version.id,
        id,
      );
      if (deleted === null) {
        throw AppException.notFound('Workflow transition', id);
      }
      this.logger.log(
        'Workflow transition deleted',
        { transitionId: id, versionId: version.id },
        WorkflowTransitionsService.name,
      );
    } catch (error) {
      mapExecutionError(error);
    }
  }

  /**
   * Cross-service resolution (AR-07 within the module): instances,
   * approvals and automations resolve their transition through this
   * method. No permission of its own — the calling service has already
   * authorized its action.
   */
  async requireTransitionInOrganization(
    organizationId: string,
    id: string,
  ): Promise<WorkflowTransition> {
    return this.mustFindInOrganization(organizationId, id);
  }

  // ---- internals ----------------------------------------------------------

  private requireRegisteredPermission(code: string): void {
    if (!this.permissions.has(code)) {
      throw AppException.businessRule(
        `Permission "${code}" is not a registered permission. Transitions may only reference declared RBAC codes.`,
      );
    }
  }

  private async mustFindInOrganization(
    organizationId: string,
    id: string,
  ): Promise<WorkflowTransition> {
    const transition = await this.repository.findById(id);
    if (transition === null || transition.organizationId !== organizationId) {
      throw AppException.notFound('Workflow transition', id);
    }
    return transition;
  }
}
