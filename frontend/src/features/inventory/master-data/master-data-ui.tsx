import type { FormEvent, ReactNode } from 'react';
import { t } from '@/lib/i18n';
import type { StatusFilter } from '@/lib/use-admin-list-state';
import { Badge } from '@/ui/badge';
import { Input } from '@/ui/input';
import { FilterBar, FilterField } from '@/ui/patterns/filter-bar';
import { Select } from '@/ui/select';

/**
 * Presentational atoms shared by the inventory master-data surfaces.
 *
 * Duplicated from (not imported out of) the organization feature on purpose:
 * `standards.md` §2 forbids feature → feature imports. Only `@/ui`, `@/lib`
 * and `@/api` cross the boundary.
 */

export function MasterDataStatusBadge({
  active,
  label,
}: {
  active: boolean;
  /** Overrides the Active/Inactive text — used for boolean capability flags. */
  label?: string;
}) {
  return (
    <Badge variant={active ? 'success' : 'neutral'}>
      {label ??
        (active ? t.inventoryMaster.active : t.inventoryMaster.inactive)}
    </Badge>
  );
}

export { Definition, DefinitionList } from '@/ui/patterns/definition-list';

export interface MasterDataFiltersProps {
  search: string;
  status: StatusFilter;
  /** Remounts the draft inputs whenever the URL-owned state changes. */
  synchronizationKey: string;
  onApply: (values: { search: string; status: string }) => void;
  onClear: () => void;
  /** Resource-specific filter controls (plain `name`d form fields). */
  children?: ReactNode;
  /** The search placeholder changes where the backend looks (e.g. barcode). */
  searchPlaceholder?: string;
  /**
   * `false` hides the Active/Inactive select for resources that have no
   * `isActive` query parameter at all (unit-conversion versions).
   */
  showStatus?: boolean;
  /** `false` hides the search box for resources without a `search` param. */
  showSearch?: boolean;
}

/**
 * Search + status filter bar for an inventory master-data list. Nothing is
 * filtered client-side: both values map onto the controllers' declared query
 * parameters (`search`, `isActive`).
 */
export function MasterDataFilters({
  search,
  status,
  synchronizationKey,
  onApply,
  onClear,
  children,
  searchPlaceholder = t.inventoryMaster.searchPlaceholder,
  showStatus = true,
  showSearch = true,
}: MasterDataFiltersProps) {
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
      applyLabel={t.inventoryMaster.filter}
      clearLabel={t.inventoryMaster.clear}
      columns={4}
      aria-label={t.filters.title}
      data-testid="inventory-master-filters"
    >
      {showSearch && (
        <FilterField label={t.app.search}>
          <Input
            name="search"
            defaultValue={search}
            placeholder={searchPlaceholder}
          />
        </FilterField>
      )}

      {children}

      {showStatus && (
        <FilterField label={t.inventoryMaster.status}>
          <Select name="status" defaultValue={status}>
            <option value="">{t.inventoryMaster.allStatuses}</option>
            <option value="active">{t.inventoryMaster.active}</option>
            <option value="inactive">{t.inventoryMaster.inactive}</option>
          </Select>
        </FilterField>
      )}
    </FilterBar>
  );
}
