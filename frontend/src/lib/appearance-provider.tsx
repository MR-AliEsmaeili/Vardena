import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  applyAppearance,
  persistAppearance,
  readStoredAppearance,
  type FontScale,
  type Theme,
} from './appearance';
import {
  AppearanceContext,
  type AppearanceContextValue,
} from './use-appearance';

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(() => readStoredAppearance());

  useEffect(() => {
    applyAppearance(settings);
    persistAppearance(settings);
  }, [settings]);

  // Re-apply on mount even if state equals default, so a server-rendered
  // `data-theme="light"` does not linger when localStorage holds `dark`.
  useEffect(() => {
    applyAppearance(readStoredAppearance());
  }, []);

  const setTheme = useCallback((theme: Theme) => {
    setSettings((prev) => ({ ...prev, theme }));
  }, []);

  const setFontScale = useCallback((scale: FontScale) => {
    setSettings((prev) => ({ ...prev, fontScale: scale }));
  }, []);

  const toggleTheme = useCallback(() => {
    setSettings((prev) => ({
      ...prev,
      theme: prev.theme === 'light' ? 'dark' : 'light',
    }));
  }, []);

  const value = useMemo<AppearanceContextValue>(
    () => ({
      theme: settings.theme,
      fontScale: settings.fontScale,
      setTheme,
      setFontScale,
      toggleTheme,
    }),
    [settings.theme, settings.fontScale, setTheme, setFontScale, toggleTheme],
  );

  // Keep the initial setting on first paint; the effect above corrects it if
  // localStorage disagrees. `DEFAULT_APPEARANCE` is intentionally not used
  // here to avoid a flash of the wrong theme when storage holds `dark`.
  if (
    typeof document !== 'undefined' &&
    document.documentElement.getAttribute('data-theme') === null
  ) {
    document.documentElement.setAttribute('data-theme', settings.theme);
    document.documentElement.setAttribute(
      'data-font-scale',
      settings.fontScale,
    );
  }

  return (
    <AppearanceContext.Provider value={value}>
      {children}
    </AppearanceContext.Provider>
  );
}

/**
 * Inline script for the earliest possible theme application, before React
 * hydrates. Injected as a `<script>` tag in `index.html` to avoid FOUC.
 * Keep this string in sync with `APPEARANCE_STORAGE_KEY` and
 * `DEFAULT_APPEARANCE` above.
 */
export const APPEARANCE_EARLY_SCRIPT = `
(function(){
  try{
    var raw=localStorage.getItem('vardena:appearance:v1');
    if(!raw) return;
    var p=JSON.parse(raw);
    var theme=p&&p.theme;
    var scale=p&&p.fontScale;
    if(theme==='light'||theme==='dark') document.documentElement.setAttribute('data-theme',theme);
    if(scale==='compact'||scale==='default'||scale==='comfortable') document.documentElement.setAttribute('data-font-scale',scale);
    if(theme==='light'||theme==='dark') document.documentElement.style.colorScheme=theme;
  }catch(e){}
})();
`.trim();
