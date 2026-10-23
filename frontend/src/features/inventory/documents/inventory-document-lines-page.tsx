import type { ColumnDef } from '@tanstack/react-table';
import { List, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type {
  InventoryDocument,
  InventoryDocumentKind,
  InventoryDocumentLine,
  InventoryDocumentStatus,
} from '@/api/contracts';
import { useOrganizationId } from '@/features/organization/use-organization';
import { exportRowsToExcelCsv, printCurrentSurface } from '@/lib/export-table';
import {
  formatDateOnly,
  formatDateOnlyCanonical,
  formatQuantity,
} from '@/lib/format';
import { t } from '@/lib/i18n';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Card } from '@/ui/card';
import { Label } from '@/ui/label';
import { Select } from '@/ui/select';
import { DataTable } from '@/ui/patterns/data-table';
import { DocumentListToolbar } from '@/ui/patterns/operational-form';
import { LoadingState } from '@/ui/patterns/states';
import { PageHeader } from '@/ui/patterns/page-header';
import { useInventoryReferences } from '../use-inventory-references';
import {
  DOCUMENT_KINDS,
  DOCUMENT_STATUSES,
  documentKindLabel,
  documentStatusLabel,
  documentStatusTone,
} from './inventory-document-labels';
import {
  DOCUMENTS_DEFAULT_SORT,
  documentsSortingState,
  hasActiveDocumentFilters,
  useDocumentsList,
  useDocumentsUrlState,
} from './use-inventory-documents';

export interface FlattenedInventoryDocumentLine {
  rowKey: string;
  documentId: string;
  documentNumber: string | null;
  kind: InventoryDocumentKind;
  businessDate: string;
  status: InventoryDocumentStatus;
  warehouseLabel: string;
  line: InventoryDocumentLine;
  itemLabel: string;
  unitLabel: string;
}

const INVENTORY_DOCUMENT_LINE_COLUMNS: ColumnDef<
  FlattenedInventoryDocumentLine,
  unknown
>[] = [
  {
    id: 'number',
    accessorFn: (row) => row.documentNumber,
    header: t.documentLines.colDocNumber,
    enableSorting: true,
    cell: ({ row }) => (
      <Link
        to={`/app/inventory/documents/${row.original.documentId}`}
        className="code font-semibold text-brand hover:underline"
        data-testid={`open-inv-parent-doc-${row.original.documentId}`}
      >
        {row.original.documentNumber ?? t.inventoryDocuments.numberNotAllocated}
      </Link>
    ),
  },
  {
    id: 'businessDate',
    accessorFn: (row) => row.businessDate,
    header: t.documentLines.colDocDate,
    enableSorting: true,
    cell: ({ row }) => (
      <span
        className="code"
        title={formatDateOnlyCanonical(row.original.businessDate)}
      >
        {formatDateOnly(row.original.businessDate)}
      </span>
    ),
  },
  {
    id: 'kind',
    header: t.documentLines.colDocKind,
    enableSorting: false,
    cell: ({ row }) => documentKindLabel(row.original.kind),
  },
  {
    id: 'status',
    header: t.documentLines.colDocState,
    enableSorting: false,
    cell: ({ row }) => (
      <Badge variant={documentStatusTone(row.original.status)}>
        {documentStatusLabel(row.original.status)}
      </Badge>
    ),
  },
  {
    id: 'warehouse',
    header: t.documentLines.colWarehouse,
    enableSorting: false,
    cell: ({ row }) => row.original.warehouseLabel,
  },
  {
    id: 'lineNumber',
    header: t.documentLines.colLineNo,
    enableSorting: false,
    cell: ({ row }) => (
      <span className="num">{row.original.line.lineNumber}</span>
    ),
  },
  {
    id: 'item',
    header: t.documentLines.colItem,
    enableSorting: false,
    cell: ({ row }) => row.original.itemLabel,
  },
  {
    id: 'quantity',
    header: t.documentLines.colQuantity,
    enableSorting: false,
    meta: { align: 'end' },
    cell: ({ row }) => (
      <span className="num">{formatQuantity(row.original.line.quantity)}</span>
    ),
  },
  {
    id: 'unit',
    header: t.documentLines.colUnit,
    enableSorting: false,
    cell: ({ row }) => row.original.unitLabel,
  },
  {
    id: 'baseQuantity',
    header: t.documentLines.colBaseQuantity,
    enableSorting: false,
    meta: { align: 'end' },
    cell: ({ row }) => (
      <span className="num">
        {formatQuantity(row.original.line.baseQuantity)}
      </span>
    ),
  },
  {
    id: 'actions',
    header: t.documents.colAction,
    enableSorting: false,
    cell: ({ row }) => (
      <Button asChild variant="ghost" size="sm">
        <Link to={`/app/inventory/documents/${row.original.documentId}`}>
          {t.documentLines.openParentDocument}
        </Link>
      </Button>
    ),
  },
];

