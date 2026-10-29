import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/errors';
import { t } from '@/lib/i18n';
import {
  ACTIVE_VALUATION_METHODS,
  isValuationMethodImplemented,
  VALUATION_METHODS,
  valuationMethodErrorMessage,
  valuationMethodLabel,
} from './valuation-method-error-messages';

describe('valuation-method vocabulary & implementation status', () => {
  it('exposes all four architectural methods and marks only moving_weighted_average as implemented', () => {
    expect(VALUATION_METHODS).toEqual([
      'moving_weighted_average',
      'fifo',
      'lifo',
      'specific_identification',
    ]);
    expect(ACTIVE_VALUATION_METHODS).toEqual(['moving_weighted_average']);
    expect(isValuationMethodImplemented('moving_weighted_average')).toBe(true);
    expect(isValuationMethodImplemented('fifo')).toBe(false);
    expect(isValuationMethodImplemented('lifo')).toBe(false);
    expect(isValuationMethodImplemented('specific_identification')).toBe(false);
  });

  it('uses canonical PDR-05 §6 Persian labels', () => {
    expect(valuationMethodLabel('moving_weighted_average')).toBe(
      'میانگین موزون متحرک',
    );
    expect(valuationMethodLabel('fifo')).toBe(
      'اولین صادره از اولین وارده (FIFO)',
    );
    expect(valuationMethodLabel('lifo')).toBe(
      'اولین صادره از آخرین وارده (LIFO)',
    );
    expect(valuationMethodLabel('specific_identification')).toBe(
      'شناسایی ویژه',
    );
  });
});

describe('valuationMethodErrorMessage — backend error code/subcode mapping', () => {
  it('maps 409 Conflict to duplicate start date guidance without leaking English message', () => {
    const err = new ApiError({
      status: 409,
      code: 'Conflict',
      message: 'A valuation method with this validFrom already exists.',
      correlationId: 'corr-409',
    });
    expect(valuationMethodErrorMessage('configure', err)).toEqual({
      message: t.inventoryValuationMethods.errors.duplicateStartDate,
      correlationId: 'corr-409',
    });
  });

  it('maps both backend overlapping_version and spec overlap subcodes to Persian overlap guidance', () => {
    const backendOverlap = new ApiError({
      status: 422,
      code: 'BusinessRuleViolation',
      message: 'Overlapping valuation method version.',
      details: { code: 'inventory.valuation_method_overlapping_version' },
      correlationId: 'corr-overlap-1',
    });
    const specOverlap = new ApiError({
      status: 422,
      code: 'BusinessRuleViolation',
      message: 'Overlap.',
      details: { code: 'inventory.valuation_method_overlap' },
      correlationId: 'corr-overlap-2',
    });
    expect(valuationMethodErrorMessage('configure', backendOverlap)).toEqual({
      message: t.inventoryValuationMethods.errors.windowOverlap,
      correlationId: 'corr-overlap-1',
    });
    expect(valuationMethodErrorMessage('configure', specOverlap)).toEqual({
      message: t.inventoryValuationMethods.errors.windowOverlap,
      correlationId: 'corr-overlap-2',
    });
  });

  it('maps 422 inventory.valuation_method_invalid_window and inventory.valuation_method_not_implemented', () => {
    const invalidWindow = new ApiError({
      status: 422,
      code: 'BusinessRuleViolation',
      message: 'Invalid window.',
      details: { code: 'inventory.valuation_method_invalid_window' },
    });
    const unimplemented = new ApiError({
      status: 422,
      code: 'BusinessRuleViolation',
      message: 'Method fifo is not implemented.',
      details: { code: 'inventory.valuation_method_not_implemented' },
    });
    expect(
      valuationMethodErrorMessage('configure', invalidWindow).message,
    ).toBe(t.inventoryValuationMethods.errors.invalidWindow);
    expect(valuationMethodErrorMessage('resolve', unimplemented).message).toBe(
      t.inventoryValuationMethods.errors.methodNotImplemented,
    );
  });

  it('maps 400 ValidationFailed subcodes invalidWindow and unknownValuationMethod', () => {
    const invalidWindow = new ApiError({
      status: 400,
      code: 'ValidationFailed',
      message: 'Validation failed',
      details: [{ field: 'validTo', code: 'invalidWindow' }],
    });
    const unknownMethod = new ApiError({
      status: 400,
      code: 'ValidationFailed',
      message: 'Validation failed',
      details: {
        errors: [{ field: 'method', code: 'unknownValuationMethod' }],
      },
    });
    expect(
      valuationMethodErrorMessage('configure', invalidWindow).message,
    ).toBe(t.inventoryValuationMethods.errors.invalidWindow);
    expect(
      valuationMethodErrorMessage('configure', unknownMethod).message,
    ).toBe(t.inventoryValuationMethods.errors.unknownMethod);
  });

  it('maps 404 EntityNotFound and 403 PermissionDenied and falls back per operation', () => {
    const notFound = new ApiError({
      status: 404,
      code: 'EntityNotFound',
      message: 'Item not found in organization',
    });
    const forbidden = new ApiError({
      status: 403,
      code: 'PermissionDenied',
      message: 'Forbidden',
    });
    expect(valuationMethodErrorMessage('resolve', notFound).message).toBe(
      t.inventoryValuationMethods.errors.itemNotFound,
    );
    expect(valuationMethodErrorMessage('load', forbidden).message).toBe(
      t.errors.forbidden,
    );
    expect(
      valuationMethodErrorMessage('load', new Error('socket hang up')).message,
    ).toBe(t.inventoryValuationMethods.errors.loadFailed);
    expect(
      valuationMethodErrorMessage('resolve', new Error('socket hang up'))
        .message,
    ).toBe(t.inventoryValuationMethods.errors.resolveFailed);
    expect(
      valuationMethodErrorMessage('configure', new Error('socket hang up'))
        .message,
    ).toBe(t.inventoryValuationMethods.errors.saveFailed);
  });
});
