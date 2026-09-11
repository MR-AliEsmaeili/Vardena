import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { isRecordNotFound } from '../../../kernel/prisma/prisma-errors.js';
import type { Branch } from '../domain/branch.js';
import {
  type AuditColumns,
  type MasterDataDelegate,
  type OrderBy,
} from './master-data-rows.js';

/**
 * Data access for `organization.branches`.
 *
 * The `(organization_id, code)` unique index is authoritative for duplicate
 * detection; the service pre-checks only to produce a 409 with a useful
 * message, and the repository still surfaces the database failure if two
 * writes race.
 */

type BranchRow = { id: string; organizationId: string } & AuditColumns & {
    code: string;
    name: string;
    isActive: boolean;
  };

interface BranchWhere {
  organizationId?: string;
  code?: string;
  isActive?: boolean;
  OR?: Array<SearchClause>;
}

interface SearchClause {
  code?: { contains: string; mode: 'insensitive' };
  name?: { contains: string; mode: 'insensitive' };
}

interface BranchCreate {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

interface BranchUpdate {
  code?: string | undefined;
  name?: string | undefined;
  isActive?: boolean | undefined;
  updatedAt: Date;
  updatedBy: string | null;
}

type Client = {
  branch: MasterDataDelegate<BranchRow, BranchWhere, BranchCreate, BranchUpdate>;
};

export interface BranchListFilter {
  /** Always set by the service: a branch list is never cross-organization. */
  organizationId: string;
  isActive?: boolean | undefined;
  search?: string | undefined;
}

@Injectable()
export class BranchesRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  async findById(id: string): Promise<Branch | null> {
    const { branch } = await this.client();
    const row = await branch.findUnique({ where: { id } });
    return row === null ? null : toDomain(row);
  }

  async findByCode(
    organizationId: string,
    code: string,
  ): Promise<Branch | null> {
    const { branch } = await this.client();
    const row = await branch.findFirst({ where: { organizationId, code } });
    return row === null ? null : toDomain(row);
  }

  async findByCodeExcludingId(
    organizationId: string,
    code: string,
    excludeId: string,
  ): Promise<Branch | null> {
    const existing = await this.findByCode(organizationId, code);
    if (existing === null) return null;
    return existing.id === excludeId ? null : existing;
  }

  async list(params: {
    where: BranchListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: Branch[]; total: number }> {
    const { branch } = await this.client();
    const where = toWhere(params.where);
    const [rows, total] = await Promise.all([
      branch.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      branch.count({ where }),
    ]);
    return { items: rows.map(toDomain), total };
  }

  async create(input: BranchCreate): Promise<Branch> {
    const { branch } = await this.client();
    return toDomain(await branch.create({ data: input }));
  }

  async update(id: string, patch: BranchUpdate): Promise<Branch | null> {
    const { branch } = await this.client();
    try {
      return toDomain(await branch.update({ where: { id }, data: patch }));
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }
}

// ---- Internal helpers ----

function toWhere(filter: BranchListFilter): BranchWhere {
  const where: BranchWhere = { organizationId: filter.organizationId };
  if (filter.isActive !== undefined) where.isActive = filter.isActive;
  if (filter.search !== undefined && filter.search !== '') {
    where.OR = [
      { code: { contains: filter.search, mode: 'insensitive' } },
      { name: { contains: filter.search, mode: 'insensitive' } },
    ];
  }
  return where;
}

function toDomain(row: BranchRow): Branch {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    name: row.name,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
