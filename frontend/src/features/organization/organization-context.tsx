import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Organization } from '@/api/contracts';
import { listOrganizations } from '@/api/organization.api';
import { isOtherOrganizationScope, queryKeys } from '@/api/query-keys';
import { useSession } from '@/features/auth/use-session';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';

/**
 * The organization resolution state machine:
 *
 * - `loading` — session permissions or the organization list are still pending;
 * - `forbidden` — the session lacks `Organization.Organization.View`, so the
 *   list can never be fetched (terminal, needs an administrator);
 * - `error` — the list request failed (retryable);
 * - `empty` — the API returned no organization (terminal);
 * - `selecting` — several organizations exist and the user has not chosen one
 *   yet: no organization scope is active until they do;
 * - `invalid` — the previously confirmed selection is no longer in the list
 *   (deactivated / removed): the scope is dropped and the user re-chooses;
 * - `ready` — exactly one effective organization is active.
 */
export type OrganizationContextStatus =
  | 'loading'
  | 'selecting'
  | 'ready'
  | 'empty'
  | 'forbidden'
  | 'invalid'
  | 'error';

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

/** A selection confirmed by the user, scoped to the session's user id. */
interface ConfirmedSelection {
  userId: string;
  organizationId: string;
}

/**
 * Organization context (ADR-0021 / ADR-0025 / Task 19 ODR-3).
 *
 * The only organization discovery the API exposes to a session is
 * `GET /api/v1/organizations`, and its result is deployment-defined: a
 * deployment pinned with `DEPLOYMENT_ORGANIZATION_ID` answers with exactly
 * one organization, an unpinned one answers with the list. This provider
 * therefore does not invent a tenant model — it follows the response:
 *
 * - one organization ⇒ auto-selected, fixed context, no selection screen and
 *   no switcher rendered;
 * - several ⇒ an explicit selection is required before any scoped request is
 *   sent (`organizationId` stays `null` while unconfirmed), and the topbar
 *   switcher offers exactly the organizations the contract returned;
 * - none ⇒ `empty` — the app never enters the workspace with a fake default.
 *
 * **The selection is never authorization.** It only decides which
 * `organizationId` query parameter the scoped requests carry; the backend
 * re-asserts membership and the deployment pin on every call
 * (`OrganizationsService.assertOrganizationInScope`) and answers 404 for
 * anything out of scope. Selecting is also not persisted anywhere: no
 * localStorage, no cookie — a reload re-reads the contract, and a selection
 * is only honored for the user who made it (a different session user starts
 * from a clean slate).
 *
 * Switching organizations drops every cached query scoped to the previous
 * organization, so the old organization's data can never be displayed for
 * the new one (keys are organization-scoped anyway — the eviction is defense
 * in depth).
 */
export function OrganizationProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { status: sessionStatus, user } = useSession();
  const permissions = usePermissions();
  const [selected, setSelected] = useState<ConfirmedSelection | null>(null);

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

  // A confirmed selection only counts for the user who made it; anything
  // else (no selection yet, another session user) is treated as unselected.
  const isSelectionForCurrentUser =
    selected !== null && selected.userId === user?.id;
  const selectedOrganization = useMemo<Organization | null>(() => {
    if (!isSelectionForCurrentUser) return null;
    return (
      organizations.find((item) => item.id === selected.organizationId) ?? null
    );
  }, [isSelectionForCurrentUser, organizations, selected]);

  const organization = useMemo<Organization | null>(() => {
    if (isSelectionForCurrentUser) {
      // A confirmed selection that vanished from the list is INVALID — the
      // scope is dropped instead of silently falling back to another
      // organization the user never chose.
      return selectedOrganization;
    }
    // Unconfirmed: exactly one organization auto-selects; several require an
    // explicit choice before any scoped request is sent.
    if (organizations.length === 1) return organizations[0] ?? null;
    return null;
  }, [isSelectionForCurrentUser, selectedOrganization, organizations]);

  const selectOrganization = useCallback(
    (organizationId: string) => {
      // Only ids the API actually returned can be selected: a UI-supplied id
      // must never become a scope the app sends blindly.
      if (!organizations.some((item) => item.id === organizationId)) return;
      if (user !== null) {
        setSelected({ userId: user.id, organizationId });
      }
      // Evict the previous organization's cached server data so a switch can
      // never render (or keep warm) the old organization's read models.
      queryClient.removeQueries({
        predicate: (query) =>
          isOtherOrganizationScope(query.queryKey, organizationId),
      });
    },
    [organizations, queryClient, user],
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
            : isSelectionForCurrentUser && selectedOrganization === null
              ? 'invalid'
              : organizations.length > 1 && !isSelectionForCurrentUser
                ? 'selecting'
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
