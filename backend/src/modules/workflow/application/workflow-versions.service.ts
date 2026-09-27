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
import { isUniqueViolation } from '../../../kernel/prisma/prisma-errors.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { WorkflowVersionsRepository } from '../data/workflow-versions.repository.js';
import type {
  WorkflowVersion,
  WorkflowVersionDto,
} from '../domain/workflow-version.js';
import {
  isWorkflowVersionStatus,
  planPublish,
  publishProblemMessage,
  toWorkflowVersionDto,
} from '../domain/workflow-version.js';
import { WORKFLOW_VERSION_PERMISSIONS } from '../domain/workflow-permissions.js';
import { WORKFLOW_VERSION_PUBLISHED_EVENT } from '../domain/workflow.events.js';
import { WorkflowDefinitionsService } from './workflow-definitions.service.js';
import { publishEvent, resolveSort } from './workflow-support.js';

/** Sortable list fields; anything else is rejected (`architecture.md` §9). */
const SORTABLE_FIELDS: Record<string, string> = {
  versionNumber: 'versionNumber',
  status: 'status',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

export interface ListWorkflowVersionsQuery {
  organizationId: string;
  definitionId: string;
  page: number;
  pageSize: number;
  status?: string | undefined;
  sort?: string | undefined;
}

export interface CreateWorkflowVersionInput {
  organizationId: string;
  definitionId: string;
  effectiveFrom?: Date | null | undefined;
}

/**
 * Workflow version administration (Task 9 §6/§23).
 *
 * Versions are created as drafts, configured through the states /
 * transitions / automations services, and published exactly once. Publish
 * validates deterministically (exactly one enabled initial state, no
 * outgoing edge from a terminal state, every transition inside the
 * version), supersedes the previously active version, and emits
 * `WorkflowVersion.Published`. Active and superseded versions are
 * immutable — behaviour changes ship as a NEW version, never as an edit.
 *
 * Organization scoping follows the definition rule: anything from another
 * organization (or another definition) is reported as NOT FOUND (Task 9
 * §10 — no IDOR).
 */
@Injectable()
export class WorkflowVersionsService {
  constructor(
    private readonly repository: WorkflowVersionsRepository,
    private readonly definitions: WorkflowDefinitionsService,
    private readonly organizations: OrganizationsService,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  async listVersions(
    query: ListWorkflowVersionsQuery,
  ): Promise<PaginatedResult<WorkflowVersionDto>> {
    await this.authorization.requireAllPermissions([
      WORKFLOW_VERSION_PERMISSIONS.VIEW,
    ]);
    await this.organizations.assertOrganizationInScope(query.organizationId);
    await this.definitions.requireDefinitionInOrganization(
      query.organizationId,
      query.definitionId,
    );
    if (query.status !== undefined && !isWorkflowVersionStatus(query.status)) {
      throw AppException.badRequest(
        'Status must be one of: draft, active, superseded.',
      );
    }
    const { skip, take } = toOffset(query.page, query.pageSize);
    const { items, total } = await this.repository.list({
      where: {
        organizationId: query.organizationId,
        definitionId: query.definitionId,
        status: query.status,
      },
      orderBy: resolveSort(query.sort, SORTABLE_FIELDS, [
        { versionNumber: 'desc' },
      ]),
      skip,
      take,
    });
    return toPaginatedResult(
      items.map(toWorkflowVersionDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  async getVersion(
    organizationId: string,
    id: string,
  ): Promise<WorkflowVersionDto> {
    await this.authorization.requireAllPermissions([
      WORKFLOW_VERSION_PERMISSIONS.VIEW,
    ]);
    await this.organizations.assertOrganizationInScope(organizationId);
    return toWorkflowVersionDto(
      await this.mustFindInOrganization(organizationId, id),
    );
  }

  async createVersion(
    input: CreateWorkflowVersionInput,
  ): Promise<WorkflowVersionDto> {
    await this.authorization.requireAllPermissions([
      WORKFLOW_VERSION_PERMISSIONS.CREATE,
    ]);
    await this.organizations.requireUsableOrganization(input.organizationId);
    const definition = await this.definitions.requireDefinitionInOrganization(
      input.organizationId,
      input.definitionId,
    );
    if (!definition.isActive) {
      throw AppException.businessRule(
        'The workflow definition is disabled, so no new version can be created for it.',
      );
    }

    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    // Version numbers are max + 1 per definition; two concurrent creates
    // race into P2002 and the loser retries with the recomputed number.
    let created: WorkflowVersion | null = null;
    for (let attempt = 0; attempt < 3 && created === null; attempt += 1) {
      const latest = await this.repository.findLatestForDefinition(
        input.definitionId,
      );
      const versionNumber = (latest?.versionNumber ?? 0) + 1;
      try {
        created = await this.repository.create({
          id: generateId(),
          organizationId: input.organizationId,
          definitionId: input.definitionId,
          versionNumber,
          status: 'draft',
          effectiveFrom: input.effectiveFrom ?? null,
          createdAt: now,
          updatedAt: now,
          createdBy: actorId,
          updatedBy: actorId,
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        if (attempt === 2) {
          throw AppException.conflict(
            'A workflow version was created concurrently. Retry the request.',
          );
        }
      }
    }
    const version = created as WorkflowVersion;
    this.logger.log(
      'Workflow version created',
      {
        versionId: version.id,
        definitionId: version.definitionId,
        versionNumber: version.versionNumber,
      },
      WorkflowVersionsService.name,
    );
    return toWorkflowVersionDto(version);
  }

  async publishVersion(
    organizationId: string,
    id: string,
  ): Promise<WorkflowVersionDto> {
    await this.authorization.requireAllPermissions([
      WORKFLOW_VERSION_PERMISSIONS.PUBLISH,
    ]);
    await this.organizations.requireUsableOrganization(organizationId);
    const current = await this.mustFindInOrganization(organizationId, id);
    if (current.status !== 'draft') {
      throw AppException.businessRule(
        `Only a draft workflow version can be published (this one is "${current.status}").`,
      );
    }
    const definition = await this.definitions.requireDefinitionInOrganization(
      organizationId,
      current.definitionId,
    );
    if (!definition.isActive) {
      throw AppException.businessRule(
        'The workflow definition is disabled, so its versions cannot be published.',
      );
    }

    // Fast-fail outside the transaction with the same decision table the
    // transaction re-applies under the lock.
    const preview = await this.repository.listStatesAndTransitions(id);
    this.assertPublishable(preview.states, preview.transitions);

    const actorId = getPrincipal()?.userId ?? null;
    const published = await this.repository.publish(
      {
        definitionId: current.definitionId,
        versionId: id,
        organizationId,
        actorId,
        now: new Date(),
      },
      (snapshot) => {
        if (snapshot.version.status !== 'draft') {
          throw AppException.conflict(
            'The workflow version is no longer a draft. Re-read it before retrying.',
          );
        }
        this.assertPublishable(snapshot.states, snapshot.transitions);
      },
    );
    if (published === null) {
      throw AppException.notFound('Workflow version', id);
    }

    await publishEvent(this.events, {
      type: WORKFLOW_VERSION_PUBLISHED_EVENT,
      aggregateType: 'WorkflowVersion',
      aggregateId: published.version.id,
      payload: {
        definitionId: published.version.definitionId,
        versionId: published.version.id,
        organizationId: published.version.organizationId,
        versionNumber: published.version.versionNumber,
        supersededVersionId: published.supersededVersionId,
      },
    });
    this.logger.log(
      'Workflow version published',
      {
        versionId: published.version.id,
        definitionId: published.version.definitionId,
        versionNumber: published.version.versionNumber,
        supersededVersionId: published.supersededVersionId,
      },
      WorkflowVersionsService.name,
    );
    return toWorkflowVersionDto(published.version);
  }

  /**
   * Cross-service resolution (AR-07 within the module): configuration and
   * runtime services resolve their version through these methods. No
   * permission of their own — the calling service has already authorized
   * its action.
   */
  async requireVersionInOrganization(
    organizationId: string,
    id: string,
  ): Promise<WorkflowVersion> {
    return this.mustFindInOrganization(organizationId, id);
  }

  /** A version whose draft configuration may still change (else 422). */
  async requireDraftVersionInOrganization(
    organizationId: string,
    id: string,
  ): Promise<WorkflowVersion> {
    const version = await this.mustFindInOrganization(organizationId, id);
    if (version.status !== 'draft') {
      throw AppException.businessRule(
        `Workflow version ${version.versionNumber} is "${version.status}" and cannot be changed. Create a new version instead.`,
      );
    }
    return version;
  }

  /**
   * The version a NEW binding resolves to: the explicit one when given
   * (which must belong to the definition and be active), otherwise the
   * definition's active version. Anything else is a 422 — drafts and
   * superseded versions are never selected for new bindings (Task 9 §6).
   */
  async requireBindableVersion(
    organizationId: string,
    definitionId: string,
    versionId: string | null,
  ): Promise<WorkflowVersion> {
    if (versionId !== null) {
      const version = await this.mustFindInOrganization(
        organizationId,
        versionId,
      );
      if (version.definitionId !== definitionId) {
        throw AppException.businessRule(
          'The workflow version does not belong to this workflow definition.',
        );
      }
      if (version.status !== 'active') {
        throw AppException.businessRule(
          `Workflow version ${version.versionNumber} is "${version.status}". Only the active version accepts new bindings.`,
        );
      }
      return version;
    }
    const active = await this.repository.findActiveForDefinition(definitionId);
    if (active === null || active.organizationId !== organizationId) {
      throw AppException.businessRule(
        'The workflow definition has no active version. Publish one before binding entities.',
      );
    }
    return active;
  }

  // ---- internals ----------------------------------------------------------

  private assertPublishable(
    states: Array<{
      id: string;
      code: string;
      isInitial: boolean;
      isTerminal: boolean;
      isActive: boolean;
    }>,
    transitions: Array<{
      id: string;
      code: string;
      sourceStateId: string;
      targetStateId: string;
      isActive: boolean;
    }>,
  ): void {
    const { problem, subject } = planPublish({ states, transitions });
    if (problem === null) return;
    const message = publishProblemMessage(problem);
    throw AppException.businessRule(
      subject === undefined ? message : `${message} (at "${subject}")`,
    );
  }

  private async mustFindInOrganization(
    organizationId: string,
    id: string,
  ): Promise<WorkflowVersion> {
    const version = await this.repository.findById(id);
    if (version === null || version.organizationId !== organizationId) {
      throw AppException.notFound('Workflow version', id);
    }
    return version;
  }
}
