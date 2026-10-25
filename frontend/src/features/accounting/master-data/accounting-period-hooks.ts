import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createAccountingPeriod,
  getAccountingPeriod,
  transitionAccountingPeriod,
  type AccountingPeriodAction,
} from '@/api/accounting.api';
import type {
  AccountingPeriod,
  CreateAccountingPeriodRequest,
  TransitionAccountingPeriodRequest,
} from '@/api/contracts';
import { queryKeys } from '@/api/query-keys';

export function useAccountingPeriodDetail(
  organizationId: string | null,
  periodId: string | undefined,
) {
  return useQuery({
    queryKey: queryKeys.accounting.accountingPeriodDetail(
      organizationId ?? 'none',
      periodId ?? 'none',
    ),
    queryFn: ({ signal }) =>
      getAccountingPeriod(organizationId as string, periodId as string, signal),
    enabled: organizationId !== null && periodId !== undefined,
  });
}

function useRefreshPeriods(organizationId: string) {
  const client = useQueryClient();
  return (period: AccountingPeriod) => {
    client.setQueryData(
      queryKeys.accounting.accountingPeriodDetail(organizationId, period.id),
      period,
    );
    // Includes reference queries, paginated lists and financial context.
    void client.invalidateQueries({
      queryKey: queryKeys.accounting.accountingPeriodsPrefix(organizationId),
    });
    void client.invalidateQueries({
      queryKey: queryKeys.accounting.all(organizationId),
    });
  };
}

export function useCreateAccountingPeriodMutation(organizationId: string) {
  const refresh = useRefreshPeriods(organizationId);
  return useMutation({
    mutationFn: (body: Omit<CreateAccountingPeriodRequest, 'organizationId'>) =>
      createAccountingPeriod({ organizationId, ...body }),
    onSuccess: refresh,
  });
}

export function useAccountingPeriodTransitionMutation(organizationId: string) {
  const refresh = useRefreshPeriods(organizationId);
  return useMutation({
    mutationFn: ({
      periodId,
      action,
      body,
    }: {
      periodId: string;
      action: AccountingPeriodAction;
      body: TransitionAccountingPeriodRequest;
    }) => transitionAccountingPeriod(organizationId, periodId, action, body),
    onSuccess: refresh,
  });
}
