import { Select } from '@/ui/select';
import { PageHeading } from '@/ui/patterns/page-heading';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as api from '@/api/owner.api';
import type { CustomerRead } from '@/api/contracts';
import { usePermissions } from '@/features/permissions/use-permissions';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { o } from '@/lib/owner-i18n';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { DateInput } from '@/ui/patterns/date-input';
import { FormField } from '@/ui/patterns/form-field';
import { LoadingState } from '@/ui/patterns/states';
import { useDirtyGuard } from '@/ui/patterns/owner-states';
import {
  licenseObservationSchema,
  replacementSchema,
  type LicenseObservationValues,
  type ReplacementValues,
} from './operation-schema';
import { ManualNotice, OperationError } from './operation-ui';

function CustomerPicker({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (id: string) => void;
  error?: string | undefined;
}) {
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search, 300);
  const query = useQuery({
    queryKey: ['owner', 'customers', debounced, 1, 'operation-picker'],
    queryFn: ({ signal }) => api.customers(debounced, 1, signal),
    enabled: debounced.trim().length > 0,
  });
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{o.customerPick}</legend>
      <p className="text-xs text-muted-ink">{o.customerPickHint}</p>
      <Input
        value={search}
        maxLength={100}
        aria-label={o.customerSearch}
        onChange={(event) => setSearch(event.target.value)}
      />
      {query.isPending && debounced ? <LoadingState rows={1} /> : null}
      {query.isError ? <OperationError error={query.error} /> : null}
      <div role="radiogroup" aria-label={o.customerPick} className="space-y-2">
        {query.data?.items.map((customer: CustomerRead) => (
          <label key={customer.id} className="flex items-center gap-2">
            <input
              type="radio"
              name="customerId"
              value={customer.id}
              checked={value === customer.id}
              onChange={() => onChange(customer.id)}
            />
            <span>
              {customer.displayName}{' '}
              <span className="code" dir="ltr">
                {customer.customerCode}
              </span>
            </span>
          </label>
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
function Acknowledge({
  form,
}: {
  form: UseFormReturn<{ acknowledged: boolean }>;
}) {
  return (
    <label className="flex items-start gap-2">
      <input
        type="checkbox"
        className="mt-1"
        aria-required="true"
        {...form.register('acknowledged')}
      />
      <span>{o.confirmObservation}</span>
    </label>
  );
}
function withEvidence<T extends { evidenceReference: string }>(values: T) {
  const evidence = values.evidenceReference.trim();
  const { evidenceReference: _ignored, ...rest } = values;
  return evidence ? { ...rest, evidenceReference: evidence } : rest;
}

export function ActivationFormPage() {
  const permissions = usePermissions();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const form = useForm<LicenseObservationValues>({
    resolver: zodResolver(licenseObservationSchema),
    defaultValues: {
      customerId: '',
      installationReference: '',
      reason: '',
      evidenceReference: '',
      observedValidityEnd: '',
      signingKeyId: '',
      acknowledged: false,
    },
  });
  useDirtyGuard(form.formState.isDirty);
  const mutation = useMutation({
    mutationFn: (values: LicenseObservationValues) =>
      api.recordLicenseObservation({
        ...withEvidence({
          customerId: values.customerId,
          installationReference: values.installationReference,
          reason: values.reason,
          evidenceReference: values.evidenceReference,
        }),
        ...(values.signingKeyId ? { signingKeyId: values.signingKeyId } : {}),
        // The recording day is never sent: the server derives it from the
        // immutable record instant (PDR-18 §1.2, PDR-17).
        ...(values.observedValidityEnd.trim()
          ? { observedValidityEnd: values.observedValidityEnd.trim() }
          : {}),
      }),
    onSuccess: async (record) => {
      form.reset();
      qc.setQueryData(['owner', 'operation', record.id], record);
      await qc.invalidateQueries({ queryKey: ['owner', 'operations'] });
      navigate(`/app/operations/${record.id}`, {
        replace: true,
        state: { saved: true },
      });
    },
  });
  if (!permissions.loaded) return <LoadingState />;
  if (
    !permissions.has('operations.record') ||
    !permissions.has('customers.view')
  )
    return (
      <p className="owner-panel p-4 text-sm text-secondary">{o.forbidden}</p>
    );
  return (
    <section className="max-w-2xl space-y-4">
      <PageHeading>{o.recordIssuance}</PageHeading>
      <ManualNotice />
      <p className="text-sm">{o.notReceipt}</p>
      <form
        className="space-y-4 owner-panel p-5"
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      >
        <CustomerPicker
          value={form.watch('customerId')}
          onChange={(id) =>
            form.setValue('customerId', id, { shouldValidate: true })
          }
          error={form.formState.errors.customerId?.message}
        />
        <SigningKeyPicker
          value={form.watch('signingKeyId')}
          onChange={(value) =>
            form.setValue('signingKeyId', value, {
              shouldDirty: true,
              shouldValidate: true,
            })
          }
        />
        <FormField
          id="installationReference"
          label={o.installation}
          error={form.formState.errors.installationReference?.message}
        >
          {(props) => (
            <Input
              {...props}
              {...form.register('installationReference')}
              dir="ltr"
              aria-required="true"
            />
          )}
        </FormField>
        <FormField
          id="reason"
          label={o.reason}
          error={form.formState.errors.reason?.message}
        >
          {(props) => (
            <Input
              {...props}
              {...form.register('reason')}
              aria-required="true"
            />
          )}
        </FormField>
        <FormField
          id="evidenceReference"
          label={o.evidence}
          hint={o.evidenceHint}
          error={form.formState.errors.evidenceReference?.message}
        >
          {(props) => (
            <Input
              {...props}
              {...form.register('evidenceReference')}
              dir="ltr"
            />
          )}
        </FormField>
        <fieldset className="space-y-3 rounded border p-3">
          <legend className="px-1 text-sm font-semibold">
            {o.observationDatesTitle}
          </legend>
          <p className="text-sm text-muted-ink">{o.observationDatesHelp}</p>
          <FormField
            id="observedValidityEnd"
            label={o.observedValidityEnd}
            error={form.formState.errors.observedValidityEnd?.message}
          >
            {(props) => (
              <DateInput
                {...props}
                value={form.watch('observedValidityEnd')}
                onChange={(value) =>
                  form.setValue('observedValidityEnd', value, {
                    shouldValidate: true,
                  })
                }
              />
            )}
          </FormField>
        </fieldset>
        <Acknowledge
          form={form as unknown as UseFormReturn<{ acknowledged: boolean }>}
        />
        {form.formState.errors.acknowledged ? (
          <p role="alert" className="text-xs text-danger">
            {form.formState.errors.acknowledged.message}
          </p>
        ) : null}
        {mutation.isError ? <OperationError error={mutation.error} /> : null}
        <div className="flex flex-wrap gap-3">
          <Button
            type="submit"
            loading={mutation.isPending}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? o.saving : o.recordIssuance}
          </Button>
          <Button asChild variant="outline">
            <Link to="/app/operations">{o.cancel}</Link>
          </Button>
        </div>
      </form>
    </section>
  );
}

export function ReplacementFormPage() {
  const permissions = usePermissions();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const form = useForm<ReplacementValues>({
    resolver: zodResolver(replacementSchema),
    defaultValues: {
      customerId: '',
      oldInstallationReference: '',
      replacementInstallationReference: '',
      reason: '',
      evidenceReference: '',
      emergencyOldServerLost: false,
      acknowledged: false,
    },
  });
  useDirtyGuard(form.formState.isDirty);
  const mutation = useMutation({
    mutationFn: (values: ReplacementValues) =>
      api.recordServerReplacement(
        withEvidence({
          customerId: values.customerId,
          oldInstallationReference: values.oldInstallationReference,
          replacementInstallationReference:
            values.replacementInstallationReference,
          reason: values.reason,
          evidenceReference: values.evidenceReference,
          emergencyOldServerLost: values.emergencyOldServerLost,
        }),
      ),
    onSuccess: async (record) => {
      form.reset();
      qc.setQueryData(['owner', 'operation', record.id], record);
      await qc.invalidateQueries({ queryKey: ['owner', 'operations'] });
      navigate(`/app/operations/${record.id}`, {
        replace: true,
        state: { saved: true },
      });
    },
  });
  if (!permissions.loaded) return <LoadingState />;
  if (
    !permissions.has('replacements.authorize') ||
    !permissions.has('customers.view')
  )
    return (
      <p className="owner-panel p-4 text-sm text-secondary">{o.forbidden}</p>
    );
  return (
    <section className="max-w-2xl space-y-4">
      <PageHeading>{o.recordReplacement}</PageHeading>
      <ManualNotice />
      <div className="owner-panel p-4 text-sm">
        <h2 className="font-semibold">{o.sequenceTitle}</h2>
        <ol className="mt-2 list-decimal space-y-1 pe-5">
          <li>تصمیم مجاز برای همان مشتری ثبت می‌شود.</li>
          <li>{o.notEnforcement}</li>
          <li>{o.emergencyHelp}</li>
          <li>مشاهده نصب جایگزین فقط پس از وضعیت سرور قدیم ثبت می‌شود.</li>
        </ol>
      </div>
      <form
        className="space-y-4 owner-panel p-5"
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      >
        <CustomerPicker
          value={form.watch('customerId')}
          onChange={(id) =>
            form.setValue('customerId', id, { shouldValidate: true })
          }
          error={form.formState.errors.customerId?.message}
        />
        {(
          [
            ['oldInstallationReference', o.oldInstallation],
            ['replacementInstallationReference', o.newInstallation],
            ['reason', o.reason],
            ['evidenceReference', o.evidence],
          ] as const
        ).map(([key, label]) => (
          <FormField
            key={key}
            id={key}
            label={label}
            hint={key === 'evidenceReference' ? o.evidenceHint : undefined}
            error={form.formState.errors[key]?.message}
          >
            {(props) => (
              <Input
                {...props}
                {...form.register(key)}
                dir={key === 'reason' ? 'auto' : 'ltr'}
                aria-required={key !== 'evidenceReference'}
              />
            )}
          </FormField>
        ))}
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-1"
            {...form.register('emergencyOldServerLost')}
          />
          <span>{o.emergency}</span>
        </label>
        <Acknowledge
          form={form as unknown as UseFormReturn<{ acknowledged: boolean }>}
        />
        {form.formState.errors.acknowledged ? (
          <p role="alert" className="text-xs text-danger">
            {form.formState.errors.acknowledged.message}
          </p>
        ) : null}
        {mutation.isError ? <OperationError error={mutation.error} /> : null}
        <div className="flex flex-wrap gap-3">
          <Button
            type="submit"
            loading={mutation.isPending}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? o.saving : o.recordReplacement}
          </Button>
          <Button asChild variant="outline">
            <Link to="/app/operations">{o.cancel}</Link>
          </Button>
        </div>
      </form>
    </section>
  );
}

/** No automatic key choice. Historical mode explicitly includes non-active keys. */
function SigningKeyPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [historical, setHistorical] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebouncedValue(search, 300);
  const query = useQuery({
    queryKey: ['owner', 'signing-keys', 'picker', debounced, page, historical],
    queryFn: ({ signal }) =>
      api.signingKeys(
        debounced,
        page,
        historical ? {} : { status: 'ACTIVE' },
        signal,
      ),
  });
  return (
    <fieldset className="space-y-2 rounded border p-3">
      <legend>{o.signingKeyId}</legend>
      <p>{o.signingKeyObservationHelp}</p>
      <label className="block">
        <input
          type="checkbox"
          checked={historical}
          onChange={(e) => {
            setHistorical(e.target.checked);
            setPage(1);
            onChange('');
          }}
        />{' '}
        {o.signingKeyHistorical}
      </label>
      <label className="block">
        {o.search}
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </label>
      {query.isPending ? (
        <LoadingState rows={1} />
      ) : query.isError ? (
        <OperationError error={query.error} />
      ) : (
        <>
          <label className="block">
            {o.signingKeyLinkedTo}
            <Select value={value} onChange={(e) => onChange(e.target.value)}>
              <option value="">{o.signingKeyNoLinked}</option>
              {query.data.items.map((key) => (
                <option key={key.id} value={key.id}>
                  {key.label} ({key.id}) — {key.status}
                </option>
              ))}
              {value && !query.data.items.some((key) => key.id === value) && (
                <option value={value}>{value}</option>
              )}
            </Select>
          </label>
          {!query.data.items.length && <p>{o.signingKeyEmpty}</p>}
          <Button
            type="button"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            {o.previous}
          </Button>
          <Button
            type="button"
            disabled={page * 50 >= (query.data.total ?? 0)}
            onClick={() => setPage(page + 1)}
          >
            {o.next}
          </Button>
        </>
      )}
    </fieldset>
  );
}
