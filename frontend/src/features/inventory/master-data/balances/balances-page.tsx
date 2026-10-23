import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';
import type { InventoryBalance } from '@/api/contracts';
import { useOrganizationId } from '@/features/organization/use-organization';
import { formatBusinessDay } from '@/lib/datetime';
import { formatQuantity } from '@/lib/format';
import { t } from '@/lib/i18n';
import {
  ADMIN_PAGE_SIZE_OPTIONS,
  useAdminListState,
} from '@/lib/use-admin-list-state';
import { DataTable } from '@/ui/patterns/data-table';
import { PageHeader } from '@/ui/patterns/page-header';
import { Select } from '@/ui/select';
import {
  useActiveItemOptions,
  useActiveWarehouseOptions,
} from '../master-data-references';
import { MasterDataFilters } from '../master-data-ui';
import {
  BALANCE_DEFAULT_SORT,
  BALANCE_SORT_FIELDS,
  useBalanceList,
} from './balance-hooks';

interface NameMaps {
  warehouseById: Map<string, { code: string; name: string }>;
  itemById: Map<string, { code: string; name: string }>;
}

/** Column factory — built once per reference-window change (§ unstable cells). */
function balanceColumns({
  warehouseById,
  itemById,
}: NameMaps): ColumnDef<InventoryBalance, unknown>[] {
  return [
    {
      id: 'warehouse',
      header: t.inventoryMaster.warehouses,
      enableSorting: false,
      cell: ({ row }) => {
        const warehouse = warehouseById.get(row.original.warehouseId);
        return warehouse !== undefined ? (
          <>
            <span className="code">{warehouse.code}</span> — {warehouse.name}
          </>
        ) : (
          <span className="code">{row.original.warehouseId}</span>
        );
      },
    },
    {
      id: 'item',
      header: t.inventoryMaster.item,
      enableSorting: false,
      cell: ({ row }) => {
        const item = itemById.get(row.original.itemId);
        return item !== undefined ? (
          <>
            <span className="code">{item.code}</span> — {item.name}
          </>
        ) : (
          <span className="code">{row.original.itemId}</span>
        );
      },
    },
    {
      accessorKey: 'onHand',
      header: t.inventoryMaster.onHand,
      cell: ({ row }) => (
        <span className="num">{formatQuantity(row.original.onHand)}</span>
      ),
    },
    {
      accessorKey: 'reserved',
      header: t.inventoryMaster.reserved,
      enableSorting: false,
      cell: ({ row }) => (
        <span className="num">{formatQuantity(row.original.reserved)}</span>
      ),
    },
    {
      accessorKey: 'available',
      header: t.inventoryMaster.available,
      enableSorting: false,
      cell: ({ row }) => (
        <span className="num font-medium">
          {formatQuantity(row.original.available)}
        </span>
      ),
    },
    {
      accessorKey: 'lastMovementDate',
      header: t.inventoryMaster.lastMovementDate,
      cell: ({ row }) =>
        row.original.lastMovementDate === null ? (
          <span className="text-ink-subtle">—</span>
        ) : (
          <span className="num">
            {formatBusinessDay(row.original.lastMovementDate)}
          </span>
        ),
    },
  ];
}

/**
 * Stock balances page (`GET /inventory/balances`).
 *
 * Read-only by design: balances are the backend's live projection of the
 * movement ledger — no create/edit/lifecycle exists and none may be faked.
 * The table resolves warehouse/item codes and names from the reference
 * lists; a row whose reference is outside the active window still shows its
 * id rather than an invented name.
 */
export function BalancesPage() {
  const organizationId = useOrganizationId();
  const list = useAdminListState({
    sortFields: BALANCE_SORT_FIELDS,
    defaultSort: BALANCE_DEFAULT_SORT,
    extraKeys: ['warehouseId', 'itemId'],
  });
  const warehouseId = list.extra['warehouseId'] ?? '';
  const itemId = list.extra['itemId'] ?? '';
  const query = useBalanceList(organizationId, list.state, {
    warehouseId,
    itemId,
  });
  const warehouses = useActiveWarehouseOptions(organizationId);
  const items = useActiveItemOptions(organizationId);

  // Name lookups are pure maps over the reference windows — memoized so the
  // table does not rebuild them per cell.
  const warehouseById = useMemo(
    () => new Map(warehouses.items.map((w) => [w.id, w])),
    [warehouses.items],
  );
  const itemById = useMemo(
    () => new Map(items.items.map((i) => [i.id, i])),
    [items.items],
  );
  const columns = useMemo(
    () => balanceColumns({ warehouseById, itemById }),
    [warehouseById, itemById],
  );

  return (
    <div className="space-y-4" data-testid="balances-page">
      <PageHeader
        title={t.inventoryMaster.balances}
        description={t.inventoryMaster.balancesDescription}
      />

      <MasterDataFilters
        synchronizationKey={`${warehouseId}:${itemId}`}
        search=""
        status=""
        showStatus={false}
        showSearch={false}
        onApply={() => undefined}
        onClear={list.clear}
      >
        <label className="min-w-44 text-xs text-ink-muted">
          <span>{t.inventoryMaster.warehouseFilter}</span>
          <Select
            className="mt-1"
            value={warehouseId}
            disabled={warehouses.unavailable}
            onChange={(event) =>
              list.update({ warehouseId: event.target.value })
            }
          >
            <option value="">{t.inventoryMaster.allWarehouses}</option>
            {warehouses.items.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.code} — {warehouse.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="min-w-44 text-xs text-ink-muted">
          <span>{t.inventoryMaster.itemFilter}</span>
          <Select
            className="mt-1"
            value={itemId}
            disabled={items.unavailable}
            onChange={(event) => list.update({ itemId: event.target.value })}
          >
            <option value="">{t.inventoryMaster.allItems}</option>
            {items.items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code} — {item.name}
              </option>
            ))}
          </Select>
        </label>
      </MasterDataFilters>

      <DataTable
        columns={columns}
        data={query.data?.items ?? []}
        getRowId={(row) => row.id}
        caption={t.inventoryMaster.balances}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        errorDescription={t.inventoryMaster.balancesLoadFailed}
        onRetry={() => void query.refetch()}
        emptyTitle={t.inventoryMaster.balances}
        emptyDescription={t.inventoryMaster.balancesEmptyFirstUse}
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
