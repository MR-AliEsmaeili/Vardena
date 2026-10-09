import { describe, expect, it } from 'vitest';
import { movementsFilterSchema } from './movements-filter-bar';
import { parseMovementsUrlState } from './use-inventory-movements';

function parse(search: string) {
  return parseMovementsUrlState(new URLSearchParams(search));
}

describe('movement BusinessDate filter schema', () => {
  const baseValues = {
    warehouseId: '',
    itemId: '',
    movementType: '',
    dateFrom: '',
    dateTo: '',
  };

  it('accepts blank optional dates and real Gregorian calendar days', () => {
    expect(
      movementsFilterSchema.safeParse({
        ...baseValues,
        dateFrom: '2026-03-21',
      }).success,
    ).toBe(true);
    expect(movementsFilterSchema.safeParse(baseValues).success).toBe(true);
  });

  it('rejects impossible Gregorian days', () => {
    expect(
      movementsFilterSchema.safeParse({
        ...baseValues,
        dateFrom: '2026-02-30',
      }).success,
    ).toBe(false);
  });
});

describe('movement BusinessDate URL filters', () => {
  it('retains valid canonical Gregorian dates', () => {
    const state = parse('dateFrom=2026-03-21&dateTo=2026-03-22');

    expect(state.dateFrom).toBe('2026-03-21');
    expect(state.dateTo).toBe('2026-03-22');
  });

  it.each([
    ['wrong shape', '2026/03/21'],
    ['impossible day', '2026-02-30'],
    ['impossible month', '1405-13-01'],
  ])(
    'drops an invalid deep-link date (%s) instead of querying with it',
    (_label, value) => {
      const state = parse(`dateFrom=${encodeURIComponent(value)}`);

      expect(state.dateFrom).toBe('');
    },
  );
});
