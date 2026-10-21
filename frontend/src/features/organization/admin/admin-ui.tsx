import type { FormEvent, ReactNode } from 'react';
import { t } from '@/lib/i18n';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import type { StatusFilter } from '@/lib/use-admin-list-state';

/**
 * Small presentational atoms shared by the organization-administration
 * surfaces.
 *
 * They are duplicated from (not imported out of) the accounting feature on
 * purpose: `standards.md` §2 forbids feature → feature imports, mirroring the
 * backend module boundary. Only `shared` (`@/ui`, `@/lib`, `@/api`) crosses.
 */

export function ActiveBadge({ active }: { active: boolean }) {
  return (
    <Badge variant={active ? 'success' : 'neutral'}>
      {active ? t.orgAdmin.active : t.orgAdmin.inactive}
    </Badge>
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

export interface AdminFiltersProps {
  search: string;
  status: StatusFilter;
  /**
   * Remounts the uncontrolled draft inputs whenever the URL-owned state
   * changes (Back/Forward and deep links stay in sync with the controls).
   */
  synchronizationKey: string;
  onApply: (values: { search: string; status: string }) => void;
  onClear: () => void;
  /** Resource-specific filter controls (plain `name`d form fields). */
  children?: ReactNode;
}

/**
 * Search + status filter bar for an organization master-data list.
 *
 * The status filter maps onto the backend's `isActive` boolean; the free text
 * maps onto `search` (the controller's documented case-insensitive substring
 * match). Nothing is filtered client-side.
 */
export function AdminFilters({
  search,
  status,
  synchronizationKey,
  onApply,
  onClear,
  children,
}: AdminFiltersProps) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onApply({
      search: String(data.get('search') ?? ''),
      status: String(data.get('status') ?? ''),
    });
  };

  return (
    <form
      key={synchronizationKey}
      className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3"
      onSubmit={submit}
      data-testid="org-admin-filters"
    >
      <label className="min-w-52 flex-1 text-xs text-slate-600">
        <span>{t.app.search}</span>
        <Input
          name="search"
          defaultValue={search}
          placeholder={t.orgAdmin.searchPlaceholder}
          className="mt-1"
        />
      </label>

      {children}

      <label className="min-w-36 text-xs text-slate-600">
        <span>{t.orgAdmin.status}</span>
        <Select name="status" defaultValue={status} className="mt-1">
          <option value="">{t.orgAdmin.allStatuses}</option>
          <option value="active">{t.orgAdmin.active}</option>
          <option value="inactive">{t.orgAdmin.inactive}</option>
        </Select>
      </label>

      <Button type="submit" size="sm">
        {t.orgAdmin.filter}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onClear}>
        {t.orgAdmin.clear}
      </Button>
    </form>
  );
}
