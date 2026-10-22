import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import type {
  CreateDepartmentRequest,
  Department,
  DepartmentListQuery,
  UpdateDepartmentRequest,
} from '@/api/contracts';
import {
  createDepartment,
  disableDepartment,
  enableDepartment,
  getDepartment,
  listDepartments,
  updateDepartment,
} from '@/api/organization.api';
import { isOtherOrganizationScope, queryKeys } from '@/api/query-keys';
import type { AdminListState } from '@/lib/use-admin-list-state';

/**
 * Department queries and mutations (`DepartmentsController`).
 *
 * The hierarchy rules (parent must exist, belong to the same organization, be
 * active when newly assigned, and must not create a cycle) are enforced by
 * `DepartmentsService` and answered as 404/422 — this module does not
 * re-implement them. `parentDepartmentId: null` on update is the documented
 * way to detach a department from its parent.
 */

export const DEPARTMENT_DEFAULT_SORT = 'code:asc';

export function buildDepartmentListQuery(
  organizationId: string,
  state: AdminListState,
  parentDepartmentId: string,
): DepartmentListQuery {
  return {
    organizationId,
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort,
    ...(state.search.trim() !== '' ? { search: state.search.trim() } : {}),
    ...(state.isActive !== undefined ? { isActive: state.isActive } : {}),
    ...(parentDepartmentId !== '' ? { parentDepartmentId } : {}),
  };
}

export function useDepartmentList(
  organizationId: string | null,
  state: AdminListState,
  parentDepartmentId: string,
) {
  const enabled = organizationId !== null;
  const query = enabled
    ? buildDepartmentListQuery(
        organizationId as string,
        state,
        parentDepartmentId,
      )
    : null;

  return useQuery({
    queryKey: queryKeys.organizations.departmentList(
      organizationId ?? 'none',
      (query ?? {}) as Record<string, unknown>,
    ),
    queryFn: ({ signal }) =>
      listDepartments(query as DepartmentListQuery, signal),
    enabled,
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

export function useDepartmentDetail(
  organizationId: string | null,
  departmentId: string | undefined,
) {
  return useQuery({
    queryKey: queryKeys.organizations.departmentDetail(
      organizationId ?? 'none',
      departmentId ?? 'none',
    ),
    queryFn: ({ signal }) =>
      getDepartment(organizationId as string, departmentId as string, signal),
    enabled: organizationId !== null && departmentId !== undefined,
  });
}

function useDepartmentInvalidation(organizationId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient
      .invalidateQueries({
        queryKey: queryKeys.organizations.departments(organizationId),
      })
      .then(
        () => undefined,
        () => undefined,
      );
  };
}

function useDepartmentCacheUpdate(organizationId: string) {
  const queryClient = useQueryClient();
  return (department: Department) => {
    queryClient.setQueryData(
      queryKeys.organizations.departmentDetail(organizationId, department.id),
      department,
    );
  };
}

export function useCreateDepartmentMutation(
  organizationId: string,
): UseMutationResult<
  Department,
  Error,
  Omit<CreateDepartmentRequest, 'organizationId'>
> {
  const invalidate = useDepartmentInvalidation(organizationId);
  const cache = useDepartmentCacheUpdate(organizationId);
  return useMutation({
    mutationKey: ['organization', organizationId, 'departments', 'create'],
    mutationFn: (values: Omit<CreateDepartmentRequest, 'organizationId'>) =>
      createDepartment({ organizationId, ...values }),
    onSuccess: (department) => {
      cache(department);
      invalidate();
    },
  });
}

export interface UpdateDepartmentVariables {
  departmentId: string;
  values: UpdateDepartmentRequest;
}

export function useUpdateDepartmentMutation(
  organizationId: string,
): UseMutationResult<Department, Error, UpdateDepartmentVariables> {
  const invalidate = useDepartmentInvalidation(organizationId);
  const cache = useDepartmentCacheUpdate(organizationId);
  return useMutation({
    mutationKey: ['organization', organizationId, 'departments', 'update'],
    mutationFn: ({ departmentId, values }: UpdateDepartmentVariables) =>
      updateDepartment(organizationId, departmentId, values),
    onSuccess: (department) => {
      cache(department);
      invalidate();
    },
  });
}

export function useDepartmentLifecycleMutation(
  organizationId: string,
): UseMutationResult<
  Department,
  Error,
  { departmentId: string; action: 'enable' | 'disable' }
> {
  const invalidate = useDepartmentInvalidation(organizationId);
  const cache = useDepartmentCacheUpdate(organizationId);
  return useMutation({
    mutationKey: ['organization', organizationId, 'departments', 'lifecycle'],
    mutationFn: ({
      departmentId,
      action,
    }: {
      departmentId: string;
      action: 'enable' | 'disable';
    }) =>
      action === 'enable'
        ? enableDepartment(organizationId, departmentId)
        : disableDepartment(organizationId, departmentId),
    onSuccess: (department) => {
      cache(department);
      invalidate();
    },
  });
}
