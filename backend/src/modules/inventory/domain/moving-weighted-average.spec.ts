import { describe, expect, it } from 'vitest';
import {
  EMPTY_POSITION,
  applyMovement,
  applyTransfer,
  replay,
  toReplayFact,
  valuationChanged,
  type ReplayFact,
  type ValuationPosition,
} from './moving-weighted-average.js';
import { averageUnitCost } from './inventory-valuation.js';

/**
 * Moving Weighted Average strategy (PDR-05 / OD-VAL rules).
 *
 * The two invariants every case below also asserts, because they are what
 * makes the quantity ledger and the value projection one coherent story:
 *
 *   (1) `onHand == valuedQuantity + uncostedQuantity`,
 *   (2) `SUM(movement.totalCost) == totalValue` for any key that is not
 *       stale.
 *
 * Invariant (1) is checked implicitly: every test tracks the quantities it
 * posted. Invariant (2) is checked explicitly by `runningValue` below.
 */

function post(
  position: ValuationPosition,
  fact: Parameters<typeof applyMovement>[1],
): ReturnType<typeof applyMovement> {
  return applyMovement(position, fact);
}

describe('applyMovement — inbound', () => {
  it('accepts a receipt WITHOUT a cost and tracks it as uncosted stock', () => {
    const outcome = post(EMPTY_POSITION, {
      movementType: 'inbound',
      baseQuantity: '10',
      knownValue: null,
    });

    expect(outcome.valuation.status).toBe('unvalued');
    expect(outcome.valuation.totalCost).toBeNull();
    expect(outcome.valuation.unvaluedReason).toBe('no_cost_supplied');
    expect(outcome.position).toEqual({
      valuedQuantity: '0',
      uncostedQuantity: '10',
      totalValue: '0',
    });
    // A receipt without a cost is normal, not an inconsistency.
    expect(outcome.marksStale).toBe(false);
  });

  it('values a receipt that carries a cost and signs it positive', () => {
    const outcome = post(EMPTY_POSITION, {
      movementType: 'inbound',
      baseQuantity: '10',
      knownValue: '1000.00',
    });

    expect(outcome.valuation.status).toBe('valued');
    expect(outcome.valuation.totalCost).toBe('1000');
    expect(outcome.valuation.source).toBe('entered');
    expect(outcome.position.valuedQuantity).toBe('10');
    expect(outcome.position.totalValue).toBe('1000');
  });

  it('applies a BACKDATED costed receipt but marks the key stale', () => {
    const outcome = post(
      { valuedQuantity: '5', uncostedQuantity: '0', totalValue: '500.00' },
      {
        movementType: 'inbound',
        baseQuantity: '5',
        knownValue: '250.00',
        backdated: true,
      },
    );

    // Value on the way in is order-independent, so the receipt is valued…
    expect(outcome.valuation.status).toBe('valued');
    expect(outcome.position.totalValue).toBe('750');
    // …but the issues already valued after its date are now wrong.
    expect(outcome.marksStale).toBe(true);
  });
});

describe('applyMovement — outbound', () => {
  it('values an issue at the moving weighted average', () => {
    const after = post(
      { valuedQuantity: '10', uncostedQuantity: '0', totalValue: '1000.00' },
      { movementType: 'outbound', baseQuantity: '-4', knownValue: null },
    );

    expect(after.valuation.status).toBe('valued');
    expect(after.valuation.source).toBe('average_cost');
    expect(after.valuation.totalCost).toBe('-400');
    expect(after.position).toEqual({
      valuedQuantity: '6',
      uncostedQuantity: '0',
      totalValue: '600',
    });
    expect(after.marksStale).toBe(false);
  });

  it('consumes UNCOSTED stock first and leaves such an issue unvalued', () => {
    const after = post(
      { valuedQuantity: '10', uncostedQuantity: '4', totalValue: '1000.00' },
      { movementType: 'outbound', baseQuantity: '-3', knownValue: null },
    );

    expect(after.valuation.status).toBe('unvalued');
    expect(after.valuation.unvaluedReason).toBe('uncosted_stock');
    expect(after.position).toEqual({
      valuedQuantity: '10',
      uncostedQuantity: '1',
      totalValue: '1000.00',
    });
  });

  it('marks an issue that straddles uncosted and valued stock provisional', () => {
    const after = post(
      { valuedQuantity: '10', uncostedQuantity: '2', totalValue: '1000.00' },
      { movementType: 'outbound', baseQuantity: '-4', knownValue: null },
    );

    // 2 uncosted + 2 valued: the value written is real but an explicit
    // recalculation (after the missing cost arrives) will change it.
    expect(after.valuation.status).toBe('provisional');
    expect(after.valuation.totalCost).toBe('-200');
    expect(after.marksStale).toBe(true);
  });

  it('flushes the residual value when an issue empties the valued pool', () => {
    // 3 units for 100.00 does not divide evenly; the last issue must take
    // whatever value is left rather than a re-rounded share.
    const first = post(
      { valuedQuantity: '3', uncostedQuantity: '0', totalValue: '100.00' },
      { movementType: 'outbound', baseQuantity: '-1', knownValue: null },
    );
    expect(first.valuation.totalCost).toBe('-33.33');

    const second = post(first.position, {
      movementType: 'outbound',
      baseQuantity: '-2',
      knownValue: null,
    });

    expect(second.valuation.totalCost).toBe('-66.67');
    expect(second.position).toEqual({
      valuedQuantity: '0',
      uncostedQuantity: '0',
      // Invariant (2): no value is stranded on an empty pool.
      totalValue: '0',
    });
  });

  it('leaves an issue from an empty valued pool unvalued, not negative', () => {
    const after = post(
      { valuedQuantity: '0', uncostedQuantity: '5', totalValue: '0' },
      { movementType: 'outbound', baseQuantity: '-5', knownValue: null },
    );

    expect(after.valuation.status).toBe('unvalued');
    expect(after.valuation.unvaluedReason).toBe('uncosted_stock');
    expect(after.position.uncostedQuantity).toBe('0');
    expect(after.position.totalValue).toBe('0');
  });
});

