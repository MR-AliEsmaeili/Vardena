import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import type {
  CreateEmployeeRequest,
  Employee,
  EmployeeListQuery,
  UpdateEmployeeRequest,
} from '@/api/contracts';
import {
  createEmployee,
  disableEmployee,
  enableEmployee,
  getEmployee,
  listEmployees,
  updateEmployee,
} from '@/api/organization.api';
import { isOtherOrganizationScope, queryKeys } from '@/api/query-keys';
import type { AdminListState } from '@/lib/use-admin-list-state';

/**
 * Employee queries and mutations (`EmployeesController`).
 *
 * The contract is deliberately minimal reference data (OQ-32): code, names,
 * optional department and branch, `is_active`. There is no `userId` field in
 * any employee DTO — linking an employee to a login account is unresolved
 * (OQ-37), so nothing here fabricates one.
 */

export const EMPLOYEE_DEFAULT_SORT = 'employeeCode:asc';

export interface EmployeeExtraFilters {
  departmentId: string;
  branchId: string;
}

export function buildEmployeeListQuery(
  organizationId: string,
  state: AdminListState,
  filters: EmployeeExtraFilters,
): EmployeeListQuery {
  return {
    organizationId,
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort,
    ...(state.search.trim() !== '' ? { search: state.search.trim() } : {}),
    ...(state.isActive !== undefined ? { isActive: state.isActive } : {}),
    ...(filters.departmentId !== ''
      ? { departmentId: filters.departmentId }
      : {}),
    ...(filters.branchId !== '' ? { branchId: filters.branchId } : {}),
  };
}

export function useEmployeeList(
  organizationId: string | null,
  state: AdminListState,
  filters: EmployeeExtraFilters,
) {
  const enabled = organizationId !== null;
  const query = enabled
    ? buildEmployeeListQuery(organizationId as string, state, filters)
    : null;

  return useQuery({
    queryKey: queryKeys.organizations.employeeList(
      organizationId ?? 'none',
      (query ?? {}) as Record<string, unknown>,
    ),
    queryFn: ({ signal }) => listEmployees(query as EmployeeListQuery, signal),
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

export function useEmployeeDetail(
  organizationId: string | null,
  employeeId: string | undefined,
) {
  return useQuery({
    queryKey: queryKeys.organizations.employeeDetail(
      organizationId ?? 'none',
      employeeId ?? 'none',
    ),
    queryFn: ({ signal }) =>
      getEmployee(organizationId as string, employeeId as string, signal),
    enabled: organizationId !== null && employeeId !== undefined,
  });
}

function useEmployeeInvalidation(organizationId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient
      .invalidateQueries({
        queryKey: queryKeys.organizations.employees(organizationId),
      })
      .then(
        () => undefined,
        () => undefined,
      );
  };
}

function useEmployeeCacheUpdate(organizationId: string) {
  const queryClient = useQueryClient();
  return (employee: Employee) => {
    queryClient.setQueryData(
      queryKeys.organizations.employeeDetail(organizationId, employee.id),
      employee,
    );
  };
}

export function useCreateEmployeeMutation(
  organizationId: string,
): UseMutationResult<
  Employee,
  Error,
  Omit<CreateEmployeeRequest, 'organizationId'>
> {
  const invalidate = useEmployeeInvalidation(organizationId);
  const cache = useEmployeeCacheUpdate(organizationId);
  return useMutation({
    mutationKey: ['organization', organizationId, 'employees', 'create'],
    mutationFn: (values: Omit<CreateEmployeeRequest, 'organizationId'>) =>
      createEmployee({ organizationId, ...values }),
    onSuccess: (employee) => {
      cache(employee);
      invalidate();
    },
  });
}

export interface UpdateEmployeeVariables {
  employeeId: string;
  values: UpdateEmployeeRequest;
}

export function useUpdateEmployeeMutation(
  organizationId: string,
): UseMutationResult<Employee, Error, UpdateEmployeeVariables> {
  const invalidate = useEmployeeInvalidation(organizationId);
  const cache = useEmployeeCacheUpdate(organizationId);
  return useMutation({
    mutationKey: ['organization', organizationId, 'employees', 'update'],
    mutationFn: ({ employeeId, values }: UpdateEmployeeVariables) =>
      updateEmployee(organizationId, employeeId, values),
    onSuccess: (employee) => {
      cache(employee);
      invalidate();
    },
  });
}

export function useEmployeeLifecycleMutation(
  organizationId: string,
): UseMutationResult<
  Employee,
  Error,
  { employeeId: string; action: 'enable' | 'disable' }
> {
  const invalidate = useEmployeeInvalidation(organizationId);
  const cache = useEmployeeCacheUpdate(organizationId);
  return useMutation({
    mutationKey: ['organization', organizationId, 'employees', 'lifecycle'],
    mutationFn: ({
      employeeId,
      action,
    }: {
      employeeId: string;
      action: 'enable' | 'disable';
    }) =>
      action === 'enable'
        ? enableEmployee(organizationId, employeeId)
        : disableEmployee(organizationId, employeeId),
    onSuccess: (employee) => {
      cache(employee);
      invalidate();
    },
  });
}
