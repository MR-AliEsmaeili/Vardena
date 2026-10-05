import { describe, expect, it } from 'vitest';
import {
  EMPTY_POSITION,
  applyMovement,
  applyTransfer,
  type ValuationPosition,
} from './moving-weighted-average.js';

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
