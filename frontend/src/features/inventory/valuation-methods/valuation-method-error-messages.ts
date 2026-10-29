import { normalizeApiError } from '@/api/errors';
import type { ValuationMethod } from '@/api/contracts';
import { t } from '@/lib/i18n';

/**
 * Domain vocabulary and operation-scoped error presentation for item valuation
 * methods (INV-04, ADR-0039, PDR-05 OD-VAL-02/14/18).
 *
 * Classification relies exclusively on the backend's stable `ApiError.code`
 * and structured `details` — never on raw English `message` strings.
 */

export const VALUATION_METHODS = [
  'moving_weighted_average',
  'fifo',
  'lifo',
  'specific_identification',
] as const satisfies readonly ValuationMethod[];

export const ACTIVE_VALUATION_METHODS = [
  'moving_weighted_average',
] as const satisfies readonly ValuationMethod[];

export function isValuationMethodImplemented(method: ValuationMethod): boolean {
  return (ACTIVE_VALUATION_METHODS as readonly string[]).includes(method);
}

export function valuationMethodLabel(method: ValuationMethod): string {
  return t.inventoryValuationMethods.methods[method];
}

export type ValuationMethodOperation = 'load' | 'resolve' | 'configure';

export interface ValuationMethodErrorMessage {
  message: string;
  correlationId?: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractValidationCodes(details: unknown): readonly string[] {
  const items: unknown[] = Array.isArray(details)
    ? details
    : isRecord(details) && Array.isArray(details['errors'])
      ? (details['errors'] as unknown[])
      : isRecord(details) && Array.isArray(details['fields'])
        ? (details['fields'] as unknown[])
        : [];
  const codes: string[] = [];
  for (const item of items) {
    if (isRecord(item) && typeof item['code'] === 'string') {
      codes.push(item['code']);
    }
  }
  return codes;
}

function fallbackForOperation(operation: ValuationMethodOperation): string {
  switch (operation) {
    case 'load':
      return t.inventoryValuationMethods.errors.loadFailed;
    case 'resolve':
      return t.inventoryValuationMethods.errors.resolveFailed;
    case 'configure':
      return t.inventoryValuationMethods.errors.saveFailed;
  }
}

export function valuationMethodErrorMessage(
  operation: ValuationMethodOperation,
  error: unknown,
): ValuationMethodErrorMessage {
  const apiError = normalizeApiError(error);
  const correlationId = apiError.correlationId;

  switch (apiError.code) {
    case 'PermissionDenied':
      return { message: t.errors.forbidden, correlationId };

    case 'EntityNotFound':
      return {
        message: t.inventoryValuationMethods.errors.itemNotFound,
        correlationId,
      };

    case 'Conflict':
      return {
        message: t.inventoryValuationMethods.errors.duplicateStartDate,
        correlationId,
      };

    case 'BusinessRuleViolation': {
      const subcode = isRecord(apiError.details)
        ? apiError.details['code']
        : undefined;
      // Backend `ValuationMethodPlanRejectedError` emits
      // `inventory.valuation_method_overlapping_version`; the INV-04 brief
      // also documents `inventory.valuation_method_overlap`. Both map to the
      // same overlap guidance.
      if (
        subcode === 'inventory.valuation_method_overlapping_version' ||
        subcode === 'inventory.valuation_method_overlap'
      ) {
        return {
          message: t.inventoryValuationMethods.errors.windowOverlap,
          correlationId,
        };
      }
      if (subcode === 'inventory.valuation_method_invalid_window') {
        return {
          message: t.inventoryValuationMethods.errors.invalidWindow,
          correlationId,
        };
      }
      if (subcode === 'inventory.valuation_method_not_implemented') {
        return {
          message: t.inventoryValuationMethods.errors.methodNotImplemented,
          correlationId,
        };
      }
      return { message: fallbackForOperation(operation), correlationId };
    }

    case 'ValidationFailed':
    case 'BadRequest': {
      const codes = extractValidationCodes(apiError.details);
      if (codes.includes('invalidWindow')) {
        return {
          message: t.inventoryValuationMethods.errors.invalidWindow,
          correlationId,
        };
      }
      if (codes.includes('unknownValuationMethod')) {
        return {
          message: t.inventoryValuationMethods.errors.unknownMethod,
          correlationId,
        };
      }
      return {
        message: t.inventoryValuationMethods.errors.validationFailed,
        correlationId,
      };
    }

    default:
      return { message: fallbackForOperation(operation), correlationId };
  }
}
