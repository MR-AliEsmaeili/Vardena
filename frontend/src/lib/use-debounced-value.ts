import { useEffect, useState } from 'react';

/** Default debounce of every search/filter control (standards.md §۶). */
export const SEARCH_DEBOUNCE_MS = 300;

/** Delay a fast-changing value (e.g. a search box) before it reaches a query. */
export function useDebouncedValue<T>(
  value: T,
  delayMs: number = SEARCH_DEBOUNCE_MS,
): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

/**
 * Public alias of `useDebouncedValue` used by the data-grid standard
 * (`docs/frontend/data-table.md`). It is the SAME implementation — one
 * debounce util, never a second timer inside a component (standards.md §۶).
 */
export function useDebounce<T>(
  value: T,
  delayMs: number = SEARCH_DEBOUNCE_MS,
): T {
  return useDebouncedValue(value, delayMs);
}
