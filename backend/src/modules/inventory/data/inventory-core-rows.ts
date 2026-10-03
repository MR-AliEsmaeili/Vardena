import type { AuditColumns, OrderBy } from './master-data-rows.js';

/**
 * Shared row/delegate shapes for the inventory core's data layer (Task 7,
 * ADR-0022).
 *
 * One file for the four transactional repositories so the delegate surfaces
 * cannot drift apart: every posting transaction touches movements, balances,
 * reservations and operations through the SAME `CoreTxClient`. Prisma models
 * stay private to the module (docs/database-strategy.md §2) and codegen may
 * not have run, so — like the master-data repositories — the shapes declared
 * here are structural.
 *
 * Numeric columns arrive as Prisma `Decimal` at runtime (or plain strings
 * through some adapters); both stringify cleanly, so `DecimalLike` accepts
 * either and every mapper funnels through `String(...)`.
 */

export type DecimalLike = string | number | { toString(): string };

export function decimalToString(value: DecimalLike): string {
  return String(value);
}

// ---------------------------------------------------------------------------
// Movements
// ---------------------------------------------------------------------------

export type MovementRow = {
  id: string;
  organizationId: string;
  branchId: string;
  warehouseId: string;
  itemId: string;
  movementType: string;
  quantity: DecimalLike;
  unitId: string;
  baseQuantity: DecimalLike;
  baseUnitId: string;
  conversionFactor: DecimalLike;
  movementDate: Date;
  transferId: string | null;
  reversalOfMovementId: string | null;
  referenceType: string | null;
  referenceId: string | null;
  reason: string | null;
  operationKey: string;
} & AuditColumns;

export interface MovementWhere {
  id?: string;
  organizationId?: string;
  branchId?: string;
  warehouseId?: string;
  itemId?: string;
  movementType?: string | { in: string[] };
  transferId?: string | null;
  reversalOfMovementId?: string | null;
  movementDate?: { gte?: Date; lte?: Date };
}

