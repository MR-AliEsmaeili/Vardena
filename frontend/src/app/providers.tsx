import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { SessionProvider } from '@/features/auth/session-context';
import { OrganizationProvider } from '@/features/organization/organization-context';
import { createQueryClient } from './query-client';

export interface AppProvidersProps {
  children: ReactNode;
  /** Injected by tests; the app creates its own client. */
  queryClient?: QueryClient;
}

/**
 * Provider composition: query client → session → organization context.
 * The order matters: the organization context depends on the session and on
 * its effective permissions.
 */
export function AppProviders({ children, queryClient }: AppProvidersProps) {
  const [client] = useState(() => queryClient ?? createQueryClient());

  return (
    <QueryClientProvider client={client}>
      <SessionProvider>
        <OrganizationProvider>{children}</OrganizationProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
