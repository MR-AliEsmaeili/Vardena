import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { isRecordNotFound } from '../../../kernel/prisma/prisma-errors.js';
import type { Organization } from '../domain/organization.js';
import {
  type AuditColumns,
  type MasterDataDelegate,
  type OrderBy,
} from './master-data-rows.js';

/**
 * Data access for `organization.organizations`.
 *
 * Rules (AR-07, AR-03): Prisma access lives in the data layer only; the
 * repository returns domain entities and never exposes row shapes; it does not
 * enforce business rules — it persists what the application layer hands it.
 *
 * Prisma delegate: `organization` (multi-schema models keep their model name
 * in the client API — the database schema is not a prefix).
 */

type OrganizationRow = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
} & AuditColumns;

interface OrganizationWhere {
  code?: string;
  isActive?: boolean;
  OR?: Array<SearchClause>;
}

interface SearchClause {
  code?: { contains: string; mode: 'insensitive' };
  name?: { contains: string; mode: 'insensitive' };
}

interface OrganizationCreate {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

interface OrganizationUpdate {
  code?: string | undefined;
  name?: string | undefined;
  isActive?: boolean | undefined;
  updatedAt: Date;
  updatedBy: string | null;
}

type Client = {
  organization: MasterDataDelegate<
    OrganizationRow,
    OrganizationWhere,
    OrganizationCreate,
    OrganizationUpdate
  >;
};

export interface OrganizationListFilter {
  isActive?: boolean | undefined;
  /** Case-insensitive substring match on code or name. */
  search?: string | undefined;
}

@Injectable()
export class OrganizationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  async findById(id: string): Promise<Organization | null> {
    const { organization } = await this.client();
    const row = await organization.findUnique({ where: { id } });
    return row === null ? null : toDomain(row);
  }

  async findByCode(code: string): Promise<Organization | null> {
    const { organization } = await this.client();
    const row = await organization.findFirst({ where: { code } });
    return row === null ? null : toDomain(row);
  }

  /**
   * Code availability for edits: a row with the same code but a different id
   * means "already taken".
   */
  async findByCodeExcludingId(
    code: string,
    excludeId: string,
  ): Promise<Organization | null> {
    const existing = await this.findByCode(code);
    if (existing === null) return null;
    return existing.id === excludeId ? null : existing;
  }

  async list(params: {
    where: OrganizationListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: Organization[]; total: number }> {
    const { organization } = await this.client();
    const where = toWhere(params.where);
    const [rows, total] = await Promise.all([
      organization.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      organization.count({ where }),
    ]);
    return { items: rows.map(toDomain), total };
  }

  async countAll(): Promise<number> {
    const { organization } = await this.client();
    return organization.count({ where: {} });
  }

  async create(input: OrganizationCreate): Promise<Organization> {
    const { organization } = await this.client();
    return toDomain(await organization.create({ data: input }));
  }

  async update(
    id: string,
    patch: OrganizationUpdate,
  ): Promise<Organization | null> {
    const { organization } = await this.client();
    try {
      return toDomain(
        await organization.update({ where: { id }, data: patch }),
      );
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }
}

// ---- Internal helpers ----

function toWhere(filter: OrganizationListFilter): OrganizationWhere {
  const where: OrganizationWhere = {};
  if (filter.isActive !== undefined) where.isActive = filter.isActive;
  if (filter.search !== undefined && filter.search !== '') {
    where.OR = [
      { code: { contains: filter.search, mode: 'insensitive' } },
      { name: { contains: filter.search, mode: 'insensitive' } },
    ];
  }
  return where;
}

function toDomain(row: OrganizationRow): Organization {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
