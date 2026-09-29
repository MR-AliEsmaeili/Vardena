import { useQuery } from '@tanstack/react-query';
import {
  listAccountingDocuments,
  listInventoryBalances,
  listWorkflowInstances,
} from '@/api/dashboard.api';
import { queryKeys } from '@/api/query-keys';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import type { DashboardScope } from './use-dashboard-scope';
import { fetchAllAccountBalances } from './fetch-all-balances';

/**
 * Dashboard query hooks.
 *
 * Each hook is disabled until the organization is known AND the session
 * holds the backend permission of the endpoint (UX gating, AR-21) — a
 * guaranteed 403 is never sent. Query keys carry the organization id and
 * the exact parameter object, so an organization switch or a filter change
 * can never serve another window's cache.
 *
 * Every hook returns its query spread together with `isPermitted`: a
 * DISABLED query is not a pending one, and the UI must be able to render an
 * honest "capability not available" state instead of an eternal skeleton.
 * While the effective permissions are still loading the answer is unknown —
 * `isPermitted` then reads true so the widget keeps its loading shape, and
 * `enabled` still blocks any request until the codes have arrived.
 */

function knownPermitted(
  permissions: ReturnType<typeof usePermissions>,
  code: string,
): boolean {
  return permissions.loaded ? permissions.has(code) : true;
}

export function useDashboardBalances(
  organizationId: string | null,
  scope: DashboardScope | null,
) {
  const permissions = usePermissions();
  const isPermitted = knownPermitted(
    permissions,
    PERMISSIONS.accounting.balanceView,
  );
  const enabled =
    organizationId !== null &&
    scope !== null &&
    permissions.loaded &&
    isPermitted;

  const query = useQuery({
    queryKey: queryKeys.accounting.accountBalances(organizationId ?? 'none', {
      organizationId,
      financialAreaId: scope?.financialAreaId,
      fiscalYearId: scope?.fiscalYearId,
    }),
    queryFn: ({ signal }) => {
      if (organizationId === null || scope === null) {
        throw new Error('balances query executed without scope');
      }
      return fetchAllAccountBalances({ organizationId, scope }, signal);
    },
    enabled,
    staleTime: 30_000,
  });

  return { ...query, isPermitted };
}

/** The most recent accounting documents of the organization (server-paged). */
export function useDashboardDocuments(
  organizationId: string | null,
  page: number,
  pageSize: number,
  sort: string | undefined,
) {
  const permissions = usePermissions();
  const isPermitted = knownPermitted(
    permissions,
    PERMISSIONS.accounting.documentView,
  );
  const enabled = organizationId !== null && permissions.loaded && isPermitted;

  const query = useQuery({
    queryKey: queryKeys.accounting.accountingDocuments(
      organizationId ?? 'none',
      {
        organizationId,
        page,
        pageSize,
        sort,
      },
    ),
    queryFn: ({ signal }) => {
      if (organizationId === null) {
        throw new Error('documents query executed without organization');
      }
      return listAccountingDocuments(
        {
          organizationId,
          page,
          pageSize,
          ...(sort === undefined ? {} : { sort }),
        },
        signal,
      );
    },
    enabled,
    placeholderData: (previous) => previous,
  });

  return { ...query, isPermitted };
}

/** Scarcest inventory balances, ascending on-hand (server-ordered). */
export function useDashboardInventory(organizationId: string | null) {
  const permissions = usePermissions();
  const isPermitted = knownPermitted(
    permissions,
    PERMISSIONS.inventory.balanceView,
  );
  const enabled = organizationId !== null && permissions.loaded && isPermitted;

  const query = useQuery({
    queryKey: queryKeys.inventory.balances(organizationId ?? 'none', {
      organizationId,
      page: 1,
      pageSize: 10,
      sort: 'onHand:asc',
    }),
    queryFn: ({ signal }) =>
      listInventoryBalances(
        {
          organizationId: organizationId as string,
          page: 1,
          pageSize: 10,
          sort: 'onHand:asc',
        },
        signal,
      ),
    enabled,
    staleTime: 30_000,
  });

  return { ...query, isPermitted };
}

/** Workflow bindings (instances) of the organization — display only. */
export function useDashboardWorkflow(organizationId: string | null) {
  const permissions = usePermissions();
  const isPermitted = knownPermitted(
    permissions,
    PERMISSIONS.workflow.instanceView,
  );
  const enabled = organizationId !== null && permissions.loaded && isPermitted;

  const query = useQuery({
    queryKey: queryKeys.workflow.instances(organizationId ?? 'none', {
      organizationId,
      page: 1,
      pageSize: 10,
      sort: 'createdAt:desc',
    }),
    queryFn: ({ signal }) =>
      listWorkflowInstances(
        {
          organizationId: organizationId as string,
          page: 1,
          pageSize: 10,
          sort: 'createdAt:desc',
        },
        signal,
      ),
    enabled,
    staleTime: 30_000,
  });

  return { ...query, isPermitted };
}
