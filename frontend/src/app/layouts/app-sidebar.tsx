import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import type { RefObject } from 'react';
import { NavLink } from 'react-router-dom';
import { usePermissions } from '@/features/permissions/use-permissions';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { NavGlyph, NAV_TONE_TILE } from '@/ui/nav-glyph';
import { Tooltip } from '@/ui/tooltip';
import { visibleNavigationSections } from '../navigation';

export interface AppSidebarProps {
  navigationId: string;
  navigationRef: RefObject<HTMLElement | null>;
  collapsed: boolean;
  collapsedGroups: readonly string[];
  onToggleGroup: (id: string) => void;
  /** Collapse/expand the desktop sidebar from the handle on its own edge. */
  onToggleCollapsed: () => void;
  /** Opened from a collapsed group marker: expand and reveal that group. */
  onExpandGroup: (id: string) => void;
  mobileOpen: boolean;
  onCloseMobile: (restoreFocus: boolean) => void;
  /** A navigation destination was chosen; the shell collapses the rail so the
   *  opened form owns the whole viewport. */
  onNavigate: () => void;
}

/**
 * Unified responsive RTL Sidebar:
 * - Single `<nav>` landmark (`id="app-navigation"`, `aria-label="منوی اصلی"`).
 * - Desktop (`lg:`): the rail is exactly one viewport tall (`100dvh - header`)
 *   and only its own content scrolls, with the collapse handle living ON the
 *   sidebar edge (expanded) or above the workbench entry (collapsed) — never
 *   in the Header.
 * - Collapsed: every domain keeps its category marker (icon + tooltip) so the
 *   map of the ERP survives icon-only mode.
 * - Mobile (`< lg`): overlay drawer with backdrop, Escape dismissal, and focus
 *   trap managed by `AppShell`.
 */
