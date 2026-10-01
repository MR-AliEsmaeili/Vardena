import { useQuery } from '@tanstack/react-query';
import { listBranches, listDepartments } from '@/api/organization.api';
import { queryKeys } from '@/api/query-keys';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';

/**
 * Reference reads behind the pickers of this feature (a department's parent,
 * an employee's department and branch).
 *
 * Three rules are encoded here:
 * - each list is gated by the backend permission of its own endpoint, so a
 *   session that clearly cannot read branches never sends a guaranteed 403;
 * - the query key carries the organization id, so a scope switch can never
 *   offer another organization's branches as options;
 * - the window is BOUNDED (`REFERENCE_PAGE_SIZE`). These endpoints are
 *   server-paginated and nothing here fetches "everything" to filter it in
 *   the browser; when the organization has more records than one window, the
 *   form says so instead of silently showing a partial list as if complete.
 *
 * Only ACTIVE records are offered: the services refuse an inactive
 * department/branch reference with a 422 (`requireUsable…InOrganization`),
 * so offering one would be offering a guaranteed failure.
 */

export const REFERENCE_PAGE_SIZE = 200;

export interface ReferenceOptions<TItem> {
  items: TItem[];
  /** True when the organization holds more records than the window shows. */
  truncated: boolean;
  isPending: boolean;
  /** True when the session may not read this reference list at all. */
  unavailable: boolean;
}

export function useActiveBranchOptions(organizationId: string | null) {
  const permissions = usePermissions();
  const allowed = permissions.has(PERMISSIONS.organization.branchView);
  const query = useQuery({
    queryKey: queryKeys.organizations.branchList(organizationId ?? 'none', {
      reference: 'active',
    }),
    queryFn: ({ signal }) =>
      listBranches(
        {
          organizationId: organizationId as string,
          isActive: true,
          page: 1,
          pageSize: REFERENCE_PAGE_SIZE,
          sort: 'code:asc',
        },
        signal,
      ),
    enabled: organizationId !== null && permissions.loaded && allowed,
    staleTime: 5 * 60_000,
  });

  const items = query.data?.items ?? [];
  return {
    items,
    truncated: (query.data?.total ?? 0) > items.length,
    isPending: query.isPending && query.fetchStatus !== 'idle',
    unavailable: (permissions.loaded && !allowed) || query.isError,
  };
}

export function useActiveDepartmentOptions(organizationId: string | null) {
  const permissions = usePermissions();
  const allowed = permissions.has(PERMISSIONS.organization.departmentView);
  const query = useQuery({
    queryKey: queryKeys.organizations.departmentList(organizationId ?? 'none', {
      reference: 'active',
    }),
    queryFn: ({ signal }) =>
      listDepartments(
        {
          organizationId: organizationId as string,
          isActive: true,
          page: 1,
          pageSize: REFERENCE_PAGE_SIZE,
          sort: 'code:asc',
        },
        signal,
      ),
    enabled: organizationId !== null && permissions.loaded && allowed,
    staleTime: 5 * 60_000,
  });

  const items = query.data?.items ?? [];
  return {
    items,
    truncated: (query.data?.total ?? 0) > items.length,
    isPending: query.isPending && query.fetchStatus !== 'idle',
    unavailable: (permissions.loaded && !allowed) || query.isError,
  };
}
