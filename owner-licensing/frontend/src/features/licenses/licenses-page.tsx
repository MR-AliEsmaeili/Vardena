import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as lic from '@/api/licensing';
import type { Issuance } from '@/api/licensing';
import { usePermissions } from '@/features/permissions/use-permissions';
import type { CustomerOption } from '@/features/customers/customer-picker';
import { o } from '@/lib/owner-i18n';
import { PageHeading } from '@/ui/patterns/page-heading';
import { LocalFetchingIndicator } from '@/ui/patterns/request-activity';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { EmptyState, LoadingState } from '@/ui/patterns/states';
import { Pagination } from '@/ui/patterns/owner-states';
import { IssuanceCard } from './issuance-card';
import {
  PrepareIssuanceForm,
  type IssuancePrefill,
} from './prepare-issuance-form';

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * Owner-side license issuance and lifecycle (OD-LIC-07…19).
 *
 * The page has two jobs: prepare unsigned requests from *selected, real*
 * records (customer → registered installation → active signing key, with the
 * customer's active ceiling visible and a review step), and follow each
 * issuance to its signed artifact, renewal, and revocation.
 *
 * `?renews=` / `?supersedes=` open the form pre-filled from the named issuance
 * (OWNER_ADMIN only — the backend re-enforces that), and `?customer=` narrows
 * the list to one customer. All three are links from real records; none of them
 * selects anything by guesswork.
 */
export function LicensesPage() {
  const permissions = usePermissions();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const customerFilter = params.get('customer') ?? '';
  const lineageParam = params.get('renews')
    ? { mode: 'renew' as const, operationId: params.get('renews') ?? '' }
    : params.get('supersedes')
      ? {
          mode: 'supersede' as const,
          operationId: params.get('supersedes') ?? '',
        }
      : null;

  const lineageIssuance = useQuery({
    queryKey: [
      'owner',
      'license-issuance',
      'lineage',
      lineageParam?.operationId,
    ],
    queryFn: ({ signal }) =>
      lic.issuance(lineageParam?.operationId ?? '', signal),
    enabled:
      lineageParam !== null &&
      ULID.test(lineageParam.operationId) &&
      permissions.has('licenses.view'),
  });

  const query = useQuery({
    queryKey: ['owner', 'license-issuances', page, customerFilter],
    queryFn: ({ signal }) =>
      lic.issuances(
        page,
        {
          ...(ULID.test(customerFilter) ? { customerId: customerFilter } : {}),
        },
        signal,
      ),
    enabled: permissions.has('licenses.view'),
  });

  if (!permissions.loaded) return <LoadingState />;
  if (!permissions.has('licenses.view'))
    return (
      <p className="owner-panel p-4 text-sm text-secondary">{o.forbidden}</p>
    );

  const prefill = buildPrefill(lineageParam, lineageIssuance.data);
  const clearLineage = () => {
    const next = new URLSearchParams(params);
    next.delete('renews');
    next.delete('supersedes');
    setParams(next, { replace: true });
  };

  return (
    <section className="space-y-5">
      <header className="space-y-1">
        <PageHeading>{o.licenses.title}</PageHeading>
        <p className="text-sm text-secondary">{o.licenses.intro}</p>
      </header>
      {lineageParam && !prefill ? (
        <p className="owner-panel p-3 text-sm text-secondary">
          {lineageIssuance.isPending
            ? o.licenses.importing
            : o.licenses.lineageNoTargets}
        </p>
      ) : null}
      {prefill ? (
        <p className="owner-panel p-3 text-sm">
          {o.licenses.lineagePreselected}{' '}
          <button
            type="button"
            className="text-accent underline"
            onClick={clearLineage}
          >
            {o.licenses.lineageNone}
          </button>
        </p>
      ) : null}
      {lineageIssuance.isError ? (
        <ApiErrorAlert
          error={lineageIssuance.error}
          onRetry={() => void lineageIssuance.refetch()}
        />
      ) : null}
      {/*
        The form owns its draft state, and a renewal link arrives
        asynchronously (the named issuance is fetched first). Keying the form by
        the pre-filled record remounts it exactly once when that data lands, so
        the draft starts from the real source instead of an empty one.
      */}
      <PrepareIssuanceForm
        key={prefill ? prefill.source.id : 'new-issuance'}
        prefill={prefill}
      />
      {customerFilter && ULID.test(customerFilter) ? (
        <p className="text-sm text-secondary">
          {o.licenses.filterCustomer}:{' '}
          <span dir="ltr" className="code">
            {customerFilter}
          </span>{' '}
          <button
            type="button"
            className="text-accent underline"
            onClick={() => {
              const next = new URLSearchParams(params);
              next.delete('customer');
              setParams(next, { replace: true });
            }}
          >
            {o.licenses.allCustomers}
          </button>
        </p>
      ) : null}
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
          title={o.licenses.empty}
          description={o.licenses.emptyHelp}
          action={
            <Link className="text-sm text-accent underline" to="/app/customers">
              {o.newCustomer}
            </Link>
          }
        />
      ) : (
        <>
          <ul className="space-y-3">
            {query.data.items.map((issuance) => (
              <IssuanceCard key={issuance.id} issuance={issuance} />
            ))}
          </ul>
          <Pagination
            page={query.data.page}
            count={query.data.items.length}
            setPage={setPage}
            hasNext={query.data.items.length === query.data.pageSize}
          />
        </>
      )}
    </section>
  );
}

/**
 * A renewal/supersession link names a real issuance; the form is pre-filled
 * from that record so the operator never re-types a customer or installation.
 * The source is deliberately not copied blindly: the operator still reviews and
 * can change limits, modules, kind and end date.
 */
function buildPrefill(
  lineage: { mode: 'renew' | 'supersede'; operationId: string } | null,
  source: Issuance | undefined,
): IssuancePrefill | null {
  if (!lineage || !source) return null;
  const customer: CustomerOption = {
    id: source.customerId,
    customerCode: source.customerCode,
    displayName: source.customerName,
    status: 'ACTIVE',
  };
  return { customer, source, mode: lineage.mode };
}
