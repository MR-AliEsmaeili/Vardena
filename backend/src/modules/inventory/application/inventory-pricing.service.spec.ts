import { licensingTestDouble } from '../../../../test/support/licensing.js';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  toBusinessDate,
  type BusinessDate,
} from '../../../kernel/datetime/business-date.js';
import {
  runWithRequestContext,
  type AuthenticatedPrincipal,
} from '../../../kernel/correlation/request-context.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { DomainEventBus } from '../../../kernel/events/domain-event-bus.js';
import { createMasterDataStores } from '../../../../test/support/master-data-repositories.js';
import { UNPINNED_APP_CONFIG } from '../../../../test/support/app-config.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { BranchesService } from '../../organization/application/branches.service.js';
import { UnitsService } from './units.service.js';
import { ItemGroupsService } from './item-groups.service.js';
import { ItemsService } from './items.service.js';
import { WarehousesService } from './warehouses.service.js';
import {
  InventoryPricingService,
  type RunPricingInput,
} from './inventory-pricing.service.js';
import type { InventoryValuationService } from './inventory-valuation.service.js';
import type { InventoryPricingRepository } from '../data/inventory-pricing.repository.js';
import type { InventoryValuationRepository } from '../data/inventory-valuation.repository.js';
import type { InventoryMovementsRepository } from '../data/inventory-movements.repository.js';
import type { InventoryBusinessDocumentsRepository } from '../data/inventory-business-documents.repository.js';
import type { InventoryOperationsRepository } from '../data/inventory-operations.repository.js';
import type { InventoryBalancesRepository } from '../data/inventory-balances.repository.js';
import type { InventoryMovement } from '../domain/inventory-movement.js';
import type {
  InventoryPricingRun,
  InventoryValuationRun,
  InventoryValuationState,
} from '../domain/inventory-valuation.js';
import type { BalanceKey } from '../data/inventory-core-rows.js';
import {
  foldPreservedPosition,
  toCompensationFacts,
} from '../domain/valuation-compensation.js';
import {
  INVENTORY_PRICING_RUN_COMPLETED_EVENT,
  INVENTORY_PRICING_RUN_REVERSED_EVENT,
} from '../domain/inventory-pricing.events.js';
import { AppException } from '../../../kernel/errors/app-exception.js';

/**
 * `InventoryPricingService` — the Periodic Pricing Operation and Reverse
 * Pricing runtime contract (C-59E/C-59E+, OD-PRC-05…07, OD-PDP-01…05,
 * OD-RVP-01…08), including the two corrections this sprint pinned:
 *
 *   1. Axis 2 (retry semantics): a run with failed keys — or a reversed
 *      run — must NOT advance its scope's from-date, so the next run
 *      re-covers the window and the failed key is retried, never silently
 *      skipped;
 *   2. Axis 1 (reverse fold): the compensating write must leave the key at
 *      the PRE-run position (the run's values erased), observed here
 *      end-to-end through a fake valuation repository whose compensating
 *      write runs the REAL domain fold.
 *
 * The persistence layer is faked (`PricingWorld` below) because this
 * sandbox has no PostgreSQL; the real-Postgres proof of the SQL, the locks
 * and the concurrency lives in `test/inventory-pricing-live.e2e-spec.ts`
 * and runs in CI. What the fake reproduces faithfully, because these
 * tests depend on it:
 *
 *   * `findLastRunForScope`'s completed-run filter (only
 *     `kind = pricing_operation AND keysFailed = 0 AND reversedByRunId IS
 *     NULL` runs advance the boundary — mirrored from the repository, whose
 *     behavior the live suite pins against real PostgreSQL);
 *   * one transaction per command with a real rollback (a snapshot of
 *     every store is restored when the work throws);
 *   * `(organizationId, operationKey)` uniqueness throwing Prisma's
 *     `P2002`, so the service's unique-race replay path is exercised;
 *   * the un-valuing write of `reverseRunWithin` exactly as the repository
 *     performs it (cost/source erased, status `unvalued`, the compensating
 *     run id stamped on the movements) followed by the REAL pure fold
 *     (`toCompensationFacts` + `foldPreservedPosition`).
 *
 * Authorization, organization scope, master data, kind normalization,
 * lock ordering, guards and events are the REAL service code under test.
 */

const ACTOR: AuthenticatedPrincipal = {
  userId: 'user-pricing-1',
  sessionId: 'session-pricing-1',
};

function asActor<T>(fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext(
    { correlationId: 'test-correlation', principal: ACTOR },
    fn,
  );
}

