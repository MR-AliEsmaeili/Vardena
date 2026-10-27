/**
 * module-tones — the D-3 assignment algebra (bijection validator, swap) and
 * the cycle-safe `var()` application. §10 rule: «tones تکراری → پیش‌فرض‌ها
 * (کل رکورد)» and the swap property «هیچ دو ماژولی در هیچ زمانی tone یکسان
 * ندارند» (W-17).
 */

import { describe, expect, it } from 'vitest';
import {
  applyModuleTones,
  DEFAULT_MODULE_TONES,
  MODULE_IDS,
  parseModuleToneMap,
  swapModuleTone,
  type ModuleToneMap,
} from './module-tones';
import { MODULE_TONES_STORAGE_KEY } from './module-tones-storage';

function isBijection(map: ModuleToneMap): boolean {
  const values = MODULE_IDS.map((id) => map[id]);
  return new Set(values).size === MODULE_IDS.length;
}

describe('storage key contract (standards §15 whitelist)', () => {
  it('is exactly the one versioned localStorage key', () => {
    expect(MODULE_TONES_STORAGE_KEY).toBe('vardena:module-tones:v1');
  });
});

describe('DEFAULT_MODULE_TONES', () => {
  it('gives every module its own distinct tone (D-3)', () => {
    expect(isBijection(DEFAULT_MODULE_TONES)).toBe(true);
    for (const id of MODULE_IDS) {
      expect(DEFAULT_MODULE_TONES[id]).toBe(id);
    }
  });
});

describe('parseModuleToneMap — fail closed to the WHOLE default record', () => {
  it('accepts a complete, duplicate-free assignment', () => {
    const swapped: ModuleToneMap = {
      ...DEFAULT_MODULE_TONES,
      accounting: 'inventory',
      inventory: 'accounting',
    };
    expect(parseModuleToneMap(swapped)).toEqual(swapped);
  });

  it('rejects non-objects', () => {
    for (const bad of [null, undefined, 42, 'x', [], true]) {
      expect(parseModuleToneMap(bad)).toEqual(DEFAULT_MODULE_TONES);
    }
  });

  it('rejects a record with a tone outside the allowlist (whole record)', () => {
    expect(
      parseModuleToneMap({
        ...DEFAULT_MODULE_TONES,
        admin: 'hotpink',
      }),
    ).toEqual(DEFAULT_MODULE_TONES);
  });

  it('rejects duplicate tones (whole record, W-17)', () => {
    expect(
      parseModuleToneMap({
        ...DEFAULT_MODULE_TONES,
        accounting: 'inventory', // inventory kept by both
      }),
    ).toEqual(DEFAULT_MODULE_TONES);
  });

  it('rejects incomplete records (not exactly six keys)', () => {
    const { admin: _dropped, ...rest } = DEFAULT_MODULE_TONES;
    expect(parseModuleToneMap(rest)).toEqual(DEFAULT_MODULE_TONES);
    expect(
      parseModuleToneMap({ ...DEFAULT_MODULE_TONES, extra: 'workspace' }),
    ).toEqual(DEFAULT_MODULE_TONES);
  });

  it('rejects non-string tone values', () => {
    expect(
      parseModuleToneMap({ ...DEFAULT_MODULE_TONES, licensing: 7 }),
    ).toEqual(DEFAULT_MODULE_TONES);
  });
});

