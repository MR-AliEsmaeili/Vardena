import { AppException } from '../../../kernel/errors/app-exception.js';
import {
  canonicalizeMoney,
  fitsMoney,
  moneyProblemMessage,
  multiplyMoney,
  validateEnteredAmount,
} from '../domain/money.js';
import type { MovementType } from '../domain/movement-type.js';

/**
 * Cost input on a posting (PDR-05 OD-VAL-05/OD-VAL-07/OD-VAL-16).
 *
 * The rules this file enforces, and why each one exists:
 *
 * 1. **Cost is never required.** A receipt with no cost is a complete,
 *    valid posting. The whole point of the valuation foundation is that the
 *    warehouse records what physically happened without waiting for a price
 *    (the stock simply lands in the key's uncosted quantity).
 *
 * 2. **At most one of `unitCost` / `totalCost`.** Both would be two sources
 *    of truth for one number, and reconciling them (which wins? do we check
 *    they agree? to what tolerance?) is precisely the kind of silent
 *    arithmetic this design refuses. `unitCost` is multiplied by the ENTERED
 *    quantity in the ENTERED unit, exactly, and the product must itself fit
 *    the money scale — no hidden rounding of something a human typed.
 *
 * 3. **Cost is refused on an issue.** An outbound movement is valued by the
 *    method (Moving Weighted Average), not by whatever the operator believes
 *    the stock cost. Accepting a number there would let anyone overwrite the
 *    costing policy per document, which is the opposite of having one.
 *    Reversals carry the original's value automatically and never take a
 *    cost from the client either.
 *
 * 4. **An entered amount is never rounded.** More than two decimals, or a
 *    magnitude beyond `numeric(18,2)`, is REJECTED — the same fail-closed
 *    stance quantities take under OD-C47-01. Rounding happens only where the
 *    METHOD derives a value (see `money.ts`).
 */

export interface CostInput {
  unitCost?: string | null | undefined;
  totalCost?: string | null | undefined;
}

/**
 * Validate and normalize the optional cost on an inbound posting.
 *
 * @returns the exact total value of the posting, or `null` when none was
 *   supplied.
 */
export function resolveEnteredCost(params: {
  input: CostInput;
  movementType: MovementType;
  /** Entered magnitude, in the entered unit (not the base unit). */
  quantity: string;
}): string | null {
  const unitCost = normalizeOptional(params.input.unitCost);
  const totalCost = normalizeOptional(params.input.totalCost);

  if (unitCost === null && totalCost === null) return null;

  if (unitCost !== null && totalCost !== null) {
    throw AppException.validation([
      {
        field: 'unitCost',
        message:
          'Provide either unitCost or totalCost, not both: two independent amounts for one posting cannot both be authoritative.',
        code: 'costInputAmbiguous',
      },
    ]);
  }

  if (!isInbound(params.movementType)) {
    throw AppException.validation([
      {
        field: unitCost === null ? 'totalCost' : 'unitCost',
        message:
          'A cost cannot be entered on an issue, a transfer or a reversal: outbound value is derived from the ' +
          `item's valuation method, not typed per document (movement type "${params.movementType}").`,
        code: 'costNotAcceptedForMovementType',
      },
    ]);
  }

  if (totalCost !== null) {
    assertAmount(totalCost, 'totalCost');
    return canonicalizeMoney(totalCost);
  }

  const perUnit = unitCost as string;
  assertAmount(perUnit, 'unitCost');
  const product = multiplyMoney(perUnit, params.quantity);
  if (!fitsMoney(product)) {
    throw AppException.validation([
      {
        field: 'unitCost',
        message:
          `unitCost x quantity (${perUnit} x ${params.quantity}) is ${product}, which does not fit the supported ` +
          'money precision exactly. Entered amounts are never rounded; send an exact totalCost instead.',
        code: 'costPrecisionExceeded',
      },
    ]);
  }
  return canonicalizeMoney(product);
}

function isInbound(movementType: MovementType): boolean {
  return movementType === 'inbound' || movementType === 'adjustment_in';
}

function normalizeOptional(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function assertAmount(value: string, field: string): void {
  const problem = validateEnteredAmount(value);
  if (problem !== null) {
    throw AppException.validation([
      { field, message: moneyProblemMessage(problem), code: problem },
    ]);
  }
}
