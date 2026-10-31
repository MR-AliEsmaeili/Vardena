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
  useApproveMaterialRequestMutation,
  useCancelMaterialRequestMutation,
  useCreateMaterialRequestMutation,
  useDeleteMaterialRequestMutation,
  useRejectMaterialRequestMutation,
  useReturnMaterialRequestForCorrectionMutation,
  useReverseMaterialRequestApprovalMutation,
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
  approveMaterialRequest: vi.fn(),
  rejectMaterialRequest: vi.fn(),
  returnMaterialRequestForCorrection: vi.fn(),
  reverseMaterialRequestApproval: vi.fn(),
  cancelMaterialRequest: vi.fn(),
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
  const balancesKey = queryKeys.inventory.balancesPrefix('org-1');
  const reservationsKey = queryKeys.inventory.reservationsPrefix('org-1');
  queryClient.setQueryData(listKey, materialRequestsResponse());
  queryClient.setQueryData(detailKey, materialRequestDetail());
  queryClient.setQueryData(eventsKey, []);
  queryClient.setQueryData(balancesKey, []);
  queryClient.setQueryData(reservationsKey, []);

  return {
    queryClient,
    Wrapper,
    listKey,
    detailKey,
    eventsKey,
    balancesKey,
    reservationsKey,
  };
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

  it('approve sends NO body and also invalidates the availability reads', async () => {
    vi.mocked(inventoryApi.approveMaterialRequest).mockResolvedValue(
      materialRequestDetail({ status: 'approved', number: 'MR-1404-0001' }),
    );
    const {
      queryClient,
      Wrapper,
      listKey,
      detailKey,
      eventsKey,
      balancesKey,
      reservationsKey,
    } = setup();

    const { result } = renderHook(
      () => useApproveMaterialRequestMutation('org-1'),
      { wrapper: Wrapper },
    );
    await act(async () => {
      await result.current.mutateAsync('request-1');
    });

    // Exactly (organizationId, requestId): the endpoint declares no body.
    expect(
      vi.mocked(inventoryApi.approveMaterialRequest).mock.calls[0],
    ).toHaveLength(2);
    expect(inventoryApi.approveMaterialRequest).toHaveBeenCalledWith(
      'org-1',
      'request-1',
    );
    expectInvalidated(queryClient, [
      listKey,
      detailKey,
      eventsKey,
      balancesKey,
      reservationsKey,
    ]);
    queryClient.clear();
  });

  it('reject sends the required reason and leaves stock reads alone', async () => {
    vi.mocked(inventoryApi.rejectMaterialRequest).mockResolvedValue(
      materialRequestDetail({ status: 'rejected' }),
    );
    const { queryClient, Wrapper, listKey, detailKey, eventsKey, balancesKey } =
      setup();

    const { result } = renderHook(
      () => useRejectMaterialRequestMutation('org-1'),
      { wrapper: Wrapper },
    );
    await act(async () => {
      await result.current.mutateAsync({
        requestId: 'request-1',
        reason: 'مقدار اشتباه',
      });
    });

    expect(inventoryApi.rejectMaterialRequest).toHaveBeenCalledWith(
      'org-1',
      'request-1',
      { reason: 'مقدار اشتباه' },
    );
    expectInvalidated(queryClient, [listKey, detailKey, eventsKey]);
    expect(queryClient.getQueryState(balancesKey)?.isInvalidated).toBe(false);
    queryClient.clear();
  });

  it('return-for-correction sends the required reason', async () => {
    vi.mocked(
      inventoryApi.returnMaterialRequestForCorrection,
    ).mockResolvedValue(materialRequestDetail({ status: 'returned' }));
    const { queryClient, Wrapper, listKey, detailKey, eventsKey } = setup();

    const { result } = renderHook(
      () => useReturnMaterialRequestForCorrectionMutation('org-1'),
      { wrapper: Wrapper },
    );
    await act(async () => {
      await result.current.mutateAsync({
        requestId: 'request-1',
        reason: 'ردیف اصلاح شود',
      });
    });

    expect(
      inventoryApi.returnMaterialRequestForCorrection,
    ).toHaveBeenCalledWith('org-1', 'request-1', { reason: 'ردیف اصلاح شود' });
    expectInvalidated(queryClient, [listKey, detailKey, eventsKey]);
    queryClient.clear();
  });

  it('reverse-approval sends an optional reason (null) and releases availability', async () => {
    vi.mocked(inventoryApi.reverseMaterialRequestApproval).mockResolvedValue(
      materialRequestDetail({ status: 'submitted' }),
    );
    const {
      queryClient,
      Wrapper,
      listKey,
      detailKey,
      eventsKey,
      balancesKey,
      reservationsKey,
    } = setup();

    const { result } = renderHook(
      () => useReverseMaterialRequestApprovalMutation('org-1'),
      { wrapper: Wrapper },
    );
    await act(async () => {
      await result.current.mutateAsync({ requestId: 'request-1' });
    });

    expect(inventoryApi.reverseMaterialRequestApproval).toHaveBeenCalledWith(
      'org-1',
      'request-1',
      { reason: null },
    );
    expectInvalidated(queryClient, [
      listKey,
      detailKey,
      eventsKey,
      balancesKey,
      reservationsKey,
    ]);
    queryClient.clear();
  });

  it('cancel sends an optional reason and also invalidates availability', async () => {
    vi.mocked(inventoryApi.cancelMaterialRequest).mockResolvedValue(
      materialRequestDetail({ status: 'cancelled' }),
    );
    const {
      queryClient,
      Wrapper,
      listKey,
      detailKey,
      eventsKey,
      balancesKey,
      reservationsKey,
    } = setup();

    const { result } = renderHook(
      () => useCancelMaterialRequestMutation('org-1'),
      { wrapper: Wrapper },
    );
    await act(async () => {
      await result.current.mutateAsync({
        requestId: 'request-1',
        reason: '  توقف تولید  ',
      });
    });

    // The hook passes the reason through untouched; the PAGE trims it.
    expect(inventoryApi.cancelMaterialRequest).toHaveBeenCalledWith(
      'org-1',
      'request-1',
      { reason: '  توقف تولید  ' },
    );
    expectInvalidated(queryClient, [
      listKey,
      detailKey,
      eventsKey,
      balancesKey,
      reservationsKey,
    ]);
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
