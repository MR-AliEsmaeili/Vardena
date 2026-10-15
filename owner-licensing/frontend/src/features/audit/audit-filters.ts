import {
  isBusinessDay,
  calendarDayStartInstant,
  calendarDayExclusiveEnd,
} from '@/lib/date-time';
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
  /** Canonical calendar day in the selected query zone, `YYYY-MM-DD`, inclusive. */
  from: string;
  /** Canonical calendar day in the selected query zone, `YYYY-MM-DD`, inclusive. */
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
const urlKeys: readonly string[] = ['page', 'dayZone', ...filterKeys];

/** Preserve old UTC deep links explicitly; ordinary new filters use Tehran. */
export function auditDayZone(params: URLSearchParams): 'UTC' | 'Asia/Tehran' {
  return params.get('dayZone') === 'Asia/Tehran' ||
    (!params.has('from') && !params.has('to'))
    ? 'Asia/Tehran'
    : 'UTC';
}

/**
 * True only for known UI URL parameters supplied once (dayZone is client-only
 * versioning metadata, never sent as an API parameter),
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
  if (params.has('dayZone') && params.get('dayZone') !== 'Asia/Tehran')
    return false;
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
  timeZone: 'UTC' | 'Asia/Tehran' = 'UTC',
): URLSearchParams {
  const next = new URLSearchParams();
  for (const key of filterKeys) {
    const value = values[key].trim();
    if (value) next.set(key, value);
  }
  if (timeZone === 'Asia/Tehran' && (values.from || values.to))
    next.set('dayZone', timeZone);
  if (page > 1) next.set('page', String(page));
  return next;
}

/** Documented minimum year for audit filter dates; mirrors the backend rule. */
export const MIN_AUDIT_YEAR = 1000;

export function isCalendarDay(value: string): boolean {
  return isBusinessDay(value) && Number(value.slice(0, 4)) >= MIN_AUDIT_YEAR;
}

/** Retained for legacy UTC deep links; all calendar math lives in the foundation. */
export function utcExclusiveEnd(day: string): string | undefined {
  return calendarDayExclusiveEnd(day, 'UTC');
}

/** Explicit local-day -> UTC event-query boundary; no persistence/API change. */
export function toAuditQuery(
  values: AuditFilterValues,
  page: number,
  timeZone: 'UTC' | 'Asia/Tehran' = 'UTC',
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
  if (values.from) {
    if (!isCalendarDay(values.from)) return undefined;
    const start = calendarDayStartInstant(values.from, timeZone);
    // Backend minimum applies to UTC wire instants, including Tehran midnight.
    if (start === undefined || Number(start.slice(0, 4)) < MIN_AUDIT_YEAR)
      return undefined;
    query.occurredFrom = start;
  }
  if (values.to) {
    if (!isCalendarDay(values.to)) return undefined;
    const before = calendarDayExclusiveEnd(values.to, timeZone);
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
