import { useMemo, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import type { SortingState } from '@tanstack/react-table';
import type { AccountingDocument } from '@/api/contracts';
import { t } from '@/lib/i18n';
import { Badge } from '@/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/ui/card';
import { DataTable } from '@/ui/patterns/data-table';
import type { ColumnDef } from '@tanstack/react-table';
import { AmountCell } from '@/ui/patterns/amount-cell';
import { formatDateOnly, formatDateOnlyCanonical } from '@/lib/format';

/**
 * Recent accounting documents (reference: dense server-paged table).
 *
 * Built on the standard DataTable wrapper: manual (server) pagination and
 * sorting, sticky-safe horizontal scrolling, amount cells right-aligned with
 * tabular figures, and the document state rendered from the contract's
 * discriminated values. The sortable column ids are exactly the backend's
 * allow-listed sort fields; any other column is display-only.
 *
 * Drill-down (FE-UX-08): when the session also holds
 * `Accounting.Document.View`, the document number links to the document's
 * own page; without it, the number stays plain text (no dead links).
 */

const statePresentation = {
  draft: { label: t.dashboard.stateDraft, variant: 'neutral' },
  temporary: { label: t.dashboard.stateTemporary, variant: 'info' },
  final: { label: t.dashboard.stateFinal, variant: 'success' },
} as const;

function DocumentStateCell({
  value,
}: {
  value: AccountingDocument['state'];
}): ReactElement {
  const presentation = statePresentation[value];
  return <Badge variant={presentation.variant}>{presentation.label}</Badge>;
}

export function buildDocumentColumns(
  canOpenDocument: boolean,
): ColumnDef<AccountingDocument, unknown>[] {
  return [
    {
      id: 'documentNumber',
      // The accessorKey makes the column genuinely sortable in TanStack's
      // model (a display-only column cannot sort); sorting itself stays
      // manual and is delegated to the backend's allow-listed field.
      accessorKey: 'documentNumber',
      header: t.dashboard.colDocumentNumber,
      enableSorting: true,
      cell: ({ row }) =>
        canOpenDocument ? (
          <Link
            className="code font-semibold text-brand hover:underline"
            to={`/app/accounting/documents/${encodeURIComponent(row.original.id)}`}
            title={row.original.documentNumber ?? undefined}
          >
            {row.original.documentNumber ?? t.app.none}
          </Link>
        ) : (
          <span
            className="code font-semibold"
            title={row.original.documentNumber ?? undefined}
          >
            {row.original.documentNumber ?? t.app.none}
          </span>
        ),
    },
    {
      id: 'documentDate',
      accessorKey: 'documentDate',
      header: t.dashboard.colDocumentDate,
      enableSorting: true,
      cell: ({ row }) => (
        <span
          className="num"
          title={formatDateOnlyCanonical(row.original.documentDate)}
        >
          {formatDateOnly(row.original.documentDate)}
        </span>
      ),
    },
    {
      id: 'description',
      header: t.dashboard.colDescription,
      enableSorting: false,
      cell: ({ row }) => (
        <span
          className="block max-w-[21rem] truncate"
          title={row.original.description}
        >
          {row.original.description}
        </span>
      ),
    },
    {
      id: 'totalDebit',
      header: t.dashboard.colTotal,
      enableSorting: false,
      meta: { align: 'end' },
      cell: ({ row }) => <AmountCell value={row.original.totalDebit} />,
    },
    {
      id: 'state',
      header: t.dashboard.colState,
      enableSorting: false,
      cell: ({ row }) => <DocumentStateCell value={row.original.state} />,
    },
    {
      id: 'origin',
      header: t.dashboard.colOrigin,
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-xs text-ink-muted">
          {row.original.origin === 'system'
            ? t.dashboard.originSystem
            : t.dashboard.originManual}
        </span>
      ),
    },
  ];
}

export function DocumentsTable({
  documents,
  total,
  page,
  pageSize,
  sorting,
  isLoading,
  isFetching,
  error,
  onRetry,
  onPageChange,
  onPageSizeChange,
  onSortingChange,
  hasFilter,
  isPermitted = true,
  canOpenDocument = false,
}: {
  documents: AccountingDocument[];
  total: number;
  page: number;
  pageSize: number;
  sorting: SortingState;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onSortingChange: (sorting: SortingState) => void;
  hasFilter: boolean;
  isPermitted?: boolean;
  /** Drill-down to the document page requires `Accounting.Document.View`. */
  canOpenDocument?: boolean;
}): ReactElement {
  const columns = useMemo(
    () => buildDocumentColumns(canOpenDocument === true),
    [canOpenDocument],
  );
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="text-sm font-bold">
            {t.dashboard.documentsSectionLabel}
          </CardTitle>
          <CardDescription className="text-[11px]">
            {hasFilter
              ? t.dashboard.documentsFilteredEmptyBody
              : t.dashboard.documentsSubtitle}
          </CardDescription>
        </div>
      </CardHeader>
      {!isPermitted ? (
        <p className="m-4 rounded-card border border-dashed border-line-strong bg-surface px-6 py-6 text-center text-xs text-ink-subtle">
          {t.dashboard.noPermission}
        </p>
      ) : (
        <DataTable
          columns={columns}
          data={documents}
          getRowId={(row) => row.id}
          caption={t.dashboard.documentsSectionLabel}
          isLoading={isLoading}
          isFetching={isFetching}
          error={error}
          onRetry={onRetry}
          emptyTitle={
            hasFilter
              ? t.dashboard.documentsFilteredEmptyTitle
              : t.dashboard.documentsEmptyTitle
          }
          emptyDescription={
            hasFilter
              ? t.dashboard.documentsFilteredEmptyBody
              : t.dashboard.documentsEmptyBody
          }
          sorting={sorting}
          onSortingChange={onSortingChange}
          pagination={{
            page,
            pageSize,
            total,
            onPageChange,
            onPageSizeChange,
          }}
        />
      )}
    </Card>
  );
}
