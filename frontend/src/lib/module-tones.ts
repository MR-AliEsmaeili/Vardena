/**
 * Module → tone assignment (D-3, spec §6.10·ب, FDR-01 §3.2).
 *
 * Every module owns a DISTINCT tone and the user may re-assign the six
 * approved tones between the six modules from the profile settings. The
 * customisation is deliberately NOT a colour picker:
 *
 *  - the only values are the existing `NavTone` names; raw hex/rgb never
 *    appear in JS (the design-token guard keeps rejecting them);
 *  - the assignment is a BIJECTION — selecting a tone held by another module
 *    SWAPS the two, so "no two modules share a tone" is structurally
 *    impossible to violate (W-17);
 *  - application is pure `var()` indirection on the document root, so both
 *    themes follow automatically and the enumerated Tailwind class maps
 *    (`NAV_TONE_TILE`, the dock tab map) stay untouched.
 *
 * Persistence lives in `module-tones-storage.ts` (versioned, fail-closed);
 * the pre-paint script in `index.html` mirrors the application step so the
 * first frame never shows the default mapping before hydrating.
 */

import type { NavTone } from '@/ui/nav-glyph';

export type ModuleId = NavTone;

export const MODULE_IDS: readonly ModuleId[] = [
  'workspace',
  'accounting',
  'inventory',
  'organization',
  'licensing',
  'admin',
];

/** Module → tone; exactly six pairs, no tone used twice. */
export type ModuleToneMap = Record<ModuleId, NavTone>;

/** The shipped default: every module wears its own named tone. */
export const DEFAULT_MODULE_TONES: ModuleToneMap = {
  workspace: 'workspace',
  accounting: 'accounting',
  inventory: 'inventory',
  organization: 'organization',
  licensing: 'licensing',
  admin: 'admin',
};

const TONE_PARTS = ['soft', 'line', 'ink', 'strong'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Fail-closed validator: anything but a complete, allowlisted, duplicate-free
 * assignment returns the DEFAULTS for the WHOLE record (never partially).
 */
export function parseModuleToneMap(value: unknown): ModuleToneMap {
  if (!isRecord(value)) return { ...DEFAULT_MODULE_TONES };
  const seen = new Set<string>();
  const result = {} as ModuleToneMap;
  for (const moduleId of MODULE_IDS) {
    const tone = value[moduleId];
    if (typeof tone !== 'string') return { ...DEFAULT_MODULE_TONES };
    if (!(MODULE_IDS as readonly string[]).includes(tone)) {
      return { ...DEFAULT_MODULE_TONES };
    }
    if (seen.has(tone)) return { ...DEFAULT_MODULE_TONES };
    seen.add(tone);
    result[moduleId] = tone as NavTone;
  }
  // Exactly six keys — extra keys invalidate the record.
  if (Object.keys(value).length !== MODULE_IDS.length) {
    return { ...DEFAULT_MODULE_TONES };
  }
  return result;
}

/**
 * The assignment-grid move: choosing a tone that another module holds swaps
 * the two modules; choosing the tone the module already has is a no-op.
 * The result is always a valid bijection.
 */
export function swapModuleTone(
  map: ModuleToneMap,
  moduleId: ModuleId,
  tone: NavTone,
): ModuleToneMap {
  if (map[moduleId] === tone) return map;
  const holder = (Object.keys(map) as ModuleId[]).find(
    (key) => map[key] === tone,
  );
  const next: ModuleToneMap = { ...map, [moduleId]: tone };
  if (holder !== undefined && holder !== moduleId) {
    next[holder] = map[moduleId];
  }
  return next;
}

export interface ToneRootLike {
  style: {
    setProperty(name: string, value: string): void;
    removeProperty(name: string): void;
  };
}

/**
 * Apply the assignment with `var()` indirection (spec §6.10·ب): a module
 * wearing its own tone removes the override (falls back to the stylesheet
 * alias → its own source); a module wearing another tone points its four
 * variables at that tone's SOURCE variables, so light/dark both follow with
 * no hex in JS.
 *
 * Cycle-safety (deviation from the spec's literal snippet, per FDR-01 which
 * outranks it): the indirection targets `--color-tone-src-*` — the palette
 * layer that is never itself remapped. Pointing module variables at OTHER
 * MODULE variables, as the snippet shows, makes a swap (A wears B while B
 * wears A) a circular `var()` reference: both are invalid at computed-value
 * time and the colours collapse. The src layer makes every permutation
 * resolvable while keeping the snippet's shape, both-theme behaviour and
 * no-hex-in-JS rule intact.
 */
export function applyModuleTones(
  map: ModuleToneMap,
  root: ToneRootLike | null = typeof document === 'undefined'
    ? null
    : document.documentElement,
): void {
  if (root === null) return;
  for (const moduleId of MODULE_IDS) {
    const tone = map[moduleId];
    for (const part of TONE_PARTS) {
      const moduleName = `--color-tone-${moduleId}-${part}`;
      if (tone === moduleId) {
        root.style.removeProperty(moduleName);
      } else {
        root.style.setProperty(
          moduleName,
          `var(--color-tone-src-${tone}-${part})`,
        );
      }
    }
  }
}
