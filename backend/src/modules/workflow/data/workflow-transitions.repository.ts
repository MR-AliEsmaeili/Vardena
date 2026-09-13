import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { isRecordNotFound } from '../../../kernel/prisma/prisma-errors.js';
import type { WorkflowTransition } from '../domain/workflow-transition.js';
import { requireDraftVersion } from './workflow-locks.js';
import type {
  OrderBy,
  WorkflowTransactionalClient,
  WorkflowTransitionCreate,
  WorkflowTransitionDelegate,
  WorkflowTransitionRow,
  WorkflowTransitionUpdate,
  WorkflowTransitionWhere,
} from './workflow-rows.js';

/**
 * Data access for `workflow.workflow_transitions` (Task 9, ADR-0024).
 *
 * Writes are draft-guarded exactly like states: the version row is locked
 * and `draft` is re-checked under the lock, so a publish racing a
 * transition edit fails one of them instead of mutating an active version.
 * Deleting a transition also deletes its draft automation bindings in the
 * same transaction (they are configuration of the same draft, not history —
 * drafts have no history by construction).
 */

export interface WorkflowTransitionListFilter {
  organizationId: string;
  versionId: string;
  sourceStateId?: string | undefined;
  isActive?: boolean | undefined;
}

type Client = {
  workflowTransition: WorkflowTransitionDelegate;
};

@Injectable()
export class WorkflowTransitionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  private transacting(): Promise<WorkflowTransactionalClient> {
    return this.prisma.getClient<WorkflowTransactionalClient>();
  }

  async findById(id: string): Promise<WorkflowTransition | null> {
    const { workflowTransition } = await this.client();
    const row = await workflowTransition.findUnique({ where: { id } });
    return row === null ? null : toTransitionDomain(row);
  }

  async findByCode(
    versionId: string,
    code: string,
  ): Promise<WorkflowTransition | null> {
    const { workflowTransition } = await this.client();
    const row = await workflowTransition.findFirst({
      where: { versionId, code },
    });
    return row === null ? null : toTransitionDomain(row);
  }

  async list(params: {
    where: WorkflowTransitionListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: WorkflowTransition[]; total: number }> {
    const { workflowTransition } = await this.client();
    const where = toWhere(params.where);
    const [rows, total] = await Promise.all([
      workflowTransition.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      workflowTransition.count({ where }),
    ]);
    return { items: rows.map(toTransitionDomain), total };
  }

  /** Enabled outgoing transitions of one state (the runtime's lookup). */
  async listEnabledFromState(
    versionId: string,
    sourceStateId: string,
  ): Promise<WorkflowTransition[]> {
    const { workflowTransition } = await this.client();
    const rows = await workflowTransition.findMany({
      where: { versionId, sourceStateId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      skip: 0,
      take: 10_000,
    });
    return rows.map(toTransitionDomain);
  }

  /** Any transition touching a state (the service's delete-state guard). */
  async countTouchingState(
    versionId: string,
    stateId: string,
  ): Promise<number> {
    const { workflowTransition } = await this.client();
    const [from, to] = await Promise.all([
      workflowTransition.count({
        where: { versionId, sourceStateId: stateId },
      }),
      workflowTransition.count({
        where: { versionId, targetStateId: stateId },
      }),
    ]);
    return from + to;
  }

  /** Create a transition in a draft version (locked, draft re-checked). */
  async createInDraftVersion(
    versionId: string,
    input: WorkflowTransitionCreate,
  ): Promise<WorkflowTransition> {
    const { $transaction } = await this.transacting();
    return $transaction(async (tx) => {
      await requireDraftVersion(tx, versionId);
      return toTransitionDomain(
        await tx.workflowTransition.create({ data: input }),
      );
    });
  }

  /** Update a transition in a draft version (locked, draft re-checked). */
  async updateInDraftVersion(
    versionId: string,
    id: string,
    patch: WorkflowTransitionUpdate,
  ): Promise<WorkflowTransition | null> {
    const { $transaction } = await this.transacting();
    return $transaction(async (tx) => {
      await requireDraftVersion(tx, versionId);
      try {
        return toTransitionDomain(
          await tx.workflowTransition.update({ where: { id }, data: patch }),
        );
      } catch (error) {
        if (isRecordNotFound(error)) return null;
        throw error;
      }
    });
  }

  /**
   * Delete a transition in a draft version (locked, draft re-checked),
   * with its draft automation bindings.
   */
  async deleteInDraftVersion(
    versionId: string,
    id: string,
  ): Promise<WorkflowTransition | null> {
    const { $transaction } = await this.transacting();
    return $transaction(async (tx) => {
      await requireDraftVersion(tx, versionId);
      await tx.workflowAutomationBinding.deleteMany({
        where: { transitionId: id },
      });
      try {
        return toTransitionDomain(
          await tx.workflowTransition.delete({ where: { id } }),
        );
      } catch (error) {
        if (isRecordNotFound(error)) return null;
        throw error;
      }
    });
  }
}

// ---- Internal helpers ----

function toWhere(
  filter: WorkflowTransitionListFilter,
): WorkflowTransitionWhere {
  const where: WorkflowTransitionWhere = {
    organizationId: filter.organizationId,
    versionId: filter.versionId,
  };
  if (filter.sourceStateId !== undefined) {
    where.sourceStateId = filter.sourceStateId;
  }
  if (filter.isActive !== undefined) where.isActive = filter.isActive;
  return where;
}

export function toTransitionDomain(
  row: WorkflowTransitionRow,
): WorkflowTransition {
  return {
    id: row.id,
    organizationId: row.organizationId,
    versionId: row.versionId,
    code: row.code,
    name: row.name,
    description: row.description,
    sourceStateId: row.sourceStateId,
    targetStateId: row.targetStateId,
    requiredPermission: row.requiredPermission,
    requiresApproval: row.requiresApproval,
    approvalPermission: row.approvalPermission,
    requiresComment: row.requiresComment,
    requireDifferentActor: row.requireDifferentActor,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
  };
}
