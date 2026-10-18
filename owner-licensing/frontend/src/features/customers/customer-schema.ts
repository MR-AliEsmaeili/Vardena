import { z } from 'zod';
import { isBusinessDay } from '@/lib/date-time';
import { o } from '@/lib/owner-i18n';

/**
 * PDR-18 §1: an empty string means "not recorded", never a defaulted day. The
 * value that reaches the API is always a canonical `YYYY-MM-DD` Gregorian day.
 */
const optionalDay = z
  .string()
  .trim()
  .refine((value) => value === '' || isBusinessDay(value), o.invalidDay);

export const customerSchema = z
  .object({
    customerCode: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/, o.invalidCode)
      .refine((v) => v.trim() === v, o.invalidCode),
    displayName: z.string().trim().min(1, o.required).max(200),
    status: z.enum(['ACTIVE', 'INACTIVE']),
    contractReference: z.string().trim().max(200),
    contractStartDate: optionalDay,
    contractEndDate: optionalDay,
    reason: z.string().trim().max(500),
  })
  // Contract dates are commercial: either side may be unrecorded, the start may
  // precede issuance, and a single-day contract (end === start) is valid.
  .refine(
    (value) =>
      value.contractStartDate === '' ||
      value.contractEndDate === '' ||
      value.contractEndDate >= value.contractStartDate,
    { path: ['contractEndDate'], message: o.contractEndBeforeStart },
  );
export type CustomerValues = z.infer<typeof customerSchema>;
