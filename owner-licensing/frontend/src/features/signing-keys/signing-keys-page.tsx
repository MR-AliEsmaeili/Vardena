import { LocalFetchingIndicator } from '@/ui/patterns/request-activity';
import { Select } from '@/ui/select';
import { PageHeading } from '@/ui/patterns/page-heading';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { formatOwnerInstant } from '@/lib/date-time';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import * as api from '@/api/owner.api';
import type { SigningKey } from '@/api/contracts';
import { usePermissions } from '@/features/permissions/use-permissions';
import { o } from '@/lib/owner-i18n';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Textarea } from '@/ui/textarea';
import { FormField } from '@/ui/patterns/form-field';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { EmptyState, LoadingState } from '@/ui/patterns/states';
import { Pagination, useDirtyGuard } from '@/ui/patterns/owner-states';

/** Administrative metadata only; replacement generation/trust rollout are external. */
const idSchema = z
  .string()
  .min(1, o.signingKeyInvalidId)
  .max(120, o.signingKeyInvalidId)
  .regex(/^[^\s]+$/, o.signingKeyInvalidId)
  .refine((v) => !unsafeMetadata(v), o.signingKeyInvalidId);
function unsafeMetadata(v: string) {
  return (
    /[\p{Cc}\p{Cf}]/u.test(v) ||
    /PRIVATE KEY|-----BEGIN |VLIC1|VLIC2|VDEA1|VDRQ1|VDRP1/i.test(v)
  );
}
const safeText = (max: number) =>
  z
    .string()
    .max(max)
    .refine((v) => !unsafeMetadata(v), o.evidenceHint);
const labelSchema = safeText(200).pipe(z.string().trim().min(1, o.required));
const notesSchema = safeText(2000).optional();
const evidenceSchema = safeText(200).optional();
const reasonSchema = safeText(500).pipe(z.string().trim().min(1, o.required));

const registerSchema = z.object({
  id: idSchema,
  label: labelSchema,
  notes: notesSchema,
  evidenceReference: evidenceSchema,
});

const statusChangeSchema = z.object({
  status: z.enum(['ACTIVE', 'COMPROMISED', 'REVOKED']),
  reason: reasonSchema,
  evidenceReference: evidenceSchema,
});

