import type {
  BaseChartCompatibilityProblem,
  BaseChartSelectionProblem,
} from '../domain/base-chart-adoption.js';
import type {
  BaseChartContentProblem,
  BaseChartVersionTransition,
} from '../domain/base-chart-template.js';

/**
 * Guard failures that can only be detected INSIDE the guarded transactions of
 * the Base Chart template/adoption repositories (Task 23).
 *
 * Same contract as `accounting-structure-errors.ts`: the repository stays
 * HTTP-free (AR-02/04) and throws one of these plain errors; the application
 * service maps it onto the stable API error model. The in-memory test fakes
 * throw the SAME errors, so one mapping covers both paths.
 */

/**
 * A lifecycle operation was attempted against a version whose status does not
 * allow it (draft the only mutable state; one-way transitions; only a
 * PUBLISHED version may be adopted). Carries the current status so the
 * service can phrase the 422 without a second read.
 */
export class BaseChartVersionStatusError extends Error {
  readonly status: string;
  readonly transition: BaseChartVersionTransition | 'edit' | 'adopt';

  constructor(
    status: string,
    transition: BaseChartVersionTransition | 'edit' | 'adopt',
  ) {
    super(
      `Base chart template version is "${status}" and cannot accept "${transition}".`,
    );
    this.name = 'BaseChartVersionStatusError';
    this.status = status;
    this.transition = transition;
  }
}

/**
 * The draft write / publish gate rejected the version's content (level shape
 * or node tree) — thrown inside the write transactions, where the locked
 * rows are authoritative.
 */
export class BaseChartContentRejectedError extends Error {
  readonly problem: BaseChartContentProblem;
  readonly subject: string | undefined;

  constructor(problem: BaseChartContentProblem, subject?: string | undefined) {
    super(`The base chart version content is not publishable (${problem}).`);
    this.name = 'BaseChartContentRejectedError';
    this.problem = problem;
    this.subject = subject;
  }
}

/**
 * The compatibility validation before adoption rejected the template version
 * against the organization's pinned configuration shape (baseline §3 option
 * C — mandatory BEFORE any mutation).
 */
export class BaseChartIncompatibleError extends Error {
  readonly problem: BaseChartCompatibilityProblem;
  readonly subject: string | undefined;

  constructor(
    problem: BaseChartCompatibilityProblem,
    subject?: string | undefined,
  ) {
    super(
      `The base chart version is not compatible with the organization's chart configuration (${problem}).`,
    );
    this.name = 'BaseChartIncompatibleError';
    this.problem = problem;
    this.subject = subject;
  }
}

/**
 * The final adoption set cannot be computed (unknown selection keys, or a
 * broken template tree). Computed and refused BEFORE any mutation — a failed
 * adoption writes nothing.
 */
export class BaseChartSelectionRejectedError extends Error {
  readonly problem: BaseChartSelectionProblem;
  readonly subject: string | undefined;

  constructor(
    problem: BaseChartSelectionProblem,
    subject?: string | undefined,
  ) {
    super(`The adoption selection is not acceptable (${problem}).`);
    this.name = 'BaseChartSelectionRejectedError';
    this.problem = problem;
    this.subject = subject;
  }
}

/**
 * Deterministic duplicate-adoption conflict (idempotency semantics, task
 * §18): the organization has already adopted THIS published version. Also
 * the mapped outcome of the (organization_id, template_version_id) unique
 * backstop under concurrency.
 */
export class BaseChartAlreadyAdoptedError extends Error {
  constructor() {
    super(
      'This organization has already adopted this base chart version. Repeated adoption never creates a duplicate chart.',
    );
    this.name = 'BaseChartAlreadyAdoptedError';
  }
}

/**
 * The organization's chart is not empty. Adoption never merges, upserts or
 * overwrites existing accounts (task §20): ANY existing account rejects the
 * adoption instead of silently colliding on `uq_accounts_organization_id_code`
 * half-way through the insert.
 */
export class OrganizationChartNotEmptyError extends Error {
  constructor() {
    super(
      'This organization already has accounts. Base chart adoption is refused into a non-empty chart (no merge/overwrite semantics).',
    );
    this.name = 'OrganizationChartNotEmptyError';
  }
}
