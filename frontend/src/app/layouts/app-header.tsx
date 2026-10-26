import {
  Boxes,
  CalendarDays,
  KeyRound,
  LogOut,
  Menu,
  Moon,
  Search,
  Settings2,
  Sun,
  Type,
  UserRound,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useWorkspace } from '../workspace/workspace-context';
import { FinancialContextSwitcher } from '@/features/accounting/context/financial-context-switcher';
import { useSession } from '@/features/auth/use-session';
import { OrganizationSwitcher } from '@/features/organization/organization-switcher';
import { usePermissions } from '@/features/permissions/use-permissions';
import { FONT_SCALES } from '@/lib/appearance';
import { todayBusinessDay, useTimeZone } from '@/lib/datetime';
import { formatBusinessDay } from '@/lib/datetime/business-date';
import { t } from '@/lib/i18n';
import { useAppearance } from '@/lib/use-appearance';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/button';
import { DropdownMenu, DropdownMenuItem } from '@/ui/dropdown-menu';
import { Input } from '@/ui/input';
import { BackgroundActivityIndicator } from '@/ui/patterns/request-activity';
import { isNavigationItemVisible, navigationSections } from '../navigation';

export interface AppHeaderProps {
  navigationId: string;
  mobileOpen: boolean;
  onToggleMobileMenu: () => void;
  mobileToggleRef: RefObject<HTMLButtonElement | null>;
  licenseActive: boolean;
  isOrganizationReady: boolean;
  isWorkspaceReady: boolean;
}

/**
 * Application Header — strict RTL visual order (right to left):
 * 1. Logo (+ sidebar toggle)
 * 2. Global search (`Ctrl+K`)
 * 3. Jalali BusinessDate (organization IANA zone)
 * 4. Organization & financial context selector
 * 5. Software settings (Light/Dark theme + 3-level font scale)
 * 6. User profile menu & secure logout
 */
