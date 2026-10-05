import { describe, expect, it } from 'vitest';
import {
  ACTIVE_VALUATION_METHODS,
  DEFAULT_VALUATION_METHOD,
  VALUATION_METHODS,
  inactiveMethodMessage,
  isActiveValuationMethod,
  isValuationMethod,
  methodHorizonOf,
  resolveValuationMethodAt,
  resolveValuationMethodFrom,
  toItemValuationMethodDto,
  versionCoversHorizon,
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
// Bounded configuration retrieval (the replay horizon)
// ---------------------------------------------------------------------------

/**
 * The recalculation reads only the configuration versions whose window
 * intersects the horizon of the movements it replays, instead of the item's
 * entire configuration history. These cases exist to prove the bound is
 * COMPLETE — a filtered read must answer every in-horizon date exactly as the
 * full series would — and that the bound follows the data, not a magic
 * number.
 */
describe('methodHorizonOf', () => {
  it('is null when there are no movements (an empty key reads no configuration)', () => {
    expect(methodHorizonOf([])).toBeNull();
  });

  it('spans the earliest and latest movement date regardless of input order', () => {
    const horizon = methodHorizonOf([
      new Date('2026-05-01T00:00:00.000Z'),
      new Date('2025-02-01T00:00:00.000Z'),
      new Date('2026-01-01T00:00:00.000Z'),
    ]);

    expect(horizon?.from.toISOString()).toBe('2025-02-01T00:00:00.000Z');
    expect(horizon?.to.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });

  it('collapses to a single instant for one movement', () => {
    const only = new Date('2026-03-21T00:00:00.000Z');
    expect(methodHorizonOf([only])).toEqual({ from: only, to: only });
  });
});

describe('versionCoversHorizon — what the bounded read may skip', () => {
  const horizon = {
    from: new Date('2026-01-10T00:00:00.000Z'),
    to: new Date('2026-02-10T00:00:00.000Z'),
  };

  it('excludes a version that starts AFTER the last movement (future configuration)', () => {
    const future = version({
      validFrom: new Date('2026-02-11T00:00:00.000Z'),
      validTo: null,
    });
    expect(versionCoversHorizon(future, horizon)).toBe(false);
  });

  it('excludes a version that ended before the first movement', () => {
    const expired = version({
      validFrom: new Date('2024-01-01T00:00:00.000Z'),
      validTo: new Date('2026-01-10T00:00:00.000Z'),
    });
    expect(versionCoversHorizon(expired, horizon)).toBe(false);
  });

  it('keeps a version that starts exactly on the last movement date (half-open window)', () => {
    const edge = version({ validFrom: horizon.to, validTo: null });
    expect(versionCoversHorizon(edge, horizon)).toBe(true);
    expect(versionCoversInstant(edge, horizon.to)).toBe(true);
  });

  it('keeps a version that covers only part of the horizon', () => {
    const middle = version({
      validFrom: new Date('2026-01-20T00:00:00.000Z'),
      validTo: new Date('2026-01-25T00:00:00.000Z'),
    });
    expect(versionCoversHorizon(middle, horizon)).toBe(true);
  });
});

describe('bounded retrieval is complete — large, realistic configuration history', () => {
  /** 60 consecutive monthly versions: five years of policy changes. */
  const series: ItemValuationMethodVersion[] = Array.from(
    { length: 60 },
    (_, index) => {
      const from = new Date(Date.UTC(2021, index, 1));
      const to = new Date(Date.UTC(2021, index + 1, 1));
      return version({
        id: `v${index + 1}`,
        validFrom: from,
        validTo: index === 59 ? null : to,
      });
    },
  );

  /** What the database read does: horizon predicate, nothing else. */
  const readForHorizon = (dates: readonly Date[]) => {
    const horizon = methodHorizonOf(dates);
    return horizon === null
      ? []
      : series.filter((candidate) => versionCoversHorizon(candidate, horizon));
  };

  it('answers every movement date exactly as the complete series would', () => {
    const movementDates = [
      new Date(Date.UTC(2023, 2, 15)),
      new Date(Date.UTC(2023, 6, 1)),
      new Date(Date.UTC(2024, 0, 31)),
      new Date(Date.UTC(2024, 5, 10)),
    ];
    const bounded = readForHorizon(movementDates);

    for (const date of movementDates) {
      expect(resolveValuationMethodAt(bounded, date)).toEqual(
        resolveValuationMethodAt(series, date),
      );
    }
    // Each date really does land on its OWN version — the test would pass
    // vacuously if they all resolved to the same one.
    expect(
      movementDates.map(
        (date) => resolveValuationMethodAt(bounded, date).configurationId,
      ),
    ).toEqual(['v27', 'v31', 'v37', 'v42']);
  });

  it('reads fewer versions than the item has, and the ones it skips cannot matter', () => {
    const movementDates = [
      new Date(Date.UTC(2023, 2, 15)),
      new Date(Date.UTC(2023, 6, 1)),
    ];
    const bounded = readForHorizon(movementDates);

    expect(bounded.length).toBeLessThan(series.length);
    const skipped = series.filter((candidate) => !bounded.includes(candidate));
    expect(skipped.length).toBeGreaterThan(0);
    for (const candidate of skipped) {
      for (const date of movementDates) {
        expect(versionCoversInstant(candidate, date)).toBe(false);
      }
    }
  });

  it('scales with the horizon, not with a fixed number: a wider window reads more versions', () => {
    const narrow = readForHorizon([
      new Date(Date.UTC(2023, 2, 15)),
      new Date(Date.UTC(2023, 3, 15)),
    ]);
    const wide = readForHorizon([
      new Date(Date.UTC(2021, 0, 2)),
      new Date(Date.UTC(2025, 11, 31)),
    ]);

    expect(narrow.length).toBe(2);
    // The whole five-year history is required when the movements span it.
    expect(wide.length).toBe(series.length);
  });

  it('holds for every month boundary in the series (swept, not sampled)', () => {
    for (let index = 0; index < 60; index += 1) {
      const first = new Date(Date.UTC(2021, index, 1));
      const mid = new Date(Date.UTC(2021, index, 17, 13, 45));
      const bounded = readForHorizon([first, mid]);
      expect(resolveValuationMethodAt(bounded, first)).toEqual(
        resolveValuationMethodAt(series, first),
      );
      expect(resolveValuationMethodAt(bounded, mid)).toEqual(
        resolveValuationMethodAt(series, mid),
      );
    }
  });

  it('never lets a FUTURE version reach an earlier movement', () => {
    const withFuture = [
      ...series,
      version({
        id: 'future-fifo',
        method: 'fifo',
        validFrom: new Date(Date.UTC(2026, 0, 1)),
        validTo: null,
      }),
    ];
    const movementDates = [new Date(Date.UTC(2023, 2, 15))];
    const horizon = methodHorizonOf(movementDates);
    if (horizon === null) throw new Error('horizon');
    const bounded = withFuture.filter((candidate) =>
      versionCoversHorizon(candidate, horizon),
    );

    expect(bounded.some((candidate) => candidate.id === 'future-fifo')).toBe(
      false,
    );
    expect(
      resolveValuationMethodAt(bounded, movementDates[0] as Date).method,
    ).toBe('moving_weighted_average');
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
