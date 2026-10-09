import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { isMovementType } from '../domain/movement-type.js';
import type { MovementType } from '../domain/movement-type.js';
import {
  addDecimalStrings,
  subtractDecimalStrings,
} from '../domain/quantities.js';
import { violatesNegativePolicy } from '../domain/negative-stock-policy.js';
import type { InventoryMovement } from '../domain/inventory-movement.js';
import type { InventoryBalance } from '../domain/inventory-balance.js';
import {
  AlreadyReversedError,
  InsufficientStockError,
  TransferBackdateConfirmationRequiredError,
} from './inventory-posting-errors.js';
import type {
  BalanceKey,
  CoreClient,
  CoreTransactionalClient,
  CoreTxClient,
  MovementCreate,
  MovementRow,
  MovementWhere,
  OperationCreate,
} from './inventory-core-rows.js';
import {
  adjustBalanceCounters,
  lockBalanceRow,
  lockMovementRow,
  lockValuationStateRow,
} from './inventory-locks.js';
import { valueMovement, valueTransfer } from './inventory-valuation-writes.js';
import { replayTransferPairWithin } from './inventory-transfer-replay.js';
import type { ValuationMethod } from '../domain/valuation-method.js';
import {
  MOVEMENT_VALUATION_STATUSES,
  VALUATION_SOURCES,
} from '../domain/inventory-valuation.js';
import type {
  MovementValuationStatus,
  ValuationSource,
} from '../domain/inventory-valuation.js';
import { decimalToString } from './inventory-core-rows.js';
import { insertOperationRow } from './inventory-operations.repository.js';
import type { OrderBy } from './master-data-rows.js';

/**
 * Data access for `inventory_movements` — the immutable ledger (D-04/D-05,
 * ADR-0022).
 *
 * Every posting method owns ONE transaction shaped identically:
 *
 *   1. lock the balance row(s) (`SELECT … FOR UPDATE`, creating the zero row
 *      for a new key),
 *   2. evaluate the negative-stock policy against the LOCKED row,
 *   3. lock the valuation state row(s) and run the pure valuation strategy
 *      on them (PDR-05) — last lock tier, see `inventory-locks.ts`,
 *   4. insert the movement row(s), already carrying their value,
 *   5. apply the exact counter deltas in SQL,
 *   6. insert the idempotency row.
 *
 * The policy check inside the transaction (never before it) is what makes
 * concurrent postings race-safe: two writers for one key serialize on the
 * lock, and the loser evaluates against the winner's committed counters.
 *
 * Step 3 is in the SAME transaction for one reason: quantity and value must
 * never be observable in disagreement. A movement row and the state it moved
 * commit together or not at all, so `onHand == valued + uncosted` holds for
 * every reader, at every instant — and a valuation failure rolls the
 * quantity back rather than leaving a fact nobody can explain. Valuation
 * still never GATES the posting: the strategy always produces an outcome
 * (possibly "unvalued"), it never rejects a quantity fact (OD-VAL-05).
 *
 * There is deliberately no `update` and no `delete` here at all (AR-13):
 * corrections are counter-movements written by `postReversal`.
 */

export interface MovementListFilter {
  organizationId: string;
  branchId?: string | undefined;
  warehouseId?: string | undefined;
  itemId?: string | undefined;
  movementType?: string | undefined;
  transferId?: string | undefined;
  dateFrom?: Date | undefined;
  dateTo?: Date | undefined;
}

/**
 * How a posting should be valued. The service resolves the method and the
 * backdating verdict BEFORE the transaction (both are fail-fast checks the
 * user must be able to see first); the position itself is only ever read
 * under lock, inside it.
 */
export interface MovementValuationPlan {
  method: ValuationMethod;
  /**
   * The value this fact carries on its own authority — a cost entered on a
   * receipt — or `null` when it carries none. Never required (OD-VAL-05).
   */
  knownValue: string | null;
  knownValueSource?: ValuationSource | undefined;
  /** `movementDate` is strictly before the key's latest movement. */
  backdated: boolean;
  /**
   * C-59D (OD-RET-02/04): the purchase return whose basis receipt carries
   * no value. Only the business-document return path sets this; it is never
   * defaulted and never inferred.
   */
  forceUnvalued?: boolean | undefined;
}

