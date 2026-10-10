import { describe, expect, it } from 'vitest';
import {
  toBusinessDate,
  type BusinessDate,
} from '../../../kernel/datetime/business-date.js';
import {
  compareCanonicalMovementOrder,
  replayCoupledTransfer,
  type CoupledReplayEntry,
} from './transfer-replay.js';
import {
  UnsupportedValuationMethodError,
  UnvaluedTransferReplayError,
  type ReplayFact,
} from './valuation-replay.js';
import {
  EMPTY_POSITION,
  applyMovement,
  applyTransfer,
  type ValuationPosition,
} from './moving-weighted-average.js';

/**
 * The coupled two-key transfer replay (C-59C / OD-TRF-01…09).
 *
 * Two things are proven here, and only two:
 *
 *   1. the pair arithmetic is NOT re-implemented — a non-backdated transfer
 *      replayed through this driver produces byte-identical values to the
 *      incremental posting path (`applyTransfer` on the live positions);
 *   2. the driver's fold is what the transfer contract says it is — the
 *      destination leg receives the SOURCE-derived value, later movements on
 *      both keys are recomputed from the position that includes the pair, and
 *      an unpaired stored leg still fails closed.
 */

const MWA = 'moving_weighted_average' as const;

/** A business date inside one fixed month; only the day varies. */
function at(day: number): Date {
  return new Date(Date.UTC(2026, 0, day, 8, 0, 0));
}

function businessDay(day: number): BusinessDate {
  const value = toBusinessDate(`2026-01-${String(day).padStart(2, '0')}`);
  if (value === null) throw new Error(`Invalid test BusinessDate day: ${day}`);
  return value;
}

function receipt(
  id: string,
  quantity: string,
  value: string | null,
): ReplayFact {
  return value === null
    ? {
        id,
        method: MWA,
        movementType: 'inbound',
        baseQuantity: quantity,
        knownValue: null,
      }
    : {
        id,
        method: MWA,
        movementType: 'inbound',
        baseQuantity: quantity,
        knownValue: value,
        knownValueSource: 'entered',
      };
}

function issue(id: string, quantity: string): ReplayFact {
  return {
    id,
    method: MWA,
    movementType: 'outbound',
    baseQuantity: `-${quantity}`,
    knownValue: null,
  };
}

function entry(
  side: 'source' | 'destination',
  day: number,
  fact: ReplayFact,
): CoupledReplayEntry {
  return {
    side,
    movementDate: businessDay(day),
    createdAt: at(day),
    id: fact.id,
    fact,
  };
}

/** The pair as one command writes it: one date, one instant, one magnitude. */
function pair(
  day: number,
  quantity: string,
): {
  movementDate: BusinessDate;
  createdAt: Date;
  id: string;
  quantity: string;
} {
  return {
    movementDate: businessDay(day),
    createdAt: at(day),
    id: 'pair-out',
    quantity,
  };
}

