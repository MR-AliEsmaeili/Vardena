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
