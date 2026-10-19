import { Link, NavLink, Outlet } from 'react-router-dom';
import { useSession } from '@/features/auth/use-session';
import { usePermissions } from '@/features/permissions/use-permissions';
import { t } from '@/lib/i18n';
import { o } from '@/lib/owner-i18n';
import { Button } from '@/ui/button';
export function AppShell() {
  const session = useSession(),
    permissions = usePermissions();
  const links = [
    ['/app', o.home, null],
    ['/app/customers', o.customers, 'customers.view'],
    ['/app/users', o.users, 'users.manage'],
    ['/app/signing-keys', o.signingKeys, 'customers.view'],
    ['/app/audit', o.audit, 'audit.view'],
    ['/app/operations', o.operations, 'operations.view'],
    ['/app/lifecycle', o.lifecycle, null],
  ] as const;
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <a href="#main-content" className="sr-only focus:not-sr-only">
        {t.app.skipToContent}
      </a>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white p-4">
        <span className="text-lg font-bold text-indigo-700">{t.app.name}</span>
        <div className="flex flex-wrap items-center gap-3">
          <span>{session.user?.username}</span>
          <NavLink className="text-sm underline" to="/change-password">
            {t.auth.changePasswordTitle}
          </NavLink>
          <Button
            variant="outline"
            disabled={session.isLoggingOut}
            onClick={() => void session.logout()}
          >
            {session.isLoggingOut ? t.auth.loggingOut : t.auth.logout}
          </Button>
        </div>
      </header>
      <div className="mx-auto flex max-w-[1400px] flex-col md:flex-row">
        <nav
          aria-label={o.home}
          className="shrink-0 border-e bg-white p-3 md:w-56"
        >
          <ul className="flex flex-wrap gap-1 md:flex-col">
            {links.map(([to, label, p]) => (
              <li key={to}>
                {p && !permissions.has(p) ? (
                  <span
                    className="block rounded px-3 py-2 text-sm text-slate-400"
                    title={o.forbidden}
                  >
                    {label}
                  </span>
                ) : (
                  <NavLink
                    end={to === '/app'}
                    to={to}
                    className={({ isActive }) =>
                      `block rounded px-3 py-2 text-sm ${isActive ? 'bg-indigo-50 font-semibold text-indigo-700' : 'hover:bg-slate-100'}`
                    }
                  >
                    {label}
                  </NavLink>
                )}
              </li>
            ))}
          </ul>
        </nav>
        <main id="main-content" className="min-w-0 flex-1 p-4 sm:p-6">
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
      <h1 className="text-xl font-bold">{o.home}</h1>
      {permissions.loaded && permissions.codes.length === 0 && (
        <output className="rounded border border-amber-200 bg-amber-50 p-4">
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
      <h2 className="font-bold">{o.lifecycle}</h2>
      <p>{o.manual}</p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {o.slices.map((item) => (
          <li
            className="rounded-lg border border-dashed bg-white p-4"
            key={item.label}
          >
            <h3 className="font-semibold">{item.label}</h3>
            {item.href &&
            item.permission &&
            permissions.has(item.permission) ? (
              <Link
                className="mt-2 inline-block text-sm underline"
                to={item.href}
              >
                {o.openManual}
              </Link>
            ) : item.href && permissions.has('operations.view') ? (
              <Link
                className="mt-2 inline-block text-sm underline"
                to="/app/operations"
              >
                {o.manualInspect}
              </Link>
            ) : item.href ? (
              <p className="mt-2 text-sm text-slate-500">{o.manualDenied}</p>
            ) : (
              <p className="mt-2 text-sm text-slate-500">{o.unavailable}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
