import { useQuery } from '@tanstack/react-query';
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
 *
 * That constraint is the point of the component. A dashboard that added,
 * averaged or "estimated" locally would become a second source of truth that
 * silently disagrees with the list pages; instead every figure below is either
 * printed verbatim or is a sum of two printed figures that partition the same
 * set (`preparedRequests.eligible + expired === issuances.prepared`, which the
 * backend suite also asserts). The "needs action" list is derived by testing
 * those counts against zero — a presentation decision, not a new fact.
 *
 * States are explicit: loading (with the real layout), a normalized retryable
 * error, and the genuine empty case (a fresh installation with nothing
 * recorded yet). Nothing here is a permission decision: `licenses.view` gates
 * the page and the backend re-authorizes the read.
 */
export function DashboardPage() {
  const permissions = usePermissions();
  const query = useQuery({
    queryKey: ['owner', 'dashboard'],
    queryFn: ({ signal }) => dashboardApi.getDashboardSummary(signal),
    enabled: permissions.loaded && permissions.has('licenses.view'),
  });

  if (!permissions.loaded) return <LoadingState />;
  // A session without the licensing read scope gets no summary at all rather
  // than a "forbidden" wall on its home page: the dashboard is an addition to
  // the workspace, not a screen that owns a route.
  if (!permissions.has('licenses.view')) return null;

  return (
    <section className="space-y-3" aria-labelledby="owner-dashboard-title">
      <div>
        <h2 id="owner-dashboard-title" className="text-lg font-bold text-ink">
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

  // Every condition below is "the count is not zero", so the list can never
  // name an action the counts do not support.
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
    <div className="space-y-3">
      {nothingRecorded ? (
        <EmptyState title={o.dashboard.empty} />
      ) : (
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Stat
            label={o.dashboard.customers}
            value={summary.customers.active}
            hint={`${o.dashboard.customersHint}${summary.customers.inactive}`}
            to="/app/customers"
            linkLabel={o.dashboard.openCustomers}
          />
          <Stat
            label={o.dashboard.identities}
            value={summary.installationIdentities.active}
            hint={`${o.dashboard.identitiesHint}${summary.installationIdentities.retired}`}
          />
          <Stat
            label={o.dashboard.prepared}
            value={summary.issuances.prepared}
            hint={`${o.dashboard.preparedEligible}: ${summary.preparedRequests.eligible} · ${o.dashboard.preparedExpired}: ${summary.preparedRequests.expired}`}
            to="/app/licenses"
            linkLabel={o.dashboard.openLicenses}
          />
          <Stat
            label={o.dashboard.signed}
            value={summary.issuances.signed}
            hint={`${o.dashboard.abandoned}: ${summary.issuances.abandoned}`}
            to="/app/licenses"
            linkLabel={o.dashboard.openLicenses}
          />
          <Stat
            label={o.dashboard.revocationsRecorded}
            value={summary.revocations.recorded}
            hint={`${o.dashboard.revocationsRequested}: ${summary.revocations.requested}`}
            to="/app/licenses"
            linkLabel={o.dashboard.openLicenses}
          />
          <Stat
            label={o.dashboard.signingKeysActive}
            value={summary.signingKeys.active}
            hint={`${o.dashboard.signingKeysReview}: ${summary.signingKeys.needsReview}`}
            to="/app/signing-keys"
            linkLabel={o.dashboard.openSigningKeys}
          />
          <Stat
            label={o.dashboard.artifactsPending}
            value={summary.licenseArtifacts.pending}
            hint={`${o.dashboard.artifactsQuarantined}: ${summary.licenseArtifacts.quarantined}`}
          />
        </dl>
      )}

      <section
        className="owner-panel space-y-2 p-4"
        aria-labelledby="owner-dashboard-attention"
      >
        <h3
          id="owner-dashboard-attention"
          className="text-sm font-bold text-ink"
        >
          {o.dashboard.attention}
        </h3>
        {attention.length === 0 ? (
          <p className="text-sm text-secondary">{o.dashboard.attentionNone}</p>
        ) : (
          <ul className="list-inside list-disc space-y-1 text-sm text-secondary">
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
  label,
  value,
  hint,
  to,
  linkLabel,
}: {
  label: string;
  value: number;
  hint?: string;
  to?: string;
  linkLabel?: string;
}) {
  return (
    <div className="owner-panel p-4">
      <dt className="text-sm text-secondary">{label}</dt>
      <dd className="mt-1 space-y-1">
        <span className={cn('num text-2xl font-bold text-ink')}>{value}</span>
        {hint !== undefined && (
          <p className="num text-xs text-muted-ink">{hint}</p>
        )}
        {to !== undefined && linkLabel !== undefined && (
          <Link
            className="inline-block text-sm font-medium text-accent underline-offset-2 hover:underline"
            to={to}
          >
            {linkLabel}
          </Link>
        )}
      </dd>
    </div>
  );
}
