import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { isRecordNotFound } from '../../../kernel/prisma/prisma-errors.js';
import type { Unit } from '../domain/unit.js';
import {
  type AuditColumns,
  type MasterDataDelegate,
  type OrderBy,
} from './master-data-rows.js';

/**
 * Data access for `inventory.units`.
 *
 * `(organization_id, code)` is the uniqueness scope; units are shared by every
 * item in the organization that uses them (no per-item unit copies).
 */

type UnitRow = {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  symbol: string | null;
  isActive: boolean;
} & AuditColumns;

interface UnitWhere {
  organizationId?: string;
  code?: string;
  isActive?: boolean;
  OR?: Array<SearchClause>;
}

interface SearchClause {
  code?: { contains: string; mode: 'insensitive' };
  name?: { contains: string; mode: 'insensitive' };
}

interface UnitCreate {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  symbol: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

interface UnitUpdate {
  code?: string | undefined;
  name?: string | undefined;
  symbol?: string | null | undefined;
  isActive?: boolean | undefined;
  updatedAt: Date;
  updatedBy: string | null;
}

type Client = {
  unit: MasterDataDelegate<UnitRow, UnitWhere, UnitCreate, UnitUpdate>;
};

export interface UnitListFilter {
  organizationId: string;
  isActive?: boolean | undefined;
  search?: string | undefined;
}

@Injectable()
export class UnitsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  async findById(id: string): Promise<Unit | null> {
    const { unit } = await this.client();
    const row = await unit.findUnique({ where: { id } });
    return row === null ? null : toDomain(row);
  }

  async findByCode(organizationId: string, code: string): Promise<Unit | null> {
    const { unit } = await this.client();
    const row = await unit.findFirst({ where: { organizationId, code } });
    return row === null ? null : toDomain(row);
  }

  async findByCodeExcludingId(
    organizationId: string,
    code: string,
    excludeId: string,
  ): Promise<Unit | null> {
    const existing = await this.findByCode(organizationId, code);
    if (existing === null) return null;
    return existing.id === excludeId ? null : existing;
  }

  async list(params: {
    where: UnitListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: Unit[]; total: number }> {
    const { unit } = await this.client();
    const where = toWhere(params.where);
    const [rows, total] = await Promise.all([
      unit.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      unit.count({ where }),
    ]);
    return { items: rows.map(toDomain), total };
  }

  async create(input: UnitCreate): Promise<Unit> {
    const { unit } = await this.client();
    return toDomain(await unit.create({ data: input }));
  }

  async update(id: string, patch: UnitUpdate): Promise<Unit | null> {
    const { unit } = await this.client();
    try {
      return toDomain(await unit.update({ where: { id }, data: patch }));
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }
}

// ---- Internal helpers ----

function toWhere(filter: UnitListFilter): UnitWhere {
  const where: UnitWhere = { organizationId: filter.organizationId };
  if (filter.isActive !== undefined) where.isActive = filter.isActive;
  if (filter.search !== undefined && filter.search !== '') {
    where.OR = [
      { code: { contains: filter.search, mode: 'insensitive' } },
      { name: { contains: filter.search, mode: 'insensitive' } },
    ];
  }
  return where;
}

function toDomain(row: UnitRow): Unit {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    name: row.name,
    symbol: row.symbol,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
