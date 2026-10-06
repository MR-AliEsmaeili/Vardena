import { describe, expect, it } from 'vitest';
import {
  foldPreservedPosition,
  toCompensationFacts,
  type CompensationSnapshotRow,
} from './valuation-compensation.js';
import type { MovementType } from './movement-type.js';

/**
 * The compensation fold behind Reverse Pricing (C-59E+, OD-RVP-04…06) and —
 * since the correction sprint — the snapshot-to-facts bridge
 * (`toCompensationFacts`) that makes the repository's fold input honest.
 *
 * The scenarios are small and fully numeric on purpose: every expected
 * position below is hand-computed from the documented per-fact rules, so a
 * regression in either the fold or the bridge is a wrong number, never a
 * tautology.
 */

function snapshot(
  movementType: MovementType,
  baseQuantity: string,
  totalCost: string | null,
  valuationSource: CompensationSnapshotRow['valuationSource'],
  valuationRunId: string | null,
): CompensationSnapshotRow {
  return {
    movementType,
    baseQuantity,
    totalCost,
    valuationSource,
    valuationRunId,
  };
}

describe('toCompensationFacts (the reverse fold input)', () => {
  it('passes survivor rows through verbatim', () => {
    const facts = toCompensationFacts(
      [
        snapshot('inbound', '100', '1000.00', 'entered', null),
        snapshot('outbound', '-40', '-400.00', 'average_cost', 'other-run'),
      ],
      'reversed-run',
    );
    expect(facts).toEqual([
      {
        movementType: 'inbound',
        baseQuantity: '100',
        totalCost: '1000.00',
        valuationSource: 'entered',
      },
      {
        movementType: 'outbound',
        baseQuantity: '-40',
        totalCost: '-400.00',
        valuationSource: 'average_cost',
      },
    ]);
  });

  it('treats the rows the reversed run valued as the unvalued facts they become', () => {
    const facts = toCompensationFacts(
      [
        // Valued by the run being reversed — the database update in flight
        // is erasing exactly this value; the fold must see null.
        snapshot('outbound', '-40', '-400.00', 'average_cost', 'reversed-run'),
        // A row an OLDER compensating run left unvalued: null already.
        snapshot('outbound', '-5', null, null, 'old-compensation'),
      ],
      'reversed-run',
    );
    expect(facts).toEqual([
      {
        movementType: 'outbound',
        baseQuantity: '-40',
        totalCost: null,
        valuationSource: null,
      },
      {
        movementType: 'outbound',
        baseQuantity: '-5',
        totalCost: null,
        valuationSource: null,
      },
    ]);
  });

  it('never confuses the compensating run id with the reversed run id (the stale-snapshot regression)', () => {
    // The defect this pins: the repository reads the key's rows BEFORE the
    // un-valuing update, so every reversed row still carries the ORIGINAL
    // run id in the snapshot. A bridge keyed on the COMPENSATING run id
    // would match nothing and fold the erased values back in.
    const rows = [
      snapshot('outbound', '-40', '-400.00', 'average_cost', 'reversed-run'),
    ];
    const keyedOnCompensating = toCompensationFacts(rows, 'compensating-run');
    expect(keyedOnCompensating[0]!.totalCost).toBe('-400.00');
    const keyedOnOriginal = toCompensationFacts(rows, 'reversed-run');
    expect(keyedOnOriginal[0]!.totalCost).toBe(null);
    expect(keyedOnOriginal[0]!.valuationSource).toBe(null);
  });
});

