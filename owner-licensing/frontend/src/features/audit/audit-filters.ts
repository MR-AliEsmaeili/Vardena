import type {
  AuditOutcome,
  AuditQuery,
  AuditTargetType,
} from '@/api/contracts';

/**
 * Pure audit-explorer state. The URL is the single source of applied filters, so
 * refresh, deep links and browser back/forward reproduce the same query.
 */

export const auditTargetTypes: readonly AuditTargetType[] = [
  'Customer',
  'OperationalRecord',
  'User',
];
export const auditOutcomes: readonly AuditOutcome[] = ['SUCCESS', 'DENIED'];

/** Event types the Owner application writes. Used only as typing suggestions. */
export const knownAuditEventTypes = [
  'AUTH_LOGIN',
  'AUTH_LOGIN_FAILED',
  'AUTH_LOGOUT',
  'PASSWORD_CHANGED',
  'PASSWORD_RESET',
  'USER_CREATED',
  'USER_ACCESS_CHANGED',
  'CUSTOMER_CREATED',
  'CUSTOMER_UPDATED',
  'OPERATION_MUTATION_DENIED',
  'LICENSE_ISSUANCE_OBSERVED',
  'LICENSE_ACTIVATION_OBSERVED',
  'SERVER_REPLACEMENT_AUTHORIZED',
  'SERVER_REPLACEMENT_OLD_STATE_RECORDED',
  'SERVER_REPLACEMENT_RECORDED',
] as const;

/** Events that record an operator observation (never cryptographic confirmation). */
export const observedAuditEventTypes: readonly string[] = [
  'LICENSE_ISSUANCE_OBSERVED',
  'LICENSE_ACTIVATION_OBSERVED',
  'SERVER_REPLACEMENT_OLD_STATE_RECORDED',
  'SERVER_REPLACEMENT_RECORDED',
];

export interface AuditFilterValues {
  eventType: string;
  actorId: string;
  targetType: string;
  targetId: string;
  outcome: string;
  /** UTC calendar day, `YYYY-MM-DD`, inclusive. */
  from: string;
  /** UTC calendar day, `YYYY-MM-DD`, inclusive. */
  to: string;
}

export const emptyAuditFilters: AuditFilterValues = {
  eventType: '',
  actorId: '',
  targetType: '',
  targetId: '',
  outcome: '',
  from: '',
  to: '',
};

const filterKeys = [
  'eventType',
  'actorId',
  'targetType',
  'targetId',
  'outcome',
  'from',
  'to',
] as const satisfies readonly (keyof AuditFilterValues)[];

const pagePattern = /^[1-9][0-9]{0,5}$/;
const urlKeys: readonly string[] = ['page', ...filterKeys];

/**
 * True only when every URL parameter is one the backend accepts, supplied once,
 * with a valid page, and each filter value is already canonical (no leading or
 * trailing whitespace). Trimming a value here would query something other than
 * what the URL states, so such a URL is refused instead. Trimming still happens
 * when the user applies a draft, which writes the canonical value to the URL.
 */
export function auditUrlIsWellFormed(params: URLSearchParams): boolean {
  for (const key of new Set(params.keys())) {
    if (!urlKeys.includes(key)) return false;
    if (params.getAll(key).length > 1) return false;
  }
  for (const key of filterKeys) {
    const value = params.get(key);
    if (value !== null && value !== value.trim()) return false;
  }
  const page = params.get('page');
  return page === null || pagePattern.test(page);
}

/** Callers must check `auditUrlIsWellFormed` first; the fallback is for display only. */
export function pageFromParams(params: URLSearchParams): number {
  const raw = params.get('page') ?? '';
  return pagePattern.test(raw) ? Number(raw) : 1;
}

export function filtersFromParams(params: URLSearchParams): AuditFilterValues {
  return {
    eventType: params.get('eventType') ?? '',
    actorId: params.get('actorId') ?? '',
    targetType: params.get('targetType') ?? '',
    targetId: params.get('targetId') ?? '',
    outcome: params.get('outcome') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
  };
}

/** Only non-empty filters and a page other than 1 are written; resetting removes them. */
export function paramsFromFilters(
  values: AuditFilterValues,
  page = 1,
): URLSearchParams {
  const next = new URLSearchParams();
  for (const key of filterKeys) {
    const value = values[key].trim();
    if (value) next.set(key, value);
  }
  if (page > 1) next.set('page', String(page));
  return next;
}

/** Documented minimum year for audit filter dates; mirrors the backend rule. */
export const MIN_AUDIT_YEAR = 1000;

export function isCalendarDay(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Same documented minimum as the backend. Checked before Date.UTC, which maps
  // years 0–99 onto 1900–1999.
  if (year < MIN_AUDIT_YEAR) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * Exclusive upper bound: the start of the UTC day after `day`. Returns `undefined`
 * for 9999-12-31, because the next day is year 10000, which the four-digit-year
 * contract cannot express. The schema rejects that input so it is never dropped.
 */
export function utcExclusiveEnd(day: string): string | undefined {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number);
  // Date.UTC maps years 0–99 onto 1900–1999, so the year is set explicitly.
  const next = new Date(0);
  next.setUTCFullYear(year, month - 1, date + 1);
  if (next.getUTCFullYear() > 9999) return undefined;
  return next.toISOString();
}

/**
 * Maps the applied filters to the API contract. Calendar days are UTC because the
 * Owner application has no organization calendar or zone; the UI labels them as UTC.
 * Returns `undefined` when the `to` day has no representable exclusive end, rather
 * than omitting the bound and widening the range. Draft values are trimmed here;
 * applied values from the URL are already canonical (see `auditUrlIsWellFormed`).
 */
export function toAuditQuery(
  values: AuditFilterValues,
  page: number,
): AuditQuery | undefined {
  const query: AuditQuery = { page };
  const eventType = values.eventType.trim();
  const actorId = values.actorId.trim();
  const targetId = values.targetId.trim();
  if (eventType) query.eventType = eventType;
  if (actorId) query.actorId = actorId;
  if (values.targetType)
    query.targetType = values.targetType as AuditTargetType;
  if (targetId) query.targetId = targetId;
  if (values.outcome) query.outcome = values.outcome as AuditOutcome;
  if (values.from) query.occurredFrom = `${values.from}T00:00:00.000Z`;
  if (values.to) {
    const before = utcExclusiveEnd(values.to);
    if (before === undefined) return undefined;
    query.occurredBefore = before;
  }
  return query;
}

export function hasAppliedFilters(values: AuditFilterValues): boolean {
  return filterKeys.some((key) => values[key].trim() !== '');
}

/** Link from a record or customer to its audit trail (exact target match). */
export function auditTrailHref(
  targetType: AuditTargetType,
  targetId: string,
): string {
  const params = new URLSearchParams({ targetType, targetId });
  return `/app/audit?${params.toString()}`;
}
