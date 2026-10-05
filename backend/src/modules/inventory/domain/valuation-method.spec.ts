import { describe, expect, it } from 'vitest';
import {
  ACTIVE_VALUATION_METHODS,
  DEFAULT_VALUATION_METHOD,
  VALUATION_METHODS,
  inactiveMethodMessage,
  isActiveValuationMethod,
  isValuationMethod,
  distinctInstants,
  resolveValuationMethodAt,
  resolveValuationMethodFrom,
  toItemValuationMethodDto,
  versionCoversAnyInstant,
  versionCoversInstant,
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
    validFrom: new Date('2026-01-01T00:00:00.000Z'),
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
    const resolved = resolveValuationMethodAt([], new Date());

    expect(resolved.method).toBe(DEFAULT_VALUATION_METHOD);
    expect(resolved.source).toBe('default');
    expect(resolved.configurationId).toBeNull();
  });

  it('resolves the version in force at the instant, not the newest one', () => {
    const versions = [
      version({
        id: 'old',
        validFrom: new Date('2025-01-01T00:00:00.000Z'),
        validTo: new Date('2026-01-01T00:00:00.000Z'),
      }),
      version({
        id: 'current',
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
      }),
    ];

    const past = resolveValuationMethodAt(
      versions,
      new Date('2025-06-01T00:00:00.000Z'),
    );
    const present = resolveValuationMethodAt(
      versions,
      new Date('2026-06-01T00:00:00.000Z'),
    );

    expect(past.configurationId).toBe('old');
    expect(present.configurationId).toBe('current');
  });

  it('treats validTo as exclusive, so adjacent windows never overlap', () => {
    const versions = [
      version({
        id: 'closed',
        validFrom: new Date('2025-01-01T00:00:00.000Z'),
        validTo: new Date('2026-01-01T00:00:00.000Z'),
      }),
      version({ id: 'open', validFrom: new Date('2026-01-01T00:00:00.000Z') }),
    ];

    const boundary = resolveValuationMethodAt(
      versions,
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(boundary.configurationId).toBe('open');
  });

  it('resolves a method BEFORE any configuration exists to the default', () => {
    const resolved = resolveValuationMethodAt(
      [version({ validFrom: new Date('2026-01-01T00:00:00.000Z') })],
      new Date('2025-01-01T00:00:00.000Z'),
    );

    expect(resolved.source).toBe('default');
    expect(resolved.validFrom).toBeNull();
  });
});

describe('toItemValuationMethodDto', () => {
  it('renders instants as ISO strings and keeps the open end open', () => {
    const dto = toItemValuationMethodDto(version());
    expect(dto.validFrom).toBe('2026-01-01T00:00:00.000Z');
    expect(dto.validTo).toBeNull();
  });
});

