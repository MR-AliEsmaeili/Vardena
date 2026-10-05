/**
 * In-memory stand-ins for the Inventory Core repositories (test support).
 *
 * Same purpose as the master-data fakes: the e2e suite runs the FULL HTTP
 * stack — controllers, guards, real core services, the real permission
 * registry — with no Postgres. Only data access is faked.
 *
 * What is faked and what is not:
 * - faked: the six core repositories (movements, reservations, balances,
 *   operations, valuation, valuation-method configuration);
 * - NOT faked: authorization, reference/quantity validation, conversion
 *   resolution, policy resolution, idempotency replay-or-reject, domain
 *   events, DTO validation.
 *
 * Fidelity rules these fakes honour (the contracts the real repositories
 * guarantee):
 * - each transactional method is ATOMIC: a snapshot/rollback wrapper mirrors
 *   `$transaction`, so a failed posting leaves no partial movement, counter
 *   bump, or idempotency row — exactly like a rolled-back transaction;
 * - counters use the domain's exact decimal helpers, never floats;
 * - VALUE is computed by the SAME pure strategy the production repositories
 *   call (`applyMovement`, `applyTransfer`, `replay` from
 *   `domain/moving-weighted-average.js`), so a valuation assertion here is a
 *   real assertion about the shipped rules and not about a second,
 *   conveniently-agreeing implementation;
 * - policy and availability failures throw the REAL error classes from
 *   `data/inventory-posting-errors.js` (the services catch them by
 *   `instanceof`), and key/unique races throw the same `P2002` the Prisma
 *   driver would, so the services' race fallback is exercised for real;
 * - stored magnitudes keep their signs: movements carry SIGNED base
 *   quantities (+in/−out), reservations UNSIGNED claims.
 *
 * What the fakes CANNOT mirror is true row locking: two postings racing
 * inside one Node process interleave at `await` points instead of
 * serializing on `SELECT … FOR UPDATE`. The idempotency-key race stays
 * faithful (the unique index backstop is real here too), but policy
 * check-then-act races are only provable against live Postgres — those
 * tests live in the opt-in live suite, not in the e2e journey.
 */
import { generateId } from '../../src/kernel/ids/ulid.js';
import {
  addDecimalStrings,
  compareDecimalStrings,
  subtractDecimalStrings,
} from '../../src/modules/inventory/domain/quantities.js';
import { violatesNegativePolicy } from '../../src/modules/inventory/domain/negative-stock-policy.js';
import { isMovementType } from '../../src/modules/inventory/domain/movement-type.js';
import type { InventoryMovement } from '../../src/modules/inventory/domain/inventory-movement.js';
import {
  isReservationStatus,
  type InventoryReservation,
} from '../../src/modules/inventory/domain/inventory-reservation.js';
import type { InventoryBalance } from '../../src/modules/inventory/domain/inventory-balance.js';
import {
  isInventoryOperationKind,
  type InventoryOperation,
  type InventoryOperationResult,
} from '../../src/modules/inventory/domain/inventory-operation.js';
import {
  AlreadyReversedError,
  BalanceDriftError,
  CostAlreadyAssignedError,
  InsufficientStockError,
  RecalculationTooLargeError,
  ReservationAvailabilityError,
  ReservationNotActiveError,
} from '../../src/modules/inventory/data/inventory-posting-errors.js';
import {
  distinctInstants,
  isValuationMethod,
  resolveValuationMethodAt,
  versionCoversAnyInstant,
  versionCoversInstant,
  type ItemValuationMethodVersion,
  type ValuationMethod,
} from '../../src/modules/inventory/domain/valuation-method.js';
import { planNewVersion } from '../../src/modules/inventory/domain/unit-conversion.js';
import {
  resolveValuationStatus,
  type InventoryValuationRun,
  type InventoryValuationState,
  type MovementValuationStatus,
  type ValuationSource,
} from '../../src/modules/inventory/domain/inventory-valuation.js';
import type { BackdateAssessment } from '../../src/modules/inventory/domain/backdating.js';
import {
  applyMovement,
  applyTransfer,
  type MovementValuation,
  type ValuationPosition,
} from '../../src/modules/inventory/domain/moving-weighted-average.js';
import {
  replay,
  toReplayFact,
  valuationChanged,
} from '../../src/modules/inventory/domain/valuation-replay.js';
import type {
  BalanceKey,
  ItemValuationMethodCreate,
  MovementCreate,
  OperationCreate,
  ReservationCreate,
} from '../../src/modules/inventory/data/inventory-core-rows.js';
import type { OrderBy } from '../../src/modules/inventory/data/master-data-rows.js';
import type {
  InventoryMovementsRepository,
  MovementListFilter,
  PostMovementInput,
  PostReversalInput,
  PostTransferInput,
} from '../../src/modules/inventory/data/inventory-movements.repository.js';
import type {
  CreateReservationInput,
  InventoryReservationsRepository,
  ReleaseReservationInput,
  ReservationListFilter,
} from '../../src/modules/inventory/data/inventory-reservations.repository.js';
import type {
  BalanceListFilter,
  BalanceScope,
  InventoryBalancesRepository,
  KeyComparison,
  KeyExpectation,
  KeyRebuild,
  StockingKey,
} from '../../src/modules/inventory/data/inventory-balances.repository.js';
import type { InventoryOperationsRepository } from '../../src/modules/inventory/data/inventory-operations.repository.js';
import {
  RECALCULATION_MOVEMENT_LIMIT,
  type AssignCostInput,
  type AssignCostOutput,
  type InventoryValuationRepository,
  type RecalculationInput,
  type RecalculationOutput,
  type ValuationRunFilter,
  type ValuationStateFilter,
} from '../../src/modules/inventory/data/inventory-valuation.repository.js';
import {
  ValuationMethodPlanRejectedError,
  type ItemValuationMethodsRepository,
  type PlannedMethodWrite,
  type ValuationMethodFilter,
} from '../../src/modules/inventory/data/item-valuation-methods.repository.js';
import { InMemoryTable, listPage } from './master-data-repositories.js';

/** One coherent in-memory "database" shared by the four core fakes. */
export interface InventoryCoreTables {
  movements: InMemoryTable<InventoryMovement>;
  balances: InMemoryTable<InventoryBalance>;
  reservations: InMemoryTable<InventoryReservation>;
  operations: InMemoryTable<InventoryOperation>;
  valuationStates: InMemoryTable<InventoryValuationState>;
  valuationRuns: InMemoryTable<InventoryValuationRun>;
  valuationMethods: InMemoryTable<ItemValuationMethodVersion>;
}

