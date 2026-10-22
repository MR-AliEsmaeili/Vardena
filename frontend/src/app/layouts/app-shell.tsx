import { Boxes, LogOut, Menu, UserRound, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useSession } from '@/features/auth/use-session';
import { useLicenseState } from '@/features/licensing/use-license-state';
import { FinancialContextSwitcher } from '@/features/accounting/context/financial-context-switcher';
import { OrganizationSwitcher } from '@/features/organization/organization-switcher';
import { useOrganization } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/button';
import { BackgroundActivityIndicator } from '@/ui/patterns/request-activity';
import { AppBreadcrumb } from '../breadcrumb';
import { navigationSections } from '../navigation';
import { BootstrapScreen } from './bootstrap-states';
import { FinancialContextGate } from './financial-context-gate';
import { LicenseGate } from './license-gate';
import { OrganizationGate } from './organization-gate';

const NAVIGATION_ID = 'app-navigation';

/**
 * The authenticated application shell.
 *
 * One responsive RTL layout for every module: a sidebar that becomes an
 * overlay drawer on small screens (no duplicated mobile pages), a top bar
 * carrying the organization context, the current user and logout, and a
 * single `<main>` outlet for the feature pages.
 *
 * Two bootstrap stages run under the top bar before the workspace, in this
 * order (ADR-0030, FE-UX-04):
 *
 * `authenticated session → LicenseGate → OrganizationGate → FinancialContextGate → workspace`
 *
 * `LicenseGate` resolves the installation license first, so no organization
 * UI exists before the license state is known; only when it is active does
 * the organization stage run. The workspace below the top bar then exists
 * only once the organization scope is `ready`: while it is being resolved,
 * blocked (no organization / no permission) or awaiting an explicit choice,
 * the `OrganizationGate` replaces the sidebar and the routed content — the
 * application never enters the dashboard around an unresolved organization,
 * and no organization data can render without a confirmed scope.
 *
 * There is deliberately no search field in the top bar: the API exposes no
 * global search contract, and an input that cannot search would be a fake
 * capability (recorded as a CONTRACT GAP in the UX docs).
 *
 * The mobile drawer is a real keyboard surface: it is `inert`-equivalent while
 * closed (hidden from layout, focus and the accessibility tree), closes on
 * Escape, keeps Tab inside itself while open, locks the document scroll and
 * returns focus to the toggle that opened it.
 */
