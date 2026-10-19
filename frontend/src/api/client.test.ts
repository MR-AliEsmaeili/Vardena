import {
  AxiosError,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apiClient,
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  cleanParams,
  setUnauthorizedHandler,
  type RequestActivityOptions,
} from './client';
import { ApiError } from './errors';
import {
  getRequestActivitySnapshot,
  resetRequestActivityForTests,
  type RequestActivitySnapshot,
} from './request-activity';

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
  resetRequestActivityForTests();
});

interface PendingCall {
  config: AxiosRequestConfig;
  resolve: (response: AxiosResponse) => void;
  reject: (error: unknown) => void;
}

/**
 * Adapter whose requests stay in flight until the test settles them. It lets
 * the registry be observed BEFORE and AFTER a request, without a fake server.
 */
function pendingAdapter(): PendingCall[] {
  const pending: PendingCall[] = [];
  apiClient.defaults.adapter = (config: AxiosRequestConfig) =>
    new Promise<AxiosResponse>((resolve, reject) => {
      pending.push({ config, resolve, reject });
    });
  return pending;
}

function takePending(pending: PendingCall[]): PendingCall {
  const call = pending.shift();
  if (call === undefined) throw new Error('no pending request');
  return call;
}

function respond(pending: PendingCall[], data: unknown, status = 200): void {
  const call = takePending(pending);
  call.resolve({
    data,
    status,
    statusText: '',
    headers: {},
    config: call.config as InternalAxiosRequestConfig,
  });
}

function failWith(pending: PendingCall[], status: number, data: unknown): void {
  const call = takePending(pending);
  call.reject(
    new AxiosError(
      'failed',
      'ERR_BAD_REQUEST',
      call.config as InternalAxiosRequestConfig,
      {},
      {
        data,
        status,
        statusText: '',
        headers: {},
        config: call.config as InternalAxiosRequestConfig,
      },
    ),
  );
}

async function waitForActivity(
  expected: Partial<RequestActivitySnapshot>,
): Promise<void> {
  await vi.waitFor(() => {
    expect(getRequestActivitySnapshot()).toMatchObject(expected);
  });
}

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

/**
 * Cross-layer contract: every REAL request passes the one Axios instance, is
 * counted exactly once from start to settlement (success, HTTP failure,
 * network failure, cancellation), and the loading UI never issues a request
 * of its own. Component code is deliberately not involved.
 */
