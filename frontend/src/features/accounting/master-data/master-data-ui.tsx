import type { FormEvent, ReactNode } from 'react';
import { t } from '@/lib/i18n';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
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
    <form
      className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3"
      onSubmit={submit}
    >
      {search !== undefined && (
        <label className="min-w-52 flex-1 text-xs text-slate-600">
          <span>{t.app.search}</span>
          <Input
            name="search"
            defaultValue={search}
            placeholder={t.masterData.searchPlaceholder}
            className="mt-1"
          />
        </label>
      )}
      {scopeOptions !== undefined && (
        <label className="min-w-48 text-xs text-slate-600">
          <span>{scopeLabel}</span>
          <Select name="scopeId" defaultValue={scope} className="mt-1">
            {scopeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>
      )}
      {children}
      {statusOptions !== undefined && (
        <label className="min-w-36 text-xs text-slate-600">
          <span>{t.masterData.status}</span>
          <Select name="status" defaultValue={status} className="mt-1">
            <option value="">{t.masterData.allStatuses}</option>
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>
      )}
      <Button type="submit" size="sm">
        {t.masterData.filter}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onClear}>
        {t.masterData.clear}
      </Button>
    </form>
  );
}

export function DefinitionList({ children }: { children: ReactNode }) {
  return (
    <dl className="grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-2">
      {children}
    </dl>
  );
}

export function Definition({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="bg-white p-4">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-slate-900">{children}</dd>
    </div>
  );
}
