import type { ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import type { AccountingConfiguration } from '@/api/contracts';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { useOrganizationId } from '@/features/organization/use-organization';
import { formatInstant, useTimeZone } from '@/lib/datetime';
import { t } from '@/lib/i18n';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { DataTable } from '@/ui/patterns/data-table';
import { PageHeader } from '@/ui/patterns/page-header';
import { MasterFilters } from '../master-data/master-data-ui';
import { useMasterDataQuery } from '../master-data/use-master-data-query';
import { ConfigurationActions } from './configuration-actions';
import {
  CONFIGURATION_STATUSES,
  useAccountingConfigurationsList,
  type ConfigurationStatus,
} from './configuration-hooks';

const STATUS_LABELS: Record<ConfigurationStatus, string> = {
  DRAFT: t.accountingConfig.statusNames.DRAFT,
  ACTIVE: t.accountingConfig.statusNames.ACTIVE,
  SUPERSEDED: t.accountingConfig.statusNames.SUPERSEDED,
};

const STATUS_VARIANT: Record<
  ConfigurationStatus,
  'success' | 'info' | 'neutral'
> = {
  ACTIVE: 'success',
  DRAFT: 'info',
  SUPERSEDED: 'neutral',
};

function ConfigurationStatusBadge({ status }: { status: ConfigurationStatus }) {
  return (
    <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABELS[status]}</Badge>
  );
}

/**
 * Column definitions built OUTSIDE the component: the render phase must not
 * create components (standards.md §3), and the only runtime input is the
 * organization zone used to render the `effectiveFrom` instant.
 */
function configurationColumns(
  timeZone: string,
): ColumnDef<AccountingConfiguration, unknown>[] {
  return [
    {
      accessorKey: 'code',
      header: t.accountingConfig.code,
      cell: ({ row }) => <span className="code">{row.original.code}</span>,
    },
    { accessorKey: 'name', header: t.accountingConfig.name },
    {
      accessorKey: 'versionNumber',
      header: t.accountingConfig.versionNumber,
      cell: ({ row }) => <span dir="ltr">{row.original.versionNumber}</span>,
    },
    {
      accessorKey: 'status',
      header: t.accountingConfig.status,
      cell: ({ row }) => (
        <span className="inline-flex flex-wrap items-center gap-1">
          <ConfigurationStatusBadge status={row.original.status} />
          {row.original.isOperationallyUsed && (
            <Badge variant="warning">
              {t.accountingConfig.operationallyUsed}
            </Badge>
          )}
        </span>
      ),
    },
    {
      accessorKey: 'pattern',
      header: t.accountingConfig.pattern,
      cell: ({ row }) => (
        <span className="code" dir="ltr">
          {row.original.pattern}
        </span>
      ),
    },
    {
      accessorKey: 'effectiveFrom',
      header: t.accountingConfig.effectiveFrom,
      cell: ({ row }) => (
        <span dir="ltr" title={row.original.effectiveFrom ?? ''}>
          {formatInstant(row.original.effectiveFrom, timeZone)}
        </span>
      ),
    },
    {
      id: 'actions',
      header: t.accountingConfig.actions,
      cell: ({ row }) => <ConfigurationActions configuration={row.original} />,
    },
  ];
}

export function ConfigurationListPage() {
  const organizationId = useOrganizationId();
  const permissions = usePermissions();
  const timeZone = useTimeZone();
  const state = useMasterDataQuery();
  const query = useAccountingConfigurationsList(organizationId, {
    page: state.page,
    pageSize: state.pageSize,
    search: state.search,
    status: state.status,
  });
  const canConfigure = permissions.has(
    PERMISSIONS.accounting.accountingConfigurationConfigure,
  );
  const columns = configurationColumns(timeZone);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.accountingConfig.title}
        description={t.accountingConfig.subtitle}
        actions={
          canConfigure ? (
            <Button asChild>
              <Link to="/app/accounting/configurations/new">
                {t.accountingConfig.newVersion}
              </Link>
            </Button>
          ) : undefined
        }
      />
      <MasterFilters
        synchronizationKey={`${state.search}:${state.status}`}
        search={state.search}
        status={state.status}
        statusOptions={CONFIGURATION_STATUSES.map((status) => ({
          value: status,
          label: STATUS_LABELS[status],
        }))}
        onApply={(values) =>
          state.update({
            search: values.search,
            status: values.status,
            page: null,
          })
        }
        onClear={() => state.update({ search: null, status: null, page: null })}
      />
      <DataTable
        columns={columns}
        data={query.data?.items ?? []}
        getRowId={(row) => row.id}
        caption={t.accountingConfig.title}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        errorDescription={t.accountingConfig.loadFailed}
        onRetry={() => void query.refetch()}
        emptyTitle={
          state.search !== '' || state.status !== ''
            ? t.accountingConfig.noResults
            : t.accountingConfig.title
        }
        emptyDescription={
          state.search !== '' || state.status !== ''
            ? t.accountingConfig.noResults
            : t.accountingConfig.noConfiguration
        }
        emptyAction={
          canConfigure && state.search === '' && state.status === '' ? (
            <Button asChild variant="outline">
              <Link to="/app/accounting/configurations/new">
                {t.accountingConfig.emptyAction}
              </Link>
            </Button>
          ) : undefined
        }
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
