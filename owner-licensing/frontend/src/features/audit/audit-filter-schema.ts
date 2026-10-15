import { z } from 'zod';
import { o } from '@/lib/owner-i18n';
import {
  auditOutcomes,
  auditTargetTypes,
  isCalendarDay,
  utcExclusiveEnd,
} from './audit-filters';

/**
 * Client-side mirror of the backend audit query contract. The server remains the
 * authority (AR-21/AR-24); this schema only prevents avoidable round trips and
 * explains rejected input in Persian.
 */
const ulid = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const eventCode = /^[A-Z][A-Z0-9_]{0,119}$/;
const optionalUlid = z
  .string()
  .trim()
  .refine((value) => value === '' || ulid.test(value), o.invalidId);
/** Strings rather than enums keep the form value type identical to the URL state. */
function oneOf(allowed: readonly string[]) {
  return z
    .string()
    .refine(
      (value) => value === '' || allowed.includes(value),
      o.auditFilterInvalidChoice,
    );
}
function optionalDay(bound: 'from' | 'to') {
  return z.string().superRefine((value, ctx) => {
    if (value === '') return;
    if (!isCalendarDay(value)) {
      // Years before 1000 get their own message so the user sees the rule that applies.
      ctx.addIssue({
        code: 'custom',
        message: /^0\d{3}-/.test(value)
          ? o.auditDateYearTooEarly
          : o.auditDateInvalid,
      });
      return;
    }
    // `to` is inclusive, so it needs an exclusive end. For 9999-12-31 that end is
    // year 10000, which the contract cannot express. Reject it instead of dropping
    // the upper bound. `from` has no such limit.
    if (bound === 'to' && utcExclusiveEnd(value) === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: o.auditDateUpperBoundUnsupported,
      });
    }
  });
}

export const auditFilterSchema = z
  .object({
    eventType: z
      .string()
      .trim()
      .refine(
        (value) => value === '' || eventCode.test(value),
        o.auditEventTypeInvalid,
      ),
    actorId: optionalUlid,
    targetType: oneOf(auditTargetTypes),
    targetId: optionalUlid,
    outcome: oneOf(auditOutcomes),
    from: optionalDay('from'),
    to: optionalDay('to'),
  })
  .refine(
    (value) => value.from === '' || value.to === '' || value.from <= value.to,
    {
      path: ['to'],
      message: o.auditDateRange,
    },
  );
