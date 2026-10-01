import type { SortingState } from '@tanstack/react-table';

/**
 * Serialize the table sort state into the backend's `sort` parameter
 * (`field:asc|desc`, comma separated). Callers must only mark columns whose
 * id IS the API sort field as sortable, so an unsupported field can never be
 * sent (the backend answers 400 for anything outside its allow-list).
 */
export function sortingToParam(sorting: SortingState): string | undefined {
  if (sorting.length === 0) return undefined;
  return sorting
    .map((entry) => `${entry.id}:${entry.desc ? 'desc' : 'asc'}`)
    .join(',');
}

/**
 * Parse a `sort` URL parameter back into TanStack sort state.
 *
 * URL parameters are untrusted input: entries with an empty id are dropped,
 * and when `allowedIds` is given, any id outside the allow-list is dropped
 * instead of being forwarded to the backend (which would answer 400).
 */
export function sortingFromParam(
  value: string | undefined | null,
  allowedIds?: readonly string[],
): SortingState {
  if (value === undefined || value === null || value.trim() === '') return [];
  const allowed = allowedIds === undefined ? null : new Set(allowedIds);
  return value
    .split(',')
    .map((part) => {
      const [id = '', direction = ''] = part.split(':');
      return { id: id.trim(), desc: direction.trim() !== 'asc' };
    })
    .filter(
      (entry) =>
        entry.id !== '' && (allowed === null || allowed.has(entry.id)),
    );
}
