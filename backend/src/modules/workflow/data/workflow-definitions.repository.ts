import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { isRecordNotFound } from '../../../kernel/prisma/prisma-errors.js';
import type { WorkflowDefinition } from '../domain/workflow-definition.js';
import type {
  WorkflowDefinitionCreate,
  WorkflowDefinitionDelegate,
  WorkflowDefinitionRow,
  WorkflowDefinitionUpdate,
  WorkflowDefinitionWhere,
  OrderBy,
} from './workflow-rows.js';

/**
 * Data access for `workflow.workflow_definitions` (Task 9, ADR-0024).
 *
 * The `(organization_id, code)` unique index is authoritative for duplicate
 * detection; the service pre-checks only to produce a 409 with a useful
 * message, and the repository still surfaces the database failure if two
 * writes race. Organization scoping is the SERVICE's job (every read/write
 * filters or checks `organization_id` there) — this layer stores rows.
 */

export interface WorkflowDefinitionListFilter {
  /** Always set by the service: a definition list is never cross-organization. */
  organizationId: string;
  isActive?: boolean | undefined;
  search?: string | undefined;
}

type Client = {
  workflowDefinition: WorkflowDefinitionDelegate;
};

@Injectable()
export class WorkflowDefinitionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  async findById(id: string): Promise<WorkflowDefinition | null> {
    const { workflowDefinition } = await this.client();
    const row = await workflowDefinition.findUnique({ where: { id } });
    return row === null ? null : toDomain(row);
  }

  async findByCode(
    organizationId: string,
    code: string,
  ): Promise<WorkflowDefinition | null> {
    const { workflowDefinition } = await this.client();
    const row = await workflowDefinition.findFirst({
      where: { organizationId, code },
    });
    return row === null ? null : toDomain(row);
  }

  async list(params: {
    where: WorkflowDefinitionListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: WorkflowDefinition[]; total: number }> {
    const { workflowDefinition } = await this.client();
    const where = toWhere(params.where);
    const [rows, total] = await Promise.all([
      workflowDefinition.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      workflowDefinition.count({ where }),
    ]);
    return { items: rows.map(toDomain), total };
  }

  async create(input: WorkflowDefinitionCreate): Promise<WorkflowDefinition> {
    const { workflowDefinition } = await this.client();
    return toDomain(await workflowDefinition.create({ data: input }));
  }

  async update(
    id: string,
    patch: WorkflowDefinitionUpdate,
  ): Promise<WorkflowDefinition | null> {
    const { workflowDefinition } = await this.client();
    try {
      return toDomain(
        await workflowDefinition.update({ where: { id }, data: patch }),
      );
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }
}

// ---- Internal helpers ----

function toWhere(
  filter: WorkflowDefinitionListFilter,
): WorkflowDefinitionWhere {
  const where: WorkflowDefinitionWhere = {
    organizationId: filter.organizationId,
  };
  if (filter.isActive !== undefined) where.isActive = filter.isActive;
  if (filter.search !== undefined && filter.search.trim() !== '') {
    const clause = {
      contains: filter.search.trim(),
      mode: 'insensitive' as const,
    };
    where.OR = [{ code: clause }, { name: clause }];
  }
  return where;
}

function toDomain(row: WorkflowDefinitionRow): WorkflowDefinition {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    name: row.name,
    description: row.description,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
  };
}
