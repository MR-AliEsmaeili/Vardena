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
import { WorkflowDefinitionsRepository } from '../data/workflow-definitions.repository.js';
import type {
  WorkflowDefinition,
  WorkflowDefinitionDto,
} from '../domain/workflow-definition.js';
import {
  planWorkflowDefinition,
  toWorkflowDefinitionDto,
  workflowDefinitionProblemMessage,
} from '../domain/workflow-definition.js';
import { WORKFLOW_DEFINITION_PERMISSIONS } from '../domain/workflow-permissions.js';
import {
  normalizeWorkflowCode,
  normalizeWorkflowName,
  normalizeWorkflowText,
} from '../domain/workflow-codes.js';
import { resolveSort } from './workflow-support.js';

/** Sortable list fields; anything else is rejected (`architecture.md` §9). */
const SORTABLE_FIELDS: Record<string, string> = {
  code: 'code',
  name: 'name',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

export interface ListWorkflowDefinitionsQuery {
  /** Mandatory: a definition list is never cross-organization. */
  organizationId: string;
  page: number;
  pageSize: number;
  isActive?: boolean | undefined;
  search?: string | undefined;
  sort?: string | undefined;
}

export interface CreateWorkflowDefinitionInput {
  organizationId: string;
  code: string;
  name: string;
  description?: string | null | undefined;
}

export interface UpdateWorkflowDefinitionInput {
  name?: string | undefined;
  description?: string | null | undefined;
  isActive?: boolean | undefined;
}

/**
 * Workflow definition administration (Task 9 §5).
 *
 * Every method enforces its `Workflow.Definition.*` permission in THIS
 * layer (AR-04, AR-21) and scopes by the caller's organization: a
 * definition from another organization is reported as NOT FOUND rather
 * than as a cross-organization error, so reads never confirm that an id
 * belonging to a different organization exists (Task 9 §10 — no IDOR).
 *
 * Codes are immutable after creation; versions carry behaviour changes.
 * Disabling a definition blocks NEW bindings and NEW version activations;
 * in-flight instances keep transitioning under their pinned version.
 */
@Injectable()
export class WorkflowDefinitionsService {
  constructor(
    private readonly repository: WorkflowDefinitionsRepository,
    private readonly organizations: OrganizationsService,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
  ) {}

  async listDefinitions(
    query: ListWorkflowDefinitionsQuery,
  ): Promise<PaginatedResult<WorkflowDefinitionDto>> {
    await this.authorization.requireAllPermissions([
      WORKFLOW_DEFINITION_PERMISSIONS.VIEW,
    ]);
    await this.organizations.assertOrganizationInScope(query.organizationId);
    const { skip, take } = toOffset(query.page, query.pageSize);
    const { items, total } = await this.repository.list({
      where: {
        organizationId: query.organizationId,
        isActive: query.isActive,
        search: query.search,
      },
      orderBy: resolveSort(query.sort, SORTABLE_FIELDS, [{ code: 'asc' }]),
      skip,
      take,
    });
    return toPaginatedResult(
      items.map(toWorkflowDefinitionDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  async getDefinition(
    organizationId: string,
    id: string,
  ): Promise<WorkflowDefinitionDto> {
    await this.authorization.requireAllPermissions([
      WORKFLOW_DEFINITION_PERMISSIONS.VIEW,
    ]);
    await this.organizations.assertOrganizationInScope(organizationId);
    return toWorkflowDefinitionDto(
      await this.mustFindInOrganization(organizationId, id),
    );
  }

  async createDefinition(
    input: CreateWorkflowDefinitionInput,
  ): Promise<WorkflowDefinitionDto> {
    await this.authorization.requireAllPermissions([
      WORKFLOW_DEFINITION_PERMISSIONS.CREATE,
    ]);
    await this.organizations.requireUsableOrganization(input.organizationId);

    const code = normalizeWorkflowCode(input.code);
    const name = normalizeWorkflowName(input.name);
    const description = normalizeWorkflowText(input.description);
    const { problem } = planWorkflowDefinition({ code, name, description });
    if (problem !== null) {
      throw AppException.badRequest(workflowDefinitionProblemMessage(problem));
    }

    const existing = await this.repository.findByCode(
      input.organizationId,
      code,
    );
    if (existing !== null) {
      throw AppException.conflict(
        'A workflow definition with that code already exists in this organization.',
      );
    }

    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    try {
      const created = await this.repository.create({
        id: generateId(),
        organizationId: input.organizationId,
        code,
        name,
        description,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        createdBy: actorId,
        updatedBy: actorId,
      });
      this.logger.log(
        'Workflow definition created',
        { definitionId: created.id, organizationId: created.organizationId },
        WorkflowDefinitionsService.name,
      );
      return toWorkflowDefinitionDto(created);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppException.conflict(
          'A workflow definition with that code already exists in this organization.',
        );
      }
      throw error;
    }
  }

  async updateDefinition(
    organizationId: string,
    id: string,
    input: UpdateWorkflowDefinitionInput,
  ): Promise<WorkflowDefinitionDto> {
    await this.authorization.requireAllPermissions([
      WORKFLOW_DEFINITION_PERMISSIONS.EDIT,
    ]);
    await this.organizations.requireUsableOrganization(organizationId);
    const current = await this.mustFindInOrganization(organizationId, id);

    const name =
      input.name === undefined
        ? current.name
        : normalizeWorkflowName(input.name);
    const description =
      input.description === undefined
        ? current.description
        : normalizeWorkflowText(input.description);
    const { problem } = planWorkflowDefinition({
      code: current.code,
      name,
      description,
    });
    if (problem !== null) {
      throw AppException.badRequest(workflowDefinitionProblemMessage(problem));
    }

    const updated = await this.repository.update(id, {
      name,
      description,
      isActive: input.isActive ?? current.isActive,
      updatedAt: new Date(),
      updatedBy: getPrincipal()?.userId ?? null,
    });
    if (updated === null)
      throw AppException.notFound('Workflow definition', id);
    this.logger.log(
      'Workflow definition updated',
      { definitionId: updated.id, organizationId: updated.organizationId },
      WorkflowDefinitionsService.name,
    );
    return toWorkflowDefinitionDto(updated);
  }

  /**
   * Cross-service resolution (AR-07 within the module): versions and
   * instances resolve their definition through this method. No permission
   * of its own — the calling service has already authorized its action.
   */
  async requireDefinitionInOrganization(
    organizationId: string,
    id: string,
  ): Promise<WorkflowDefinition> {
    return this.mustFindInOrganization(organizationId, id);
  }

  // ---- internals ----------------------------------------------------------

  private async mustFindInOrganization(organizationId: string, id: string) {
    const definition = await this.repository.findById(id);
    if (definition === null || definition.organizationId !== organizationId) {
      throw AppException.notFound('Workflow definition', id);
    }
    return definition;
  }
}
