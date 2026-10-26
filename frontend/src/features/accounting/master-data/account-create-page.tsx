import { useMutation, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { createAccount } from '@/api/accounting.api';
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
import { AccountCreateForm } from './account-create-form';

/** A Create-only operator can POST a root without Account.View or Configuration.View.
 * The backend checks the full code against the active structure. The richer
 * local-segment/parent picker is only available when its GET permissions exist.
 */
const rootSchema = z.object({
  code: z.string().trim().min(1, t.masterData.localCodeRequired),
  title: z.string().trim().min(1, t.masterData.titleRequired).max(200),
  accountNature: z.enum(['DEBIT', 'CREDIT', 'DUAL']),
});
type RootValues = z.infer<typeof rootSchema>;

export function AccountCreatePage() {
  const organizationId = useOrganizationId();
  const permissions = usePermissions();
  if (organizationId === null) return <LoadingState rows={6} />;
  return (
    <div className="space-y-4">
      <PageHeader
        title={t.masterData.createAccountTitle}
        description={t.masterData.createAccountBody}
      />
      {permissions.hasAll([
        PERMISSIONS.accounting.accountView,
        PERMISSIONS.accounting.accountingConfigurationView,
      ]) ? (
        <AccountCreateForm organizationId={organizationId} />
      ) : (
        <AccountRootCreateForm organizationId={organizationId} />
      )}
    </div>
  );
}

function AccountRootCreateForm({ organizationId }: { organizationId: string }) {
  const client = useQueryClient();
  const { showToast } = useToast();
  const form = useForm<RootValues>({
    resolver: zodResolver(rootSchema),
    defaultValues: { code: '', title: '', accountNature: 'DUAL' },
  });
  const mutation = useMutation({
    mutationFn: (values: RootValues) =>
      createAccount({
        organizationId,
        code: values.code.trim(),
        title: values.title.trim(),
        accountNature: values.accountNature,
      }),
    onSuccess: async () => {
      form.reset();
      await Promise.all([
        client.invalidateQueries({
          queryKey: queryKeys.accounting.accountPrefix(organizationId),
        }),
        client.invalidateQueries({
          queryKey: queryKeys.accounting.chartTree(organizationId),
        }),
      ]);
      showToast({ kind: 'success', message: t.masterData.accountCreated });
    },
  });
  return (
    <Card>
      <CardContent>
        <form
          noValidate
          className="space-y-4"
          onSubmit={form.handleSubmit((values) => {
            if (!mutation.isPending) mutation.mutate(values);
          })}
        >
          <p className="text-sm text-ink-muted">
            {t.accountAdmin.rootOnlyHint}
          </p>
          <FormField
            id="root-code"
            label={t.masterData.fullCode}
            error={form.formState.errors.code?.message}
            required
          >
            {(props) => (
              <Input {...props} dir="ltr" {...form.register('code')} />
            )}
          </FormField>
          <FormField
            id="root-title"
            label={t.masterData.accountTitle}
            error={form.formState.errors.title?.message}
            required
          >
            {(props) => (
              <Input {...props} maxLength={200} {...form.register('title')} />
            )}
          </FormField>
          <FormField id="root-nature" label={t.masterData.nature} required>
            {(props) => (
              <Select {...props} {...form.register('accountNature')}>
                <option value="DEBIT">{t.masterData.natureDebit}</option>
                <option value="CREDIT">{t.masterData.natureCredit}</option>
                <option value="DUAL">{t.masterData.natureDual}</option>
              </Select>
            )}
          </FormField>
          {mutation.isError && <ApiErrorAlert error={mutation.error} />}
          <Button
            type="submit"
            disabled={mutation.isPending}
            loading={mutation.isPending}
          >
            {t.masterData.createAccount}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
