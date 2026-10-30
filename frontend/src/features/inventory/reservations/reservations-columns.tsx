import type { ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import type { InventoryReservation } from '@/api/contracts';
import { formatDateTimeWithZone, formatQuantity } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import type { InventoryReferences } from '../use-inventory-references';
import { isMaterialRequestLineReservation } from './reservation-reference';

export function reservationsColumns(
  references: Pick<
    InventoryReferences,
    'itemById' | 'warehouseById' | 'unitById'
  >,
): ColumnDef<InventoryReservation, unknown>[] {
  return [
    {
      id: 'itemId',
      accessorKey: 'itemId',
      enableSorting: false,
      header: t.reservations.item,
      cell: ({ row }) => {
        const item = references.itemById(row.original.itemId);
        return item === undefined ? (
          <span className="code">{row.original.itemId}</span>
        ) : (
          <span>
            {item.code} — {item.name}
          </span>
        );
      },
    },
    {
      id: 'warehouseId',
      accessorKey: 'warehouseId',
      enableSorting: false,
      header: t.reservations.warehouse,
      cell: ({ row }) => {
        const warehouse = references.warehouseById(row.original.warehouseId);
        return warehouse === undefined ? (
          <span className="code">{row.original.warehouseId}</span>
        ) : (
          <span>
            {warehouse.code} — {warehouse.name}
          </span>
        );
      },
    },
    {
      id: 'quantity',
      accessorKey: 'quantity',
      enableSorting: false,
      header: t.reservations.quantity,
      cell: ({ row }) => {
        const unit = references.unitById(row.original.enteredUnitId);
        return (
          <span className="num">
            {formatQuantity(row.original.quantity)}{' '}
            <span className="text-xs text-ink-subtle">
              {unit?.code ?? row.original.enteredUnitId}
            </span>
          </span>
        );
      },
      meta: { align: 'end' },
    },
    {
      id: 'baseQuantity',
      accessorKey: 'baseQuantity',
      enableSorting: false,
      header: t.reservations.baseQuantity,
      cell: ({ row }) => {
        const unit = references.unitById(row.original.baseUnitId);
        return (
          <span className="num">
            {formatQuantity(row.original.baseQuantity)}{' '}
            <span className="text-xs text-ink-subtle">
              {unit?.code ?? row.original.baseUnitId}
            </span>
          </span>
        );
      },
      meta: { align: 'end' },
    },
    {
      id: 'status',
      accessorKey: 'status',
      enableSorting: true,
      header: t.reservations.status,
      cell: ({ row }) => (
        <Badge
          variant={row.original.status === 'active' ? 'success' : 'neutral'}
        >
          {t.reservations.statuses[row.original.status]}
        </Badge>
      ),
    },
    {
      id: 'referenceType',
      accessorKey: 'referenceType',
      enableSorting: false,
      header: t.reservations.reference,
      cell: ({ row }) => {
        const reservation = row.original;
        if (reservation.referenceType === null) return t.app.none;
        return isMaterialRequestLineReservation(reservation)
          ? t.reservations.referenceMaterialRequest
          : reservation.referenceType;
      },
    },
    {
      id: 'referenceId',
      accessorKey: 'referenceId',
      enableSorting: false,
      header: t.reservations.referenceId,
      cell: ({ row }) =>
        row.original.referenceId === null ? (
          t.app.none
        ) : (
          <span className="code">{row.original.referenceId}</span>
        ),
    },
    {
      id: 'createdAt',
      accessorKey: 'createdAt',
      enableSorting: true,
      header: t.reservations.createdAt,
      cell: ({ row }) => (
        <span dir="ltr" title={row.original.createdAt}>
          {formatDateTimeWithZone(row.original.createdAt)}
        </span>
      ),
    },
    {
      id: 'updatedAt',
      accessorKey: 'updatedAt',
      enableSorting: true,
      header: t.reservations.updatedAt,
      cell: ({ row }) => (
        <span dir="ltr" title={row.original.updatedAt}>
          {formatDateTimeWithZone(row.original.updatedAt)}
        </span>
      ),
    },
    {
      id: 'releasedAt',
      accessorKey: 'releasedAt',
      enableSorting: false,
      header: t.reservations.releasedAt,
      cell: ({ row }) =>
        row.original.releasedAt === null ? (
          t.app.none
        ) : (
          <span dir="ltr" title={row.original.releasedAt}>
            {formatDateTimeWithZone(row.original.releasedAt)}
          </span>
        ),
    },
    {
      id: 'actions',
      enableSorting: false,
      header: t.reservations.openDetails,
      cell: ({ row }) => (
        <Button asChild size="sm" variant="ghost">
          <Link to={`/app/inventory/reservations/${row.original.id}`}>
            {t.reservations.openDetails}
          </Link>
        </Button>
      ),
    },
  ];
}
