import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThinkingOrbIndicator } from './thinking-orb';

/**
 * Integration coverage of the REAL `thinking-orbs` component through our one
 * wrapper: DOM role/name, tuned sizes, decorative mode, and the library's
 * `prefers-reduced-motion` contract (a static frame, never a rAF loop).
 *
 * jsdom has no canvas, so a no-op 2D context is installed for this file. The
 * library's painting code only writes to it; the assertions are about its
 * scheduling and accessibility behavior, not pixels.
 */

const originalMatchMedia = window.matchMedia;

function fakeContext(): CanvasRenderingContext2D {
  const gradient = { addColorStop: vi.fn() };
  const target: Record<string | symbol, unknown> = {
    canvas: document.createElement('canvas'),
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    filter: 'none',
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  };

  return new Proxy(target, {
    get(object, property) {
      if (property in object) return object[property];
      if (
        property === 'createLinearGradient' ||
        property === 'createRadialGradient'
      ) {
        return () => gradient;
      }
      return () => undefined;
    },
    set(object, property, value) {
      object[property] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function setReducedMotion(reduced: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: reduced && query.includes('(prefers-reduced-motion: reduce)'),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  vi.restoreAllMocks();
});

/** Tracks scheduled frames so a test can prove the loop is (not) running. */
function trackFrames() {
  let nextId = 1;
  const scheduled = new Map<number, FrameRequestCallback>();

  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    const id = nextId++;
    scheduled.set(id, callback);
    return id;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    scheduled.delete(id);
  });

  return scheduled;
}

describe('ThinkingOrbIndicator', () => {
  it('renders the library canvas with its role and accessible name', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      fakeContext(),
    );

    render(<ThinkingOrbIndicator size={64} label="در حال دریافت گزارش…" />);

    const canvas = screen.getByRole('img', {
      name: 'در حال دریافت گزارش…',
    });
    expect(canvas.tagName).toBe('CANVAS');
    expect(canvas).toHaveAttribute('width', '64');
    expect(canvas).toHaveAttribute('height', '64');
  });

  it('is hidden from assistive tech when it is decorative', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      fakeContext(),
    );

    render(<ThinkingOrbIndicator decorative />);

    const canvas = document.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas).toHaveAttribute('aria-hidden', 'true');
  });

  it('settles on a static frame under prefers-reduced-motion', async () => {
    setReducedMotion(true);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      fakeContext(),
    );
    const scheduled = trackFrames();

    render(<ThinkingOrbIndicator size={20} />);
    await act(async () => undefined);

    // The library reads the media query in an effect, so the first paint may
    // arm one frame; by the time effects settle it must have cancelled it and
    // rendered exactly one static frame instead of a loop.
    expect(scheduled.size).toBe(0);
  });

  it('keeps an animation loop running when motion is allowed', async () => {
    setReducedMotion(false);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      fakeContext(),
    );
    const scheduled = trackFrames();

    render(<ThinkingOrbIndicator size={20} />);
    await act(async () => undefined);

    expect(scheduled.size).toBe(1);
  });

  it('delegates the reduced-motion preference to the library', () => {
    const matchMedia = vi.fn((query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }));
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      fakeContext(),
    );

    render(<ThinkingOrbIndicator size={20} />);

    // The app must not re-implement reduced motion; it only has to let the
    // library read the media query.
    expect(
      matchMedia.mock.calls.some(
        ([query]) => query === '(prefers-reduced-motion: reduce)',
      ),
    ).toBe(true);
  });

  it('supports an explicit dark theme without changing the wrapper contract', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      fakeContext(),
    );

    render(<ThinkingOrbIndicator theme="dark" label="نشانگر" />);

    // The library owns the palette; the wrapper must still expose one named
    // canvas and no extra DOM.
    expect(screen.getByRole('img', { name: 'نشانگر' }).tagName).toBe('CANVAS');
  });
});
