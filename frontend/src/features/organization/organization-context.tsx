import { useQuery } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Organization } from '@/api/contracts';
import { listOrganizations } from '@/api/organization.api';
import { queryKeys } from '@/api/query-keys';
import { useSession } from '@/features/auth/use-session';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';

export type OrganizationContextStatus =
  'loading' | 'ready' | 'empty' | 'forbidden' | 'error';

export interface OrganizationContextValue {
  /** Organizations the API returned for this session (never invented). */
  organizations: readonly Organization[];
  /** The organization every scoped request is sent with. */
  organization: Organization | null;
  organizationId: string | null;
  status: OrganizationContextStatus;
  error: unknown;
  /** True only when the API actually offers more than one organization. */
  canSwitch: boolean;
  selectOrganization: (organizationId: string) => void;
  refresh: () => void;
}

export const OrganizationContext =
  createContext<OrganizationContextValue | null>(null);

/**
 * Organization context (ADR-0021 / ADR-0025 / Task 19 ODR-3).
 *
 * The only organization discovery the API exposes to a session is
 * `GET /api/v1/organizations`, and its result is deployment-defined: a
 * deployment pinned with `DEPLOYMENT_ORGANIZATION_ID` answers with exactly
 * one organization, an unpinned one answers with the list. This provider
 * therefore does not invent a tenant model — it follows the response:
 *
 * - one organization ⇒ fixed context, no switcher rendered;
 * - several ⇒ the switcher offers exactly those, using the existing contract.
 *
 * **The selection is never authorization.** It only decides which
 * `organizationId` query parameter the scoped requests carry; the backend
 * re-asserts membership and the deployment pin on every call
 * (`OrganizationsService.assertOrganizationInScope`) and answers 404 for
 * anything out of scope. Selecting is also not persisted anywhere: no
 * localStorage, no cookie — a reload re-reads the contract.
 */
export function OrganizationProvider({ children }: { children: ReactNode }) {
  const { status: sessionStatus } = useSession();
  const permissions = usePermissions();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const canReadOrganizations =
    permissions.loaded && permissions.has(PERMISSIONS.organization.view);

  const organizationsQuery = useQuery({
    queryKey: queryKeys.organizations.list({ isActive: true }),
    queryFn: ({ signal }) => listOrganizations({ isActive: true }, signal),
    enabled: sessionStatus === 'authenticated' && canReadOrganizations,
    retry: false,
    staleTime: 5 * 60_000,
  });

  const organizations = useMemo<readonly Organization[]>(
    () => organizationsQuery.data?.items ?? [],
    [organizationsQuery.data],
  );

  const organization = useMemo<Organization | null>(() => {
    if (organizations.length === 0) return null;
    const selected = organizations.find((item) => item.id === selectedId);
    return selected ?? organizations[0] ?? null;
  }, [organizations, selectedId]);

  const selectOrganization = useCallback(
    (organizationId: string) => {
      // Only ids the API actually returned can be selected: a UI-supplied id
      // must never become a scope the app sends blindly.
      if (organizations.some((item) => item.id === organizationId)) {
        setSelectedId(organizationId);
      }
    },
    [organizations],
  );

  const refresh = useCallback(() => {
    void organizationsQuery.refetch();
  }, [organizationsQuery]);

  const status: OrganizationContextStatus = !permissions.loaded
    ? 'loading'
    : !canReadOrganizations
      ? 'forbidden'
      : organizationsQuery.isPending
        ? 'loading'
        : organizationsQuery.isError
          ? 'error'
          : organizations.length === 0
            ? 'empty'
            : 'ready';

  const value = useMemo<OrganizationContextValue>(
    () => ({
      organizations,
      organization,
      organizationId: organization?.id ?? null,
      status,
      error: organizationsQuery.error,
      canSwitch: organizations.length > 1,
      selectOrganization,
      refresh,
    }),
    [
      organizations,
      organization,
      status,
      organizationsQuery.error,
      selectOrganization,
      refresh,
    ],
  );

  return (
    <OrganizationContext.Provider value={value}>
      {children}
    </OrganizationContext.Provider>
  );
}
