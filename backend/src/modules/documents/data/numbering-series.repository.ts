import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { isRecordNotFound } from '../../../kernel/prisma/prisma-errors.js';
import { nextSerialValue, formatSerial } from '../domain/numbering.js';
import type { NumberingSeries } from '../domain/numbering-series.js';
import type { NumberingAllocation } from '../domain/numbering-allocation.js';
import { lockSeriesRow } from './documents-locks.js';
import { insertAllocationRow } from './numbering-allocations.repository.js';
import type {
  DocumentsTransactionalClient,
  NumberingSeriesCreate,
  NumberingSeriesDelegate,
  NumberingSeriesRow,
  NumberingSeriesUpdate,
  NumberingSeriesWhere,
  OrderBy,
} from './documents-rows.js';

/**
 * Data access for `documents.numbering_series` — configuration CRUD and the
 * concurrency-safe allocation transaction (Task 8, ADR-0023).
 *
 * `allocate` owns ONE transaction shaped like the Inventory posting path:
 *
 *   1. lock the series row (`SELECT … FOR UPDATE`),
 *   2. compute the next serial from the locked counter (strategy + width),
 *   3. insert the allocation row,
 *   4. advance the counter.
 *
 * The lock is what makes two concurrent allocations for one series serialize;
 * the `(series_id, number)` unique index is the backstop. `reuse_policy` is
 * stored but never acted on here — recycling is tied to document deletion in
 * the owning modules and is expert-gated (OQ-12, Task 8 §12).
 */

export interface NumberingSeriesListFilter {
  organizationId: string;
  documentType?: string | undefined;
  isActive?: boolean | undefined;
}

export interface AllocateInput {
  seriesId: string;
  organizationId: string;
  documentType: string;
  allocationId: string;
  allocationKey: string;
  referenceModule: string | null;
  referenceDocumentType: string | null;
  referenceDocumentId: string | null;
  actorId: string | null;
}

type Client = {
  numberingSeries: NumberingSeriesDelegate;
};

@Injectable()
export class NumberingSeriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  private transacting(): Promise<DocumentsTransactionalClient> {
    return this.prisma.getClient<DocumentsTransactionalClient>();
  }

  // ---- configuration CRUD --------------------------------------------------

  async findById(id: string): Promise<NumberingSeries | null> {
    const { numberingSeries } = await this.client();
    const row = await numberingSeries.findUnique({ where: { id } });
    return row === null ? null : toDomain(row);
  }

  async findByScope(
    organizationId: string,
    documentType: string,
    scopeKey: string,
  ): Promise<NumberingSeries | null> {
    const { numberingSeries } = await this.client();
    const row = await numberingSeries.findFirst({
      where: { organizationId, documentType, scopeKey },
    });
    return row === null ? null : toDomain(row);
  }

  async list(params: {
    where: NumberingSeriesListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: NumberingSeries[]; total: number }> {
    const { numberingSeries } = await this.client();
    const where = toWhere(params.where);
    const [rows, total] = await Promise.all([
      numberingSeries.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      numberingSeries.count({ where }),
    ]);
    return { items: rows.map(toDomain), total };
  }

  async create(input: NumberingSeriesCreate): Promise<NumberingSeries> {
    const { numberingSeries } = await this.client();
    return toDomain(await numberingSeries.create({ data: input }));
  }

  async update(
    id: string,
    patch: NumberingSeriesUpdate,
  ): Promise<NumberingSeries | null> {
    const { numberingSeries } = await this.client();
    try {
      return toDomain(
        await numberingSeries.update({ where: { id }, data: patch }),
      );
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }

  // ---- allocation (owns its transaction) -----------------------------------

  /**
   * Allocate the next serial from a series atomically.
   *
   * @returns the stored allocation (its `number` is the formatted serial) and
   *   the series' new counter value.
   */
  async allocate(
    input: AllocateInput,
  ): Promise<{ allocation: NumberingAllocation; lastValue: bigint }> {
    const { $transaction } = await this.transacting();
    return $transaction(async (tx) => {
      const locked = await lockSeriesRow(tx, input.seriesId);
      const next = nextSerialValue(
        locked.lastValue,
        // The lock reads the stored strategy; the service already validated it
        // at configuration time, so it is one of the closed list.
        locked.strategy as 'monotonic',
      );
      const number = formatSerial(next, locked.width);
      const now = new Date();
      const allocation = await insertAllocationRow(tx, {
        id: input.allocationId,
        seriesId: input.seriesId,
        organizationId: input.organizationId,
        documentType: input.documentType,
        number,
        allocationKey: input.allocationKey,
        referenceModule: input.referenceModule,
        referenceDocumentType: input.referenceDocumentType,
        referenceDocumentId: input.referenceDocumentId,
        createdAt: now,
        updatedAt: now,
        createdBy: input.actorId,
        updatedBy: input.actorId,
      });
      await tx.numberingSeries.update({
        where: { id: input.seriesId },
        data: {
          lastValue: next,
          updatedAt: now,
          updatedBy: input.actorId,
        },
      });
      return { allocation, lastValue: next };
    });
  }
}

// ---- Internal helpers ----

function toWhere(filter: NumberingSeriesListFilter): NumberingSeriesWhere {
  const where: NumberingSeriesWhere = {
    organizationId: filter.organizationId,
  };
  if (filter.documentType !== undefined) {
    where.documentType = filter.documentType;
  }
  if (filter.isActive !== undefined) where.isActive = filter.isActive;
  return where;
}

function toDomain(row: NumberingSeriesRow): NumberingSeries {
  return {
    id: row.id,
    organizationId: row.organizationId,
    documentType: row.documentType,
    scopeKey: row.scopeKey,
    name: row.name,
    strategy: row.strategy,
    width: row.width,
    reusePolicy: row.reusePolicy,
    lastValue: row.lastValue,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
