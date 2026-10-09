import { describe, expect, it } from 'vitest';
import {
  toBusinessDate,
  type BusinessDate,
} from '../../../kernel/datetime/business-date.js';
import {
  ACTIVE_VALUATION_METHODS,
  DEFAULT_VALUATION_METHOD,
  VALUATION_METHODS,
  inactiveMethodMessage,
  isActiveValuationMethod,
  isValuationMethod,
  distinctBusinessDates,
  findAmbiguousBusinessDate,
  resolveValuationMethodAt,
  resolveValuationMethodFrom,
  toItemValuationMethodDto,
  versionCoversAnyBusinessDate,
  versionCoversBusinessDate,
  type ItemValuationMethodVersion,
} from './valuation-method.js';
import {
  BACKDATE_CONFIRMATION_CODE,
  REPRICING_CHOICE_CODE,
  REPRICING_CHOICES,
  backdateConfirmationMessage,
  isBackdated,
  isRepricingChoice,
  repricingChoiceMessage,
  type BackdateAssessment,
} from './backdating.js';

function version(
  overrides: Partial<ItemValuationMethodVersion> = {},
): ItemValuationMethodVersion {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id: 'v1',
    organizationId: 'org-1',
    itemId: 'item-1',
    method: 'moving_weighted_average',
    validFrom: day('2026-01-01'),
    validTo: null,
    note: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('valuation method vocabulary', () => {
  it('knows more methods than it implements, and says which is which', () => {
    expect(VALUATION_METHODS.length).toBeGreaterThan(
      ACTIVE_VALUATION_METHODS.length,
    );
    expect(ACTIVE_VALUATION_METHODS).toEqual(['moving_weighted_average']);
    expect(DEFAULT_VALUATION_METHOD).toBe('moving_weighted_average');
  });

  it('recognises FIFO as a known method but refuses to treat it as implemented', () => {
    expect(isValuationMethod('fifo')).toBe(true);
    expect(isActiveValuationMethod('fifo')).toBe(false);
    // The rejection explains the real state of affairs — no fake option.
    expect(inactiveMethodMessage('fifo')).toContain('moving_weighted_average');
  });

  it('rejects an unknown string outright', () => {
    expect(isValuationMethod('vibes')).toBe(false);
    expect(isActiveValuationMethod('vibes')).toBe(false);
  });
});

describe('resolveValuationMethodAt — effective dating (D-21)', () => {
  it('falls back to the code-defined default and SAYS it is a default', () => {
    const resolved = resolveValuationMethodAt([], day('2026-01-01'));

    expect(resolved.method).toBe(DEFAULT_VALUATION_METHOD);
    expect(resolved.source).toBe('default');
    expect(resolved.configurationId).toBeNull();
  });

  it('resolves the version in force on the business date, not the newest one', () => {
    const versions = [
      version({
        id: 'old',
        validFrom: businessDate('2025-01-01'),
        validTo: businessDate('2026-01-01'),
      }),
      version({
        id: 'current',
        validFrom: day('2026-01-01'),
      }),
    ];

    const past = resolveValuationMethodAt(versions, businessDate('2025-06-01'));
    const present = resolveValuationMethodAt(
      versions,
      businessDate('2026-06-01'),
    );

    expect(past.configurationId).toBe('old');
    expect(present.configurationId).toBe('current');
  });

  it('treats validTo as exclusive, so adjacent windows never overlap', () => {
    const versions = [
      version({
        id: 'closed',
        validFrom: businessDate('2025-01-01'),
        validTo: businessDate('2026-01-01'),
      }),
      version({ id: 'open', validFrom: businessDate('2026-01-01') }),
    ];

    const boundary = resolveValuationMethodAt(
      versions,
      businessDate('2026-01-01'),
    );

    expect(boundary.configurationId).toBe('open');
  });

  it('resolves a method BEFORE any configuration exists to the default', () => {
    const resolved = resolveValuationMethodAt(
      [version({ validFrom: businessDate('2026-01-01') })],
      businessDate('2025-01-01'),
    );

    expect(resolved.source).toBe('default');
    expect(resolved.validFrom).toBeNull();
  });
});

describe('toItemValuationMethodDto', () => {
  it('renders business dates as canonical days and keeps the open end open', () => {
    const dto = toItemValuationMethodDto(version());
    expect(dto.validFrom).toBe('2026-01-01');
    expect(dto.validTo).toBeNull();
  });
});

describe('backdating gate', () => {
  const assessment: BackdateAssessment = {
    backdated: true,
    movementDate: businessDate('2026-01-10'),
    latestMovementDate: businessDate('2026-02-01'),
    affectedMovements: 3,
    affectedValuedMovements: 2,
    alreadyStale: false,
  };

  it('treats a strictly earlier date as backdated', () => {
    expect(
      isBackdated({
        movementDate: businessDate('2026-01-10'),
        latestMovementDate: businessDate('2026-02-01'),
      }),
    ).toBe(true);
  });

  it('does NOT treat an equal business day as backdated (the ledger order decides)', () => {
    const date = businessDate('2026-02-01');
    expect(isBackdated({ movementDate: date, latestMovementDate: date })).toBe(
      false,
    );
  });

  it('is never backdated on an empty key', () => {
    expect(
      isBackdated({
        movementDate: day('2026-10-09'),
        latestMovementDate: null,
      }),
    ).toBe(false);
  });

  it('offers exactly two repricing choices and no default', () => {
    expect(REPRICING_CHOICES).toEqual(['recalculate', 'skip']);
    expect(isRepricingChoice('recalculate')).toBe(true);
    expect(isRepricingChoice('skip')).toBe(true);
    expect(isRepricingChoice('')).toBe(false);
    expect(isRepricingChoice('maybe')).toBe(false);
  });

  it('explains the business consequence instead of asking "are you sure?"', () => {
    const message = backdateConfirmationMessage(assessment);

    expect(message).toContain('3 later movement(s)');
    expect(message).toContain('2 of them valued');
    // OQ-73: the confirmation message names the business DAY, not an instant.
    expect(message).toContain('(2026-02-01)');
    expect(BACKDATE_CONFIRMATION_CODE).toBe('inventory.backdated_document');
  });

  it('states that nothing is ever recalculated silently', () => {
    expect(repricingChoiceMessage()).toContain('never recalculated silently');
    expect(REPRICING_CHOICE_CODE).toBe('inventory.repricing_choice_required');
  });
});

// ---------------------------------------------------------------------------
// Bounded configuration retrieval — relevance, not density
// ---------------------------------------------------------------------------

/**
 * A replay reads the versions in force at the DISTINCT dates it is replaying,
 * expressed in SQL as one window branch per date. These cases pin the two
 * properties that matters: the read is complete (it can never miss the
 * version that governs a movement) and it is bounded by how many distinct
 * movement dates exist, never by how densely the item has been reconfigured.
 */

/** Exactly what the database read returns, modelled in memory. */
function readFor(
  series: readonly ItemValuationMethodVersion[],
  movementDates: readonly BusinessDate[],
): ItemValuationMethodVersion[] {
  const dates = distinctBusinessDates(movementDates);
  return dates.length === 0
    ? []
    : series.filter((candidate) =>
        versionCoversAnyBusinessDate(candidate, dates),
      );
}

function businessDate(value: string): BusinessDate {
  const parsed = toBusinessDate(value);
  if (parsed === null) throw new Error(`Invalid test BusinessDate: ${value}`);
  return parsed;
}

const day = businessDate;
const utc = (year: number, month: number, dayOfMonth: number): BusinessDate =>
  businessDate(
    `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`,
  );
const utcOffset = (days: number): BusinessDate =>
  businessDate(
    new Date(Date.UTC(2000, 0, 1 + days)).toISOString().slice(0, 10),
  );

describe('distinctBusinessDates', () => {
  it('is empty for no movements (an empty key reads no configuration)', () => {
    expect(distinctBusinessDates([])).toEqual([]);
  });

  it('collapses repeated movement dates and sorts ascending', () => {
    const dates = [
      utc(2026, 3, 1),
      utc(2026, 1, 1),
      utc(2026, 3, 1),
      utc(2026, 2, 1),
      utc(2026, 1, 1),
    ];
    expect(distinctBusinessDates(dates)).toEqual([
      utc(2026, 1, 1),
      utc(2026, 2, 1),
      utc(2026, 3, 1),
    ]);
  });

  it('collapses repeated movements from the same business day', () => {
    const movementDay = businessDate('2026-01-01');
    expect(
      distinctBusinessDates([movementDay, movementDay, movementDay]),
    ).toHaveLength(1);
  });
});

describe('sparse movements across dense configuration history', () => {
  /**
   * The Owner's case: a year of monthly policy versions, two movements.
   * Resolution must be exact and the read must stay proportional to the
   * movements, not to the configuration.
   */
  const monthly: ItemValuationMethodVersion[] = Array.from(
    { length: 12 },
    (_, index) =>
      version({
        id: `m${index + 1}`,
        validFrom: utc(2025, index + 1, 1),
        validTo: index === 11 ? null : utc(2025, index + 2, 1),
      }),
  );

  it('reads one version per movement date, not one per configuration version', () => {
    const movements = [utc(2025, 1, 1), utc(2025, 12, 29)];
    const read = readFor(monthly, movements);

    expect(monthly).toHaveLength(12);
    expect(read).toHaveLength(2);
    expect(read.map((v) => v.id)).toEqual(['m1', 'm12']);
  });

  it('resolves both movements exactly as the complete history would', () => {
    const movements = [utc(2025, 1, 1), utc(2025, 12, 29)];
    const read = readFor(monthly, movements);

    for (const movementDate of movements) {
      expect(resolveValuationMethodAt(read, movementDate)).toEqual(
        resolveValuationMethodAt(monthly, movementDate),
      );
    }
    expect(
      resolveValuationMethodAt(read, movements[0] as BusinessDate)
        .configurationId,
    ).toBe('m1');
    expect(
      resolveValuationMethodAt(read, movements[1] as BusinessDate)
        .configurationId,
    ).toBe('m12');
  });

  it('stays proportional to distinct dates as configuration density grows', () => {
    // 600 versions (fortnightly for 25 years) against the same two movements.
    const dense: ItemValuationMethodVersion[] = Array.from(
      { length: 600 },
      (_, index) =>
        version({
          id: `d${index}`,
          validFrom: utcOffset(index * 15),
          validTo: index === 599 ? null : utcOffset((index + 1) * 15),
        }),
    );
    const movements = [utc(2005, 6, 7), utc(2020, 11, 30)];

    expect(readFor(dense, movements)).toHaveLength(2);
    for (const movementDate of movements) {
      expect(
        resolveValuationMethodAt(readFor(dense, movements), movementDate),
      ).toEqual(resolveValuationMethodAt(dense, movementDate));
    }
  });

  it('reads one version for a hundred movements sharing five dates', () => {
    const fiveDates = [
      utc(2025, 2, 10),
      utc(2025, 2, 11),
      utc(2025, 2, 12),
      utc(2025, 2, 13),
      utc(2025, 2, 14),
    ];
    const hundredMovements = Array.from(
      { length: 100 },
      (_, index) => fiveDates[index % 5] as BusinessDate,
    );

    expect(distinctBusinessDates(hundredMovements)).toHaveLength(5);
    // All five dates fall inside February's single version.
    expect(readFor(monthly, hundredMovements)).toHaveLength(1);
    expect(readFor(monthly, hundredMovements)[0]?.id).toBe('m2');
  });

  it('never returns a version that governs none of the replayed movements', () => {
    const movements = [utc(2025, 1, 1), utc(2025, 12, 29)];
    for (const candidate of readFor(monthly, movements)) {
      expect(versionCoversAnyBusinessDate(candidate, movements)).toBe(true);
    }
    for (const skipped of monthly.filter(
      (candidate) => !readFor(monthly, movements).includes(candidate),
    )) {
      for (const movementDate of movements) {
        expect(versionCoversBusinessDate(skipped, movementDate)).toBe(false);
      }
    }
  });
});

describe('effective dating across the replayed dates', () => {
  it('ignores a configuration that starts after the movement', () => {
    const series = [
      version({
        id: 'a',
        validFrom: utc(2025, 1, 1),
        validTo: utc(2025, 6, 1),
      }),
      version({ id: 'b', validFrom: utc(2025, 6, 1), validTo: null }),
    ];
    const movement = utc(2025, 3, 15);
    const read = readFor(series, [movement]);

    expect(read.map((v) => v.id)).toEqual(['a']);
    expect(resolveValuationMethodAt(read, movement).method).toBe(
      'moving_weighted_average',
    );
  });

  it('picks the later version once its window has opened', () => {
    const series = [
      version({
        id: 'a',
        validFrom: utc(2025, 1, 1),
        validTo: utc(2025, 7, 1),
      }),
      version({ id: 'b', validFrom: utc(2025, 7, 1), validTo: null }),
    ];
    const movement = utc(2025, 8, 1);

    expect(
      resolveValuationMethodAt(readFor(series, [movement]), movement)
        .configurationId,
    ).toBe('b');
  });

  it('loads an unsupported HISTORICAL version so the replay can fail closed', () => {
    const series = [
      version({
        id: 'a',
        validFrom: utc(2025, 1, 1),
        validTo: utc(2025, 6, 1),
      }),
      version({
        id: 'fifo',
        method: 'fifo',
        validFrom: utc(2025, 6, 1),
        validTo: null,
      }),
    ];
    const movement = utc(2025, 7, 1);
    const read = readFor(series, [movement]);

    // Relevance is about the DATE, never about whether we can execute it:
    // skipping it here would silently restate the period under the default.
    expect(read.map((v) => v.id)).toEqual(['fifo']);
    expect(resolveValuationMethodAt(read, movement).method).toBe('fifo');
  });

  it('excludes an unsupported FUTURE version from an earlier replay', () => {
    const series = [
      version({
        id: 'a',
        validFrom: utc(2025, 1, 1),
        validTo: utc(2026, 1, 1),
      }),
      version({
        id: 'future-fifo',
        method: 'fifo',
        validFrom: utc(2026, 1, 1),
        validTo: null,
      }),
    ];
    const movement = utc(2025, 12, 29);
    const read = readFor(series, [movement]);

    expect(read.map((v) => v.id)).toEqual(['a']);
    expect(resolveValuationMethodAt(read, movement).method).toBe(
      'moving_weighted_average',
    );
  });

  it('falls back to the code-defined default when no version covers the date', () => {
    const series = [
      version({ id: 'a', validFrom: utc(2025, 6, 1), validTo: null }),
    ];
    const movement = utc(2025, 1, 1);

    expect(readFor(series, [movement])).toEqual([]);
    expect(
      resolveValuationMethodAt(readFor(series, [movement]), movement),
    ).toEqual({
      method: DEFAULT_VALUATION_METHOD,
      source: 'default',
      configurationId: null,
      validFrom: null,
      validTo: null,
    });
  });

  it('keeps the half-open boundary: validFrom inclusive, validTo exclusive', () => {
    const series = [
      version({
        id: 'a',
        validFrom: utc(2025, 3, 21),
        validTo: utc(2025, 9, 23),
      }),
      version({ id: 'b', validFrom: utc(2025, 9, 23), validTo: null }),
    ];

    // The validTo business day belongs to the NEXT version, not this one.
    expect(
      resolveValuationMethodAt(series, utc(2025, 9, 23)).configurationId,
    ).toBe('b');
    expect(
      resolveValuationMethodAt(series, utc(2025, 9, 22)).configurationId,
    ).toBe('a');
    // ...and the read agrees on both sides of the edge.
    expect(readFor(series, [utc(2025, 9, 23)]).map((v) => v.id)).toEqual(['b']);
    expect(readFor(series, [utc(2025, 9, 22)]).map((v) => v.id)).toEqual(['a']);
  });
});

describe('resolveValuationMethodFrom — the single-row lookup path', () => {
  const series = [
    version({
      id: 'v1',
      validFrom: businessDate('2025-03-21'),
      validTo: businessDate('2026-03-21'),
    }),
    version({
      id: 'v2',
      method: 'fifo',
      validFrom: businessDate('2026-03-21'),
      validTo: null,
    }),
  ];

  /** What `findEffectiveVersionAt` asks the database for. */
  const pickEffective = (asOf: BusinessDate) =>
    series
      .filter((candidate) => versionCoversBusinessDate(candidate, asOf))
      .sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0] ?? null;

  it('agrees with the list-based resolution on every probed business day', () => {
    for (const dayValue of [
      '2024-01-01',
      '2025-03-21',
      '2025-12-31',
      '2026-03-20',
      '2026-03-21',
      '2027-06-01',
    ]) {
      const asOf = businessDate(dayValue);
      expect(resolveValuationMethodFrom(pickEffective(asOf))).toEqual(
        resolveValuationMethodAt(series, asOf),
      );
    }
  });

  it('reports the code-defined default when the lookup finds nothing', () => {
    expect(resolveValuationMethodFrom(null)).toEqual({
      method: DEFAULT_VALUATION_METHOD,
      source: 'default',
      configurationId: null,
      validFrom: null,
      validTo: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Per-date ambiguity (overlapping configuration in stored data)
// ---------------------------------------------------------------------------

describe('findAmbiguousBusinessDate', () => {
  const d1 = utc(2025, 3, 15);
  const d2 = utc(2025, 9, 20);

  it('passes when every movement date has exactly one version in force', () => {
    const series = [
      version({
        id: 'a',
        validFrom: utc(2025, 1, 1),
        validTo: utc(2025, 7, 1),
      }),
      version({ id: 'b', validFrom: utc(2025, 7, 1), validTo: null }),
    ];
    expect(findAmbiguousBusinessDate(series, [d1, d2])).toBeNull();
    expect(resolveValuationMethodAt(series, d1).configurationId).toBe('a');
    expect(resolveValuationMethodAt(series, d2).configurationId).toBe('b');
  });

  it('flags a date covered by two versions, naming the date and both versions', () => {
    const series = [
      version({
        id: 'a',
        validFrom: utc(2025, 1, 1),
        validTo: utc(2025, 7, 1),
      }),
      version({
        id: 'b',
        validFrom: utc(2025, 2, 1),
        validTo: utc(2025, 6, 1),
      }),
      version({ id: 'c', validFrom: utc(2025, 7, 1), validTo: null }),
    ];
    expect(findAmbiguousBusinessDate(series, [d1, d2])).toEqual({
      businessDate: d1,
      versionIds: ['a', 'b'],
    });
  });

  /**
   * THE REGRESSION CASE. Two versions are in force on the first date and
   * none on the second, so the read returns exactly as many rows as there
   * are dates. The count comparison this detector replaced
   * (`rows.length > dates.length`) sees 2 and 2 and waves it through,
   * while the first date resolves ambiguously.
   */
  it('flags an overlap even when the row count equals the date count', () => {
    const series = [
      version({
        id: 'a',
        validFrom: utc(2025, 1, 1),
        validTo: utc(2025, 7, 1),
      }),
      version({
        id: 'b',
        validFrom: utc(2025, 2, 1),
        validTo: utc(2025, 6, 1),
      }),
    ];
    const dates = [d1, d2];
    const inForceSomewhere = series.filter((candidate) =>
      versionCoversAnyBusinessDate(candidate, dates),
    );

    // Precondition: the discarded global check could not have caught this.
    expect(inForceSomewhere).toHaveLength(2);
    expect(dates).toHaveLength(2);
    expect(inForceSomewhere.length > dates.length).toBe(false);

    expect(findAmbiguousBusinessDate(inForceSomewhere, dates)).toEqual({
      businessDate: d1,
      versionIds: ['a', 'b'],
    });
  });

  it('reports the earliest ambiguous date when several are ambiguous', () => {
    const series = [
      version({ id: 'a', validFrom: utc(2025, 1, 1), validTo: null }),
      version({ id: 'b', validFrom: utc(2025, 1, 1), validTo: null }),
    ];
    expect(findAmbiguousBusinessDate(series, [d2, d1])?.businessDate).toEqual(
      d1,
    );
  });

  it('does not treat adjacent windows as ambiguous (half-open boundary)', () => {
    const boundary = utc(2025, 7, 1);
    const series = [
      version({ id: 'a', validFrom: utc(2025, 1, 1), validTo: boundary }),
      version({ id: 'b', validFrom: boundary, validTo: null }),
    ];
    expect(findAmbiguousBusinessDate(series, [boundary])).toBeNull();
    expect(resolveValuationMethodAt(series, boundary).configurationId).toBe(
      'b',
    );
  });

  it('does not treat an unconfigured date as ambiguous', () => {
    const series = [
      version({ id: 'a', validFrom: utc(2025, 6, 1), validTo: null }),
    ];
    expect(findAmbiguousBusinessDate(series, [utc(2025, 1, 1)])).toBeNull();
    expect(resolveValuationMethodAt(series, utc(2025, 1, 1)).source).toBe(
      'default',
    );
  });

  it('ignores an overlap that exists only outside the replayed dates', () => {
    const series = [
      version({
        id: 'a',
        validFrom: utc(2024, 1, 1),
        validTo: utc(2024, 7, 1),
      }),
      version({
        id: 'b',
        validFrom: utc(2024, 2, 1),
        validTo: utc(2024, 6, 1),
      }),
      version({ id: 'c', validFrom: utc(2025, 1, 1), validTo: null }),
    ];
    // 2024 is corrupt, but no movement is dated there.
    expect(findAmbiguousBusinessDate(series, [d1, d2])).toBeNull();
  });

  it('is unaffected by repeated movement dates', () => {
    const series = [
      version({ id: 'a', validFrom: utc(2025, 1, 1), validTo: null }),
    ];
    const repeated = [d1, d1, d1, d2, d2];
    expect(
      findAmbiguousBusinessDate(series, distinctBusinessDates(repeated)),
    ).toBeNull();
  });
});
