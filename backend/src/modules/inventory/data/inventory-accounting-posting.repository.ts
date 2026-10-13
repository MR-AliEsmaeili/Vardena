import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import {
  businessDateFromDbDate,
  businessDateToDbDate,
  type BusinessDate,
} from '../../../kernel/datetime/business-date.js';
import { generateId } from '../../../kernel/ids/ulid.js';
import type { DocTxClient } from './inventory-business-document-rows.js';
import {
  isInventoryAccountingPostingState,
  type InventoryAccountingPostingState,
} from '../domain/inventory-accounting-posting-operation.js';
import type { AccountingPostingMovementFact } from '../domain/inventory-accounting-posting-request.js';
import type {
  InventoryAccountingPostingClient,
  InventoryAccountingPostingOperationCreate,
  InventoryAccountingPostingOperationRow,
  InventoryAccountingPostingOperationUpdate,
  InventoryAccountingPostingOperationWhere,
  InventoryAccountingPostingSnapshotCreate,
  InventoryAccountingPostingSnapshotMovementCreate,
  InventoryAccountingPostingSnapshotMovementRow,
  InventoryAccountingPostingSnapshotRow,
  InventoryAccountingPostingTxClient,
} from './inventory-accounting-posting-rows.js';

/** The durable operation, as the domain reads it. */
export interface InventoryAccountingPostingOperation {
  id: string;
  organizationId: string;
  documentId: string;
  action: string;
  operationKey: string;
  requestHash: string;
  documentVersion: string;
  postingMode: string;
  state: InventoryAccountingPostingState;
  refusalCode: string | null;
  refusalReason: string | null;
  accountingDocumentId: string | null;
  accountingDocumentNumber: string | null;
  accountingDocumentPhase: string | null;
  accountingOperationKey: string | null;
  glPosted: boolean;
  replayed: boolean;
  actorUserId: string | null;
  actorPermission: string;
  requestedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string | null;
  updatedBy?: string | null;
}

/** The immutable snapshot header, as the domain reads it. */
export interface InventoryAccountingPostingSnapshot {
  id: string;
  organizationId: string;
  operationId: string;
  documentId: string;
  documentType: string;
  documentNumber: string | null;
  documentVersion: string;
  documentDate: BusinessDate;
  branchId: string;
  warehouseId: string;
  valuationState: string;
  valuationStale: boolean;
  staleVerdict: string;
  valuationRunId: string | null;
  valuationBasis: string;
  totalValue: string;
  actorUserId: string | null;
  capturedAt: Date;
  createdAt: Date;
  createdBy?: string | null;
  movements: readonly InventoryAccountingPostingSnapshotMovement[];
}

export interface InventoryAccountingPostingSnapshotMovement {
  id: string;
  movementId: string;
  lineId: string;
  itemId: string;
  quantity: string;
  unitId: string;
  baseQuantity: string;
  baseUnitId: string;
  totalValue: string;
  unitCost: string;
  valuationStatus: string;
  valuationSource: string | null;
  valuationRunId: string | null;
}

export interface CreateAccountingPostingOperationInput {
  organizationId: string;
  documentId: string;
  action: string;
  operationKey: string;
  requestHash: string;
  documentVersion: string;
  postingMode: string;
  state: InventoryAccountingPostingState;
  accountingDocumentId?: string | null | undefined;
  accountingDocumentNumber?: string | null | undefined;
  accountingDocumentPhase?: string | null | undefined;
  accountingOperationKey?: string | null | undefined;
  actorUserId: string | null;
  actorPermission: string;
  now: Date;
}

export interface RecordAccountingPostingSnapshotInput {
  operationId: string;
  organizationId: string;
  documentId: string;
  documentType: string;
  documentNumber: string | null;
  documentVersion: string;
  documentDate: BusinessDate;
  branchId: string;
  warehouseId: string;
  valuationState: string;
  valuationStale: boolean;
  staleVerdict: string;
  valuationRunId: string | null;
  valuationBasis: string;
  totalValue: string;
  actorUserId: string | null;
  capturedAt: Date;
  movements: readonly AccountingPostingMovementFact[];
  now: Date;
}

export interface InventoryAccountingPostingOperationFilter {
  organizationId: string;
  documentId?: string | undefined;
  action?: string | undefined;
  state?: string | undefined;
}

