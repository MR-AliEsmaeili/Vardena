import {
  AxiosError,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apiClient,
  apiGet,
  cleanParams,
  setUnauthorizedHandler,
} from './client';
import { ApiError } from './errors';

const originalAdapter = apiClient.defaults.adapter;

function respondWithError(status: number, data: unknown): void {
  apiClient.defaults.adapter = (config: AxiosRequestConfig) => {
    const response = {
      data,
      status,
      statusText: '',
      headers: {},
      config,
    } as AxiosResponse;
    return Promise.reject(
      new AxiosError(
        'failed',
        'ERR_BAD_REQUEST',
        config as InternalAxiosRequestConfig,
        {},
        response,
      ),
    );
  };
}

afterEach(() => {
  if (originalAdapter === undefined) {
    delete apiClient.defaults.adapter;
  } else {
    apiClient.defaults.adapter = originalAdapter;
  }
  setUnauthorizedHandler(null);
});

describe('apiClient error handling', () => {
  it('normalizes the backend error envelope into an ApiError', async () => {
    respondWithError(422, {
      code: 'BusinessRuleViolation',
      message: 'Scope is inconsistent.',
      correlationId: 'corr-1',
    });

    const error = await apiGet('/accounting/general-ledger').catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.code).toBe('BusinessRuleViolation');
    expect(apiError.status).toBe(422);
    expect(apiError.correlationId).toBe('corr-1');
  });

  it('notifies the session-expiry handler on a 401 from a normal request', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    respondWithError(401, {
      code: 'Unauthorized',
      message: 'Authentication required.',
      correlationId: 'corr-2',
    });

    await expect(apiGet('/accounting/trial-balance')).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not treat a 401 from the session probes as an expired session', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    respondWithError(401, {
      code: 'Unauthorized',
      message: 'Authentication required.',
      correlationId: 'corr-3',
    });

    await expect(apiGet('/auth/me')).rejects.toBeInstanceOf(ApiError);
    expect(handler).not.toHaveBeenCalled();
  });

  it('reports a transport failure as a network error', async () => {
    apiClient.defaults.adapter = () =>
      Promise.reject(new AxiosError('Network Error', 'ERR_NETWORK'));

    const error = (await apiGet('/auth/me').catch(
      (caught: unknown) => caught,
    )) as ApiError;

    expect(error.code).toBe('NetworkError');
  });

  it('sends the session cookie with every request', () => {
    expect(apiClient.defaults.withCredentials).toBe(true);
  });
});

describe('cleanParams', () => {
  it('drops unset filters so they never reach the API', () => {
    expect(
      cleanParams({
        organizationId: 'org-1',
        accountId: undefined,
        accountCode: '',
        isActive: false,
        page: 1,
      }),
    ).toEqual({ organizationId: 'org-1', isActive: false, page: 1 });
  });
});
