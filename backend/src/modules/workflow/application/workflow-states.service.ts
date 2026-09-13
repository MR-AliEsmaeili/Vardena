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
import {
  isForeignKeyViolation,
  isUniqueViolation,
} from '../../../kernel/prisma/prisma-errors.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { WorkflowStatesRepository } from '../data/workflow-states.repository.js';
import { WorkflowTransitionsRepository } from '../data/workflow-transitions.repository.js';
import type {
  WorkflowState,
  WorkflowStateDto,
} from '../domain/workflow-state.js';
import {
  planWorkflowState,
  toWorkflowStateDto,
  workflowStateProblemMessage,
} from '../domain/workflow-state.js';
import { WORKFLOW_VERSION_PERMISSIONS } from '../domain/workflow-permissions.js';
import {
  normalizeWorkflowCode,
  normalizeWorkflowName,
  normalizeWorkflowText,
} from '../domain/workflow-codes.js';
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

export interface ListWorkflowStatesQuery {
  organizationId: string;
  versionId: string;
  page: number;
  pageSize: number;
  sort?: string | undefined;
}

export interface CreateWorkflowStateInput {
  organizationId: string;
  versionId: string;
  code: string;
  name: string;
  description?: string | null | undefined;
  isInitial?: boolean | undefined;
  isTerminal?: boolean | undefined;
  isActive?: boolean | undefined;
  sortOrder?: number | undefined;
}

export interface UpdateWorkflowStateInput {
  name?: string | undefined;
  description?: string | null | undefined;
  isInitial?: boolean | undefined;
  isTerminal?: boolean | undefined;
  isActive?: boolean | undefined;
  sortOrder?: number | undefined;
}

/**
 * Workflow state configuration (Task 9 §7).
 *
 * States are configured inside DRAFT versions only (`Workflow.Version.Edit`);
 * active and superseded versions are immutable and every write re-checks
 * `draft` under the version lock. Codes are immutable after creation.
 * Multiple initial states are tolerated in a draft (publish rejects them);
 * deleting a state referenced by any transition is rejected.
 */
@Injectable()
export class WorkflowStatesService {
  constructor(
    private readonly repository: WorkflowStatesRepository,
    private readonly transitions: WorkflowTransitionsRepository,
    private readonly versions: WorkflowVersionsService,
    private readonly organizations: OrganizationsService,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
  ) {}

  async listStates(
    query: ListWorkflowStatesQuery,
  ): Promise<PaginatedResult<WorkflowStateDto>> {
    await this.authorization.requireAllPermissions([
      WORKFLOW_VERSION_PERMISSIONS.VIEW,
    ]);
    await this.versions.requireVersionInOrganization(
      query.organizationId,
      query.versionId,
    );
    const { skip, take } = toOffset(query.page, query.pageSize);
    const { items, total } = await this.repository.list({
      where: {
        organizationId: query.organizationId,
        versionId: query.versionId,
      },
      orderBy: resolveSort(query.sort, SORTABLE_FIELDS, [
        { sortOrder: 'asc' },
        { code: 'asc' },
      ]),
      skip,
      take,
    });
    return toPaginatedResult(
      items.map(toWorkflowStateDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  async getState(
    organizationId: string,
    id: string,
  ): Promise<WorkflowStateDto> {
    await this.authorization.requireAllPermissions([
      WORKFLOW_VERSION_PERMISSIONS.VIEW,
    ]);
    return toWorkflowStateDto(
      await this.mustFindInOrganization(organizationId, id),
    );
  }

  async createState(
    input: CreateWorkflowStateInput,
  ): Promise<WorkflowStateDto> {
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
    const { problem } = planWorkflowState({
      code,
      name,
      description,
      sortOrder,
    });
    if (problem !== null) {
      throw AppException.badRequest(workflowStateProblemMessage(problem));
    }

    const existing = await this.repository.findByCode(input.versionId, code);
    if (existing !== null) {
      throw AppException.conflict(
        'A workflow state with that code already exists in this version.',
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
        isInitial: input.isInitial ?? false,
        isTerminal: input.isTerminal ?? false,
        isActive: input.isActive ?? true,
        sortOrder,
        createdAt: now,
        updatedAt: now,
        createdBy: actorId,
        updatedBy: actorId,
      });
      this.logger.log(
        'Workflow state created',
        { stateId: created.id, versionId: version.id },
        WorkflowStatesService.name,
      );
      return toWorkflowStateDto(created);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppException.conflict(
          'A workflow state with that code already exists in this version.',
        );
      }
      mapExecutionError(error);
    }
  }

  async updateState(
    organizationId: string,
    id: string,
    input: UpdateWorkflowStateInput,
  ): Promise<WorkflowStateDto> {
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
    const { problem } = planWorkflowState({
      code: current.code,
      name,
      description,
      sortOrder,
    });
    if (problem !== null) {
      throw AppException.badRequest(workflowStateProblemMessage(problem));
    }

    try {
      const updated = await this.repository.updateInDraftVersion(
        version.id,
        id,
        {
          name,
          description,
          isInitial: input.isInitial ?? current.isInitial,
          isTerminal: input.isTerminal ?? current.isTerminal,
          isActive: input.isActive ?? current.isActive,
          sortOrder,
          updatedAt: new Date(),
          updatedBy: getPrincipal()?.userId ?? null,
        },
      );
      if (updated === null) throw AppException.notFound('Workflow state', id);
      this.logger.log(
        'Workflow state updated',
        { stateId: updated.id, versionId: version.id },
        WorkflowStatesService.name,
      );
      return toWorkflowStateDto(updated);
    } catch (error) {
      mapExecutionError(error);
    }
  }

  async deleteState(organizationId: string, id: string): Promise<void> {
    await this.authorization.requireAllPermissions([
      WORKFLOW_VERSION_PERMISSIONS.EDIT,
    ]);
    await this.organizations.requireUsableOrganization(organizationId);
    const current = await this.mustFindInOrganization(organizationId, id);
    const version = await this.versions.requireDraftVersionInOrganization(
      organizationId,
      current.versionId,
    );

    const touching = await this.transitions.countTouchingState(
      version.id,
      current.id,
    );
    if (touching > 0) {
      throw AppException.businessRule(
        `The workflow state is referenced by ${touching} transition${touching === 1 ? '' : 's'}. Remove the transitions before deleting the state.`,
      );
    }

    try {
      const deleted = await this.repository.deleteInDraftVersion(
        version.id,
        id,
      );
      if (deleted === null) throw AppException.notFound('Workflow state', id);
      this.logger.log(
        'Workflow state deleted',
        { stateId: id, versionId: version.id },
        WorkflowStatesService.name,
      );
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw AppException.businessRule(
          'The workflow state is referenced by a transition. Remove the transitions before deleting the state.',
        );
      }
      mapExecutionError(error);
    }
  }

  /**
   * Cross-service resolution (AR-07 within the module): transitions resolve
   * their endpoint states through this method. No permission of its own —
   * the calling service has already authorized its action.
   */
  async requireStateInOrganization(
    organizationId: string,
    id: string,
  ): Promise<WorkflowState> {
    return this.mustFindInOrganization(organizationId, id);
  }

  // ---- internals ----------------------------------------------------------

  private async mustFindInOrganization(
    organizationId: string,
    id: string,
  ): Promise<WorkflowState> {
    const state = await this.repository.findById(id);
    if (state === null || state.organizationId !== organizationId) {
      throw AppException.notFound('Workflow state', id);
    }
    return state;
  }
}
