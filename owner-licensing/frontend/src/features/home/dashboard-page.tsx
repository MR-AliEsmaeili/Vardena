import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Cpu,
  FileCheck2,
  FileClock,
  KeyRound,
  PackageCheck,
  ShieldAlert,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import * as dashboardApi from '@/api/dashboard.api';
import type { DashboardSummary } from '@/api/dashboard.api';
import { usePermissions } from '@/features/permissions/use-permissions';
import { formatOwnerInstant } from '@/lib/date-time';
import { o } from '@/lib/owner-i18n';
import { cn } from '@/lib/utils';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { EmptyState, LoadingState } from '@/ui/patterns/states';

/**
 * Owner dashboard (TS-8.2). It renders ONE server payload — the counts the
 * backend just took from the Owner database — and never computes a number of
 * its own.
 */
export function DashboardPage() {
  const permissions = usePermissions();
  const query = useQuery({
    queryKey: ['owner', 'dashboard'],
    queryFn: ({ signal }) => dashboardApi.getDashboardSummary(signal),
    enabled: permissions.loaded && permissions.has('licenses.view'),
  });

  if (!permissions.loaded) return <LoadingState />;
  if (!permissions.has('licenses.view')) return null;

  return (
    <section className="space-y-4" aria-labelledby="owner-dashboard-title">
      <div className="space-y-1">
        <h2
          id="owner-dashboard-title"
          className="text-base font-bold text-ink sm:text-lg"
        >
          {o.dashboard.title}
        </h2>
        <p className="text-sm text-secondary">{o.dashboard.help}</p>
      </div>

      {query.status === 'pending' ? (
        <LoadingState label={o.dashboard.loading} rows={4} />
      ) : query.status === 'error' ? (
        <ApiErrorAlert
          error={query.error}
          title={o.dashboard.error}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <DashboardBody summary={query.data} />
      )}
    </section>
  );
}

