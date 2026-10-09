import { describe, expect, it } from 'vitest';
import {
  toBusinessDate,
  type BusinessDate,
} from '../../../kernel/datetime/business-date.js';
import {
  buildRequestHash,
  canonicalClientBusinessDate,
} from './inventory-posting-support.js';

/**
 * Idempotency-hash determinism (ADR-0022, Task 9.6 finding: inventory
 * idempotency determinism defect; OQ-73: the date is now a business DAY).
 *
 * The request hash is the replay identity: two submissions of one logical
 * operation MUST hash identically, and any material difference in client
 * intent MUST change it. The regression these tests pin: a posting without a
 * client-supplied business date defaults the EFFECTIVE date to the server
 * clock on every attempt; that clock must never enter the hash, or a retried
 * request (the exact scenario idempotency keys exist for) hashes differently
 * and is rejected with 409 instead of replaying.
 *
 * `canonicalClientBusinessDate` hashes WHAT THE CLIENT SENT (OQ-73): the
 * canonical Gregorian day for day inputs, the equivalent Gregorian day for a
 * declared Jalali day (two spellings of one day hash identically), and the
 * legacy instant string verbatim for pre-OQ-73 clients. It never consults a
 * clock and never resolves "today".
 */
describe('canonicalClientBusinessDate', () => {
  it('turns an omitted date into an explicit null (never into now())', () => {
    expect(canonicalClientBusinessDate(undefined)).toBeNull();
  });

  it('hashes a canonical Gregorian day verbatim', () => {
    expect(canonicalClientBusinessDate('2026-03-01')).toBe('2026-03-01');
  });

  it('hashes a declared Jalali day as the same Gregorian day', () => {
    // 1404-12-10 (Jalali) IS 2026-03-01 (Gregorian): one business day,
    // one hash contribution, whatever the client's calendar system.
    expect(
      canonicalClientBusinessDate({ calendar: 'JALALI', value: '1404-12-10' }),
    ).toBe('2026-03-01');
    expect(
      canonicalClientBusinessDate({
        calendar: 'GREGORIAN',
        value: '2026-03-01',
      }),
    ).toBe('2026-03-01');
  });

  it('hashes a legacy ISO instant by its UTC calendar day', () => {
    // The local offset crosses back into the previous UTC day; compatibility
    // follows the stored/migrated UTC day, not the organization's zone.
    expect(canonicalClientBusinessDate('2026-03-01T00:30:00+03:30')).toBe(
      '2026-02-28',
    );
  });
});

