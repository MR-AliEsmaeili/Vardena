import { describe, expect, it } from 'vitest';
import { o } from '@/lib/owner-i18n';
import {
  auditTrailHref,
  emptyAuditFilters,
  filtersFromParams,
  hasAppliedFilters,
  isCalendarDay,
  knownAuditEventTypes,
  observedAuditEventTypes,
  pageFromParams,
  paramsFromFilters,
  toAuditQuery,
  utcExclusiveEnd,
  type AuditFilterValues,
} from './audit-filters';
import { auditFilterSchema } from './audit-filter-schema';

const ulid = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const filled: AuditFilterValues = {
  eventType: ' CUSTOMER_UPDATED ',
  actorId: ulid,
  targetType: 'Customer',
  targetId: ulid,
  outcome: 'DENIED',
  from: '2026-10-01',
  to: '2026-10-31',
};

describe('audit URL state', () => {
  it('writes only non-empty filters and omits page 1', () => {
    const params = paramsFromFilters({
      ...emptyAuditFilters,
      outcome: 'DENIED',
    });
    expect(params.toString()).toBe('outcome=DENIED');
    expect(paramsFromFilters(emptyAuditFilters, 1).toString()).toBe('');
  });

  it('round-trips every filter and the page through the URL', () => {
    const params = paramsFromFilters(filled, 4);
    expect(filtersFromParams(params)).toEqual({
      ...filled,
      eventType: 'CUSTOMER_UPDATED',
    });
    expect(pageFromParams(params)).toBe(4);
  });

  it('falls back to page 1 for malformed or oversized page values', () => {
    for (const raw of ['0', '-2', 'abc', '1000000', '', '2.5'])
      expect(pageFromParams(new URLSearchParams({ page: raw }))).toBe(1);
    expect(pageFromParams(new URLSearchParams())).toBe(1);
  });

  it('reports whether any filter is applied, ignoring whitespace-only drafts', () => {
    expect(hasAppliedFilters(emptyAuditFilters)).toBe(false);
    expect(hasAppliedFilters({ ...emptyAuditFilters, eventType: '  ' })).toBe(
      false,
    );
    expect(
      hasAppliedFilters({ ...emptyAuditFilters, from: '2026-10-01' }),
    ).toBe(true);
  });
});

describe('audit query mapping', () => {
  it('maps the day window to a UTC half-open interval', () => {
    expect(toAuditQuery(filled, 2)).toEqual({
      page: 2,
      eventType: 'CUSTOMER_UPDATED',
      actorId: ulid,
      targetType: 'Customer',
      targetId: ulid,
      outcome: 'DENIED',
      occurredFrom: '2026-10-01T00:00:00.000Z',
      occurredBefore: '2026-11-01T00:00:00.000Z',
    });
  });

  it('sends only the page when no filter is applied', () => {
    expect(toAuditQuery(emptyAuditFilters, 1)).toEqual({ page: 1 });
  });

  it('computes the exclusive end of a UTC day across month, year and leap boundaries', () => {
    expect(utcExclusiveEnd('2028-02-29')).toBe('2028-03-01T00:00:00.000Z');
    expect(utcExclusiveEnd('2026-12-31')).toBe('2027-01-01T00:00:00.000Z');
  });

  it('accepts only real calendar days', () => {
    expect(isCalendarDay('2028-02-29')).toBe(true);
    expect(isCalendarDay('2027-02-29')).toBe(false);
    expect(isCalendarDay('2026-13-01')).toBe(false);
    expect(isCalendarDay('2026-10-01T00:00:00Z')).toBe(false);
    expect(isCalendarDay('')).toBe(false);
  });

  it('builds an exact-target trail link for records and customers', () => {
    expect(auditTrailHref('OperationalRecord', ulid)).toBe(
      `/app/audit?targetType=OperationalRecord&targetId=${ulid}`,
    );
  });
});

describe('audit filter schema', () => {
  it('accepts an empty draft and a complete valid draft', () => {
    expect(auditFilterSchema.safeParse(emptyAuditFilters).success).toBe(true);
    expect(auditFilterSchema.safeParse(filled).success).toBe(true);
  });

  it.each([
    ['lower-case event type', { eventType: 'customer_updated' }],
    ['LIKE wildcard in event type', { eventType: 'CUSTOMER%' }],
    ['SQL fragment in event type', { eventType: "x' OR '1'='1" }],
    ['short actor id', { actorId: '01ARZ3' }],
    ['wildcard target id', { targetId: '%' }],
    ['unknown target type', { targetType: 'Users' }],
    ['unknown outcome', { outcome: 'OK' }],
    ['impossible day', { from: '2027-02-29' }],
    ['inverted range', { from: '2026-10-02', to: '2026-10-01' }],
  ])('rejects %s', (_label, patch) => {
    expect(
      auditFilterSchema.safeParse({ ...emptyAuditFilters, ...patch }).success,
    ).toBe(false);
  });

  it('explains an invalid event code in Persian', () => {
    const result = auditFilterSchema.safeParse({
      ...emptyAuditFilters,
      eventType: 'a%',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(o.auditEventTypeInvalid);
  });
});

describe('observation copy', () => {
  const labelOf = (code: string) =>
    (o.auditEventLabels as Record<string, string>)[code];

  it.each(observedAuditEventTypes)(
    'labels %s as an operator observation, never as proof',
    (code) => {
      expect(labelOf(code)).toContain('مشاهده');
      expect(labelOf(code)).not.toMatch(
        /اثبات|تأیید شد|امضا شد|verified|proof/i,
      );
    },
  );

  it.each(knownAuditEventTypes)('has a Persian label for %s', (code) => {
    expect(labelOf(code)).toBeDefined();
  });
});