function loggerStub(): JsonLogger {
  return {
    log: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as JsonLogger;
}

// ---------------------------------------------------------------------------
// Fake world: pricing runs + outcomes + valuation runs + states +
// movements + documents + operations
// ---------------------------------------------------------------------------

interface PricingRunRow {
  id: string;
  organizationId: string;
  warehouseId: string | null;
  documentKinds: string[];
  fromDate: BusinessDate | null;
  toDate: BusinessDate;
  kind: 'pricing_operation' | 'reverse_pricing';
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
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

interface KeyOutcomeRow {
  id: string;
  pricingRunId: string;
  organizationId: string;
  warehouseId: string;
  itemId: string;
  outcome: 'priced' | 'failed' | 'reversed';
  reason: string | null;
  failedMovementIds: string[];
  valuationRunId: string | null;
  movementsExamined: number;
  movementsRevalued: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

interface OperationRow {
  id: string;
  organizationId: string;
  operationKey: string;
  operation: string;
  requestHash: string;
  result: { kind: 'pricing'; pricingRunId: string };
  createdAt: Date;
  updatedAt: Date;
}

interface StateRow {
  id: string;
  organizationId: string;
  branchId: string;
  warehouseId: string;
  itemId: string;
  method: string;
  valuedQuantity: string;
  uncostedQuantity: string;
  totalValue: string;
  status: 'valued' | 'pending_cost' | 'stale';
  staleSince: Date | null;
  lastValuedAt: Date | null;
  lastRecalculationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface DocHeaderRow {
  id: string;
  organizationId: string;
  kind: string;
  status:
    'draft' | 'operational' | 'accounting_posted' | 'immutable' | 'cancelled';
}

/** What the fake valuation repository was asked to do, per key. */
interface RecalculationCall {
  keyId: string;
  runId: string;
  fromDate: BusinessDate | null;
}

interface ReverseCall {
  keyId: string;
  originalRunId: string;
  compensatingRunId: string;
}

class PricingWorld {
  pricingRuns = new Map<string, PricingRunRow>();
  keyOutcomes = new Map<string, KeyOutcomeRow>();
  valuationRuns = new Map<string, InventoryValuationRun>();
  states = new Map<string, StateRow>();
  movements = new Map<string, InventoryMovement>();
  operations = new Map<string, OperationRow>();
  docHeaders = new Map<string, DocHeaderRow>();
  /** The fixed-order valuation-state locks, as `warehouse:item` strings. */
  lockOrder: string[] = [];
  recalcCalls: RecalculationCall[] = [];
  reverseCalls: ReverseCall[] = [];
  /**
   * Simulate a concurrent winner: flip this run to "already reversed" the
   * moment `lockRunRow` takes it (after the fail-fast pre-check passed).
   */
  reverseRaceOnRunId: string | null = null;

  snapshot() {
    return {
      pricingRuns: new Map(
        [...this.pricingRuns].map(([id, row]) => [id, { ...row }]),
      ),
      keyOutcomes: new Map(
        [...this.keyOutcomes].map(([id, row]) => [id, { ...row }]),
      ),
      valuationRuns: new Map(
        [...this.valuationRuns].map(([id, row]) => [id, { ...row }]),
      ),
      states: new Map([...this.states].map(([id, row]) => [id, { ...row }])),
      movements: new Map(
        [...this.movements].map(([id, row]) => [id, { ...row }]),
      ),
      operations: new Map(this.operations),
      lockOrder: [...this.lockOrder],
      recalcCalls: [...this.recalcCalls],
      reverseCalls: [...this.reverseCalls],
    };
  }

  restore(snapshot: ReturnType<PricingWorld['snapshot']>): void {
    this.pricingRuns = snapshot.pricingRuns;
    this.keyOutcomes = snapshot.keyOutcomes;
    this.valuationRuns = snapshot.valuationRuns;
    this.states = snapshot.states;
    this.movements = snapshot.movements;
    this.operations = snapshot.operations;
    this.lockOrder = snapshot.lockOrder;
    this.recalcCalls = snapshot.recalcCalls;
    this.reverseCalls = snapshot.reverseCalls;
  }

  stateKey(organizationId: string, warehouseId: string, itemId: string) {
    return `${organizationId}:${warehouseId}:${itemId}`;
  }

  movementsOfKey(organizationId: string, warehouseId: string, itemId: string) {
    return [...this.movements.values()]
      .filter(
        (movement) =>
          movement.organizationId === organizationId &&
          movement.warehouseId === warehouseId &&
          movement.itemId === itemId,
      )
      .sort(
        (left, right) =>
          left.movementDate.localeCompare(right.movementDate) ||
          left.createdAt.getTime() - right.createdAt.getTime() ||
          left.id.localeCompare(right.id),
      );
  }
}

/** Canonical money from integer cents: 60000 → "600", -40050 → "-400.5". */
function money(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100);
  const rest = abs % 100;
  if (rest === 0) return `${sign}${whole}`;
  return `${sign}${whole}.${String(rest).padStart(2, '0').replace(/0$/, '')}`;
}

/**
 * The transaction handle the service passes around. It supports exactly what
 * the REAL code reaches through it on the pricing paths: the raw valuation
 * state lock (`lockValuationStateRow` — executed for real, so the lock ORDER
 * is genuinely taken and observable), the zero-row creation for a new key's
 * state, and the operation idempotency insert.
 */
function fakeTx(world: PricingWorld) {
  return {
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const sql = strings.join('?');
      if (!sql.includes('inventory_valuation_states')) {
        throw new Error(
          `TEST DOUBLE: unexpected raw SQL on the pricing path: ${sql.slice(0, 80)}`,
        );
      }
      const organizationId = values[0] as string;
      const warehouseId = values[1] as string;
      const itemId = values[2] as string;
      world.lockOrder.push(`${warehouseId}:${itemId}`);
      const row = world.states.get(
        world.stateKey(organizationId, warehouseId, itemId),
      );
      return row === undefined ? [] : [row];
    },
    inventoryValuationState: {
      async create({ data }: { data: Omit<StateRow, 'id'> & { id: string } }) {
        const key = world.stateKey(
          data.organizationId,
          data.warehouseId,
          data.itemId,
        );
        if (world.states.has(key)) {
          throw Object.assign(new Error('Unique constraint failed'), {
            code: 'P2002',
          });
        }
        world.states.set(key, { ...data });
        return { ...data };
      },
    },
    inventoryOperation: {
      async create({
        data,
      }: {
        data: Omit<OperationRow, 'id'> & { id: string };
      }) {
        const key = `${data.organizationId}:${data.operationKey}`;
        if (world.operations.has(key)) {
          // Prisma's P2002 — the service catches it and replays.
          throw Object.assign(new Error('Unique constraint failed'), {
            code: 'P2002',
          });
        }
        const row: OperationRow = { ...data } as OperationRow;
        world.operations.set(key, row);
        return row;
      },
    },
  };
}

function toPricingRunDomain(
  world: PricingWorld,
  row: PricingRunRow,
): InventoryPricingRun {
  return {
    id: row.id,
    organizationId: row.organizationId,
    warehouseId: row.warehouseId,
    documentKinds: [...row.documentKinds],
    fromDate: row.fromDate,
    toDate: row.toDate,
    kind: row.kind,
    reversesRunId: row.reversesRunId,
    reversedByRunId: row.reversedByRunId,
    reversedAt: row.reversedAt,
    keysExamined: row.keysExamined,
    keysPriced: row.keysPriced,
    keysFailed: row.keysFailed,
    movementsExamined: row.movementsExamined,
    movementsRevalued: row.movementsRevalued,
    reason: row.reason,
    operationKey: row.operationKey,
    executedBy: row.executedBy,
    executedAt: row.executedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    keyOutcomes: [...world.keyOutcomes.values()]
      .filter((outcome) => outcome.pricingRunId === row.id)
      .map((outcome) => ({
        id: outcome.id,
        pricingRunId: outcome.pricingRunId,
        organizationId: outcome.organizationId,
        warehouseId: outcome.warehouseId,
        itemId: outcome.itemId,
        outcome: outcome.outcome,
        reason: outcome.reason,
        failedMovementIds: [...outcome.failedMovementIds],
        valuationRunId: outcome.valuationRunId,
        movementsExamined: outcome.movementsExamined,
        movementsRevalued: outcome.movementsRevalued,
        createdAt: outcome.createdAt,
        updatedAt: outcome.updatedAt,
      })),
  };
}

/**
 * A faithful mirror of the REAL repository methods the service calls —
 * including `findLastRunForScope`'s completed-run filter, which is exactly
 * the axis-2 behavior under test here (the live e2e suite pins the same
 * behavior against real PostgreSQL).
 */
function fakePricingRepository(
  world: PricingWorld,
): InventoryPricingRepository {
  return {
    async withTransaction<T>(work: (tx: unknown) => Promise<T>): Promise<T> {
      const snapshot = world.snapshot();
      try {
        return await work(fakeTx(world));
      } catch (error) {
        world.restore(snapshot);
        throw error;
      }
    },
    async findRun(organizationId: string, id: string) {
      const row = world.pricingRuns.get(id);
      if (row === undefined || row.organizationId !== organizationId) {
        return null;
      }
      return toPricingRunDomain(world, row);
    },
    async listRuns(params: {
      where: {
        organizationId: string;
        warehouseId?: string;
        kind?: string;
      };
      orderBy: unknown;
      skip: number;
      take: number;
    }) {
      const rows = [...world.pricingRuns.values()]
        .filter(
          (row) =>
            row.organizationId === params.where.organizationId &&
            (params.where.warehouseId === undefined ||
              row.warehouseId === params.where.warehouseId) &&
            (params.where.kind === undefined || row.kind === params.where.kind),
        )
        .sort(
          (left, right) =>
            right.executedAt.getTime() - left.executedAt.getTime(),
        );
      return {
        items: rows
          .slice(params.skip, params.skip + params.take)
          .map((row) => toPricingRunDomain(world, row)),
        total: rows.length,
      };
    },
    async findLastRunForScope(params: {
      organizationId: string;
      warehouseId: string | null;
      documentKinds: readonly string[];
    }) {
      // Mirrors the repository: only COMPLETED runs (kind
      // pricing_operation, keysFailed = 0, keysExamined > 0, not reversed)
      // are candidates — a failed, empty or reversed run never advances
      // the boundary.
      const rows = [...world.pricingRuns.values()]
        .filter(
          (row) =>
            row.organizationId === params.organizationId &&
            row.warehouseId === params.warehouseId &&
            row.kind === 'pricing_operation' &&
            row.keysFailed === 0 &&
            row.keysExamined > 0 &&
            row.reversedByRunId === null,
        )
        .sort(
          (left, right) =>
            right.executedAt.getTime() - left.executedAt.getTime(),
        );
      const requested = [...params.documentKinds].sort().join(',');
      for (const row of rows) {
        if ([...row.documentKinds].sort().join(',') === requested) {
          return { id: row.id, toDate: row.toDate };
        }
      }
      return null;
    },
    async insertRun(
      _tx: unknown,
      create: Partial<PricingRunRow> & { id: string },
    ) {
      if (world.pricingRuns.has(create.id)) {
        throw Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
        });
      }
      const row: PricingRunRow = {
        reversesRunId: null,
        reversedByRunId: null,
        reversedAt: null,
        reason: null,
        executedBy: null,
        ...create,
      } as PricingRunRow;
      world.pricingRuns.set(create.id, row);
      return toPricingRunDomain(world, row);
    },
    async insertKeyOutcome(_tx: unknown, create: KeyOutcomeRow) {
      world.keyOutcomes.set(create.id, { ...create });
    },
    async markRunReversed(
      _tx: unknown,
      runId: string,
      audit: { byRunId: string; at: Date; by: string | null },
    ) {
      const row = world.pricingRuns.get(runId);
      if (row === undefined) return;
      row.reversedByRunId = audit.byRunId;
      row.reversedAt = audit.at;
      row.updatedAt = audit.at;
      row.updatedBy = audit.by;
    },
    async lockRunRow(_tx: unknown, organizationId: string, runId: string) {
      const current = world.pricingRuns.get(runId);
      if (
        world.reverseRaceOnRunId === runId &&
        current !== undefined &&
        current.reversedByRunId === null
      ) {
        // A concurrent transaction committed its reverse between the
        // service's pre-check read and this lock — exactly the race the
        // in-transaction guard exists for.
        world.reverseRaceOnRunId = null;
        current.reversedByRunId = 'won-by-concurrent-reverse';
        current.reversedAt = new Date();
      }
      const row = world.pricingRuns.get(runId);
      if (row === undefined || row.organizationId !== organizationId) {
        return null;
      }
      return { ...row, documentKinds: [...row.documentKinds] };
    },
  } as unknown as InventoryPricingRepository;
}

