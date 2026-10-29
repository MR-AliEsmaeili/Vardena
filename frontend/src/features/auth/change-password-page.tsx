import { zodResolver } from '@hookform/resolvers/zod';
import { Boxes, LogOut } from 'lucide-react';
import { useForm, type UseFormSetError } from 'react-hook-form';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { normalizeApiError } from '@/api/errors';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { PasswordInput } from '@/ui/password-input';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { FormField } from '@/ui/patterns/form-field';
import { FullPageLoading } from '@/ui/patterns/states';
import {
  changePasswordSchema,
  type ChangePasswordFormValues,
} from './change-password-schema';
import { safeReturnPath } from './login-page';
import { useSession } from './use-session';

interface LocationState {
  from?: string;
}

interface ValidationIssueLike {
  field?: unknown;
  code?: unknown;
}

function mapValidationIssueMessage(
  field: 'currentPassword' | 'newPassword',
  code: unknown,
): string {
  if (field === 'currentPassword') {
    return code === 'invalidCurrentPassword'
      ? t.auth.currentPasswordInvalid
      : t.auth.currentPasswordRequired;
  }
  if (code === 'mustDifferFromCurrent') {
    return t.auth.newPasswordMustDiffer;
  }
  if (code === 'maxLength') {
    return t.auth.newPasswordMaxLength;
  }
  return t.auth.newPasswordMinLength;
}

function applyServerValidationIssues(
  error: unknown,
  setError: UseFormSetError<ChangePasswordFormValues>,
): string | undefined {
  const apiError = normalizeApiError(error);
  if (
    apiError.code !== 'ValidationFailed' ||
    !Array.isArray(apiError.details)
  ) {
    return apiError.isUnauthorized ? t.auth.sessionExpired : undefined;
  }

  let firstDescription: string | undefined;
  for (const rawIssue of apiError.details) {
    if (typeof rawIssue !== 'object' || rawIssue === null) continue;
    const issue = rawIssue as ValidationIssueLike;
    if (issue.field === 'currentPassword' || issue.field === 'newPassword') {
      const message = mapValidationIssueMessage(issue.field, issue.code);
      setError(issue.field, { type: 'server', message });
      if (firstDescription === undefined) {
        firstDescription = message;
      }
    }
  }
  return firstDescription ?? t.errors.validation;
}

function resolveChangePasswordErrorDescription(
  error: unknown,
): string | undefined {
  const apiError = normalizeApiError(error);
  if (apiError.isUnauthorized) {
    return t.auth.sessionExpired;
  }
  if (
    apiError.code !== 'ValidationFailed' ||
    !Array.isArray(apiError.details)
  ) {
    return undefined;
  }
  for (const rawIssue of apiError.details) {
    if (typeof rawIssue !== 'object' || rawIssue === null) continue;
    const issue = rawIssue as ValidationIssueLike;
    if (issue.field === 'currentPassword' || issue.field === 'newPassword') {
      return mapValidationIssueMessage(issue.field, issue.code);
    }
  }
  return t.errors.validation;
}

/**
 * Mandatory first-login password change page (`/change-password`).
 *
 * Reachable when the authenticated session user has `mustChangePassword=true`.
 * Unauthenticated visitors are redirected to `/login`; authenticated users who
 * do not require a password change are redirected to their return path (`/app`
 * by default) so there is never a redirect loop between `/login`,
 * `/change-password`, and `/app`.
 */
