import type { ColumnDef } from '@tanstack/react-table';
import { type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { NumberingSeries } from '@/api/contracts';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { PermissionGate } from '@/features/permissions/permission-gate';
import { formatInstant, useTimeZone } from '@/lib/datetime';
import { t } from '@/lib/i18n';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { DataTable } from '@/ui/patterns/data-table';
import { FilterBar, FilterField } from '@/ui/patterns/filter-bar';
import { PageHeader } from '@/ui/patterns/page-header';
import { Select } from '@/ui/select';
import {
  useDocumentTypes,
} from '../document-types/use-document-types';
import { numberingSeriesErrorMessage } from './numbering-series-error-messages';
import {
  useNumberingSeries,
  useNumberingSeriesListState,
} from './use-numbering-series';

export const NUMBERING_SERIES_PATH = '/app/documents/numbering-series';

export function numberingSeriesDetailPath(seriesId: string): string {
  return `${NUMBERING_SERIES_PATH}/${encodeURIComponent(seriesId)}`;
}

function createColumns(timeZone: string): ColumnDef<NumberingSeries, unknown>[] {
  return [
    {
      accessorKey: 'documentType',
      header: t.numberingSeries.documentType,
      cell: ({ row }) => (
        <span className="code" dir="ltr">
          {row.original.documentType}
        </span>
      ),
    },
    {
      accessorKey: 'scopeKey',
      header: t.numberingSeries.scopeKey,
      cell: ({ row }) => (
        <span dir="ltr">
          {row.original.scopeKey === ''
            ? t.numberingSeries.scopeKeyDefault
            : row.original.scopeKey}
        </span>
      ),
    },
    { accessorKey: 'name', header: t.numberingSeries.name },
    {
      accessorKey: 'lastValue',
      header: t.numberingSeries.lastValue,
      cell: ({ row }) => (
        <span className="num" dir="ltr">
          {row.original.lastValue}
        </span>
      ),
    },
    {
      accessorKey: 'width',
      header: t.numberingSeries.width,
      cell: ({ row }) => <span dir="ltr">{String(row.original.width)}</span>,
    },
    {
      accessorKey: 'reusePolicy',
      header: t.numberingSeries.reusePolicy,
      cell: ({ row }) => (
        <span dir="ltr">
          {row.original.reusePolicy === 'recycle'
            ? t.numberingSeries.reuseRecycle
            : t.numberingSeries.reuseNever}
        </span>
      ),
    },
    {
      id: 'isActive',
      header: t.numberingSeries.isActive,
      cell: ({ row }) => (
        <Badge variant={row.original.isActive ? 'success' : 'neutral'}>
          {row.original.isActive
            ? t.numberingSeries.active
            : t.numberingSeries.inactive}
        </Badge>
      ),
    },
    {
      accessorKey: 'createdAt',
      header: t.numberingSeries.createdAt,
      cell: ({ row }) => (
        <span dir="ltr" title={row.original.createdAt}>
          {formatInstant(row.original.createdAt, timeZone)}
        </span>
      ),
    },
    {
      id: 'actions',
      header: t.numberingSeries.actions,
      enableSorting: false,
      cell: ({ row }) => (
        <Button asChild variant="ghost" size="sm">
          <Link to={numberingSeriesDetailPath(row.original.id)}>
            {t.numberingSeries.view}
          </Link>
        </Button>
      ),
    },
  ];
}

/**
 * Numbering series catalog (DOC-02).
 *
 * Server-paged, URL-owned filters (`documentType`, `isActive`), four states.
 * `documentType` options come from the document-type registry (no hardcode);
 * `lastValue`/`number` stay exact decimal strings.
 */
export function NumberingSeriesPage() {
  const organizationId = useOrganizationId();
  const state = useNumberingSeriesListState();
  const query = useNumberingSeries(organizationId, state);

  // Document-type options for the filter — registry-backed, not hardcoded.
  const docTypesQuery = useDocumentTypes(organizationId, {
    page: 1,
    pageSize: 200,
    search: '',
  });

  const hasActiveFilter =
    state.documentType !== '' || state.isActive !== '';

  const apply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    state.update({
      documentType: String(data.get('documentType') ?? '').trim(),
      isActive: String(data.get('isActive') ?? '').trim(),
      page: null,
    });
  };

  const timeZone = useTimeZone();
  const columns = createColumns(timeZone);

  return (
    <div className="space-y-4" data-testid="numbering-series-page">
      <PageHeader
        title={t.numberingSeries.title}
        description={t.numberingSeries.subtitle}
        actions={
          <PermissionGate
            permission={PERMISSIONS.documents.numberingSeriesCreate}
          >
            <Button asChild size="sm" data-testid="numbering-series-new-button">
              <Link to={`${NUMBERING_SERIES_PATH}/new`}>
                {t.numberingSeries.newSeries}
              </Link>
            </Button>
          </PermissionGate>
        }
      />
      <p
        className="text-xs text-ink-subtle"
        data-testid="numbering-series-registry-note"
      >
        {t.numberingSeries.registryNote}
      </p>
      <FilterBar
        key={`${state.documentType}:${state.isActive}`}
        columns={3}
        onSubmit={apply}
        onClear={() =>
          state.update({ documentType: null, isActive: null, page: null })
        }
        aria-label={t.filters.title}
      >
        <FilterField label={t.numberingSeries.documentType}>
          <Select
            name="documentType"
            defaultValue={state.documentType}
            data-testid="numbering-series-document-type-filter"
            aria-label={t.numberingSeries.documentType}
          >
            <option value="">همه انواع</option>
            {(docTypesQuery.data?.items ?? []).map((dt) => (
              <option key={dt.code} value={dt.code}>
                {dt.code}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label={t.numberingSeries.isActive}>
          <Select
            name="isActive"
            defaultValue={state.isActive}
            data-testid="numbering-series-is-active-filter"
            aria-label={t.numberingSeries.isActive}
          >
            <option value="">{t.numberingSeries.allStatuses}</option>
            <option value="true">{t.numberingSeries.active}</option>
            <option value="false">{t.numberingSeries.inactive}</option>
          </Select>
        </FilterField>
      </FilterBar>

      <DataTable
        columns={columns}
        data={query.data?.items ?? []}
        getRowId={(row) => row.id}
        caption={t.numberingSeries.title}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        {...(query.isError
          ? {
              errorDescription: numberingSeriesErrorMessage(
                'load',
                query.error,
              ),
            }
          : {})}
        onRetry={() => void query.refetch()}
        emptyTitle={
          hasActiveFilter
            ? t.numberingSeries.emptyBodyFiltered
            : t.numberingSeries.emptyTitle
        }
        emptyDescription={
          hasActiveFilter
            ? t.numberingSeries.emptyBodyFiltered
            : t.numberingSeries.emptyBody
        }
        pagination={{
          page: query.data?.page ?? state.page,
          pageSize: query.data?.pageSize ?? state.pageSize,
          total: query.data?.total ?? 0,
          onPageChange: (page) => state.update({ page }),
          onPageSizeChange: (pageSize) =>
            state.update({ pageSize, page: null }),
        }}
      />
      <p className="text-xs text-ink-subtle" data-testid="numbering-series-no-delete-note">
        {t.numberingSeries.noDeleteNote}
      </p>
    </div>
  );
}
