import { useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { normalizeApiError } from '@/api/errors';
import { t } from '@/lib/i18n';
import { Input } from '@/ui/input';
import { FormField } from '@/ui/patterns/form-field';
import { useToast } from '@/ui/patterns/toast';
import {
  administrationErrorMessage,
  administrationSuccessMessage,
} from '../administration-error-messages';
import { AdministrationFormShell } from '../administration-form-shell';
import { useCreateUserMutation } from './user-hooks';
import { createUserSchema, type CreateUserFormValues } from './user-schemas';

/**
 * Create a user account (`POST /users`, `Users.User.Create`).
 *
 * The new account starts enabled and the backend decides
 * `mustChangePassword` by its own rule; the form sends exactly the two
 * fields the DTO owns — nothing else is smuggled in.
 */
export function UserCreatePage(): ReactElement {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const createMutation = useCreateUserMutation();
  const [serverError, setServerError] = useState<ReturnType<
    typeof administrationErrorMessage
  > | null>(null);

  const form = useForm<CreateUserFormValues>({
    resolver: zodResolver(createUserSchema),
    mode: 'onSubmit',
    defaultValues: { username: '', password: '' },
  });

  const submitting = createMutation.isPending;

  const onSubmit = form.handleSubmit((values) => {
    if (submitting) return; // duplicate-submit protection
    setServerError(null);
    createMutation.mutate(
      { username: values.username, password: values.password },
      {
        onSuccess: (created) => {
          showToast({
            kind: 'success',
            message: administrationSuccessMessage('user', 'create'),
          });
          navigate(`/app/admin/users/${encodeURIComponent(created.id)}`);
        },
        onError: (error) => {
          const normalized = normalizeApiError(error);
          if (normalized.isUnauthorized) return; // owned by the session flow
          setServerError(administrationErrorMessage('user', 'create', error));
        },
      },
    );
  });

  return (
    <AdministrationFormShell
      title={t.usersAdmin.newUser}
      description={t.usersAdmin.newUserDescription}
      error={serverError}
      isDirty={form.formState.isDirty}
      submitting={submitting}
      submitLabel={t.usersAdmin.create}
      cancelTo="/app/admin/users"
      onSubmit={onSubmit}
      testId="user-create-form"
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

      <FormField
        id="user-password"
        label={t.usersAdmin.password}
        error={form.formState.errors.password?.message}
        hint={t.usersAdmin.passwordHint}
      >
        {(fieldProps) => (
          <Input
            {...fieldProps}
            type="password"
            dir="ltr"
            autoComplete="new-password"
            required
            aria-required="true"
            disabled={submitting}
            {...form.register('password')}
          />
        )}
      </FormField>
    </AdministrationFormShell>
  );
}
