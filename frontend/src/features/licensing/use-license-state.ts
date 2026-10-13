import { useQuery } from '@tanstack/react-query';
import type { LicenseState } from '@/api/contracts';
import { getLicenseState } from '@/api/licensing.api';
import { queryKeys } from '@/api/query-keys';
import { useSession } from '@/features/auth/use-session';

/**
 * The four states the licensing bootstrap stage can be in.
 *
 * They are mutually exclusive on purpose: a failed read is NOT an inactive
 * license, and an unanswered read is neither. Consumers switch on this value
 * instead of combining booleans, so no surface can accidentally treat
 * "unknown" as "inactive" (or as "active").
 */
export type LicenseBootstrapStatus =
  'loading' | 'active' | 'inactive' | 'error';

export interface LicenseStateQuery {
  status: LicenseBootstrapStatus;
  /**
   * The backend's evaluated state exactly as `GET /license/current` returned
   * it (including its `entitlements` collection), or `null` while unknown.
   * Nothing is derived, renamed or extended here — this is the only license
   * state the frontend has.
   */
  license: LicenseState | null;
  /** Transport/server failure of the license read (retryable). */
  error: unknown;
  refetch: () => void;
}

/**
 * The installation license state of the authenticated session (ADR-0030,
 * `docs/licensing-architecture.md`).
 *
 * This is the frontend's SINGLE license source: one query, one key
 * (`queryKeys.licenseState()`), fetched once per authenticated bootstrap and
 * shared by every consumer through the query cache. There is no second
 * context, no storage copy, no environment fallback and no hard-coded
 * development state — an unreachable backend is an error state, never an
 * assumed license.
 *
 * It is read-only UX routing, never enforcement: no count is compared against
 * `organizationLimit`/`userLimit` anywhere in the frontend, and the backend
 * re-evaluates the same license on every licensed capability
 * (`LicensingService`, `OrganizationsService.createOrganization`) regardless
 * of what this hook reports.
 *
 * License and permission stay separate facts: this hook answers "is this
 * installation licensed", while `GET /permissions/effective`
 * (`features/permissions/use-permissions.ts`) answers "may this user do X".
 */
export function useLicenseState(): LicenseStateQuery {
  const { status: sessionStatus } = useSession();

  const query = useQuery({
    queryKey: queryKeys.licenseState(),
    // The license read is a post-login self-read: it is never sent before a
    // session exists (the endpoint requires authentication).
    enabled: sessionStatus === 'authenticated',
    queryFn: ({ signal }) => getLicenseState(signal),
    retry: false,
    staleTime: 60_000,
  });

  // Order matters: a failure wins over stale data, and "no answer yet" is its
  // own state. `active` is taken verbatim from the backend's evaluation —
  // the frontend never re-derives it from status/dates/limits.
  const status: LicenseBootstrapStatus = query.isError
    ? 'error'
    : query.data === undefined
      ? 'loading'
      : query.data.active
        ? 'active'
        : 'inactive';

  return {
    status,
    license: query.data ?? null,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}
