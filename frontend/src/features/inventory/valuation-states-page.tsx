import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';
import { listInventoryValuationStates } from '@/api/inventory.api';
import type {
  InventoryValuationState,
  InventoryValuationStateListQuery,
  ValuationStateStatus,
} from '@/api/contracts';
import { queryKeys } from '@/api/query-keys';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import {
  formatAmount,
  formatDateTimeWithZone,
  formatQuantity,
} from '@/lib/format';
import { t } from '@/lib/i18n';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { DataTable } from '@/ui/patterns/data-table';
import { ConfirmDialog } from '@/ui/patterns/confirm-dialog';
import { Select } from '@/ui/select';
import { LoadingState } from '@/ui/patterns/states';
import { PageHeader } from '@/ui/patterns/page-header';
import { useToast } from '@/ui/patterns/toast';
import { inventoryErrorMessage } from './inventory-error-messages';
import {
  newInventoryOperationKey,
  useRecalculateMutation,
} from './inventory-mutations';
import { valuationStateStatusLabel } from './inventory-labels';
import { useInventoryReferences } from './use-inventory-references';

/**
 * Valuation-worklist columns (module level — the cell renderers are created
 * outside any component render, like every other column builder).
 */
function buildValuationColumns(
  references: Pick<
    ReturnType<typeof useInventoryReferences>,
    'itemById' | 'warehouseById'
  >,
  options: {
    mayRecalculate: boolean;
    onRecalculate: (state: InventoryValuationState) => void;
  },
): ColumnDef<InventoryValuationState, unknown>[] {
  const base: ColumnDef<InventoryValuationState, unknown>[] = [
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
      id: 'status',
      accessorKey: 'status',
      header: t.inventory.valuationStatusFilter,
      cell: ({ row }) => <ValuationStateStatusBadge state={row.original} />,
    },
    {
      id: 'valuedQuantity',
      accessorKey: 'valuedQuantity',
      header: t.inventory.columnValuedQuantity,
      cell: ({ row }) => (
        <span className="num">
          {formatQuantity(row.original.valuedQuantity)}
        </span>
      ),
      meta: { align: 'end' },
    },
    {
      id: 'uncostedQuantity',
      accessorKey: 'uncostedQuantity',
      header: t.inventory.columnUncostedQuantity,
      cell: ({ row }) => (
        <span className="num">
          {formatQuantity(row.original.uncostedQuantity)}
        </span>
      ),
      meta: { align: 'end' },
    },
    {
      id: 'totalValue',
      accessorKey: 'totalValue',
      header: t.inventory.columnTotalValue,
      // Value of the VALUED part only — the backend's own number.
      cell: ({ row }) => (
        <span className="num">{formatAmount(row.original.totalValue)}</span>
      ),
      meta: { align: 'end' },
    },
    {
      id: 'averageUnitCost',
      accessorKey: 'averageUnitCost',
      header: t.inventory.columnAverageUnitCost,
      // null = nothing is valued — «—», NEVER «۰».
      cell: ({ row }) => (
        <span className="num">
          {row.original.averageUnitCost ?? t.inventory.noAverageCost}
        </span>
      ),
      meta: { align: 'end' },
    },
  ];

  if (options.mayRecalculate) {
    base.push({
      id: 'actions',
      header: t.inventory.staleNoticeRecalculate,
      cell: ({ row }) =>
        row.original.status === 'stale' ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => options.onRecalculate(row.original)}
          >
            {t.inventory.staleNoticeRecalculate}
          </Button>
        ) : (
          <span className="text-slate-400">{t.inventory.noValue}</span>
        ),
    });
  }
  return base;
}

/**
 * The Inventory Accounting worklist: what still has no cost, what is
 * inconsistent, and the one bounded command that repairs a stale key.
 *
 * Everything on this page is a backend-derived number — the frontend never
 * computes an average, a value or a total (no second valuation model). A
 * missing average is «—», never «۰»: stock without a cost has NO value
 * assigned, not a zero value (persian-ux-writing-standard §9 rule 11).
 *
 * The recalculate action is offered ONLY on `stale` rows (OD-VAL-12: one
 * item in one warehouse per command; there is no «قیمت‌گذاری مجدد همه»),
 * and only for sessions holding `Inventory.Valuation.Recalculate` — a UX
 * gate; the endpoint re-authorizes regardless (AR-21).
 */

const VALUATION_STATUS_FILTERS: readonly (ValuationStateStatus | '')[] = [
  '',
  'pending_cost',
  'stale',
  'valued',
];

