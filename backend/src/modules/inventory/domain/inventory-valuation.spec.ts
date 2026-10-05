import { describe, expect, it } from 'vitest';
import {
  averageUnitCost,
  resolveValuationStatus,
  toInventoryValuationStateDto,
  unvaluedReasonMessage,
  UNVALUED_REASONS,
  type InventoryValuationState,
} from './inventory-valuation.js';
import {
  fitsMoney,
  isAmountString,
  moneyProblemMessage,
  roundToMoneyScale,
  validateEnteredAmount,
} from './money.js';
import { isValidPermissionCode } from '../../rbac/domain/permission-code.js';
import {
  INVENTORY_VALUATION_PERMISSION_DEFINITIONS,
  VALUATION_PERMISSIONS,
} from './inventory-valuation-permissions.js';

function state(
  overrides: Partial<InventoryValuationState> = {},
): InventoryValuationState {
  const now = new Date('2026-03-01T00:00:00.000Z');
  return {
    id: 'state-1',
    organizationId: 'org-1',
    branchId: 'branch-1',
    warehouseId: 'wh-1',
    itemId: 'item-1',
    method: 'moving_weighted_average',
    valuedQuantity: '0',
    uncostedQuantity: '0',
    totalValue: '0',
    status: 'valued',
    staleSince: null,
    lastValuedAt: null,
    lastRecalculationId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('resolveValuationStatus', () => {
  it('reports an empty key as valued, not as waiting for a cost', () => {
    expect(
      resolveValuationStatus({ uncostedQuantity: '0', staleSince: null }),
    ).toBe('valued');
  });

  it('reports uncosted stock as pending_cost', () => {
    expect(
      resolveValuationStatus({ uncostedQuantity: '5', staleSince: null }),
    ).toBe('pending_cost');
  });

  it('lets stale win over pending_cost — the worse news is the honest one', () => {
    expect(
      resolveValuationStatus({
        uncostedQuantity: '5',
        staleSince: new Date('2026-02-01T00:00:00.000Z'),
      }),
    ).toBe('stale');
  });
});

describe('averageUnitCost', () => {
  it('is derived, never stored, and null when nothing is valued', () => {
    expect(
      averageUnitCost({ totalValue: '0', valuedQuantity: '0' }),
    ).toBeNull();
  });

  it('divides at display scale without touching the stored value', () => {
    expect(averageUnitCost({ totalValue: '1000', valuedQuantity: '3' })).toBe(
      '333.333333',
    );
  });
});

describe('toInventoryValuationStateDto', () => {
  it('exposes the uncosted quantity instead of averaging it away', () => {
    const dto = toInventoryValuationStateDto(
      state({
        valuedQuantity: '10',
        uncostedQuantity: '4',
        totalValue: '1000',
        status: 'pending_cost',
      }),
    );

    expect(dto.valuedQuantity).toBe('10');
    expect(dto.uncostedQuantity).toBe('4');
    // onHand for this key: the quantity ledger and the value projection
    // agree about how much stock exists (invariant 1).
    expect(dto.totalQuantity).toBe('14');
    expect(dto.averageUnitCost).toBe('100');
    expect(dto.status).toBe('pending_cost');
  });

  it('carries the instant a key became inconsistent', () => {
    const since = new Date('2026-02-02T10:00:00.000Z');
    const dto = toInventoryValuationStateDto(
      state({ status: 'stale', staleSince: since }),
    );
    expect(dto.staleSince).toBe(since.toISOString());
  });
});

describe('unvalued reasons', () => {
  it.each(UNVALUED_REASONS)('%s has an explanatory message', (reason) => {
    expect(unvaluedReasonMessage(reason).length).toBeGreaterThan(20);
  });
});

describe('money — entered amounts are never rounded', () => {
  it('accepts an exact two-decimal amount', () => {
    expect(validateEnteredAmount('12500.25')).toBeNull();
    expect(fitsMoney('12500.25')).toBe(true);
  });

  it('rejects a third decimal instead of rounding it away', () => {
    expect(validateEnteredAmount('12500.255')).toBe('malformed');
    expect(moneyProblemMessage('exceeds_precision')).toContain('never rounded');
  });

  it('rejects zero, negatives and junk', () => {
    expect(validateEnteredAmount('0')).toBe('not_positive');
    expect(validateEnteredAmount('-5.00')).toBe('malformed');
    expect(validateEnteredAmount('abc')).toBe('malformed');
    expect(isAmountString('1e5')).toBe(false);
  });

  it('rounds half-up only where the average forces a division', () => {
    expect(roundToMoneyScale('2.345')).toBe('2.35');
    expect(roundToMoneyScale('-2.345')).toBe('-2.35');
    expect(roundToMoneyScale('2.344')).toBe('2.34');
  });
});

describe('valuation permission vocabulary', () => {
  it('contains exactly the four implemented codes', () => {
    expect(
      INVENTORY_VALUATION_PERMISSION_DEFINITIONS.map(({ code }) => code).sort(),
    ).toEqual(
      [
        VALUATION_PERMISSIONS.ASSIGN_COST,
        VALUATION_PERMISSIONS.CONFIGURE,
        VALUATION_PERMISSIONS.RECALCULATE,
        VALUATION_PERMISSIONS.VIEW,
      ].sort(),
    );
  });

  it.each(
    INVENTORY_VALUATION_PERMISSION_DEFINITIONS.map(
      (definition) => [definition.code, definition] as const,
    ),
  )('%s is a well-formed permission code', (code, definition) => {
    expect(isValidPermissionCode(code)).toBe(true);
    expect(definition.description.trim().length).toBeGreaterThan(0);
  });

  it('keeps recalculation separate from assigning a cost', () => {
    // Restating numbers other people have already seen is not the same
    // authority as entering a price.
    expect(VALUATION_PERMISSIONS.RECALCULATE).not.toBe(
      VALUATION_PERMISSIONS.ASSIGN_COST,
    );
  });
});
