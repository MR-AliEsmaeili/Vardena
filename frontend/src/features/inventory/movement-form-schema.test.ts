import { describe, expect, it } from 'vitest';
import { issueFormSchema, receiptFormSchema } from './movement-form-schema';

const movementValues = {
  itemId: 'item-1',
  warehouseId: 'warehouse-1',
  quantity: '1',
  unitId: 'unit-1',
  movementDate: '2024-02-29',
  reason: '',
};

describe('inventory movement form business date', () => {
  it('accepts a real Gregorian leap day for receipts and issues', () => {
    expect(
      receiptFormSchema.safeParse({ ...movementValues, totalCost: '' }).success,
    ).toBe(true);
    expect(issueFormSchema.safeParse(movementValues).success).toBe(true);
  });

  it.each(['2025-02-29', '2026-02-30', '1900-02-29'])(
    'rejects impossible Gregorian day %s',
    (movementDate) => {
      expect(
        receiptFormSchema.safeParse({
          ...movementValues,
          movementDate,
          totalCost: '',
        }).success,
      ).toBe(false);
      expect(
        issueFormSchema.safeParse({ ...movementValues, movementDate }).success,
      ).toBe(false);
    },
  );

  it('keeps the empty date valid so the backend can apply its default', () => {
    expect(
      issueFormSchema.safeParse({ ...movementValues, movementDate: '' })
        .success,
    ).toBe(true);
  });
});
