import { describe, expect, it } from 'vitest';
import { documentFormSchema } from './inventory-document-form-schema';

const documentValues = {
  kind: 'receipt' as const,
  businessDate: '2024-02-29',
  warehouseId: 'warehouse-1',
  sourceWarehouseId: '',
  destinationWarehouseId: '',
  cost: '',
  description: '',
  reference: '',
  lines: [{ itemId: 'item-1', quantity: '1', unitId: 'unit-1' }],
};

describe('inventory document form business date', () => {
  it('accepts a real Gregorian leap day', () => {
    expect(documentFormSchema.safeParse(documentValues).success).toBe(true);
  });

  it.each(['2025-02-29', '2026-02-30', '1900-02-29'])(
    'rejects impossible Gregorian day %s',
    (businessDate) => {
      expect(
        documentFormSchema.safeParse({ ...documentValues, businessDate })
          .success,
      ).toBe(false);
    },
  );

  it('keeps an omitted business date valid for the backend default', () => {
    expect(
      documentFormSchema.safeParse({ ...documentValues, businessDate: '' })
        .success,
    ).toBe(true);
  });
});
