import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { isRecordNotFound } from '../../../kernel/prisma/prisma-errors.js';
import type { Warehouse } from '../domain/warehouse.js';
import {
  type AuditColumns,
  type MasterDataDelegate,
  type OrderBy,
} from './master-data-rows.js';

/**
 * Data access for `inventory.warehouses`.
 *
 * `branch_id` is NOT NULL: a warehouse belongs to exactly one branch
 * (ADR-0020 §1, master-data-strategy.md §4). Nothing here limits how many
 * warehouses an organization or a branch may have — multiple warehouses are
 * the normal case.
 */

type WarehouseRow = {
  id: string;
  organizationId: string;
  branchId: string;
  code: string;
  name: string;
  allowNegativeStock: boolean;
  isActive: boolean;
} & AuditColumns;

interface WarehouseWhere {
  organizationId?: string;
  branchId?: string;
  code?: string;
  isActive?: boolean;
  OR?: Array<SearchClause>;
}

interface SearchClause {
  code?: { contains: string; mode: 'insensitive' };
  name?: { contains: string; mode: 'insensitive' };
}

interface WarehouseCreate {
  id: string;
  organizationId: string;
  branchId: string;
  code: string;
  name: string;
  allowNegativeStock: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

interface WarehouseUpdate {
  branchId?: string | undefined;
  code?: string | undefined;
  name?: string | undefined;
  allowNegativeStock?: boolean | undefined;
  isActive?: boolean | undefined;
  updatedAt: Date;
  updatedBy: string | null;
}

type Client = {
  warehouse: MasterDataDelegate<
    WarehouseRow,
    WarehouseWhere,
    WarehouseCreate,
    WarehouseUpdate
  >;
};

export interface WarehouseListFilter {
  organizationId: string;
  branchId?: string | undefined;
  isActive?: boolean | undefined;
  search?: string | undefined;
}

@Injectable()
export class WarehousesRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  async findById(id: string): Promise<Warehouse | null> {
    const { warehouse } = await this.client();
    const row = await warehouse.findUnique({ where: { id } });
    return row === null ? null : toDomain(row);
  }

  async findByCode(
    organizationId: string,
    code: string,
  ): Promise<Warehouse | null> {
    const { warehouse } = await this.client();
    const row = await warehouse.findFirst({ where: { organizationId, code } });
    return row === null ? null : toDomain(row);
  }

  async findByCodeExcludingId(
    organizationId: string,
    code: string,
    excludeId: string,
  ): Promise<Warehouse | null> {
    const existing = await this.findByCode(organizationId, code);
    if (existing === null) return null;
    return existing.id === excludeId ? null : existing;
  }

  async list(params: {
    where: WarehouseListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: Warehouse[]; total: number }> {
    const { warehouse } = await this.client();
    const where = toWhere(params.where);
    const [rows, total] = await Promise.all([
      warehouse.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      warehouse.count({ where }),
    ]);
    return { items: rows.map(toDomain), total };
  }

  async create(input: WarehouseCreate): Promise<Warehouse> {
    const { warehouse } = await this.client();
    return toDomain(await warehouse.create({ data: input }));
  }

  async update(id: string, patch: WarehouseUpdate): Promise<Warehouse | null> {
    const { warehouse } = await this.client();
    try {
      return toDomain(await warehouse.update({ where: { id }, data: patch }));
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }
}

// ---- Internal helpers ----

function toWhere(filter: WarehouseListFilter): WarehouseWhere {
  const where: WarehouseWhere = { organizationId: filter.organizationId };
  if (filter.branchId !== undefined) where.branchId = filter.branchId;
  if (filter.isActive !== undefined) where.isActive = filter.isActive;
  if (filter.search !== undefined && filter.search !== '') {
    where.OR = [
      { code: { contains: filter.search, mode: 'insensitive' } },
      { name: { contains: filter.search, mode: 'insensitive' } },
    ];
  }
  return where;
}

function toDomain(row: WarehouseRow): Warehouse {
  return {
    id: row.id,
    organizationId: row.organizationId,
    branchId: row.branchId,
    code: row.code,
    name: row.name,
    allowNegativeStock: row.allowNegativeStock,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
