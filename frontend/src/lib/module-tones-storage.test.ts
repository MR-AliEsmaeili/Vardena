/**
 * module-tones-storage — the versioned localStorage record (§6.10·ب),
 * fail-closed to the DEFAULTS for the whole record.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODULE_TONES,
  MODULE_IDS,
  type ModuleToneMap,
} from './module-tones';
import {
  MODULE_TONES_STORAGE_KEY,
  parseModuleTonesRaw,
  persistModuleTones,
  readModuleTones,
  serializeModuleTones,
} from './module-tones-storage';

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    map,
  };
}

const SWAPPED: ModuleToneMap = {
  ...DEFAULT_MODULE_TONES,
  workspace: 'admin',
  admin: 'workspace',
};

describe('readModuleTones', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(readModuleTones(fakeStorage())).toEqual(DEFAULT_MODULE_TONES);
    expect(readModuleTones(null)).toEqual(DEFAULT_MODULE_TONES);
  });

  it('returns the defaults on corrupt JSON or a wrong version', () => {
    expect(
      readModuleTones(fakeStorage({ [MODULE_TONES_STORAGE_KEY]: '{broken' })),
    ).toEqual(DEFAULT_MODULE_TONES);
    expect(
      readModuleTones(
        fakeStorage({
          [MODULE_TONES_STORAGE_KEY]: JSON.stringify({
            version: 2,
            tones: SWAPPED,
          }),
        }),
      ),
    ).toEqual(DEFAULT_MODULE_TONES);
    expect(
      readModuleTones(
        fakeStorage({ [MODULE_TONES_STORAGE_KEY]: '"nonsense"' }),
      ),
    ).toEqual(DEFAULT_MODULE_TONES);
  });

  it('returns the defaults when the tones record is invalid', () => {
    expect(
      readModuleTones(
        fakeStorage({
          [MODULE_TONES_STORAGE_KEY]: JSON.stringify({
            version: 1,
            tones: { ...SWAPPED, accounting: 'inventory' }, // duplicate tone
          }),
        }),
      ),
    ).toEqual(DEFAULT_MODULE_TONES);
    const partial = { ...DEFAULT_MODULE_TONES } as Record<string, string>;
    delete partial.admin;
    expect(
      readModuleTones(
        fakeStorage({
          [MODULE_TONES_STORAGE_KEY]: JSON.stringify({
            version: 1,
            tones: partial,
          }),
        }),
      ),
    ).toEqual(DEFAULT_MODULE_TONES);
  });

  it('survives a throwing storage (private mode)', () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(readModuleTones(throwing)).toEqual(DEFAULT_MODULE_TONES);
    expect(() => persistModuleTones(SWAPPED, throwing)).not.toThrow();
  });
});

describe('persist / read round-trip', () => {
  it('stores the versioned record and reads it back exactly', () => {
    const storage = fakeStorage();
    persistModuleTones(SWAPPED, storage);
    expect(storage.map.size).toBe(1);
    expect(readModuleTones(storage)).toEqual(SWAPPED);
    // Exactly six pairs, no duplicates (W-17).
    const tones = readModuleTones(storage);
    expect(new Set(MODULE_IDS.map((id) => tones[id])).size).toBe(
      MODULE_IDS.length,
    );
  });

  it('serialize/parse mirror the stored shape', () => {
    const raw = serializeModuleTones(SWAPPED);
    expect(JSON.parse(raw)).toEqual({ version: 1, tones: SWAPPED });
    expect(parseModuleTonesRaw(raw)).toEqual(SWAPPED);
    expect(parseModuleTonesRaw(null)).toEqual(DEFAULT_MODULE_TONES);
    expect(parseModuleTonesRaw('{')).toEqual(DEFAULT_MODULE_TONES);
  });
});
