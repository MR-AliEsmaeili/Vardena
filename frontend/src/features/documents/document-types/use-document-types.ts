import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  configureDocumentType,
  getDocumentType,
  listDocumentTypes,
} from '@/api/documents.api';
import type {
  ConfigureDocumentTypeRequest,
  DocumentType,
} from '@/api/contracts';
import { queryKeys } from '@/api/query-keys';

/**
 * Document-type reads and the ONE configuration write (DOC-01).
 *
 * Backend contract (`DocumentTypesController`) is the source of truth:
 * - `GET /documents/types` — paged registry, organization-scoped;
 * - `GET /documents/types/:code` — one registry entry + org configuration;
 * - `PUT /documents/types/:code/configuration` — idempotent upsert of the
 *   single writable field `draftRequired`.
 *
 * A configuration change alters BOTH the detail row and the list columns
 * (`draftRequired`/`configured`), so the mutation invalidates the shared
 * `document-types` prefix — one prefix covering the list and the detail key —
 * instead of patching one cached view and leaving the other stale.
 */

/** Page sizes the shared Pagination pattern offers. */
const PAGE_SIZES: readonly number[] = [25, 50, 100, 200];
const DEFAULT_PAGE_SIZE = 50;

export interface DocumentTypeListState {
  page: number;
  pageSize: number;
  search: string;
}

/**
 * List state lives in the URL (standards.md §5), never in component state:
 * a filtered, paged registry is a linkable report surface.
 */
export function useDocumentTypeListState() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const pageSizeValue = Number(params.get('pageSize')) || DEFAULT_PAGE_SIZE;
  const pageSize = PAGE_SIZES.includes(pageSizeValue)
    ? pageSizeValue
    : DEFAULT_PAGE_SIZE;
  const search = params.get('search') ?? '';

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

  return { page, pageSize, search, update };
}

export function useDocumentTypes(
  organizationId: string | null,
  state: DocumentTypeListState,
) {
  return useQuery({
    queryKey: queryKeys.documents.documentTypes(organizationId ?? 'none', {
      ...state,
    }),
    queryFn: ({ signal }) => {
      if (organizationId === null) {
        throw new Error('Document type list query requires an organization.');
      }
      return listDocumentTypes(
        {
          organizationId,
          page: state.page,
          pageSize: state.pageSize,
          ...(state.search !== '' ? { search: state.search } : {}),
        },
        signal,
      );
    },
    enabled: organizationId !== null,
    staleTime: 30_000,
  });
}

export function useDocumentType(
  organizationId: string | null,
  code: string | undefined,
) {
  return useQuery({
    queryKey: queryKeys.documents.documentType(
      organizationId ?? 'none',
      code ?? 'none',
    ),
    queryFn: ({ signal }) => {
      if (organizationId === null || code === undefined) {
        throw new Error(
          'Document type detail query requires an organization and code.',
        );
      }
      return getDocumentType(organizationId, code, signal);
    },
    enabled: organizationId !== null && code !== undefined,
  });
}

export function useConfigureDocumentTypeMutation(
  organizationId: string,
  code: string,
) {
  const queryClient = useQueryClient();
  return useMutation<DocumentType, Error, ConfigureDocumentTypeRequest>({
    mutationKey: [
      'documents',
      organizationId,
      'document-types',
      'configure',
      code,
    ],
    mutationFn: (body) => configureDocumentType(organizationId, code, body),
    onSuccess: (saved) => {
      // Show the server's merged view immediately; the prefix invalidation
      // below then re-reads both surfaces from the authoritative source.
      queryClient.setQueryData(
        queryKeys.documents.documentType(organizationId, code),
        saved,
      );
      void queryClient
        .invalidateQueries({
          queryKey: queryKeys.documents.documentTypesPrefix(organizationId),
        })
        .then(
          () => undefined,
          () => undefined,
        );
    },
  });
}
