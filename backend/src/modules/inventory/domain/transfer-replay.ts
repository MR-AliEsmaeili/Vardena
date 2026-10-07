/**
 * The COUPLED two-key transfer replay (C-59C — the gap OD-TRF-09 assigned).
 *
 * WHY THIS EXISTS
 *
 * A transfer's two legs are one valuation unit (OD-TRF-05): the source leg is
 * valued first and the destination leg receives EXACTLY the source-derived
 * value (OD-TRF-01), so the pair is value-neutral (OD-TRF-02). A backdated
 * transfer therefore cannot be valued by replaying either key on its own — and
 * the single-key replay refuses to try (`UnvaluedTransferReplayError`).
 *
 * WHAT THIS IS
 *
 * One fold over BOTH keys' histories in the canonical ledger order
 * (`movementDate, createdAt, id` — the same total order the Kardex and the
 * single-key replay use). Each stored fact is applied to its own key by the
 * strategy its own effective method names, and the transfer's two NEW legs are
 * applied at the pair's position by the SAME pure arithmetic the posting path
 * uses: `applyTransfer` from `moving-weighted-average.ts`. Nothing here
 * recomputes an average, a share or a rounding rule: the pair's value, its
 * uncosted split and its value-neutrality are the shipped rules, reused.
 *
 * WHY ONE PASS AND NOT TWO REPLAYS
 *
 * The invariant the transfer contract rests on is "the destination value is
 * derived from the source value, never independently invented". Applying the
 * pair with one call that yields BOTH legs makes that structural instead of
 * sequential: there is no code path here that can write one leg without the
 * other, and no second place where MWA arithmetic could drift from the posting
 * path.
 *
 * Consequence, asserted in `transfer-replay.spec.ts`: on a key with nothing
 * dated after the transfer, the coupled replay produces exactly what the
 * incremental posting path writes.
 *
 * WHAT IS PRESERVED, WHAT IS RECOMPUTED
 *
 * Identical to the single-key replay: every value a fact carries on its own
 * authority (entered costs, transfer legs of OTHER pairs, reversals) is
 * preserved; every average-derived issue value is recomputed; `backdated` is
 * meaningless during a replay and cleared. Stored legs of other transfers keep
 * the shared guard (`assertUnpairedTransferLegIsReplayable`), so a pair this
 * driver is not replaying still fails closed rather than leaking value.
 *
 * Framework-free (AR-05): no I/O, no clock, no ids — the caller supplies both
 * histories, their order and the pair's position, so the same input always
 * produces the same numbers.
 */

import type {
  MovementValuation,
  ValuationPosition,
} from './moving-weighted-average.js';
import { EMPTY_POSITION, applyTransfer } from './moving-weighted-average.js';
import type { ReplayFact, ReplayedMovement } from './valuation-replay.js';
import {
  assertUnpairedTransferLegIsReplayable,
  toStrategyInput,
  valuationStrategyFor,
} from './valuation-replay.js';

/** Which side of the pair a stored movement belongs to. */
export type CoupledReplaySide = 'source' | 'destination';

/**
 * One stored movement of either key, with the identity columns the canonical
 * order needs. The FACT alone cannot be ordered: its id is a ULID minted when
 * the row was created, which for a backdated movement is later than its
 * business date — so the caller passes the movement's own ordering columns.
 */
export interface CoupledReplayEntry {
  side: CoupledReplaySide;
  movementDate: Date;
  createdAt: Date;
  id: string;
  fact: ReplayFact;
  /**
   * The stored row's own transfer, when it is a transfer leg. Carried so a
   * refusal can name the pair the operator must price together — the driver
   * itself never uses it for arithmetic.
   */
  transferId?: string | null | undefined;
}

/**
 * Where the pair sits in the merged timeline, and what it moves.
 *
 * The two new legs share one business date and one creation instant (they are
 * written by one command), so one anchor describes both. `id` is the out leg's
 * id — the tie-break the canonical order uses when dates and instants are
 * equal, and the leg that must sort before its own partner.
 */
export interface CoupledTransferAnchor {
  movementDate: Date;
  createdAt: Date;
  id: string;
  /** Positive base-unit magnitude moved. */
  quantity: string;
}

