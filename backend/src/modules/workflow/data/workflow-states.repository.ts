import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { isRecordNotFound } from '../../../kernel/prisma/prisma-errors.js';
import type { WorkflowState } from '../domain/workflow-state.js';
import { requireDraftVersion } from './workflow-locks.js';
import type {
  OrderBy,
  WorkflowStateCreate,
  WorkflowStateDelegate,
  WorkflowStateRow,
  WorkflowStateUpdate,
  WorkflowStateWhere,
  WorkflowTransactionalClient,
} from './workflow-rows.js';

/**
 * Data access for `workflow.workflow_states` (Task 9, ADR-0024).
 *
 * Every WRITE runs in a transaction that locks the version row and re-checks
 * `draft` under the lock: a publish racing a state edit fails one of them
 * instead of mutating an active version. The service pre-checks `draft`
 * outside the transaction for a fast, well-messaged 422; the lock turns a
 * lost race into `WorkflowVersionLockedError` (mapped to 409).
 */

export interface WorkflowStateListFilter {
  organizationId: string;
  versionId: string;
}

type Client = {
  workflowState: WorkflowStateDelegate;
};

@Injectable()
export class WorkflowStatesRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  private transacting(): Promise<WorkflowTransactionalClient> {
    return this.prisma.getClient<WorkflowTransactionalClient>();
  }

  async findById(id: string): Promise<WorkflowState | null> {
    const { workflowState } = await this.client();
    const row = await workflowState.findUnique({ where: { id } });
    return row === null ? null : toStateDomain(row);
  }

  async findByCode(
    versionId: string,
    code: string,
  ): Promise<WorkflowState | null> {
    const { workflowState } = await this.client();
    const row = await workflowState.findFirst({ where: { versionId, code } });
    return row === null ? null : toStateDomain(row);
  }

  async list(params: {
    where: WorkflowStateListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: WorkflowState[]; total: number }> {
    const { workflowState } = await this.client();
    const where: WorkflowStateWhere = {
      organizationId: params.where.organizationId,
      versionId: params.where.versionId,
    };
    const [rows, total] = await Promise.all([
      workflowState.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      workflowState.count({ where }),
    ]);
    return { items: rows.map(toStateDomain), total };
  }

  async countByVersion(versionId: string): Promise<number> {
    const { workflowState } = await this.client();
    return workflowState.count({ where: { versionId } });
  }

  /** Create a state in a draft version (locked, draft re-checked). */
  async createInDraftVersion(
    versionId: string,
    input: WorkflowStateCreate,
  ): Promise<WorkflowState> {
    const { $transaction } = await this.transacting();
    return $transaction(async (tx) => {
      await requireDraftVersion(tx, versionId);
      return toStateDomain(await tx.workflowState.create({ data: input }));
    });
  }

  /** Update a state in a draft version (locked, draft re-checked). */
  async updateInDraftVersion(
    versionId: string,
    id: string,
    patch: WorkflowStateUpdate,
  ): Promise<WorkflowState | null> {
    const { $transaction } = await this.transacting();
    return $transaction(async (tx) => {
      await requireDraftVersion(tx, versionId);
      try {
        return toStateDomain(
          await tx.workflowState.update({ where: { id }, data: patch }),
        );
      } catch (error) {
        if (isRecordNotFound(error)) return null;
        throw error;
      }
    });
  }

  /**
   * Delete a state in a draft version (locked, draft re-checked). A state
   * referenced by any transition is rejected by the FK (RESTRICT) — the
   * service pre-checks for a well-messaged 422 and maps the violation too.
   */
  async deleteInDraftVersion(
    versionId: string,
    id: string,
  ): Promise<WorkflowState | null> {
    const { $transaction } = await this.transacting();
    return $transaction(async (tx) => {
      await requireDraftVersion(tx, versionId);
      try {
        return toStateDomain(await tx.workflowState.delete({ where: { id } }));
      } catch (error) {
        if (isRecordNotFound(error)) return null;
        throw error;
      }
    });
  }
}

// ---- Internal helpers ----

export function toStateDomain(row: WorkflowStateRow): WorkflowState {
  return {
    id: row.id,
    organizationId: row.organizationId,
    versionId: row.versionId,
    code: row.code,
    name: row.name,
    description: row.description,
    isInitial: row.isInitial,
    isTerminal: row.isTerminal,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
  };
}
