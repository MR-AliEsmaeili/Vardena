import {
  ArrowLeft,
  CircleUserRound,
  ClipboardList,
  FileKey2,
  KeyRound,
  LayoutDashboard,
  Lock,
  LogOut,
  Moon,
  ScrollText,
  ShieldCheck,
  Sun,
  UserRoundCog,
  Users,
  Workflow,
} from 'lucide-react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useSession } from '@/features/auth/use-session';
import { DashboardPage } from '@/features/home/dashboard-page';
import { usePermissions } from '@/features/permissions/use-permissions';
import { useOwnerTheme } from '@/lib/appearance';
import { t } from '@/lib/i18n';
import { o } from '@/lib/owner-i18n';
import { Button } from '@/ui/button';
import { PageHeading } from '@/ui/patterns/page-heading';
import { BackgroundActivityIndicator } from '@/ui/patterns/request-activity';

export function AppShell() {
  const session = useSession();
  const permissions = usePermissions();
  const { theme, toggleTheme } = useOwnerTheme();

  const links = [
    ['/app', o.home, null, LayoutDashboard],
    ['/app/customers', o.customers, 'customers.view', Users],
    ['/app/users', o.users, 'users.manage', UserRoundCog],
    ['/app/signing-keys', o.signingKeys, 'customers.view', KeyRound],
    ['/app/licenses', o.licenses.title, 'licenses.view', FileKey2],
    ['/app/audit', o.audit, 'audit.view', ScrollText],
    ['/app/operations', o.operations, 'operations.view', ClipboardList],
    ['/app/lifecycle', o.lifecycle, null, Workflow],
  ] as const;

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-2 focus:z-50 focus:rounded-control focus:border focus:border-line focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-raised"
      >
        {t.app.skipToContent}
      </a>
      <header className="sticky top-0 z-30 flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-line bg-surface/95 px-4 py-2.5 backdrop-blur-xs md:px-6">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-accent-line bg-accent-soft text-accent-ink"
          >
            <ShieldCheck className="size-4.5" />
          </span>
          <span className="text-sm font-bold tracking-tight text-ink sm:text-base">
            {t.app.name}
          </span>
          <BackgroundActivityIndicator />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex min-w-0 items-center gap-1.5 rounded-control border border-line bg-muted/70 px-2.5 py-1 text-xs font-medium text-secondary">
            <CircleUserRound
              aria-hidden="true"
              className="size-3.5 shrink-0 text-subtle"
            />
            <bdi>{session.user?.username}</bdi>
            {session.user?.role && (
              <span className="border-s border-line ps-1.5 text-[0.6875rem] text-muted-ink">
                {o.roles[session.user.role]}
              </span>
            )}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={theme === 'dark' ? t.app.themeLight : t.app.themeDark}
            title={theme === 'dark' ? t.app.themeLight : t.app.themeDark}
            onClick={toggleTheme}
          >
            {theme === 'dark' ? (
              <Sun className="size-4" aria-hidden="true" />
            ) : (
              <Moon className="size-4" aria-hidden="true" />
            )}
          </Button>
          <Button asChild variant="ghost" size="sm">
            <NavLink to="/change-password">
              {t.auth.changePasswordTitle}
            </NavLink>
          </Button>
          <Button
            variant="outline"
            size="sm"
            loading={session.isLoggingOut}
            disabled={session.isLoggingOut}
            onClick={() => void session.logout()}
          >
            <LogOut className="size-3.5" aria-hidden="true" />
            {session.isLoggingOut ? t.auth.loggingOut : t.auth.logout}
          </Button>
        </div>
      </header>
      <div className="mx-auto flex max-w-[1440px] flex-col md:min-h-[calc(100vh-3.5rem)] md:flex-row">
        <nav
          aria-label={o.home}
          className="shrink-0 border-b border-line bg-surface p-2.5 md:w-60 md:border-e md:border-b-0"
        >
          <ul className="grid grid-cols-2 gap-1 md:sticky md:top-18 md:grid-cols-1">
            {links.map(([to, label, p, Icon]) => (
              <li key={to}>
                {p && !permissions.has(p) ? (
                  <span
                    className="flex min-h-9 items-center justify-between gap-2 rounded-control px-3 py-1.5 text-xs text-muted-ink opacity-70"
                    title={o.forbidden}
                  >
                    <span className="flex min-w-0 items-center gap-2 truncate">
                      <Icon aria-hidden="true" className="size-4 shrink-0" />
                      <span className="truncate">{label}</span>
                    </span>
                    <Lock
                      aria-hidden="true"
                      className="size-3 shrink-0 text-subtle"
                    />
                  </span>
                ) : (
                  <NavLink
                    end={to === '/app'}
                    to={to}
                    className={({ isActive }) =>
                      `flex min-h-9 items-center gap-2.5 rounded-control border-s-2 px-3 py-1.5 text-sm transition-colors ${isActive ? 'border-accent bg-accent-soft font-semibold text-accent-ink' : 'border-transparent text-secondary hover:bg-muted hover:text-ink'}`
                    }
                  >
                    <Icon aria-hidden="true" className="size-4 shrink-0" />
                    <span className="truncate">{label}</span>
                  </NavLink>
                )}
              </li>
            ))}
          </ul>
        </nav>
        <main
          id="main-content"
          tabIndex={-1}
          className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8"
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function OwnerHome() {
  const permissions = usePermissions();
  return (
    <section className="space-y-6">
      <PageHeading>{o.home}</PageHeading>
      {permissions.loaded && permissions.codes.length === 0 && (
        <output className="block rounded-card border border-warning-line bg-warning-soft p-4 text-sm text-warning">
          {o.scope}
        </output>
      )}
      <DashboardPage />
      <LifecyclePage />
    </section>
  );
}

export function LifecyclePage() {
  const permissions = usePermissions();
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-base font-bold text-ink sm:text-lg">
          {o.lifecycle}
        </h2>
        <p className="text-sm text-secondary">{o.manual}</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {o.slices.map((item) => {
          const canExecute = Boolean(
            item.href && item.permission && permissions.has(item.permission),
          );
          const canInspect =
            !canExecute &&
            item.href.startsWith('/app/operations') &&
            permissions.has('operations.view');

          return (
            <li
              className="owner-panel flex flex-col justify-between gap-2.5 border-s-2 border-s-accent/70 p-4 transition-colors hover:border-control-line"
              key={item.label}
            >
              <h3 className="text-sm font-semibold text-ink">{item.label}</h3>
              {canExecute ? (
                <Link
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent-ink underline-offset-4 hover:underline"
                  to={item.href}
                >
                  {o.openManual}
                  <ArrowLeft aria-hidden="true" className="size-3.5" />
                </Link>
              ) : canInspect ? (
                <Link
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent-ink underline-offset-4 hover:underline"
                  to="/app/operations"
                >
                  {o.manualInspect}
                  <ArrowLeft aria-hidden="true" className="size-3.5" />
                </Link>
              ) : item.href ? (
                <p className="text-xs text-muted-ink">{o.manualDenied}</p>
              ) : (
                <p className="text-xs text-muted-ink">{o.unavailable}</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
