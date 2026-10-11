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
    <Card>
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
                <span className="code" dir="ltr">
                  {state.installationId}
                </span>
              </>
            )}
          </CardDescription>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {state === null || license.status === 'loading' ? (
          <p className="text-xs text-slate-500">{t.license.checking}</p>
        ) : (
          <>
            {state.licensed && state.validFrom !== null && (
              <p className="text-xs text-slate-600">
                {t.license.statusWindow}:{' '}
                <span className="num" dir="ltr">
                  {windowLabel(state.validFrom, state.validUntil)}
                </span>
              </p>
            )}

            {scheduled !== null && (
              <div className="rounded-md border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs text-indigo-900">
                <p className="font-medium">{t.license.statusScheduled}</p>
                <p className="num" dir="ltr">
                  {t.license.statusEffectiveFrom}:{' '}
                  {windowLabel(scheduled.validFrom, scheduled.validUntil)}
                </p>
                <p className="mt-1 text-indigo-800">
                  {t.license.statusScheduledHint}
                </p>
              </div>
            )}

            <div className="border-t border-slate-100 pt-3">
              <p className="mb-2 text-xs font-medium text-slate-700">
                {t.license.importTitle}
              </p>
              <LicenseImportForm />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
