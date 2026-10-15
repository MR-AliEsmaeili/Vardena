import { describe, expect, it } from 'vitest';
import { o } from '@/lib/owner-i18n';
import {
  auditTrailHref,
  auditUrlIsWellFormed,
  emptyAuditFilters,
  auditDayZone,
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

  it('sends an ordinary inclusive end day as the next day, exclusive', () => {
    expect(toAuditQuery({ ...emptyAuditFilters, to: '2026-10-31' }, 1)).toEqual(
      {
        page: 1,
        occurredBefore: '2026-11-01T00:00:00.000Z',
      },
    );
    expect(toAuditQuery({ ...emptyAuditFilters, to: '9999-12-30' }, 1)).toEqual(
      { page: 1, occurredBefore: '9999-12-31T00:00:00.000Z' },
    );
  });

  it('keeps the year-1000 boundary as a valid from and to range', () => {
    expect(
      toAuditQuery(
        { ...emptyAuditFilters, from: '1000-01-01', to: '1000-01-01' },
        1,
      ),
    ).toEqual({
      page: 1,
      occurredFrom: '1000-01-01T00:00:00.000Z',
      occurredBefore: '1000-01-02T00:00:00.000Z',
    });
  });

  it('never drops the upper bound for 9999-12-31: the query is undefined instead', () => {
    // The exclusive end would be year 10000, which the contract cannot express.
    expect(utcExclusiveEnd('9999-12-31')).toBeUndefined();
    expect(toAuditQuery({ ...emptyAuditFilters, to: '9999-12-31' }, 1)).toBe(
      undefined,
    );
    // Without `to`, the same final day is an ordinary lower bound and is kept.
    expect(
      toAuditQuery({ ...emptyAuditFilters, from: '9999-12-31' }, 1),
    ).toEqual({ page: 1, occurredFrom: '9999-12-31T00:00:00.000Z' });
  });

  it('rejects years below 1000, the documented minimum, and accepts the boundary', () => {
    expect(isCalendarDay('1000-01-01')).toBe(true);
    expect(isCalendarDay('0999-12-31')).toBe(false);
    expect(isCalendarDay('0099-12-31')).toBe(false);
    expect(isCalendarDay('0050-01-01')).toBe(false);
    expect(isCalendarDay('0000-01-01')).toBe(false);
    // 1000 is divisible by 100 but not by 400, so 29 February does not exist.
    expect(isCalendarDay('1000-02-29')).toBe(false);
    expect(isCalendarDay('2000-02-29')).toBe(true);
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

  it.each([
    ['from', { from: '0999-12-31' }],
    ['to', { to: '0999-12-31' }],
    ['from (year 0099)', { from: '0099-01-01' }],
  ])('rejects a %s date before year 1000', (_label, patch) => {
    expect(
      auditFilterSchema.safeParse({ ...emptyAuditFilters, ...patch }).success,
    ).toBe(false);
  });

  it('rejects an upper bound of 9999-12-31 with its own message, and accepts 9999-12-30', () => {
    const rejected = auditFilterSchema.safeParse({
      ...emptyAuditFilters,
      to: '9999-12-31',
    });
    expect(rejected.success).toBe(false);
    expect(rejected.error?.issues[0]?.message).toBe(
      o.auditDateUpperBoundUnsupported,
    );
    expect(rejected.error?.issues[0]?.path).toEqual(['to']);
    expect(
      auditFilterSchema.safeParse({ ...emptyAuditFilters, to: '9999-12-30' })
        .success,
    ).toBe(true);
  });

  it('still accepts 9999-12-31 as a lower bound, because it has no exclusive-end problem', () => {
    expect(
      auditFilterSchema.safeParse({ ...emptyAuditFilters, from: '9999-12-31' })
        .success,
    ).toBe(true);
  });

  it('accepts the year-1000 boundary as a date range', () => {
    expect(
      auditFilterSchema.safeParse({
        ...emptyAuditFilters,
        from: '1000-01-01',
        to: '1000-12-31',
      }).success,
    ).toBe(true);
  });

  it('explains a year-before-1000 date with the year rule, not a generic message', () => {
    const result = auditFilterSchema.safeParse({
      ...emptyAuditFilters,
      from: '0999-01-01',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(o.auditDateYearTooEarly);
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

describe('URL well-formedness (no silent fallback)', () => {
  // The backend rejects these with 400. The UI must not quietly use the first
  // value, drop the unknown key, or show page one for a malformed page.
  it.each([
    ['repeated filter key', 'eventType=AUTH_LOGIN&eventType=AUTH_LOGOUT'],
    ['repeated page key', 'page=2&page=3'],
    ['unknown key (typo)', 'actor=01ARZ3NDEKTSV4RRFFQ69G5FAV'],
    ['unknown key next to valid filters', 'outcome=DENIED&actor=x'],
    ['empty page', 'page='],
    ['zero page', 'page=0'],
    ['non-numeric page', 'page=abc'],
    ['oversized page', 'page=1000000'],
  ])('flags a URL with %s as not well formed', (_label, query) => {
    expect(auditUrlIsWellFormed(new URLSearchParams(query))).toBe(false);
  });

  it('accepts an empty URL, a valid page and empty filter values', () => {
    expect(auditUrlIsWellFormed(new URLSearchParams(''))).toBe(true);
    expect(
      auditUrlIsWellFormed(new URLSearchParams('page=12&eventType=')),
    ).toBe(true);
  });

  it('accepts canonical filter values as they appear in the URL', () => {
    expect(
      auditUrlIsWellFormed(
        new URLSearchParams(
          `eventType=AUTH_LOGIN&actorId=${ulid}&targetId=${ulid}&outcome=DENIED`,
        ),
      ),
    ).toBe(true);
  });

  // The request would send the trimmed value, so a padded URL value would query
  // something other than what the URL states. Such URLs are refused, not trimmed.
  it.each([
    ['leading space in eventType', 'eventType=%20AUTH_LOGIN'],
    ['trailing space in eventType', 'eventType=AUTH_LOGIN%20'],
    ['padded eventType', 'eventType=%20AUTH_LOGIN%20'],
    ['encoded tab in eventType', 'eventType=%09AUTH_LOGIN%09'],
    ['plus-encoded space in eventType', 'eventType=+AUTH_LOGIN+'],
    ['whitespace-only eventType', 'eventType=%20%20'],
    ['leading space in actorId', `actorId=%20${ulid}`],
    ['trailing space in actorId', `actorId=${ulid}%20`],
    ['plus-encoded space in actorId', `actorId=+${ulid}`],
    ['leading space in targetId', `targetId=%20${ulid}`],
    ['trailing space in targetId', `targetId=${ulid}%20`],
    ['encoded newline in targetId', `targetId=${ulid}%0A`],
    ['padded outcome', 'outcome=%20DENIED'],
    ['padded from date', 'from=%202026-10-01'],
    ['padded to date', 'to=2026-10-31%20'],
  ])('refuses a URL with %s', (_label, query) => {
    expect(auditUrlIsWellFormed(new URLSearchParams(query))).toBe(false);
  });
});

describe('UTC day arithmetic', () => {
  it('computes the exclusive end at the year-1000 boundary', () => {
    expect(utcExclusiveEnd('1000-12-31')).toBe('1001-01-01T00:00:00.000Z');
  });

  it('keeps helper arithmetic correct for years 0–99 that Date.UTC would remap', () => {
    // Validation rejects these years before the helper runs; this guards the
    // helper itself, which must not depend on Date.UTC's two-digit mapping.
    expect(utcExclusiveEnd('0099-12-31')).toBe('0100-01-01T00:00:00.000Z');
  });
});

describe('Tehran date filter compatibility', () => {
  it('maps a new local-day filter to explicit UTC boundaries without a day shift', () => {
    expect(
      toAuditQuery(
        { ...emptyAuditFilters, from: '2026-10-09', to: '2026-10-09' },
        1,
        'Asia/Tehran',
      ),
    ).toEqual({
      page: 1,
      occurredFrom: '2026-10-08T20:30:00.000Z',
      occurredBefore: '2026-10-09T20:30:00.000Z',
    });
  });
  it('does not issue a UTC year below the API minimum at a Tehran boundary', () => {
    expect(
      toAuditQuery(
        { ...emptyAuditFilters, from: '1000-01-01' },
        1,
        'Asia/Tehran',
      ),
    ).toBeUndefined();
  });
});

it('versions Tehran day links, preserves legacy UTC semantics and rejects unknown/repeated zones', () => {
  const local = paramsFromFilters(
    { ...emptyAuditFilters, from: '2026-10-09' },
    2,
    'Asia/Tehran',
  );
  expect(local.get('dayZone')).toBe('Asia/Tehran');
  expect(auditDayZone(local)).toBe('Asia/Tehran');
  expect(auditUrlIsWellFormed(local)).toBe(true);
  expect(auditDayZone(new URLSearchParams('from=2026-10-09'))).toBe('UTC');
  expect(auditDayZone(new URLSearchParams())).toBe('Asia/Tehran');
  expect(
    auditUrlIsWellFormed(new URLSearchParams('dayZone=Europe/Stockholm')),
  ).toBe(false);
  expect(
    auditUrlIsWellFormed(
      new URLSearchParams('dayZone=Asia/Tehran&dayZone=Asia/Tehran'),
    ),
  ).toBe(false);
});
