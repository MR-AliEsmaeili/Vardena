/**
 * Posting failures that can only be detected INSIDE the ledger transaction
 * (Task 7, ADR-0022).
 *
 * The negative-stock and availability checks read the locked balance row, so
 * they run in the repository's transaction — but the repository stays HTTP-
 * free (AR-02/04): it throws one of these plain errors and the application
 * service maps it onto the stable API error model. The in-memory test fakes
 * throw the same errors, so both paths are covered by one mapping.
 */

/** An outbound posting would drive on-hand stock negative under a reject policy. */
export class InsufficientStockError extends Error {
  readonly onHand: string;
  readonly requested: string;

  constructor(input: { onHand: string; requested: string }) {
    super(
      `Insufficient stock: on hand ${input.onHand}, requested ${input.requested}.`,
    );
    this.name = 'InsufficientStockError';
    this.onHand = input.onHand;
    this.requested = input.requested;
  }
}

/** A reservation would drive availability negative under a reject policy. */
export class ReservationAvailabilityError extends Error {
  readonly available: string;
  readonly requested: string;

  constructor(input: { available: string; requested: string }) {
    super(
      `Insufficient available stock: available ${input.available}, requested ${input.requested}.`,
    );
    this.name = 'ReservationAvailabilityError';
    this.available = input.available;
    this.requested = input.requested;
  }
}

/** Releasing a reservation that is no longer ACTIVE. */
export class ReservationNotActiveError extends Error {
  readonly status: string;

  constructor(status: string) {
    super(`Reservation is ${status} and cannot be released.`);
    this.name = 'ReservationNotActiveError';
    this.status = status;
  }
}

/**
 * The stored projection contradicts the operation (a release would drive the
 * reserved counter negative, or an ACTIVE reservation has no balance row).
 * Drift is a defect (ADR-0017), never a business event: the operation is
 * refused and the caller is told to run reconciliation — the counters are
 * never silently clamped.
 */
export class BalanceDriftError extends Error {
  constructor() {
    super(
      'The stored stock balance contradicts this operation. Run reconciliation to diagnose it before retrying.',
    );
    this.name = 'BalanceDriftError';
  }
}

/** A second reversal of an already-reversed movement. */
export class AlreadyReversedError extends Error {
  constructor() {
    super('The movement has already been reversed.');
    this.name = 'AlreadyReversedError';
  }
}

/**
 * A cost was offered for a movement that already carries one (PDR-05).
 *
 * Assigning a cost is an ADDITION to a fact that had none, never a rewrite
 * of a figure someone may already have reported on. Correcting a wrong cost
 * follows the same route as correcting a wrong quantity: reverse the
 * movement and post it again.
 */
export class CostAlreadyAssignedError extends Error {
  readonly movementId: string;

  constructor(movementId: string) {
    super(
      `Movement "${movementId}" already carries a cost. Reverse it and post the correction instead of overwriting the value.`,
    );
    this.name = 'CostAlreadyAssignedError';
    this.movementId = movementId;
  }
}

/**
 * A recalculation would replay more movements than the bounded command
 * allows (PDR-05 OD-VAL-12).
 *
 * Refusing is the point: an unbounded replay would hold the key's valuation
 * lock for an unpredictable time, which is exactly the "recalculate
 * everything" behaviour this design rules out.
 */
export class RecalculationTooLargeError extends Error {
  readonly limit: number;
  /**
   * Which bounded read tripped. Both are the same business rule — "a
   * recalculation reads a bounded number of rows and REFUSES rather than
   * truncating" — so they share one stable API code; only the message
   * differs, because an operator must be told which one to act on.
   */
  readonly subject: 'movements' | 'valuation_method_versions';

  constructor(
    limit: number,
    subject: 'movements' | 'valuation_method_versions' = 'movements',
  ) {
    super(
      subject === 'movements'
        ? `This item and warehouse have more than ${limit} movements, which exceeds the bounded recalculation limit.`
        : `This item has more than ${limit} valuation method configuration versions covering the period being replayed, which exceeds the bounded recalculation limit.`,
    );
    this.name = 'RecalculationTooLargeError';
    this.limit = limit;
    this.subject = subject;
  }
}