export function createInventoryCoreTables(): InventoryCoreTables {
  return {
    // Partial unique index: one reversal per movement (NULLs distinct).
    movements: new InMemoryTable<InventoryMovement>([['reversalOfMovementId']]),
    balances: new InMemoryTable<InventoryBalance>([
      ['organizationId', 'warehouseId', 'itemId'],
    ]),
    reservations: new InMemoryTable<InventoryReservation>(),
    // The idempotency backstop: a key commits exactly one effect.
    operations: new InMemoryTable<InventoryOperation>([
      ['organizationId', 'operationKey'],
    ]),
    // One valuation position per physical stocking key — the same grain the
    // balance projection uses.
    valuationStates: new InMemoryTable<InventoryValuationState>([
      ['organizationId', 'warehouseId', 'itemId'],
    ]),
    valuationRuns: new InMemoryTable<InventoryValuationRun>(),
    // One method version per item per start instant (effective dating).
    valuationMethods: new InMemoryTable<ItemValuationMethodVersion>([
      ['organizationId', 'itemId', 'validFrom'],
    ]),
  };
}

/**
 * Run a fake "transaction": the real repositories commit movement + balance
 * + idempotency row in ONE `$transaction`, so any throw must undo every
 * partial write. The snapshot covers all four tables because one method can
 * touch three of them.
 */
async function atomic<T>(
  tables: InventoryCoreTables,
  fn: () => Promise<T>,
): Promise<T> {
  const snapshot = {
    movements: tables.movements.snapshot(),
    balances: tables.balances.snapshot(),
    reservations: tables.reservations.snapshot(),
    operations: tables.operations.snapshot(),
    valuationStates: tables.valuationStates.snapshot(),
    valuationRuns: tables.valuationRuns.snapshot(),
    valuationMethods: tables.valuationMethods.snapshot(),
  };
  try {
    return await fn();
  } catch (error) {
    tables.movements.restore(snapshot.movements);
    tables.balances.restore(snapshot.balances);
    tables.reservations.restore(snapshot.reservations);
    tables.operations.restore(snapshot.operations);
    tables.valuationStates.restore(snapshot.valuationStates);
    tables.valuationRuns.restore(snapshot.valuationRuns);
    tables.valuationMethods.restore(snapshot.valuationMethods);
    throw error;
  }
}

/** Mirror of `lockBalanceRow`'s zero-row creation (no locking in-memory). */
function ensureBalance(
  tables: InventoryCoreTables,
  key: BalanceKey,
): { balance: InventoryBalance; created: boolean } {
  const existing = tables.balances.findOne(
    (row) =>
      row.organizationId === key.organizationId &&
      row.warehouseId === key.warehouseId &&
      row.itemId === key.itemId,
  );
  if (existing !== null) return { balance: existing, created: false };
  const now = new Date();
  const created = tables.balances.insert({
    id: generateId(),
    organizationId: key.organizationId,
    branchId: key.branchId,
    warehouseId: key.warehouseId,
    itemId: key.itemId,
    onHand: '0',
    reserved: '0',
    lastMovementAt: null,
    createdAt: now,
    updatedAt: now,
  });
  return { balance: created, created: true };
}

/** Mirror of the movements repository's policy evaluation. */
function assertSufficient(
  onHand: string,
  baseDelta: string,
  allowNegative: boolean,
): void {
  const resulting = addDecimalStrings(onHand, baseDelta);
  if (violatesNegativePolicy(resulting, allowNegative)) {
    const requested = baseDelta.trim().startsWith('-')
      ? subtractDecimalStrings('0', baseDelta)
      : baseDelta;
    throw new InsufficientStockError({ onHand, requested });
  }
}

function maxDate(current: Date | null, candidate: Date): Date {
  if (current === null || candidate.getTime() > current.getTime()) {
    return candidate;
  }
  return current;
}

/**
 * `MovementCreate` → domain, mirroring the real row→domain mapping.
 *
 * `valuation` carries the columns the posting path computed from the locked
 * position; a caller that passes none gets the unvalued columns, which is
 * what a quantity-only fixture row means.
 */
function toMovement(
  create: MovementCreate,
  valuation: MovementValuationColumns = UNVALUED_COLUMNS,
): InventoryMovement {
  if (!isMovementType(create.movementType)) {
    throw new Error(
      `Stored movement "${create.id}" has an unknown type "${create.movementType}".`,
    );
  }
  return {
    id: create.id,
    organizationId: create.organizationId,
    branchId: create.branchId,
    warehouseId: create.warehouseId,
    itemId: create.itemId,
    movementType: create.movementType,
    quantity: create.quantity,
    enteredUnitId: create.unitId,
    baseQuantity: create.baseQuantity,
    baseUnitId: create.baseUnitId,
    conversionFactor: create.conversionFactor,
    movementDate: create.movementDate,
    transferId: create.transferId,
    reversalOfMovementId: create.reversalOfMovementId,
    referenceType: create.referenceType,
    referenceId: create.referenceId,
    reason: create.reason,
    operationKey: create.operationKey,
    totalCost: valuation.totalCost,
    valuationStatus: valuation.valuationStatus,
    valuationSource: valuation.valuationSource,
    valuedAt: valuation.valuedAt,
    valuationRunId: valuation.valuationRunId,
    createdAt: create.createdAt,
    updatedAt: create.updatedAt,
  };
}

function toReservation(create: ReservationCreate): InventoryReservation {
  if (!isReservationStatus(create.status)) {
    throw new Error(
      `Stored reservation "${create.id}" has an unknown status "${create.status}".`,
    );
  }
  return {
    id: create.id,
    organizationId: create.organizationId,
    branchId: create.branchId,
    warehouseId: create.warehouseId,
    itemId: create.itemId,
    quantity: create.quantity,
    enteredUnitId: create.unitId,
    baseQuantity: create.baseQuantity,
    baseUnitId: create.baseUnitId,
    conversionFactor: create.conversionFactor,
    status: create.status,
    referenceType: create.referenceType,
    referenceId: create.referenceId,
    reason: create.reason,
    operationKey: create.operationKey,
    releasedAt: create.releasedAt,
    releasedBy: create.releasedBy,
    releaseOperationKey: create.releaseOperationKey,
    createdAt: create.createdAt,
    updatedAt: create.updatedAt,
  };
}

function toOperation(create: OperationCreate): InventoryOperation {
  if (!isInventoryOperationKind(create.operation)) {
    throw new Error(
      `Stored inventory operation "${create.id}" has an unknown operation "${create.operation}".`,
    );
  }
  return {
    id: create.id,
    organizationId: create.organizationId,
    operationKey: create.operationKey,
    operation: create.operation,
    requestHash: create.requestHash,
    // The services write validated envelopes; the fake replays them verbatim.
    result: create.result as InventoryOperationResult,
    createdAt: create.createdAt,
    updatedAt: create.updatedAt,
  };
}

