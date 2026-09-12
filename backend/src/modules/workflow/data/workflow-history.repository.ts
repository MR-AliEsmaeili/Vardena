import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import type { WorkflowTransitionHistory } from '../domain/workflow-history.js';
import type {
  OrderBy,
  WorkflowTransitionHistoryCreate,
  WorkflowTransitionHistoryDelegate,
  WorkflowTransitionHistoryRow,
  WorkflowTransitionHistoryWhere,
  WorkflowTxClient,
} from './workflow-rows.js';

/**
 * Data access for `workflow.workflow_transition_history` (Task 9, ADR-0024).
 *
 * Rows are append-only. The insert happens INSIDE the execution transaction
 * owned by `WorkflowInstancesRepository` (via `insertHistoryRow`), so a
 * committed state change always has its history row and a failed one never
 * does. This repository owns the reads (instance history, history length).
 */

export interface WorkflowHistoryListFilter {
  organizationId: string;
  instanceId: string;
}

type Client = {
  workflowTransitionHistory: WorkflowTransitionHistoryDelegate;
};

@Injectable()
export class WorkflowHistoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  async listByInstance(params: {
    where: WorkflowHistoryListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: WorkflowTransitionHistory[]; total: number }> {
    const { workflowTransitionHistory } = await this.client();
    const where: WorkflowTransitionHistoryWhere = {
      organizationId: params.where.organizationId,
      instanceId: params.where.instanceId,
    };
    const [rows, total] = await Promise.all([
      workflowTransitionHistory.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      workflowTransitionHistory.count({ where }),
    ]);
    return { items: rows.map(toDomain), total };
  }

  async countByInstance(instanceId: string): Promise<number> {
    const { workflowTransitionHistory } = await this.client();
    return workflowTransitionHistory.count({ where: { instanceId } });
  }
}

// ---- Internal helpers ----

/**
 * Insert a history row inside the caller's transaction. Called only by the
 * execution path — never from the service directly.
 */
export async function insertHistoryRow(
  tx: WorkflowTxClient,
  input: WorkflowTransitionHistoryCreate,
): Promise<WorkflowTransitionHistory> {
  const row = await tx.workflowTransitionHistory.create({ data: input });
  return toDomain(row);
}

function toDomain(
  row: WorkflowTransitionHistoryRow,
): WorkflowTransitionHistory {
  return {
    id: row.id,
    organizationId: row.organizationId,
    instanceId: row.instanceId,
    versionId: row.versionId,
    transitionId: row.transitionId,
    fromStateId: row.fromStateId,
    toStateId: row.toStateId,
    sequence: row.sequence,
    actorId: row.actorId,
    comment: row.comment,
    approvalId: row.approvalId,
    correlationId: row.correlationId,
    occurredAt: row.occurredAt,
    createdAt: row.createdAt,
  };
}
