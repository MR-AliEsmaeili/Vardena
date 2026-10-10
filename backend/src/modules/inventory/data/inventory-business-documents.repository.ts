import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import {
  businessDateFromDbDate,
  businessDateToDbDate,
  toBusinessDate,
  type BusinessDate,
} from '../../../kernel/datetime/business-date.js';
import { JALALI_RENDERABLE_GREGORIAN_RANGE } from '../../../kernel/datetime/jalali.js';
import {
  isInventoryDocumentKind,
  isInventoryDocumentStatus,
  type InventoryBusinessDocument,
  type InventoryDocumentKind,
  type InventoryDocumentLine,
  type InventoryDocumentStatus,
} from '../domain/inventory-business-document.js';
import { decimalToString } from './inventory-core-rows.js';
import { lockValuationStateRowsInOrder } from './inventory-locks.js';
import { isInventoryDocumentAccountingPostingState } from '../domain/inventory-accounting-posting-operation.js';
import type { ValuationMethod } from '../domain/valuation-method.js';
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
  InventoryDocumentUpdateData,
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
  dateFrom?: BusinessDate | undefined;
  dateTo?: BusinessDate | undefined;
}

export type LockedInventoryDocumentRow = Omit<
  InventoryDocumentRow,
  'businessDate'
> & { businessDate: BusinessDate };

export interface DocumentHeaderCreate {
  id: string;
  organizationId: string;
  kind: InventoryDocumentKind;
  businessDate: BusinessDate;
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
  /** C-59D return basis link (OD-RET-01); `null` on non-return lines. */
  basisMovementId: string | null;
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

