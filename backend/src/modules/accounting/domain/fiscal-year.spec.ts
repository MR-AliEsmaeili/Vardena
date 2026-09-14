import { describe, expect, it } from 'vitest';
import {
  checkFiscalYearRange,
  isFiscalYearStatus,
  planFiscalYearTransition,
  toFiscalYearDto,
  type FiscalYear,
  type FiscalYearStatus,
} from './fiscal-year.js';
import { parseDateOnly } from './date-range.js';

function mustParse(value: string): Date {
  const parsed = parseDateOnly(value);
  if (parsed === null) throw new Error(`Test bug: ${value} must parse.`);
  return parsed;
}

function sibling(
  id: string,
  start: string,
  end: string,
): { id: string; startDate: Date; endDate: Date } {
  return { id, startDate: mustParse(start), endDate: mustParse(end) };
}

describe('isFiscalYearStatus', () => {
  it('accepts exactly open, closed and sealed', () => {
    expect(isFiscalYearStatus('open')).toBe(true);
    expect(isFiscalYearStatus('closed')).toBe(true);
    expect(isFiscalYearStatus('sealed')).toBe(true);
    expect(isFiscalYearStatus('initial')).toBe(false);
    expect(isFiscalYearStatus('void')).toBe(false);
    expect(isFiscalYearStatus('Open')).toBe(false);
    expect(isFiscalYearStatus('')).toBe(false);
  });
});

describe('checkFiscalYearRange', () => {
  const existing = [sibling('y1', '2026-01-01', '2026-12-31')];

  it('accepts a disjoint year before or after', () => {
    expect(
      checkFiscalYearRange({
        candidate: {
          startDate: mustParse('2025-01-01'),
          endDate: mustParse('2025-12-31'),
        },
        existing,
      }),
    ).toEqual({ problem: null, conflictingId: null });
    // Touching the bound exactly is disjoint under inclusive semantics.
    expect(
      checkFiscalYearRange({
        candidate: {
          startDate: mustParse('2027-01-01'),
          endDate: mustParse('2027-12-31'),
        },
        existing,
      }),
    ).toEqual({ problem: null, conflictingId: null });
  });

  it('rejects an end before the start', () => {
    expect(
      checkFiscalYearRange({
        candidate: {
          startDate: mustParse('2027-06-01'),
          endDate: mustParse('2027-05-31'),
        },
        existing,
      }),
    ).toEqual({ problem: 'invalid_range', conflictingId: null });
  });

  it('rejects an overlap and names the conflicting year', () => {
    expect(
      checkFiscalYearRange({
        candidate: {
          startDate: mustParse('2026-06-01'),
          endDate: mustParse('2027-06-01'),
        },
        existing,
      }),
    ).toEqual({ problem: 'overlapping_year', conflictingId: 'y1' });
  });

  it('rejects sharing a single boundary day', () => {
    expect(
      checkFiscalYearRange({
        candidate: {
          startDate: mustParse('2026-12-31'),
          endDate: mustParse('2027-12-31'),
        },
        existing,
      }),
    ).toEqual({ problem: 'overlapping_year', conflictingId: 'y1' });
  });

  it('ignores the excluded year (the date-edit path)', () => {
    expect(
      checkFiscalYearRange({
        candidate: {
          startDate: mustParse('2026-01-01'),
          endDate: mustParse('2026-12-31'),
        },
        existing,
        excludeId: 'y1',
      }),
    ).toEqual({ problem: null, conflictingId: null });
  });
});

describe('planFiscalYearTransition', () => {
  const cases: Array<{
    from: FiscalYearStatus;
    transition: 'close' | 'reopen' | 'seal' | 'unseal';
    to: FiscalYearStatus | null;
  }> = [
    { from: 'open', transition: 'close', to: 'closed' },
    { from: 'closed', transition: 'reopen', to: 'open' },
    { from: 'closed', transition: 'seal', to: 'sealed' },
    { from: 'sealed', transition: 'unseal', to: 'closed' },
    // Everything else is refused: no skipping, no same-state step.
    { from: 'open', transition: 'seal', to: null },
    { from: 'open', transition: 'reopen', to: null },
    { from: 'open', transition: 'unseal', to: null },
    { from: 'closed', transition: 'close', to: null },
    { from: 'closed', transition: 'unseal', to: null },
    { from: 'sealed', transition: 'close', to: null },
    { from: 'sealed', transition: 'reopen', to: null },
    { from: 'sealed', transition: 'seal', to: null },
  ];

  for (const { from, transition, to } of cases) {
    it(`${transition} from ${from} → ${to ?? 'refused'}`, () => {
      expect(planFiscalYearTransition(from, transition)).toEqual({ to });
    });
  }
});

describe('toFiscalYearDto', () => {
  it('renders date-only fields as YYYY-MM-DD and carries no audit actors', () => {
    const year: FiscalYear = {
      id: 'y1',
      organizationId: 'org',
      financialAreaId: 'area',
      code: 'FY26',
      title: 'Fiscal year 2026',
      startDate: mustParse('2026-01-01'),
      endDate: mustParse('2026-12-31'),
      status: 'open',
      isActive: true,
      priorYearId: null,
      createdAt: new Date('2026-01-02T10:00:00.000Z'),
      updatedAt: new Date('2026-01-02T10:00:00.000Z'),
    };
    expect(toFiscalYearDto(year)).toEqual({
      id: 'y1',
      organizationId: 'org',
      financialAreaId: 'area',
      code: 'FY26',
      title: 'Fiscal year 2026',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      status: 'open',
      isActive: true,
      priorYearId: null,
      createdAt: '2026-01-02T10:00:00.000Z',
      updatedAt: '2026-01-02T10:00:00.000Z',
    });
  });
});
