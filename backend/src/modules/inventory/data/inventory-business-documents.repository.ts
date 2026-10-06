import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import {
  isInventoryDocumentKind,
  isInventoryDocumentStatus,
  type InventoryBusinessDocument,
  type InventoryDocumentKind,
  type InventoryDocumentLine,
  type InventoryDocumentStatus,
} from '../domain/inventory-business-document.js';
import { decimalToString } from './inventory-core-rows.js';
import type { OrderBy } from './master-data-rows.js';
import type {
  DocClient,
  DocTransactionalClient,
  DocTxClient,
  InventoryDocumentCreate,
  InventoryDocumentLineCreate,
  InventoryDocumentLineRow,
  InventoryDocumentRow,
  InventoryDocumentUpdate,
  InventoryDocumentWhere,
} from './inventory-business-document-rows.js';

/**
 * Data access for the Inventory Business Document aggregate (C-58).
 *
 * Owns NO stock effect of its own: it reads and writes the document header
 * and its lines, nothing else. Every method that participates in a ledger
 * operation accepts the caller's transaction client (`DocTxClient`) so the
 * document state, the movement rows, the balances, the valuation state and
 * the idempotency row all commit together or not at all — the composition
 * seam PR #120 opened (`InventoryMovementsRepository.withTransaction`).
 *
 * Organization safety is structural, not advisory: every read is resolved
 * with the organization in the `where`, so an id from another organization
 * simply does not exist here and the service answers 404 (ADR-0021 §4).
 */

const MAX_LINES_PER_DOCUMENT = 500;

export interface DocumentListFilter {
  organizationId: string;
  kind?: InventoryDocumentKind | undefined;
  status?: InventoryDocumentStatus | undefined;
  warehouseId?: string | undefined;
  dateFrom?: Date | undefined;
  dateTo?: Date | undefined;
}

export interface DocumentHeaderCreate {
  id: string;
  organizationId: string;
  kind: InventoryDocumentKind;
  businessDate: Date;
  warehouseId: string | null;
  sourceWarehouseId: string | null;
  destinationWarehouseId: string | null;
  receiptCost: string | null;
  status: InventoryDocumentStatus;
  description: string | null;
  reference: string | null;
  actorId: string | null;
  at: Date;
}

export interface DocumentLineCreate {
  id: string;
  lineNumber: number;
  itemId: string;
  quantity: string;
  unitId: string;
  baseQuantity: string;
  baseUnitId: string;
  conversionFactor: string;
}

