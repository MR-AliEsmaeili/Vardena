import { Select } from '@/ui/select';
import { PageHeading } from '@/ui/patterns/page-heading';
import { formatOwnerBusinessDay, formatOwnerInstant } from '@/lib/date-time';
import { Link, useNavigate, useParams, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as api from '@/api/owner.api';
import type { Customer } from '@/api/contracts';
import { usePermissions } from '@/features/permissions/use-permissions';
import { auditTrailHref } from '@/features/audit/audit-filters';
import { o } from '@/lib/owner-i18n';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { DateInput } from '@/ui/patterns/date-input';
import { FormField } from '@/ui/patterns/form-field';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { LoadingState } from '@/ui/patterns/states';
import { useDirtyGuard } from '@/ui/patterns/owner-states';
import { customerSchema, type CustomerValues } from './customer-schema';
import { InstallationIdentities } from './installation-identities';
import { LimitProfiles } from './limit-profiles';

export function CustomerPage({ mode }: { mode: 'new' | 'detail' | 'edit' }) {
  const { id = '' } = useParams();
  const location = useLocation();
  const permissions = usePermissions();
  const query = useQuery({
    queryKey: ['owner', 'customer', id],
    queryFn: ({ signal }) => api.customer(id, signal),
    enabled: mode !== 'new' && permissions.has('customers.view'),
  });
  if (!permissions.loaded) return <LoadingState />;
  if (
    !permissions.has(mode === 'detail' ? 'customers.view' : 'customers.write')
  )
    return (
      <p className="owner-panel p-4 text-sm text-secondary">{o.forbidden}</p>
    );
  if (mode === 'new') return <CustomerForm />;
  if (query.isPending) return <LoadingState />;
  if (query.isError)
    return (
      <ApiErrorAlert error={query.error} onRetry={() => void query.refetch()} />
    );
  const c = query.data;
  if (mode === 'edit')
    return 'contractReference' in c ? (
      <CustomerForm customer={c} />
    ) : (
      <p className="owner-panel p-4 text-sm text-secondary">{o.forbidden}</p>
    );
  return (
    <section className="space-y-4">
      <PageHeading>{c.displayName}</PageHeading>
      {!!(location.state as { saved?: boolean } | null)?.saved && (
        <output className="owner-success">{o.success}</output>
      )}
      <dl className="grid gap-3 owner-panel p-4 sm:grid-cols-2">
        {[
          [o.id, c.id],
          [o.code, c.customerCode],
          [o.status, c.status === 'ACTIVE' ? o.active : o.inactive],
          ...('contractReference' in c
            ? [
                [o.reference, c.contractReference],
                [
                  o.contractStartDate,
                  formatOwnerBusinessDay(c.contractStartDate),
                  c.contractStartDate,
                ],
                [
                  o.contractEndDate,
                  formatOwnerBusinessDay(c.contractEndDate),
                  c.contractEndDate,
                ],
                [o.created, formatOwnerInstant(c.createdAt), c.createdAt],
                [o.updated, formatOwnerInstant(c.updatedAt), c.updatedAt],
              ]
            : []),
        ].map(([label, value, canonical]) => (
          <div key={label}>
            <dt className="text-sm text-muted-ink">{label}</dt>
            <dd title={canonical ?? undefined} className="break-all" dir="auto">
              {value || '—'}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-muted-ink">{o.immutable}</p>
      <p className="text-sm text-muted-ink">{o.contractDatesHelp}</p>
      <div className="flex flex-wrap gap-3">
        {permissions.has('licenses.view') && (
          <Button asChild>
            <Link to={`/app/licenses?customer=${id}`}>
              {o.customerLicenses}
            </Link>
          </Button>
        )}
        {permissions.has('licenses.issue.time_limited') && (
          <Button asChild variant="outline">
            <Link to={`/app/licenses?customer=${id}`}>
              {o.issueForCustomer}
            </Link>
          </Button>
        )}
        {permissions.has('customers.write') && (
          <Button asChild variant="outline">
            <Link to={`/app/customers/${id}/edit`}>{o.edit}</Link>
          </Button>
        )}
        {permissions.has('audit.view') ? (
          <Button asChild variant="outline">
            <Link to={auditTrailHref('Customer', c.id)}>
              {o.auditCustomerLink}
            </Link>
          </Button>
        ) : null}
        <Button asChild variant="outline">
          <Link to="/app/customers">{o.back}</Link>
        </Button>
      </div>
      {permissions.has('licenses.view') ? (
        <>
          <InstallationIdentities customerId={c.id} />
          <LimitProfiles customerId={c.id} />
        </>
      ) : null}
    </section>
  );
}
function CustomerForm({ customer }: { customer?: Customer }) {
  const navigate = useNavigate(),
    qc = useQueryClient();
  const form = useForm<CustomerValues>({
    resolver: zodResolver(customerSchema),
    defaultValues: {
      customerCode: customer?.customerCode ?? '',
      displayName: customer?.displayName ?? '',
      status: customer?.status ?? 'ACTIVE',
      contractReference: customer?.contractReference ?? '',
      contractStartDate: customer?.contractStartDate ?? '',
      contractEndDate: customer?.contractEndDate ?? '',
      reason: '',
    },
  });
  useDirtyGuard(form.formState.isDirty);
  const mutation = useMutation({
    mutationFn: async (v: CustomerValues) => {
      if (customer) {
        if (!v.reason.trim()) {
          form.setError('reason', { message: o.required });
          throw new Error(o.required);
        }
        return api.updateCustomer(customer.id, {
          displayName: v.displayName,
          status: v.status,
          contractReference: v.contractReference,
          contractStartDate: v.contractStartDate,
          contractEndDate: v.contractEndDate,
          reason: v.reason,
        });
      }
      const { reason: _reason, ...input } = v;
      return api.createCustomer(input);
    },
    onSuccess: async (c) => {
      form.reset();
      qc.setQueryData(['owner', 'customer', c.id], c);
      await qc.invalidateQueries({ queryKey: ['owner', 'customers'] });
      navigate(`/app/customers/${c.id}`, {
        replace: true,
        state: { saved: true },
      });
    },
  });
  return (
    <section className="max-w-2xl space-y-4">
      <PageHeading>{customer ? o.edit : o.newCustomer}</PageHeading>
      <form
        onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
        className="space-y-4 owner-panel p-5"
      >
        {(
          [
            'customerCode',
            'displayName',
            'contractReference',
            ...(customer ? (['reason'] as const) : []),
          ] as const
        ).map((key) => (
          <FormField
            key={key}
            id={key}
            label={
              {
                customerCode: o.code,
                displayName: o.name,
                contractReference: o.reference,
                reason: o.reason,
              }[key]
            }
            error={form.formState.errors[key]?.message}
          >
            {(props) => (
              <Input
                {...props}
                {...form.register(key)}
                readOnly={key === 'customerCode' && !!customer}
                aria-required={key !== 'contractReference'}
                dir={key === 'customerCode' ? 'ltr' : 'auto'}
              />
            )}
          </FormField>
        ))}
        <fieldset className="space-y-3 rounded border p-3">
          <legend className="px-1 text-sm font-semibold">
            {o.contractDatesTitle}
          </legend>
          <p className="text-sm text-muted-ink">{o.contractDatesHelp}</p>
          {(['contractStartDate', 'contractEndDate'] as const).map((key) => (
            <FormField
              key={key}
              id={key}
              label={
                key === 'contractStartDate'
                  ? o.contractStartDate
                  : o.contractEndDate
              }
              error={form.formState.errors[key]?.message}
            >
              {(props) => (
                <DateInput
                  {...props}
                  value={form.watch(key)}
                  onChange={(value) =>
                    form.setValue(key, value, { shouldValidate: true })
                  }
                />
              )}
            </FormField>
          ))}
        </fieldset>
        <label className="block space-y-2">
          <span>{o.status}</span>
          <Select {...form.register('status')}>
            <option value="ACTIVE">{o.active}</option>
            <option value="INACTIVE">{o.inactive}</option>
          </Select>
        </label>
        {mutation.isError && <ApiErrorAlert error={mutation.error} />}
        <div className="flex flex-wrap gap-3">
          <Button
            type="submit"
            loading={mutation.isPending}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? o.saving : o.save}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (!form.formState.isDirty || window.confirm(o.confirmDirty))
                navigate(
                  customer ? `/app/customers/${customer.id}` : '/app/customers',
                );
            }}
          >
            {o.cancel}
          </Button>
        </div>
      </form>
    </section>
  );
}
