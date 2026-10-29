import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/button';
import { useFormPageBack } from '../workspace/use-form-page-back';

export interface FormPageHeaderProps {
  /**
   * The record identity or the form's purpose — the page's single `h1`
   * (an `h1` never disappears with the big title block: heading navigation
   * and the window title keep agreeing on what this screen is).
   */
  title: string;
  /**
   * One compact secondary line: record code, document number, or the
   * contextual label the operator needs to identify the data. Wraps at most
   * two lines, so a long explanatory sentence stays readable without turning
   * the header back into a page banner.
   */
  description?: string | undefined;
  /** Small contextual marks next to the title (status badge, code badge). */
  meta?: ReactNode;
  /** Primary first, then secondary actions; rendered at the inline-end. */
  actions?: ReactNode;
  /**
   * Explicit parent screen for this workflow step. Omit it for the route's
   * canonical parent (the record's list) — see `use-form-page-back`.
   */
  backTo?: string | undefined;
  className?: string;
}

/**
 * The ONE header of every create/edit form and record detail page
 * (standards.md §4, design-system.md §5.2).
 *
 * What it is: a single compact control row that starts directly under the
 * Open Windows bar — Back at the inline-start (top-right in RTL), then the
 * record identity, then the page's actions at the inline-end.
 *
 * What it deliberately is NOT: a breadcrumb, a decorative banner or a second
 * copy of the window title. The dock tab already names the screen, so this
 * row carries only the context the dock cannot (which record), and gives the
 * vertical space back to the form.
 *
 * Responsive behaviour is one implementation: the row wraps, the Back label
 * collapses to its icon (the accessible name stays), and nothing is
 * duplicated for mobile.
 */
export function FormPageHeader({
  title,
  description,
  meta,
  actions,
  backTo,
  className,
}: FormPageHeaderProps) {
  const back = useFormPageBack({ backTo });

  return (
    <header
      data-testid="form-page-header"
      className={cn(
        'flex min-h-form-header flex-wrap items-center gap-x-form-header-gap gap-y-1.5 border-b border-line pb-2',
        className,
      )}
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={back}
        aria-label={t.formHeader.back}
        title={t.app.backToPrevious}
        data-testid="form-page-header-back"
        className="pointer-coarse:h-9"
      >
        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        <span className="hidden sm:inline">{t.formHeader.back}</span>
      </Button>

      <span aria-hidden className="hidden h-4 w-px bg-line sm:block" />

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <h1 className="truncate text-sm font-semibold text-ink">{title}</h1>
          {meta}
        </div>
        {description !== undefined && description !== '' && (
          <p
            className="line-clamp-2 text-xs text-ink-muted"
            title={description}
          >
            {description}
          </p>
        )}
      </div>

      {actions !== undefined && actions !== null && (
        <div className="flex flex-wrap items-center gap-1.5">{actions}</div>
      )}
    </header>
  );
}
