import { render, screen } from '@testing-library/react';
import { Boxes, Package, Receipt, ShieldCheck } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { NavGlyph, NAV_TONE_TILE, type NavTone } from './nav-glyph';

/**
 * The navigation glyph is the visual identity of a domain. Two contracts are
 * pinned here:
 *
 * 1. It is decorative — the label next to it is the accessible name, so the
 *    glyph never becomes a second, noisy announcement for a screen reader.
 * 2. The active state is visually distinct from the idle state for EVERY tone,
 *    and every tone is distinguishable from the others. A copy-pasted map
 *    entry (two domains sharing one tint) is a silent usability regression.
 */

const TONES = Object.keys(NAV_TONE_TILE) as NavTone[];

describe('NavGlyph', () => {
  it('renders a decorative glyph tile with its own tone marker', () => {
    const { container } = render(<NavGlyph icon={Receipt} tone="accounting" />);

    const tile = container.querySelector('[data-tone]');
    expect(tile).not.toBeNull();
    expect(tile).toHaveAttribute('data-tone', 'accounting');
    expect(tile).toHaveAttribute('data-active', 'false');
    expect(tile).toHaveAttribute('aria-hidden', 'true');

    const svg = tile?.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('is not exposed as a control or an image to assistive technology', () => {
    render(<NavGlyph icon={Boxes} tone="workspace" />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('marks the active route with the saturated tone instead of the soft tint', () => {
    const idle = render(<NavGlyph icon={Package} tone="inventory" />);
    const idleTile = idle.container.querySelector('[data-tone]');

    idle.unmount();

    const active = render(<NavGlyph icon={Package} tone="inventory" active />);
    const activeTile = active.container.querySelector('[data-tone]');

    expect(activeTile).toHaveAttribute('data-active', 'true');
    expect(activeTile?.className).toContain('bg-tone-inventory-strong');
    expect(idleTile?.className).toContain('bg-tone-inventory-soft');
    expect(idleTile?.className).not.toContain('bg-tone-inventory-strong');
  });

  it('keeps every tone visually distinct in the shared map', () => {
    const idleClasses = TONES.map((tone) => NAV_TONE_TILE[tone].idle);
    const activeClasses = TONES.map((tone) => NAV_TONE_TILE[tone].active);
    const markerClasses = TONES.map((tone) => NAV_TONE_TILE[tone].marker);

    expect(new Set(idleClasses).size).toBe(TONES.length);
    expect(new Set(activeClasses).size).toBe(TONES.length);
    expect(new Set(markerClasses).size).toBe(TONES.length);
  });

  it('uses only semantic token utilities — never a raw palette value', () => {
    for (const tone of TONES) {
      const classes = [
        NAV_TONE_TILE[tone].idle,
        NAV_TONE_TILE[tone].active,
        NAV_TONE_TILE[tone].icon,
        NAV_TONE_TILE[tone].marker,
      ].join(' ');

      expect(classes).toMatch(/tone-/);
      expect(classes).not.toMatch(
        /\b(?:text|bg|ring|border)-(?:slate|indigo|emerald|orange|blue|pink|gray|zinc)-[0-9]{2,3}\b/,
      );
      expect(classes).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    }
  });

  it('scales the tile for dense (sidebar) and header contexts', () => {
    const small = render(
      <NavGlyph icon={ShieldCheck} tone="admin" size="sm" />,
    );
    const smallTile = small.container.querySelector('[data-tone]');
    small.unmount();

    const large = render(
      <NavGlyph icon={ShieldCheck} tone="admin" size="lg" />,
    );
    const largeTile = large.container.querySelector('[data-tone]');

    expect(smallTile?.className).toContain('h-5');
    expect(largeTile?.className).toContain('h-8');
  });

  it('lets the caller extend the tile without dropping its tone styling', () => {
    const { container } = render(
      <NavGlyph icon={Receipt} tone="licensing" className="my-extra-class" />,
    );

    const tile = container.querySelector('[data-tone]');
    expect(tile?.className).toContain('my-extra-class');
    expect(tile?.className).toContain('bg-tone-licensing-soft');
  });
});
