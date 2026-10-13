import { z } from 'zod';
import { t } from '@/lib/i18n';

/**
 * First-organization creation form schema (React Hook Form + Zod, AR-24).
 *
 * Mirrors `CreateOrganizationDto`
 * (`backend/src/modules/organization/api/dto/organization.dto.ts`): a
 * required code and name, capped at the same `MAX_CODE_LENGTH` /
 * `MAX_NAME_LENGTH` the backend enforces. This is client-side UX feedback
 * only (AR-21) — the backend re-validates and re-authorizes the request
 * (`Organization.Organization.Create`) regardless of what this schema
 * accepts.
 */
const MAX_CODE_LENGTH = 64;
const MAX_NAME_LENGTH = 200;

export const createFirstOrganizationSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, t.organization.createFirstCodeRequired)
    .max(MAX_CODE_LENGTH),
  name: z
    .string()
    .trim()
    .min(1, t.organization.createFirstNameRequired)
    .max(MAX_NAME_LENGTH),
});

export type CreateFirstOrganizationFormValues = z.infer<
  typeof createFirstOrganizationSchema
>;