export interface CoupledTransferReplayResult {
  sourcePosition: ValuationPosition;
  destinationPosition: ValuationPosition;
  /** The new source leg's valuation — the value the destination derives from. */
  out: MovementValuation;
  /** The new destination leg's valuation: the exact same value, opposite sign. */
  in: MovementValuation;
  /** Stored source rows, in canonical order, with their replayed valuation. */
  sourceValuations: ReplayedMovement[];
  /** Stored destination rows, in canonical order, with their replayed valuation. */
  destinationValuations: ReplayedMovement[];
  /**
   * True when the key's stored value is still inconsistent after the replay —
   * the key stays stale. Driven by the strategy's own `marksStale`, so it
   * covers both a `provisional` row and the unvalued exit that consumed
   * valued stock (OD-RET-02/04); the two drivers cannot disagree.
   */
  provisional: { source: boolean; destination: boolean };
}

/** The canonical ledger total order: business date, creation instant, id. */
export function compareCanonicalMovementOrder(
  left: { movementDate: Date; createdAt: Date; id: string },
  right: { movementDate: Date; createdAt: Date; id: string },
): number {
  const byDate = left.movementDate.getTime() - right.movementDate.getTime();
  if (byDate !== 0) return byDate;
  const byCreatedAt = left.createdAt.getTime() - right.createdAt.getTime();
  if (byCreatedAt !== 0) return byCreatedAt;
  return left.id.localeCompare(right.id);
}

/**
 * Replay both keys' histories together, applying the transfer pair at its own
 * position. Deterministic and total: the same entries and anchor always
 * produce the same result.
 *
 * The caller MUST pass entries whose `fact.method` is the method effective for
 * that movement's organization + item AT THAT MOVEMENT'S BUSINESS DATE
 * (OD-VAL-14) — resolution is I/O and belongs to the caller, exactly as in
 * `replay()`.
 *
 * @throws UnvaluedTransferReplayError when a STORED leg of some other transfer
 *   would have to be valued on one key alone (the pair is not in this replay).
 * @throws UnsupportedValuationMethodError when a replayed period's configured
 *   method is not implemented in this build (OD-VAL-18).
 */
export function replayCoupledTransfer(params: {
  entries: readonly CoupledReplayEntry[];
  transfer: CoupledTransferAnchor;
}): CoupledTransferReplayResult {
  const steps = [
    ...params.entries.map((entry) => ({ entry, transfer: false as const })),
    { entry: null, transfer: true as const },
  ].sort((left, right) =>
    compareCanonicalMovementOrder(
      left.transfer ? params.transfer : (left.entry as CoupledReplayEntry),
      right.transfer ? params.transfer : (right.entry as CoupledReplayEntry),
    ),
  );

  let source = EMPTY_POSITION;
  let destination = EMPTY_POSITION;
  const sourceValuations: ReplayedMovement[] = [];
  const destinationValuations: ReplayedMovement[] = [];
  let sourceProvisional = false;
  let destinationProvisional = false;
  let out: MovementValuation | null = null;
  let pairIn: MovementValuation | null = null;

  for (const step of steps) {
    if (step.transfer) {
      // The pair, at its own position, by the posting path's own arithmetic.
      const outcome = applyTransfer({
        source,
        destination,
        quantity: params.transfer.quantity,
      });
      source = outcome.source;
      destination = outcome.destination;
      out = outcome.outValuation;
      pairIn = outcome.inValuation;
      continue;
    }
    const entry = step.entry as CoupledReplayEntry;
    const position = entry.side === 'source' ? source : destination;
    assertUnpairedTransferLegIsReplayable(position, entry.fact, {
      transferId: entry.transferId ?? null,
    });
    const outcome = valuationStrategyFor(entry.fact.method, entry.fact.id)(
      position,
      toStrategyInput(entry.fact),
    );
    const replayed: ReplayedMovement = {
      id: entry.fact.id,
      valuation: outcome.valuation,
    };
    // The strategy's own `marksStale` keeps the key stale, exactly as in the
    // single-key driver: a stored fact can be `unvalued` and still leave its
    // key inconsistent (the basis-linked unvalued purchase return that
    // consumed valued stock, OD-RET-02/04).
    if (entry.side === 'source') {
      source = outcome.position;
      sourceProvisional ||= outcome.marksStale;
      sourceValuations.push(replayed);
    } else {
      destination = outcome.position;
      destinationProvisional ||= outcome.marksStale;
      destinationValuations.push(replayed);
    }
  }

  if (out === null || pairIn === null) {
    // Unreachable: the anchor is always part of the step list.
    throw new Error('The coupled transfer replay did not apply the transfer.');
  }
  return {
    sourcePosition: source,
    destinationPosition: destination,
    out,
    in: pairIn,
    sourceValuations,
    destinationValuations,
    provisional: {
      source: sourceProvisional,
      destination: destinationProvisional,
    },
  };
}
