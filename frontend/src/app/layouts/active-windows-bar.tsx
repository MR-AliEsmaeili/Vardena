import { X } from 'lucide-react';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { NAV_TONE_TILE, type NavTone } from '@/ui/nav-glyph';
import { navigationSections } from '../navigation';

interface ActiveWindow {
  path: string;
  label: string;
  tone: NavTone;
}

function resolveWindow(path: string): ActiveWindow {
  const match = navigationSections
    .flatMap((section) => section.items.map((item) => ({ section, item })))
    .filter(({ item }) => path === item.to || path.startsWith(`${item.to}/`))
    .sort((left, right) => right.item.to.length - left.item.to.length)[0];

  if (match === undefined) {
    return { path, label: t.nav.activeWindow, tone: 'workspace' };
  }

  const isNew = path.endsWith('/new');
  const isEdit = path.endsWith('/edit');
  const label = isNew
    ? `${match.item.label} · ${t.nav.newWindow}`
    : isEdit
      ? `${match.item.label} · ${t.nav.editWindow}`
      : match.item.label;
  return { path, label, tone: match.section.tone };
}

function createWindowStore() {
  let snapshot: readonly ActiveWindow[] = [];
  const listeners = new Set<() => void>();

  const publish = (next: readonly ActiveWindow[]) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    open(path: string) {
      if (snapshot.some((window) => window.path === path)) return;
      publish([...snapshot, resolveWindow(path)]);
    },
    remove(path: string) {
      publish(snapshot.filter((window) => window.path !== path));
    },
  };
}

/**
 * Compact route-window switcher. Each destination is represented once (query
 * changes don't create duplicate windows); cards wrap into rows rather than
 * scrolling horizontally. Navigation remains router-native and module tints
 * reuse the app's semantic tone tokens.
 */
export function ActiveWindowsBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const store = useMemo(() => createWindowStore(), []);
  const windows = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const activePath = location.pathname;

  useEffect(() => {
    if (activePath.startsWith('/app/') && activePath !== '/app/profile') {
      store.open(activePath);
    }
  }, [activePath, store]);

  const activeWindow = useMemo(
    () => windows.find((window) => window.path === activePath),
    [activePath, windows],
  );

  if (windows.length === 0) return null;

  const closeWindow = (path: string) => {
    const index = windows.findIndex((window) => window.path === path);
    const remaining = windows.filter((window) => window.path !== path);
    store.remove(path);
    if (path === activePath) {
      const fallback = remaining[Math.max(0, index - 1)];
      navigate(fallback?.path ?? '/app', { replace: true });
    }
  };

  return (
    <section
      aria-label={t.nav.activeWindows}
      data-testid="active-windows"
      className="border-b border-line/70 bg-sunken/45 px-3 py-2 sm:px-5 lg:px-6"
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-1.5">
        {windows.map((window) => {
          const isActive = window.path === activeWindow?.path;
          const tone = NAV_TONE_TILE[window.tone];
          return (
            <div
              key={window.path}
              className={cn(
                'animate-fade-in group/window flex min-w-0 items-center gap-1 rounded-control border px-1.5 py-1 transition-[background-color,border-color,box-shadow] duration-200 motion-reduce:transition-none',
                tone.idle,
                isActive
                  ? 'border-current shadow-card'
                  : 'border-line/70 hover:brightness-[0.98]',
              )}
              data-tone={window.tone}
              data-active={isActive ? 'true' : 'false'}
            >
              <button
                type="button"
                className="min-w-0 flex-1 truncate px-1 text-start text-xs font-medium"
                aria-current={isActive ? 'page' : undefined}
                aria-label={t.nav.openWindow.replace('{window}', window.label)}
                onClick={() => navigate(window.path)}
              >
                {window.label}
              </button>
              <button
                type="button"
                className="action-press flex h-6 w-6 shrink-0 items-center justify-center rounded-control text-ink-subtle transition-colors hover:bg-danger-soft hover:text-danger-ink focus-visible:bg-danger-soft focus-visible:text-danger-ink"
                aria-label={t.nav.closeWindow.replace('{window}', window.label)}
                onClick={() => closeWindow(window.path)}
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