export function AppHeader({
  navigationId,
  mobileOpen,
  onToggleMobileMenu,
  mobileToggleRef,
  licenseActive,
  isOrganizationReady,
  isWorkspaceReady,
}: AppHeaderProps) {
  const session = useSession();
  const permissions = usePermissions();
  const timeZone = useTimeZone();
  const appearance = useAppearance();
  const navigate = useNavigate();
  const workspace = useWorkspace();
  // ADR-0054 (§4.6): scope switchers are blocked while unsaved changes live
  // in any window — the switch would reset the whole workspace.
  const hasDirtyWindows = workspace?.hasDirtyWindows ?? false;

  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const settingsRef = useRef<HTMLDivElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const desktopSearchInputRef = useRef<HTMLInputElement>(null);
  const mobileSearchInputRef = useRef<HTMLInputElement>(null);

  // Close settings / search popovers on outside pointer down or Escape;
  // bind Ctrl+K / Cmd+K to focus global search (standards.md §13).
  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (
        settingsRef.current !== null &&
        !settingsRef.current.contains(target)
      ) {
        setSettingsOpen(false);
      }
      if (
        searchContainerRef.current !== null &&
        !searchContainerRef.current.contains(target)
      ) {
        // Keep query text if user only clicked away when empty
        if (searchQuery.trim() !== '') {
          setSearchQuery('');
        }
      }
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        if (!isWorkspaceReady) return;
        event.preventDefault();
        desktopSearchInputRef.current?.focus();
        return;
      }
      if (event.key === 'Escape') {
        setSettingsOpen(false);
        setMobileSearchOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isWorkspaceReady, searchQuery]);

  useEffect(() => {
    if (mobileSearchOpen) {
      mobileSearchInputRef.current?.focus();
    }
  }, [mobileSearchOpen]);

  const permittedItems = useMemo(
    () =>
      navigationSections.flatMap((section) =>
        section.items
          .filter((item) => isNavigationItemVisible(item, permissions))
          .map((item) => ({
            ...item,
            sectionLabel: section.label,
          })),
      ),
    [permissions],
  );

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const filteredNav = useMemo(() => {
    if (trimmedQuery === '') return [];
    return permittedItems.filter(
      (item) =>
        item.label.toLowerCase().includes(trimmedQuery) ||
        item.sectionLabel.toLowerCase().includes(trimmedQuery),
    );
  }, [permittedItems, trimmedQuery]);

  const handleSearchSelect = useCallback(
    (to: string) => {
      setSearchQuery('');
      setMobileSearchOpen(false);
      // ADR-0054 (§4.8): Enter/click on a search result opens a NEW window —
      // search is an explicit "take me there" intent, never a silent reuse.
      if (workspace !== null) {
        workspace.open(to, { intent: 'new' });
        return;
      }
      navigate(to);
    },
    [navigate, workspace],
  );

  const today = todayBusinessDay(timeZone);
  const jalaliToday = formatBusinessDay(today);

  return (
    <header
      className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85"
      data-testid="app-header"
    >
      <div className="flex h-14 w-full items-center gap-1.5 px-2 sm:gap-2 sm:px-4">
        {/* 1 — Logo + mobile menu (Right / inline-start in RTL). The desktop
            collapse handle lives inside the sidebar itself. */}
        <div
          className="flex min-w-0 shrink items-center gap-1.5"
          data-testid="header-slot-logo"
        >
          <Button
            ref={mobileToggleRef}
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              'shrink-0',
              isWorkspaceReady ? 'lg:hidden' : 'hidden',
            )}
            aria-label={mobileOpen ? t.nav.closeMenu : t.nav.openMenu}
            aria-expanded={mobileOpen}
            aria-controls={navigationId}
            onClick={onToggleMobileMenu}
            data-testid="mobile-menu-toggle"
          >
            {mobileOpen ? (
              <X className="h-5 w-5" aria-hidden />
            ) : (
              <Menu className="h-5 w-5" aria-hidden />
            )}
          </Button>

          <Link
            to="/app"
            aria-label={t.app.name}
            onClick={(event) => {
              if (workspace === null) return;
              event.preventDefault();
              workspace.open('/app');
            }}
            className="flex min-w-0 items-center gap-2 rounded-control focus-visible:outline-2 focus-visible:outline-brand"
          >
            <span
              aria-hidden="true"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-brand text-white shadow-card"
            >
              <Boxes className="h-4.5 w-4.5" />
            </span>
            <span className="hidden min-w-0 flex-col justify-center leading-tight sm:flex">
              {/* The mark alone is the logo on a phone: a 360px header cannot
                  afford a wordmark next to the scope, settings and profile
                  controls (it carries no function, and the link keeps its
                  accessible name through `aria-label`). */}
              <span className="hidden truncate text-sm font-bold text-ink sm:inline">
                {t.app.name}
              </span>
              <span className="hidden truncate text-[0.6875rem] text-ink-subtle xl:block">
                {t.app.tagline}
              </span>
            </span>
          </Link>
        </div>

        {/* 2 — Global Search */}
        {isWorkspaceReady && (
          <div
            ref={searchContainerRef}
            className="relative ms-1 hidden max-w-xs min-w-0 flex-1 items-center md:flex lg:max-w-sm"
            data-testid="header-slot-search"
          >
            <div className="relative flex w-full items-center">
              <Search
                className="pointer-events-none absolute start-2.5 h-4 w-4 text-ink-subtle"
                aria-hidden
              />
              <Input
                ref={desktopSearchInputRef}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setSearchQuery('');
                  } else if (
                    event.key === 'Enter' &&
                    filteredNav[0] !== undefined
                  ) {
                    event.preventDefault();
                    handleSearchSelect(filteredNav[0].to);
                  }
                }}
                placeholder={t.nav.globalSearchPlaceholder}
                aria-label={t.nav.globalSearch}
                className="h-8 w-full bg-sunken ps-8 pe-7 text-xs"
                data-testid="global-search-input"
              />
              {searchQuery !== '' && (
                <button
                  type="button"
                  className="absolute end-2 rounded p-0.5 text-ink-subtle hover:text-ink"
                  aria-label={t.app.close}
                  onClick={() => setSearchQuery('')}
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              )}
            </div>
            {trimmedQuery !== '' && (
              <div
                className="animate-rise-in absolute start-0 top-9 z-40 max-h-72 w-full overflow-y-auto rounded-card border border-line bg-surface p-1 shadow-raised"
                data-testid="global-search-results"
              >
                {filteredNav.length === 0 ? (
                  <p className="px-3 py-2.5 text-xs text-ink-muted">
                    {t.nav.globalSearchEmpty}
                  </p>
                ) : (
                  <ul className="space-y-0.5">
                    {filteredNav.map((item) => (
                      <li key={item.to}>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-2 rounded-control px-3 py-2 text-start text-xs hover:bg-sunken"
                          onClick={() => handleSearchSelect(item.to)}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <item.icon
                              className="h-4 w-4 shrink-0 text-brand"
                              aria-hidden
                            />
                            <span className="truncate font-medium text-ink">
                              {item.label}
                            </span>
                          </span>
                          <span className="shrink-0 text-[0.6875rem] text-ink-subtle">
                            {item.sectionLabel}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        {isWorkspaceReady && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 md:hidden"
            aria-label={t.nav.globalSearch}
            aria-expanded={mobileSearchOpen}
            onClick={() => setMobileSearchOpen((prev) => !prev)}
            data-testid="mobile-search-toggle"
          >
            <Search className="h-4.5 w-4.5" aria-hidden />
          </Button>
        )}

        <div className="ms-auto flex min-w-0 items-center gap-1.5 sm:gap-2.5">
          <span className="hidden sm:inline-flex">
            <BackgroundActivityIndicator />
          </span>

          {/* 3 — Jalali Date */}
          <span
            className="hidden shrink-0 items-center gap-1.5 rounded-control border border-line bg-sunken px-2.5 py-1 text-xs font-medium text-ink-muted md:inline-flex"
            title={today}
            data-testid="header-slot-date"
          >
            <CalendarDays
              className="h-3.5 w-3.5 shrink-0 text-ink-subtle"
              aria-hidden
            />
            <span dir="ltr" className="tabular-nums">
              {jalaliToday}
            </span>
          </span>

          {/* 4 — Organization & Financial Scope */}
          {licenseActive && (
            <div
              className="flex min-w-0 shrink items-center gap-2"
              data-testid="header-slot-organization"
            >
              <OrganizationSwitcher
                compact
                scopeChangeBlocked={hasDirtyWindows}
              />
              {isOrganizationReady && (
                <FinancialContextSwitcher
                  compact
                  scopeChangeBlocked={hasDirtyWindows}
                />
              )}
            </div>
          )}

          {/* 5 — Software Settings (Theme + 3 Font Scales) */}
          <div
            ref={settingsRef}
            className="relative shrink-0"
            data-testid="header-slot-settings"
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t.app.settings}
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen((prev) => !prev)}
              data-testid="settings-toggle"
            >
              <Settings2 className="h-4.5 w-4.5" aria-hidden />
            </Button>
            {settingsOpen && (
              <section
                aria-label={t.app.settings}
                className="animate-rise-in absolute end-0 top-full z-40 mt-1.5 w-72 rounded-card border border-line bg-surface p-4 text-ink shadow-raised"
                data-testid="settings-panel"
              >
                <h2 className="mb-3 text-sm font-semibold text-ink">
                  {t.app.settings}
                </h2>

                <div className="mb-4">
                  <p className="mb-2 text-xs font-medium text-ink-muted">
                    {t.app.themeLabel}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={cn(
                        'flex flex-1 items-center justify-center gap-1.5 rounded-control border px-3 py-2 text-xs font-medium transition-colors',
                        appearance.theme === 'light'
                          ? 'border-brand bg-brand-soft text-brand-ink'
                          : 'border-line bg-surface text-ink-muted hover:bg-sunken',
                      )}
                      aria-pressed={appearance.theme === 'light'}
                      onClick={() => appearance.setTheme('light')}
                      data-testid="theme-light"
                    >
                      <Sun className="h-4 w-4" aria-hidden />
                      {t.app.themeLight}
                    </button>
                    <button
                      type="button"
                      className={cn(
                        'flex flex-1 items-center justify-center gap-1.5 rounded-control border px-3 py-2 text-xs font-medium transition-colors',
                        appearance.theme === 'dark'
                          ? 'border-brand bg-brand-soft text-brand-ink'
                          : 'border-line bg-surface text-ink-muted hover:bg-sunken',
                      )}
                      aria-pressed={appearance.theme === 'dark'}
                      onClick={() => appearance.setTheme('dark')}
                      data-testid="theme-dark"
                    >
                      <Moon className="h-4 w-4" aria-hidden />
                      {t.app.themeDark}
                    </button>
                  </div>
                </div>

                <div>
                  <p className="mb-2 flex items-center gap-1 text-xs font-medium text-ink-muted">
                    <Type className="h-3.5 w-3.5" aria-hidden />
                    {t.app.fontScaleLabel}
                  </p>
                  <div className="flex gap-1.5">
                    {FONT_SCALES.map((scale) => (
                      <button
                        key={scale}
                        type="button"
                        className={cn(
                          'flex-1 rounded-control border px-2 py-2 text-xs font-medium transition-colors',
                          appearance.fontScale === scale
                            ? 'border-brand bg-brand-soft text-brand-ink'
                            : 'border-line bg-surface text-ink-muted hover:bg-sunken',
                        )}
                        aria-pressed={appearance.fontScale === scale}
                        onClick={() => appearance.setFontScale(scale)}
                        data-testid={`font-scale-${scale}`}
                      >
                        {t.app.fontScaleOptions[scale]}
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            )}
          </div>

          {/* 6 — User Profile & Logout (Left / inline-end in RTL) */}
          <div
            className="flex shrink-0 items-center gap-1 border-s border-line ps-2"
            data-testid="header-slot-profile"
          >
            <DropdownMenu
              open={profileOpen}
              onOpenChange={setProfileOpen}
              label={t.app.profile}
              align="end"
              data-testid="profile-menu"
              menuClassName="w-60"
              trigger={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 px-2"
                  aria-label={t.app.profile}
                  aria-expanded={profileOpen}
                  aria-haspopup="menu"
                  onClick={() => setProfileOpen((prev) => !prev)}
                  data-testid="profile-toggle"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-sunken text-ink-subtle"
                  >
                    <UserRound className="h-3.5 w-3.5" />
                  </span>
                  <span
                    className="hidden max-w-28 truncate text-xs font-medium text-ink sm:inline"
                    dir="ltr"
                  >
                    {session.user?.username ?? ''}
                  </span>
                </Button>
              }
            >
              <div className="border-b border-line px-3 py-2">
                <p className="text-xs text-ink-subtle">{t.auth.signedInAs}</p>
                <p
                  className="truncate text-sm font-semibold text-ink"
                  dir="ltr"
                >
                  {session.user?.username ?? ''}
                </p>
              </div>
              {isWorkspaceReady && (
                <div className="py-1">
                  <DropdownMenuItem
                    icon={<UserRound className="h-4 w-4" aria-hidden />}
                    data-testid="profile-menu-open-profile"
                    onSelect={() => {
                      setProfileOpen(false);
                      if (workspace !== null) workspace.open('/app/profile');
                      else navigate('/app/profile');
                    }}
                  >
                    {t.app.viewProfile}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    icon={<KeyRound className="h-4 w-4" aria-hidden />}
                    data-testid="profile-menu-change-password"
                    onSelect={() => {
                      setProfileOpen(false);
                      if (workspace !== null) workspace.open('/app/profile');
                      else navigate('/app/profile');
                    }}
                  >
                    {t.profile.passwordSection}
                  </DropdownMenuItem>
                </div>
              )}
              <div className="border-t border-line pt-1">
                <DropdownMenuItem
                  danger
                  disabled={session.isLoggingOut}
                  icon={<LogOut className="h-4 w-4" aria-hidden />}
                  data-testid="profile-logout"
                  onSelect={() => {
                    setProfileOpen(false);
                    void session.logout();
                  }}
                >
                  {session.isLoggingOut ? t.auth.loggingOut : t.auth.logout}
                </DropdownMenuItem>
              </div>
            </DropdownMenu>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={
                session.isLoggingOut ? t.auth.loggingOut : t.auth.logout
              }
              title={t.auth.logout}
              disabled={session.isLoggingOut}
              loading={session.isLoggingOut}
              onClick={() => {
                void session.logout();
              }}
              data-testid="header-logout-button"
            >
              <LogOut className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </div>
      </div>

      {/* Expandable mobile search bar */}
      {isWorkspaceReady && mobileSearchOpen && (
        <div className="border-t border-line bg-surface px-3 py-2 md:hidden">
          <div className="flex items-center gap-1.5">
            <div className="relative flex flex-1 items-center">
              <Search
                className="pointer-events-none absolute start-2.5 h-4 w-4 text-ink-subtle"
                aria-hidden
              />
              <Input
                ref={mobileSearchInputRef}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t.nav.globalSearchPlaceholder}
                aria-label={t.nav.globalSearch}
                className="h-9 w-full bg-sunken ps-8 text-sm"
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t.app.close}
              onClick={() => {
                setSearchQuery('');
                setMobileSearchOpen(false);
              }}
            >
              <X className="h-4 w-4" aria-hidden />
            </Button>
          </div>
          {trimmedQuery !== '' && (
            <ul className="mt-2 max-h-56 space-y-0.5 overflow-y-auto">
              {filteredNav.length === 0 ? (
                <li className="px-2 py-2 text-xs text-ink-muted">
                  {t.nav.globalSearchEmpty}
                </li>
              ) : (
                filteredNav.map((item) => (
                  <li key={item.to}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-control px-3 py-2 text-start text-sm hover:bg-sunken"
                      onClick={() => handleSearchSelect(item.to)}
                    >
                      <item.icon
                        className="h-4 w-4 shrink-0 text-brand"
                        aria-hidden
                      />
                      <span className="truncate">{item.label}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      )}
    </header>
  );
}