describe('backdating gate', () => {
  const assessment: BackdateAssessment = {
    backdated: true,
    movementDate: new Date('2026-01-10T00:00:00.000Z'),
    latestMovementDate: new Date('2026-02-01T00:00:00.000Z'),
    affectedMovements: 3,
    affectedValuedMovements: 2,
    alreadyStale: false,
  };

  it('treats a strictly earlier date as backdated', () => {
    expect(
      isBackdated({
        movementDate: new Date('2026-01-10T00:00:00.000Z'),
        latestMovementDate: new Date('2026-02-01T00:00:00.000Z'),
      }),
    ).toBe(true);
  });

  it('does NOT treat an equal instant as backdated (the ledger order decides)', () => {
    const instant = new Date('2026-02-01T00:00:00.000Z');
    expect(
      isBackdated({ movementDate: instant, latestMovementDate: instant }),
    ).toBe(false);
  });

  it('is never backdated on an empty key', () => {
    expect(
      isBackdated({ movementDate: new Date(), latestMovementDate: null }),
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
    expect(message).toContain('2026-02-01T00:00:00.000Z');
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
  movementDates: readonly Date[],
): ItemValuationMethodVersion[] {
  const instants = distinctInstants(movementDates);
  return instants.length === 0
    ? []
    : series.filter((candidate) =>
        versionCoversAnyInstant(candidate, instants),
      );
}

const utc = (year: number, month: number, day: number): Date =>
  new Date(Date.UTC(year, month - 1, day));

describe('distinctInstants', () => {
  it('is empty for no movements (an empty key reads no configuration)', () => {
    expect(distinctInstants([])).toEqual([]);
  });

  it('collapses repeated movement dates and sorts ascending', () => {
    const dates = [
      utc(2026, 3, 1),
      utc(2026, 1, 1),
      utc(2026, 3, 1),
      utc(2026, 2, 1),
      utc(2026, 1, 1),
    ];
    expect(distinctInstants(dates).map((d) => d.toISOString())).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
      '2026-03-01T00:00:00.000Z',
    ]);
  });

  it('keeps instants that differ only by time of day', () => {
    const morning = new Date('2026-01-01T08:00:00.000Z');
    const evening = new Date('2026-01-01T20:00:00.000Z');
    expect(distinctInstants([morning, evening, morning])).toHaveLength(2);
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
      resolveValuationMethodAt(read, movements[0] as Date).configurationId,
    ).toBe('m1');
    expect(
      resolveValuationMethodAt(read, movements[1] as Date).configurationId,
    ).toBe('m12');
  });

  it('stays proportional to distinct dates as configuration density grows', () => {
    // 600 versions (fortnightly for 25 years) against the same two movements.
    const dense: ItemValuationMethodVersion[] = Array.from(
      { length: 600 },
      (_, index) =>
        version({
          id: `d${index}`,
          validFrom: new Date(Date.UTC(2000, 0, 1 + index * 15)),
          validTo:
            index === 599
              ? null
              : new Date(Date.UTC(2000, 0, 1 + (index + 1) * 15)),
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
      (_, index) => fiveDates[index % 5] as Date,
    );

    expect(distinctInstants(hundredMovements)).toHaveLength(5);
    // All five dates fall inside February's single version.
    expect(readFor(monthly, hundredMovements)).toHaveLength(1);
    expect(readFor(monthly, hundredMovements)[0]?.id).toBe('m2');
  });

  it('never returns a version that governs none of the replayed movements', () => {
    const movements = [utc(2025, 1, 1), utc(2025, 12, 29)];
    for (const candidate of readFor(monthly, movements)) {
      expect(versionCoversAnyInstant(candidate, movements)).toBe(true);
    }
    for (const skipped of monthly.filter(
      (candidate) => !readFor(monthly, movements).includes(candidate),
    )) {
      for (const movementDate of movements) {
        expect(versionCoversInstant(skipped, movementDate)).toBe(false);
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

    // The instant a window closes belongs to the NEXT version, not this one.
    expect(
      resolveValuationMethodAt(series, utc(2025, 9, 23)).configurationId,
    ).toBe('b');
    expect(
      resolveValuationMethodAt(series, new Date(utc(2025, 9, 23).getTime() - 1))
        .configurationId,
    ).toBe('a');
    // ...and the read agrees on both sides of the edge.
    expect(readFor(series, [utc(2025, 9, 23)]).map((v) => v.id)).toEqual(['b']);
    expect(
      readFor(series, [new Date(utc(2025, 9, 23).getTime() - 1)]).map(
        (v) => v.id,
      ),
    ).toEqual(['a']);
  });
});

describe('resolveValuationMethodFrom — the single-row lookup path', () => {
  const series = [
    version({
      id: 'v1',
      validFrom: new Date('2025-03-21T00:00:00.000Z'),
      validTo: new Date('2026-03-21T00:00:00.000Z'),
    }),
    version({
      id: 'v2',
      method: 'fifo',
      validFrom: new Date('2026-03-21T00:00:00.000Z'),
      validTo: null,
    }),
  ];

  /** What `findEffectiveVersionAt` asks the database for. */
  const pickEffective = (asOf: Date) =>
    series
      .filter((candidate) => versionCoversInstant(candidate, asOf))
      .sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime())[0] ?? null;

  it('agrees with the list-based resolution on every probed instant', () => {
    for (const iso of [
      '2024-01-01T00:00:00.000Z',
      '2025-03-21T00:00:00.000Z',
      '2025-12-31T23:59:59.000Z',
      '2026-03-20T23:59:59.999Z',
      '2026-03-21T00:00:00.000Z',
      '2027-06-01T00:00:00.000Z',
    ]) {
      const asOf = new Date(iso);
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