describe('replayCoupledTransfer — the pair is valued together', () => {
  it('produces exactly what the incremental posting path writes when nothing is backdated', () => {
    const sourceFact = receipt('s1', '10', '1000.00');
    const destinationFact = receipt('d1', '5', '250.00');

    const replayed = replayCoupledTransfer({
      entries: [
        entry('source', 1, sourceFact),
        entry('destination', 1, destinationFact),
      ],
      transfer: pair(10, '4'),
    });

    // The posted values, computed by the shipped posting arithmetic.
    const sourcePost = applyMovement(EMPTY_POSITION, {
      movementType: 'inbound',
      baseQuantity: '10',
      knownValue: '1000.00',
      knownValueSource: 'entered',
    });
    const destinationPost = applyMovement(EMPTY_POSITION, {
      movementType: 'inbound',
      baseQuantity: '5',
      knownValue: '250.00',
      knownValueSource: 'entered',
    });
    const posted = applyTransfer({
      source: sourcePost.position,
      destination: destinationPost.position,
      quantity: '4',
    });

    expect(replayed.out).toEqual(posted.outValuation);
    expect(replayed.in).toEqual(posted.inValuation);
    expect(replayed.sourcePosition).toEqual(posted.source);
    expect(replayed.destinationPosition).toEqual(posted.destination);
    expect(replayed.out.totalCost).toBe('-400');
    expect(replayed.in.totalCost).toBe('400');
  });

  it('gives the destination the SOURCE-derived value, never its own average', () => {
    // Destination average is 50/unit; source average is 100/unit. Four units
    // must arrive worth 400 (source-derived), not 200 (destination's pool).
    const replayed = replayCoupledTransfer({
      entries: [
        entry('source', 1, receipt('s1', '10', '1000.00')),
        entry('destination', 1, receipt('d1', '20', '1000.00')),
      ],
      transfer: pair(10, '4'),
    });

    expect(replayed.in.totalCost).toBe('400');
    expect(replayed.in.status).toBe('valued');
    expect(replayed.in.source).toBe('transfer');
    expect(replayed.destinationPosition).toEqual({
      valuedQuantity: '24',
      uncostedQuantity: '0',
      totalValue: '1400',
    });
  });

  it('recomputes both histories around a BACKDATED pair', () => {
    // Source: 10 @ 1000 on day 1, then a second receipt 10 @ 3000 on day 20.
    // Destination: 10 @ 1000 on day 1, then an issue of 12 on day 25.
    // The transfer (5 units) is dated day 10 — before the source's second
    // receipt — so it must consume the day-1 average (100/unit), and the
    // destination's later issue must consume the position that includes the
    // arriving value.
    const replayed = replayCoupledTransfer({
      entries: [
        entry('source', 1, receipt('s1', '10', '1000.00')),
        entry('source', 20, receipt('s2', '10', '3000.00')),
        entry('destination', 1, receipt('d1', '10', '1000.00')),
        entry('destination', 25, issue('d2', '12')),
      ],
      transfer: pair(10, '5'),
    });

    expect(replayed.out.totalCost).toBe('-500');
    expect(replayed.in.totalCost).toBe('500');
    expect(replayed.sourcePosition).toEqual({
      valuedQuantity: '15',
      uncostedQuantity: '0',
      totalValue: '3500',
    });
    expect(replayed.destinationPosition).toEqual({
      valuedQuantity: '3',
      uncostedQuantity: '0',
      totalValue: '300',
    });
    expect(
      replayed.destinationValuations.map(
        (movement) => movement.valuation.totalCost,
      ),
    ).toEqual(['1000', '-1200']);

    // The contrast the "backdated" verdict exists for: valuing the pair from
    // the positions as they stand TODAY would move 5 × 200 = 1000, an amount
    // the day-10 source position never held.
    const currentSource = applyMovement(EMPTY_POSITION, {
      movementType: 'inbound',
      baseQuantity: '10',
      knownValue: '1000.00',
    });
    const withSecondReceipt = applyMovement(currentSource.position, {
      movementType: 'inbound',
      baseQuantity: '10',
      knownValue: '3000.00',
    });
    const today = applyTransfer({
      source: withSecondReceipt.position,
      destination: EMPTY_POSITION,
      quantity: '5',
    });
    expect(today.outValuation.totalCost).toBe('-1000');
    expect(replayed.out.totalCost).not.toBe(today.outValuation.totalCost);
  });

  it('keeps the uncosted part uncosted on the destination (OD-TRF-02)', () => {
    // 10 uncosted units + 5 valued units at 100/unit. Moving 12 takes the 10
    // uncosted ones first, then 2 valued ones (200) — so the pair carries 200
    // and the destination receives 2 valued + 10 uncosted.
    const replayed = replayCoupledTransfer({
      entries: [
        entry('source', 1, receipt('s1', '10', null)),
        entry('source', 2, receipt('s2', '5', '500.00')),
        entry('destination', 1, receipt('d1', '1', '100.00')),
      ],
      transfer: pair(10, '12'),
    });

    expect(replayed.out.totalCost).toBe('-200');
    expect(replayed.in.totalCost).toBe('200');
    expect(replayed.sourcePosition).toEqual({
      valuedQuantity: '3',
      uncostedQuantity: '0',
      totalValue: '300',
    });
    expect(replayed.destinationPosition).toEqual({
      valuedQuantity: '3',
      uncostedQuantity: '10',
      totalValue: '300',
    });
  });

  it('leaves BOTH legs unvalued when the source carries no value (OD-TRF-07)', () => {
    const replayed = replayCoupledTransfer({
      entries: [
        entry('source', 1, receipt('s1', '10', null)),
        entry('destination', 1, receipt('d1', '4', '400.00')),
      ],
      transfer: pair(10, '6'),
    });

    expect(replayed.out.status).toBe('unvalued');
    expect(replayed.in.status).toBe('unvalued');
    expect(replayed.out.unvaluedReason).toBe('uncosted_stock');
    expect(replayed.in.unvaluedReason).toBe('uncosted_stock');
    // Quantities still move — the quantity effect is never blocked by value.
    expect(replayed.sourcePosition).toEqual({
      valuedQuantity: '0',
      uncostedQuantity: '4',
      totalValue: '0',
    });
    expect(replayed.destinationPosition).toEqual({
      valuedQuantity: '4',
      uncostedQuantity: '6',
      totalValue: '400',
    });
  });

  it('fails closed on a stored leg of ANOTHER transfer that would consume valued stock', () => {
    // `x9` is an unvalued `transfer_out` leg of a different pair: valuing it
    // on this key alone would strand its value on the other warehouse.
    const orphan: ReplayFact = {
      id: 'x9',
      method: MWA,
      movementType: 'transfer_out',
      baseQuantity: '-5',
      knownValue: null,
    };

    expect(() =>
      replayCoupledTransfer({
        entries: [
          entry('source', 1, receipt('s1', '10', '1000.00')),
          entry('source', 2, orphan),
        ],
        transfer: pair(10, '4'),
      }),
    ).toThrow(UnvaluedTransferReplayError);
  });

  it('replays preserved facts (stored transfer legs, entered costs) without recomputing them', () => {
    // The stored out leg of ANOTHER pair carries its own value: it is a fact,
    // not an average-derived issue.
    const storedLeg: ReplayFact = {
      id: 'x1',
      method: MWA,
      movementType: 'transfer_out',
      baseQuantity: '-2',
      knownValue: '250.00',
      knownValueSource: 'transfer',
    };

    const replayed = replayCoupledTransfer({
      entries: [
        entry('source', 1, receipt('s1', '10', '1000.00')),
        entry('source', 2, storedLeg),
      ],
      transfer: pair(10, '4'),
    });

    // The stored leg is replayed AT ITS OWN VALUE (-250), which leaves the
    // source holding 8 units worth 750 — so the 4-unit pair moves 375, not a
    // number derived from the entered 1000.
    expect(replayed.sourceValuations[1]?.valuation.totalCost).toBe('-250');
    expect(replayed.out.totalCost).toBe('-375');
    expect(replayed.sourcePosition).toEqual({
      valuedQuantity: '4',
      uncostedQuantity: '0',
      totalValue: '375',
    });
  });

  it('is independent of the order its entries are supplied in', () => {
    const entries: CoupledReplayEntry[] = [
      entry('source', 1, receipt('s1', '10', '1000.00')),
      entry('source', 20, receipt('s2', '10', '3000.00')),
      entry('destination', 1, receipt('d1', '10', '1000.00')),
      entry('destination', 25, issue('d2', '12')),
    ];

    const ordered = replayCoupledTransfer({ entries, transfer: pair(10, '5') });
    const shuffled = replayCoupledTransfer({
      entries: [...entries].reverse(),
      transfer: pair(10, '5'),
    });

    expect(shuffled.sourcePosition).toEqual(ordered.sourcePosition);
    expect(shuffled.destinationPosition).toEqual(ordered.destinationPosition);
    expect(shuffled.out).toEqual(ordered.out);
    expect(shuffled.in).toEqual(ordered.in);
  });

  it('refuses a replayed period whose configured method this build cannot execute', () => {
    const fifoFact: ReplayFact = {
      ...receipt('s1', '10', '1000.00'),
      method: 'fifo',
    };

    expect(() =>
      replayCoupledTransfer({
        entries: [entry('source', 1, fifoFact)],
        transfer: pair(10, '4'),
      }),
    ).toThrow(UnsupportedValuationMethodError);
  });
});

