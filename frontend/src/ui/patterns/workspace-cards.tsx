import { ArrowLeft, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export interface WorkspaceCardItem {
  to: string;
  label: string;
  icon: LucideIcon;
  description?: string;
}

export interface WorkspaceCardGroup {
  id: string;
  label?: string;
  items: readonly WorkspaceCardItem[];
}

export interface WorkspaceCardGridProps {
  groups: readonly WorkspaceCardGroup[];
  /** Compact variant omits secondary description and action label for dense dashboard quick-access. */
  compact?: boolean;
}

/**
 * Minimal domain workspace card grid — icon on top, title below, categorized.
 *
 * Uses semantic tokens exclusively so Light and Dark themes render with full
 * WCAG AA contrast, and renders `<h3>` headings for assistive-technology
 * landmark/heading navigation.
 */
export function WorkspaceCardGrid({
  groups,
  compact = false,
}: WorkspaceCardGridProps) {
  const nonEmpty = groups.filter((group) => group.items.length > 0);
  if (nonEmpty.length === 0) return null;

  return (
    <div className="space-y-5" data-testid="workspace-card-grid">
      {nonEmpty.map((group) => (
        <section
          key={group.id}
          aria-label={group.label ?? group.id}
          className="space-y-2.5"
        >
          {group.label !== undefined && (
            <h2 className="text-xs font-semibold tracking-wide text-ink-subtle">
              {group.label}
            </h2>
          )}
          <div
            className={cn(
              'grid gap-3',
              compact
                ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6'
                : 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
            )}
          >
            {group.items.map((item) =>
              compact ? (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-label={`${t.home.openSection}: ${item.label}`}
                  data-testid={`workspace-card-${group.id}-${item.to}`}
                  className="group flex flex-col items-center justify-center gap-2.5 rounded-card border border-line bg-surface px-3 py-4 text-center shadow-card transition-colors hover:border-brand/50 hover:bg-sunken"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-soft text-brand transition-colors group-hover:bg-brand group-hover:text-white">
                    <item.icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="line-clamp-2 text-xs font-semibold text-ink">
                    {item.label}
                  </span>
                </Link>
              ) : (
                <div
                  key={item.to}
                  data-testid={`workspace-card-${group.id}-${item.to}`}
                  className="group flex flex-col items-center gap-2.5 rounded-card border border-line bg-surface px-4 py-5 text-center shadow-card transition-colors hover:border-line-strong"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-soft text-brand transition-colors group-hover:bg-brand group-hover:text-white">
                    <item.icon className="h-5 w-5" aria-hidden />
                  </span>
                  <h3 className="text-sm font-semibold text-ink">
                    {item.label}
                  </h3>
                  {item.description !== undefined && (
                    <p className="line-clamp-2 text-xs leading-5 text-ink-muted">
                      {item.description}
                    </p>
                  )}
                  <Link
                    to={item.to}
                    className="mt-auto inline-flex items-center gap-1 rounded-control border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-sunken"
                  >
                    {t.home.openSection}
                    <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                </div>
              ),
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
