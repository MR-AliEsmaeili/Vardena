import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import type { AccountingDocument } from '@/api/contracts';
import { toBusinessDateInput } from '@/lib/datetime';
import {
  createAccountingDocument,
  deleteAccountingDocument,
  finalizeAccountingDocument,
  issueAccountingDocument,
  reverseAccountingDocument,
  toDocumentLineInputs,
  updateAccountingDocument,
} from '@/api/accounting.api';
import { queryKeys } from '@/api/query-keys';
import type {
  CreateAccountingDocumentInput,
  DocumentTransitionInput,
  ReverseAccountingDocumentInput,
  UpdateAccountingDocumentInput,
} from '@/api/contracts';
import type { DocumentFormValues } from './document-form-schema';

/**
 * Document lifecycle mutations (FE-UX-08).
 *
 * Contract rules implemented here:
 * - **No optimistic updates.** These are financial operations (issuance,
 *   finalization, reversal, discard); the UI only reflects what the backend
 *   confirmed (standards.md §6).
 * - **No auto-retry.** The query client already refuses mutation retries; a
 *   manual retry reuses the same `operationKey` so the backend replays the
 *   stored operation instead of applying it twice (§16.4, AC-I-12).
 * - **Targeted invalidation.** A mutation refreshes the documents prefix
 *   (list + affected detail caches) and — for the ledger-posting operations
 *   (finalize, reverse) — the ledger-derived reads. Nothing else is evicted.
 * - **Organization scope.** Every key and every request carries the
 *   organization id, so a switch can never serve another organization's
 *   documents from this cache.
 */

/** A fresh client idempotency key for one operation intent (§16.4). */
export function newOperationKey(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Refresh every documents list AND detail cache of this organization. */
function useDocumentsPrefixInvalidation(organizationId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient
      .invalidateQueries({
        queryKey:
          queryKeys.accounting.accountingDocumentsPrefix(organizationId),
      })
      .then(
        () => undefined,
        () => undefined,
      );
  };
}

/**
 * Finalize and reverse POST to the ledger, so every ledger-derived read
 * (general ledger, trial balance, account statement, balance projection)
 * is stale afterwards and must be refetched on next use.
 */
function useLedgerReadsInvalidation(organizationId: string) {
  const queryClient = useQueryClient();
  return () => {
    const prefixes = [
      queryKeys.accounting.generalLedgerPrefix(organizationId),
      queryKeys.accounting.trialBalancePrefix(organizationId),
      queryKeys.accounting.accountStatementPrefix(organizationId),
      queryKeys.accounting.accountBalancesPrefix(organizationId),
    ];
    void Promise.all(
      prefixes.map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }).then(
          () => undefined,
          () => undefined,
        ),
      ),
    );
  };
}

/** Write the server's response into the detail cache (exact, not optimistic). */
function useDetailCacheUpdate(organizationId: string) {
  const queryClient = useQueryClient();
  return (document: AccountingDocument) => {
    queryClient.setQueryData(
      queryKeys.accounting.accountingDocumentDetail(
        organizationId,
        document.id,
      ),
      document,
    );
  };
}

export interface CreateDocumentVariables {
  values: DocumentFormValues;
  operationKey: string;
}

export function useCreateDocumentMutation(
  organizationId: string,
): UseMutationResult<AccountingDocument, Error, CreateDocumentVariables> {
  const invalidateDocuments = useDocumentsPrefixInvalidation(organizationId);
  return useMutation({
    mutationKey: [
      'accounting',
      organizationId,
      'accounting-documents',
      'create',
    ],
    mutationFn: ({ values, operationKey }: CreateDocumentVariables) => {
      const body: CreateAccountingDocumentInput = {
        organizationId,
        financialAreaId: values.financialAreaId,
        documentDate: toBusinessDateInput(values.documentDate),
        description: values.description.trim(),
        lines: toDocumentLineInputs(values.lines),
        operationKey,
      };
      return createAccountingDocument(body);
    },
    onSuccess: () => invalidateDocuments(),
  });
}

export interface UpdateDocumentVariables {
  documentId: string;
  values: DocumentFormValues;
}

