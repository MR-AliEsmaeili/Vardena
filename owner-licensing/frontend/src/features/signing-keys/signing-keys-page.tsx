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
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { FormField } from '@/ui/patterns/form-field';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { EmptyState, LoadingState } from '@/ui/patterns/states';
import { Pagination, useDirtyGuard } from '@/ui/patterns/owner-states';

/**
 * OQ-74 (Product Owner decision 2026-10-18): signing-key tracking.
 *
 * The Owner app is observational (PDR-17: cryptographic issuance is "not
 * implemented" here). This page manages the administrative record of which
 * signing keys exist and their current status (ACTIVE/COMPROMISED/REVOKED).
 * The customer runtime remains the authority for actual signature
 * verification — this page only records what the Owner observed and decided.
 *
 * Key compromise response (per the Product Owner decision):
 *   1. A new key is generated outside this app (keygen tool) and added to the
 *      customer runtime's trust list; the compromised key is removed from
 *      that trust list. Future licenses are issued with the new key.
 *   2. Marking a key as COMPROMISED here does NOT automatically invalidate
 *      any already-issued license. The Owner reviews affected licenses case
 *      by case (visible on the operations page with safety status
 *      NEEDS_REVIEW).
 *   3. REVOKED is for explicit administrative revocation separate from
 *      compromise (e.g. routine rotation). It also surfaces licenses as
 *      NEEDS_REVIEW.
 */

const idSchema = z
  .string()
  .trim()
  .min(1, o.signingKeyInvalidId)
  .max(120, o.signingKeyInvalidId)
  .regex(/^[^\s]+$/, o.signingKeyInvalidId);
const labelSchema = z.string().trim().min(1, o.required).max(200);
const notesSchema = z.string().trim().max(2000).optional();
const evidenceSchema = z.string().trim().max(200).optional();
const reasonSchema = z.string().trim().min(1, o.required).max(500);

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
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [selected, setSelected] = useState<SigningKey | null>(null);
  const query = useQuery({
    queryKey: ['owner', 'signing-keys', search, status, page],
    queryFn: ({ signal }) =>
      api.signingKeys(search, page, status ? { status } : {}, signal),
    enabled: permissions.has('customers.view'),
  });
  const setFilter = (next: Record<string, string>) =>
    setParams({ search, status, page: '1', ...next });
  if (!permissions.loaded) return <LoadingState />;
  if (!permissions.has('customers.view')) return <p>{o.forbidden}</p>;
  const canMutate = permissions.has('customers.write');
  return (
    <section className="space-y-5">
      <header className="space-y-2">
        <h1 className="text-xl font-bold">{o.signingKeys}</h1>
        <p className="text-sm text-slate-600">{o.signingKeysHelp}</p>
      </header>
      {canMutate && <RegisterKeyForm />}
      <div className="grid gap-3 sm:grid-cols-2">
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
          <select
            className="w-full rounded border p-2"
            value={status}
            onChange={(event) => setFilter({ status: event.target.value })}
          >
            <option value="">{o.all}</option>
            <option value="ACTIVE">{o.signingKeyStatusActive}</option>
            <option value="COMPROMISED">{o.signingKeyStatusCompromised}</option>
            <option value="REVOKED">{o.signingKeyStatusRevoked}</option>
          </select>
        </label>
      </div>
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
        <ul className="divide-y rounded-lg border border-slate-200 bg-white">
          {query.data.items.map((key) => (
            <li key={key.id} className="space-y-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="font-semibold">{key.label}</p>
                  <p className="code text-xs text-slate-500" dir="ltr">
                    {key.id}
                  </p>
                </div>
                <StatusBadge status={key.status} />
              </div>
              {key.statusReason && (
                <p className="text-sm">
                  <span className="text-slate-500">{o.signingKeyReason}: </span>
                  {key.statusReason}
                </p>
              )}
              {key.statusDetectedAt && (
                <p className="text-xs text-slate-500">
                  {o.signingKeyDetectedAt}:{' '}
                  {new Date(key.statusDetectedAt).toLocaleString('fa-IR')}
                </p>
              )}
              {key.evidenceRef && (
                <p className="text-xs text-slate-500" dir="ltr">
                  {key.evidenceRef}
                </p>
              )}
              {key.notes && (
                <p className="whitespace-pre-wrap text-sm text-slate-600">
                  {key.notes}
                </p>
              )}
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
          signingKey={selected}
          onDone={() => setSelected(null)}
        />
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: SigningKey['status'] }) {
  const classes: Record<SigningKey['status'], string> = {
    ACTIVE: 'bg-emerald-100 text-emerald-800',
    COMPROMISED: 'bg-red-100 text-red-800',
    REVOKED: 'bg-amber-100 text-amber-800',
  };
  const label: Record<SigningKey['status'], string> = {
    ACTIVE: o.signingKeyStatusActive,
    COMPROMISED: o.signingKeyStatusCompromised,
    REVOKED: o.signingKeyStatusRevoked,
  };
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-1 text-xs font-medium ${classes[status]}`}
    >
      {label[status]}
    </span>
  );
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
      className="max-w-xl space-y-3 rounded border bg-white p-4"
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
          <textarea
            {...props}
            {...form.register('notes')}
            className="w-full rounded border p-2"
            rows={3}
          />
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
      {mutation.isSuccess && <output>{o.signingKeyRegisterSuccess}</output>}
      <Button disabled={mutation.isPending}>
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
      onDone();
    },
  });
  return (
    <form
      className="space-y-3 rounded border bg-white p-4"
      onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
    >
      <h2 className="font-semibold">
        {signingKey.label}{' '}
        <span className="code text-xs text-slate-500" dir="ltr">
          ({signingKey.id})
        </span>
      </h2>
      <p className="text-sm text-slate-500">
        {o.signingKeyStatus}: {signingKey.status}
      </p>
      <label className="block space-y-2">
        <span>{o.signingKeyStatus}</span>
        <select
          className="w-full rounded border p-2"
          {...form.register('status')}
        >
          <option value="ACTIVE">{o.signingKeyMarkActive}</option>
          <option value="COMPROMISED">{o.signingKeyMarkCompromised}</option>
          <option value="REVOKED">{o.signingKeyMarkRevoked}</option>
        </select>
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
      {mutation.isSuccess && <output>{o.signingKeyStatusChangeSuccess}</output>}
      <Button disabled={mutation.isPending}>
        {mutation.isPending ? o.saving : o.save}
      </Button>
    </form>
  );
}
