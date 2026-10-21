import type { FormEvent, ReactNode } from 'react';
import { t } from '@/lib/i18n';
import type { StatusFilter } from '@/lib/use-admin-list-state';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
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
    <form
      key={synchronizationKey}
      className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3"
      onSubmit={submit}
      data-testid="inventory-master-filters"
    >
      {showSearch && (
        <label className="min-w-52 flex-1 text-xs text-slate-600">
          <span>{t.app.search}</span>
          <Input
            name="search"
            defaultValue={search}
            placeholder={searchPlaceholder}
            className="mt-1"
          />
        </label>
      )}

      {children}

      {showStatus && (
        <label className="min-w-36 text-xs text-slate-600">
          <span>{t.inventoryMaster.status}</span>
          <Select name="status" defaultValue={status} className="mt-1">
            <option value="">{t.inventoryMaster.allStatuses}</option>
            <option value="active">{t.inventoryMaster.active}</option>
            <option value="inactive">{t.inventoryMaster.inactive}</option>
          </Select>
        </label>
      )}

      <Button type="submit" size="sm">
        {t.inventoryMaster.filter}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onClear}>
        {t.inventoryMaster.clear}
      </Button>
    </form>
  );
}
