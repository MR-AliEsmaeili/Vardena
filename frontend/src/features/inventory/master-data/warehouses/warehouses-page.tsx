import type { ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import type { InventoryWarehouse } from '@/api/contracts';
import { useOrganizationId } from '@/features/organization/use-organization';
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
import { PageHeader } from '@/ui/patterns/page-header';
import { Select } from '@/ui/select';
import {
  useActiveBranchOptions,
  useActiveWarehouseOptions,
} from '../master-data-references';
import { MasterDataFilters, MasterDataStatusBadge } from '../master-data-ui';
import {
  WAREHOUSE_DEFAULT_SORT,
  WAREHOUSE_SORT_FIELDS,
  useWarehouseList,
} from './warehouse-hooks';

const columns: ColumnDef<InventoryWarehouse, unknown>[] = [
  {
    accessorKey: 'code',
    header: t.inventoryMaster.code,
    cell: ({ row }) => (
      <Link
        className="code font-medium text-brand hover:underline"
        to={`/app/inventory/warehouses/${encodeURIComponent(row.original.id)}`}
      >
        {row.original.code}
      </Link>
    ),
  },
  { accessorKey: 'name', header: t.inventoryMaster.name },
  {
    id: 'isActive',
    header: t.inventoryMaster.status,
    enableSorting: false,
    cell: ({ row }) => <MasterDataStatusBadge active={row.original.isActive} />,
  },
  {
    accessorKey: 'accountingPostingMode',
    header: t.inventoryMaster.accountingPostingMode,
    enableSorting: false,
    cell: ({ row }) => (
      <Badge
        variant={
          row.original.accountingPostingMode === 'draft' ? 'info' : 'neutral'
        }
      >
        {row.original.accountingPostingMode === 'draft'
          ? t.inventoryMaster.postingModes.draft
          : t.inventoryMaster.postingModes.direct_final}
      </Badge>
    ),
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
          to={`/app/inventory/warehouses/${encodeURIComponent(row.original.id)}`}
        >
          {t.inventoryMaster.view}
        </Link>
      </Button>
    ),
  },
];

/** Warehouse list (`GET /warehouses`) with the endpoint's branch filter. */
export function WarehousesPage() {
  const organizationId = useOrganizationId();
  const list = useAdminListState({
    sortFields: WAREHOUSE_SORT_FIELDS,
    defaultSort: WAREHOUSE_DEFAULT_SORT,
    extraKeys: ['branchId'],
  });
  const branchId = list.extra['branchId'] ?? '';
  const query = useWarehouseList(organizationId, list.state, branchId);
  const branches = useActiveBranchOptions(organizationId);
  // Available after the list: pickers must not duplicate the read.
  useActiveWarehouseOptions(organizationId);

  return (
    <div className="space-y-4" data-testid="warehouses-page">
      <PageHeader
        title={t.inventoryMaster.warehouses}
        description={t.inventoryMaster.warehousesDescription}
        actions={
          <PermissionGate permission={PERMISSIONS.inventory.warehouseCreate}>
            <Button asChild size="sm">
              <Link to="/app/inventory/warehouses/new">
                {t.inventoryMaster.newWarehouse}
              </Link>
            </Button>
          </PermissionGate>
        }
      />

      <MasterDataFilters
        synchronizationKey={`${list.state.search}:${list.state.status}:${branchId}`}
        search={list.state.search}
        status={list.state.status}
        onApply={(values) =>
          list.update({ search: values.search, status: values.status })
        }
        onClear={list.clear}
      >
        <label className="min-w-44 text-xs text-ink-muted">
          <span>{t.inventoryMaster.branchFilter}</span>
          <Select
            className="mt-1"
            value={branchId}
            disabled={branches.unavailable}
            onChange={(event) => list.update({ branchId: event.target.value })}
          >
            <option value="">{t.inventoryMaster.allBranches}</option>
            {branches.items.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.code} — {branch.name}
              </option>
            ))}
          </Select>
        </label>
      </MasterDataFilters>

      <DataTable
        columns={columns}
        data={query.data?.items ?? []}
        getRowId={(row) => row.id}
        caption={t.inventoryMaster.warehouses}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        errorDescription={t.inventoryMaster.loadFailed}
        onRetry={() => void query.refetch()}
        emptyTitle={t.inventoryMaster.warehouses}
        emptyDescription={t.inventoryMaster.warehousesEmptyFirstUse}
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
