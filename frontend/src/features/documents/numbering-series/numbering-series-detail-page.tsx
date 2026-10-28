import type { ColumnDef } from '@tanstack/react-table';
import { type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { NumberingAllocation } from '@/api/contracts';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { PermissionGate } from '@/features/permissions/permission-gate';
import { formatInstant, useTimeZone } from '@/lib/datetime';
import { t } from '@/lib/i18n';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import { Input } from '@/ui/input';
import { DataTable } from '@/ui/patterns/data-table';
import { FilterBar, FilterField } from '@/ui/patterns/filter-bar';
import { PageHeader } from '@/ui/patterns/page-header';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import {
  Definition,
  DefinitionList,
} from '@/ui/patterns/definition-list';
import { LoadingState } from '@/ui/patterns/states';
import { Select } from '@/ui/select';
import {
  numberingAllocationErrorMessage,
  numberingSeriesErrorMessage,
} from './numbering-series-error-messages';
import {
  useNumberingAllocationListState,
  useNumberingAllocations,
  useNumberingSeriesDetail,
} from './use-numbering-series';

const LIST_PATH = '/app/documents/numbering-series';

function allocationColumns(
  timeZone: string,
): ColumnDef<NumberingAllocation, unknown>[] {
  return [
    {
      accessorKey: 'number',
      header: t.numberingSeries.allocationNumber,
      cell: ({ row }) => (
        <span className="num font-medium" dir="ltr">
          {row.original.number}
        </span>
      ),
    },
    {
      accessorKey: 'referenceModule',
      header: t.numberingSeries.referenceModule,
      cell: ({ row }) => (
        <span dir="ltr">
          {row.original.referenceModule ?? '—'}
        </span>
      ),
    },
    {
      accessorKey: 'referenceDocumentType',
      header: t.numberingSeries.referenceDocumentType,
      cell: ({ row }) => (
        <span dir="ltr">
          {row.original.referenceDocumentType ?? '—'}
        </span>
      ),
    },
    {
      accessorKey: 'referenceDocumentId',
      header: t.numberingSeries.referenceDocumentId,
      cell: ({ row }) => (
        <span dir="ltr" className="code text-xs">
          {row.original.referenceDocumentId ?? '—'}
        </span>
      ),
    },
    {
      accessorKey: 'createdAt',
      header: t.numberingSeries.allocatedAt,
      cell: ({ row }) => (
        <span dir="ltr" title={row.original.createdAt}>
          {formatInstant(row.original.createdAt, timeZone)}
        </span>
      ),
    },
  ];
}

/**
 * Numbering series detail (DOC-02).
 *
 * Four states for the series itself; the allocation ledger is a second
 * independent server-paged grid (read-only, append-only, gated by
 * `Document.Numbering.View`). `lastValue` and `number` remain strings.
 */
export function NumberingSeriesDetailPage() {
  const organizationId = useOrganizationId();
  const { seriesId } = useParams<{ seriesId: string }>();
  const detailQuery = useNumberingSeriesDetail(organizationId, seriesId);
  const timeZone = useTimeZone();

  if (organizationId === null || seriesId === undefined) {
    return <LoadingState rows={5} label={t.loading.receiving} />;
  }

  if (detailQuery.isPending) {
    return <LoadingState rows={6} label={t.loading.receiving} />;
  }

  if (detailQuery.isError) {
    return (
      <div className="space-y-4">
        <PageHeader
          title={t.numberingSeries.detailTitle}
          description={t.numberingSeries.detailSubtitle}
        />
        <ApiErrorAlert
          error={detailQuery.error}
          title={t.table.errorTitle}
          description={numberingSeriesErrorMessage('load', detailQuery.error)}
          onRetry={() => void detailQuery.refetch()}
        />
      </div>
    );
  }

  const series = detailQuery.data;

  return (
    <div className="space-y-6" data-testid="numbering-series-detail-page">
      <PageHeader
        title={series.name}
        description={t.numberingSeries.detailSubtitle}
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to={LIST_PATH}>{t.numberingSeries.backToList}</Link>
            </Button>
            <PermissionGate
              permission={PERMISSIONS.documents.numberingSeriesEdit}
            >
              <Button asChild size="sm" data-testid="numbering-series-edit-button">
                <Link
                  to={`/app/documents/numbering-series/${encodeURIComponent(series.id)}/edit`}
                >
                  {t.numberingSeries.edit}
                </Link>
              </Button>
            </PermissionGate>
          </div>
        }
      />

      <Card>
        <CardContent>
          <DefinitionList>
            <Definition label={t.numberingSeries.documentType}>
              <span dir="ltr" className="code">
                {series.documentType}
              </span>
            </Definition>
            <Definition label={t.numberingSeries.scopeKey}>
              <span dir="ltr">
                {series.scopeKey === ''
                  ? t.numberingSeries.scopeKeyDefault
                  : series.scopeKey}
              </span>
            </Definition>
            <Definition label={t.numberingSeries.name}>{series.name}</Definition>
            <Definition label={t.numberingSeries.lastValue}>
              <span dir="ltr" className="num">
                {series.lastValue}
              </span>
            </Definition>
            <Definition label={t.numberingSeries.strategy}>
              <span dir="ltr">{t.numberingSeries.strategyMonotonic}</span>
            </Definition>
            <Definition label={t.numberingSeries.width}>
              <span dir="ltr">{String(series.width)}</span>
            </Definition>
            <Definition label={t.numberingSeries.reusePolicy}>
              <span dir="ltr">
                {series.reusePolicy === 'recycle'
                  ? t.numberingSeries.reuseRecycle
                  : t.numberingSeries.reuseNever}
              </span>
            </Definition>
            <Definition label={t.numberingSeries.isActive}>
              <Badge variant={series.isActive ? 'success' : 'neutral'}>
                {series.isActive
                  ? t.numberingSeries.active
                  : t.numberingSeries.inactive}
              </Badge>
            </Definition>
            <Definition label={t.numberingSeries.createdAt}>
              <span dir="ltr">{formatInstant(series.createdAt, timeZone)}</span>
            </Definition>
            <Definition label={t.numberingSeries.updatedAt}>
              <span dir="ltr">{formatInstant(series.updatedAt, timeZone)}</span>
            </Definition>
          </DefinitionList>
        </CardContent>
      </Card>

      <p className="text-xs text-ink-subtle" data-testid="numbering-series-detail-notes">
        {t.numberingSeries.scopeKeyReadOnlyHint} — {t.numberingSeries.noDeleteNote}
      </p>

      <PermissionGate
        permission={PERMISSIONS.documents.numberingAllocationView}
        fallback={
          <Card>
            <CardContent>
              <p
                className="text-sm text-ink-muted"
                data-testid="numbering-series-allocations-permission-note"
              >
                {t.numberingSeries.noAllocationsPermission}
              </p>
            </CardContent>
          </Card>
        }
      >
        <NumberingAllocationsSection
          organizationId={organizationId}
          seriesId={seriesId}
          timeZone={timeZone}
        />
      </PermissionGate>
    </div>
  );
}

