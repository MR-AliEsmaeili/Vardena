import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios';
import { normalizeApiError, type ApiError } from './errors';

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

apiClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    const apiError = normalizeApiError(error);
    const failed = error as AxiosError | undefined;
    const config: InternalAxiosRequestConfig | undefined =
      failed?.config ??
      (failed?.response?.config as InternalAxiosRequestConfig | undefined);

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

/** GET helper: normalized errors, typed payload, cancellation support. */
export async function apiGet<TResponse>(
  url: string,
  config?: AxiosRequestConfig,
): Promise<TResponse> {
  const response = await apiClient.get<TResponse>(url, config);
  return response.data;
}

/** PATCH helper: normalized errors, typed payload. */
export async function apiPatch<TResponse, TBody = unknown>(
  url: string,
  body?: TBody,
  config?: AxiosRequestConfig,
): Promise<TResponse> {
  const response = await apiClient.patch<TResponse>(url, body, config);
  return response.data;
}

/** POST helper: normalized errors, typed payload. */
export async function apiPost<TResponse, TBody = unknown>(
  url: string,
  body?: TBody,
  config?: AxiosRequestConfig,
): Promise<TResponse> {
  const response = await apiClient.post<TResponse>(url, body, config);
  return response.data;
}

/** DELETE helper: normalized errors, typed payload. */
export async function apiDelete<TResponse>(
  url: string,
  config?: AxiosRequestConfig,
): Promise<TResponse> {
  const response = await apiClient.delete<TResponse>(url, config);
  return response.data;
}
