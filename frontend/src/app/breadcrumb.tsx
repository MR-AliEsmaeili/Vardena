import { ChevronLeft } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { t } from '@/lib/i18n';
import { navigationSections } from './navigation';

export interface BreadcrumbItem {
  to: string;
  label: string;
}

/**
 * Breadcrumb items for a pathname — the REAL route hierarchy only.
 *
 * An item exists for every navigation entry whose path is a prefix of the
 * current route, in hierarchy order. There are no invented segments, no
 * technical route names, no ids: if a path has no real parent chain (the
 * dashboard index, an unmatched path), fewer than two items come back and
 * the breadcrumb is not rendered at all.
 */
export function breadcrumbItemsFor(pathname: string): BreadcrumbItem[] {
  return navigationSections
    .flatMap((section) => section.items)
    .filter(
      (item) => pathname === item.to || pathname.startsWith(`${item.to}/`),
    )
    .sort((a, b) => a.to.length - b.to.length)
    .map((item) => ({ to: item.to, label: item.label }));
}

/**
 * Workspace breadcrumb of the application shell.
 *
 * Rendered above the routed content for nested routes only (a single-level
 * route carries no hierarchy worth showing). Parents are links, the current
 * page is `aria-current="page"`; the separator chevron points left because
 * the layout is RTL.
 */
export function AppBreadcrumb() {
  const { pathname } = useLocation();
  const items = breadcrumbItemsFor(pathname);
  if (items.length < 2) return null;

  return (
    <nav aria-label={t.breadcrumb.label}>
      <ol className="flex flex-wrap items-center gap-1.5 text-xs text-ink-subtle">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={item.to} className="flex items-center gap-1.5">
              {index > 0 && (
                <ChevronLeft
                  className="h-3.5 w-3.5 shrink-0 text-ink-subtle/60"
                  aria-hidden
                />
              )}
              {isLast ? (
                <span
                  aria-current="page"
                  className="font-medium text-ink-muted"
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  to={item.to}
                  className="rounded-control hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-brand"
                >
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
