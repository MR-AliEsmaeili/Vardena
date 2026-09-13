import { Inject, Injectable } from '@nestjs/common';
import {
  DOMAIN_EVENT_BUS,
  type DomainEventBus,
} from '../../../kernel/events/domain-event-bus.js';
import { generateId } from '../../../kernel/ids/ulid.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import {
  getCorrelationId,
  getPrincipal,
} from '../../../kernel/correlation/request-context.js';
import {
  toOffset,
  toPaginatedResult,
  type PaginatedResult,
} from '../../../kernel/pagination/paginated-result.js';
import { isUniqueViolation } from '../../../kernel/prisma/prisma-errors.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { WorkflowAutomationsRepository } from '../data/workflow-automations.repository.js';
import { WorkflowHistoryRepository } from '../data/workflow-history.repository.js';
import { WorkflowInstancesRepository } from '../data/workflow-instances.repository.js';
import { WorkflowStatesRepository } from '../data/workflow-states.repository.js';
import { WorkflowTransitionsRepository } from '../data/workflow-transitions.repository.js';
import { WorkflowVersionsRepository } from '../data/workflow-versions.repository.js';
import type {
  WorkflowInstance,
  WorkflowInstanceDto,
} from '../domain/workflow-instance.js';
import {
  planEntityReference,
  entityReferenceProblemMessage,
  toWorkflowInstanceDto,
} from '../domain/workflow-instance.js';
import type { WorkflowTransitionHistoryDto } from '../domain/workflow-history.js';
import { toWorkflowTransitionHistoryDto } from '../domain/workflow-history.js';
import type { WorkflowStateDto } from '../domain/workflow-state.js';
import { toWorkflowStateDto } from '../domain/workflow-state.js';
import type { WorkflowTransitionDto } from '../domain/workflow-transition.js';
import {
  isTransitionPermitted,
  toWorkflowTransitionDto,
} from '../domain/workflow-transition.js';
import { WORKFLOW_INSTANCE_PERMISSIONS } from '../domain/workflow-permissions.js';
import {
  WORKFLOW_INSTANCE_BOUND_EVENT,
  WORKFLOW_TRANSITION_COMPLETED_EVENT,
} from '../domain/workflow.events.js';
import { normalizeWorkflowText } from '../domain/workflow-codes.js';
import { WorkflowDefinitionsService } from './workflow-definitions.service.js';
import { WorkflowTransitionsService } from './workflow-transitions.service.js';
import { WorkflowVersionsService } from './workflow-versions.service.js';
import {
  mapExecutionError,
  publishEvent,
  resolveSort,
} from './workflow-support.js';

