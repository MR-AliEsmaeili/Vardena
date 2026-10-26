import { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useLicenseState } from '@/features/licensing/use-license-state';
import { useOrganization } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { t } from '@/lib/i18n';
import { persistSidebarState, readSidebarState } from '@/lib/sidebar-state';
import { AppBreadcrumb } from '../breadcrumb';
import { ActiveWindowsBar } from './active-windows-bar';
import { AppHeader } from './app-header';
import { PageBackButton } from './page-back-button';
import { AppSidebar } from './app-sidebar';
import { BootstrapScreen, ResolvingState } from './bootstrap-states';
import { FinancialContextGate } from './financial-context-gate';
import { LicenseGate } from './license-gate';
import { OrganizationGate } from './organization-gate';

const NAVIGATION_ID = 'app-navigation';

/**
 * The authenticated application shell.
 *
 * Full-width RTL layout with no artificial `max-w-[1600px]` clamp:
 * - Sticky `AppHeader` (Logo → Global Search → Jalali Date → Organization →
 *   Settings → Profile)
 * - Collapsible `AppSidebar` (16rem expanded / 3.75rem icon-only with tooltips
 *   on desktop; accessible focus-trapped drawer on mobile). The sidebar owns
 *   its own collapse handle and folds itself after a menu selection so the
 *   opened form gets the full width.
 * - Bootstrap pipeline:
 *   `session → LicenseGate → OrganizationGate → FinancialContextGate → workspace`
 */
export function AppShell() {
  const license = useLicenseState();
  const organization = useOrganization();
  const permissions = usePermissions();

  const [sidebarState, setSidebarState] = useState(() => readSidebarState());
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileToggleRef = useRef<HTMLButtonElement>(null);
  const navigationRef = useRef<HTMLElement>(null);

  useEffect(() => {
    persistSidebarState(sidebarState);
  }, [sidebarState]);

  const toggleSidebar = useCallback(() => {
    setSidebarState((prev) => ({ ...prev, collapsed: !prev.collapsed }));
  }, []);

  const collapseSidebar = useCallback(() => {
    // The rail is a desktop affordance; on mobile it is already a drawer.
    if (typeof window.matchMedia !== 'function') return;
    if (!window.matchMedia('(min-width: 1024px)').matches) return;
    setSidebarState((prev) =>
      prev.collapsed ? prev : { ...prev, collapsed: true },
    );
  }, []);

  /**
   * Opening a menu entry hands the workspace back to the form: the rail folds
   * itself so the document grid/editor gets the full width.
   */
  const handleSidebarNavigate = useCallback(() => {
    collapseSidebar();
  }, [collapseSidebar]);

  const expandGroupFromRail = useCallback((groupId: string) => {
    setSidebarState((prev) => ({
      ...prev,
      collapsed: false,
      collapsedGroups: prev.collapsedGroups.filter((id) => id !== groupId),
    }));
  }, []);

  const toggleGroup = useCallback((groupId: string) => {
    setSidebarState((prev) => ({
      ...prev,
      collapsedGroups: prev.collapsedGroups.includes(groupId)
        ? prev.collapsedGroups.filter((id) => id !== groupId)
        : [...prev.collapsedGroups, groupId],
    }));
  }, []);

  const closeMobile = useCallback((restoreFocus: boolean) => {
    setMobileOpen(false);
    if (restoreFocus) {
      mobileToggleRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMobile(true);
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
  }, [closeMobile, mobileOpen]);

  const licenseActive = license.status === 'active';
  const isOrganizationReady = organization.status === 'ready';
  const canResolveFinancialContext =
    permissions.loaded &&
    permissions.has(PERMISSIONS.accounting.financialAreaView) &&
    permissions.has(PERMISSIONS.accounting.fiscalYearView);
  const isWorkspaceReady =
    licenseActive &&
    isOrganizationReady &&
    permissions.loaded &&
    (!canResolveFinancialContext ||
      organization.financialContextStatus === 'ready');

  return (
    /*
     * `overflow-x-clip` (not `hidden`: `hidden` would create a scroll
     * container and break the sticky header/sidebar) keeps ONE noisy widget
     * from scrolling the whole RTL page sideways. Grids already scroll inside
     * their own `TableWrapper`, so nothing loses reachable content, and the
     * header/menu layout still has to fit on its own (see
     * `e2e/responsive.spec.ts`).
     */
    <div className="min-h-screen overflow-x-clip bg-canvas text-ink">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:shadow-raised"
      >
        {t.app.skipToContent}
      </a>

      <AppHeader
        navigationId={NAVIGATION_ID}
        mobileOpen={mobileOpen}
        onToggleMobileMenu={() =>
          mobileOpen ? closeMobile(false) : setMobileOpen(true)
        }
        mobileToggleRef={mobileToggleRef}
        licenseActive={licenseActive}
        isOrganizationReady={isOrganizationReady}
        isWorkspaceReady={isWorkspaceReady}
      />

      {isWorkspaceReady && <ActiveWindowsBar />}

      <LicenseGate>
        {isWorkspaceReady ? (
          <div className="flex w-full items-start">
            <AppSidebar
              navigationId={NAVIGATION_ID}
              navigationRef={navigationRef}
              collapsed={sidebarState.collapsed}
              collapsedGroups={sidebarState.collapsedGroups}
              onToggleGroup={toggleGroup}
              onToggleCollapsed={toggleSidebar}
              onExpandGroup={expandGroupFromRail}
              mobileOpen={mobileOpen}
              onCloseMobile={closeMobile}
              onNavigate={handleSidebarNavigate}
            />

            <main
              id="main-content"
              className="min-w-0 flex-1 space-y-4 px-3 py-4 sm:px-5 sm:py-5 lg:px-6"
            >
              <AppBreadcrumb />
              <PageBackButton />
              <Outlet />
            </main>
          </div>
        ) : (
          <BootstrapScreen>
            {!isOrganizationReady ? (
              <OrganizationGate />
            ) : !permissions.loaded ? (
              <ResolvingState label={t.app.loading} />
            ) : (
              <FinancialContextGate />
            )}
          </BootstrapScreen>
        )}
      </LicenseGate>
    </div>
  );
}