describe('buildRequestHash — dateless retry determinism', () => {
  const payloadWithoutDate = {
    organizationId: '01ORGANIZATIONA000000000AA',
    warehouseId: '01WAREHOUSE0000000000001',
    itemId: '01ITEM00000000000000000001',
    movementType: 'inbound',
    quantity: '5',
    unitId: '01UNIT00000000000000000001',
    reason: null,
    referenceType: null,
    referenceId: null,
  };

  it('hashes two dateless attempts identically even across time', async () => {
    // Simulate the retry arriving after the server clock has moved: the
    // service builds the canonical payload once per attempt, each time with
    // movementDate omitted.
    const first = buildRequestHash('movement_post', {
      ...payloadWithoutDate,
      movementDate: canonicalClientBusinessDate(undefined),
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const retry = buildRequestHash('movement_post', {
      ...payloadWithoutDate,
      movementDate: canonicalClientBusinessDate(undefined),
    });

    expect(retry).toBe(first);
  });

  it('hashes two attempts with the same explicit business DAY identically', () => {
    const first = buildRequestHash('movement_post', {
      ...payloadWithoutDate,
      movementDate: canonicalClientBusinessDate('2026-03-01'),
    });
    const retry = buildRequestHash('movement_post', {
      ...payloadWithoutDate,
      movementDate: canonicalClientBusinessDate('2026-03-01'),
    });

    expect(retry).toBe(first);
  });

  it('hashes the Gregorian and the Jalali spelling of one day identically', () => {
    // 2026-03-01 and 1404-12-10 name the SAME business day: the hash must
    // not change with the client's calendar system.
    const gregorian = buildRequestHash('movement_post', {
      ...payloadWithoutDate,
      movementDate: canonicalClientBusinessDate('2026-03-01'),
    });
    const jalali = buildRequestHash('movement_post', {
      ...payloadWithoutDate,
      movementDate: canonicalClientBusinessDate({
        calendar: 'JALALI',
        value: '1404-12-10',
      }),
    });

    expect(jalali).toBe(gregorian);
  });

  it('distinguishes two different explicit business dates', () => {
    const march = buildRequestHash('movement_post', {
      ...payloadWithoutDate,
      movementDate: canonicalClientBusinessDate('2026-03-01'),
    });
    const april = buildRequestHash('movement_post', {
      ...payloadWithoutDate,
      movementDate: canonicalClientBusinessDate('2026-04-01'),
    });

    expect(april).not.toBe(march);
  });

  it('distinguishes an omitted date from a supplied date (different intent)', () => {
    const dateless = buildRequestHash('movement_post', {
      ...payloadWithoutDate,
      movementDate: canonicalClientBusinessDate(undefined),
    });
    const dated = buildRequestHash('movement_post', {
      ...payloadWithoutDate,
      movementDate: canonicalClientBusinessDate('2026-03-01'),
    });

    expect(dated).not.toBe(dateless);
  });

  it('changes the hash when any material client field changes', () => {
    const baseline = buildRequestHash('movement_post', {
      ...payloadWithoutDate,
      movementDate: canonicalClientBusinessDate(undefined),
    });
    const differentQuantity = buildRequestHash('movement_post', {
      ...payloadWithoutDate,
      quantity: '6',
      movementDate: canonicalClientBusinessDate(undefined),
    });
    const differentOperation = buildRequestHash('transfer_post', {
      ...payloadWithoutDate,
      movementDate: canonicalClientBusinessDate(undefined),
    });

    expect(differentQuantity).not.toBe(baseline);
    expect(differentOperation).not.toBe(baseline);
  });
});

import { resolveEnteredToBase } from './inventory-posting-support.js';
import type { UnitConversionsRepository } from '../data/unit-conversions.repository.js';
import type { UnitConversion } from '../domain/unit-conversion.js';

/**
 * Entered → base quantity resolution (D-21/D-26, ADR-0022).
 *
 * This is the conversion boundary every posting crosses: the exact decimal
 * product, the version in force on the BUSINESS DATE (a backdated posting
 * uses the backdated factor, never today's), item-specific precedence, and
 * the fail-closed rules — no conversion means rejection, never an invented
 * 1:1; a product that does not fit `numeric(18,4)` exactly is rejected, never
 * rounded (OQ-29 stays open; rounding mode is *not* chosen here).
 */
describe('resolveEnteredToBase', () => {
  const ORG = '01ORGANIZATIONA000000000AA';
  const ITEM = '01ITEM00000000000000000001';
  const PCS = '01UNITPCSA0000000000000000';
  const BOX = '01UNITBOXA0000000000000000';
  const JAN = toBusinessDate('2026-01-01')!;
  const FEB = toBusinessDate('2026-02-01')!;

  let seq = 0;
  function conversion(parts: Partial<UnitConversion>): UnitConversion {
    seq += 1;
    return {
      id: `01CV${String(seq).padStart(24, '0')}`,
      organizationId: ORG,
      itemId: null,
      fromUnitId: BOX,
      toUnitId: PCS,
      factor: '12',
      validFrom: JAN,
      validTo: null,
      ...parts,
    } as UnitConversion;
  }

  function conversionsStub(rows: UnitConversion[]): UnitConversionsRepository {
    return {
      findItemVersions: async (itemId: string, from: string, to: string) =>
        rows.filter(
          (row) =>
            row.itemId === itemId &&
            row.fromUnitId === from &&
            row.toUnitId === to,
        ),
      findGlobalVersions: async (orgId: string, from: string, to: string) =>
        rows.filter(
          (row) =>
            row.itemId === null &&
            row.organizationId === orgId &&
            row.fromUnitId === from &&
            row.toUnitId === to,
        ),
    } as unknown as UnitConversionsRepository;
  }

  interface ResolveOverrides {
    organizationId?: string;
    itemId?: string;
    baseUnitId?: string;
    unitId?: string;
    quantity?: string;
    asOf?: BusinessDate;
  }

  function resolveWith(
    rows: UnitConversion[],
    overrides: ResolveOverrides = {},
  ): ReturnType<typeof resolveEnteredToBase> {
    return resolveEnteredToBase({
      conversions: conversionsStub(rows),
      organizationId: ORG,
      itemId: ITEM,
      baseUnitId: PCS,
      unitId: BOX,
      quantity: '2',
      asOf: FEB,
      ...overrides,
    });
  }

  it('short-circuits same-unit postings with an exact factor of 1', async () => {
    // Must not even look conversions up — the stub would resolve nothing.
    const resolved = await resolveWith([], { unitId: PCS });
    expect(resolved).toEqual({
      quantity: '2',
      baseQuantity: '2',
      conversionFactor: '1',
    });
  });

  it('resolves the exact decimal product and canonicalizes, never floats', async () => {
    const resolved = await resolveWith([
      conversion({ factor: '2.5', validFrom: JAN }),
    ]);
    expect(resolved).toEqual({
      quantity: '2',
      baseQuantity: '5',
      conversionFactor: '2.5',
    });

    const small = await resolveWith([conversion({})], {
      quantity: '0.0001',
    });
    expect(small.baseQuantity).toBe('0.0012');
  });

  it('prefers the item-specific version over the global one', async () => {
    const resolved = await resolveWith([
      conversion({ factor: '12' }),
      conversion({ itemId: ITEM, factor: '6' }),
    ]);
    expect(resolved.conversionFactor).toBe('6');
  });

  it('falls back to the global version when the item has none', async () => {
    const resolved = await resolveWith([conversion({ factor: '12' })]);
    expect(resolved.conversionFactor).toBe('12');
  });

  it("a backdated posting resolves the backdated factor (D-21), never today's", async () => {
    // Version 1 [JAN, FEB): 12; version 2 [FEB, ∞): 24 (the planned state).
    const resolved = await resolveWith(
      [
        conversion({ factor: '12', validFrom: JAN, validTo: FEB }),
        conversion({ factor: '24', validFrom: FEB, validTo: null }),
      ],
      { asOf: toBusinessDate('2026-01-20')! },
    );
    expect(resolved.conversionFactor).toBe('12');
    expect(resolved.baseQuantity).toBe('24');

    // …and today resolves the current factor.
    const today = await resolveWith(
      [
        conversion({ factor: '12', validFrom: JAN, validTo: FEB }),
        conversion({ factor: '24', validFrom: FEB, validTo: null }),
      ],
      { asOf: FEB },
    );
    expect(today.conversionFactor).toBe('24');
  });

  it('rejects a posting with no covering conversion — an explicit rule, never an invented 1:1', async () => {
    await expect(resolveWith([])).rejects.toMatchObject({
      code: 'BusinessRuleViolation',
      message: expect.stringContaining('No unit conversion'),
    });

    // A conversion in the REVERSE direction does not rescue the posting:
    // deriving it would divide, and division needs a rounding rule OQ-29 has
    // not approved.
    await expect(
      resolveWith([conversion({ fromUnitId: PCS, toUnitId: BOX })]),
    ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });
  });

  it('rejects a product that does not fit numeric(18,4) exactly, rather than rounding', async () => {
    // 1/3 is representable as a factor exactly; the PRODUCT of 0.333333×1
    // fits, but 0.333333×100 = 33.333300 fits too — the failing case needs
    // more than 4 dp: factor 0.142857×2 = 0.285714 → 6 dp, rejected.
    await expect(
      resolveWith([conversion({ factor: '0.142857' })]),
    ).rejects.toMatchObject({
      code: 'BusinessRuleViolation',
      message: expect.stringContaining('more than 4 decimal places'),
    });
  });

  it('rejects malformed or non-positive entered quantities as client errors', async () => {
    for (const quantity of ['abc', '', '1x', '0', '-5', '10.00001']) {
      await expect(
        resolveWith([conversion({})], { quantity }),
        quantity,
      ).rejects.toMatchObject({ code: 'BadRequest' });
    }
  });
});
