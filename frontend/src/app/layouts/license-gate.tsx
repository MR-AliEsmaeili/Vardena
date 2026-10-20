import type { ReactNode } from 'react';
import { LicenseImportCard } from '@/features/licensing/license-import-form';
import { useLicenseState } from '@/features/licensing/use-license-state';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { formatDateTime } from '@/lib/format';
import { t } from '@/lib/i18n';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import {
  BlockedState,
  BootstrapScreen,
  LogoutButton,
  ResolvingState,
} from './bootstrap-states';

/**
 * The licensing bootstrap stage (ADR-0030, `docs/licensing-architecture.md`).
 *
 * It sits between the authenticated session and the organization stage:
 *
 * `Login → session → LICENSE → OrganizationGate → organization context → workspace`
 *
 * so the installation license state is known before any organization
 * bootstrap UI exists. `children` — the organization gate and, behind it, the
 * whole workspace — render only in the `active` state; the other three states
 * replace them entirely:
 *
 * - `loading` — the read is in flight: no organization UI, no workspace;
 * - `inactive` — the backend evaluated the license as not active: the
 *   file-first import step for a session that holds
 *   `Licensing.License.Activate` (L-03, ADR-0046), otherwise the license
 *   explainer — deliberately NOT a permission-denied message (an inactive
 *   license also empties the effective permission set server-side —
 *   `AuthorizationService.effectivePermissionCodes` → `filterLicensedPermissions`
 *   — so without this stage the user would be told they lack permission when
 *   the real cause is the installation license);
 * - `error` — the read failed: a retryable error, never silently treated as
 *   active or inactive.
 *
 * `active` covers three backend access modes (OQ-45, ADR-0049): `ACTIVE`
 * renders the workspace unchanged; `GRACE` and `READ_ONLY` render the same
 * workspace behind a Persian notice naming the mode and the grace deadline,
 * because the backend — not this component — is what withholds the mutation
 * permissions.
 *
 * It is a UX boundary only (AR-21). It enforces nothing: it compares no count
 * against `organizationLimit`/`userLimit`, hides no capability by itself, and
 * the backend re-evaluates the license on every licensed operation anyway.
 */
export function LicenseGate({ children }: { children: ReactNode }) {
  const license = useLicenseState();
  const permissions = usePermissions();

  switch (license.status) {
    case 'loading':
      return (
        <BootstrapScreen>
          <ResolvingState label={t.license.checking} />
        </BootstrapScreen>
      );

    case 'error':
      return (
        <BootstrapScreen>
          <div className="space-y-4">
            {/*
              A failed read is its own state: the title names the license
              read that failed, the body stays the normalized transport/server
              reason (never "inactive"), and the user can retry the exact
              same query instead of being pushed into a dead end.
            */}
            <ApiErrorAlert
              error={license.error}
              title={t.license.errorTitle}
              onRetry={license.refetch}
            />
            <LogoutButton />
          </div>
        </BootstrapScreen>
      );

    case 'inactive': {
      // An installation that has never been licensed is a distinct, far more
      // common situation than a license that stopped being valid (L-02): the
      // operator needs the installation identity to obtain a license at all,
      // so it is shown here instead of being hidden in the API response.
      const unlicensed = license.license?.status === 'UNLICENSED';
      const revoked = license.license?.inactiveReason === 'revoked';
      const installationId = license.license?.installationId ?? null;
      const body = unlicensed
        ? t.license.unlicensedBody
        : t.license.inactiveBody;

      // A revoked license refuses every later import (OD-LIC-17), so offering
      // the import form here would be a dead end that implies recovery is
      // possible by re-importing. It is not: a new issuance is required.
      if (revoked) {
        return (
          <BootstrapScreen>
            <BlockedState
              title={t.license.revokedTitle}
              description={
                installationId === null
                  ? t.license.revokedBody
                  : `${t.license.revokedBody} (${t.license.installationIdLabel}: ${installationId})`
              }
            />
          </BootstrapScreen>
        );
      }

      // The import step (L-03): one route accepts the signed file, a bare
      // artifact or a legacy VLIC1 code. It is offered when the session
      // actually holds the backend's own permission — a UX affordance only
      // (AR-21): `POST /license/import` re-authorizes the call, so a session
      // without the code sees the unchanged explainer instead of a form that
      // could only ever answer 403. This is NOT a license bypass: the gate
      // still releases only on a backend-confirmed active license, for
      // administrators exactly as for anyone else.
      if (permissions.hasAll([PERMISSIONS.licensing.licenseActivate])) {
        return (
          <BootstrapScreen>
            <div className="space-y-4">
              <LicenseImportCard installationId={installationId} />
              <div className="flex justify-center">
                <LogoutButton />
              </div>
            </div>
          </BootstrapScreen>
        );
      }

      return (
        <BootstrapScreen>
          <BlockedState
            title={
              unlicensed ? t.license.unlicensedTitle : t.license.inactiveTitle
            }
            description={
              installationId === null
                ? body
                : `${body} (${t.license.installationIdLabel}: ${installationId})`
            }
          />
        </BootstrapScreen>
      );
    }

    case 'active': {
      const mode = license.license?.accessMode;
      if (mode === 'GRACE' || mode === 'READ_ONLY') {
        // The deadline is an Instant, not a display string: it is rendered
        // through the shared canonical formatter (organization IANA zone,
        // Jalali-first, Persian digits) exactly like the license status card.
        // Printing the raw ISO value here would bypass the date foundation
        // (docs/datetime.md, AR-32) and show a different shape than every
        // other instant in the product.
        const graceEndsAt = license.license?.graceEndsAt ?? null;
        return (
          <>
            <output
              aria-live="polite"
              className="block border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900"
            >
              {mode === 'GRACE'
                ? t.license.graceNotice
                : t.license.readOnlyNotice}
              {graceEndsAt !== null && (
                <>
                  {' '}
                  {t.license.graceEndsAtLabel}:{' '}
                  <span className="num" dir="ltr">
                    {formatDateTime(graceEndsAt)}
                  </span>
                </>
              )}
            </output>
            {children}
          </>
        );
      }
      return children;
    }
  }
}
