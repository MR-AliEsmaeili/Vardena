import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import type {
  CancelInventoryDocumentInput,
  CreateInventoryDocumentInput,
  FinalizeInventoryDocumentInput,
  InventoryDocument,
  UpdateInventoryDocumentInput,
} from '@/api/contracts';
import {
  accountingPostInventoryDocument,
  cancelInventoryDocument,
  createInventoryDocument,
  deleteInventoryDocument,
  finalizeInventoryDocument,
  sealInventoryDocument,
  updateInventoryDocument,
} from '@/api/inventory.api';
import { queryKeys } from '@/api/query-keys';

/**
 * Business-document commands.
 *
 * Contract rules (standards.md §6), identical to the movement mutations:
 * - **No optimistic updates.** A document's lifecycle state and its ledger
 *   effect are financial facts; the UI shows only what the backend confirmed.
 * - **No auto-retry.** Finalize/cancel post and reverse real stock; a retry
 *   is always a deliberate human act.
 * - **Targeted invalidation.** A lifecycle command touches the documents of
 *   THIS organization AND the ledger reads it moved (movements, balances,
 *   Kardex, valuation states) — and nothing else.
 */

function useDocumentInvalidation(organizationId: string) {
  const queryClient = useQueryClient();
  return (documentId?: string) => {
    const prefixes: readonly unknown[][] = [
      [...queryKeys.inventory.documentsPrefix(organizationId)],
      [...queryKeys.inventory.movementsPrefix(organizationId)],
      [...queryKeys.inventory.balancesPrefix(organizationId)],
      [...queryKeys.inventory.kardexPrefix(organizationId)],
      [...queryKeys.inventory.valuationStatesPrefix(organizationId)],
    ];
    void Promise.all(
      prefixes.map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }).then(
          () => undefined,
          () => undefined,
        ),
      ),
    );
    if (documentId !== undefined) {
      queryClient.removeQueries({
        queryKey: queryKeys.inventory.document(organizationId, documentId),
        exact: true,
      });
    }
  };
}

/** Write the authoritative server response straight into the detail cache. */
function useDocumentCacheWriter(organizationId: string) {
  const queryClient = useQueryClient();
  return (document: InventoryDocument) => {
    queryClient.setQueryData(
      queryKeys.inventory.document(organizationId, document.id),
      document,
    );
  };
}

export function useCreateDocumentMutation(
  organizationId: string,
): UseMutationResult<
  InventoryDocument,
  Error,
  Omit<CreateInventoryDocumentInput, 'organizationId'>
> {
  const invalidate = useDocumentInvalidation(organizationId);
  const writeCache = useDocumentCacheWriter(organizationId);
  return useMutation({
    mutationKey: ['inventory', organizationId, 'documents', 'create'],
    mutationFn: (
      values: Omit<CreateInventoryDocumentInput, 'organizationId'>,
    ) => createInventoryDocument({ organizationId, ...values }),
    onSuccess: (document) => {
      writeCache(document);
      invalidate();
    },
  });
}

export interface UpdateDocumentVariables {
  documentId: string;
  values: UpdateInventoryDocumentInput;
}

export function useUpdateDocumentMutation(
  organizationId: string,
): UseMutationResult<InventoryDocument, Error, UpdateDocumentVariables> {
  const invalidate = useDocumentInvalidation(organizationId);
  const writeCache = useDocumentCacheWriter(organizationId);
  return useMutation({
    mutationKey: ['inventory', organizationId, 'documents', 'update'],
    mutationFn: ({ documentId, values }: UpdateDocumentVariables) =>
      updateInventoryDocument(documentId, organizationId, values),
    onSuccess: (document) => {
      writeCache(document);
      invalidate();
    },
  });
}

export function useDeleteDocumentMutation(
  organizationId: string,
): UseMutationResult<void, Error, string> {
  const invalidate = useDocumentInvalidation(organizationId);
  return useMutation({
    mutationKey: ['inventory', organizationId, 'documents', 'delete'],
    mutationFn: (documentId: string) =>
      deleteInventoryDocument(documentId, organizationId),
    onSuccess: (_result, documentId) => invalidate(documentId),
  });
}

export interface FinalizeDocumentVariables {
  documentId: string;
  values?: FinalizeInventoryDocumentInput;
}

/** Allocates the number and posts the ledger effect, in one transaction. */
export function useFinalizeDocumentMutation(
  organizationId: string,
): UseMutationResult<InventoryDocument, Error, FinalizeDocumentVariables> {
  const invalidate = useDocumentInvalidation(organizationId);
  const writeCache = useDocumentCacheWriter(organizationId);
  return useMutation({
    mutationKey: ['inventory', organizationId, 'documents', 'finalize'],
    mutationFn: ({ documentId, values }: FinalizeDocumentVariables) =>
      finalizeInventoryDocument(documentId, organizationId, values ?? {}),
    onSuccess: (document) => {
      writeCache(document);
      invalidate();
    },
  });
}

export function useAccountingPostDocumentMutation(
  organizationId: string,
): UseMutationResult<InventoryDocument, Error, string> {
  const invalidate = useDocumentInvalidation(organizationId);
  const writeCache = useDocumentCacheWriter(organizationId);
  return useMutation({
    mutationKey: ['inventory', organizationId, 'documents', 'accountingPost'],
    mutationFn: (documentId: string) =>
      accountingPostInventoryDocument(documentId, organizationId),
    onSuccess: (document) => {
      writeCache(document);
      invalidate();
    },
  });
}

export function useSealDocumentMutation(
  organizationId: string,
): UseMutationResult<InventoryDocument, Error, string> {
  const invalidate = useDocumentInvalidation(organizationId);
  const writeCache = useDocumentCacheWriter(organizationId);
  return useMutation({
    mutationKey: ['inventory', organizationId, 'documents', 'seal'],
    mutationFn: (documentId: string) =>
      sealInventoryDocument(documentId, organizationId),
    onSuccess: (document) => {
      writeCache(document);
      invalidate();
    },
  });
}

export interface CancelDocumentVariables {
  documentId: string;
  values: CancelInventoryDocumentInput;
}

/** Reverses the posted effect; the document and its number survive. */
export function useCancelDocumentMutation(
  organizationId: string,
): UseMutationResult<InventoryDocument, Error, CancelDocumentVariables> {
  const invalidate = useDocumentInvalidation(organizationId);
  const writeCache = useDocumentCacheWriter(organizationId);
  return useMutation({
    mutationKey: ['inventory', organizationId, 'documents', 'cancel'],
    mutationFn: ({ documentId, values }: CancelDocumentVariables) =>
      cancelInventoryDocument(documentId, organizationId, values),
    onSuccess: (document) => {
      writeCache(document);
      invalidate();
    },
  });
}
