import { Outlet } from 'react-router-dom';
import { usePermissions } from '@/features/permissions/use-permissions';
import { t } from '@/lib/i18n';
import { Alert, AlertBody, AlertTitle } from '@/ui/alert';
import { LoadingState } from '@/ui/patterns/states';

export interface RequirePermissionProps {
  permissions: readonly string[];
}

/**
 * Feature-route permission boundary (UX only, AR-21).
 *
 * It prevents a user from landing on a page whose every request would be
 * refused, and explains why. It is NOT an authorization mechanism: the
 * backend refuses the underlying calls independently of what this component
 * renders.
 */
export function RequirePermission({ permissions }: RequirePermissionProps) {
  const checks = usePermissions();

  if (!checks.loaded) {
    return <LoadingState rows={4} />;
  }

  if (!checks.hasAll(permissions)) {
    return (
      <Alert variant="warning" role="alert">
        <AlertTitle>{t.permissions.forbiddenTitle}</AlertTitle>
        <AlertBody>
          <p>{t.permissions.forbiddenBody}</p>
          <p className="mt-2 text-xs">
            {t.permissions.requiredPermission}:{' '}
            <span className="code">{permissions.join('، ')}</span>
          </p>
        </AlertBody>
      </Alert>
    );
  }

  return <Outlet />;
}
