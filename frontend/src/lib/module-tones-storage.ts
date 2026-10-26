/**
 * Persistence of the module-tone assignment (D-3, spec §6.10·ب).
 *
 * ONE versioned key in `localStorage` — whitelisted by name in
 * `docs/frontend/standards.md` §15 and guarded by `module-tones.test.ts` so
 * the whitelist cannot widen silently:
 *
 *   `vardena:module-tones:v1` → `{ version: 1, tones: {…six pairs…} }`
 *
 * Device-local by decision: Q-1 in FDR-01 keeps per-user backend sync for
 * the ADR-0013 Customization module (phase 4); if that lands, this key is
 * REMOVED, not migrated. No form values, business data or tokens are ever
 * stored here (W-08).
 */

import {
  DEFAULT_MODULE_TONES,
  parseModuleToneMap,
  type ModuleToneMap,
} from './module-tones';

export const MODULE_TONES_STORAGE_KEY = 'vardena:module-tones:v1';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function localStore(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Fail-closed read: `version !== 1`, corrupt JSON, an unknown module/tone,
 * duplicate tones or an incomplete record all fall back to the DEFAULTS for
 * the whole record (never partially).
 */
export function readModuleTones(
  storage: StorageLike | null = localStore(),
): ModuleToneMap {
  if (storage === null) return { ...DEFAULT_MODULE_TONES };
  let raw: string | null = null;
  try {
    raw = storage.getItem(MODULE_TONES_STORAGE_KEY);
  } catch {
    return { ...DEFAULT_MODULE_TONES };
  }
  if (raw === null) return { ...DEFAULT_MODULE_TONES };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_MODULE_TONES };
  }
  if (!isRecord(parsed) || parsed.version !== 1) {
    return { ...DEFAULT_MODULE_TONES };
  }
  return parseModuleToneMap(parsed.tones);
}

/** Best-effort write (quota / private mode never break the page). */
export function persistModuleTones(
  map: ModuleToneMap,
  storage: StorageLike | null = localStore(),
): void {
  if (storage === null) return;
  try {
    storage.setItem(
      MODULE_TONES_STORAGE_KEY,
      JSON.stringify({ version: 1, tones: map }),
    );
  } catch {
    // Device-local preference is best-effort (the `appearance.ts` pattern).
  }
}

export function serializeModuleTones(map: ModuleToneMap): string {
  return JSON.stringify({ version: 1, tones: map });
}

/** The same validation the `index.html` pre-paint script performs. */
export function parseModuleTonesRaw(raw: string | null): ModuleToneMap {
  if (raw === null) return { ...DEFAULT_MODULE_TONES };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_MODULE_TONES };
  }
  if (!isRecord(parsed) || parsed.version !== 1) {
    return { ...DEFAULT_MODULE_TONES };
  }
  return parseModuleToneMap(parsed.tones);
}
