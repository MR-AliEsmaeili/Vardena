import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  createNumberingSeries,
  getNumberingSeries,
  listNumberingAllocations,
  listNumberingSeries,
  updateNumberingSeries,
} from '@/api/documents.api';
import type {
  CreateNumberingSeriesRequest,
  NumberingAllocation,
  NumberingSeries,
  Paginated,
  UpdateNumberingSeriesRequest,
} from '@/api/contracts';
import { queryKeys } from '@/api/query-keys';

/**
 * Numbering series reads and writes (DOC-02).
 *
 * Backend contract (`NumberingSeriesController`) is the source of truth:
 * - `GET /documents/numbering-series` — paged, organization-scoped, filterable
 *   by `documentType` and `isActive`, sortable by `name`, `createdAt`,
 *   `updatedAt`;
 * - `POST /documents/numbering-series` — creates with the unique triple
 *   `(organizationId, documentType, scopeKey)`;
 * - `GET /documents/numbering-series/:id` — one series;
 * - `PATCH /documents/numbering-series/:id` — only `name`, `strategy`,
 *   `width`, `reusePolicy`, `isActive` are writable;
 * - `GET /documents/numbering-series/:id/allocations` — read-only ledger
 *   (`Document.Numbering.View`), append-only, no write endpoint.
 */

const PAGE_SIZES: readonly number[] = [25, 50, 100, 200];
const DEFAULT_PAGE_SIZE = 50;

export interface NumberingSeriesListState {
  page: number;
  pageSize: number;
  documentType: string;
  isActive: string;
}

export function useNumberingSeriesListState(): NumberingSeriesListState & {
  update: (values: Record<string, string | number | null>) => void;
} {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const pageSizeValue = Number(params.get('pageSize')) || DEFAULT_PAGE_SIZE;
  const pageSize = PAGE_SIZES.includes(pageSizeValue)
    ? pageSizeValue
    : DEFAULT_PAGE_SIZE;
  const documentType = params.get('documentType') ?? '';
  const isActive = params.get('isActive') ?? '';

  const update = (values: Record<string, string | number | null>) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(values)) {
        if (value === null || value === '' || (key === 'page' && value === 1)) {
          next.delete(key);
        } else {
          next.set(key, String(value));
        }
      }
      return next;
    });
  };

  return { page, pageSize, documentType, isActive, update };
}

export interface NumberingAllocationListState {
  page: number;
  pageSize: number;
  referenceModule: string;
  referenceDocumentType: string;
  referenceDocumentId: string;
  sort: string;
}

export function useNumberingAllocationListState(
  seriesId: string,
): NumberingAllocationListState & {
  update: (values: Record<string, string | number | null>) => void;
} {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('allocationPage')) || 1);
  const pageSizeValue =
    Number(params.get('allocationPageSize')) || DEFAULT_PAGE_SIZE;
  const pageSize = PAGE_SIZES.includes(pageSizeValue)
    ? pageSizeValue
    : DEFAULT_PAGE_SIZE;
  const referenceModule = params.get('referenceModule') ?? '';
  const referenceDocumentType = params.get('referenceDocumentType') ?? '';
  const referenceDocumentId = params.get('referenceDocumentId') ?? '';
  const sort = params.get('allocationSort') ?? 'number:asc';

  const update = (values: Record<string, string | number | null>) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(values)) {
        const paramKey =
          key === 'page'
            ? 'allocationPage'
            : key === 'pageSize'
              ? 'allocationPageSize'
              : key === 'sort'
                ? 'allocationSort'
                : key;
        if (
          value === null ||
          value === '' ||
          (paramKey === 'allocationPage' && value === 1) ||
          (paramKey === 'allocationSort' && value === 'number:asc')
        ) {
          next.delete(paramKey);
        } else {
          next.set(paramKey, String(value));
        }
      }
      // keep series id visible for deep-link; not part of allocation filters
      if (!next.get('seriesId')) {
        next.set('seriesId', seriesId);
      }
      return next;
    });
  };

  return {
    page,
    pageSize,
    referenceModule,
    referenceDocumentType,
    referenceDocumentId,
    sort,
    update,
  };
}

