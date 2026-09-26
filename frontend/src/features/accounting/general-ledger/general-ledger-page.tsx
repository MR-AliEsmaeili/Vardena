import { zodResolver } from '@hookform/resolvers/zod';
import type { SortingState } from '@tanstack/react-table';
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
} from '../shared/report-filters';
import { useReportQueryState } from '../shared/use-report-query-state';
import { generalLedgerColumns } from './general-ledger-columns';
import { useGeneralLedger } from './use-general-ledger';

/** Backend default order of the endpoint (documentDate ascending). */
const DEFAULT_SORTING: SortingState = [{ id: 'documentDate', desc: false }];

/** General Ledger read surface (server-filtered, server-paged, server-sorted). */
export function GeneralLedgerPage() {
  const organizationId = useOrganizationId();
  const state = useReportQueryState<LedgerScopeValues>({
    defaultSorting: DEFAULT_SORTING,
  });

  const form = useForm<LedgerScopeValues>({
    resolver: zodResolver(ledgerScopeSchema),
    defaultValues: emptyLedgerScope,
    mode: 'onSubmit',
  });

  const ledgerQuery = useGeneralLedger({
    organizationId,
    filters: state.applied,
    page: state.page,
    pageSize: state.pageSize,
    sorting: state.sorting,
  });

  const rows = ledgerQuery.data?.items ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.generalLedger.title}
        description={t.generalLedger.subtitle}
      />

      <FilterBar
        isFetching={ledgerQuery.isFetching}
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
          columns={generalLedgerColumns}
          data={rows}
          getRowId={(row) => row.ledgerLineId}
          caption={t.generalLedger.title}
          isLoading={ledgerQuery.isPending}
          isFetching={ledgerQuery.isFetching}
          error={ledgerQuery.error}
          onRetry={() => void ledgerQuery.refetch()}
          sorting={state.sorting}
          onSortingChange={state.setSorting}
          pagination={{
            page: ledgerQuery.data?.page ?? state.page,
            pageSize: ledgerQuery.data?.pageSize ?? state.pageSize,
            total: ledgerQuery.data?.total ?? 0,
            onPageChange: state.setPage,
            onPageSizeChange: state.setPageSize,
          }}
        />
      )}
    </div>
  );
}
