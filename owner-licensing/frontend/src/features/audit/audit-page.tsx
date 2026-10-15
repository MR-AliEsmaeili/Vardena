import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import * as api from '@/api/owner.api';
import { usePermissions } from '@/features/permissions/use-permissions';
import { o } from '@/lib/owner-i18n';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { EmptyState, LoadingState } from '@/ui/patterns/states';
import { Pagination } from '@/ui/patterns/owner-states';
export function AuditPage() {
  const permissions = usePermissions(),
    [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const query = useQuery({
    queryKey: ['owner', 'audit', page],
    queryFn: () => api.auditEvents(page),
    enabled: permissions.has('audit.view'),
  });
  if (!permissions.loaded) return <LoadingState />;
  if (!permissions.has('audit.view')) return <p>{o.forbidden}</p>;
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-bold">{o.audit}</h1>
      <p className="text-sm text-slate-500">{o.auditNotice}</p>
      {query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ApiErrorAlert
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : query.data.items.length === 0 ? (
        <EmptyState title={o.noAudit} />
      ) : (
        <ul className="space-y-3">
          {query.data.items.map((e) => (
            <li key={e.id} className="space-y-2 rounded border bg-white p-4">
              <h2 className="font-semibold" dir="ltr">
                {e.eventType}
              </h2>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                {[
                  [o.actor, e.actorId],
                  [o.target, e.targetId],
                  [o.time, e.occurredAt],
                  [o.outcome, e.outcome],
                  [o.reason, e.reason],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-slate-500">{label}</dt>
                    <dd dir="auto" className="break-all">
                      {value ?? '—'}
                    </dd>
                  </div>
                ))}
              </dl>
              <details>
                <summary>
                  {o.before} / {o.after}
                </summary>
                <pre dir="ltr" className="overflow-auto text-xs">
                  {JSON.stringify(
                    { before: e.beforeState, after: e.afterState },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </li>
          ))}
        </ul>
      )}
      <Pagination
        page={page}
        count={query.data?.items.length ?? 0}
        setPage={(p) => setParams({ page: String(p) })}
      />
    </section>
  );
}
