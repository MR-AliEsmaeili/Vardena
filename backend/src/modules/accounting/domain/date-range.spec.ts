import { describe, expect, it } from 'vitest';
import {
  dateOnlyRangeWithin,
  dateOnlyRangesOverlap,
  formatDateOnly,
  isValidDateOnlyRange,
  parseDateOnly,
} from './date-range.js';

function mustParse(value: string): Date {
  const parsed = parseDateOnly(value);
  if (parsed === null) throw new Error(`Test bug: ${value} must parse.`);
  return parsed;
}

describe('parseDateOnly', () => {
  it('parses a calendar date to a UTC-midnight instant', () => {
    expect(parseDateOnly('2026-03-21')).toEqual(
      new Date(Date.UTC(2026, 2, 21)),
    );
  });

  it('rejects non-date shapes', () => {
    expect(parseDateOnly('2026-03-21T00:00:00Z')).toBeNull();
    expect(parseDateOnly('21.03.2026')).toBeNull();
    expect(parseDateOnly('2026-3-1')).toBeNull();
    expect(parseDateOnly('')).toBeNull();
    expect(parseDateOnly('not-a-date')).toBeNull();
  });

  it('rejects impossible calendar dates without rolling over', () => {
    expect(parseDateOnly('2026-02-30')).toBeNull();
    expect(parseDateOnly('2026-13-01')).toBeNull();
    expect(parseDateOnly('2026-00-10')).toBeNull();
    expect(parseDateOnly('2026-04-31')).toBeNull();
  });

  it('accepts February 29 on leap years only', () => {
    expect(parseDateOnly('2024-02-29')).not.toBeNull();
    expect(parseDateOnly('2026-02-29')).toBeNull();
  });
});

describe('formatDateOnly', () => {
  it('renders the UTC day regardless of the local timezone', () => {
    // Noon UTC on the 21st is still the 21st in UTC — but midnight local
    // in a behind-UTC zone would render the 20th through local accessors.
    expect(formatDateOnly(new Date(Date.UTC(2026, 2, 21, 12)))).toBe(
      '2026-03-21',
    );
  });

  it('round-trips through parseDateOnly', () => {
    expect(formatDateOnly(mustParse('1405-01-01'))).toBe('1405-01-01');
  });
});

describe('isValidDateOnlyRange', () => {
  it('accepts a zero-length range (start = end)', () => {
    const day = mustParse('2026-01-01');
    expect(isValidDateOnlyRange({ startDate: day, endDate: day })).toBe(true);
  });

  it('rejects an end before the start', () => {
    expect(
      isValidDateOnlyRange({
        startDate: mustParse('2026-02-01'),
        endDate: mustParse('2026-01-31'),
      }),
    ).toBe(false);
  });
});

describe('dateOnlyRangesOverlap (inclusive bounds)', () => {
  it('detects containment and partial overlaps', () => {
    const outer = {
      startDate: mustParse('2026-01-01'),
      endDate: mustParse('2026-12-31'),
    };
    expect(
      dateOnlyRangesOverlap(outer, {
        startDate: mustParse('2026-03-01'),
        endDate: mustParse('2026-03-31'),
      }),
    ).toBe(true);
    expect(
      dateOnlyRangesOverlap(
        {
          startDate: mustParse('2026-01-01'),
          endDate: mustParse('2026-06-30'),
        },
        {
          startDate: mustParse('2026-06-01'),
          endDate: mustParse('2026-12-31'),
        },
      ),
    ).toBe(true);
  });

  it('treats ranges sharing exactly one day as overlapping', () => {
    expect(
      dateOnlyRangesOverlap(
        {
          startDate: mustParse('2026-01-01'),
          endDate: mustParse('2026-03-31'),
        },
        {
          startDate: mustParse('2026-03-31'),
          endDate: mustParse('2026-06-30'),
        },
      ),
    ).toBe(true);
  });

  it('treats touching-but-disjoint ranges as NOT overlapping', () => {
    expect(
      dateOnlyRangesOverlap(
        {
          startDate: mustParse('2026-01-01'),
          endDate: mustParse('2026-03-30'),
        },
        {
          startDate: mustParse('2026-03-31'),
          endDate: mustParse('2026-06-30'),
        },
      ),
    ).toBe(false);
  });

  it('treats a single day inside another range as overlapping', () => {
    const day = mustParse('2026-05-05');
    expect(
      dateOnlyRangesOverlap(
        { startDate: day, endDate: day },
        {
          startDate: mustParse('2026-01-01'),
          endDate: mustParse('2026-12-31'),
        },
      ),
    ).toBe(true);
  });
});

describe('dateOnlyRangeWithin', () => {
  const year = {
    startDate: mustParse('2026-01-01'),
    endDate: mustParse('2026-12-31'),
  };

  it('accepts a period on the exact year bounds', () => {
    expect(dateOnlyRangeWithin({ ...year }, year)).toBe(true);
  });

  it('rejects a period sticking out by one day on either side', () => {
    expect(
      dateOnlyRangeWithin(
        {
          startDate: mustParse('2025-12-31'),
          endDate: mustParse('2026-01-31'),
        },
        year,
      ),
    ).toBe(false);
    expect(
      dateOnlyRangeWithin(
        {
          startDate: mustParse('2026-12-01'),
          endDate: mustParse('2027-01-01'),
        },
        year,
      ),
    ).toBe(false);
  });
});
