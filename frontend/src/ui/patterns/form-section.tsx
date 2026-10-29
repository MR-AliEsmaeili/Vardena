import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface FormSectionProps {
  /** Section heading — `h2` under the page's own `h1` (no skipped levels). */
  title: string;
  /** Optional secondary line: scope, count, or a short instruction. */
  description?: string;
  /** Section-level actions (add row, export, …). */
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * A compact form/detail section: one header line, a hairline rule, then the
 * content. It replaces the tall card + inner title blocks so that several
 * sections fit on one screen — the ERP density rule (design-system.md §1,
 * standards.md §8) — while keeping an explicit boundary between sections.
 */
export function FormSection({
  title,
  description,
  actions,
  className,
  children,
}: FormSectionProps) {
  return (
    <section
      className={cn('space-y-1.5', className)}
      data-testid="form-section"
      aria-label={title}
    >
      <div className="flex min-h-form-section-header flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line pb-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <h2 className="text-[0.8125rem] font-semibold text-ink">{title}</h2>
          {description !== undefined && description !== '' && (
            <span className="text-xs text-ink-subtle">{description}</span>
          )}
        </div>
        {actions !== undefined && actions !== null && (
          <div className="flex flex-wrap items-center gap-1.5">{actions}</div>
        )}
      </div>
      {children}
    </section>
  );
}
