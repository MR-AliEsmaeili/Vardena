import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  render,
  type RenderOptions,
  type RenderResult,
} from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter, type InitialEntry } from 'react-router-dom';
import { SessionProvider } from '@/features/auth/session-context';
import { OrganizationProvider } from '@/features/organization/organization-context';
import { ToastProvider } from '@/ui/patterns/toast';

/**
 * Test helpers.
 *
 * Tests exercise the REAL providers (session, organization, query client) and
 * stub only the `src/api/*` modules, so the behavior under test is the
 * application's own state machine rather than a re-implementation of it.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export interface RenderAppOptions extends Omit<RenderOptions, 'wrapper'> {
  queryClient?: QueryClient;
  /** Router entry strings or objects (path + pre-seeded `location.state`). */
  initialEntries?: InitialEntry[];
  /** Include the session + organization providers (default: true). */
  withProviders?: boolean;
}

export function renderWithProviders(
  ui: ReactElement,
  options: RenderAppOptions = {},
): RenderResult & { queryClient: QueryClient } {
  const {
    queryClient = createTestQueryClient(),
    initialEntries = ['/'],
    withProviders = true,
    ...renderOptions
  } = options;

  function Wrapper({ children }: { children: ReactNode }) {
    const routed = (
      <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
    );
    return (
      <QueryClientProvider client={queryClient}>
        {withProviders ? (
          <SessionProvider>
            <OrganizationProvider>
              <ToastProvider>{routed}</ToastProvider>
            </OrganizationProvider>
          </SessionProvider>
        ) : (
          routed
        )}
      </QueryClientProvider>
    );
  }

  return {
    ...render(ui, { wrapper: Wrapper, ...renderOptions }),
    queryClient,
  };
}