/**
 * Inventory Document Lines Explorer (`/app/inventory/document-lines`).
 *
 * Read-only cross-document line view showing every permitted operational
 * inventory line paired with its parent document's essential Header metadata,
 * backed by the real `GET /api/v1/inventory/business-documents` contract, with
 * filter, search, sort, pagination, virtualization, Print, Excel export, and
 * direct parent-document opening.
 */
export function InventoryDocumentLinesPage() {
  const organizationId = useOrganizationId();
  const navigate = useNavigate();
  const { state, update, clearFilters } = useDocumentsUrlState();
  const references = useInventoryReferences(organizationId);
  const documentsQuery = useDocumentsList(organizationId, state);

  const [filtersVisible, setFiltersVisible] = useState(true);
  const [lineQuery, setLineQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const rows = useMemo<FlattenedInventoryDocumentLine[]>(() => {
    const docs: readonly InventoryDocument[] = documentsQuery.data?.items ?? [];
    const needle = lineQuery.trim().toLowerCase();
    const result: FlattenedInventoryDocumentLine[] = [];

    for (const doc of docs) {
      const warehouseLabel =
        doc.kind === 'transfer'
          ? `${references.warehouseById(doc.sourceWarehouseId ?? '')?.name ?? doc.sourceWarehouseId ?? t.app.none} ← ${references.warehouseById(doc.destinationWarehouseId ?? '')?.name ?? doc.destinationWarehouseId ?? t.app.none}`
          : (references.warehouseById(doc.warehouseId ?? '')?.name ??
            doc.warehouseId ??
            t.app.none);

      for (const line of doc.lines) {
        const item = references.itemById(line.itemId);
        const unit = references.unitById(line.unitId);
        const itemLabel =
          item !== undefined ? `${item.code} — ${item.name}` : line.itemId;
        const unitLabel = unit !== undefined ? unit.name : line.unitId;

        if (needle !== '') {
          const hay = [
            doc.number ?? '',
            doc.description ?? '',
            warehouseLabel,
            itemLabel,
            unitLabel,
          ]
            .join(' ')
            .toLowerCase();
          if (!hay.includes(needle)) continue;
        }

        result.push({
          rowKey: `${doc.id}:${line.id}`,
          documentId: doc.id,
          documentNumber: doc.number,
          kind: doc.kind,
          businessDate: doc.businessDate,
          status: doc.status,
          warehouseLabel,
          line,
          itemLabel,
          unitLabel,
        });
      }
    }
    return result;
  }, [documentsQuery.data?.items, lineQuery, references]);

  const selectedParentId = useMemo(() => {
    for (const row of rows) {
      if (selectedIds.has(row.rowKey)) return row.documentId;
    }
    return null;
  }, [rows, selectedIds]);

  const columns = INVENTORY_DOCUMENT_LINE_COLUMNS;

  if (organizationId === null) {
    return <LoadingState rows={6} label={t.organization.loading} />;
  }

  const filtersActive =
    hasActiveDocumentFilters(state) || lineQuery.trim() !== '';

  const handleExportExcel = () => {
    exportRowsToExcelCsv(
      'inventory-document-lines',
      [
        {
          header: t.documentLines.colDocNumber,
          value: (row) => row.documentNumber ?? '',
        },
        {
          header: t.documentLines.colDocDate,
          value: (row) => formatDateOnly(row.businessDate),
        },
        {
          header: t.documentLines.colDocKind,
          value: (row) => documentKindLabel(row.kind),
        },
        {
          header: t.documentLines.colDocState,
          value: (row) => documentStatusLabel(row.status),
        },
        {
          header: t.documentLines.colWarehouse,
          value: (row) => row.warehouseLabel,
        },
        {
          header: t.documentLines.colLineNo,
          value: (row) => row.line.lineNumber,
        },
        {
          header: t.documentLines.colItem,
          value: (row) => row.itemLabel,
        },
        {
          header: t.documentLines.colQuantity,
          value: (row) => row.line.quantity,
        },
        {
          header: t.documentLines.colUnit,
          value: (row) => row.unitLabel,
        },
        {
          header: t.documentLines.colBaseQuantity,
          value: (row) => row.line.baseQuantity,
        },
      ],
      rows,
    );
  };

  return (
    <div className="space-y-4" data-testid="inventory-document-lines-page">
      <PageHeader
        title={t.documentLines.inventoryTitle}
        description={t.documentLines.inventorySubtitle}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void documentsQuery.refetch()}
              disabled={documentsQuery.isFetching}
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              {t.documents.refresh}
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/app/inventory/documents">
                <List className="h-4 w-4" aria-hidden />
                {t.operationalForm.viewDocuments}
              </Link>
            </Button>
          </>
        }
      />

      <DocumentListToolbar
        searchValue={lineQuery}
        searchPlaceholder={t.documentLines.searchLinesPlaceholder}
        onSearchChange={setLineQuery}
        onFilterToggle={() => setFiltersVisible((prev) => !prev)}
        filterActive={filtersActive}
        onPrint={printCurrentSurface}
        onExportExcel={handleExportExcel}
        exportDisabled={rows.length === 0}
        onOpenSelected={
          selectedParentId !== null
            ? () => navigate(`/app/inventory/documents/${selectedParentId}`)
            : undefined
        }
      />

      {filtersVisible && (
        <Card className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-40">
              <Label htmlFor="doc-lines-kind">
                {t.inventoryDocuments.kindFilter}
              </Label>
              <Select
                id="doc-lines-kind"
                data-testid="doc-lines-kind-filter"
                value={state.kind}
                onChange={(event) =>
                  update({
                    kind: event.target.value as InventoryDocumentKind | '',
                    page: 1,
                  })
                }
              >
                <option value="">{t.inventoryDocuments.allKinds}</option>
                {DOCUMENT_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {documentKindLabel(kind)}
                  </option>
                ))}
              </Select>
            </div>

            <div className="min-w-40">
              <Label htmlFor="doc-lines-status">
                {t.inventoryDocuments.statusFilter}
              </Label>
              <Select
                id="doc-lines-status"
                data-testid="doc-lines-status-filter"
                value={state.status}
                onChange={(event) =>
                  update({
                    status: event.target.value as InventoryDocumentStatus | '',
                    page: 1,
                  })
                }
              >
                <option value="">{t.inventoryDocuments.allStatuses}</option>
                {DOCUMENT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {documentStatusLabel(status)}
                  </option>
                ))}
              </Select>
            </div>

            <div className="min-w-56">
              <Label htmlFor="doc-lines-warehouse">
                {t.inventoryDocuments.columnWarehouse}
              </Label>
              <Select
                id="doc-lines-warehouse"
                data-testid="doc-lines-warehouse-filter"
                value={state.warehouseId}
                onChange={(event) =>
                  update({ warehouseId: event.target.value, page: 1 })
                }
              >
                <option value="">{t.inventoryDocuments.allWarehouses}</option>
                {references.warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.code} — {warehouse.name}
                  </option>
                ))}
              </Select>
            </div>

            {filtersActive && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setLineQuery('');
                  clearFilters();
                }}
                data-testid="doc-lines-clear-filters"
              >
                {t.app.reset}
              </Button>
            )}
          </div>
        </Card>
      )}

      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.rowKey}
        isLoading={documentsQuery.isPending}
        isFetching={documentsQuery.isFetching}
        error={documentsQuery.isError ? documentsQuery.error : undefined}
        errorDescription={t.inventoryDocuments.loadFailed}
        onRetry={() => void documentsQuery.refetch()}
        emptyTitle={t.documentLines.emptyInventoryTitle}
        emptyDescription={t.documentLines.emptyInventoryBody}
        selectable
        selectedRowIds={selectedIds}
        onSelectedRowIdsChange={setSelectedIds}
        onRowActivate={(row) =>
          navigate(`/app/inventory/documents/${row.documentId}`)
        }
        virtualize
        sorting={documentsSortingState(state.sort)}
        onSortingChange={(sorting) => {
          const first = sorting[0];
          update({
            sort:
              first === undefined
                ? DOCUMENTS_DEFAULT_SORT
                : `${first.id}:${first.desc ? 'desc' : 'asc'}`,
            page: 1,
          });
        }}
        pagination={{
          page: state.page,
          pageSize: state.pageSize,
          total: documentsQuery.data?.total ?? 0,
          onPageChange: (page) => update({ page }),
          onPageSizeChange: (pageSize) => update({ pageSize, page: 1 }),
        }}
        caption={t.documentLines.inventoryTitle}
      />
    </div>
  );
}
