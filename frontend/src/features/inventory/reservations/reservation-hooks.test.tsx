import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryKeys } from '@/api/query-keys';
import { useOrganizationId } from '@/features/organization/use-organization';
import { createTestQueryClient } from '@/test/test-utils';
import {
  useCreateReservationMutation,
  useReleaseReservationMutation,
} from './reservation-hooks';

vi.mock('@/features/organization/use-organization', () => ({
  useOrganizationId: vi.fn(() => 'org-1'),
}));
vi.mock('@/api/inventory.api', () => ({
  createReservation: vi.fn(),
  releaseReservation: vi.fn(),
}));
const api = await import('@/api/inventory.api');

function renderCreateMutation(
  queryClient: ReturnType<typeof createTestQueryClient>,
) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useCreateReservationMutation('org-1'), { wrapper });
}

function renderReleaseMutation(
  queryClient: ReturnType<typeof createTestQueryClient>,
) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useReleaseReservationMutation('org-1'), { wrapper });
}

describe('INV-08 reservation hooks', () => {
  beforeEach(() => {
    vi.mocked(useOrganizationId).mockReturnValue('org-1');
    vi.clearAllMocks();
    vi.mocked(api.createReservation).mockResolvedValue({
      id: 'res-1',
      organizationId: 'org-1',
      branchId: null,
      warehouseId: 'wh-1',
      itemId: 'item-1',
      quantity: '5',
      enteredUnitId: 'unit-1',
      baseQuantity: '5',
      baseUnitId: 'unit-1',
      conversionFactor: '1',
      status: 'active',
      referenceType: null,
      referenceId: null,
      reason: null,
      operationKey: 'op-1',
      releasedAt: null,
      releasedBy: null,
      releaseOperationKey: null,
      createdAt: '2026-01-01T08:00:00.000Z',
      updatedAt: '2026-01-01T08:00:00.000Z',
    });
    vi.mocked(api.releaseReservation).mockResolvedValue({
      id: 'res-1',
      organizationId: 'org-1',
      branchId: null,
      warehouseId: 'wh-1',
      itemId: 'item-1',
      quantity: '5',
      enteredUnitId: 'unit-1',
      baseQuantity: '5',
      baseUnitId: 'unit-1',
      conversionFactor: '1',
      status: 'released',
      referenceType: null,
      referenceId: null,
      reason: null,
      operationKey: 'op-1',
      releasedAt: '2026-01-02T08:00:00.000Z',
      releasedBy: 'usr-1',
      releaseOperationKey: 'op-2',
      createdAt: '2026-01-01T08:00:00.000Z',
      updatedAt: '2026-01-02T08:00:00.000Z',
    });
  });

  it('createReservation sends exact body and invalidates reservations, detail and balances', async () => {
    const client = createTestQueryClient();
    const invalidated = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderCreateMutation(client);

    await act(async () => {
      await result.current.mutateAsync({
        values: {
          warehouseId: 'wh-1',
          itemId: 'item-1',
          quantity: '5',
          unitId: 'unit-1',
        },
        operationKey: 'op-1',
      });
    });

    expect(api.createReservation).toHaveBeenCalledWith({
      organizationId: 'org-1',
      operationKey: 'op-1',
      warehouseId: 'wh-1',
      itemId: 'item-1',
      quantity: '5',
      unitId: 'unit-1',
    });

    for (const queryKey of [
      queryKeys.inventory.reservationsPrefix('org-1'),
      queryKeys.inventory.balancesPrefix('org-1'),
    ]) {
      expect(invalidated).toHaveBeenCalledWith({ queryKey });
    }
  });

  it('releaseReservation sends operationKey in body and invalidates the same scopes', async () => {
    const client = createTestQueryClient();
    const invalidated = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderReleaseMutation(client);

    await act(async () => {
      await result.current.mutateAsync({
        reservationId: 'res-1',
        operationKey: 'op-2',
      });
    });

    expect(api.releaseReservation).toHaveBeenCalledWith('org-1', 'res-1', {
      operationKey: 'op-2',
    });

    for (const queryKey of [
      queryKeys.inventory.reservationsPrefix('org-1'),
      queryKeys.inventory.balancesPrefix('org-1'),
    ]) {
      expect(invalidated).toHaveBeenCalledWith({ queryKey });
    }
  });
});