export interface PostMovementInput {
  movement: MovementCreate;
  operation: OperationCreate;
  /** Effective policy for (item override ?? warehouse). */
  allowNegative: boolean;
  actorId: string | null;
  /**
   * Required, not optional: every posting path must DECIDE how the fact is
   * valued, even if the decision is "it carries no value". An optional plan
   * would let a new caller silently skip the state update and break
   * `onHand == valuedQuantity + uncostedQuantity`.
   */
  valuation: MovementValuationPlan;
}

export interface PostTransferInput {
  /** Out-leg first: the order is the legs' stable identity. */
  outLeg: MovementCreate;
  inLeg: MovementCreate;
  operation: OperationCreate;
  /** Effective policy evaluated on the SOURCE key (the in-leg only adds). */
  sourceAllowNegative: boolean;
  actorId: string | null;
  /** The method both keys are valued with (required; see above). */
  valuationMethod: ValuationMethod;
  /**
   * The operator's backdating decision (OD-VAL-10), already permission-checked
   * by the caller. `true` = "I know this transfer is dated before the latest
   * movement on one of its warehouses". The verdict that decides which
   * valuation path runs is re-derived from the LOCKED rows here, so a transfer
   * that became backdated by a concurrent posting is refused
   * (`TransferBackdateConfirmationRequiredError`) instead of being repriced
   * without the operator's confirmation.
   */
  backdateConfirmed?: boolean | undefined;
}

export interface PostReversalInput extends PostMovementInput {
  /** The original movement being reversed (locked for the check). */
  originalMovementId: string;
}

/**
 * Bound for the movements one Pricing Run's date window may cover. The
 * per-key replay is separately bounded by `RECALCULATION_MOVEMENT_LIMIT`;
 * this bound keeps the scope-resolution read and the batch itself inside a
 * reviewable envelope (OD-VAL-12's bounded-command doctrine).
 */
const PRICING_SCOPE_MOVEMENT_LIMIT = 20_000;

/**
 * Bound for one valuation run's affected movements (Reverse Pricing). A run
 * is itself bounded by `RECALCULATION_MOVEMENT_LIMIT` per key, and a reverse
 * touches one run's keys, so this is a defensive ceiling that refuses
 * unbounded work rather than trusting it.
 */
const REVERSAL_MOVEMENT_LIMIT = 50_000;

