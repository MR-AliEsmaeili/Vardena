/**
 * Valuation method — the closed, code-defined strategy vocabulary and its
 * effective-dated configuration (PDR-05 OD-VAL-02/03/14/18, D-06, D-21,
 * OQ-24).
 *
 * Two separate ideas, deliberately not merged:
 *
 * - **Known methods** (`VALUATION_METHODS`): the strategies the architecture
 *   is shaped to admit. Naming them now is what keeps the schema free of a
 *   Moving-Weighted-Average-specific shape — the ledger stores the value that
 *   was assigned and the state is a rebuildable projection, so adding a cost
 *   layer engine later is a new module, not a rewrite of the Inventory domain.
 * - **Active methods** (`ACTIVE_VALUATION_METHODS`): the strategies this MVP
 *   can actually execute. Exactly one: Moving Weighted Average. FIFO, LIFO and
 *   Specific Identification are known, NOT active: configuring them is
 *   rejected (fail-closed, AR-24), and no UI may offer them. A method nobody
 *   implemented must never silently value stock.
 *
 * **Scope** (OD-VAL-03): the method is configured per **organization + item**.
 * Different items may use different methods in the future; the same item may
 * change method over time, and that change is **effective-dated** (OD-VAL-14)
 * using the mechanism `unit_conversions` already established (D-21/D-26) — a
 * new version is inserted and the previous open-ended one is closed, never
 * edited in place, so historical valuation stays reproducible.
 *
 * **Default** (not a configuration row): a key with no version covering an
 * instant resolves to `DEFAULT_VALUATION_METHOD`. There is deliberately no
 * organization-level default row and no "global settings" table — the MVP has
 * one active strategy, so the default is code, and configuration only ever
 * records a deviation or an explicit confirmation.
 *
 * Stored as text like `item_kind`/`movement_type`: adding a method is a code
 * change plus an ordinary migration, never an `ALTER TYPE`.
 *
 * Framework-free (AR-05).
 */

import type { ConversionWindow } from './unit-conversion.js';

/** Every method the architecture admits (active or not). */
export const VALUATION_METHODS = [
  'moving_weighted_average',
  'fifo',
  'lifo',
  'specific_identification',
] as const;

export type ValuationMethod = (typeof VALUATION_METHODS)[number];

/** The methods this MVP can execute (OD-VAL-02/OD-VAL-18). */
export const ACTIVE_VALUATION_METHODS = ['moving_weighted_average'] as const;

export type ActiveValuationMethod = (typeof ACTIVE_VALUATION_METHODS)[number];

/** Applied when no configuration version covers the instant. */
export const DEFAULT_VALUATION_METHOD: ActiveValuationMethod =
  'moving_weighted_average';

export function isValuationMethod(value: string): value is ValuationMethod {
  return (VALUATION_METHODS as readonly string[]).includes(value);
}

export function isActiveValuationMethod(
  value: string,
): value is ActiveValuationMethod {
  return (ACTIVE_VALUATION_METHODS as readonly string[]).includes(value);
}

/**
 * Why an inactive-but-known method is refused. The message names the method
 * and the single active one, so the caller never has to guess which value is
 * accepted.
 */
export function inactiveMethodMessage(method: string): string {
  return (
    `Valuation method "${method}" is not implemented and cannot be activated. ` +
    `The only active method is "${DEFAULT_VALUATION_METHOD}" ` +
    '(FIFO, LIFO and specific identification are known future strategies, not MVP methods).'
  );
}

// ---------------------------------------------------------------------------
// Configuration (organization + item, effective-dated)
// ---------------------------------------------------------------------------

/**
 * One effective-dated configuration version. Reuses the `ConversionWindow`
 * shape (`validFrom`/`validTo`) on purpose: the repository, the planner
 * (`planNewVersion`) and the resolver (`resolveVersionAt`) are the SAME
 * effective-dating machinery the unit conversions already use, so the module
 * has one history mechanism instead of two.
 */
