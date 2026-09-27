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
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { WorkflowAutomationsRepository } from '../data/workflow-automations.repository.js';
import type {
  WorkflowAutomationBinding,
  WorkflowAutomationBindingDto,
} from '../domain/workflow-automation.js';
import {
  normalizeAutomationParameters,
  planWorkflowAutomation,
  toWorkflowAutomationBindingDto,
  workflowAutomationProblemMessage,
} from '../domain/workflow-automation.js';
import { WORKFLOW_VERSION_PERMISSIONS } from '../domain/workflow-permissions.js';
import { AutomationActionRegistry } from './automation-action-registry.js';
import { WorkflowTransitionsService } from './workflow-transitions.service.js';
import { WorkflowVersionsService } from './workflow-versions.service.js';
import { mapExecutionError, resolveSort } from './workflow-support.js';

/** Sortable list fields; anything else is rejected (`architecture.md` §9). */
const SORTABLE_FIELDS: Record<string, string> = {
  action: 'action',
  sortOrder: 'sortOrder',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

export interface ListWorkflowAutomationsQuery {
  organizationId: string;
  transitionId: string;
  page: number;
  pageSize: number;
  isActive?: boolean | undefined;
  sort?: string | undefined;
}

export interface CreateWorkflowAutomationInput {
  organizationId: string;
  transitionId: string;
  action: string;
  parameters?: unknown;
  sortOrder?: number | undefined;
  isActive?: boolean | undefined;
}

export interface UpdateWorkflowAutomationInput {
  sortOrder?: number | undefined;
  isActive?: boolean | undefined;
}

/**
 * Automation binding foundation (Task 9 §18).
 *
 * The v1 CONTRACT: which catalogue action a transition binds, with typed
 * parameters. Actions must be REGISTERED application code
 * (`AutomationActionRegistry`, empty in Task 9 — the future dispatcher
 * registers its actions at startup); unknown actions are rejected, and
 * parameters must fit the bounded envelope (flat JSON object, primitive
 * values). No user scripts, no stored code, no generic expressions.
 *
 * Bindings are draft configuration (`Workflow.Version.Edit`); action and
 * parameters are immutable after creation (recreate instead of repointing).
 * v1 REPORTS bound actions on the transition event; it runs none —
 * executing external effects through the outbox/worker is a future
 * automation module, not this task.
 */
@Injectable()
export class WorkflowAutomationsService {
  constructor(
    private readonly repository: WorkflowAutomationsRepository,
    private readonly versions: WorkflowVersionsService,
    private readonly transitions: WorkflowTransitionsService,
    private readonly actions: AutomationActionRegistry,
    private readonly organizations: OrganizationsService,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
  ) {}

  async listAutomations(
    query: ListWorkflowAutomationsQuery,
  ): Promise<PaginatedResult<WorkflowAutomationBindingDto>> {
    await this.authorization.requireAllPermissions([
      WORKFLOW_VERSION_PERMISSIONS.VIEW,
    ]);
    await this.organizations.assertOrganizationInScope(query.organizationId);
    const transition = await this.transitions.requireTransitionInOrganization(
      query.organizationId,
      query.transitionId,
    );
    const { skip, take } = toOffset(query.page, query.pageSize);
    const { items, total } = await this.repository.list({
      where: {
        organizationId: query.organizationId,
        transitionId: transition.id,
        isActive: query.isActive,
      },
      orderBy: resolveSort(query.sort, SORTABLE_FIELDS, [
        { sortOrder: 'asc' },
        { action: 'asc' },
      ]),
      skip,
      take,
    });
    return toPaginatedResult(
      items.map(toWorkflowAutomationBindingDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  async getAutomation(
    organizationId: string,
    id: string,
  ): Promise<WorkflowAutomationBindingDto> {
    await this.authorization.requireAllPermissions([
      WORKFLOW_VERSION_PERMISSIONS.VIEW,
    ]);
    await this.organizations.assertOrganizationInScope(organizationId);
    return toWorkflowAutomationBindingDto(
      await this.mustFindInOrganization(organizationId, id),
    );
  }

  async createAutomation(
    input: CreateWorkflowAutomationInput,
  ): Promise<WorkflowAutomationBindingDto> {
    await this.authorization.requireAllPermissions([
      WORKFLOW_VERSION_PERMISSIONS.EDIT,
    ]);
    await this.organizations.requireUsableOrganization(input.organizationId);
    const transition = await this.transitions.requireTransitionInOrganization(
      input.organizationId,
      input.transitionId,
    );
    const version = await this.versions.requireDraftVersionInOrganization(
      input.organizationId,
      transition.versionId,
    );

    const action = input.action.trim();
    const sortOrder = input.sortOrder ?? 0;
    const { problem } = planWorkflowAutomation({
      action,
      parameters: input.parameters,
      sortOrder,
    });
    if (problem !== null) {
      throw AppException.badRequest(workflowAutomationProblemMessage(problem));
    }
    if (!this.actions.has(action)) {
      throw AppException.businessRule(
        `Automation action "${action}" is not registered. Transitions may only bind actions declared by application code.`,
      );
    }

    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    try {
      const created = await this.repository.createInDraftVersion(version.id, {
        id: generateId(),
        organizationId: input.organizationId,
        versionId: version.id,
        transitionId: transition.id,
        action,
        parameters: normalizeAutomationParameters(input.parameters),
        sortOrder,
        isActive: input.isActive ?? true,
        createdAt: now,
        updatedAt: now,
        createdBy: actorId,
        updatedBy: actorId,
      });
      this.logger.log(
        'Workflow automation bound',
        { bindingId: created.id, transitionId: transition.id, action },
        WorkflowAutomationsService.name,
      );
      return toWorkflowAutomationBindingDto(created);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppException.conflict(
          'The automation action is already bound to this transition.',
        );
      }
      mapExecutionError(error);
    }
  }

  async updateAutomation(
    organizationId: string,
    id: string,
    input: UpdateWorkflowAutomationInput,
  ): Promise<WorkflowAutomationBindingDto> {
    await this.authorization.requireAllPermissions([
      WORKFLOW_VERSION_PERMISSIONS.EDIT,
    ]);
    await this.organizations.requireUsableOrganization(organizationId);
    const current = await this.mustFindInOrganization(organizationId, id);
    const version = await this.versions.requireDraftVersionInOrganization(
      organizationId,
      current.versionId,
    );

    const sortOrder = input.sortOrder ?? current.sortOrder;
    const { problem } = planWorkflowAutomation({
      action: current.action,
      parameters: current.parameters,
      sortOrder,
    });
    if (problem !== null) {
      throw AppException.badRequest(workflowAutomationProblemMessage(problem));
    }

    try {
      const updated = await this.repository.updateInDraftVersion(
        version.id,
        id,
        {
          sortOrder,
          isActive: input.isActive ?? current.isActive,
          updatedAt: new Date(),
          updatedBy: getPrincipal()?.userId ?? null,
        },
      );
      if (updated === null) {
        throw AppException.notFound('Workflow automation', id);
      }
      this.logger.log(
        'Workflow automation updated',
        { bindingId: updated.id },
        WorkflowAutomationsService.name,
      );
      return toWorkflowAutomationBindingDto(updated);
    } catch (error) {
      mapExecutionError(error);
    }
  }

  async deleteAutomation(organizationId: string, id: string): Promise<void> {
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
        throw AppException.notFound('Workflow automation', id);
      }
      this.logger.log(
        'Workflow automation deleted',
        { bindingId: id },
        WorkflowAutomationsService.name,
      );
    } catch (error) {
      mapExecutionError(error);
    }
  }

  // ---- internals ----------------------------------------------------------

  private async mustFindInOrganization(
    organizationId: string,
    id: string,
  ): Promise<WorkflowAutomationBinding> {
    const binding = await this.repository.findById(id);
    if (binding === null || binding.organizationId !== organizationId) {
      throw AppException.notFound('Workflow automation', id);
    }
    return binding;
  }
}
