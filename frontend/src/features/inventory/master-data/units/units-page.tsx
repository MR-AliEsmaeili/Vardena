import type { ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import type { InventoryUnit } from '@/api/contracts';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { PermissionGate } from '@/features/permissions/permission-gate';
import { formatDateTime } from '@/lib/format';
import { t } from '@/lib/i18n';
import {
  ADMIN_PAGE_SIZE_OPTIONS,
  useAdminListState,
} from '@/lib/use-admin-list-state';
import { Button } from '@/ui/button';
import { DataTable } from '@/ui/patterns/data-table';
import { PageHeader } from '@/ui/patterns/page-header';
import { MasterDataFilters, MasterDataStatusBadge } from '../master-data-ui';
import { UNIT_DEFAULT_SORT, UNIT_SORT_FIELDS, useUnitList } from './unit-hooks';

const columns: ColumnDef<InventoryUnit, unknown>[] = [
  {
    accessorKey: 'code',
    header: t.inventoryMaster.code,
    cell: ({ row }) => (
      <Link
        className="code font-medium text-indigo-700 hover:underline"
        to={`/app/inventory/units/${encodeURIComponent(row.original.id)}`}
      >
        {row.original.code}
      </Link>
    ),
  },
  { accessorKey: 'name', header: t.inventoryMaster.name },
  {
    accessorKey: 'symbol',
    header: t.inventoryMaster.unitSymbol,
    enableSorting: false,
    cell: ({ row }) => row.original.symbol ?? t.app.none,
  },
  {
    id: 'isActive',
    header: t.inventoryMaster.status,
    enableSorting: false,
    cell: ({ row }) => <MasterDataStatusBadge active={row.original.isActive} />,
  },
  {
    accessorKey: 'updatedAt',
    header: t.inventoryMaster.updatedAt,
    cell: ({ row }) => (
      <span className="num">{formatDateTime(row.original.updatedAt)}</span>
    ),
  },
  {
    id: 'actions',
    header: t.inventoryMaster.actions,
    enableSorting: false,
    meta: { align: 'end' },
    cell: ({ row }) => (
      <Button asChild variant="ghost" size="sm">
        <Link
          to={`/app/inventory/units/${encodeURIComponent(row.original.id)}`}
        >
          {t.inventoryMaster.view}
        </Link>
      </Button>
    ),
  },
];

/** Unit list — server paginated, filtered and sorted (`GET /units`). */
export function UnitsPage() {
  const organizationId = useOrganizationId();
  const list = useAdminListState({
    sortFields: UNIT_SORT_FIELDS,
    defaultSort: UNIT_DEFAULT_SORT,
  });
  const query = useUnitList(organizationId, list.state);

  return (
    <div className="space-y-4" data-testid="units-page">
      <PageHeader
        title={t.inventoryMaster.units}
        description={t.inventoryMaster.unitsDescription}
        actions={
          <PermissionGate permission={PERMISSIONS.inventory.unitCreate}>
            <Button asChild size="sm">
              <Link to="/app/inventory/units/new">
                {t.inventoryMaster.newUnit}
              </Link>
            </Button>
          </PermissionGate>
        }
      />

      <MasterDataFilters
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
        caption={t.inventoryMaster.units}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        errorDescription={t.inventoryMaster.loadFailed}
        onRetry={() => void query.refetch()}
        emptyTitle={t.inventoryMaster.units}
        emptyDescription={t.inventoryMaster.unitsEmptyFirstUse}
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