/**
 * Data access for the C-62 Inventory → Accounting posting ledger
 * (`inventory_accounting_posting_operations` + the immutable snapshot tables).
 *
 * The operation row is the DURABLE intent: it is written BEFORE Accounting is
 * asked, so a crash between the two leaves a recoverable `REQUESTED`/`PENDING`
 * row instead of nothing. The snapshot is written with it, in the same
 * transaction, and is never updated afterwards — the `update` paths below only
 * ever touch the operation's state, result and timestamps.
 *
 * `(organization_id, document_id, action, operation_key)` is unique, so the
 * idempotency rule (C62-OD-06) is enforced by the database rather than by a
 * read-then-write check: a lost race surfaces as a unique violation, the
 * caller re-reads the winner's row and replays or refuses.
 */
@Injectable()
export class InventoryAccountingPostingRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<InventoryAccountingPostingClient> {
    return this.prisma.getClient<InventoryAccountingPostingClient>();
  }

  /**
   * The durable operation for one (organization, document, action, key).
   *
   * The optional `tx` lets the caller read through its OWN transaction — the
   * Phase-1 re-check that closes the find-then-create race reads under the
   * document row lock, so it must not miss a row the lock holder can see.
   */
  async findByKey(
    input: {
      organizationId: string;
      documentId: string;
      action: string;
      operationKey: string;
    },
    tx?: InventoryAccountingPostingTxClient | undefined,
  ): Promise<InventoryAccountingPostingOperation | null> {
    const client = tx ?? (await this.client());
    const row = await client.inventoryAccountingPostingOperation.findFirst({
      where: {
        organizationId: input.organizationId,
        documentId: input.documentId,
        action: input.action,
        operationKey: input.operationKey,
      },
    });
    return row === null ? null : toOperationDomain(row);
  }

  /**
   * The newest operation of one (organization, document) — ANY action — that
   * has NOT durably answered yet: `REQUESTED`, `PENDING`, `FAILED` (an
   * Accounting effect may already exist for it) or `DRAFT_CREATED` (an
   * Accounting draft exists). While one exists, a SECOND operation under ANY
   * key would be a second Accounting effect for the same document, so Phase 1
   * refuses it instead of racing it (the same-key retry never reaches this
   * check: it is answered by `findByKey` first).
   *
   * The one deliberate exception is a `DRAFT_CREATED` POSTING operation that
   * a terminal cancellation operation has superseded: its draft is gone, the
   * posting is history, and the document is re-postable. The caller decides
   * that with `findLatestInState`.
   */
  async findInFlightForDocument(input: {
    organizationId: string;
    documentId: string;
  }): Promise<InventoryAccountingPostingOperation | null> {
    const { inventoryAccountingPostingOperation } = await this.client();
    const row = await inventoryAccountingPostingOperation.findFirst({
      where: {
        organizationId: input.organizationId,
        documentId: input.documentId,
        // Every non-terminal state: REQUESTED/PENDING mean Accounting has
        // not answered, FAILED means an effect may already exist, and
        // DRAFT_CREATED means an Accounting draft exists.
        state: {
          in: ['REQUESTED', 'PENDING', 'FAILED', 'DRAFT_CREATED'],
        },
      },
      orderBy: [{ requestedAt: 'desc' }, { createdAt: 'desc' }],
    });
    return row === null ? null : toOperationDomain(row);
  }

  async findById(
    organizationId: string,
    id: string,
  ): Promise<InventoryAccountingPostingOperation | null> {
    const { inventoryAccountingPostingOperation } = await this.client();
    const row = await inventoryAccountingPostingOperation.findFirst({
      where: { organizationId, id },
    });
    return row === null ? null : toOperationDomain(row);
  }

  /** Every operation of one document, newest first — the audit trail. */
  async listForDocument(input: {
    organizationId: string;
    documentId: string;
  }): Promise<InventoryAccountingPostingOperation[]> {
    const { inventoryAccountingPostingOperation } = await this.client();
    const rows = await inventoryAccountingPostingOperation.findMany({
      where: {
        organizationId: input.organizationId,
        documentId: input.documentId,
      },
      orderBy: [{ requestedAt: 'desc' }, { createdAt: 'desc' }],
      skip: 0,
      take: 100,
    });
    return rows.map(toOperationDomain);
  }

  /** The most recent operation that reached a given state, if any. */
  async findLatestInState(input: {
    organizationId: string;
    documentId: string;
    action: string;
    state: string;
  }): Promise<InventoryAccountingPostingOperation | null> {
    const { inventoryAccountingPostingOperation } = await this.client();
    const row = await inventoryAccountingPostingOperation.findFirst({
      where: {
        organizationId: input.organizationId,
        documentId: input.documentId,
        action: input.action,
        state: input.state,
      },
      orderBy: [{ requestedAt: 'desc' }, { createdAt: 'desc' }],
    });
    return row === null ? null : toOperationDomain(row);
  }

  async findSnapshot(
    organizationId: string,
    operationId: string,
  ): Promise<InventoryAccountingPostingSnapshot | null> {
    const { inventoryAccountingPostingSnapshot } = await this.client();
    const row = await inventoryAccountingPostingSnapshot.findFirst({
      where: { organizationId, operationId },
      include: { movements: true },
    });
    if (row === null) return null;
    const movements = row.movements ?? [];
    return toSnapshotDomain(row, movements);
  }

  /**
   * Lock ONE operation row `FOR UPDATE` — the serialization point of PHASE 2.
   *
   * Two calls may legitimately reach the boundary for the SAME operation (a
   * fresh posting racing its own retry, or two concurrent retries of a
   * PENDING one). Accounting's own ledger replays the second call — but only
   * once the first call's ledger row is COMMITTED, and the numbering
   * allocation Accounting performs on the fresh-create path commits BEFORE
   * that row and is keyed by the operation key with a per-call reference, so
   * an unserialized second call can be refused as "a different request" even
   * though it is the same one. Holding the operation row across the boundary
   * call makes the second call start after the first committed its ledger
   * row, so it replays instead of conflicting: one operation, one effect,
   * one answer. The lock is per operation — it never serializes different
   * documents, and it is always released before PHASE 3 takes the document
   * row, so the lock order (document → operation → document, never nested)
   * cannot deadlock.
   */
  async lockOperationRow(
    tx: DocTxClient,
    organizationId: string,
    operationId: string,
  ): Promise<{ id: string; organizationId: string } | null> {
    const rows = await tx.$queryRaw<{ id: string; organizationId: string }>`
      SELECT "id", "organization_id" AS "organizationId"
      FROM "inventory"."inventory_accounting_posting_operations"
      WHERE "id" = ${operationId}
        AND "organization_id" = ${organizationId}
      FOR UPDATE`;
    return rows[0] ?? null;
  }

  /**
   * Create the durable operation AND its immutable snapshot in ONE transaction.
   *
   * This is the operation's "before" half: if it throws, nothing about the
   * posting exists, and a retry starts from a clean slate rather than from a
   * half-written ledger.
   */
  /**
   * Write the durable operation row INSIDE the caller's transaction, WITHOUT
   * a snapshot.
   *
   * Used by the CANCELLATION operation (`accounting_post:cancel`): its request
   * is the operation identity itself (organization, document, action, posting
   * operation key), so it is reconstructable from the row alone and needs no
   * immutable snapshot — OD-05's snapshot exists to freeze the POSTING's
   * valuation facts, which a cancellation never re-sends.
   */
  async createOperation(
    tx: InventoryAccountingPostingTxClient,
    operation: CreateAccountingPostingOperationInput,
  ): Promise<InventoryAccountingPostingOperation> {
    const created = await tx.inventoryAccountingPostingOperation.create({
      data: toOperationCreate(operation),
    });
    return toOperationDomain(created);
  }

  /**
   * Write the durable operation and its immutable snapshot INSIDE the caller's
   * transaction.
   *
   * The `tx` is the document transaction that has ALREADY locked the header
   * row and the valuation-state rows and re-derived eligibility from a
   * post-lock read. Opening a second `$transaction` here is not an option:
   * Prisma does not nest transactions, so the inner one would either
   * deadlock against the connection pool or fail outright, and - far worse -
   * the eligibility decision would stop being atomic with the record of what
   * was actually sent across the boundary. The caller owns the boundary; this
   * method only joins it.
   */
  async createOperationWithSnapshot(
    tx: InventoryAccountingPostingTxClient,
    operation: CreateAccountingPostingOperationInput,
    snapshot: RecordAccountingPostingSnapshotInput,
  ): Promise<InventoryAccountingPostingOperation> {
    const created = await this.createOperation(tx, operation);
    await this.writeSnapshot(tx, created.id, snapshot);
    return created;
  }

  /**
   * Record that this operation ANSWERED a replay (C62-OD-06).
   *
   * Without it the durable row would keep `replayed = false` for an operation
   * that was in fact replayed, because the replay path answers from the
   * existing record and never performs a new effect. That is dishonest audit
   * evidence: "this request was answered twice" is exactly what an auditor
   * reconciling the two ledgers needs to see.
   */
  async markReplayed(
    organizationId: string,
    id: string,
    actorUserId: string | null,
    now: Date,
  ): Promise<void> {
    const { inventoryAccountingPostingOperation } = await this.client();
    const row = await inventoryAccountingPostingOperation.update({
      where: { id },
      data: { replayed: true, updatedAt: now, updatedBy: actorUserId },
    });
    if (row.organizationId !== organizationId) {
      throw new Error(
        'An accounting posting operation was updated outside its organization.',
      );
    }
  }

  /** Apply a state transition and/or an Accounting result to an operation. */
  async updateOperation(
    organizationId: string,
    id: string,
    patch: InventoryAccountingPostingOperationUpdate,
  ): Promise<InventoryAccountingPostingOperation> {
    const { inventoryAccountingPostingOperation } = await this.client();
    const row = await inventoryAccountingPostingOperation.update({
      where: { id },
      data: patch,
    });
    if (row.organizationId !== organizationId) {
      // Unreachable through the service (every caller resolves the row inside
      // its own organization first); stated so a future caller cannot widen
      // the scope by accident.
      throw new Error(
        'An accounting posting operation was updated outside its organization.',
      );
    }
    return toOperationDomain(row);
  }

  private async writeSnapshot(
    tx: InventoryAccountingPostingTxClient,
    operationId: string,
    snapshot: RecordAccountingPostingSnapshotInput,
  ): Promise<void> {
    const snapshotId = generateId();
    await tx.inventoryAccountingPostingSnapshot.create({
      data: toSnapshotCreate(operationId, snapshotId, snapshot),
    });
    if (snapshot.movements.length === 0) return;
    await tx.inventoryAccountingPostingSnapshotMovement.createMany({
      data: snapshot.movements.map((movement, index) =>
        toSnapshotMovementCreate(
          operationId,
          snapshotId,
          movement,
          index,
          snapshot,
        ),
      ),
    });
  }
}

