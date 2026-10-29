import { useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import type { Branch } from '@/api/contracts';
import { normalizeApiError } from '@/api/errors';
import { useOrganizationId } from '@/features/organization/use-organization';
import { t } from '@/lib/i18n';
import { Input } from '@/ui/input';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { FormField } from '@/ui/patterns/form-field';
import { FormPageHeader } from '@/app/layouts/form-page-header';
import { LoadingState } from '@/ui/patterns/states';
import { useToast } from '@/ui/patterns/toast';
import {
  adminErrorMessage,
  applyServerValidation,
  type AdminErrorMessage,
} from '../admin-error-messages';
import { AdminFormShell } from '../admin-form-shell';
import { branchSchema, type BranchFormValues } from '../admin-schemas';
import {
  useBranchDetail,
  useCreateBranchMutation,
  useUpdateBranchMutation,
} from './branch-hooks';

/**
 * Create / edit a branch (`POST /branches`, `PATCH /branches/:id`).
 *
 * The edit screen loads the record first (`GET /branches/:id`), which is why
 * its route requires `Organization.Branch.View` in addition to
 * `Organization.Branch.Edit`; the create route requires only
 * `Organization.Branch.Create`, exactly like the endpoint.
 */

const KNOWN_FIELDS = ['code', 'name'] as const;

export function BranchCreatePage(): ReactElement {
  const organizationId = useOrganizationId();
  if (organizationId === null) {
    return <LoadingState rows={5} label={t.orgAdmin.loading} />;
  }
  return <BranchForm organizationId={organizationId} mode="create" />;
}

export function BranchEditPage(): ReactElement {
  const organizationId = useOrganizationId();
  const { branchId } = useParams<{ branchId: string }>();
  const query = useBranchDetail(organizationId, branchId);

  if (organizationId === null || query.isPending) {
    return <LoadingState rows={5} label={t.orgAdmin.loading} />;
  }
  if (query.isError) {
    return (
      <div className="space-y-4">
        <FormPageHeader title={t.orgAdmin.branchEditTitle} />
        <ApiErrorAlert
          error={query.error}
          title={t.table.errorTitle}
          description={t.orgAdmin.branchLoadFailed}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }
  return (
    <BranchForm
      organizationId={organizationId}
      mode="edit"
      branch={query.data}
    />
  );
}

function BranchForm({
  organizationId,
  mode,
  branch,
}: {
  organizationId: string;
  mode: 'create' | 'edit';
  branch?: Branch;
}): ReactElement {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [serverError, setServerError] = useState<AdminErrorMessage | null>(
    null,
  );

  const form = useForm<BranchFormValues>({
    resolver: zodResolver(branchSchema),
    mode: 'onSubmit',
    defaultValues: {
      code: branch?.code ?? '',
      name: branch?.name ?? '',
    },
  });

  const createMutation = useCreateBranchMutation(organizationId);
  const updateMutation = useUpdateBranchMutation(organizationId);
  const submitting = createMutation.isPending || updateMutation.isPending;

  const onError = (error: unknown) => {
    const normalized = normalizeApiError(error);
    if (normalized.isUnauthorized) return; // owned by the session flow
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
            'branch',
            mode === 'create' ? 'create' : 'update',
            error,
          ),
    );
  };

  const onSubmit = form.handleSubmit((values) => {
    if (submitting) return; // duplicate-submit protection
    setServerError(null);
    if (mode === 'create') {
      createMutation.mutate(values, {
        onSuccess: (created) => {
          showToast({ kind: 'success', message: t.orgAdmin.branchCreated });
          navigate(
            `/app/organization/branches/${encodeURIComponent(created.id)}`,
          );
        },
        onError,
      });
      return;
    }
    const target = branch as Branch;
    updateMutation.mutate(
      { branchId: target.id, values },
      {
        onSuccess: (updated) => {
          showToast({ kind: 'success', message: t.orgAdmin.branchUpdated });
          navigate(
            `/app/organization/branches/${encodeURIComponent(updated.id)}`,
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
          ? t.orgAdmin.branchCreateTitle
          : t.orgAdmin.branchEditTitle
      }
      description={t.orgAdmin.branchesDescription}
      error={serverError}
      isDirty={form.formState.isDirty}
      submitting={submitting}
      submitLabel={t.orgAdmin.save}
      cancelTo={
        mode === 'edit' && branch !== undefined
          ? `/app/organization/branches/${encodeURIComponent(branch.id)}`
          : '/app/organization/branches'
      }
      onSubmit={onSubmit}
      testId="branch-form"
    >
      <FormField
        id="branch-code"
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
        id="branch-name"
        label={t.orgAdmin.name}
        error={form.formState.errors.name?.message}
      >
        {(fieldProps) => (
          <Input
            {...fieldProps}
            type="text"
            required
            aria-required="true"
            disabled={submitting}
            {...form.register('name')}
          />
        )}
      </FormField>
    </AdminFormShell>
  );
}
