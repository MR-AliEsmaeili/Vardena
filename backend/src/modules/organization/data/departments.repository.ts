import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { isRecordNotFound } from '../../../kernel/prisma/prisma-errors.js';
import type { Department } from '../domain/department.js';
import type { HierarchyEdge } from '../domain/hierarchy.js';
import {
  type AuditColumns,
  type MasterDataDelegate,
  type OrderBy,
} from './master-data-rows.js';

/**
 * Data access for `organization.departments`.
 *
 * `listHierarchyEdges` returns the whole organization's parent edges so the
 * cycle rule can be evaluated by the pure domain function
 * (`collectDescendantIds`) instead of one query per tree level.
 */

type DepartmentRow = {
  id: string;
  organizationId: string;
  parentDepartmentId: string | null;
  code: string;
  name: string;
  isActive: boolean;
} & AuditColumns;

interface DepartmentWhere {
  organizationId?: string;
  code?: string;
  isActive?: boolean;
  parentDepartmentId?: string | null;
  OR?: Array<SearchClause>;
}

interface SearchClause {
  code?: { contains: string; mode: 'insensitive' };
  name?: { contains: string; mode: 'insensitive' };
}

interface DepartmentCreate {
  id: string;
  organizationId: string;
  parentDepartmentId: string | null;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

interface DepartmentUpdate {
  parentDepartmentId?: string | null | undefined;
  code?: string | undefined;
  name?: string | undefined;
  isActive?: boolean | undefined;
  updatedAt: Date;
  updatedBy: string | null;
}

type Client = {
  department: MasterDataDelegate<
    DepartmentRow,
    DepartmentWhere,
    DepartmentCreate,
    DepartmentUpdate
  >;
};

export interface DepartmentListFilter {
  organizationId: string;
  isActive?: boolean | undefined;
  /** Filter to the direct children of one department (`null` = roots). */
  parentDepartmentId?: string | null | undefined;
  search?: string | undefined;
}

@Injectable()
export class DepartmentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  async findById(id: string): Promise<Department | null> {
    const { department } = await this.client();
    const row = await department.findUnique({ where: { id } });
    return row === null ? null : toDomain(row);
  }

  async findByCode(
    organizationId: string,
    code: string,
  ): Promise<Department | null> {
    const { department } = await this.client();
    const row = await department.findFirst({ where: { organizationId, code } });
    return row === null ? null : toDomain(row);
  }

  async findByCodeExcludingId(
    organizationId: string,
    code: string,
    excludeId: string,
  ): Promise<Department | null> {
    const existing = await this.findByCode(organizationId, code);
    if (existing === null) return null;
    return existing.id === excludeId ? null : existing;
  }

  /** Parent edges of every department in one organization. */
  async listHierarchyEdges(organizationId: string): Promise<HierarchyEdge[]> {
    const { department } = await this.client();
    const rows = await department.findMany({
      where: { organizationId },
      orderBy: [{ id: 'asc' }],
      skip: 0,
      // Intentionally unbounded: an organizational tree is small and the walk
      // needs the complete edge set to detect a cycle anywhere in it.
      take: Number.MAX_SAFE_INTEGER,
    });
    return rows.map((row) => ({
      id: row.id,
      parentId: row.parentDepartmentId,
    }));
  }

  async list(params: {
    where: DepartmentListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: Department[]; total: number }> {
    const { department } = await this.client();
    const where = toWhere(params.where);
    const [rows, total] = await Promise.all([
      department.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      department.count({ where }),
    ]);
    return { items: rows.map(toDomain), total };
  }

  async create(input: DepartmentCreate): Promise<Department> {
    const { department } = await this.client();
    return toDomain(await department.create({ data: input }));
  }

  async update(
    id: string,
    patch: DepartmentUpdate,
  ): Promise<Department | null> {
    const { department } = await this.client();
    try {
      return toDomain(await department.update({ where: { id }, data: patch }));
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }
}

// ---- Internal helpers ----

function toWhere(filter: DepartmentListFilter): DepartmentWhere {
  const where: DepartmentWhere = { organizationId: filter.organizationId };
  if (filter.isActive !== undefined) where.isActive = filter.isActive;
  if (filter.parentDepartmentId !== undefined) {
    where.parentDepartmentId = filter.parentDepartmentId;
  }
  if (filter.search !== undefined && filter.search !== '') {
    where.OR = [
      { code: { contains: filter.search, mode: 'insensitive' } },
      { name: { contains: filter.search, mode: 'insensitive' } },
    ];
  }
  return where;
}

function toDomain(row: DepartmentRow): Department {
  return {
    id: row.id,
    organizationId: row.organizationId,
    parentDepartmentId: row.parentDepartmentId,
    code: row.code,
    name: row.name,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
