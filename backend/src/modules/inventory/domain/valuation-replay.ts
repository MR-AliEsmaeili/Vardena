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
 * replay. The coupled two-key replay that would resolve both legs together
 * is the C-59C gap (OD-TRF-08/09), so until it exists the replay REFUSES
 * with this named error instead of silently breaking organization-level value
 * conservation (OD-TRF-01: the pair is exactly value-neutral).
 */
export class UnvaluedTransferReplayError extends Error {
  readonly movementId: string;

  constructor(movementId: string) {
    super(
      `Movement "${movementId}" is an unvalued transfer leg; repricing it on this ` +
        'warehouse alone would strand the moved value on the other side of the transfer. ' +
        'Assign a cost to the transferred stock (or price the key before the transfer date) ' +
        'so both legs carry their value. Coupled two-key transfer repricing is not implemented yet.',
    );
    this.name = 'UnvaluedTransferReplayError';
    this.movementId = movementId;
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
  /** True when any replayed row is still provisional — the key stays stale. */
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
    // Transfer-leg guard (C-59 hardening): a transfer leg that was posted
    // `unvalued` (the source held no valued stock) must stay unvalued in a
    // single-key replay. Valuing it here would move value out of this key's
    // pool while the paired leg on the other key receives nothing — an
    // organization-level value leak. The coupled two-key replay that could
    // resolve both legs together is the C-59C gap (OD-TRF-08/09), so the
    // replay fails closed with a named error instead.
    if (
      fact.movementType === 'transfer_out' &&
      fact.knownValue === null &&
      outboundConsumesValuedStock(position, magnitudeOf(fact.baseQuantity))
    ) {
      throw new UnvaluedTransferReplayError(fact.id);
    }
    const strategy = valuationStrategyFor(fact.method, fact.id);
    const outcome = strategy(position, {
      movementType: fact.movementType,
      baseQuantity: fact.baseQuantity,
      knownValue: fact.knownValue,
      knownValueSource: fact.knownValueSource,
      backdated: false,
    });
    position = outcome.position;
    provisional ||= outcome.valuation.status === 'provisional';
    movements.push({ id: fact.id, valuation: outcome.valuation });
  }
  return { position, movements, provisional };
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
