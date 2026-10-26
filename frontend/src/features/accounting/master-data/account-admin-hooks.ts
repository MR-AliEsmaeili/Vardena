import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  disableAccount,
  enableAccount,
  unlinkAccountDetailGroup,
  updateAccount,
} from '@/api/accounting.api';
import type { UpdateAccountRequest } from '@/api/contracts';
import { queryKeys } from '@/api/query-keys';

function useRefreshAccounts(organizationId: string) {
  const client = useQueryClient();
  return async () => {
    await Promise.all([
      client.invalidateQueries({
        queryKey: queryKeys.accounting.accountPrefix(organizationId),
      }),
      client.invalidateQueries({
        queryKey: queryKeys.accounting.chartTree(organizationId),
      }),
    ]);
  };
}

export function useUpdateAccountMutation(
  organizationId: string,
  accountId: string,
) {
  const refresh = useRefreshAccounts(organizationId);
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
  const refresh = useRefreshAccounts(organizationId);
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
