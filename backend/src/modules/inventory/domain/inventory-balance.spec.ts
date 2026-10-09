import { describe, expect, it } from 'vitest';
import {
  availableQuantity,
  resolveAvailableQuantity,
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
    lastMovementDate: null,
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
    const dto = toInventoryBalanceDto(
      balance({ onHand: '10', reserved: '4' }),
      true,
    );
    expect(dto.available).toBe('6');
    expect(dto.onHand).toBe('10');
    expect(dto.reserved).toBe('4');
    expect(dto.reservationsReduceAvailable).toBe(true);
  });
});

describe('resolveAvailableQuantity (C-50 §3.7)', () => {
  it('subtracts reservations when the warehouse setting is true', () => {
    expect(
      resolveAvailableQuantity({ onHand: '10', reserved: '4' }, true),
    ).toBe('6');
  });

  it('reports on-hand unchanged when the warehouse setting is false', () => {
    expect(
      resolveAvailableQuantity({ onHand: '10', reserved: '4' }, false),
    ).toBe('10');
  });

  it('never mutates on-hand either way', () => {
    const balanceInput = { onHand: '10', reserved: '4' };
    resolveAvailableQuantity(balanceInput, false);
    expect(balanceInput.onHand).toBe('10');
  });

  it('agrees with the DTO helper for the same inputs', () => {
    const dtoTrue = toInventoryBalanceDto(
      balance({ onHand: '10', reserved: '4' }),
      true,
    );
    const dtoFalse = toInventoryBalanceDto(
      balance({ onHand: '10', reserved: '4' }),
      false,
    );
    expect(dtoTrue.available).toBe(
      resolveAvailableQuantity({ onHand: '10', reserved: '4' }, true),
    );
    expect(dtoFalse.available).toBe('10');
    expect(dtoFalse.onHand).toBe('10');
  });
});
