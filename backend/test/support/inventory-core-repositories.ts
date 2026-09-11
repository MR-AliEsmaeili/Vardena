/**
 * In-memory stand-ins for the Inventory Core repositories (test support).
 *
 * Same purpose as the master-data fakes: the e2e suite runs the FULL HTTP
 * stack — controllers, guards, real core services, the real permission
 * registry — with no Postgres. Only data access is faked.
 *
 * What is faked and what is not:
 * - faked: the four core repositories (movements, reservations, balances,
 *   operations);
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
  InsufficientStockError,
  ReservationAvailabilityError,
  ReservationNotActiveError,
} from '../../src/modules/inventory/data/inventory-posting-errors.js';
import type {
  BalanceKey,
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
import { InMemoryTable, listPage } from './master-data-repositories.js';

/** One coherent in-memory "database" shared by the four core fakes. */
export interface InventoryCoreTables {
  movements: InMemoryTable<InventoryMovement>;
  balances: InMemoryTable<InventoryBalance>;
  reservations: InMemoryTable<InventoryReservation>;
  operations: InMemoryTable<InventoryOperation>;
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
  };
  try {
    return await fn();
  } catch (error) {
    tables.movements.restore(snapshot.movements);
    tables.balances.restore(snapshot.balances);
    tables.reservations.restore(snapshot.reservations);
    tables.operations.restore(snapshot.operations);
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

/** `MovementCreate` → domain, mirroring the real row→domain mapping. */
function toMovement(create: MovementCreate): InventoryMovement {
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

function movementKey(movement: MovementCreate): BalanceKey {
  return {
    organizationId: movement.organizationId,
    branchId: movement.branchId,
    warehouseId: movement.warehouseId,
    itemId: movement.itemId,
  };
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
      const movement = this.tables.movements.insert(toMovement(input.movement));
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
      const outLeg = this.tables.movements.insert(toMovement(input.outLeg));
      const inLeg = this.tables.movements.insert(toMovement(input.inLeg));
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
      // The partial unique index is the backstop here too: a raced second
      // reversal of the same movement fails the insert with P2002.
      const movement = this.tables.movements.insert(toMovement(input.movement));
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
// Store bundle
// ---------------------------------------------------------------------------

export interface InventoryCoreStores {
  /** Handles typed as the real repositories — safe for `overrideProvider`. */
  movements: InventoryMovementsRepository;
  reservations: InventoryReservationsRepository;
  balances: InventoryBalancesRepository;
  operations: InventoryOperationsRepository;
  /** Shared tables for assertions and direct manipulation (drift seeding). */
  tables: InventoryCoreTables;
  /** Concrete fakes (rarely needed directly). */
  raw: {
    movements: InMemoryInventoryMovementsRepository;
    reservations: InMemoryInventoryReservationsRepository;
    balances: InMemoryInventoryBalancesRepository;
    operations: InMemoryInventoryOperationsRepository;
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
  return {
    movements: movements as unknown as InventoryMovementsRepository,
    reservations: reservations as unknown as InventoryReservationsRepository,
    balances: balances as unknown as InventoryBalancesRepository,
    operations: operations as unknown as InventoryOperationsRepository,
    tables,
    raw: { movements, reservations, balances, operations },
  };
}
