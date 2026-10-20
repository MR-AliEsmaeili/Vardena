import {
  LayoutDashboard,
  Users,
  UserRoundCog,
  KeyRound,
  FileKey2,
  ScrollText,
  ClipboardList,
  Workflow,
  ShieldCheck,
  CircleUserRound,
} from 'lucide-react';
import { PageHeading } from '@/ui/patterns/page-heading';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useSession } from '@/features/auth/use-session';
import { usePermissions } from '@/features/permissions/use-permissions';
import { t } from '@/lib/i18n';
import { o } from '@/lib/owner-i18n';
import { Button } from '@/ui/button';
import { BackgroundActivityIndicator } from '@/ui/patterns/request-activity';

export function AppShell() {
  const session = useSession();
  const permissions = usePermissions();
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
        className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:p-3"
      >
        {t.app.skipToContent}
      </a>
      <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3 md:px-6">
        <div className="flex items-center gap-3">
          <ShieldCheck
            aria-hidden="true"
            className="size-8 shrink-0 text-accent"
          />
          <span className="text-base font-bold text-ink sm:text-lg">
            {t.app.name}
          </span>
          <BackgroundActivityIndicator />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex min-w-0 items-center gap-2 rounded-md bg-muted px-2 py-1 text-sm text-secondary">
            <CircleUserRound aria-hidden="true" className="size-4 shrink-0" />
            <bdi>{session.user?.username}</bdi>
          </span>
          <NavLink
            className="text-sm text-accent underline-offset-2 hover:underline"
            to="/change-password"
          >
            {t.auth.changePasswordTitle}
          </NavLink>
          <Button
            variant="outline"
            size="sm"
            loading={session.isLoggingOut}
            disabled={session.isLoggingOut}
            onClick={() => void session.logout()}
          >
            {session.isLoggingOut ? t.auth.loggingOut : t.auth.logout}
          </Button>
        </div>
      </header>
      <div className="mx-auto flex max-w-[1440px] flex-col md:min-h-[calc(100vh-4.5rem)] md:flex-row">
        <nav
          aria-label={o.home}
          className="shrink-0 border-b border-line bg-surface p-3 md:w-60 md:border-e md:border-b-0"
        >
          <ul className="grid grid-cols-2 gap-1 md:sticky md:top-24 md:grid-cols-1">
            {links.map(([to, label, p, Icon]) => (
              <li key={to}>
                {p && !permissions.has(p) ? (
                  <span
                    className="flex min-h-10 items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-ink"
                    title={o.forbidden}
                  >
                    <Icon aria-hidden="true" className="size-4 shrink-0" />
                    {label}
                  </span>
                ) : (
                  <NavLink
                    end={to === '/app'}
                    to={to}
                    className={({ isActive }) =>
                      `flex min-h-10 items-center gap-2 rounded-md border-s-2 px-3 py-2 text-sm transition-colors ${isActive ? 'border-accent bg-accent-soft font-semibold text-accent-strong' : 'border-transparent text-secondary hover:bg-muted'}`
                    }
                  >
                    <Icon aria-hidden="true" className="size-4 shrink-0" />
                    {label}
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
    <section className="space-y-4">
      <PageHeading>{o.home}</PageHeading>
      {permissions.loaded && permissions.codes.length === 0 && (
        <output className="block rounded-lg border border-warning-line bg-warning-soft p-4 text-sm text-warning">
          {o.scope}
        </output>
      )}
      <LifecyclePage />
    </section>
  );
}

export function LifecyclePage() {
  const permissions = usePermissions();
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-bold text-ink">{o.lifecycle}</h2>
      <p className="text-sm text-secondary">{o.manual}</p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {o.slices.map((item) => (
          <li
            className="border-s-2 border-line bg-surface p-4"
            key={item.label}
          >
            <h3 className="font-semibold text-ink">{item.label}</h3>
            {item.href &&
            item.permission &&
            permissions.has(item.permission) ? (
              <Link
                className="mt-2 inline-block text-sm font-medium text-accent underline-offset-2 hover:underline"
                to={item.href}
              >
                {o.openManual}
              </Link>
            ) : item.href.startsWith('/app/operations') &&
              permissions.has('operations.view') ? (
              <Link
                className="mt-2 inline-block text-sm font-medium text-accent underline-offset-2 hover:underline"
                to="/app/operations"
              >
                {o.manualInspect}
              </Link>
            ) : item.href ? (
              <p className="mt-2 text-sm text-muted-ink">{o.manualDenied}</p>
            ) : (
              <p className="mt-2 text-sm text-muted-ink">{o.unavailable}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
