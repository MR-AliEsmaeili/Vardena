import type { ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import type { AdminRole } from '@/api/contracts';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { PermissionGate } from '@/features/permissions/permission-gate';
import { formatCount, formatDateTime } from '@/lib/format';
import { t } from '@/lib/i18n';
import {
  ADMIN_PAGE_SIZE_OPTIONS,
  useAdminListState,
} from '@/lib/use-admin-list-state';
import { Button } from '@/ui/button';
import { DataTable } from '@/ui/patterns/data-table';
import { PageHeader } from '@/ui/patterns/page-header';
import { ROLE_DEFAULT_SORT, ROLE_SORT_FIELDS, useRoleList } from './role-hooks';

const columns: ColumnDef<AdminRole, unknown>[] = [
  {
    accessorKey: 'name',
    header: t.rolesAdmin.roleName,
    cell: ({ row }) => (
      <Link
        className="font-medium text-indigo-700 hover:underline"
        to={`/app/admin/roles/${encodeURIComponent(row.original.id)}`}
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: 'description',
    header: t.rolesAdmin.description,
    enableSorting: false,
    cell: ({ row }) =>
      row.original.description === null || row.original.description === '' ? (
        <span className="text-slate-400">{t.rolesAdmin.noDescription}</span>
      ) : (
        row.original.description
      ),
  },
  {
    accessorKey: 'permissionCount',
    header: t.rolesAdmin.permissionCount,
    enableSorting: false,
    cell: ({ row }) => (
      <span className="num">{formatCount(row.original.permissionCount)}</span>
    ),
  },
  {
    accessorKey: 'createdAt',
    header: t.rolesAdmin.createdAt,
    cell: ({ row }) => (
      <span className="num">{formatDateTime(row.original.createdAt)}</span>
    ),
  },
  {
    accessorKey: 'updatedAt',
    header: t.rolesAdmin.updatedAt,
    cell: ({ row }) => (
      <span className="num">{formatDateTime(row.original.updatedAt)}</span>
    ),
  },
  {
    id: 'actions',
    header: t.rolesAdmin.actions,
    enableSorting: false,
    meta: { align: 'end' },
    cell: ({ row }) => (
      <Button asChild variant="ghost" size="sm">
        <Link to={`/app/admin/roles/${encodeURIComponent(row.original.id)}`}>
          {t.rolesAdmin.view}
        </Link>
      </Button>
    ),
  },
];

/**
 * Role list — server paginated and sorted (`GET /roles`). The endpoint has
 * no search and no state filter, so the filter bar is deliberately absent.
 */
export function RolesPage() {
  const list = useAdminListState({
    sortFields: ROLE_SORT_FIELDS,
    defaultSort: ROLE_DEFAULT_SORT,
  });
  const query = useRoleList(list.state);

  return (
    <div className="space-y-4" data-testid="roles-page">
      <PageHeader
        title={t.rolesAdmin.title}
        description={t.rolesAdmin.subtitle}
        actions={
          <PermissionGate permission={PERMISSIONS.rbac.roleCreate}>
            <Button asChild size="sm">
              <Link to="/app/admin/roles/new">{t.rolesAdmin.newRole}</Link>
            </Button>
          </PermissionGate>
        }
      />

      <DataTable
        columns={columns}
        data={query.data?.items ?? []}
        getRowId={(row) => row.id}
        caption={t.rolesAdmin.title}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        errorDescription={t.rolesAdmin.listLoadFailed}
        onRetry={() => void query.refetch()}
        emptyTitle={t.rolesAdmin.title}
        emptyDescription={t.rolesAdmin.rolesEmpty}
        emptyAction={
          <PermissionGate permission={PERMISSIONS.rbac.roleCreate}>
            <Button asChild variant="outline" size="sm">
              <Link to="/app/admin/roles/new">{t.rolesAdmin.newRole}</Link>
            </Button>
          </PermissionGate>
        }
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
