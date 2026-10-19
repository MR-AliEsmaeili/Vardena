import { t } from '@/lib/i18n';
import { formatCount } from '@/lib/format';
import { Button } from '@/ui/button';
import { Select } from '@/ui/select';
import { LocalFetchingIndicator } from './request-activity';

/** Stable reference so the default does not change identity per render. */
const DEFAULT_PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  pageSizeOptions?: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  disabled?: boolean;
  /** A new server page is in flight; shows the local refresh indicator. */
  fetching?: boolean;
}

/**
 * Server-side pagination control.
 *
 * The backend owns paging (`page`, `pageSize`, `total` — `architecture.md`
 * §9); this component only reports the current window and requests another
 * one. It never slices a locally cached dataset.
 */
export function Pagination({
  page,
  pageSize,
  total,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  onPageChange,
  onPageSizeChange,
  disabled = false,
  fetching = false,
}: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const canPrevious = page > 1 && !disabled;
  const canNext = page < pageCount && !disabled;

  return (
    <div className="flex flex-col gap-3 border-t border-slate-100 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3 text-slate-600">
        <span>
          {t.table.rowsTotal}: <span className="num">{formatCount(total)}</span>
        </span>
        <LocalFetchingIndicator active={fetching} />
        {onPageSizeChange !== undefined && (
          <label className="flex items-center gap-2">
            <span className="text-xs text-slate-500">{t.table.pageSize}</span>
            <Select
              className="h-8 w-20"
              value={pageSize}
              disabled={disabled}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              aria-label={t.table.pageSize}
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </label>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canPrevious}
          onClick={() => onPageChange(page - 1)}
        >
          {t.table.previous}
        </Button>
        <span className="text-slate-600">
          {t.table.page} <span className="num">{page}</span> {t.table.of}{' '}
          <span className="num">{pageCount}</span>
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canNext}
          onClick={() => onPageChange(page + 1)}
        >
          {t.table.next}
        </Button>
      </div>
    </div>
  );
}