@Injectable()
export class InventoryMovementsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<CoreClient> {
    return this.prisma.getClient<CoreClient>();
  }

  private transacting(): Promise<CoreTransactionalClient> {
    return this.prisma.getClient<CoreTransactionalClient>();
  }

  // ---- reads --------------------------------------------------------------

  async findById(id: string): Promise<InventoryMovement | null> {
    const { inventoryMovement } = await this.client();
    const row = await inventoryMovement.findUnique({ where: { id } });
    return row === null ? null : toDomain(row);
  }

  async findIds(ids: string[]): Promise<InventoryMovement[]> {
    if (ids.length === 0) return [];
    const { inventoryMovement } = await this.client();
    const rows: InventoryMovement[] = [];
    for (const id of ids) {
      const row = await inventoryMovement.findUnique({ where: { id } });
      if (row !== null) rows.push(toDomain(row));
    }
    return rows;
  }

  async findByTransferId(transferId: string): Promise<InventoryMovement[]> {
    const { inventoryMovement } = await this.client();
    const rows = await inventoryMovement.findMany({
      where: { transferId },
      orderBy: [{ movementDate: 'asc' }],
      skip: 0,
      take: 10,
    });
    return rows.map(toDomain);
  }

  async list(params: {
    where: MovementListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: InventoryMovement[]; total: number }> {
    const { inventoryMovement } = await this.client();
    const where = toWhere(params.where);
    const [rows, total] = await Promise.all([
      inventoryMovement.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      inventoryMovement.count({ where }),
    ]);
    return { items: rows.map(toDomain), total };
  }

  async sumBaseQuantity(
    organizationId: string,
    warehouseId: string,
    itemId: string,
  ): Promise<string> {
    const { inventoryMovement } = await this.client();
    const result = await inventoryMovement.aggregate({
      where: { organizationId, warehouseId, itemId },
      _sum: { baseQuantity: true },
      _max: { movementDate: true },
    });
    return decimalToString(result._sum.baseQuantity ?? '0');
  }

  async maxMovementDate(
    organizationId: string,
    warehouseId: string,
    itemId: string,
  ): Promise<Date | null> {
    const { inventoryMovement } = await this.client();
    const result = await inventoryMovement.aggregate({
      where: { organizationId, warehouseId, itemId },
      _sum: { baseQuantity: true },
      _max: { movementDate: true },
    });
    return result._max.movementDate;
  }

  /**
   * Movements in a Pricing Run's date window that reference a business
   * document (C-59E scope resolution). The half-open window is
   * `(fromDateExclusive, toDateInclusive]` — OD-PDP-01's contiguous,
   * non-overlapping runs. Bounded: a window with more movements than the
   * bound is the caller's named refusal, never a silent truncation.
   */
  async listScopedToDocuments(
    organizationId: string,
    window: { fromDateExclusive: Date | null; toDateInclusive: Date },
  ): Promise<InventoryMovement[]> {
    const { inventoryMovement } = await this.client();
    const rows = await inventoryMovement.findMany({
      where: {
        organizationId,
        referenceType: 'inventory_business_document',
        movementDate: {
          ...(window.fromDateExclusive === null
            ? {}
            : { gt: window.fromDateExclusive }),
          lte: window.toDateInclusive,
        },
      },
      orderBy: [{ movementDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      skip: 0,
      take: PRICING_SCOPE_MOVEMENT_LIMIT + 1,
    });
    if (rows.length > PRICING_SCOPE_MOVEMENT_LIMIT) {
      throw new Error(
        `The pricing scope covers more than ${PRICING_SCOPE_MOVEMENT_LIMIT} movements. Narrow the date window.`,
      );
    }
    return rows.map(toDomain);
  }

  /**
   * Movements last written by one valuation run (C-59E: Reverse Pricing's
   * affected set — OD-RVP-03's accounting guard and OD-RVP-06's un-valuing
   * both key off exactly these rows).
   */
  async findByValuationRun(
    valuationRunId: string,
  ): Promise<InventoryMovement[]> {
    const { inventoryMovement } = await this.client();
    const rows = await inventoryMovement.findMany({
      where: { valuationRunId },
      orderBy: [{ movementDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      skip: 0,
      take: REVERSAL_MOVEMENT_LIMIT,
    });
    return rows.map(toDomain);
  }

  /**
   * Movements by logical reference (C-59E scope resolution: the movements
   * owned by the documents a Pricing Run covers). Bounded and ordered
   * deterministically.
   */
  async findByReferences(
    organizationId: string,
    referenceType: string,
    referenceIds: readonly string[],
  ): Promise<InventoryMovement[]> {
    if (referenceIds.length === 0) return [];
    const { inventoryMovement } = await this.client();
    const rows: InventoryMovement[] = [];
    // Chunked id sets: the ids arrive from a bounded document list, and the
    // chunk keeps the parameter count inside sane bounds.
    for (let offset = 0; offset < referenceIds.length; offset += 500) {
      const chunk = referenceIds.slice(offset, offset + 500);
      const found = await inventoryMovement.findMany({
        where: {
          organizationId,
          referenceType,
          referenceId: { in: chunk },
        },
        orderBy: [{ movementDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        skip: 0,
        take: 10_000,
      });
      rows.push(...found.map(toDomain));
    }
    return rows;
  }

  /** Master-data freeze guard: has this item ever moved? */
  async existsForItem(itemId: string): Promise<boolean> {
    const { inventoryMovement } = await this.client();
    return (await inventoryMovement.findFirst({ where: { itemId } })) !== null;
  }

  /** Master-data freeze guard: has this warehouse ever moved stock? */
  async existsForWarehouse(warehouseId: string): Promise<boolean> {
    const { inventoryMovement } = await this.client();
    return (
      (await inventoryMovement.findFirst({ where: { warehouseId } })) !== null
    );
  }

  // ---- postings (each owns its transaction) --------------------------------

  /**
   * Post one movement and advance its balance row atomically.
   *
   * @throws InsufficientStockError when the locked counters reject the delta.
   */
  async postMovement(
    input: PostMovementInput,
    tx?: CoreTxClient,
  ): Promise<{ movement: InventoryMovement; balance: InventoryBalance }> {
    if (tx === undefined) {
      return this.withTransaction((transaction) =>
        this.postMovement(input, transaction),
      );
    }
    const { balance } = await lockBalanceRow(
      tx,
      movementKey(input.movement),
      input.actorId,
    );
    assertSufficient(
      balance.onHand,
      input.movement.baseQuantity,
      input.allowNegative,
    );
    const { state } = await lockValuationStateRow(
      tx,
      movementKey(input.movement),
      input.valuation.method,
      input.actorId,
    );
    const columns = await valueMovement(tx, {
      state,
      method: input.valuation.method,
      movementType: movementTypeOf(input.movement),
      baseQuantity: input.movement.baseQuantity,
      knownValue: input.valuation.knownValue,
      ...(input.valuation.knownValueSource === undefined
        ? {}
        : { knownValueSource: input.valuation.knownValueSource }),
      backdated: input.valuation.backdated,
      ...(input.valuation.forceUnvalued === true
        ? { forceUnvalued: true }
        : {}),
      at: input.movement.updatedAt,
      actorId: input.actorId,
    });
    const movement = toDomain(
      await tx.inventoryMovement.create({
        data: { ...input.movement, ...columns },
      }),
    );
    await adjustBalanceCounters(tx, {
      balanceId: balance.id,
      onHandDelta: input.movement.baseQuantity,
      reservedDelta: '0',
      lastMovementDate: maxDate(
        balance.lastMovementDate,
        input.movement.movementDate,
      ),
      updatedAt: input.movement.updatedAt,
      updatedBy: input.actorId,
    });
    await insertOperationRow(tx, input.operation);
    return { movement, balance };
  }

  /**
   * Post a warehouse-to-warehouse transfer: both legs (or neither) commit.
   * The two balance rows lock in ascending warehouse-id order — the fixed
   * global order that keeps concurrent transfers deadlock-free.
   */
  async postTransfer(
    input: PostTransferInput,
    tx?: CoreTxClient,
  ): Promise<{ outLeg: InventoryMovement; inLeg: InventoryMovement }> {
    if (tx === undefined) {
      return this.withTransaction((transaction) =>
        this.postTransfer(input, transaction),
      );
    }
    const [first, second] = orderedKeys(input.outLeg, input.inLeg);
    const { balance: firstBalance } = await lockBalanceRow(
      tx,
      first.key,
      input.actorId,
    );
    const { balance: secondBalance } = await lockBalanceRow(
      tx,
      second.key,
      input.actorId,
    );
    const sourceBalance = first.role === 'out' ? firstBalance : secondBalance;

    // The source leg removes stock: the policy bites here. The destination
    // leg only adds and cannot violate a negative-stock policy.
    assertSufficient(
      sourceBalance.onHand,
      input.outLeg.baseQuantity,
      input.sourceAllowNegative,
    );

    // Valuation states lock after BOTH balances, in the same ascending
    // warehouse order, so a transfer and its mirror image cannot deadlock.
    const [firstKey, secondKey] = [first.key, second.key];
    const firstLock = await lockValuationStateRow(
      tx,
      firstKey,
      input.valuationMethod,
      input.actorId,
    );
    const secondLock = await lockValuationStateRow(
      tx,
      secondKey,
      input.valuationMethod,
      input.actorId,
    );
    const sourceState =
      first.role === 'out' ? firstLock.state : secondLock.state;
    const destinationState =
      first.role === 'out' ? secondLock.state : firstLock.state;

    // A transfer dated before the latest movement on EITHER key cannot be
    // valued from the keys' current positions: the source average at the
    // transfer date is only reconstructible by replaying the history, and the
    // destination leg must receive exactly the value that replay derives
    // (OD-TRF-01/05). That is the coupled two-key replay (C-59C); the
    // incremental path below stays for every other transfer.
    //
    // The verdict is re-derived HERE, from the locked rows, so a transfer that
    // became backdated by a concurrent posting can never be valued by a rule
    // the operator was not asked about (OD-VAL-10).
    const backdated = await isBackdatedTransfer(tx, input);
    if (backdated && input.backdateConfirmed !== true) {
      throw new TransferBackdateConfirmationRequiredError({
        movementDate: input.outLeg.movementDate,
        keys: await transferKeyLatestMovementDates(tx, input),
      });
    }
    const legColumns = backdated
      ? await replayTransferPairWithin(tx, {
          outLeg: {
            id: input.outLeg.id,
            key: movementKey(input.outLeg),
            movementDate: input.outLeg.movementDate,
            createdAt: input.outLeg.createdAt,
            baseQuantity: input.outLeg.baseQuantity,
          },
          inLeg: {
            id: input.inLeg.id,
            key: movementKey(input.inLeg),
            movementDate: input.inLeg.movementDate,
            createdAt: input.inLeg.createdAt,
            baseQuantity: input.inLeg.baseQuantity,
          },
          sourceState,
          destinationState,
          method: input.valuationMethod,
          at: input.outLeg.updatedAt,
          actorId: input.actorId,
          operationKey: input.outLeg.operationKey,
          reason: input.outLeg.reason,
        })
      : await valueTransfer(tx, {
          sourceState,
          destinationState,
          method: input.valuationMethod,
          quantity: magnitudeOf(input.outLeg.baseQuantity),
          at: input.outLeg.updatedAt,
          actorId: input.actorId,
        });

    const outLeg = toDomain(
      await tx.inventoryMovement.create({
        data: { ...input.outLeg, ...legColumns.out },
      }),
    );
    const inLeg = toDomain(
      await tx.inventoryMovement.create({
        data: { ...input.inLeg, ...legColumns.in },
      }),
    );
    const outBalance = first.role === 'out' ? firstBalance : secondBalance;
    const inBalance = first.role === 'out' ? secondBalance : firstBalance;
    await adjustBalanceCounters(tx, {
      balanceId: outBalance.id,
      onHandDelta: input.outLeg.baseQuantity,
      reservedDelta: '0',
      lastMovementDate: maxDate(
        outBalance.lastMovementDate,
        input.outLeg.movementDate,
      ),
      updatedAt: input.outLeg.updatedAt,
      updatedBy: input.actorId,
    });
    await adjustBalanceCounters(tx, {
      balanceId: inBalance.id,
      onHandDelta: input.inLeg.baseQuantity,
      reservedDelta: '0',
      lastMovementDate: maxDate(
        inBalance.lastMovementDate,
        input.inLeg.movementDate,
      ),
      updatedAt: input.inLeg.updatedAt,
      updatedBy: input.actorId,
    });
    await insertOperationRow(tx, input.operation);
    return { outLeg, inLeg };
  }

  /**
   * Post a reversal: the exact mirror of one original movement. The original
   * row locks first, so two concurrent reversals of the same movement
   * serialize and the loser deterministically sees the winner's reversal —
   * the unique index stays as backstop, never as the primary mechanism.
   *
   * @throws AlreadyReversedError when the original already has a reversal.
   * @throws InsufficientStockError when the mirror would violate the policy
   *   (e.g. reversing an inbound whose stock was already consumed).
   */
  async postReversal(
    input: PostReversalInput,
    tx?: CoreTxClient,
  ): Promise<{ movement: InventoryMovement }> {
    if (tx === undefined) {
      return this.withTransaction((transaction) =>
        this.postReversal(input, transaction),
      );
    }
    const original = await lockMovementRow(tx, input.originalMovementId);
    if (original === null) {
      throw new Error(
        `Original movement "${input.originalMovementId}" does not exist.`,
      );
    }
    const prior = await tx.inventoryMovement.findFirst({
      where: { reversalOfMovementId: input.originalMovementId },
    });
    if (prior !== null) throw new AlreadyReversedError();

    const { balance } = await lockBalanceRow(
      tx,
      movementKey(input.movement),
      input.actorId,
    );
    assertSufficient(
      balance.onHand,
      input.movement.baseQuantity,
      input.allowNegative,
    );
    // A reversal undoes the value the ORIGINAL actually carried, read from
    // the row this transaction already holds locked (PDR-05 rule 7) — not
    // the current average, and not a number the caller supplied.
    const { state } = await lockValuationStateRow(
      tx,
      movementKey(input.movement),
      input.valuation.method,
      input.actorId,
    );
    const reversedValue =
      original.totalCost === null || original.valuationStatus === 'unvalued'
        ? null
        : magnitudeOf(original.totalCost);
    const columns = await valueMovement(tx, {
      state,
      method: input.valuation.method,
      movementType: movementTypeOf(input.movement),
      baseQuantity: input.movement.baseQuantity,
      knownValue: reversedValue,
      knownValueSource: 'reversal',
      backdated: input.valuation.backdated,
      at: input.movement.updatedAt,
      actorId: input.actorId,
    });
    const movement = toDomain(
      await tx.inventoryMovement.create({
        data: { ...input.movement, ...columns },
      }),
    );
    await adjustBalanceCounters(tx, {
      balanceId: balance.id,
      onHandDelta: input.movement.baseQuantity,
      reservedDelta: '0',
      lastMovementDate: maxDate(
        balance.lastMovementDate,
        input.movement.movementDate,
      ),
      updatedAt: input.movement.updatedAt,
      updatedBy: input.actorId,
    });
    await insertOperationRow(tx, input.operation);
    return { movement };
  }

  /** C-58 composition seam: one caller owns document + ledger atomicity. */
  async withTransaction<T>(work: (tx: CoreTxClient) => Promise<T>): Promise<T> {
    const client = await this.transacting();
    return client.$transaction(work);
  }
}

// ---- Internal helpers ----

function movementKey(movement: MovementCreate): BalanceKey {
  return {
    organizationId: movement.organizationId,
    branchId: movement.branchId,
    warehouseId: movement.warehouseId,
    itemId: movement.itemId,
  };
}

/**
 * Is this transfer dated before the latest movement on either of its keys?
 * Read INSIDE the transfer's transaction (the caller passes its client), so
 * the answer describes the state the locked write is about to extend.
 */
async function isBackdatedTransfer(
  tx: CoreTxClient,
  input: PostTransferInput,
): Promise<boolean> {
  const keys = await transferKeyLatestMovementDates(tx, input);
  return keys.some(
    (key) =>
      key.latestMovementDate !== null &&
      input.outLeg.movementDate.getTime() < key.latestMovementDate.getTime(),
  );
}

/** Both keys with their latest movement date, for the refusal payload. */
async function transferKeyLatestMovementDates(
  tx: CoreTxClient,
  input: PostTransferInput,
): Promise<{ warehouseId: string; latestMovementDate: Date | null }[]> {
  const keys = [
    { warehouseId: input.outLeg.warehouseId },
    { warehouseId: input.inLeg.warehouseId },
  ];
  const rows: { warehouseId: string; latestMovementDate: Date | null }[] = [];
  for (const key of keys) {
    const aggregate = await tx.inventoryMovement.aggregate({
      where: {
        organizationId: input.outLeg.organizationId,
        warehouseId: key.warehouseId,
        itemId: input.outLeg.itemId,
      },
      _sum: { baseQuantity: true },
      _max: { movementDate: true },
    });
    rows.push({
      warehouseId: key.warehouseId,
      latestMovementDate: aggregate._max.movementDate,
    });
  }
  return rows;
}

/** The two transfer keys in the fixed locking order (ascending warehouse). */
type OrderedLeg = { role: 'out' | 'in'; key: BalanceKey };

function orderedKeys(
  outLeg: MovementCreate,
  inLeg: MovementCreate,
): [OrderedLeg, OrderedLeg] {
  const out: OrderedLeg = { role: 'out', key: movementKey(outLeg) };
  const into: OrderedLeg = { role: 'in', key: movementKey(inLeg) };
  return out.key.warehouseId.localeCompare(into.key.warehouseId) <= 0
    ? [out, into]
    : [into, out];
}

/** The movement type of a create payload, validated once at the boundary. */
function movementTypeOf(movement: MovementCreate): MovementType {
  if (!isMovementType(movement.movementType)) {
    throw new Error(
      `Cannot post a movement with unknown type "${movement.movementType}".`,
    );
  }
  return movement.movementType;
}

/** `|value|` for a signed decimal string. */
function magnitudeOf(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('-') ? trimmed.slice(1) : trimmed;
}

/** Policy evaluation against the locked row — exact decimal arithmetic. */
function assertSufficient(
  onHand: string,
  baseDelta: string,
  allowNegative: boolean,
): void {
  const resulting = addDecimalStrings(onHand, baseDelta);
  if (violatesNegativePolicy(resulting, allowNegative)) {
    // `requested` is the outbound magnitude (positive) for a readable message.
    const requested = baseDelta.trim().startsWith('-')
      ? decimalToString(subtractDecimalStrings('0', baseDelta))
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

function toWhere(filter: MovementListFilter): MovementWhere {
  const where: MovementWhere = { organizationId: filter.organizationId };
  if (filter.branchId !== undefined) where.branchId = filter.branchId;
  if (filter.warehouseId !== undefined) where.warehouseId = filter.warehouseId;
  if (filter.itemId !== undefined) where.itemId = filter.itemId;
  if (filter.movementType !== undefined)
    where.movementType = filter.movementType;
  if (filter.transferId !== undefined) where.transferId = filter.transferId;
  if (filter.dateFrom !== undefined || filter.dateTo !== undefined) {
    where.movementDate = {
      ...(filter.dateFrom === undefined ? {} : { gte: filter.dateFrom }),
      ...(filter.dateTo === undefined ? {} : { lte: filter.dateTo }),
    };
  }
  return where;
}

function toDomain(row: MovementRow): InventoryMovement {
  if (!isMovementType(row.movementType)) {
    throw new Error(
      `Stored movement "${row.id}" has an unknown type "${row.movementType}".`,
    );
  }
  return {
    id: row.id,
    organizationId: row.organizationId,
    branchId: row.branchId,
    warehouseId: row.warehouseId,
    itemId: row.itemId,
    movementType: row.movementType,
    quantity: decimalToString(row.quantity),
    enteredUnitId: row.unitId,
    baseQuantity: decimalToString(row.baseQuantity),
    baseUnitId: row.baseUnitId,
    conversionFactor: decimalToString(row.conversionFactor),
    movementDate: row.movementDate,
    transferId: row.transferId,
    reversalOfMovementId: row.reversalOfMovementId,
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    reason: row.reason,
    operationKey: row.operationKey,
    totalCost: row.totalCost === null ? null : decimalToString(row.totalCost),
    valuationStatus: toMovementValuationStatus(row.id, row.valuationStatus),
    valuationSource: toValuationSource(row.id, row.valuationSource),
    valuedAt: row.valuedAt,
    valuationRunId: row.valuationRunId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toMovementValuationStatus(
  id: string,
  value: string,
): MovementValuationStatus {
  if (!(MOVEMENT_VALUATION_STATUSES as readonly string[]).includes(value)) {
    throw new Error(
      `Stored movement "${id}" has an unknown valuation status "${value}".`,
    );
  }
  return value as MovementValuationStatus;
}

function toValuationSource(
  id: string,
  value: string | null,
): ValuationSource | null {
  if (value === null) return null;
  if (!(VALUATION_SOURCES as readonly string[]).includes(value)) {
    throw new Error(
      `Stored movement "${id}" has an unknown valuation source "${value}".`,
    );
  }
  return value as ValuationSource;
}
