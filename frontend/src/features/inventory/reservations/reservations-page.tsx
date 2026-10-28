import type { ColumnDef, Row } from '@tanstack/react-table';
import type { InventoryReservation } from '@/api/inventory.api';
import { useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { formatDateTime } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { DataTable } from '@/ui/patterns/data-table';
import { FilterBar, FilterField } from '@/ui/patterns/filter-bar';
import { PageHeader } from '@/ui/patterns/page-header';
import { Badge } from '@/ui/badge';
import { Select } from '@/ui/select';
import {
  useReservationsList,
  useReservationsUrlState,
  RESERVATIONS_DEFAULT_SORT,
} from './reservation-hooks';
import { useInventoryReferences } from '../use-inventory-references';

function statusCell(status: 'active' | 'released') {
  return (
    <Badge variant={status === 'active' ? 'success' : 'neutral'}>
      {status === 'active'
        ? t.reservations.statuses.active
        : t.reservations.statuses.released}
    </Badge>
  );
}

function CreatedAtCell({ row }: { row: Row<InventoryReservation> }) {
  return (
    <time data-testid="reservation-created-at">
      {formatDateTime(row.original.createdAt)}
    </time>
  );
}

function ItemCell({
  row,
  references,
}: {
  row: Row<InventoryReservation>;
  references: ReturnType<typeof useInventoryReferences>;
}) {
  const item = references.itemById(row.original.itemId);
  return item === undefined ? (
    <span className="code">{row.original.itemId}</span>
  ) : (
    `${item.code} — ${item.name}`
  );
}

function WarehouseCell({
  row,
  references,
}: {
  row: Row<InventoryReservation>;
  references: ReturnType<typeof useInventoryReferences>;
}) {
  const warehouse = references.warehouseById(row.original.warehouseId);
  return warehouse === undefined ? (
    <span className="code">{row.original.warehouseId}</span>
  ) : (
    `${warehouse.code} — ${warehouse.name}`
  );
}

function QuantityCell({
  row,
  references,
}: {
  row: Row<InventoryReservation>;
  references: ReturnType<typeof useInventoryReferences>;
}) {
  const unit = references.unitById(row.original.enteredUnitId);
  return (
    <span dir="ltr" className="num">
      {row.original.quantity} {unit === undefined ? '' : unit.code}
    </span>
  );
}

function BaseQuantityCell({
  row,
  references,
}: {
  row: Row<InventoryReservation>;
  references: ReturnType<typeof useInventoryReferences>;
}) {
  const unit = references.unitById(row.original.baseUnitId);
  return (
    <span dir="ltr" className="num">
      {row.original.baseQuantity} {unit === undefined ? '' : unit.code}
    </span>
  );
}

function ReferenceCell({ row }: { row: Row<InventoryReservation> }) {
  if (
    row.original.referenceType === null ||
    row.original.referenceId === null
  ) {
    return '—';
  }
  return (
    <>
      {row.original.referenceType === 'material_request_line'
        ? t.reservations.referenceMaterialRequest
        : row.original.referenceType}
      {row.original.referenceId}
    </>
  );
}

export function ReservationsPage() {
  const organizationId = useOrganizationId();
  const permissions = usePermissions();
  const [params] = useSearchParams();
  const { state, update, clearFilters } = useReservationsUrlState();
  const references = useInventoryReferences(organizationId);
  const reservationsQuery = useReservationsList(organizationId, state);

  const canCreate = permissions.has(PERMISSIONS.inventory.reservationCreate);

  const itemCell = useCallback(
    ({ row }: { row: Row<InventoryReservation> }) => (
      <ItemCell row={row} references={references} />
    ),
    [references],
  );
  const warehouseCell = useCallback(
    ({ row }: { row: Row<InventoryReservation> }) => (
      <WarehouseCell row={row} references={references} />
    ),
    [references],
  );
  const quantityCell = useCallback(
    ({ row }: { row: Row<InventoryReservation> }) => (
      <QuantityCell row={row} references={references} />
    ),
    [references],
  );
  const baseQuantityCell = useCallback(
    ({ row }: { row: Row<InventoryReservation> }) => (
      <BaseQuantityCell row={row} references={references} />
    ),
    [references],
  );
  const referenceCell = useCallback(
    ({ row }: { row: Row<InventoryReservation> }) => (
      <ReferenceCell row={row} />
    ),
    [],
  );

  const columns: ColumnDef<InventoryReservation, unknown>[] = useMemo(
    () => [
      {
        id: 'item',
        accessorKey: 'itemId',
        header: t.inventory.item,
        cell: itemCell,
      },
      {
        id: 'warehouse',
        accessorKey: 'warehouseId',
        header: t.inventory.warehouse,
        cell: warehouseCell,
      },
      {
        id: 'quantity',
        header: t.reservations.quantity,
        cell: quantityCell,
      },
      {
        id: 'baseQuantity',
        header: t.reservations.baseQuantity,
        cell: baseQuantityCell,
      },
      {
        id: 'status',
        header: t.reservations.status,
        cell: ({ row }) => statusCell(row.original.status),
      },
      {
        id: 'reference',
        header: t.reservations.reference,
        cell: referenceCell,
      },
      {
        id: 'createdAt',
        header: t.reservations.createdAt,
        cell: CreatedAtCell,
      },
    ],
    [itemCell, warehouseCell, quantityCell, baseQuantityCell, referenceCell],
  );

  const filtersActive =
    state.warehouseId !== '' || state.itemId !== '' || state.status !== '';
  const synchronizationKey = params.toString();

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.reservations.title}
        description={t.reservations.subtitle}
        actions={
          canCreate ? (
            <Button asChild size="sm">
              <Link to="/app/inventory/reservations/new">
                <Plus className="h-4 w-4" aria-hidden />
                {t.reservations.newReservation}
              </Link>
            </Button>
          ) : null
        }
      />
      <FilterBar
        key={synchronizationKey}
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          update({
            warehouseId: String(data.get('warehouseId') ?? ''),
            itemId: String(data.get('itemId') ?? ''),
            status: String(data.get('status') ?? ''),
            page: 1,
          });
        }}
        onClear={clearFilters}
        applyLabel={t.inventoryMaster.filter}
        clearLabel={t.inventoryMaster.clear}
        columns={4}
        aria-label={t.filters.title}
        data-testid="reservations-filter-bar"
        isFetching={reservationsQuery.isFetching}
      >
        <FilterField label={t.inventory.warehouse}>
          <Select name="warehouseId" defaultValue={state.warehouseId}>
            <option value="">{t.filters.select}</option>
            {references.warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.code} — {warehouse.name}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label={t.inventory.item}>
          <Select name="itemId" defaultValue={state.itemId}>
            <option value="">{t.filters.select}</option>
            {references.items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code} — {item.name}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label={t.reservations.status}>
          <Select name="status" defaultValue={state.status}>
            <option value="">{t.inventoryMaster.allStatuses}</option>
            <option value="active">{t.reservations.statuses.active}</option>
            <option value="released">{t.reservations.statuses.released}</option>
          </Select>
        </FilterField>
      </FilterBar>
      <DataTable
        columns={columns}
        data={reservationsQuery.data?.items ?? []}
        getRowId={(row) => row.id}
        isLoading={reservationsQuery.isPending}
        isFetching={reservationsQuery.isFetching}
        error={reservationsQuery.isError ? reservationsQuery.error : undefined}
        errorDescription={t.reservations.loadFailed}
        onRetry={() => void reservationsQuery.refetch()}
        emptyTitle={
          filtersActive ? t.table.emptyTitle : t.reservations.emptyTitle
        }
        emptyDescription={
          filtersActive ? t.table.emptyBody : t.reservations.emptyBody
        }
        sorting={[
          {
            id: state.sort.split(':')[0] ?? 'createdAt',
            desc: state.sort.endsWith(':desc'),
          },
        ]}
        onSortingChange={(sorting) => {
          const first = sorting[0];
          update({
            sort:
              first === undefined
                ? RESERVATIONS_DEFAULT_SORT
                : `${first.id}:${first.desc ? 'desc' : 'asc'}`,
            page: 1,
          });
        }}
        pagination={{
          page: state.page,
          pageSize: state.pageSize,
          total: reservationsQuery.data?.total ?? 0,
          onPageChange: (page) => update({ page }),
          onPageSizeChange: (pageSize) => update({ pageSize, page: 1 }),
        }}
        caption={t.reservations.title}
      />
    </div>
  );
}
