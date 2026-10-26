import type { ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import type { InventoryUnitConversion } from '@/api/contracts';
import { formatBusinessDay } from '@/lib/datetime';
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
import { useActiveItemOptions } from '../master-data-references';
import { UnitConversionResolveSection } from './unit-conversion-resolve-page';
import { MasterDataFilters } from '../master-data-ui';
import {
  UNIT_CONVERSION_DEFAULT_SORT,
  UNIT_CONVERSION_SORT_FIELDS,
  useUnitConversionList,
} from './unit-conversion-hooks';

const columns: ColumnDef<InventoryUnitConversion, unknown>[] = [
  {
    accessorKey: 'fromUnitId',
    header: t.inventoryMaster.fromUnit,
    enableSorting: false,
    cell: ({ row }) => (
      <span className="code" title={row.original.fromUnitId}>
        {row.original.fromUnitId}
      </span>
    ),
  },
  {
    accessorKey: 'toUnitId',
    header: t.inventoryMaster.toUnit,
    enableSorting: false,
    cell: ({ row }) => (
      <span className="code" title={row.original.toUnitId}>
        {row.original.toUnitId}
      </span>
    ),
  },
  {
    accessorKey: 'factor',
    header: t.inventoryMaster.columnFactor,
    cell: ({ row }) => <span className="num">{row.original.factor}</span>,
  },
  {
    accessorKey: 'validFrom',
    header: t.inventoryMaster.columnValidFrom,
    cell: ({ row }) => (
      <span className="num">{formatBusinessDay(row.original.validFrom)}</span>
    ),
  },
  {
    accessorKey: 'validTo',
    header: t.inventoryMaster.columnValidTo,
    cell: ({ row }) =>
      row.original.validTo === null ? (
        <Badge variant="info">{t.inventoryMaster.openEnded}</Badge>
      ) : (
        <span className="num">{formatBusinessDay(row.original.validTo)}</span>
      ),
  },
  {
    accessorKey: 'updatedAt',
    header: t.inventoryMaster.updatedAt,
    cell: ({ row }) => (
      <span className="num">{formatDateTime(row.original.updatedAt)}</span>
    ),
  },
];

/**
 * Unit conversion versions (`GET /unit-conversions`).
 *
 * Two tables in one route, exactly as the backend declares: `scope=global`
 * (organization-wide unit pairs) and `scope=item` (one item's pairs, which
 * requires the item picker). Versions are immutable — the only write is
 * "create a new version", so there is no edit link.
 */
export function UnitConversionsPage() {
  const organizationId = useOrganizationId();
  const list = useAdminListState({
    sortFields: UNIT_CONVERSION_SORT_FIELDS,
    defaultSort: UNIT_CONVERSION_DEFAULT_SORT,
    extraKeys: ['scope', 'itemId'],
  });
  const scope =
    (list.extra['scope'] ?? 'global') === 'item' ? 'item' : 'global';
  const itemId = list.extra['itemId'] ?? '';
  const query = useUnitConversionList(organizationId, list.state, {
    scope,
    itemId,
  });
  const items = useActiveItemOptions(organizationId);

  return (
    <div className="space-y-4" data-testid="unit-conversions-page">
      <PageHeader
        title={t.inventoryMaster.unitConversions}
        description={t.inventoryMaster.unitConversionsDescription}
        actions={
          <PermissionGate
            permission={PERMISSIONS.inventory.unitConversionCreate}
          >
            <Button asChild size="sm">
              <Link to="/app/inventory/unit-conversions/new">
                {t.inventoryMaster.newUnitConversion}
              </Link>
            </Button>
          </PermissionGate>
        }
      />

      <UnitConversionResolveSection />

      <MasterDataFilters
        synchronizationKey={`${list.state.search}:${scope}:${itemId}`}
        search=""
        status=""
        showStatus={false}
        showSearch={false}
        onApply={() => undefined}
        onClear={list.clear}
      >
        <label className="min-w-44 text-xs text-ink-muted">
          <span>{t.inventoryMaster.conversionScope}</span>
          <Select
            className="mt-1"
            value={scope}
            onChange={(event) =>
              list.update({ scope: event.target.value, itemId: '' })
            }
          >
            <option value="global">
              {t.inventoryMaster.conversionScopes.global}
            </option>
            <option value="item">
              {t.inventoryMaster.conversionScopes.item}
            </option>
          </Select>
        </label>
        {scope === 'item' && (
          <label className="min-w-52 text-xs text-ink-muted">
            <span>{t.inventoryMaster.conversionItem}</span>
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
        )}
      </MasterDataFilters>

      <DataTable
        columns={columns}
        data={query.data?.items ?? []}
        getRowId={(row) => row.id}
        caption={t.inventoryMaster.unitConversions}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        errorDescription={t.inventoryMaster.conversionsLoadFailed}
        onRetry={() => void query.refetch()}
        emptyTitle={t.inventoryMaster.unitConversions}
        emptyDescription={
          scope === 'item' && itemId === ''
            ? t.inventoryMaster.allItems
            : t.inventoryMaster.conversionsEmptyFirstUse
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

      <p className="text-xs text-ink-subtle">
        {t.inventoryMaster.conversionNoEditNote}
      </p>
    </div>
  );
}
