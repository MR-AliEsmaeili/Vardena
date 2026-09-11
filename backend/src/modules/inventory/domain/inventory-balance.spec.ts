import { describe, expect, it } from 'vitest';
import {
  availableQuantity,
  toInventoryBalanceDto,
} from './inventory-balance.js';
import type { InventoryBalance } from './inventory-balance.js';

function balance(overrides: Partial<InventoryBalance> = {}): InventoryBalance {
  return {
    id: 'id',
    organizationId: 'org',
    branchId: 'branch',
    warehouseId: 'warehouse',
    itemId: 'item',
    onHand: '10',
    reserved: '7',
    lastMovementAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

describe('availability', () => {
  it('is on hand minus reserved', () => {
    expect(availableQuantity({ onHand: '10', reserved: '7' })).toBe('3');
  });

  it('can go negative (the policy decides whether that is allowed)', () => {
    expect(availableQuantity({ onHand: '3', reserved: '5' })).toBe('-2');
  });

  it('stays exact on fractional stock', () => {
    expect(availableQuantity({ onHand: '1', reserved: '0.9999' })).toBe(
      '0.0001',
    );
  });

  it('is derived on the DTO, never stored', () => {
    const dto = toInventoryBalanceDto(balance({ onHand: '10', reserved: '4' }));
    expect(dto.available).toBe('6');
    expect(dto.onHand).toBe('10');
    expect(dto.reserved).toBe('4');
  });
});
