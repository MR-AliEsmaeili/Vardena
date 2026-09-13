import { describe, expect, it } from 'vitest';
import {
  buildRequestHash,
  canonicalClientDate,
} from './inventory-posting-support.js';

/**
 * Idempotency-hash determinism (ADR-0022, Task 9.6 finding: inventory
 * idempotency determinism defect).
 *
 * The request hash is the replay identity: two submissions of one logical
 * operation MUST hash identically, and any material difference in client
 * intent MUST change it. The regression these tests pin: a posting without a
 * client-supplied business date defaults the EFFECTIVE date to the server
 * clock on every attempt; that clock must never enter the hash, or a retried
 * request (the exact scenario idempotency keys exist for) hashes differently
 * and is rejected with 409 instead of replaying.
 */
describe('canonicalClientDate', () => {
  it('turns an omitted date into an explicit null (never into now())', () => {
    expect(canonicalClientDate(undefined)).toBeNull();
  });

  it('renders a supplied date as its stable ISO instant', () => {
    const date = new Date('2026-03-01T08:30:00.000Z');
    expect(canonicalClientDate(date)).toBe('2026-03-01T08:30:00.000Z');
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
      movementDate: canonicalClientDate(undefined),
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const retry = buildRequestHash('movement_post', {
      ...payloadWithoutDate,
      movementDate: canonicalClientDate(undefined),
    });

    expect(retry).toBe(first);
  });

  it('hashes two attempts with the same explicit business date identically', () => {
    const date = new Date('2026-03-01T00:00:00.000Z');
    const first = buildRequestHash('movement_post', {
      ...payloadWithoutDate,
      movementDate: canonicalClientDate(date),
    });
    const retry = buildRequestHash('movement_post', {
      ...payloadWithoutDate,
      movementDate: canonicalClientDate(new Date(date.getTime())),
    });

    expect(retry).toBe(first);
  });

  it('distinguishes two different explicit business dates', () => {
    const march = buildRequestHash('movement_post', {
      ...payloadWithoutDate,
      movementDate: canonicalClientDate(new Date('2026-03-01T00:00:00.000Z')),
    });
    const april = buildRequestHash('movement_post', {
      ...payloadWithoutDate,
      movementDate: canonicalClientDate(new Date('2026-04-01T00:00:00.000Z')),
    });

    expect(april).not.toBe(march);
  });

  it('distinguishes an omitted date from a supplied date (different intent)', () => {
    const dateless = buildRequestHash('movement_post', {
      ...payloadWithoutDate,
      movementDate: canonicalClientDate(undefined),
    });
    const dated = buildRequestHash('movement_post', {
      ...payloadWithoutDate,
      movementDate: canonicalClientDate(new Date('2026-03-01T00:00:00.000Z')),
    });

    expect(dated).not.toBe(dateless);
  });

  it('changes the hash when any material client field changes', () => {
    const baseline = buildRequestHash('movement_post', {
      ...payloadWithoutDate,
      movementDate: canonicalClientDate(undefined),
    });
    const differentQuantity = buildRequestHash('movement_post', {
      ...payloadWithoutDate,
      quantity: '6',
      movementDate: canonicalClientDate(undefined),
    });
    const differentOperation = buildRequestHash('transfer_post', {
      ...payloadWithoutDate,
      movementDate: canonicalClientDate(undefined),
    });

    expect(differentQuantity).not.toBe(baseline);
    expect(differentOperation).not.toBe(baseline);
  });
});
