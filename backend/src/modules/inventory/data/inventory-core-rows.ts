import type { BusinessDate } from '../../../kernel/datetime/business-date.js';
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
  /** Valuation columns (PDR-05): the VALUE half of the same ledger row. */
  totalCost: DecimalLike | null;
  valuationStatus: string;
  valuationSource: string | null;
  valuedAt: Date | null;
  valuationRunId: string | null;
} & AuditColumns;

export interface MovementWhere {
  id?: string | { in: string[] };
  organizationId?: string;
  branchId?: string;
  warehouseId?: string;
  itemId?: string;
  movementType?: string | { in: string[] };
  transferId?: string | null;
  reversalOfMovementId?: string | null;
  movementDate?: { gt?: Date; gte?: Date; lte?: Date };
  valuationStatus?: string | { in: string[] };
  valuationRunId?: string | null;
  /** C-59E: scope resolution reads movements by their document reference. */
  referenceType?: string;
  referenceId?: string | { in: string[] };
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
  movementDate: BusinessDate;
  transferId: string | null;
  reversalOfMovementId: string | null;
  referenceType: string | null;
  referenceId: string | null;
  reason: string | null;
  operationKey: string;
  /**
   * Valuation columns. Optional in the CREATE payload because the service
   * builds the quantity fact first and the posting transaction attaches the
   * value it computed under lock (`inventory-valuation-writes.ts`) — the
   * database defaults (`total_cost NULL`, `valuation_status 'unvalued'`)
   * describe exactly a fact that carries no value.
   */
  totalCost?: string | null;
  valuationStatus?: string;
  valuationSource?: string | null;
  valuedAt?: Date | null;
  valuationRunId?: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

/**
 * The ONLY shape a movement row is ever updated with (PDR-05, ADR-0039).
 *
 * The quantity facts of a movement stay immutable (D-05/AR-13) — there is no
 * update path for them anywhere in this module. The valuation columns are
 * different in kind: they are a PROJECTION of the ledger that an explicit,
 * audited recalculation may recompute, which is exactly the "never silent"
 * contract (OD-VAL-11). Keeping the update shape this narrow is what makes
 * that distinction enforceable by the type system rather than by discipline:
 * no caller can reach `quantity`, `movement_date` or `movement_type` through
 * it.
 */
export interface MovementCreateData extends Omit<
  MovementCreate,
  'movementDate'
> {
  movementDate: Date;
}

export interface MovementValuationUpdate {
  totalCost: string | null;
  valuationStatus: string;
  valuationSource: string | null;
  valuedAt: Date | null;
  valuationRunId: string | null;
  updatedAt: Date;
  updatedBy: string | null;
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
  create(args: { data: MovementCreateData }): Promise<MovementRow>;
  /** Valuation-only rewrite; see `MovementValuationUpdate`. */
  update(args: {
    where: { id: string };
    data: MovementValuationUpdate;
  }): Promise<MovementRow>;
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
  lastMovementDate: Date | null;
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
  lastMovementDate: Date | null;
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
// Valuation configuration, state and runs (PDR-05)
// ---------------------------------------------------------------------------

export type ItemValuationMethodRow = {
  id: string;
  organizationId: string;
  itemId: string;
  method: string;
  validFrom: Date;
  validTo: Date | null;
  note: string | null;
} & AuditColumns;

/**
 * The window half of a configuration filter: `validFrom <= x` and/or
 * `validTo IS NULL OR validTo > x`. Recursive, because selecting the
 * versions in force on SEVERAL dates is one OR of per-date windows rather
 * than one query per date.
 */
export interface ItemValuationMethodWindowWhere {
  validFrom?: { lte: Date };
  validTo?: null | { gt: Date };
  OR?: ItemValuationMethodWindowWhere[];
}

export interface ItemValuationMethodWhere extends ItemValuationMethodWindowWhere {
  id?: string;
  organizationId?: string;
  itemId?: string;
  method?: string;
}

export interface ItemValuationMethodCreate {
  id: string;
  organizationId: string;
  itemId: string;
  method: string;
  validFrom: BusinessDate;
  validTo: BusinessDate | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

/** The only shape a configuration version is updated with: close its window. */
export interface ItemValuationMethodCreateData extends Omit<
  ItemValuationMethodCreate,
  'validFrom' | 'validTo'
> {
  validFrom: Date;
  validTo: Date | null;
}

export interface ItemValuationMethodCloseUpdate {
  validTo: Date;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface ItemValuationMethodDelegate {
  findUnique(args: {
    where: { id: string };
  }): Promise<ItemValuationMethodRow | null>;
  findMany(args: {
    where: ItemValuationMethodWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<ItemValuationMethodRow[]>;
  count(args: { where: ItemValuationMethodWhere }): Promise<number>;
  create(args: {
    data: ItemValuationMethodCreateData;
  }): Promise<ItemValuationMethodRow>;
  update(args: {
    where: { id: string };
    data: ItemValuationMethodCloseUpdate;
  }): Promise<ItemValuationMethodRow>;
  /** Test-only cleanup for live-database suites (no API delete exists). */
  deleteMany(args: {
    where: ItemValuationMethodWhere;
  }): Promise<{ count: number }>;
}

export type ValuationStateRow = {
  id: string;
  organizationId: string;
  branchId: string;
  warehouseId: string;
  itemId: string;
  method: string;
  valuedQuantity: DecimalLike;
  uncostedQuantity: DecimalLike;
  totalValue: DecimalLike;
  status: string;
  staleSince: Date | null;
  lastValuedAt: Date | null;
  lastRecalculationId: string | null;
} & AuditColumns;

export interface ValuationStateWhere {
  id?: string;
  organizationId?: string;
  branchId?: string;
  warehouseId?: string;
  itemId?: string;
  status?: string;
}

export interface ValuationStateCreate {
  id: string;
  organizationId: string;
  branchId: string;
  warehouseId: string;
  itemId: string;
  method: string;
  valuedQuantity: string;
  uncostedQuantity: string;
  totalValue: string;
  status: string;
  staleSince: Date | null;
  lastValuedAt: Date | null;
  lastRecalculationId: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

/**
 * Absolute rewrite of a LOCKED valuation state row. Unlike the balance
 * counters (incremental `on_hand = on_hand + $1`), the valuation counters are
 * always written as the complete result the pure strategy computed from the
 * row it just read under lock — there is no partial-delta path, so a state
 * row can never drift from the position the engine actually produced.
 */
export interface ValuationStateUpdate {
  method: string;
  valuedQuantity: string;
  uncostedQuantity: string;
  totalValue: string;
  status: string;
  staleSince: Date | null;
  lastValuedAt: Date | null;
  lastRecalculationId: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface ValuationStateDelegate {
  findUnique(args: {
    where: { id: string };
  }): Promise<ValuationStateRow | null>;
  findFirst(args: {
    where: ValuationStateWhere;
  }): Promise<ValuationStateRow | null>;
  findMany(args: {
    where: ValuationStateWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<ValuationStateRow[]>;
  count(args: { where: ValuationStateWhere }): Promise<number>;
  create(args: { data: ValuationStateCreate }): Promise<ValuationStateRow>;
  update(args: {
    where: { id: string };
    data: ValuationStateUpdate;
  }): Promise<ValuationStateRow>;
  /** Test-only cleanup for live-database suites (no API delete exists). */
  deleteMany(args: { where: ValuationStateWhere }): Promise<{ count: number }>;
}

export type ValuationRunRow = {
  id: string;
  organizationId: string;
  branchId: string;
  warehouseId: string;
  itemId: string;
  method: string;
  trigger: string;
  fromDate: Date | null;
  movementsExamined: number;
  movementsRevalued: number;
  resultingValuedQuantity: DecimalLike;
  resultingUncostedQuantity: DecimalLike;
  resultingTotalValue: DecimalLike;
  resultingStatus: string;
  operationKey: string;
  reason: string | null;
  executedAt: Date;
} & AuditColumns;

export interface ValuationRunWhere {
  id?: string;
  organizationId?: string;
  branchId?: string;
  warehouseId?: string;
  itemId?: string;
  trigger?: string;
  /** C-59E OD-RVP-02: runs on the key executed after this instant. */
  executedAt?: { gt?: Date };
}

export interface ValuationRunCreate {
  id: string;
  organizationId: string;
  branchId: string;
  warehouseId: string;
  itemId: string;
  method: string;
  trigger: string;
  fromDate: Date | null;
  movementsExamined: number;
  movementsRevalued: number;
  resultingValuedQuantity: string;
  resultingUncostedQuantity: string;
  resultingTotalValue: string;
  resultingStatus: string;
  operationKey: string;
  reason: string | null;
  executedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface ValuationRunDelegate {
  findUnique(args: { where: { id: string } }): Promise<ValuationRunRow | null>;
  findMany(args: {
    where: ValuationRunWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<ValuationRunRow[]>;
  count(args: { where: ValuationRunWhere }): Promise<number>;
  create(args: { data: ValuationRunCreate }): Promise<ValuationRunRow>;
  /** Test-only cleanup for live-database suites (no API delete exists). */
  deleteMany(args: { where: ValuationRunWhere }): Promise<{ count: number }>;
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
// Pricing runs (C-59E — batch audit/reporting records, never a second truth)
// ---------------------------------------------------------------------------

export type PricingRunRow = {
  id: string;
  organizationId: string;
  warehouseId: string | null;
  documentKinds: string[];
  fromDate: Date | null;
  toDate: Date;
  kind: string;
  reversesRunId: string | null;
  reversedByRunId: string | null;
  reversedAt: Date | null;
  keysExamined: number;
  keysPriced: number;
  keysFailed: number;
  movementsExamined: number;
  movementsRevalued: number;
  reason: string | null;
  operationKey: string;
  executedBy: string | null;
  executedAt: Date;
} & AuditColumns;

export interface PricingRunCreate {
  id: string;
  organizationId: string;
  warehouseId: string | null;
  documentKinds: string[];
  fromDate: BusinessDate | null;
  toDate: BusinessDate;
  kind: string;
  reversesRunId: string | null;
  keysExamined: number;
  keysPriced: number;
  keysFailed: number;
  movementsExamined: number;
  movementsRevalued: number;
  reason: string | null;
  operationKey: string;
  executedBy: string | null;
  executedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface PricingRunCreateData extends Omit<
  PricingRunCreate,
  'fromDate' | 'toDate'
> {
  fromDate: Date | null;
  toDate: Date;
}

export interface PricingRunUpdate {
  keysExamined?: number;
  keysPriced?: number;
  keysFailed?: number;
  movementsExamined?: number;
  movementsRevalued?: number;
  reversedByRunId?: string | null;
  reversedAt?: Date | null;
  updatedAt: Date;
  updatedBy?: string | null;
}

export interface PricingRunWhere {
  id?: string;
  organizationId?: string;
  warehouseId?: string | null;
  kind?: string;
  /**
   * C-59 correction sprint (failed-key progression): the from-date lookup
   * filters on the completion counters — `keysFailed: 0` selects only fully
   * completed runs.
   */
  keysFailed?: number;
  /**
   * C-59 correction sprint (concurrent empty run): `keysExamined: { gt: 0 }`
   * selects runs that actually did work in their window — an empty run (no
   * movements in range) advances nothing.
   */
  keysExamined?: { gt: number };
  /** `null` selects runs that have NOT been reversed. */
  reversedByRunId?: string | null;
}

export interface PricingRunDelegate {
  findUnique(args: { where: { id: string } }): Promise<PricingRunRow | null>;
  findFirst(args: { where: PricingRunWhere }): Promise<PricingRunRow | null>;
  findMany(args: {
    where: PricingRunWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<PricingRunRow[]>;
  count(args: { where: PricingRunWhere }): Promise<number>;
  create(args: { data: PricingRunCreateData }): Promise<PricingRunRow>;
  update(args: {
    where: { id: string };
    data: PricingRunUpdate;
  }): Promise<PricingRunRow>;
}

export type PricingRunKeyOutcomeRow = {
  id: string;
  pricingRunId: string;
  organizationId: string;
  warehouseId: string;
  itemId: string;
  outcome: string;
  reason: string | null;
  failedMovementIds: string[];
  valuationRunId: string | null;
  movementsExamined: number;
  movementsRevalued: number;
} & AuditColumns;

export interface PricingRunKeyOutcomeCreate {
  id: string;
  pricingRunId: string;
  organizationId: string;
  warehouseId: string;
  itemId: string;
  outcome: string;
  reason: string | null;
  failedMovementIds: string[];
  valuationRunId: string | null;
  movementsExamined: number;
  movementsRevalued: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface PricingRunKeyOutcomeWhere {
  pricingRunId?: string | { in: string[] };
  organizationId?: string;
}

export interface PricingRunKeyOutcomeDelegate {
  findMany(args: {
    where: PricingRunKeyOutcomeWhere;
    orderBy?: OrderBy;
    skip?: number;
    take?: number;
  }): Promise<PricingRunKeyOutcomeRow[]>;
  count(args: { where: PricingRunKeyOutcomeWhere }): Promise<number>;
  create(args: {
    data: PricingRunKeyOutcomeCreate;
  }): Promise<PricingRunKeyOutcomeRow>;
}

// ---------------------------------------------------------------------------
// Transaction client
// ---------------------------------------------------------------------------

/** The delegates every posting transaction works with. */
export interface CoreClient {
  inventoryMovement: MovementDelegate;
  inventoryBalance: BalanceDelegate;
  inventoryReservation: ReservationDelegate;
  inventoryOperation: OperationDelegate;
  itemValuationMethod: ItemValuationMethodDelegate;
  inventoryValuationState: ValuationStateDelegate;
  inventoryValuationRun: ValuationRunDelegate;
  inventoryPricingRun: PricingRunDelegate;
  inventoryPricingRunKeyOutcome: PricingRunKeyOutcomeDelegate;
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
  /**
   * Statements whose result is not a row set — `pg_advisory_xact_lock`
   * returns `void`, which `$queryRaw` cannot deserialize (CI live-suite
   * finding, see `unit-conversions.repository.ts`).
   */
  $executeRaw: (
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<number>;
}

export interface CoreTransactionalClient extends CoreClient {
  $transaction: <T>(fn: (tx: CoreTxClient) => Promise<T>) => Promise<T>;
}