/**
 * The valuation repository fake. `recalculateKeyWithinBatch` runs a real
 * (small) moving-weighted-average replay over the key's committed movement
 * history and stamps what changes; `reverseRunWithin` mirrors the
 * repository's un-valuing write and then runs the REAL pure fold, so the
 * service-level position assertions below are computed by production
 * domain code, not by test arithmetic.
 */
function fakeValuationRepository(
  world: PricingWorld,
  options: { failKeys?: Set<string> } = {},
): InventoryValuationRepository {
  const stateOf = (key: BalanceKey): InventoryValuationState => {
    const existing = world.states.get(
      world.stateKey(key.organizationId, key.warehouseId, key.itemId),
    );
    if (existing !== undefined) {
      return { ...existing } as unknown as InventoryValuationState;
    }
    const created: StateRow = {
      id: `state-${key.warehouseId}-${key.itemId}`,
      organizationId: key.organizationId,
      branchId: key.branchId,
      warehouseId: key.warehouseId,
      itemId: key.itemId,
      method: 'moving_weighted_average',
      valuedQuantity: '0',
      uncostedQuantity: '0',
      totalValue: '0',
      status: 'valued',
      staleSince: null,
      lastValuedAt: null,
      lastRecalculationId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    world.states.set(
      world.stateKey(key.organizationId, key.warehouseId, key.itemId),
      created,
    );
    return { ...created } as unknown as InventoryValuationState;
  };

  const writeState = (
    key: BalanceKey,
    position: {
      valuedQuantity: string;
      uncostedQuantity: string;
      totalValue: string;
    },
    audit: {
      status: 'valued' | 'stale';
      lastRecalculationId: string;
      at: Date;
    },
  ) => {
    const row = world.states.get(
      world.stateKey(key.organizationId, key.warehouseId, key.itemId),
    );
    if (row === undefined) return;
    row.valuedQuantity = position.valuedQuantity;
    row.uncostedQuantity = position.uncostedQuantity;
    row.totalValue = position.totalValue;
    row.status = audit.status;
    row.staleSince = audit.status === 'stale' ? audit.at : null;
    row.lastValuedAt = audit.at;
    row.lastRecalculationId = audit.lastRecalculationId;
    row.updatedAt = audit.at;
  };

  return {
    async findRunById(id: string) {
      return world.valuationRuns.get(id) ?? null;
    },
    async listRunsForKeyAfter(params: {
      organizationId: string;
      warehouseId: string;
      itemId: string;
      executedAfter: Date;
    }) {
      return [...world.valuationRuns.values()]
        .filter(
          (run) =>
            run.organizationId === params.organizationId &&
            run.warehouseId === params.warehouseId &&
            run.itemId === params.itemId &&
            run.executedAt.getTime() > params.executedAfter.getTime(),
        )
        .sort(
          (left, right) =>
            left.executedAt.getTime() - right.executedAt.getTime(),
        );
    },
    async recalculateKeyWithinBatch(
      _tx: unknown,
      input: {
        key: BalanceKey;
        runId: string;
        fromDate: BusinessDate | null;
        at: Date;
      },
    ) {
      const keyId = `${input.key.warehouseId}:${input.key.itemId}`;
      if (options.failKeys?.has(keyId) === true) {
        const { RecalculationTooLargeError } =
          await import('../data/inventory-posting-errors.js');
        throw new RecalculationTooLargeError(1);
      }
      world.recalcCalls.push({
        keyId,
        runId: input.runId,
        fromDate: input.fromDate,
      });
      const history = world.movementsOfKey(
        input.key.organizationId,
        input.key.warehouseId,
        input.key.itemId,
      );
      // A small, real moving-weighted-average pass over the whole key
      // (exact in integer cents — the test values are round by design).
      let valuedQty = 0;
      let uncostedQty = 0;
      let cents = 0;
      let examined = 0;
      let revalued = 0;
      const stamp = (movement: InventoryMovement, cost: string | null) => {
        if (movement.totalCost !== cost) revalued += 1;
        movement.totalCost = cost;
        movement.valuationStatus = 'valued';
        movement.valuationSource = cost === null ? null : 'average_cost';
        movement.valuedAt = input.at;
        movement.valuationRunId = input.runId;
      };
      for (const movement of history) {
        examined += 1;
        const qty = Number(movement.baseQuantity);
        switch (movement.movementType) {
          case 'inbound':
          case 'adjustment_in':
          case 'sales_return':
          case 'transfer_in': {
            if (
              movement.totalCost !== null &&
              movement.valuationRunId === null
            ) {
              // A preserved, committed inbound fact: joins the pool.
              valuedQty += qty;
              cents += Number(movement.totalCost) * 100;
            } else if (
              movement.movementType === 'transfer_in' &&
              movement.valuationRunId === input.runId
            ) {
              valuedQty += qty;
              cents += Number(movement.totalCost ?? '0') * 100;
            } else if (movement.totalCost !== null) {
              valuedQty += qty;
              cents += Number(movement.totalCost) * 100;
            } else {
              uncostedQty += qty;
            }
            break;
          }
          case 'outbound':
          case 'adjustment_out':
          case 'purchase_return':
          case 'transfer_out': {
            // Consume the uncosted quarantine first, then the valued
            // pool at the running average.
            let remaining = Math.abs(qty);
            let costCents = 0;
            const fromUncosted = Math.min(uncostedQty, remaining);
            uncostedQty -= fromUncosted;
            remaining -= fromUncosted;
            if (remaining > 0 && valuedQty > 0) {
              const averageCents = cents / valuedQty;
              const moved = averageCents * remaining;
              costCents += moved;
              cents -= moved;
              valuedQty -= remaining;
              remaining = 0;
            }
            stamp(movement, money(-costCents));
            break;
          }
          default:
            break;
        }
      }
      const run: InventoryValuationRun = {
        id: input.runId,
        organizationId: input.key.organizationId,
        branchId: input.key.branchId,
        warehouseId: input.key.warehouseId,
        itemId: input.key.itemId,
        method: 'moving_weighted_average',
        trigger: 'pricing_operation',
        fromDate: input.fromDate,
        movementsExamined: examined,
        movementsRevalued: revalued,
        resultingValuedQuantity: String(valuedQty),
        resultingUncostedQuantity: String(uncostedQty),
        resultingTotalValue: money(cents),
        resultingStatus: 'valued',
        operationKey: `pricing:${input.runId}`,
        reason: null,
        executedAt: input.at,
        createdAt: input.at,
        updatedAt: input.at,
      };
      world.valuationRuns.set(run.id, run);
      writeState(
        input.key,
        {
          valuedQuantity: run.resultingValuedQuantity,
          uncostedQuantity: run.resultingUncostedQuantity,
          totalValue: run.resultingTotalValue,
        },
        {
          status: 'valued',
          lastRecalculationId: run.id,
          at: input.at,
        },
      );
      return { run, state: stateOf(input.key) };
    },
    async reverseRunWithin(
      _tx: unknown,
      input: {
        key: BalanceKey;
        originalRunId: string;
        compensatingRunId: string;
        reason: string | null;
        at: Date;
        actorId: string | null;
      },
    ) {
      const keyId = `${input.key.warehouseId}:${input.key.itemId}`;
      world.reverseCalls.push({
        keyId,
        originalRunId: input.originalRunId,
        compensatingRunId: input.compensatingRunId,
      });
      const rows = world.movementsOfKey(
        input.key.organizationId,
        input.key.warehouseId,
        input.key.itemId,
      );
      // The repository reads the PRE-update snapshot, un-values in place,
      // and folds the SNAPSHOT through the pure compensation bridge — the
      // exact composition the axis-1 correction fixed. Reuse it for real.
      const snapshot = rows.map((row) => ({
        movementType: row.movementType,
        baseQuantity: row.baseQuantity,
        totalCost: row.totalCost,
        valuationSource: row.valuationSource,
        valuationRunId: row.valuationRunId,
      }));
      const reversed = rows.filter(
        (row) => row.valuationRunId === input.originalRunId,
      );
      for (const row of reversed) {
        row.totalCost = null;
        row.valuationStatus = 'unvalued';
        row.valuationSource = null;
        row.valuedAt = null;
        row.valuationRunId = input.compensatingRunId;
        row.updatedAt = input.at;
      }
      const position = foldPreservedPosition(
        toCompensationFacts(snapshot, input.originalRunId),
      );
      const run: InventoryValuationRun = {
        id: input.compensatingRunId,
        organizationId: input.key.organizationId,
        branchId: input.key.branchId,
        warehouseId: input.key.warehouseId,
        itemId: input.key.itemId,
        method: 'moving_weighted_average',
        trigger: 'reverse_pricing',
        fromDate: null,
        movementsExamined: rows.length,
        movementsRevalued: reversed.length,
        resultingValuedQuantity: position.valuedQuantity,
        resultingUncostedQuantity: position.uncostedQuantity,
        resultingTotalValue: position.totalValue,
        resultingStatus: 'stale',
        operationKey: `reverse:${input.originalRunId}`,
        reason: input.reason,
        executedAt: input.at,
        createdAt: input.at,
        updatedAt: input.at,
      };
      world.valuationRuns.set(run.id, run);
      writeState(input.key, position, {
        status: 'stale',
        lastRecalculationId: run.id,
        at: input.at,
      });
      return {
        run,
        state: stateOf(input.key),
        movementsUnvalued: reversed.length,
      };
    },
  } as unknown as InventoryValuationRepository;
}

function fakeMovementsRepository(
  world: PricingWorld,
): InventoryMovementsRepository {
  return {
    async listScopedToDocuments(
      organizationId: string,
      window: {
        fromDateExclusive: BusinessDate | null;
        toDateInclusive: BusinessDate;
      },
    ) {
      return [...world.movements.values()]
        .filter(
          (movement) =>
            movement.organizationId === organizationId &&
            movement.referenceType === 'inventory_business_document' &&
            (window.fromDateExclusive === null ||
              movement.movementDate > window.fromDateExclusive) &&
            movement.movementDate <= window.toDateInclusive,
        )
        .sort(
          (left, right) =>
            left.movementDate.localeCompare(right.movementDate) ||
            left.createdAt.getTime() - right.createdAt.getTime() ||
            left.id.localeCompare(right.id),
        );
    },
    async findByValuationRun(valuationRunId: string) {
      return [...world.movements.values()]
        .filter((movement) => movement.valuationRunId === valuationRunId)
        .sort((left, right) =>
          left.movementDate.localeCompare(right.movementDate),
        );
    },
    async findByTransferId(transferId: string) {
      return [...world.movements.values()]
        .filter((movement) => movement.transferId === transferId)
        .sort((left, right) =>
          left.movementDate.localeCompare(right.movementDate),
        );
    },
  } as unknown as InventoryMovementsRepository;
}

function fakeDocumentsRepository(
  world: PricingWorld,
): InventoryBusinessDocumentsRepository {
  return {
    async listHeadersByIds(organizationId: string, ids: readonly string[]) {
      const headers: Array<{
        id: string;
        kind: string;
        status: DocHeaderRow['status'];
        warehouseId: string | null;
        sourceWarehouseId: string | null;
        destinationWarehouseId: string | null;
      }> = [];
      for (const id of ids) {
        const header = world.docHeaders.get(id);
        if (header === undefined) continue;
        if (header.organizationId !== organizationId) continue;
        headers.push({
          id: header.id,
          kind: header.kind,
          status: header.status,
          warehouseId: null,
          sourceWarehouseId: null,
          destinationWarehouseId: null,
        });
      }
      return headers;
    },
  } as unknown as InventoryBusinessDocumentsRepository;
}

function fakeOperationsRepository(
  world: PricingWorld,
): InventoryOperationsRepository {
  return {
    async findByKey(organizationId: string, operationKey: string) {
      const row = world.operations.get(`${organizationId}:${operationKey}`);
      return row === undefined ? null : { ...row };
    },
  } as unknown as InventoryOperationsRepository;
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

async function buildFixture(options: { failKeys?: Set<string> } = {}) {
  const stores = createMasterDataStores();
  const requested: string[] = [];
  const authorization = {
    requireAllPermissions: async (codes: string[]) => {
      requested.push(...codes);
    },
    hasAllPermissions: async () => true,
    hasAnyPermission: async () => true,
    effectivePermissionCodes: async () => [],
  } as unknown as AuthorizationService;

  const bus = new DomainEventBus();
  const published: Array<{ type: string; payload: Record<string, unknown> }> =
    [];
  for (const type of [
    INVENTORY_PRICING_RUN_COMPLETED_EVENT,
    INVENTORY_PRICING_RUN_REVERSED_EVENT,
  ]) {
    bus.on(type, (event) => {
      published.push({
        type: event.type,
        payload: event.payload as Record<string, unknown>,
      });
      return Promise.resolve();
    });
  }

  const organizations = new OrganizationsService(
    stores.organizations,
    stores.memberships,
    authorization,
    loggerStub(),
    bus,
    UNPINNED_APP_CONFIG,
    licensingTestDouble(),
  );
  const branches = new BranchesService(
    stores.branches,
    organizations,
    authorization,
    loggerStub(),
    bus,
  );
  const units = new UnitsService(
    stores.units,
    organizations,
    authorization,
    loggerStub(),
    bus,
  );
  const itemGroups = new ItemGroupsService(
    stores.itemGroups,
    organizations,
    authorization,
    loggerStub(),
    bus,
  );
  const noMovements = {
    existsForItem: async () => false,
    existsForWarehouse: async () => false,
  } as unknown as InventoryMovementsRepository;
  const noBalances = {
    hasBlockingBalanceForItem: async () => false,
    hasBlockingBalanceForWarehouse: async () => false,
  } as unknown as InventoryBalancesRepository;
  const items = new ItemsService(
    stores.items,
    organizations,
    itemGroups,
    units,
    authorization,
    loggerStub(),
    bus,
    noMovements,
    noBalances,
  );
  const warehouses = new WarehousesService(
    stores.warehouses,
    organizations,
    branches,
    authorization,
    loggerStub(),
    bus,
    noMovements,
    noBalances,
  );

  const world = new PricingWorld();

  const valuationService = {
    async resolveMethodForPosting() {
      return { method: 'moving_weighted_average', source: 'default' };
    },
  } as unknown as InventoryValuationService;

  const service = new InventoryPricingService(
    fakePricingRepository(world),
    fakeValuationRepository(world, options),
    fakeMovementsRepository(world),
    fakeDocumentsRepository(world),
    fakeOperationsRepository(world),
    organizations,
    warehouses,
    items,
    valuationService,
    authorization,
    loggerStub(),
    bus,
  );

  const organizationId = (
    await organizations.createOrganization({ code: 'ORG-P', name: 'Org P' })
  ).id;
  const otherOrganizationId = (
    await organizations.createOrganization({ code: 'ORG-Q', name: 'Org Q' })
  ).id;
  stores.raw.memberships.seed(ACTOR.userId, organizationId);
  stores.raw.memberships.seed(ACTOR.userId, otherOrganizationId);

  const branchId = (
    await branches.createBranch({ organizationId, code: 'B1', name: 'Branch' })
  ).id;
  const unitId = (
    await units.createUnit({ organizationId, code: 'EA', name: 'Each' })
  ).id;
  const itemId = (
    await items.createItem({
      organizationId,
      code: 'ITM-1',
      name: 'Widget',
      itemKind: 'goods',
      baseUnitId: unitId,
    })
  ).id;
  const otherItemId = (
    await items.createItem({
      organizationId,
      code: 'ITM-2',
      name: 'Gadget',
      itemKind: 'goods',
      baseUnitId: unitId,
    })
  ).id;
  const warehouseId = (
    await warehouses.createWarehouse({
      organizationId,
      branchId,
      code: 'WH-P1',
      name: 'Main',
    })
  ).id;
  const otherWarehouseId = (
    await warehouses.createWarehouse({
      organizationId,
      branchId,
      code: 'WH-P2',
      name: 'Second',
    })
  ).id;

  return {
    service,
    world,
    published,
    requested,
    organizationId,
    otherOrganizationId,
    branchId,
    unitId,
    itemId,
    otherItemId,
    warehouseId,
    otherWarehouseId,
  };
}

type Fixture = Awaited<ReturnType<typeof buildFixture>>;

// ---------------------------------------------------------------------------
// Seeding helpers
// ---------------------------------------------------------------------------

let seedSerial = 0;
function nextId(prefix: string): string {
  seedSerial += 1;
  return `${prefix}-${String(seedSerial).padStart(5, '0')}`;
}

const DOCUMENT_KIND_BY_MOVEMENT_TYPE: Record<string, string> = {
  inbound: 'receipt',
  adjustment_in: 'receipt',
  outbound: 'issue',
  adjustment_out: 'issue',
  transfer_in: 'transfer',
  transfer_out: 'transfer',
  purchase_return: 'purchase_return',
  sales_return: 'sales_return',
};

/**
 * Seed one movement. By default the movement is document-referenced and
 * backed by an `operational` document header of the matching kind, so it
 * is in scope for a pricing run over that kind.
 */
function seedMovement(
  fixture: Fixture,
  input: {
    organizationId?: string;
    warehouseId?: string;
    itemId?: string;
    movementType: InventoryMovement['movementType'];
    baseQuantity: string;
    movementDate: BusinessDate;
    totalCost?: string | null;
    valuationStatus?: InventoryMovement['valuationStatus'];
    valuationRunId?: string | null;
    referenceId?: string;
    /** `false` seeds a movement with a reference but NO readable header. */
    registerHeader?: boolean;
    headerStatus?: DocHeaderRow['status'];
    headerKind?: string;
    transferId?: string | null;
  },
): InventoryMovement {
  const organizationId = input.organizationId ?? fixture.organizationId;
  const referenceId = input.referenceId ?? nextId('doc');
  const registerHeader =
    input.registerHeader ?? input.referenceId === undefined;
  if (registerHeader) {
    fixture.world.docHeaders.set(referenceId, {
      id: referenceId,
      organizationId,
      kind:
        input.headerKind ?? DOCUMENT_KIND_BY_MOVEMENT_TYPE[input.movementType]!,
      status: input.headerStatus ?? 'operational',
    });
  }
  const movement: InventoryMovement = {
    id: nextId('mov'),
    organizationId,
    branchId: fixture.branchId,
    warehouseId: input.warehouseId ?? fixture.warehouseId,
    itemId: input.itemId ?? fixture.itemId,
    movementType: input.movementType,
    quantity: input.baseQuantity.replace('-', ''),
    enteredUnitId: fixture.unitId,
    baseQuantity: input.baseQuantity,
    baseUnitId: fixture.unitId,
    conversionFactor: '1',
    movementDate: input.movementDate,
    transferId: input.transferId ?? null,
    reversalOfMovementId: null,
    referenceType: 'inventory_business_document',
    referenceId,
    reason: null,
    operationKey: nextId('opk'),
    totalCost: input.totalCost ?? null,
    valuationStatus: input.valuationStatus ?? 'unvalued',
    valuationSource: null,
    valuedAt: null,
    valuationRunId: input.valuationRunId ?? null,
    createdAt: new Date(`${input.movementDate}T00:00:01.000Z`),
    updatedAt: new Date(`${input.movementDate}T00:00:01.000Z`),
  };
  fixture.world.movements.set(movement.id, movement);
  return movement;
}

function runInput(
  fixture: Fixture,
  overrides: Partial<RunPricingInput> = {},
): RunPricingInput {
  return {
    organizationId: fixture.organizationId,
    operationKey: nextId('pricing-key'),
    documentKinds: [
      'receipt',
      'issue',
      'transfer',
      'purchase_return',
      'sales_return',
    ],
    toDate: '2026-01-31',
    ...overrides,
  };
}

async function expectBusinessError(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppException);
    const appError = error as AppException;
    expect((appError.details as { code?: string } | undefined)?.code).toBe(
      code,
    );
    return;
  }
  throw new Error(`Expected a business error with code ${code}.`);
}

