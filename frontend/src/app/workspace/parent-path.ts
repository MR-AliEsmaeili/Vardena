/**
 * The parent screen of a form/detail route — the ONE place that decides where
 * a form header's Back button goes when the window has no previous in-app
 * step (a direct link, a refresh, or the first screen of a window).
 *
 * Why this is not `navigate(-1)`:
 *  - In a workspace window the memory history may be empty (deep link,
 *    restored window), so "one step back" would leave the app or do nothing.
 *  - A record page's canonical parent is the LIST it belongs to, and that
 *    list keeps its filters in ITS OWN window (ADR-0054). Re-activating the
 *    open list window therefore preserves the user's filters without this
 *    module having to copy query strings around.
 *
 * Destination rules (in order), each validated against the real navigation
 * registry — no invented paths:
 *  1. an explicit `backTo` the page declares for its workflow step;
 *  2. `…/:id/edit` → `…/:id` (the record the form edits);
 *  3. `…/new` → its list, when that list is a registered destination;
 *  4. the longest registered destination that is a true prefix of the path
 *     (`/app/inventory/items/123` → `/app/inventory/items`);
 *  5. `/app` (the workspace hub) as the safe, always-valid fallback.
 *
 * Everything here is pure: no router, no DOM, no workspace state — the hook
 * that consumes it owns the activation/navigation side effect.
 */

import { navigationSections } from '../navigation';

/** Every registered in-app destination (the sidebar registry = real routes). */
const DESTINATIONS: ReadonlySet<string> = new Set(
  navigationSections.flatMap((section) => section.items.map((item) => item.to)),
);

/** Strip query/hash so a destination is compared by pathname only. */
export function pathnameOf(target: string): string {
  const withoutHash = target.split('#')[0] ?? target;
  return withoutHash.split('?')[0] ?? withoutHash;
}

/** The pathname without a single trailing `/`. */
function trimTrailingSlash(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/')
    ? pathname.slice(0, -1)
    : pathname;
}

/** Is this pathname a registered navigation destination (a real screen)? */
export function isRegisteredDestination(pathname: string): boolean {
  return DESTINATIONS.has(trimTrailingSlash(pathnameOf(pathname)));
}

/**
 * Longest registered destination strictly below `pathname`
 * (`/app/inventory/items/123` → `/app/inventory/items`). The bare `/app` hub
 * is only ever a match for `/app` itself, never a prefix of everything.
 */
export function deepestDestinationBelow(pathname: string): string | null {
  const path = trimTrailingSlash(pathnameOf(pathname));
  let best: string | null = null;
  for (const destination of DESTINATIONS) {
    if (destination === '/app') continue;
    if (!path.startsWith(`${destination}/`)) continue;
    if (best === null || destination.length > best.length) best = destination;
  }
  return best;
}

/** `…/123/edit` → `…/123` — the record the form edits. */
function editParent(path: string): string | null {
  if (!path.endsWith('/edit')) return null;
  const stripped = path.slice(0, -'/edit'.length);
  // `…/:id/edit` always sits beside `…/:id` in the route tree; `…/new/edit`
  // never exists, so a stripped path with too few segments is not trusted.
  const segments = stripped.split('/').filter((segment) => segment !== '');
  return segments.length >= 3 ? stripped : null;
}

/** `…/new` → the list it creates into (when that list really exists). */
function createParent(path: string): string | null {
  if (!path.endsWith('/new')) return null;
  const stripped = path.slice(0, -'/new'.length);
  return isRegisteredDestination(stripped) ? stripped : null;
}

export interface ParentPathInput {
  /** The current in-window pathname. */
  pathname: string;
  /** A page-declared parent for this workflow step (wins when valid). */
  explicitTarget?: string | undefined;
}

/**
 * Resolve the parent screen for `pathname`. Always returns a path the app can
 * actually render; never a fabricated segment.
 */
export function resolveParentPath({
  pathname,
  explicitTarget,
}: ParentPathInput): string {
  const path = trimTrailingSlash(pathnameOf(pathname));

  if (explicitTarget !== undefined && explicitTarget !== '') {
    const target = pathnameOf(explicitTarget);
    if (isRegisteredDestination(target) || target === '/app') {
      return explicitTarget;
    }
  }

  const fromEdit = editParent(path);
  if (fromEdit !== null) return fromEdit;

  const fromCreate = createParent(path);
  if (fromCreate !== null) return fromCreate;

  const listDestination = deepestDestinationBelow(path);
  if (listDestination !== null) return listDestination;

  // `/app/<module>/<collection>/new` whose collection is not a destination
  // (e.g. `inventory/transfers/new`): fall back to the module hub, which the
  // navigation registry always registers.
  const segments = path.split('/').filter((segment) => segment !== '');
  for (let depth = segments.length - 1; depth >= 1; depth -= 1) {
    const candidate = `/${segments.slice(0, depth).join('/')}`;
    if (isRegisteredDestination(candidate)) return candidate;
  }

  return '/app';
}