export function AppSidebar({
  navigationId,
  navigationRef,
  collapsed,
  collapsedGroups,
  onToggleGroup,
  onToggleCollapsed,
  onExpandGroup,
  mobileOpen,
  onCloseMobile,
  onNavigate,
}: AppSidebarProps) {
  const permissions = usePermissions();
  const isIconOnly = collapsed && !mobileOpen;

  const visibleSections = visibleNavigationSections(permissions);

  const handleSelect = () => {
    onCloseMobile(false);
    onNavigate();
  };

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          className="animate-fade-in fixed inset-0 z-20 bg-ink/35 lg:hidden"
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
          'group/sidebar fixed top-14 bottom-0 start-0 z-30 flex w-72 flex-col border-e border-line bg-surface',
          'transition-[width,transform] duration-300 ease-out motion-reduce:transition-none',
          'lg:sticky lg:top-14 lg:z-10 lg:h-[calc(100dvh_-_var(--spacing-app-header))]',
          collapsed
            ? 'lg:w-[var(--spacing-app-sidebar-collapsed)]'
            : 'lg:w-[var(--spacing-app-sidebar)]',
          mobileOpen
            ? 'visible translate-x-0 shadow-raised'
            : 'invisible translate-x-full lg:visible lg:translate-x-0',
        )}
      >
        {/*
         * Collapse handle — expanded: a small round grip straddling the
         * sidebar's inner edge (the modern “floating on the rail line” idiom).
         * Collapsed: it moves to the top of the rail, above the workbench.
         */}
        {!mobileOpen && !collapsed && (
          <div className="absolute -end-3 top-3.5 hidden lg:block">
            <Tooltip content={t.nav.collapseSidebar} side="end">
              <button
                type="button"
                aria-label={t.nav.collapseSidebar}
                aria-expanded={true}
                aria-controls={navigationId}
                onClick={onToggleCollapsed}
                data-testid="sidebar-toggle"
                className="action-press flex h-6 w-6 items-center justify-center rounded-full border border-line bg-surface text-ink-subtle shadow-card hover:border-brand/45 hover:text-brand"
              >
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </button>
            </Tooltip>
          </div>
        )}

        {/*
         * Collapsed rail: the expand handle keeps the first row, directly
         * above «میزکار». It sits outside the scroll box so scrolling a long
         * menu never loses it.
         */}
        {isIconOnly && (
          /*
           * The expand handle is a peer of the menu glyphs, not a banner:
           * it keeps the SAME 24px visual box as `NavGlyph` and sits in the
           * same centred column (the `after:` pseudo-element widens only the
           * hit area, never the visual size). The rail also keeps a real
           * inline-start padding (RTL = the right edge) so the icon column
           * never glues itself to the viewport edge.
           */
          <div className="flex justify-center ps-3 pe-1.5 pt-2 pb-1">
            <Tooltip content={t.nav.expandSidebar} side="end">
              <button
                type="button"
                aria-label={t.nav.expandSidebar}
                aria-expanded={false}
                aria-controls={navigationId}
                onClick={onToggleCollapsed}
                data-testid="sidebar-toggle"
                className="action-press relative flex h-6 w-6 items-center justify-center rounded-glyph border border-brand/25 bg-brand-soft text-brand-ink after:absolute after:-inset-1.5 after:content-[''] hover:border-brand/50 hover:bg-brand hover:text-white"
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
              </button>
            </Tooltip>
          </div>
        )}

        <div
          data-testid="sidebar-scroll"
          className={cn(
            'scroll-elegant min-h-0 flex-1 overflow-y-auto overflow-x-hidden pt-2 pb-3',
            isIconOnly ? 'ps-3 pe-1.5' : 'px-2',
          )}
        >
          <ul className="space-y-1">
            {visibleSections.map((section) => {
              const isGroupCollapsed =
                !section.standalone &&
                !isIconOnly &&
                collapsedGroups.includes(section.id);

              return (
                <li
                  key={section.id}
                  className={cn(!section.standalone && 'pt-1')}
                >
                  {section.standalone ? null : isIconOnly ? (
                    <div className="mb-1 flex flex-col items-center gap-1">
                      <span className="h-px w-5 bg-line" aria-hidden="true" />
                      <Tooltip content={section.label} side="end">
                        <button
                          type="button"
                          aria-label={t.nav.openGroup.replace(
                            '{group}',
                            section.label,
                          )}
                          onClick={() => onExpandGroup(section.id)}
                          data-testid={`sidebar-group-${section.id}`}
                          className="action-press flex h-6 w-6 items-center justify-center rounded-glyph hover:bg-sunken"
                        >
                          <section.icon
                            className={cn(
                              'h-4 w-4',
                              NAV_TONE_TILE[section.tone].icon,
                            )}
                            aria-hidden
                          />
                        </button>
                      </Tooltip>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="action-press flex w-full items-center gap-1.5 rounded-control px-1.5 py-1 text-[0.6875rem] font-semibold tracking-wide text-ink-subtle hover:bg-sunken hover:text-ink"
                      aria-expanded={!isGroupCollapsed}
                      aria-controls={`${navigationId}-${section.id}`}
                      onClick={() => onToggleGroup(section.id)}
                      data-testid={`sidebar-group-${section.id}`}
                    >
                      <section.icon
                        className={cn(
                          'h-3.5 w-3.5 shrink-0',
                          NAV_TONE_TILE[section.tone].icon,
                        )}
                        aria-hidden
                      />
                      <span className="truncate">{section.label}</span>
                      <ChevronDown
                        className={cn(
                          'ms-auto h-3 w-3 shrink-0 transition-transform duration-200',
                          isGroupCollapsed && '-rotate-90',
                        )}
                        aria-hidden
                      />
                    </button>
                  )}

                  {!isGroupCollapsed && (
                    <ul
                      id={`${navigationId}-${section.id}`}
                      className={cn('mt-0.5 space-y-0.5', isIconOnly && 'mt-1')}
                    >
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
                              onClick={handleSelect}
                              className={({ isActive }) =>
                                cn(
                                  'group relative flex w-full items-center gap-2.5 rounded-control px-2 py-1.5 text-[0.8125rem] transition-[background-color,color] duration-150',
                                  'action-press',
                                  isIconOnly &&
                                    'lg:justify-center lg:gap-0 lg:px-0',
                                  isActive
                                    ? 'bg-brand-soft/80 font-semibold text-brand-ink'
                                    : 'text-ink-muted hover:bg-sunken hover:text-ink',
                                )
                              }
                            >
                              {({ isActive }) => (
                                <>
                                  {isActive && (
                                    <span
                                      aria-hidden="true"
                                      className={cn(
                                        'animate-marker-in absolute inset-y-1.5 start-0 w-[3px] rounded-full',
                                        NAV_TONE_TILE[section.tone].marker,
                                      )}
                                    />
                                  )}
                                  <NavGlyph
                                    icon={item.icon}
                                    tone={section.tone}
                                    active={isActive}
                                  />
                                  <span
                                    className={cn(
                                      'truncate',
                                      isIconOnly && 'sr-only',
                                    )}
                                  >
                                    {item.label}
                                  </span>
                                </>
                              )}
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
        </div>
      </nav>
    </>
  );
}