describe('compareCanonicalMovementOrder', () => {
  it('orders by business date, then creation instant, then id', () => {
    const base = { movementDate: businessDay(1), createdAt: at(1), id: 'b' };
    const later = { movementDate: businessDay(2), createdAt: at(1), id: 'a' };
    const sameDateLaterInstant = {
      movementDate: businessDay(1),
      createdAt: at(2),
      id: 'a',
    };
    const sameInstant = {
      movementDate: businessDay(1),
      createdAt: at(1),
      id: 'a',
    };

    expect(compareCanonicalMovementOrder(base, later)).toBeLessThan(0);
    expect(
      compareCanonicalMovementOrder(base, sameDateLaterInstant),
    ).toBeLessThan(0);
    expect(compareCanonicalMovementOrder(base, sameInstant)).toBeGreaterThan(0);
    expect(compareCanonicalMovementOrder(base, base)).toBe(0);
  });
});

describe('the driver is a fold, not a second implementation', () => {
  it('leaves a position untouched when the pair moves zero-valued stock', () => {
    const start: ValuationPosition = {
      valuedQuantity: '3',
      uncostedQuantity: '2',
      totalValue: '300',
    };
    const replayed = replayCoupledTransfer({
      entries: [
        entry('source', 1, receipt('s1', '3', '300.00')),
        entry('source', 2, receipt('s2', '2', null)),
      ],
      transfer: pair(10, '0'),
    });

    expect(replayed.sourcePosition).toEqual(start);
    expect(replayed.out.status).toBe('unvalued');
    expect(replayed.in.status).toBe('unvalued');
  });
});