describe('foldPreservedPosition', () => {
  it('folds valued facts through the strategy arithmetic', () => {
    const position = foldPreservedPosition([
      {
        movementType: 'inbound',
        baseQuantity: '100',
        totalCost: '1000.00',
        valuationSource: 'entered',
      },
      {
        movementType: 'outbound',
        baseQuantity: '-40',
        totalCost: '-400.00',
        valuationSource: 'average_cost',
      },
    ]);
    expect(position).toEqual({
      valuedQuantity: '60',
      uncostedQuantity: '0',
      totalValue: '600',
    });
  });

  it('quarantines an unvalued inbound as uncosted stock', () => {
    const position = foldPreservedPosition([
      {
        movementType: 'inbound',
        baseQuantity: '50',
        totalCost: null,
        valuationSource: null,
      },
    ]);
    expect(position).toEqual({
      valuedQuantity: '0',
      uncostedQuantity: '50',
      totalValue: '0',
    });
  });

  it('consumes uncosted stock first, then valued stock with the value parked', () => {
    const position = foldPreservedPosition([
      {
        movementType: 'inbound',
        baseQuantity: '100',
        totalCost: '1000.00',
        valuationSource: 'entered',
      },
      {
        movementType: 'inbound',
        baseQuantity: '50',
        totalCost: null,
        valuationSource: null,
      },
      {
        movementType: 'outbound',
        baseQuantity: '-60',
        totalCost: null,
        valuationSource: null,
      },
    ]);
    // 50 of the 60 leave the uncosted quarantine; the remaining 10 leave the
    // valued pool WITHOUT value attribution — the value stays parked until
    // the next pricing run (the documented honest imperfection).
    expect(position.valuedQuantity).toBe('90');
    expect(position.uncostedQuantity).toBe('0');
    expect(position.totalValue).toBe('1000');
  });

  it('keeps the position quantity-consistent for a fact stream that empties the pool', () => {
    const position = foldPreservedPosition([
      {
        movementType: 'inbound',
        baseQuantity: '10',
        totalCost: '100.00',
        valuationSource: 'entered',
      },
      {
        movementType: 'outbound',
        baseQuantity: '-10',
        totalCost: null,
        valuationSource: null,
      },
    ]);
    // The pool emptied by an unvalued outbound: quantity zero, value parked.
    expect(position.valuedQuantity).toBe('0');
    expect(position.uncostedQuantity).toBe('0');
    expect(position.totalValue).toBe('100');
  });

  it('produces the PRE-run fold for the reverse scenario, not the post-run position (the axis-1 regression)', () => {
    // One committed, preserved receipt; two issues the run being reversed
    // re-derived. The correct post-reverse position folds the issues as
    // unvalued outbounds: 50 units left, the pool's whole value parked
    // (nothing attributed), key stale. The stale-snapshot defect produced
    // the post-run position instead (valued 50, value 500.00) — as if the
    // reverse had never happened.
    const rows: CompensationSnapshotRow[] = [
      snapshot('inbound', '100', '1000.00', 'entered', null),
      snapshot('outbound', '-40', '-400.00', 'average_cost', 'run-r'),
      snapshot('outbound', '-10', '-100.00', 'average_cost', 'run-r'),
    ];
    const position = foldPreservedPosition(toCompensationFacts(rows, 'run-r'));
    expect(position.valuedQuantity).toBe('50');
    expect(position.uncostedQuantity).toBe('0');
    expect(position.totalValue).toBe('1000');
  });

  it('keeps on_hand == valuedQuantity + uncostedQuantity across a mixed fact stream', () => {
    const position = foldPreservedPosition([
      {
        movementType: 'inbound',
        baseQuantity: '30',
        totalCost: '900.00',
        valuationSource: 'entered',
      },
      {
        movementType: 'inbound',
        baseQuantity: '7.5',
        totalCost: null,
        valuationSource: null,
      },
      {
        movementType: 'sales_return',
        baseQuantity: '2.5',
        totalCost: null,
        valuationSource: null,
      },
      {
        movementType: 'outbound',
        baseQuantity: '-12.25',
        totalCost: null,
        valuationSource: null,
      },
      {
        movementType: 'purchase_return',
        baseQuantity: '-3',
        totalCost: null,
        valuationSource: null,
      },
    ]);
    // 30 + 7.5 + 2.5 in, 12.25 + 3 out → 24.75 on hand, however it splits.
    const onHand = 30 + 7.5 + 2.5 - 12.25 - 3;
    const split =
      Number(position.valuedQuantity) + Number(position.uncostedQuantity);
    expect(split).toBeCloseTo(onHand, 6);
  });
});
