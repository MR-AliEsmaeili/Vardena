import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { formatCount } from '@/lib/format';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';

/**
 * Standard Operational Form Shell — five structured zones:
 * `Toolbar` · `CollapsibleHeader` · `DetailGrid` · `Summary` · `Footer`.
 */

// ── 1. Toolbar ───────────────────────────────────────────────────────────────

export interface OperationalToolbarProps {
  children: ReactNode;
}

export function OperationalToolbar({ children }: OperationalToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label={t.operationalForm.toolbarLabel}
      className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface px-3 py-2 shadow-card"
      data-testid="operational-toolbar"
    >
      {children}
    </div>
  );
}

// ── 2. Collapsible Header ────────────────────────────────────────────────────

export interface HeaderSummaryChip {
  label: string;
  value: string;
}

export interface CollapsibleHeaderProps {
  title: string;
  /** Compact summary string or structured key-value chips shown when collapsed. */
  summary?: ReactNode;
  summaryChips?: readonly HeaderSummaryChip[];
  defaultOpen?: boolean;
  /** True only when all required header fields are filled and valid. */
  canCollapse?: boolean;
  /** Forces header open when validation errors exist on header fields. */
  hasRequiredErrors?: boolean;
  /** Optional callback fired when user tries to collapse an incomplete header. */
  onCollapseBlocked?: () => void;
  children: ReactNode;
}

export function CollapsibleHeader({
  title,
  summary,
  summaryChips,
  defaultOpen = true,
  canCollapse = true,
  hasRequiredErrors = false,
  onCollapseBlocked,
  children,
}: CollapsibleHeaderProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [blockedAttempt, setBlockedAttempt] = useState(false);

  const mayCollapse = canCollapse && !hasRequiredErrors;
  const effectiveOpen = mayCollapse ? open : true;

  const handleToggle = () => {
    if (effectiveOpen && !mayCollapse) {
      setBlockedAttempt(true);
      onCollapseBlocked?.();
      return;
    }
    setBlockedAttempt(false);
    setOpen((prev) => !prev);
  };

  return (
    <Card
      data-testid="collapsible-header"
      data-open={effectiveOpen ? 'true' : 'false'}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>

          {!effectiveOpen && (
            <div
              className="flex flex-wrap items-center gap-1.5"
              aria-label={t.operationalForm.headerCollapsedSummaryLabel}
              data-testid="header-summary"
            >
              {summaryChips !== undefined && summaryChips.length > 0
                ? summaryChips.map((chip) => (
                    <Badge key={chip.label} variant="neutral">
                      <span className="text-ink-subtle">{chip.label}:</span>{' '}
                      <span className="font-semibold text-ink">
                        {chip.value}
                      </span>
                    </Badge>
                  ))
                : summary !== undefined && (
                    <span className="text-xs text-ink-muted">{summary}</span>
                  )}
            </div>
          )}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={effectiveOpen}
          aria-controls="collapsible-header-content"
          onClick={handleToggle}
          title={
            !mayCollapse
              ? t.operationalForm.headerIncompleteHint
              : effectiveOpen
                ? t.operationalForm.collapseHeader
                : t.operationalForm.expandHeader
          }
          data-testid="collapsible-header-toggle"
        >
          {effectiveOpen ? (
            <ChevronUp className="h-4 w-4" aria-hidden />
          ) : (
            <ChevronDown className="h-4 w-4" aria-hidden />
          )}
          <span>
            {effectiveOpen
              ? t.operationalForm.collapseHeader
              : t.operationalForm.expandHeader}
          </span>
        </Button>
      </div>

      {blockedAttempt && !mayCollapse && (
        <output
          aria-live="polite"
          data-testid="collapsible-header-blocked-hint"
          className="block border-t border-warn-line bg-warn-soft px-4 py-2 text-xs font-medium text-warn-ink"
        >
          {t.operationalForm.headerIncompleteHint}
        </output>
      )}

      {effectiveOpen && (
        <CardContent
          id="collapsible-header-content"
          className="border-t border-line pt-4"
        >
          {children}
        </CardContent>
      )}
    </Card>
  );
}

// ── 3. Summary ───────────────────────────────────────────────────────────────

