import { describe, expect, it } from 'vitest';
import type { BusinessDate } from '../../../kernel/datetime/business-date.js';
import {
  checkAccountingPeriodRange,
  isAccountingPeriodStatus,
  planAccountingPeriodTransition,
  type AccountingPeriodStatus,
} from './accounting-period.js';
import { parseDateOnly } from './date-range.js';

function mustParse(value: string): BusinessDate {
  const parsed = parseDateOnly(value);
  if (parsed === null) throw new Error(`Test bug: ${value} must parse.`);
  return parsed;
}

const YEAR = {
  startDate: mustParse('2026-01-01'),
  endDate: mustParse('2026-12-31'),
};

function sibling(
  id: string,
  start: string,
  end: string,
): { id: string; startDate: BusinessDate; endDate: BusinessDate } {
  return { id, startDate: mustParse(start), endDate: mustParse(end) };
}

describe('isAccountingPeriodStatus', () => {
  it('accepts exactly open, closed and sealed', () => {
    expect(isAccountingPeriodStatus('open')).toBe(true);
    expect(isAccountingPeriodStatus('closed')).toBe(true);
    expect(isAccountingPeriodStatus('sealed')).toBe(true);
    expect(isAccountingPeriodStatus('initial')).toBe(false);
    expect(isAccountingPeriodStatus('')).toBe(false);
  });
});

describe('checkAccountingPeriodRange', () => {
  const existing = [sibling('p1', '2026-01-01', '2026-01-31')];

  it('accepts a disjoint period inside the year', () => {
    expect(
      checkAccountingPeriodRange({
        candidate: {
          startDate: mustParse('2026-02-01'),
          endDate: mustParse('2026-02-28'),
        },
        year: YEAR,
        existing,
      }),
    ).toEqual({ problem: null, conflictingId: null });
  });

  it('accepts a period spanning the whole year when nothing overlaps', () => {
    expect(
      checkAccountingPeriodRange({
        candidate: { ...YEAR },
        year: YEAR,
        existing: [],
      }),
    ).toEqual({ problem: null, conflictingId: null });
  });

  it('rejects an end before the start', () => {
    expect(
      checkAccountingPeriodRange({
        candidate: {
          startDate: mustParse('2026-02-01'),
          endDate: mustParse('2026-01-31'),
        },
        year: YEAR,
        existing,
      }),
    ).toEqual({ problem: 'invalid_range', conflictingId: null });
  });

  it('rejects a period outside the year bounds by one day', () => {
    expect(
      checkAccountingPeriodRange({
        candidate: {
          startDate: mustParse('2025-12-31'),
          endDate: mustParse('2026-01-31'),
        },
        year: YEAR,
        existing: [],
      }),
    ).toEqual({ problem: 'outside_year', conflictingId: null });
    expect(
      checkAccountingPeriodRange({
        candidate: {
          startDate: mustParse('2026-12-01'),
          endDate: mustParse('2027-01-01'),
        },
        year: YEAR,
        existing: [],
      }),
    ).toEqual({ problem: 'outside_year', conflictingId: null });
  });

  it('checks the year boundary before overlap', () => {
    // Outside the year AND overlapping p1: the boundary problem wins, so
    // the caller fixes the year mismatch first.
    expect(
      checkAccountingPeriodRange({
        candidate: {
          startDate: mustParse('2025-12-15'),
          endDate: mustParse('2026-01-15'),
        },
        year: YEAR,
        existing,
      }),
    ).toEqual({ problem: 'outside_year', conflictingId: null });
  });

  it('rejects an overlap and names the conflicting period', () => {
    expect(
      checkAccountingPeriodRange({
        candidate: {
          startDate: mustParse('2026-01-15'),
          endDate: mustParse('2026-02-15'),
        },
        year: YEAR,
        existing,
      }),
    ).toEqual({ problem: 'overlapping_period', conflictingId: 'p1' });
  });
});

describe('planAccountingPeriodTransition', () => {
  const cases: Array<{
    from: AccountingPeriodStatus;
    transition: 'close' | 'reopen' | 'seal';
    to: AccountingPeriodStatus | null;
  }> = [
    { from: 'open', transition: 'close', to: 'closed' },
    { from: 'closed', transition: 'reopen', to: 'open' },
    // A sealed period reopens only after the year is unsealed — the
    // year-level gate lives in the transaction; the row move is allowed.
    { from: 'sealed', transition: 'reopen', to: 'open' },
    { from: 'closed', transition: 'seal', to: 'sealed' },
    // Refused: no open → sealed skip, no same-state step.
    { from: 'open', transition: 'seal', to: null },
    { from: 'open', transition: 'reopen', to: null },
    { from: 'closed', transition: 'close', to: null },
    { from: 'sealed', transition: 'close', to: null },
    { from: 'sealed', transition: 'seal', to: null },
  ];

  for (const { from, transition, to } of cases) {
    it(`${transition} from ${from} → ${to ?? 'refused'}`, () => {
      expect(planAccountingPeriodTransition(from, transition)).toEqual({
        to,
      });
    });
  }
});
