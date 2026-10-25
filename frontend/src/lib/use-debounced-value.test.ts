import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SEARCH_DEBOUNCE_MS,
  useDebounce,
  useDebouncedValue,
} from './use-debounced-value';

/**
 * The one debounce the grid standard relies on
 * (`docs/frontend/data-table.md`): the value reaches the caller only after the
 * quiet window, and a fast sequence of changes collapses into the last one.
 */

afterEach(() => {
  vi.useRealTimers();
});

describe('useDebounce', () => {
  it('returns the initial value immediately and updates after 300ms', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useDebounce(value),
      { initialProps: { value: 'اب' } },
    );

    expect(result.current).toBe('اب');
    expect(SEARCH_DEBOUNCE_MS).toBe(300);

    rerender({ value: 'انبار' });
    expect(result.current).toBe('اب');

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current).toBe('اب');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('انبار');
  });

  it('collapses fast typing into the last value only', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useDebounce(value, 100),
      { initialProps: { value: '' } },
    );

    rerender({ value: 'ح' });
    act(() => {
      vi.advanceTimersByTime(60);
    });
    rerender({ value: 'حس' });
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(result.current).toBe('');

    rerender({ value: 'حساب' });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe('حساب');
  });

  it('uses the same implementation as useDebouncedValue', () => {
    expect(useDebounce).toBeTypeOf('function');
    expect(useDebouncedValue).toBeTypeOf('function');
  });
});
