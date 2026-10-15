import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '@/api/owner.api';
import { usePermissions } from '@/features/permissions/use-permissions';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { o } from '@/lib/owner-i18n';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { EmptyState, LoadingState } from '@/ui/patterns/states';
import { Pagination } from '@/ui/patterns/owner-states';
import { ManualNotice, OperationError, labelOf } from './operation-ui';

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
  if (!permissions.has('operations.view')) return <p>{o.forbidden}</p>;
  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">{o.operations}</h1>
        {permissions.has('operations.record') && (
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link to="/app/operations/activation/new">
                {o.recordIssuance}
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/app/operations/replacement/new">
                {o.recordReplacement}
              </Link>
            </Button>
          </div>
        )}
      </header>
      <ManualNotice />
      <div className="grid gap-3 sm:grid-cols-3">
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
          <select
            className="w-full rounded border p-2"
            value={kind}
            onChange={(event) => setFilter({ kind: event.target.value })}
          >
            <option value="">{o.all}</option>
            <option value="LICENSE">{o.kinds.LICENSE}</option>
            <option value="SERVER_REPLACEMENT">
              {o.kinds.SERVER_REPLACEMENT}
            </option>
          </select>
        </label>
        <label className="block space-y-2">
          <span>{o.statusFilter}</span>
          <select
            className="w-full rounded border p-2"
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
          </select>
        </label>
      </div>
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
        <ul className="divide-y rounded-lg border border-slate-200 bg-white">
          {query.data.items.map((item) => (
            <li key={item.id} className="space-y-1 p-4">
              <Link
                className="font-semibold text-indigo-700 underline"
                to={`/app/operations/${item.id}`}
              >
                {item.displayName}
              </Link>
              <p className="code text-sm text-slate-500" dir="ltr">
                {item.customerCode}
              </p>
              <p className="text-sm">
                {o.kinds[item.kind]} — {labelOf(item.observedStatus)}
                {item.emergencyOldServerLost ? ` — ${o.emergency}` : ''}
              </p>
              <p className="text-xs text-slate-500">{o.operatorObserved}</p>
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