function movementTypeOf(
  create: MovementCreate,
): InventoryMovement['movementType'] {
  if (!isMovementType(create.movementType)) {
    throw new Error(
      `Movement "${create.id}" has an unknown type "${create.movementType}".`,
    );
  }
  return create.movementType;
}

function movementKey(movement: MovementCreate): BalanceKey {
  return {
    organizationId: movement.organizationId,
    branchId: movement.branchId,
    warehouseId: movement.warehouseId,
    itemId: movement.itemId,
  };
}

// ---------------------------------------------------------------------------
// Valuation helpers (mirrors of `data/inventory-valuation-writes.ts`)
// ---------------------------------------------------------------------------

/** The valuation columns written onto a movement row. */
interface MovementValuationColumns {
  totalCost: string | null;
  valuationStatus: MovementValuationStatus;
  valuationSource: ValuationSource | null;
  valuedAt: Date | null;
  valuationRunId: string | null;
}

const UNVALUED_COLUMNS: MovementValuationColumns = {
  totalCost: null,
  valuationStatus: 'unvalued',
  valuationSource: null,
  valuedAt: null,
  valuationRunId: null,
};

function toMovementColumns(
  valuation: MovementValuation,
  valuedAt: Date,
): MovementValuationColumns {
  return {
    totalCost: valuation.totalCost,
    valuationStatus: valuation.status,
    valuationSource: valuation.source,
    valuedAt: valuation.status === 'unvalued' ? null : valuedAt,
    valuationRunId: null,
  };
}

function positionOf(state: InventoryValuationState): ValuationPosition {
  return {
    valuedQuantity: state.valuedQuantity,
    uncostedQuantity: state.uncostedQuantity,
    totalValue: state.totalValue,
  };
}

/** Mirror of `lockValuationStateRow`'s zero-row creation (no locking). */
function ensureValuationState(
  tables: InventoryCoreTables,
  key: BalanceKey,
  method: ValuationMethod,
): InventoryValuationState {
  const existing = tables.valuationStates.findOne(
    (row) =>
      row.organizationId === key.organizationId &&
      row.warehouseId === key.warehouseId &&
      row.itemId === key.itemId,
  );
  if (existing !== null) return existing;
  const now = new Date();
  return tables.valuationStates.insert({
    id: generateId(),
    organizationId: key.organizationId,
    branchId: key.branchId,
    warehouseId: key.warehouseId,
    itemId: key.itemId,
    method,
    valuedQuantity: '0',
    uncostedQuantity: '0',
    totalValue: '0',
    status: 'valued',
    staleSince: null,
    lastValuedAt: null,
    lastRecalculationId: null,
    createdAt: now,
    updatedAt: now,
  });
}

/** Mirror of `writeValuationState`, including the sticky `staleSince`. */
function writeValuationState(
  tables: InventoryCoreTables,
  input: {
    state: InventoryValuationState;
    position: ValuationPosition;
    method: ValuationMethod;
    marksStale: boolean;
    at: Date;
    recalculationId?: string | null;
    clearStale?: boolean;
  },
): InventoryValuationState {
  const clearStale = input.clearStale === true;
  const staleSince = clearStale
    ? input.marksStale
      ? input.at
      : null
    : (input.state.staleSince ?? (input.marksStale ? input.at : null));
  const patched = tables.valuationStates.patch(input.state.id, {
    method: input.method,
    valuedQuantity: input.position.valuedQuantity,
    uncostedQuantity: input.position.uncostedQuantity,
    totalValue: input.position.totalValue,
    status: resolveValuationStatus({
      uncostedQuantity: input.position.uncostedQuantity,
      staleSince,
    }),
    staleSince,
    lastValuedAt: input.at,
    lastRecalculationId:
      input.recalculationId === undefined
        ? input.state.lastRecalculationId
        : input.recalculationId,
    updatedAt: input.at,
  });
  if (patched === null) {
    throw new Error(`Valuation state "${input.state.id}" vanished.`);
  }
  return patched;
}

/** Mirror of `valueMovement`: pure strategy + absolute state write. */
function valueMovementInMemory(
  tables: InventoryCoreTables,
  input: {
    key: BalanceKey;
    method: ValuationMethod;
    movementType: InventoryMovement['movementType'];
    baseQuantity: string;
    knownValue: string | null;
    knownValueSource?: ValuationSource | undefined;
    backdated: boolean;
    at: Date;
  },
): MovementValuationColumns {
  const state = ensureValuationState(tables, input.key, input.method);
  const outcome = applyMovement(positionOf(state), {
    movementType: input.movementType,
    baseQuantity: input.baseQuantity,
    knownValue: input.knownValue,
    ...(input.knownValueSource === undefined
      ? {}
      : { knownValueSource: input.knownValueSource }),
    backdated: input.backdated,
  });
  writeValuationState(tables, {
    state,
    position: outcome.position,
    method: input.method,
    marksStale: outcome.marksStale,
    at: input.at,
  });
  return toMovementColumns(outcome.valuation, input.at);
}

function magnitudeOf(signed: string): string {
  return signed.trim().startsWith('-')
    ? subtractDecimalStrings('0', signed)
    : signed;
}

