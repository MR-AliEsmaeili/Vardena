import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { readInventoryKardex } from '@/api/inventory.api';
import type { InventoryKardexQuery, InventoryKardexRow } from '@/api/contracts';
import { isOtherOrganizationScope, queryKeys } from '@/api/query-keys';
import { useOrganizationId } from '@/features/organization/use-organization';
import {
  formatQuantity,
  formatDateOnly,
  formatDateOnlyCanonical,
} from '@/lib/format';
import { t } from '@/lib/i18n';
import { DataTable } from '@/ui/patterns/data-table';
import { FilterBar } from '@/ui/patterns/filter-bar';
import { FormField } from '@/ui/patterns/form-field';
import { DateInput } from '@/ui/patterns/date-input';
import { EmptyState, LoadingState } from '@/ui/patterns/states';
import { PageHeader } from '@/ui/patterns/page-header';
import { Select } from '@/ui/select';
import { movementTypeLabel } from './inventory-labels';
import { useInventoryReferences } from './use-inventory-references';

/**
 * Kardex columns (module level — cell renderers are created outside any
 * component render, matching the other column builders).
 */
function buildKardexColumns(): ColumnDef<InventoryKardexRow, unknown>[] {
  return [
    {
      id: 'movementDate',
      accessorKey: 'movementDate',
      header: t.inventory.kardexColumnDate,
      cell: ({ row }) => (
        // OQ-73 / ADR-0044: a ledger day is a BusinessDate rendered
        // Jalali-first, never shifted through an instant/time zone.
        <span
          className="num"
          dir="ltr"
          title={formatDateOnlyCanonical(row.original.movementDate)}
        >
          {formatDateOnly(row.original.movementDate)}
        </span>
      ),
    },
    {
      id: 'movementType',
      accessorKey: 'movementType',
      header: t.inventory.kardexColumnType,
      cell: ({ row }) => movementTypeLabel(row.original.movementType),
    },
    {
      id: 'signedQuantity',
      accessorKey: 'signedQuantity',
      header: t.inventory.kardexColumnQuantity,
      cell: ({ row }) => (
        <span
          className={
            row.original.signedQuantity.startsWith('-')
              ? 'num text-danger-ink'
              : 'num text-emerald-700'
          }
        >
          {formatQuantity(row.original.signedQuantity)}
        </span>
      ),
      meta: { align: 'end' },
    },
    {
      id: 'runningQuantity',
      accessorKey: 'runningQuantity',
      header: t.inventory.kardexColumnBalance,
      cell: ({ row }) => (
        <span className="num font-medium">
          {formatQuantity(row.original.runningQuantity)}
        </span>
      ),
      meta: { align: 'end' },
    },
  ];
}

/**
 * The Kardex of one item in one warehouse: a quantity-only running balance
 * (no valuation columns — the Kardex contract carries no money at all).
 *
 * Paging follows the backend's snapshot contract: page 1 answers with an
 * opaque ledger snapshot that must be passed UNCHANGED on every later page;
 * changing any filter restarts at page 1, so the snapshot of the current
 * view is always in hand before the user can leave page 1.
 */
