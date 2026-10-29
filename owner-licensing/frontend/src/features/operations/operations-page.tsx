import { LocalFetchingIndicator } from '@/ui/patterns/request-activity';
import { Select } from '@/ui/select';
import { PageHeading } from '@/ui/patterns/page-heading';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '@/api/owner.api';
import { usePermissions } from '@/features/permissions/use-permissions';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { o } from '@/lib/owner-i18n';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { EmptyState, LoadingState } from '@/ui/patterns/states';
import { Pagination } from '@/ui/patterns/owner-states';
import { ManualNotice, OperationError, labelOf } from './operation-ui';

/** OQ-74: show the signing-key id and the derived safety status inline. */
export function SigningKeySafetyLine({
  signingKeyId,
  safety,
}: {
  signingKeyId: string | null;
  safety: 'SAFE' | 'NEEDS_REVIEW' | 'UNKNOWN';
}) {
  const labelMap: Record<typeof safety, string> = {
    SAFE: o.signingKeySafetySafe,
    NEEDS_REVIEW: o.signingKeySafetyNeedsReview,
    UNKNOWN: o.signingKeySafetyUnknown,
  };
  const variants: Record<typeof safety, 'success' | 'critical' | 'neutral'> = {
    SAFE: 'success',
    NEEDS_REVIEW: 'critical',
    UNKNOWN: 'neutral',
  };
  const helpMap: Record<typeof safety, string> = {
    SAFE: o.signingKeySafetySafeHelp,
    NEEDS_REVIEW: o.signingKeySafetyNeedsReviewHelp,
    UNKNOWN: o.signingKeySafetyUnknownHelp,
  };
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted-ink">{o.operationsSigningKeyColumn}: </span>
      {signingKeyId ? (
        <span className="code text-secondary" dir="ltr">
          {signingKeyId}
        </span>
      ) : (
        <span className="text-subtle">—</span>
      )}
      <Badge variant={variants[safety]} title={helpMap[safety]}>
        {labelMap[safety]}
      </Badge>
    </p>
  );
}

export function OperationsPage() {
  const [params, setParams] = useSearchParams();
  const search = params.get('search') ?? '';
  const kind = params.get('kind') ?? '';
  const status = params.get('status') ?? '';
  const debounced = useDebouncedValue(search, 300);
  const page = Math.max(1, Number(params.get('page')) || 1);
  const permissions = usePermissions();
  const query = useQuery({
    queryKey: ['owner', 'operations', debounced, kind, status, page],
    queryFn: ({ signal }) =>
      api.operationalRecords(debounced, page, { kind, status }, signal),
    enabled: permissions.has('operations.view'),
  });
  const setFilter = (next: Record<string, string>) =>
    setParams({ search, kind, status, page: '1', ...next });
  if (!permissions.loaded) return <LoadingState />;
  if (!permissions.has('operations.view'))
    return (
      <p className="owner-panel p-4 text-sm text-secondary">{o.forbidden}</p>
    );
  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <PageHeading>{o.operations}</PageHeading>
        {(permissions.has('operations.record') ||
          permissions.has('replacements.authorize')) && (
          <div className="flex flex-wrap gap-2">
            {permissions.has('operations.record') && (
              <Button asChild>
                <Link to="/app/operations/activation/new">
                  {o.recordIssuance}
                </Link>
              </Button>
            )}
            {permissions.has('replacements.authorize') && (
              <Button asChild variant="outline">
                <Link to="/app/operations/replacement/new">
                  {o.recordReplacement}
                </Link>
              </Button>
            )}
          </div>
        )}
      </header>
      <ManualNotice />
      <div className="owner-toolbar sm:grid-cols-3">
        <label className="block space-y-2">
          <span>{o.search}</span>
          <Input
            value={search}
            maxLength={100}
            onChange={(event) =>
              setFilter({ search: event.target.value, page: '1' })
            }
          />
        </label>
        <label className="block space-y-2">
          <span>{o.kindFilter}</span>
          <Select
            value={kind}
            onChange={(event) => setFilter({ kind: event.target.value })}
          >
            <option value="">{o.all}</option>
            <option value="LICENSE">{o.kinds.LICENSE}</option>
            <option value="SERVER_REPLACEMENT">
              {o.kinds.SERVER_REPLACEMENT}
            </option>
          </Select>
        </label>
        <label className="block space-y-2">
          <span>{o.statusFilter}</span>
          <Select
            value={status}
            onChange={(event) => setFilter({ status: event.target.value })}
          >
            <option value="">{o.all}</option>
            {Object.entries(o.statuses)
              .filter(([code]) =>
                [
                  'ISSUED',
                  'ACTIVATED',
                  'REPLACEMENT_AUTHORIZED',
                  'OLD_SERVER_STATE_RECORDED',
                  'REPLACEMENT_RECORDED',
                ].includes(code),
              )
              .map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
          </Select>
        </label>
      </div>
      <LocalFetchingIndicator active={query.isFetching && !query.isPending} />
      {query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <OperationError error={query.error} />
      ) : query.data.items.length === 0 ? (
        <EmptyState
          title={search || kind || status ? o.noResults : o.emptyOperations}
          description={o.emptyOperationsHelp}
        />
      ) : (
        <ul className="divide-y owner-panel overflow-hidden">
          {query.data.items.map((item) => (
            <li
              key={item.id}
              className="space-y-1.5 p-4 transition-colors hover:bg-muted/50"
            >
              <Link
                className="text-sm font-semibold text-accent-ink underline-offset-4 hover:underline"
                to={`/app/operations/${item.id}`}
              >
                {item.displayName}
              </Link>
              <p className="code text-sm text-muted-ink" dir="ltr">
                {item.customerCode}
              </p>
              <p className="text-sm">
                {o.kinds[item.kind]} — {labelOf(item.observedStatus)}
                {item.emergencyOldServerLost ? ` — ${o.emergency}` : ''}
              </p>
              {/* OQ-74: signing-key safety status. Only LICENSE observations
                  carry a signing key; SERVER_REPLACEMENT is always UNKNOWN. */}
              {item.kind === 'LICENSE' && (
                <SigningKeySafetyLine
                  signingKeyId={item.signingKeyId}
                  safety={item.signingKeySafety}
                />
              )}
              <p className="text-xs text-muted-ink">{o.operatorObserved}</p>
            </li>
          ))}
        </ul>
      )}
      <Pagination
        page={page}
        count={query.data?.items.length ?? 0}
        setPage={(next) =>
          setParams({ search, kind, status, page: String(next) })
        }
      />
    </section>
  );
}