function DashboardBody({ summary }: { summary: DashboardSummary }) {
  const nothingRecorded =
    summary.customers.active === 0 &&
    summary.customers.inactive === 0 &&
    summary.issuances.prepared === 0 &&
    summary.issuances.signed === 0 &&
    summary.issuances.abandoned === 0 &&
    summary.revocations.requested === 0 &&
    summary.revocations.recorded === 0 &&
    summary.installationIdentities.active === 0 &&
    summary.installationIdentities.retired === 0 &&
    summary.signingKeys.active === 0 &&
    summary.signingKeys.needsReview === 0;

  const attention: string[] = [];
  if (summary.preparedRequests.eligible > 0)
    attention.push(o.dashboard.attentionPrepared);
  if (summary.revocations.requested > 0)
    attention.push(o.dashboard.attentionRevocations);
  if (summary.preparedRequests.expired > 0)
    attention.push(o.dashboard.attentionExpired);
  if (summary.signingKeys.needsReview > 0)
    attention.push(o.dashboard.attentionKeys);
  if (
    summary.licenseArtifacts.pending > 0 ||
    summary.licenseArtifacts.quarantined > 0
  )
    attention.push(o.dashboard.attentionArtifacts);

  return (
    <div className="space-y-4">
      {nothingRecorded ? (
        <EmptyState title={o.dashboard.empty} />
      ) : (
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Stat
            icon={Users}
            label={o.dashboard.customers}
            value={summary.customers.active}
            hint={`${o.dashboard.customersHint}${summary.customers.inactive}`}
            to="/app/customers"
            linkLabel={o.dashboard.openCustomers}
          />
          <Stat
            icon={Cpu}
            label={o.dashboard.identities}
            value={summary.installationIdentities.active}
            hint={`${o.dashboard.identitiesHint}${summary.installationIdentities.retired}`}
          />
          <Stat
            icon={FileClock}
            label={o.dashboard.prepared}
            value={summary.issuances.prepared}
            hint={`${o.dashboard.preparedEligible}: ${summary.preparedRequests.eligible} · ${o.dashboard.preparedExpired}: ${summary.preparedRequests.expired}`}
            to="/app/licenses"
            linkLabel={o.dashboard.openLicenses}
          />
          <Stat
            icon={FileCheck2}
            label={o.dashboard.signed}
            value={summary.issuances.signed}
            hint={`${o.dashboard.abandoned}: ${summary.issuances.abandoned}`}
            to="/app/licenses"
            linkLabel={o.dashboard.openLicenses}
          />
          <Stat
            icon={ShieldAlert}
            label={o.dashboard.revocationsRecorded}
            value={summary.revocations.recorded}
            hint={`${o.dashboard.revocationsRequested}: ${summary.revocations.requested}`}
            to="/app/licenses"
            linkLabel={o.dashboard.openLicenses}
          />
          <Stat
            icon={KeyRound}
            label={o.dashboard.signingKeysActive}
            value={summary.signingKeys.active}
            hint={`${o.dashboard.signingKeysReview}: ${summary.signingKeys.needsReview}`}
            to="/app/signing-keys"
            linkLabel={o.dashboard.openSigningKeys}
          />
          <Stat
            icon={PackageCheck}
            label={o.dashboard.artifactsPending}
            value={summary.licenseArtifacts.pending}
            hint={`${o.dashboard.artifactsQuarantined}: ${summary.licenseArtifacts.quarantined}`}
          />
        </dl>
      )}

      <section
        className={cn(
          'owner-panel space-y-2.5 p-4',
          attention.length > 0 &&
            'border-warning-line border-s-4 border-s-warning bg-warning-soft/40',
        )}
        aria-labelledby="owner-dashboard-attention"
      >
        <div className="flex items-center gap-2">
          {attention.length > 0 ? (
            <AlertTriangle
              aria-hidden="true"
              className="size-4 shrink-0 text-warning"
            />
          ) : (
            <CheckCircle2
              aria-hidden="true"
              className="size-4 shrink-0 text-success"
            />
          )}
          <h3
            id="owner-dashboard-attention"
            className="text-sm font-bold text-ink"
          >
            {o.dashboard.attention}
          </h3>
        </div>
        {attention.length === 0 ? (
          <p className="text-sm text-secondary">{o.dashboard.attentionNone}</p>
        ) : (
          <ul className="list-inside list-disc space-y-1 text-sm text-ink">
            {attention.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-ink">{o.dashboard.artifactsHint}</p>
        <p className="text-xs text-muted-ink">
          {o.dashboard.preparedHint} {o.dashboard.signingKeysReviewHint}
        </p>
      </section>

      <p className="text-xs text-muted-ink">
        {o.dashboard.generatedAt}:{' '}
        <span className="num">{formatOwnerInstant(summary.generatedAt)}</span>
      </p>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
  to,
  linkLabel,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  hint?: string;
  to?: string;
  linkLabel?: string;
}) {
  return (
    <div className="owner-panel flex flex-col justify-between gap-2 p-4">
      <dt className="flex items-center justify-between gap-2 text-xs font-medium text-secondary">
        <span>{label}</span>
        <span
          aria-hidden="true"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-muted text-accent-ink"
        >
          <Icon className="size-3.5" />
        </span>
      </dt>
      <dd className="space-y-1.5">
        <span className={cn('num text-2xl font-bold tracking-tight text-ink')}>
          {value}
        </span>
        {hint !== undefined && (
          <p className="num text-xs text-muted-ink">{hint}</p>
        )}
        {to !== undefined && linkLabel !== undefined && (
          <Link
            className="inline-flex items-center gap-1 pt-0.5 text-xs font-semibold text-accent-ink underline-offset-4 hover:underline"
            to={to}
          >
            {linkLabel}
            <ArrowLeft aria-hidden="true" className="size-3.5" />
          </Link>
        )}
      </dd>
    </div>
  );
}
