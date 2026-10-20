import {
  ThinkingOrb,
  type OrbSize,
  type OrbState,
  type OrbTheme,
  type ThinkingOrbProps,
} from 'thinking-orbs';
import { t } from '@/lib/i18n';

/**
 * The application's single wrapper around `thinking-orbs` (MIT, v0.3.2).
 *
 * Every loading surface imports THIS component, never the library directly, so
 * the visual language, accessible name and theme policy cannot drift.
 *
 * - size uses the library's tuned presets (20 inline, 64 standalone).
 * - theme defaults to auto (follows data-theme / prefers-color-scheme).
 * - prefers-reduced-motion is handled inside the library.
 * - When the orb sits next to visible Persian text, set decorative so only
 *   the readable status text is announced.
 */
export interface ThinkingOrbIndicatorProps {
  state?: OrbState;
  size?: OrbSize;
  theme?: OrbTheme;
  label?: string;
  decorative?: boolean;
  className?: string;
  'data-testid'?: string;
}

export function ThinkingOrbIndicator({
  state = 'working',
  size = 20,
  theme = 'auto',
  label = t.loading.orbLabel,
  decorative = false,
  className,
  'data-testid': testId,
}: ThinkingOrbIndicatorProps) {
  const orbProps: ThinkingOrbProps & { 'data-testid'?: string } = {
    state,
    size,
    theme,
    className,
    'aria-label': label,
    'aria-hidden': decorative ? true : undefined,
    ...(testId === undefined ? {} : { 'data-testid': testId }),
  };

  return <ThinkingOrb {...orbProps} />;
}
