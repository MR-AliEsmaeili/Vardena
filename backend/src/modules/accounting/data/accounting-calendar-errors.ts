/**
 * Calendar failures that can only be detected INSIDE the guard transaction
 * (Task 10.2, AC-I-03/AC-I-04).
 *
 * Overlap, year bounds and lifecycle guards are evaluated against locked
 * rows, so they run in the repository's transaction — but the repository
 * stays HTTP-free (AR-02/04): it throws one of these plain errors and the
 * application service maps it onto the stable API error model. The
 * in-memory test fakes throw the same errors, so both paths are covered by
 * one mapping (the `inventory-posting-errors.ts` pattern).
 */

/** A year was created in a disabled financial area. */
export class AreaDisabledError extends Error {
  constructor() {
    super('The financial area is disabled and cannot take new fiscal years.');
    this.name = 'AreaDisabledError';
  }
}

/** An area with an open fiscal year cannot be disabled (contract §5.6). */
export class AreaHasOpenYearsError extends Error {
  readonly openYearId: string;

  constructor(openYearId: string) {
    super('The financial area has an open fiscal year and cannot be disabled.');
    this.name = 'AreaHasOpenYearsError';
    this.openYearId = openYearId;
  }
}

/** A year range overlaps another year of the same (organization, area). */
export class FiscalYearOverlapError extends Error {
  readonly conflictingId: string;

  constructor(conflictingId: string) {
    super('The fiscal year overlaps another fiscal year of this area.');
    this.name = 'FiscalYearOverlapError';
    this.conflictingId = conflictingId;
  }
}

/** A year date edit would leave one of its periods outside the year. */
export class FiscalYearRangeExcludesPeriodsError extends Error {
  readonly periodId: string;

  constructor(periodId: string) {
    super(
      'The new year dates would leave an accounting period outside the year.',
    );
    this.name = 'FiscalYearRangeExcludesPeriodsError';
    this.periodId = periodId;
  }
}

/** Year dates were edited while the year was not open (fail closed). */
export class FiscalYearNotEditableError extends Error {
  readonly status: string;

  constructor(status: string) {
    super(`A ${status} fiscal year cannot have its dates changed.`);
    this.name = 'FiscalYearNotEditableError';
    this.status = status;
  }
}

/** The year moved while the transition was in flight (concurrent move). */
export class FiscalYearTransitionConflictError extends Error {
  readonly actual: string;

  constructor(actual: string) {
    super(`The fiscal year is ${actual}; the transition no longer applies.`);
    this.name = 'FiscalYearTransitionConflictError';
    this.actual = actual;
  }
}

/** A year with an open period cannot be sealed (contract §6.4, fail closed). */
export class FiscalYearSealBlockedError extends Error {
  readonly openPeriodId: string;

  constructor(openPeriodId: string) {
    super(
      'The fiscal year has an open accounting period and cannot be sealed.',
    );
    this.name = 'FiscalYearSealBlockedError';
    this.openPeriodId = openPeriodId;
  }
}

/** A period was created in an inactive fiscal year. */
export class PeriodYearNotUsableError extends Error {
  constructor() {
    super('The fiscal year is disabled and cannot take new periods.');
    this.name = 'PeriodYearNotUsableError';
  }
}

/** A period was created in a closed or sealed fiscal year (fail closed). */
export class PeriodYearNotOpenError extends Error {
  readonly status: string;

  constructor(status: string) {
    super(`A ${status} fiscal year cannot take new periods.`);
    this.name = 'PeriodYearNotOpenError';
    this.status = status;
  }
}

/** A period range lies outside its owning year's range. */
export class PeriodOutsideYearError extends Error {
  constructor() {
    super('The period must lie inside its fiscal year.');
    this.name = 'PeriodOutsideYearError';
  }
}

/** A period range overlaps another period of the same year. */
export class PeriodOverlapError extends Error {
  readonly conflictingId: string;

  constructor(conflictingId: string) {
    super('The period overlaps another period of this fiscal year.');
    this.name = 'PeriodOverlapError';
    this.conflictingId = conflictingId;
  }
}

/** The period moved while the transition was in flight (concurrent move). */
export class PeriodTransitionConflictError extends Error {
  readonly actual: string;

  constructor(actual: string) {
    super(
      `The accounting period is ${actual}; the transition no longer applies.`,
    );
    this.name = 'PeriodTransitionConflictError';
    this.actual = actual;
  }
}

/** A period of a sealed year cannot be closed or reopened (contract §7.2). */
export class PeriodYearSealedError extends Error {
  constructor() {
    super(
      'The fiscal year is sealed; unseal the year before changing its periods.',
    );
    this.name = 'PeriodYearSealedError';
  }
}
