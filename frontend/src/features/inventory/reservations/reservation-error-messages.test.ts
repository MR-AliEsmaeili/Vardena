import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/errors';
import { t } from '@/lib/i18n';
import { reservationErrorMessage } from './reservation-error-messages';

describe('reservation domain error localization', () => {
  it('keeps exact decimal quantities from the availability refusal without exposing raw English', () => {
    const raw =
      'Insufficient available stock in warehouse "WH-01": available 1.2500, requested 9007199254740993.0001.';
    const result = reservationErrorMessage(
      'create',
      new ApiError({ code: 'BusinessRuleViolation', message: raw }),
    ).message;

    expect(result).toContain('WH-01');
    expect(result).toContain('1.2500');
    expect(result).toContain('9,007,199,254,740,993.0001');
    expect(result).not.toContain('Insufficient available stock');
  });

  it('maps a backend-authoritative missing conversion without a client date preflight', () => {
    const result = reservationErrorMessage(
      'create',
      new ApiError({
        code: 'BusinessRuleViolation',
        message:
          'No unit conversion from the entered unit to the base unit covers 2026-10-26. Configure the conversion (in the entered → base direction) before posting.',
      }),
    ).message;

    expect(result).toBe(t.reservations.conversionUnavailable);
    expect(result).not.toContain('No unit conversion');
  });

  it('maps terminal duplicate release to the localized specific message', () => {
    const result = reservationErrorMessage(
      'release',
      new ApiError({
        code: 'BusinessRuleViolation',
        message:
          'The reservation is already released. A release is terminal and cannot be applied twice.',
      }),
    ).message;

    expect(result).toBe(t.reservations.releasedAlready);
  });

  it('explains Material Request ownership without permitting a generic release', () => {
    const result = reservationErrorMessage(
      'release',
      new ApiError({
        code: 'BusinessRuleViolation',
        message:
          'This reservation belongs to a Material Request line and can only be released through its lifecycle.',
      }),
    ).message;

    expect(result).toBe(t.reservations.materialRequestOwnedBody);
  });

  it('maps a reused operation key and the both-or-neither validation message', () => {
    expect(
      reservationErrorMessage(
        'create',
        new ApiError({
          code: 'Conflict',
          message:
            'This operationKey was already used with a different request. Retry with the original request, or use a new key.',
        }),
      ).message,
    ).toBe(t.reservations.errors.operationKeyReused);

    expect(
      reservationErrorMessage(
        'create',
        new ApiError({
          code: 'BadRequest',
          message: 'referenceType and referenceId must be set together.',
        }),
      ).message,
    ).toBe(t.reservations.referencePairHint);
  });
});
