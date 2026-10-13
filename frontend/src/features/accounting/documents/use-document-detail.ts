import { useQuery } from '@tanstack/react-query';
import {
  getAccountingDocument,
  getDetailRecord,
  listPostableDetails,
} from '@/api/accounting.api';
import { getAccount } from '@/api/accounting.api';
import { getBranch } from '@/api/organization.api';
import { queryKeys } from '@/api/query-keys';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { useDebouncedValue } from '@/lib/use-debounced-value';

/**
 * Reference reads behind the document surfaces. Each is a real,
 * permission-gated endpoint; a read the session may not perform resolves to
 * an honest fallback in the UI — never a guessed name.
 */

/** One accounting document with its lines. */
export function useDocumentDetail(
  organizationId: string | null,
  documentId: string | undefined,
) {
  return useQuery({
    queryKey: queryKeys.accounting.accountingDocumentDetail(
      organizationId ?? 'none',
      documentId ?? 'none',
    ),
    queryFn: ({ signal }) =>
      getAccountingDocument(
        organizationId as string,
        documentId as string,
        signal,
      ),
    enabled: organizationId !== null && documentId !== undefined,
  });
}

/**
 * A document line's account (code + title). The same cache the compose form's
 * pickers fill, so a line's account is fetched once per organization.
 */
export function useAccountReference(
  organizationId: string | null,
  accountId: string | undefined,
) {
  return useQuery({
    queryKey: queryKeys.accounting.accountDetail(
      organizationId ?? 'none',
      accountId ?? 'none',
    ),
    queryFn: ({ signal }) =>
      getAccount(organizationId as string, accountId as string, signal),
    enabled: organizationId !== null && accountId !== undefined,
    staleTime: 5 * 60_000,
  });
}

/** A document line's detail record (`GET /details/:id`). */
export function useDetailRecordReference(
  organizationId: string | null,
  detailId: string | undefined,
) {
  const permissions = usePermissions();
  return useQuery({
    queryKey: queryKeys.accounting.detailRecord(
      organizationId ?? 'none',
      detailId ?? 'none',
    ),
    queryFn: ({ signal }) =>
      getDetailRecord(organizationId as string, detailId as string, signal),
    enabled:
      organizationId !== null &&
      detailId !== undefined &&
      permissions.loaded &&
      permissions.has(PERMISSIONS.accounting.detailView),
    staleTime: 5 * 60_000,
  });
}

/** Postable detail options for a line's detail picker (server-filtered). */
export function usePostableDetailOptions(
  organizationId: string | null,
  search: string,
) {
  const permissions = usePermissions();
  const trimmed = search.trim();
  const debounced = useDebouncedValue(trimmed, 300);
  return useQuery({
    queryKey: queryKeys.accounting.postableDetails(
      organizationId ?? 'none',
      debounced,
    ),
    queryFn: ({ signal }) =>
      listPostableDetails(
        {
          organizationId: organizationId as string,
          search: debounced === '' ? undefined : debounced,
        },
        signal,
      ),
    enabled:
      organizationId !== null &&
      permissions.loaded &&
      permissions.has(PERMISSIONS.accounting.detailView),
    staleTime: 60_000,
  });
}

/** The branch reference of a document header (`GET /branches/:id`). */
export function useBranchReference(
  organizationId: string | null,
  branchId: string | null | undefined,
) {
  const permissions = usePermissions();
  return useQuery({
    queryKey: queryKeys.organizations.branchDetail(
      organizationId ?? 'none',
      branchId ?? 'none',
    ),
    queryFn: ({ signal }) =>
      getBranch(organizationId as string, branchId as string, signal),
    enabled:
      organizationId !== null &&
      branchId !== null &&
      branchId !== undefined &&
      permissions.loaded &&
      permissions.has(PERMISSIONS.organization.branchView),
    staleTime: 5 * 60_000,
  });
}
