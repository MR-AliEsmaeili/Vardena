import { describe, expect, it } from 'vitest';
import { t } from '@/lib/i18n';
import { hasCompleteReservationReference } from './reference-pair';
import { reservationFormSchema } from './reservation-form-schema';

const baseValues = {
  warehouseId: 'wh-1',
  itemId: 'item-1',
  quantity: '2.5000',
  unitId: 'unit-1',
  reason: '',
  referenceType: '',
  referenceId: '',
};

describe('reservation owner reference pair', () => {
  it('accepts both values empty or both values present', () => {
    expect(hasCompleteReservationReference('', '')).toBe(true);
    expect(hasCompleteReservationReference('external_order', 'ORD-7')).toBe(
      true,
    );
    expect(hasCompleteReservationReference(' external_order ', ' ORD-7 ')).toBe(
      true,
    );
  });

  it('rejects either half on its own, including whitespace-only values', () => {
    expect(hasCompleteReservationReference('external_order', '')).toBe(false);
    expect(hasCompleteReservationReference('', 'ORD-7')).toBe(false);
    expect(hasCompleteReservationReference('   ', 'ORD-7')).toBe(false);
  });

  it('validates both-or-neither at the form boundary and preserves quantity as a string', () => {
    const parsed = reservationFormSchema.safeParse({
      ...baseValues,
      referenceType: 'external_order',
    });
    expect(parsed.success).toBe(false);
    const messages = parsed.success
      ? []
      : parsed.error.issues.map((issue) => issue.message);
    expect(messages).toContain(t.reservations.referencePairHint);

    const valid = reservationFormSchema.parse({ ...baseValues });
    expect(valid.quantity).toBe('2.5000');
    expect(typeof valid.quantity).toBe('string');
  });
});
