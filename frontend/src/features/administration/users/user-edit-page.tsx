import { useEffect, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { normalizeApiError } from '@/api/errors';
import { t } from '@/lib/i18n';
import { Input } from '@/ui/input';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { FormField } from '@/ui/patterns/form-field';
import { PageHeader } from '@/ui/patterns/page-header';
import { LoadingState } from '@/ui/patterns/states';
import { useToast } from '@/ui/patterns/toast';
import {
  administrationErrorMessage,
  administrationSuccessMessage,
} from '../administration-error-messages';
import { AdministrationFormShell } from '../administration-form-shell';
import { useUpdateUserMutation, useUserDetail } from './user-hooks';
import { updateUserSchema, type UpdateUserFormValues } from './user-schemas';

/**
 * Edit a user's username (`PATCH /users/:id`, `Users.User.Edit`).
 *
 * The username is the only writable field of the user record: the password
 * and the account state each have their own operation on the detail page.
 */
export function UserEditPage(): ReactElement {
  const { userId } = useParams<{ userId: string }>();
  const query = useUserDetail(userId);

  if (query.isPending) {
    return <LoadingState rows={5} label={t.app.loading} />;
  }
  if (query.isError) {
    return (
      <div className="space-y-4">
        <PageHeader title={t.usersAdmin.editUser} />
        <ApiErrorAlert
          error={query.error}
          title={t.table.errorTitle}
          description={t.usersAdmin.userLoadFailed}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }
  return <UserEditForm userId={query.data.id} username={query.data.username} />;
}

function UserEditForm({
  userId,
  username,
}: {
  userId: string;
  username: string;
}): ReactElement {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const updateMutation = useUpdateUserMutation();
  const [serverError, setServerError] = useState<ReturnType<
    typeof administrationErrorMessage
  > | null>(null);

  const form = useForm<UpdateUserFormValues>({
    resolver: zodResolver(updateUserSchema),
    mode: 'onSubmit',
    defaultValues: { username },
  });

  // Re-seed the form when the loaded record differs (Back/Forward/deep link).
  useEffect(() => {
    form.reset({ username });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once per record identity
  }, [userId, username]);

  const submitting = updateMutation.isPending;

  const onSubmit = form.handleSubmit((values) => {
    if (submitting) return;
    setServerError(null);
    updateMutation.mutate(
      { userId, values: { username: values.username } },
      {
        onSuccess: (updated) => {
          showToast({
            kind: 'success',
            message: administrationSuccessMessage('user', 'update'),
          });
          navigate(`/app/admin/users/${encodeURIComponent(updated.id)}`);
        },
        onError: (error) => {
          const normalized = normalizeApiError(error);
          if (normalized.isUnauthorized) return;
          setServerError(administrationErrorMessage('user', 'update', error));
        },
      },
    );
  });

  return (
    <AdministrationFormShell
      title={t.usersAdmin.editUser}
      description={t.usersAdmin.editUserDescription}
      error={serverError}
      isDirty={form.formState.isDirty}
      submitting={submitting}
      submitLabel={t.usersAdmin.update}
      cancelTo={`/app/admin/users/${encodeURIComponent(userId)}`}
      onSubmit={onSubmit}
      testId="user-edit-form"
    >
      <FormField
        id="user-username"
        label={t.usersAdmin.username}
        error={form.formState.errors.username?.message}
        hint={t.usersAdmin.usernameHint}
      >
        {(fieldProps) => (
          <Input
            {...fieldProps}
            type="text"
            dir="ltr"
            autoComplete="off"
            required
            aria-required="true"
            disabled={submitting}
            {...form.register('username')}
          />
        )}
      </FormField>
    </AdministrationFormShell>
  );
}
