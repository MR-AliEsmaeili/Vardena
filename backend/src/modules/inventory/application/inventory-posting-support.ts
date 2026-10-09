import { createHash } from 'node:crypto';
import { AppException } from '../../../kernel/errors/app-exception.js';
import {
  BUSINESS_DATE_PATTERN,
  businessDateFromInstant,
  businessDateToDbDate,
  parseBusinessDate,
} from '../../../kernel/datetime/business-date.js';
import {
  parseBusinessDateInput,
  type BusinessDateInput,
} from '../../../kernel/datetime/business-date-input.js';
import {
  canonicalizeDecimal,
  fitsQuantity,
  multiplyDecimalStrings,
  quantityProblemMessage,
  validateEnteredQuantity,
} from '../domain/quantities.js';
import {
  resolveVersionAt,
  type UnitConversion,
} from '../domain/unit-conversion.js';
import type { InventoryOperationKind } from '../domain/inventory-operation.js';
import { UnitConversionsRepository } from '../data/unit-conversions.repository.js';

/**
 * Shared helpers for the inventory core's posting services (Task 7, ADR-0022):
 * operation-key validation, reference normalization, entered→base quantity
 * resolution, and idempotency hashing.
 *
 * Quantity resolution is the reason this file exists. Every posting preserves
 * the entered quantity AND the base quantity (D-26): the entered magnitude as
 * typed, the base magnitude as `quantity × factor` in exact decimal
 * arithmetic, resolved against the conversion version in force at the
 * operation's business instant (D-21 — a backdated posting uses the backdated
 * conversion, never today's).
 */

/** `operation_key` columns are `VARCHAR(128)`; keys are opaque client strings. */
export const MAX_OPERATION_KEY_LENGTH = 128;

/** `reference_type` columns are `VARCHAR(64)`. */
export const MAX_REFERENCE_TYPE_LENGTH = 64;

/** API cap for the opaque `reference_id` (unbounded `TEXT` in storage). */
export const MAX_REFERENCE_ID_LENGTH = 128;

/** `reason` columns are `VARCHAR(500)`. */
export const MAX_REASON_LENGTH = 500;

/**
 * Validate a client-supplied idempotency key. Keys are REQUIRED on every
 * mutating inventory-core operation: a retry without a key could never be
 * told apart from a new intent, and the ledger must never hold a doubled
 * posting. ULIDs are recommended but any opaque string works.
 */
export function requireOperationKey(value: string): string {
  const key = value.trim();
  if (key === '') {
    throw AppException.badRequest('An operationKey is required.');
  }
  if (key.length > MAX_OPERATION_KEY_LENGTH) {
    throw AppException.badRequest(
      `operationKey must be at most ${MAX_OPERATION_KEY_LENGTH} characters.`,
    );
  }
  return key;
}

export interface NormalizedReference {
  referenceType: string | null;
  referenceId: string | null;
}

/**
 * Normalize the opaque logical reference (both-or-neither). References point
 * at documents that do not exist yet in Vardena (future Sales/Purchasing) or
 * at external systems — they are stored, never dereferenced, and there is
 * deliberately no universal reference table to validate them against.
 */
export function normalizeReference(input: {
  referenceType?: string | null | undefined;
  referenceId?: string | null | undefined;
}): NormalizedReference {
  const type = input.referenceType?.trim() ?? '';
  const id = input.referenceId?.trim() ?? '';
  if (type === '' && id === '') {
    return { referenceType: null, referenceId: null };
  }
  if (type === '' || id === '') {
    throw AppException.badRequest(
      'referenceType and referenceId must be set together.',
    );
  }
  if (type.length > MAX_REFERENCE_TYPE_LENGTH) {
    throw AppException.badRequest(
      `referenceType must be at most ${MAX_REFERENCE_TYPE_LENGTH} characters.`,
    );
  }
  if (id.length > MAX_REFERENCE_ID_LENGTH) {
    throw AppException.badRequest(
      `referenceId must be at most ${MAX_REFERENCE_ID_LENGTH} characters.`,
    );
  }
  return { referenceType: type, referenceId: id };
}

/**
 * Normalize the free-text reason. Adjustments REQUIRE one (an otherwise
 * unexplained stock change must say why); every other posting takes an
 * optional note. No reason-code vocabulary is invented.
 */
