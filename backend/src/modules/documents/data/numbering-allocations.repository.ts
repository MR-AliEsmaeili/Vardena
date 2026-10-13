import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import type { NumberingAllocation } from '../domain/numbering-allocation.js';
import type {
  DocumentsTxClient,
  NumberingAllocationCreate,
  NumberingAllocationDelegate,
  NumberingAllocationRow,
  NumberingAllocationWhere,
  OrderBy,
} from './documents-rows.js';

/**
 * Data access for `documents.numbering_allocations` — the numbering ledger
 * (Task 8, ADR-0023).
 *
 * Rows are append-only. The insert happens INSIDE the allocation transaction
 * owned by `NumberingSeriesRepository` (via `insertAllocationRow`), so a
 * committed allocation always has its key and a failed one never does. This
 * repository owns the reads (idempotency pre-check, inspection).
 */

export interface NumberingAllocationListFilter {
  /** Always set by the service: a numbering ledger list is never cross-organization. */
  organizationId: string;
  seriesId?: string | undefined;
  documentType?: string | undefined;
  referenceModule?: string | undefined;
  referenceDocumentType?: string | undefined;
  referenceDocumentId?: string | undefined;
}

type Client = {
  numberingAllocation: NumberingAllocationDelegate;
};

@Injectable()
export class NumberingAllocationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  async findById(id: string): Promise<NumberingAllocation | null> {
    const { numberingAllocation } = await this.client();
    const row = await numberingAllocation.findUnique({ where: { id } });
    return row === null ? null : toDomain(row);
  }

  /** Idempotency pre-check / race re-check: key → existing allocation. */
  async findBySeriesAndKey(
    seriesId: string,
    allocationKey: string,
  ): Promise<NumberingAllocation | null> {
    const { numberingAllocation } = await this.client();
    const row = await numberingAllocation.findFirst({
      where: { seriesId, allocationKey },
    });
    return row === null ? null : toDomain(row);
  }

  async list(params: {
    where: NumberingAllocationListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: NumberingAllocation[]; total: number }> {
    const { numberingAllocation } = await this.client();
    const where = toWhere(params.where);
    const [rows, total] = await Promise.all([
      numberingAllocation.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      numberingAllocation.count({ where }),
    ]);
    return { items: rows.map(toDomain), total };
  }
}

// ---- Internal helpers ----

function toWhere(
  filter: NumberingAllocationListFilter,
): NumberingAllocationWhere {
  const where: NumberingAllocationWhere = {
    organizationId: filter.organizationId,
  };
  if (filter.seriesId !== undefined) where.seriesId = filter.seriesId;
  if (filter.documentType !== undefined) {
    where.documentType = filter.documentType;
  }
  if (filter.referenceModule !== undefined) {
    where.referenceModule = filter.referenceModule;
  }
  if (filter.referenceDocumentType !== undefined) {
    where.referenceDocumentType = filter.referenceDocumentType;
  }
  if (filter.referenceDocumentId !== undefined) {
    where.referenceDocumentId = filter.referenceDocumentId;
  }
  return where;
}

/**
 * Insert an allocation row inside the caller's transaction. Called only by the
 * numbering allocation path — never from the service directly.
 */
export async function insertAllocationRow(
  tx: DocumentsTxClient,
  input: NumberingAllocationCreate,
): Promise<NumberingAllocation> {
  const row = await tx.numberingAllocation.create({ data: input });
  return toDomain(row);
}

function toDomain(row: NumberingAllocationRow): NumberingAllocation {
  return {
    id: row.id,
    seriesId: row.seriesId,
    organizationId: row.organizationId,
    documentType: row.documentType,
    number: row.number,
    allocationKey: row.allocationKey,
    referenceModule: row.referenceModule,
    referenceDocumentType: row.referenceDocumentType,
    referenceDocumentId: row.referenceDocumentId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
