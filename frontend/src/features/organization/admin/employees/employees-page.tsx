import type { ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import type { Employee } from '@/api/contracts';
import { EMPLOYEE_SORT_FIELDS } from '@/api/organization.api';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PermissionGate } from '@/features/permissions/permission-gate';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { Select } from '@/ui/select';
import { DataTable } from '@/ui/patterns/data-table';
import { PageHeader } from '@/ui/patterns/page-header';
import {
  useActiveBranchOptions,
  useActiveDepartmentOptions,
} from '../admin-references';
import { ActiveBadge, AdminFilters } from '../admin-ui';
import {
  ADMIN_PAGE_SIZE_OPTIONS,
  useAdminListState,
} from '../admin-list-state';
import { EMPLOYEE_DEFAULT_SORT, useEmployeeList } from './employee-hooks';

const columns: ColumnDef<Employee, unknown>[] = [
  {
    accessorKey: 'employeeCode',
    header: t.orgAdmin.employeeCode,
    cell: ({ row }) => (
      <Link
        className="code font-medium text-indigo-700 hover:underline"
        to={`/app/organization/employees/${encodeURIComponent(row.original.id)}`}
      >
        {row.original.employeeCode}
      </Link>
    ),
  },
  { accessorKey: 'firstName', header: t.orgAdmin.firstName },
  { accessorKey: 'lastName', header: t.orgAdmin.lastName },
  {
    id: 'isActive',
    header: t.orgAdmin.status,
    enableSorting: false,
    cell: ({ row }) => <ActiveBadge active={row.original.isActive} />,
  },
  {
    id: 'actions',
    header: t.orgAdmin.actions,
    enableSorting: false,
    meta: { align: 'end' },
    cell: ({ row }) => (
      <Button asChild variant="ghost" size="sm">
        <Link
          to={`/app/organization/employees/${encodeURIComponent(row.original.id)}`}
        >
          {t.orgAdmin.view}
        </Link>
      </Button>
    ),
  },
];

/** Employee list (`GET /employees`) with the endpoint's own filters. */
export function EmployeesPage() {
  const organizationId = useOrganizationId();
  const list = useAdminListState({
    sortFields: EMPLOYEE_SORT_FIELDS,
    defaultSort: EMPLOYEE_DEFAULT_SORT,
    extraKeys: ['departmentId', 'branchId'],
  });
  const departmentId = list.extra['departmentId'] ?? '';
  const branchId = list.extra['branchId'] ?? '';
  const query = useEmployeeList(organizationId, list.state, {
    departmentId,
    branchId,
  });
  const departments = useActiveDepartmentOptions(organizationId);
  const branches = useActiveBranchOptions(organizationId);

  return (
    <div className="space-y-4" data-testid="employees-page">
      <PageHeader
        title={t.orgAdmin.employees}
        description={t.orgAdmin.employeesDescription}
        actions={
          <PermissionGate permission={PERMISSIONS.organization.employeeCreate}>
            <Button asChild size="sm">
              <Link to="/app/organization/employees/new">
                {t.orgAdmin.newEmployee}
              </Link>
            </Button>
          </PermissionGate>
        }
      />

      <AdminFilters
        synchronizationKey={`${list.state.search}:${list.state.status}:${departmentId}:${branchId}`}
        search={list.state.search}
        status={list.state.status}
        onApply={(values) =>
          list.update({ search: values.search, status: values.status })
        }
        onClear={list.clear}
      >
        <label className="min-w-44 text-xs text-slate-600">
          <span>{t.orgAdmin.department}</span>
          <Select
            className="mt-1"
            value={departmentId}
            disabled={departments.unavailable}
            onChange={(event) =>
              list.update({ departmentId: event.target.value })
            }
          >
            <option value="">{t.orgAdmin.allDepartments}</option>
            {departments.items.map((department) => (
              <option key={department.id} value={department.id}>
                {department.code} — {department.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="min-w-44 text-xs text-slate-600">
          <span>{t.orgAdmin.branch}</span>
          <Select
            className="mt-1"
            value={branchId}
            disabled={branches.unavailable}
            onChange={(event) => list.update({ branchId: event.target.value })}
          >
            <option value="">{t.orgAdmin.allBranches}</option>
            {branches.items.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.code} — {branch.name}
              </option>
            ))}
          </Select>
        </label>
      </AdminFilters>

      <DataTable
        columns={columns}
        data={query.data?.items ?? []}
        getRowId={(row) => row.id}
        caption={t.orgAdmin.employees}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        errorDescription={t.orgAdmin.employeesLoadFailed}
        onRetry={() => void query.refetch()}
        emptyTitle={t.orgAdmin.employees}
        emptyDescription={t.orgAdmin.noEmployees}
        sorting={list.state.sorting}
        onSortingChange={list.setSorting}
        pagination={{
          page: query.data?.page ?? list.state.page,
          pageSize: query.data?.pageSize ?? list.state.pageSize,
          total: query.data?.total ?? 0,
          pageSizeOptions: [...ADMIN_PAGE_SIZE_OPTIONS],
          onPageChange: (page) => list.update({ page }),
          onPageSizeChange: (pageSize) => list.update({ pageSize }),
        }}
      />
    </div>
  );
}
