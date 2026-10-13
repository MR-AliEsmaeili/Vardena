import type { AuditColumns, OrderBy } from './master-data-rows.js';
import type {
  CoreClient,
  CoreTransactionalClient,
  CoreTxClient,
  DecimalLike,
} from './inventory-core-rows.js';

/**
 * Shared row/delegate shapes for Material Request's data layer (C-50).
 *
 * Same structural-typing convention as `inventory-core-rows.ts`: Prisma
 * models stay private to the module and codegen may not have run, so the
 * shapes here are declared, not imported from a generated client.
 *
 * `MrTxClient`/`MrTransactionalClient` extend the inventory core's own
 * transaction client — the approval transaction touches BOTH the Material
 * Request tables and the core's balance/reservation/operation tables in one
 * `$transaction`, reusing `lockBalanceRow`/`adjustBalanceCounters` from
 * `inventory-locks.ts` exactly as `InventoryReservationsRepository` does.
 */

// ---------------------------------------------------------------------------
// Material requests
// ---------------------------------------------------------------------------

export type MaterialRequestRow = {
  id: string;
  organizationId: string;
  number: string | null;
  status: string;
  description: string | null;
  requestedBy: string;
  submittedAt: Date | null;
  submittedBy: string | null;
  returnedAt: Date | null;
  returnedBy: string | null;
  returnReason: string | null;
  approvedAt: Date | null;
  approvedBy: string | null;
  rejectedAt: Date | null;
  rejectedBy: string | null;
  rejectionReason: string | null;
  approvalReversedAt: Date | null;
  approvalReversedBy: string | null;
  approvalReversalReason: string | null;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
} & AuditColumns;

export interface MaterialRequestWhere {
  id?: string;
  organizationId?: string;
  status?: string | { in: string[] };
  requestedBy?: string;
}

export interface MaterialRequestCreate {
  id: string;
  organizationId: string;
  number: string | null;
  status: string;
  description: string | null;
  requestedBy: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface MaterialRequestUpdate {
  number?: string | null;
  status?: string;
  description?: string | null;
  submittedAt?: Date | null;
  submittedBy?: string | null;
  returnedAt?: Date | null;
  returnedBy?: string | null;
  returnReason?: string | null;
  approvedAt?: Date | null;
  approvedBy?: string | null;
  rejectedAt?: Date | null;
  rejectedBy?: string | null;
  rejectionReason?: string | null;
  approvalReversedAt?: Date | null;
  approvalReversedBy?: string | null;
  approvalReversalReason?: string | null;
  cancelledAt?: Date | null;
  cancelledBy?: string | null;
  cancellationReason?: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface MaterialRequestDelegate {
  findUnique(args: {
    where: { id: string };
  }): Promise<MaterialRequestRow | null>;
  findMany(args: {
    where: MaterialRequestWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<MaterialRequestRow[]>;
  count(args: { where: MaterialRequestWhere }): Promise<number>;
  create(args: { data: MaterialRequestCreate }): Promise<MaterialRequestRow>;
  update(args: {
    where: { id: string };
    data: MaterialRequestUpdate;
  }): Promise<MaterialRequestRow>;
  delete(args: { where: { id: string } }): Promise<MaterialRequestRow>;
}

// ---------------------------------------------------------------------------
// Material request lines
// ---------------------------------------------------------------------------

export type MaterialRequestLineRow = {
  id: string;
  materialRequestId: string;
  organizationId: string;
  branchId: string;
  lineNumber: number;
  itemId: string;
  warehouseId: string;
  quantity: DecimalLike;
  unitId: string;
  baseQuantity: DecimalLike;
  baseUnitId: string;
  conversionFactor: DecimalLike;
  reservationRequested: boolean;
  reservationId: string | null;
  /** Authoritative, transactionally-maintained counter (C-50 §3.8) — see
   *  `material-requests.repository.ts#reserveInvocationCapacity`. */
  invokedBaseQuantity: DecimalLike;
  invocationCount: number;
} & AuditColumns;

export interface MaterialRequestLineWhere {
  id?: string;
  materialRequestId?: string;
  organizationId?: string;
}

export interface MaterialRequestLineCreate {
  id: string;
  materialRequestId: string;
  organizationId: string;
  branchId: string;
  lineNumber: number;
  itemId: string;
  warehouseId: string;
  quantity: string;
  unitId: string;
  baseQuantity: string;
  baseUnitId: string;
  conversionFactor: string;
  reservationRequested: boolean;
  reservationId: string | null;
  invokedBaseQuantity: string;
  invocationCount: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface MaterialRequestLineUpdate {
  itemId?: string;
  warehouseId?: string;
  branchId?: string;
  quantity?: string;
  unitId?: string;
  baseQuantity?: string;
  baseUnitId?: string;
  conversionFactor?: string;
  reservationRequested?: boolean;
  reservationId?: string | null;
  invokedBaseQuantity?: string;
  invocationCount?: number;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface MaterialRequestLineDelegate {
  findUnique(args: {
    where: { id: string };
  }): Promise<MaterialRequestLineRow | null>;
  findMany(args: {
    where: MaterialRequestLineWhere;
    orderBy: OrderBy;
  }): Promise<MaterialRequestLineRow[]>;
  create(args: {
    data: MaterialRequestLineCreate;
  }): Promise<MaterialRequestLineRow>;
  update(args: {
    where: { id: string };
    data: MaterialRequestLineUpdate;
  }): Promise<MaterialRequestLineRow>;
  deleteMany(args: {
    where: MaterialRequestLineWhere;
  }): Promise<{ count: number }>;
  delete(args: { where: { id: string } }): Promise<MaterialRequestLineRow>;
}

// ---------------------------------------------------------------------------
// Material request events (append-only audit trail)
// ---------------------------------------------------------------------------

export type MaterialRequestEventRow = {
  id: string;
  materialRequestId: string;
  organizationId: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorId: string | null;
  reason: string | null;
  referenceId: string | null;
  occurredAt: Date;
  createdAt: Date;
};

export interface MaterialRequestEventWhere {
  materialRequestId?: string;
  organizationId?: string;
}

export interface MaterialRequestEventCreate {
  id: string;
  materialRequestId: string;
  organizationId: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorId: string | null;
  reason: string | null;
  referenceId: string | null;
  occurredAt: Date;
  createdAt: Date;
}

export interface MaterialRequestEventDelegate {
  findMany(args: {
    where: MaterialRequestEventWhere;
    orderBy: OrderBy;
  }): Promise<MaterialRequestEventRow[]>;
  create(args: {
    data: MaterialRequestEventCreate;
  }): Promise<MaterialRequestEventRow>;
  /** Used only by draft deletion, to satisfy the ON DELETE RESTRICT foreign
   *  key before the header row itself is deleted. */
  deleteMany(args: {
    where: MaterialRequestEventWhere;
  }): Promise<{ count: number }>;
}

// ---------------------------------------------------------------------------
// Combined clients
// ---------------------------------------------------------------------------

export interface MrClient extends CoreClient {
  materialRequest: MaterialRequestDelegate;
  materialRequestLine: MaterialRequestLineDelegate;
  materialRequestEvent: MaterialRequestEventDelegate;
}

export interface MrTxClient extends CoreTxClient, MrClient {}

export interface MrTransactionalClient
  extends CoreTransactionalClient, MrClient {
  $transaction: <T>(fn: (tx: MrTxClient) => Promise<T>) => Promise<T>;
}
