import type { ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import type { InventoryDocument } from '@/api/contracts';
import {
  formatCount,
  formatDateOnly,
  formatDateOnlyCanonical,
} from '@/lib/format';
import { t } from '@/lib/i18n';
import { Badge } from '@/ui/badge';
import type { InventoryReferences } from '../use-inventory-references';
import {
  documentKindLabel,
  documentStatusLabel,
  documentStatusTone,
  documentWarehouseId,
} from './inventory-document-labels';

/**
 * Documents-table columns.
 *
 * A draft has NO number yet (numbering happens at finalize), so the number
 * cell says «هنوز شماره نگرفته است» instead of «—» or a fabricated
 * placeholder: the absence is a fact about the lifecycle, not missing data.
 */
export function inventoryDocumentsColumns(
  references: Pick<InventoryReferences, 'warehouseById'>,
): ColumnDef<InventoryDocument, unknown>[] {
  return [
    {
      id: 'number',
      accessorKey: 'number',
      header: t.inventoryDocuments.columnNumber,
      cell: ({ row }) => (
        <Link
          className="font-medium text-indigo-700 underline-offset-4 hover:underline"
          to={`/app/inventory/documents/${row.original.id}`}
          data-testid={`document-link-${row.original.id}`}
        >
          {row.original.number === null ? (
            <span className="text-slate-500">
              {t.inventoryDocuments.numberNotAllocated}
            </span>
          ) : (
            <span className="num">{row.original.number}</span>
          )}
        </Link>
      ),
      meta: { align: 'start' },
    },
    {
      id: 'kind',
      accessorKey: 'kind',
      header: t.inventoryDocuments.columnKind,
      cell: ({ row }) => documentKindLabel(row.original.kind),
    },
    {
      id: 'businessDate',
      accessorKey: 'businessDate',
      header: t.inventoryDocuments.columnDate,
      cell: ({ row }) => (
        // ADR-0044 / OQ-73: render Jalali-first, retaining the canonical
        // Gregorian value on hover. The API returns a BusinessDate, not an instant.
        <span
          className="num"
          dir="ltr"
          title={formatDateOnlyCanonical(row.original.businessDate)}
        >
          {formatDateOnly(row.original.businessDate)}
        </span>
      ),
      meta: { align: 'start' },
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: t.inventoryDocuments.columnStatus,
      cell: ({ row }) => (
        <Badge variant={documentStatusTone(row.original.status)}>
          {documentStatusLabel(row.original.status)}
        </Badge>
      ),
    },
    {
      id: 'warehouse',
      header: t.inventoryDocuments.columnWarehouse,
      enableSorting: false,
      cell: ({ row }) => {
        const warehouseId = documentWarehouseId(row.original);
        if (warehouseId === null) return <span>{t.app.none}</span>;
        const warehouse = references.warehouseById(warehouseId);
        if (warehouse === undefined) {
          return <span className="code">{warehouseId}</span>;
        }
        if (row.original.kind !== 'transfer') {
          return (
            <span>
              {warehouse.code} — {warehouse.name}
            </span>
          );
        }
        const destinationId = row.original.destinationWarehouseId;
        const destination =
          destinationId === null
            ? undefined
            : references.warehouseById(destinationId);
        return (
          <span>
            {warehouse.code} ← {destination?.code ?? destinationId}
          </span>
        );
      },
    },
    {
      id: 'lines',
      header: t.inventoryDocuments.columnLines,
      enableSorting: false,
      cell: ({ row }) => (
        <span className="num">{formatCount(row.original.lines.length)}</span>
      ),
      meta: { align: 'end' },
    },
  ];
}
