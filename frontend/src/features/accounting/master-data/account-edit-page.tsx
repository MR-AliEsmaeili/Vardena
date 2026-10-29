import { useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import type { Account, AccountingDetail } from '@/api/contracts';
import { useDebouncedValue } from '@/lib/use-debounced-value';
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
import { FormPageHeader } from '@/app/layouts/form-page-header';
import { LoadingState } from '@/ui/patterns/states';
import { useToast } from '@/ui/patterns/toast';
import {
  useAccountDetailGroupCandidates,
  useUpdateAccountMutation,
} from './account-admin-hooks';
import { AccountParentPicker } from './account-parent-picker';
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
  const [parentSearch, setParentSearch] = useState('');
  const [selectedParentRecord, setSelectedParentRecord] =
    useState<Account | null>(null);
  const debouncedParentSearch = useDebouncedValue(parentSearch);
  const parentQuery = useAccountParentCandidates(
    account.organizationId,
    debouncedParentSearch,
  );
  const canChooseDetailGroup =
    permissions.has(PERMISSIONS.accounting.detailView) &&
    permissions.has(PERMISSIONS.accounting.detailStructureView);
  const [groupSearch, setGroupSearch] = useState('');
  const [selectedDetailGroupRecord, setSelectedDetailGroupRecord] =
    useState<AccountingDetail | null>(null);
  const debouncedGroupSearch = useDebouncedValue(groupSearch);
  const { activeStructure: detailStructureQuery, groups } =
    useAccountDetailGroupCandidates(
      account.organizationId,
      debouncedGroupSearch,
      canChooseDetailGroup,
    );
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
  const detailGroupField = form.register('detailGroupId');
  const [failure, setFailure] = useState(false);
  const parents =
    parentQuery.data?.items.filter(
      (candidate) => candidate.id !== account.id,
    ) ?? [];
  const activeDetailGroups = useMemo(() => {
    const candidates = groups.data?.items ?? [];
    const selected = selectedDetailGroupRecord;
    if (
      selected !== null &&
      selected.isActive &&
      selected.detailStructureVersionId === detailStructureQuery.data?.id &&
      !candidates.some((candidate) => candidate.id === selected.id)
    ) {
      return [selected, ...candidates];
    }
    return candidates;
  }, [
    detailStructureQuery.data?.id,
    groups.data?.items,
    selectedDetailGroupRecord,
  ]);
  const currentParentId = form.watch('parentId') ?? '';
  const currentParentInList =
    currentParentId === '' ||
    parents.some((parent) => parent.id === currentParentId);
  const parentFallback = currentParentInList
    ? null
    : selectedParentRecord?.id === currentParentId
      ? {
          id: selectedParentRecord.id,
          label: `${selectedParentRecord.code} — ${selectedParentRecord.title}`,
        }
      : currentParentId === account.parentId && account.parentId !== null
        ? { id: account.parentId, label: t.accountAdmin.parentUnchanged }
        : null;
  const currentGroupInList =
    account.detailGroupId === null ||
    activeDetailGroups.some((group) => group.id === account.detailGroupId);
  return (
    <div className="space-y-4">
      <FormPageHeader
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
                  ...(canChooseDetailGroup &&
                  activeDetailGroups.some(
                    (group) => group.id === values.detailGroupId,
                  )
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
              <AccountParentPicker
                id="account-edit-parent"
                value={form.watch('parentId')}
                candidates={parents}
                search={parentSearch}
                onSearchChange={setParentSearch}
                onChange={(parentId) => {
                  setSelectedParentRecord(
                    parents.find((parent) => parent.id === parentId) ?? null,
                  );
                  form.setValue('parentId', parentId, {
                    shouldDirty: true,
                    shouldTouch: true,
                  });
                }}
                disabled={parentQuery.isPending}
                error={form.formState.errors.parentId?.message}
                fallback={parentFallback}
              />
              {canChooseDetailGroup && (
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
                      <Select
                        {...props}
                        {...detailGroupField}
                        onChange={(event) => {
                          void detailGroupField.onChange(event);
                          const selectedId = event.target.value;
                          setSelectedDetailGroupRecord(
                            activeDetailGroups.find(
                              (group) => group.id === selectedId,
                            ) ?? null,
                          );
                        }}
                        disabled={
                          detailStructureQuery.isPending ||
                          detailStructureQuery.data === null ||
                          groups.isPending
                        }
                      >
                        {account.detailGroupId === null && (
                          <option value="">{t.accountAdmin.groupNone}</option>
                        )}
                        {!currentGroupInList &&
                          account.detailGroupId !== null && (
                            <option value={account.detailGroupId}>
                              {t.accountAdmin.groupUnchanged}
                            </option>
                          )}
                        {activeDetailGroups.map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.code} — {group.title}
                          </option>
                        ))}
                      </Select>
                      {detailStructureQuery.isSuccess &&
                        detailStructureQuery.data === null && (
                          <p className="text-xs text-ink-muted">
                            {t.accountAdmin.noActiveDetailStructure}
                          </p>
                        )}
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
            {canChooseDetailGroup && detailStructureQuery.isError && (
              <ApiErrorAlert
                error={detailStructureQuery.error}
                description={t.accountAdmin.groupLoadFailed}
                onRetry={() => void detailStructureQuery.refetch()}
              />
            )}
            {groups.isError && canChooseDetailGroup && (
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
              disabled={mutation.isPending || parentQuery.isPending}
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
