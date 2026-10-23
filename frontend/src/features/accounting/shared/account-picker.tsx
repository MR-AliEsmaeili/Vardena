import { useState } from 'react';
import { t } from '@/lib/i18n';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { FormField } from '@/ui/patterns/form-field';
import { usePostableAccounts } from './use-accounting-references';

export interface AccountPickerProps {
  id: string;
  label: string;
  organizationId: string | null;
  value: string;
  onChange: (accountId: string) => void;
  error?: string | undefined;
  required?: boolean;
  disabled?: boolean;
}

/**
 * Postable-account picker backed by the API's own `search` filter.
 *
 * The chart of accounts can be large, so the list is always server-filtered
 * and server-paged (`GET /accounts?isPostable=true&search=…&pageSize=50`);
 * the UI never downloads the chart to filter it locally.
 */
export function AccountPicker({
  id,
  label,
  organizationId,
  value,
  onChange,
  error,
  required = false,
  disabled = false,
}: AccountPickerProps) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const accountsQuery = usePostableAccounts(organizationId, debouncedSearch);
  const accounts = accountsQuery.data?.items ?? [];
  const hasMore = (accountsQuery.data?.total ?? 0) > accounts.length;

  return (
    <div className="space-y-1.5">
      <FormField id={id} label={label} error={error}>
        {(fieldProps) => (
          <Select
            {...fieldProps}
            value={value}
            disabled={disabled || accountsQuery.isPending}
            onChange={(event) => onChange(event.target.value)}
          >
            <option value="">
              {required ? t.filters.select : t.filters.allAccounts}
            </option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.code} — {account.title}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <Input
        type="search"
        className="h-8 text-xs"
        placeholder={t.app.search}
        value={search}
        disabled={disabled}
        aria-label={`${label} — ${t.app.search}`}
        onChange={(event) => setSearch(event.target.value)}
      />
      <p className="text-xs text-ink-subtle">
        {t.filters.postableOnly}
        {hasMore ? ` · ${t.app.search}` : ''}
      </p>
    </div>
  );
}