describe('swapModuleTone — the assignment-grid move', () => {
  it('choosing a free tone is a plain assignment', () => {
    // accounting already owns 'accounting'; moving admin to 'accounting'
    // swaps admin and accounting.
    const next = swapModuleTone(DEFAULT_MODULE_TONES, 'admin', 'accounting');
    expect(next.admin).toBe('accounting');
    expect(next.accounting).toBe('admin');
    expect(isBijection(next)).toBe(true);
  });

  it('choosing the tone a module already has is a no-op (same reference)', () => {
    expect(swapModuleTone(DEFAULT_MODULE_TONES, 'admin', 'admin')).toBe(
      DEFAULT_MODULE_TONES,
    );
  });

  it('never mutates the input map', () => {
    const before = { ...DEFAULT_MODULE_TONES };
    swapModuleTone(DEFAULT_MODULE_TONES, 'workspace', 'licensing');
    expect(DEFAULT_MODULE_TONES).toEqual(before);
  });

  it('exhaustive property: every module×tone choice preserves the bijection', () => {
    for (const moduleId of MODULE_IDS) {
      for (const tone of MODULE_IDS) {
        const next = swapModuleTone(DEFAULT_MODULE_TONES, moduleId, tone);
        expect(next[moduleId]).toBe(tone);
        expect(isBijection(next)).toBe(true);
      }
    }
  });

  it('a swapped pair applied twice returns to the default', () => {
    const once = swapModuleTone(DEFAULT_MODULE_TONES, 'admin', 'accounting');
    const twice = swapModuleTone(once, 'admin', 'admin');
    expect(twice).toEqual(DEFAULT_MODULE_TONES);
  });
});

function fakeRoot() {
  const set = new Map<string, string>();
  const removed: string[] = [];
  return {
    set,
    removed,
    style: {
      setProperty: (name: string, value: string) => {
        set.set(name, value);
      },
      removeProperty: (name: string) => {
        set.delete(name);
        removed.push(name);
      },
    },
  };
}

describe('applyModuleTones — cycle-safe var() indirection (§6.10·ب)', () => {
  it('identity assignment removes the overrides (stylesheet defaults apply)', () => {
    const root = fakeRoot();
    applyModuleTones(DEFAULT_MODULE_TONES, root);
    expect(root.set.size).toBe(0);
    expect(root.removed.length).toBe(MODULE_IDS.length * 4);
  });

  it('reassignment points module variables at the SOURCE palette variables', () => {
    const root = fakeRoot();
    applyModuleTones(
      { ...DEFAULT_MODULE_TONES, accounting: 'inventory' },
      root,
    );
    for (const part of ['soft', 'line', 'ink', 'strong']) {
      expect(root.set.get(`--color-tone-accounting-${part}`)).toBe(
        `var(--color-tone-src-inventory-${part})`,
      );
    }
    // The other modules keep their stylesheet defaults.
    expect(root.set.has('--color-tone-admin-soft')).toBe(false);
    expect(root.removed).toContain('--color-tone-admin-soft');
  });

  it('a full swap references only -src- variables — no circular var() chain', () => {
    const root = fakeRoot();
    const swapped: ModuleToneMap = {
      ...DEFAULT_MODULE_TONES,
      accounting: 'inventory',
      inventory: 'accounting',
    };
    applyModuleTones(swapped, root);
    for (const value of root.set.values()) {
      expect(value).toMatch(
        /^var\(--color-tone-src-[a-z]+-(soft|line|ink|strong)\)$/,
      );
      // The target of an override is never another overridden variable.
      const target = value.slice('var('.length, -1);
      expect(root.set.has(target)).toBe(false);
    }
    expect(root.set.get('--color-tone-accounting-soft')).toBe(
      'var(--color-tone-src-inventory-soft)',
    );
    expect(root.set.get('--color-tone-inventory-soft')).toBe(
      'var(--color-tone-src-accounting-soft)',
    );
  });

  it('a 3-cycle permutation is also acyclic', () => {
    const root = fakeRoot();
    applyModuleTones(
      {
        ...DEFAULT_MODULE_TONES,
        accounting: 'inventory',
        inventory: 'organization',
        organization: 'accounting',
      },
      root,
    );
    for (const value of root.set.values()) {
      expect(value.startsWith('var(--color-tone-src-')).toBe(true);
    }
  });

  it('tolerates a missing document root', () => {
    expect(() => applyModuleTones(DEFAULT_MODULE_TONES, null)).not.toThrow();
  });
});
