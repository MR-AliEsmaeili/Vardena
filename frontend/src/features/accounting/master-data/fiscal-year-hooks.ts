import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getFiscalYear,
  transitionFiscalYear,
  updateFiscalYear,
  type FiscalYearTransitionAction,
} from '@/api/accounting.api';
import type {
  FiscalYear,
  TransitionFiscalYearRequest,
  UpdateFiscalYearRequest,
} from '@/api/contracts';
import { queryKeys } from '@/api/query-keys';

export function useFiscalYearDetail(
  organizationId: string | null,
  fiscalYearId: string | undefined,
) {
  return useQuery({
    queryKey: queryKeys.accounting.fiscalYearDetail(
      organizationId ?? 'none',
      fiscalYearId ?? 'none',
    ),
    queryFn: ({ signal }) => {
      if (organizationId === null || fiscalYearId === undefined) {
        throw new Error(
          'Fiscal-year detail query requires an organization and id.',
        );
      }
      return getFiscalYear(organizationId, fiscalYearId, signal);
    },
    enabled: organizationId !== null && fiscalYearId !== undefined,
  });
}

function useFiscalYearInvalidation(organizationId: string) {
  const queryClient = useQueryClient();
  return () => {
    const keys: readonly (readonly unknown[])[] = [
      queryKeys.accounting.fiscalYearPrefix(organizationId),
      queryKeys.accounting.accountingPeriodsPrefix(organizationId),
      queryKeys.accounting.financialContextFiscalYearsPrefix(organizationId),
    ];
    for (const queryKey of keys) {
      void queryClient.invalidateQueries({ queryKey }).then(
        () => undefined,
        () => undefined,
      );
    }
  };
}

function updateFiscalYearCache(
  queryClient: ReturnType<typeof useQueryClient>,
  organizationId: string,
  fiscalYear: FiscalYear,
) {
  queryClient.setQueryData(
    queryKeys.accounting.fiscalYearDetail(organizationId, fiscalYear.id),
    fiscalYear,
  );
}

export function useUpdateFiscalYearMutation(
  organizationId: string,
  fiscalYearId: string,
) {
  const queryClient = useQueryClient();
  const invalidate = useFiscalYearInvalidation(organizationId);
  return useMutation<FiscalYear, Error, UpdateFiscalYearRequest>({
    mutationKey: [
      'accounting',
      organizationId,
      'fiscal-years',
      'update',
      fiscalYearId,
    ],
    mutationFn: (body) => updateFiscalYear(organizationId, fiscalYearId, body),
    onSuccess: (year) => {
      updateFiscalYearCache(queryClient, organizationId, year);
      invalidate();
    },
  });
}

export interface FiscalYearTransitionVariables {
  id: string;
  action: FiscalYearTransitionAction;
  reason: string;
}

export function useFiscalYearTransitionMutation(organizationId: string) {
  const queryClient = useQueryClient();
  const invalidate = useFiscalYearInvalidation(organizationId);
  return useMutation<FiscalYear, Error, FiscalYearTransitionVariables>({
    mutationKey: ['accounting', organizationId, 'fiscal-years', 'transition'],
    mutationFn: ({ id, action, reason }) => {
      const body: TransitionFiscalYearRequest = { reason };
      return transitionFiscalYear(organizationId, id, action, body);
    },
    onSuccess: (year) => {
      updateFiscalYearCache(queryClient, organizationId, year);
      invalidate();
    },
  });
}
