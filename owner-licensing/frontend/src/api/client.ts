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
 * The single Axios instance of the application (AR-28).
 *
 * Authentication follows the actual backend contract (ADR-0007):
 * opaque httpOnly session cookie. withCredentials is on; no token is kept
 * in JavaScript or storage.
 */

const DEFAULT_BASE_URL = '/api/v1';

export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL?.trim() || DEFAULT_BASE_URL;

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

export function setUnauthorizedHandler(
  handler: UnauthorizedHandler | null,
): void {
  unauthorizedHandler = handler;
}

export const expectedUnauthorizedPaths = [
  '/auth/login',
  '/auth/logout',
  '/auth/me',
  '/auth/change-password',
] as const;

export function isExpectedUnauthorized(url: string): boolean {
  return expectedUnauthorizedPaths.some((path) => url.startsWith(path));
}

function expectsUnauthorized(config: InternalAxiosRequestConfig): boolean {
  return isExpectedUnauthorized(config.url ?? '');
}

export const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: { Accept: 'application/json', 'x-owner-request': '1' },
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

export async function apiGet<TResponse>(
  url: string,
  config?: AxiosRequestConfig,
): Promise<TResponse> {
  const response = await runTrackedRequest(config, (requestConfig) =>
    apiClient.get<TResponse>(url, requestConfig),
  );
  return response.data;
}

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

export async function apiDelete<TResponse>(
  url: string,
  config?: AxiosRequestConfig,
): Promise<TResponse> {
  const response = await runTrackedRequest(config, (requestConfig) =>
    apiClient.delete<TResponse>(url, requestConfig),
  );
  return response.data;
}
