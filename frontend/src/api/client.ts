import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios';
import { normalizeApiError, type ApiError } from './errors';
import {
  beginRequest,
  endRequest,
  type RequestActivityMessage,
  type RequestActivityScope,
} from './request-activity';

/**
 * The single Axios instance of the application (AR-28: "all server data flows
 * through TanStack Query; all mutations go through the `api/` layer (single
 * Axios instance, interceptors). No ad-hoc fetch/Axios calls inside
 * components").
 *
 * Authentication follows the actual backend contract (ADR-0007,
 * `backend/src/modules/identity`): an opaque **httpOnly session cookie**
 * issued by `POST /auth/login`. The browser stores and sends it; the SPA can
 * neither read nor forge it — which is why `withCredentials` is on and why no
 * token is ever kept in JavaScript, localStorage or the UI.
 *
 * The base URL comes from the environment (`VITE_API_BASE_URL`, default
 * `/api/v1`, i.e. same-origin). No production host is hard-coded.
 */

const DEFAULT_BASE_URL = '/api/v1';

export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL?.trim() || DEFAULT_BASE_URL;

/** Correlation header the backend echoes on every response/error. */
export const CORRELATION_ID_HEADER = 'x-correlation-id';

/**
 * Per-request loading declaration.
 *
 * `scope: 'silent'` opts a request out of the activity registry entirely;
 * callers use it only for a request whose progress the user must not be told
 * about (none today — kept for a future probe that would otherwise flicker).
 * The transport layer never decides how the UI looks: it only reports that a
 * real request started/ended and which semantic message applies.
 */
export interface RequestActivityOptions {
  scope?: RequestActivityScope | 'silent';
  message?: RequestActivityMessage;
}

/**
 * Per-call handle filled by the request interceptor. The API helpers use it
 * as a finalization safety net: even an adapter failure that loses the Axios
 * config (a hand-written/third-party adapter, or a rejection before dispatch)
 * still has a token the helper can end in `finally`. The response
 * interceptor remains the primary, immediate finalization path.
 */
export interface RequestActivityTracker {
  token?: number;
}

/**
 * A class instance, not an object literal: Axios deep-merges plain-object
 * config values, which would break the interceptor -> helper reference. A
 * non-plain instance travels by reference, so the token written during the
 * request interceptor is visible in the helper's `finally`.
 */
class ActivityTracker implements RequestActivityTracker {
  token?: number;
}

declare module 'axios' {
  interface AxiosRequestConfig {
    /** See `RequestActivityOptions`; defaults are derived from the method. */
    vardenaRequestActivity?: RequestActivityOptions;
    vardenaRequestActivityTracker?: RequestActivityTracker;
  }

  interface InternalAxiosRequestConfig {
    /** Registry token for exactly one HTTP attempt (set by the interceptor). */
    vardenaRequestActivityToken?: number;
  }
}

/** Default semantic message of an HTTP method (neutral by construction). */
function defaultActivityMessage(method: string): RequestActivityMessage {
  switch (method) {
    case 'get':
    case 'head':
    case 'options':
      return 'receiving';
    case 'post':
      return 'saving';
    case 'put':
    case 'patch':
      return 'updating';
    case 'delete':
      return 'deleting';
    default:
      return 'processing';
  }
}

/**
 * Start-of-request policy, in ONE place.
 *
 * - Read requests are `background`: their section owns the local skeleton and
 *   the shell shows only the ambient orb, so a table refresh or a focus
 *   refetch can never cover the page.
 * - Write requests are `global`: a mutation the user is waiting for may
 *   surface the (delayed, non-modal) global indicator; its own button/dialog
 *   keeps the immediate local feedback.
 * - Explicit per-call options win (auth screens and license import declare
 *   `background` because they already own the channel; document lifecycle
 *   commands declare the neutral `processing` message).
 */
function resolveRequestActivity(config: InternalAxiosRequestConfig): {
  scope: RequestActivityScope;
  message: RequestActivityMessage;
} | null {
  const override = config.vardenaRequestActivity;
  if (override?.scope === 'silent') return null;

  const method = (config.method ?? 'get').toLowerCase();
  const isRead = method === 'get' || method === 'head' || method === 'options';
  return {
    scope: override?.scope ?? (isRead ? 'background' : 'global'),
    message: override?.message ?? defaultActivityMessage(method),
  };
}

function endTrackedRequest(
  config: InternalAxiosRequestConfig | undefined,
): void {
  endRequest(config?.vardenaRequestActivityToken);
}

type UnauthorizedHandler = (error: ApiError) => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;

/**
 * Register the session-expiry reaction (set once by the auth provider).
 * Keeping it a callback avoids coupling the transport layer to the router.
 */
