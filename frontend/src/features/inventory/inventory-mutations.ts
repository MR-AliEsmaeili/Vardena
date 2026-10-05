import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import type {
  InventoryMovement,
  InventoryTransferResult,
  PostInventoryMovementInput,
  PostInventoryTransferInput,
  RecalculationResult,
} from '@/api/contracts';
import {
  postInventoryMovement,
  postInventoryTransfer,
  recalculateInventoryValuation,
} from '@/api/inventory.api';
import { queryKeys } from '@/api/query-keys';

/**
 * Inventory mutations (warehouse operations + the one valuation command).
 *
 * Contract rules implemented here:
 * - **No optimistic updates.** These are inventory/financial facts; the UI
 *   reflects only what the backend confirmed (standards.md §6).
 * - **No auto-retry.** A manual retry reuses the same `operationKey` so the
 *   backend replays the stored operation instead of applying it twice. The
 *   backdating answers (`backdateConfirmed`/`repricing`) are excluded from
 *   the backend's request hash on purpose, so resubmitting the same form
 *   with the user's explicit decision is still the SAME intent.
 * - **Targeted invalidation.** A posting refreshes the movement ledger, the
 *   stock balances, the Kardex and the valuation worklist of THIS
 *   organization — nothing else is evicted.
 */

/** A fresh client idempotency key for one operation intent. */
export function newInventoryOperationKey(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return `inv-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function useInventoryReadsInvalidation(organizationId: string) {
  const queryClient = useQueryClient();
  return () => {
    const prefixes = [
      queryKeys.inventory.movementsPrefix(organizationId),
      queryKeys.inventory.balancesPrefix(organizationId),
      queryKeys.inventory.kardexPrefix(organizationId),
      queryKeys.inventory.valuationStatesPrefix(organizationId),
    ];
    void Promise.all(
      prefixes.map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }).then(
          () => undefined,
          () => undefined,
        ),
      ),
    );
  };
}

export interface PostMovementVariables {
  values: Omit<PostInventoryMovementInput, 'organizationId' | 'operationKey'>;
  operationKey: string;
}

export function usePostMovementMutation(
  organizationId: string,
): UseMutationResult<InventoryMovement, Error, PostMovementVariables> {
  const invalidate = useInventoryReadsInvalidation(organizationId);
  return useMutation({
    mutationKey: ['inventory', organizationId, 'movements', 'create'],
    mutationFn: ({ values, operationKey }: PostMovementVariables) =>
      postInventoryMovement({
        organizationId,
        operationKey,
        ...values,
      }),
    onSuccess: () => invalidate(),
  });
}

export interface PostTransferVariables {
  values: Omit<PostInventoryTransferInput, 'organizationId' | 'operationKey'>;
  operationKey: string;
}

export function usePostTransferMutation(
  organizationId: string,
): UseMutationResult<InventoryTransferResult, Error, PostTransferVariables> {
  const invalidate = useInventoryReadsInvalidation(organizationId);
  return useMutation({
    mutationKey: ['inventory', organizationId, 'transfers', 'create'],
    mutationFn: ({ values, operationKey }: PostTransferVariables) =>
      postInventoryTransfer({
        organizationId,
        operationKey,
        ...values,
      }),
    onSuccess: () => invalidate(),
  });
}

export interface RecalculateVariables {
  warehouseId: string;
  itemId: string;
  operationKey: string;
}

/**
 * The explicit, bounded repricing command for ONE item in ONE warehouse
 * (OD-VAL-12: there is no «قیمت‌گذاری مجدد همه» anywhere in the UI).
 */
export function useRecalculateMutation(
  organizationId: string,
): UseMutationResult<RecalculationResult, Error, RecalculateVariables> {
  const invalidate = useInventoryReadsInvalidation(organizationId);
  return useMutation({
    mutationKey: ['inventory', organizationId, 'valuation', 'recalculate'],
    mutationFn: ({ warehouseId, itemId, operationKey }: RecalculateVariables) =>
      recalculateInventoryValuation({
        organizationId,
        warehouseId,
        itemId,
        operationKey,
        trigger: 'manual',
        reason:
          'Recalculation requested from the inventory valuation UI (stale key).',
      }),
    onSuccess: () => invalidate(),
  });
}
