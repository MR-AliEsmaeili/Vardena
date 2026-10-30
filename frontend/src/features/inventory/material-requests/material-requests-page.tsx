import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { DataTable } from '@/ui/patterns/data-table';
import { LoadingState } from '@/ui/patterns/states';
import { PageHeader } from '@/ui/patterns/page-header';
import { useMaterialRequests } from './material-request-hooks';
import {
  hasActiveMaterialRequestsFilters,
  materialRequestsSortingState,
  MATERIAL_REQUESTS_DEFAULT_SORT,
  useMaterialRequestsUrlState,
} from './material-request-url-state';
import { materialRequestsColumns } from './material-requests-columns';
import {
  MaterialRequestsFilterBar,
  materialRequestsFilterValuesFromUrl,
} from './material-requests-filter-bar';

/**
 * Server-owned list, filters, sort and pagination for the active organization.
 * A draft has no number yet, which is a normal state — never an error.
 */
export function MaterialRequestsPage() {
  const organizationId = useOrganizationId();
  const permissions = usePermissions();
  const { state, update, clearFilters } = useMaterialRequestsUrlState();
  const [params] = useSearchParams();
  const requestsQuery = useMaterialRequests(organizationId, state);
  const columns = useMemo(() => materialRequestsColumns(), []);

  if (organizationId === null) {
    return <LoadingState rows={6} label={t.organization.loading} />;
  }

  const canCreate = permissions.has(
    PERMISSIONS.inventory.materialRequestCreate,
  );
  const filterValues = materialRequestsFilterValuesFromUrl(state);
  const filtersActive = hasActiveMaterialRequestsFilters(state);
  const createAction = canCreate ? (
    <Button asChild size="sm">
      <Link to="/app/inventory/material-requests/new">
        <Plus className="h-4 w-4" aria-hidden />
        {t.materialRequests.newRequest}
      </Link>
    </Button>
  ) : null;

  return (
    <div className="space-y-4" data-testid="material-requests-page">
      <PageHeader
        title={t.materialRequests.title}
        description={t.materialRequests.subtitle}
        actions={createAction}
      />

      <MaterialRequestsFilterBar
        values={filterValues}
        synchronizationKey={params.toString()}
        isFetching={requestsQuery.isFetching}
        onApply={(values) => update({ ...values, page: 1 })}
        onClear={clearFilters}
      />

      <DataTable
        columns={columns}
        data={requestsQuery.data?.items ?? []}
        getRowId={(row) => row.id}
        isLoading={requestsQuery.isPending}
        isFetching={requestsQuery.isFetching}
        error={requestsQuery.isError ? requestsQuery.error : undefined}
        errorDescription={t.materialRequests.loadFailed}
        onRetry={() => void requestsQuery.refetch()}
        emptyTitle={
          filtersActive ? t.table.emptyTitle : t.materialRequests.emptyTitle
        }
        emptyDescription={
          filtersActive ? t.table.emptyBody : t.materialRequests.emptyBody
        }
        emptyAction={createAction}
        sorting={materialRequestsSortingState(state.sort)}
        onSortingChange={(sorting) => {
          const first = sorting[0];
          update({
            sort:
              first === undefined
                ? MATERIAL_REQUESTS_DEFAULT_SORT
                : `${first.id}:${first.desc ? 'desc' : 'asc'}`,
            page: 1,
          });
        }}
        pagination={{
          page: state.page,
          pageSize: state.pageSize,
          total: requestsQuery.data?.total ?? 0,
          onPageChange: (page) => update({ page }),
          onPageSizeChange: (pageSize) => update({ pageSize, page: 1 }),
        }}
        caption={t.materialRequests.title}
      />
    </div>
  );
}
