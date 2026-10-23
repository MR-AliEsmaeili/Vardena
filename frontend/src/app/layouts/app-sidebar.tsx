import { ChevronDown } from 'lucide-react';
import type { RefObject } from 'react';
import { NavLink } from 'react-router-dom';
import { usePermissions } from '@/features/permissions/use-permissions';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Tooltip } from '@/ui/tooltip';
import { isNavigationItemVisible, navigationSections } from '../navigation';

export interface AppSidebarProps {
  navigationId: string;
  navigationRef: RefObject<HTMLElement | null>;
  collapsed: boolean;
  collapsedGroups: readonly string[];
  onToggleGroup: (id: string) => void;
  mobileOpen: boolean;
  onCloseMobile: (restoreFocus: boolean) => void;
}

/**
 * Unified responsive RTL Sidebar:
 * - Single `<nav>` landmark (`id="app-navigation"`, `aria-label="منوی اصلی"`).
 * - Desktop (`lg:`): sticky collapsible sidebar (16rem expanded / 3.75rem
 *   icon-only rail with accessible tooltips and collapsible domain groups).
 * - Mobile (`< lg`): overlay drawer with backdrop, Escape dismissal, and focus
 *   trap managed by `AppShell`.
 */
export function AppSidebar({
  navigationId,
  navigationRef,
  collapsed,
  collapsedGroups,
  onToggleGroup,
  mobileOpen,
  onCloseMobile,
}: AppSidebarProps) {
  const permissions = usePermissions();
  const isIconOnly = collapsed && !mobileOpen;

  const visibleSections = navigationSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) =>
        isNavigationItemVisible(item, permissions),
      ),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          className="fixed inset-0 z-20 bg-ink/35 lg:hidden"
          tabIndex={-1}
          aria-label={t.nav.closeMenu}
          onClick={() => onCloseMobile(false)}
        />
      )}

      <nav
        id={navigationId}
        ref={navigationRef}
        aria-label={t.nav.mainMenu}
        data-testid="app-sidebar"
        data-collapsed={isIconOnly ? 'true' : 'false'}
        className={cn(
          'scroll-thin fixed top-14 bottom-0 start-0 z-30 w-72 overflow-y-auto border-e border-line bg-surface px-3 py-3',
          'transition-all duration-200 ease-out motion-reduce:transition-none',
          'lg:sticky lg:top-14 lg:z-10 lg:h-[calc(100vh-3.5rem)] lg:translate-x-0 lg:visible lg:shrink-0',
          collapsed
            ? 'lg:w-[var(--spacing-app-sidebar-collapsed)] lg:overflow-visible lg:px-1.5'
            : 'lg:w-[var(--spacing-app-sidebar)] lg:px-3',
          mobileOpen ? 'visible translate-x-0' : 'invisible translate-x-full',
        )}
      >
        <ul className="space-y-4">
          {visibleSections.map((section) => {
            const isGroupCollapsed =
              !section.standalone &&
              !isIconOnly &&
              collapsedGroups.includes(section.id);

            return (
              <li key={section.id}>
                {section.standalone ? null : isIconOnly ? (
                  <div className="flex justify-center py-1" aria-hidden>
                    <span className="h-px w-6 bg-line" />
                  </div>
                ) : (
                  <button
                    type="button"
                    className="flex w-full items-center justify-between rounded-control px-2 py-1 text-[0.6875rem] font-semibold tracking-wide text-ink-subtle transition-colors hover:bg-sunken hover:text-ink"
                    aria-expanded={!isGroupCollapsed}
                    onClick={() => onToggleGroup(section.id)}
                    data-testid={`sidebar-group-${section.id}`}
                  >
                    <span className="truncate">{section.label}</span>
                    <ChevronDown
                      className={cn(
                        'h-3.5 w-3.5 shrink-0 transition-transform',
                        isGroupCollapsed && 'rotate-90',
                      )}
                      aria-hidden
                    />
                  </button>
                )}

                {!isGroupCollapsed && (
                  <ul className="mt-0.5 space-y-0.5">
                    {section.items.map((item) => (
                      <li key={item.to}>
                        <Tooltip
                          content={item.label}
                          side="end"
                          enabled={isIconOnly}
                          className="w-full"
                        >
                          <NavLink
                            to={item.to}
                            end={item.end ?? false}
                            onClick={() => onCloseMobile(false)}
                            title={isIconOnly ? item.label : undefined}
                            className={({ isActive }) =>
                              cn(
                                'relative flex w-full items-center gap-2 rounded-control px-2.5 py-2 text-[0.8125rem] transition-colors',
                                isIconOnly && 'lg:justify-center lg:px-1.5',
                                isActive
                                  ? 'bg-brand-soft font-medium text-brand-ink before:absolute before:inset-y-1.5 before:start-0 before:w-0.5 before:rounded-full before:bg-brand'
                                  : 'text-ink-muted hover:bg-sunken hover:text-ink',
                              )
                            }
                          >
                            <item.icon
                              className="h-4 w-4 shrink-0"
                              aria-hidden
                            />
                            <span
                              className={cn(
                                'truncate',
                                isIconOnly && 'sr-only',
                              )}
                            >
                              {item.label}
                            </span>
                          </NavLink>
                        </Tooltip>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