function stateOfKey(
  fixture: Fixture,
  warehouseId: string,
  itemId: string,
): StateRow {
  const row = fixture.world.states.get(
    fixture.world.stateKey(fixture.organizationId, warehouseId, itemId),
  );
  expect(row).toBeDefined();
  return row!;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InventoryPricingService.runPricing (OD-PDP-01…05)', () => {
  beforeEach(() => {
    seedSerial = 0;
  });

  it('requires the pricing permission and prices every in-scope key from the beginning of history', async () => {
    const fixture = await buildFixture();
    const receipt = seedMovement(fixture, {
      movementType: 'inbound',
      baseQuantity: '100',
      movementDate: toBusinessDate('2026-01-05')!,
      totalCost: '1000',
      valuationStatus: 'valued',
    });
    seedMovement(fixture, {
      movementType: 'outbound',
      baseQuantity: '-40',
      movementDate: toBusinessDate('2026-01-10')!,
    });

    const run = await asActor(() =>
      fixture.service.runPricing(runInput(fixture)),
    );

    expect(fixture.requested).toContain('Inventory.Valuation.RunPricing');
    expect(run.keysExamined).toBe(1);
    expect(run.keysPriced).toBe(1);
    expect(run.keysFailed).toBe(0);
    expect(run.fromDate).toBeNull();

    const recalc = fixture.world.recalcCalls.find(
      (call) => call.keyId === `${fixture.warehouseId}:${fixture.itemId}`,
    );
    expect(recalc).toBeDefined();
    expect(recalc!.fromDate).toBeNull();

    // The issue was priced by the run: MWA 10 × 40 = 400.
    const issue = [...fixture.world.movements.values()].find(
      (movement) => movement.movementType === 'outbound',
    )!;
    expect(issue.totalCost).toBe('-400');
    expect(issue.valuationStatus).toBe('valued');
    expect(issue.valuationRunId).toBe(recalc!.runId);
    // The preserved receipt is untouched: quantity and value survive.
    expect(receipt.baseQuantity).toBe('100');
    expect(receipt.totalCost).toBe('1000');
    expect(receipt.valuationRunId).toBeNull();

    // State: 60 @ 600.
    const state = stateOfKey(fixture, fixture.warehouseId, fixture.itemId);
    expect(state.valuedQuantity).toBe('60');
    expect(state.uncostedQuantity).toBe('0');
    expect(state.totalValue).toBe('600');
    expect(state.status).toBe('valued');

    const event = fixture.published.find(
      (entry) => entry.type === INVENTORY_PRICING_RUN_COMPLETED_EVENT,
    );
    expect(event?.payload).toMatchObject({
      keysExamined: 1,
      keysPriced: 1,
      keysFailed: 0,
    });
  });

  it('does not advance the from-date behind an empty run (concurrent-reverse stranding guard)', async () => {
    const fixture = await buildFixture();
    // No movements in scope: the run completes but examines nothing.
    const empty = await asActor(() =>
      fixture.service.runPricing(runInput(fixture, { toDate: '2026-01-31' })),
    );
    expect(empty.keysExamined).toBe(0);
    expect(empty.keysFailed).toBe(0);
    // The boundary did NOT move: the next run still starts from the
    // beginning of history. Under pricing↔reverse concurrency a run whose
    // window a concurrent reverse emptied must not strand the stale key it
    // would have re-priced behind an advanced boundary.
    const next = await asActor(() =>
      fixture.service.runPricing(runInput(fixture, { toDate: '2026-02-28' })),
    );
    expect(next.fromDate).toBeNull();
  });

  it('auto-advances the from-date after a completed run and refuses a range that does not extend it', async () => {
    const fixture = await buildFixture();
    // The boundary only advances behind a run that DID work: seed a key so
    // the first run actually examines and prices it (an empty run advances
    // nothing — the concurrent-reverse stranding guard).
    seedMovement(fixture, {
      movementType: 'inbound',
      baseQuantity: '100',
      movementDate: toBusinessDate('2026-01-05')!,
      totalCost: '1000',
      valuationStatus: 'valued',
    });
    seedMovement(fixture, {
      movementType: 'outbound',
      baseQuantity: '-40',
      movementDate: toBusinessDate('2026-01-10')!,
    });
    const first = await asActor(() =>
      fixture.service.runPricing(runInput(fixture, { toDate: '2026-01-31' })),
    );
    expect(first.fromDate).toBeNull();
    expect(first.keysExamined).toBe(1);

    const second = await asActor(() =>
      fixture.service.runPricing(runInput(fixture, { toDate: '2026-02-28' })),
    );
    expect(second.fromDate).toBe('2026-01-31');

    // Same or earlier end date: refused with range_not_extending. The
    // refusal is asserted with the FIRST run's end date so it holds no
    // matter which of the two completed runs the boundary resolved to
    // (equal-millisecond ties are over-cover-safe by design, never skips).
    await expectBusinessError(
      asActor(() =>
        fixture.service.runPricing(runInput(fixture, { toDate: '2026-01-31' })),
      ),
      'inventory.pricing.range_not_extending',
    );
  });

  it('AXIS 2: a run with failed keys does NOT advance the from-date — the failed key is retried, not skipped', async () => {
    const fixture = await buildFixture();
    // Key A: healthy. Key B: an unvalued receipt blocks it (OD-PDP-03).
    seedMovement(fixture, {
      movementType: 'inbound',
      baseQuantity: '100',
      movementDate: toBusinessDate('2026-01-05')!,
      totalCost: '500',
      valuationStatus: 'valued',
    });
    const unvaluedReceipt = seedMovement(fixture, {
      itemId: fixture.otherItemId,
      movementType: 'inbound',
      baseQuantity: '10',
      movementDate: toBusinessDate('2026-01-06')!,
      valuationStatus: 'unvalued',
    });

    const first = await asActor(() =>
      fixture.service.runPricing(runInput(fixture, { toDate: '2026-01-31' })),
    );
    expect(first.keysExamined).toBe(2);
    expect(first.keysPriced).toBe(1);
    expect(first.keysFailed).toBe(1);

    const failedOutcome = first.keyOutcomes.find(
      (outcome) => outcome.outcome === 'failed',
    );
    expect(failedOutcome?.itemId).toBe(fixture.otherItemId);
    expect(failedOutcome?.reason).toBe(
      'inventory.pricing.unvalued_inbound_in_range',
    );
    expect(failedOutcome?.failedMovementIds).toEqual([unvaluedReceipt.id]);
    // The failed key was NOT recalculated.
    expect(
      fixture.world.recalcCalls.find(
        (call) =>
          call.keyId === `${fixture.warehouseId}:${fixture.otherItemId}`,
      ),
    ).toBeUndefined();

    // The next run's from-date is still the beginning: the failed run did
    // not advance the boundary (the axis-2 correction).
    const second = await asActor(() =>
      fixture.service.runPricing(runInput(fixture, { toDate: '2026-02-28' })),
    );
    expect(second.fromDate).toBeNull();
    // Key A replays the whole key again (idempotent), key B fails again.
    expect(second.keysPriced).toBe(1);
    expect(second.keysFailed).toBe(1);

    // Resolve the blocker — the receipt receives its cost — and re-run.
    unvaluedReceipt.totalCost = '120';
    unvaluedReceipt.valuationStatus = 'valued';
    const third = await asActor(() =>
      fixture.service.runPricing(runInput(fixture, { toDate: '2026-03-31' })),
    );
    expect(third.keysPriced).toBe(2);
    expect(third.keysFailed).toBe(0);
    const retried = fixture.world.recalcCalls.filter(
      (call) => call.keyId === `${fixture.warehouseId}:${fixture.otherItemId}`,
    );
    expect(retried.length).toBe(1);
    expect(retried[0]!.fromDate).toBeNull();
    // The retry priced the previously-failed key; quantities unchanged.
    expect(unvaluedReceipt.baseQuantity).toBe('10');
    expect(unvaluedReceipt.valuationStatus).toBe('valued');

    // NOW the boundary advances: a fully-completed run advances it.
    const fourth = await asActor(() =>
      fixture.service.runPricing(runInput(fixture, { toDate: '2026-04-30' })),
    );
    expect(fourth.fromDate).toBe('2026-03-31');
  });

  it('AXIS 2: a reversed run does not advance the from-date either', async () => {
    const fixture = await buildFixture();
    seedMovement(fixture, {
      movementType: 'inbound',
      baseQuantity: '50',
      movementDate: toBusinessDate('2026-01-05')!,
      totalCost: '250',
      valuationStatus: 'valued',
    });
    const first = await asActor(() =>
      fixture.service.runPricing(runInput(fixture, { toDate: '2026-01-31' })),
    );
    expect(first.fromDate).toBeNull();

    await asActor(() =>
      fixture.service.reversePricing({
        organizationId: fixture.organizationId,
        pricingRunId: first.id,
        operationKey: nextId('reverse-key'),
      }),
    );

    // The reversed run no longer counts as completed: the scope's boundary
    // falls back to the beginning of history, so the next run re-prices
    // the window instead of starting after it.
    const second = await asActor(() =>
      fixture.service.runPricing(runInput(fixture, { toDate: '2026-02-28' })),
    );
    expect(second.fromDate).toBeNull();
    expect(second.keysPriced).toBe(1);
  });

  it('scopes by document kind and warehouse, and keeps organizations isolated', async () => {
    const fixture = await buildFixture();
    // Own org, own warehouse: receipt — in scope for a receipt-only run.
    seedMovement(fixture, {
      movementType: 'inbound',
      baseQuantity: '10',
      movementDate: toBusinessDate('2026-01-05')!,
      totalCost: '100',
      valuationStatus: 'valued',
    });
    // Own org, other warehouse: an issue — excluded by the warehouse scope.
    seedMovement(fixture, {
      warehouseId: fixture.otherWarehouseId,
      movementType: 'outbound',
      baseQuantity: '-2',
      movementDate: toBusinessDate('2026-01-06')!,
    });
    // Another org's movement — invisible.
    seedMovement(fixture, {
      organizationId: fixture.otherOrganizationId,
      movementType: 'inbound',
      baseQuantity: '99',
      movementDate: toBusinessDate('2026-01-07')!,
      totalCost: '990',
      valuationStatus: 'valued',
    });

    const run = await asActor(() =>
      fixture.service.runPricing(
        runInput(fixture, {
          documentKinds: ['receipt'],
          warehouseId: fixture.warehouseId,
        }),
      ),
    );
    expect(run.keysExamined).toBe(1);
    expect(run.warehouseId).toBe(fixture.warehouseId);
    expect(run.documentKinds).toEqual(['receipt']);
    // Only the own-org, own-warehouse receipt key was recalculated.
    expect(fixture.world.recalcCalls.map((call) => call.keyId)).toEqual([
      `${fixture.warehouseId}:${fixture.itemId}`,
    ]);
  });

  it('locks every key in the fixed ascending order, transfer sources before destinations (OD-PDP-04)', async () => {
    const fixture = await buildFixture();
    seedMovement(fixture, {
      movementType: 'inbound',
      baseQuantity: '100',
      movementDate: toBusinessDate('2026-01-05')!,
      totalCost: '1000',
      valuationStatus: 'valued',
    });
    // A transfer into the OTHER warehouse: its source key is this key.
    // The legs carry their posting-time values (source 'transfer'),
    // preserved — never re-derived — by the replay.
    seedMovement(fixture, {
      movementType: 'transfer_out',
      baseQuantity: '-30',
      movementDate: toBusinessDate('2026-01-10')!,
      totalCost: '-300',
      valuationStatus: 'valued',
      transferId: 'trf-1',
    });
    const transferIn = seedMovement(fixture, {
      warehouseId: fixture.otherWarehouseId,
      movementType: 'transfer_in',
      baseQuantity: '30',
      movementDate: toBusinessDate('2026-01-10')!,
      totalCost: '300',
      valuationStatus: 'valued',
      transferId: 'trf-1',
    });

    await asActor(() => fixture.service.runPricing(runInput(fixture)));

    // The service locked BOTH keys, in ascending (warehouse, item) order —
    // the transfer edge cannot reorder the lock tier (ordering the replay
    // is separate from ordering the locks). The warehouse ids are ULIDs,
    // so "ascending" is computed from the ids themselves.
    const ascending = [fixture.warehouseId, fixture.otherWarehouseId].sort();
    expect(fixture.world.lockOrder).toEqual([
      `${ascending[0]}:${fixture.itemId}`,
      `${ascending[1]}:${fixture.itemId}`,
    ]);
    // The replay itself ran source before destination.
    const keyIds = fixture.world.recalcCalls.map((call) => call.keyId);
    expect(
      keyIds.indexOf(`${fixture.warehouseId}:${fixture.itemId}`),
    ).toBeLessThan(
      keyIds.indexOf(`${fixture.otherWarehouseId}:${fixture.itemId}`),
    );
    // The transfer legs carried value across (300 of 1000).
    expect(transferIn.totalCost).toBe('300');
    const source = stateOfKey(fixture, fixture.warehouseId, fixture.itemId);
    const destination = stateOfKey(
      fixture,
      fixture.otherWarehouseId,
      fixture.itemId,
    );
    expect(source.valuedQuantity).toBe('70');
    expect(source.totalValue).toBe('700');
    expect(destination.valuedQuantity).toBe('30');
    expect(destination.totalValue).toBe('300');
  });

  it('fails only the affected key when the replay itself fails, and keeps the batch atomic', async () => {
    const failKeys = new Set<string>();
    const fixture = await buildFixture({ failKeys });
    seedMovement(fixture, {
      itemId: fixture.itemId,
      movementType: 'inbound',
      baseQuantity: '20',
      movementDate: toBusinessDate('2026-01-05')!,
      totalCost: '200',
      valuationStatus: 'valued',
    });
    seedMovement(fixture, {
      itemId: fixture.otherItemId,
      movementType: 'inbound',
      baseQuantity: '10',
      movementDate: toBusinessDate('2026-01-06')!,
      totalCost: '100',
      valuationStatus: 'valued',
    });
    // The replay for THIS key throws a translated failure.
    failKeys.add(`${fixture.warehouseId}:${fixture.otherItemId}`);

    const run = await asActor(() =>
      fixture.service.runPricing(runInput(fixture)),
    );
    expect(run.keysExamined).toBe(2);
    expect(run.keysPriced).toBe(1);
    expect(run.keysFailed).toBe(1);
    const failed = run.keyOutcomes.find(
      (outcome) => outcome.outcome === 'failed',
    )!;
    expect(failed.reason).toBe('inventory.pricing.recalculation_too_large');
    // The healthy key is valued; the failed key was never recalculated.
    expect(
      fixture.world.recalcCalls.some(
        (call) =>
          call.keyId === `${fixture.warehouseId}:${fixture.otherItemId}`,
      ),
    ).toBe(false);
    expect(
      stateOfKey(fixture, fixture.warehouseId, fixture.itemId).status,
    ).toBe('valued');
  });

  it('refuses a scope that covers more than the supported keys (scope_too_large)', async () => {
    const fixture = await buildFixture();
    // 501 synthetic movements over 501 distinct item ids: the key-count
    // guard fires before any master-data resolution.
    for (let index = 0; index < 501; index += 1) {
      seedMovement(fixture, {
        itemId: `item-bulk-${index}`,
        movementType: 'inbound',
        baseQuantity: '1',
        movementDate: toBusinessDate('2026-01-05')!,
      });
    }
    await expectBusinessError(
      asActor(() => fixture.service.runPricing(runInput(fixture))),
      'inventory.pricing.scope_too_large',
    );
  });

  it('refuses to price around a broken document reference (broken_document_reference)', async () => {
    const fixture = await buildFixture();
    seedMovement(fixture, {
      movementType: 'inbound',
      baseQuantity: '5',
      movementDate: toBusinessDate('2026-01-05')!,
      referenceId: 'doc-missing',
      registerHeader: false,
    });
    await expectBusinessError(
      asActor(() => fixture.service.runPricing(runInput(fixture))),
      'inventory.pricing.broken_document_reference',
    );
  });

  it('is idempotent per operation key: a replay returns the stored run, a different intent is a 409', async () => {
    const fixture = await buildFixture();
    const input = runInput(fixture);
    const first = await asActor(() => fixture.service.runPricing(input));
    const runsBefore = fixture.world.pricingRuns.size;
    const recalcsBefore = fixture.world.recalcCalls.length;

    const replay = await asActor(() =>
      fixture.service.runPricing({ ...input }),
    );
    expect(replay.id).toBe(first.id);
    expect(fixture.world.pricingRuns.size).toBe(runsBefore);
    expect(fixture.world.recalcCalls.length).toBe(recalcsBefore);

    // Same key, different request → conflict, not a second run.
    const conflicting = asActor(() =>
      fixture.service.runPricing({
        ...input,
        toDate: '2026-06-30',
      }),
    );
    await expect(conflicting).rejects.toBeInstanceOf(AppException);
    expect(fixture.world.pricingRuns.size).toBe(runsBefore);
  });

  it('never changes a quantity column: repricing is value-only', async () => {
    const fixture = await buildFixture();
    seedMovement(fixture, {
      movementType: 'inbound',
      baseQuantity: '33.75',
      movementDate: toBusinessDate('2026-01-05')!,
      totalCost: '675',
      valuationStatus: 'valued',
    });
    seedMovement(fixture, {
      movementType: 'outbound',
      baseQuantity: '-12.5',
      movementDate: toBusinessDate('2026-01-10')!,
    });
    const before = [...fixture.world.movements.values()].map((movement) => ({
      id: movement.id,
      baseQuantity: movement.baseQuantity,
      quantity: movement.quantity,
    }));

    await asActor(() => fixture.service.runPricing(runInput(fixture)));

    for (const snapshot of before) {
      const movement = fixture.world.movements.get(snapshot.id)!;
      expect(movement.baseQuantity).toBe(snapshot.baseQuantity);
      expect(movement.quantity).toBe(snapshot.quantity);
    }
  });
});

