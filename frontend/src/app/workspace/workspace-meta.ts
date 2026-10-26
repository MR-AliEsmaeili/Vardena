/**
 * Per-window presentation metadata — derived from the path at render time,
 * never stored in workspace state (spec §6.6, invariant 4).
 *
 * `resolveWindowMeta(pathname, search)` follows the §6.6 table exactly:
 *  1. module = first segment after `/app`; empty/unknown → `workspace`;
 *  2. base icon+label from `navigationSections`: the item with
 *     `item.to === pathname`, else the LONGEST item whose `to` is a path
 *     prefix; else the module's section label. The bare `/app` hub item only
 *     matches exactly — otherwise every path would resolve to «میزکار»;
 *  3. dynamic suffix: last segment `new` → draft suffix, `/edit` → edit
 *     suffix, a single `:id`-shaped segment under a matched item → short id
 *     suffix (last 6 characters);
 *  4. known query suffixes (`kind=receipt|issue|transfer`,
 *     `type=receipt|issue`); unknown query keys never reach the title;
 *  5. fallback: section label + last segment — never an empty title;
 *  6. tone/icon are read at render time, not in state.
 *
 * Tone customisation (D-3) happens under this layer: `tone` here is the
 * MODULE id; `applyModuleTones` re-points the module's CSS variables at the
 * assigned tone's variables, so consumers keep reading `tone-<module>-*`.
 */

import type { LucideIcon } from 'lucide-react';
import { t } from '@/lib/i18n';
import {
  navigationSections,
  type NavigationItem,
  type NavigationSection,
} from '../navigation';

export type ModuleId =
  | 'workspace'
  | 'accounting'
  | 'inventory'
  | 'organization'
  | 'licensing'
  | 'admin';

export const MODULE_IDS: readonly ModuleId[] = [
  'workspace',
  'accounting',
  'inventory',
  'organization',
  'licensing',
  'admin',
];

export interface WindowMeta {
  module: ModuleId;
  title: string;
  /** The module's tone name — CSS variables apply the user's assignment. */
  tone: ModuleId;
  icon: LucideIcon;
}

const MODULE_ID_SET = new Set<string>(MODULE_IDS);

/** Rule 1 — module of a pathname (`/app/accounting/…` → `accounting`). */
export function moduleOfPath(pathname: string): ModuleId {
  const rest = pathname.startsWith('/app')
    ? pathname.slice('/app'.length)
    : pathname;
  const segments = rest.split('/').filter((segment) => segment !== '');
  const first = segments[0];
  if (first !== undefined && MODULE_ID_SET.has(first)) {
    return first as ModuleId;
  }
  return 'workspace';
}

function sectionOfModule(module: ModuleId): NavigationSection | undefined {
  return navigationSections.find((section) => section.tone === module);
}

interface ItemMatch {
  item: NavigationItem;
  section: NavigationSection;
}

/** Rule 2 — exact item, else the longest true path-prefix item. */
function matchNavigationItem(pathname: string): ItemMatch | null {
  let best: ItemMatch | null = null;
  for (const section of navigationSections) {
    for (const item of section.items) {
      if (item.to === pathname) {
        return { item, section };
      }
      // The bare `/app` hub only matches exactly: it is a prefix of every
      // in-app path and would swallow rule 5's fallback for unknown routes.
      if (item.to === '/app') continue;
      if (pathname.startsWith(`${item.to}/`)) {
        if (best === null || item.to.length > best.item.to.length) {
          best = { item, section };
        }
      }
    }
  }
  return best;
}

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

/** Persian digits for UI counts (windowCount is «N پنجره» with Persian N). */
export function toPersianDigits(value: number | string): string {
  return String(value).replace(
    /[0-9]/g,
    (digit) => PERSIAN_DIGITS[Number(digit)] ?? digit,
  );
}

export function formatWindowCount(count: number): string {
  return t.workspace.windowCount.replace('{count}', toPersianDigits(count));
}

/** Short, displayable id suffix: the last 6 characters (spec §6.6 rule 3). */
export function shortenWindowId(segment: string): string {
  return segment.slice(-6);
}

const KNOWN_KIND_SUFFIX: Record<string, string> = {
  receipt: t.workspace.querySuffix.kind.receipt,
  issue: t.workspace.querySuffix.kind.issue,
  transfer: t.workspace.querySuffix.kind.transfer,
};

const KNOWN_TYPE_SUFFIX: Record<string, string> = {
  receipt: t.workspace.querySuffix.type.receipt,
  issue: t.workspace.querySuffix.type.issue,
};

/**
 * Resolve the dock presentation of one window path. `search` is the query
 * string including the leading `?` (or empty) — unknown keys are ignored.
 */
export function resolveWindowMeta(
  pathname: string,
  search: string = '',
): WindowMeta {
  const module = moduleOfPath(pathname);
  const section = sectionOfModule(module);
  const match = matchNavigationItem(pathname);

  const baseLabel =
    match?.item.label ?? section?.label ?? t.workspace.moduleNames[module];
  const icon = match?.item.icon ?? section?.icon;

  let title = baseLabel;
  if (match !== null) {
    const remainder = pathname.slice(match.item.to.length).replace(/^\//, '');
    const segments = remainder.split('/').filter((segment) => segment !== '');
    const last = segments[segments.length - 1];
    if (last === 'new') {
      title = `${baseLabel} · ${t.workspace.draftSuffix}`;
    } else if (last === 'edit') {
      title = `${baseLabel} · ${t.workspace.editSuffix}`;
    } else if (segments.length === 1 && last !== undefined) {
      title = `${baseLabel} ${t.workspace.idSuffix.replace('{id}', shortenWindowId(last))}`;
    }
  } else {
    // Rule 5 fallback: section label + last segment (never an empty title).
    const segments = pathname.split('/').filter((segment) => segment !== '');
    const last = segments[segments.length - 1];
    if (last !== undefined && pathname !== '/app') {
      title = `${baseLabel} · ${last}`;
    }
  }

  // Rule 4 — known query suffixes only.
  if (search !== '') {
    const params = new URLSearchParams(search);
    const kind = params.get('kind');
    if (kind !== null && KNOWN_KIND_SUFFIX[kind] !== undefined) {
      title = `${title} · ${KNOWN_KIND_SUFFIX[kind]}`;
    }
    const type = params.get('type');
    if (type !== null && KNOWN_TYPE_SUFFIX[type] !== undefined) {
      title = `${title} · ${KNOWN_TYPE_SUFFIX[type]}`;
    }
  }

  return {
    module,
    title,
    tone: module,
    // `icon` is typed non-optional: every module has a section with an icon;
    // the workspace standalone section is always present.
    icon: icon ?? (sectionOfModule('workspace')?.icon as LucideIcon),
  };
}