export function AppShell() {
  const session = useSession();
  const license = useLicenseState();
  const organization = useOrganization();
  const permissions = usePermissions();
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const navigationRef = useRef<HTMLElement>(null);

  const visibleSections = navigationSections
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) =>
          item.permissions === undefined ||
          (permissions.loaded && permissions.hasAll(item.permissions)),
      ),
    }))
    .filter((section) => section.items.length > 0);

  // The workspace needs every bootstrap stage: active installation license,
  // confirmed organization and coherent Accounting context. A stale child
  // selection cannot render the workspace while its parent is unresolved.
  const licenseActive = license.status === 'active';
  const isOrganizationReady = organization.status === 'ready';
  // Existing routes are independently permission-gated and the backend has
  // no universal "active financial context" requirement for every module.
  // Apply the new selection stage only to sessions that can actually resolve
  // BOTH Accounting-owned parent lists; a user with, for example, only an
  // Organization or Chart read permission retains the established route
  // contract instead of being trapped behind an unrelated 403.
  const canResolveFinancialContext =
    permissions.loaded &&
    permissions.has(PERMISSIONS.accounting.financialAreaView) &&
    permissions.has(PERMISSIONS.accounting.fiscalYearView);
  const isWorkspaceReady =
    licenseActive &&
    isOrganizationReady &&
    (!canResolveFinancialContext ||
      organization.financialContextStatus === 'ready');

  const closeMenu = useCallback((restoreFocus: boolean) => {
    setMenuOpen(false);
    if (restoreFocus) toggleRef.current?.focus();
  }, []);

  // While the drawer covers the workspace, Escape must not be swallowed by
  // anything underneath, and Tab must stay inside the open drawer.
  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu(true);
        return;
      }
      if (event.key !== 'Tab') return;
      const container = navigationRef.current;
      if (container === null) return;
      const focusable = container.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [closeMenu, menuOpen]);

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:shadow-raised"
      >
        {t.app.skipToContent}
      </a>

      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85">
        <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center gap-2 px-3 sm:px-4">
          <Button
            ref={toggleRef}
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              'shrink-0',
              isWorkspaceReady ? 'lg:hidden' : 'hidden',
            )}
            aria-label={menuOpen ? t.nav.closeMenu : t.nav.openMenu}
            aria-expanded={menuOpen}
            aria-controls={NAVIGATION_ID}
            onClick={() => (menuOpen ? closeMenu(false) : setMenuOpen(true))}
          >
            {menuOpen ? (
              <X className="h-5 w-5" aria-hidden />
            ) : (
              <Menu className="h-5 w-5" aria-hidden />
            )}
          </Button>

          <div className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-brand text-white shadow-card"
            >
              <Boxes className="h-4.5 w-4.5" />
            </span>
            <span className="flex min-w-0 flex-col justify-center leading-tight">
              <span className="truncate text-sm font-bold text-ink">
                {t.app.name}
              </span>
              <span className="hidden truncate text-[11px] text-ink-subtle sm:block">
                {t.app.tagline}
              </span>
            </span>
          </div>

          <div className="ms-auto flex min-w-0 items-center gap-2 sm:gap-3">
            {/* Ambient refetch/background activity — never a page overlay. */}
            <BackgroundActivityIndicator />
            {/*
              The organization indicator belongs to the organization stage:
              before the license is active there is no organization context
              to announce, so the top bar must not claim one is being
              resolved.
            */}
            {licenseActive && <OrganizationSwitcher />}
            {licenseActive && isOrganizationReady && (
              <FinancialContextSwitcher />
            )}
            <span className="hidden items-center gap-2 border-s border-line ps-3 text-sm text-ink-muted sm:flex">
              <span
                aria-hidden="true"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-sunken text-ink-subtle"
              >
                <UserRound className="h-3.5 w-3.5" />
              </span>
              <span className="max-w-32 truncate font-medium" dir="ltr">
                {session.user?.username ?? ''}
              </span>
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={session.isLoggingOut}
              loading={session.isLoggingOut}
              onClick={() => {
                void session.logout();
              }}
            >
              <LogOut className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">
                {session.isLoggingOut ? t.auth.loggingOut : t.auth.logout}
              </span>
            </Button>
          </div>
        </div>
      </header>

      <LicenseGate>
        {isWorkspaceReady ? (
          <div className="mx-auto flex w-full max-w-[1600px] items-start">
            {menuOpen && (
              <button
                type="button"
                className="fixed inset-0 z-20 bg-ink/35 lg:hidden"
                tabIndex={-1}
                aria-label={t.nav.closeMenu}
                onClick={() => closeMenu(false)}
              />
            )}

            <nav
              id={NAVIGATION_ID}
              ref={navigationRef}
              aria-label={t.nav.mainMenu}
              className={cn(
                'scroll-thin fixed top-14 bottom-0 start-0 z-30 w-72 overflow-y-auto border-e border-line bg-surface px-3 py-4',
                'transition-transform duration-200 ease-out motion-reduce:transition-none',
                'lg:sticky lg:top-14 lg:z-0 lg:h-[calc(100vh-3.5rem)] lg:w-64 lg:translate-x-0 lg:visible lg:shrink-0',
                menuOpen
                  ? 'visible translate-x-0'
                  : 'invisible translate-x-full',
              )}
            >
              <ul className="space-y-5">
                {visibleSections.map((section) => (
                  <li key={section.id}>
                    <p className="px-2 pb-1.5 text-[11px] font-semibold tracking-wide text-ink-subtle">
                      {section.label}
                    </p>
                    <ul className="space-y-0.5">
                      {section.items.map((item) => (
                        <li key={item.to}>
                          <NavLink
                            to={item.to}
                            end={item.end ?? false}
                            onClick={() => closeMenu(false)}
                            title={item.label}
                            className={({ isActive }) =>
                              cn(
                                'relative flex items-center gap-2 rounded-control px-2.5 py-2 text-[0.8125rem] transition-colors',
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
                            <span className="truncate">{item.label}</span>
                          </NavLink>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </nav>

            <main
              id="main-content"
              className="min-w-0 flex-1 space-y-4 px-3 py-4 sm:px-5 sm:py-5 lg:px-6"
            >
              <AppBreadcrumb />
              <Outlet />
            </main>
          </div>
        ) : (
          <BootstrapScreen>
            {isOrganizationReady ? (
              <FinancialContextGate />
            ) : (
              <OrganizationGate />
            )}
          </BootstrapScreen>
        )}
      </LicenseGate>
    </div>
  );
}
