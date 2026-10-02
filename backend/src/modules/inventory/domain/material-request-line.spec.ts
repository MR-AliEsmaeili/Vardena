import { describe, expect, it } from 'vitest';
import {
  toMaterialRequestLineDto,
  type MaterialRequestLine,
} from './material-request-line.js';

function baseLine(
  overrides: Partial<MaterialRequestLine> = {},
): MaterialRequestLine {
  return {
    id: 'line-1',
    materialRequestId: 'mr-1',
    organizationId: 'org-1',
    branchId: 'branch-1',
    lineNumber: 1,
    itemId: 'item-1',
    warehouseId: 'warehouse-1',
    quantity: '10',
    unitId: 'unit-1',
    baseQuantity: '10',
    baseUnitId: 'unit-1',
    conversionFactor: '1',
    reservationRequested: false,
    reservationId: null,
    invokedBaseQuantity: '0',
    invocationCount: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('toMaterialRequestLineDto', () => {
  it('embeds the read-time invocation summary passed in, never derives it itself', () => {
    const line = baseLine({ baseQuantity: '10' });
    const dto = toMaterialRequestLineDto(line, {
      invokedBaseQuantity: '4',
      remainingBaseQuantity: '6',
      invocationCount: 2,
    });
    expect(dto.invokedBaseQuantity).toBe('4');
    expect(dto.remainingBaseQuantity).toBe('6');
    expect(dto.invocationCount).toBe(2);
  });

  it('reports a never-invoked line as fully remaining', () => {
    const line = baseLine({ baseQuantity: '7' });
    const dto = toMaterialRequestLineDto(line, {
      invokedBaseQuantity: '0',
      remainingBaseQuantity: '7',
      invocationCount: 0,
    });
    expect(dto.invokedBaseQuantity).toBe('0');
    expect(dto.remainingBaseQuantity).toBe('7');
    expect(dto.invocationCount).toBe(0);
  });

  it('passes reservationId through as null until a reservation is created', () => {
    const line = baseLine({ reservationRequested: true, reservationId: null });
    const dto = toMaterialRequestLineDto(line, {
      invokedBaseQuantity: '0',
      remainingBaseQuantity: '10',
      invocationCount: 0,
    });
    expect(dto.reservationRequested).toBe(true);
    expect(dto.reservationId).toBeNull();
  });

  it('serializes dates to ISO strings', () => {
    const dto = toMaterialRequestLineDto(baseLine(), {
      invokedBaseQuantity: '0',
      remainingBaseQuantity: '10',
      invocationCount: 0,
    });
    expect(dto.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(dto.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});
