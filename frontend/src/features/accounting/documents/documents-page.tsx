import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Plus, RefreshCw } from 'lucide-react';
import { sortingToParam } from '@/lib/sort-param';
import { t } from '@/lib/i18n';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { PermissionGate } from '@/features/permissions/permission-gate';
import { Button } from '@/ui/button';
import { DataTable } from '@/ui/patterns/data-table';
import { PageHeader } from '@/ui/patterns/page-header';
import { useFinancialAreas } from '../shared/use-accounting-references';
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
 * Documents workspace (FE-UX-08): the real, server-owned list of the
 * organization's accounting documents.
 *
 * Every filter, the page, the page size and the sort live in the URL
 * (`?page=&pageSize=&search=&state=&origin=&financialAreaId=&fiscalYearId=
 * &accountingPeriodId=&documentNumber=&dateFrom=&dateTo=&sort=`) — exactly
 * the parameters the endpoint declares, so Back/Forward/Refresh/deep-link
 * reproduce the same server query. The «ثبت سند» action exists only when the
 * session holds `Accounting.Document.Create` (the backend enforces it again
 * on POST).
 */
export function DocumentsPage() {
  const organizationId = useOrganizationId();
  const { state, update, clearFilters } = useDocumentsUrlState();
  const query = useDocumentsList(organizationId, state);

  // Financial-area reference for the area column (a permission-gated read;
  // without it the column honestly shows «—» instead of a guessed label).
  const areasQuery = useFinancialAreas(organizationId);
  const areas = useMemo(() => areasQuery.data?.items ?? [], [areasQuery.data]);

  const columns = useMemo(() => buildDocumentsColumns(areas), [areas]);

  const filterValues = documentsFilterValuesFromUrl(state);
  const synchronizationKey = JSON.stringify(filterValues);
  const hasFilter =
    hasActiveDocumentFilters(state) || !isEmptyDocumentsFilter(filterValues);

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

      <DataTable
        columns={columns}
        data={query.data?.items ?? []}
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
