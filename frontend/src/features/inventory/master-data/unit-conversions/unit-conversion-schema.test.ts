import { describe, expect, it } from 'vitest';
import { t } from '@/lib/i18n';
import { unitConversionSchema } from '../master-data-schemas';

const values = {
  scope: 'global',
  itemId: '',
  fromUnitId: 'a',
  toUnitId: 'b',
  factor: '12.000001',
  validFrom: '2026-10-26',
  validTo: '',
};

describe('unit conversion form', () => {
  it('requires an item for item scope before posting', () => {
    const parsed = unitConversionSchema.safeParse({ ...values, scope: 'item' });
    expect(parsed.success).toBe(false);
    if (parsed.success)
      throw new Error('item scope unexpectedly accepted without an item');
    expect(parsed.error.issues).toContainEqual(
      expect.objectContaining({
        path: ['itemId'],
        message: t.inventoryMaster.conversionItemRequired,
      }),
    );
  });
  it('permits an omitted item for the global scope', () => {
    expect(unitConversionSchema.safeParse(values).success).toBe(true);
  });
});
