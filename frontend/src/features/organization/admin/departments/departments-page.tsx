import type { ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import type { Department } from '@/api/contracts';
import { DEPARTMENT_SORT_FIELDS } from '@/api/organization.api';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PermissionGate } from '@/features/permissions/permission-gate';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { formatDateTime } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { Select } from '@/ui/select';
import { DataTable } from '@/ui/patterns/data-table';
import { PageHeader } from '@/ui/patterns/page-header';
import { useActiveDepartmentOptions } from '../admin-references';
import { ActiveBadge, AdminFilters } from '../admin-ui';
import {
  ADMIN_PAGE_SIZE_OPTIONS,
  useAdminListState,
} from '../admin-list-state';
import { DEPARTMENT_DEFAULT_SORT, useDepartmentList } from './department-hooks';

const columns: ColumnDef<Department, unknown>[] = [
  {
    accessorKey: 'code',
    header: t.orgAdmin.code,
    cell: ({ row }) => (
      <Link
        className="code font-medium text-indigo-700 hover:underline"
        to={`/app/organization/departments/${encodeURIComponent(row.original.id)}`}
      >
        {row.original.code}
      </Link>
    ),
  },
  { accessorKey: 'name', header: t.orgAdmin.name },
  {
    id: 'parentDepartmentId',
    header: t.orgAdmin.parentDepartment,
    enableSorting: false,
    cell: ({ row }) =>
      row.original.parentDepartmentId === null ? (
        <span className="text-slate-500">{t.orgAdmin.rootDepartment}</span>
      ) : (
        <Link
          className="code text-indigo-700 hover:underline"
          to={`/app/organization/departments/${encodeURIComponent(row.original.parentDepartmentId)}`}
        >
          {row.original.parentDepartmentId}
        </Link>
      ),
  },
  {
    id: 'isActive',
    header: t.orgAdmin.status,
    enableSorting: false,
    cell: ({ row }) => <ActiveBadge active={row.original.isActive} />,
  },
  {
    accessorKey: 'updatedAt',
    header: t.orgAdmin.updatedAt,
    cell: ({ row }) => (
      <span className="num">{formatDateTime(row.original.updatedAt)}</span>
    ),
  },
  {
    id: 'actions',
    header: t.orgAdmin.actions,
    enableSorting: false,
    meta: { align: 'end' },
    cell: ({ row }) => (
      <Button asChild variant="ghost" size="sm">
        <Link
          to={`/app/organization/departments/${encodeURIComponent(row.original.id)}`}
        >
          {t.orgAdmin.view}
        </Link>
      </Button>
    ),
  },
];

/**
 * Department list (`GET /departments`).
 *
 * The extra filter is the endpoint's own `parentDepartmentId` — "the direct
 * children of one department". No tree is rendered: the contract returns a
 * paginated flat list, and drawing a hierarchy would require fetching every
 * page, which §8 forbids.
 */
export function DepartmentsPage() {
  const organizationId = useOrganizationId();
  const list = useAdminListState({
    sortFields: DEPARTMENT_SORT_FIELDS,
    defaultSort: DEPARTMENT_DEFAULT_SORT,
    extraKeys: ['parentDepartmentId'],
  });
  const parentDepartmentId = list.extra['parentDepartmentId'] ?? '';
  const query = useDepartmentList(
    organizationId,
    list.state,
    parentDepartmentId,
  );
  const parents = useActiveDepartmentOptions(organizationId);

  return (
    <div className="space-y-4" data-testid="departments-page">
      <PageHeader
        title={t.orgAdmin.departments}
        description={t.orgAdmin.departmentsDescription}
        actions={
          <PermissionGate
            permission={PERMISSIONS.organization.departmentCreate}
          >
            <Button asChild size="sm">
              <Link to="/app/organization/departments/new">
                {t.orgAdmin.newDepartment}
              </Link>
            </Button>
          </PermissionGate>
        }
      />

      <AdminFilters
        synchronizationKey={`${list.state.search}:${list.state.status}:${parentDepartmentId}`}
        search={list.state.search}
        status={list.state.status}
        onApply={(values) =>
          list.update({ search: values.search, status: values.status })
        }
        onClear={list.clear}
      >
        <label className="min-w-48 text-xs text-slate-600">
          <span>{t.orgAdmin.parentDepartment}</span>
          <Select
            className="mt-1"
            value={parentDepartmentId}
            disabled={parents.unavailable}
            onChange={(event) =>
              list.update({ parentDepartmentId: event.target.value })
            }
          >
            <option value="">{t.orgAdmin.allParents}</option>
            {parents.items.map((parent) => (
              <option key={parent.id} value={parent.id}>
                {parent.code} — {parent.name}
              </option>
            ))}
          </Select>
        </label>
      </AdminFilters>

      <DataTable
        columns={columns}
        data={query.data?.items ?? []}
        getRowId={(row) => row.id}
        caption={t.orgAdmin.departments}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        errorDescription={t.orgAdmin.departmentsLoadFailed}
        onRetry={() => void query.refetch()}
        emptyTitle={t.orgAdmin.departments}
        emptyDescription={t.orgAdmin.noDepartments}
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
