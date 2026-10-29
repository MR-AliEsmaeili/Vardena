import { useEffect, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { normalizeApiError } from '@/api/errors';
import { t } from '@/lib/i18n';
import { Input } from '@/ui/input';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { FormField } from '@/ui/patterns/form-field';
import { FormPageHeader } from '@/app/layouts/form-page-header';
import { LoadingState } from '@/ui/patterns/states';
import { useToast } from '@/ui/patterns/toast';
import {
  administrationErrorMessage,
  administrationSuccessMessage,
} from '../administration-error-messages';
import { AdministrationFormShell } from '../administration-form-shell';
import { useRoleDetail, useUpdateRoleMutation } from './role-hooks';
import { updateRoleSchema, type UpdateRoleFormValues } from './role-schemas';

/**
 * Edit a role's identity (`PATCH /roles/:id`, `Rbac.Role.Edit`).
 *
 * The permission set is deliberately NOT editable here: it has its own
 * dedicated operations on the role's detail page, and pretending otherwise
 * would invite divergent copies of the same truth.
 */
export function RoleEditPage(): ReactElement {
  const { roleId } = useParams<{ roleId: string }>();
  const query = useRoleDetail(roleId);

  if (query.isPending) {
    return <LoadingState rows={5} label={t.app.loading} />;
  }
  if (query.isError) {
    return (
      <div className="space-y-4">
        <FormPageHeader title={t.rolesAdmin.editRole} />
        <ApiErrorAlert
          error={query.error}
          title={t.table.errorTitle}
          description={t.rolesAdmin.roleLoadFailed}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }
  return (
    <RoleEditForm
      roleId={query.data.id}
      name={query.data.name}
      description={query.data.description ?? ''}
    />
  );
}

function RoleEditForm({
  roleId,
  name,
  description,
}: {
  roleId: string;
  name: string;
  description: string;
}): ReactElement {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const updateMutation = useUpdateRoleMutation();
  const [serverError, setServerError] = useState<ReturnType<
    typeof administrationErrorMessage
  > | null>(null);

  const form = useForm<UpdateRoleFormValues>({
    resolver: zodResolver(updateRoleSchema),
    mode: 'onSubmit',
    defaultValues: { name, description },
  });

  // Re-seed the form when the loaded record differs (Back/Forward/deep link).
  useEffect(() => {
    form.reset({ name, description });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once per record identity
  }, [roleId, name, description]);

  const submitting = updateMutation.isPending;

  const onSubmit = form.handleSubmit((values) => {
    if (submitting) return;
    setServerError(null);
    updateMutation.mutate(
      {
        roleId,
        values: {
          name: values.name,
          ...(values.description !== ''
            ? { description: values.description }
            : { description: null }),
        },
      },
      {
        onSuccess: (updated) => {
          showToast({
            kind: 'success',
            message: administrationSuccessMessage('role', 'update'),
          });
          navigate(`/app/admin/roles/${encodeURIComponent(updated.id)}`);
        },
        onError: (error) => {
          const normalized = normalizeApiError(error);
          if (normalized.isUnauthorized) return;
          setServerError(administrationErrorMessage('role', 'update', error));
        },
      },
    );
  });

  return (
    <AdministrationFormShell
      title={t.rolesAdmin.editRole}
      description={t.rolesAdmin.editRoleDescription}
      error={serverError}
      isDirty={form.formState.isDirty}
      submitting={submitting}
      submitLabel={t.rolesAdmin.update}
      cancelTo={`/app/admin/roles/${encodeURIComponent(roleId)}`}
      onSubmit={onSubmit}
      testId="role-edit-form"
    >
      <FormField
        id="role-name"
        label={t.rolesAdmin.roleName}
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

      <FormField
        id="role-description"
        label={t.rolesAdmin.description}
        error={form.formState.errors.description?.message}
      >
        {(fieldProps) => (
          <Input
            {...fieldProps}
            type="text"
            disabled={submitting}
            {...form.register('description')}
          />
        )}
      </FormField>
    </AdministrationFormShell>
  );
}