/** Mirror of `applyReplay`: deterministic replay + run row + state write. */
function applyReplayInMemory(
  tables: InventoryCoreTables,
  input: {
    state: InventoryValuationState;
    runId: string;
    key: BalanceKey;
    method: ValuationMethod;
    trigger: InventoryValuationRun['trigger'];
    fromDate: Date | null;
    reason: string | null;
    operationKey: string;
    at: Date;
  },
): { run: InventoryValuationRun; state: InventoryValuationState } {
  const rows = tables.movements
    .findMany(
      (row) =>
        row.organizationId === input.key.organizationId &&
        row.warehouseId === input.key.warehouseId &&
        row.itemId === input.key.itemId,
    )
    .sort(compareLedgerOrder)
    .slice(0, RECALCULATION_MOVEMENT_LIMIT + 1);
  if (rows.length > RECALCULATION_MOVEMENT_LIMIT) {
    throw new RecalculationTooLargeError(RECALCULATION_MOVEMENT_LIMIT);
  }
  // Mirrors the production repository exactly: the configuration read selects
  // the versions in force at the DISTINCT movement dates being replayed — so
  // it is bounded by how many dates there are, never by how densely the item
  // has been reconfigured — and the method is then resolved PER MOVEMENT at
  // that movement's own business date (OD-VAL-14), never one method for the
  // whole history.
  const instants = distinctInstants(rows.map((row) => row.movementDate));
  const versions =
    instants.length === 0
      ? []
      : tables.valuationMethods.findMany(
          (version) =>
            version.organizationId === input.key.organizationId &&
            version.itemId === input.key.itemId &&
            versionCoversAnyInstant(version, instants),
        );
  if (versions.length > instants.length) {
    throw new Error(
      `Item "${input.key.itemId}" has overlapping valuation method versions: ${versions.length} versions are in force across ${instants.length} movement dates. Historical resolution would be ambiguous, so the replay was refused.`,
    );
  }
  const result = replay(
    rows.map((row) =>
      toReplayFact(
        {
          id: row.id,
          movementType: row.movementType,
          baseQuantity: row.baseQuantity,
          totalCost: row.totalCost,
          valuationStatus: row.valuationStatus,
          valuationSource: row.valuationSource,
        },
        resolveValuationMethodAt(versions, row.movementDate).method,
      ),
    ),
  );
  const changes = rows.flatMap((row, index) => {
    const next = result.movements[index];
    if (next === undefined) return [];
    return valuationChanged(
      {
        status: row.valuationStatus,
        totalCost: row.totalCost,
        source: row.valuationSource,
      },
      next.valuation,
    )
      ? [{ id: row.id, valuation: next.valuation }]
      : [];
  });

  const run = tables.valuationRuns.insert({
    id: input.runId,
    organizationId: input.key.organizationId,
    branchId: input.key.branchId,
    warehouseId: input.key.warehouseId,
    itemId: input.key.itemId,
    method: input.method,
    trigger: input.trigger,
    fromDate: input.fromDate,
    movementsExamined: rows.length,
    movementsRevalued: changes.length,
    resultingValuedQuantity: result.position.valuedQuantity,
    resultingUncostedQuantity: result.position.uncostedQuantity,
    resultingTotalValue: result.position.totalValue,
    resultingStatus: resolveValuationStatus({
      uncostedQuantity: result.position.uncostedQuantity,
      staleSince: result.provisional ? input.at : null,
    }),
    operationKey: input.operationKey,
    reason: input.reason,
    executedAt: input.at,
    createdAt: input.at,
    updatedAt: input.at,
  });
  for (const change of changes) {
    tables.movements.patch(change.id, {
      totalCost: change.valuation.totalCost,
      valuationStatus: change.valuation.status,
      valuationSource: change.valuation.source,
      valuedAt: change.valuation.status === 'unvalued' ? null : input.at,
      valuationRunId: input.runId,
      updatedAt: input.at,
    });
  }
  const state = writeValuationState(tables, {
    state: input.state,
    position: result.position,
    method: input.method,
    marksStale: result.provisional,
    at: input.at,
    recalculationId: input.runId,
    clearStale: true,
  });
  return { run, state };
}

/** The canonical ledger order (C-54): movementDate, createdAt, id. */
function compareLedgerOrder(
  left: InventoryMovement,
  right: InventoryMovement,
): number {
  const byDate = left.movementDate.getTime() - right.movementDate.getTime();
  if (byDate !== 0) return byDate;
  const byCreated = left.createdAt.getTime() - right.createdAt.getTime();
  if (byCreated !== 0) return byCreated;
  return left.id.localeCompare(right.id);
}

// ---------------------------------------------------------------------------
// Movements
// ---------------------------------------------------------------------------

export class InMemoryInventoryMovementsRepository {
  constructor(private readonly tables: InventoryCoreTables) {}

  async findById(id: string): Promise<InventoryMovement | null> {
    return this.tables.movements.findById(id);
  }

  async findIds(ids: string[]): Promise<InventoryMovement[]> {
    const rows: InventoryMovement[] = [];
    for (const id of ids) {
      const row = this.tables.movements.findById(id);
      if (row !== null) rows.push(row);
    }
    return rows;
  }

  async findByTransferId(transferId: string): Promise<InventoryMovement[]> {
    return this.tables.movements
      .findMany((row) => row.transferId === transferId)
      .sort((a, b) => a.movementDate.getTime() - b.movementDate.getTime())
      .slice(0, 10);
  }

