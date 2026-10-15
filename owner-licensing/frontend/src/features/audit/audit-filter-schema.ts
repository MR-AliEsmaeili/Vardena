import { z } from 'zod';
import { o } from '@/lib/owner-i18n';
import {
  auditOutcomes,
  auditTargetTypes,
  isCalendarDay,
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
const optionalDay = z
  .string()
  .refine((value) => value === '' || isCalendarDay(value), o.auditDateInvalid);

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
    from: optionalDay,
    to: optionalDay,
  })
  .refine(
    (value) => value.from === '' || value.to === '' || value.from <= value.to,
    {
      path: ['to'],
      message: o.auditDateRange,
    },
  );
