import type { ColumnDef } from '@tanstack/react-table';
import { List, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type {
  AccountingDocument,
  AccountingDocumentLine,
} from '@/api/contracts';
import { useOrganizationId } from '@/features/organization/use-organization';
import { exportRowsToExcelCsv, printCurrentSurface } from '@/lib/export-table';
import { formatDateOnly, formatDateOnlyCanonical } from '@/lib/format';
import { t } from '@/lib/i18n';
import { sortingToParam } from '@/lib/sort-param';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { AmountCell } from '@/ui/patterns/amount-cell';
import { DataTable } from '@/ui/patterns/data-table';
import { DocumentListToolbar } from '@/ui/patterns/operational-form';
import { PageHeader } from '@/ui/patterns/page-header';
import {
  documentStatePresentation,
  parseDocumentState,
} from './document-lifecycle';
import {
  AccountLabel,
  DetailLabel,
  NoneLabel,
} from './document-reference-labels';
import {
  DocumentsFilterBar,
  documentsFilterValuesFromUrl,
  isEmptyDocumentsFilter,
} from './documents-filter-bar';
import {
  DOCUMENTS_DEFAULT_SORT,
  documentsSortingState,
  hasActiveDocumentFilters,
  useDocumentsList,
  useDocumentsUrlState,
} from './use-documents-list';

export interface FlattenedAccountingDocumentLine {
  rowKey: string;
  documentId: string;
  documentNumber: string | null;
  documentDate: string;
  state: AccountingDocument['state'];
  headerDescription: string;
  line: AccountingDocumentLine;
}

function flattenAccountingLines(
  documents: readonly AccountingDocument[],
  lineFilter: string,
): FlattenedAccountingDocumentLine[] {
  const needle = lineFilter.trim().toLowerCase();
  const rows: FlattenedAccountingDocumentLine[] = [];

  for (const doc of documents) {
    for (const line of doc.lines) {
      if (needle !== '') {
        const hay = [
          doc.documentNumber ?? '',
          doc.description,
          line.description ?? '',
          line.accountId,
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(needle)) continue;
      }
      rows.push({
        rowKey: `${doc.id}:${line.id}`,
        documentId: doc.id,
        documentNumber: doc.documentNumber,
        documentDate: doc.documentDate,
        state: doc.state,
        headerDescription: doc.description,
        line,
      });
    }
  }
  return rows;
}

function buildAccountingDocumentLinesColumns(
  orgScope: string,
): ColumnDef<FlattenedAccountingDocumentLine, unknown>[] {
  return [
    {
      id: 'documentNumber',
      accessorFn: (row) => row.documentNumber,
      header: t.documentLines.colDocNumber,
      enableSorting: true,
      cell: ({ row }) => (
        <Link
          to={`/app/accounting/documents/${encodeURIComponent(row.original.documentId)}`}
          className="code font-semibold text-brand hover:underline"
          data-testid={`open-parent-doc-${row.original.documentId}`}
        >
          {row.original.documentNumber ?? t.app.none}
        </Link>
      ),
    },
    {
      id: 'documentDate',
      accessorFn: (row) => row.documentDate,
      header: t.documentLines.colDocDate,
      enableSorting: true,
      cell: ({ row }) => (
        <span
          className="code"
          title={formatDateOnlyCanonical(row.original.documentDate)}
        >
          {formatDateOnly(row.original.documentDate)}
        </span>
      ),
    },
    {
      id: 'state',
      header: t.documentLines.colDocState,
      enableSorting: false,
      cell: ({ row }) => {
        const parsed = parseDocumentState(row.original.state);
        return parsed !== null ? (
          <Badge variant={documentStatePresentation[parsed].variant}>
            {documentStatePresentation[parsed].label}
          </Badge>
        ) : (
          <span className="code text-xs">{row.original.state}</span>
        );
      },
    },
    {
      id: 'lineNo',
      header: t.documentLines.colLineNo,
      enableSorting: false,
      cell: ({ row }) => (
        <span className="num">{row.original.line.lineNo}</span>
      ),
    },
    {
      id: 'account',
      header: t.documentLines.colAccount,
      enableSorting: false,
      cell: ({ row }) => (
        <AccountLabel
          organizationId={orgScope}
          accountId={row.original.line.accountId}
        />
      ),
    },
    {
      id: 'detail',
      header: t.documentLines.colDetail,
      enableSorting: false,
      cell: ({ row }) => {
        const detailId = row.original.line.detailId ?? null;
        return detailId !== null ? (
          <DetailLabel organizationId={orgScope} detailId={detailId} />
        ) : (
          <NoneLabel />
        );
      },
    },
    {
      id: 'lineDescription',
      header: t.documentLines.colLineDescription,
      enableSorting: false,
      cell: ({ row }) => (
        <span
          className="block max-w-xs truncate"
          title={
            row.original.line.description ?? row.original.headerDescription
          }
        >
          {row.original.line.description ?? row.original.headerDescription}
        </span>
      ),
    },
    {
      id: 'debit',
      header: t.documentLines.colDebit,
      enableSorting: false,
      meta: { align: 'end' },
      cell: ({ row }) => <AmountCell value={row.original.line.debitAmount} />,
    },
    {
      id: 'credit',
      header: t.documentLines.colCredit,
      enableSorting: false,
      meta: { align: 'end' },
      cell: ({ row }) => <AmountCell value={row.original.line.creditAmount} />,
    },
    {
      id: 'actions',
      header: t.documents.colAction,
      enableSorting: false,
      cell: ({ row }) => (
        <Button asChild variant="ghost" size="sm">
          <Link
            to={`/app/accounting/documents/${encodeURIComponent(row.original.documentId)}`}
          >
            {t.documentLines.openParentDocument}
          </Link>
        </Button>
      ),
    },
  ];
}

/**
 * Accounting Document Lines Explorer (`/app/accounting/document-lines`).
 *
 * Read-only cross-document line view showing every permitted voucher line
 * paired with its parent document's essential Header metadata, backed by the
 * real `GET /api/v1/accounting-documents` contract, with filter, search, sort,
 * pagination, virtualization, Print, Excel export, and direct parent-document
 * opening.
 */
export function AccountingDocumentLinesPage() {
  const organizationId = useOrganizationId();
  const navigate = useNavigate();
  const { state, update, clearFilters } = useDocumentsUrlState();
  const query = useDocumentsList(organizationId, state);

  const [filtersVisible, setFiltersVisible] = useState(false);
  const [lineQuery, setLineQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const filterValues = documentsFilterValuesFromUrl(state);
  const synchronizationKey = JSON.stringify(filterValues);
  const hasFilter =
    hasActiveDocumentFilters(state) ||
    !isEmptyDocumentsFilter(filterValues) ||
    lineQuery.trim() !== '';

  const rows = useMemo(
    () => flattenAccountingLines(query.data?.items ?? [], lineQuery),
    [lineQuery, query.data?.items],
  );

  const selectedParentDocumentId = useMemo(() => {
    for (const row of rows) {
      if (selectedIds.has(row.rowKey)) return row.documentId;
    }
    return null;
  }, [rows, selectedIds]);

  const orgScope = organizationId ?? 'none';

  const columns = useMemo(
    () => buildAccountingDocumentLinesColumns(orgScope),
    [orgScope],
  );

  const handleExportExcel = () => {
    exportRowsToExcelCsv(
      'accounting-document-lines',
      [
        {
          header: t.documentLines.colDocNumber,
          value: (row) => row.documentNumber ?? '',
        },
        {
          header: t.documentLines.colDocDate,
          value: (row) => formatDateOnly(row.documentDate),
        },
        {
          header: t.documentLines.colDocState,
          value: (row) => {
            const parsed = parseDocumentState(row.state);
            return parsed !== null
              ? documentStatePresentation[parsed].label
              : row.state;
          },
        },
        {
          header: t.documentLines.colLineNo,
          value: (row) => row.line.lineNo,
        },
        {
          header: t.documentLines.colAccount,
          value: (row) => row.line.accountId,
        },
        {
          header: t.documentLines.colLineDescription,
          value: (row) => row.line.description ?? row.headerDescription,
        },
        {
          header: t.documentLines.colDebit,
          value: (row) => row.line.debitAmount,
        },
        {
          header: t.documentLines.colCredit,
          value: (row) => row.line.creditAmount,
        },
      ],
      rows,
    );
  };

  return (
    <div className="space-y-4" data-testid="accounting-document-lines-page">
      <PageHeader
        title={t.documentLines.accountingTitle}
        description={t.documentLines.accountingSubtitle}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
            >
              <RefreshCw aria-hidden className="h-4 w-4" />
              {t.documents.refresh}
            </Button>
            <Button type="button" variant="outline" size="sm" asChild>
              <Link to="/app/accounting/documents">
                <List aria-hidden className="h-4 w-4" />
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
        filterActive={hasFilter}
        onPrint={printCurrentSurface}
        onExportExcel={handleExportExcel}
        exportDisabled={rows.length === 0}
        onOpenSelected={
          selectedParentDocumentId !== null
            ? () =>
                navigate(
                  `/app/accounting/documents/${encodeURIComponent(selectedParentDocumentId)}`,
                )
            : undefined
        }
      />

      {filtersVisible && (
        <DocumentsFilterBar
          organizationId={organizationId}
          values={filterValues}
          synchronizationKey={synchronizationKey}
          isFetching={query.isFetching}
          onApply={(values) =>
            update({
              search: values.search,
              state: values.state,
              origin: values.origin,
              financialAreaId: values.financialAreaId,
              fiscalYearId: values.fiscalYearId,
              accountingPeriodId: values.accountingPeriodId,
              documentNumber: values.documentNumber,
              dateFrom: values.dateFrom,
              dateTo: values.dateTo,
              page: null,
            })
          }
          onClear={() => {
            setLineQuery('');
            clearFilters();
          }}
        />
      )}

      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.rowKey}
        caption={t.documentLines.accountingTitle}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        errorDescription={t.documents.loadListFailed}
        onRetry={() => void query.refetch()}
        emptyTitle={t.documentLines.emptyAccountingTitle}
        emptyDescription={t.documentLines.emptyAccountingBody}
        selectable
        selectedRowIds={selectedIds}
        onSelectedRowIdsChange={setSelectedIds}
        onRowActivate={(row) =>
          navigate(
            `/app/accounting/documents/${encodeURIComponent(row.documentId)}`,
          )
        }
        virtualize
        sorting={documentsSortingState(state.sort)}
        onSortingChange={(sorting) =>
          update({
            sort: sortingToParam(sorting) ?? DOCUMENTS_DEFAULT_SORT,
            page: null,
          })
        }
        pagination={{
          page: query.data?.page ?? state.page,
          pageSize: query.data?.pageSize ?? state.pageSize,
          total: query.data?.total ?? 0,
          onPageChange: (page) => update({ page }),
          onPageSizeChange: (pageSize) => update({ pageSize, page: null }),
        }}
      />
    </div>
  );
}
