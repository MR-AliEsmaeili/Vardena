import type { ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import type { FiscalYear } from '@/api/contracts';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { formatDateOnly, formatDateOnlyCanonical } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { DataTable } from '@/ui/patterns/data-table';
import { PageHeader } from '@/ui/patterns/page-header';
import { useFinancialAreas } from '../shared/use-accounting-references';
import { LifecycleBadge, MasterFilters } from './master-data-ui';
import { useFiscalYearList } from './master-data-hooks';
import { FiscalYearRowActions } from './fiscal-year-row-actions';
import { useMasterDataQuery } from './use-master-data-query';

const columns: ColumnDef<FiscalYear, unknown>[] = [
  {
    accessorKey: 'code',
    header: t.masterData.code,
    cell: ({ row }) => <span className="code">{row.original.code}</span>,
  },
  { accessorKey: 'title', header: t.masterData.name },
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
  {
    id: 'actions',
    header: t.fiscalYear.actions,
    cell: ({ row }) => <FiscalYearRowActions fiscalYear={row.original} />,
  },
];

export function FiscalYearsPage() {
  const organizationId = useOrganizationId();
  const permissions = usePermissions();
  const state = useMasterDataQuery();
  const areas = useFinancialAreas(organizationId);
  const query = useFiscalYearList(organizationId, state);
  const areaOptions = [
    { value: '', label: t.masterData.selectFinancialArea },
    ...(areas.data?.items ?? []).map((item) => ({
      value: item.id,
      label: `${item.code} — ${item.title}`,
    })),
  ];
  return (
    <div className="space-y-4">
      <PageHeader
        title={t.masterData.fiscalYears}
        description={t.masterData.fiscalYearsDescription}
        actions={
          permissions.has(PERMISSIONS.accounting.fiscalYearCreate) ? (
            <Button asChild>
              <Link to="/app/accounting/fiscal-years/new">
                {t.fiscalYear.new}
              </Link>
            </Button>
          ) : undefined
        }
      />
      <p className="text-xs font-medium text-ink-subtle">
        {t.masterData.contextHint}
      </p>
      <MasterFilters
        synchronizationKey={`${state.search}:${state.status}:${state.scopeId}`}
        search={state.search}
        status={state.status}
        scope={state.scopeId}
        scopeLabel={t.masterData.financialArea}
        scopeOptions={areaOptions}
        statusOptions={[
          { value: 'open', label: t.masterData.open },
          { value: 'closed', label: t.masterData.closed },
          { value: 'sealed', label: t.masterData.sealed },
        ]}
        onApply={(values) => state.update({ ...values, page: null })}
        onClear={() =>
          state.update({
            search: null,
            status: null,
            scopeId: null,
            page: null,
          })
        }
      />
      <DataTable
        columns={columns}
        data={query.data?.items ?? []}
        getRowId={(row) => row.id}
        caption={t.masterData.fiscalYears}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        errorDescription={t.masterData.loadFailed}
        onRetry={() => void query.refetch()}
        emptyTitle={t.masterData.fiscalYears}
        emptyDescription={t.masterData.noFiscalYears}
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
