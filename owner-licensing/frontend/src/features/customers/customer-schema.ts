import { z } from 'zod';
import { o } from '@/lib/owner-i18n';
export const customerSchema = z.object({
  customerCode: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/, o.invalidCode)
    .refine((v) => v.trim() === v, o.invalidCode),
  displayName: z.string().trim().min(1, o.required).max(200),
  status: z.enum(['ACTIVE', 'INACTIVE']),
  contractReference: z.string().trim().max(200),
  reason: z.string().trim().max(500),
});
export type CustomerValues = z.infer<typeof customerSchema>;
