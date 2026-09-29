import type { ColumnDef } from '@tanstack/react-table';
import {
  useOrganization,
  useOrganizationId,
} from '@/features/organization/use-organization';
import type { FinancialArea } from '@/api/contracts';
import { t } from '@/lib/i18n';
import { Badge } from '@/ui/badge';
import { DataTable } from '@/ui/patterns/data-table';
import { PageHeader } from '@/ui/patterns/page-header';
import { ActiveBadge, MasterFilters } from './master-data-ui';
import { useFinancialAreaList } from './master-data-hooks';
import { useMasterDataQuery } from './use-master-data-query';

const columns: ColumnDef<FinancialArea, unknown>[] = [
  {
    accessorKey: 'code',
    header: t.masterData.code,
    cell: ({ row }) => <span className="code">{row.original.code}</span>,
  },
  { accessorKey: 'title', header: t.masterData.name },
  {
    id: 'default',
    header: t.masterData.defaultArea,
    cell: ({ row }) =>
      row.original.isDefault ? (
        <Badge variant="info">{t.app.yes}</Badge>
      ) : (
        t.app.none
      ),
  },
  {
    id: 'status',
    header: t.masterData.status,
    cell: ({ row }) => <ActiveBadge active={row.original.isActive} />,
  },
];

export function FinancialAreasPage() {
  const organizationId = useOrganizationId();
  const organization = useOrganization();
  const state = useMasterDataQuery();
  const query = useFinancialAreaList(organizationId, state);
  return (
    <div className="space-y-4">
      <PageHeader
        title={t.masterData.financialAreas}
        description={`${t.masterData.financialAreasDescription} ${t.masterData.organizationScope}: ${organization.organization?.name ?? t.app.none}`}
      />
      <MasterFilters
        search={state.search}
        status={state.status}
        statusOptions={[
          { value: 'active', label: t.masterData.active },
          { value: 'inactive', label: t.masterData.inactive },
        ]}
        onApply={(values) => state.update({ ...values, page: null })}
        onClear={() => state.update({ search: null, status: null, page: null })}
      />
      <DataTable
        columns={columns}
        data={query.data?.items ?? []}
        getRowId={(row) => row.id}
        caption={t.masterData.financialAreas}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        errorDescription={t.masterData.loadFailed}
        onRetry={() => void query.refetch()}
        emptyTitle={t.masterData.financialAreas}
        emptyDescription={t.masterData.noFinancialAreas}
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
