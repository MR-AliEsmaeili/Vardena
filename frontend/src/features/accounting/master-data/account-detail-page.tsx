import { Link, useParams } from 'react-router-dom';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PermissionGate } from '@/features/permissions/permission-gate';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { PageHeader } from '@/ui/patterns/page-header';
import { LoadingState } from '@/ui/patterns/states';
import { Definition, DefinitionList } from './master-data-ui';
import { useAccountDetail } from './master-data-hooks';

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
  const query = useAccountDetail(organizationId, accountId);
  // The parent is resolved to its code/title — a raw parent ULID tells an
  // operator nothing about where this account sits in the coding tree.
  const parentQuery = useAccountDetail(
    organizationId,
    query.data?.parentId ?? undefined,
  );
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
      <PageHeader
        title={t.masterData.accountDetail}
        description={`${account.code} — ${account.title}`}
        actions={
          account.isPostable ? (
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
          ) : undefined
        }
      />
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
        <Definition label={t.masterData.status}>
          <Badge variant={account.isActive ? 'success' : 'neutral'}>
            {account.isActive ? t.masterData.active : t.masterData.inactive}
          </Badge>
        </Definition>
      </DefinitionList>
    </div>
  );
}
