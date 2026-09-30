import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { useSearchParams } from 'react-router-dom';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { t } from '@/lib/i18n';
import { Alert, AlertBody } from '@/ui/alert';
import { Select } from '@/ui/select';
import { DataTable } from '@/ui/patterns/data-table';
import { FormField } from '@/ui/patterns/form-field';
import { PageHeader } from '@/ui/patterns/page-header';
import { AccountPicker } from '../shared/account-picker';
import { FilterBar } from '../shared/filter-bar';
import {
  emptyStatementScope,
  statementScopeSchema,
  type StatementScopeValues,
  statementUrlCodec,
} from '../shared/report-filters';
import {
  useAccountingPeriods,
  useFinancialAreas,
  useFiscalYears,
} from '../shared/use-accounting-references';
import { useReportQueryState } from '../shared/use-report-query-state';
import { buildAccountStatementColumns } from './account-statement-columns';
import { AccountStatementSummary } from './account-statement-summary';
import { useAccountStatement } from './use-account-statement';

/**
 * Account statement: opening balance, movements and closing balance of one
 * account inside one fiscal year (optionally narrowed to one period).
 */
export function AccountStatementPage() {
  const organizationId = useOrganizationId();
  const permissions = usePermissions();
  const [searchParams] = useSearchParams();
  const state = useReportQueryState<StatementScopeValues>({
    codec: statementUrlCodec,
  });
  const linkedAccountId = searchParams.get('accountId') ?? '';

  // Drill-down to a document needs its own view permission (UX only; the
  // backend authorizes the document read itself).
  const columns = useMemo(
    () =>
      buildAccountStatementColumns(
        permissions.loaded &&
          permissions.has(PERMISSIONS.accounting.documentView),
      ),
    [permissions],
  );

  const form = useForm<StatementScopeValues>({
    resolver: zodResolver(statementScopeSchema),
    defaultValues: { ...emptyStatementScope, accountId: linkedAccountId },
    mode: 'onSubmit',
  });

  useEffect(() => {
    form.reset(
      state.urlFilters ?? {
        ...emptyStatementScope,
        accountId: linkedAccountId,
      },
    );
  }, [form, linkedAccountId, state.urlFilters]);

  const financialAreaId = form.watch('financialAreaId');
  const fiscalYearId = form.watch('fiscalYearId');
  const accountId = form.watch('accountId');

  const areasQuery = useFinancialAreas(organizationId);
  const yearsQuery = useFiscalYears(
    organizationId,
    financialAreaId === '' ? null : financialAreaId,
  );
  const periodsQuery = useAccountingPeriods(
    organizationId,
    fiscalYearId === '' ? null : fiscalYearId,
  );

  const statementQuery = useAccountStatement({
    organizationId,
    filters: state.applied,
    page: state.page,
    pageSize: state.pageSize,
  });

  const statement = statementQuery.data;
  const movements = statement?.movements;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.statement.title}
        description={t.statement.subtitle}
      />

      <FilterBar
        isFetching={statementQuery.isFetching}
        onSubmit={form.handleSubmit((values) => state.apply(values))}
        onReset={() => {
          form.reset(emptyStatementScope);
          state.clear();
        }}
      >
        <FormField id="financialAreaId" label={t.filters.financialArea}>
          {(fieldProps) => (
            <Select
              {...fieldProps}
              {...form.register('financialAreaId', {
                onChange: () => {
                  form.setValue('fiscalYearId', '');
                  form.setValue('accountingPeriodId', '');
                },
              })}
              disabled={areasQuery.isPending}
            >
              <option value="">{t.filters.select}</option>
              {(areasQuery.data?.items ?? []).map((area) => (
                <option key={area.id} value={area.id}>
                  {area.code} — {area.title}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <FormField
          id="fiscalYearId"
          label={t.filters.fiscalYear}
          error={form.formState.errors.fiscalYearId?.message}
        >
          {(fieldProps) => (
            <Select
              {...fieldProps}
              {...form.register('fiscalYearId', {
                onChange: () => form.setValue('accountingPeriodId', ''),
              })}
              disabled={yearsQuery.isPending}
            >
              <option value="">{t.filters.select}</option>
              {(yearsQuery.data?.items ?? []).map((year) => (
                <option key={year.id} value={year.id}>
                  {year.code} — {year.title}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <FormField id="accountingPeriodId" label={t.filters.accountingPeriod}>
          {(fieldProps) => (
            <Select
              {...fieldProps}
              {...form.register('accountingPeriodId')}
              disabled={fiscalYearId === '' || periodsQuery.isPending}
            >
              <option value="">{t.filters.allPeriods}</option>
              {(periodsQuery.data?.items ?? []).map((period) => (
                <option key={period.id} value={period.id}>
                  {period.sequence} — {period.title}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <AccountPicker
          id="accountId"
          label={t.filters.account}
          organizationId={organizationId}
          value={accountId}
          required
          error={form.formState.errors.accountId?.message}
          onChange={(value) =>
            form.setValue('accountId', value, { shouldValidate: true })
          }
        />
      </FilterBar>

      {state.applied === null ? (
        <Alert variant="neutral">
          <AlertBody>{t.filters.missingStatementScope}</AlertBody>
        </Alert>
      ) : (
        <>
          {statement !== undefined && !statementQuery.isError && (
            <AccountStatementSummary statement={statement} />
          )}
          <DataTable
            columns={columns}
            data={movements?.items ?? []}
            getRowId={(row) => row.id}
            caption={t.statement.title}
            isLoading={statementQuery.isPending}
            isFetching={statementQuery.isFetching}
            error={statementQuery.error}
            onRetry={() => void statementQuery.refetch()}
            pagination={{
              page: movements?.page ?? state.page,
              pageSize: movements?.pageSize ?? state.pageSize,
              total: movements?.total ?? 0,
              onPageChange: state.setPage,
              onPageSizeChange: state.setPageSize,
            }}
          />
        </>
      )}
    </div>
  );
}
