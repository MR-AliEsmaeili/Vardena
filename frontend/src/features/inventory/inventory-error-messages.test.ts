import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/errors';
import { t } from '@/lib/i18n';
import { inventoryErrorMessage } from './inventory-error-messages';

function conflict(message: string, details?: unknown) {
  return new ApiError({ code: 'Conflict', message, status: 409, details });
}
function rule(code: string, details: Record<string, unknown> = {}) {
  return new ApiError({
    code: 'BusinessRuleViolation',
    message: 'server text',
    status: 422,
    details: { code, ...details },
  });
}

describe('movement reversal errors use backend signals without displaying server English', () => {
  it('distinguishes the transfer pair from duplicate key', () => {
    expect(
      inventoryErrorMessage(
        'reverseMovement',
        conflict('transfer blocked', {
          code: 'inventory.transfer.reverse_pair_required',
        }),
      ).message,
    ).toBe(t.inventory.errors.transferReversePairRequired);
    expect(
      inventoryErrorMessage(
        'reverseMovement',
        conflict('This operationKey was already used with a different request'),
      ).message,
    ).toBe(t.inventory.errors.operationKeyConflict);
  });
  it('recognizes the only unstructured already-reversed conflict by its exact backend phrase', () => {
    expect(
      inventoryErrorMessage(
        'reverseMovement',
        conflict('The movement has already been reversed.'),
      ).message,
    ).toBe(t.inventory.errors.alreadyReversed);
  });
  it('maps accounting and date guards and measured insufficient-stock quantities', () => {
    expect(
      inventoryErrorMessage(
        'reverseMovement',
        rule('inventory.reversal.accounting_posted'),
      ).message,
    ).toBe(t.inventory.errors.reversalAccountingPosted);
    expect(
      inventoryErrorMessage(
        'reverseMovement',
        rule('inventory.reversal_date_before_original'),
      ).message,
    ).toBe(t.inventory.errors.reversalDateBeforeOriginal);
    const stock = inventoryErrorMessage(
      'reverseMovement',
      rule('inventory.insufficient_stock', { onHand: '2', requested: '3' }),
    ).message;
    expect(stock).toContain(t.inventory.errors.insufficientStock);
    expect(stock).toContain('2');
    expect(stock).toContain('3');
  });
});
