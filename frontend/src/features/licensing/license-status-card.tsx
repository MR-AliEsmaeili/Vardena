import type { ReactElement } from 'react';
import type { LicenseVersionSummary } from '@/api/contracts';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { t } from '@/lib/i18n';
import { formatDateTime } from '@/lib/format';
import { Badge } from '@/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/card';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { LicenseImportForm } from './license-import-form';
import { LicenseRevocationImportForm } from './revocation-import-form';
import { useLicenseState } from './use-license-state';

/** Half-open window rendered as one line in the organization's zone. */
function windowLabel(from: string, until: string | null): string {
  const start = formatDateTime(from);
  const end =
    until === null ? t.license.statusPerpetual : formatDateTime(until);
  return `${start} — ${end}`;
}

/**
 * The license status / renewal surface for a session that holds
 * `Licensing.License.Activate` (L-03, ADR-0046).
 *
 * It exists for one reason an inactive-license screen cannot serve: an
 * installation that is currently active must still be able to import its next
 * signed version BEFORE the current window ends. A future-dated version is
 * retained, marked as the scheduled renewal and becomes effective at its own
 * `validFrom` — the current license keeps working until then (PDR-11 §19
 * CF-1/CF-2).
 *
 * This is not an administration console: it shows the backend's evaluated
 * state (status, window, scheduled version) and offers the one write this
 * slice ships — the import form. Every value comes from
 * `GET /license/current`; nothing is counted, derived or cached locally, and
 * the backend re-authorizes the import on every call (AR-21). Sessions without
 * the permission never see the card at all.
 */