export function ValuationStatesPage() {
  const organizationId = useOrganizationId();
  const permissions = usePermissions();
  const references = useInventoryReferences(organizationId);
  const [params, setParams] = useSearchParams();
  const { showToast } = useToast();

  const statusParam = params.get('status') ?? '';
  const status: ValuationStateStatus | '' = (
    VALUATION_STATUS_FILTERS as readonly string[]
  ).includes(statusParam)
    ? (statusParam as ValuationStateStatus | '')
    : '';
  const page = Math.max(1, Number(params.get('page')) || 1);

  const query = useMemo<InventoryValuationStateListQuery | null>(() => {
    if (organizationId === null) return null;
    return {
      organizationId,
      page,
      pageSize: 25,
      ...(status !== '' ? { status } : {}),
    };
  }, [organizationId, page, status]);

  const statesQuery = useQuery({
    queryKey: queryKeys.inventory.valuationStates(
      organizationId ?? 'none',
      (query ?? {}) as Record<string, unknown>,
    ),
    queryFn: ({ signal }) =>
      listInventoryValuationStates(
        query as InventoryValuationStateListQuery,
        signal,
      ),
    enabled: query !== null,
  });

  const mayRecalculate = permissions.has(
    PERMISSIONS.inventory.valuationRecalculate,
  );

  const [confirmTarget, setConfirmTarget] =
    useState<InventoryValuationState | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const recalculateMutation = useRecalculateMutation(organizationId ?? 'none');

  /** The row action only OPENS the confirm dialog — it never fires the command. */
  const openRecalculate = (target: InventoryValuationState) => {
    setDialogError(null);
    setConfirmTarget(target);
  };

  /** The bounded command itself, sent only after the explicit confirm. */
  const runRecalculate = () => {
    if (confirmTarget === null) return;
    setDialogError(null);
    recalculateMutation.mutate(
      {
        warehouseId: confirmTarget.warehouseId,
        itemId: confirmTarget.itemId,
        operationKey: newInventoryOperationKey(),
      },
      {
        onSuccess: (result) => {
          showToast({
            kind: 'success',
            message: `${t.inventory.recalculationDone} ${formatQuantity(
              String(result.run.movementsRevalued),
            )} ${t.inventory.recalculationDoneCount}`,
          });
          setConfirmTarget(null);
          setDialogError(null);
        },
        onError: (error) => {
          setDialogError(inventoryErrorMessage('recalculate', error).message);
        },
      },
    );
  };

  if (organizationId === null) {
    return <LoadingState rows={6} label={t.organization.loading} />;
  }

  const columns = buildValuationColumns(references, {
    mayRecalculate,
    onRecalculate: openRecalculate,
  });

  const filtersActive = status !== '';
  const total = statesQuery.data?.total ?? 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.inventory.valuationTitle}
        description={t.inventory.valuationSubtitle}
      />

      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-3">
        <label htmlFor="valuation-status-filter" className="text-sm">
          {t.inventory.valuationStatusFilter}:
        </label>
        <Select
          id="valuation-status-filter"
          className="h-9 w-56"
          value={status}
          onChange={(event) => {
            const next = new URLSearchParams(params);
            next.delete('page');
            if (event.target.value === '') {
              next.delete('status');
            } else {
              next.set('status', event.target.value);
            }
            setParams(next);
          }}
        >
          <option value="">{t.inventory.allValuationStatuses}</option>
          <option value="pending_cost">
            {t.inventory.valuationStateStatuses.pending_cost}
          </option>
          <option value="stale">
            {t.inventory.valuationStateStatuses.stale}
          </option>
          <option value="valued">
            {t.inventory.valuationStateStatuses.valued}
          </option>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={statesQuery.data?.items ?? []}
        getRowId={(row) => row.id}
        isLoading={statesQuery.isPending}
        isFetching={statesQuery.isFetching}
        error={statesQuery.isError ? statesQuery.error : undefined}
        errorDescription={t.inventory.valuationLoadFailed}
        onRetry={() => void statesQuery.refetch()}
        emptyTitle={
          filtersActive ? t.table.emptyTitle : t.inventory.valuationEmpty
        }
        emptyDescription={
          filtersActive
            ? t.inventory.valuationEmptyFiltered
            : t.inventory.valuationEmpty
        }
        pagination={{
          page: statesQuery.data?.page ?? page,
          pageSize: statesQuery.data?.pageSize ?? 25,
          total,
          onPageChange: (nextPage) => {
            const next = new URLSearchParams(params);
            if (nextPage <= 1) {
              next.delete('page');
            } else {
              next.set('page', String(nextPage));
            }
            setParams(next);
          },
        }}
        caption={t.inventory.valuationTitle}
      />

      <ConfirmDialog
        open={confirmTarget !== null}
        title={t.inventory.recalculateTitle}
        description={
          <div className="space-y-2">
            <p>{t.inventory.recalculateBody}</p>
            {confirmTarget !== null && (
              <p className="text-xs">
                {t.inventory.item}:{' '}
                {references.itemById(confirmTarget.itemId)?.code ??
                  confirmTarget.itemId}
                {' · '}
                {t.inventory.warehouse}:{' '}
                {references.warehouseById(confirmTarget.warehouseId)?.code ??
                  confirmTarget.warehouseId}
              </p>
            )}
          </div>
        }
        confirmLabel={t.inventory.recalculateSubmit}
        loading={recalculateMutation.isPending}
        loadingLabel={t.inventory.recalculateSubmitting}
        error={dialogError !== null ? <span>{dialogError}</span> : undefined}
        onConfirm={() => {
          runRecalculate();
        }}
        onCancel={() => {
          setConfirmTarget(null);
          setDialogError(null);
        }}
      />
    </div>
  );
}

/** Key-level status badge — warning for stale, info for pending, success for valued. */
function ValuationStateStatusBadge({
  state,
}: {
  state: InventoryValuationState;
}) {
  const variant =
    state.status === 'stale'
      ? 'warning'
      : state.status === 'pending_cost'
        ? 'info'
        : 'success';
  return (
    <span className="inline-flex items-center gap-1">
      <Badge variant={variant}>{valuationStateStatusLabel(state.status)}</Badge>
      {state.status === 'stale' && state.staleSince !== null && (
        <span className="text-xs text-slate-500" title={state.staleSince}>
          {t.inventory.staleSince} {formatDateTimeWithZone(state.staleSince)}
        </span>
      )}
    </span>
  );
}
