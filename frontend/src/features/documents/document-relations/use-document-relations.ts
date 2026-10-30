import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  createDocumentRelation,
  deleteDocumentRelation,
  getDocumentRelation,
  listDocumentRelations,
} from '@/api/documents.api';
import type {
  CreateDocumentRelationRequest,
  DocumentRelation,
  Paginated,
} from '@/api/contracts';
import { queryKeys } from '@/api/query-keys';

/**
 * Document relations (DOC-03).
 *
 * Backend contract (`DocumentRelationsController`) is the source of truth:
 * - `GET /documents/relations` — paged, organization-scoped, filterable by
 *   `relationKind`, `sourceModule`, `sourceDocumentType`, `sourceDocumentId`,
 *   `targetModule`, `targetDocumentType`, `targetDocumentId`, sortable only
 *   by `createdAt` (default `createdAt:desc`);
 * - `GET /documents/relations/:id`;
 * - `POST /documents/relations` — organizationId + source/target endpoints
 *   + relationKind (6 values) + quantity only for fulfill;
 * - `DELETE /documents/relations/:id` — hard delete, 200 returns the DTO.
 */

const PAGE_SIZES: readonly number[] = [25, 50, 100, 200];
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_SORT = 'createdAt:desc';

export interface DocumentRelationListState {
  page: number;
  pageSize: number;
  relationKind: string;
  sourceModule: string;
  sourceDocumentType: string;
  sourceDocumentId: string;
  targetModule: string;
  targetDocumentType: string;
  targetDocumentId: string;
  sort: string;
}

export function useDocumentRelationsListState(): DocumentRelationListState & {
  update: (values: Record<string, string | number | null>) => void;
} {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const pageSizeValue = Number(params.get('pageSize')) || DEFAULT_PAGE_SIZE;
  const pageSize = PAGE_SIZES.includes(pageSizeValue)
    ? pageSizeValue
    : DEFAULT_PAGE_SIZE;
  const relationKind = params.get('relationKind') ?? '';
  const sourceModule = params.get('sourceModule') ?? '';
  const sourceDocumentType = params.get('sourceDocumentType') ?? '';
  const sourceDocumentId = params.get('sourceDocumentId') ?? '';
  const targetModule = params.get('targetModule') ?? '';
  const targetDocumentType = params.get('targetDocumentType') ?? '';
  const targetDocumentId = params.get('targetDocumentId') ?? '';
  const sort = params.get('sort') ?? DEFAULT_SORT;

  const update = (values: Record<string, string | number | null>) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(values)) {
        if (
          value === null ||
          value === '' ||
          (key === 'page' && value === 1) ||
          (key === 'sort' && value === DEFAULT_SORT)
        ) {
          next.delete(key);
        } else {
          next.set(key, String(value));
        }
      }
      return next;
    });
  };

  return {
    page,
    pageSize,
    relationKind,
    sourceModule,
    sourceDocumentType,
    sourceDocumentId,
    targetModule,
    targetDocumentType,
    targetDocumentId,
    sort,
    update,
  };
}

export function useDocumentRelations(
  organizationId: string | null,
  state: DocumentRelationListState,
) {
  return useQuery<Paginated<DocumentRelation>, Error>({
    queryKey: queryKeys.documents.relations(organizationId ?? 'none', {
      ...state,
    }),
    queryFn: ({ signal }) => {
      if (organizationId === null) {
        throw new Error('Document relations list query requires an organization.');
      }
      return listDocumentRelations(
        {
          organizationId,
          page: state.page,
          pageSize: state.pageSize,
          sort: state.sort as DocumentRelationListState['sort'],
          ...(state.relationKind !== ''
            ? { relationKind: state.relationKind as DocumentRelationListState['relationKind'] }
            : {}),
          ...(state.sourceModule !== '' ? { sourceModule: state.sourceModule } : {}),
          ...(state.sourceDocumentType !== ''
            ? { sourceDocumentType: state.sourceDocumentType }
            : {}),
          ...(state.sourceDocumentId !== ''
            ? { sourceDocumentId: state.sourceDocumentId }
            : {}),
          ...(state.targetModule !== '' ? { targetModule: state.targetModule } : {}),
          ...(state.targetDocumentType !== ''
            ? { targetDocumentType: state.targetDocumentType }
            : {}),
          ...(state.targetDocumentId !== ''
            ? { targetDocumentId: state.targetDocumentId }
            : {}),
        } as Parameters<typeof listDocumentRelations>[0],
        signal,
      );
    },
    enabled: organizationId !== null,
    staleTime: 30_000,
  });
}

export function useDocumentRelation(
  organizationId: string | null,
  relationId: string | undefined,
) {
  return useQuery<DocumentRelation, Error>({
    queryKey: queryKeys.documents.relation(organizationId ?? 'none', relationId ?? 'none'),
    queryFn: ({ signal }) => {
      if (organizationId === null || relationId === undefined) {
        throw new Error('Document relation detail query requires an organization and id.');
      }
      return getDocumentRelation(organizationId, relationId, signal);
    },
    enabled: organizationId !== null && relationId !== undefined,
  });
}

export function useCreateDocumentRelationMutation(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation<DocumentRelation, Error, CreateDocumentRelationRequest>({
    mutationKey: ['documents', organizationId, 'document-relations', 'create'],
    mutationFn: (body) => createDocumentRelation(body),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.documents.relation(organizationId, saved.id), saved);
      void queryClient
        .invalidateQueries({
          queryKey: queryKeys.documents.relationsPrefix(organizationId),
        })
        .then(
          () => undefined,
          () => undefined,
        );
    },
  });
}

export function useDeleteDocumentRelationMutation(organizationId: string, relationId: string) {
  const queryClient = useQueryClient();
  return useMutation<DocumentRelation, Error, void>({
    mutationKey: ['documents', organizationId, 'document-relations', 'delete', relationId],
    mutationFn: () => deleteDocumentRelation(organizationId, relationId),
    onSuccess: () => {
      queryClient.removeQueries({
        queryKey: queryKeys.documents.relation(organizationId, relationId),
      });
      void queryClient
        .invalidateQueries({
          queryKey: queryKeys.documents.relationsPrefix(organizationId),
        })
        .then(
          () => undefined,
          () => undefined,
        );
    },
  });
}
