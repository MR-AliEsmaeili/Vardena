import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { isRecordNotFound } from '../../../kernel/prisma/prisma-errors.js';
import type { Party, PartyType } from '../domain/party.js';
import {
  type AuditColumns,
  type MasterDataDelegate,
  type OrderBy,
} from './master-data-rows.js';

/**
 * Data access for `organization.parties` — the single counterparty master
 * (D-02). Filters expose the capability flags directly (`isCustomer`,
 * `isSupplier`) so "show me the suppliers" is an explicit column filter, not a
 * join to a role table that does not exist.
 */

type PartyRow = {
  id: string;
  organizationId: string;
  code: string;
  displayName: string;
  legalName: string | null;
  partyType: string;
  isCustomer: boolean;
  isSupplier: boolean;
  email: string | null;
  phone: string | null;
  isActive: boolean;
} & AuditColumns;

interface PartyWhere {
  organizationId?: string;
  code?: string;
  isActive?: boolean;
  partyType?: string;
  isCustomer?: boolean;
  isSupplier?: boolean;
  OR?: Array<SearchClause>;
}

interface SearchClause {
  code?: { contains: string; mode: 'insensitive' };
  displayName?: { contains: string; mode: 'insensitive' };
  legalName?: { contains: string; mode: 'insensitive' };
}

interface PartyCreate {
  id: string;
  organizationId: string;
  code: string;
  displayName: string;
  legalName: string | null;
  partyType: string;
  isCustomer: boolean;
  isSupplier: boolean;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

interface PartyUpdate {
  code?: string | undefined;
  displayName?: string | undefined;
  legalName?: string | null | undefined;
  partyType?: string | undefined;
  isCustomer?: boolean | undefined;
  isSupplier?: boolean | undefined;
  email?: string | null | undefined;
  phone?: string | null | undefined;
  isActive?: boolean | undefined;
  updatedAt: Date;
  updatedBy: string | null;
}

type Client = {
  party: MasterDataDelegate<PartyRow, PartyWhere, PartyCreate, PartyUpdate>;
};

export interface PartyListFilter {
  organizationId: string;
  isActive?: boolean | undefined;
  partyType?: PartyType | undefined;
  isCustomer?: boolean | undefined;
  isSupplier?: boolean | undefined;
  search?: string | undefined;
}

@Injectable()
export class PartiesRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  async findById(id: string): Promise<Party | null> {
    const { party } = await this.client();
    const row = await party.findUnique({ where: { id } });
    return row === null ? null : toDomain(row);
  }

  async findByCode(organizationId: string, code: string): Promise<Party | null> {
    const { party } = await this.client();
    const row = await party.findFirst({ where: { organizationId, code } });
    return row === null ? null : toDomain(row);
  }

  async findByCodeExcludingId(
    organizationId: string,
    code: string,
    excludeId: string,
  ): Promise<Party | null> {
    const existing = await this.findByCode(organizationId, code);
    if (existing === null) return null;
    return existing.id === excludeId ? null : existing;
  }

  async list(params: {
    where: PartyListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: Party[]; total: number }> {
    const { party } = await this.client();
    const where = toWhere(params.where);
    const [rows, total] = await Promise.all([
      party.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      party.count({ where }),
    ]);
    return { items: rows.map(toDomain), total };
  }

  async create(input: PartyCreate): Promise<Party> {
    const { party } = await this.client();
    return toDomain(await party.create({ data: input }));
  }

  async update(id: string, patch: PartyUpdate): Promise<Party | null> {
    const { party } = await this.client();
    try {
      return toDomain(await party.update({ where: { id }, data: patch }));
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }
}

// ---- Internal helpers ----

function toWhere(filter: PartyListFilter): PartyWhere {
  const where: PartyWhere = { organizationId: filter.organizationId };
  if (filter.isActive !== undefined) where.isActive = filter.isActive;
  if (filter.partyType !== undefined) where.partyType = filter.partyType;
  if (filter.isCustomer !== undefined) where.isCustomer = filter.isCustomer;
  if (filter.isSupplier !== undefined) where.isSupplier = filter.isSupplier;
  if (filter.search !== undefined && filter.search !== '') {
    where.OR = [
      { code: { contains: filter.search, mode: 'insensitive' } },
      { displayName: { contains: filter.search, mode: 'insensitive' } },
      { legalName: { contains: filter.search, mode: 'insensitive' } },
    ];
  }
  return where;
}

function toDomain(row: PartyRow): Party {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    displayName: row.displayName,
    legalName: row.legalName,
    // `party_type` is validated on write against the closed list, so a row
    // always holds one of the two values.
    partyType: row.partyType === 'person' ? 'person' : 'organization',
    isCustomer: row.isCustomer,
    isSupplier: row.isSupplier,
    email: row.email,
    phone: row.phone,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
