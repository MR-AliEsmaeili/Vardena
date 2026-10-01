import { useQuery } from '@tanstack/react-query';
import { getLicenseState } from '@/api/licensing.api';
import { queryKeys } from '@/api/query-keys';
import { useSession } from '@/features/auth/use-session';

export interface LicenseStateQuery {
  /** `GET /license/current` has not answered yet. */
  loading: boolean;
  /** `true` once the backend answered with an active license. */
  active: boolean;
  /** The request failed (retryable) — distinct from `active === false`. */
  isError: boolean;
  error: unknown;
  refetch: () => void;
}

/**
 * Installation license state for the first-organization bootstrap UX only
 * (ADR-0030, `docs/licensing-architecture.md` "PR #96" note).
 *
 * This hook exists so `EmptyOrganizationState` can tell an inactive
 * installation license apart from a plain RBAC permission gap before it
 * offers the first-organization form — otherwise a session with
 * `Organization.Organization.Create` would see the generic "you lack
 * permission" explainer even when the real cause is the license, which this
 * follow-up's compatibility audit treats as a misleading message (the error
 * contract already supports a precise distinction once this state is known).
 *
 * It is read-only UX routing, never enforcement: `active` here never
 * threshold-compares a count against a limit, and
 * `OrganizationsService.createOrganization` re-evaluates the same license
 * server-side on every call regardless of what this hook reports.
 */
export function useLicenseState(): LicenseStateQuery {
  const { status: sessionStatus } = useSession();

  const query = useQuery({
    queryKey: queryKeys.licenseState(),
    queryFn: ({ signal }) => getLicenseState(signal),
    enabled: sessionStatus === 'authenticated',
    retry: false,
    staleTime: 60_000,
  });

  return {
    loading: query.isPending,
    active: query.data?.active ?? false,
    isError: query.isError,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}
