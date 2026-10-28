import { describe, expect, it } from 'vitest';
import { reservationFormSchema } from './reservation-form-page';
export { reservationFormSchema };

/**
 * INV-08 §6: logic-e unit for the both-or-neither reference pair
 * (`referenceType`/`referenceId` must be set together or left empty together).
 */

describe('reference pair validation', () => {
  it('accepts an empty pair', () => {
    const result = reservationFormSchema.safeParse({
      warehouseId: 'wh-1',
      itemId: 'item-1',
      quantity: '5',
      unitId: 'unit-1',
      reason: '',
      referenceType: '',
      referenceId: '',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a complete pair', () => {
    const result = reservationFormSchema.safeParse({
      warehouseId: 'wh-1',
      itemId: 'item-1',
      quantity: '5',
      unitId: 'unit-1',
      reason: '',
      referenceType: 'material_request_line',
      referenceId: 'mrl-1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects referenceType without referenceId', () => {
    const result = reservationFormSchema.safeParse({
      warehouseId: 'wh-1',
      itemId: 'item-1',
      quantity: '5',
      unitId: 'unit-1',
      reason: '',
      referenceType: 'material_request_line',
      referenceId: '',
    });
    expect(result.success).toBe(false);
    const issues = result.error?.issues ?? [];
    expect(issues.some((e) => e.path.join('.') === 'referenceId')).toBe(true);
  });

  it('rejects referenceId without referenceType', () => {
    const result = reservationFormSchema.safeParse({
      warehouseId: 'wh-1',
      itemId: 'item-1',
      quantity: '5',
      unitId: 'unit-1',
      reason: '',
      referenceType: '',
      referenceId: 'mrl-1',
    });
    expect(result.success).toBe(false);
    const issues = result.error?.issues ?? [];
    expect(issues.some((e) => e.path.join('.') === 'referenceId')).toBe(true);
  });

  it('keeps quantity as a decimal string — no conversion to number', () => {
    const result = reservationFormSchema.safeParse({
      warehouseId: 'wh-1',
      itemId: 'item-1',
      quantity: '0.0001',
      unitId: 'unit-1',
      reason: '',
    });
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.quantity).toBe('0.0001');
    expect(typeof result.data.quantity).toBe('string');
  });

  it('rejects zero quantity', () => {
    const result = reservationFormSchema.safeParse({
      warehouseId: 'wh-1',
      itemId: 'item-1',
      quantity: '0',
      unitId: 'unit-1',
      reason: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than four fractional digits', () => {
    const result = reservationFormSchema.safeParse({
      warehouseId: 'wh-1',
      itemId: 'item-1',
      quantity: '5.00001',
      unitId: 'unit-1',
      reason: '',
    });
    expect(result.success).toBe(false);
  });
});
