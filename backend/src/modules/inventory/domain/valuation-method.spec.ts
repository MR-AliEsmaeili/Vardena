import { describe, expect, it } from 'vitest';
import {
  ACTIVE_VALUATION_METHODS,
  DEFAULT_VALUATION_METHOD,
  VALUATION_METHODS,
  inactiveMethodMessage,
  isActiveValuationMethod,
  isValuationMethod,
  resolveValuationMethodAt,
  toItemValuationMethodDto,
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
