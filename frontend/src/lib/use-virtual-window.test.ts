import { act, renderHook } from '@testing-library/react';
import type { UIEvent } from 'react';
import { describe, expect, it } from 'vitest';
import { useVirtualWindow } from './use-virtual-window';

/**
 * The grid's windowing math, isolated from the DOM.
 *
 * The compact row height is a product rule (standards.md §8), so the spacer
 * heights are asserted against the SAME row height the grid passes in: a
 * mismatch there shifts every row under the cursor while scrolling, which is
 * exactly the class of bug a snapshot of the rendered slice would not catch.
 */

const ROW_HEIGHT = 29;

function hook(overrides: Partial<Parameters<typeof useVirtualWindow>[0]> = {}) {
  return renderHook(() =>
    useVirtualWindow({ totalCount: 0, rowHeight: ROW_HEIGHT, ...overrides }),
  );
}

function scrollTo(element: HTMLElement, scrollTop: number) {
  element.scrollTop = scrollTop;
}

describe('useVirtualWindow', () => {
  it('keeps every row mounted below the activation threshold', () => {
    const { result } = hook({ totalCount: 79 });

    expect(result.current.isVirtualized).toBe(false);
    expect(result.current.startIndex).toBe(0);
    expect(result.current.endIndex).toBe(79);
    expect(result.current.topSpacerHeight).toBe(0);
    expect(result.current.bottomSpacerHeight).toBe(0);
  });

  it('activates exactly at the threshold and renders only a window plus overscan', () => {
    const { result } = hook({ totalCount: 80 });

    // ceil(520 / 29) = 18 visible rows, plus 8 overscan at scrollTop 0.
    expect(result.current.isVirtualized).toBe(true);
    expect(result.current.startIndex).toBe(0);
    expect(result.current.endIndex).toBe(26);
    expect(result.current.topSpacerHeight).toBe(0);
    expect(result.current.bottomSpacerHeight).toBe((80 - 26) * ROW_HEIGHT);
  });

  it('moves the window and both spacers together on scroll', () => {
    const { result } = hook({ totalCount: 500 });
    const container = document.createElement('div');
    const event = {
      currentTarget: container,
    } as unknown as UIEvent<HTMLElement>;

    act(() => {
      scrollTo(container, 29 * 100);
      result.current.onScroll(event);
    });

    expect(result.current.startIndex).toBe(92); // 100 - 8 overscan
    expect(result.current.topSpacerHeight).toBe(92 * ROW_HEIGHT);
    expect(result.current.endIndex).toBe(126);
    expect(result.current.bottomSpacerHeight).toBe((500 - 126) * ROW_HEIGHT);
  });

  it('never returns a negative or overflowing range at the edges', () => {
    const { result } = hook({ totalCount: 100 });
    const container = document.createElement('div');
    const event = {
      currentTarget: container,
    } as unknown as UIEvent<HTMLElement>;

    act(() => {
      scrollTo(container, 0);
      result.current.onScroll(event);
    });
    expect(result.current.startIndex).toBeGreaterThanOrEqual(0);

    act(() => {
      scrollTo(container, 100 * ROW_HEIGHT + 500);
      result.current.onScroll(event);
    });
    expect(result.current.endIndex).toBeLessThanOrEqual(100);
    expect(result.current.bottomSpacerHeight).toBe(0);
    expect(result.current.topSpacerHeight).toBeLessThanOrEqual(
      100 * ROW_HEIGHT,
    );
  });

  it('scrolls a row into view in both directions and is a no-op when unvirtualized', () => {
    const virtualized = renderHook(() =>
      useVirtualWindow({ totalCount: 200, rowHeight: ROW_HEIGHT }),
    );
    const container = document.createElement('div');

    // Row 40 sits below the initial 520px window -> scrolls down.
    act(() => {
      virtualized.result.current.scrollToRow(40, container);
    });
    expect(container.scrollTop).toBe(41 * ROW_HEIGHT - 520);

    // Row 0 is above the current view -> scrolls back to the top.
    act(() => {
      virtualized.result.current.scrollToRow(0, container);
    });
    expect(container.scrollTop).toBe(0);

    const plain = hook({ totalCount: 10 });
    const untouched = document.createElement('div');
    act(() => {
      plain.result.current.scrollToRow(5, untouched);
    });
    expect(untouched.scrollTop).toBe(0);
  });

  it('treats a null container as a no-op instead of throwing', () => {
    const { result } = hook({ totalCount: 200 });

    expect(() =>
      act(() => {
        result.current.scrollToRow(10, null);
      }),
    ).not.toThrow();
  });
});
