/**
 * Query-string boolean transform (kernel-technical DTO primitive, AR-06).
 *
 * Query parameters always arrive as strings. This maps the two canonical
 * spellings and leaves anything else untouched so `@IsBoolean()` rejects it
 * with a 400 instead of silently coercing `"yes"`/`"1"`/`""` into a filter the
 * caller did not ask for.
 *
 * `modules/users/api/dto/list-users-query.dto.ts` has a private copy of the
 * same function; it predates this helper and is left untouched (no drive-by
 * refactoring, AG-03).
 */
export function parseQueryBoolean(value: unknown): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}