export function normalizeReason(
  value: string | null | undefined,
  options: { required: boolean; operation: string },
): string | null {
  const reason = value?.trim() ?? '';
  if (reason === '') {
    if (options.required) {
      throw AppException.badRequest(
        `A reason is required for ${options.operation}.`,
      );
    }
    return null;
  }
  if (reason.length > MAX_REASON_LENGTH) {
    throw AppException.badRequest(
      `Reason must be at most ${MAX_REASON_LENGTH} characters.`,
    );
  }
  return reason;
}

export interface ResolvedBaseQuantity {
  /** Canonical entered magnitude (echoes the input, normalized). */
  quantity: string;
  /** Exact base magnitude (always > 0 — the sign comes from the type). */
  baseQuantity: string;
  /** Exact factor applied; '1' for same-unit postings. */
  conversionFactor: string;
}

/**
 * Resolve entered quantity → base quantity against the conversion in force at
 * `asOf` (the movement's business date, or now for dateless operations).
 *
 * Item-specific versions win over global ones (D-26, Task 6). Pairs resolve
 * in the ENTERED → BASE direction only: deriving a reverse pair would divide,
 * and division needs a rounding rule that OQ-29 has not approved — fail
 * closed instead. Products that do not fit `numeric(18,4)` exactly are
 * likewise rejected, never rounded (OQ-29).
 *
 * @throws BadRequest for a malformed quantity.
 * @throws BusinessRuleViolation when no conversion covers the instant, or the
 *   exact product exceeds the storage precision.
 */
export async function resolveEnteredToBase(input: {
  conversions: UnitConversionsRepository;
  organizationId: string;
  itemId: string;
  baseUnitId: string;
  unitId: string;
  quantity: string;
  asOf: Date;
}): Promise<ResolvedBaseQuantity> {
  const problem = validateEnteredQuantity(input.quantity);
  if (problem !== null) {
    throw AppException.badRequest(quantityProblemMessage(problem));
  }
  const quantity = canonicalizeDecimal(input.quantity);

  if (input.unitId === input.baseUnitId) {
    return { quantity, baseQuantity: quantity, conversionFactor: '1' };
  }

  const [itemVersions, globalVersions] = await Promise.all([
    input.conversions.findItemVersions(
      input.itemId,
      input.unitId,
      input.baseUnitId,
    ),
    input.conversions.findGlobalVersions(
      input.organizationId,
      input.unitId,
      input.baseUnitId,
    ),
  ]);
  const version: UnitConversion | null =
    resolveVersionAt(itemVersions, input.asOf) ??
    resolveVersionAt(globalVersions, input.asOf);
  if (version === null) {
    throw AppException.businessRule(
      'No unit conversion from the entered unit to the base unit covers ' +
        `${input.asOf.toISOString()}. Configure the conversion (in the entered → base direction) before posting.`,
    );
  }
  const baseQuantity = multiplyDecimalStrings(quantity, version.factor);
  if (!fitsQuantity(baseQuantity)) {
    throw AppException.businessRule(
      quantityProblemMessage('exceeds_precision'),
    );
  }
  return {
    quantity,
    baseQuantity: canonicalizeDecimal(baseQuantity),
    conversionFactor: canonicalizeDecimal(version.factor),
  };
}

/**
 * Canonical form of the CLIENT-SUPPLIED business date for idempotency
 * hashing (OQ-73: the field is a calendar DAY, never an instant):
 *
 *   * a canonical Gregorian day hashes as itself;
 *   * a declared day (`{ calendar, value }`) hashes as the canonical
 *     Gregorian day it resolves to, so `1405-07-16`/JALALI and `2026-10-08`
 *     are ONE intent;
 *   * a legacy ISO instant hashes as the string supplied (its day depends
 *     on the organization zone; the string itself is the stable intent);
 *   * an omitted date hashes as an explicit `null`.
 *
 * The omission MUST be hashed as `null`, never as the server's effective
 * default. Postings without a business date default it to today's business
 * day at the first attempt, but a retry is a different HTTP request later:
 * hashing that clock would make every dateless retry hash differently and
 * turn the replay into a false `409` — the exact double-posting failure
 * idempotency keys exist to prevent. The stored row keeps the first
 * attempt's effective day; only the client's INTENT enters the hash.
 */
