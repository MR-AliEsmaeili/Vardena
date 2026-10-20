import { LocalFetchingIndicator } from '@/ui/patterns/request-activity';
import { PageHeading } from '@/ui/patterns/page-heading';
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
  if (!permissions.has('customers.view'))
    return (
      <p className="owner-panel p-4 text-sm text-secondary">{o.forbidden}</p>
    );
  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <PageHeading>{o.customers}</PageHeading>
        {permissions.has('customers.write') && (
          <Button asChild>
            <Link to="/app/customers/new">{o.newCustomer}</Link>
          </Button>
        )}
      </header>
      <label className="owner-toolbar">
        <span>{o.search}</span>
        <Input
          value={search}
          maxLength={100}
          onChange={(e) => setParams({ search: e.target.value, page: '1' })}
        />
      </label>
      <LocalFetchingIndicator active={query.isFetching && !query.isPending} />
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
        <ul className="divide-y owner-panel">
          {query.data.items.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <Link
                  className="font-semibold text-accent-strong underline"
                  to={`/app/customers/${c.id}`}
                >
                  {c.displayName}
                </Link>
                <p className="code text-sm text-muted-ink">{c.customerCode}</p>
              </div>
              <span
                className={`owner-status ${c.status === 'ACTIVE' ? 'border-success-line bg-success-soft text-success' : 'border-line bg-muted text-secondary'}`}
              >
                {c.status === 'ACTIVE' ? o.active : o.inactive}
              </span>
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
