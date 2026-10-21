import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import type {
  AdminRoleDetail,
  AdminRoleListQuery,
  CreateRoleRequest,
  UpdateRoleRequest,
} from '@/api/contracts';
import {
  assignRolePermission,
  assignUserToRole,
  createRole,
  getRole,
  listPermissions,
  listRoles,
  removeRolePermission,
  removeUserFromRole,
  updateRole,
} from '@/api/admin.api';
import { queryKeys } from '@/api/query-keys';
import type { AdminListState } from '@/lib/use-admin-list-state';

/**
 * Role queries and mutations (`RolesController`, `PermissionsController`).
 *
 * Role records are session-global like user records. The permission
 * REGISTRY read is a separate, separately-authorized catalog
 * (`Rbac.Permission.View`) that the role editor reads with a bounded page
 * size. The backend offers NO read of the role↔user assignments — the
 * assign/remove mutations below answer 409/404 when they do not apply, and
 * the UI reports exactly that.
 *
 * Sort whitelists (services): roles name|createdAt|updatedAt; registry
 * code|createdAt.
 */

export const ROLE_SORT_FIELDS = ['name', 'createdAt', 'updatedAt'] as const;
export const ROLE_DEFAULT_SORT = 'name:asc';

export const PERMISSION_SORT_FIELDS = ['code', 'createdAt'] as const;
export const PERMISSION_DEFAULT_SORT = 'code:asc';

/** Bounded registry read for pickers (the admin-references pattern). */
export const PERMISSION_REGISTRY_PAGE_SIZE = 200;

export function buildRoleListQuery(state: AdminListState): AdminRoleListQuery {
  return {
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort,
  };
}

export function useRoleList(state: AdminListState) {
  const query = buildRoleListQuery(state);

  return useQuery({
    queryKey: queryKeys.rbac.roleList(
      query as unknown as Record<string, unknown>,
    ),
    queryFn: ({ signal }) => listRoles(query, signal),
  });
}

export function useRoleDetail(roleId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.rbac.roleDetail(roleId ?? 'none'),
    queryFn: ({ signal }) => getRole(roleId as string, signal),
    enabled: roleId !== undefined,
  });
}

/**
 * The permission registry, read once per editor session with the bounded
 * page size; `enabled` stays caller-owned so the read only runs for a
 * surface that can actually use it.
 */
export function usePermissionRegistry(enabled = true) {
  return useQuery({
    queryKey: queryKeys.rbac.permissionList({
      reference: 'active',
      pageSize: PERMISSION_REGISTRY_PAGE_SIZE,
    }),
    queryFn: ({ signal }) =>
      listPermissions(
        {
          page: 1,
          pageSize: PERMISSION_REGISTRY_PAGE_SIZE,
          sort: PERMISSION_DEFAULT_SORT,
        },
        signal,
      ),
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}

function useRolesInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient
      .invalidateQueries({ queryKey: queryKeys.rbac.rolesPrefix() })
      .then(
        () => undefined,
        () => undefined,
      );
  };
}

function useRoleCacheUpdate() {
  const queryClient = useQueryClient();
  return (role: AdminRoleDetail) => {
    queryClient.setQueryData(queryKeys.rbac.roleDetail(role.id), role);
  };
}

export function useCreateRoleMutation(): UseMutationResult<
  AdminRoleDetail,
  Error,
  CreateRoleRequest
> {
  const invalidate = useRolesInvalidation();
  const cache = useRoleCacheUpdate();
  return useMutation({
    mutationKey: ['rbac', 'roles', 'create'],
    mutationFn: (values: CreateRoleRequest) => createRole(values),
    onSuccess: (role) => {
      cache(role);
      invalidate();
    },
  });
}

export interface UpdateRoleVariables {
  roleId: string;
  values: UpdateRoleRequest;
}

export function useUpdateRoleMutation(): UseMutationResult<
  AdminRoleDetail,
  Error,
  UpdateRoleVariables
> {
  const invalidate = useRolesInvalidation();
  const cache = useRoleCacheUpdate();
  return useMutation({
    mutationKey: ['rbac', 'roles', 'update'],
    mutationFn: ({ roleId, values }: UpdateRoleVariables) =>
      updateRole(roleId, values),
    onSuccess: (role) => {
      cache(role);
      invalidate();
    },
  });
}

/** Assign one permission to the role (204; 409 when already assigned). */
export function useAssignRolePermissionMutation(): UseMutationResult<
  void,
  Error,
  { roleId: string; code: string }
> {
  const invalidate = useRolesInvalidation();
  return useMutation({
    mutationKey: ['rbac', 'roles', 'assign-permission'],
    mutationFn: ({ roleId, code }: { roleId: string; code: string }) =>
      assignRolePermission(roleId, code),
    onSuccess: () => {
      invalidate();
    },
  });
}

/** Remove one permission from the role (204; 404 when not assigned). */
export function useRemoveRolePermissionMutation(): UseMutationResult<
  void,
  Error,
  { roleId: string; code: string }
> {
  const invalidate = useRolesInvalidation();
  return useMutation({
    mutationKey: ['rbac', 'roles', 'remove-permission'],
    mutationFn: ({ roleId, code }: { roleId: string; code: string }) =>
      removeRolePermission(roleId, code),
    onSuccess: () => {
      invalidate();
    },
  });
}

/** Assign the role to a user (204; 409 when already assigned). */
export function useAssignUserToRoleMutation(): UseMutationResult<
  void,
  Error,
  { roleId: string; userId: string }
> {
  const invalidate = useRolesInvalidation();
  return useMutation({
    mutationKey: ['rbac', 'roles', 'assign-user'],
    mutationFn: ({ roleId, userId }: { roleId: string; userId: string }) =>
      assignUserToRole(roleId, userId),
    onSuccess: () => {
      invalidate();
    },
  });
}

/** Remove the role from a user (204; 404 when not assigned). */
export function useRemoveUserFromRoleMutation(): UseMutationResult<
  void,
  Error,
  { roleId: string; userId: string }
> {
  const invalidate = useRolesInvalidation();
  return useMutation({
    mutationKey: ['rbac', 'roles', 'remove-user'],
    mutationFn: ({ roleId, userId }: { roleId: string; userId: string }) =>
      removeUserFromRole(roleId, userId),
    onSuccess: () => {
      invalidate();
    },
  });
}