export function setUnauthorizedHandler(
  handler: UnauthorizedHandler | null,
): void {
  unauthorizedHandler = handler;
}

/** Requests whose 401 is an expected answer, not an expired session. */
const SESSION_PROBE_PATHS = ['/auth/login', '/auth/logout', '/auth/me'];

function isSessionProbe(config: InternalAxiosRequestConfig): boolean {
  const url = config.url ?? '';
  return SESSION_PROBE_PATHS.some((path) => url.startsWith(path));
}

export const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  // Session cookie transport (ADR-0007). Required for the cookie to travel.
  withCredentials: true,
  headers: { Accept: 'application/json' },
  // Query parameters are plain scalars; drop undefined values so optional
  // filters never reach the API as `?accountId=undefined` (the backend
  // rejects unknown/invalid values with 400 — whitelist validation).
  paramsSerializer: {
    indexes: null,
  },
});

/**
 * The ONE place a request enters the activity registry. The token travels on
 * the Axios config so the matching response (success or error) can end
 * exactly that entry — retries are new attempts with new tokens, and a
 * cancelled request still rejects through the response interceptor.
 */
apiClient.interceptors.request.use((config) => {
  const activity = resolveRequestActivity(config);
  if (activity !== null) {
    const token = beginRequest(activity);
    config.vardenaRequestActivityToken = token;
    if (config.vardenaRequestActivityTracker !== undefined) {
      config.vardenaRequestActivityTracker.token = token;
    }
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => {
    endTrackedRequest(response.config);
    return response;
  },
  (error: unknown) => {
    const failed = error as AxiosError | undefined;
    const config: InternalAxiosRequestConfig | undefined =
      failed?.config ??
      (failed?.response?.config as InternalAxiosRequestConfig | undefined);

    // Finalize BEFORE running the unauthorized reaction: that reaction clears
    // the query cache and may cancel other queries, and no loading entry may
    // survive a settled request.
    endTrackedRequest(config);

    const apiError = normalizeApiError(error);

    if (
      apiError.isUnauthorized &&
      unauthorizedHandler !== null &&
      (config === undefined || !isSessionProbe(config))
    ) {
      unauthorizedHandler(apiError);
    }

    return Promise.reject(apiError);
  },
);

/** Strip `undefined` entries so optional filters are simply not sent. */
export function cleanParams<T extends Record<string, unknown>>(
  params: T,
): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Run one real request with a tracker token and guarantee finalization.
 *
 * The interceptor starts the activity; this `finally` ends the SAME token
 * whatever the promise does (success, normalization error, network failure,
 * cancellation). Ending twice is a safe no-op, so the response interceptor
 * can still settle it immediately for callers that bypass these helpers.
 */
async function runTrackedRequest<TResponse>(
  config: AxiosRequestConfig | undefined,
  run: (config: AxiosRequestConfig) => Promise<TResponse>,
): Promise<TResponse> {
  const tracker = new ActivityTracker();
  const requestConfig: AxiosRequestConfig = {
    ...config,
    vardenaRequestActivityTracker: tracker,
  };
  try {
    return await run(requestConfig);
  } finally {
    endRequest(tracker.token);
  }
}

/** GET helper: normalized errors, typed payload, cancellation support. */
export async function apiGet<TResponse>(
  url: string,
  config?: AxiosRequestConfig,
): Promise<TResponse> {
  const response = await runTrackedRequest(config, (requestConfig) =>
    apiClient.get<TResponse>(url, requestConfig),
  );
  return response.data;
}

/** PATCH helper: normalized errors, typed payload. */
export async function apiPatch<TResponse, TBody = unknown>(
  url: string,
  body?: TBody,
  config?: AxiosRequestConfig,
): Promise<TResponse> {
  const response = await runTrackedRequest(config, (requestConfig) =>
    apiClient.patch<TResponse>(url, body, requestConfig),
  );
  return response.data;
}

/** POST helper: normalized errors, typed payload. */
export async function apiPost<TResponse, TBody = unknown>(
  url: string,
  body?: TBody,
  config?: AxiosRequestConfig,
): Promise<TResponse> {
  const response = await runTrackedRequest(config, (requestConfig) =>
    apiClient.post<TResponse>(url, body, requestConfig),
  );
  return response.data;
}

/** DELETE helper: normalized errors, typed payload. */
export async function apiDelete<TResponse>(
  url: string,
  config?: AxiosRequestConfig,
): Promise<TResponse> {
  const response = await runTrackedRequest(config, (requestConfig) =>
    apiClient.delete<TResponse>(url, requestConfig),
  );
  return response.data;
}
