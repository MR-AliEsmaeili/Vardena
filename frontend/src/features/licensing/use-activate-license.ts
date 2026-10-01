import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import type {
  ActivateLicenseRequest,
  LicenseActivationResult,
} from '@/api/contracts';
import { activateLicense } from '@/api/licensing.api';
import { queryKeys } from '@/api/query-keys';

/**
 * Installation license activation (`POST /api/v1/license/activate`, L-02).
 *
 * The one rule this hook exists to enforce: **a successful POST is not an
 * active license**. The mutation never writes the activation response into
 * `queryKeys.licenseState()` and never flips any local flag; it invalidates
 * the single canonical license query and waits for `GET /license/current` to
 * answer again, so the gate releases only on a state the backend re-evaluated
 * and persisted. If that re-read fails, the license query owns the failure
 * (retryable error state) and the application stays blocked — the safe
 * outcome.
 *
 * Because the invalidation is awaited inside `onSuccess`, `isPending` stays
 * true across both requests: the submit button cannot be pressed again while
 * the authoritative state is still being confirmed.
 *
 * The raw code lives only in the `variables` of one in-flight mutation. It is
 * not stored in a query cache entry (the mutation cache is in-memory and
 * never persisted — no `PersistQueryClientProvider` exists in this app), not
 * logged, and not put in any URL: `gcTime: 0` additionally drops the
 * mutation's variables as soon as it settles.
 */
export function useActivateLicenseMutation(): UseMutationResult<
  LicenseActivationResult,
  Error,
  ActivateLicenseRequest
> {
  const queryClient = useQueryClient();

  return useMutation({
    // No variables, no code: the key identifies the operation only.
    mutationKey: ['licensing', 'license', 'activate'],
    mutationFn: (request: ActivateLicenseRequest) => activateLicense(request),
    // Mutations are never auto-retried (standards §6): a retry is the user
    // submitting again.
    retry: false,
    gcTime: 0,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.licenseState(),
        refetchType: 'all',
      });
    },
  });
}