function toOperationCreate(
  input: CreateAccountingPostingOperationInput,
): InventoryAccountingPostingOperationCreate {
  return {
    id: generateId(),
    organizationId: input.organizationId,
    documentId: input.documentId,
    action: input.action,
    operationKey: input.operationKey,
    requestHash: input.requestHash,
    documentVersion: input.documentVersion,
    postingMode: input.postingMode,
    state: input.state,
    refusalCode: null,
    refusalReason: null,
    accountingDocumentId: input.accountingDocumentId ?? null,
    accountingDocumentNumber: input.accountingDocumentNumber ?? null,
    accountingDocumentPhase: input.accountingDocumentPhase ?? null,
    accountingOperationKey: input.accountingOperationKey ?? null,
    glPosted: false,
    replayed: false,
    actorUserId: input.actorUserId,
    actorPermission: input.actorPermission,
    requestedAt: input.now,
    completedAt: null,
    createdAt: input.now,
    updatedAt: input.now,
    createdBy: input.actorUserId,
  };
}

function toSnapshotCreate(
  operationId: string,
  snapshotId: string,
  input: RecordAccountingPostingSnapshotInput,
): InventoryAccountingPostingSnapshotCreate {
  return {
    id: snapshotId,
    organizationId: input.organizationId,
    operationId,
    documentId: input.documentId,
    documentType: input.documentType,
    documentNumber: input.documentNumber,
    documentVersion: input.documentVersion,
    documentDate: dbBusinessDate(input.documentDate),
    branchId: input.branchId,
    warehouseId: input.warehouseId,
    valuationState: input.valuationState,
    valuationStale: input.valuationStale,
    staleVerdict: input.staleVerdict,
    valuationRunId: input.valuationRunId,
    valuationBasis: input.valuationBasis,
    totalValue: input.totalValue,
    actorUserId: input.actorUserId,
    capturedAt: input.capturedAt,
    createdAt: input.now,
    createdBy: input.actorUserId,
  };
}

