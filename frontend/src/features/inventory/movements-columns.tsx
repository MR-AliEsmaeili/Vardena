import type { ColumnDef } from '@tanstack/react-table';
import type { InventoryMovement } from '@/api/contracts';
import {
  formatQuantity,
  formatDateOnly,
  formatDateOnlyCanonical,
} from '@/lib/format';
import { t } from '@/lib/i18n';
import { AmountCell } from '@/ui/patterns/amount-cell';
import { Badge } from '@/ui/badge';
import {
  movementTypeLabel,
  movementValuationStatusLabel,
} from './inventory-labels';
import type { InventoryReferences } from './use-inventory-references';

/**
 * Movements-table columns.
 *
 * The valuation STATUS column is always rendered (it is not money); the
 * signed VALUE column is rendered only for sessions holding
 * `Inventory.Valuation.View` — for everyone else the backend nulls
 * `totalCost`, and a permanently-empty value column would read as «بدون
 * قیمت» which would be a lie (FE-UX-02 §5.4: status is never hidden).
 *
 * An unvalued movement shows «—», NEVER «۰»: missing cost is not zero cost
 * (persian-ux-writing-standard §9 rule 11).
 */

export function movementsColumns(
  references: Pick<
    InventoryReferences,
    'itemById' | 'warehouseById' | 'unitById'
  >,
  options: { showCost: boolean },
): ColumnDef<InventoryMovement, unknown>[] {
  const columns: ColumnDef<InventoryMovement, unknown>[] = [
    {
      id: 'movementDate',
      accessorKey: 'movementDate',
      header: t.inventory.columnDate,
      cell: ({ row }) => (
        // OQ-73: movementDate is a business DATE — rendered in the org
        // calendar, never shifted through an instant/timezone.
        <span
          className="num"
          dir="ltr"
          title={formatDateOnlyCanonical(row.original.movementDate)}
        >
          {formatDateOnly(row.original.movementDate)}
        </span>
      ),
      meta: { align: 'start' },
    },
    {
      id: 'movementType',
      accessorKey: 'movementType',
      header: t.inventory.columnType,
      cell: ({ row }) => movementTypeLabel(row.original.movementType),
    },
    {
      id: 'item',
      accessorKey: 'itemId',
      header: t.inventory.columnItem,
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
      id: 'warehouse',
      accessorKey: 'warehouseId',
      header: t.inventory.columnWarehouse,
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
      header: t.inventory.columnQuantity,
      cell: ({ row }) => {
        const unit = references.unitById(row.original.enteredUnitId);
        return (
          <span className="num">
            {formatQuantity(row.original.quantity)}{' '}
            <span className="text-xs text-slate-500">
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
      header: t.inventory.columnBaseQuantity,
      cell: ({ row }) => {
        const unit = references.unitById(row.original.baseUnitId);
        return (
          <span className="num">
            {formatQuantity(row.original.baseQuantity)}{' '}
            <span className="text-xs text-slate-500">
              {unit?.code ?? row.original.baseUnitId}
            </span>
          </span>
        );
      },
      meta: { align: 'end' },
    },
    {
      id: 'valuationStatus',
      accessorKey: 'valuationStatus',
      header: t.inventory.columnValuationStatus,
      cell: ({ row }) => (
        <ValuationStatusBadge status={row.original.valuationStatus} />
      ),
    },
  ];

  if (options.showCost) {
    columns.push({
      id: 'totalCost',
      accessorKey: 'totalCost',
      header: t.inventory.columnTotalCost,
      // `null` is «بدون قیمت تمام‌شده»: rendered as «—», never as 0 — a
      // movement without a cost has NO value assigned, not a zero value
      // (persian-ux-writing-standard §9 rule 11).
      cell: ({ row }) =>
        row.original.totalCost === null ? (
          <span className="num">{t.inventory.noValue}</span>
        ) : (
          <AmountCell value={row.original.totalCost} />
        ),
      meta: { align: 'end' },
    });
  }

  return columns;
}

/** Finality badge — neutral for valued, warning for provisional, muted for unvalued. */
export function ValuationStatusBadge({
  status,
}: {
  status: InventoryMovement['valuationStatus'];
}) {
  const variant =
    status === 'valued'
      ? 'success'
      : status === 'provisional'
        ? 'warning'
        : 'neutral';
  return (
    <Badge variant={variant}>{movementValuationStatusLabel(status)}</Badge>
  );
}
