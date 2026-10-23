import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';
import type {
  AccountingPeriod,
  FinancialArea,
  FiscalYear,
} from '@/api/contracts';
import { useOrganizationId } from '@/features/organization/use-organization';
import { formatDateOnly, formatDateOnlyCanonical } from '@/lib/format';
import { t } from '@/lib/i18n';
import { DataTable } from '@/ui/patterns/data-table';
import { PageHeader } from '@/ui/patterns/page-header';
import {
  useFinancialAreas,
  useFiscalYears,
} from '../shared/use-accounting-references';
import { LifecycleBadge, MasterFilters } from './master-data-ui';
import { useAccountingPeriodList } from './master-data-hooks';
import { useMasterDataQuery } from './use-master-data-query';

function periodColumns(
  areaById: ReadonlyMap<string, FinancialArea>,
  yearById: ReadonlyMap<string, FiscalYear>,
): ColumnDef<AccountingPeriod, unknown>[] {
  return [
    { accessorKey: 'sequence', header: t.masterData.sequence },
    { accessorKey: 'title', header: t.masterData.name },
    {
      id: 'area',
      header: t.masterData.financialArea,
      cell: ({ row }) =>
        areaById.get(row.original.financialAreaId)?.title ?? t.app.none,
    },
    {
      id: 'year',
      header: t.masterData.fiscalYear,
      cell: ({ row }) =>
        yearById.get(row.original.fiscalYearId)?.title ?? t.app.none,
    },
    {
      accessorKey: 'startDate',
      header: t.masterData.startDate,
      cell: ({ row }) => (
        <span dir="ltr" title={formatDateOnlyCanonical(row.original.startDate)}>
          {formatDateOnly(row.original.startDate)}
        </span>
      ),
    },
    {
      accessorKey: 'endDate',
      header: t.masterData.endDate,
      cell: ({ row }) => (
        <span dir="ltr" title={formatDateOnlyCanonical(row.original.endDate)}>
          {formatDateOnly(row.original.endDate)}
        </span>
      ),
    },
    {
      accessorKey: 'status',
      header: t.masterData.status,
      cell: ({ row }) => <LifecycleBadge status={row.original.status} />,
    },
  ];
}

export function AccountingPeriodsPage() {
  const organizationId = useOrganizationId();
  const state = useMasterDataQuery();
  const areas = useFinancialAreas(organizationId);
  const years = useFiscalYears(organizationId, null);
  const query = useAccountingPeriodList(organizationId, state);
  const yearById = useMemo(
    () => new Map((years.data?.items ?? []).map((item) => [item.id, item])),
    [years.data],
  );
  const areaById = useMemo(
    () => new Map((areas.data?.items ?? []).map((item) => [item.id, item])),
    [areas.data],
  );
  const columns = useMemo(
    () => periodColumns(areaById, yearById),
    [areaById, yearById],
  );
  const yearOptions = [
    { value: '', label: t.masterData.selectFiscalYear },
    ...(years.data?.items ?? []).map((item) => ({
      value: item.id,
      label: `${item.code} — ${item.title}`,
    })),
  ];
  return (
    <div className="space-y-4">
      <PageHeader
        title={t.masterData.periods}
        description={t.masterData.periodsDescription}
      />
      <p className="text-xs font-medium text-ink-subtle">
        {t.masterData.contextHint}
      </p>
      <MasterFilters
        synchronizationKey={`${state.status}:${state.scopeId}`}
        status={state.status}
        scope={state.scopeId}
        scopeLabel={t.masterData.fiscalYear}
        scopeOptions={yearOptions}
        statusOptions={[
          { value: 'open', label: t.masterData.open },
          { value: 'closed', label: t.masterData.closed },
          { value: 'sealed', label: t.masterData.sealed },
        ]}
        onApply={(values) =>
          state.update({
            status: values.status,
            scopeId: values.scopeId,
            page: null,
          })
        }
        onClear={() =>
          state.update({ status: null, scopeId: null, page: null })
        }
      />
      <DataTable
        columns={columns}
        data={query.data?.items ?? []}
        getRowId={(row) => row.id}
        caption={t.masterData.periods}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        errorDescription={t.masterData.loadFailed}
        onRetry={() => void query.refetch()}
        emptyTitle={t.masterData.periods}
        emptyDescription={t.masterData.noPeriods}
        pagination={{
          page: query.data?.page ?? state.page,
          pageSize: query.data?.pageSize ?? state.pageSize,
          total: query.data?.total ?? 0,
          onPageChange: (page) => state.update({ page }),
          onPageSizeChange: (pageSize) =>
            state.update({ pageSize, page: null }),
        }}
      />
    </div>
  );
}
