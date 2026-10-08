import type { AuditColumns, OrderBy } from './master-data-rows.js';
import type {
  CoreClient,
  CoreTransactionalClient,
  CoreTxClient,
  DecimalLike,
} from './inventory-core-rows.js';

/**
 * Row/delegate shapes for the Inventory Business Document data layer (C-58).
 *
 * Same structural-typing convention as `inventory-core-rows.ts` and
 * `material-request-rows.ts`: Prisma models stay private to the module
 * (docs/database-strategy.md §2) and codegen may not have run, so the shapes
 * here are declared, not imported from a generated client.
 *
 * `DocTxClient` extends the inventory core's own transaction client because
 * finalize/edit/cancel touch BOTH the document tables and the core's
 * movement/balance/valuation/operation tables in ONE `$transaction` — the
 * caller-owned boundary `InventoryMovementsRepository.withTransaction`
 * exposes.
 */

export type InventoryDocumentRow = {
  id: string;
  organizationId: string;
  kind: string;
  number: string | null;
  businessDate: Date;
  warehouseId: string | null;
  sourceWarehouseId: string | null;
  destinationWarehouseId: string | null;
  receiptCost: DecimalLike | null;
  status: string;
  description: string | null;
  reference: string | null;
  operationKey: string | null;
  valuationStale: boolean;
  // C-62: the document's Accounting standing projected onto its own header.
  // The authoritative record stays `inventory_accounting_posting_operations`.
  accountingPostingState: string;
  accountingPostingOperationId: string | null;
  accountingDocumentId: string | null;
  accountingDocumentNumber: string | null;
  accountingDocumentPhase: string | null;
  finalizedAt: Date | null;
  finalizedBy: string | null;
  accountingPostedAt: Date | null;
  accountingPostedBy: string | null;
  sealedAt: Date | null;
  sealedBy: string | null;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
} & AuditColumns;

export interface InventoryDocumentWhere {
  id?: string | { in: string[] };
  organizationId?: string;
  kind?: string | { in: string[] };
  status?: string | { in: string[] };
  warehouseId?: string;
  businessDate?: { gte?: Date; lte?: Date };
}

export interface InventoryDocumentCreate {
  id: string;
  organizationId: string;
  kind: string;
  number: string | null;
  businessDate: Date;
  warehouseId: string | null;
  sourceWarehouseId: string | null;
  destinationWarehouseId: string | null;
  receiptCost: string | null;
  status: string;
  description: string | null;
  reference: string | null;
  operationKey: string | null;
  // C-62: deliberately absent, exactly like `valuationStale` above — the
  // database default `not_posted` is the only value a new document may carry.
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface InventoryDocumentUpdate {
  number?: string | null;
  businessDate?: Date;
  warehouseId?: string | null;
  sourceWarehouseId?: string | null;
  destinationWarehouseId?: string | null;
  receiptCost?: string | null;
  status?: string;
  description?: string | null;
  reference?: string | null;
  operationKey?: string | null;
  valuationStale?: boolean;
  accountingPostingState?: string;
  accountingPostingOperationId?: string | null;
  accountingDocumentId?: string | null;
  accountingDocumentNumber?: string | null;
  accountingDocumentPhase?: string | null;
  finalizedAt?: Date | null;
  finalizedBy?: string | null;
  accountingPostedAt?: Date | null;
  accountingPostedBy?: string | null;
  sealedAt?: Date | null;
  sealedBy?: string | null;
  cancelledAt?: Date | null;
  cancelledBy?: string | null;
  cancellationReason?: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface InventoryDocumentDelegate {
  findUnique(args: {
    where: { id: string };
  }): Promise<InventoryDocumentRow | null>;
  findMany(args: {
    where: InventoryDocumentWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<InventoryDocumentRow[]>;
  count(args: { where: InventoryDocumentWhere }): Promise<number>;
  create(args: {
    data: InventoryDocumentCreate;
  }): Promise<InventoryDocumentRow>;
  update(args: {
    where: { id: string };
    data: InventoryDocumentUpdate;
  }): Promise<InventoryDocumentRow>;
  delete(args: { where: { id: string } }): Promise<InventoryDocumentRow>;
}

export type InventoryDocumentLineRow = {
  id: string;
  documentId: string;
  organizationId: string;
  lineNumber: number;
  itemId: string;
  quantity: DecimalLike;
  unitId: string;
  baseQuantity: DecimalLike;
  baseUnitId: string;
  conversionFactor: DecimalLike;
  /** C-59D return basis link (OD-RET-01); NULL on non-return lines. */
  basisMovementId: string | null;
  movementId: string | null;
  outMovementId: string | null;
  inMovementId: string | null;
} & AuditColumns;

export interface InventoryDocumentLineWhere {
  id?: string;
  documentId?: string | { in: string[] };
  organizationId?: string;
  /** C-59D: every line linked to one basis movement (over-return guard). */
  basisMovementId?: string;
}

export interface InventoryDocumentLineCreate {
  id: string;
  documentId: string;
  organizationId: string;
  lineNumber: number;
  itemId: string;
  quantity: string;
  unitId: string;
  baseQuantity: string;
  baseUnitId: string;
  conversionFactor: string;
  /** C-59D return basis link (OD-RET-01); NULL on non-return lines. */
  basisMovementId: string | null;
  movementId: string | null;
  outMovementId: string | null;
  inMovementId: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface InventoryDocumentLineUpdate {
  movementId?: string | null;
  outMovementId?: string | null;
  inMovementId?: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface InventoryDocumentLineDelegate {
  findMany(args: {
    where: InventoryDocumentLineWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<InventoryDocumentLineRow[]>;
  create(args: {
    data: InventoryDocumentLineCreate;
  }): Promise<InventoryDocumentLineRow>;
  update(args: {
    where: { id: string };
    data: InventoryDocumentLineUpdate;
  }): Promise<InventoryDocumentLineRow>;
  deleteMany(args: {
    where: InventoryDocumentLineWhere;
  }): Promise<{ count: number }>;
}

/** The core delegates plus the two document tables. */
export interface DocClient extends CoreClient {
  inventoryBusinessDocument: InventoryDocumentDelegate;
  inventoryBusinessDocumentLine: InventoryDocumentLineDelegate;
}

export interface DocTxClient extends CoreTxClient {
  inventoryBusinessDocument: InventoryDocumentDelegate;
  inventoryBusinessDocumentLine: InventoryDocumentLineDelegate;
}

export interface DocTransactionalClient extends CoreTransactionalClient {
  inventoryBusinessDocument: InventoryDocumentDelegate;
  inventoryBusinessDocumentLine: InventoryDocumentLineDelegate;
  $transaction: <T>(fn: (tx: DocTxClient) => Promise<T>) => Promise<T>;
}
