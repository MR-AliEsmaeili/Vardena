import type { FormEvent, ReactNode } from 'react';
import { t } from '@/lib/i18n';
import { Badge } from '@/ui/badge';
import { Input } from '@/ui/input';
import { FilterBar, FilterField } from '@/ui/patterns/filter-bar';
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

export { Definition, DefinitionList } from '@/ui/patterns/definition-list';

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
    <FilterBar
      key={synchronizationKey}
      onSubmit={submit}
      onClear={onClear}
      applyLabel={t.orgAdmin.filter}
      clearLabel={t.orgAdmin.clear}
      columns={4}
      aria-label={t.filters.title}
      data-testid="org-admin-filters"
    >
      <FilterField label={t.app.search} className="sm:col-span-2">
        <Input
          name="search"
          defaultValue={search}
          placeholder={t.orgAdmin.searchPlaceholder}
        />
      </FilterField>

      {children}

      <FilterField label={t.orgAdmin.status}>
        <Select name="status" defaultValue={status}>
          <option value="">{t.orgAdmin.allStatuses}</option>
          <option value="active">{t.orgAdmin.active}</option>
          <option value="inactive">{t.orgAdmin.inactive}</option>
        </Select>
      </FilterField>
    </FilterBar>
  );
}