export function SigningKeysPage() {
  const permissions = usePermissions();
  const [params, setParams] = useSearchParams();
  const search = params.get('search') ?? '';
  const status = params.get('status') ?? '';
  const debounced = useDebouncedValue(search, 300);
  const [saved, setSaved] = useState(false);
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [selected, setSelected] = useState<SigningKey | null>(null);
  const query = useQuery({
    queryKey: ['owner', 'signing-keys', debounced, status, page],
    queryFn: ({ signal }) =>
      api.signingKeys(debounced, page, status ? { status } : {}, signal),
    enabled: permissions.has('customers.view'),
  });
  const setFilter = (next: Record<string, string>) =>
    setParams({ search, status, page: '1', ...next });
  if (!permissions.loaded) return <LoadingState />;
  if (!permissions.has('customers.view'))
    return (
      <p className="owner-panel p-4 text-sm text-secondary">{o.forbidden}</p>
    );
  const canMutate = permissions.has('customers.write');
  return (
    <section className="space-y-5">
      <header className="space-y-2">
        <PageHeading>{o.signingKeys}</PageHeading>
        <p className="text-sm text-secondary">{o.signingKeysHelp}</p>
      </header>
      {saved && (
        <output className="owner-success">
          {o.signingKeyStatusChangeSuccess}
        </output>
      )}
      {canMutate && <RegisterKeyForm />}
      <div className="owner-toolbar sm:grid-cols-2">
        <label className="block space-y-2">
          <span>{o.search}</span>
          <Input
            value={search}
            maxLength={100}
            onChange={(event) =>
              setFilter({ search: event.target.value, page: '1' })
            }
          />
        </label>
        <label className="block space-y-2">
          <span>{o.signingKeyStatus}</span>
          <Select
            value={status}
            onChange={(event) => setFilter({ status: event.target.value })}
          >
            <option value="">{o.all}</option>
            <option value="ACTIVE">{o.signingKeyStatusActive}</option>
            <option value="COMPROMISED">{o.signingKeyStatusCompromised}</option>
            <option value="REVOKED">{o.signingKeyStatusRevoked}</option>
          </Select>
        </label>
      </div>
      <LocalFetchingIndicator active={query.isFetching && !query.isPending} />
      {query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ApiErrorAlert
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : query.data.items.length === 0 ? (
        <EmptyState
          title={search || status ? o.noResults : o.signingKeyEmpty}
          description={o.signingKeyEmptyHelp}
        />
      ) : (
        <ul className="divide-y owner-panel">
          {query.data.items.map((key) => (
            <li key={key.id} className="space-y-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="font-semibold">{key.label}</p>
                  <p className="code text-xs text-muted-ink" dir="ltr">
                    {key.id}
                  </p>
                </div>
                <StatusBadge status={key.status} />
              </div>
              <p className="text-xs">
                {o.created}:{' '}
                <time dateTime={key.createdAt} title={key.createdAt}>
                  {formatOwnerInstant(key.createdAt)}
                </time>
              </p>
              <p className="text-xs">
                {o.updated}:{' '}
                <time dateTime={key.updatedAt} title={key.updatedAt}>
                  {formatOwnerInstant(key.updatedAt)}
                </time>
              </p>
              <p className="text-xs">
                {o.actor}: <span dir="ltr">{key.updatedBy}</span>
              </p>
              {key.statusReason && (
                <p className="text-sm">
                  <span className="text-muted-ink">{o.signingKeyReason}: </span>
                  {key.statusReason}
                </p>
              )}
              {key.statusDetectedAt && (
                <p className="text-xs text-muted-ink">
                  {o.signingKeyDetectedAt}:{' '}
                  <time
                    dateTime={key.statusDetectedAt}
                    title={key.statusDetectedAt}
                  >
                    {formatOwnerInstant(key.statusDetectedAt)}
                  </time>
                </p>
              )}
              {key.evidenceRef && (
                <p className="text-xs text-muted-ink" dir="ltr">
                  {key.evidenceRef}
                </p>
              )}
              {key.notes && (
                <p className="whitespace-pre-wrap text-sm text-secondary">
                  {key.notes}
                </p>
              )}
              {canMutate && <NotesForm signingKey={key} />}
              {canMutate && (
                <Button variant="outline" onClick={() => setSelected(key)}>
                  {o.signingKeyStatus}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Pagination
        page={page}
        count={query.data?.items.length ?? 0}
        setPage={(p) => setParams({ search, status, page: String(p) })}
      />
      {selected && canMutate && (
        <StatusChangeForm
          key={selected.id}
          signingKey={selected}
          onDone={() => {
            setSelected(null);
            setSaved(true);
          }}
        />
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: SigningKey['status'] }) {
  const variants: Record<
    SigningKey['status'],
    'success' | 'critical' | 'danger'
  > = {
    ACTIVE: 'success',
    COMPROMISED: 'critical',
    REVOKED: 'danger',
  };
  const label: Record<SigningKey['status'], string> = {
    ACTIVE: o.signingKeyStatusActive,
    COMPROMISED: o.signingKeyStatusCompromised,
    REVOKED: o.signingKeyStatusRevoked,
  };
  return <Badge variant={variants[status]}>{label[status]}</Badge>;
}

function RegisterKeyForm() {
  const qc = useQueryClient();
  const form = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { id: '', label: '', notes: '', evidenceReference: '' },
  });
  useDirtyGuard(form.formState.isDirty);
  const mutation = useMutation({
    mutationFn: (v: z.infer<typeof registerSchema>) => {
      // Strip empty optionals to satisfy exactOptionalPropertyTypes.
      const payload: Parameters<typeof api.registerSigningKey>[0] = {
        id: v.id,
        label: v.label,
      };
      if (v.notes) payload.notes = v.notes;
      if (v.evidenceReference) payload.evidenceReference = v.evidenceReference;
      return api.registerSigningKey(payload);
    },
    onSuccess: async () => {
      form.reset();
      await qc.invalidateQueries({ queryKey: ['owner', 'signing-keys'] });
    },
  });
  return (
    <form
      className="max-w-xl space-y-3 owner-panel p-4"
      onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
    >
      <h2 className="font-semibold">{o.signingKeyRegister}</h2>
      <FormField
        id="new-signing-key-id"
        label={o.signingKeyIdLabel}
        error={form.formState.errors.id?.message}
        hint={o.signingKeyIdHint}
      >
        {(props) => (
          <Input
            {...props}
            {...form.register('id')}
            aria-required
            dir="ltr"
            autoComplete="off"
          />
        )}
      </FormField>
      <FormField
        id="new-signing-key-label"
        label={o.signingKeyLabelField}
        error={form.formState.errors.label?.message}
      >
        {(props) => (
          <Input {...props} {...form.register('label')} aria-required />
        )}
      </FormField>
      <FormField
        id="new-signing-key-notes"
        label={o.signingKeyNotesField}
        error={form.formState.errors.notes?.message}
      >
        {(props) => (
          <Textarea {...props} {...form.register('notes')} rows={3} />
        )}
      </FormField>
      <FormField
        id="new-signing-key-evidence"
        label={o.signingKeyEvidenceField}
        error={form.formState.errors.evidenceReference?.message}
      >
        {(props) => (
          <Input {...props} {...form.register('evidenceReference')} dir="ltr" />
        )}
      </FormField>
      {mutation.isError && <ApiErrorAlert error={mutation.error} />}
      {mutation.isSuccess && (
        <output className="owner-success">{o.signingKeyRegisterSuccess}</output>
      )}
      <Button loading={mutation.isPending} disabled={mutation.isPending}>
        {mutation.isPending ? o.saving : o.signingKeyRegister}
      </Button>
    </form>
  );
}

function StatusChangeForm({
  signingKey,
  onDone,
}: {
  signingKey: SigningKey;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const form = useForm<z.infer<typeof statusChangeSchema>>({
    resolver: zodResolver(statusChangeSchema),
    defaultValues: {
      status: signingKey.status === 'ACTIVE' ? 'COMPROMISED' : 'ACTIVE',
      reason: '',
      evidenceReference: '',
    },
  });
  useDirtyGuard(form.formState.isDirty);
  const mutation = useMutation({
    mutationFn: (v: z.infer<typeof statusChangeSchema>) => {
      const payload: Parameters<typeof api.updateSigningKeyStatus>[1] = {
        status: v.status,
        reason: v.reason,
      };
      if (v.evidenceReference) payload.evidenceReference = v.evidenceReference;
      return api.updateSigningKeyStatus(signingKey.id, payload);
    },
    onSuccess: async () => {
      form.reset();
      await qc.invalidateQueries({ queryKey: ['owner', 'signing-keys'] });
      await qc.invalidateQueries({ queryKey: ['owner', 'operations'] });
      await qc.invalidateQueries({ queryKey: ['owner', 'operation'] });
      onDone();
    },
  });
  return (
    <form
      className="space-y-3 owner-panel p-4"
      onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
    >
      <h2 className="font-semibold">
        {signingKey.label}{' '}
        <span className="code text-xs text-muted-ink" dir="ltr">
          ({signingKey.id})
        </span>
      </h2>
      <p className="text-sm text-muted-ink">
        {o.signingKeyStatus}: {signingKey.status}
      </p>
      <label className="block space-y-2">
        <span>{o.signingKeyStatus}</span>
        <Select {...form.register('status')}>
          <option value="ACTIVE">{o.signingKeyMarkActive}</option>
          <option value="COMPROMISED">{o.signingKeyMarkCompromised}</option>
          <option value="REVOKED">{o.signingKeyMarkRevoked}</option>
        </Select>
      </label>
      <FormField
        id="status-change-reason"
        label={o.signingKeyStatusChangeReason}
        error={form.formState.errors.reason?.message}
      >
        {(props) => (
          <Input {...props} {...form.register('reason')} aria-required />
        )}
      </FormField>
      <FormField
        id="status-change-evidence"
        label={o.signingKeyEvidenceField}
        error={form.formState.errors.evidenceReference?.message}
      >
        {(props) => (
          <Input {...props} {...form.register('evidenceReference')} dir="ltr" />
        )}
      </FormField>
      {mutation.isError && <ApiErrorAlert error={mutation.error} />}
      {mutation.isSuccess && (
        <output className="owner-success">
          {o.signingKeyStatusChangeSuccess}
        </output>
      )}
      <Button loading={mutation.isPending} disabled={mutation.isPending}>
        {mutation.isPending ? o.saving : o.save}
      </Button>
    </form>
  );
}

function NotesForm({ signingKey }: { signingKey: SigningKey }) {
  const qc = useQueryClient();
  const form = useForm<{ notes: string }>({
    resolver: zodResolver(z.object({ notes: safeText(2000) })),
    defaultValues: { notes: signingKey.notes ?? '' },
  });
  useDirtyGuard(form.formState.isDirty);
  const mutation = useMutation({
    mutationFn: (values: { notes: string }) =>
      api.updateSigningKeyNotes(signingKey.id, values),
    onSuccess: async (updated) => {
      form.reset({ notes: updated.notes ?? '' });
      await qc.invalidateQueries({ queryKey: ['owner', 'signing-keys'] });
    },
  });
  return (
    <form
      className="space-y-2"
      onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
    >
      <FormField
        id={`notes-${signingKey.id}`}
        label={o.signingKeyNotesField}
        error={form.formState.errors.notes?.message}
      >
        {(props) => <Input {...props} {...form.register('notes')} />}
      </FormField>
      {mutation.isError && <ApiErrorAlert error={mutation.error} />}
      {mutation.isSuccess && (
        <output className="owner-success">{o.success}</output>
      )}
      <Button loading={mutation.isPending} disabled={mutation.isPending}>
        {o.save}
      </Button>
    </form>
  );
}
