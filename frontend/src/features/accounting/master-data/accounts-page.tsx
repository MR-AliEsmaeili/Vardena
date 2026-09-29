import type { ColumnDef } from '@tanstack/react-table';
import { Link, useSearchParams } from 'react-router-dom';
import type { Account } from '@/api/contracts';
import { useOrganizationId } from '@/features/organization/use-organization';
import { formatCount } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { DataTable } from '@/ui/patterns/data-table';
import { PageHeader } from '@/ui/patterns/page-header';
import { MasterFilters } from './master-data-ui';
import { useAccountList } from './master-data-hooks';
import { useMasterDataQuery } from './use-master-data-query';

const natureLabels: Record<Account['accountNature'], string> = {
  DEBIT: t.masterData.natureDebit,
  CREDIT: t.masterData.natureCredit,
  DUAL: t.masterData.natureDual,
};

const columns: ColumnDef<Account, unknown>[] = [
  {
    accessorKey: 'code',
    header: t.masterData.code,
    cell: ({ row }) => (
      <Link
        className="code font-medium text-indigo-700 hover:underline"
        to={`/app/accounting/accounts/${encodeURIComponent(row.original.id)}`}
      >
        {row.original.code}
      </Link>
    ),
  },
  { accessorKey: 'title', header: t.masterData.name },
  {
    accessorKey: 'level',
    header: t.masterData.level,
    cell: ({ row }) => (
      <span className="num">{formatCount(row.original.level)}</span>
    ),
  },
  {
    accessorKey: 'accountNature',
    header: t.masterData.nature,
    cell: ({ row }) => natureLabels[row.original.accountNature],
  },
  {
    id: 'postable',
    header: t.masterData.postability,
    cell: ({ row }) => (
      <Badge variant={row.original.isPostable ? 'success' : 'neutral'}>
        {row.original.isPostable
          ? t.masterData.postable
          : t.masterData.aggregate}
      </Badge>
    ),
  },
  {
    id: 'status',
    header: t.masterData.status,
    cell: ({ row }) => (
      <Badge variant={row.original.isActive ? 'success' : 'neutral'}>
        {row.original.isActive ? t.masterData.active : t.masterData.inactive}
      </Badge>
    ),
  },
  {
    id: 'action',
    header: t.masterData.view,
    cell: ({ row }) => (
      <Button asChild variant="ghost" size="sm">
        <Link
          to={`/app/accounting/accounts/${encodeURIComponent(row.original.id)}`}
        >
          {t.masterData.view}
        </Link>
      </Button>
    ),
  },
];

export function AccountsPage() {
  const organizationId = useOrganizationId();
  const state = useMasterDataQuery();
  const [params] = useSearchParams();
  const levelValue = Number(params.get('level'));
  const level =
    Number.isInteger(levelValue) && levelValue > 0 ? levelValue : undefined;
  const postableParam = params.get('postable');
  const postable =
    postableParam === 'true'
      ? true
      : postableParam === 'false'
        ? false
        : undefined;
  const query = useAccountList(organizationId, { ...state, level, postable });
  return (
    <div className="space-y-4">
      <PageHeader
        title={t.masterData.accounts}
        description={t.masterData.accountsDescription}
      />
      <MasterFilters
        search={state.search}
        status=""
        onApply={(values) =>
          state.update({
            search: values.search,
            level: values.level,
            postable: values.postable,
            page: null,
          })
        }
        onClear={() =>
          state.update({
            search: null,
            level: null,
            postable: null,
            page: null,
          })
        }
      >
        <label className="min-w-28 text-xs text-slate-600">
          <span>{t.masterData.level}</span>
          <Input
            name="level"
            type="number"
            min="1"
            defaultValue={level ?? ''}
            className="mt-1"
          />
        </label>
        <label className="min-w-36 text-xs text-slate-600">
          <span>{t.masterData.postability}</span>
          <Select
            name="postable"
            defaultValue={postableParam ?? ''}
            className="mt-1"
          >
            <option value="">{t.masterData.allStatuses}</option>
            <option value="true">{t.masterData.postable}</option>
            <option value="false">{t.masterData.aggregate}</option>
          </Select>
        </label>
      </MasterFilters>
      <DataTable
        columns={columns}
        data={query.data?.items ?? []}
        getRowId={(row) => row.id}
        caption={t.masterData.accounts}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        errorDescription={t.masterData.loadFailed}
        onRetry={() => void query.refetch()}
        emptyTitle={t.masterData.accounts}
        emptyDescription={t.masterData.noAccounts}
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