describe('InventoryPricingService.reversePricing (OD-RVP-01…08)', () => {
  beforeEach(() => {
    seedSerial = 0;
  });

  async function pricedRunWithTwoIssues(fixture: Fixture): Promise<{
    runId: string;
    receipt: InventoryMovement;
    issues: InventoryMovement[];
  }> {
    const receipt = seedMovement(fixture, {
      movementType: 'inbound',
      baseQuantity: '100',
      movementDate: toBusinessDate('2026-01-05')!,
      totalCost: '1000',
      valuationStatus: 'valued',
    });
    const issueA = seedMovement(fixture, {
      movementType: 'outbound',
      baseQuantity: '-40',
      movementDate: toBusinessDate('2026-01-10')!,
    });
    const issueB = seedMovement(fixture, {
      movementType: 'outbound',
      baseQuantity: '-10',
      movementDate: toBusinessDate('2026-01-15')!,
    });
    const run = await asActor(() =>
      fixture.service.runPricing(runInput(fixture)),
    );
    expect(run.keysPriced).toBe(1);
    return { runId: run.id, receipt, issues: [issueA, issueB] };
  }

  it('AXIS 1 (service level): reverses to the PRE-run position — run values erased, survivors preserved, quantities untouched', async () => {
    const fixture = await buildFixture();
    const { runId, receipt, issues } = await pricedRunWithTwoIssues(fixture);
    const quantitiesBefore = issues.map((issue) => issue.baseQuantity);

    const reverse = await asActor(() =>
      fixture.service.reversePricing({
        organizationId: fixture.organizationId,
        pricingRunId: runId,
        operationKey: nextId('reverse-key'),
      }),
    );

    expect(reverse.kind).toBe('reverse_pricing');
    expect(reverse.reversesRunId).toBe(runId);
    expect(reverse.keysExamined).toBe(1);
    expect(reverse.keysPriced).toBe(0);
    expect(reverse.keysFailed).toBe(0);

    // The original is MARKED, not deleted.
    const original = fixture.world.pricingRuns.get(runId)!;
    expect(original.reversedByRunId).toBe(reverse.id);

    const compensatingRunId = reverse.keyOutcomes[0]!.valuationRunId!;
    // The issues the run valued are un-valued, pointing at the
    // compensating run; the receipt keeps its entered value untouched.
    for (const [index, issue] of issues.entries()) {
      expect(issue.valuationStatus).toBe('unvalued');
      expect(issue.totalCost).toBeNull();
      expect(issue.valuationRunId).toBe(compensatingRunId);
      expect(issue.baseQuantity).toBe(quantitiesBefore[index]);
    }
    expect(receipt.totalCost).toBe('1000');
    expect(receipt.valuationStatus).toBe('valued');
    expect(receipt.valuationRunId).toBeNull();

    // The key is left at the PRE-run fold — the two unvalued outbounds
    // consumed the valued pool without attribution, so 50 units remain
    // carrying the WHOLE 1000 (value parked until the next pricing run) —
    // and the key is STALE. The stale-snapshot defect's signature was
    // totalValue "600": the erased -400/-100 folded back in as if the
    // reverse had never happened.
    const state = stateOfKey(fixture, fixture.warehouseId, fixture.itemId);
    expect(state.valuedQuantity).toBe('50');
    expect(state.uncostedQuantity).toBe('0');
    expect(state.totalValue).toBe('1000');
    expect(state.status).toBe('stale');
    expect(state.lastRecalculationId).toBe(compensatingRunId);

    const compensating = fixture.world.valuationRuns.get(compensatingRunId)!;
    expect(compensating.trigger).toBe('reverse_pricing');
    expect(compensating.movementsRevalued).toBe(2);
    expect(compensating.resultingValuedQuantity).toBe('50');
    expect(compensating.resultingUncostedQuantity).toBe('0');
    expect(compensating.resultingTotalValue).toBe('1000');
    expect(compensating.resultingStatus).toBe('stale');

    const event = fixture.published.find(
      (entry) => entry.type === INVENTORY_PRICING_RUN_REVERSED_EVENT,
    );
    expect(event?.payload).toMatchObject({
      kind: 'reverse_pricing',
      reversesRunId: runId,
    });
  });

  it('refuses a run that is no longer the latest valuation on a key (reverse_not_latest_run)', async () => {
    const fixture = await buildFixture();
    const { runId } = await pricedRunWithTwoIssues(fixture);

    // A NEWER valuation run on the same key (e.g. a manual recalculation).
    const priced = fixture.world.recalcCalls[0]!;
    fixture.world.valuationRuns.set('newer-run', {
      ...fixture.world.valuationRuns.get(priced.runId)!,
      id: 'newer-run',
      executedAt: new Date(
        fixture.world.valuationRuns.get(priced.runId)!.executedAt.getTime() +
          60_000,
      ),
    });

    await expectBusinessError(
      asActor(() =>
        fixture.service.reversePricing({
          organizationId: fixture.organizationId,
          pricingRunId: runId,
          operationKey: nextId('reverse-key'),
        }),
      ),
      'inventory.pricing.reverse_not_latest_run',
    );
    // Nothing was reversed.
    expect(fixture.world.pricingRuns.get(runId)!.reversedByRunId).toBeNull();
  });

  it('refuses when an affected document has crossed Accounting Post (reverse_accounting_posted)', async () => {
    const fixture = await buildFixture();
    seedMovement(fixture, {
      movementType: 'inbound',
      baseQuantity: '100',
      movementDate: toBusinessDate('2026-01-05')!,
      totalCost: '1000',
      valuationStatus: 'valued',
    });
    const issue = seedMovement(fixture, {
      movementType: 'outbound',
      baseQuantity: '-40',
      movementDate: toBusinessDate('2026-01-10')!,
      headerStatus: 'accounting_posted',
    });
    const run = await asActor(() =>
      fixture.service.runPricing(runInput(fixture)),
    );

    await expectBusinessError(
      asActor(() =>
        fixture.service.reversePricing({
          organizationId: fixture.organizationId,
          pricingRunId: run.id,
          operationKey: nextId('reverse-key'),
        }),
      ),
      'inventory.pricing.reverse_accounting_posted',
    );
    // Nothing was reversed.
    expect(fixture.world.pricingRuns.get(run.id)!.reversedByRunId).toBeNull();
    expect(issue.valuationStatus).toBe('valued');
  });

  it('refuses to reverse a compensating run (reverse_of_reverse) and an already-reversed run (409)', async () => {
    const fixture = await buildFixture();
    const { runId } = await pricedRunWithTwoIssues(fixture);
    const reverse = await asActor(() =>
      fixture.service.reversePricing({
        organizationId: fixture.organizationId,
        pricingRunId: runId,
        operationKey: nextId('reverse-key'),
      }),
    );

    // Reversing the COMPENSATING run: refused by kind.
    await expectBusinessError(
      asActor(() =>
        fixture.service.reversePricing({
          organizationId: fixture.organizationId,
          pricingRunId: reverse.id,
          operationKey: nextId('reverse-key'),
        }),
      ),
      'inventory.pricing.reverse_of_reverse',
    );

    // Reversing the ORIGINAL again: conflict (already reversed).
    const again = asActor(() =>
      fixture.service.reversePricing({
        organizationId: fixture.organizationId,
        pricingRunId: runId,
        operationKey: nextId('reverse-key'),
      }),
    );
    await expect(again).rejects.toBeInstanceOf(AppException);
  });

  it('loses the reverse race only once: the in-transaction guard conflicts when a concurrent reverse won, and the loser writes nothing', async () => {
    const fixture = await buildFixture();
    const { runId } = await pricedRunWithTwoIssues(fixture);
    fixture.world.reverseRaceOnRunId = runId;

    const raced = asActor(() =>
      fixture.service.reversePricing({
        organizationId: fixture.organizationId,
        pricingRunId: runId,
        operationKey: nextId('reverse-key'),
      }),
    );
    await expect(raced).rejects.toBeInstanceOf(AppException);

    // The loser's transaction rolled back completely: no compensating
    // artifacts, no marked original, no operation row.
    expect(
      [...fixture.world.valuationRuns.values()].filter(
        (run) => run.trigger === 'reverse_pricing',
      ),
    ).toHaveLength(0);
    expect(
      [...fixture.world.pricingRuns.values()].filter(
        (row) => row.kind === 'reverse_pricing',
      ),
    ).toHaveLength(0);
    expect(fixture.world.pricingRuns.get(runId)!.reversedByRunId).toBeNull();
    expect(fixture.world.reverseCalls).toHaveLength(0);
  });

  it('blocks a reverse whose transfer destination key has been valued since (OD-RVP-07)', async () => {
    const fixture = await buildFixture();
    seedMovement(fixture, {
      movementType: 'inbound',
      baseQuantity: '100',
      movementDate: toBusinessDate('2026-01-05')!,
      totalCost: '1000',
      valuationStatus: 'valued',
    });
    seedMovement(fixture, {
      movementType: 'transfer_out',
      baseQuantity: '-30',
      movementDate: toBusinessDate('2026-01-10')!,
      transferId: 'trf-7',
    });
    seedMovement(fixture, {
      warehouseId: fixture.otherWarehouseId,
      movementType: 'transfer_in',
      baseQuantity: '30',
      movementDate: toBusinessDate('2026-01-10')!,
      transferId: 'trf-7',
    });

    const run = await asActor(() =>
      fixture.service.runPricing(runInput(fixture)),
    );
    expect(run.keysPriced).toBe(2);
    // The source leg was valued by the run; the destination key then gets
    // a NEWER valuation run (post-run) — the OD-RVP-07 hazard.
    const destinationRun = fixture.world.recalcCalls.find(
      (call) => call.keyId === `${fixture.otherWarehouseId}:${fixture.itemId}`,
    )!;
    fixture.world.valuationRuns.set('post-transfer-run', {
      ...fixture.world.valuationRuns.get(destinationRun.runId)!,
      id: 'post-transfer-run',
      warehouseId: fixture.otherWarehouseId,
      executedAt: new Date(Date.now() + 60_000),
    });

    await expectBusinessError(
      asActor(() =>
        fixture.service.reversePricing({
          organizationId: fixture.organizationId,
          pricingRunId: run.id,
          operationKey: nextId('reverse-key'),
        }),
      ),
      'inventory.pricing.reverse_transfer_destination_valued',
    );
    expect(fixture.world.pricingRuns.get(run.id)!.reversedByRunId).toBeNull();
  });

  it('is idempotent per operation key and isolated per organization', async () => {
    const fixture = await buildFixture();
    const { runId } = await pricedRunWithTwoIssues(fixture);
    const input = {
      organizationId: fixture.organizationId,
      pricingRunId: runId,
      operationKey: nextId('reverse-key'),
    };
    const first = await asActor(() => fixture.service.reversePricing(input));
    const valuationRunsBefore = fixture.world.valuationRuns.size;
    const reverseCallsBefore = fixture.world.reverseCalls.length;

    const replay = await asActor(() =>
      fixture.service.reversePricing({ ...input }),
    );
    expect(replay.id).toBe(first.id);
    expect(fixture.world.valuationRuns.size).toBe(valuationRunsBefore);
    expect(fixture.world.reverseCalls.length).toBe(reverseCallsBefore);

    // Another organization cannot even see the run.
    const foreign = asActor(() =>
      fixture.service.reversePricing({
        organizationId: fixture.otherOrganizationId,
        pricingRunId: runId,
        operationKey: nextId('reverse-key'),
      }),
    );
    await expect(foreign).rejects.toBeInstanceOf(AppException);
    expect(fixture.world.valuationRuns.size).toBe(valuationRunsBefore);
  });
});