export function KardexPage() {
  const organizationId = useOrganizationId();
  const references = useInventoryReferences(organizationId);

  // Local UI interaction state (standards.md §5): the scope selection is a
  // form, not URL state, because the Kardex has nothing to deep-link into
  // until both keys are chosen.
  const [itemId, setItemId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  // The backend's opaque ledger snapshot — the continuation token every
  // later page must replay. Adopted from the page-1 response INSIDE the
  // queryFn (never during render); cleared together with the page whenever
  // any filter changes.
  const [snapshot, setSnapshot] = useState<string | undefined>(undefined);

  const dateFieldHint = t.filters.dateFormatHintJalali;

  const scopeReady =
    organizationId !== null && itemId !== '' && warehouseId !== '';

  const query = useMemo<InventoryKardexQuery | null>(() => {
    if (!scopeReady) return null;
    return {
      organizationId: organizationId as string,
      itemId,
      warehouseId,
      page,
      pageSize: 50,
      // OQ-73: day filters are canonical Gregorian days — the backend
      // compares them against the `date` column directly.
      ...(dateFrom !== '' ? { dateFrom } : {}),
      ...(dateTo !== '' ? { dateTo } : {}),
      ...(page > 1 && snapshot !== undefined ? { snapshot } : {}),
    };
  }, [
    scopeReady,
    organizationId,
    itemId,
    warehouseId,
    page,
    dateFrom,
    dateTo,
    snapshot,
  ]);

  const kardexQuery = useQuery({
    queryKey: queryKeys.inventory.kardex(
      organizationId ?? 'none',
      (query ?? { disabled: true }) as Record<string, unknown>,
    ),
    queryFn: ({ signal }) =>
      readInventoryKardex(query as InventoryKardexQuery, signal).then(
        (response) => {
          // Adopt the snapshot of the page-1 response; it authorizes every
          // later page of this exact view (§ snapshot paging).
          if (response.page === 1) {
            setSnapshot(response.snapshot);
          }
          return response;
        },
      ),
    enabled: query !== null,
    placeholderData: (previous, previousQuery) =>
      previousQuery !== undefined &&
      !isOtherOrganizationScope(
        previousQuery.queryKey,
        organizationId ?? 'none',
      )
        ? previous
        : undefined,
  });

  const response = kardexQuery.data;

  const displayUnitId = response?.scope.displayUnitId;
  const displayUnit =
    displayUnitId === undefined
      ? undefined
      : references.unitById(displayUnitId);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.inventory.kardexTitle}
        description={t.inventory.kardexSubtitle}
      />

      <FilterBar
        columns={5}
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setSnapshot(undefined);
        }}
        applyLabel={t.inventory.kardexShow}
        isFetching={kardexQuery.isFetching}
        applyDisabled={!scopeReady}
      >
        <FormField id="kardex-item" label={t.inventory.item}>
          {(fieldProps) => (
            <Select
              {...fieldProps}
              value={itemId}
              onChange={(event) => {
                setItemId(event.target.value);
                setPage(1);
                setSnapshot(undefined);
              }}
            >
              <option value="">{t.filters.select}</option>
              {references.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} — {item.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <FormField id="kardex-warehouse" label={t.inventory.warehouse}>
          {(fieldProps) => (
            <Select
              {...fieldProps}
              value={warehouseId}
              onChange={(event) => {
                setWarehouseId(event.target.value);
                setPage(1);
                setSnapshot(undefined);
              }}
            >
              <option value="">{t.filters.select}</option>
              {references.warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.code} — {warehouse.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <FormField
          id="kardex-date-from"
          label={t.inventory.dateFrom}
          hint={dateFieldHint}
        >
          {(fieldProps) => (
            <DateInput
              {...fieldProps}
              id="kardex-date-from"
              value={dateFrom}
              onValueChange={(day) => {
                setDateFrom(day);
                setPage(1);
                setSnapshot(undefined);
              }}
            />
          )}
        </FormField>

        <FormField
          id="kardex-date-to"
          label={t.inventory.dateTo}
          hint={dateFieldHint}
        >
          {(fieldProps) => (
            <DateInput
              {...fieldProps}
              id="kardex-date-to"
              value={dateTo}
              onValueChange={(day) => {
                setDateTo(day);
                setPage(1);
                setSnapshot(undefined);
              }}
            />
          )}
        </FormField>
      </FilterBar>

      {organizationId === null || references.isLoading ? (
        <LoadingState rows={6} label={t.filters.referencesLoading} />
      ) : !scopeReady ? (
        <EmptyState
          title={t.inventory.kardexTitle}
          description={t.inventory.kardexMissingScope}
        />
      ) : (
        <DataTable
          columns={buildKardexColumns()}
          data={kardexQuery.data?.items ?? []}
          getRowId={(row) => row.movementId}
          isLoading={kardexQuery.isPending}
          isFetching={kardexQuery.isFetching}
          error={kardexQuery.isError ? kardexQuery.error : undefined}
          errorDescription={t.inventory.kardexLoadFailed}
          onRetry={() => void kardexQuery.refetch()}
          emptyTitle={t.inventory.kardexTitle}
          emptyDescription={t.inventory.kardexEmpty}
          pagination={{
            page: kardexQuery.data?.page ?? page,
            pageSize: kardexQuery.data?.pageSize ?? 50,
            total: kardexQuery.data?.total ?? 0,
            onPageChange: (nextPage) => setPage(nextPage),
          }}
          caption={t.inventory.kardexTitle}
        />
      )}

      {response !== undefined && (
        <div className="grid gap-2 rounded-lg border border-line bg-surface p-3 text-sm sm:grid-cols-2">
          <p>
            {t.inventory.kardexOpening}:{' '}
            <span className="num font-medium">
              {formatQuantity(response.opening)}
            </span>
            {displayUnit !== undefined && (
              <span className="text-xs text-ink-subtle">
                {' '}
                {displayUnit.code}
              </span>
            )}
          </p>
          <p>
            {t.inventory.kardexClosing}:{' '}
            <span className="num font-medium">
              {formatQuantity(response.closing)}
            </span>
            {displayUnit !== undefined && (
              <span className="text-xs text-ink-subtle">
                {' '}
                {displayUnit.code}
              </span>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
