/**
 * Appearance settings — theme and font scale.
 *
 * Three font scales and two themes, persisted in localStorage under a
 * single versioned key. No backend contract exists for these preferences
 * (they are device-local), and the backend never observes them.
 *
 * Storage key is versioned so a future preference shape can migrate without
 * silently inheriting an incompatible value; `parseAppearance` falls back to
 * defaults when the stored JSON is missing, malformed, or carries an unknown
 * enum value.
 */

import { t } from './i18n';

export const APPEARANCE_STORAGE_KEY = 'vardena:appearance:v1';

export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const FONT_SCALES = ['compact', 'default', 'comfortable'] as const;
export type FontScale = (typeof FONT_SCALES)[number];

export interface AppearanceSettings {
  theme: Theme;
  fontScale: FontScale;
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: 'light',
  fontScale: 'default',
};

const VALID_THEME = new Set<string>(THEMES);
const VALID_SCALE = new Set<string>(FONT_SCALES);

export function parseAppearance(raw: string | null): AppearanceSettings {
  if (raw === null) return { ...DEFAULT_APPEARANCE };
  try {
    const parsed = JSON.parse(raw) as Partial<AppearanceSettings>;
    const theme =
      typeof parsed.theme === 'string' && VALID_THEME.has(parsed.theme)
        ? (parsed.theme as Theme)
        : DEFAULT_APPEARANCE.theme;
    const fontScale =
      typeof parsed.fontScale === 'string' && VALID_SCALE.has(parsed.fontScale)
        ? (parsed.fontScale as FontScale)
        : DEFAULT_APPEARANCE.fontScale;
    return { theme, fontScale };
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export function serializeAppearance(settings: AppearanceSettings): string {
  return JSON.stringify(settings);
}

/**
 * Apply appearance to the document root. Safe to call in non-DOM environments
 * (tests, SSR stubs): it no-ops when `document` is absent.
 */
export function applyAppearance(settings: AppearanceSettings): void {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  html.setAttribute('data-theme', settings.theme);
  html.setAttribute('data-font-scale', settings.fontScale);
  // `color-scheme` informs the browser's native controls (scrollbar, form
  // controls) and `prefers-color-scheme` consumers.
  html.style.colorScheme = settings.theme;
}

/** Read the persisted appearance, falling back to defaults. */
export function readStoredAppearance(): AppearanceSettings {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_APPEARANCE };
  try {
    return parseAppearance(localStorage.getItem(APPEARANCE_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

/** Persist appearance; safe outside a DOM (e.g. during tests with no storage). */
export function persistAppearance(settings: AppearanceSettings): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, serializeAppearance(settings));
  } catch {
    // Quota or private-mode — the preference is best-effort on this device.
  }
}

export const FONT_SCALE_LABEL: Record<FontScale, string> = {
  compact: t.app.fontScaleOptions.compact,
  default: t.app.fontScaleOptions.default,
  comfortable: t.app.fontScaleOptions.comfortable,
};

export const THEME_LABEL: Record<Theme, string> = {
  light: t.app.themeLight,
  dark: t.app.themeDark,
};