export interface MovementCreate {
  id: string;
  organizationId: string;
  branchId: string;
  warehouseId: string;
  itemId: string;
  movementType: string;
  quantity: string;
  unitId: string;
  baseQuantity: string;
  baseUnitId: string;
  conversionFactor: string;
  movementDate: Date;
  transferId: string | null;
  reversalOfMovementId: string | null;
  referenceType: string | null;
  referenceId: string | null;
  reason: string | null;
  operationKey: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface MovementDelegate {
  findUnique(args: { where: { id: string } }): Promise<MovementRow | null>;
  findFirst(args: { where: MovementWhere }): Promise<MovementRow | null>;
  findMany(args: {
    where: MovementWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<MovementRow[]>;
  count(args: { where: MovementWhere }): Promise<number>;
  aggregate(args: {
    where: MovementWhere;
    _sum: { baseQuantity: true };
    _max: { movementDate: true };
  }): Promise<{
    _sum: { baseQuantity: DecimalLike | null };
    _max: { movementDate: Date | null };
  }>;
  /** Distinct (warehouse, item) pairs — reconciliation key enumeration. */
  groupBy(args: {
    by: Array<'warehouseId' | 'itemId'>;
    where: MovementWhere;
  }): Promise<Array<{ warehouseId: string; itemId: string }>>;
  create(args: { data: MovementCreate }): Promise<MovementRow>;
  /** Test-only cleanup for live-database suites (no API delete exists). */
  deleteMany(args: { where: MovementWhere }): Promise<{ count: number }>;
}

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

/** The natural key of a balance row: one warehouse × one item. */
export interface BalanceKey {
  organizationId: string;
  branchId: string;
  warehouseId: string;
  itemId: string;
}

export type BalanceRow = {
  id: string;
  organizationId: string;
  branchId: string;
  warehouseId: string;
  itemId: string;
  onHand: DecimalLike;
  /** Column `reserved_quantity`; the domain name is `reserved`. */
  reservedQuantity: DecimalLike;
  lastMovementAt: Date | null;
} & AuditColumns;

export interface BalanceWhere {
  id?: string;
  organizationId?: string;
  branchId?: string;
  warehouseId?: string;
  itemId?: string;
  OR?: Array<{
    onHand?: { not: string };
    reservedQuantity?: { not: string };
  }>;
}

export interface BalanceCreate {
  id: string;
  organizationId: string;
  branchId: string;
  warehouseId: string;
  itemId: string;
  onHand: string;
  reservedQuantity: string;
  lastMovementAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface BalanceDelegate {
  findUnique(args: { where: { id: string } }): Promise<BalanceRow | null>;
  findFirst(args: { where: BalanceWhere }): Promise<BalanceRow | null>;
  findMany(args: {
    where: BalanceWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<BalanceRow[]>;
  count(args: { where: BalanceWhere }): Promise<number>;
  groupBy(args: {
    by: Array<'warehouseId' | 'itemId'>;
    where: BalanceWhere;
  }): Promise<Array<{ warehouseId: string; itemId: string }>>;
  create(args: { data: BalanceCreate }): Promise<BalanceRow>;
  delete(args: { where: { id: string } }): Promise<BalanceRow>;
  /** Test-only cleanup for live-database suites (no API delete exists). */
  deleteMany(args: { where: BalanceWhere }): Promise<{ count: number }>;
}

// ---------------------------------------------------------------------------
// Reservations
// ---------------------------------------------------------------------------

export type ReservationRow = {
  id: string;
  organizationId: string;
  branchId: string;
  warehouseId: string;
  itemId: string;
  quantity: DecimalLike;
  unitId: string;
  baseQuantity: DecimalLike;
  baseUnitId: string;
  conversionFactor: DecimalLike;
  status: string;
  referenceType: string | null;
  referenceId: string | null;
  reason: string | null;
  operationKey: string;
  releasedAt: Date | null;
  releasedBy: string | null;
  releaseOperationKey: string | null;
} & AuditColumns;

export interface ReservationWhere {
  id?: string;
  organizationId?: string;
  branchId?: string;
  warehouseId?: string;
  itemId?: string;
  status?: string;
}

export interface ReservationCreate {
  id: string;
  organizationId: string;
  branchId: string;
  warehouseId: string;
  itemId: string;
  quantity: string;
  unitId: string;
  baseQuantity: string;
  baseUnitId: string;
  conversionFactor: string;
  status: string;
  referenceType: string | null;
  referenceId: string | null;
  reason: string | null;
  operationKey: string;
  releasedAt: Date | null;
  releasedBy: string | null;
  releaseOperationKey: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface ReservationReleaseUpdate {
  status: 'released';
  releasedAt: Date;
  releasedBy: string | null;
  releaseOperationKey: string;
  updatedAt: Date;
  updatedBy: string | null;
}

/**
 * Reduce an ACTIVE reservation's remaining quantity without changing its
 * status (C-50 §3.8/Owner decision: a Material Request invocation consumes
 * the corresponding amount from the line's active reservation). The caller
 * has already verified the result stays strictly positive — a reservation
 * that reaches exactly zero uses `ReservationConsumedCloseUpdate` instead,
 * because an ACTIVE reservation must never show a zero remaining quantity.
 */
export interface ReservationPartialConsumeUpdate {
  quantity: string;
  baseQuantity: string;
  updatedAt: Date;
  updatedBy: string | null;
}

/**
 * Close a reservation that invocation has just fully consumed: unlike
 * `ReservationReleaseUpdate` (reversal/cancellation releasing an UNCONSUMED
 * claim back to available stock), nothing is "released back" here — the
 * claim was entirely used, so the terminal row shows zero remaining rather
 * than the pre-consumption amount.
 */
export interface ReservationConsumedCloseUpdate {
  status: 'released';
  quantity: '0';
  baseQuantity: '0';
  releasedAt: Date;
  releasedBy: string | null;
  releaseOperationKey: string;
  updatedAt: Date;
  updatedBy: string | null;
}

/**
 * Compensate a consumption whose downstream Document Relation write then
 * failed: give back exactly what this invocation attempt took. When the
 * attempt had closed the reservation (`ReservationConsumedCloseUpdate`),
 * this also reopens it — the invocation never truly happened, so the
 * reservation must return to exactly its pre-attempt state.
 */
export interface ReservationReopenUpdate {
  status: 'active';
  quantity: string;
  baseQuantity: string;
  releasedAt: null;
  releasedBy: null;
  releaseOperationKey: null;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface ReservationDelegate {
  findUnique(args: { where: { id: string } }): Promise<ReservationRow | null>;
  findMany(args: {
    where: ReservationWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<ReservationRow[]>;
  count(args: { where: ReservationWhere }): Promise<number>;
  aggregate(args: {
    where: ReservationWhere;
    _sum: { baseQuantity: true };
  }): Promise<{ _sum: { baseQuantity: DecimalLike | null } }>;
  groupBy(args: {
    by: Array<'warehouseId' | 'itemId'>;
    where: ReservationWhere;
  }): Promise<Array<{ warehouseId: string; itemId: string }>>;
  create(args: { data: ReservationCreate }): Promise<ReservationRow>;
  update(args: {
    where: { id: string };
    data:
      | ReservationReleaseUpdate
      | ReservationPartialConsumeUpdate
      | ReservationConsumedCloseUpdate
      | ReservationReopenUpdate;
  }): Promise<ReservationRow>;
  /** Test-only cleanup for live-database suites (no API delete exists). */
  deleteMany(args: { where: ReservationWhere }): Promise<{ count: number }>;
}

// ---------------------------------------------------------------------------
// Operations (idempotency ledger)
// ---------------------------------------------------------------------------

export type OperationRow = {
  id: string;
  organizationId: string;
  operationKey: string;
  operation: string;
  requestHash: string;
  result: unknown;
} & AuditColumns;

export interface OperationWhere {
  organizationId?: string;
  operationKey?: string;
}

export interface OperationCreate {
  id: string;
  organizationId: string;
  operationKey: string;
  operation: string;
  requestHash: string;
  result: unknown;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface OperationDelegate {
  findFirst(args: { where: OperationWhere }): Promise<OperationRow | null>;
  create(args: { data: OperationCreate }): Promise<OperationRow>;
  /** Test-only cleanup for live-database suites (no API delete exists). */
  deleteMany(args: { where: OperationWhere }): Promise<{ count: number }>;
}

// ---------------------------------------------------------------------------
// Transaction client
// ---------------------------------------------------------------------------

/** The four delegates every posting transaction works with. */
export interface CoreClient {
  inventoryMovement: MovementDelegate;
  inventoryBalance: BalanceDelegate;
  inventoryReservation: ReservationDelegate;
  inventoryOperation: OperationDelegate;
}

/**
 * Parameterized raw SQL inside a transaction. Used ONLY for row locking
 * (`SELECT … FOR UPDATE`, which Prisma cannot express) and for exact
 * numeric counter updates (`SET on_hand = on_hand + $1`, evaluated by
 * PostgreSQL so no float ever touches a quantity). This is the documented
 * concurrency-critical path (docs/modules.md §Inventory, AR-11) — every
 * statement is parameterized, never string-concatenated.
 */
export type RawQuery = <T>(
  query: TemplateStringsArray,
  ...values: unknown[]
) => Promise<T[]>;

export interface CoreTxClient extends CoreClient {
  $queryRaw: RawQuery;
}

export interface CoreTransactionalClient extends CoreClient {
  $transaction: <T>(fn: (tx: CoreTxClient) => Promise<T>) => Promise<T>;
}
