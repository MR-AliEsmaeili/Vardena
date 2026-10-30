import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { t } from '@/lib/i18n';
import { Alert, AlertBody, AlertTitle } from '@/ui/alert';
import { Button } from '@/ui/button';
import { DataTable } from '@/ui/patterns/data-table';
import { LoadingState } from '@/ui/patterns/states';
import { PageHeader } from '@/ui/patterns/page-header';
import {
  ReservationsFilterBar,
  reservationsFilterValuesFromUrl,
} from './reservations-filter-bar';
import { reservationsColumns } from './reservations-columns';
import {
  hasActiveReservationsFilters,
  reservationsSortingState,
  useReservationsUrlState,
  RESERVATIONS_DEFAULT_SORT,
} from './reservation-url-state';
import { useReservations } from './reservation-hooks';
import { useInventoryReferences } from '../use-inventory-references';

/** Server-owned list, filters, sort and pagination for the active organization. */
export function ReservationsPage() {
  const organizationId = useOrganizationId();
  const permissions = usePermissions();
  const { state, update, clearFilters } = useReservationsUrlState();
  const [params] = useSearchParams();
  const references = useInventoryReferences(organizationId);
  const reservationsQuery = useReservations(organizationId, state);
  const columns = useMemo(() => reservationsColumns(references), [references]);

  if (organizationId === null) {
    return <LoadingState rows={6} label={t.organization.loading} />;
  }

  const canCreate = permissions.has(PERMISSIONS.inventory.reservationCreate);
  const filterValues = reservationsFilterValuesFromUrl(state);
  const filtersActive = hasActiveReservationsFilters(state);
  const createAction = canCreate ? (
    <Button asChild size="sm">
      <Link to="/app/inventory/reservations/new">
        <Plus className="h-4 w-4" aria-hidden />
        {t.reservations.newReservation}
      </Link>
    </Button>
  ) : null;
  const synchronizationKey = params.toString();

  return (
    <div className="space-y-4" data-testid="reservations-page">
      <PageHeader
        title={t.reservations.title}
        description={t.reservations.subtitle}
        actions={createAction}
      />

      {references.isFailed ? (
        <Alert
          variant="warning"
          data-testid="reservation-references-unavailable"
        >
          <AlertTitle>{t.reservations.referencesUnavailable}</AlertTitle>
          <AlertBody>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p>{t.reservations.referencesUnavailable}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={references.refetch}
              >
                {t.app.retry}
              </Button>
            </div>
          </AlertBody>
        </Alert>
      ) : null}

      <ReservationsFilterBar
        references={references}
        values={filterValues}
        synchronizationKey={synchronizationKey}
        isFetching={reservationsQuery.isFetching}
        onApply={(values) => update({ ...values, page: 1 })}
        onClear={clearFilters}
      />

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
        emptyAction={createAction}
        sorting={reservationsSortingState(state.sort)}
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
