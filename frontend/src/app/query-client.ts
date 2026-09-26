import { QueryClient } from '@tanstack/react-query';
import { isTerminalApiError } from '@/api/errors';

/**
 * The application's single TanStack Query client (AR-28).
 *
 * Server state lives here — there is no global client store (Redux/Zustand/…
 * are forbidden by ADR-0002). Retries never fight the backend: a 401/403/404
 * or a validation/business-rule failure is a final answer and is not retried.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) =>
          !isTerminalApiError(error) && failureCount < 2,
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
