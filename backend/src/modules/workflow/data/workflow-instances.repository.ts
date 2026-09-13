import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import type { WorkflowInstance } from '../domain/workflow-instance.js';
import type { WorkflowTransitionHistory } from '../domain/workflow-history.js';
import type { WorkflowTransition } from '../domain/workflow-transition.js';
import { planTransitionExecution } from '../domain/workflow-transition.js';
import {
  WorkflowApprovalStaleError,
  WorkflowExecutionError,
} from './workflow-errors.js';
import { insertHistoryRow } from './workflow-history.repository.js';
import { lockInstanceRow } from './workflow-locks.js';
import { toTransitionDomain } from './workflow-transitions.repository.js';
import type {
  OrderBy,
  WorkflowInstanceCreate,
  WorkflowInstanceDelegate,
  WorkflowInstanceRow,
  WorkflowInstanceWhere,
  WorkflowTransactionalClient,
} from './workflow-rows.js';

/**
 * Data access for `workflow.workflow_instances` + the transition execution
 * transaction (Task 9 §12/§20/§21, ADR-0024).
 *
 * `executeTransition` owns ONE transaction shaped like the inventory posting
 * path:
 *
 *   1. lock the instance row (`SELECT … FOR UPDATE`),
 *   2. re-read transition + states + approval + history length under the lock,
 *   3. decide via the domain decision table (`planTransitionExecution`),
 *   4. update the current state and insert the history row.
 *
 * Two concurrent transitions for one instance serialize on the lock: the
 * winner commits, the loser re-reads the winner's state and fails cleanly
 * with `not_in_source_state` (mapped to 409 — nothing is partially written).
 * The `(instance_id, sequence)` unique index is the backstop.
 *
 * What is checked WHERE is deliberate: organization membership and row
 * existence are verified here (null → the service's 404, so no cross-org
 * oracle exists); RBAC is enforced by the SERVICE before entering (the
 * transaction receives the already-decided `actorPermitted` flag and keeps
 * the permission branch as defense in depth for direct repository callers).
 */

export interface WorkflowInstanceListFilter {
  /** Always set by the service: an instance list is never cross-organization. */
  organizationId: string;
  definitionId?: string | undefined;
  versionId?: string | undefined;
  currentStateId?: string | undefined;
  entityModule?: string | undefined;
  entityType?: string | undefined;
  entityId?: string | undefined;
}

export interface ExecuteTransitionInput {
  instanceId: string;
  organizationId: string;
  transitionId: string;
  historyId: string;
  /** Already-decided by the service via `AuthorizationService`. */
  actorPermitted: boolean;
  actorId: string | null;
  comment: string | null;
  /** Required when the transition requires approval. */
  approvalId: string | null;
  correlationId: string | null;
  now: Date;
}

export interface ExecuteTransitionResult {
  instance: WorkflowInstance;
  history: WorkflowTransitionHistory;
  transition: WorkflowTransition;
}

type Client = {
  workflowInstance: WorkflowInstanceDelegate;
};