@Injectable()
export class InventoryBusinessDocumentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<DocClient> {
    return this.prisma.getClient<DocClient>();
  }

  private transacting(): Promise<DocTransactionalClient> {
    return this.prisma.getClient<DocTransactionalClient>();
  }

  /**
   * The C-58 composition boundary: ONE transaction for the document write
   * and every ledger side effect it causes. Mirrors
   * `InventoryMovementsRepository.withTransaction` and hands out the same
   * client widened with the two document delegates.
   */
  async withTransaction<T>(work: (tx: DocTxClient) => Promise<T>): Promise<T> {
    const client = await this.transacting();
    return client.$transaction(work);
  }

  // ---- reads ---------------------------------------------------------------

  /** One document WITH its lines, scoped to the organization (404 otherwise). */
  async findById(
    organizationId: string,
    id: string,
    tx?: DocTxClient,
  ): Promise<InventoryBusinessDocument | null> {
    const client = tx ?? (await this.client());
    const row = await client.inventoryBusinessDocument.findUnique({
      where: { id },
    });
    if (row === null || row.organizationId !== organizationId) return null;
    const lines = await client.inventoryBusinessDocumentLine.findMany({
      where: { documentId: id },
      orderBy: [{ lineNumber: 'asc' }],
      skip: 0,
      take: MAX_LINES_PER_DOCUMENT,
    });
    return toDomain(row, lines);
  }

  async list(params: {
    where: DocumentListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: InventoryBusinessDocument[]; total: number }> {
    const client = await this.client();
    const where = toWhere(params.where);
    const [rows, total] = await Promise.all([
      client.inventoryBusinessDocument.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      client.inventoryBusinessDocument.count({ where }),
    ]);
    if (rows.length === 0) return { items: [], total };
    const lines = await client.inventoryBusinessDocumentLine.findMany({
      where: { documentId: { in: rows.map((row) => row.id) } },
      orderBy: [{ lineNumber: 'asc' }],
      skip: 0,
      take: MAX_LINES_PER_DOCUMENT * rows.length,
    });
    const byDocument = new Map<string, InventoryDocumentLineRow[]>();
    for (const line of lines) {
      const bucket = byDocument.get(line.documentId);
      if (bucket === undefined) byDocument.set(line.documentId, [line]);
      else bucket.push(line);
    }
    return {
      items: rows.map((row) => toDomain(row, byDocument.get(row.id) ?? [])),
      total,
    };
  }

  // ---- writes --------------------------------------------------------------

  /** Create the header and its lines in one transaction. */
  async createDocument(input: {
    header: DocumentHeaderCreate;
    lines: DocumentLineCreate[];
  }): Promise<InventoryBusinessDocument> {
    return this.withTransaction(async (tx) => {
      await tx.inventoryBusinessDocument.create({
        data: toCreateData(input.header),
      });
      await this.writeLines(tx, input.header, input.lines);
      const created = await this.findById(
        input.header.organizationId,
        input.header.id,
        tx,
      );
      if (created === null) {
        throw new Error('The inventory document vanished right after insert.');
      }
      return created;
    });
  }

  /**
   * Replace the line set wholesale. Used by the edit pipeline AFTER the
   * previous lines' ledger effects have been reconciled in the same
   * transaction — never on its own.
   */
  async replaceLines(
    tx: DocTxClient,
    header: {
      id: string;
      organizationId: string;
      actorId: string | null;
      at: Date;
    },
    lines: DocumentLineCreate[],
  ): Promise<void> {
    await tx.inventoryBusinessDocumentLine.deleteMany({
      where: { documentId: header.id },
    });
    await this.writeLines(tx, header, lines);
  }

  async updateHeader(
    tx: DocTxClient,
    id: string,
    data: InventoryDocumentUpdate,
  ): Promise<void> {
    await tx.inventoryBusinessDocument.update({ where: { id }, data });
  }

  /** Point a line at the ledger fact(s) it now owns (or clear them). */
  async setLineMovements(
    tx: DocTxClient,
    lineId: string,
    movements: {
      movementId?: string | null;
      outMovementId?: string | null;
      inMovementId?: string | null;
    },
    audit: { at: Date; actorId: string | null },
  ): Promise<void> {
    await tx.inventoryBusinessDocumentLine.update({
      where: { id: lineId },
      data: { ...movements, updatedAt: audit.at, updatedBy: audit.actorId },
    });
  }

  /** Delete a DRAFT document and its lines. Never used for posted history. */
  async deleteDraft(organizationId: string, id: string): Promise<void> {
    await this.withTransaction(async (tx) => {
      const row = await tx.inventoryBusinessDocument.findUnique({
        where: { id },
      });
      if (row === null || row.organizationId !== organizationId) return;
      await tx.inventoryBusinessDocumentLine.deleteMany({
        where: { documentId: id },
      });
      await tx.inventoryBusinessDocument.delete({ where: { id } });
    });
  }

  // ---- internals -----------------------------------------------------------

  private async writeLines(
    tx: DocTxClient,
    header: {
      id: string;
      organizationId: string;
      actorId: string | null;
      at: Date;
    },
    lines: DocumentLineCreate[],
  ): Promise<void> {
    for (const line of lines) {
      const data: InventoryDocumentLineCreate = {
        id: line.id,
        documentId: header.id,
        // Denormalized from the parent, never from the request: a line can
        // not belong to a different organization than its document.
        organizationId: header.organizationId,
        lineNumber: line.lineNumber,
        itemId: line.itemId,
        quantity: line.quantity,
        unitId: line.unitId,
        baseQuantity: line.baseQuantity,
        baseUnitId: line.baseUnitId,
        conversionFactor: line.conversionFactor,
        movementId: null,
        outMovementId: null,
        inMovementId: null,
        createdAt: header.at,
        updatedAt: header.at,
        createdBy: header.actorId,
      };
      await tx.inventoryBusinessDocumentLine.create({ data });
    }
  }
}

// ---- Internal helpers ----

