import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { createAccount } from '@/api/accounting.api';
import type { Account } from '@/api/contracts';
import { queryKeys } from '@/api/query-keys';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/card';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { FormField } from '@/ui/patterns/form-field';

const schema = z.object({
  code: z.string().trim().min(1, t.masterData.codeRequired).max(30),
  title: z.string().trim().min(1, t.masterData.titleRequired).max(200),
  parentId: z.string(),
  accountNature: z.enum(['DEBIT', 'CREDIT', 'DUAL']),
  accountType: z.enum(['BALANCE_SHEET', 'INCOME_STATEMENT', 'MEMORANDUM']),
  isPostable: z.boolean(),
});
type Values = z.infer<typeof schema>;

/** Create an account — POST /accounts, `Accounting.Account.Create`. Level, pins and code shape are derived/validated by the backend against the active configuration + coding structure. */
export function AccountCreateForm({
  organizationId,
  accounts,
}: {
  organizationId: string;
  accounts: readonly Account[];
}) {
  const queryClient = useQueryClient();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      code: '',
      title: '',
      parentId: '',
      accountNature: 'DUAL',
      accountType: 'BALANCE_SHEET',
      isPostable: false,
    },
    mode: 'onSubmit',
  });
  const mutation = useMutation({
    mutationFn: (values: Values) =>
      createAccount({
        organizationId,
        code: values.code.trim(),
        title: values.title.trim(),
        parentId: values.parentId === '' ? null : values.parentId,
        accountNature: values.accountNature,
        accountType: values.accountType,
        isPostable: values.isPostable,
      }),
    onSuccess: async () => {
      form.reset();
      await queryClient.invalidateQueries({
        queryKey: queryKeys.accounting.all(organizationId),
      });
    },
  });
  const errors = form.formState.errors;
  const parents = accounts.filter((a) => !a.isPostable && a.isActive);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.masterData.createAccountTitle}</CardTitle>
        <CardDescription>{t.masterData.createAccountBody}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          noValidate
          onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              id="account-code"
              label={t.masterData.accountCode}
              required
              error={errors.code?.message}
            >
              {(p) => (
                <Input
                  {...p}
                  dir="ltr"
                  {...form.register('code')}
                  disabled={mutation.isPending}
                />
              )}
            </FormField>
            <FormField
              id="account-title"
              label={t.masterData.accountTitle}
              required
              error={errors.title?.message}
            >
              {(p) => (
                <Input
                  {...p}
                  {...form.register('title')}
                  disabled={mutation.isPending}
                />
              )}
            </FormField>
            <FormField id="account-parent" label={t.masterData.parentAccount}>
              {(p) => (
                <Select
                  {...p}
                  {...form.register('parentId')}
                  disabled={mutation.isPending}
                >
                  <option value="">{t.masterData.rootParent}</option>
                  {parents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.title}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField id="account-nature" label={t.masterData.nature}>
              {(p) => (
                <Select
                  {...p}
                  {...form.register('accountNature')}
                  disabled={mutation.isPending}
                >
                  <option value="DEBIT">{t.masterData.natureDebit}</option>
                  <option value="CREDIT">{t.masterData.natureCredit}</option>
                  <option value="DUAL">{t.masterData.natureDual}</option>
                </Select>
              )}
            </FormField>
            <FormField id="account-type" label={t.masterData.accountType}>
              {(p) => (
                <Select
                  {...p}
                  {...form.register('accountType')}
                  disabled={mutation.isPending}
                >
                  <option value="BALANCE_SHEET">
                    {t.masterData.balanceSheet}
                  </option>
                  <option value="INCOME_STATEMENT">
                    {t.masterData.incomeStatement}
                  </option>
                  <option value="MEMORANDUM">{t.masterData.memorandum}</option>
                </Select>
              )}
            </FormField>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input
                type="checkbox"
                {...form.register('isPostable')}
                disabled={mutation.isPending}
              />
              {t.masterData.postableAccount}
            </label>
          </div>
          {mutation.isError && <ApiErrorAlert error={mutation.error} />}
          {mutation.isSuccess && (
            <output className="block text-sm text-success">
              {t.masterData.accountCreated}
            </output>
          )}
          <Button
            type="submit"
            disabled={mutation.isPending}
            loading={mutation.isPending}
          >
            {mutation.isPending
              ? t.masterData.creatingAccount
              : t.masterData.createAccount}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