  async list(params: {
    where: MovementListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: InventoryMovement[]; total: number }> {
    // The range bounds are not row columns: strip them before the equality
    // filter and apply them in the extra predicate instead.
    const { dateFrom, dateTo, ...equality } = params.where;
    return listPage(
      this.tables.movements,
      {
        where: equality,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      },
      (row) => {
        if (
          dateFrom !== undefined &&
          row.movementDate.getTime() < dateFrom.getTime()
        ) {
          return false;
        }
        if (
          dateTo !== undefined &&
          row.movementDate.getTime() > dateTo.getTime()
        ) {
          return false;
        }
        return true;
      },
    );
  }

  async sumBaseQuantity(
    organizationId: string,
    warehouseId: string,
    itemId: string,
  ): Promise<string> {
    let total = '0';
    for (const row of this.tables.movements.findMany(
      (movement) =>
        movement.organizationId === organizationId &&
        movement.warehouseId === warehouseId &&
        movement.itemId === itemId,
    )) {
      total = addDecimalStrings(total, row.baseQuantity);
    }
    return total;
  }

  async maxMovementDate(
    organizationId: string,
    warehouseId: string,
    itemId: string,
  ): Promise<Date | null> {
    let max: Date | null = null;
    for (const row of this.tables.movements.findMany(
      (movement) =>
        movement.organizationId === organizationId &&
        movement.warehouseId === warehouseId &&
        movement.itemId === itemId,
    )) {
      if (max === null || row.movementDate.getTime() > max.getTime()) {
        max = row.movementDate;
      }
    }
    return max;
  }

  async existsForItem(itemId: string): Promise<boolean> {
    return (
      this.tables.movements.findOne((row) => row.itemId === itemId) !== null
    );
  }

  async existsForWarehouse(warehouseId: string): Promise<boolean> {
    return (
      this.tables.movements.findOne(
        (row) => row.warehouseId === warehouseId,
      ) !== null
    );
  }

  async postMovement(
    input: PostMovementInput,
  ): Promise<{ movement: InventoryMovement; balance: InventoryBalance }> {
    return atomic(this.tables, async () => {
      const { balance } = ensureBalance(
        this.tables,
        movementKey(input.movement),
      );
      assertSufficient(
        balance.onHand,
        input.movement.baseQuantity,
        input.allowNegative,
      );
      const columns = valueMovementInMemory(this.tables, {
        key: movementKey(input.movement),
        method: input.valuation.method,
        movementType: movementTypeOf(input.movement),
        baseQuantity: input.movement.baseQuantity,
        knownValue: input.valuation.knownValue,
        ...(input.valuation.knownValueSource === undefined
          ? {}
          : { knownValueSource: input.valuation.knownValueSource }),
        backdated: input.valuation.backdated,
        at: input.movement.updatedAt,
      });
      const movement = this.tables.movements.insert(
        toMovement(input.movement, columns),
      );
      this.tables.balances.patch(balance.id, {
        onHand: addDecimalStrings(balance.onHand, input.movement.baseQuantity),
        lastMovementAt: maxDate(
          balance.lastMovementAt,
          input.movement.movementDate,
        ),
        updatedAt: input.movement.updatedAt,
      });
      this.tables.operations.insert(toOperation(input.operation));
      return { movement, balance };
    });
  }

  async postTransfer(
    input: PostTransferInput,
  ): Promise<{ outLeg: InventoryMovement; inLeg: InventoryMovement }> {
    return atomic(this.tables, async () => {
      // Lock order is meaningless in-memory, but the SOURCE policy check is
      // not: only the out-leg can violate a negative-stock policy.
      const { balance: sourceBalance } = ensureBalance(
        this.tables,
        movementKey(input.outLeg),
      );
      const { balance: destinationBalance } = ensureBalance(
        this.tables,
        movementKey(input.inLeg),
      );
      assertSufficient(
        sourceBalance.onHand,
        input.outLeg.baseQuantity,
        input.sourceAllowNegative,
      );
      // A transfer is exactly value-neutral: the pair moves value out of one
      // position and into the other in ONE call, so no path can update one
      // side without the other.
      const sourceState = ensureValuationState(
        this.tables,
        movementKey(input.outLeg),
        input.valuationMethod,
      );
      const destinationState = ensureValuationState(
        this.tables,
        movementKey(input.inLeg),
        input.valuationMethod,
      );
      const transferOutcome = applyTransfer({
        source: positionOf(sourceState),
        destination: positionOf(destinationState),
        quantity: magnitudeOf(input.outLeg.baseQuantity),
      });
      writeValuationState(this.tables, {
        state: sourceState,
        position: transferOutcome.source,
        method: input.valuationMethod,
        marksStale: transferOutcome.marksStale,
        at: input.outLeg.updatedAt,
      });
      writeValuationState(this.tables, {
        state: destinationState,
        position: transferOutcome.destination,
        method: input.valuationMethod,
        marksStale: transferOutcome.marksStale,
        at: input.inLeg.updatedAt,
      });
      const outLeg = this.tables.movements.insert(
        toMovement(
          input.outLeg,
          toMovementColumns(
            transferOutcome.outValuation,
            input.outLeg.updatedAt,
          ),
        ),
      );
      const inLeg = this.tables.movements.insert(
        toMovement(
          input.inLeg,
          toMovementColumns(transferOutcome.inValuation, input.inLeg.updatedAt),
        ),
      );
      this.tables.balances.patch(sourceBalance.id, {
        onHand: addDecimalStrings(
          sourceBalance.onHand,
          input.outLeg.baseQuantity,
        ),
        lastMovementAt: maxDate(
          sourceBalance.lastMovementAt,
          input.outLeg.movementDate,
        ),
        updatedAt: input.outLeg.updatedAt,
      });
      this.tables.balances.patch(destinationBalance.id, {
        onHand: addDecimalStrings(
          destinationBalance.onHand,
          input.inLeg.baseQuantity,
        ),
        lastMovementAt: maxDate(
          destinationBalance.lastMovementAt,
          input.inLeg.movementDate,
        ),
        updatedAt: input.inLeg.updatedAt,
      });
      this.tables.operations.insert(toOperation(input.operation));
      return { outLeg, inLeg };
    });
  }

  async postReversal(
    input: PostReversalInput,
  ): Promise<{ movement: InventoryMovement }> {
    return atomic(this.tables, async () => {
      const original = this.tables.movements.findById(input.originalMovementId);
      if (original === null) {
        throw new Error(
          `Original movement "${input.originalMovementId}" does not exist.`,
        );
      }
      const prior = this.tables.movements.findOne(
        (row) => row.reversalOfMovementId === input.originalMovementId,
      );
      if (prior !== null) throw new AlreadyReversedError();

      const { balance } = ensureBalance(
        this.tables,
        movementKey(input.movement),
      );
      assertSufficient(
        balance.onHand,
        input.movement.baseQuantity,
        input.allowNegative,
      );
      // A reversal undoes the value the ORIGINAL actually carried, read from
      // the stored row — not the current average, and not a caller-supplied
      // number.
      const reversedValue =
        original.totalCost === null || original.valuationStatus === 'unvalued'
          ? null
          : magnitudeOf(original.totalCost);
      const columns = valueMovementInMemory(this.tables, {
        key: movementKey(input.movement),
        method: input.valuation.method,
        movementType: movementTypeOf(input.movement),
        baseQuantity: input.movement.baseQuantity,
        knownValue: reversedValue,
        knownValueSource: 'reversal',
        backdated: input.valuation.backdated,
        at: input.movement.updatedAt,
      });
      // The partial unique index is the backstop here too: a raced second
      // reversal of the same movement fails the insert with P2002.
      const movement = this.tables.movements.insert(
        toMovement(input.movement, columns),
      );
      this.tables.balances.patch(balance.id, {
        onHand: addDecimalStrings(balance.onHand, input.movement.baseQuantity),
        lastMovementAt: maxDate(
          balance.lastMovementAt,
          input.movement.movementDate,
        ),
        updatedAt: input.movement.updatedAt,
      });
      this.tables.operations.insert(toOperation(input.operation));
      return { movement };
    });
  }
}

// ---------------------------------------------------------------------------
// Reservations
// ---------------------------------------------------------------------------

export class InMemoryInventoryReservationsRepository {
  constructor(private readonly tables: InventoryCoreTables) {}

  async findById(id: string): Promise<InventoryReservation | null> {
    return this.tables.reservations.findById(id);
  }

