import type { ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import type { AdminUser } from '@/api/contracts';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { PermissionGate } from '@/features/permissions/permission-gate';
import { formatDateTime } from '@/lib/format';
import { t } from '@/lib/i18n';
import {
  ADMIN_PAGE_SIZE_OPTIONS,
  useAdminListState,
} from '@/lib/use-admin-list-state';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { DataTable } from '@/ui/patterns/data-table';
import { FilterBar, FilterField } from '@/ui/patterns/filter-bar';
import { PageHeader } from '@/ui/patterns/page-header';
import { Select } from '@/ui/select';
import { USER_DEFAULT_SORT, USER_SORT_FIELDS, useUserList } from './user-hooks';

const columns: ColumnDef<AdminUser, unknown>[] = [
  {
    accessorKey: 'username',
    header: t.usersAdmin.username,
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
    id: 'isActive',
    header: t.usersAdmin.status,
    enableSorting: false,
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
    cell: ({ row }) => (
      <span className="num">{formatDateTime(row.original.createdAt)}</span>
    ),
  },
  {
    accessorKey: 'updatedAt',
    header: t.usersAdmin.updatedAt,
    cell: ({ row }) => (
      <span className="num">{formatDateTime(row.original.updatedAt)}</span>
    ),
  },
  {
    id: 'actions',
    header: t.usersAdmin.actions,
    enableSorting: false,
    meta: { align: 'end' },
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
 * User account list — server paginated and filtered by account state
 * (`GET /users`). The backend offers NO search parameter on this list, so
 * the search box is intentionally absent (FE-UX-02 §4: never render a
 * control the API cannot honor).
 */
export function UsersPage() {
  const list = useAdminListState({
    sortFields: USER_SORT_FIELDS,
    defaultSort: USER_DEFAULT_SORT,
  });
  const query = useUserList(list.state);

  const statusValue = list.state.status;

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

      <FilterBar
        onClear={list.clear}
        clearLabel={t.orgAdmin.clear}
        columns={4}
        aria-label={t.filters.title}
      >
        <FilterField label={t.usersAdmin.status}>
          <Select
            value={statusValue}
            onChange={(event) => list.update({ status: event.target.value })}
          >
            <option value="">{t.usersAdmin.allStatuses}</option>
            <option value="active">{t.usersAdmin.active}</option>
            <option value="inactive">{t.usersAdmin.inactive}</option>
          </Select>
        </FilterField>
      </FilterBar>

      <DataTable
        columns={columns}
        data={query.data?.items ?? []}
        getRowId={(row) => row.id}
        caption={t.usersAdmin.title}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        errorDescription={t.usersAdmin.listLoadFailed}
        onRetry={() => void query.refetch()}
        emptyTitle={t.usersAdmin.title}
        emptyDescription={t.usersAdmin.usersEmptyFirstUse}
        // Only the "no users yet" empty state offers creation. With a status
        // filter active the grid is empty because of the filter, and a create
        // CTA would not be the recovery for what the user sees.
        emptyAction={
          statusValue === '' ? (
            <PermissionGate permission={PERMISSIONS.users.create}>
              <Button asChild variant="outline" size="sm">
                <Link to="/app/admin/users/new">{t.usersAdmin.newUser}</Link>
              </Button>
            </PermissionGate>
          ) : undefined
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
