import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { isRecordNotFound } from '../../../kernel/prisma/prisma-errors.js';
import type { ItemGroup } from '../domain/item-group.js';
import type { HierarchyEdge } from '../domain/hierarchy.js';
import {
  type AuditColumns,
  type MasterDataDelegate,
  type OrderBy,
} from './master-data-rows.js';

/** Data access for `inventory.item_groups` (hierarchical, per organization). */

type ItemGroupRow = {
  id: string;
  organizationId: string;
  parentId: string | null;
  code: string;
  name: string;
  isActive: boolean;
} & AuditColumns;

interface ItemGroupWhere {
  organizationId?: string;
  code?: string;
  isActive?: boolean;
  parentId?: string | null;
  OR?: Array<SearchClause>;
}

interface SearchClause {
  code?: { contains: string; mode: 'insensitive' };
  name?: { contains: string; mode: 'insensitive' };
}

interface ItemGroupCreate {
  id: string;
  organizationId: string;
  parentId: string | null;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

interface ItemGroupUpdate {
  parentId?: string | null | undefined;
  code?: string | undefined;
  name?: string | undefined;
  isActive?: boolean | undefined;
  updatedAt: Date;
  updatedBy: string | null;
}

type Client = {
  itemGroup: MasterDataDelegate<
    ItemGroupRow,
    ItemGroupWhere,
    ItemGroupCreate,
    ItemGroupUpdate
  >;
};

export interface ItemGroupListFilter {
  organizationId: string;
  isActive?: boolean | undefined;
  parentId?: string | null | undefined;
  search?: string | undefined;
}

@Injectable()
export class ItemGroupsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  async findById(id: string): Promise<ItemGroup | null> {
    const { itemGroup } = await this.client();
    const row = await itemGroup.findUnique({ where: { id } });
    return row === null ? null : toDomain(row);
  }

  async findByCode(
    organizationId: string,
    code: string,
  ): Promise<ItemGroup | null> {
    const { itemGroup } = await this.client();
    const row = await itemGroup.findFirst({ where: { organizationId, code } });
    return row === null ? null : toDomain(row);
  }

  async findByCodeExcludingId(
    organizationId: string,
    code: string,
    excludeId: string,
  ): Promise<ItemGroup | null> {
    const existing = await this.findByCode(organizationId, code);
    if (existing === null) return null;
    return existing.id === excludeId ? null : existing;
  }

  /** Parent edges of every group in one organization (cycle checking). */
  async listHierarchyEdges(organizationId: string): Promise<HierarchyEdge[]> {
    const { itemGroup } = await this.client();
    const rows = await itemGroup.findMany({
      where: { organizationId },
      orderBy: [{ id: 'asc' }],
      skip: 0,
      take: Number.MAX_SAFE_INTEGER,
    });
    return rows.map((row) => ({ id: row.id, parentId: row.parentId }));
  }

  async list(params: {
    where: ItemGroupListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: ItemGroup[]; total: number }> {
    const { itemGroup } = await this.client();
    const where = toWhere(params.where);
    const [rows, total] = await Promise.all([
      itemGroup.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      itemGroup.count({ where }),
    ]);
    return { items: rows.map(toDomain), total };
  }

  async create(input: ItemGroupCreate): Promise<ItemGroup> {
    const { itemGroup } = await this.client();
    return toDomain(await itemGroup.create({ data: input }));
  }

  async update(id: string, patch: ItemGroupUpdate): Promise<ItemGroup | null> {
    const { itemGroup } = await this.client();
    try {
      return toDomain(await itemGroup.update({ where: { id }, data: patch }));
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }
}

// ---- Internal helpers ----

function toWhere(filter: ItemGroupListFilter): ItemGroupWhere {
  const where: ItemGroupWhere = { organizationId: filter.organizationId };
  if (filter.isActive !== undefined) where.isActive = filter.isActive;
  if (filter.parentId !== undefined) where.parentId = filter.parentId;
  if (filter.search !== undefined && filter.search !== '') {
    where.OR = [
      { code: { contains: filter.search, mode: 'insensitive' } },
      { name: { contains: filter.search, mode: 'insensitive' } },
    ];
  }
  return where;
}

function toDomain(row: ItemGroupRow): ItemGroup {
  return {
    id: row.id,
    organizationId: row.organizationId,
    parentId: row.parentId,
    code: row.code,
    name: row.name,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
