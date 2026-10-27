import type { ColumnDef } from '@tanstack/react-table';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { DocumentType } from '@/api/contracts';
import { useOrganizationId } from '@/features/organization/use-organization';
import { t } from '@/lib/i18n';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { DataTable } from '@/ui/patterns/data-table';
import { FilterBar, FilterField } from '@/ui/patterns/filter-bar';
import { PageHeader } from '@/ui/patterns/page-header';
import { documentTypeErrorMessage } from './document-type-error-messages';
import {
  useDocumentTypeListState,
  useDocumentTypes,
} from './use-document-types';

/** The two DOC-01 routes share this base (`/app/documents/types/:code`). */
export const DOCUMENT_TYPES_PATH = '/app/documents/types';

export function documentTypeDetailPath(code: string): string {
  return `${DOCUMENT_TYPES_PATH}/${encodeURIComponent(code)}`;
}

/**
 * Column definitions live OUTSIDE the component (standards.md §3). The rows
 * are the backend's registry view: no code list is hardcoded here, and the
 * only action is a link to the read-only detail surface — the controller has
 * no POST/DELETE, so no create/delete action is offered.
 */
const columns: ColumnDef<DocumentType, unknown>[] = [
  {
    accessorKey: 'code',
    header: t.documentTypes.code,
    cell: ({ row }) => (
      <span className="code" dir="ltr">
        {row.original.code}
      </span>
    ),
  },
  {
    accessorKey: 'module',
    header: t.documentTypes.module,
    cell: ({ row }) => <span dir="ltr">{row.original.module}</span>,
  },
  { accessorKey: 'name', header: t.documentTypes.name },
  {
    id: 'draftCapable',
    header: t.documentTypes.draftCapable,
    cell: ({ row }) => (
      <Badge variant={row.original.draftCapable ? 'success' : 'neutral'}>
        {row.original.draftCapable
          ? t.app.yes
          : t.documentTypes.draftNotCapable}
      </Badge>
    ),
  },
  {
    id: 'configured',
    header: t.documentTypes.configuration,
    cell: ({ row }) => (
      <Badge variant={row.original.configured ? 'info' : 'neutral'}>
        {row.original.configured
          ? t.documentTypes.configured
          : t.documentTypes.notConfigured}
      </Badge>
    ),
  },
  {
    id: 'actions',
    header: t.documentTypes.actions,
    cell: ({ row }) => (
      <Button asChild variant="ghost" size="sm">
        <Link to={documentTypeDetailPath(row.original.code)}>
          {t.documentTypes.view}
        </Link>
      </Button>
    ),
  },
];

/**
 * Registered document types (DOC-01).
 *
 * Four states are owned by `DataTable` (loading / error + retry / empty /
 * success); the empty copy explains that types come from the backend module
 * registry and cannot be created here. Filtering and paging are URL-owned and
 * server-backed; `sort` is intentionally never sent (see `documents.api.ts`).
 */
export function DocumentTypesPage() {
  const organizationId = useOrganizationId();
  const state = useDocumentTypeListState();
  const query = useDocumentTypes(organizationId, state);
  const hasSearch = state.search !== '';

  const apply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    state.update({
      search: String(data.get('search') ?? '').trim(),
      page: null,
    });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.documentTypes.title}
        description={t.documentTypes.subtitle}
      />
      <p
        className="text-xs text-ink-subtle"
        data-testid="document-type-registry-note"
      >
        {t.documentTypes.registryNote}
      </p>
      <FilterBar
        key={state.search}
        columns={3}
        onSubmit={apply}
        onClear={() => state.update({ search: null, page: null })}
        aria-label={t.filters.title}
      >
        <FilterField label={t.documentTypes.searchLabel}>
          <Input
            name="search"
            defaultValue={state.search}
            placeholder={t.documentTypes.searchPlaceholder}
            maxLength={120}
          />
        </FilterField>
      </FilterBar>
      <DataTable
        columns={columns}
        data={query.data?.items ?? []}
        getRowId={(row) => row.code}
        caption={t.documentTypes.title}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        {...(query.isError
          ? {
              errorDescription: documentTypeErrorMessage('load', query.error),
            }
          : {})}
        onRetry={() => void query.refetch()}
        emptyTitle={
          hasSearch ? t.documentTypes.noResults : t.documentTypes.emptyTitle
        }
        emptyDescription={
          hasSearch ? t.documentTypes.noResults : t.documentTypes.emptyBody
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
    </div>
  );
}
