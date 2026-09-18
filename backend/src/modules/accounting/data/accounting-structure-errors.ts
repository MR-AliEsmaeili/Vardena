import type { AccountPlacementProblem } from '../domain/account.js';
import type { CodingStructureProblem } from '../domain/coding-structure.js';

/**
 * Guard failures that can only be detected INSIDE the guarded transactions of
 * the coding-structure / chart repositories (Task 10.3, AC-I-10/AC-I-11).
 *
 * Same contract as `accounting-calendar-errors.ts` (Task 10.2): the repository
 * stays HTTP-free (AR-02/04) and throws one of these plain errors; the
 * application service maps it onto the stable API error model. The in-memory
 * test fakes throw the SAME errors, so one mapping covers both paths.
 */

/** A coding-structure version was edited while it is no longer a `draft`. */
export class CodingStructureNotDraftError extends Error {
  readonly status: string;

  constructor(status: string) {
    super(
      `Coding structure version is "${status}" and cannot be changed. Create a new version instead.`,
    );
    this.name = 'CodingStructureNotDraftError';
    this.status = status;
  }
}

/**
 * The publish gate rejected the version's shape (levels incomplete, digit
 * lengths over the architecture cap, …). Thrown inside the publish
 * transaction, where the locked rows are authoritative.
 */
export class CodingStructurePlanRejectedError extends Error {
  readonly problem: CodingStructureProblem;
  readonly subject: string | undefined;

  constructor(problem: CodingStructureProblem, subject?: string | undefined) {
    super(`The coding structure is not publishable (${problem}).`);
    this.name = 'CodingStructurePlanRejectedError';
    this.problem = problem;
    this.subject = subject;
  }
}

/**
 * A new ROOT account raced a structure publish: the version it resolved to is
 * no longer the active one, so the placement was refused rather than pinned to
 * a version that just became `superseded` (§9.4).
 */
export class CodingStructureVersionNotActiveError extends Error {
  readonly status: string;

  constructor(status: string) {
    super(
      `The coding structure version is "${status}"; retry against the active one.`,
    );
    this.name = 'CodingStructureVersionNotActiveError';
    this.status = status;
  }
}

/** No active coding-structure version exists to derive a code shape from. */
export class NoActiveCodingStructureError extends Error {
  constructor() {
    super(
      'The organization has no active coding structure, so account codes cannot be validated.',
    );
    this.name = 'NoActiveCodingStructureError';
  }
}

/** A create/move violated a tree invariant (§8.4/§9.3/§14) under the lock. */
export class AccountPlacementRejectedError extends Error {
  readonly problem: AccountPlacementProblem;

  constructor(problem: AccountPlacementProblem) {
    super(`The account placement violates the chart invariants (${problem}).`);
    this.name = 'AccountPlacementRejectedError';
    this.problem = problem;
  }
}

/** `is_postable = true` on an account that already has children (§14 rule 2). */
export class AccountPostabilityRejectedError extends Error {
  readonly childId: string;

  constructor(childId: string) {
    super('A postable account must be a leaf of the chart.');
    this.name = 'AccountPostabilityRejectedError';
    this.childId = childId;
  }
}

/** AC-I-11: a structural field of a referenced account was edited. */
export class AccountImmutableAfterUseError extends Error {
  readonly fields: readonly string[];

  constructor(fields: readonly string[]) {
    super(
      `The account is referenced by document lines; ${fields.join(', ')} can no longer change.`,
    );
    this.name = 'AccountImmutableAfterUseError';
    this.fields = fields;
  }
}

// ---------------------------------------------------------------------------
// Accounting Configuration (Task 11)
// ---------------------------------------------------------------------------

import type { AccountingConfigurationProblem } from '../domain/accounting-configuration.js';

export class AccountingConfigurationNotDraftError extends Error {
  readonly status: string;

  constructor(status: string) {
    super(
      `Accounting configuration is \"${status}\" and cannot be changed. Create a new version instead.`,
    );
    this.name = 'AccountingConfigurationNotDraftError';
    this.status = status;
  }
}

export class AccountingConfigurationPlanRejectedError extends Error {
  readonly problem: AccountingConfigurationProblem;
  readonly subject: string | undefined;

  constructor(
    problem: AccountingConfigurationProblem,
    subject?: string | undefined,
  ) {
    super(`The accounting configuration is not publishable (${problem}).`);
    this.name = 'AccountingConfigurationPlanRejectedError';
    this.problem = problem;
    this.subject = subject;
  }
}

export class AccountingConfigurationNotActiveError extends Error {
  readonly status: string;

  constructor(status: string) {
    super(
      `The accounting configuration is \"${status}\"; only ACTIVE configurations may be used.`,
    );
    this.name = 'AccountingConfigurationNotActiveError';
    this.status = status;
  }
}

export class NoActiveAccountingConfigurationError extends Error {
  constructor() {
    super(
      'The organization has no active accounting configuration, so accounts cannot be validated.',
    );
    this.name = 'NoActiveAccountingConfigurationError';
  }
}

export class AccountingConfigurationOperationallyUsedError extends Error {
  constructor() {
    super(
      'The accounting configuration has already been used operationally and cannot be changed or deleted.',
    );
    this.name = 'AccountingConfigurationOperationallyUsedError';
  }
}
