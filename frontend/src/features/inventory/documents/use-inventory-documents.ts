import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import type { SortingState } from '@tanstack/react-table';
import {
  listInventoryDocuments,
  readInventoryDocument,
} from '@/api/inventory.api';
import type {
  InventoryDocumentKind,
  InventoryDocumentListQuery,
  InventoryDocumentStatus,
} from '@/api/contracts';
import { isOtherOrganizationScope, queryKeys } from '@/api/query-keys';
import { sortingFromParam } from '@/lib/sort-param';
import { DOCUMENT_KINDS, DOCUMENT_STATUSES } from './inventory-document-labels';

/**
 * URL-owned state of the inventory documents workspace (standards.md §5).
 *
 * Every parameter maps 1:1 onto a query parameter
 * `InventoryBusinessDocumentsController` declares, and unknown URL input is
 * normalized away rather than forwarded to the API (which would answer 400).
 */

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
const DEFAULT_PAGE_SIZE = 50;

/** The backend's own default order, made explicit in the URL. */
export const DOCUMENTS_DEFAULT_SORT = 'businessDate:desc';

/** Sort fields the documents endpoint allow-lists (its service). */
export const DOCUMENT_SORT_FIELDS = [
  'businessDate',
  'createdAt',
  'number',
  'status',
] as const;

export interface DocumentsUrlState {
  page: number;
  pageSize: number;
  sort: string;
  kind: InventoryDocumentKind | '';
  status: InventoryDocumentStatus | '';
  warehouseId: string;
  dateFrom: string;
  dateTo: string;
}

export function hasActiveDocumentFilters(state: DocumentsUrlState): boolean {
  return (
    state.kind !== '' ||
    state.status !== '' ||
    state.warehouseId !== '' ||
    state.dateFrom !== '' ||
    state.dateTo !== ''
  );
}

function parseKind(value: string | null): InventoryDocumentKind | '' {
  if (value === null) return '';
  return (DOCUMENT_KINDS as readonly string[]).includes(value)
    ? (value as InventoryDocumentKind)
    : '';
}

function parseStatus(value: string | null): InventoryDocumentStatus | '' {
  if (value === null) return '';
  return (DOCUMENT_STATUSES as readonly string[]).includes(value)
    ? (value as InventoryDocumentStatus)
    : '';
}

/** Normalize the URL into the state the UI renders (untrusted input). */
export function parseDocumentsUrlState(
  params: URLSearchParams,
): DocumentsUrlState {
  const pageValue = Number(params.get('page'));
  const page =
    Number.isInteger(pageValue) && pageValue >= 1 ? Math.trunc(pageValue) : 1;
  const pageSizeValue = Number(params.get('pageSize'));
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(
    pageSizeValue,
  )
    ? pageSizeValue
    : DEFAULT_PAGE_SIZE;

  const sorting = sortingFromParam(params.get('sort'), DOCUMENT_SORT_FIELDS);
  const first = sorting[0];
  const sort =
    first === undefined
      ? DOCUMENTS_DEFAULT_SORT
      : `${first.id}:${first.desc ? 'desc' : 'asc'}`;

  const dateFrom = params.get('dateFrom') ?? '';
  const dateTo = params.get('dateTo') ?? '';
  return {
    page,
    pageSize,
    sort,
    kind: parseKind(params.get('kind')),
    status: parseStatus(params.get('status')),
    warehouseId: params.get('warehouseId') ?? '',
    dateFrom: /^\d{4}-\d{2}-\d{2}$/.test(dateFrom) ? dateFrom : '',
    dateTo: /^\d{4}-\d{2}-\d{2}$/.test(dateTo) ? dateTo : '',
  };
}

export type DocumentsUrlUpdate = Partial<
  Omit<DocumentsUrlState, 'page' | 'pageSize' | 'sort'>
> & {
  page?: number | null;
  pageSize?: number;
  sort?: string;
};

export function useDocumentsUrlState() {
  const [params, setParams] = useSearchParams();
  const urlState = parseDocumentsUrlState(params);

  const update = useCallback(
    (changes: DocumentsUrlUpdate) => {
      setParams((current) => {
        const next = new URLSearchParams(current);
        const apply = (
          key: string,
          value: string | number | null | undefined,
        ) => {
          if (value === null || value === undefined || value === '') {
            next.delete(key);
          } else {
            next.set(key, String(value));
          }
        };
        const resetPage = 'page' in changes;
        for (const [key, value] of Object.entries(changes)) {
          if (key === 'page') continue;
          apply(
            key,
            key === 'sort' && value === DOCUMENTS_DEFAULT_SORT ? null : value,
          );
        }
        if (resetPage) {
          const page = changes.page;
          if (page === null || page === undefined || page === 1) {
            next.delete('page');
          } else {
            next.set('page', String(page));
          }
        }
        return next;
      });
    },
    [setParams],
  );

  const clearFilters = useCallback(() => {
    setParams(() => new URLSearchParams());
  }, [setParams]);

  return { state: urlState, update, clearFilters };
}

/** The exact query for the endpoint (only declared parameters, no more). */
export function buildDocumentsQuery(
  organizationId: string,
  state: DocumentsUrlState,
): InventoryDocumentListQuery {
  return {
    organizationId,
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort,
    ...(state.kind !== '' ? { kind: state.kind } : {}),
    ...(state.status !== '' ? { status: state.status } : {}),
    ...(state.warehouseId !== '' ? { warehouseId: state.warehouseId } : {}),
    ...(state.dateFrom !== ''
      ? { dateFrom: `${state.dateFrom}T00:00:00.000Z` }
      : {}),
    ...(state.dateTo !== '' ? { dateTo: `${state.dateTo}T00:00:00.000Z` } : {}),
  };
}

export function documentsSortingState(sort: string): SortingState {
  return sortingFromParam(sort, DOCUMENT_SORT_FIELDS);
}

/** The documents list of the active organization. */
export function useDocumentsList(
  organizationId: string | null,
  state: DocumentsUrlState,
) {
  const enabled = organizationId !== null;
  const query = enabled
    ? buildDocumentsQuery(organizationId as string, state)
    : null;

  return useQuery({
    queryKey: queryKeys.inventory.documents(
      organizationId ?? 'none',
      (query ?? {}) as Record<string, unknown>,
    ),
    queryFn: ({ signal }) =>
      listInventoryDocuments(query as InventoryDocumentListQuery, signal),
    enabled,
    // Operational list: short freshness window (standards.md §6).
    staleTime: 30_000,
    placeholderData: (previous, previousQuery) =>
      previousQuery !== undefined &&
      !isOtherOrganizationScope(
        previousQuery.queryKey,
        organizationId ?? 'none',
      )
        ? previous
        : undefined,
  });
}

/** One document with its lines. */
export function useDocumentDetail(
  organizationId: string | null,
  documentId: string | undefined,
) {
  const enabled = organizationId !== null && documentId !== undefined;
  return useQuery({
    queryKey: queryKeys.inventory.document(
      organizationId ?? 'none',
      documentId ?? 'none',
    ),
    queryFn: ({ signal }) =>
      readInventoryDocument(
        documentId as string,
        organizationId as string,
        signal,
      ),
    enabled,
    staleTime: 30_000,
  });
}
