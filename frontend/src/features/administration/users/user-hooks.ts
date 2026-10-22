import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import type {
  AdminUser,
  AdminUserListQuery,
  CreateUserRequest,
  UpdateUserRequest,
} from '@/api/contracts';
import {
  createUser,
  disableUser,
  enableUser,
  getUser,
  listUsers,
  resetUserPassword,
  updateUser,
} from '@/api/admin.api';
import { queryKeys } from '@/api/query-keys';
import type { AdminListState } from '@/lib/use-admin-list-state';

/**
 * User account queries and mutations (`UsersController`).
 *
 * User records are session-global (they belong to the installation, not to
 * an organization), so the list/detail keys carry no organization id and the
 * `isOtherOrganizationScope` guard only keeps the placeholder page when the
 * PREVIOUS key was in the same organization — which for these keys is never;
 * the placeholder logic is kept uniform with every other admin list anyway.
 *
 * The list has no search parameter — the backend offers page/pageSize/sort
 * plus an active-state filter only. Sort whitelist (UsersService):
 * username | createdAt | updatedAt.
 */

/** Sort whitelist mirror — the backend rejects anything else. */
export const USER_SORT_FIELDS = ['username', 'createdAt', 'updatedAt'] as const;

export const USER_DEFAULT_SORT = 'username:asc';

export function buildUserListQuery(state: AdminListState): AdminUserListQuery {
  return {
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort,
    ...(state.isActive !== undefined ? { isActive: state.isActive } : {}),
  };
}

export function useUserList(state: AdminListState) {
  const query = buildUserListQuery(state);

  return useQuery({
    queryKey: queryKeys.users.list(query as unknown as Record<string, unknown>),
    queryFn: ({ signal }) => listUsers(query, signal),
    // User records are session-global — no organization scope, so keeping
    // the previous page visible while the next loads is always safe.
    placeholderData: (previous) => previous,
  });
}

export function useUserDetail(userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.users.detail(userId ?? 'none'),
    queryFn: ({ signal }) => getUser(userId as string, signal),
    enabled: userId !== undefined,
  });
}

function useUserInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient
      .invalidateQueries({ queryKey: queryKeys.users.prefix() })
      .then(
        () => undefined,
        () => undefined,
      );
  };
}

function useUserCacheUpdate() {
  const queryClient = useQueryClient();
  return (user: AdminUser) => {
    queryClient.setQueryData(queryKeys.users.detail(user.id), user);
  };
}

export function useCreateUserMutation(): UseMutationResult<
  AdminUser,
  Error,
  CreateUserRequest
> {
  const invalidate = useUserInvalidation();
  const cache = useUserCacheUpdate();
  return useMutation({
    mutationKey: ['users', 'create'],
    mutationFn: (values: CreateUserRequest) => createUser(values),
    onSuccess: (user) => {
      cache(user);
      invalidate();
    },
  });
}

export interface UpdateUserVariables {
  userId: string;
  values: UpdateUserRequest;
}

export function useUpdateUserMutation(): UseMutationResult<
  AdminUser,
  Error,
  UpdateUserVariables
> {
  const invalidate = useUserInvalidation();
  const cache = useUserCacheUpdate();
  return useMutation({
    mutationKey: ['users', 'update'],
    mutationFn: ({ userId, values }: UpdateUserVariables) =>
      updateUser(userId, values),
    onSuccess: (user) => {
      cache(user);
      invalidate();
    },
  });
}

export function useUserLifecycleMutation(): UseMutationResult<
  AdminUser,
  Error,
  { userId: string; action: 'enable' | 'disable' }
> {
  const invalidate = useUserInvalidation();
  const cache = useUserCacheUpdate();
  return useMutation({
    mutationKey: ['users', 'lifecycle'],
    mutationFn: ({
      userId,
      action,
    }: {
      userId: string;
      action: 'enable' | 'disable';
    }) => (action === 'enable' ? enableUser(userId) : disableUser(userId)),
    onSuccess: (user) => {
      cache(user);
      invalidate();
    },
  });
}

export function useResetUserPasswordMutation(): UseMutationResult<
  void,
  Error,
  { userId: string; newPassword: string }
> {
  const invalidate = useUserInvalidation();
  return useMutation({
    mutationKey: ['users', 'reset-password'],
    mutationFn: ({
      userId,
      newPassword,
    }: {
      userId: string;
      newPassword: string;
    }) => resetUserPassword(userId, { newPassword }),
    onSuccess: () => {
      invalidate();
    },
  });
}