export function LicenseStatusCard(): ReactElement | null {
  const permissions = usePermissions();
  const license = useLicenseState();

  const isPermitted =
    permissions.loaded &&
    permissions.has(PERMISSIONS.licensing.licenseActivate);

  // The revocation surface needs its own code (`Licensing.License.Revoke`):
  // an operator who may import a license cannot necessarily revoke one.
  const isRevokePermitted =
    permissions.loaded && permissions.has(PERMISSIONS.licensing.licenseRevoke);

  // No permission → no surface. The license READ itself needs no permission,
  // but this card's only action does, and a card without its action would be
  // noise.
  if (!isPermitted) return null;

  if (license.status === 'error') {
    return (
      <Card>
        <ApiErrorAlert
          error={license.error}
          title={t.license.errorTitle}
          onRetry={license.refetch}
        />
      </Card>
    );
  }

  const state = license.license;
  const scheduled: LicenseVersionSummary | null =
    state?.scheduledVersion ?? null;

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-bold">
          {t.license.statusTitle}
          {state !== null && (
            <Badge
              variant={
                !state.licensed
                  ? 'neutral'
                  : state.active
                    ? 'success'
                    : 'warning'
              }
            >
              {!state.licensed
                ? t.license.statusUnlicensed
                : state.inactiveReason === 'revoked'
                  ? t.license.statusRevoked
                  : state.accessMode === 'GRACE'
                    ? t.license.statusGrace
                    : state.accessMode === 'READ_ONLY'
                      ? t.license.statusReadOnly
                      : state.active
                        ? t.license.statusActive
                        : t.license.statusInactive}
            </Badge>
          )}
        </CardTitle>
        {state !== null && (
          <CardDescription>
            {state.installationId !== null && (
              <>
                {t.license.installationIdLabel}:{' '}
                <span className="code break-all" dir="ltr">
                  {state.installationId}
                </span>
              </>
            )}
          </CardDescription>
        )}
      </CardHeader>

      <CardContent className="min-w-0 space-y-4">
        {state === null || license.status === 'loading' ? (
          <p className="text-xs text-ink-subtle">{t.license.checking}</p>
        ) : (
          <>
            {state.revokedAt !== null && (
              <p className="text-xs text-ink-muted">
                {t.license.revokedAtLabel}:{' '}
                <span className="num" dir="ltr">
                  {formatDateTime(state.revokedAt)}
                </span>
              </p>
            )}

            {state.graceEndsAt !== null && (
              <p className="text-xs text-ink-muted">
                {t.license.graceEndsAtLabel}:{' '}
                <span className="num" dir="ltr">
                  {formatDateTime(state.graceEndsAt)}
                </span>
              </p>
            )}

            {state.licensed && state.validFrom !== null && (
              <p className="text-xs text-ink-muted">
                {t.license.statusWindow}:{' '}
                <span className="num" dir="ltr">
                  {windowLabel(state.validFrom, state.validUntil)}
                </span>
              </p>
            )}

            {/*
              The end of the whole purchased coverage (OD-LIC-06 §6, PO
              decision Q-2). It differs from the governing version's
              `validUntil` exactly when a renewal is already retained, which is
              the fact an operator must not misread: the term does not end where
              the current row ends.
            */}
            {state.coverageEnd !== null &&
              state.coverageEnd !== state.validUntil && (
                <p className="text-xs text-ink-muted">
                  <span>{t.license.statusCoverageEnd}</span>:{' '}
                  <span className="num break-words" dir="ltr">
                    {formatDateTime(state.coverageEnd)}
                  </span>{' '}
                  <span className="text-ink-subtle">
                    {t.license.statusCoverageEndHint}
                  </span>
                </p>
              )}

            {scheduled !== null && (
              <div className="rounded-md border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs text-brand-ink">
                <p className="font-medium">{t.license.statusScheduled}</p>
                {/*
                  `effectiveFrom`, not `validFrom`: a renewal is issued early
                  but governs from the renewed term boundary, and showing the
                  signed issuance day here would claim the current term ends
                  earlier than it does.
                */}
                <p className="num break-words" dir="ltr">
                  {t.license.statusEffectiveFrom}:{' '}
                  {windowLabel(scheduled.effectiveFrom, scheduled.validUntil)}
                </p>
                <p className="mt-1 text-indigo-800">
                  {t.license.statusScheduledHint}
                </p>
              </div>
            )}

            {/*
              Retained versions (bounded by the backend) so an operator can
              name the renewal target unambiguously: the signed operation id is
              what the Owner must sign as `renewsOperationId`, and only a
              version the state reports can be extended (OD-LIC-06 §4F). This is
              display-only; the backend re-resolves every rule on import.
            */}
            {state.versions.length > 0 && (
              <div className="rounded-md border border-line px-3 py-2 text-xs text-ink-muted">
                <p className="font-medium text-ink-muted">
                  {t.license.statusHistory}
                </p>
                <p className="mt-1 text-ink-subtle">
                  {t.license.statusHistoryHint}
                </p>
                <ul className="mt-2 space-y-1">
                  {state.versions.map((version) => (
                    <li
                      key={version.versionId}
                      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
                    >
                      <Badge
                        variant={
                          version.versionId === state.effectiveVersionId
                            ? 'success'
                            : version.governsUntil !== null
                              ? 'neutral'
                              : 'info'
                        }
                      >
                        {version.versionId === state.effectiveVersionId
                          ? t.license.statusVersionEffective
                          : version.governsUntil !== null
                            ? t.license.statusVersionRetired
                            : t.license.statusVersionScheduled}
                      </Badge>
                      <span className="num break-words" dir="ltr">
                        {windowLabel(version.effectiveFrom, version.validUntil)}
                      </span>
                      <span className="text-ink-subtle">
                        {t.license.statusOperationId}:{' '}
                        <span className="code break-all" dir="ltr">
                          {version.operationId}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="border-t border-line pt-3">
              <p className="mb-2 text-xs font-medium text-ink-muted">
                {t.license.importTitle}
              </p>
              <LicenseImportForm />
            </div>

            {/*
              Signed revocation (OD-LIC-17). A separate act with a separate
              permission: importing a revocation turns this installation's
              license off, so it is never offered as part of license import.
              Hidden once the license IS revoked — the backend refuses a second
              revocation (409 `already-revoked`) and re-importing a license
              cannot restore it, so the form would only imply a recovery path
              that does not exist.
            */}
            {isRevokePermitted && state.inactiveReason !== 'revoked' && (
              <div className="border-t border-line pt-3">
                <p className="mb-1 text-xs font-medium text-ink-muted">
                  {t.license.revocationTitle}
                </p>
                <p className="mb-2 text-xs text-ink-subtle">
                  {t.license.revocationBody}
                </p>
                <LicenseRevocationImportForm />
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
