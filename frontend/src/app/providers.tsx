import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { SessionProvider } from '@/features/auth/session-context';
import { OrganizationProvider } from '@/features/organization/organization-context';
import { ToastProvider } from '@/ui/patterns/toast';
import { createQueryClient } from './query-client';

export interface AppProvidersProps {
  children: ReactNode;
  /** Injected by tests; the app creates its own client. */
  queryClient?: QueryClient;
}

/**
 * Provider composition: query client → session → organization context →
 * toasts. The order matters: the organization context depends on the session
 * and on its effective permissions; the toast channel sits last so every
 * feature under it can announce completed mutations.
 */
export function AppProviders({ children, queryClient }: AppProvidersProps) {
  const [client] = useState(() => queryClient ?? createQueryClient());

  return (
    <QueryClientProvider client={client}>
      <SessionProvider>
        <OrganizationProvider>
          <ToastProvider>{children}</ToastProvider>
        </OrganizationProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
