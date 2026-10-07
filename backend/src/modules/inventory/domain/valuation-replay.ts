/**
 * Deterministic replay — the historical driver of a recalculation
 * (PDR-05 OD-VAL-12/OD-VAL-14, D-21).
 *
 * This file is deliberately METHOD-AGNOSTIC. It owns the order of history and
 * the dispatch to a strategy; it owns no costing arithmetic. The arithmetic of
 * the one method this MVP executes lives in `moving-weighted-average.ts`.
 *
 * WHY THE DISPATCH IS PER FACT, NOT PER RUN
 *
 * The valuation method is effective-dated configuration per organization +
 * item (OD-VAL-03/OD-VAL-14). A movement is therefore valued by the method
 * that was in force for its item AT ITS OWN BUSINESS DATE:
 *
 *     movementDate → resolve(organization + item, movementDate) → strategy
 *
 * A replay that resolved ONE method (say, the one in force today) and applied
 * it to the whole history would silently restate periods under a method that
 * was not in force then — exactly what effective dating exists to prevent. So
 * every `ReplayFact` carries the method resolved at its own date, and the
 * driver asks for a strategy once per fact.
 *
 * WHAT THIS IS NOT
 *
 * There is no dynamic strategy registry, no configuration table of handlers
 * and no JSONB strategy document. `valuationStrategyFor` is a closed switch
 * over the same closed `ValuationMethod` vocabulary the configuration endpoint
 * validates against. Adding FIFO later means adding one pure module and one
 * `case` — and nothing else. Until that exists, a fact whose effective method
 * is not implemented makes the replay FAIL CLOSED
 * (`UnsupportedValuationMethodError`), because the only alternatives are to
 * value history with a strategy nobody wrote or to drop the fact; both would
 * produce a number the system cannot defend (AR-24, OD-VAL-18).
 *
 * Framework-free (AR-05): the caller supplies the facts, their order and their
 * methods, so the same input always produces the same output.
 */

import type { MovementType } from './movement-type.js';
import type {
  MovementValuationStatus,
  ValuationSource,
} from './inventory-valuation.js';
import type {
  MovementValuation,
  ValuationFact,
  ValuationOutcome,
  ValuationPosition,
} from './moving-weighted-average.js';
import {
  EMPTY_POSITION,
  applyMovement,
  outboundConsumesValuedStock,
} from './moving-weighted-average.js';
import { compareMoney } from './money.js';
import type { ValuationMethod } from './valuation-method.js';

/**
 * A pure costing strategy: (position so far, one fact) → (next position, what
 * that fact is worth). `applyMovement` is the Moving Weighted Average
 * implementation of exactly this shape.
 */
export type ValuationStrategy = (
  position: ValuationPosition,
  fact: ValuationFact,
) => ValuationOutcome;

/**
 * Raised when history asks for a method this build cannot execute. It names
 * the method and the fact so the caller can tell the user WHICH movement and
 * WHICH configured method made the replay impossible, instead of a generic
 * failure.
 */
/**
 * More than one valuation method version is in force at one movement date.
 *
 * Unmapped by the API on purpose: unlike the errors beside it, this is not
 * something a user did — the write path forbids overlapping windows, so
 * reaching this means stored configuration has become invalid and an
 * engineer must look. It therefore surfaces as a server fault, exactly like
 * the "unknown stored method" guard in the same read path, rather than as a
 * business-rule response that would read as if the operator had made a
 * mistake. The message names the item, the date and the conflicting
 * versions; no database internals are exposed.
 */
export class AmbiguousValuationMethodError extends Error {
  readonly itemId: string;
  readonly instant: Date;
  readonly versionIds: readonly string[];

  constructor(itemId: string, instant: Date, versionIds: readonly string[]) {
    super(
      `Item "${itemId}" has ${versionIds.length} valuation method versions in force at ${instant.toISOString()} ` +
        `(${versionIds.join(', ')}). Historical resolution for that date is ambiguous, so the replay was refused.`,
    );
    this.name = 'AmbiguousValuationMethodError';
    this.itemId = itemId;
    this.instant = instant;
    this.versionIds = versionIds;
  }
}

export class UnsupportedValuationMethodError extends Error {
  readonly method: string;
  readonly movementId: string | null;

  constructor(method: string, movementId: string | null = null) {
    super(
      `Valuation method "${method}" is configured for this period but is not implemented, ` +
        'so the affected movements cannot be revalued. Only "moving_weighted_average" can be executed.',
    );
    this.name = 'UnsupportedValuationMethodError';
    this.method = method;
    this.movementId = movementId;
  }
}

/**
 * A single-key replay would VALUE a transfer leg that was posted `unvalued`
 * (the source key held no valued stock when the transfer moved it). Valuing
 * the source leg alone leaks the moved value out of the organization: the
 * paired destination leg lives on another key and is never revalued by this
 * replay. A single-key command therefore REFUSES with this named error instead
 * of silently breaking organization-level value conservation (OD-TRF-01: the
 * pair is exactly value-neutral).
 *
 * Since C-59C the caller that CAN resolve the pair — the coupled two-key
 * replay (`domain/transfer-replay.ts`), run by the transfer command itself —
 * does not go through this guard for the pair it is posting. The guard still
 * fires for a STORED leg of some OTHER transfer: its counterpart key is not
 * being replayed, so the refusal (and its remedy: price both keys together)
 * stands.
 */