export function useUpdateDocumentMutation(
  organizationId: string,
): UseMutationResult<AccountingDocument, Error, UpdateDocumentVariables> {
  const invalidateDocuments = useDocumentsPrefixInvalidation(organizationId);
  const cacheDetail = useDetailCacheUpdate(organizationId);
  return useMutation({
    mutationKey: [
      'accounting',
      organizationId,
      'accounting-documents',
      'update',
    ],
    mutationFn: ({ documentId, values }: UpdateDocumentVariables) => {
      // An edit is a state-carrying PUT: no operationKey, and the fields the
      // form does not own (branch) are simply not sent — omitted = kept.
      const body: UpdateAccountingDocumentInput = {
        documentDate: toBusinessDateInput(values.documentDate),
        description: values.description.trim(),
        financialAreaId: values.financialAreaId,
        lines: toDocumentLineInputs(values.lines),
      };
      return updateAccountingDocument(organizationId, documentId, body);
    },
    onSuccess: (document) => {
      cacheDetail(document);
      invalidateDocuments();
    },
  });
}

export interface TransitionVariables {
  documentId: string;
  operationKey: string;
}

export function useIssueDocumentMutation(
  organizationId: string,
): UseMutationResult<AccountingDocument, Error, TransitionVariables> {
  const invalidateDocuments = useDocumentsPrefixInvalidation(organizationId);
  const cacheDetail = useDetailCacheUpdate(organizationId);
  return useMutation({
    mutationKey: [
      'accounting',
      organizationId,
      'accounting-documents',
      'issue',
    ],
    mutationFn: ({ documentId, operationKey }: TransitionVariables) => {
      const body: DocumentTransitionInput = { operationKey };
      return issueAccountingDocument(organizationId, documentId, body);
    },
    onSuccess: (document) => {
      cacheDetail(document);
      invalidateDocuments();
    },
  });
}

export function useFinalizeDocumentMutation(
  organizationId: string,
): UseMutationResult<AccountingDocument, Error, TransitionVariables> {
  const invalidateDocuments = useDocumentsPrefixInvalidation(organizationId);
  const cacheDetail = useDetailCacheUpdate(organizationId);
  const invalidateLedgerReads = useLedgerReadsInvalidation(organizationId);
  return useMutation({
    mutationKey: [
      'accounting',
      organizationId,
      'accounting-documents',
      'finalize',
    ],
    mutationFn: ({ documentId, operationKey }: TransitionVariables) => {
      const body: DocumentTransitionInput = { operationKey };
      return finalizeAccountingDocument(organizationId, documentId, body);
    },
    onSuccess: (document) => {
      cacheDetail(document);
      invalidateDocuments();
      invalidateLedgerReads();
    },
  });
}

export interface ReverseDocumentVariables {
  documentId: string;
  reason: string;
  operationKey: string;
}

export function useReverseDocumentMutation(
  organizationId: string,
): UseMutationResult<AccountingDocument, Error, ReverseDocumentVariables> {
  const invalidateDocuments = useDocumentsPrefixInvalidation(organizationId);
  const cacheDetail = useDetailCacheUpdate(organizationId);
  const invalidateLedgerReads = useLedgerReadsInvalidation(organizationId);
  return useMutation({
    mutationKey: [
      'accounting',
      organizationId,
      'accounting-documents',
      'reverse',
    ],
    mutationFn: ({
      documentId,
      reason,
      operationKey,
    }: ReverseDocumentVariables) => {
      const body: ReverseAccountingDocumentInput = {
        operationKey,
        reason,
      };
      return reverseAccountingDocument(organizationId, documentId, body);
    },
    onSuccess: (reversal) => {
      // The reversal itself is cached from the response; the ORIGINAL
      // document changed too (its `reversedByDocumentId` is now set), so the
      // whole documents prefix — lists and details — is refreshed.
      cacheDetail(reversal);
      invalidateDocuments();
      invalidateLedgerReads();
    },
  });
}

export interface DeleteDocumentVariables {
  documentId: string;
}

export function useDeleteDocumentMutation(
  organizationId: string,
): UseMutationResult<AccountingDocument, Error, DeleteDocumentVariables> {
  const invalidateDocuments = useDocumentsPrefixInvalidation(organizationId);
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: [
      'accounting',
      organizationId,
      'accounting-documents',
      'delete',
    ],
    mutationFn: ({ documentId }: DeleteDocumentVariables) =>
      deleteAccountingDocument(organizationId, documentId),
    onSuccess: (deleted) => {
      // The document is gone: drop its detail cache instead of caching a
      // deleted aggregate, then refresh the lists.
      queryClient.removeQueries({
        queryKey: queryKeys.accounting.accountingDocumentDetail(
          organizationId,
          deleted.id,
        ),
      });
      invalidateDocuments();
    },
  });
}
