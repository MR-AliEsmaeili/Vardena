import { useId, useMemo, useState, type FormEvent } from 'react';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { CalendarCheck2, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import type {
  ItemValuationMethod,
  ResolvedValuationMethod,
} from '@/api/contracts';
import { useActiveItemOptions } from '@/features/inventory/master-data/master-data-references';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { PermissionGate } from '@/features/permissions/permission-gate';
import {
  formatBusinessDay,
  formatInstant,
  isBusinessDay,
  todayBusinessDay,
  useTimeZone,
} from '@/lib/datetime';
import { t } from '@/lib/i18n';
import { ADMIN_PAGE_SIZE_OPTIONS } from '@/lib/use-admin-list-state';
import { Alert, AlertBody, AlertTitle } from '@/ui/alert';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/card';
import { Input } from '@/ui/input';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { DataTable } from '@/ui/patterns/data-table';
import { Definition, DefinitionList } from '@/ui/patterns/definition-list';
import { FilterBar, FilterField } from '@/ui/patterns/filter-bar';
import { FormField } from '@/ui/patterns/form-field';
import { JalaliDateInputField } from '@/ui/patterns/jalali-date-input-field';
import { PageHeader } from '@/ui/patterns/page-header';
import { EmptyState, LoadingState } from '@/ui/patterns/states';
import { Select } from '@/ui/select';
import {
  DEFAULT_VALUATION_METHOD_SORT,
  useResolveValuationMethod,
  useValuationMethods,
  useValuationMethodsListState,
  VALUATION_METHOD_SORT_OPTIONS,
  type ResolveValuationMethodInput,
  type ValuationMethodSort,
} from './use-valuation-methods';
import {
  isValuationMethodImplemented,
  valuationMethodErrorMessage,
  valuationMethodLabel,
} from './valuation-method-error-messages';

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
const PAGE_SIZE_OPTIONS = [...ADMIN_PAGE_SIZE_OPTIONS];

function toSortingState(sort: ValuationMethodSort): SortingState {
  const [id, direction] = sort.split(':');
  if (!id) return [];
  return [{ id, desc: direction === 'desc' }];
}

function fromSortingState(next: SortingState): ValuationMethodSort {
  const first = next[0];
  if (!first) return DEFAULT_VALUATION_METHOD_SORT;
  const candidate = `${first.id}:${first.desc ? 'desc' : 'asc'}`;
  return (VALUATION_METHOD_SORT_OPTIONS as readonly string[]).includes(
    candidate,
  )
    ? (candidate as ValuationMethodSort)
    : DEFAULT_VALUATION_METHOD_SORT;
}

interface ResolvePanelProps {
  organizationId: string;
  committed: ResolveValuationMethodInput | null;
  onApply: (next: ResolveValuationMethodInput) => void;
  onClear: () => void;
  itemLabel: (itemId: string) => string;
}

function ValuationMethodResolveCard({
  organizationId,
  committed,
  onApply,
  onClear,
  itemLabel,
}: ResolvePanelProps) {
  const zone = useTimeZone();
  const defaultAsOf = useMemo(() => todayBusinessDay(zone), [zone]);
  const items = useActiveItemOptions(organizationId);
  const resolveItemFieldId = useId();
  const resolveAsOfFieldId = useId();

  const [draftItemId, setDraftItemId] = useState<string>(
    committed?.itemId ?? '',
  );
  const [draftAsOf, setDraftAsOf] = useState<string>(
    committed?.asOf && isBusinessDay(committed.asOf)
      ? committed.asOf
      : defaultAsOf,
  );
  const [itemError, setItemError] = useState<string | undefined>(undefined);
  const [asOfError, setAsOfError] = useState<string | undefined>(undefined);

  const resolveQuery = useResolveValuationMethod(organizationId, committed);

  const hasSelectedOptionInList = useMemo(
    () => items.items.some((opt) => opt.id === draftItemId),
    [items.items, draftItemId],
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedItem = draftItemId.trim();
    const normalizedItem = items.unavailable
      ? trimmedItem.toUpperCase()
      : trimmedItem;
    let valid = true;

    if (normalizedItem === '') {
      setItemError(t.inventoryValuationMethods.validation.itemRequired);
      valid = false;
    } else if (items.unavailable && !ULID_PATTERN.test(normalizedItem)) {
      setItemError(t.inventoryValuationMethods.validation.itemInvalidUlid);
      valid = false;
    } else {
      setItemError(undefined);
    }

    if (!isBusinessDay(draftAsOf)) {
      setAsOfError(t.inventoryValuationMethods.validation.validFromInvalid);
      valid = false;
    } else {
      setAsOfError(undefined);
    }

    if (!valid) return;
    onApply({ itemId: normalizedItem, asOf: draftAsOf });
  };

  const handleClear = () => {
    setDraftItemId('');
    setDraftAsOf(defaultAsOf);
    setItemError(undefined);
    setAsOfError(undefined);
    onClear();
  };

  return (
    <Card data-testid="valuation-method-resolve-card">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CalendarCheck2
            className="size-4 text-ink-muted"
            aria-hidden="true"
          />
          <CardTitle>{t.inventoryValuationMethods.effectiveMethod}</CardTitle>
        </div>
        <CardDescription>
          {t.inventoryValuationMethods.effectiveMethodSubtitle}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          noValidate
          onSubmit={handleSubmit}
          className="grid gap-4 sm:grid-cols-3 sm:items-start"
        >
          <FormField
            id={resolveItemFieldId}
            label={t.inventoryValuationMethods.item}
            required
            error={itemError}
            hint={
              items.unavailable
                ? t.inventoryValuationMethods.itemPickerUnavailableHint
                : undefined
            }
          >
            {(fieldProps) =>
              items.unavailable ? (
                <Input
                  {...fieldProps}
                  dir="ltr"
                  className="font-mono"
                  placeholder={t.inventoryValuationMethods.itemIdPlaceholder}
                  value={draftItemId}
                  onChange={(event) => {
                    setDraftItemId(event.target.value);
                    if (itemError) setItemError(undefined);
                  }}
                />
              ) : (
                <Select
                  {...fieldProps}
                  value={draftItemId}
                  disabled={items.isPending}
                  onChange={(event) => {
                    setDraftItemId(event.target.value);
                    if (itemError) setItemError(undefined);
                  }}
                >
                  <option value="">
                    {t.inventoryValuationMethods.selectItem}
                  </option>
                  {draftItemId !== '' && !hasSelectedOptionInList && (
                    <option value={draftItemId}>{draftItemId}</option>
                  )}
                  {items.items.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.code} — {opt.name}
                    </option>
                  ))}
                </Select>
              )
            }
          </FormField>

          <FormField
            id={resolveAsOfFieldId}
            label={t.inventoryValuationMethods.effectiveAsOf}
            required
            error={asOfError}
          >
            {(fieldProps) => (
              <JalaliDateInputField
                {...fieldProps}
                value={draftAsOf}
                onValueChange={(next) => {
                  setDraftAsOf(next);
                  if (asOfError) setAsOfError(undefined);
                }}
              />
            )}
          </FormField>

          <div className="flex flex-wrap items-center gap-2 sm:pt-7">
            <Button type="submit" disabled={resolveQuery.isFetching}>
              {t.inventoryValuationMethods.resolveAction}
            </Button>
            {committed !== null && (
              <Button
                type="button"
                variant="outline"
                onClick={handleClear}
                disabled={resolveQuery.isFetching}
              >
                {t.inventoryValuationMethods.resolveClear}
              </Button>
            )}
          </div>
        </form>

        {committed === null ? (
          <p className="text-xs text-ink-muted">
            {t.inventoryValuationMethods.resolveIdleHint}
          </p>
        ) : resolveQuery.isError ? (
          <ApiErrorAlert
            error={resolveQuery.error}
            description={
              valuationMethodErrorMessage('resolve', resolveQuery.error).message
            }
            onRetry={() => {
              void resolveQuery.refetch();
            }}
          />
        ) : resolveQuery.isPending ? (
          <LoadingState rows={2} />
        ) : resolveQuery.data !== undefined ? (
          <ResolvedValuationMethodSummary
            resolved={resolveQuery.data}
            itemDisplay={itemLabel(resolveQuery.data.itemId)}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function ResolvedValuationMethodSummary({
  resolved,
  itemDisplay,
}: {
  resolved: ResolvedValuationMethod;
  itemDisplay: string;
}) {
  return (
    <div className="space-y-3" data-testid="valuation-method-resolve-summary">
      <DefinitionList>
        <Definition label={t.inventoryValuationMethods.item}>
          <span>{itemDisplay}</span>
        </Definition>
        <Definition label={t.inventoryValuationMethods.effectiveAsOf}>
          <span className="tabular-nums">
            {formatBusinessDay(resolved.asOf)}
          </span>
        </Definition>
        <Definition label={t.inventoryValuationMethods.effectiveMethod}>
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>{valuationMethodLabel(resolved.method)}</span>
            <Badge variant={resolved.active ? 'success' : 'warning'}>
              {resolved.active
                ? t.inventoryValuationMethods.methodImplemented
                : t.inventoryValuationMethods.methodNotImplemented}
            </Badge>
          </span>
        </Definition>
        <Definition label={t.inventoryValuationMethods.source}>
          <Badge
            variant={resolved.source === 'configured' ? 'info' : 'neutral'}
          >
            {resolved.source === 'configured'
              ? t.inventoryValuationMethods.sourceConfigured
              : t.inventoryValuationMethods.sourceDefault}
          </Badge>
        </Definition>
        <Definition label={t.inventoryValuationMethods.validFrom}>
          {resolved.validFrom !== null ? (
            <span className="tabular-nums">
              {formatBusinessDay(resolved.validFrom)}
            </span>
          ) : (
            <span className="text-ink-muted">
              {t.inventoryValuationMethods.noNote}
            </span>
          )}
        </Definition>
        <Definition label={t.inventoryValuationMethods.validTo}>
          {resolved.source === 'default' ? (
            <span className="text-ink-muted">
              {t.inventoryValuationMethods.noNote}
            </span>
          ) : resolved.validTo !== null ? (
            <span className="tabular-nums">
              {formatBusinessDay(resolved.validTo)}
            </span>
          ) : (
            <Badge variant="neutral">
              {t.inventoryValuationMethods.openEnded}
            </Badge>
          )}
        </Definition>
        <Definition label={t.inventoryValuationMethods.configurationId}>
          {resolved.configurationId !== null ? (
            <span dir="ltr" className="font-mono text-xs">
              {resolved.configurationId}
            </span>
          ) : (
            <span className="text-ink-muted">
              {t.inventoryValuationMethods.noConfigurationRow}
            </span>
          )}
        </Definition>
      </DefinitionList>
      {resolved.source === 'default' && (
        <p className="text-xs text-ink-muted">
          {t.inventoryValuationMethods.sourceDefaultHint}
        </p>
      )}
    </div>
  );
}

function buildValuationMethodColumns(
  itemDisplayMap: ReadonlyMap<string, string>,
  zone: string,
): ColumnDef<ItemValuationMethod, unknown>[] {
  return [
    {
      accessorKey: 'itemId',
      header: t.inventoryValuationMethods.item,
      enableSorting: false,
      cell: ({ row }) => {
        const display = itemDisplayMap.get(row.original.itemId);
        return display !== undefined ? (
          <span className="font-medium text-ink">{display}</span>
        ) : (
          <span dir="ltr" className="font-mono text-xs text-ink">
            {row.original.itemId}
          </span>
        );
      },
    },
    {
      accessorKey: 'method',
      header: t.inventoryValuationMethods.method,
      enableSorting: false,
      cell: ({ row }) => {
        const implemented = isValuationMethodImplemented(row.original.method);
        return (
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="font-medium text-ink">
              {valuationMethodLabel(row.original.method)}
            </span>
            <Badge variant={implemented ? 'success' : 'warning'}>
              {implemented
                ? t.inventoryValuationMethods.methodImplemented
                : t.inventoryValuationMethods.methodNotImplemented}
            </Badge>
          </span>
        );
      },
    },
    {
      accessorKey: 'validFrom',
      header: t.inventoryValuationMethods.validFrom,
      cell: ({ row }) => (
        <span className="tabular-nums">
          {formatBusinessDay(row.original.validFrom)}
        </span>
      ),
    },
    {
      accessorKey: 'validTo',
      header: t.inventoryValuationMethods.validTo,
      // `validTo` is NOT in backend `InventoryValuationService.listMethods`
      // `resolveSort` allowlist (`validFrom` and `createdAt` only).
      enableSorting: false,
      cell: ({ row }) =>
        row.original.validTo !== null ? (
          <span className="tabular-nums">
            {formatBusinessDay(row.original.validTo)}
          </span>
        ) : (
          <Badge variant="neutral">
            {t.inventoryValuationMethods.openEnded}
          </Badge>
        ),
    },
    {
      accessorKey: 'note',
      header: t.inventoryValuationMethods.note,
      enableSorting: false,
      cell: ({ row }) => {
        const noteText = row.original.note;
        return noteText !== null && noteText.trim() !== '' ? (
          <span className="line-clamp-2 max-w-xs text-sm text-ink">
            {noteText}
          </span>
        ) : (
          <span className="text-ink-muted">
            {t.inventoryValuationMethods.noNote}
          </span>
        );
      },
    },
    {
      accessorKey: 'createdAt',
      header: t.inventoryValuationMethods.createdAt,
      cell: ({ row }) => (
        <span className="tabular-nums text-xs text-ink-muted">
          {formatInstant(row.original.createdAt, zone)}
        </span>
      ),
    },
  ];
}

/**
 * Effective-dated item valuation methods workspace (`INV-04`, ADR-0039, PDR-05).
 *
 * Read surfaces (`GET /inventory/valuation/methods` and `/methods/resolve`)
 * require `Inventory.Valuation.View`. Creating a new version requires
 * `Inventory.Valuation.Configure`. Versions are strictly append-only — no edit
 * or delete affordances exist on the backend or in this UI.
 */
export function ValuationMethodsPage() {
  const organizationId = useOrganizationId();
  const zone = useTimeZone();
  const state = useValuationMethodsListState();
  const {
    itemId,
    activeAt,
    hasInvalidActiveAt,
    sort,
    page,
    pageSize,
    resolveItemId,
    resolveAsOf,
    update,
  } = state;

  const itemFilterId = useId();
  const activeAtFilterId = useId();
  const sortFilterId = useId();

  const items = useActiveItemOptions(organizationId);
  const listQuery = useValuationMethods(organizationId, {
    itemId,
    activeAt,
    hasInvalidActiveAt,
    sort,
    page,
    pageSize,
  });

  const itemDisplayMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const option of items.items) {
      map.set(option.id, `${option.code} — ${option.name}`);
    }
    return map;
  }, [items.items]);

  const itemLabel = useMemo(
    () => (id: string) => itemDisplayMap.get(id) ?? id,
    [itemDisplayMap],
  );

  const committedResolve = useMemo<ResolveValuationMethodInput | null>(() => {
    if (resolveItemId === '' || !isBusinessDay(resolveAsOf)) return null;
    return { itemId: resolveItemId, asOf: resolveAsOf };
  }, [resolveItemId, resolveAsOf]);

  const columns = useMemo(
    () => buildValuationMethodColumns(itemDisplayMap, zone),
    [itemDisplayMap, zone],
  );

  if (organizationId === null) {
    return <LoadingState rows={6} label={t.organization.loading} />;
  }

  const newVersionHref =
    itemId !== ''
      ? `/app/inventory/valuation-methods/new?itemId=${encodeURIComponent(itemId)}`
      : '/app/inventory/valuation-methods/new';

  const hasActiveFilters =
    itemId !== '' || activeAt !== '' || sort !== DEFAULT_VALUATION_METHOD_SORT;

  const hasFilteredItemOption = items.items.some((opt) => opt.id === itemId);

  const rows = listQuery.data?.items ?? [];
  const totalItems = listQuery.data?.total ?? 0;

  const resetFilters = () =>
    update({
      itemId: null,
      activeAt: null,
      sort: null,
      page: 1,
    });

  return (
    <div className="space-y-6" data-testid="valuation-methods-page">
      <PageHeader
        title={t.inventoryValuationMethods.title}
        description={t.inventoryValuationMethods.subtitle}
        actions={
          <PermissionGate permission={PERMISSIONS.inventory.valuationConfigure}>
            <Button asChild>
              <Link to={newVersionHref}>
                <Plus className="size-4" aria-hidden="true" />
                {t.inventoryValuationMethods.newVersion}
              </Link>
            </Button>
          </PermissionGate>
        }
      />

      <Alert variant="neutral">
        <AlertTitle>{t.inventoryValuationMethods.immutableNote}</AlertTitle>
        <AlertBody>{t.inventoryValuationMethods.halfOpenWindowNote}</AlertBody>
      </Alert>

      <ValuationMethodResolveCard
        key={
          committedResolve !== null
            ? `${committedResolve.itemId}:${committedResolve.asOf}`
            : 'idle'
        }
        organizationId={organizationId}
        committed={committedResolve}
        onApply={(next) =>
          update({
            resolveItemId: next.itemId,
            resolveAsOf: next.asOf,
          })
        }
        onClear={() =>
          update({
            resolveItemId: null,
            resolveAsOf: null,
          })
        }
        itemLabel={itemLabel}
      />

      <FilterBar
        columns={3}
        isFetching={listQuery.isFetching}
        {...(hasActiveFilters ? { onClear: resetFilters } : {})}
      >
        <FilterField label={t.inventoryValuationMethods.item}>
          {items.unavailable ? (
            <Input
              id={itemFilterId}
              dir="ltr"
              className="font-mono"
              placeholder={t.inventoryValuationMethods.itemIdPlaceholder}
              value={itemId}
              onChange={(event) =>
                update({ itemId: event.target.value || null, page: 1 })
              }
            />
          ) : (
            <Select
              id={itemFilterId}
              value={itemId}
              disabled={items.isPending}
              onChange={(event) =>
                update({ itemId: event.target.value || null, page: 1 })
              }
            >
              <option value="">{t.inventoryValuationMethods.allItems}</option>
              {itemId !== '' && !hasFilteredItemOption && (
                <option value={itemId}>{itemId}</option>
              )}
              {items.items.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.code} — {opt.name}
                </option>
              ))}
            </Select>
          )}
        </FilterField>

        <FormField
          id={activeAtFilterId}
          label={t.inventoryValuationMethods.activeAt}
        >
          {(fieldProps) => (
            <JalaliDateInputField
              {...fieldProps}
              value={activeAt}
              aria-invalid={hasInvalidActiveAt ? true : undefined}
              onValueChange={(next) =>
                update({ activeAt: next !== '' ? next : null, page: 1 })
              }
            />
          )}
        </FormField>

        <FilterField label={t.inventoryValuationMethods.sortLabel}>
          <Select
            id={sortFilterId}
            value={sort}
            onChange={(event) =>
              update({
                sort: event.target.value as ValuationMethodSort,
                page: 1,
              })
            }
          >
            <option value="validFrom:desc">
              {t.inventoryValuationMethods.sortValidFromDesc}
            </option>
            <option value="validFrom:asc">
              {t.inventoryValuationMethods.sortValidFromAsc}
            </option>
            <option value="createdAt:desc">
              {t.inventoryValuationMethods.sortCreatedAtDesc}
            </option>
            <option value="createdAt:asc">
              {t.inventoryValuationMethods.sortCreatedAtAsc}
            </option>
          </Select>
        </FilterField>
      </FilterBar>

      {hasInvalidActiveAt ? (
        <Alert variant="danger" role="alert">
          <AlertTitle>{t.errors.title}</AlertTitle>
          <AlertBody>{t.inventoryValuationMethods.activeAtInvalid}</AlertBody>
        </Alert>
      ) : !listQuery.isPending && !listQuery.isError && rows.length === 0 ? (
        <EmptyState
          title={
            hasActiveFilters
              ? t.inventoryValuationMethods.emptyFilteredTitle
              : t.inventoryValuationMethods.emptyTitle
          }
          description={
            hasActiveFilters
              ? t.inventoryValuationMethods.emptyFilteredBody
              : t.inventoryValuationMethods.emptyBody
          }
          action={
            hasActiveFilters ? (
              <Button type="button" variant="outline" onClick={resetFilters}>
                {t.filters.reset}
              </Button>
            ) : (
              <PermissionGate
                permission={PERMISSIONS.inventory.valuationConfigure}
              >
                <Button asChild>
                  <Link to={newVersionHref}>
                    <Plus className="size-4" aria-hidden="true" />
                    {t.inventoryValuationMethods.newVersion}
                  </Link>
                </Button>
              </PermissionGate>
            )
          }
        />
      ) : (
        <DataTable<ItemValuationMethod>
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          isLoading={listQuery.isPending}
          isFetching={listQuery.isFetching}
          {...(listQuery.isError
            ? {
                error: listQuery.error,
                errorDescription: valuationMethodErrorMessage(
                  'load',
                  listQuery.error,
                ).message,
              }
            : {})}
          onRetry={() => {
            void listQuery.refetch();
          }}
          sorting={toSortingState(sort)}
          onSortingChange={(next) =>
            update({ sort: fromSortingState(next), page: 1 })
          }
          caption={t.inventoryValuationMethods.title}
          pagination={{
            page,
            pageSize,
            total: totalItems,
            pageSizeOptions: PAGE_SIZE_OPTIONS,
            onPageChange: (nextPage) => update({ page: nextPage }),
            onPageSizeChange: (nextSize) =>
              update({ pageSize: nextSize, page: 1 }),
          }}
        />
      )}
    </div>
  );
}
