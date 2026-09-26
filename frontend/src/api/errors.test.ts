import { AxiosError, type AxiosResponse } from 'axios';
import { describe, expect, it } from 'vitest';
import { t } from '@/lib/i18n';
import { ApiError, isTerminalApiError, normalizeApiError } from './errors';

function axiosErrorWith(status: number, data: unknown): AxiosError {
  const response = {
    data,
    status,
    statusText: '',
    headers: {},
    config: {},
  } as AxiosResponse;
  return new AxiosError('failed', 'ERR_BAD_REQUEST', undefined, {}, response);
}

describe('normalizeApiError', () => {
  it('maps the stable error code, not the server message', () => {
    const error = normalizeApiError(
      axiosErrorWith(403, {
        code: 'PermissionDenied',
        message: 'Missing permission Accounting.GeneralLedger.View',
        correlationId: 'corr-9',
      }),
    );

    expect(error.code).toBe('PermissionDenied');
    expect(error.isForbidden).toBe(true);
    expect(error.message).toBe(t.errors.forbidden);
    expect(error.correlationId).toBe('corr-9');
  });

  it('keeps the server message for validation failures', () => {
    const error = normalizeApiError(
      axiosErrorWith(400, {
        code: 'ValidationFailed',
        message: 'sort must be one of accountCode, accountName',
        correlationId: 'corr-10',
        details: [{ field: 'sort' }],
      }),
    );

    expect(error.code).toBe('ValidationFailed');
    expect(error.message).toContain('sort');
    expect(error.details).toEqual([{ field: 'sort' }]);
  });

  it('falls back to the HTTP status when the body is not an envelope', () => {
    const error = normalizeApiError(
      axiosErrorWith(502, '<html>gateway</html>'),
    );
    expect(error.code).toBe('InternalError');
    expect(error.message).toBe(t.errors.server);
  });

  it('classifies a missing response as a network error', () => {
    const error = normalizeApiError(new AxiosError('boom', 'ERR_NETWORK'));
    expect(error.code).toBe('NetworkError');
    expect(error.message).toBe(t.errors.network);
  });

  it('passes an already normalized error through unchanged', () => {
    const original = new ApiError({ code: 'Conflict', message: 'x' });
    expect(normalizeApiError(original)).toBe(original);
  });

  it('never leaks an unknown thrown value into the UI', () => {
    const error = normalizeApiError({ secret: 'do-not-show' });
    expect(error.message).toBe(t.errors.unknown);
  });
});

describe('isTerminalApiError', () => {
  it('does not retry decisions the backend already made', () => {
    for (const code of [
      'Unauthorized',
      'PermissionDenied',
      'EntityNotFound',
      'ValidationFailed',
      'BusinessRuleViolation',
    ] as const) {
      expect(isTerminalApiError(new ApiError({ code, message: 'x' }))).toBe(
        true,
      );
    }
  });

  it('allows retrying transient failures', () => {
    expect(
      isTerminalApiError(
        new ApiError({ code: 'ServiceUnavailable', message: 'x' }),
      ),
    ).toBe(false);
    expect(
      isTerminalApiError(new ApiError({ code: 'NetworkError', message: 'x' })),
    ).toBe(false);
  });
});
