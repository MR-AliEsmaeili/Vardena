import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { isRecordNotFound } from '../../../kernel/prisma/prisma-errors.js';
import type { FinancialArea } from '../domain/financial-area.js';
import { AreaHasOpenYearsError } from './accounting-calendar-errors.js';
import {
  lockFinancialAreaRow,
  lockFinancialAreasOfOrganization,
  lockFiscalYearsOfArea,
} from './accounting-locks.js';
import type {
  AccountingTransactionalClient,
  FinancialAreaCreate,
  FinancialAreaDelegate,
  FinancialAreaRow,
  FinancialAreaUpdate,
  FinancialAreaWhere,
  OrderBy,
} from './accounting-rows.js';

/**
 * Data access for `accounting.financial_areas`.
 *
 * The `(organization_id, code)` unique index is authoritative for duplicate
 * detection; the service pre-checks only to produce a 409 with a useful
 * message, and the repository still surfaces the database failure if two
 * writes race.
 *
 * Two writes own a transaction each (the area is the lock parents hang
 * off — see `accounting-locks.ts`):
 * - `setDefaultChecked`: locks every area row of the organization, clears
 *   the previous default, flags the new one. Two concurrent "set default"
 *   operations for one org serialize, so two defaults are impossible.
 * - `disableChecked`: locks the area plus every year of the area, refuses
 *   while an open year exists (contract §5.6), then disables.
 */

type Client = {
  financialArea: FinancialAreaDelegate;
};

export interface FinancialAreaListFilter {
  /** Always set by the service: an area list is never cross-organization. */
  organizationId: string;
  isActive?: boolean | undefined;
  isDefault?: boolean | undefined;
  search?: string | undefined;
}

@Injectable()
export class FinancialAreasRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  private transacting(): Promise<AccountingTransactionalClient> {
    return this.prisma.getClient<AccountingTransactionalClient>();
  }

  async findById(id: string): Promise<FinancialArea | null> {
    const { financialArea } = await this.client();
    const row = await financialArea.findUnique({ where: { id } });
    return row === null ? null : toDomain(row);
  }

  async findByCode(
    organizationId: string,
    code: string,
  ): Promise<FinancialArea | null> {
    const { financialArea } = await this.client();
    const row = await financialArea.findFirst({
      where: { organizationId, code },
    });
    return row === null ? null : toDomain(row);
  }

  async findByCodeExcludingId(
    organizationId: string,
    code: string,
    excludeId: string,
  ): Promise<FinancialArea | null> {
    const existing = await this.findByCode(organizationId, code);
    if (existing === null) return null;
    return existing.id === excludeId ? null : existing;
  }

  async list(params: {
    where: FinancialAreaListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: FinancialArea[]; total: number }> {
    const { financialArea } = await this.client();
    const where = toWhere(params.where);
    const [rows, total] = await Promise.all([
      financialArea.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      financialArea.count({ where }),
    ]);
    return { items: rows.map(toDomain), total };
  }

  async create(input: FinancialAreaCreate): Promise<FinancialArea> {
    const { financialArea } = await this.client();
    return toDomain(await financialArea.create({ data: input }));
  }

  async update(
    id: string,
    patch: FinancialAreaUpdate,
  ): Promise<FinancialArea | null> {
    const { financialArea } = await this.client();
    try {
      return toDomain(await financialArea.update({ where: { id }, data: patch }));
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }

  /**
   * Flag one area as the organization's default, clearing the previous
   * default (if any) in the same transaction. The per-org row locks make
   * two concurrent "set default" operations serialize, so "at most one
   * default per organization" (contract §5.5) holds under concurrency.
   *
   * @returns the updated area plus the id of the cleared previous default
   *   (`null` when there was none, or it was already this area).
   */
  async setDefaultChecked(input: {
    id: string;
    organizationId: string;
    updatedAt: Date;
    updatedBy: string | null;
  }): Promise<{ area: FinancialArea; clearedId: string | null }> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      // Throws when the row is gone (a bug — the service resolves the area
      // first, and areas are never deleted).
      await lockFinancialAreaRow(tx, input.id);
      await lockFinancialAreasOfOrganization(tx, input.organizationId);

      const previous = await tx.financialArea.findFirst({
        where: { organizationId: input.organizationId, isDefault: true },
      });
      const clearedId =
        previous !== null && previous.id !== input.id ? previous.id : null;
      if (clearedId !== null) {
        await tx.financialArea.updateMany({
          where: { organizationId: input.organizationId, isDefault: true },
          data: {
            isDefault: false,
            updatedAt: input.updatedAt,
            updatedBy: input.updatedBy,
          },
        });
      }
      const updated = await tx.financialArea.update({
        where: { id: input.id },
        data: {
          isDefault: true,
          updatedAt: input.updatedAt,
          updatedBy: input.updatedBy,
        },
      });
      return { area: toDomain(updated), clearedId };
    });
  }

  /**
   * Disable one area, refusing while it has an open fiscal year
   * (contract §5.6). The area lock serializes against concurrent year
   * creates (which lock the area for their overlap check); the year locks
   * serialize against concurrent year reopens (which lock their year
   * row) — so the guard cannot miss an open year either way.
   *
   * The "non-final documents" half of contract §5.6 has no documents to
   * check in Task 10.2; the documenting task wires it here.
   *
   * @throws AreaHasOpenYearsError when an open year exists.
   */
  async disableChecked(input: {
    id: string;
    updatedAt: Date;
    updatedBy: string | null;
  }): Promise<FinancialArea> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      // Throws when the row is gone (same bug posture as above).
      await lockFinancialAreaRow(tx, input.id);
      await lockFiscalYearsOfArea(tx, input.id);

      const openYear = await tx.fiscalYear.findMany({
        where: { financialAreaId: input.id, status: 'open' },
        orderBy: [{ id: 'asc' }],
        skip: 0,
        take: 1,
      });
      const [blocking] = openYear;
      if (blocking !== undefined) {
        throw new AreaHasOpenYearsError(blocking.id);
      }
      const updated = await tx.financialArea.update({
        where: { id: input.id },
        data: {
          isActive: false,
          updatedAt: input.updatedAt,
          updatedBy: input.updatedBy,
        },
      });
      return toDomain(updated);
    });
  }
}

// ---- Internal helpers ----

function toWhere(filter: FinancialAreaListFilter): FinancialAreaWhere {
  const where: FinancialAreaWhere = { organizationId: filter.organizationId };
  if (filter.isActive !== undefined) where.isActive = filter.isActive;
  if (filter.isDefault !== undefined) where.isDefault = filter.isDefault;
  if (filter.search !== undefined && filter.search !== '') {
    where.OR = [
      { code: { contains: filter.search, mode: 'insensitive' } },
      { title: { contains: filter.search, mode: 'insensitive' } },
    ];
  }
  return where;
}

function toDomain(row: FinancialAreaRow): FinancialArea {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    title: row.title,
    isDefault: row.isDefault,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
