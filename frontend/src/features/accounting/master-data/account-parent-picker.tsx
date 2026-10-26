import type { Account } from '@/api/contracts';
import { t } from '@/lib/i18n';
import { FormField } from '@/ui/patterns/form-field';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';

export interface AccountParentPickerProps {
  id: string;
  value: string;
  candidates: readonly Account[];
  search: string;
  onSearchChange: (value: string) => void;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: string | undefined;
  fallback?: { id: string; label: string } | null;
}

/** Server-searched eligible parent options; the root option is explicit. */
export function AccountParentPicker({
  id,
  value,
  candidates,
  search,
  onSearchChange,
  onChange,
  disabled = false,
  error,
  fallback = null,
}: AccountParentPickerProps) {
  const hasSelectedCandidate = candidates.some(
    (account) => account.id === value,
  );
  const selectedFallback =
    !hasSelectedCandidate && fallback?.id === value ? fallback : null;

  return (
    <div className="space-y-1.5">
      <FormField id={id} label={t.masterData.parentAccount} error={error}>
        {(fieldProps) => (
          <Select
            {...fieldProps}
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          >
            <option value="">{t.masterData.rootParent}</option>
            {selectedFallback !== null && (
              <option value={selectedFallback.id}>
                {selectedFallback.label}
              </option>
            )}
            {candidates.map((account) => (
              <option key={account.id} value={account.id}>
                {account.code} — {account.title}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <Input
        type="search"
        aria-label={t.accountAdmin.parentSearch}
        placeholder={t.app.search}
        value={search}
        disabled={disabled}
        onChange={(event) => onSearchChange(event.target.value)}
      />
    </div>
  );
}
