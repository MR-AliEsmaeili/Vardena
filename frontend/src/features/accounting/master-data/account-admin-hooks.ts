import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createAccount,
  disableAccount,
  enableAccount,
  getActiveDetailStructure,
  listDetailGroups,
  unlinkAccountDetailGroup,
  updateAccount,
} from '@/api/accounting.api';
import type {
  CreateAccountRequest,
  UpdateAccountRequest,
} from '@/api/contracts';
import { queryKeys } from '@/api/query-keys';

function useRefreshAccounts(organizationId: string, accountId?: string) {
  const client = useQueryClient();
  return async () => {
    const invalidations = [
      client.invalidateQueries({
        queryKey: queryKeys.accounting.accountPrefix(organizationId),
      }),
      client.invalidateQueries({
        queryKey: queryKeys.accounting.chartTree(organizationId),
      }),
    ];
    if (accountId !== undefined) {
      invalidations.push(
        client.invalidateQueries({
          queryKey: queryKeys.accounting.accountDetail(
            organizationId,
            accountId,
          ),
        }),
      );
    }
    await Promise.all(invalidations);
  };
}

export function useCreateAccountMutation(organizationId: string) {
  const refresh = useRefreshAccounts(organizationId);
  return useMutation({
    mutationFn: (body: CreateAccountRequest) => createAccount(body),
    onSuccess: refresh,
  });
}

/** Read only level-1 details from the currently active detail structure. */
export function useAccountDetailGroupCandidates(
  organizationId: string | null,
  search: string,
  enabled: boolean,
) {
  const activeStructure = useQuery({
    queryKey: queryKeys.accounting.detailStructureActive(
      organizationId ?? 'none',
    ),
    queryFn: ({ signal }) =>
      getActiveDetailStructure(organizationId as string, signal),
    enabled: organizationId !== null && enabled,
    staleTime: 5 * 60_000,
  });
  const structureVersionId = activeStructure.data?.id ?? null;
  const groups = useQuery({
    queryKey: queryKeys.accounting.detailGroupList(
      organizationId ?? 'none',
      search,
      structureVersionId,
    ),
    queryFn: ({ signal }) =>
      listDetailGroups(
        {
          organizationId: organizationId as string,
          page: 1,
          pageSize: 50,
          isActive: true,
          ...(structureVersionId !== null
            ? { detailStructureVersionId: structureVersionId }
            : {}),
          ...(search.trim() ? { search: search.trim() } : {}),
          sort: 'code:asc',
        },
        signal,
      ),
    enabled:
      organizationId !== null &&
      enabled &&
      activeStructure.isSuccess &&
      structureVersionId !== null,
    staleTime: 30_000,
  });
  return { activeStructure, groups };
}

export function useUpdateAccountMutation(
  organizationId: string,
  accountId: string,
) {
  const refresh = useRefreshAccounts(organizationId, accountId);
  return useMutation({
    mutationFn: (body: UpdateAccountRequest) =>
      updateAccount(organizationId, accountId, body),
    onSuccess: refresh,
  });
}

export function useAccountLifecycleMutation(
  organizationId: string,
  accountId: string,
) {
  const refresh = useRefreshAccounts(organizationId, accountId);
  return useMutation({
    mutationFn: (action: 'enable' | 'disable') =>
      action === 'enable'
        ? enableAccount(organizationId, accountId)
        : disableAccount(organizationId, accountId),
    onSuccess: refresh,
  });
}

export function useUnlinkAccountDetailGroupMutation(
  organizationId: string,
  accountId: string,
) {
  const refresh = useRefreshAccounts(organizationId);
  return useMutation({
    mutationFn: () =>
      unlinkAccountDetailGroup(organizationId, accountId, {
        confirmUnlink: true,
      }),
    onSuccess: refresh,
  });
}
