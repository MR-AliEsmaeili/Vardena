import { useOrganization } from '@/features/organization/use-organization';
import { t } from '@/lib/i18n';
import { Select } from '@/ui/select';

/**
 * Header controls for changing the in-memory financial navigation context.
 * Selecting a different area clears the dependent fiscal-year selection in
 * the provider before its new child list can be queried.
 */
export function FinancialContextSwitcher({
  compact = false,
}: {
  compact?: boolean;
}) {
  const {
    financialArea,
    financialAreas,
    financialAreaStatus,
    fiscalYear,
    fiscalYears,
    fiscalYearStatus,
    selectFinancialArea,
    selectFiscalYear,
  } = useOrganization();

  if (financialAreaStatus !== 'ready' || financialArea === null) return null;

  // In header-compact mode the switcher is hidden on very narrow screens;
  // in page context it always shows.
  const wrapperClass = compact
    ? 'hidden items-center gap-1.5 xl:flex'
    : 'flex items-center gap-2';

  return (
    <div className={wrapperClass}>
      {financialAreas.length > 1 ? (
        <Select
          aria-label={t.financialContext.areaSwitcher}
          value={financialArea.id}
          onChange={(event) => selectFinancialArea(event.target.value)}
          className="h-8 max-w-44 text-xs"
        >
          {financialAreas.map((area) => (
            <option key={area.id} value={area.id}>
              {area.code} — {area.title}
            </option>
          ))}
        </Select>
      ) : (
        <span className="max-w-40 truncate text-xs text-ink-muted">
          {financialArea.title}
        </span>
      )}

      {fiscalYearStatus === 'ready' &&
        fiscalYear !== null &&
        (fiscalYears.length > 1 ? (
          <Select
            aria-label={t.financialContext.fiscalYearSwitcher}
            value={fiscalYear.id}
            onChange={(event) => selectFiscalYear(event.target.value)}
            className="h-8 max-w-40 text-xs"
          >
            {fiscalYears.map((year) => (
              <option key={year.id} value={year.id}>
                {year.code} — {year.title}
              </option>
            ))}
          </Select>
        ) : (
          <span className="max-w-40 truncate text-xs text-ink-muted">
            {fiscalYear.title}
          </span>
        ))}
    </div>
  );
}
