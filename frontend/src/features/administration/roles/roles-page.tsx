import type { ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import type { AdminRole } from '@/api/contracts';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { PermissionGate } from '@/features/permissions/permission-gate';
import { formatCount, formatDateTime } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { DataTable } from '@/ui/patterns/data-table';
import { DataTableTruncationNotice } from '@/ui/patterns/data-table/truncation-notice';
import { PageHeader } from '@/ui/patterns/page-header';
import { useAllRoles } from './role-hooks';

const columns: ColumnDef<AdminRole, unknown>[] = [
  {
    accessorKey: 'name',
    header: t.rolesAdmin.roleName,
    meta: { filter: { kind: 'text', label: t.rolesAdmin.roleName } },
    cell: ({ row }) => (
      <Link
        className="font-medium text-brand hover:underline"
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
    meta: { filter: { kind: 'text', label: t.rolesAdmin.description } },
    cell: ({ row }) =>
      row.original.description === null || row.original.description === '' ? (
        <span className="text-ink-subtle">{t.rolesAdmin.noDescription}</span>
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
    enableColumnFilter: false,
    meta: { align: 'end', excludeFromGlobalSearch: true },
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
 * Role list (`GET /roles`).
 *
 * The endpoint offers no search, so the shared grid's light client-side
 * filtering searches the bounded role read by name and description
 * (`docs/frontend/data-table.md`).
 */
export function RolesPage() {
  const query = useAllRoles();
  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

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

      {total > items.length && (
        <DataTableTruncationNotice loaded={items.length} />
      )}

      <DataTable
        columns={columns}
        data={items}
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
        filtering={{ initialPageSize: 50, pageSizeOptions: [25, 50, 100] }}
      />
    </div>
  );
}
