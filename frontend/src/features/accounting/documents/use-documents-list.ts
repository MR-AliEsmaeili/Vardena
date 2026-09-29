import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import type { SortingState } from '@tanstack/react-table';
import {
  ACCOUNTING_DOCUMENT_SORT_FIELDS,
  listAccountingDocuments,
} from '@/api/accounting.api';
import type { AccountingDocumentListQuery } from '@/api/contracts';
import { isOtherOrganizationScope, queryKeys } from '@/api/query-keys';
import { sortingFromParam } from '@/lib/sort-param';
import {
  DOCUMENT_ORIGINS,
  DOCUMENT_STATES,
  type DocumentOrigin,
  type DocumentState,
} from './document-lifecycle';

/**
 * URL-owned state of the documents workspace (standards.md §5: list state
 * belongs in the router search params).
 *
 * Invariant held here: **URL ↔ visible controls ↔ server query**. Every
 * parameter below maps 1:1 onto a query parameter the
 * `AccountingDocumentsController.list` endpoint actually declares, every
 * visible control reads from and writes to the URL, and unknown/garbage URL
 * input is normalized away instead of being forwarded to the API (which
 * would answer 400). Browser Back/Forward/Refresh/deep-link therefore all
 * reproduce the exact same server query.
 */

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
const DEFAULT_PAGE_SIZE = 50;

/**
 * The backend's own default order (`documentDate:desc, createdAt:desc`) made
 * explicit in the URL, so the sort indicator, the URL and the server always
 * agree about the active order.
 */
export const DOCUMENTS_DEFAULT_SORT = 'documentDate:desc';

export interface DocumentsUrlState {
  page: number;
  pageSize: number;
  search: string;
  sort: string;
  state: DocumentState | '';
  origin: DocumentOrigin | '';
  financialAreaId: string;
  fiscalYearId: string;
  accountingPeriodId: string;
  documentNumber: string;
  dateFrom: string;
  dateTo: string;
}

/** Which filters (beyond paging/sort/search) are currently narrowing the list. */
export function hasActiveDocumentFilters(state: DocumentsUrlState): boolean {
  return (
    state.state !== '' ||
    state.origin !== '' ||
    state.financialAreaId !== '' ||
    state.fiscalYearId !== '' ||
    state.accountingPeriodId !== '' ||
    state.documentNumber !== '' ||
    state.dateFrom !== '' ||
    state.dateTo !== ''
  );
}

function parseEnum<T extends string>(
  value: string | null,
  allowed: readonly T[],
): T | '' {
  if (value === null) return '';
  return (allowed as readonly string[]).includes(value) ? (value as T) : '';
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

  const sorting = sortingFromParam(
    params.get('sort'),
    ACCOUNTING_DOCUMENT_SORT_FIELDS,
  );
  const sort =
    sorting.length > 0
      ? `${sorting[0]?.id ?? 'documentDate'}:${sorting[0]?.desc ? 'desc' : 'asc'}`
      : DOCUMENTS_DEFAULT_SORT;

  return {
    page,
    pageSize,
    search: params.get('search') ?? '',
    sort,
    state: parseEnum(params.get('state'), DOCUMENT_STATES),
    origin: parseEnum(params.get('origin'), DOCUMENT_ORIGINS),
    financialAreaId: params.get('financialAreaId') ?? '',
    fiscalYearId: params.get('fiscalYearId') ?? '',
    accountingPeriodId: params.get('accountingPeriodId') ?? '',
    documentNumber: params.get('documentNumber') ?? '',
    dateFrom: params.get('dateFrom') ?? '',
    dateTo: params.get('dateTo') ?? '',
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

  /** Clear every filter parameter (page returns to 1; sort returns to default). */
  const clearFilters = useCallback(() => {
    setParams((current) => {
      const next = new URLSearchParams();
      // Paging/sort survive as the (clean) defaults.
      const state = parseDocumentsUrlState(current);
      next.delete('page');
      if (state.pageSize !== DEFAULT_PAGE_SIZE) {
        next.set('pageSize', String(state.pageSize));
      }
      return next;
    });
  }, [setParams]);

  return { state: urlState, update, clearFilters };
}

/** The exact query for the endpoint (only declared parameters, no more). */
export function buildDocumentsQuery(
  organizationId: string,
  state: DocumentsUrlState,
): AccountingDocumentListQuery {
  return {
    organizationId,
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort,
    ...(state.search.trim() !== '' ? { search: state.search.trim() } : {}),
    ...(state.state !== '' ? { state: state.state } : {}),
    ...(state.origin !== '' ? { origin: state.origin } : {}),
    ...(state.financialAreaId !== ''
      ? { financialAreaId: state.financialAreaId }
      : {}),
    ...(state.fiscalYearId !== '' ? { fiscalYearId: state.fiscalYearId } : {}),
    ...(state.accountingPeriodId !== ''
      ? { accountingPeriodId: state.accountingPeriodId }
      : {}),
    ...(state.documentNumber.trim() !== ''
      ? { documentNumber: state.documentNumber.trim() }
      : {}),
    ...(state.dateFrom !== '' ? { dateFrom: state.dateFrom } : {}),
    ...(state.dateTo !== '' ? { dateTo: state.dateTo } : {}),
  } as AccountingDocumentListQuery;
}

export function documentsSortingState(sort: string): SortingState {
  return sortingFromParam(sort, ACCOUNTING_DOCUMENT_SORT_FIELDS);
}

/**
 * The documents list of the active organization. Loading keeps the previous
 * page only within the SAME organization (an organization switch must never
 * paint the old organization's vouchers).
 */
export function useDocumentsList(
  organizationId: string | null,
  state: DocumentsUrlState,
) {
  const enabled = organizationId !== null;
  const query = enabled
    ? buildDocumentsQuery(organizationId as string, state)
    : null;

  return useQuery({
    queryKey: queryKeys.accounting.accountingDocuments(
      organizationId ?? 'none',
      (query ?? {}) as Record<string, unknown>,
    ),
    queryFn: ({ signal }) =>
      listAccountingDocuments(query as AccountingDocumentListQuery, signal),
    enabled,
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