export function canonicalClientBusinessDate(
  value: BusinessDateInput | undefined,
): string | null {
  if (value === undefined) return null;
  if (typeof value === 'string') return value;
  const resolved = parseBusinessDate(value.value, value.calendar);
  return resolved === null
    ? `${value.calendar}:${value.value}`
    : resolved.gregorian;
}

/**
 * Resolve a client-supplied business-date INPUT into the PostgreSQL `date`
 * carrier stored on the column (OQ-73):
 *
 *   * a canonical Gregorian day or a declared Jalali day converts ONCE to
 *     the canonical Gregorian day;
 *   * a legacy ISO instant resolves to the DAY it falls on in `timeZone`
 *     (the compatibility boundary — no time-of-day survives a `date`
 *     column);
 *   * an omitted date defaults to TODAY's business day in `timeZone` — the
 *     organization's "today", never the server's UTC day.
 *
 * The returned `Date` is the transport adapter Prisma writes as
 * `YYYY-MM-DD` (its UTC components ARE the day); it is never an instant the
 * caller may render, compare-with-time or zone-shift.
 */
export function resolveBusinessDateCarrier(params: {
  field: string;
  value: BusinessDateInput | undefined;
  timeZone: string;
  now?: Date;
}): Date {
  let day: string;
  if (params.value === undefined) {
    day = businessDateFromInstant(params.now ?? new Date(), params.timeZone);
  } else {
    const parsed = parseBusinessDateInput(params.value, {
      timeZone: params.timeZone,
    });
    if (!parsed.ok) {
      throw AppException.validation([
        {
          field: params.field,
          code: parsed.reason,
          message:
            parsed.reason === 'business_date_calendar'
              ? 'That date does not exist in the declared calendar.'
              : parsed.reason === 'business_date_declaration'
                ? 'A declared business date must be exactly { calendar, value } with calendar GREGORIAN or JALALI and value YYYY-MM-DD.'
                : 'Business date must be YYYY-MM-DD, a declared Jalali/Gregorian day, or an ISO-8601 instant.',
        },
      ]);
    }
    day = parsed.gregorian;
  }
  const carrier = businessDateToDbDate(day);
  if (carrier === null) {
    throw AppException.validation([
      {
        field: params.field,
        code: 'business_date_calendar',
        message: 'That date does not exist in the declared calendar.',
      },
    ]);
  }
  return carrier;
}

/**
 * A business-day LIST FILTER (`YYYY-MM-DD`) into its PostgreSQL `date`
 * carrier (OQ-73): strict canonical Gregorian day shape, calendar-validated,
 * nothing else. Day filters are true date comparisons on the `date` column —
 * index-friendly, no instant arithmetic, no UTC-midnight convention. A Jalali
 * day entered by a user is converted to its canonical Gregorian day at the
 * boundary (the frontend datetime layer) before arriving here.
 */
export function resolveBusinessDateFilter(
  field: string,
  value: string | undefined,
): Date | undefined {
  if (value === undefined) return undefined;
  const carrier = businessDateToDbDate(value);
  if (carrier === null) {
    throw AppException.validation([
      {
        field,
        code: BUSINESS_DATE_PATTERN.test(value)
          ? 'business_date_calendar'
          : 'business_date_format',
        message: `${field} must be a Gregorian business day, YYYY-MM-DD.`,
      },
    ]);
  }
  return carrier;
}

/**
 * sha256 over the canonical request payload. The payloads are built with
 * fixed key order and canonical values (trimmed strings, ISO instants,
 * canonical decimals, explicit nulls), so two submissions of one logical
 * operation hash identically while any material difference changes the hash.
 * Generated ids (movement/transfer ids) and server-generated clocks are NEVER
 * part of the hash — a retry generates fresh ones, and they must not break
 * the match.
 */
export function buildRequestHash(
  operation: InventoryOperationKind,
  canonical: Record<string, unknown>,
): string {
  return createHash('sha256')
    .update(JSON.stringify({ operation, ...canonical }))
    .digest('hex');
}
