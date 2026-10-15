import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '@/api/owner.api';
import { usePermissions } from '@/features/permissions/use-permissions';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { o } from '@/lib/owner-i18n';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { EmptyState, LoadingState } from '@/ui/patterns/states';
import { Pagination } from '@/ui/patterns/owner-states';

export function CustomersPage() {
  const [params, setParams] = useSearchParams();
  const search = params.get('search') ?? '';
  const debounced = useDebouncedValue(search, 300);
  const page = Math.max(1, Number(params.get('page')) || 1);
  const permissions = usePermissions();
  const query = useQuery({
    queryKey: ['owner', 'customers', debounced, page],
    queryFn: ({ signal }) => api.customers(debounced, page, signal),
    enabled: permissions.has('customers.view'),
  });
  if (!permissions.loaded) return <LoadingState />;
  if (!permissions.has('customers.view')) return <p>{o.forbidden}</p>;
  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{o.customers}</h1>
        {permissions.has('customers.write') && (
          <Button asChild>
            <Link to="/app/customers/new">{o.newCustomer}</Link>
          </Button>
        )}
      </header>
      <label className="block space-y-2">
        <span>{o.search}</span>
        <Input
          value={search}
          maxLength={100}
          onChange={(e) => setParams({ search: e.target.value, page: '1' })}
        />
      </label>
      {query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ApiErrorAlert
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : query.data.items.length === 0 ? (
        <EmptyState
          title={search ? o.noResults : o.empty}
          description={o.emptyHelp}
        />
      ) : (
        <ul className="divide-y rounded-lg border border-slate-200 bg-white">
          {query.data.items.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-3 p-4"
            >
              <div>
                <Link
                  className="font-semibold text-indigo-700 underline"
                  to={`/app/customers/${c.id}`}
                >
                  {c.displayName}
                </Link>
                <p className="code text-sm text-slate-500">{c.customerCode}</p>
              </div>
              <span>{c.status === 'ACTIVE' ? o.active : o.inactive}</span>
            </li>
          ))}
        </ul>
      )}
      <Pagination
        page={page}
        count={query.data?.items.length ?? 0}
        setPage={(p) => setParams({ search, page: String(p) })}
      />
    </section>
  );
}