function NumberingAllocationsSection({
  organizationId,
  seriesId,
  timeZone,
}: {
  organizationId: string;
  seriesId: string;
  timeZone: string;
}) {
  const state = useNumberingAllocationListState(seriesId);
  const query = useNumberingAllocations(organizationId, seriesId, state);
  const columns = allocationColumns(timeZone);

  const hasFilter =
    state.referenceModule !== '' ||
    state.referenceDocumentType !== '' ||
    state.referenceDocumentId !== '';

  const apply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    state.update({
      referenceModule: String(data.get('referenceModule') ?? '').trim(),
      referenceDocumentType: String(
        data.get('referenceDocumentType') ?? '',
      ).trim(),
      referenceDocumentId: String(
        data.get('referenceDocumentId') ?? '',
      ).trim(),
      sort: String(data.get('sort') ?? '').trim(),
      page: null,
    });
  };

  return (
    <div className="space-y-3" data-testid="numbering-series-allocations-section">
      <h2 className="text-sm font-semibold">{t.numberingSeries.allocationsTitle}</h2>
      <p className="text-xs text-ink-subtle">{t.numberingSeries.allocationsSubtitle}</p>

      <FilterBar
        key={`${state.referenceModule}:${state.referenceDocumentType}:${state.referenceDocumentId}:${state.sort}`}
        columns={4}
        onSubmit={apply}
        onClear={() =>
          state.update({
            referenceModule: null,
            referenceDocumentType: null,
            referenceDocumentId: null,
            sort: null,
            page: null,
          })
        }
        aria-label={t.numberingSeries.allocationsTitle}
      >
        <FilterField label={t.numberingSeries.referenceModule}>
          <Input
            name="referenceModule"
            defaultValue={state.referenceModule}
            placeholder={t.numberingSeries.referenceModule}
            data-testid="allocation-reference-module-filter"
          />
        </FilterField>
        <FilterField label={t.numberingSeries.referenceDocumentType}>
          <Input
            name="referenceDocumentType"
            defaultValue={state.referenceDocumentType}
            placeholder={t.numberingSeries.referenceDocumentType}
            data-testid="allocation-reference-document-type-filter"
          />
        </FilterField>
        <FilterField label={t.numberingSeries.referenceDocumentId}>
          <Input
            name="referenceDocumentId"
            defaultValue={state.referenceDocumentId}
            placeholder={t.numberingSeries.referenceDocumentId}
            dir="ltr"
            data-testid="allocation-reference-document-id-filter"
          />
        </FilterField>
        <FilterField label={t.numberingSeries.sort}>
          <Select
            name="sort"
            defaultValue={state.sort}
            data-testid="allocation-sort-filter"
          >
            <option value="number:asc">{t.numberingSeries.sortNumberAsc}</option>
            <option value="number:desc">{t.numberingSeries.sortNumberDesc}</option>
            <option value="createdAt:asc">{t.numberingSeries.sortCreatedAtAsc}</option>
            <option value="createdAt:desc">{t.numberingSeries.sortCreatedAtDesc}</option>
          </Select>
        </FilterField>
      </FilterBar>

      <DataTable
        columns={columns}
        data={query.data?.items ?? []}
        getRowId={(row) => row.id}
        caption={t.numberingSeries.allocationsTitle}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        {...(query.isError
          ? {
              errorDescription: numberingAllocationErrorMessage(query.error),
            }
          : {})}
        onRetry={() => void query.refetch()}
        emptyTitle={
          hasFilter
            ? t.numberingSeries.allocationsEmptyFiltered
            : t.numberingSeries.allocationsEmpty
        }
        emptyDescription={
          hasFilter
            ? t.numberingSeries.allocationsEmptyFiltered
            : t.numberingSeries.allocationsEmpty
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

      <p className="text-xs text-ink-subtle" data-testid="allocations-read-only-note">
        {t.numberingSeries.allocationsReadOnlyNote}
      </p>
    </div>
  );
}