/** Sortable list fields; anything else is rejected (`architecture.md` §9). */
const SORTABLE_FIELDS: Record<string, string> = {
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

const HISTORY_SORTABLE_FIELDS: Record<string, string> = {
  sequence: 'sequence',
  occurredAt: 'occurredAt',
};

export interface ListWorkflowInstancesQuery {
  /** Mandatory: an instance list is never cross-organization. */
  organizationId: string;
  page: number;
  pageSize: number;
  definitionId?: string | undefined;
  versionId?: string | undefined;
  currentStateId?: string | undefined;
  entityModule?: string | undefined;
  entityType?: string | undefined;
  entityId?: string | undefined;
  sort?: string | undefined;
}

export interface BindWorkflowInstanceInput {
  organizationId: string;
  definitionId: string;
  /** Null = the definition's active version. */
  versionId?: string | null | undefined;
  entityModule: string;
  entityType: string;
  entityId: string;
}

export interface ExecuteWorkflowTransitionInput {
  organizationId: string;
  instanceId: string;
  transitionId: string;
  comment?: string | null | undefined;
  /** Required when the transition requires approval. */
  approvalId?: string | null | undefined;
}

export interface AvailableTransitionDto extends WorkflowTransitionDto {
  /** Whether the caller holds the transition's required permission. */
  permitted: boolean;
}

export interface AvailableTransitionsView {
  instance: WorkflowInstanceDto;
  currentState: WorkflowStateDto;
  isTerminal: boolean;
  transitions: AvailableTransitionDto[];
}

export interface ExecuteTransitionView {
  instance: WorkflowInstanceDto;
  history: WorkflowTransitionHistoryDto;
  transition: WorkflowTransitionDto;
}

export interface ListWorkflowHistoryQuery {
  organizationId: string;
  instanceId: string;
  page: number;
  pageSize: number;
  sort?: string | undefined;
}

/**
 * Workflow runtime (Task 9 §11/§12/§13/§20).
 *
 * Binds entities to workflow versions (pinned forever — never silently
 * migrated), reports current state + available transitions + history, and
 * executes transitions through the locked transaction:
 *
 *   authorize (workflow permission + the transition's own permission)
 *     → lock instance → re-validate under the lock → apply state change
 *     → insert history → commit → publish `WorkflowTransition.Completed`.
 *
 * The service re-checks BOTH permissions (AR-04/AR-21) and never trusts
 * the controller guard alone; cross-organization instances are reported
 * as NOT FOUND (Task 9 §10 — no IDOR).
 *
 * Public surface (AR-07): future business modules bind and transition
 * their entities through `bindInstance` / `executeTransition` instead of
 * touching `workflow.*` tables.
 */
@Injectable()
export class WorkflowInstancesService {
  constructor(
    private readonly repository: WorkflowInstancesRepository,
    private readonly definitions: WorkflowDefinitionsService,
    private readonly versions: WorkflowVersionsService,
    private readonly transitions: WorkflowTransitionsService,
    private readonly transitionRows: WorkflowTransitionsRepository,
    private readonly stateRows: WorkflowStatesRepository,
    private readonly versionRows: WorkflowVersionsRepository,
    private readonly history: WorkflowHistoryRepository,
    private readonly automations: WorkflowAutomationsRepository,
    private readonly organizations: OrganizationsService,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  async listInstances(
    query: ListWorkflowInstancesQuery,
  ): Promise<PaginatedResult<WorkflowInstanceDto>> {
    await this.authorization.requireAllPermissions([
      WORKFLOW_INSTANCE_PERMISSIONS.VIEW,
    ]);
    const { skip, take } = toOffset(query.page, query.pageSize);
    const { items, total } = await this.repository.list({
      where: {
        organizationId: query.organizationId,
        definitionId: query.definitionId,
        versionId: query.versionId,
        currentStateId: query.currentStateId,
        entityModule: query.entityModule,
        entityType: query.entityType,
        entityId: query.entityId,
      },
      orderBy: resolveSort(query.sort, SORTABLE_FIELDS, [
        { createdAt: 'desc' },
      ]),
      skip,
      take,
    });
    return toPaginatedResult(
      items.map(toWorkflowInstanceDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  async getInstance(
    organizationId: string,
    id: string,
  ): Promise<WorkflowInstanceDto> {
    await this.authorization.requireAllPermissions([
      WORKFLOW_INSTANCE_PERMISSIONS.VIEW,
    ]);
    return toWorkflowInstanceDto(
      await this.mustFindInOrganization(organizationId, id),
    );
  }

  async bindInstance(
    input: BindWorkflowInstanceInput,
  ): Promise<WorkflowInstanceDto> {
    await this.authorization.requireAllPermissions([
      WORKFLOW_INSTANCE_PERMISSIONS.BIND,
    ]);
    await this.organizations.requireUsableOrganization(input.organizationId);
    const definition = await this.definitions.requireDefinitionInOrganization(
      input.organizationId,
      input.definitionId,
    );
    if (!definition.isActive) {
      throw AppException.businessRule(
        'The workflow definition is disabled, so no new entity can be bound to it.',
      );
    }
    const version = await this.versions.requireBindableVersion(
      input.organizationId,
      input.definitionId,
      input.versionId ?? null,
    );

    const entityModule = input.entityModule.trim();
    const entityType = input.entityType.trim();
    const entityId = input.entityId.trim();
    const { problem } = planEntityReference({
      entityModule,
      entityType,
      entityId,
    });
    if (problem !== null) {
      throw AppException.badRequest(entityReferenceProblemMessage(problem));
    }

    const existing = await this.repository.findByEntity(
      input.organizationId,
      entityModule,
      entityType,
      entityId,
    );
    if (existing !== null) {
      throw AppException.conflict(
        'The entity is already bound to a workflow. An entity has exactly one live binding.',
      );
    }

    // The initial state is deterministic by publish validation (exactly one
    // enabled initial state); the lookup below is defense in depth.
    const initial = await this.findInitialState(version.id);
    if (initial === null) {
      throw AppException.businessRule(
        'The workflow version has no usable initial state, so nothing can be bound to it.',
      );
    }

    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    try {
      const created = await this.repository.create({
        id: generateId(),
        organizationId: input.organizationId,
        definitionId: definition.id,
        versionId: version.id,
        entityModule,
        entityType,
        entityId,
        currentStateId: initial.id,
        createdAt: now,
        updatedAt: now,
        createdBy: actorId,
        updatedBy: actorId,
      });
      await publishEvent(this.events, {
        type: WORKFLOW_INSTANCE_BOUND_EVENT,
        aggregateType: 'WorkflowInstance',
        aggregateId: created.id,
        payload: {
          instanceId: created.id,
          organizationId: created.organizationId,
          definitionId: created.definitionId,
          versionId: created.versionId,
          entity: { module: entityModule, entityType, entityId },
          initialStateId: initial.id,
        },
      });
      this.logger.log(
        'Workflow instance bound',
        {
          instanceId: created.id,
          versionId: version.id,
          entityModule,
          entityType,
        },
        WorkflowInstancesService.name,
      );
      return toWorkflowInstanceDto(created);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppException.conflict(
          'The entity is already bound to a workflow. An entity has exactly one live binding.',
        );
      }
      throw error;
    }
  }

  async listAvailableTransitions(
    organizationId: string,
    instanceId: string,
  ): Promise<AvailableTransitionsView> {
    await this.authorization.requireAllPermissions([
      WORKFLOW_INSTANCE_PERMISSIONS.VIEW,
    ]);
    const instance = await this.mustFindInOrganization(
      organizationId,
      instanceId,
    );
    const currentState = await this.stateRows.findById(instance.currentStateId);
    if (currentState === null) {
      // States are RESTRICT-deleted: a current state that vanished is a bug.
      throw new Error(
        `Workflow instance "${instance.id}" references a state that no longer exists.`,
      );
    }
    const outgoing = currentState.isTerminal
      ? []
      : await this.transitionRows.listEnabledFromState(
          instance.versionId,
          instance.currentStateId,
        );

    // Permission preview for the caller (the execution path enforces for
    // real). System context has no caller to evaluate — everything reads
    // permitted and enforcement happens at execution time.
    const principal = getPrincipal();
    const effective =
      principal === undefined
        ? null
        : new Set(
            await this.authorization.effectivePermissionCodes(principal.userId),
          );
    return {
      instance: toWorkflowInstanceDto(instance),
      currentState: toWorkflowStateDto(currentState),
      isTerminal: currentState.isTerminal,
      transitions: outgoing.map((transition) => ({
        ...toWorkflowTransitionDto(transition),
        permitted:
          effective === null
            ? true
            : isTransitionPermitted(transition, effective),
      })),
    };
  }

  async executeTransition(
    input: ExecuteWorkflowTransitionInput,
  ): Promise<ExecuteTransitionView> {
    await this.authorization.requireAllPermissions([
      WORKFLOW_INSTANCE_PERMISSIONS.EXECUTE,
    ]);
    await this.organizations.requireUsableOrganization(input.organizationId);
    const instance = await this.mustFindInOrganization(
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
    // The service-level re-check (AR-04/AR-21): the guard's workflow
    // permission is not enough — the caller must ALSO hold the
    // transition's own permission. No wildcard, no bypass (Task 9 §9).
    await this.authorization.requireAllPermissions([
      transition.requiredPermission,
    ]);

    const comment = normalizeWorkflowText(input.comment);
    const approvalId =
      input.approvalId === undefined || input.approvalId === null
        ? null
        : input.approvalId;
    const actorId = getPrincipal()?.userId ?? null;
    const now = new Date();
    try {
      const result = await this.repository.executeTransition({
        instanceId: instance.id,
        organizationId: input.organizationId,
        transitionId: transition.id,
        historyId: generateId(),
        actorPermitted: true,
        actorId,
        comment,
        approvalId,
        correlationId: getCorrelationId() ?? null,
        now,
      });
      if (result === null) {
        throw AppException.notFound('Workflow instance', input.instanceId);
      }
      const bindings = await this.automations.listEnabledForTransition(
        result.transition.id,
      );
      await publishEvent(this.events, {
        type: WORKFLOW_TRANSITION_COMPLETED_EVENT,
        aggregateType: 'WorkflowInstance',
        aggregateId: result.instance.id,
        payload: {
          instanceId: result.instance.id,
          organizationId: result.instance.organizationId,
          definitionId: result.instance.definitionId,
          versionId: result.instance.versionId,
          entity: {
            module: result.instance.entityModule,
            entityType: result.instance.entityType,
            entityId: result.instance.entityId,
          },
          transitionId: result.transition.id,
          transitionCode: result.transition.code,
          fromStateId: result.history.fromStateId,
          toStateId: result.history.toStateId,
          sequence: result.history.sequence,
          actorId,
          approvalId: result.history.approvalId,
          automations: bindings.map((binding) => ({
            action: binding.action,
            parameters: binding.parameters,
          })),
        },
      });
      this.logger.log(
        'Workflow transition executed',
        {
          instanceId: result.instance.id,
          transitionId: result.transition.id,
          fromStateId: result.history.fromStateId,
          toStateId: result.history.toStateId,
          sequence: result.history.sequence,
        },
        WorkflowInstancesService.name,
      );
      return {
        instance: toWorkflowInstanceDto(result.instance),
        history: toWorkflowTransitionHistoryDto(result.history),
        transition: toWorkflowTransitionDto(result.transition),
      };
    } catch (error) {
      mapExecutionError(error);
    }
  }

  async listHistory(
    query: ListWorkflowHistoryQuery,
  ): Promise<PaginatedResult<WorkflowTransitionHistoryDto>> {
    await this.authorization.requireAllPermissions([
      WORKFLOW_INSTANCE_PERMISSIONS.VIEW,
    ]);
    await this.mustFindInOrganization(query.organizationId, query.instanceId);
    const { skip, take } = toOffset(query.page, query.pageSize);
    const { items, total } = await this.history.listByInstance({
      where: {
        organizationId: query.organizationId,
        instanceId: query.instanceId,
      },
      orderBy: resolveSort(query.sort, HISTORY_SORTABLE_FIELDS, [
        { sequence: 'asc' },
      ]),
      skip,
      take,
    });
    return toPaginatedResult(
      items.map(toWorkflowTransitionHistoryDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  /**
   * Cross-service resolution (AR-07 within the module): approvals resolve
   * their instance through this method. No permission of its own — the
   * calling service has already authorized its action.
   */
  async requireInstanceInOrganization(
    organizationId: string,
    id: string,
  ): Promise<WorkflowInstance> {
    return this.mustFindInOrganization(organizationId, id);
  }

  // ---- internals ----------------------------------------------------------

  private async findInitialState(versionId: string) {
    // Already scoped: the version was resolved in-organization by the caller.
    const { states } =
      await this.versionRows.listStatesAndTransitions(versionId);
    return states.find((state) => state.isInitial && state.isActive) ?? null;
  }

  private async mustFindInOrganization(
    organizationId: string,
    id: string,
  ): Promise<WorkflowInstance> {
    const instance = await this.repository.findById(id);
    if (instance === null || instance.organizationId !== organizationId) {
      throw AppException.notFound('Workflow instance', id);
    }
    return instance;
  }
}
