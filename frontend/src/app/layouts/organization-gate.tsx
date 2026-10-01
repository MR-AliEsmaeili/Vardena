import { useSession } from '@/features/auth/use-session';
import { CreateFirstOrganizationForm } from '@/features/organization/create-first-organization-form';
import { OrganizationSelection } from '@/features/organization/organization-selection';
import { useOrganization } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { t } from '@/lib/i18n';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { BlockedState, LogoutButton, ResolvingState } from './bootstrap-states';

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
 *
 * The installation license (ADR-0030) is NOT evaluated here: the licensing
 * bootstrap stage (`license-gate.tsx`) runs before this gate is mounted, so
 * everything below already happens under an active license and this
 * component keeps exactly one question — the organization one. That is also
 * what keeps the two explainers honest: "the license is not active" is
 * decided one stage earlier and can never be confused with "you lack the
 * organization permission" decided here.
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
 *
 * This gate is reached only through `LicenseGate` (`license-gate.tsx`), i.e.
 * only while the installation license is active.
 */
export function OrganizationGate() {
  const { status, error, refresh } = useOrganization();

  if (status === 'loading') {
    return <ResolvingState label={t.organization.resolving} />;
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
