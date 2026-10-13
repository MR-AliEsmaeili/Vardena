import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { queryKeys } from '@/api/query-keys';
import { testUser } from '@/test/fixtures';
import { SessionProvider } from './session-context';
import { useSession } from './use-session';

const unauthorizedRegistration = vi.hoisted(() => ({
  handler: null as (() => void) | null,
}));

vi.mock('@/api/client', () => ({
  setUnauthorizedHandler: vi.fn((handler: (() => void) | null) => {
    unauthorizedRegistration.handler = handler;
  }),
}));

vi.mock('@/api/identity.api', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  getCurrentUser: vi.fn(),
  getEffectivePermissions: vi.fn(),
}));

const identityApi = await import('@/api/identity.api');

function SessionProbe() {
  const session = useSession();
  return (
    <>
      <span data-testid="status">{session.status}</span>
      <span data-testid="expired">{session.sessionExpired ? 'yes' : 'no'}</span>
    </>
  );
}

beforeEach(() => {
  unauthorizedRegistration.handler = null;
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions: ['Inventory.Balance.View', 'Workflow.Instance.View'],
  });
});

it('clears every previous-session query namespace when the API reports session expiry', async () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <SessionProvider>{children}</SessionProvider>
      </QueryClientProvider>
    );
  }

  render(<SessionProbe />, { wrapper: Wrapper });

  await waitFor(() => {
    expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
    expect(unauthorizedRegistration.handler).not.toBeNull();
  });

  const inventoryKey = ['inventory', 'org-1', 'balances'] as const;
  const workflowKey = ['workflow', 'org-1', 'instances'] as const;
  queryClient.setQueryData(inventoryKey, { items: ['inventory-data'] });
  queryClient.setQueryData(workflowKey, { items: ['workflow-data'] });

  expect(queryClient.getQueryData(inventoryKey)).toBeDefined();
  expect(queryClient.getQueryData(workflowKey)).toBeDefined();

  act(() => unauthorizedRegistration.handler?.());

  await waitFor(() => {
    expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
    expect(screen.getByTestId('expired')).toHaveTextContent('yes');
  });
  expect(queryClient.getQueryData(inventoryKey)).toBeUndefined();
  expect(queryClient.getQueryData(workflowKey)).toBeUndefined();
  expect(
    queryClient.getQueryData(queryKeys.effectivePermissions()),
  ).toBeUndefined();
  expect(queryClient.getQueryData(queryKeys.session())).toBeNull();
});