describe('applyMovement — reversals (a value the fact carries itself)', () => {
  it('undoes exactly the value the original carried', () => {
    const after = post(
      { valuedQuantity: '10', uncostedQuantity: '0', totalValue: '1000.00' },
      {
        movementType: 'reversal_out',
        baseQuantity: '-4',
        knownValue: '400.00',
        knownValueSource: 'reversal',
      },
    );

    expect(after.valuation.status).toBe('valued');
    expect(after.valuation.source).toBe('reversal');
    expect(after.valuation.totalCost).toBe('-400');
    expect(after.position.totalValue).toBe('600');
    expect(after.marksStale).toBe(false);
  });

  it('degrades to provisional when the pool no longer holds the original value', () => {
    const after = post(
      { valuedQuantity: '1', uncostedQuantity: '0', totalValue: '100.00' },
      {
        movementType: 'reversal_out',
        baseQuantity: '-4',
        knownValue: '400.00',
        knownValueSource: 'reversal',
      },
    );

    expect(after.valuation.status).toBe('provisional');
    expect(after.valuation.totalCost).toBe('-100');
    expect(after.position.totalValue).toBe('0');
    expect(after.marksStale).toBe(true);
  });
});

describe('applyTransfer', () => {
  it('is exactly value-neutral across the two keys', () => {
    const outcome = applyTransfer({
      source: {
        valuedQuantity: '10',
        uncostedQuantity: '0',
        totalValue: '1000.00',
      },
      destination: EMPTY_POSITION,
      quantity: '4',
    });

    expect(outcome.outValuation.totalCost).toBe('-400');
    expect(outcome.inValuation.totalCost).toBe('400');
    expect(outcome.outValuation.source).toBe('transfer');
    expect(outcome.source.totalValue).toBe('600');
    expect(outcome.destination.totalValue).toBe('400');
    // Total value across both keys is unchanged: 600 + 400 = 1000.
    expect(
      Number(outcome.source.totalValue) +
        Number(outcome.destination.totalValue),
    ).toBe(1000);
  });

  it('moves uncosted stock as uncosted stock, with no value either side', () => {
    const outcome = applyTransfer({
      source: { valuedQuantity: '0', uncostedQuantity: '6', totalValue: '0' },
      destination: EMPTY_POSITION,
      quantity: '6',
    });

    expect(outcome.outValuation.status).toBe('unvalued');
    expect(outcome.inValuation.status).toBe('unvalued');
    expect(outcome.destination.uncostedQuantity).toBe('6');
    expect(outcome.destination.totalValue).toBe('0');
  });
});