  /**
   * Inventory-owned history read for the GREGORIAN → JALALI guard. It checks
   * every persisted Inventory-owned BusinessDate (including derived balance
   * and Accounting snapshot dates) and returns the earliest one outside the
   * inclusive conversion envelope. Every branch is organization-scoped and
   * the ordered aggregate makes the result deterministic. No Organization
   * table or Prisma model is read here (AR-07).
   */
  async findFirstUnrenderableBusinessDate(
    organizationId: string,
  ): Promise<BusinessDate | null> {
    const minimum = businessDateToDbDate(
      requireBusinessDate(JALALI_RENDERABLE_GREGORIAN_RANGE.minimum),
    );
    const maximum = businessDateToDbDate(
      requireBusinessDate(JALALI_RENDERABLE_GREGORIAN_RANGE.maximum),
    );
    const client = await this.prisma.getClient<
      DocClient & { $queryRaw: import('./inventory-core-rows.js').RawQuery }
    >();
    // PostgreSQL `date` is a calendar value, not an instant. Return its ISO
    // text form so a driver-level Date parser or host timezone cannot shift the
    // day while the transition guard converts it back into the canonical type.
    const rows = await client.$queryRaw<{ businessDate: string | null }>`
      SELECT candidate."businessDate"::text AS "businessDate"
      FROM (
        SELECT MIN("movement_date") AS "businessDate", 1 AS "sourceOrder"
        FROM "inventory"."inventory_movements"
        WHERE "organization_id" = ${organizationId}
          AND ("movement_date" < ${minimum}::date OR "movement_date" > ${maximum}::date)
        UNION ALL
        SELECT MIN("business_date") AS "businessDate", 2 AS "sourceOrder"
        FROM "inventory"."inventory_business_documents"
        WHERE "organization_id" = ${organizationId}
          AND ("business_date" < ${minimum}::date OR "business_date" > ${maximum}::date)
        UNION ALL
        SELECT MIN("valid_from") AS "businessDate", 3 AS "sourceOrder"
        FROM "inventory"."unit_conversions"
        WHERE "organization_id" = ${organizationId}
          AND ("valid_from" < ${minimum}::date OR "valid_from" > ${maximum}::date)
        UNION ALL
        SELECT MIN("valid_to") AS "businessDate", 4 AS "sourceOrder"
        FROM "inventory"."unit_conversions"
        WHERE "organization_id" = ${organizationId}
          AND "valid_to" IS NOT NULL
          AND ("valid_to" < ${minimum}::date OR "valid_to" > ${maximum}::date)
        UNION ALL
        SELECT MIN("valid_from") AS "businessDate", 5 AS "sourceOrder"
        FROM "inventory"."item_unit_conversions"
        WHERE "organization_id" = ${organizationId}
          AND ("valid_from" < ${minimum}::date OR "valid_from" > ${maximum}::date)
        UNION ALL
        SELECT MIN("valid_to") AS "businessDate", 6 AS "sourceOrder"
        FROM "inventory"."item_unit_conversions"
        WHERE "organization_id" = ${organizationId}
          AND "valid_to" IS NOT NULL
          AND ("valid_to" < ${minimum}::date OR "valid_to" > ${maximum}::date)
        UNION ALL
        SELECT MIN("valid_from") AS "businessDate", 7 AS "sourceOrder"
        FROM "inventory"."item_valuation_methods"
        WHERE "organization_id" = ${organizationId}
          AND ("valid_from" < ${minimum}::date OR "valid_from" > ${maximum}::date)
        UNION ALL
        SELECT MIN("valid_to") AS "businessDate", 8 AS "sourceOrder"
        FROM "inventory"."item_valuation_methods"
        WHERE "organization_id" = ${organizationId}
          AND "valid_to" IS NOT NULL
          AND ("valid_to" < ${minimum}::date OR "valid_to" > ${maximum}::date)
        UNION ALL
        SELECT MIN("from_date") AS "businessDate", 9 AS "sourceOrder"
        FROM "inventory"."inventory_valuation_runs"
        WHERE "organization_id" = ${organizationId}
          AND "from_date" IS NOT NULL
          AND ("from_date" < ${minimum}::date OR "from_date" > ${maximum}::date)
        UNION ALL
        SELECT MIN("from_date") AS "businessDate", 10 AS "sourceOrder"
        FROM "inventory"."inventory_pricing_runs"
        WHERE "organization_id" = ${organizationId}
          AND "from_date" IS NOT NULL
          AND ("from_date" < ${minimum}::date OR "from_date" > ${maximum}::date)
        UNION ALL
        SELECT MIN("to_date") AS "businessDate", 11 AS "sourceOrder"
        FROM "inventory"."inventory_pricing_runs"
        WHERE "organization_id" = ${organizationId}
          AND ("to_date" < ${minimum}::date OR "to_date" > ${maximum}::date)
        UNION ALL
        SELECT MIN("last_movement_date") AS "businessDate", 12 AS "sourceOrder"
        FROM "inventory"."inventory_balances"
        WHERE "organization_id" = ${organizationId}
          AND "last_movement_date" IS NOT NULL
          AND ("last_movement_date" < ${minimum}::date OR "last_movement_date" > ${maximum}::date)
        UNION ALL
        SELECT MIN("document_date") AS "businessDate", 13 AS "sourceOrder"
        FROM "inventory"."inventory_accounting_posting_snapshots"
        WHERE "organization_id" = ${organizationId}
          AND ("document_date" < ${minimum}::date OR "document_date" > ${maximum}::date)
      ) AS candidate
      WHERE candidate."businessDate" IS NOT NULL
      ORDER BY candidate."businessDate" ASC, candidate."sourceOrder" ASC
      LIMIT 1
    `;
    const earliest = rows[0]?.businessDate;
    if (earliest === undefined || earliest === null) return null;
    const businessDate = toBusinessDate(earliest);
    if (businessDate === null) {
      throw new Error(
        `Inventory BusinessDate history contains a non-canonical day "${earliest}".`,
      );
    }
    return businessDate;
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

  /**
   * Document headers by id set, organization-scoped (C-59E: the pricing
   * scope's kind resolution and Reverse Pricing's OD-RVP-03 accounting
   * guard). Returns the raw header facts the callers need — id, kind,
   * status and the warehouse columns — without loading lines.
   */
  async listHeadersByIds(
    organizationId: string,
    ids: readonly string[],
  ): Promise<
    Array<{
      id: string;
      kind: string;
      status: InventoryDocumentStatus;
      warehouseId: string | null;
      sourceWarehouseId: string | null;
      destinationWarehouseId: string | null;
    }>
  > {
    if (ids.length === 0) return [];
    const client = await this.client();
    const rows: InventoryDocumentRow[] = [];
    for (let offset = 0; offset < ids.length; offset += 500) {
      const chunk = ids.slice(offset, offset + 500);
      const found = await client.inventoryBusinessDocument.findMany({
        where: { organizationId, id: { in: chunk } },
        orderBy: [{ createdAt: 'asc' }],
        skip: 0,
        take: 500,
      });
      rows.push(...found);
    }
    return rows.map((row) => {
      if (!isInventoryDocumentStatus(row.status)) {
        throw new Error(
          `Stored inventory document "${row.id}" has an unknown status "${row.status}".`,
        );
      }
      return {
        id: row.id,
        kind: row.kind,
        status: row.status,
        warehouseId: row.warehouseId,
        sourceWarehouseId: row.sourceWarehouseId,
        destinationWarehouseId: row.destinationWarehouseId,
      };
    });
  }

  /**
   * Every line linked to one basis movement, with its document's status —
   * the input to the purchase-return over-return guard (C-59D OD-RET-03).
   * Transaction-scoped on purpose: the guard runs while the basis movement
   * row is locked, so a concurrent return against the same basis cannot
   * slip between this read and its own.
   */
  async listBasisLinkedLines(
    tx: DocTxClient,
    organizationId: string,
    basisMovementId: string,
  ): Promise<
    Array<{
      documentId: string;
      documentStatus: string;
      lineNumber: number;
      itemId: string;
      baseQuantity: string;
    }>
  > {
    const lines = await tx.inventoryBusinessDocumentLine.findMany({
      where: { organizationId, basisMovementId },
      orderBy: [{ lineNumber: 'asc' }],
      skip: 0,
      take: 500,
    });
    if (lines.length === 0) return [];
    const documentIds = [...new Set(lines.map((line) => line.documentId))];
    const documents = await tx.inventoryBusinessDocument.findMany({
      where: { organizationId, id: { in: documentIds } },
      orderBy: [{ createdAt: 'asc' }],
      skip: 0,
      take: documentIds.length,
    });
    const statusById = new Map(documents.map((row) => [row.id, row.status]));
    return lines.map((line) => ({
      documentId: line.documentId,
      documentStatus: statusById.get(line.documentId) ?? 'missing',
      lineNumber: line.lineNumber,
      itemId: line.itemId,
      baseQuantity: decimalToString(line.baseQuantity),
    }));
  }

  /**
   * Lock the valuation-state rows of every key a hardened Accounting Post
   * depends on, in the module's fixed ascending multi-key order (C-59
   * concurrency hardening). Thin data-layer wrapper over
   * `lockValuationStateRowsInOrder` so the service orchestrates through its
   * own repository and unit fakes can stub the DB lock.
   */
  async lockValuationStateRows(
    tx: DocTxClient,
    entries: readonly {
      key: {
        organizationId: string;
        branchId: string;
        warehouseId: string;
        itemId: string;
      };
      method: string;
    }[],
    actorId: string | null,
  ): Promise<void> {
    await lockValuationStateRowsInOrder(
      tx,
      entries.map((entry) => ({
        key: entry.key,
        method: entry.method as ValuationMethod,
      })),
      actorId,
    );
  }

  /**
   * Lock ONE document header row `FOR UPDATE` — the serialization point of
   * the hardened Accounting Post (C-59 concurrency hardening). The caller
   * then re-derives the valuation state under the key locks and writes the
   * lifecycle change in the SAME transaction, so a concurrent Pricing Run /
   * Reverse Pricing (which locks the same key rows) can never interleave
   * between the check and the write.
   */
  async lockDocumentRow(
    tx: DocTxClient,
    organizationId: string,
    id: string,
  ): Promise<LockedInventoryDocumentRow | null> {
    const rows = await tx.$queryRaw<InventoryDocumentRow>`
      SELECT "id",
             "organization_id" AS "organizationId",
             "kind",
             "number",
             "business_date" AS "businessDate",
             "warehouse_id" AS "warehouseId",
             "source_warehouse_id" AS "sourceWarehouseId",
             "destination_warehouse_id" AS "destinationWarehouseId",
             "receipt_cost" AS "receiptCost",
             "status",
             "description",
             "reference",
             "operation_key" AS "operationKey",
             "valuation_stale" AS "valuationStale",
             "accounting_posting_state" AS "accountingPostingState",
             "accounting_posting_operation_id" AS "accountingPostingOperationId",
             "accounting_document_id" AS "accountingDocumentId",
             "accounting_document_number" AS "accountingDocumentNumber",
             "accounting_document_phase" AS "accountingDocumentPhase",
             "finalized_at" AS "finalizedAt",
             "finalized_by" AS "finalizedBy",
             "accounting_posted_at" AS "accountingPostedAt",
             "accounting_posted_by" AS "accountingPostedBy",
             "sealed_at" AS "sealedAt",
             "sealed_by" AS "sealedBy",
             "cancelled_at" AS "cancelledAt",
             "cancelled_by" AS "cancelledBy",
             "cancellation_reason" AS "cancellationReason",
             "created_at" AS "createdAt",
             "updated_at" AS "updatedAt",
             "created_by" AS "createdBy",
             "updated_by" AS "updatedBy"
        FROM "inventory"."inventory_business_documents"
       WHERE "id" = ${id}
         AND "organization_id" = ${organizationId}
       FOR UPDATE`;
    const row = rows[0];
    return row === undefined
      ? null
      : { ...row, businessDate: businessDateFromDbDate(row.businessDate) };
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
    await tx.inventoryBusinessDocument.update({
      where: { id },
      data: toUpdateData(data),
    });
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
        basisMovementId: line.basisMovementId,
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

function requireBusinessDate(value: string): BusinessDate {
  const businessDate = toBusinessDate(value);
  if (businessDate === null) {
    throw new Error(
      `Invalid configured Inventory BusinessDate boundary "${value}".`,
    );
  }
  return businessDate;
}

function dbBusinessDate(value: BusinessDate): Date {
  const carrier = businessDateToDbDate(value);
  if (carrier === null) {
    throw new Error(`Invalid canonical Inventory BusinessDate "${value}".`);
  }
  return carrier;
}

function toUpdateData(
  input: InventoryDocumentUpdate,
): InventoryDocumentUpdateData {
  const { businessDate, ...data } = input;
  return {
    ...data,
    ...(businessDate === undefined
      ? {}
      : { businessDate: dbBusinessDate(businessDate) }),
  };
}

function toCreateData(header: DocumentHeaderCreate): InventoryDocumentCreate {
  return {
    id: header.id,
    organizationId: header.organizationId,
    kind: header.kind,
    number: null,
    businessDate: dbBusinessDate(header.businessDate),
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
      ...(filter.dateFrom === undefined
        ? {}
        : { gte: dbBusinessDate(filter.dateFrom) }),
      ...(filter.dateTo === undefined
        ? {}
        : { lte: dbBusinessDate(filter.dateTo) }),
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
    basisMovementId: row.basisMovementId,
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
  if (!isInventoryDocumentAccountingPostingState(row.accountingPostingState)) {
    // C-62: a stored standing the code does not know is a defect, never a
    // silent default — the same rule the kind and status checks already
    // follow, and the same fail-closed shape the warehouse posting mode uses.
    throw new Error(
      `Stored inventory document "${row.id}" has an unknown accounting posting state "${row.accountingPostingState}".`,
    );
  }
  const base = {
    id: row.id,
    organizationId: row.organizationId,
    number: row.number,
    businessDate: businessDateFromDbDate(row.businessDate),
    lines: lineRows.map(toLineDomain),
    description: row.description,
    reference: row.reference,
    status: row.status,
    operationKey: row.operationKey,
    valuationStale: row.valuationStale,
    accountingPostingState: row.accountingPostingState,
    accountingPostingOperationId: row.accountingPostingOperationId,
    accountingDocumentId: row.accountingDocumentId,
    accountingDocumentNumber: row.accountingDocumentNumber,
    accountingDocumentPhase: row.accountingDocumentPhase,
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
  if (row.kind === 'purchase_return') {
    return {
      ...base,
      kind: 'purchase_return',
      warehouseId: row.warehouseId,
      sourceWarehouseId: null,
      destinationWarehouseId: null,
      cost: null,
    };
  }
  if (row.kind === 'sales_return') {
    return {
      ...base,
      kind: 'sales_return',
      warehouseId: row.warehouseId,
      sourceWarehouseId: null,
      destinationWarehouseId: null,
      cost: row.receiptCost === null ? null : decimalToString(row.receiptCost),
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