export class UnvaluedTransferReplayError extends Error {
  readonly movementId: string;
  /** The transfer whose leg could not be resolved, when the caller knows it. */
  readonly transferId: string | null;
  /** The key the OTHER leg of that transfer lives on, when known. */
  readonly counterpartWarehouseId: string | null;

  constructor(
    movementId: string,
    context: {
      transferId?: string | null | undefined;
      counterpartWarehouseId?: string | null | undefined;
    } = {},
  ) {
    const transferId = context.transferId ?? null;
    const counterpartWarehouseId = context.counterpartWarehouseId ?? null;
    super(
      `Movement "${movementId}" is an unvalued transfer leg; repricing it on this ` +
        'warehouse alone would strand the moved value on the other side of the transfer.' +
        (transferId === null ? '' : ` The transfer is "${transferId}".`) +
        (counterpartWarehouseId === null
          ? ''
          : ` Its paired leg lives on warehouse "${counterpartWarehouseId}".`) +
        ' Price BOTH keys of that transfer together (a Pricing Operation covering both' +
        ' warehouses), or assign the transferred stock a cost, so both legs carry their value.',
    );
    this.name = 'UnvaluedTransferReplayError';
    this.movementId = movementId;
    this.transferId = transferId;
    this.counterpartWarehouseId = counterpartWarehouseId;
  }
}

/**
 * The closed method → strategy map. One active method today (OD-VAL-02); the
 * rest of the vocabulary exists so configuration can name them and the system
 * can refuse them honestly (OD-VAL-18).
 */
export function valuationStrategyFor(
  method: ValuationMethod,
  movementId: string | null = null,
): ValuationStrategy {
  switch (method) {
    case 'moving_weighted_average':
      return applyMovement;
    default:
      throw new UnsupportedValuationMethodError(method, movementId);
  }
}

/** One fact, the method effective at its date, and the row to write back to. */
export interface ReplayFact extends ValuationFact {
  id: string;
  /**
   * The valuation method effective for this movement's organization + item at
   * this movement's BUSINESS date — never the method in force today.
   */
  method: ValuationMethod;
}

export interface ReplayedMovement {
  id: string;
  valuation: MovementValuation;
}

export interface ReplayResult {
  position: ValuationPosition;
  movements: ReplayedMovement[];
  /**
   * True when the replay leaves the key's stored value inconsistent — the
   * key stays stale after it. The authority is the STRATEGY's own
   * `marksStale`, never a status comparison: a row can be `unvalued` and
   * still leave the key inconsistent — the basis-linked unvalued purchase
   * return that consumed valued stock attributes no value to its own row,
   * so the movement sum no longer matches the position (OD-RET-02/04,
   * exactly as on the posting path). A replay re-establishes consistency;
   * it may only conclude "still inconsistent" from what the strategy itself
   * reports for its facts.
   */
  provisional: boolean;
}

/**
 * Deterministic replay of a key's whole history.
 *
 * The caller passes the facts in the canonical ledger order
 * (`movement_date, created_at, id` — the same order C-54's Kardex uses, so
 * the recalculated numbers agree with what the Kardex shows). `backdated` is
 * meaningless during a replay (the facts are in order by definition) and is
 * cleared: valuing a late document as if it had arrived on time is precisely
 * what a recalculation is for.
 *
 * WHAT IS PRESERVED: every value a fact carries on its own authority — human
 * entered costs, transfer legs, reversals. WHAT IS RECOMPUTED: every
 * average-derived issue value. That split is why a replay is idempotent:
 * running it twice yields identical numbers.
 *
 * WHICH STRATEGY: the one named by the fact itself, resolved once per fact.
 */
export function replay(facts: readonly ReplayFact[]): ReplayResult {
  let position = EMPTY_POSITION;
  const movements: ReplayedMovement[] = [];
  let provisional = false;
  for (const fact of facts) {
    assertUnpairedTransferLegIsReplayable(position, fact);
    const strategy = valuationStrategyFor(fact.method, fact.id);
    const outcome = strategy(position, toStrategyInput(fact));
    position = outcome.position;
    // The key stays stale when the STRATEGY says it does — `marksStale` is
    // its own answer, not a status comparison. In a replay `backdated` is
    // always false, so the one case where it differs from "some row is
    // `provisional`" is the basis-linked unvalued purchase return that
    // consumed valued stock without attributing value to its own row: the
    // key must stay stale rather than be reported consistent (OD-RET-02/04).
    provisional ||= outcome.marksStale;
    movements.push({ id: fact.id, valuation: outcome.valuation });
  }
  return { position, movements, provisional };
}

