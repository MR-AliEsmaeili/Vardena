import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/errors';
import { t } from '@/lib/i18n';
import { deviceLifecycleErrorMessage } from './device-lifecycle-errors';

describe('device lifecycle error presentation', () => {
  it('maps stable device quota reasons without rendering backend messages', () => {
    const result = deviceLifecycleErrorMessage(
      new ApiError({
        code: 'Conflict',
        message: 'internal SQL text must not appear',
        status: 409,
        correlationId: 'corr-oq83',
        details: { reason: 'device-limit-reached' },
      }),
      'activation',
    );

    expect(result).toEqual({
      message: t.deviceLicensing.errorDeviceLimit,
      correlationId: 'corr-oq83',
    });
    expect(result.message).not.toContain('internal SQL text');
  });

  it('explains terminal cancellation and does not imply a retry can revive it', () => {
    expect(
      deviceLifecycleErrorMessage(
        new ApiError({
          code: 'Conflict',
          message: 'request state',
          status: 409,
          details: { reason: 'replacement-request-cancelled' },
        }),
        'replacement-import',
      ).message,
    ).toBe(t.deviceLicensing.errorCancelled);
  });

  it('presents permission and transport failures from stable codes', () => {
    expect(
      deviceLifecycleErrorMessage(
        new ApiError({
          code: 'PermissionDenied',
          message: 'backend permission detail',
          status: 403,
        }),
        'deactivation',
      ).message,
    ).toBe(t.errors.forbidden);
    expect(
      deviceLifecycleErrorMessage(
        new ApiError({ code: 'NetworkError', message: 'socket detail' }),
        'load',
      ).message,
    ).toBe(t.errors.network);
  });
});
