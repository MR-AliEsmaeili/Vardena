import { zodResolver } from '@hookform/resolvers/zod';
import type { SortingState } from '@tanstack/react-table';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useOrganizationId } from '@/features/organization/use-organization';
import { t } from '@/lib/i18n';
import { Alert, AlertBody } from '@/ui/alert';
import { DataTable } from '@/ui/patterns/data-table';
import { PageHeader } from '@/ui/patterns/page-header';
import { FilterBar } from '../shared/filter-bar';
import { LedgerScopeFields } from '../shared/ledger-scope-fields';
import {
  emptyLedgerScope,
  ledgerScopeSchema,
  type LedgerScopeValues,
  ledgerUrlCodec,
} from '../shared/report-filters';
import { useReportQueryState } from '../shared/use-report-query-state';
import { trialBalanceColumns } from './trial-balance-columns';
import { useTrialBalance } from './use-trial-balance';

/** Backend default order of the endpoint (accountCode ascending). */
const DEFAULT_SORTING: SortingState = [{ id: 'accountCode', desc: false }];

/** Trial Balance read surface (server-filtered, server-paged, server-sorted). */
export function TrialBalancePage() {
  const organizationId = useOrganizationId();
  const state = useReportQueryState<LedgerScopeValues>({
    defaultSorting: DEFAULT_SORTING,
    allowedSortFields: [
      'accountCode',
      'accountName',
      'accountId',
      'opening',
      'debit',
      'credit',
      'periodNet',
      'closing',
    ],
    codec: ledgerUrlCodec,
  });

  const form = useForm<LedgerScopeValues>({
    resolver: zodResolver(ledgerScopeSchema),
    defaultValues: emptyLedgerScope,
    mode: 'onSubmit',
  });

  useEffect(() => {
    form.reset(state.urlFilters ?? emptyLedgerScope);
  }, [form, state.urlFilters]);

  const trialBalanceQuery = useTrialBalance({
    organizationId,
    filters: state.applied,
    page: state.page,
    pageSize: state.pageSize,
    sorting: state.sorting,
  });

  const rows = trialBalanceQuery.data?.items ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.trialBalance.title}
        description={t.trialBalance.subtitle}
      />

      <FilterBar
        isFetching={trialBalanceQuery.isFetching}
        onSubmit={form.handleSubmit((values) => state.apply(values))}
        onReset={() => {
          form.reset(emptyLedgerScope);
          state.clear();
        }}
      >
        <LedgerScopeFields form={form} organizationId={organizationId} />
      </FilterBar>

      {state.applied === null ? (
        <Alert variant="neutral">
          <AlertBody>{t.filters.missingScope}</AlertBody>
        </Alert>
      ) : (
        <DataTable
          columns={trialBalanceColumns}
          data={rows}
          getRowId={(row) => row.accountId}
          caption={t.trialBalance.title}
          isLoading={trialBalanceQuery.isPending}
          isFetching={trialBalanceQuery.isFetching}
          error={trialBalanceQuery.error}
          onRetry={() => void trialBalanceQuery.refetch()}
          sorting={state.sorting}
          onSortingChange={state.setSorting}
          pagination={{
            page: trialBalanceQuery.data?.page ?? state.page,
            pageSize: trialBalanceQuery.data?.pageSize ?? state.pageSize,
            total: trialBalanceQuery.data?.total ?? 0,
            onPageChange: state.setPage,
            onPageSizeChange: state.setPageSize,
          }}
        />
      )}
    </div>
  );
}
