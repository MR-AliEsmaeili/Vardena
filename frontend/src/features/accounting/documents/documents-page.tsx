import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, RefreshCw, TableProperties } from 'lucide-react';
import { exportRowsToExcelCsv, printCurrentSurface } from '@/lib/export-table';
import { formatDateOnly } from '@/lib/format';
import { sortingToParam } from '@/lib/sort-param';
import { t } from '@/lib/i18n';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { PermissionGate } from '@/features/permissions/permission-gate';
import { Button } from '@/ui/button';
import { DataTable } from '@/ui/patterns/data-table';
import { DocumentListToolbar } from '@/ui/patterns/operational-form';
import { PageHeader } from '@/ui/patterns/page-header';
import { useFinancialAreas } from '../shared/use-accounting-references';
import {
  documentOriginLabel,
  documentStatePresentation,
  parseDocumentState,
} from './document-lifecycle';
import { buildDocumentsColumns } from './documents-columns';
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

/**
 * Documents workspace (FE-UX-08): the real, server-owned read-only list of the
 * organization's accounting documents with filter, sort, pagination, row
 * selection, open-document action, print, and Excel CSV export.
 */
export function DocumentsPage() {
  const organizationId = useOrganizationId();
  const navigate = useNavigate();
  const { state, update, clearFilters } = useDocumentsUrlState();
  const query = useDocumentsList(organizationId, state);

  const [filtersVisible, setFiltersVisible] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const areasQuery = useFinancialAreas(organizationId);
  const areas = useMemo(() => areasQuery.data?.items ?? [], [areasQuery.data]);

  const columns = useMemo(() => buildDocumentsColumns(areas), [areas]);

  const filterValues = documentsFilterValuesFromUrl(state);
  const synchronizationKey = JSON.stringify(filterValues);
  const hasFilter =
    hasActiveDocumentFilters(state) || !isEmptyDocumentsFilter(filterValues);

  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  const firstSelectedId = useMemo(() => {
    for (const row of items) {
      if (selectedIds.has(row.id)) return row.id;
    }
    return null;
  }, [items, selectedIds]);

  const handleExportExcel = () => {
    exportRowsToExcelCsv(
      'accounting-documents',
      [
        {
          header: t.documents.colNumber,
          value: (row) => row.documentNumber ?? '',
        },
        {
          header: t.documents.colDate,
          value: (row) => formatDateOnly(row.documentDate),
        },
        {
          header: t.documents.colDescription,
          value: (row) => row.description,
        },
        {
          header: t.documents.colArea,
          value: (row) =>
            areas.find((a) => a.id === row.financialAreaId)?.title ??
            row.financialAreaId,
        },
        {
          header: t.documents.colTotal,
          value: (row) => row.totalDebit,
        },
        {
          header: t.documents.colState,
          value: (row) => {
            const parsed = parseDocumentState(row.state);
            return parsed !== null
              ? documentStatePresentation[parsed].label
              : row.state;
          },
        },
        {
          header: t.documents.colOrigin,
          value: (row) => documentOriginLabel(row.origin),
        },
      ],
      items,
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.documents.title}
        description={t.documents.subtitle}
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
              <Link to="/app/accounting/document-lines">
                <TableProperties aria-hidden className="h-4 w-4" />
                {t.operationalForm.viewDocumentLines}
              </Link>
            </Button>
            <PermissionGate permission={PERMISSIONS.accounting.documentCreate}>
              <Button type="button" size="sm" asChild>
                <Link to="/app/accounting/documents/new">
                  <Plus aria-hidden className="h-4 w-4" />
                  {t.documents.create}
                </Link>
              </Button>
            </PermissionGate>
          </>
        }
      />

      <DocumentListToolbar
        onFilterToggle={() => setFiltersVisible((prev) => !prev)}
        filterActive={hasFilter}
        onPrint={printCurrentSurface}
        onExportExcel={handleExportExcel}
        exportDisabled={items.length === 0}
        onOpenSelected={
          firstSelectedId !== null
            ? () =>
                navigate(
                  `/app/accounting/documents/${encodeURIComponent(firstSelectedId)}`,
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
          onClear={clearFilters}
        />
      )}

      <DataTable
        columns={columns}
        data={items}
        getRowId={(row) => row.id}
        caption={t.documents.title}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        errorDescription={t.documents.loadListFailed}
        onRetry={() => void query.refetch()}
        emptyTitle={
          hasFilter ? t.documents.emptyFilteredTitle : t.documents.emptyTitle
        }
        emptyDescription={
          hasFilter ? t.documents.emptyFilteredBody : t.documents.emptyBody
        }
        selectable
        selectedRowIds={selectedIds}
        onSelectedRowIdsChange={setSelectedIds}
        onRowActivate={(row) =>
          navigate(`/app/accounting/documents/${encodeURIComponent(row.id)}`)
        }
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
