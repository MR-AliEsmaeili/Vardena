import { describe, expect, it } from 'vitest';
import { toBusinessDate } from '../../../kernel/datetime/business-date.js';
import type { MovementRow } from './inventory-core-rows.js';
import { buildReplayFacts } from './inventory-valuation.repository.js';
import { replay, valuationChanged } from '../domain/valuation-replay.js';
import type { ItemValuationMethodVersion } from '../domain/valuation-method.js';

/**
 * The recalculation CHAIN, from the stored row to the value written back.
 *
 * `applyReplay` reads a key's rows, resolves the method per movement date and
 * builds the replay facts with `buildReplayFacts` — the production function
 * this spec drives, over the same `MovementRow` shape Prisma returns. What it
 * pins is that a stored fact's own authority (`forceUnvalued`, rebuilt by
 * `toReplayFact` from `return_basis`) reaches the strategy, so a recalculation
 * reproduces the exit instead of inventing one.
 */

const MWA = 'moving_weighted_average' as const;

function at(day: number): Date {
  return new Date(Date.UTC(2026, 5, day));
}

const VERSIONS: ItemValuationMethodVersion[] = [
  {
    id: 'version-1',
    organizationId: 'org-1',
    itemId: 'item-1',
    method: MWA,
    validFrom: toBusinessDate('2026-01-01')!,
    validTo: null,
    note: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  },
];

function row(
  columns: Pick<MovementRow, 'id' | 'movementType' | 'baseQuantity'> & {
    movementDate: Date;
    totalCost?: string | null;
    valuationStatus?: string;
    valuationSource?: string | null;
  },
): MovementRow {
  return {
    organizationId: 'org-1',
    branchId: 'branch-1',
    warehouseId: 'warehouse-1',
    itemId: 'item-1',
    quantity: columns.baseQuantity,
    unitId: 'unit-1',
    baseUnitId: 'unit-1',
    conversionFactor: '1',
    transferId: null,
    reversalOfMovementId: null,
    referenceType: 'inventory_business_document',
    referenceId: 'document-1',
    reason: null,
    operationKey: `operation-${columns.id}`,
    totalCost: null,
    valuationStatus: 'unvalued',
    valuationSource: null,
    valuedAt: null,
    valuationRunId: null,
    createdAt: new Date(`${columns.movementDate}T08:00:00.000Z`),
    updatedAt: new Date(`${columns.movementDate}T08:00:00.000Z`),
    createdBy: null,
    updatedBy: null,
    ...columns,
  };
}

/** The four rows a key holds after a basis-linked unvalued purchase return. */
function keyRows(options: { valuationSource: string | null }): MovementRow[] {
  return [
    row({
      id: 'basis-receipt',
      movementType: 'inbound',
      baseQuantity: '10',
      movementDate: at(1),
    }),
    row({
      id: 'issue',
      movementType: 'outbound',
      baseQuantity: '-10',
      movementDate: at(2),
    }),
    row({
      id: 'costed-receipt',
      movementType: 'inbound',
      baseQuantity: '5',
      movementDate: at(3),
      totalCost: '500.00',
      valuationStatus: 'valued',
      valuationSource: 'entered',
    }),
    row({
      id: 'purchase-return',
      movementType: 'purchase_return',
      baseQuantity: '-4',
      movementDate: at(4),
      totalCost: null,
      valuationStatus: 'unvalued',
      valuationSource: options.valuationSource,
    }),
  ];
}

describe('buildReplayFacts — the stored rows a recalculation replays', () => {
  it('carries the basis-linked unvalued exit into the replay, so it is reproduced and nothing is restated', () => {
    const facts = buildReplayFacts(
      keyRows({ valuationSource: 'return_basis' }),
      VERSIONS,
    );

    expect(facts[3]?.forceUnvalued).toBe(true);

    const result = replay(facts);
    const exit = result.movements[3];
    if (exit === undefined) throw new Error('missing replay result');

    // The recalculation derives NO value for the exit…
    expect(exit.valuation).toEqual({
      status: 'unvalued',
      totalCost: null,
      source: 'return_basis',
      unvaluedReason: 'no_cost_supplied',
    });
    // …so the stored row is exactly what it re-derives and no write follows.
    expect(
      valuationChanged(
        { status: 'unvalued', totalCost: null, source: 'return_basis' },
        exit.valuation,
      ),
    ).toBe(false);
    // Quantities move exactly as they were posted.
    expect(result.position).toEqual({
      valuedQuantity: '1',
      uncostedQuantity: '0',
      totalValue: '100',
    });
    // And the key keeps the stale flag the posting path set: the exit
    // consumed valued stock without attributing value (OD-RET-02/04).
    expect(result.provisional).toBe(true);
  });

  it('never infers the flag: a basis-less purchase return is still re-derived from the average', () => {
    const facts = buildReplayFacts(
      keyRows({ valuationSource: null }),
      VERSIONS,
    );

    expect(facts[3]?.forceUnvalued).toBeUndefined();

    const result = replay(facts);
    expect(result.movements[3]?.valuation).toEqual({
      status: 'valued',
      totalCost: '-400',
      source: 'average_cost',
      unvaluedReason: null,
    });
    expect(result.provisional).toBe(false);
  });
});
