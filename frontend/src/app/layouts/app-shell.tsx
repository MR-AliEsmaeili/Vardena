import { LogOut, Menu, UserRound, X } from 'lucide-react';
import { useState } from 'react';
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
import { AppBreadcrumb } from '../breadcrumb';
import { navigationSections } from '../navigation';
import { BootstrapScreen } from './bootstrap-states';
import { FinancialContextGate } from './financial-context-gate';
import { LicenseGate } from './license-gate';
import { OrganizationGate } from './organization-gate';

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
 */
export function AppShell() {
  const session = useSession();
  const license = useLicenseState();
  const organization = useOrganization();
  const permissions = usePermissions();
  const [menuOpen, setMenuOpen] = useState(false);

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

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded focus:bg-white focus:p-2 focus:shadow"
      >
        {t.app.skipToContent}
      </a>

      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="flex h-14 items-center gap-3 px-3 sm:px-4">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={isWorkspaceReady ? 'lg:hidden' : 'hidden'}
            aria-label={menuOpen ? t.nav.closeMenu : t.nav.openMenu}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? (
              <X className="h-5 w-5" aria-hidden />
            ) : (
              <Menu className="h-5 w-5" aria-hidden />
            )}
          </Button>

          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold text-indigo-700">
              {t.app.name}
            </span>
            <span className="hidden text-xs text-slate-500 sm:inline">
              {t.app.tagline}
            </span>
          </div>

          <div className="ms-auto flex items-center gap-3">
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
            <span className="hidden items-center gap-1.5 text-sm text-slate-700 sm:flex">
              <UserRound className="h-4 w-4 text-slate-400" aria-hidden />
              <span className="font-medium" dir="ltr">
                {session.user?.username ?? ''}
              </span>
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={session.isLoggingOut}
              onClick={() => {
                void session.logout();
              }}
            >
              <LogOut className="h-4 w-4" aria-hidden />
              {session.isLoggingOut ? t.auth.loggingOut : t.auth.logout}
            </Button>
          </div>
        </div>
      </header>

      <LicenseGate>
        {isWorkspaceReady ? (
          <div className="mx-auto flex w-full max-w-[1600px]">
            {menuOpen && (
              <button
                type="button"
                className="fixed inset-0 z-20 bg-slate-900/30 lg:hidden"
                aria-label={t.nav.closeMenu}
                onClick={() => setMenuOpen(false)}
              />
            )}

            <nav
              aria-label={t.nav.mainMenu}
              className={cn(
                'fixed inset-y-0 start-0 z-30 mt-14 w-64 shrink-0 overflow-y-auto border-e border-slate-200 bg-white p-3 transition-transform lg:static lg:mt-0 lg:translate-x-0',
                menuOpen
                  ? 'translate-x-0'
                  : 'translate-x-full lg:translate-x-0',
                !menuOpen && 'hidden lg:block',
              )}
            >
              <ul className="space-y-4">
                {visibleSections.map((section) => (
                  <li key={section.id}>
                    <p className="px-2 pb-1 text-xs font-semibold text-slate-400">
                      {section.label}
                    </p>
                    <ul className="space-y-1">
                      {section.items.map((item) => (
                        <li key={item.to}>
                          <NavLink
                            to={item.to}
                            end={item.end ?? false}
                            onClick={() => setMenuOpen(false)}
                            className={({ isActive }) =>
                              cn(
                                'flex items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors',
                                isActive
                                  ? 'bg-indigo-50 font-medium text-indigo-700'
                                  : 'text-slate-700 hover:bg-slate-100',
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
              className="min-w-0 flex-1 space-y-4 p-3 sm:p-5"
              dir="rtl"
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
