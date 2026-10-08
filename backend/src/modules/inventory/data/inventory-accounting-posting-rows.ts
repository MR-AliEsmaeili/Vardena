import type { AuditColumns, OrderBy } from './master-data-rows.js';

/**
 * Row/delegate shapes for the Inventory → Accounting posting data layer
 * (C-62, PDR-10 C62-OD-05/OD-06).
 *
 * Same structural-typing convention as `inventory-business-document-rows.ts`
 * and `inventory-core-rows.ts`: Prisma models stay private to the module
 * (docs/database-strategy.md §2) and codegen may not have run, so the shapes
 * here are declared, not imported from a generated client. Services work with
 * domain types, never with these shapes.
 */

/** `inventory_accounting_posting_operations` — the durable operation ledger. */
export type InventoryAccountingPostingOperationRow = {
  id: string;
  organizationId: string;
  documentId: string;
  action: string;
  operationKey: string;
  requestHash: string;
  documentVersion: string;
  postingMode: string;
  state: string;
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
} & AuditColumns;

export interface InventoryAccountingPostingOperationWhere {
  id?: string | { in: string[] };
  organizationId?: string;
  documentId?: string;
  action?: string;
  operationKey?: string;
  state?: string | { in: string[] };
}

export interface InventoryAccountingPostingOperationCreate {
  id: string;
  organizationId: string;
  documentId: string;
  action: string;
  operationKey: string;
  requestHash: string;
  documentVersion: string;
  postingMode: string;
  state: string;
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
  createdBy: string | null;
}

export interface InventoryAccountingPostingOperationUpdate {
  state?: string;
  refusalCode?: string | null;
  refusalReason?: string | null;
  accountingDocumentId?: string | null;
  accountingDocumentNumber?: string | null;
  accountingDocumentPhase?: string | null;
  accountingOperationKey?: string | null;
  glPosted?: boolean;
  replayed?: boolean;
  completedAt?: Date | null;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface InventoryAccountingPostingOperationDelegate {
  findUnique(args: {
    where: { id: string };
  }): Promise<InventoryAccountingPostingOperationRow | null>;
  findFirst(args: {
    where: InventoryAccountingPostingOperationWhere;
    orderBy?: OrderBy | undefined;
  }): Promise<InventoryAccountingPostingOperationRow | null>;
  findMany(args: {
    where: InventoryAccountingPostingOperationWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<InventoryAccountingPostingOperationRow[]>;
  count(args: {
    where: InventoryAccountingPostingOperationWhere;
  }): Promise<number>;
  create(args: {
    data: InventoryAccountingPostingOperationCreate;
  }): Promise<InventoryAccountingPostingOperationRow>;
  update(args: {
    where: { id: string };
    data: InventoryAccountingPostingOperationUpdate;
  }): Promise<InventoryAccountingPostingOperationRow>;
}

/** `inventory_accounting_posting_snapshots` — the immutable posting snapshot. */
export type InventoryAccountingPostingSnapshotRow = {
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
  totalValue: unknown;
  actorUserId: string | null;
  capturedAt: Date;
} & AuditColumns;

export interface InventoryAccountingPostingSnapshotWhere {
  id?: string;
  organizationId?: string;
  operationId?: string;
  documentId?: string;
}

export interface InventoryAccountingPostingSnapshotCreate {
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
  createdAt: Date;
  createdBy: string | null;
}

export interface InventoryAccountingPostingSnapshotDelegate {
  findUnique(args: {
    where: { id: string };
  }): Promise<InventoryAccountingPostingSnapshotRow | null>;
  findFirst(args: {
    where: InventoryAccountingPostingSnapshotWhere;
    include?: { movements?: boolean };
  }): Promise<
    | (InventoryAccountingPostingSnapshotRow & {
        movements?: InventoryAccountingPostingSnapshotMovementRow[];
      })
    | null
  >;
  create(args: {
    data: InventoryAccountingPostingSnapshotCreate;
  }): Promise<InventoryAccountingPostingSnapshotRow>;
}

/** `inventory_accounting_posting_snapshot_movements`. */
export type InventoryAccountingPostingSnapshotMovementRow = {
  id: string;
  organizationId: string;
  snapshotId: string;
  movementId: string;
  lineId: string;
  itemId: string;
  quantity: unknown;
  unitId: string;
  baseQuantity: unknown;
  baseUnitId: string;
  totalValue: unknown;
  unitCost: unknown;
  valuationStatus: string;
  valuationSource: string | null;
  valuationRunId: string | null;
} & AuditColumns;

export interface InventoryAccountingPostingSnapshotMovementCreate {
  id: string;
  organizationId: string;
  snapshotId: string;
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
  createdAt: Date;
}

export interface InventoryAccountingPostingSnapshotMovementDelegate {
  findMany(args: {
    where: {
      organizationId?: string;
      snapshotId?: string;
      movementId?: string;
    };
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<InventoryAccountingPostingSnapshotMovementRow[]>;
  createMany(args: {
    data: InventoryAccountingPostingSnapshotMovementCreate[];
  }): Promise<{ count: number }>;
}

export interface InventoryAccountingPostingClient {
  inventoryAccountingPostingOperation: InventoryAccountingPostingOperationDelegate;
  inventoryAccountingPostingSnapshot: InventoryAccountingPostingSnapshotDelegate;
  inventoryAccountingPostingSnapshotMovement: InventoryAccountingPostingSnapshotMovementDelegate;
}

export interface InventoryAccountingPostingTransactionalClient extends InventoryAccountingPostingClient {
  $transaction: <T>(
    fn: (tx: InventoryAccountingPostingTxClient) => Promise<T>,
  ) => Promise<T>;
}

export interface InventoryAccountingPostingTxClient extends InventoryAccountingPostingClient {}
