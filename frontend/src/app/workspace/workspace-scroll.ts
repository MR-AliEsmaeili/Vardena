/**
 * Per-window scroll memory (spec §6.5).
 *
 * The document owns ONE scroll position, but each window is an independent
 * work context: before the active window changes, its `scrollTop` is saved;
 * after activation (inside a `requestAnimationFrame`) it is restored. A
 * window that was never scrolled in this session — e.g. a restored
 * descriptor mounting for the first time — has no entry and restoring is a
 * no-op. The map is runtime-only; nothing is persisted (W-08).
 */

import type { WindowId } from './workspace-reducer';

export interface ScrollElementLike {
  scrollTop: number;
}

export class WindowScrollMemory {
  private readonly positions = new Map<WindowId, number>();

  constructor(
    private readonly element: () => ScrollElementLike | null = () =>
      typeof document === 'undefined'
        ? null
        : (document.scrollingElement as ScrollElementLike | null),
  ) {}

  save(id: WindowId): void {
    // jsdom can hand back `undefined` instead of `null` for
    // document.scrollingElement — normalise before the guard.
    const element = this.element() ?? null;
    if (element === null) return;
    this.positions.set(id, element.scrollTop);
  }

  restore(id: WindowId): void {
    const element = this.element() ?? null;
    const saved = this.positions.get(id);
    if (element === null || saved === undefined) return;
    element.scrollTop = saved;
  }

  /** Forget a closed window so the map stays bounded by the window cap. */
  forget(id: WindowId): void {
    this.positions.delete(id);
  }

  /** Organization / financial-context reset drops every position (§6.8). */
  clear(): void {
    this.positions.clear();
  }
}
