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
 * the visual language, accessible name and theme policy cannot drift:
 *
 * - `size` uses the library's tuned presets (20 inline, 64 standalone); no
 *   arbitrary scaling is invented here.
 * - `theme` defaults to `auto`, which makes the orb follow the nearest
 *   `data-theme`/`.light`/`.dark` ancestor and then `prefers-color-scheme`.
 *   Vardena declares its current theme once on `<html data-theme="light">`,
 *   so the orb is light today; a future dark theme only has to flip that root
 *   attribute and every orb follows without per-component changes.
 * - `prefers-reduced-motion` is handled inside the library: it renders one
 *   static representative frame, so no second reduced-motion branch is
 *   duplicated here.
 * - The library renders `role="img"` + an aria-label. When the orb sits next
 *   to visible Persian text (every current usage), set `decorative` so the
 *   canvas is removed from the accessibility tree and only the readable
 *   status text is announced.
 *
 * The canvas is client-only and pauses itself offscreen / on a hidden tab.
 */
export interface ThinkingOrbIndicatorProps {
  state?: OrbState;
  size?: OrbSize;
  /** Default `auto` — follows the root `data-theme`, then the OS. */
  theme?: OrbTheme;
  /** Accessible name used when the orb itself is meaningful. */
  label?: string;
  /** Hide the canvas from assistive tech (a visible label already exists). */
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
  // `data-*` is not part of the library's public props type, but the component
  // forwards every remaining prop to the canvas. Keeping the test id on the
  // canvas (not on an extra wrapper) preserves the exact DOM the library owns.
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
