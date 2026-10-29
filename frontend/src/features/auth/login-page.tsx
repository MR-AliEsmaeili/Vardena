import { zodResolver } from '@hookform/resolvers/zod';
import { Boxes } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation } from 'react-router-dom';
import { normalizeApiError } from '@/api/errors';
import { t } from '@/lib/i18n';
import { Alert, AlertBody } from '@/ui/alert';
import { Button } from '@/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Input } from '@/ui/input';
import { PasswordInput } from '@/ui/password-input';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { FormField } from '@/ui/patterns/form-field';
import { FullPageLoading } from '@/ui/patterns/states';
import { loginSchema, type LoginFormValues } from './login-schema';
import { useSession } from './use-session';

interface LocationState {
  from?: string;
}

/**
 * The post-login destination must be an internal path. `state.from` normally
 * originates from `RequireAuth`'s own redirect, but it is still untrusted
 * input: anything that is not a same-app path starting with a single `/`
 * (protocol-relative URLs included) falls back to `/app`, so the redirect can
 * never leave the application (open-redirect guard).
 */
export function safeReturnPath(from: unknown): string {
  if (
    typeof from === 'string' &&
    from.startsWith('/') &&
    !from.startsWith('//') &&
    !from.startsWith('/login') &&
    !from.startsWith('/change-password')
  ) {
    return from;
  }
  return '/app';
}

/**
 * Login page — the only public route.
 *
 * There are no demo credentials, no mocked user and no client-side
 * authentication: the form posts to the real `POST /api/v1/auth/login` and
 * the server decides. Failures are rendered from the normalized API error
 * (a single generic message by design, `security.md` §2).
 */
export function LoginPage() {
  const location = useLocation();
  const session = useSession();
  const state = location.state as LocationState | null;

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: '', password: '' },
    mode: 'onSubmit',
  });

  if (session.status === 'loading') {
    return <FullPageLoading label={t.auth.checkingSession} />;
  }

  if (session.status === 'authenticated') {
    const returnTo = safeReturnPath(state?.from);
    if (session.mustChangePassword) {
      return (
        <Navigate to="/change-password" replace state={{ from: returnTo }} />
      );
    }
    return <Navigate to={returnTo} replace />;
  }

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await session.login(values);
    } catch {
      // The mutation error is rendered below; nothing to do here besides
      // clearing the password so a rejected secret is never left sitting in
      // the field (FE-UX-02 §9). The username is kept so the user only has to
      // re-type the secret, and focus returns to it.
      form.resetField('password');
      form.setFocus('password');
    }
  });

  const loginError = session.loginError;
  const isCredentialError =
    loginError !== null &&
    loginError !== undefined &&
    normalizeApiError(loginError).isUnauthorized;
  const usernameError = form.formState.errors.username?.message;
  const passwordError = form.formState.errors.password?.message;

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

        {session.sessionExpired && (
          <Alert variant="warning">
            <AlertBody>{t.auth.sessionExpired}</AlertBody>
          </Alert>
        )}

        <Card className="shadow-raised">
          <CardHeader className="space-y-1 p-5">
            <CardTitle>{t.auth.loginTitle}</CardTitle>
            <p className="text-xs text-ink-muted">{t.auth.loginSubtitle}</p>
          </CardHeader>
          <CardContent className="p-5">
            <form className="space-y-4" onSubmit={onSubmit} noValidate>
              <FormField
                id="username"
                label={t.auth.username}
                error={usernameError}
                required
              >
                {(fieldProps) => (
                  <Input
                    {...fieldProps}
                    type="text"
                    autoComplete="username"
                    dir="ltr"
                    disabled={session.isLoggingIn}
                    {...form.register('username')}
                  />
                )}
              </FormField>

              <FormField
                id="password"
                label={t.auth.password}
                error={passwordError}
                required
              >
                {(fieldProps) => (
                  <PasswordInput
                    {...fieldProps}
                    autoComplete="current-password"
                    dir="ltr"
                    disabled={session.isLoggingIn}
                    {...form.register('password')}
                  />
                )}
              </FormField>

              {loginError !== null && loginError !== undefined && (
                <ApiErrorAlert
                  error={loginError}
                  title={
                    isCredentialError
                      ? t.auth.invalidCredentials
                      : t.errors.title
                  }
                  description={
                    isCredentialError
                      ? t.auth.invalidCredentialsHelp
                      : undefined
                  }
                />
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={session.isLoggingIn}
                loading={session.isLoggingIn}
              >
                {session.isLoggingIn ? t.auth.submitting : t.auth.submit}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
