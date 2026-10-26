import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/api/query-keys';
import { createTestQueryClient } from '@/test/test-utils';
import {
  useAccountLifecycleMutation,
  useUnlinkAccountDetailGroupMutation,
  useUpdateAccountMutation,
} from './account-admin-hooks';

vi.mock('@/api/accounting.api', () => ({
  updateAccount: vi.fn(),
  enableAccount: vi.fn(),
  disableAccount: vi.fn(),
  unlinkAccountDetailGroup: vi.fn(),
}));
const api = await import('@/api/accounting.api');
const org = 'org-1';
const id = 'account-1';
function setup() {
  const client = createTestQueryClient();
  const invalidated = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidated };
}
function expectRefresh(invalidated: ReturnType<typeof setup>['invalidated']) {
  expect(invalidated).toHaveBeenCalledWith({
    queryKey: queryKeys.accounting.accountPrefix(org),
  });
  expect(invalidated).toHaveBeenCalledWith({
    queryKey: queryKeys.accounting.chartTree(org),
  });
}

describe('account administration mutations', () => {
  it('updates a scoped account and refreshes the list/detail and chart', async () => {
    const { wrapper, invalidated } = setup();
    const { result } = renderHook(() => useUpdateAccountMutation(org, id), {
      wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({ title: 'جدید' });
    });
    expect(api.updateAccount).toHaveBeenCalledWith(org, id, { title: 'جدید' });
    expectRefresh(invalidated);
  });
  it('transitions active state via distinct backend endpoints', async () => {
    const { wrapper, invalidated } = setup();
    const { result } = renderHook(() => useAccountLifecycleMutation(org, id), {
      wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync('disable');
    });
    expect(api.disableAccount).toHaveBeenCalledWith(org, id);
    await act(async () => {
      await result.current.mutateAsync('enable');
    });
    expect(api.enableAccount).toHaveBeenCalledWith(org, id);
    expectRefresh(invalidated);
  });
  it('sends the explicit confirmation body and refreshes chart', async () => {
    const { wrapper, invalidated } = setup();
    const { result } = renderHook(
      () => useUnlinkAccountDetailGroupMutation(org, id),
      { wrapper },
    );
    await act(async () => {
      await result.current.mutateAsync();
    });
    expect(api.unlinkAccountDetailGroup).toHaveBeenCalledWith(org, id, {
      confirmUnlink: true,
    });
    expectRefresh(invalidated);
  });
});
