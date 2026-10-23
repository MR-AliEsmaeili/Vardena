import { describe, expect, it } from 'vitest';
import {
  APPEARANCE_STORAGE_KEY,
  applyAppearance,
  DEFAULT_APPEARANCE,
  parseAppearance,
  persistAppearance,
  readStoredAppearance,
} from './appearance';
import {
  DEFAULT_SIDEBAR_STATE,
  parseSidebarState,
  persistSidebarState,
  readSidebarState,
  SIDEBAR_STORAGE_KEY,
} from './sidebar-state';

describe('appearance settings — theme and 3-level font scale', () => {
  it('falls back to light + default when storage is empty, malformed or unknown', () => {
    expect(parseAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance('{not-json')).toEqual(DEFAULT_APPEARANCE);
    expect(
      parseAppearance(JSON.stringify({ theme: 'neon', fontScale: 'giant' })),
    ).toEqual(DEFAULT_APPEARANCE);
  });

  it('parses valid light/dark themes and all three font scales', () => {
    expect(
      parseAppearance(JSON.stringify({ theme: 'dark', fontScale: 'compact' })),
    ).toEqual({ theme: 'dark', fontScale: 'compact' });

    expect(
      parseAppearance(
        JSON.stringify({ theme: 'light', fontScale: 'comfortable' }),
      ),
    ).toEqual({ theme: 'light', fontScale: 'comfortable' });
  });

  it('applies data-theme, data-font-scale and colorScheme on the root element and persists in localStorage', () => {
    const next = { theme: 'dark' as const, fontScale: 'comfortable' as const };
    applyAppearance(next);
    persistAppearance(next);

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-font-scale')).toBe(
      'comfortable',
    );
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe(
      JSON.stringify(next),
    );
    expect(readStoredAppearance()).toEqual(next);
  });
});

describe('sidebar persistence state', () => {
  it('defaults to expanded with no collapsed groups on missing or invalid JSON', () => {
    expect(parseSidebarState(null)).toEqual(DEFAULT_SIDEBAR_STATE);
    expect(parseSidebarState('invalid')).toEqual(DEFAULT_SIDEBAR_STATE);
  });

  it('persists and restores collapsed sidebar and collapsed category ids', () => {
    const state = {
      collapsed: true,
      collapsedGroups: ['accounting', 'inventory'],
    };
    persistSidebarState(state);
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBeTruthy();
    expect(readSidebarState()).toEqual(state);
  });
});
