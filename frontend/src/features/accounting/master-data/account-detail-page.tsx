import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getDetailRecord } from '@/api/accounting.api';
import { queryKeys } from '@/api/query-keys';
import { usePermissions } from '@/features/permissions/use-permissions';
import { Link, useParams } from 'react-router-dom';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PermissionGate } from '@/features/permissions/permission-gate';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { FormPageHeader } from '@/app/layouts/form-page-header';
import { LoadingState } from '@/ui/patterns/states';
import { Definition, DefinitionList } from './master-data-ui';
import { useAccountDetail } from './master-data-hooks';
import { AccountRowActions } from './account-row-actions';
import { AccountUnlinkDetailGroupDialog } from './account-unlink-detail-group-dialog';

const natureLabels = {
  DEBIT: t.masterData.natureDebit,
  CREDIT: t.masterData.natureCredit,
  DUAL: t.masterData.natureDual,
} as const;
const typeLabels = {
  BALANCE_SHEET: t.masterData.balanceSheet,
  INCOME_STATEMENT: t.masterData.incomeStatement,
  MEMORANDUM: t.masterData.memorandum,
} as const;

export function AccountDetailPage() {
  const organizationId = useOrganizationId();
  const { accountId } = useParams();
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const permissions = usePermissions();
  const query = useAccountDetail(organizationId, accountId);
  // The parent is resolved to its code/title — a raw parent ULID tells an
  // operator nothing about where this account sits in the coding tree.
  const parentQuery = useAccountDetail(
    organizationId,
    query.data?.parentId ?? undefined,
  );
  const detailGroupId = query.data?.detailGroupId;
  const groupQuery = useQuery({
    queryKey: queryKeys.accounting.detailRecord(
      organizationId ?? 'none',
      detailGroupId ?? 'none',
    ),
    queryFn: ({ signal }) =>
      getDetailRecord(
        organizationId as string,
        detailGroupId as string,
        signal,
      ),
    enabled:
      organizationId !== null &&
      detailGroupId != null &&
      permissions.has(PERMISSIONS.accounting.detailView),
  });
  if (query.isPending) return <LoadingState rows={7} />;
  if (query.isError)
    return (
      <ApiErrorAlert
        error={query.error}
        title={t.table.errorTitle}
        description={t.masterData.loadFailed}
        onRetry={() => void query.refetch()}
      />
    );
  const account = query.data;
  return (
    <div className="space-y-4">
      <FormPageHeader
        title={t.masterData.accountDetail}
        description={`${account.code} — ${account.title}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <AccountRowActions account={account} />
            {account.detailGroupId !== null &&
              permissions.has(
                PERMISSIONS.accounting.accountUnlinkDetailGroup,
              ) && (
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={() => setUnlinkOpen(true)}
                >
                  {t.accountAdmin.unlink}
                </Button>
              )}
            {account.isPostable && (
              <PermissionGate
                permission={PERMISSIONS.accounting.accountStatementView}
              >
                <Button asChild variant="outline" size="sm">
                  <Link
                    to={`/app/accounting/account-statements?accountId=${encodeURIComponent(account.id)}`}
                  >
                    {t.masterData.viewStatement}
                  </Link>
                </Button>
              </PermissionGate>
            )}
          </div>
        }
      />
      {unlinkOpen &&
        organizationId !== null &&
        account.detailGroupId !== null && (
          <AccountUnlinkDetailGroupDialog
            organizationId={organizationId}
            accountId={account.id}
            groupName={
              groupQuery.data?.title ?? t.accountAdmin.groupUnavailable
            }
            onClose={() => setUnlinkOpen(false)}
          />
        )}
      <DefinitionList>
        <Definition label={t.masterData.fullCode}>
          <span dir="ltr" className="code">
            {account.code}
          </span>
        </Definition>
        <Definition label={t.masterData.localCodeLabel}>
          <span dir="ltr" className="code">
            {account.localCode}
          </span>
        </Definition>
        <Definition label={t.masterData.name}>{account.title}</Definition>
        <Definition label={t.masterData.level}>
          <span className="num">{account.level}</span>
        </Definition>
        <Definition label={t.masterData.parent}>
          {account.parentId === null ? (
            t.masterData.rootAccount
          ) : parentQuery.data !== undefined ? (
            <Link
              className="text-brand hover:underline"
              to={`/app/accounting/accounts/${encodeURIComponent(parentQuery.data.id)}`}
            >
              <span dir="ltr" className="code">
                {parentQuery.data.code}
              </span>{' '}
              — {parentQuery.data.title}
            </Link>
          ) : parentQuery.isError ? (
            t.masterData.parentUnavailable
          ) : (
            t.app.loading
          )}
        </Definition>
        <Definition label={t.masterData.nature}>
          {natureLabels[account.accountNature]}
        </Definition>
        <Definition label={t.masterData.accountType}>
          {typeLabels[account.accountType]}
        </Definition>
        <Definition label={t.masterData.postability}>
          <Badge variant={account.isPostable ? 'success' : 'neutral'}>
            {account.isPostable
              ? t.masterData.postable
              : t.masterData.aggregate}
          </Badge>
        </Definition>
        <Definition label={t.masterData.detailGroup}>
          {account.detailGroupId === null
            ? t.accountAdmin.groupNone
            : (groupQuery.data?.title ??
              (groupQuery.isPending
                ? t.app.loading
                : t.accountAdmin.groupUnavailable))}
        </Definition>
        <Definition label={t.masterData.status}>
          <Badge variant={account.isActive ? 'success' : 'neutral'}>
            {account.isActive ? t.masterData.active : t.masterData.inactive}
          </Badge>
        </Definition>
      </DefinitionList>
    </div>
  );
}
