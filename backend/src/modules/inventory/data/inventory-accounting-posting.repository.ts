import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { generateId } from '../../../kernel/ids/ulid.js';
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
  InventoryAccountingPostingTransactionalClient,
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
  documentDate: Date;
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
  documentDate: Date;
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

  private transacting(): Promise<InventoryAccountingPostingTransactionalClient> {
    return this.prisma.getClient<InventoryAccountingPostingTransactionalClient>();
  }

  async findByKey(input: {
    organizationId: string;
    documentId: string;
    action: string;
    operationKey: string;
  }): Promise<InventoryAccountingPostingOperation | null> {
    const { inventoryAccountingPostingOperation } = await this.client();
    const row = await inventoryAccountingPostingOperation.findFirst({
      where: {
        organizationId: input.organizationId,
        documentId: input.documentId,
        action: input.action,
        operationKey: input.operationKey,
      },
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
   * Create the durable operation AND its immutable snapshot in ONE transaction.
   *
   * This is the operation's "before" half: if it throws, nothing about the
   * posting exists, and a retry starts from a clean slate rather than from a
   * half-written ledger.
   */
  async createOperationWithSnapshot(
    operation: CreateAccountingPostingOperationInput,
    snapshot: RecordAccountingPostingSnapshotInput,
  ): Promise<InventoryAccountingPostingOperation> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      const created = await tx.inventoryAccountingPostingOperation.create({
        data: toOperationCreate(operation),
      });
      await this.writeSnapshot(tx, created.id, snapshot);
      return toOperationDomain(created);
    });
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
    accountingDocumentId: null,
    accountingDocumentNumber: null,
    accountingDocumentPhase: null,
    accountingOperationKey: null,
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
    documentDate: input.documentDate,
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
    documentDate: row.documentDate,
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
