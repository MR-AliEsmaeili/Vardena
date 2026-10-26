import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createAccountingConfiguration,
  deleteAccountingConfiguration,
  getAccountingConfiguration,
  listAccountingConfigurations,
  publishAccountingConfiguration,
  updateAccountingConfiguration,
} from '@/api/accounting.api';
import type {
  AccountingConfiguration,
  AccountingConfigurationListQuery,
  CreateAccountingConfigurationRequest,
  UpdateAccountingConfigurationRequest,
} from '@/api/contracts';
import { queryKeys } from '@/api/query-keys';

/**
 * Accounting-configuration queries and mutations (ACC-06).
 *
 * The ACTIVE version defines the account-code shape the backend validates
 * new accounts against, so every mutation invalidates BOTH the whole
 * `accounting-configurations` namespace and the `active` key — a published
 * version changes the structure other screens derive from.
 *
 * `useActiveAccountingConfiguration` is NOT redefined here: ACC-04 already
 * owns it (`master-data/master-data-hooks.ts`) under the same
 * `accountingConfigurationActive` key, and two definitions of one server fact
 * would be two truths. It is re-exported so this feature has one import.
 */
export { useActiveAccountingConfiguration } from '../master-data/master-data-hooks';

/** The three statuses of `ACCOUNTING_CONFIGURATION_STATUSES`. */
export const CONFIGURATION_STATUSES = [
  'DRAFT',
  'ACTIVE',
  'SUPERSEDED',
] as const;
export type ConfigurationStatus = (typeof CONFIGURATION_STATUSES)[number];

export function isConfigurationStatus(
  value: string,
): value is ConfigurationStatus {
  return (CONFIGURATION_STATUSES as readonly string[]).includes(value);
}

/** URL-owned list state (page/pageSize/search/status), mirrored by the page. */
export interface ConfigurationListState {
  page: number;
  pageSize: number;
  search: string;
  status: string;
}

export function useAccountingConfigurationsList(
  organizationId: string | null,
  state: ConfigurationListState,
) {
  const query: AccountingConfigurationListQuery = {
    organizationId: organizationId as string,
    page: state.page,
    pageSize: state.pageSize,
    sort: 'code:asc,versionNumber:desc',
    ...(state.search !== '' ? { search: state.search } : {}),
    ...(isConfigurationStatus(state.status) ? { status: state.status } : {}),
  };
  return useQuery({
    queryKey: queryKeys.accounting.accountingConfigurationList(
      organizationId ?? 'none',
      { ...state },
    ),
    queryFn: ({ signal }) =>
      listAccountingConfigurations(
        query as AccountingConfigurationListQuery,
        signal,
      ),
    enabled: organizationId !== null,
    staleTime: 30_000,
  });
}

export function useAccountingConfigurationDetail(
  organizationId: string | null,
  configurationId: string | undefined,
) {
  return useQuery({
    queryKey: queryKeys.accounting.accountingConfigurationDetail(
      organizationId ?? 'none',
      configurationId ?? 'none',
    ),
    queryFn: ({ signal }) => {
      if (organizationId === null || configurationId === undefined) {
        throw new Error(
          'Accounting-configuration detail query requires an organization and id.',
        );
      }
      return getAccountingConfiguration(
        organizationId,
        configurationId,
        signal,
      );
    },
    enabled: organizationId !== null && configurationId !== undefined,
  });
}

function useConfigurationInvalidation(organizationId: string) {
  const queryClient = useQueryClient();
  return () => {
    const keys: readonly (readonly unknown[])[] = [
      queryKeys.accounting.accountingConfigurationPrefix(organizationId),
      queryKeys.accounting.accountingConfigurationActive(organizationId),
    ];
    for (const queryKey of keys) {
      void queryClient.invalidateQueries({ queryKey }).then(
        () => undefined,
        () => undefined,
      );
    }
  };
}

function cacheDetail(
  queryClient: ReturnType<typeof useQueryClient>,
  organizationId: string,
  configuration: AccountingConfiguration,
) {
  queryClient.setQueryData(
    queryKeys.accounting.accountingConfigurationDetail(
      organizationId,
      configuration.id,
    ),
    configuration,
  );
}

export function useCreateAccountingConfigurationMutation(
  organizationId: string,
) {
  const queryClient = useQueryClient();
  const invalidate = useConfigurationInvalidation(organizationId);
  return useMutation<
    AccountingConfiguration,
    Error,
    CreateAccountingConfigurationRequest
  >({
    mutationKey: [
      'accounting',
      organizationId,
      'accounting-configurations',
      'create',
    ],
    mutationFn: (body) => createAccountingConfiguration(body),
    onSuccess: (configuration) => {
      cacheDetail(queryClient, organizationId, configuration);
      invalidate();
    },
  });
}

export function useUpdateAccountingConfigurationMutation(
  organizationId: string,
  configurationId: string,
) {
  const queryClient = useQueryClient();
  const invalidate = useConfigurationInvalidation(organizationId);
  return useMutation<
    AccountingConfiguration,
    Error,
    UpdateAccountingConfigurationRequest
  >({
    mutationKey: [
      'accounting',
      organizationId,
      'accounting-configurations',
      'update',
      configurationId,
    ],
    mutationFn: (body) =>
      updateAccountingConfiguration(organizationId, configurationId, body),
    onSuccess: (configuration) => {
      cacheDetail(queryClient, organizationId, configuration);
      invalidate();
    },
  });
}

export function usePublishAccountingConfigurationMutation(
  organizationId: string,
) {
  const queryClient = useQueryClient();
  const invalidate = useConfigurationInvalidation(organizationId);
  return useMutation<AccountingConfiguration, Error, string>({
    mutationKey: [
      'accounting',
      organizationId,
      'accounting-configurations',
      'publish',
    ],
    mutationFn: (configurationId) =>
      publishAccountingConfiguration(organizationId, configurationId),
    onSuccess: (configuration) => {
      cacheDetail(queryClient, organizationId, configuration);
      invalidate();
    },
  });
}

export function useDeleteAccountingConfigurationMutation(
  organizationId: string,
) {
  const queryClient = useQueryClient();
  const invalidate = useConfigurationInvalidation(organizationId);
  return useMutation<void, Error, string>({
    mutationKey: [
      'accounting',
      organizationId,
      'accounting-configurations',
      'delete',
    ],
    mutationFn: (configurationId) =>
      deleteAccountingConfiguration(organizationId, configurationId),
    onSuccess: (_result, configurationId) => {
      queryClient.removeQueries({
        queryKey: queryKeys.accounting.accountingConfigurationDetail(
          organizationId,
          configurationId,
        ),
      });
      invalidate();
    },
  });
}
