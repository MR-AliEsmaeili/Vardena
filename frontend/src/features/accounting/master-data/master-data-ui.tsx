import type { FormEvent, ReactNode } from 'react';
import { t } from '@/lib/i18n';
import { Badge } from '@/ui/badge';
import { Input } from '@/ui/input';
import { FilterBar, FilterField } from '@/ui/patterns/filter-bar';
import { Select } from '@/ui/select';

const STATUS_LABELS: Record<string, string> = {
  open: t.masterData.open,
  closed: t.masterData.closed,
  sealed: t.masterData.sealed,
};

export function LifecycleBadge({ status }: { status: string }) {
  const variant =
    status === 'open' ? 'success' : status === 'sealed' ? 'warning' : 'neutral';
  return <Badge variant={variant}>{STATUS_LABELS[status] ?? status}</Badge>;
}

export function ActiveBadge({ active }: { active: boolean }) {
  return (
    <Badge variant={active ? 'success' : 'neutral'}>
      {active ? t.masterData.active : t.masterData.inactive}
    </Badge>
  );
}

export function MasterFilters({
  search,
  status,
  statusOptions,
  scope,
  scopeOptions,
  scopeLabel,
  onApply,
  onClear,
  synchronizationKey,
  children,
}: {
  search?: string;
  status: string;
  statusOptions?: readonly { value: string; label: string }[];
  scope?: string;
  scopeOptions?: readonly { value: string; label: string }[];
  scopeLabel?: string;
  onApply: (values: {
    search: string;
    status: string;
    scopeId: string;
    level: string;
    postable: string;
  }) => void;
  onClear: () => void;
  /** Remounts the uncontrolled draft form whenever its URL-owned state changes. */
  synchronizationKey: string;
  children?: ReactNode;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onApply({
      search: String(data.get('search') ?? ''),
      status: String(data.get('status') ?? ''),
      scopeId: String(data.get('scopeId') ?? ''),
      level: String(data.get('level') ?? ''),
      postable: String(data.get('postable') ?? ''),
    });
  };
  return (
    <FilterBar
      key={synchronizationKey}
      onSubmit={submit}
      onClear={onClear}
      applyLabel={t.masterData.filter}
      clearLabel={t.masterData.clear}
      columns={4}
      aria-label={t.filters.title}
    >
      {search !== undefined && (
        <FilterField label={t.app.search}>
          <Input
            name="search"
            defaultValue={search}
            placeholder={t.masterData.searchPlaceholder}
          />
        </FilterField>
      )}
      {scopeOptions !== undefined && (
        <FilterField label={scopeLabel ?? t.filters.title}>
          <Select name="scopeId" defaultValue={scope}>
            {scopeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </FilterField>
      )}
      {children}
      {statusOptions !== undefined && (
        <FilterField label={t.masterData.status}>
          <Select name="status" defaultValue={status}>
            <option value="">{t.masterData.allStatuses}</option>
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </FilterField>
      )}
    </FilterBar>
  );
}

export { Definition, DefinitionList } from '@/ui/patterns/definition-list';
