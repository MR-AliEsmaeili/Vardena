import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import type {
  ImportLicenseRevocationRequest,
  LicenseRevocationImportResult,
} from '@/api/contracts';
import { importLicenseRevocation } from '@/api/licensing.api';
import { queryKeys } from '@/api/query-keys';

/**
 * Signed revocation import (`POST /api/v1/license/revocations/import`,
 * OD-LIC-17).
 *
 * The rule is the same one the license import hook enforces, for the same
 * reason: **a successful POST is not a state**. The receipt is discarded and
 * the canonical `GET /license/current` query is invalidated and awaited, so
 * the gate, the status card and every permission decision keep reading the
 * backend's evaluated state. This matters more here than anywhere else — a
 * revocation turns the installation license off, and believing a receipt
 * instead of the state would be inventing an outcome the backend owns.
 *
 * `isPending` stays true across both requests (the invalidation is awaited
 * inside `onSuccess`), so the submit button cannot race the confirmation.
 *
 * The artifact itself lives only in the `variables` of one in-flight mutation:
 * no query cache entry, no `localStorage`, no URL, no log — and `gcTime: 0`
 * drops the variables as soon as it settles.
 */
export function useImportLicenseRevocationMutation(): UseMutationResult<
  LicenseRevocationImportResult,
  Error,
  ImportLicenseRevocationRequest
> {
  const queryClient = useQueryClient();

  return useMutation({
    // The key identifies the operation, never the document.
    mutationKey: ['licensing', 'license', 'revocations', 'import'],
    mutationFn: (request: ImportLicenseRevocationRequest) =>
      importLicenseRevocation(request),
    // Mutations are never auto-retried (standards §6): a retry is the operator
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