  async list(params: {
    where: ReservationListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: InventoryReservation[]; total: number }> {
    return listPage(this.tables.reservations, {
      where: params.where,
      orderBy: params.orderBy,
      skip: params.skip,
      take: params.take,
    });
  }

  async sumActiveBaseQuantity(
    organizationId: string,
    warehouseId: string,
    itemId: string,
  ): Promise<string> {
    let total = '0';
    for (const row of this.tables.reservations.findMany(
      (reservation) =>
        reservation.organizationId === organizationId &&
        reservation.warehouseId === warehouseId &&
        reservation.itemId === itemId &&
        reservation.status === 'active',
    )) {
      total = addDecimalStrings(total, row.baseQuantity);
    }
    return total;
  }

  async createReservation(
    input: CreateReservationInput,
  ): Promise<InventoryReservation> {
    return atomic(this.tables, async () => {
      const { balance } = ensureBalance(this.tables, {
        organizationId: input.reservation.organizationId,
        branchId: input.reservation.branchId,
        warehouseId: input.reservation.warehouseId,
        itemId: input.reservation.itemId,
      });
      const resultingReserved = addDecimalStrings(
        balance.reserved,
        input.reservation.baseQuantity,
      );
      const resultingAvailable = subtractDecimalStrings(
        balance.onHand,
        resultingReserved,
      );
      if (violatesNegativePolicy(resultingAvailable, input.allowNegative)) {
        throw new ReservationAvailabilityError({
          available: subtractDecimalStrings(balance.onHand, balance.reserved),
          requested: input.reservation.baseQuantity,
        });
      }
      const reservation = this.tables.reservations.insert(
        toReservation(input.reservation),
      );
      this.tables.balances.patch(balance.id, {
        reserved: resultingReserved,
        updatedAt: input.reservation.updatedAt,
      });
      this.tables.operations.insert(toOperation(input.operation));
      return reservation;
    });
  }

  async releaseReservation(
    input: ReleaseReservationInput,
  ): Promise<InventoryReservation> {
    return atomic(this.tables, async () => {
      const locked = this.tables.reservations.findById(input.reservationId);
      if (locked === null) {
        throw new Error(`Reservation "${input.reservationId}" does not exist.`);
      }
      if (locked.status !== 'active') {
        throw new ReservationNotActiveError(locked.status);
      }
      const { balance } = ensureBalance(this.tables, {
        organizationId: locked.organizationId,
        branchId: locked.branchId,
        warehouseId: locked.warehouseId,
        itemId: locked.itemId,
      });
      const resultingReserved = subtractDecimalStrings(
        balance.reserved,
        locked.baseQuantity,
      );
      // Drift is refused, never silently clamped — same as the real path.
      if (compareDecimalStrings(resultingReserved, '0') < 0) {
        throw new BalanceDriftError();
      }
      const released = this.tables.reservations.patch(input.reservationId, {
        status: 'released',
        releasedAt: input.releasedAt,
        releasedBy: input.actorId,
        releaseOperationKey: input.operation.operationKey,
        updatedAt: input.releasedAt,
      });
      this.tables.balances.patch(balance.id, {
        reserved: resultingReserved,
        updatedAt: input.releasedAt,
      });
      this.tables.operations.insert(toOperation(input.operation));
      // `patch` throws when the row is missing; the row was just read.
      if (released === null) {
        throw new Error(`Reservation "${input.reservationId}" does not exist.`);
      }
      return released;
    });
  }
}

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

export class InMemoryInventoryBalancesRepository {
  constructor(private readonly tables: InventoryCoreTables) {}

  async findByKey(
    organizationId: string,
    warehouseId: string,
    itemId: string,
  ): Promise<InventoryBalance | null> {
    return this.tables.balances.findOne(
      (row) =>
        row.organizationId === organizationId &&
        row.warehouseId === warehouseId &&
        row.itemId === itemId,
    );
  }

