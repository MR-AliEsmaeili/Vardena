import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_KEYS,
  findCapabilityProblem,
  resolveCapabilities,
  type ItemCapabilities,
} from './item-capabilities.js';
import { ITEM_KIND_DEFAULTS, ITEM_KINDS, type ItemKind } from './item-kind.js';

/**
 * Item capability rules (D-25, master-data-strategy.md §3.2/§3.3).
 *
 * These are the only capability invariants in Task 6. Note in particular what
 * is NOT rejected: `isSellable` on a non-stockable item is legal, because §20
 * forbids enforcing a "sellable implies stockable" rule the domain has not
 * approved (a drop-shipped service line is sellable and never stocked).
 */

function caps(overrides: Partial<ItemCapabilities> = {}): ItemCapabilities {
  return { ...ITEM_KIND_DEFAULTS.goods, ...overrides };
}

describe('ITEM_KIND_DEFAULTS', () => {
  it('defines defaults for every kind in the closed list', () => {
    expect(Object.keys(ITEM_KIND_DEFAULTS).sort()).toEqual(
      [...ITEM_KINDS].sort(),
    );
  });

  it('makes a service non-stockable, non-valued, but bought and sold', () => {
    // Read directly off the §3.3 behaviour table.
    expect(ITEM_KIND_DEFAULTS.service).toEqual({
      isStockable: false,
      isPurchasable: true,
      isSellable: true,
      isValued: false,
      requiresLot: false,
      requiresSerial: false,
      requiresExpiry: false,
    });
  });

  it('makes a consumable stockable and valued but not sellable', () => {
    expect(ITEM_KIND_DEFAULTS.consumable).toMatchObject({
      isStockable: true,
      isValued: true,
      isSellable: false,
    });
  });

  it('makes an asset non-stockable: the asset register is out of scope', () => {
    expect(ITEM_KIND_DEFAULTS.asset).toMatchObject({
      isStockable: false,
      isValued: false,
    });
  });

  it('fails closed for the `other` kind', () => {
    // An unknown classification must not silently gain behaviour.
    expect(Object.values(ITEM_KIND_DEFAULTS.other).every((v) => v === false)).toBe(
      true,
    );
  });

  it('never enables lot/serial/expiry by default: §3.3 calls them per-item', () => {
    for (const kind of ITEM_KINDS as readonly ItemKind[]) {
      const defaults = ITEM_KIND_DEFAULTS[kind];
      expect(defaults.requiresLot, kind).toBe(false);
      expect(defaults.requiresSerial, kind).toBe(false);
      expect(defaults.requiresExpiry, kind).toBe(false);
    }
  });
});

describe('resolveCapabilities', () => {
  it('takes every flag from the kind when nothing is overridden', () => {
    expect(resolveCapabilities('service', {})).toEqual(
      ITEM_KIND_DEFAULTS.service,
    );
  });

  it('lets an explicit override win over the kind default', () => {
    expect(resolveCapabilities('service', { isStockable: true })).toMatchObject({
      isStockable: true,
      isSellable: true,
    });
  });

  it('treats an explicitly-undefined override as "not stated"', () => {
    // `exactOptionalPropertyTypes` makes this reachable: an omitted DTO field
    // arrives as `undefined`, and must not overwrite a kind default.
    expect(
      resolveCapabilities('goods', { isStockable: undefined, isValued: false }),
    ).toMatchObject({ isStockable: true, isValued: false });
  });

  it('ignores non-capability keys on the wider create input', () => {
    // Callers pass the whole create input; only capability keys may be read.
    const resolved = resolveCapabilities('goods', {
      code: 'RAW-CODE',
      name: 'Raw Name',
      baseUnitId: 'unit-1',
      isSellable: false,
    } as unknown as Partial<ItemCapabilities>);
    expect(resolved).not.toHaveProperty('code');
    expect(resolved).not.toHaveProperty('name');
    expect(resolved).not.toHaveProperty('baseUnitId');
    expect(resolved.isSellable).toBe(false);
  });

  it('exposes exactly the seven capability keys', () => {
    expect(CAPABILITY_KEYS).toHaveLength(7);
    expect(Object.keys(resolveCapabilities('goods', {})).sort()).toEqual(
      [...CAPABILITY_KEYS].sort(),
    );
  });
});

describe('findCapabilityProblem', () => {
  it('accepts the goods defaults', () => {
    expect(findCapabilityProblem(caps())).toBe(null);
  });

  it('accepts a sellable item that is not stockable (drop-ship/service line)', () => {
    // Deliberately NOT an invariant — master-data-strategy.md §20.
    expect(
      findCapabilityProblem(
        caps({ isStockable: false, isValued: false, isSellable: true }),
      ),
    ).toBe(null);
  });

  it('accepts a purchasable item that is not stockable', () => {
    expect(
      findCapabilityProblem(
        caps({
          isStockable: false,
          isValued: false,
          isSellable: false,
          isPurchasable: true,
        }),
      ),
    ).toBe(null);
  });

  it('rejects a valued item that is not stockable', () => {
    expect(
      findCapabilityProblem(caps({ isStockable: false, isValued: true })),
    ).toBe('valued_requires_stockable');
  });

  it.each([
    ['requiresLot', 'lot_requires_stockable'],
    ['requiresSerial', 'serial_requires_stockable'],
    ['requiresExpiry', 'expiry_requires_stockable'],
  ] as const)('rejects %s on a non-stockable item', (flag, expected) => {
    expect(
      findCapabilityProblem(
        caps({ isStockable: false, isValued: false, [flag]: true }),
      ),
    ).toBe(expected);
  });

  it('reports the valuation problem before the tracking ones', () => {
    expect(
      findCapabilityProblem(
        caps({
          isStockable: false,
          isValued: true,
          requiresLot: true,
        }),
      ),
    ).toBe('valued_requires_stockable');
  });

  it('accepts every tracking flag together on a stockable item', () => {
    expect(
      findCapabilityProblem(
        caps({ requiresLot: true, requiresSerial: true, requiresExpiry: true }),
      ),
    ).toBe(null);
  });
});
