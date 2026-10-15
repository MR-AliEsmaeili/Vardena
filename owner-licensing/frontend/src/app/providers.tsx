import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { SessionProvider } from '@/features/auth/session-context';
import { ToastProvider } from '@/ui/patterns/toast';
import { createQueryClient } from './query-client';

export interface AppProvidersProps {
  children: ReactNode;
  queryClient?: QueryClient;
}

export function AppProviders({ children, queryClient }: AppProvidersProps) {
  const [client] = useState(() => queryClient ?? createQueryClient());

  return (
    <QueryClientProvider client={client}>
      <SessionProvider>
        <ToastProvider>{children}</ToastProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
