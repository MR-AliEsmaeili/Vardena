import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import {
  createFinancialArea,
  disableFinancialArea,
  enableFinancialArea,
  getFinancialArea,
  updateFinancialArea,
} from '@/api/accounting.api';
import type {
  CreateFinancialAreaRequest,
  FinancialArea,
  UpdateFinancialAreaRequest,
} from '@/api/contracts';
import { queryKeys } from '@/api/query-keys';

/**
 * Financial-area administration queries and mutations (ACC-01,
 * `FinancialAreasController`).
 *
 * Contract rules implemented here:
 * - every key and every request carries the organization id, so an
 *   organization switch can never serve another organization's areas;
 * - mutations are never optimistic and never auto-retried; the server's own
 *   response is written into the detail cache;
 * - after every confirmed mutation, the financial-area prefix is invalidated
 *   (administration lists and details live under it) AND the
 *   `financialAreas` reference read plus the financial-context gate read are
 *   invalidated, so pickers and the context switcher never keep offering a
 *   disabled area or a stale default. `financialAreaPrefix` and
 *   `financialAreas` currently resolve to the same tuple; both are
 *   invalidated explicitly so the two consumers stay correct even if one
 *   key shape ever moves.
 * - the "only one default" rule is NOT reimplemented here: setting a default
 *   sends `isDefault: true` and the backend clears the previous default in
 *   its own transaction; the invalidations above then re-read the truth.
 */

export function useFinancialAreaDetail(
  organizationId: string | null,
  financialAreaId: string | undefined,
) {
  return useQuery({
    queryKey: queryKeys.accounting.financialAreaDetail(
      organizationId ?? 'none',
      financialAreaId ?? 'none',
    ),
    queryFn: ({ signal }) =>
      getFinancialArea(
        organizationId as string,
        financialAreaId as string,
        signal,
      ),
    enabled: organizationId !== null && financialAreaId !== undefined,
  });
}

/** Refresh every financial-area read of this organization after a mutation. */
function useFinancialAreaInvalidation(organizationId: string) {
  const queryClient = useQueryClient();
  return () => {
    const invalidate = (queryKey: readonly unknown[]) => {
      void queryClient.invalidateQueries({ queryKey }).then(
        () => undefined,
        () => undefined,
      );
    };
    invalidate(queryKeys.accounting.financialAreaPrefix(organizationId));
    invalidate(queryKeys.accounting.financialAreas(organizationId));
    invalidate(queryKeys.accounting.financialContextAreas(organizationId));
  };
}

function useFinancialAreaCacheUpdate(organizationId: string) {
  const queryClient = useQueryClient();
  return (area: FinancialArea) => {
    queryClient.setQueryData(
      queryKeys.accounting.financialAreaDetail(organizationId, area.id),
      area,
    );
  };
}

export function useCreateFinancialAreaMutation(
  organizationId: string,
): UseMutationResult<
  FinancialArea,
  Error,
  Omit<CreateFinancialAreaRequest, 'organizationId'>
> {
  const invalidate = useFinancialAreaInvalidation(organizationId);
  const cache = useFinancialAreaCacheUpdate(organizationId);
  return useMutation({
    mutationKey: ['accounting', organizationId, 'financial-areas', 'create'],
    mutationFn: (values: Omit<CreateFinancialAreaRequest, 'organizationId'>) =>
      createFinancialArea({ organizationId, ...values }),
    onSuccess: (area) => {
      cache(area);
      invalidate();
    },
  });
}

export function useUpdateFinancialAreaMutation(
  organizationId: string,
  financialAreaId: string,
): UseMutationResult<FinancialArea, Error, UpdateFinancialAreaRequest> {
  const invalidate = useFinancialAreaInvalidation(organizationId);
  const cache = useFinancialAreaCacheUpdate(organizationId);
  return useMutation({
    mutationKey: [
      'accounting',
      organizationId,
      'financial-areas',
      'update',
      financialAreaId,
    ],
    mutationFn: (body: UpdateFinancialAreaRequest) =>
      updateFinancialArea(organizationId, financialAreaId, body),
    onSuccess: (area) => {
      cache(area);
      invalidate();
    },
  });
}

export interface FinancialAreaLifecycleVariables {
  id: string;
  next: 'enable' | 'disable';
}

/**
 * Enable / disable. There is no delete endpoint for financial areas — the
 * lifecycle is the `is_active` flag, exactly like the backend contract.
 */
export function useFinancialAreaLifecycleMutation(
  organizationId: string,
): UseMutationResult<FinancialArea, Error, FinancialAreaLifecycleVariables> {
  const invalidate = useFinancialAreaInvalidation(organizationId);
  const cache = useFinancialAreaCacheUpdate(organizationId);
  return useMutation({
    mutationKey: ['accounting', organizationId, 'financial-areas', 'lifecycle'],
    mutationFn: ({ id, next }: FinancialAreaLifecycleVariables) =>
      next === 'enable'
        ? enableFinancialArea(organizationId, id)
        : disableFinancialArea(organizationId, id),
    onSuccess: (area) => {
      cache(area);
      invalidate();
    },
  });
}
