import { describe, expect, it } from 'vitest';
import { transferFormSchema } from './transfer-form-schema';

const transferValues = {
  sourceWarehouseId: 'source-warehouse',
  destinationWarehouseId: 'destination-warehouse',
  itemId: 'item-1',
  quantity: '1',
  unitId: 'unit-1',
  movementDate: '2024-02-29',
  reason: '',
};

describe('inventory transfer form business date', () => {
  it('accepts a real Gregorian leap day', () => {
    expect(transferFormSchema.safeParse(transferValues).success).toBe(true);
  });

  it.each(['2025-02-29', '2026-02-30', '1900-02-29'])(
    'rejects impossible Gregorian day %s',
    (movementDate) => {
      expect(
        transferFormSchema.safeParse({ ...transferValues, movementDate })
          .success,
      ).toBe(false);
    },
  );

  it('keeps the empty date valid so the backend can apply its default', () => {
    expect(
      transferFormSchema.safeParse({ ...transferValues, movementDate: '' })
        .success,
    ).toBe(true);
  });
});
