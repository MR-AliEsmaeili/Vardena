import { describe, expect, it } from 'vitest';
import {
  replay,
  toReplayFact,
  valuationChanged,
  valuationStrategyFor,
  UnsupportedValuationMethodError,
  type ReplayFact,
} from './valuation-replay.js';
import { applyMovement } from './moving-weighted-average.js';
import {
  VALUATION_METHODS,
  resolveValuationMethodAt,
  type ItemValuationMethodVersion,
} from './valuation-method.js';
import { averageUnitCost } from './inventory-valuation.js';

/**
 * The replay driver: ORDER and DISPATCH, not arithmetic.
 *
 * The arithmetic cases live in `moving-weighted-average.spec.ts`. What this
 * file proves is the part the Owner review called out: a recalculation
 * resolves the valuation method PER MOVEMENT at that movement's own business
 * date (OD-VAL-14), so a period is never silently restated under a method
 * that only became effective later.
 */

const MWA = 'moving_weighted_average' as const;

describe('replay — the deterministic recalculation', () => {
  const history: ReplayFact[] = [
    {
      id: 'm1',
      method: MWA,
      movementType: 'inbound',
      baseQuantity: '10',
      knownValue: '1000.00',
      knownValueSource: 'entered',
    },
    {
      id: 'm2',
      method: MWA,
      movementType: 'outbound',
      baseQuantity: '-4',
      knownValue: null,
    },
    {
      id: 'm3',
      method: MWA,
      movementType: 'inbound',
      baseQuantity: '6',
      knownValue: '900.00',
      knownValueSource: 'entered',
    },
    {
      id: 'm4',
      method: MWA,
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
      return toReplayFact(
        {
          id: fact.id,
          movementType: fact.movementType,
          baseQuantity: fact.baseQuantity,
          totalCost: valuation.valuation.totalCost,
          valuationStatus: valuation.valuation.status,
          valuationSource: valuation.valuation.source,
        },
        fact.method,
      );
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
    const entered = toReplayFact(
      {
        id: 'm1',
        movementType: 'inbound',
        baseQuantity: '10',
        totalCost: '1000.00',
        valuationStatus: 'valued',
        valuationSource: 'entered',
      },
      MWA,
    );
    const derived = toReplayFact(
      {
        id: 'm2',
        movementType: 'outbound',
        baseQuantity: '-4',
        totalCost: '-400.00',
        valuationStatus: 'valued',
        valuationSource: 'average_cost',
      },
      MWA,
    );
    const reversal = toReplayFact(
      {
        id: 'm3',
        movementType: 'reversal_out',
        baseQuantity: '-2',
        totalCost: '-200.00',
        valuationStatus: 'valued',
        valuationSource: 'reversal',
      },
      MWA,
    );

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
        method: MWA,
        movementType: 'inbound',
        baseQuantity: '10',
        knownValue: null,
      },
      {
        id: 'm2',
        method: MWA,
        movementType: 'inbound',
        baseQuantity: '10',
        knownValue: '1000.00',
        knownValueSource: 'entered',
      },
      {
        id: 'm3',
        method: MWA,
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
        method: MWA,
        movementType: 'inbound',
        baseQuantity: '3',
        knownValue: '100.00',
        knownValueSource: 'entered',
      },
      {
        id: 'b',
        method: MWA,
        movementType: 'outbound',
        baseQuantity: '-1',
        knownValue: null,
      },
      {
        id: 'c',
        method: MWA,
        movementType: 'inbound',
        baseQuantity: '7',
        knownValue: '333.33',
        knownValueSource: 'entered',
      },
      {
        id: 'd',
        method: MWA,
        movementType: 'outbound',
        baseQuantity: '-5',
        knownValue: null,
      },
      {
        id: 'e',
        method: MWA,
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

describe('method dispatch — one lookup per fact, not one per run', () => {
  it('asks for the strategy of each fact, so a non-MVP method in the MIDDLE of history fails closed', () => {
    const facts: ReplayFact[] = [
      {
        id: 'm1',
        method: MWA,
        movementType: 'inbound',
        baseQuantity: '10',
        knownValue: '1000.00',
        knownValueSource: 'entered',
      },
      {
        id: 'm2',
        method: 'fifo',
        movementType: 'outbound',
        baseQuantity: '-4',
        knownValue: null,
      },
    ];

    // Not "the run used today's method and carried on": the fact that needs
    // FIFO is named, so the operator learns WHICH movement and WHICH
    // configured method the system cannot execute.
    expect(() => replay(facts)).toThrowError(UnsupportedValuationMethodError);
    try {
      replay(facts);
      expect.unreachable('replay must refuse a method it cannot execute');
    } catch (error) {
      expect(error).toBeInstanceOf(UnsupportedValuationMethodError);
      const failure = error as UnsupportedValuationMethodError;
      expect(failure.method).toBe('fifo');
      expect(failure.movementId).toBe('m2');
    }
  });

  it('returns the Moving Weighted Average strategy for the one active method', () => {
    expect(valuationStrategyFor(MWA)).toBe(applyMovement);
  });

  it('refuses every method the MVP does not implement', () => {
    for (const method of VALUATION_METHODS.filter((method) => method !== MWA)) {
      expect(() => valuationStrategyFor(method)).toThrowError(
        UnsupportedValuationMethodError,
      );
    }
  });

  it('does not let a later unsupported configuration poison earlier valid history', () => {
    // The first two facts are MWA and are applied; only the third stops the
    // run. The guarantee is that the engine never reaches for a strategy it
    // does not have, in either direction.
    const applied: string[] = [];
    const facts: ReplayFact[] = [
      {
        id: 'a',
        method: MWA,
        movementType: 'inbound',
        baseQuantity: '5',
        knownValue: '500.00',
        knownValueSource: 'entered',
      },
      {
        id: 'b',
        method: MWA,
        movementType: 'outbound',
        baseQuantity: '-1',
        knownValue: null,
      },
    ];
    const ok = replay(facts);
    for (const movement of ok.movements) applied.push(movement.id);
    expect(applied).toEqual(['a', 'b']);

    expect(() =>
      replay([
        ...facts,
        {
          id: 'c',
          method: 'lifo',
          movementType: 'outbound',
          baseQuantity: '-1',
          knownValue: null,
        },
      ]),
    ).toThrowError(/lifo/);
  });
});

describe('effective-dated resolution — the 1404/1405 case', () => {
  const versions: ItemValuationMethodVersion[] = [
    {
      id: 'v1',
      organizationId: 'org-1',
      itemId: 'item-1',
      method: MWA,
      validFrom: new Date('2025-03-21T00:00:00.000Z'),
      validTo: new Date('2026-03-21T00:00:00.000Z'),
      note: null,
      createdAt: new Date('2025-03-21T00:00:00.000Z'),
      updatedAt: new Date('2025-03-21T00:00:00.000Z'),
    },
    {
      id: 'v2',
      organizationId: 'org-1',
      itemId: 'item-1',
      method: 'fifo',
      validFrom: new Date('2026-03-21T00:00:00.000Z'),
      validTo: null,
      note: null,
      createdAt: new Date('2026-03-21T00:00:00.000Z'),
      updatedAt: new Date('2026-03-21T00:00:00.000Z'),
    },
  ];

  /** What the repository does per row, in one line. */
  const factFor = (id: string, movementDate: string): ReplayFact =>
    toReplayFact(
      {
        id,
        movementType: 'inbound',
        baseQuantity: '1',
        totalCost: '10.00',
        valuationStatus: 'valued',
        valuationSource: 'entered',
      },
      resolveValuationMethodAt(versions, new Date(movementDate)).method,
    );

  it('builds each fact with the method in force at that movement date', () => {
    const facts = [
      factFor('old', '2025-06-01T00:00:00.000Z'),
      factFor('older', '2026-03-20T23:59:59.000Z'),
      factFor('new', '2026-06-01T00:00:00.000Z'),
    ];

    expect(facts.map((fact) => fact.method)).toEqual([MWA, MWA, 'fifo']);
  });

  it('replays the previous period under the method that was in force THEN, even though a newer version exists', () => {
    const result = replay([
      factFor('old-1', '2025-06-01T00:00:00.000Z'),
      factFor('old-2', '2026-01-01T00:00:00.000Z'),
    ]);

    expect(result.movements.map((movement) => movement.id)).toEqual([
      'old-1',
      'old-2',
    ]);
    expect(result.position.totalValue).toBe('20');
  });

  it('refuses to revalue a period whose configured method is not implemented', () => {
    expect(() =>
      replay([
        factFor('old-1', '2025-06-01T00:00:00.000Z'),
        factFor('new-1', '2026-06-01T00:00:00.000Z'),
      ]),
    ).toThrowError(UnsupportedValuationMethodError);
  });

  it('falls back to the default method for dates before any configured version', () => {
    expect(factFor('ancient', '2024-01-01T00:00:00.000Z').method).toBe(MWA);
  });
});

describe('forceUnvalued — the basis-linked unvalued purchase return survives a replay', () => {
  /**
   * The exact shape the posting path writes for a purchase return based on an
   * UNVALUED receipt (OD-RET-02/04): the exit carries no value and
   * `return_basis` is recorded as WHY. A recalculation rebuilds that fact
   * from the stored row (`toReplayFact`) and must re-apply it — never derive
   * a value from the current average.
   *
   * The issue consumed the uncosted units the basis receipt contributed, so
   * the return's quantity comes out of the VALUED pool without attributing
   * value: the key is honestly inconsistent (the same verdict the posting
   * path records) and every quantity still moves.
   */
  const basisReceipt: ReplayFact = {
    id: 'basis-receipt',
    method: MWA,
    movementType: 'inbound',
    baseQuantity: '10',
    knownValue: null,
  };
  const issue: ReplayFact = {
    id: 'issue',
    method: MWA,
    movementType: 'outbound',
    baseQuantity: '-10',
    knownValue: null,
  };
  const costedReceipt: ReplayFact = {
    id: 'costed-receipt',
    method: MWA,
    movementType: 'inbound',
    baseQuantity: '5',
    knownValue: '500.00',
    knownValueSource: 'entered',
  };
  const forcedExit: ReplayFact = {
    id: 'purchase-return',
    method: MWA,
    movementType: 'purchase_return',
    baseQuantity: '-4',
    knownValue: null,
    knownValueSource: 'return_basis',
    forceUnvalued: true,
  };
  const history: ReplayFact[] = [
    basisReceipt,
    issue,
    costedReceipt,
    forcedExit,
  ];

  it('keeps the exit unvalued — the average never supplies the value the posting path refused to invent', () => {
    const result = replay(history);

    // Before the fix the shared fact→strategy dispatch dropped the flag, so
    // the recalculation re-derived this row from the average (4 × 100) and
    // rewrote it as a `valued`/`average_cost` exit.
    expect(result.movements[3]?.valuation).toEqual({
      status: 'unvalued',
      totalCost: null,
      source: 'return_basis',
      unvaluedReason: 'no_cost_supplied',
    });
    // No rows before it changed value either.
    expect(
      result.movements.map((movement) => movement.valuation.totalCost),
    ).toEqual([null, null, '500', null]);
  });

  it('moves the same quantities in the same order as the posting path', () => {
    const result = replay(history);

    // 10 − 10 + 5 − 4 = 1 on hand: the exit consumes like any other outbound
    // (uncosted stock first, then the valued pool); only its VALUE is
    // withheld.
    expect(result.position).toEqual({
      valuedQuantity: '1',
      uncostedQuantity: '0',
      totalValue: '100',
    });
    // Canonical ledger order is preserved — the driver never reorders facts.
    expect(result.movements.map((movement) => movement.id)).toEqual([
      'basis-receipt',
      'issue',
      'costed-receipt',
      'purchase-return',
    ]);
  });

  it('keeps the key stale: an unvalued exit that consumed valued stock is not a consistent key', () => {
    // The strategy's own `marksStale` — the identical verdict the posting
    // path records — must reach the replay result, or the recalculation
    // would report the key consistent and clear its stale flag.
    expect(replay(history).provisional).toBe(true);
  });

  it('leaves the key consistent when nothing left the valued pool', () => {
    // Same facts, but the return happens while the basis receipt's uncosted
    // units are still there: no value is stranded, so no stale flag.
    const clean = replay([
      basisReceipt,
      { ...forcedExit, id: 'purchase-return-full', baseQuantity: '-10' },
    ]);

    expect(clean.movements[1]?.valuation.status).toBe('unvalued');
    expect(clean.provisional).toBe(false);
  });

  it('values the same history from the average when the flag is absent — normal behaviour is unchanged', () => {
    const unflagged: ReplayFact = {
      id: forcedExit.id,
      method: forcedExit.method,
      movementType: forcedExit.movementType,
      baseQuantity: forcedExit.baseQuantity,
      knownValue: forcedExit.knownValue,
      knownValueSource: forcedExit.knownValueSource,
    };

    // Omitted (a basis-less return under OD-RET-03) and explicit `false`
    // are the same thing: only `=== true` forces the exit.
    for (const fact of [unflagged, { ...unflagged, forceUnvalued: false }]) {
      const result = replay([basisReceipt, issue, costedReceipt, fact]);

      expect(result.movements[3]?.valuation).toEqual({
        status: 'valued',
        totalCost: '-400',
        source: 'average_cost',
        unvaluedReason: null,
      });
      expect(result.provisional).toBe(false);
    }
  });
});
