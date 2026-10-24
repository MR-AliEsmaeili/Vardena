import { formatCount } from '@/lib/format';
import { t } from '@/lib/i18n';

/**
 * Honest limit note for a client-mode grid.
 *
 * Client filtering is only valid over the rows actually loaded. When the
 * backend reports more rows than the bounded read returned (its hard
 * `MAX_PAGE_SIZE`), the extra rows are NOT filtered — silently hiding that
 * would make the grid lie about the dataset. The page renders this notice so
 * the operator knows to narrow the server-side filter.
 */
export function DataTableTruncationNotice({ loaded }: { loaded: number }) {
  return (
    <p
      className="rounded-control border border-warn-line/70 bg-warn-soft px-3 py-1.5 text-[0.6875rem] leading-5 text-ink-muted"
      data-testid="data-table-truncation-notice"
    >
      {t.table.filters.truncatedNotice.replace('{count}', formatCount(loaded))}
    </p>
  );
}
