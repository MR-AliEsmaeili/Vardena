import { createContext, useContext } from 'react';
import type { AppearanceSettings, FontScale, Theme } from './appearance';

export interface AppearanceContextValue extends AppearanceSettings {
  setTheme: (theme: Theme) => void;
  setFontScale: (scale: FontScale) => void;
  toggleTheme: () => void;
}

export const AppearanceContext = createContext<AppearanceContextValue | null>(
  null,
);

export function useAppearance(): AppearanceContextValue {
  const ctx = useContext(AppearanceContext);
  if (ctx === null) {
    throw new Error('useAppearance must be used inside AppearanceProvider');
  }
  return ctx;
}
