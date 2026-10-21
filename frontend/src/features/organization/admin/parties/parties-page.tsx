import type { ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import type { Party } from '@/api/contracts';
import { PARTY_SORT_FIELDS } from '@/api/organization.api';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PermissionGate } from '@/features/permissions/permission-gate';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Select } from '@/ui/select';
import { DataTable } from '@/ui/patterns/data-table';
import { PageHeader } from '@/ui/patterns/page-header';
import { ActiveBadge, AdminFilters } from '../admin-ui';
import {
  ADMIN_PAGE_SIZE_OPTIONS,
  useAdminListState,
} from '@/lib/use-admin-list-state';
import { PARTY_TYPE_LABELS, PARTY_TYPES, parsePartyType } from '../party-types';
import { PARTY_DEFAULT_SORT, usePartyList } from './party-hooks';

function Capabilities({ party }: { party: Party }) {
  return (
    <span className="flex flex-wrap gap-1">
      {party.isCustomer && <Badge variant="info">{t.orgAdmin.customer}</Badge>}
      {party.isSupplier && <Badge variant="info">{t.orgAdmin.supplier}</Badge>}
    </span>
  );
}

const columns: ColumnDef<Party, unknown>[] = [
  {
    accessorKey: 'code',
    header: t.orgAdmin.code,
    cell: ({ row }) => (
      <Link
        className="code font-medium text-indigo-700 hover:underline"
        to={`/app/organization/parties/${encodeURIComponent(row.original.id)}`}
      >
        {row.original.code}
      </Link>
    ),
  },
  { accessorKey: 'displayName', header: t.orgAdmin.displayName },
  {
    id: 'partyType',
    header: t.orgAdmin.partyType,
    enableSorting: false,
    cell: ({ row }) => PARTY_TYPE_LABELS[row.original.partyType],
  },
  {
    id: 'capabilities',
    header: t.orgAdmin.capabilities,
    enableSorting: false,
    cell: ({ row }) => <Capabilities party={row.original} />,
  },
  {
    id: 'isActive',
    header: t.orgAdmin.status,
    enableSorting: false,
    cell: ({ row }) => <ActiveBadge active={row.original.isActive} />,
  },
  {
    id: 'actions',
    header: t.orgAdmin.actions,
    enableSorting: false,
    meta: { align: 'end' },
    cell: ({ row }) => (
      <Button asChild variant="ghost" size="sm">
        <Link
          to={`/app/organization/parties/${encodeURIComponent(row.original.id)}`}
        >
          {t.orgAdmin.view}
        </Link>
      </Button>
    ),
  },
];

/** Party list (`GET /parties`) with the endpoint's own filters. */
export function PartiesPage() {
  const organizationId = useOrganizationId();
  const list = useAdminListState({
    sortFields: PARTY_SORT_FIELDS,
    defaultSort: PARTY_DEFAULT_SORT,
    extraKeys: ['partyType', 'capability'],
  });
  const partyType = parsePartyType(list.extra['partyType'] ?? '');
  const rawCapability = list.extra['capability'] ?? '';
  const capability =
    rawCapability === 'customer' || rawCapability === 'supplier'
      ? rawCapability
      : '';
  const query = usePartyList(organizationId, list.state, {
    partyType,
    capability,
  });

  return (
    <div className="space-y-4" data-testid="parties-page">
      <PageHeader
        title={t.orgAdmin.parties}
        description={t.orgAdmin.partiesDescription}
        actions={
          <PermissionGate permission={PERMISSIONS.organization.partyCreate}>
            <Button asChild size="sm">
              <Link to="/app/organization/parties/new">
                {t.orgAdmin.newParty}
              </Link>
            </Button>
          </PermissionGate>
        }
      />

      <AdminFilters
        synchronizationKey={`${list.state.search}:${list.state.status}:${partyType}:${capability}`}
        search={list.state.search}
        status={list.state.status}
        onApply={(values) =>
          list.update({ search: values.search, status: values.status })
        }
        onClear={list.clear}
      >
        <label className="min-w-40 text-xs text-slate-600">
          <span>{t.orgAdmin.partyType}</span>
          <Select
            className="mt-1"
            value={partyType}
            onChange={(event) => list.update({ partyType: event.target.value })}
          >
            <option value="">{t.orgAdmin.allPartyTypes}</option>
            {PARTY_TYPES.map((value) => (
              <option key={value} value={value}>
                {PARTY_TYPE_LABELS[value]}
              </option>
            ))}
          </Select>
        </label>
        <label className="min-w-40 text-xs text-slate-600">
          <span>{t.orgAdmin.capabilities}</span>
          <Select
            className="mt-1"
            value={capability}
            onChange={(event) =>
              list.update({ capability: event.target.value })
            }
          >
            <option value="">{t.orgAdmin.allCapabilities}</option>
            <option value="customer">{t.orgAdmin.onlyCustomers}</option>
            <option value="supplier">{t.orgAdmin.onlySuppliers}</option>
          </Select>
        </label>
      </AdminFilters>

      <DataTable
        columns={columns}
        data={query.data?.items ?? []}
        getRowId={(row) => row.id}
        caption={t.orgAdmin.parties}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        errorDescription={t.orgAdmin.partiesLoadFailed}
        onRetry={() => void query.refetch()}
        emptyTitle={t.orgAdmin.parties}
        emptyDescription={t.orgAdmin.noParties}
        sorting={list.state.sorting}
        onSortingChange={list.setSorting}
        pagination={{
          page: query.data?.page ?? list.state.page,
          pageSize: query.data?.pageSize ?? list.state.pageSize,
          total: query.data?.total ?? 0,
          pageSizeOptions: [...ADMIN_PAGE_SIZE_OPTIONS],
          onPageChange: (page) => list.update({ page }),
          onPageSizeChange: (pageSize) => list.update({ pageSize }),
        }}
      />
    </div>
  );
}