/**
 * The transfer-leg guard (C-59 hardening), shared by every replay driver —
 * the single-key `replay()` above and the coupled two-key driver
 * (`domain/transfer-replay.ts`), so the two can never disagree about which
 * stored legs a replay may not resolve on its own.
 *
 * A stored `transfer_out` leg with no value of its own that would consume
 * valued stock is refused: the value it would move lives on this key, and the
 * paired leg on the other key is not part of THIS replay. The caller that
 * holds both keys (the coupled transfer replay) applies its own pair instead
 * and never calls this for it.
 *
 * `context` is the movement's own transfer identity, when the caller holds the
 * row that carries it: the coupled replay does (its entries come from the
 * stored rows), the single-key replay does not (it folds facts only) — in
 * which case the refusal still names the blocking movement id.
 */
export function assertUnpairedTransferLegIsReplayable(
  position: ValuationPosition,
  fact: ReplayFact,
  context: {
    transferId?: string | null | undefined;
    counterpartWarehouseId?: string | null | undefined;
  } = {},
): void {
  if (
    fact.movementType === 'transfer_out' &&
    fact.knownValue === null &&
    outboundConsumesValuedStock(position, magnitudeOf(fact.baseQuantity))
  ) {
    throw new UnvaluedTransferReplayError(fact.id, context);
  }
}

/**
 * The strategy input a STORED fact replays as.
 *
 * Shared by both drivers for one reason: the coupled transfer replay must
 * compute exactly what a single-key recalculation computes for the movements
 * it does not couple, so "how a stored fact is dispatched" exists once.
 *
 * `backdated` is cleared — the facts are in order by definition, and valuing a
 * late document as if it had arrived on time is precisely what a replay is
 * for.
 *
 * `forceUnvalued` is propagated VERBATIM: it is part of what the stored fact
 * carries on its own authority. A basis-linked purchase return whose receipt
 * basis carried no value was posted as an unvalued exit, deriving no value
 * from the average (OD-RET-02/04); `toReplayFact` rebuilds that fact from the
 * stored row, and a replay must re-apply exactly that exit. Dropping the flag
 * here would silently re-derive the exit from the current average — the
 * recalculation inventing the value the posting path refused to invent.
 */
export function toStrategyInput(fact: ReplayFact): ValuationFact {
  return {
    movementType: fact.movementType,
    baseQuantity: fact.baseQuantity,
    knownValue: fact.knownValue,
    knownValueSource: fact.knownValueSource,
    backdated: false,
    ...(fact.forceUnvalued === true ? { forceUnvalued: true } : {}),
  };
}

/** `|baseQuantity|` — the magnitude the strategy consumes. */
function magnitudeOf(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('-') ? trimmed.slice(1) : trimmed;
}

/**
 * True when two valuations differ in any stored field — used to count what a
 * recalculation actually changed, so a run that changed nothing reports zero
 * instead of claiming work it did not do.
 */
export function valuationChanged(
  before: {
    status: MovementValuationStatus;
    totalCost: string | null;
    source: ValuationSource | null;
  },
  after: MovementValuation,
): boolean {
  if (before.status !== after.status) return true;
  if (before.source !== after.source) return true;
  if (before.totalCost === null || after.totalCost === null) {
    return before.totalCost !== after.totalCost;
  }
  return compareMoney(before.totalCost, after.totalCost) !== 0;
}

/**
 * `|value|` with the string left exactly as stored — the strategy canonicalises
 * when it does the arithmetic, so a replay never silently reformats a value a
 * human entered.
 */
function unsigned(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('-') ? trimmed.slice(1) : trimmed;
}

/**
 * The replay input for a stored movement row: preserve every value the fact
 * carries on its own authority, recompute only what the average produced.
 *
 * `method` is supplied by the caller because resolving it needs the item's
 * effective-dated configuration, which is I/O; this function stays pure. The
 * caller MUST resolve it at `row.movementDate` — see
 * `resolveValuationMethodAt`.
 */
export function toReplayFact(
  row: {
    id: string;
    movementType: MovementType;
    baseQuantity: string;
    totalCost: string | null;
    valuationStatus: MovementValuationStatus;
    valuationSource: ValuationSource | null;
  },
  method: ValuationMethod,
): ReplayFact {
  const preserved =
    row.totalCost !== null &&
    row.valuationSource !== null &&
    row.valuationSource !== 'average_cost';
  // The unvalued basis-linked purchase return (OD-RET-02/04): no value on
  // the row, but `return_basis` says WHY — the receipt it returns against
  // was never priced. A replay must reproduce that exactly: the exit stays
  // valueless and never derives from the average (a value here would be a
  // silent variance into the pool).
  const forcedUnvalued =
    row.movementType === 'purchase_return' &&
    row.totalCost === null &&
    row.valuationSource === 'return_basis';
  return {
    id: row.id,
    method,
    movementType: row.movementType,
    baseQuantity: row.baseQuantity,
    knownValue: preserved ? unsigned(row.totalCost ?? '0') : null,
    knownValueSource: preserved
      ? (row.valuationSource ?? 'entered')
      : undefined,
    ...(forcedUnvalued ? { forceUnvalued: true } : {}),
  };
}
