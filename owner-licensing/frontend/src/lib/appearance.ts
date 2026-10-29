import { useSyncExternalStore } from 'react';

export type OwnerTheme = 'light' | 'dark';

const STORAGE_KEY = 'vardena-owner:appearance:v1';
const listeners = new Set<() => void>();

export function readOwnerTheme(): OwnerTheme {
  if (typeof window === 'undefined') return 'light';
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return 'light';
    const parsed = JSON.parse(raw) as { theme?: unknown };
    return parsed?.theme === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function applyOwnerTheme(theme: OwnerTheme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme = theme;
}

export function setOwnerTheme(theme: OwnerTheme): void {
  applyOwnerTheme(theme);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme }));
  } catch {
    // Private browsing / quota exceeded: DOM attribute still applies for session.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useOwnerTheme(): {
  theme: OwnerTheme;
  setTheme: (theme: OwnerTheme) => void;
  toggleTheme: () => void;
} {
  const theme = useSyncExternalStore<OwnerTheme>(
    subscribe,
    readOwnerTheme,
    () => 'light',
  );
  return {
    theme,
    setTheme: setOwnerTheme,
    toggleTheme: () => setOwnerTheme(theme === 'dark' ? 'light' : 'dark'),
  };
}
