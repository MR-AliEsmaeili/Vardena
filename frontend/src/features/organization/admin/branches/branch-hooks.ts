import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import type {
  Branch,
  BranchListQuery,
  CreateBranchRequest,
  UpdateBranchRequest,
} from '@/api/contracts';
import {
  createBranch,
  disableBranch,
  enableBranch,
  getBranch,
  listBranches,
  updateBranch,
} from '@/api/organization.api';
import { isOtherOrganizationScope, queryKeys } from '@/api/query-keys';
import type { AdminListState } from '@/lib/use-admin-list-state';

/**
 * Branch queries and mutations (`BranchesController`).
 *
 * Contract rules implemented here:
 * - paging, sorting and filtering are SERVER side; this module only forwards
 *   the declared query parameters;
 * - every key and every request carries the organization id, so an
 *   organization switch can never serve another organization's branches;
 * - mutations are never optimistic and are never auto-retried; the server's
 *   own response is written into the detail cache and the branches prefix is
 *   invalidated (lists, detail and the reference picker all live under it).
 */

export const BRANCH_DEFAULT_SORT = 'code:asc';

export function buildBranchListQuery(
  organizationId: string,
  state: AdminListState,
): BranchListQuery {
  return {
    organizationId,
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort,
    ...(state.search.trim() !== '' ? { search: state.search.trim() } : {}),
    ...(state.isActive !== undefined ? { isActive: state.isActive } : {}),
  };
}

export function useBranchList(
  organizationId: string | null,
  state: AdminListState,
) {
  const enabled = organizationId !== null;
  const query = enabled
    ? buildBranchListQuery(organizationId as string, state)
    : null;

  return useQuery({
    queryKey: queryKeys.organizations.branchList(
      organizationId ?? 'none',
      (query ?? {}) as Record<string, unknown>,
    ),
    queryFn: ({ signal }) => listBranches(query as BranchListQuery, signal),
    enabled,
    // Keep the previous page visible while the next one loads — but only
    // inside the SAME organization.
    placeholderData: (previous, previousQuery) =>
      previousQuery !== undefined &&
      !isOtherOrganizationScope(
        previousQuery.queryKey,
        organizationId ?? 'none',
      )
        ? previous
        : undefined,
  });
}

export function useBranchDetail(
  organizationId: string | null,
  branchId: string | undefined,
) {
  return useQuery({
    queryKey: queryKeys.organizations.branchDetail(
      organizationId ?? 'none',
      branchId ?? 'none',
    ),
    queryFn: ({ signal }) =>
      getBranch(organizationId as string, branchId as string, signal),
    enabled: organizationId !== null && branchId !== undefined,
  });
}

/** Refresh every branch list, detail and picker of this organization. */
function useBranchInvalidation(organizationId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient
      .invalidateQueries({
        queryKey: queryKeys.organizations.branches(organizationId),
      })
      .then(
        () => undefined,
        () => undefined,
      );
  };
}

function useBranchCacheUpdate(organizationId: string) {
  const queryClient = useQueryClient();
  return (branch: Branch) => {
    queryClient.setQueryData(
      queryKeys.organizations.branchDetail(organizationId, branch.id),
      branch,
    );
  };
}

export function useCreateBranchMutation(
  organizationId: string,
): UseMutationResult<
  Branch,
  Error,
  Omit<CreateBranchRequest, 'organizationId'>
> {
  const invalidate = useBranchInvalidation(organizationId);
  const cache = useBranchCacheUpdate(organizationId);
  return useMutation({
    mutationKey: ['organization', organizationId, 'branches', 'create'],
    mutationFn: (values: Omit<CreateBranchRequest, 'organizationId'>) =>
      createBranch({ organizationId, ...values }),
    onSuccess: (branch) => {
      cache(branch);
      invalidate();
    },
  });
}

export interface UpdateBranchVariables {
  branchId: string;
  values: UpdateBranchRequest;
}

export function useUpdateBranchMutation(
  organizationId: string,
): UseMutationResult<Branch, Error, UpdateBranchVariables> {
  const invalidate = useBranchInvalidation(organizationId);
  const cache = useBranchCacheUpdate(organizationId);
  return useMutation({
    mutationKey: ['organization', organizationId, 'branches', 'update'],
    mutationFn: ({ branchId, values }: UpdateBranchVariables) =>
      updateBranch(organizationId, branchId, values),
    onSuccess: (branch) => {
      cache(branch);
      invalidate();
    },
  });
}

/**
 * Enable / disable. There is no delete endpoint for branches — the lifecycle
 * is the `is_active` flag (master-data-strategy.md §7.4).
 */
export function useBranchLifecycleMutation(
  organizationId: string,
): UseMutationResult<
  Branch,
  Error,
  { branchId: string; action: 'enable' | 'disable' }
> {
  const invalidate = useBranchInvalidation(organizationId);
  const cache = useBranchCacheUpdate(organizationId);
  return useMutation({
    mutationKey: ['organization', organizationId, 'branches', 'lifecycle'],
    mutationFn: ({
      branchId,
      action,
    }: {
      branchId: string;
      action: 'enable' | 'disable';
    }) =>
      action === 'enable'
        ? enableBranch(organizationId, branchId)
        : disableBranch(organizationId, branchId),
    onSuccess: (branch) => {
      cache(branch);
      invalidate();
    },
  });
}