function toSnapshotMovementCreate(
  operationId: string,
  snapshotId: string,
  movement: AccountingPostingMovementFact,
  index: number,
  input: RecordAccountingPostingSnapshotInput,
): InventoryAccountingPostingSnapshotMovementCreate {
  return {
    id: generateId(),
    organizationId: input.organizationId,
    snapshotId,
    movementId: movement.movementId,
    lineId: movement.lineId,
    itemId: movement.itemId,
    quantity: movement.quantity,
    unitId: movement.unitId,
    baseQuantity: movement.baseQuantity,
    baseUnitId: movement.baseUnitId,
    totalValue: movement.value,
    unitCost: movement.unitCost,
    valuationStatus: movement.valuationStatus,
    valuationSource: movement.valuationSource,
    valuationRunId: movement.valuationRunId,
    createdAt: input.now,
  };
}

function toOperationDomain(
  row: InventoryAccountingPostingOperationRow,
): InventoryAccountingPostingOperation {
  if (!isInventoryAccountingPostingState(row.state)) {
    throw new Error(
      `Stored accounting posting operation "${row.id}" has an unknown state "${row.state}".`,
    );
  }
  return {
    id: row.id,
    organizationId: row.organizationId,
    documentId: row.documentId,
    action: row.action,
    operationKey: row.operationKey,
    requestHash: row.requestHash,
    documentVersion: row.documentVersion,
    postingMode: row.postingMode,
    state: row.state,
    refusalCode: row.refusalCode,
    refusalReason: row.refusalReason,
    accountingDocumentId: row.accountingDocumentId,
    accountingDocumentNumber: row.accountingDocumentNumber,
    accountingDocumentPhase: row.accountingDocumentPhase,
    accountingOperationKey: row.accountingOperationKey,
    glPosted: row.glPosted,
    replayed: row.replayed,
    actorUserId: row.actorUserId,
    actorPermission: row.actorPermission,
    requestedAt: row.requestedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
  };
}

