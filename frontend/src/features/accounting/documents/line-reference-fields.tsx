import { useState, type ReactElement } from 'react';
import { t } from '@/lib/i18n';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import {
  useDetailRecordReference,
  usePostableDetailOptions,
} from './use-document-detail';

/**
 * Line-level detail picker.
 *
 * The account cell is the linked code/name field
 * (`shared/account-code-name-field.tsx`); the detail list below stays
 * server-filtered and bounded (`GET /details?isPostable=true&isActive=true&
 * search=…`, page size 50): the chart is never downloaded to filter locally.
 * The selected value is always renderable — a selected detail that is not in
 * the current page (an edit-mode prefill) is resolved through its reference
 * read and shown as its own option, so the control never displays a wrong or
 * empty selection.
 *
 * Group membership of a detail is NOT decided here: the backend validates it
 * (`detail_group_mismatch`) and the form maps that answer.
 */

export function LineDetailSelect({
  id,
  organizationId,
  value,
  onChange,
  error,
  disabled,
}: {
  id: string;
  organizationId: string | null;
  value: string;
  onChange: (detailId: string) => void;
  error?: string | undefined;
  disabled?: boolean;
}): ReactElement {
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search.trim(), 300);

  const optionsQuery = usePostableDetailOptions(organizationId, debounced);
  const selectedQuery = useDetailRecordReference(
    organizationId,
    value === '' ? undefined : value,
  );
  const options = optionsQuery.data?.items ?? [];
  const selected = value === '' ? undefined : selectedQuery.data;
  const selectedInOptions = options.some((detail) => detail.id === value);

  return (
    <div className="space-y-1">
      <Select
        id={id}
        value={value}
        disabled={disabled}
        aria-invalid={error !== undefined}
        aria-describedby={error !== undefined ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{t.filters.select}</option>
        {selected !== undefined && !selectedInOptions && (
          <option value={selected.id}>
            {selected.code} — {selected.title}
          </option>
        )}
        {options.map((detail) => (
          <option key={detail.id} value={detail.id}>
            {detail.code} — {detail.title}
          </option>
        ))}
      </Select>
      {error !== undefined && (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger-ink">
          {error}
        </p>
      )}
      <Input
        type="search"
        className="h-8 text-xs"
        placeholder={t.documents.searchDetails}
        value={search}
        disabled={disabled}
        aria-label={`${t.documents.lineDetail} — ${t.app.search}`}
        onChange={(event) => setSearch(event.target.value)}
      />
      <p className="text-[0.6875rem] text-ink-subtle">
        {t.documents.detailHint}
      </p>
    </div>
  );
}
