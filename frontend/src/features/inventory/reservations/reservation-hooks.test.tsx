import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/api/query-keys';
import { reservation, reservationsResponse } from './reservation-test-fixtures';
import {
  useCreateReservationMutation,
  useReleaseReservationMutation,
} from './reservation-hooks';

vi.mock('@/api/inventory.api', () => ({
  listReservations: vi.fn(),
  getReservation: vi.fn(),
  createReservation: vi.fn(),
  releaseReservation: vi.fn(),
}));

const inventoryApi = await import('@/api/inventory.api');

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 10_000 },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  return { queryClient, Wrapper };
}

beforeEach(() => vi.resetAllMocks());

describe('reservation mutations', () => {
  it('create posts the body key and invalidates reservation list/detail and balances', async () => {
    const created = reservation({ id: 'res-created' });
    vi.mocked(inventoryApi.createReservation).mockResolvedValue(created);
    const { queryClient, Wrapper } = setup();
    const listKey = queryKeys.inventory.reservations('org-1', {
      organizationId: 'org-1',
      page: 1,
      pageSize: 50,
    });
    const detailKey = queryKeys.inventory.reservationDetail(
      'org-1',
      created.id,
    );
    const balancesKey = queryKeys.inventory.balances('org-1', {
      organizationId: 'org-1',
      page: 1,
      pageSize: 50,
    });
    queryClient.setQueryData(listKey, reservationsResponse());
    queryClient.setQueryData(detailKey, created);
    queryClient.setQueryData(balancesKey, []);

    const { result } = renderHook(() => useCreateReservationMutation('org-1'), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({
        warehouseId: 'wh-1',
        itemId: 'item-1',
        quantity: '2.5000',
        unitId: 'unit-1',
        operationKey: 'op-create',
      });
    });

    expect(inventoryApi.createReservation).toHaveBeenCalledWith({
      organizationId: 'org-1',
      warehouseId: 'wh-1',
      itemId: 'item-1',
      quantity: '2.5000',
      unitId: 'unit-1',
      operationKey: 'op-create',
    });
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(balancesKey)?.isInvalidated).toBe(true);
    queryClient.clear();
  });

  it('release sends its operation key in the body and invalidates the affected detail and balance', async () => {
    const released = reservation({
      status: 'released',
      releasedAt: '2026-10-26T09:00:00.000Z',
      releaseOperationKey: 'op-release',
    });
    vi.mocked(inventoryApi.releaseReservation).mockResolvedValue(released);
    const { queryClient, Wrapper } = setup();
    const listKey = queryKeys.inventory.reservations('org-1', {
      organizationId: 'org-1',
      page: 1,
      pageSize: 50,
    });
    const detailKey = queryKeys.inventory.reservationDetail('org-1', 'res-1');
    const balancesKey = queryKeys.inventory.balances('org-1', {
      organizationId: 'org-1',
      page: 1,
      pageSize: 50,
    });
    queryClient.setQueryData(listKey, reservationsResponse());
    queryClient.setQueryData(detailKey, reservation());
    queryClient.setQueryData(balancesKey, []);

    const { result } = renderHook(
      () => useReleaseReservationMutation('org-1'),
      { wrapper: Wrapper },
    );
    await act(async () => {
      await result.current.mutateAsync({
        reservationId: 'res-1',
        body: { operationKey: 'op-release' },
      });
    });

    expect(inventoryApi.releaseReservation).toHaveBeenCalledWith(
      'org-1',
      'res-1',
      { operationKey: 'op-release' },
    );
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(balancesKey)?.isInvalidated).toBe(true);
    queryClient.clear();
  });
});