@Injectable()
export class WorkflowInstancesRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  private transacting(): Promise<WorkflowTransactionalClient> {
    return this.prisma.getClient<WorkflowTransactionalClient>();
  }

  async findById(id: string): Promise<WorkflowInstance | null> {
    const { workflowInstance } = await this.client();
    const row = await workflowInstance.findUnique({ where: { id } });
    return row === null ? null : toDomain(row);
  }

  async findByEntity(
    organizationId: string,
    entityModule: string,
    entityType: string,
    entityId: string,
  ): Promise<WorkflowInstance | null> {
    const { workflowInstance } = await this.client();
    const row = await workflowInstance.findFirst({
      where: { organizationId, entityModule, entityType, entityId },
    });
    return row === null ? null : toDomain(row);
  }

  async list(params: {
    where: WorkflowInstanceListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: WorkflowInstance[]; total: number }> {
    const { workflowInstance } = await this.client();
    const where = toWhere(params.where);
    const [rows, total] = await Promise.all([
      workflowInstance.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      workflowInstance.count({ where }),
    ]);
    return { items: rows.map(toDomain), total };
  }

  /**
   * Bind an entity (single insert — no transaction needed). The
   * `(organization, module, type, id)` unique index is authoritative: a
   * double-bind races into P2002, which the service maps to 409. Binding to
   * a version that a concurrent publish just superseded is benign — the
   * instance pins a version that was active when resolved, and pinned
   * versions stay executable (Task 9 §23).
   */
  async create(input: WorkflowInstanceCreate): Promise<WorkflowInstance> {
    const { workflowInstance } = await this.client();
    return toDomain(await workflowInstance.create({ data: input }));
  }

  /**
   * Execute a transition atomically (see the class docs for the shape).
   *
   * @returns null when the instance does not exist or belongs to another
   *   organization (the service maps both to 404).
   * @throws WorkflowExecutionError when the locked decision table rejects
   *   the transition (nothing is written).
   * @throws WorkflowApprovalStaleError when the cited approval was approved
   *   but went stale before execution.
   */
  async executeTransition(
    input: ExecuteTransitionInput,
  ): Promise<ExecuteTransitionResult | null> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      const locked = await lockInstanceRow(tx, input.instanceId);
      if (locked === null || locked.organizationId !== input.organizationId) {
        return null;
      }
      const transitionRow = await tx.workflowTransition.findUnique({
        where: { id: input.transitionId },
      });
      if (
        transitionRow === null ||
        transitionRow.organizationId !== input.organizationId ||
        transitionRow.versionId !== locked.versionId
      ) {
        // Missing here means "not this instance's version": the service
        // 404s unknown transitions before entering, so in-tx this is a
        // version mismatch (or a caller bug for direct repository use).
        throw new WorkflowExecutionError('version_mismatch');
      }
      const [source, target, historyLength] = await Promise.all([
        tx.workflowState.findUnique({
          where: { id: transitionRow.sourceStateId },
        }),
        tx.workflowState.findUnique({
          where: { id: transitionRow.targetStateId },
        }),
        tx.workflowTransitionHistory.count({
          where: { instanceId: locked.id },
        }),
      ]);
      if (source === null || target === null) {
        // Active versions are immutable and states are RESTRICT-deleted:
        // an endpoint that vanished mid-flight is a bug, not a rejection.
        throw new Error(
          `Workflow transition "${transitionRow.id}" references a state that no longer exists.`,
        );
      }

      // Approval facts: loaded under the lock so freshness is exact.
      let approvalSatisfied = !transitionRow.requiresApproval;
      let approvalIsStale = false;
      if (transitionRow.requiresApproval) {
        if (input.approvalId !== null) {
          const approval = await tx.workflowApproval.findUnique({
            where: { id: input.approvalId },
          });
          const matches =
            approval !== null &&
            approval.instanceId === locked.id &&
            approval.transitionId === transitionRow.id &&
            approval.status === 'approved';
          if (matches && approval.baseSequence === historyLength) {
            approvalSatisfied = true;
          } else if (matches && approval.baseSequence !== historyLength) {
            approvalIsStale = true;
          }
        }
      }

      const { problem } = planTransitionExecution({
        versionMatches: true,
        sourceIsCurrent: locked.currentStateId === transitionRow.sourceStateId,
        transitionEnabled: transitionRow.isActive,
        statesEnabled: source.isActive && target.isActive,
        sourceIsTerminal: source.isTerminal,
        actorPermitted: input.actorPermitted,
        commentSatisfied:
          !transitionRow.requiresComment ||
          (input.comment !== null && input.comment.trim() !== ''),
        actorDiffersSatisfied:
          !transitionRow.requireDifferentActor ||
          input.actorId === null ||
          input.actorId !== locked.createdBy,
        approvalSatisfied,
      });
      if (problem !== null) {
        if (problem === 'approval_required' && approvalIsStale) {
          throw new WorkflowApprovalStaleError(
            'The approval is stale: the workflow moved since it was requested, so it can no longer be used.',
          );
        }
        throw new WorkflowExecutionError(problem);
      }

      const sequence = historyLength + 1;
      const [updated, history] = await Promise.all([
        tx.workflowInstance.update({
          where: { id: locked.id },
          data: {
            currentStateId: transitionRow.targetStateId,
            updatedAt: input.now,
            updatedBy: input.actorId,
          },
        }),
        insertHistoryRow(tx, {
          id: input.historyId,
          organizationId: locked.organizationId,
          instanceId: locked.id,
          versionId: locked.versionId,
          transitionId: transitionRow.id,
          fromStateId: transitionRow.sourceStateId,
          toStateId: transitionRow.targetStateId,
          sequence,
          actorId: input.actorId,
          comment: input.comment,
          approvalId: transitionRow.requiresApproval ? input.approvalId : null,
          correlationId: input.correlationId,
          occurredAt: input.now,
          createdAt: input.now,
          updatedAt: input.now,
          createdBy: input.actorId,
          updatedBy: input.actorId,
        }),
      ]);
      return {
        instance: toDomain(updated),
        history,
        transition: toTransitionDomain(transitionRow),
      };
    });
  }
}

// ---- Internal helpers ----

function toWhere(filter: WorkflowInstanceListFilter): WorkflowInstanceWhere {
  const where: WorkflowInstanceWhere = {
    organizationId: filter.organizationId,
  };
  if (filter.definitionId !== undefined) {
    where.definitionId = filter.definitionId;
  }
  if (filter.versionId !== undefined) where.versionId = filter.versionId;
  if (filter.currentStateId !== undefined) {
    where.currentStateId = filter.currentStateId;
  }
  if (filter.entityModule !== undefined) {
    where.entityModule = filter.entityModule;
  }
  if (filter.entityType !== undefined) where.entityType = filter.entityType;
  if (filter.entityId !== undefined) where.entityId = filter.entityId;
  return where;
}

function toDomain(row: WorkflowInstanceRow): WorkflowInstance {
  return {
    id: row.id,
    organizationId: row.organizationId,
    definitionId: row.definitionId,
    versionId: row.versionId,
    entityModule: row.entityModule,
    entityType: row.entityType,
    entityId: row.entityId,
    currentStateId: row.currentStateId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
  };
}