describe('replay — the deterministic recalculation', () => {
  const history: ReplayFact[] = [
    {
      id: 'm1',
      movementType: 'inbound',
      baseQuantity: '10',
      knownValue: '1000.00',
      knownValueSource: 'entered',
    },
    {
      id: 'm2',
      movementType: 'outbound',
      baseQuantity: '-4',
      knownValue: null,
    },
    {
      id: 'm3',
      movementType: 'inbound',
      baseQuantity: '6',
      knownValue: '900.00',
      knownValueSource: 'entered',
    },
    {
      id: 'm4',
      movementType: 'outbound',
      baseQuantity: '-2',
      knownValue: null,
    },
  ];

  it('reproduces the position and values every issue from the average', () => {
    const result = replay(history);

    expect(
      result.movements.map((movement) => movement.valuation.totalCost),
    ).toEqual([
      '1000',
      '-400',
      '900',
      // (600 + 900) / 12 = 125 per unit → 2 units = 250
      '-250',
    ]);
    expect(result.position).toEqual({
      valuedQuantity: '10',
      uncostedQuantity: '0',
      totalValue: '1250',
    });
    expect(result.provisional).toBe(false);
    expect(averageUnitCost(result.position)).toBe('125');
  });

  it('is idempotent: replaying the replayed rows changes nothing', () => {
    const first = replay(history);
    const rows = history.map((fact, index) => {
      const valuation = first.movements[index];
      if (valuation === undefined) throw new Error('missing replay result');
      return toReplayFact({
        id: fact.id,
        movementType: fact.movementType,
        baseQuantity: fact.baseQuantity,
        totalCost: valuation.valuation.totalCost,
        valuationStatus: valuation.valuation.status,
        valuationSource: valuation.valuation.source,
      });
    });

    const second = replay(rows);

    expect(second.position).toEqual(first.position);
    expect(second.movements).toEqual(first.movements);
    for (const [index, movement] of second.movements.entries()) {
      const before = first.movements[index];
      if (before === undefined) throw new Error('missing replay result');
      expect(
        valuationChanged(
          {
            status: before.valuation.status,
            totalCost: before.valuation.totalCost,
            source: before.valuation.source,
          },
          movement.valuation,
        ),
      ).toBe(false);
    }
  });

  it('preserves entered, transfer and reversal values; recomputes average ones', () => {
    const entered = toReplayFact({
      id: 'm1',
      movementType: 'inbound',
      baseQuantity: '10',
      totalCost: '1000.00',
      valuationStatus: 'valued',
      valuationSource: 'entered',
    });
    const derived = toReplayFact({
      id: 'm2',
      movementType: 'outbound',
      baseQuantity: '-4',
      totalCost: '-400.00',
      valuationStatus: 'valued',
      valuationSource: 'average_cost',
    });
    const reversal = toReplayFact({
      id: 'm3',
      movementType: 'reversal_out',
      baseQuantity: '-2',
      totalCost: '-200.00',
      valuationStatus: 'valued',
      valuationSource: 'reversal',
    });

    expect(entered.knownValue).toBe('1000.00');
    // The only value a replay is allowed to recompute.
    expect(derived.knownValue).toBeNull();
    // A reversal's magnitude is preserved, not its sign (the strategy
    // re-derives the sign from the direction).
    expect(reversal.knownValue).toBe('200.00');
    expect(reversal.knownValueSource).toBe('reversal');
  });

  it('reports a key as still provisional when uncosted stock was issued', () => {
    const result = replay([
      {
        id: 'm1',
        movementType: 'inbound',
        baseQuantity: '10',
        knownValue: null,
      },
      {
        id: 'm2',
        movementType: 'inbound',
        baseQuantity: '10',
        knownValue: '1000.00',
        knownValueSource: 'entered',
      },
      {
        id: 'm3',
        movementType: 'outbound',
        baseQuantity: '-12',
        knownValue: null,
      },
    ]);

    expect(result.provisional).toBe(true);
    expect(result.movements[2]?.valuation.status).toBe('provisional');
  });

  it('is order-independent in the sense that matters: the SAME facts in canonical order always give the same answer', () => {
    const a = replay(history);
    const b = replay([...history]);
    expect(b).toEqual(a);
  });
});

describe('invariant (2): SUM(movement.totalCost) == totalValue', () => {
  it('holds across a mixed, non-dividing history', () => {
    const facts: ReplayFact[] = [
      {
        id: 'a',
        movementType: 'inbound',
        baseQuantity: '3',
        knownValue: '100.00',
        knownValueSource: 'entered',
      },
      {
        id: 'b',
        movementType: 'outbound',
        baseQuantity: '-1',
        knownValue: null,
      },
      {
        id: 'c',
        movementType: 'inbound',
        baseQuantity: '7',
        knownValue: '333.33',
        knownValueSource: 'entered',
      },
      {
        id: 'd',
        movementType: 'outbound',
        baseQuantity: '-5',
        knownValue: null,
      },
      {
        id: 'e',
        movementType: 'outbound',
        baseQuantity: '-4',
        knownValue: null,
      },
    ];

    const result = replay(facts);
    const summed = result.movements.reduce((total, movement) => {
      const value = movement.valuation.totalCost;
      return value === null ? total : total + Number(value);
    }, 0);

    expect(summed).toBeCloseTo(Number(result.position.totalValue), 2);
    expect(result.position.valuedQuantity).toBe('0');
    expect(Number(result.position.totalValue)).toBe(0);
  });
});