export interface SummaryRow {
  label: string;
  value: string;
  emphasize?: boolean;
  tone?: 'default' | 'ok' | 'danger';
}

export interface OperationalSummaryProps {
  rows: readonly SummaryRow[];
  showServerAuthorityNote?: boolean;
}

export function OperationalSummary({
  rows,
  showServerAuthorityNote = true,
}: OperationalSummaryProps) {
  if (rows.length === 0) return null;

  return (
    <Card
      aria-label={t.operationalForm.summaryLabel}
      data-testid="operational-summary"
    >
      <CardContent className="space-y-2 px-4 py-3">
        <div className="flex flex-wrap items-center gap-6">
          {rows.map((row) => (
            <div key={row.label} className="flex flex-col gap-0.5">
              <span className="text-xs text-ink-subtle">{row.label}</span>
              <span
                className={cn(
                  'text-sm tabular-nums',
                  row.tone === 'ok'
                    ? 'font-bold text-ok-ink'
                    : row.tone === 'danger'
                      ? 'font-bold text-danger-ink'
                      : row.emphasize
                        ? 'font-bold text-ink'
                        : 'font-medium text-ink-muted',
                )}
              >
                {row.value}
              </span>
            </div>
          ))}
        </div>
        {showServerAuthorityNote && (
          <p className="border-t border-line pt-2 text-[0.6875rem] text-ink-subtle">
            {t.operationalForm.serverAuthorityHint}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ── 4. Footer (3 RTL Zones: Right = Lifecycle · Center = Pagination · Left = Confirm/Cancel) ──

export interface DocumentPaginationControlProps {
  currentIndex: number;
  totalCount: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  disabled?: boolean;
}

export function DocumentPaginationControl({
  currentIndex,
  totalCount,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  disabled = false,
}: DocumentPaginationControlProps) {
  if (totalCount <= 0) return null;

  const positionLabel = t.operationalForm.documentPosition
    .replace('{current}', formatCount(currentIndex + 1))
    .replace('{total}', formatCount(totalCount));

  return (
    <div
      className="inline-flex items-center gap-1.5"
      data-testid="document-pagination"
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || !hasPrev}
        aria-label={t.operationalForm.prevDocument}
        title={t.operationalForm.prevDocument}
        onClick={onPrev}
        data-testid="document-pagination-prev"
      >
        <ChevronRight className="h-4 w-4" aria-hidden />
      </Button>
      <span
        className="px-2 text-xs font-medium text-ink-muted tabular-nums"
        data-testid="document-pagination-label"
      >
        {positionLabel}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || !hasNext}
        aria-label={t.operationalForm.nextDocument}
        title={t.operationalForm.nextDocument}
        onClick={onNext}
        data-testid="document-pagination-next"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
      </Button>
    </div>
  );
}

export interface OperationalFooterProps {
  /** Right zone in RTL (inline-start): create, edit, delete, lifecycle transitions. */
  start?: ReactNode;
  /** Center zone: document-to-document pagination or position status. */
  center?: ReactNode;
  /** Left zone in RTL (inline-end): confirm/save and cancel. */
  end?: ReactNode;
}

export function OperationalFooter({
  start,
  center,
  end,
}: OperationalFooterProps) {
  return (
    <section
      aria-label={t.operationalForm.footerLabel}
      className="no-print flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3 shadow-card"
      data-testid="operational-footer"
    >
      <div
        className="flex flex-wrap items-center gap-2"
        data-testid="operational-footer-start"
      >
        {start}
      </div>
      <div
        className="flex items-center gap-2"
        data-testid="operational-footer-center"
      >
        {center}
      </div>
      <div
        className="flex flex-wrap items-center gap-2"
        data-testid="operational-footer-end"
      >
        {end}
      </div>
    </section>
  );
}

// ── 5. Full Shell ────────────────────────────────────────────────────────────

export interface OperationalFormShellProps {
  toolbar?: ReactNode;
  header?: ReactNode;
  detail?: ReactNode;
  summary?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}

export function OperationalFormShell({
  toolbar,
  header,
  detail,
  summary,
  footer,
  children,
}: OperationalFormShellProps) {
  return (
    <div className="space-y-4" data-testid="operational-form-shell">
      {toolbar}
      {header}
      {detail}
      {summary}
      {footer}
      {children}
    </div>
  );
}