export interface ItemValuationMethodVersion extends ConversionWindow {
  id: string;
  organizationId: string;
  itemId: string;
  method: ValuationMethod;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ItemValuationMethodDto {
  id: string;
  organizationId: string;
  itemId: string;
  method: ValuationMethod;
  validFrom: string;
  validTo: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toItemValuationMethodDto(
  version: ItemValuationMethodVersion,
): ItemValuationMethodDto {
  return {
    id: version.id,
    organizationId: version.organizationId,
    itemId: version.itemId,
    method: version.method,
    validFrom: version.validFrom.toISOString(),
    validTo: version.validTo?.toISOString() ?? null,
    note: version.note,
    createdAt: version.createdAt.toISOString(),
    updatedAt: version.updatedAt.toISOString(),
  };
}

/** Where a resolved method came from — never inferred by the caller. */
export type ValuationMethodSource = 'configured' | 'default';

export interface ResolvedValuationMethod {
  method: ValuationMethod;
  source: ValuationMethodSource;
  /** The version that decided it; `null` when the default applied. */
  configurationId: string | null;
  validFrom: Date | null;
  validTo: Date | null;
}

/** Is this version in force at `asOf`? Half-open window `[validFrom, validTo)`. */
export function versionCoversInstant(
  version: ItemValuationMethodVersion,
  asOf: Date,
): boolean {
  const time = asOf.getTime();
  return (
    version.validFrom.getTime() <= time &&
    (version.validTo === null || time < version.validTo.getTime())
  );
}

/**
 * Turn "the version in force" (or its absence) into the answer every caller
 * consumes.
 *
 * Both read paths funnel through this one function so they cannot drift:
 * the list-based `resolveValuationMethodAt` (used by the replay, which
 * already holds the versions it needs in memory) and the single-row database
 * lookup (used by the posting path, which asks PostgreSQL for exactly the one
 * version in force). Same mapping, same default, same `source`.
 */
export function resolveValuationMethodFrom(
  version: ItemValuationMethodVersion | null,
): ResolvedValuationMethod {
  if (version === null) {
    return {
      method: DEFAULT_VALUATION_METHOD,
      source: 'default',
      configurationId: null,
      validFrom: null,
      validTo: null,
    };
  }
  return {
    method: version.method,
    source: 'configured',
    configurationId: version.id,
    validFrom: version.validFrom,
    validTo: version.validTo,
  };
}

/**
 * The method in force for one item at one instant.
 *
 * Resolution is purely historical: a document dated in the past resolves the
 * version that was valid then, never today's. When no version covers the
 * instant the code-defined MVP default applies, and the result says so
 * (`source: 'default'`) rather than pretending a configuration exists.
 *
 * Overlaps are rejected on write, so at most one version should match; when
 * several do, the latest `validFrom` wins — the same tie-break the
 * `ORDER BY valid_from DESC LIMIT 1` lookup makes in SQL.
 */
export function resolveValuationMethodAt(
  versions: readonly ItemValuationMethodVersion[],
  asOf: Date,
): ResolvedValuationMethod {
  const matching = versions.filter((version) =>
    versionCoversInstant(version, asOf),
  );
  const winner =
    matching.length === 0
      ? null
      : matching.reduce((latest, version) =>
          version.validFrom.getTime() > latest.validFrom.getTime()
            ? version
            : latest,
        );
  return resolveValuationMethodFrom(winner);
}

/**
 * The closed business interval a replay has to resolve methods for: the
 * earliest and latest movement date it will examine.
 *
 * `null` means "no movements", in which case no configuration row is needed
 * at all — an empty key reads no configuration.
 */
export interface ValuationMethodHorizon {
  from: Date;
  to: Date;
}

export function methodHorizonOf(
  movementDates: readonly Date[],
): ValuationMethodHorizon | null {
  if (movementDates.length === 0) return null;
  let from = movementDates[0] as Date;
  let to = from;
  for (const date of movementDates) {
    if (date.getTime() < from.getTime()) from = date;
    if (date.getTime() > to.getTime()) to = date;
  }
  return { from, to };
}

/**
 * Can this version be in force for ANY instant inside the horizon?
 *
 * This is the predicate the bounded database read expresses as
 * `valid_from <= horizon.to AND (valid_to IS NULL OR valid_to > horizon.from)`,
 * and it is why that read is COMPLETE rather than merely smaller:
 *
 * - `validFrom > horizon.to` → the version starts after every movement in the
 *   window, so no movement can resolve to it (this is what keeps a FUTURE
 *   configuration from touching historical movements);
 * - `validTo <= horizon.from` → the version ended before the earliest
 *   movement, so no movement can resolve to it.
 *
 * Every other version is read. Resolving a date inside the horizon against
 * the filtered set therefore gives exactly the same answer as resolving it
 * against the complete series — asserted directly in
 * `valuation-method.spec.ts`.
 */
export function versionCoversHorizon(
  version: ItemValuationMethodVersion,
  horizon: ValuationMethodHorizon,
): boolean {
  return (
    version.validFrom.getTime() <= horizon.to.getTime() &&
    (version.validTo === null ||
      version.validTo.getTime() > horizon.from.getTime())
  );
}
