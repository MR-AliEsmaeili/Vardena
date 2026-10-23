import {
  ExternalLink,
  FileSpreadsheet,
  Filter,
  Printer,
  Search,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';

export interface DocumentListToolbarProps {
  searchValue?: string | undefined;
  searchPlaceholder?: string | undefined;
  onSearchChange?: ((value: string) => void) | undefined;
  onFilterToggle?: (() => void) | undefined;
  filterActive?: boolean | undefined;
  onPrint?: (() => void) | undefined;
  onExportExcel?: (() => void) | undefined;
  exportDisabled?: boolean | undefined;
  onOpenSelected?: (() => void) | undefined;
  extraActions?: ReactNode;
}

/**
 * Standard compact list toolbar — Search · Filter · Open Selected · Print · Excel.
 * All UI copy comes from the central `t` dictionary (`@/lib/i18n`).
 */
export function DocumentListToolbar({
  searchValue,
  searchPlaceholder = t.app.search,
  onSearchChange,
  onFilterToggle,
  filterActive = false,
  onPrint,
  onExportExcel,
  exportDisabled = false,
  onOpenSelected,
  extraActions,
}: DocumentListToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label={t.operationalForm.toolbarLabel}
      className="no-print flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface px-3 py-2 shadow-card"
      data-testid="document-list-toolbar"
    >
      {onSearchChange !== undefined && (
        <div className="relative flex max-w-sm min-w-0 flex-1 items-center">
          <Search
            className="pointer-events-none absolute start-2.5 h-4 w-4 text-ink-subtle"
            aria-hidden
          />
          <Input
            value={searchValue ?? ''}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={t.app.search}
            className="h-8 ps-8 text-xs"
            data-testid="toolbar-search"
          />
        </div>
      )}

      {onFilterToggle !== undefined && (
        <Button
          type="button"
          variant={filterActive ? 'default' : 'outline'}
          size="sm"
          onClick={onFilterToggle}
          data-testid="toolbar-filter"
        >
          <Filter className="h-4 w-4" aria-hidden />
          <span>{t.operationalForm.toggleFilters}</span>
        </Button>
      )}

      {onOpenSelected !== undefined && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onOpenSelected}
          data-testid="toolbar-open-selected"
        >
          <ExternalLink className="h-4 w-4" aria-hidden />
          <span>{t.operationalForm.openSelected}</span>
        </Button>
      )}

      <div className="ms-auto flex flex-wrap items-center gap-1.5">
        {extraActions}

        {onPrint !== undefined && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onPrint}
            aria-label={t.operationalForm.print}
            data-testid="toolbar-print"
          >
            <Printer className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">{t.operationalForm.print}</span>
          </Button>
        )}

        {onExportExcel !== undefined && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={exportDisabled}
            onClick={onExportExcel}
            aria-label={t.operationalForm.exportExcel}
            data-testid="toolbar-excel"
          >
            <FileSpreadsheet className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">
              {t.operationalForm.exportExcel}
            </span>
          </Button>
        )}
      </div>
    </div>
  );
}
