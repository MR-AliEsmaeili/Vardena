import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as api from '@/api/owner.api';
import type { CustomerRead } from '@/api/contracts';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { o } from '@/lib/owner-i18n';
import { Input } from '@/ui/input';
import { LoadingState } from '@/ui/patterns/states';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';

/** The subset of a customer that a selection needs to stay legible. */
export interface CustomerOption {
  id: string;
  customerCode: string;
  displayName: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export function toCustomerOption(customer: CustomerRead): CustomerOption {
  return {
    id: customer.id,
    customerCode: customer.customerCode,
    displayName: customer.displayName,
    status: customer.status,
  };
}

/**
 * Search-and-select over the real customer list.
 *
 * The issuance and observation workflows must not ask an operator to type an
 * opaque ULID: the customer identity is owned by the backend, and a mistyped
 * or guessed identifier either fails or — worse — names a different customer.
 * This control therefore reads `GET /customers` (search + page 1) and returns
 * the selected record, so callers can use its real code and name.
 *
 * It is a UX affordance only (AR-21): every request downstream re-authorizes
 * and re-reads the customer by id server-side.
 */
export function CustomerPicker({
  selected,
  onSelect,
  label = o.licenses.customerPick,
  hint = o.licenses.customerPickHint,
  error,
}: {
  selected: CustomerOption | null;
  onSelect: (customer: CustomerOption) => void;
  label?: string;
  hint?: string;
  error?: string | undefined;
}) {
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search, 300);
  const query = useQuery({
    queryKey: ['owner', 'customers', debounced, 1, 'licensing-picker'],
    queryFn: ({ signal }) => api.customers(debounced, 1, signal),
  });

  return (
    <fieldset className="space-y-2" aria-describedby="customer-picker-hint">
      <legend className="text-sm font-medium">{label}</legend>
      <p id="customer-picker-hint" className="text-xs text-muted-ink">
        {hint}
      </p>
      <Input
        value={search}
        maxLength={100}
        aria-label={o.licenses.customerSearch}
        placeholder={o.licenses.customerSearch}
        onChange={(event) => setSearch(event.target.value)}
      />
      {query.isPending ? <LoadingState rows={1} /> : null}
      {query.isError ? (
        <ApiErrorAlert
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {query.data && query.data.items.length === 0 ? (
        <p className="text-xs text-muted-ink">{o.noResults}</p>
      ) : null}
      <div
        role="radiogroup"
        aria-label={label}
        className="max-h-56 space-y-1 overflow-y-auto"
      >
        {query.data?.items.map((customer) => (
          <label
            key={customer.id}
            className="flex items-start gap-2 rounded px-1 py-1 text-sm hover:bg-canvas"
          >
            <input
              type="radio"
              className="mt-1"
              name="licensing-customer"
              value={customer.id}
              checked={selected?.id === customer.id}
              onChange={() => onSelect(toCustomerOption(customer))}
            />
            <span>
              {customer.displayName}{' '}
              <span className="code text-xs text-muted-ink" dir="ltr">
                {customer.customerCode}
              </span>{' '}
              <span className="text-xs text-muted-ink">
                · {customer.status === 'ACTIVE' ? o.active : o.inactive}
              </span>
            </span>
          </label>
        ))}
      </div>
      {selected ? (
        <p className="rounded bg-canvas px-2 py-1 text-sm">
          {o.selectedValue}:{' '}
          <span className="font-semibold">{selected.displayName}</span>{' '}
          <span className="code text-xs text-muted-ink" dir="ltr">
            {selected.customerCode}
          </span>
        </p>
      ) : (
        <p className="text-xs text-muted-ink">{o.licenses.customerNone}</p>
      )}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
