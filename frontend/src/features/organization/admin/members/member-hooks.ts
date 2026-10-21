import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import type {
  OrganizationMembership,
  OrganizationMembersListQuery,
} from '@/api/contracts';
import {
  grantMembership,
  listOrganizationMembers,
  revokeOrganizationMembership,
} from '@/api/organization.api';
import { queryKeys } from '@/api/query-keys';
import type { AdminListState } from '@/lib/use-admin-list-state';

/**
 * Organization membership queries and mutations
 * (`OrganizationMembershipsController`).
 *
 * The rows carry USER ids only — resolving them to usernames is the UI's
 * job and only possible with `Users.User.View` (the backend offers no
 * joined read). The list endpoint declares a `sort` parameter without a
 * documented whitelist; the default stays the server's own order.
 *
 * These keys ARE organization-scoped: the placeholder logic
 * (`isOtherOrganizationScope`) keeps a previous organization's page visible
 * while the next organization loads.
 */

export function buildMemberListQuery(
  state: AdminListState,
): OrganizationMembersListQuery {
  return {
    page: state.page,
    pageSize: state.pageSize,
    ...(state.sort !== '' ? { sort: state.sort } : {}),
  };
}

export function useOrganizationMembersList(
  organizationId: string | null,
  state: AdminListState,
) {
  const query = buildMemberListQuery(state);

  return useQuery({
    queryKey: queryKeys.organizations.memberList(
      organizationId ?? 'none',
      query as unknown as Record<string, unknown>,
    ),
    queryFn: ({ signal }) =>
      listOrganizationMembers(organizationId as string, query, signal),
    enabled: organizationId !== null,
  });
}

function useMembersInvalidation(organizationId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient
      .invalidateQueries({
        queryKey: queryKeys.organizations.members(organizationId),
      })
      .then(
        () => undefined,
        () => undefined,
      );
  };
}

/** Grant one user access to the organization (204; 409 = already a member). */
export function useGrantMembershipMutation(
  organizationId: string,
): UseMutationResult<void, Error, { userId: string }> {
  const invalidate = useMembersInvalidation(organizationId);
  return useMutation({
    mutationKey: ['organization', organizationId, 'members', 'grant'],
    mutationFn: ({ userId }: { userId: string }) =>
      grantMembership(organizationId, { userId }),
    onSuccess: () => {
      invalidate();
    },
  });
}

/** Revoke one member's access (204; 404 = not a member). */
export function useRevokeMembershipMutation(
  organizationId: string,
): UseMutationResult<void, Error, { userId: string }> {
  const invalidate = useMembersInvalidation(organizationId);
  return useMutation({
    mutationKey: ['organization', organizationId, 'members', 'revoke'],
    mutationFn: ({ userId }: { userId: string }) =>
      revokeOrganizationMembership(organizationId, userId),
    onSuccess: () => {
      invalidate();
    },
  });
}

export type OrganizationMembersPageRow = OrganizationMembership;