  async list(params: {
    where: BalanceListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: InventoryBalance[]; total: number }> {
    return listPage(this.tables.balances, {
      where: params.where,
      orderBy: params.orderBy,
      skip: params.skip,
      take: params.take,
    });
  }

  async listStockingKeys(scope: BalanceScope): Promise<StockingKey[]> {
    const inScope = (row: { organizationId: string }): boolean =>
      row.organizationId === scope.organizationId;
    const matches = (row: { warehouseId: string; itemId: string }): boolean =>
      (scope.warehouseId === undefined ||
        row.warehouseId === scope.warehouseId) &&
      (scope.itemId === undefined || row.itemId === scope.itemId);
    const merged = new Map<string, StockingKey>();
    const collect = (row: { warehouseId: string; itemId: string }): void => {
      merged.set(`${row.warehouseId}|${row.itemId}`, {
        warehouseId: row.warehouseId,
        itemId: row.itemId,
      });
    };
    for (const row of this.tables.movements.findMany(
      (movement) => inScope(movement) && matches(movement),
    )) {
      collect(row);
    }
    for (const row of this.tables.balances.findMany(
      (balance) => inScope(balance) && matches(balance),
    )) {
      collect(row);
    }
    // Reservations count only while ACTIVE — a released claim is history.
    for (const row of this.tables.reservations.findMany(
      (reservation) =>
        inScope(reservation) &&
        matches(reservation) &&
        reservation.status === 'active',
    )) {
      collect(row);
    }
    return [...merged.values()].sort((a, b) =>
      `${a.warehouseId}|${a.itemId}`.localeCompare(
        `${b.warehouseId}|${b.itemId}`,
      ),
    );
  }

  async hasBlockingBalanceForItem(itemId: string): Promise<boolean> {
    // NUMERIC comparison, like the real `NOT (… = '0')` predicate: a row of
    // `0.0000` blocks nothing.
    return (
      this.tables.balances.findOne(
        (row) =>
          row.itemId === itemId &&
          (compareDecimalStrings(row.onHand, '0') !== 0 ||
            compareDecimalStrings(row.reserved, '0') !== 0),
      ) !== null
    );
  }

  async hasBlockingBalanceForWarehouse(warehouseId: string): Promise<boolean> {
    return (
      this.tables.balances.findOne(
        (row) =>
          row.warehouseId === warehouseId &&
          (compareDecimalStrings(row.onHand, '0') !== 0 ||
            compareDecimalStrings(row.reserved, '0') !== 0),
      ) !== null
    );
  }

  async compareKey(
    organizationId: string,
    key: StockingKey,
  ): Promise<KeyComparison> {
    // Read-only: no row is created here, only inspected.
    const stored = await this.findByKey(
      organizationId,
      key.warehouseId,
      key.itemId,
    );
    const expected = this.expectation(organizationId, key);
    if (stored === null) {
      return {
        ...expected,
        stored: null,
        matches:
          compareDecimalStrings(expected.expectedOnHand, '0') === 0 &&
          compareDecimalStrings(expected.expectedReserved, '0') === 0,
      };
    }
    return {
      ...expected,
      stored: { onHand: stored.onHand, reserved: stored.reserved },
      matches:
        compareDecimalStrings(stored.onHand, expected.expectedOnHand) === 0 &&
        compareDecimalStrings(stored.reserved, expected.expectedReserved) === 0,
    };
  }

  async rebuildKey(
    organizationId: string,
    branchId: string,
    key: StockingKey,
    actorId: string | null,
  ): Promise<KeyRebuild> {
    return atomic(this.tables, async () => {
      const { balance: stored, created: isNew } = ensureBalance(this.tables, {
        organizationId,
        branchId,
        warehouseId: key.warehouseId,
        itemId: key.itemId,
      });
      void actorId;
      const expected = this.expectation(organizationId, key);
      const factsExist =
        compareDecimalStrings(expected.expectedOnHand, '0') !== 0 ||
        compareDecimalStrings(expected.expectedReserved, '0') !== 0 ||
        expected.expectedLastMovementAt !== null;
      const now = new Date();

      if (isNew) {
        if (!factsExist) {
          this.tables.balances.delete(stored.id);
          return { ...expected, storedBefore: null, action: 'noop' };
        }
        this.tables.balances.patch(stored.id, {
          onHand: expected.expectedOnHand,
          reserved: expected.expectedReserved,
          lastMovementAt: expected.expectedLastMovementAt,
          updatedAt: now,
        });
        return { ...expected, storedBefore: null, action: 'created' };
      }

      const storedBefore = {
        onHand: stored.onHand,
        reserved: stored.reserved,
      };
      if (!factsExist) {
        this.tables.balances.delete(stored.id);
        return { ...expected, storedBefore, action: 'deleted' };
      }
      if (
        compareDecimalStrings(stored.onHand, expected.expectedOnHand) === 0 &&
        compareDecimalStrings(stored.reserved, expected.expectedReserved) ===
          0 &&
        sameInstant(stored.lastMovementAt, expected.expectedLastMovementAt)
      ) {
        return { ...expected, storedBefore, action: 'noop' };
      }
      this.tables.balances.patch(stored.id, {
        onHand: expected.expectedOnHand,
        reserved: expected.expectedReserved,
        lastMovementAt: expected.expectedLastMovementAt,
        updatedAt: now,
      });
      return { ...expected, storedBefore, action: 'updated' };
    });
  }

  /** The ledger-derived truth for one key (exact SUMs, no floats). */
  private expectation(
    organizationId: string,
    key: StockingKey,
  ): KeyExpectation {
    let expectedOnHand = '0';
    let expectedLastMovementAt: Date | null = null;
    for (const row of this.tables.movements.findMany(
      (movement) =>
        movement.organizationId === organizationId &&
        movement.warehouseId === key.warehouseId &&
        movement.itemId === key.itemId,
    )) {
      expectedOnHand = addDecimalStrings(expectedOnHand, row.baseQuantity);
      if (
        expectedLastMovementAt === null ||
        row.movementDate.getTime() > expectedLastMovementAt.getTime()
      ) {
        expectedLastMovementAt = row.movementDate;
      }
    }
    let expectedReserved = '0';
    for (const row of this.tables.reservations.findMany(
      (reservation) =>
        reservation.organizationId === organizationId &&
        reservation.warehouseId === key.warehouseId &&
        reservation.itemId === key.itemId &&
        reservation.status === 'active',
    )) {
      expectedReserved = addDecimalStrings(expectedReserved, row.baseQuantity);
    }
    return {
      warehouseId: key.warehouseId,
      itemId: key.itemId,
      expectedOnHand,
      expectedReserved,
      expectedLastMovementAt,
    };
  }
}

function sameInstant(left: Date | null, right: Date | null): boolean {
  if (left === null || right === null) return left === right;
  return left.getTime() === right.getTime();
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export class InMemoryInventoryOperationsRepository {
  constructor(private readonly tables: InventoryCoreTables) {}

  async findByKey(
    organizationId: string,
    operationKey: string,
  ): Promise<InventoryOperation | null> {
    return this.tables.operations.findOne(
      (row) =>
        row.organizationId === organizationId &&
        row.operationKey === operationKey,
    );
  }
}

// ---------------------------------------------------------------------------
// Valuation
// ---------------------------------------------------------------------------

export class InMemoryInventoryValuationRepository {
  constructor(private readonly tables: InventoryCoreTables) {}

  async findState(key: {
    organizationId: string;
    warehouseId: string;
    itemId: string;
  }): Promise<InventoryValuationState | null> {
    return this.tables.valuationStates.findOne(
      (row) =>
        row.organizationId === key.organizationId &&
        row.warehouseId === key.warehouseId &&
        row.itemId === key.itemId,
    );
  }

  async listStates(params: {
    where: ValuationStateFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: InventoryValuationState[]; total: number }> {
    return listPage(this.tables.valuationStates, params);
  }

  async findRunById(id: string): Promise<InventoryValuationRun | null> {
    return this.tables.valuationRuns.findById(id);
  }

  async listRuns(params: {
    where: ValuationRunFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: InventoryValuationRun[]; total: number }> {
    return listPage(this.tables.valuationRuns, params);
  }

  async assessBackdate(params: {
    organizationId: string;
    warehouseId: string;
    itemId: string;
    movementDate: Date;
  }): Promise<BackdateAssessment> {
    const rows = this.tables.movements.findMany(
      (row) =>
        row.organizationId === params.organizationId &&
        row.warehouseId === params.warehouseId &&
        row.itemId === params.itemId,
    );
    let latestMovementDate: Date | null = null;
    let affectedMovements = 0;
    let affectedValuedMovements = 0;
    for (const row of rows) {
      latestMovementDate = maxDate(latestMovementDate, row.movementDate);
      // Strictly later, exactly like the SQL `movementDate: { gt }`.
      if (row.movementDate.getTime() > params.movementDate.getTime()) {
        affectedMovements += 1;
        if (row.valuationStatus !== 'unvalued') affectedValuedMovements += 1;
      }
    }
    const state = await this.findState(params);
    return {
      backdated:
        latestMovementDate !== null &&
        params.movementDate.getTime() < latestMovementDate.getTime(),
      movementDate: params.movementDate,
      latestMovementDate,
      affectedMovements,
      affectedValuedMovements,
      alreadyStale: state?.status === 'stale',
    };
  }

  async recalculateKey(
    input: RecalculationInput,
  ): Promise<RecalculationOutput> {
    return atomic(this.tables, async () => {
      const state = ensureValuationState(this.tables, input.key, input.method);
      const applied = applyReplayInMemory(this.tables, {
        state,
        runId: input.runId,
        key: input.key,
        method: input.method,
        trigger: input.trigger,
        fromDate: input.fromDate,
        reason: input.reason,
        operationKey: input.operation.operationKey,
        at: input.at,
      });
      this.tables.operations.insert(toOperation(input.operation));
      return { run: applied.run, state: applied.state };
    });
  }

  async assignCost(input: AssignCostInput): Promise<AssignCostOutput> {
    return atomic(this.tables, async () => {
      const movement = this.tables.movements.findById(input.movementId);
      if (movement === null) {
        throw new Error(`Movement "${input.movementId}" does not exist.`);
      }
      if (movement.valuationStatus !== 'unvalued') {
        throw new CostAlreadyAssignedError(input.movementId);
      }
      const state = ensureValuationState(this.tables, input.key, input.method);
      this.tables.movements.patch(input.movementId, {
        totalCost: input.totalCost,
        valuationStatus: 'valued',
        valuationSource: 'entered',
        valuedAt: input.at,
        valuationRunId: null,
        updatedAt: input.at,
      });

      if (!input.recalculate) {
        // The honest half of "do not recalculate": the stored position no
        // longer matches the facts, and says so.
        const stale = writeValuationState(this.tables, {
          state,
          position: positionOf(state),
          method: input.method,
          marksStale: true,
          at: input.at,
        });
        this.tables.operations.insert(toOperation(input.operation));
        return { movementId: input.movementId, state: stale, run: null };
      }

      const applied = applyReplayInMemory(this.tables, {
        state,
        runId: input.runId,
        key: input.key,
        method: input.method,
        trigger: 'cost_assignment',
        fromDate: null,
        reason: input.reason,
        operationKey: input.operation.operationKey,
        at: input.at,
      });
      this.tables.operations.insert(toOperation(input.operation));
      return {
        movementId: input.movementId,
        state: applied.state,
        run: applied.run,
      };
    });
  }
}

// ---------------------------------------------------------------------------
// Valuation method configuration
// ---------------------------------------------------------------------------

export class InMemoryItemValuationMethodsRepository {
  constructor(private readonly tables: InventoryCoreTables) {}

  /**
   * Mirrors the production query: the window predicate is evaluated by the
   * store and only the winning row (latest `validFrom`) is returned.
   */
  async findEffectiveVersionAt(
    organizationId: string,
    itemId: string,
    asOf: Date,
  ): Promise<ItemValuationMethodVersion | null> {
    const matching = this.tables.valuationMethods
      .findMany(
        (row) =>
          row.organizationId === organizationId &&
          row.itemId === itemId &&
          versionCoversInstant(row, asOf),
      )
      .sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime());
    return matching[0] ?? null;
  }

  async findById(id: string): Promise<ItemValuationMethodVersion | null> {
    return this.tables.valuationMethods.findById(id);
  }

  async list(params: {
    where: ValuationMethodFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: ItemValuationMethodVersion[]; total: number }> {
    return listPage(this.tables.valuationMethods, params, (row, where) => {
      if (where.activeAt === undefined) return true;
      const at = where.activeAt.getTime();
      return (
        row.validFrom.getTime() <= at &&
        (row.validTo === null || row.validTo.getTime() > at)
      );
    });
  }

  async createVersion(input: {
    create: ItemValuationMethodCreate;
    closeAudit: { updatedAt: Date; updatedBy: string | null };
  }): Promise<PlannedMethodWrite> {
    return atomic(this.tables, async () => {
      // The complete series, exactly like the production write path: the
      // planner tests the candidate against EVERY existing window.
      const existing = this.tables.valuationMethods
        .findMany(
          (row) =>
            row.organizationId === input.create.organizationId &&
            row.itemId === input.create.itemId,
        )
        .sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime());
      // The REAL planner, so window rules are proven here, not re-stated.
      const plan = planNewVersion({
        candidate: {
          validFrom: input.create.validFrom,
          validTo: input.create.validTo,
        },
        existing,
      });
      if (plan.problem !== null) {
        throw new ValuationMethodPlanRejectedError(plan.problem);
      }
      if (plan.supersededId !== null) {
        this.tables.valuationMethods.patch(plan.supersededId, {
          validTo: input.create.validFrom,
          updatedAt: input.closeAudit.updatedAt,
        });
      }
      if (!isValuationMethod(input.create.method)) {
        throw new Error(
          `Valuation method version "${input.create.id}" has an unknown method "${input.create.method}".`,
        );
      }
      const version = this.tables.valuationMethods.insert({
        id: input.create.id,
        organizationId: input.create.organizationId,
        itemId: input.create.itemId,
        method: input.create.method,
        validFrom: input.create.validFrom,
        validTo: input.create.validTo,
        note: input.create.note,
        createdAt: input.create.createdAt,
        updatedAt: input.create.updatedAt,
      });
      return { version, supersededVersionId: plan.supersededId };
    });
  }
}

// ---------------------------------------------------------------------------
// Store bundle
// ---------------------------------------------------------------------------

export interface InventoryCoreStores {
  /** Handles typed as the real repositories — safe for `overrideProvider`. */
  movements: InventoryMovementsRepository;
  reservations: InventoryReservationsRepository;
  balances: InventoryBalancesRepository;
  operations: InventoryOperationsRepository;
  valuation: InventoryValuationRepository;
  valuationMethods: ItemValuationMethodsRepository;
  /** Shared tables for assertions and direct manipulation (drift seeding). */
  tables: InventoryCoreTables;
  /** Concrete fakes (rarely needed directly). */
  raw: {
    movements: InMemoryInventoryMovementsRepository;
    reservations: InMemoryInventoryReservationsRepository;
    balances: InMemoryInventoryBalancesRepository;
    operations: InMemoryInventoryOperationsRepository;
    valuation: InMemoryInventoryValuationRepository;
    valuationMethods: InMemoryItemValuationMethodsRepository;
  };
}

/**
 * Build one coherent in-memory "database" for the inventory core. The four
 * fakes share the tables because the real transactions span them (a posting
 * writes its movement, its balance bump, and its idempotency row together).
 */
export function createInventoryCoreStores(): InventoryCoreStores {
  const tables = createInventoryCoreTables();
  const movements = new InMemoryInventoryMovementsRepository(tables);
  const reservations = new InMemoryInventoryReservationsRepository(tables);
  const balances = new InMemoryInventoryBalancesRepository(tables);
  const operations = new InMemoryInventoryOperationsRepository(tables);
  const valuation = new InMemoryInventoryValuationRepository(tables);
  const valuationMethods = new InMemoryItemValuationMethodsRepository(tables);
  return {
    movements: movements as unknown as InventoryMovementsRepository,
    reservations: reservations as unknown as InventoryReservationsRepository,
    balances: balances as unknown as InventoryBalancesRepository,
    operations: operations as unknown as InventoryOperationsRepository,
    valuation: valuation as unknown as InventoryValuationRepository,
    valuationMethods:
      valuationMethods as unknown as ItemValuationMethodsRepository,
    tables,
    raw: {
      movements,
      reservations,
      balances,
      operations,
      valuation,
      valuationMethods,
    },
  };
}
