import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useSession } from '@/features/auth/use-session';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { FullPageLoading } from '@/ui/patterns/states';

/**
 * Private-route boundary.
 *
 * Renders the protected tree only for an authenticated session
 * (`GET /auth/me` answered with a user). An unauthenticated or expired
 * session is redirected to `/login`, remembering the attempted location.
 * A transport failure is shown as an error instead of being mistaken for a
 * logout. This is UX routing — the API rejects unauthenticated calls itself.
 */
export function RequireAuth() {
  const { status, error, mustChangePassword } = useSession();
  const location = useLocation();

  if (status === 'loading') {
    return <FullPageLoading label={t.auth.checkingSession} />;
  }

  if (status === 'error') {
    return (
      <main className="mx-auto max-w-lg space-y-4 p-6">
        <ApiErrorAlert error={error} />
        <Button asChild variant="outline">
          <Link to="/login">{t.auth.loginTitle}</Link>
        </Button>
      </main>
    );
  }

  if (status === 'unauthenticated') {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  if (mustChangePassword) {
    return (
      <Navigate
        to="/change-password"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  return <Outlet />;
}