export function useNumberingSeries(
  organizationId: string | null,
  state: NumberingSeriesListState,
) {
  return useQuery<Paginated<NumberingSeries>, Error>({
    queryKey: queryKeys.documents.numberingSeries(organizationId ?? 'none', {
      ...state,
    }),
    queryFn: ({ signal }) => {
      if (organizationId === null) {
        throw new Error(
          'Numbering series list query requires an organization.',
        );
      }
      const isActiveParam =
        state.isActive === 'true'
          ? true
          : state.isActive === 'false'
            ? false
            : undefined;
      return listNumberingSeries(
        {
          organizationId,
          page: state.page,
          pageSize: state.pageSize,
          ...(state.documentType !== ''
            ? { documentType: state.documentType }
            : {}),
          ...(isActiveParam !== undefined ? { isActive: isActiveParam } : {}),
        },
        signal,
      );
    },
    enabled: organizationId !== null,
    staleTime: 30_000,
  });
}

export function useNumberingSeriesDetail(
  organizationId: string | null,
  seriesId: string | undefined,
) {
  return useQuery<NumberingSeries, Error>({
    queryKey: queryKeys.documents.numberingSeriesDetail(
      organizationId ?? 'none',
      seriesId ?? 'none',
    ),
    queryFn: ({ signal }) => {
      if (organizationId === null || seriesId === undefined) {
        throw new Error(
          'Numbering series detail query requires an organization and id.',
        );
      }
      return getNumberingSeries(organizationId, seriesId, signal);
    },
    enabled: organizationId !== null && seriesId !== undefined,
  });
}

export function useCreateNumberingSeriesMutation(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation<NumberingSeries, Error, CreateNumberingSeriesRequest>({
    mutationKey: ['documents', organizationId, 'numbering-series', 'create'],
    mutationFn: (body) => createNumberingSeries(body),
    onSuccess: (saved) => {
      queryClient.setQueryData(
        queryKeys.documents.numberingSeriesDetail(organizationId, saved.id),
        saved,
      );
      void queryClient
        .invalidateQueries({
          queryKey: queryKeys.documents.numberingSeriesPrefix(organizationId),
        })
        .then(
          () => undefined,
          () => undefined,
        );
    },
  });
}

export function useUpdateNumberingSeriesMutation(
  organizationId: string,
  seriesId: string,
) {
  const queryClient = useQueryClient();
  return useMutation<NumberingSeries, Error, UpdateNumberingSeriesRequest>({
    mutationKey: [
      'documents',
      organizationId,
      'numbering-series',
      'update',
      seriesId,
    ],
    mutationFn: (body) => updateNumberingSeries(organizationId, seriesId, body),
    onSuccess: (saved) => {
      queryClient.setQueryData(
        queryKeys.documents.numberingSeriesDetail(organizationId, seriesId),
        saved,
      );
      void queryClient
        .invalidateQueries({
          queryKey: queryKeys.documents.numberingSeriesPrefix(organizationId),
        })
        .then(
          () => undefined,
          () => undefined,
        );
    },
  });
}

export function useNumberingAllocations(
  organizationId: string | null,
  seriesId: string | undefined,
  state: NumberingAllocationListState,
) {
  return useQuery<Paginated<NumberingAllocation>, Error>({
    queryKey: queryKeys.documents.numberingAllocations(
      organizationId ?? 'none',
      seriesId ?? 'none',
      { ...state },
    ),
    queryFn: ({ signal }) => {
      if (organizationId === null || seriesId === undefined) {
        throw new Error(
          'Numbering allocations query requires an organization and seriesId.',
        );
      }
      return listNumberingAllocations(
        organizationId,
        seriesId,
        {
          organizationId,
          page: state.page,
          pageSize: state.pageSize,
          sort: state.sort,
          ...(state.referenceModule !== ''
            ? { referenceModule: state.referenceModule }
            : {}),
          ...(state.referenceDocumentType !== ''
            ? { referenceDocumentType: state.referenceDocumentType }
            : {}),
          ...(state.referenceDocumentId !== ''
            ? { referenceDocumentId: state.referenceDocumentId }
            : {}),
        },
        signal,
      );
    },
    enabled: organizationId !== null && seriesId !== undefined,
    staleTime: 30_000,
  });
}
