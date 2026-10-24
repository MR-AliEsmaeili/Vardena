import type { ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import type { AdminUser } from '@/api/contracts';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { PermissionGate } from '@/features/permissions/permission-gate';
import { formatDateTime } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { DataTable } from '@/ui/patterns/data-table';
import { PageHeader } from '@/ui/patterns/page-header';
import { DataTableTruncationNotice } from '@/ui/patterns/data-table/truncation-notice';
import { useAllUsers } from './user-hooks';

const columns: ColumnDef<AdminUser, unknown>[] = [
  {
    accessorKey: 'username',
    header: t.usersAdmin.username,
    meta: {
      filter: { kind: 'text', label: t.usersAdmin.username },
    },
    cell: ({ row }) => (
      <Link
        className="code font-medium text-brand hover:underline"
        to={`/app/admin/users/${encodeURIComponent(row.original.id)}`}
      >
        <span dir="ltr">{row.original.username}</span>
      </Link>
    ),
  },
  {
    accessorKey: 'isActive',
    header: t.usersAdmin.status,
    enableSorting: false,
    meta: {
      filter: {
        kind: 'select',
        label: t.usersAdmin.status,
        options: [
          { value: 'true', label: t.usersAdmin.active },
          { value: 'false', label: t.usersAdmin.inactive },
        ],
        searchValue: (user) =>
          user.isActive ? t.usersAdmin.active : t.usersAdmin.inactive,
      },
    },
    cell: ({ row }) =>
      row.original.isActive ? (
        <Badge variant="success">{t.usersAdmin.active}</Badge>
      ) : (
        <Badge variant="neutral">{t.usersAdmin.inactive}</Badge>
      ),
  },
  {
    accessorKey: 'mustChangePassword',
    header: t.usersAdmin.mustChangePassword,
    enableSorting: false,
    meta: {
      filter: {
        kind: 'select',
        label: t.usersAdmin.mustChangePassword,
        options: [
          { value: 'true', label: t.usersAdmin.mustChangePasswordYes },
          { value: 'false', label: t.usersAdmin.mustChangePasswordNo },
        ],
        searchValue: (user) =>
          user.mustChangePassword
            ? t.usersAdmin.mustChangePasswordYes
            : t.usersAdmin.mustChangePasswordNo,
      },
    },
    cell: ({ row }) =>
      row.original.mustChangePassword ? (
        <Badge variant="warning">{t.usersAdmin.mustChangePasswordYes}</Badge>
      ) : (
        <span className="text-ink-subtle">
          {t.usersAdmin.mustChangePasswordNo}
        </span>
      ),
  },
  {
    accessorKey: 'createdAt',
    header: t.usersAdmin.createdAt,
    meta: { excludeFromGlobalSearch: true },
    cell: ({ row }) => (
      <span className="num">{formatDateTime(row.original.createdAt)}</span>
    ),
  },
  {
    accessorKey: 'updatedAt',
    header: t.usersAdmin.updatedAt,
    meta: { excludeFromGlobalSearch: true },
    cell: ({ row }) => (
      <span className="num">{formatDateTime(row.original.updatedAt)}</span>
    ),
  },
  {
    id: 'actions',
    header: t.usersAdmin.actions,
    enableSorting: false,
    enableColumnFilter: false,
    meta: { align: 'end', excludeFromGlobalSearch: true },
    cell: ({ row }) => (
      <Button asChild variant="ghost" size="sm">
        <Link to={`/app/admin/users/${encodeURIComponent(row.original.id)}`}>
          {t.usersAdmin.view}
        </Link>
      </Button>
    ),
  },
];

/**
 * User account list.
 *
 * The backend list offers no search parameter, so the grid uses the standard
 * light client-side filtering over a bounded read (`GET /users?pageSize=500`):
 * global search, account status and "must change password" are filtered in
 * the browser (`docs/frontend/data-table.md`). If the installation holds more
 * users than one bounded page, the truncation notice says so instead of
 * pretending the filters cover rows that were never loaded.
 */
export function UsersPage() {
  const query = useAllUsers();
  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  return (
    <div className="space-y-4" data-testid="users-page">
      <PageHeader
        title={t.usersAdmin.title}
        description={t.usersAdmin.subtitle}
        actions={
          <PermissionGate permission={PERMISSIONS.users.create}>
            <Button asChild size="sm">
              <Link to="/app/admin/users/new">{t.usersAdmin.newUser}</Link>
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
        caption={t.usersAdmin.title}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        errorDescription={t.usersAdmin.listLoadFailed}
        onRetry={() => void query.refetch()}
        emptyTitle={t.usersAdmin.title}
        emptyDescription={t.usersAdmin.usersEmptyFirstUse}
        emptyAction={
          <PermissionGate permission={PERMISSIONS.users.create}>
            <Button asChild variant="outline" size="sm">
              <Link to="/app/admin/users/new">{t.usersAdmin.newUser}</Link>
            </Button>
          </PermissionGate>
        }
        filtering={{
          initialPageSize: 50,
          pageSizeOptions: [25, 50, 100],
        }}
      />
    </div>
  );
}
