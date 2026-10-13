/**
 * Backdating — detection, and the two explicit choices it forces
 * (PDR-05 OD-VAL-10/OD-VAL-11, brief §17/§18).
 *
 * A backdated document is one whose BUSINESS date (`movementDate`) is before
 * the latest movement already recorded on the same key. It is allowed — real
 * warehouses receive paperwork late — but it is never silent, because it
 * changes the meaning of numbers that were already shown to someone:
 *
 *   * a late RECEIPT with a cost changes the average that later issues were
 *     valued at, so those issue values become wrong;
 *   * a late ISSUE must be valued at the average AT ITS DATE, which the
 *     current state cannot reconstruct.
 *
 * Two separate confirmations are therefore required, and they are different
 * questions — the UI must not collapse them into one "Are you sure?":
 *
 *   1. **acknowledge** — "this document is dated in the past; here is what
 *      that affects". Posting without `backdateConfirmed` is rejected.
 *   2. **repricing** — "do you want the existing valuation of this item and
 *      warehouse recalculated now, or left as it is?". There is no default:
 *      an omitted choice is rejected, because defaulting either way would
 *      make the system decide an accounting matter on the operator's behalf.
 *
 * `skip` is a first-class, honest answer: the key is marked STALE and keeps
 * reporting a value it itself labels inconsistent. The system never quietly
 * repairs it, and never quietly pretends it is fine.
 *
 * Equality is NOT backdating: a document dated exactly on the latest
 * movement's business day is a same-day posting, which the canonical ledger
 * order (`movement_date, created_at, id`) already resolves deterministically.
 *
 * `movementDate` / `latestMovementDate` values below are PostgreSQL `date`
 * carriers (OQ-73) — `Date` objects whose UTC components are the calendar
 * day; comparisons are day comparisons, never instant comparisons.
 *
 * Framework-free (AR-05).
 */

import type { BusinessDate } from '../../../kernel/datetime/business-date.js';

/** The operator's answer to the repricing question. No default exists. */
export const REPRICING_CHOICES = ['recalculate', 'skip'] as const;
export type RepricingChoice = (typeof REPRICING_CHOICES)[number];

export function isRepricingChoice(value: string): value is RepricingChoice {
  return (REPRICING_CHOICES as readonly string[]).includes(value);
}

/**
 * What a backdated posting would affect on this key — the facts the UI needs
 * to explain the consequence in business terms instead of asking a generic
 * confirmation question.
 */
export interface BackdateAssessment {
  backdated: boolean;
  /** The proposed business date, never a persistence carrier. */
  movementDate: BusinessDate;
  /** Latest movement business day on the key, or `null` when empty. */
  latestMovementDate: BusinessDate | null;
  /** Movements on the key dated strictly after the proposed date. */
  affectedMovements: number;
  /** How many of those currently carry a value that could change. */
  affectedValuedMovements: number;
  /** Whether the key currently reports an inconsistent (stale) value. */
  alreadyStale: boolean;
}

/** Strictly-before day comparison; the same business day is not backdated. */
export function isBackdated(params: {
  movementDate: BusinessDate;
  latestMovementDate: BusinessDate | null;
}): boolean {
  if (params.latestMovementDate === null) return false;
  return params.movementDate < params.latestMovementDate;
}

/**
 * Why a backdated posting was refused, in machine-readable form. The Persian
 * wording lives in the frontend (i18n rule, docs/frontend/standards.md §6);
 * the backend returns the code plus the measured facts so the message can be
 * written once, in the user's language, with real numbers in it.
 */
export const BACKDATE_CONFIRMATION_CODE = 'inventory.backdated_document';
export const REPRICING_CHOICE_CODE = 'inventory.repricing_choice_required';

export function backdateConfirmationMessage(
  assessment: BackdateAssessment,
): string {
  const latest = assessment.latestMovementDate ?? 'unknown';
  return (
    `The document date is earlier than the latest movement on this item and warehouse (${latest}). ` +
    `${assessment.affectedMovements} later movement(s), ${assessment.affectedValuedMovements} of them valued, ` +
    'may no longer be valued correctly. Confirm the backdated posting and choose explicitly whether to ' +
    'recalculate the valuation of this item and warehouse.'
  );
}

/**
 * The transfer's version of question 1 (C-59C): the SAME acknowledgement code
 * (`inventory.backdated_document`) and the same measured facts, phrased for a
 * document that touches TWO keys, because both histories are restated by the
 * coupled replay and the operator is entitled to see both.
 */
export function transferBackdateConfirmationMessage(params: {
  movementDate: BusinessDate;
  keys: readonly {
    warehouseId: string;
    latestMovementDate: BusinessDate | null;
  }[];
}): string {
  const keys = params.keys
    .map(
      (key) =>
        `warehouse "${key.warehouseId}" (latest movement ` +
        `${key.latestMovementDate ?? 'none'})`,
    )
    .join(' and ');
  return (
    `The transfer is dated ${params.movementDate}, earlier than the latest movement on ` +
    `${keys}. Valuing it correctly restates both warehouses from that date onward, so the backdated ` +
    'transfer must be explicitly confirmed. There is no per-warehouse repricing choice: the transfer ' +
    'pair is valued together, source first, and the destination receives exactly the source value.'
  );
}

export function repricingChoiceMessage(): string {
  return (
    'A backdated posting requires an explicit repricing choice: "recalculate" to reprice this item and ' +
    'warehouse now, or "skip" to keep the current values and mark them as inconsistent. ' +
    'Valuation is never recalculated silently.'
  );
}
