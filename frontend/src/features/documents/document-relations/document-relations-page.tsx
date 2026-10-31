import type { ColumnDef } from '@tanstack/react-table';
import { type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { DocumentRelation } from '@/api/contracts';
import { DOCUMENT_RELATION_KINDS } from '@/api/contracts';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { PermissionGate } from '@/features/permissions/permission-gate';
import { formatInstant, useTimeZone } from '@/lib/datetime';
import { t } from '@/lib/i18n';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { DataTable } from '@/ui/patterns/data-table';
import { FilterBar, FilterField } from '@/ui/patterns/filter-bar';
import { PageHeader } from '@/ui/patterns/page-header';
import { Select } from '@/ui/select';
import { documentRelationListErrorMessage } from './document-relations-error-messages';
import {
  useDocumentRelations,
  useDocumentRelationsListState,
} from './use-document-relations';

export const DOCUMENT_RELATIONS_PATH = '/app/documents/relations';

export function documentRelationDetailPath(relationId: string): string {
  return `${DOCUMENT_RELATIONS_PATH}/${encodeURIComponent(relationId)}`;
}

function relationKindLabel(kind: string): string {
  const map: Record<string, string> = {
    reference: t.documentRelations.kinds.reference,
    derive: t.documentRelations.kinds.derive,
    fulfill: t.documentRelations.kinds.fulfill,
    settle: t.documentRelations.kinds.settle,
    reverse: t.documentRelations.kinds.reverse,
    transfer_of: t.documentRelations.kinds.transferOf,
  };
  return map[kind] ?? kind;
}

function createColumns(
  timeZone: string,
): ColumnDef<DocumentRelation, unknown>[] {
  return [
    {
      accessorKey: 'relationKind',
      header: t.documentRelations.relationKind,
      cell: ({ row }) => (
        <Badge
          variant="neutral"
          data-testid={`relation-kind-${row.original.relationKind}`}
        >
          {relationKindLabel(row.original.relationKind)}
        </Badge>
      ),
    },
    {
      id: 'source',
      header: t.documentRelations.source,
      cell: ({ row }) => (
        <span dir="ltr" className="text-xs">
          {row.original.source.module}/{row.original.source.documentType}/
          <span className="code">
            {row.original.source.documentId.slice(0, 8)}…
          </span>
        </span>
      ),
    },
    {
      id: 'target',
      header: t.documentRelations.target,
      cell: ({ row }) => (
        <span dir="ltr" className="text-xs">
          {row.original.target.module}/{row.original.target.documentType}/
          <span className="code">
            {row.original.target.documentId.slice(0, 8)}…
          </span>
        </span>
      ),
    },
    {
      accessorKey: 'quantity',
      header: t.documentRelations.quantity,
      cell: ({ row }) => (
        <span dir="ltr" className="num">
          {row.original.quantity ?? '—'}
        </span>
      ),
    },
    {
      accessorKey: 'createdAt',
      header: t.documentRelations.createdAt,
      cell: ({ row }) => (
        <span dir="ltr" title={row.original.createdAt}>
          {formatInstant(row.original.createdAt, timeZone)}
        </span>
      ),
    },
    {
      id: 'actions',
      header: t.documentRelations.actions,
      enableSorting: false,
      cell: ({ row }) => (
        <Button asChild variant="ghost" size="sm">
          <Link to={documentRelationDetailPath(row.original.id)}>
            {t.documentRelations.view}
          </Link>
        </Button>
      ),
    },
  ];
}

/**
 * Document relations list (DOC-03).
 *
 * Server-paged, URL-owned filters for all 7 filter fields, sort is
 * `createdAt:asc|desc` only (backend whitelist). Four DataTable states.
 */
export function DocumentRelationsPage() {
  const organizationId = useOrganizationId();
  const state = useDocumentRelationsListState();
  const query = useDocumentRelations(organizationId, state);
  const timeZone = useTimeZone();
  const columns = createColumns(timeZone);

  const hasActiveFilter =
    state.relationKind !== '' ||
    state.sourceModule !== '' ||
    state.sourceDocumentType !== '' ||
    state.sourceDocumentId !== '' ||
    state.targetModule !== '' ||
    state.targetDocumentType !== '' ||
    state.targetDocumentId !== '';

  const apply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    state.update({
      relationKind: String(data.get('relationKind') ?? '').trim(),
      sourceModule: String(data.get('sourceModule') ?? '').trim(),
      sourceDocumentType: String(data.get('sourceDocumentType') ?? '').trim(),
      sourceDocumentId: String(data.get('sourceDocumentId') ?? '').trim(),
      targetModule: String(data.get('targetModule') ?? '').trim(),
      targetDocumentType: String(data.get('targetDocumentType') ?? '').trim(),
      targetDocumentId: String(data.get('targetDocumentId') ?? '').trim(),
      sort: String(data.get('sort') ?? '').trim(),
      page: null,
    });
  };

  return (
    <div className="space-y-4" data-testid="document-relations-page">
      <PageHeader
        title={t.documentRelations.title}
        description={t.documentRelations.subtitle}
        actions={
          <PermissionGate permission={PERMISSIONS.documents.relationCreate}>
            <Button
              asChild
              size="sm"
              data-testid="document-relations-new-button"
            >
              <Link to={`${DOCUMENT_RELATIONS_PATH}/new`}>
                {t.documentRelations.newRelation}
              </Link>
            </Button>
          </PermissionGate>
        }
      />
      <p
        className="text-xs text-ink-subtle"
        data-testid="document-relations-note"
      >
        {t.documentRelations.registryNote}
      </p>

      <FilterBar
        key={`${state.relationKind}:${state.sourceModule}:${state.sourceDocumentType}:${state.sourceDocumentId}:${state.targetModule}:${state.targetDocumentType}:${state.targetDocumentId}:${state.sort}`}
        columns={4}
        onSubmit={apply}
        onClear={() =>
          state.update({
            relationKind: null,
            sourceModule: null,
            sourceDocumentType: null,
            sourceDocumentId: null,
            targetModule: null,
            targetDocumentType: null,
            targetDocumentId: null,
            sort: null,
            page: null,
          })
        }
        aria-label={t.filters.title}
      >
        <FilterField label={t.documentRelations.relationKind}>
          <Select
            name="relationKind"
            defaultValue={state.relationKind}
            data-testid="document-relations-relation-kind-filter"
            aria-label={t.documentRelations.relationKind}
          >
            <option value="">{t.documentRelations.allKinds}</option>
            {DOCUMENT_RELATION_KINDS.map((k) => (
              <option key={k} value={k}>
                {relationKindLabel(k)}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label={t.documentRelations.sourceModule}>
          <Input
            name="sourceModule"
            defaultValue={state.sourceModule}
            placeholder={t.documentRelations.sourceModule}
            data-testid="document-relations-source-module-filter"
          />
        </FilterField>
        <FilterField label={t.documentRelations.sourceDocumentType}>
          <Input
            name="sourceDocumentType"
            defaultValue={state.sourceDocumentType}
            placeholder={t.documentRelations.sourceDocumentType}
            data-testid="document-relations-source-document-type-filter"
          />
        </FilterField>
        <FilterField label={t.documentRelations.sourceDocumentId}>
          <Input
            name="sourceDocumentId"
            defaultValue={state.sourceDocumentId}
            placeholder={t.documentRelations.sourceDocumentId}
            dir="ltr"
            data-testid="document-relations-source-document-id-filter"
          />
        </FilterField>
        <FilterField label={t.documentRelations.targetModule}>
          <Input
            name="targetModule"
            defaultValue={state.targetModule}
            placeholder={t.documentRelations.targetModule}
            data-testid="document-relations-target-module-filter"
          />
        </FilterField>
        <FilterField label={t.documentRelations.targetDocumentType}>
          <Input
            name="targetDocumentType"
            defaultValue={state.targetDocumentType}
            placeholder={t.documentRelations.targetDocumentType}
            data-testid="document-relations-target-document-type-filter"
          />
        </FilterField>
        <FilterField label={t.documentRelations.targetDocumentId}>
          <Input
            name="targetDocumentId"
            defaultValue={state.targetDocumentId}
            placeholder={t.documentRelations.targetDocumentId}
            dir="ltr"
            data-testid="document-relations-target-document-id-filter"
          />
        </FilterField>
        <FilterField label={t.documentRelations.sort}>
          <Select
            name="sort"
            defaultValue={state.sort}
            data-testid="document-relations-sort-filter"
          >
            <option value="createdAt:desc">
              {t.documentRelations.sortCreatedAtDesc}
            </option>
            <option value="createdAt:asc">
              {t.documentRelations.sortCreatedAtAsc}
            </option>
          </Select>
        </FilterField>
      </FilterBar>

      <DataTable
        columns={columns}
        data={query.data?.items ?? []}
        getRowId={(row) => row.id}
        caption={t.documentRelations.title}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        {...(query.isError
          ? { errorDescription: documentRelationListErrorMessage(query.error) }
          : {})}
        onRetry={() => void query.refetch()}
        emptyTitle={
          hasActiveFilter
            ? t.documentRelations.emptyFilteredTitle
            : t.documentRelations.emptyTitle
        }
        emptyDescription={
          hasActiveFilter
            ? t.documentRelations.emptyFilteredBody
            : t.documentRelations.emptyBody
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
      <p
        className="text-xs text-ink-subtle"
        data-testid="document-relations-no-delete-note"
      >
        {t.documentRelations.noDeleteNote}
      </p>
    </div>
  );
}