describe("the coupled driver applies a stored fact's forceUnvalued flag (OD-RET-02/04)", () => {
  it('keeps a stored unvalued purchase return unvalued on its own key, and keeps THAT key stale', () => {
    // A purchase return is not a transfer fact, but this driver replays BOTH
    // keys' whole histories — so a stored one must get the same answer the
    // single-key driver gives, through the same shared dispatch
    // (`toStrategyInput`).
    const forcedReturn: ReplayFact = {
      id: 'pr-1',
      method: MWA,
      movementType: 'purchase_return',
      baseQuantity: '-4',
      knownValue: null,
      knownValueSource: 'return_basis',
      forceUnvalued: true,
    };

    const replayed = replayCoupledTransfer({
      entries: [
        entry('source', 1, receipt('s1', '10', null)),
        entry('source', 2, issue('s2', '10')),
        entry('source', 3, receipt('s3', '5', '500.00')),
        entry('source', 4, forcedReturn),
        entry('destination', 1, receipt('d1', '4', '400.00')),
      ],
      transfer: pair(10, '1'),
    });

    // The exit carries no value and no derived one — 4 × 100 is never
    // invented for it.
    expect(replayed.sourceValuations[3]?.valuation).toEqual({
      status: 'unvalued',
      totalCost: null,
      source: 'return_basis',
      unvaluedReason: 'no_cost_supplied',
    });
    // The source key stays honestly inconsistent; the destination key, whose
    // own facts are all preserve-or-average, does not.
    expect(replayed.provisional).toEqual({
      source: true,
      destination: false,
    });
    // The pair still moves its value out of whatever the source holds.
    expect(replayed.out.status).toBe('valued');
    expect(replayed.in.totalCost).toBe('100');
  });
});
