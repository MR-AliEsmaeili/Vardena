import { LogOut } from 'lucide-react';
import { useSession } from '@/features/auth/use-session';
import { CreateFirstOrganizationForm } from '@/features/organization/create-first-organization-form';
import { OrganizationSelection } from '@/features/organization/organization-selection';
import { useOrganization } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/card';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';

/** Centered resolving state while the organization scope is being determined. */
function ResolvingState() {
  return (
    <output
      className="flex flex-col items-center gap-3 py-16"
      aria-live="polite"
    >
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" />
      <p className="text-sm text-slate-600">{t.organization.resolving}</p>
    </output>
  );
}

/** The logout affordance every blocked state shares. */
function LogoutButton() {
  const session = useSession();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={session.isLoggingOut}
      onClick={() => {
        void session.logout();
      }}
    >
      <LogOut className="h-4 w-4" aria-hidden />
      {session.isLoggingOut ? t.auth.loggingOut : t.auth.logout}
    </Button>
  );
}

/**
 * Terminal blocked state (no organization / no permission to read the list).
 *
 * The workspace is never entered: no fake default organization is selected
 * and no organization-scoped request is sent. The only recovery paths the
 * contract actually offers are contacting an administrator and logging out.
 */
function BlockedState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <LogoutButton />
      </CardContent>
    </Card>
  );
}

/**
 * The `empty` state (task §4/§7 — `GET /organizations` answered `[]`).
 *
 * `[]` is deployment-defined, not necessarily a dead end: an unpinned
 * deployment legitimately starts with zero organizations (ADR-0021), and the
 * backend already lets a principal holding both
 * `Organization.Organization.Create` and `Organization.Membership.Grant`
 * create the first one and become its first member through the existing
 * ODR-3 bootstrap exception (`OrganizationMembershipsService`). Offering that
 * path here is a UX affordance only (AR-21) — the backend re-checks both
 * permissions and refuses the call entirely in a pinned deployment; a
 * session without both codes still sees the unchanged terminal explainer,
 * exactly as before this form existed.
 */
function EmptyOrganizationState() {
  const { user } = useSession();
  const permissions = usePermissions();
  const { refresh } = useOrganization();

  const canBootstrapFirstOrganization =
    user !== null &&
    permissions.hasAll([
      PERMISSIONS.organization.create,
      PERMISSIONS.organization.membershipGrant,
    ]);

  if (canBootstrapFirstOrganization) {
    return (
      <div className="w-full space-y-4">
        <CreateFirstOrganizationForm userId={user.id} onCreated={refresh} />
        <div className="flex justify-center">
          <LogoutButton />
        </div>
      </div>
    );
  }

  return (
    <BlockedState
      title={t.organization.emptyTitle}
      description={t.organization.emptyBody}
    />
  );
}

/**
 * The organization gate of the application shell (FE-UX-04).
 *
 * Everything the organization context reports besides `ready` replaces the
 * workspace instead of rendering beside it — the dashboard must never load
 * "around" an unresolved, failed or missing organization scope, and no state
 * may degrade silently:
 *
 * - `loading` / `forbidden` / `error` — explicit explainer above;
 * - `empty` — the terminal explainer, or the first-organization bootstrap
 *   form when the session can actually use it (see `EmptyOrganizationState`);
 * - `selecting` / `invalid` — the explicit organization selection step.
 */
export function OrganizationGate() {
  const { status, error, refresh } = useOrganization();

  if (status === 'loading') {
    return <ResolvingState />;
  }

  if (status === 'forbidden') {
    return (
      <BlockedState
        title={t.organization.errorTitle}
        description={t.organization.permissionHint}
      />
    );
  }

  if (status === 'empty') {
    return <EmptyOrganizationState />;
  }

  if (status === 'error') {
    return (
      <div className="space-y-4">
        <ApiErrorAlert
          error={error}
          title={t.organization.errorTitle}
          onRetry={refresh}
        />
        <LogoutButton />
      </div>
    );
  }

  return <OrganizationSelection invalid={status === 'invalid'} />;
}
