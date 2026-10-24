import type { ColumnDef } from '@tanstack/react-table';
import { Link, useSearchParams } from 'react-router-dom';
import type { InventoryItem } from '@/api/contracts';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { PermissionGate } from '@/features/permissions/permission-gate';
import { formatDateTime } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { DataTable } from '@/ui/patterns/data-table';
import { DataTableTruncationNotice } from '@/ui/patterns/data-table/truncation-notice';
import { PageHeader } from '@/ui/patterns/page-header';
import { Select } from '@/ui/select';
import { useActiveItemGroupOptions } from '../master-data-references';
import { MasterDataStatusBadge } from '../master-data-ui';
import { ITEM_KINDS } from '../master-data-schemas';
import { useAllItems } from './item-hooks';

const itemKindOptions = ITEM_KINDS.map((kind) => ({
  value: kind,
  label: t.inventoryMaster.itemKinds[kind],
}));

const columns: ColumnDef<InventoryItem, unknown>[] = [
  {
    accessorKey: 'code',
    header: t.inventoryMaster.code,
    meta: { filter: { kind: 'text', label: t.inventoryMaster.code } },
    cell: ({ row }) => (
      <Link
        className="code font-medium text-brand hover:underline"
        to={`/app/inventory/items/${encodeURIComponent(row.original.id)}`}
      >
        {row.original.code}
      </Link>
    ),
  },
  {
    accessorKey: 'name',
    header: t.inventoryMaster.name,
    meta: { filter: { kind: 'text', label: t.inventoryMaster.name } },
  },
  {
    accessorKey: 'itemKind',
    header: t.inventoryMaster.itemKind,
    meta: {
      filter: {
        kind: 'select',
        label: t.inventoryMaster.itemKind,
        options: itemKindOptions,
        searchValue: (item) =>
          t.inventoryMaster.itemKinds[
            item.itemKind as keyof typeof t.inventoryMaster.itemKinds
          ] ?? item.itemKind,
      },
    },
    cell: ({ row }) =>
      t.inventoryMaster.itemKinds[
        row.original.itemKind as keyof typeof t.inventoryMaster.itemKinds
      ],
  },
  {
    accessorKey: 'isActive',
    header: t.inventoryMaster.status,
    enableSorting: false,
    meta: {
      filter: {
        kind: 'select',
        label: t.inventoryMaster.status,
        options: [
          { value: 'true', label: t.masterData.active },
          { value: 'false', label: t.masterData.inactive },
        ],
        searchValue: (item) =>
          item.isActive ? t.masterData.active : t.masterData.inactive,
      },
    },
    cell: ({ row }) => <MasterDataStatusBadge active={row.original.isActive} />,
  },
  {
    accessorKey: 'updatedAt',
    header: t.inventoryMaster.updatedAt,
    meta: { excludeFromGlobalSearch: true },
    cell: ({ row }) => (
      <span className="num">{formatDateTime(row.original.updatedAt)}</span>
    ),
  },
  {
    id: 'actions',
    header: t.inventoryMaster.actions,
    enableSorting: false,
    enableColumnFilter: false,
    meta: { align: 'end', excludeFromGlobalSearch: true },
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

/**
 * Item list (`GET /items`).
 *
 * The shared grid filters the bounded item read by code, name, kind and
 * active state in the browser (`docs/frontend/data-table.md`). The item group
 * is not part of the item row the grid renders, so its filter stays a real
 * server-side query parameter — still linkable in the URL, exactly as before.
 */
export function ItemsPage() {
  const organizationId = useOrganizationId();
  const [params, setParams] = useSearchParams();
  const itemGroupId = params.get('itemGroupId') ?? '';
  const groups = useActiveItemGroupOptions(organizationId);
  const query = useAllItems(organizationId, itemGroupId);
  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  const updateItemGroup = (value: string) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value === '') next.delete('itemGroupId');
        else next.set('itemGroupId', value);
        return next;
      },
      { replace: true },
    );
  };

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

      {total > items.length && (
        <DataTableTruncationNotice loaded={items.length} />
      )}

      <DataTable
        columns={columns}
        data={items}
        getRowId={(row) => row.id}
        caption={t.inventoryMaster.items}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        errorDescription={t.inventoryMaster.loadFailed}
        onRetry={() => void query.refetch()}
        emptyTitle={t.inventoryMaster.items}
        emptyDescription={t.inventoryMaster.itemsEmptyFirstUse}
        filtering={{
          initialPageSize: 50,
          pageSizeOptions: [25, 50, 100],
          toolbarActions: (
            <label className="flex items-center gap-1.5 text-[0.6875rem] text-ink-muted">
              <span>{t.inventoryMaster.itemGroupFilter}</span>
              <Select
                className="h-8 w-44 text-xs"
                aria-label={t.inventoryMaster.itemGroupFilter}
                data-testid="item-group-filter"
                value={itemGroupId}
                disabled={groups.unavailable}
                onChange={(event) => updateItemGroup(event.target.value)}
              >
                <option value="">{t.inventoryMaster.allItemGroups}</option>
                {groups.items.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.code} — {group.name}
                  </option>
                ))}
              </Select>
            </label>
          ),
        }}
      />
    </div>
  );
}
