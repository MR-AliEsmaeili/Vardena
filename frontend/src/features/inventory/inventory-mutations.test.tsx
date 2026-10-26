import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/api/query-keys';
import { createTestQueryClient } from '@/test/test-utils';
import { useReverseMovementMutation } from './inventory-mutations';

vi.mock('@/api/inventory.api', () => ({ reverseInventoryMovement: vi.fn() }));
const api = await import('@/api/inventory.api');

describe('INV-01 reversal invalidation', () => {
  it('sends a scoped reversal and refreshes movements, Kardex, balances and valuation states', async () => {
    const client = createTestQueryClient();
    const invalidated = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useReverseMovementMutation('org-1'), {
      wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({
        movementId: 'mv-1',
        operationKey: 'key',
        values: { movementDate: '2026-10-26' },
      });
    });
    expect(api.reverseInventoryMovement).toHaveBeenCalledWith('org-1', 'mv-1', {
      operationKey: 'key',
      movementDate: '2026-10-26',
    });
    for (const queryKey of [
      queryKeys.inventory.movementsPrefix('org-1'),
      queryKeys.inventory.kardexPrefix('org-1'),
      queryKeys.inventory.balancesPrefix('org-1'),
      queryKeys.inventory.valuationStatesPrefix('org-1'),
    ])
      expect(invalidated).toHaveBeenCalledWith({ queryKey });
  });
});
