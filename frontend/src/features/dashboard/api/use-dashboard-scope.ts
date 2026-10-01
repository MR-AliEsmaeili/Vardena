import {
  useDashboardFinancialAreas,
  useDashboardFiscalYears,
} from './use-dashboard-references';

/**
 * The accounting read scope the dashboard's financial widgets are bound to.
 *
 * The Balance Projection contract requires a financial area / fiscal year for
 * meaningful windows, and the dashboard is a summary surface — so it binds to
 * the DEFAULT financial area (the same resolution the backend uses for a
 * single-area organization) and its first fiscal year in code order. The
 * binding is derived during render from the reference data itself — no
 * duplicated state, no effect synchronization. When the references are
 * missing or the session lacks their view permissions, the scope is `null`
 * and every scope-bound widget renders its disabled/empty presentation.
 */
export interface DashboardScope {
  financialAreaId: string;
  fiscalYearId: string;
}

export function useDashboardScope(
  organizationId: string | null,
): { scope: DashboardScope | null; isReady: boolean } {
  const areasQuery = useDashboardFinancialAreas(organizationId);
  const areas = areasQuery.data?.items ?? [];
  const defaultArea =
    areas.find((area) => area.isDefault && area.isActive) ??
    areas.find((area) => area.isActive) ??
    areas[0];

  const yearsQuery = useDashboardFiscalYears(
    organizationId,
    defaultArea?.id ?? null,
  );
  const years = yearsQuery.data?.items ?? [];
  const firstYear = years[0];

  // "Ready" means the reference reads have SETTLED (or never ran because the
  // session lacks their view permission) — a disabled query is not pending
  // forever, and the UI must be able to render an honest empty state instead
  // of an eternal skeleton.
  const isReady =
    organizationId !== null &&
    (areasQuery.isSuccess || areasQuery.isError || !areasQuery.isEnabled) &&
    (yearsQuery.isSuccess || yearsQuery.isError || !yearsQuery.isEnabled);

  const scope: DashboardScope | null =
    defaultArea !== undefined && firstYear !== undefined
      ? { financialAreaId: defaultArea.id, fiscalYearId: firstYear.id }
      : null;

  return { scope, isReady };
}