function toSnapshotDomain(
  row: InventoryAccountingPostingSnapshotRow,
  movements: readonly InventoryAccountingPostingSnapshotMovementRow[],
): InventoryAccountingPostingSnapshot {
  return {
    id: row.id,
    organizationId: row.organizationId,
    operationId: row.operationId,
    documentId: row.documentId,
    documentType: row.documentType,
    documentNumber: row.documentNumber,
    documentVersion: row.documentVersion,
    documentDate: businessDateFromDbDate(row.documentDate),
    branchId: row.branchId,
    warehouseId: row.warehouseId,
    valuationState: row.valuationState,
    valuationStale: row.valuationStale,
    staleVerdict: row.staleVerdict,
    valuationRunId: row.valuationRunId,
    valuationBasis: row.valuationBasis,
    totalValue: decimalToString(row.totalValue),
    actorUserId: row.actorUserId,
    capturedAt: row.capturedAt,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    movements: movements
      .slice()
      .sort((left, right) => left.movementId.localeCompare(right.movementId))
      .map((movement) => ({
        id: movement.id,
        movementId: movement.movementId,
        lineId: movement.lineId,
        itemId: movement.itemId,
        quantity: decimalToString(movement.quantity),
        unitId: movement.unitId,
        baseQuantity: decimalToString(movement.baseQuantity),
        baseUnitId: movement.baseUnitId,
        totalValue: decimalToString(movement.totalValue),
        unitCost: decimalToString(movement.unitCost),
        valuationStatus: movement.valuationStatus,
        valuationSource: movement.valuationSource,
        valuationRunId: movement.valuationRunId,
      })),
  };
}

/**
 * Prisma hands back `Decimal` objects for `numeric` columns at runtime; the
 * module's convention is exact decimal STRINGS in the domain layer, so the
 * conversion happens once, here, and nowhere else.
 */
function decimalToString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (value === null || value === undefined) return '0';
  return String(value);
}

export type {
  InventoryAccountingPostingOperationWhere,
  InventoryAccountingPostingOperationUpdate,
};

function dbBusinessDate(value: BusinessDate): Date {
  const carrier = businessDateToDbDate(value);
  if (carrier === null) {
    throw new Error(`Invalid canonical Inventory BusinessDate "${value}".`);
  }
  return carrier;
}
