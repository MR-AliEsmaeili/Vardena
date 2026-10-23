import { useCallback, useMemo, useState, type UIEvent } from 'react';

export interface VirtualWindowOptions {
  /** Total number of items. */
  totalCount: number;
  /** Estimated height of one row in pixels. */
  rowHeight?: number;
  /** Visible viewport height in pixels when virtualization activates. */
  viewportHeight?: number;
  /** Minimum row count before windowing activates (default: 80). */
  threshold?: number;
  /** Extra rows rendered above and below the viewport (default: 8). */
  overscan?: number;
}

export interface VirtualWindowState {
  isVirtualized: boolean;
  startIndex: number;
  endIndex: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  viewportHeight: number;
  onScroll: (event: UIEvent<HTMLElement>) => void;
  scrollToRow: (index: number, container: HTMLElement | null) => void;
}

/**
 * Lightweight zero-dependency row virtualization (standards.md §8, ADR-0002).
 *
 * Below `threshold` rows, all rows render normally with zero spacer overhead.
 * At or above `threshold`, only the visible slice + `overscan` rows mount,
 * keeping 500+ line operational grids responsive during rapid keyboard entry.
 */
export function useVirtualWindow({
  totalCount,
  rowHeight = 44,
  viewportHeight = 520,
  threshold = 80,
  overscan = 8,
}: VirtualWindowOptions): VirtualWindowState {
  const [scrollTop, setScrollTop] = useState(0);
  const isVirtualized = totalCount >= threshold;

  const onScroll = useCallback((event: UIEvent<HTMLElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  const scrollToRow = useCallback(
    (index: number, container: HTMLElement | null) => {
      if (!isVirtualized || container === null) return;
      const targetTop = index * rowHeight;
      const targetBottom = targetTop + rowHeight;
      const viewTop = container.scrollTop;
      const viewBottom = viewTop + viewportHeight;
      if (targetTop < viewTop) {
        container.scrollTop = targetTop;
        setScrollTop(targetTop);
      } else if (targetBottom > viewBottom) {
        const nextTop = Math.max(0, targetBottom - viewportHeight);
        container.scrollTop = nextTop;
        setScrollTop(nextTop);
      }
    },
    [isVirtualized, rowHeight, viewportHeight],
  );

  return useMemo(() => {
    if (!isVirtualized) {
      return {
        isVirtualized: false,
        startIndex: 0,
        endIndex: totalCount,
        topSpacerHeight: 0,
        bottomSpacerHeight: 0,
        viewportHeight,
        onScroll,
        scrollToRow,
      };
    }

    const visibleCount = Math.ceil(viewportHeight / rowHeight);
    const rawStart = Math.floor(scrollTop / rowHeight) - overscan;
    const startIndex = Math.max(0, Math.min(rawStart, totalCount));
    const endIndex = Math.min(
      totalCount,
      Math.max(
        startIndex,
        Math.floor(scrollTop / rowHeight) + visibleCount + overscan,
      ),
    );
    const topSpacerHeight = startIndex * rowHeight;
    const bottomSpacerHeight = Math.max(0, (totalCount - endIndex) * rowHeight);

    return {
      isVirtualized: true,
      startIndex,
      endIndex,
      topSpacerHeight,
      bottomSpacerHeight,
      viewportHeight,
      onScroll,
      scrollToRow,
    };
  }, [
    isVirtualized,
    onScroll,
    overscan,
    rowHeight,
    scrollToRow,
    scrollTop,
    totalCount,
    viewportHeight,
  ]);
}
