import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { isRecordNotFound } from '../../../kernel/prisma/prisma-errors.js';
import type { WorkflowAutomationBinding } from '../domain/workflow-automation.js';
import { requireDraftVersion } from './workflow-locks.js';
import type {
  OrderBy,
  WorkflowAutomationBindingCreate,
  WorkflowAutomationBindingDelegate,
  WorkflowAutomationBindingRow,
  WorkflowAutomationBindingUpdate,
  WorkflowAutomationBindingWhere,
  WorkflowTransactionalClient,
} from './workflow-rows.js';

/**
 * Data access for `workflow.workflow_automation_bindings` (Task 9, ADR-0024).
 *
 * Writes are draft-guarded exactly like states and transitions: the version
 * row is locked and `draft` is re-checked under the lock. Bindings of an
 * active version are immutable — and the execution path may therefore read
 * them outside its transaction when assembling the transition event.
 */

export interface WorkflowAutomationListFilter {
  organizationId: string;
  versionId?: string | undefined;
  transitionId?: string | undefined;
  isActive?: boolean | undefined;
}

type Client = {
  workflowAutomationBinding: WorkflowAutomationBindingDelegate;
};

@Injectable()
export class WorkflowAutomationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  private transacting(): Promise<WorkflowTransactionalClient> {
    return this.prisma.getClient<WorkflowTransactionalClient>();
  }

  async findById(id: string): Promise<WorkflowAutomationBinding | null> {
    const { workflowAutomationBinding } = await this.client();
    const row = await workflowAutomationBinding.findUnique({ where: { id } });
    return row === null ? null : toDomain(row);
  }

  async list(params: {
    where: WorkflowAutomationListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: WorkflowAutomationBinding[]; total: number }> {
    const { workflowAutomationBinding } = await this.client();
    const where = toWhere(params.where);
    const [rows, total] = await Promise.all([
      workflowAutomationBinding.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      workflowAutomationBinding.count({ where }),
    ]);
    return { items: rows.map(toDomain), total };
  }

  /** Enabled bindings of one transition (the event-payload lookup). */
  async listEnabledForTransition(
    transitionId: string,
  ): Promise<WorkflowAutomationBinding[]> {
    const { workflowAutomationBinding } = await this.client();
    const rows = await workflowAutomationBinding.findMany({
      where: { transitionId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { action: 'asc' }],
      skip: 0,
      take: 10_000,
    });
    return rows.map(toDomain);
  }

  /** Create a binding in a draft version (locked, draft re-checked). */
  async createInDraftVersion(
    versionId: string,
    input: WorkflowAutomationBindingCreate,
  ): Promise<WorkflowAutomationBinding> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      await requireDraftVersion(tx, versionId);
      return toDomain(
        await tx.workflowAutomationBinding.create({ data: input }),
      );
    });
  }

  /** Update a binding in a draft version (locked, draft re-checked). */
  async updateInDraftVersion(
    versionId: string,
    id: string,
    patch: WorkflowAutomationBindingUpdate,
  ): Promise<WorkflowAutomationBinding | null> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      await requireDraftVersion(tx, versionId);
      try {
        return toDomain(
          await tx.workflowAutomationBinding.update({
            where: { id },
            data: patch,
          }),
        );
      } catch (error) {
        if (isRecordNotFound(error)) return null;
        throw error;
      }
    });
  }

  /** Delete a binding in a draft version (locked, draft re-checked). */
  async deleteInDraftVersion(
    versionId: string,
    id: string,
  ): Promise<WorkflowAutomationBinding | null> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      await requireDraftVersion(tx, versionId);
      try {
        return toDomain(
          await tx.workflowAutomationBinding.delete({ where: { id } }),
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
  filter: WorkflowAutomationListFilter,
): WorkflowAutomationBindingWhere {
  const where: WorkflowAutomationBindingWhere = {
    organizationId: filter.organizationId,
  };
  if (filter.versionId !== undefined) where.versionId = filter.versionId;
  if (filter.transitionId !== undefined) {
    where.transitionId = filter.transitionId;
  }
  if (filter.isActive !== undefined) where.isActive = filter.isActive;
  return where;
}

function toDomain(
  row: WorkflowAutomationBindingRow,
): WorkflowAutomationBinding {
  return {
    id: row.id,
    organizationId: row.organizationId,
    versionId: row.versionId,
    transitionId: row.transitionId,
    action: row.action,
    parameters: row.parameters,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
  };
}
