import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/api/query-keys';
import {
  materialRequestDetail,
  materialRequestsResponse,
} from './material-request-test-fixtures';
import {
  useCreateMaterialRequestMutation,
  useDeleteMaterialRequestMutation,
  useSubmitMaterialRequestMutation,
  useUpdateMaterialRequestMutation,
} from './material-request-hooks';

vi.mock('@/api/inventory.api', () => ({
  listMaterialRequests: vi.fn(),
  getMaterialRequest: vi.fn(),
  listMaterialRequestEvents: vi.fn(),
  createMaterialRequest: vi.fn(),
  updateMaterialRequest: vi.fn(),
  deleteMaterialRequest: vi.fn(),
  submitMaterialRequest: vi.fn(),
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
  const listKey = queryKeys.inventory.materialRequests('org-1', {
    organizationId: 'org-1',
    page: 1,
    pageSize: 50,
  });
  const detailKey = queryKeys.inventory.materialRequestDetail(
    'org-1',
    'request-1',
  );
  const eventsKey = queryKeys.inventory.materialRequestEvents(
    'org-1',
    'request-1',
  );
  queryClient.setQueryData(listKey, materialRequestsResponse());
  queryClient.setQueryData(detailKey, materialRequestDetail());
  queryClient.setQueryData(eventsKey, []);

  return { queryClient, Wrapper, listKey, detailKey, eventsKey };
}

function expectInvalidated(
  queryClient: QueryClient,
  keys: readonly (readonly unknown[])[],
) {
  for (const key of keys) {
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
  }
}

beforeEach(() => vi.resetAllMocks());

describe('material request mutations', () => {
  it('create sends the organization in the body and invalidates list, detail and events', async () => {
    vi.mocked(inventoryApi.createMaterialRequest).mockResolvedValue(
      materialRequestDetail({ id: 'request-1' }),
    );
    const { queryClient, Wrapper, listKey, detailKey, eventsKey } = setup();

    const { result } = renderHook(
      () => useCreateMaterialRequestMutation('org-1'),
      { wrapper: Wrapper },
    );
    await act(async () => {
      await result.current.mutateAsync({
        description: 'خط تولید',
        lines: [
          {
            itemId: 'item-1',
            warehouseId: 'wh-1',
            quantity: '5.0000',
            unitId: 'unit-1',
            reservationRequested: true,
          },
        ],
      });
    });

    expect(inventoryApi.createMaterialRequest).toHaveBeenCalledWith({
      organizationId: 'org-1',
      description: 'خط تولید',
      lines: [
        {
          itemId: 'item-1',
          warehouseId: 'wh-1',
          quantity: '5.0000',
          unitId: 'unit-1',
          reservationRequested: true,
        },
      ],
    });
    expectInvalidated(queryClient, [listKey, detailKey, eventsKey]);
    queryClient.clear();
  });

  it('update keeps the request id in the path and the organization in the query', async () => {
    vi.mocked(inventoryApi.updateMaterialRequest).mockResolvedValue(
      materialRequestDetail(),
    );
    const { queryClient, Wrapper, listKey, detailKey, eventsKey } = setup();

    const { result } = renderHook(
      () => useUpdateMaterialRequestMutation('org-1'),
      { wrapper: Wrapper },
    );
    await act(async () => {
      await result.current.mutateAsync({
        requestId: 'request-1',
        body: { description: null, lines: [] },
      });
    });

    expect(inventoryApi.updateMaterialRequest).toHaveBeenCalledWith(
      'org-1',
      'request-1',
      { description: null, lines: [] },
    );
    expectInvalidated(queryClient, [listKey, detailKey, eventsKey]);
    queryClient.clear();
  });

  it('submit is a command with no body and invalidates the request reads', async () => {
    vi.mocked(inventoryApi.submitMaterialRequest).mockResolvedValue(
      materialRequestDetail({ status: 'submitted', number: 'MR-1404-0001' }),
    );
    const { queryClient, Wrapper, listKey, detailKey, eventsKey } = setup();

    const { result } = renderHook(
      () => useSubmitMaterialRequestMutation('org-1'),
      { wrapper: Wrapper },
    );
    await act(async () => {
      await result.current.mutateAsync('request-1');
    });

    expect(inventoryApi.submitMaterialRequest).toHaveBeenCalledWith(
      'org-1',
      'request-1',
    );
    expectInvalidated(queryClient, [listKey, detailKey, eventsKey]);
    queryClient.clear();
  });

  it('delete invalidates the reads it removes from the server', async () => {
    vi.mocked(inventoryApi.deleteMaterialRequest).mockResolvedValue(undefined);
    const { queryClient, Wrapper, listKey, detailKey, eventsKey } = setup();

    const { result } = renderHook(
      () => useDeleteMaterialRequestMutation('org-1'),
      { wrapper: Wrapper },
    );
    await act(async () => {
      await result.current.mutateAsync('request-1');
    });

    expect(inventoryApi.deleteMaterialRequest).toHaveBeenCalledWith(
      'org-1',
      'request-1',
    );
    expectInvalidated(queryClient, [listKey, detailKey, eventsKey]);
    queryClient.clear();
  });
});