describe('request activity (single HTTP layer)', () => {
  it('tracks a GET as background and clears it after success', async () => {
    const pending = pendingAdapter();
    const promise = apiGet<{ ok: boolean }>('/inventory/movements');

    await waitForActivity({ total: 1, global: 0, background: 1 });
    respond(pending, { ok: true });
    await expect(promise).resolves.toEqual({ ok: true });

    expect(getRequestActivitySnapshot().total).toBe(0);
  });

  it('tracks a POST as a global save', async () => {
    const pending = pendingAdapter();
    const promise = apiPost('/accounting-documents', {});

    await waitForActivity({ total: 1, global: 1, background: 0 });
    expect(getRequestActivitySnapshot().globalMessage).toBe('saving');

    respond(pending, {});
    await promise;
    expect(getRequestActivitySnapshot().total).toBe(0);
  });

  it('maps PATCH and DELETE to their own messages', async () => {
    const pending = pendingAdapter();
    const patch = apiPatch('/accounting-documents/1', {});
    await waitForActivity({ global: 1 });
    expect(getRequestActivitySnapshot().globalMessage).toBe('updating');
    respond(pending, {});
    await patch;

    const remove = apiDelete('/accounting-documents/1');
    await waitForActivity({ global: 1 });
    expect(getRequestActivitySnapshot().globalMessage).toBe('deleting');
    respond(pending, {});
    await remove;

    expect(getRequestActivitySnapshot().total).toBe(0);
  });

  it('accepts an explicit neutral processing message', async () => {
    const options: RequestActivityOptions = { message: 'processing' };
    const pending = pendingAdapter();
    const promise = apiPost(
      '/accounting-documents/1/finalize',
      {},
      {
        vardenaRequestActivity: options,
      },
    );

    await waitForActivity({ global: 1 });
    expect(getRequestActivitySnapshot().globalMessage).toBe('processing');

    respond(pending, {});
    await promise;
  });

  it('finalizes a direct apiClient call through the response interceptor', async () => {
    // The helpers add a `finally` safety net; this test bypasses them to prove
    // the interceptor itself owns a complete lifecycle (the primary path any
    // future direct apiClient call would rely on).
    const pending = pendingAdapter();
    const promise = apiClient.get('/health');

    await waitForActivity({ total: 1, background: 1 });
    respond(pending, { ok: true });
    await promise;

    expect(getRequestActivitySnapshot().total).toBe(0);
  });

  it('ends the entry on an HTTP error and still rejects with the ApiError', async () => {
    const pending = pendingAdapter();
    const promise = apiPost('/accounting-documents', {});

    await waitForActivity({ global: 1 });
    failWith(pending, 422, {
      code: 'BusinessRuleViolation',
      message: 'Scope is inconsistent.',
      correlationId: 'corr-activity',
    });

    const error = await promise.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('BusinessRuleViolation');
    expect(getRequestActivitySnapshot().total).toBe(0);
  });

  it('ends the entry on a network failure', async () => {
    const pending = pendingAdapter();
    const promise = apiGet('/health');

    await waitForActivity({ background: 1 });
    takePending(pending).reject(new AxiosError('Network Error', 'ERR_NETWORK'));

    await expect(promise).rejects.toMatchObject({ code: 'NetworkError' });
    expect(getRequestActivitySnapshot().total).toBe(0);
  });

  it('ends the entry when the request is cancelled', async () => {
    const pending = pendingAdapter();
    const controller = new AbortController();
    const promise = apiGet('/auth/me', { signal: controller.signal });

    await waitForActivity({ background: 1 });
    const call = takePending(pending);
    controller.abort();
    call.reject(
      new AxiosError(
        'canceled',
        AxiosError.ERR_CANCELED,
        call.config as InternalAxiosRequestConfig,
      ),
    );

    await expect(promise).rejects.toMatchObject({ code: 'RequestAborted' });
    expect(getRequestActivitySnapshot().total).toBe(0);
  });

  it('keeps two concurrent requests independent', async () => {
    const pending = pendingAdapter();
    const first = apiPost('/accounting-documents', {});
    const second = apiGet('/accounting-documents?page=1');

    await waitForActivity({ total: 2, global: 1, background: 1 });

    respond(pending, { id: 'doc-1' });
    await first;
    expect(getRequestActivitySnapshot()).toMatchObject({
      total: 1,
      global: 0,
      background: 1,
    });

    respond(pending, { items: [] });
    await second;
    expect(getRequestActivitySnapshot().total).toBe(0);
  });

  it('settles a mixed global set with the neutral message', async () => {
    const pending = pendingAdapter();
    const save = apiPost('/accounting-documents', {});
    const remove = apiDelete('/accounting-documents/2');

    await waitForActivity({ total: 2, global: 2 });
    expect(getRequestActivitySnapshot().globalMessage).toBeNull();

    respond(pending, {});
    respond(pending, {});
    await Promise.all([save, remove]);
    expect(getRequestActivitySnapshot().total).toBe(0);
  });

  it('does not leak or double-count when a failed attempt is retried', async () => {
    const pending = pendingAdapter();
    const firstAttempt = apiPost('/inventory/movements', {});

    await waitForActivity({ global: 1 });
    failWith(pending, 500, {
      code: 'InternalError',
      message: 'boom',
      correlationId: 'corr-retry',
    });
    await expect(firstAttempt).rejects.toBeInstanceOf(ApiError);
    expect(getRequestActivitySnapshot().total).toBe(0);

    // A user/query retry is a NEW HTTP attempt with its own token.
    const retry = apiPost('/inventory/movements', {});
    await waitForActivity({ total: 1, global: 1 });
    respond(pending, { id: 'movement-1' });
    await retry;

    expect(getRequestActivitySnapshot()).toMatchObject({
      total: 0,
      global: 0,
      background: 0,
    });
  });

  it('honours explicit background and silent overrides', async () => {
    const pending = pendingAdapter();

    const backgroundPost = apiPost(
      '/license/import',
      {},
      {
        vardenaRequestActivity: { scope: 'background' },
      },
    );
    await waitForActivity({ total: 1, global: 0, background: 1 });
    respond(pending, {});
    await backgroundPost;

    const silent = apiGet('/auth/me', {
      vardenaRequestActivity: { scope: 'silent' },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(getRequestActivitySnapshot().total).toBe(0);
    expect(pending).toHaveLength(1);
    respond(pending, { id: 'user-1' });
    await silent;

    expect(getRequestActivitySnapshot().total).toBe(0);
  });

  it('finalizes before the session-expiry reaction runs', async () => {
    const observedTotals: number[] = [];
    setUnauthorizedHandler(() => {
      observedTotals.push(getRequestActivitySnapshot().total);
    });

    const pending = pendingAdapter();
    const promise = apiGet('/accounting/trial-balance');

    await waitForActivity({ total: 1, background: 1 });
    failWith(pending, 401, {
      code: 'Unauthorized',
      message: 'Authentication required.',
      correlationId: 'corr-order',
    });

    await expect(promise).rejects.toBeInstanceOf(ApiError);
    // The 401 reaction may clear the cache and cancel other queries; it must
    // never run while this request still looks in flight.
    expect(observedTotals).toEqual([0]);
    expect(getRequestActivitySnapshot().total).toBe(0);
  });

  it('never creates an extra request just to show loading', async () => {
    let calls = 0;
    apiClient.defaults.adapter = (config: AxiosRequestConfig) => {
      calls += 1;
      return Promise.resolve({
        data: { ok: true },
        status: 200,
        statusText: '',
        headers: {},
        config: config as InternalAxiosRequestConfig,
      });
    };

    await expect(apiGet('/dashboard')).resolves.toEqual({ ok: true });
    expect(calls).toBe(1);
    expect(getRequestActivitySnapshot().total).toBe(0);
  });
});
