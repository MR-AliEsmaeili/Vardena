/**
 * In-memory stand-ins for the Document Foundation repositories (test support).
 *
 * Same purpose as `master-data-repositories.ts` and `inventory-core-repositories.ts`:
 * the e2e suite runs the FULL HTTP stack — controllers, guards, real
 * application services, the real permission registry and its startup sync —
 * with no Postgres, no Docker and no Prisma codegen.
 *
 * What is faked and what is not:
 * - faked: the four `documents` repositories and `PrismaService`;
 * - NOT faked: the document type registry, type configuration validation,
 *   numbering idempotency + monotonic allocation logic, relation kind/quantity
 *   validation, authorization checks, DTO validation.
 *
 * The fakes honour the contracts the real repositories guarantee, including the
 * unique violations the services map to 409 (`P2002`) — duplicate
 * (organization, type, scope) series and duplicate (series, number) or
 * (series, key) allocations — and the missing-row case the services map to
 * 404. The numbering `allocate` mirrors the real transaction's observable
 * effect (compute next from the counter, insert, advance; nothing is
 * observable on a collision) and throws the same unique violation the real
 * backstop index would.
 */

import type { DocumentTypeConfig } from '../../src/modules/documents/domain/document-type-config.js';
import type { NumberingSeries } from '../../src/modules/documents/domain/numbering-series.js';
import type { NumberingAllocation } from '../../src/modules/documents/domain/numbering-allocation.js';
import type { DocumentRelation } from '../../src/modules/documents/domain/document-relation.js';
import type { DocumentTypeConfigsRepository } from '../../src/modules/documents/data/document-type-configs.repository.js';
import type { NumberingSeriesRepository } from '../../src/modules/documents/data/numbering-series.repository.js';
import type { NumberingAllocationsRepository } from '../../src/modules/documents/data/numbering-allocations.repository.js';
import type { DocumentRelationsRepository } from '../../src/modules/documents/data/document-relations.repository.js';
import {
  formatSerial,
  nextSerialValue,
} from '../../src/modules/documents/domain/numbering.js';
import { generateId } from '../../src/kernel/ids/ulid.js';
import { uniqueViolation } from './in-memory-repositories.js';

export type DocumentOrderBy = Array<Record<string, 'asc' | 'desc'>>;

// ---------------------------------------------------------------------------
// Document type configs
// ---------------------------------------------------------------------------

export class InMemoryDocumentTypeConfigsRepository {
  private readonly rows = new Map<string, DocumentTypeConfig>();

  async findForType(
    organizationId: string,
    documentType: string,
  ): Promise<DocumentTypeConfig | null> {
    for (const row of this.rows.values()) {
      if (
        row.organizationId === organizationId &&
        row.documentType === documentType
      ) {
        return row;
      }
    }
    return null;
  }

  async list(params: {
    organizationId: string;
    orderBy: DocumentOrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: DocumentTypeConfig[]; total: number }> {
    const items = [...this.rows.values()]
      .filter((row) => row.organizationId === params.organizationId)
      .sort((a, b) => a.documentType.localeCompare(b.documentType));
    return {
      items: items.slice(params.skip, params.skip + params.take),
      total: items.length,
    };
  }

  async create(input: {
    id: string;
    organizationId: string;
    documentType: string;
    draftRequired: boolean;
    createdAt: Date;
    updatedAt: Date;
    createdBy: string | null;
    updatedBy: string | null;
  }): Promise<DocumentTypeConfig> {
    const existing = await this.findForType(
      input.organizationId,
      input.documentType,
    );
    if (existing !== null) throw uniqueViolation();
    const row: DocumentTypeConfig = {
      id: input.id,
      organizationId: input.organizationId,
      documentType: input.documentType,
      draftRequired: input.draftRequired,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    };
    this.rows.set(row.id, row);
    return row;
  }

  async update(
    id: string,
    patch: { draftRequired?: boolean },
  ): Promise<DocumentTypeConfig | null> {
    const row = this.rows.get(id);
    if (row === undefined) return null; // the real repo maps P2025 to null
    const updated: DocumentTypeConfig = {
      ...row,
      draftRequired: patch.draftRequired ?? row.draftRequired,
      updatedAt: new Date(),
    };
    this.rows.set(id, updated);
    return updated;
  }
}

// ---------------------------------------------------------------------------
// Numbering (series + allocations share one state so the allocation path is
// consistent across the two injected repositories, like the real module).
// ---------------------------------------------------------------------------

interface NumberingState {
  series: Map<string, NumberingSeries>;
  allocations: Map<string, NumberingAllocation>;
}

export class InMemoryNumberingSeriesRepository {
  constructor(private readonly state: NumberingState) {}

