import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import type {
  WorkflowApproval,
  WorkflowApprovalStatus,
} from '../domain/workflow-approval.js';
import {
  WorkflowApprovalPendingError,
  WorkflowApprovalStaleError,
  WorkflowExecutionError,
} from './workflow-errors.js';
import { lockInstanceRow } from './workflow-locks.js';
import type {
  OrderBy,
  WorkflowApprovalDelegate,
  WorkflowApprovalRow,
  WorkflowApprovalWhere,
  WorkflowTransactionalClient,
} from './workflow-rows.js';

/**
 * Data access for `workflow.workflow_approvals` (Task 9, ADR-0024).
 *
 * Request and decide each own ONE transaction on the locked INSTANCE row
 * (not an approval row): the history length they read must be exact, and
 * the lock serializes them against transitions landing concurrently.
 * A request pins `base_sequence` to the locked history length; a decision
 * re-checks `pending` + freshness under the same lock. Stale or
 * already-decided approvals fail here — never at execution time as a
 * surprise, and (via the execution path's own check) never consumable
 * after the fact either.
 */

export interface WorkflowApprovalListFilter {
  organizationId: string;
  instanceId: string;
  status?: string | undefined;
}

export interface RequestApprovalInput {
  organizationId: string;
  instanceId: string;
  versionId: string;
  transitionId: string;
  sourceStateId: string;
  approvalId: string;
  actorId: string | null;
  comment: string | null;
  now: Date;
}

export interface DecideApprovalInput {
  organizationId: string;
  approvalId: string;
  decision: 'approved' | 'rejected';
  actorId: string | null;
  comment: string | null;
  now: Date;
}

type Client = {
  workflowApproval: WorkflowApprovalDelegate;
};

@Injectable()
export class WorkflowApprovalsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  private transacting(): Promise<WorkflowTransactionalClient> {
    return this.prisma.getClient<WorkflowTransactionalClient>();
  }

  async findById(id: string): Promise<WorkflowApproval | null> {
    const { workflowApproval } = await this.client();
    const row = await workflowApproval.findUnique({ where: { id } });
    return row === null ? null : toDomain(row);
  }

  async findPending(
    instanceId: string,
    transitionId: string,
  ): Promise<WorkflowApproval | null> {
    const { workflowApproval } = await this.client();
    const row = await workflowApproval.findFirst({
      where: { instanceId, transitionId, status: 'pending' },
      orderBy: [{ requestedAt: 'desc' }],
    });
    return row === null ? null : toDomain(row);
  }

  async list(params: {
    where: WorkflowApprovalListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: WorkflowApproval[]; total: number }> {
    const { workflowApproval } = await this.client();
    const where = toWhere(params.where);
    const [rows, total] = await Promise.all([
      workflowApproval.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      workflowApproval.count({ where }),
    ]);
    return { items: rows.map(toDomain), total };
  }

  /**
   * Request an approval atomically (see the class docs for the shape).
   *
   * @returns null when the instance does not exist or belongs to another
   *   organization (the service maps both to 404).
   * @throws WorkflowExecutionError(`not_in_source_state`) when the instance
   *   is not in the transition's source state (the service maps it to 422 —
   *   a fresh request for an unavailable transition is a client error).
   * @throws WorkflowApprovalPendingError when a pending approval for the
   *   (instance, transition) already exists (mapped to 409).
   */
  async requestInLock(
    input: RequestApprovalInput,
  ): Promise<WorkflowApproval | null> {
    const { $transaction } = await this.transacting();
    return $transaction(async (tx) => {
      const locked = await lockInstanceRow(tx, input.instanceId);
      if (locked === null || locked.organizationId !== input.organizationId) {
        return null;
      }
      if (locked.currentStateId !== input.sourceStateId) {
        throw new WorkflowExecutionError('not_in_source_state');
      }
      const [historyLength, pending] = await Promise.all([
        tx.workflowTransitionHistory.count({
          where: { instanceId: locked.id },
        }),
        tx.workflowApproval.findFirst({
          where: {
            instanceId: locked.id,
            transitionId: input.transitionId,
            status: 'pending',
          },
        }),
      ]);
      if (pending !== null) {
        throw new WorkflowApprovalPendingError(locked.id, input.transitionId);
      }
      return toDomain(
        await tx.workflowApproval.create({
          data: {
            id: input.approvalId,
            organizationId: locked.organizationId,
            instanceId: locked.id,
            versionId: locked.versionId,
            transitionId: input.transitionId,
            status: 'pending',
            requestedBy: input.actorId,
            requestedAt: input.now,
            decidedBy: null,
            decidedAt: null,
            comment: input.comment,
            baseSequence: historyLength,
            createdAt: input.now,
            updatedAt: input.now,
            createdBy: input.actorId,
            updatedBy: input.actorId,
          },
        }),
      );
    });
  }

  /**
   * Decide an approval atomically (see the class docs for the shape).
   *
   * @returns null when the approval does not exist or belongs to another
   *   organization (the service maps both to 404).
   * @throws WorkflowApprovalStaleError when the approval was already
   *   decided or went stale (mapped to 422).
   */
  async decideInLock(
    input: DecideApprovalInput,
  ): Promise<WorkflowApproval | null> {
    const { $transaction } = await this.transacting();
    return $transaction(async (tx) => {
      const approval = await tx.workflowApproval.findUnique({
        where: { id: input.approvalId },
      });
      if (
        approval === null ||
        approval.organizationId !== input.organizationId
      ) {
        return null;
      }
      if (approval.status !== 'pending') {
        throw new WorkflowApprovalStaleError(
          'The approval has already been decided and cannot be changed.',
        );
      }
      const locked = await lockInstanceRow(tx, approval.instanceId);
      if (locked === null) {
        throw new Error(
          `Workflow instance "${approval.instanceId}" no longer exists.`,
        );
      }
      const historyLength = await tx.workflowTransitionHistory.count({
        where: { instanceId: locked.id },
      });
      if (approval.baseSequence !== historyLength) {
        throw new WorkflowApprovalStaleError(
          'The approval is stale: the workflow moved since it was requested, so it can no longer be decided.',
        );
      }
      return toDomain(
        await tx.workflowApproval.update({
          where: { id: approval.id },
          data: {
            status: input.decision,
            decidedBy: input.actorId,
            decidedAt: input.now,
            comment: input.comment ?? approval.comment,
            updatedAt: input.now,
            updatedBy: input.actorId,
          },
        }),
      );
    });
  }
}

// ---- Internal helpers ----

function toWhere(filter: WorkflowApprovalListFilter): WorkflowApprovalWhere {
  const where: WorkflowApprovalWhere = {
    organizationId: filter.organizationId,
    instanceId: filter.instanceId,
  };
  if (filter.status !== undefined) where.status = filter.status;
  return where;
}

function toDomain(row: WorkflowApprovalRow): WorkflowApproval {
  return {
    id: row.id,
    organizationId: row.organizationId,
    instanceId: row.instanceId,
    versionId: row.versionId,
    transitionId: row.transitionId,
    status: row.status as WorkflowApprovalStatus,
    requestedBy: row.requestedBy,
    requestedAt: row.requestedAt,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    comment: row.comment,
    baseSequence: row.baseSequence,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
  };
}
