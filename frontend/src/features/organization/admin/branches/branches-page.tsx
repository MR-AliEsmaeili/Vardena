import type { ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import type { Branch } from '@/api/contracts';
import { BRANCH_SORT_FIELDS } from '@/api/organization.api';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PermissionGate } from '@/features/permissions/permission-gate';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { formatDateTime } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { DataTable } from '@/ui/patterns/data-table';
import { PageHeader } from '@/ui/patterns/page-header';
import { ActiveBadge, AdminFilters } from '../admin-ui';
import {
  ADMIN_PAGE_SIZE_OPTIONS,
  useAdminListState,
} from '@/lib/use-admin-list-state';
import { BRANCH_DEFAULT_SORT, useBranchList } from './branch-hooks';

const columns: ColumnDef<Branch, unknown>[] = [
  {
    accessorKey: 'code',
    header: t.orgAdmin.code,
    cell: ({ row }) => (
      <Link
        className="code font-medium text-brand hover:underline"
        to={`/app/organization/branches/${encodeURIComponent(row.original.id)}`}
      >
        {row.original.code}
      </Link>
    ),
  },
  { accessorKey: 'name', header: t.orgAdmin.name },
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
          to={`/app/organization/branches/${encodeURIComponent(row.original.id)}`}
        >
          {t.orgAdmin.view}
        </Link>
      </Button>
    ),
  },
];

/** Branch list — server paginated, filtered and sorted (`GET /branches`). */
export function BranchesPage() {
  const organizationId = useOrganizationId();
  const list = useAdminListState({
    sortFields: BRANCH_SORT_FIELDS,
    defaultSort: BRANCH_DEFAULT_SORT,
  });
  const query = useBranchList(organizationId, list.state);

  return (
    <div className="space-y-4" data-testid="branches-page">
      <PageHeader
        title={t.orgAdmin.branches}
        description={t.orgAdmin.branchesDescription}
        actions={
          <PermissionGate permission={PERMISSIONS.organization.branchCreate}>
            <Button asChild size="sm">
              <Link to="/app/organization/branches/new">
                {t.orgAdmin.newBranch}
              </Link>
            </Button>
          </PermissionGate>
        }
      />

      <AdminFilters
        synchronizationKey={`${list.state.search}:${list.state.status}`}
        search={list.state.search}
        status={list.state.status}
        onApply={(values) =>
          list.update({ search: values.search, status: values.status })
        }
        onClear={list.clear}
      />

      <DataTable
        columns={columns}
        data={query.data?.items ?? []}
        getRowId={(row) => row.id}
        caption={t.orgAdmin.branches}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        errorDescription={t.orgAdmin.branchesLoadFailed}
        onRetry={() => void query.refetch()}
        emptyTitle={t.orgAdmin.branches}
        emptyDescription={t.orgAdmin.noBranches}
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