export function ChangePasswordPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const session = useSession();
  const state = location.state as LocationState | null;
  const returnTo = safeReturnPath(state?.from);

  const form = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
    mode: 'onSubmit',
  });

  if (session.status === 'loading') {
    return <FullPageLoading label={t.auth.checkingSession} />;
  }

  if (session.status === 'error') {
    return (
      <main className="mx-auto max-w-lg space-y-4 p-6">
        <ApiErrorAlert error={session.error} />
        <Button asChild variant="outline">
          <Link to="/login">{t.auth.loginTitle}</Link>
        </Button>
      </main>
    );
  }

  if (session.status === 'unauthenticated' || session.user === null) {
    return <Navigate to="/login" replace state={{ from: returnTo }} />;
  }

  if (!session.user.mustChangePassword) {
    return <Navigate to={returnTo} replace />;
  }

  const onSubmit = form.handleSubmit(async (values) => {
    session.resetChangePasswordError();
    try {
      await session.changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      void navigate(returnTo, { replace: true });
    } catch (caught) {
      form.setValue('currentPassword', '');
      form.setValue('newPassword', '');
      form.setValue('confirmPassword', '');
      applyServerValidationIssues(caught, form.setError);
    }
  });

  const handleLogout = async () => {
    session.resetChangePasswordError();
    await session.logout();
  };

  const changePasswordError = session.changePasswordError;
  const errorDescription =
    changePasswordError !== null && changePasswordError !== undefined
      ? resolveChangePasswordErrorDescription(changePasswordError)
      : undefined;

  const currentPasswordError = form.formState.errors.currentPassword?.message;
  const newPasswordError = form.formState.errors.newPassword?.message;
  const confirmPasswordError = form.formState.errors.confirmPassword?.message;
  const isBusy = session.isChangingPassword || session.isLoggingOut;

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md space-y-5">
        <header className="text-center">
          <span
            aria-hidden="true"
            className="mx-auto flex h-11 w-11 items-center justify-center rounded-card bg-brand text-white shadow-raised"
          >
            <Boxes className="h-5 w-5" />
          </span>
          <p className="mt-3 text-xl font-bold text-ink">{t.app.name}</p>
          <p className="mt-1 text-xs text-ink-muted">{t.app.tagline}</p>
        </header>

        <Card className="shadow-raised">
          <CardHeader className="space-y-1 p-5">
            <CardTitle>{t.auth.changePasswordTitle}</CardTitle>
            <p className="text-xs leading-6 text-ink-muted">
              {t.auth.changePasswordSubtitle}
            </p>
            <p className="text-xs text-ink-subtle">
              {t.auth.signedInAs}:{' '}
              <span className="font-medium text-ink" dir="ltr">
                {session.user.username}
              </span>
            </p>
          </CardHeader>
          <CardContent className="p-5">
            <form className="space-y-4" onSubmit={onSubmit} noValidate>
              <FormField
                id="currentPassword"
                label={t.auth.currentPassword}
                error={currentPasswordError}
                required
              >
                {(fieldProps) => (
                  <PasswordInput
                    {...fieldProps}
                    autoComplete="current-password"
                    dir="ltr"
                    disabled={isBusy}
                    {...form.register('currentPassword')}
                  />
                )}
              </FormField>

              <FormField
                id="newPassword"
                label={t.auth.newPassword}
                hint={t.auth.passwordLengthHint}
                error={newPasswordError}
                required
              >
                {(fieldProps) => (
                  <PasswordInput
                    {...fieldProps}
                    autoComplete="new-password"
                    dir="ltr"
                    disabled={isBusy}
                    {...form.register('newPassword')}
                  />
                )}
              </FormField>

              <FormField
                id="confirmPassword"
                label={t.auth.confirmPassword}
                error={confirmPasswordError}
                required
              >
                {(fieldProps) => (
                  <PasswordInput
                    {...fieldProps}
                    autoComplete="new-password"
                    dir="ltr"
                    disabled={isBusy}
                    {...form.register('confirmPassword')}
                  />
                )}
              </FormField>

              {changePasswordError !== null &&
                changePasswordError !== undefined && (
                  <ApiErrorAlert
                    error={changePasswordError}
                    title={t.auth.changePasswordFailedTitle}
                    description={errorDescription}
                  />
                )}

              <div className="space-y-2 pt-1">
                <Button
                  type="submit"
                  className="w-full"
                  disabled={isBusy}
                  loading={session.isChangingPassword}
                >
                  {session.isChangingPassword
                    ? t.auth.changingPassword
                    : t.auth.submitChangePassword}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={isBusy}
                  loading={session.isLoggingOut}
                  onClick={() => void handleLogout()}
                >
                  <LogOut className="h-4 w-4" aria-hidden />
                  {session.isLoggingOut ? t.auth.loggingOut : t.auth.logout}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
