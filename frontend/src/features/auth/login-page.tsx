import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation } from 'react-router-dom';
import { normalizeApiError } from '@/api/errors';
import { t } from '@/lib/i18n';
import { Alert, AlertBody } from '@/ui/alert';
import { Button } from '@/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Input } from '@/ui/input';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { FormField } from '@/ui/patterns/form-field';
import { FullPageLoading } from '@/ui/patterns/states';
import { loginSchema, type LoginFormValues } from './login-schema';
import { useSession } from './use-session';

interface LocationState {
  from?: string;
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
    return <Navigate to={state?.from ?? '/app'} replace />;
  }

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await session.login(values);
    } catch {
      // The mutation error is rendered below; nothing to do here. The
      // password is never logged, stored or echoed back into the form.
    }
  });

  const loginError = session.loginError;
  const usernameError = form.formState.errors.username?.message;
  const passwordError = form.formState.errors.password?.message;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center">
          <p className="text-2xl font-bold text-indigo-700">{t.app.name}</p>
          <p className="mt-1 text-sm text-slate-600">{t.app.tagline}</p>
        </div>

        {session.sessionExpired && (
          <Alert variant="warning">
            <AlertBody>{t.auth.sessionExpired}</AlertBody>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle>{t.auth.loginTitle}</CardTitle>
            <p className="text-sm text-slate-600">{t.auth.loginSubtitle}</p>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={onSubmit} noValidate>
              <FormField
                id="username"
                label={t.auth.username}
                error={usernameError}
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
              >
                {(fieldProps) => (
                  <Input
                    {...fieldProps}
                    type="password"
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
                    normalizeApiError(loginError).isUnauthorized
                      ? t.auth.invalidCredentials
                      : t.errors.title
                  }
                />
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={session.isLoggingIn}
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
