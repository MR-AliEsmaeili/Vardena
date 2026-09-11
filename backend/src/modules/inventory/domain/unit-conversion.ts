/**
 * Unit conversion — effective-dated configuration (D-26, D-21,
 * master-data-strategy.md §3.4/§7.7, OQ-29).
 *
 * Two shapes, both from master-data-strategy.md §3.4:
 * - **global** (`inventory.unit_conversions`): true for the unit pair in the
 *   whole organization, e.g. `KG ↔ G`;
 * - **item-specific** (`inventory.item_unit_conversions`): true for one item,
 *   e.g. `1 BOX of THIS item = 12 PCS`. This is the common case, and it is why
 *   `1 BOX = 10 PCS` for item A and `1 BOX = 24 PCS` for item B are both
 *   representable instead of one global packaging assumption.
 *
 * **Effective dating.** A conversion is a version row with `validFrom` and an
 * optional `validTo`. A change never rewrites an existing version: the new
 * version is inserted and the previous open-ended version is *closed* at the
 * new `validFrom`. That is the whole mechanism by which historical meaning is
 * preserved — a document that recorded "3 BOX" against the version valid in
 * March keeps the factor that was valid in March, and resolving "as of" a
 * past date still returns that version (`resolveVersionAt`).
 *
 * There is **no rounding rule** here: rounding of fractional conversions is
 * expert-gated and unresolved (OQ-29) and must not be invented. The factor is
 * stored as `numeric(18,6)` (docs/database-strategy.md §6, rates/ratios) and
 * carried as a string so no binary floating-point drift is introduced.
 *
 * Framework-free (AR-05).
 */

/** Half-open validity window `[validFrom, validTo)`; `null` = open-ended. */
export interface ConversionWindow {
  validFrom: Date;
  validTo: Date | null;
}

export interface UnitConversion extends ConversionWindow {
  id: string;
  organizationId: string;
  /** Null for a global conversion; set for an item-specific one. */
  itemId: string | null;
  fromUnitId: string;
  toUnitId: string;
  /** Decimal string, always > 0. */
  factor: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UnitConversionDto {
  id: string;
  organizationId: string;
  itemId: string | null;
  fromUnitId: string;
  toUnitId: string;
  factor: string;
  validFrom: string;
  validTo: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toUnitConversionDto(
  conversion: UnitConversion,
): UnitConversionDto {
  return {
    id: conversion.id,
    organizationId: conversion.organizationId,
    itemId: conversion.itemId,
    fromUnitId: conversion.fromUnitId,
    toUnitId: conversion.toUnitId,
    factor: conversion.factor,
    validFrom: conversion.validFrom.toISOString(),
    validTo: conversion.validTo?.toISOString() ?? null,
    createdAt: conversion.createdAt.toISOString(),
    updatedAt: conversion.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Versioning rules (pure, unit-tested)
// ---------------------------------------------------------------------------

export type ConversionVersionProblem =
  /** `validTo` must be strictly after `validFrom`. */
  | 'invalid_window'
  /** The requested window overlaps an existing version of the same pair. */
  | 'overlapping_version';

export interface NewVersionPlan {
  problem: ConversionVersionProblem | null;
  /**
   * The open-ended version this new version supersedes (its `validTo` becomes
   * the new `validFrom`), or `null` when nothing is closed.
   */
  supersededId: string | null;
}

/**
 * Decide how a new conversion version fits the existing versions of the same
 * (item, from-unit, to-unit) pair.
 *
 * Rules, in order:
 * 1. `validTo` (when supplied) must be strictly after `validFrom`.
 * 2. If nothing overlaps, insert as-is.
 * 3. If exactly one version overlaps and it is open-ended, started earlier, and
 *    the new version is also open-ended → **supersede**: close the existing
 *    version at the new `validFrom` and insert the new one. This produces the
 *    `Version A: T1 → T2` / `Version B: T2 → future` shape.
 * 4. Any other overlap is rejected. In particular a *bounded* new version
 *    inside an existing open-ended window is rejected rather than silently
 *    splitting the old one — inventing "revert after T2" semantics is a
 *    business rule nobody has approved.
 */
export function planNewVersion(params: {
  candidate: ConversionWindow;
  existing: ReadonlyArray<{ id: string } & ConversionWindow>;
}): NewVersionPlan {
  const { candidate, existing } = params;
  if (
    candidate.validTo !== null &&
    candidate.validTo.getTime() <= candidate.validFrom.getTime()
  ) {
    return { problem: 'invalid_window', supersededId: null };
  }

  const overlapping = existing.filter((version) =>
    windowsOverlap(version, candidate),
  );
  if (overlapping.length === 0) {
    return { problem: null, supersededId: null };
  }
  const [only] = overlapping;
  if (
    overlapping.length === 1 &&
    only !== undefined &&
    only.validTo === null &&
    candidate.validTo === null &&
    only.validFrom.getTime() < candidate.validFrom.getTime()
  ) {
    return { problem: null, supersededId: only.id };
  }
  return { problem: 'overlapping_version', supersededId: null };
}

/** Half-open overlap test: `[aFrom, aTo) ∩ [bFrom, bTo) ≠ ∅`. */
export function windowsOverlap(a: ConversionWindow, b: ConversionWindow): boolean {
  const aEnd = a.validTo?.getTime() ?? Number.POSITIVE_INFINITY;
  const bEnd = b.validTo?.getTime() ?? Number.POSITIVE_INFINITY;
  return a.validFrom.getTime() < bEnd && b.validFrom.getTime() < aEnd;
}

/**
 * The version in force at `asOf`, or `null` when none is.
 *
 * This is the read path that preserves historical meaning: a document dated in
 * the past resolves the version that was valid then, not the current one. When
 * several versions could match (they should not — overlaps are rejected on
 * write), the latest `validFrom` wins so the answer is deterministic.
 */
export function resolveVersionAt<T extends ConversionWindow>(
  versions: readonly T[],
  asOf: Date,
): T | null {
  const time = asOf.getTime();
  const matching = versions.filter(
    (version) =>
      version.validFrom.getTime() <= time &&
      (version.validTo === null || time < version.validTo.getTime()),
  );
  if (matching.length === 0) return null;
  return matching.reduce((latest, version) =>
    version.validFrom.getTime() > latest.validFrom.getTime() ? version : latest,
  );
}
