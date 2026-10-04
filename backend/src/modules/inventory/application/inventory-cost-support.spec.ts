import { describe, expect, it } from 'vitest';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { resolveEnteredCost } from './inventory-cost-support.js';
import {
  toInventoryMovementDto,
  type InventoryMovement,
} from '../domain/inventory-movement.js';

/**
 * Cost input on a warehouse posting, and the redaction that makes money a
 * separate authority from quantity.
 *
 * The headline requirement of this slice is negative: a receipt or an issue
 * must POST without any monetary field. The first test is therefore the most
 * important one in the file.
 */

function issue(code: () => unknown): AppException {
  try {
    code();
  } catch (error) {
    if (error instanceof AppException) return error;
    throw error;
  }
  throw new Error('Expected an AppException.');
}

describe('resolveEnteredCost', () => {
  it('accepts a receipt with NO cost at all', () => {
    expect(
      resolveEnteredCost({
        input: {},
        movementType: 'inbound',
        quantity: '10',
      }),
    ).toBeNull();
  });

  it('treats empty strings as "not supplied", not as a malformed amount', () => {
    expect(
      resolveEnteredCost({
        input: { unitCost: '', totalCost: undefined },
        movementType: 'inbound',
        quantity: '10',
      }),
    ).toBeNull();
  });

  it('accepts an exact total cost', () => {
    expect(
      resolveEnteredCost({
        input: { totalCost: '1250.50' },
        movementType: 'inbound',
        quantity: '10',
      }),
    ).toBe('1250.5');
  });

  it('multiplies a unit cost by the ENTERED quantity, exactly', () => {
    expect(
      resolveEnteredCost({
        input: { unitCost: '12.25' },
        movementType: 'inbound',
        quantity: '4',
      }),
    ).toBe('49');
  });

  it('refuses both amounts at once rather than picking a winner', () => {
    const error = issue(() =>
      resolveEnteredCost({
        input: { unitCost: '10.00', totalCost: '100.00' },
        movementType: 'inbound',
        quantity: '10',
      }),
    );
    expect(error.getStatus()).toBe(400);
  });

  it('refuses a cost on an ISSUE: outbound value comes from the method', () => {
    const error = issue(() =>
      resolveEnteredCost({
        input: { totalCost: '100.00' },
        movementType: 'outbound',
        quantity: '10',
      }),
    );
    expect(error.getStatus()).toBe(400);
  });

  it('refuses a cost on a transfer leg and on a reversal', () => {
    for (const movementType of ['transfer_out', 'reversal_in'] as const) {
      expect(() =>
        resolveEnteredCost({
          input: { totalCost: '100.00' },
          movementType,
          quantity: '10',
        }),
      ).toThrow(AppException);
    }
  });

  it('rejects an amount that would need rounding instead of rounding it', () => {
    expect(() =>
      resolveEnteredCost({
        input: { totalCost: '100.005' },
        movementType: 'inbound',
        quantity: '1',
      }),
    ).toThrow(AppException);

    // unitCost x quantity must ALSO land exactly on the money scale.
    expect(() =>
      resolveEnteredCost({
        input: { unitCost: '0.33' },
        movementType: 'inbound',
        quantity: '0.3333',
      }),
    ).toThrow(AppException);
  });

  it('rejects a non-positive cost', () => {
    expect(() =>
      resolveEnteredCost({
        input: { totalCost: '0' },
        movementType: 'inbound',
        quantity: '1',
      }),
    ).toThrow(AppException);
  });
});

describe('toInventoryMovementDto — value is permission-gated', () => {
  const movement: InventoryMovement = {
    id: 'm1',
    organizationId: 'org-1',
    branchId: 'branch-1',
    warehouseId: 'wh-1',
    itemId: 'item-1',
    movementType: 'inbound',
    quantity: '10',
    enteredUnitId: 'unit-1',
    baseQuantity: '10',
    baseUnitId: 'unit-1',
    conversionFactor: '1',
    movementDate: new Date('2026-03-01T00:00:00.000Z'),
    transferId: null,
    reversalOfMovementId: null,
    referenceType: null,
    referenceId: null,
    reason: null,
    operationKey: 'op-1',
    totalCost: '1000',
    valuationStatus: 'valued',
    valuationSource: 'entered',
    valuedAt: new Date('2026-03-01T00:00:00.000Z'),
    valuationRunId: null,
    createdAt: new Date('2026-03-01T00:00:00.000Z'),
    updatedAt: new Date('2026-03-01T00:00:00.000Z'),
  };

  it('shows the value to a caller allowed to see it', () => {
    const dto = toInventoryMovementDto(movement, true);
    expect(dto.totalCost).toBe('1000');
    expect(dto.valuationSource).toBe('entered');
  });

  it('blanks the money for a caller who may not, keeping the SAME shape', () => {
    const dto = toInventoryMovementDto(movement, false);

    expect(dto.totalCost).toBeNull();
    expect(dto.valuationSource).toBeNull();
    expect(dto.valuationRunId).toBeNull();
    // The quantity record is untouched: a warehouse operator still sees the
    // whole physical fact, and the response shape never changes.
    expect(dto.baseQuantity).toBe('10');
    expect(Object.keys(dto)).toEqual(
      Object.keys(toInventoryMovementDto(movement, true)),
    );
    // The FINALITY marker is not money and stays visible: "this receipt has
    // no cost yet" is operational information.
    expect(dto.valuationStatus).toBe('valued');
  });
});
