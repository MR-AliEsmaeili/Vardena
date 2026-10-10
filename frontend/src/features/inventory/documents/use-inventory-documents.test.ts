import { describe, expect, it } from 'vitest';
import { parseDocumentsUrlState } from './use-inventory-documents';

function parse(search: string) {
  return parseDocumentsUrlState(new URLSearchParams(search));
}

describe('inventory-document BusinessDate URL filters', () => {
  it('retains valid canonical Gregorian range endpoints', () => {
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
