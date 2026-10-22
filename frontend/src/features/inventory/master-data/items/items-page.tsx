import type { ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import type { InventoryItem } from '@/api/contracts';
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
import { Select } from '@/ui/select';
import { useActiveItemGroupOptions } from '../master-data-references';
import { MasterDataFilters, MasterDataStatusBadge } from '../master-data-ui';
import { ITEM_KINDS } from '../master-data-schemas';
import { ITEM_DEFAULT_SORT, ITEM_SORT_FIELDS, useItemList } from './item-hooks';

const columns: ColumnDef<InventoryItem, unknown>[] = [
  {
    accessorKey: 'code',
    header: t.inventoryMaster.code,
    cell: ({ row }) => (
      <Link
        className="code font-medium text-indigo-700 hover:underline"
        to={`/app/inventory/items/${encodeURIComponent(row.original.id)}`}
      >
        {row.original.code}
      </Link>
    ),
  },
  { accessorKey: 'name', header: t.inventoryMaster.name },
  {
    accessorKey: 'itemKind',
    header: t.inventoryMaster.itemKind,
    cell: ({ row }) =>
      t.inventoryMaster.itemKinds[
        row.original.itemKind as keyof typeof t.inventoryMaster.itemKinds
      ],
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
          to={`/app/inventory/items/${encodeURIComponent(row.original.id)}`}
        >
          {t.inventoryMaster.view}
        </Link>
      </Button>
    ),
  },
];

/** Item list (`GET /items`) with the endpoint's kind and group filters. */
export function ItemsPage() {
  const organizationId = useOrganizationId();
  const list = useAdminListState({
    sortFields: ITEM_SORT_FIELDS,
    defaultSort: ITEM_DEFAULT_SORT,
    extraKeys: ['itemKind', 'itemGroupId'],
  });
  const itemKind = list.extra['itemKind'] ?? '';
  const itemGroupId = list.extra['itemGroupId'] ?? '';
  const query = useItemList(organizationId, list.state, {
    itemKind,
    itemGroupId,
  });
  const groups = useActiveItemGroupOptions(organizationId);

  return (
    <div className="space-y-4" data-testid="items-page">
      <PageHeader
        title={t.inventoryMaster.items}
        description={t.inventoryMaster.itemsDescription}
        actions={
          <PermissionGate permission={PERMISSIONS.inventory.itemCreate}>
            <Button asChild size="sm">
              <Link to="/app/inventory/items/new">
                {t.inventoryMaster.newItem}
              </Link>
            </Button>
          </PermissionGate>
        }
      />

      <MasterDataFilters
        synchronizationKey={`${list.state.search}:${list.state.status}:${itemKind}:${itemGroupId}`}
        search={list.state.search}
        status={list.state.status}
        onApply={(values) =>
          list.update({ search: values.search, status: values.status })
        }
        onClear={list.clear}
      >
        <label className="min-w-44 text-xs text-slate-600">
          <span>{t.inventoryMaster.itemKind}</span>
          <Select
            className="mt-1"
            value={itemKind}
            onChange={(event) => list.update({ itemKind: event.target.value })}
          >
            <option value="">{t.inventoryMaster.allItemKinds}</option>
            {ITEM_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t.inventoryMaster.itemKinds[kind]}
              </option>
            ))}
          </Select>
        </label>
        <label className="min-w-44 text-xs text-slate-600">
          <span>{t.inventoryMaster.itemGroupFilter}</span>
          <Select
            className="mt-1"
            value={itemGroupId}
            disabled={groups.unavailable}
            onChange={(event) =>
              list.update({ itemGroupId: event.target.value })
            }
          >
            <option value="">{t.inventoryMaster.allItemGroups}</option>
            {groups.items.map((group) => (
              <option key={group.id} value={group.id}>
                {group.code} — {group.name}
              </option>
            ))}
          </Select>
        </label>
      </MasterDataFilters>

      <DataTable
        columns={columns}
        data={query.data?.items ?? []}
        getRowId={(row) => row.id}
        caption={t.inventoryMaster.items}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        errorDescription={t.inventoryMaster.loadFailed}
        onRetry={() => void query.refetch()}
        emptyTitle={t.inventoryMaster.items}
        emptyDescription={t.inventoryMaster.itemsEmptyFirstUse}
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
