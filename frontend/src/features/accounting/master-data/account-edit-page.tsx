import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { listDetailGroups, MAX_PAGE_SIZE } from '@/api/accounting.api';
import type { Account } from '@/api/contracts';
import { queryKeys } from '@/api/query-keys';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { FormField } from '@/ui/patterns/form-field';
import { PageHeader } from '@/ui/patterns/page-header';
import { LoadingState } from '@/ui/patterns/states';
import { useToast } from '@/ui/patterns/toast';
import { useUpdateAccountMutation } from './account-admin-hooks';
import {
  useAccountDetail,
  useAccountParentCandidates,
} from './master-data-hooks';

const schema = z.object({
  title: z.string().trim().min(1, t.masterData.titleRequired).max(200),
  accountNature: z.enum(['DEBIT', 'CREDIT', 'DUAL']),
  accountType: z.enum(['BALANCE_SHEET', 'INCOME_STATEMENT', 'MEMORANDUM']),
  parentId: z.string(),
  detailGroupId: z.string(),
  isPostable: z.boolean(),
});
type Values = z.infer<typeof schema>;

export function AccountEditPage() {
  const organizationId = useOrganizationId();
  const { accountId } = useParams();
  const account = useAccountDetail(organizationId, accountId);
  if (account.isPending) return <LoadingState rows={7} />;
  if (account.isError)
    return (
      <ApiErrorAlert
        error={account.error}
        onRetry={() => void account.refetch()}
      />
    );
  return <AccountEditForm key={account.data.id} account={account.data} />;
}

function AccountEditForm({ account }: { account: Account }) {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const parentQuery = useAccountParentCandidates(account.organizationId);
  const canViewDetails = permissions.has(PERMISSIONS.accounting.detailView);
  const [groupSearch, setGroupSearch] = useState('');
  const groups = useQuery({
    queryKey: queryKeys.accounting.detailGroupList(
      account.organizationId,
      groupSearch,
    ),
    queryFn: ({ signal }) =>
      listDetailGroups(
        {
          organizationId: account.organizationId,
          isActive: true,
          page: 1,
          pageSize: MAX_PAGE_SIZE,
          ...(groupSearch ? { search: groupSearch } : {}),
        },
        signal,
      ),
    enabled: canViewDetails,
  });
  const mutation = useUpdateAccountMutation(account.organizationId, account.id);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: account.title,
      accountNature: account.accountNature,
      accountType: account.accountType,
      parentId: account.parentId ?? '',
      detailGroupId: account.detailGroupId ?? '',
      isPostable: account.isPostable,
    },
  });
  const [failure, setFailure] = useState(false);
  const parents =
    parentQuery.data?.items.filter(
      (candidate) => candidate.id !== account.id,
    ) ?? [];
  const currentParentInList =
    account.parentId === null ||
    parents.some((parent) => parent.id === account.parentId);
  const currentGroupInList =
    account.detailGroupId === null ||
    groups.data?.items.some((group) => group.id === account.detailGroupId);
  return (
    <div className="space-y-4">
      <PageHeader
        title={t.accountAdmin.editTitle}
        description={`${account.code} — ${account.title}`}
      />
      <Card>
        <CardContent>
          <form
            className="space-y-4"
            noValidate
            onSubmit={form.handleSubmit((values) => {
              if (mutation.isPending) return;
              setFailure(false);
              // Code/localCode are deliberately absent: both are immutable in UpdateAccountDto.
              mutation.mutate(
                {
                  title: values.title.trim(),
                  accountNature: values.accountNature,
                  accountType: values.accountType,
                  isPostable: values.isPostable,
                  parentId: values.parentId || null,
                  ...(canViewDetails && values.detailGroupId !== ''
                    ? { detailGroupId: values.detailGroupId }
                    : {}),
                },
                {
                  onSuccess: (saved) => {
                    showToast({
                      kind: 'success',
                      message: t.accountAdmin.saved,
                    });
                    void navigate(
                      `/app/accounting/accounts/${encodeURIComponent(saved.id)}`,
                    );
                  },
                  onError: () => setFailure(true),
                },
              );
            })}
          >
            <p className="text-sm text-ink-muted">
              {t.accountAdmin.codeImmutable}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                id="account-edit-title"
                label={t.masterData.accountTitle}
                required
                error={form.formState.errors.title?.message}
              >
                {(props) => (
                  <Input
                    {...props}
                    maxLength={200}
                    {...form.register('title')}
                  />
                )}
              </FormField>
              <FormField id="account-edit-nature" label={t.masterData.nature}>
                {(props) => (
                  <Select {...props} {...form.register('accountNature')}>
                    <option value="DEBIT">{t.masterData.natureDebit}</option>
                    <option value="CREDIT">{t.masterData.natureCredit}</option>
                    <option value="DUAL">{t.masterData.natureDual}</option>
                  </Select>
                )}
              </FormField>
              <FormField
                id="account-edit-type"
                label={t.masterData.accountType}
              >
                {(props) => (
                  <Select {...props} {...form.register('accountType')}>
                    <option value="BALANCE_SHEET">
                      {t.masterData.balanceSheet}
                    </option>
                    <option value="INCOME_STATEMENT">
                      {t.masterData.incomeStatement}
                    </option>
                    <option value="MEMORANDUM">
                      {t.masterData.memorandum}
                    </option>
                  </Select>
                )}
              </FormField>
              <FormField
                id="account-edit-parent"
                label={t.masterData.parentAccount}
                error={form.formState.errors.parentId?.message}
              >
                {(props) => (
                  <Select {...props} {...form.register('parentId')}>
                    <option value="">{t.masterData.rootParent}</option>
                    {!currentParentInList && (
                      <option value={account.parentId ?? ''}>
                        {t.accountAdmin.parentUnchanged}
                      </option>
                    )}
                    {parents.map((parent) => (
                      <option key={parent.id} value={parent.id}>
                        {parent.code} — {parent.title}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
              {canViewDetails && (
                <FormField
                  id="account-edit-group"
                  label={t.masterData.detailGroup}
                >
                  {(props) => (
                    <>
                      <Input
                        aria-label={t.accountAdmin.groupSearch}
                        value={groupSearch}
                        onChange={(event) => setGroupSearch(event.target.value)}
                      />
                      <Select {...props} {...form.register('detailGroupId')}>
                        {account.detailGroupId === null && (
                          <option value="">{t.accountAdmin.groupNone}</option>
                        )}
                        {!currentGroupInList && (
                          <option value={account.detailGroupId ?? ''}>
                            {t.accountAdmin.groupUnchanged}
                          </option>
                        )}
                        {groups.data?.items.map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.code} — {group.title}
                          </option>
                        ))}
                      </Select>
                    </>
                  )}
                </FormField>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" {...form.register('isPostable')} />
                {t.masterData.postable}
              </label>
            </div>
            {parentQuery.isError && (
              <ApiErrorAlert
                error={parentQuery.error}
                onRetry={() => void parentQuery.refetch()}
              />
            )}
            {groups.isError && canViewDetails && (
              <ApiErrorAlert
                error={groups.error}
                description={t.accountAdmin.groupLoadFailed}
                onRetry={() => void groups.refetch()}
              />
            )}
            {failure && mutation.error && (
              <ApiErrorAlert
                error={mutation.error}
                description={t.accountAdmin.saveFailed}
              />
            )}
            <Button
              type="submit"
              disabled={
                mutation.isPending ||
                parentQuery.isPending ||
                (canViewDetails && groups.isPending)
              }
              loading={mutation.isPending}
            >
              {t.accountAdmin.save}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
