import { useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import type { Party, UpdatePartyRequest } from '@/api/contracts';
import { normalizeApiError } from '@/api/errors';
import { useOrganizationId } from '@/features/organization/use-organization';
import { t } from '@/lib/i18n';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { FormField } from '@/ui/patterns/form-field';
import { PageHeader } from '@/ui/patterns/page-header';
import { LoadingState } from '@/ui/patterns/states';
import { useToast } from '@/ui/patterns/toast';
import {
  adminErrorMessage,
  applyServerValidation,
  type AdminErrorMessage,
} from '../admin-error-messages';
import { AdminFormShell } from '../admin-form-shell';
import { partySchema, type PartyFormValues } from '../admin-schemas';
import { PARTY_TYPE_LABELS, PARTY_TYPES } from '../party-types';
import {
  useCreatePartyMutation,
  usePartyDetail,
  useUpdatePartyMutation,
} from './party-hooks';

/**
 * Create / edit a party (`POST /parties`, `PATCH /parties/:id`).
 *
 * Customer and supplier are capabilities of ONE record; at least one must be
 * held. The schema mirrors that rule for immediate feedback, and the service
 * enforces it as a domain rule (422) regardless.
 *
 * The DTOs carry no national id, economic code, tax classification, address,
 * contact or bank account: those are unresolved and expert-gated (OQ-30,
 * OQ-38), so this form deliberately has no such fields.
 */

const KNOWN_FIELDS = [
  'code',
  'displayName',
  'legalName',
  'partyType',
  'email',
  'phone',
  'isCustomer',
  'isSupplier',
] as const;

export function PartyCreatePage(): ReactElement {
  const organizationId = useOrganizationId();
  if (organizationId === null) {
    return <LoadingState rows={6} label={t.orgAdmin.loading} />;
  }
  return <PartyForm organizationId={organizationId} mode="create" />;
}

export function PartyEditPage(): ReactElement {
  const organizationId = useOrganizationId();
  const { partyId } = useParams<{ partyId: string }>();
  const query = usePartyDetail(organizationId, partyId);

  if (organizationId === null || query.isPending) {
    return <LoadingState rows={6} label={t.orgAdmin.loading} />;
  }
  if (query.isError) {
    return (
      <div className="space-y-4">
        <PageHeader title={t.orgAdmin.partyEditTitle} />
        <ApiErrorAlert
          error={query.error}
          title={t.table.errorTitle}
          description={t.orgAdmin.partyLoadFailed}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }
  return (
    <PartyForm organizationId={organizationId} mode="edit" party={query.data} />
  );
}

function PartyForm({
  organizationId,
  mode,
  party,
}: {
  organizationId: string;
  mode: 'create' | 'edit';
  party?: Party;
}): ReactElement {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [serverError, setServerError] = useState<AdminErrorMessage | null>(
    null,
  );

  const form = useForm<PartyFormValues>({
    resolver: zodResolver(partySchema),
    mode: 'onSubmit',
    defaultValues: {
      code: party?.code ?? '',
      displayName: party?.displayName ?? '',
      legalName: party?.legalName ?? '',
      partyType: party?.partyType ?? 'organization',
      isCustomer: party?.isCustomer ?? true,
      isSupplier: party?.isSupplier ?? false,
      email: party?.email ?? '',
      phone: party?.phone ?? '',
    },
  });

  const createMutation = useCreatePartyMutation(organizationId);
  const updateMutation = useUpdatePartyMutation(organizationId);
  const submitting = createMutation.isPending || updateMutation.isPending;

  const onError = (error: unknown) => {
    const normalized = normalizeApiError(error);
    if (normalized.isUnauthorized) return;
    const validation = applyServerValidation(error, form, KNOWN_FIELDS);
    setServerError(
      validation !== null
        ? {
            message: validation.summary,
            ...(normalized.correlationId !== undefined
              ? { correlationId: normalized.correlationId }
              : {}),
          }
        : adminErrorMessage(
            'party',
            mode === 'create' ? 'create' : 'update',
            error,
          ),
    );
  };

  const onSubmit = form.handleSubmit((values) => {
    if (submitting) return;
    setServerError(null);

    // The optional text fields are omitted when empty: the DTOs accept a
    // string or nothing — they do not accept `null`.
    const optional = {
      ...(values.legalName !== '' ? { legalName: values.legalName } : {}),
      ...(values.email !== '' ? { email: values.email } : {}),
      ...(values.phone !== '' ? { phone: values.phone } : {}),
    };

    if (mode === 'create') {
      createMutation.mutate(
        {
          code: values.code,
          displayName: values.displayName,
          partyType: values.partyType,
          isCustomer: values.isCustomer,
          isSupplier: values.isSupplier,
          ...optional,
        },
        {
          onSuccess: (created) => {
            showToast({ kind: 'success', message: t.orgAdmin.partyCreated });
            navigate(
              `/app/organization/parties/${encodeURIComponent(created.id)}`,
            );
          },
          onError,
        },
      );
      return;
    }

    const target = party as Party;
    const body: UpdatePartyRequest = {
      code: values.code,
      displayName: values.displayName,
      partyType: values.partyType,
      isCustomer: values.isCustomer,
      isSupplier: values.isSupplier,
      ...optional,
    };
    updateMutation.mutate(
      { partyId: target.id, values: body },
      {
        onSuccess: (updated) => {
          showToast({ kind: 'success', message: t.orgAdmin.partyUpdated });
          navigate(
            `/app/organization/parties/${encodeURIComponent(updated.id)}`,
          );
        },
        onError,
      },
    );
  });

  return (
    <AdminFormShell
      title={
        mode === 'create'
          ? t.orgAdmin.partyCreateTitle
          : t.orgAdmin.partyEditTitle
      }
      description={t.orgAdmin.partiesDescription}
      error={serverError}
      isDirty={form.formState.isDirty}
      submitting={submitting}
      submitLabel={t.orgAdmin.save}
      cancelTo={
        mode === 'edit' && party !== undefined
          ? `/app/organization/parties/${encodeURIComponent(party.id)}`
          : '/app/organization/parties'
      }
      onSubmit={onSubmit}
      testId="party-form"
    >
      <FormField
        id="party-code"
        label={t.orgAdmin.code}
        error={form.formState.errors.code?.message}
      >
        {(fieldProps) => (
          <Input
            {...fieldProps}
            type="text"
            dir="ltr"
            required
            aria-required="true"
            disabled={submitting}
            {...form.register('code')}
          />
        )}
      </FormField>

      <FormField
        id="party-display-name"
        label={t.orgAdmin.displayName}
        error={form.formState.errors.displayName?.message}
      >
        {(fieldProps) => (
          <Input
            {...fieldProps}
            type="text"
            required
            aria-required="true"
            disabled={submitting}
            {...form.register('displayName')}
          />
        )}
      </FormField>

      <FormField
        id="party-legal-name"
        label={t.orgAdmin.legalName}
        error={form.formState.errors.legalName?.message}
      >
        {(fieldProps) => (
          <Input
            {...fieldProps}
            type="text"
            disabled={submitting}
            {...form.register('legalName')}
          />
        )}
      </FormField>

      <FormField
        id="party-type"
        label={t.orgAdmin.partyType}
        error={form.formState.errors.partyType?.message}
      >
        {(fieldProps) => (
          <Select
            {...fieldProps}
            disabled={submitting}
            {...form.register('partyType')}
          >
            {PARTY_TYPES.map((value) => (
              <option key={value} value={value}>
                {PARTY_TYPE_LABELS[value]}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <fieldset className="sm:col-span-2 space-y-1.5">
        <legend className="text-sm font-medium text-ink">
          {t.orgAdmin.capabilities}
        </legend>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-line-strong"
              disabled={submitting}
              {...form.register('isCustomer')}
            />
            {t.orgAdmin.customerCapability}
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-line-strong"
              disabled={submitting}
              {...form.register('isSupplier')}
            />
            {t.orgAdmin.supplierCapability}
          </label>
        </div>
        {form.formState.errors.isCustomer?.message !== undefined && (
          <p role="alert" className="text-xs text-danger-ink">
            {form.formState.errors.isCustomer.message}
          </p>
        )}
      </fieldset>

      <FormField
        id="party-email"
        label={t.orgAdmin.email}
        error={form.formState.errors.email?.message}
      >
        {(fieldProps) => (
          <Input
            {...fieldProps}
            type="email"
            dir="ltr"
            disabled={submitting}
            {...form.register('email')}
          />
        )}
      </FormField>

      <FormField
        id="party-phone"
        label={t.orgAdmin.phone}
        error={form.formState.errors.phone?.message}
      >
        {(fieldProps) => (
          <Input
            {...fieldProps}
            type="text"
            dir="ltr"
            disabled={submitting}
            {...form.register('phone')}
          />
        )}
      </FormField>
    </AdminFormShell>
  );
}
