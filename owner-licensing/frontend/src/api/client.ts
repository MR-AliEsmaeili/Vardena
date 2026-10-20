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

export interface RequestActivityOptions {
  scope?: RequestActivityScope | 'silent';
  message?: RequestActivityMessage;
}

export interface RequestActivityTracker {
  token?: number;
}

class ActivityTracker implements RequestActivityTracker {
  token?: number;
}

declare module 'axios' {
  interface AxiosRequestConfig {
    vardenaRequestActivity?: RequestActivityOptions;
    vardenaRequestActivityTracker?: RequestActivityTracker;
  }

  interface InternalAxiosRequestConfig {
    vardenaRequestActivityToken?: number;
  }
}

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

/**
 * Requests whose 401 is an expected answer, not an ended session.
 *
 * `POST /auth/change-password` belongs here because the Owner API answers 401
 * `Unauthorized` for **two different facts** on that route: the session has ended,
 * or the submitted current password was rejected ("Invalid current password.").
 * A status code cannot tell them apart, and this layer must not guess: treating a
 * rejected credential as an ended session would clear every cached server value
 * and send the operator to `/login` with a false "session expired" notice.
 * The caller asks the session instead (`SessionProvider.verifySessionAlive`, which
 * re-reads `GET /auth/me`) and reports only the cause it could verify.
 */
export const expectedUnauthorizedPaths = [
  '/auth/login',
  '/auth/logout',
  '/auth/me',
  '/auth/change-password',
] as const;

/** True when a 401 from this request must not be reported as an ended session. */
export function isExpectedUnauthorized(url: string): boolean {
  return expectedUnauthorizedPaths.some((path) => url.startsWith(path));
}

function expectsUnauthorized(config: InternalAxiosRequestConfig): boolean {
  return isExpectedUnauthorized(config.url ?? '');
}

export const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  // Session cookie transport (ADR-0007). Required for the cookie to travel.
  withCredentials: true,
  headers: { Accept: 'application/json', 'x-owner-request': '1' },
  // Query parameters stay scalar; unset optional filters are omitted.
  paramsSerializer: {
    indexes: null,
  },
});

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

    endTrackedRequest(config);

    const apiError = normalizeApiError(error);

    if (
      apiError.isUnauthorized &&
      unauthorizedHandler !== null &&
      (config === undefined || !expectsUnauthorized(config))
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