function toCreateData(header: DocumentHeaderCreate): InventoryDocumentCreate {
  return {
    id: header.id,
    organizationId: header.organizationId,
    kind: header.kind,
    number: null,
    businessDate: header.businessDate,
    warehouseId: header.warehouseId,
    sourceWarehouseId: header.sourceWarehouseId,
    destinationWarehouseId: header.destinationWarehouseId,
    receiptCost: header.receiptCost,
    status: header.status,
    description: header.description,
    reference: header.reference,
    operationKey: null,
    createdAt: header.at,
    updatedAt: header.at,
    createdBy: header.actorId,
  };
}

function toWhere(filter: DocumentListFilter): InventoryDocumentWhere {
  const where: InventoryDocumentWhere = {
    organizationId: filter.organizationId,
  };
  if (filter.kind !== undefined) where.kind = filter.kind;
  if (filter.status !== undefined) where.status = filter.status;
  if (filter.warehouseId !== undefined) where.warehouseId = filter.warehouseId;
  if (filter.dateFrom !== undefined || filter.dateTo !== undefined) {
    where.businessDate = {
      ...(filter.dateFrom === undefined ? {} : { gte: filter.dateFrom }),
      ...(filter.dateTo === undefined ? {} : { lte: filter.dateTo }),
    };
  }
  return where;
}

function toLineDomain(row: InventoryDocumentLineRow): InventoryDocumentLine {
  return {
    id: row.id,
    lineNumber: row.lineNumber,
    itemId: row.itemId,
    quantity: decimalToString(row.quantity),
    unitId: row.unitId,
    baseQuantity: decimalToString(row.baseQuantity),
    baseUnitId: row.baseUnitId,
    conversionFactor: decimalToString(row.conversionFactor),
    movementId: row.movementId,
    outMovementId: row.outMovementId,
    inMovementId: row.inMovementId,
  };
}

export function toDomain(
  row: InventoryDocumentRow,
  lineRows: readonly InventoryDocumentLineRow[],
): InventoryBusinessDocument {
  if (!isInventoryDocumentKind(row.kind)) {
    throw new Error(
      `Stored inventory document "${row.id}" has an unknown kind "${row.kind}".`,
    );
  }
  if (!isInventoryDocumentStatus(row.status)) {
    throw new Error(
      `Stored inventory document "${row.id}" has an unknown status "${row.status}".`,
    );
  }
  const base = {
    id: row.id,
    organizationId: row.organizationId,
    number: row.number,
    businessDate: row.businessDate,
    lines: lineRows.map(toLineDomain),
    description: row.description,
    reference: row.reference,
    status: row.status,
    operationKey: row.operationKey,
    valuationStale: row.valuationStale,
    finalizedAt: row.finalizedAt,
    finalizedBy: row.finalizedBy,
    accountingPostedAt: row.accountingPostedAt,
    accountingPostedBy: row.accountingPostedBy,
    sealedAt: row.sealedAt,
    sealedBy: row.sealedBy,
    cancelledAt: row.cancelledAt,
    cancelledBy: row.cancelledBy,
    cancellationReason: row.cancellationReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
  };
  if (row.kind === 'transfer') {
    if (row.sourceWarehouseId === null || row.destinationWarehouseId === null) {
      throw new Error(
        `Stored transfer document "${row.id}" is missing a warehouse.`,
      );
    }
    return {
      ...base,
      kind: 'transfer',
      warehouseId: null,
      sourceWarehouseId: row.sourceWarehouseId,
      destinationWarehouseId: row.destinationWarehouseId,
      cost: null,
    };
  }
  if (row.warehouseId === null) {
    throw new Error(
      `Stored ${row.kind} document "${row.id}" is missing its warehouse.`,
    );
  }
  if (row.kind === 'issue') {
    return {
      ...base,
      kind: 'issue',
      warehouseId: row.warehouseId,
      sourceWarehouseId: null,
      destinationWarehouseId: null,
      cost: null,
    };
  }
  return {
    ...base,
    kind: 'receipt',
    warehouseId: row.warehouseId,
    sourceWarehouseId: null,
    destinationWarehouseId: null,
    cost: row.receiptCost === null ? null : decimalToString(row.receiptCost),
  };
}