  async findById(id: string): Promise<NumberingSeries | null> {
    return this.state.series.get(id) ?? null;
  }

  async findByScope(
    organizationId: string,
    documentType: string,
    scopeKey: string,
  ): Promise<NumberingSeries | null> {
    for (const series of this.state.series.values()) {
      if (
        series.organizationId === organizationId &&
        series.documentType === documentType &&
        series.scopeKey === scopeKey
      ) {
        return series;
      }
    }
    return null;
  }

  async list(params: {
    where: {
      organizationId: string;
      documentType?: string;
      isActive?: boolean;
    };
    orderBy: DocumentOrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: NumberingSeries[]; total: number }> {
    const items = [...this.state.series.values()]
      .filter(
        (series) =>
          series.organizationId === params.where.organizationId &&
          (params.where.documentType === undefined ||
            series.documentType === params.where.documentType) &&
          (params.where.isActive === undefined ||
            series.isActive === params.where.isActive),
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return {
      items: items.slice(params.skip, params.skip + params.take),
      total: items.length,
    };
  }

  async create(input: {
    id: string;
    organizationId: string;
    documentType: string;
    scopeKey: string;
    name: string;
    strategy: string;
    width: number;
    reusePolicy: string;
    lastValue: bigint;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    createdBy: string | null;
    updatedBy: string | null;
  }): Promise<NumberingSeries> {
    const existing = await this.findByScope(
      input.organizationId,
      input.documentType,
      input.scopeKey,
    );
    if (existing !== null) throw uniqueViolation();
    const series: NumberingSeries = {
      id: input.id,
      organizationId: input.organizationId,
      documentType: input.documentType,
      scopeKey: input.scopeKey,
      name: input.name,
      strategy: input.strategy,
      width: input.width,
      reusePolicy: input.reusePolicy,
      lastValue: input.lastValue,
      isActive: input.isActive,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    };
    this.state.series.set(series.id, series);
    return series;
  }

  async update(
    id: string,
    patch: {
      name?: string;
      strategy?: string;
      width?: number;
      reusePolicy?: string;
      isActive?: boolean;
    },
  ): Promise<NumberingSeries | null> {
    const series = this.state.series.get(id);
    if (series === undefined) return null;
    const updated: NumberingSeries = {
      ...series,
      name: patch.name ?? series.name,
      strategy: patch.strategy ?? series.strategy,
      width: patch.width ?? series.width,
      reusePolicy: patch.reusePolicy ?? series.reusePolicy,
      isActive: patch.isActive ?? series.isActive,
      updatedAt: new Date(),
    };
    this.state.series.set(id, updated);
    return updated;
  }

  /**
   * Mirrors the real allocation transaction's observable effect: compute next
   * from the counter, insert, advance. A (series, number) or (series, key)
   * collision throws `P2002` and leaves the counter untouched, exactly like the
   * rolled-back real transaction.
   */
  async allocate(input: {
    seriesId: string;
    organizationId: string;
    documentType: string;
    allocationId: string;
    allocationKey: string;
    referenceModule: string | null;
    referenceDocumentType: string | null;
    referenceDocumentId: string | null;
    actorId: string | null;
  }): Promise<{ allocation: NumberingAllocation; lastValue: bigint }> {
    const series = this.state.series.get(input.seriesId);
    if (series === undefined) {
      throw new Error(`Numbering series "${input.seriesId}" no longer exists.`);
    }
    const next = nextSerialValue(series.lastValue, 'monotonic');
    const number = formatSerial(next, series.width);
    for (const allocation of this.state.allocations.values()) {
      if (
        allocation.seriesId === input.seriesId &&
        (allocation.number === number ||
          allocation.allocationKey === input.allocationKey)
      ) {
        throw uniqueViolation();
      }
    }
    const now = new Date();
    const allocation: NumberingAllocation = {
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
    };
    this.state.allocations.set(allocation.id, allocation);
    series.lastValue = next;
    series.updatedAt = now;
    return { allocation, lastValue: next };
  }
}

export class InMemoryNumberingAllocationsRepository {
  constructor(private readonly state: NumberingState) {}

  async findById(id: string): Promise<NumberingAllocation | null> {
    return this.state.allocations.get(id) ?? null;
  }

  async findBySeriesAndKey(
    seriesId: string,
    allocationKey: string,
  ): Promise<NumberingAllocation | null> {
    for (const allocation of this.state.allocations.values()) {
      if (
        allocation.seriesId === seriesId &&
        allocation.allocationKey === allocationKey
      ) {
        return allocation;
      }
    }
    return null;
  }

  /** Test helper: the number of stored ledger rows. */
  stateSize(): number {
    return this.state.allocations.size;
  }

  /**
   * Test helper: seed a committed ledger row directly (fixtures + the
   * unique-violation race, mirroring `InMemoryTable.seed`).
   */
  seed(input: {
    seriesId: string;
    organizationId: string;
    documentType: string;
    number: string;
    allocationKey: string;
    referenceModule: string | null;
    referenceDocumentType: string | null;
    referenceDocumentId: string | null;
  }): NumberingAllocation {
    const now = new Date();
    const allocation: NumberingAllocation = {
      id: generateId(),
      seriesId: input.seriesId,
      organizationId: input.organizationId,
      documentType: input.documentType,
      number: input.number,
      allocationKey: input.allocationKey,
      referenceModule: input.referenceModule,
      referenceDocumentType: input.referenceDocumentType,
      referenceDocumentId: input.referenceDocumentId,
      createdAt: now,
      updatedAt: now,
    };
    this.state.allocations.set(allocation.id, allocation);
    return allocation;
  }

  async list(params: {
    where: {
      organizationId: string;
      seriesId?: string;
      documentType?: string;
      referenceModule?: string;
      referenceDocumentType?: string;
      referenceDocumentId?: string;
    };
    orderBy: DocumentOrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: NumberingAllocation[]; total: number }> {
    const items = [...this.state.allocations.values()]
      .filter(
        (allocation) =>
          allocation.organizationId === params.where.organizationId &&
          (params.where.seriesId === undefined ||
            allocation.seriesId === params.where.seriesId) &&
          (params.where.documentType === undefined ||
            allocation.documentType === params.where.documentType) &&
          (params.where.referenceModule === undefined ||
            allocation.referenceModule === params.where.referenceModule) &&
          (params.where.referenceDocumentType === undefined ||
            allocation.referenceDocumentType ===
              params.where.referenceDocumentType) &&
          (params.where.referenceDocumentId === undefined ||
            allocation.referenceDocumentId ===
              params.where.referenceDocumentId),
      )
      .sort((a, b) => {
        // Numeric order for the ledger, matching the real `number ASC`.
        const left = BigInt(a.number);
        const right = BigInt(b.number);
        return left < right ? -1 : left > right ? 1 : 0;
      });
    return {
      items: items.slice(params.skip, params.skip + params.take),
      total: items.length,
    };
  }
}

// ---------------------------------------------------------------------------
// Document relations
// ---------------------------------------------------------------------------

export class InMemoryDocumentRelationsRepository {
  private readonly rows = new Map<string, DocumentRelation>();

  async findById(id: string): Promise<DocumentRelation | null> {
    return this.rows.get(id) ?? null;
  }

  async list(params: {
    where: {
      organizationId: string;
      relationKind?: string;
      sourceModule?: string;
      sourceDocumentType?: string;
      sourceDocumentId?: string;
      targetModule?: string;
      targetDocumentType?: string;
      targetDocumentId?: string;
    };
    orderBy: DocumentOrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: DocumentRelation[]; total: number }> {
    const where = params.where;
    const items = [...this.rows.values()]
      .filter(
        (row) =>
          row.organizationId === where.organizationId &&
          (where.relationKind === undefined ||
            row.relationKind === where.relationKind) &&
          (where.sourceModule === undefined ||
            row.source.module === where.sourceModule) &&
          (where.sourceDocumentType === undefined ||
            row.source.documentType === where.sourceDocumentType) &&
          (where.sourceDocumentId === undefined ||
            row.source.documentId === where.sourceDocumentId) &&
          (where.targetModule === undefined ||
            row.target.module === where.targetModule) &&
          (where.targetDocumentType === undefined ||
            row.target.documentType === where.targetDocumentType) &&
          (where.targetDocumentId === undefined ||
            row.target.documentId === where.targetDocumentId),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return {
      items: items.slice(params.skip, params.skip + params.take),
      total: items.length,
    };
  }

  async create(input: {
    id: string;
    organizationId: string;
    sourceModule: string;
    sourceDocumentType: string;
    sourceDocumentId: string;
    sourceLineId: string | null;
    targetModule: string;
    targetDocumentType: string;
    targetDocumentId: string;
    targetLineId: string | null;
    relationKind: string;
    quantity: string | null;
    createdByProcess: boolean;
    createdAt: Date;
    updatedAt: Date;
    createdBy: string | null;
    updatedBy: string | null;
  }): Promise<DocumentRelation> {
    const row: DocumentRelation = {
      id: input.id,
      organizationId: input.organizationId,
      source: {
        module: input.sourceModule,
        documentType: input.sourceDocumentType,
        documentId: input.sourceDocumentId,
        lineId: input.sourceLineId,
      },
      target: {
        module: input.targetModule,
        documentType: input.targetDocumentType,
        documentId: input.targetDocumentId,
        lineId: input.targetLineId,
      },
      relationKind: input.relationKind as DocumentRelation['relationKind'],
      quantity: input.quantity,
      createdByProcess: input.createdByProcess,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    };
    this.rows.set(row.id, row);
    return row;
  }

  async delete(id: string): Promise<DocumentRelation | null> {
    const row = this.rows.get(id);
    if (row === undefined) return null; // the real repo maps P2025 to null
    this.rows.delete(id);
    return row;
  }
}

// ---------------------------------------------------------------------------
// Store bundle
// ---------------------------------------------------------------------------

export interface DocumentStores {
  /** Handles typed as the real repositories — safe for `overrideProvider`. */
  typeConfigs: DocumentTypeConfigsRepository;
  numberingSeries: NumberingSeriesRepository;
  numberingAllocations: NumberingAllocationsRepository;
  relations: DocumentRelationsRepository;
  /** Concrete stores for assertions and direct manipulation. */
  raw: {
    typeConfigs: InMemoryDocumentTypeConfigsRepository;
    numberingSeries: InMemoryNumberingSeriesRepository;
    numberingAllocations: InMemoryNumberingAllocationsRepository;
    relations: InMemoryDocumentRelationsRepository;
  };
}

export function createDocumentStores(): DocumentStores {
  const numberingState: NumberingState = {
    series: new Map(),
    allocations: new Map(),
  };
  const typeConfigs = new InMemoryDocumentTypeConfigsRepository();
  const numberingSeries = new InMemoryNumberingSeriesRepository(numberingState);
  const numberingAllocations = new InMemoryNumberingAllocationsRepository(
    numberingState,
  );
  const relations = new InMemoryDocumentRelationsRepository();
  return {
    typeConfigs: typeConfigs as unknown as DocumentTypeConfigsRepository,
    numberingSeries: numberingSeries as unknown as NumberingSeriesRepository,
    numberingAllocations:
      numberingAllocations as unknown as NumberingAllocationsRepository,
    relations: relations as unknown as DocumentRelationsRepository,
    raw: { typeConfigs, numberingSeries, numberingAllocations, relations },
  };
}
