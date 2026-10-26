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
import {
  hasActiveMovementFilters,
  movementsSortingState,
  useMovementsList,
  useMovementsUrlState,
  MOVEMENTS_DEFAULT_SORT,
  MOVEMENT_TYPE_FILTERS,
} from './use-inventory-movements';
import {
  MovementsFilterBar,
  movementsFilterValuesFromUrl,
  isEmptyMovementsFilter,
} from './movements-filter-bar';
import type { MovementType } from '@/api/contracts';
import { movementsColumns } from './movements-columns';
import { useInventoryReferences } from './use-inventory-references';

/**
 * The movements workspace: the organization's ledger history of inventory
 * movements with the endpoint's declared filters, server-side paging and
 * sorting, all URL-owned. Valuation status is always visible; the signed
 * value column appears only for sessions that may see money.
 */
export function MovementsPage() {
  const organizationId = useOrganizationId();
  const permissions = usePermissions();
  const { state, update, clearFilters } = useMovementsUrlState();
  const [params] = useSearchParams();
  const references = useInventoryReferences(organizationId);
  const movementsQuery = useMovementsList(organizationId, state);

  const showCost = permissions.has(PERMISSIONS.inventory.valuationView);
  const canReverse = permissions.has(PERMISSIONS.inventory.movementReverse);
  const columns = useMemo(
    () => movementsColumns(references, { showCost, canReverse }),
    [references, showCost, canReverse],
  );

  if (organizationId === null) {
    return <LoadingState rows={6} label={t.organization.loading} />;
  }

  const filterValues = movementsFilterValuesFromUrl(state);
  const filtersActive =
    hasActiveMovementFilters(state) || !isEmptyMovementsFilter(filterValues);
  const emptyTitle = filtersActive
    ? t.table.emptyTitle
    : t.inventory.movementsEmptyFirstUse;
  const emptyBody = filtersActive
    ? t.table.emptyBody
    : t.inventory.movementsEmptyFirstUse;

  // Re-seed the filter form whenever the URL changes (Back/Forward/deep link).
  const synchronizationKey = params.toString();

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.inventory.movementsTitle}
        description={t.inventory.movementsSubtitle}
        actions={<PermissionGateActions />}
      />

      <MovementsFilterBar
        references={references}
        values={filterValues}
        synchronizationKey={synchronizationKey}
        isFetching={movementsQuery.isFetching}
        onApply={(values) =>
          update({
            warehouseId: values.warehouseId,
            itemId: values.itemId,
            movementType: MOVEMENT_TYPE_FILTERS.includes(
              values.movementType as MovementType,
            )
              ? (values.movementType as MovementType)
              : '',
            dateFrom: values.dateFrom,
            dateTo: values.dateTo,
            page: 1,
          })
        }
        onClear={clearFilters}
      />

      <DataTable
        columns={columns}
        data={movementsQuery.data?.items ?? []}
        getRowId={(row) => row.id}
        isLoading={movementsQuery.isPending}
        isFetching={movementsQuery.isFetching}
        error={movementsQuery.isError ? movementsQuery.error : undefined}
        errorDescription={t.inventory.movementsLoadFailed}
        onRetry={() => void movementsQuery.refetch()}
        emptyTitle={emptyTitle}
        emptyDescription={emptyBody}
        sorting={movementsSortingState(state.sort)}
        onSortingChange={(sorting) => {
          const first = sorting[0];
          update({
            sort:
              first === undefined
                ? MOVEMENTS_DEFAULT_SORT
                : `${first.id}:${first.desc ? 'desc' : 'asc'}`,
            page: 1,
          });
        }}
        pagination={{
          page: state.page,
          pageSize: state.pageSize,
          total: movementsQuery.data?.total ?? 0,
          onPageChange: (page) => update({ page }),
          onPageSizeChange: (pageSize) => update({ pageSize, page: 1 }),
        }}
        caption={t.inventory.movementsTitle}
      />
    </div>
  );
}

/** Posting CTAs — only the movements this session may create. */
function PermissionGateActions() {
  const permissions = usePermissions();
  const canPost = permissions.has(PERMISSIONS.inventory.movementCreate);
  if (!canPost) return null;
  return (
    <>
      <Button asChild size="sm">
        <Link to="/app/inventory/movements/new?type=receipt">
          <Plus className="h-4 w-4" aria-hidden />
          {t.inventory.newReceipt}
        </Link>
      </Button>
      <Button asChild size="sm" variant="outline">
        <Link to="/app/inventory/movements/new?type=issue">
          <Plus className="h-4 w-4" aria-hidden />
          {t.inventory.newIssue}
        </Link>
      </Button>
    </>
  );
}
