import { z } from 'zod';
import { PARTY_TYPES } from './party-types';
import { t } from '@/lib/i18n';

/**
 * Form schemas for organization master data (React Hook Form + Zod, AR-24).
 *
 * Each schema mirrors the matching backend DTO **exactly** — the same
 * required fields and the same length limits
 * (`backend/src/modules/organization/domain/master-data.ts`,
 * `api/dto/*.dto.ts`). Nothing stricter and nothing looser is invented here:
 * this is client-side UX feedback only (AR-21), and the backend re-validates
 * and re-authorizes every request regardless of what these accept.
 *
 * Rules that need other rows (a department's parent must exist, be in the
 * same organization, be active and not create a cycle; an employee's
 * department/branch must be usable; a party code must be unique) are NOT
 * reimplemented here — they are domain rules the service owns, and their
 * answers (404 / 409 / 422) are surfaced through `admin-error-messages.ts`.
 */

export const MAX_CODE_LENGTH = 64;
export const MAX_NAME_LENGTH = 200;
export const MAX_EMPLOYEE_CODE_LENGTH = 64;
export const MAX_PERSON_NAME_LENGTH = 120;
export const MAX_PARTY_NAME_LENGTH = 200;
export const MAX_EMAIL_LENGTH = 320;
export const MAX_PHONE_LENGTH = 64;

const codeField = z
  .string()
  .trim()
  .min(1, t.orgAdmin.validation.codeRequired)
  .max(MAX_CODE_LENGTH, t.orgAdmin.validation.codeTooLong);

const nameField = z
  .string()
  .trim()
  .min(1, t.orgAdmin.validation.nameRequired)
  .max(MAX_NAME_LENGTH, t.orgAdmin.validation.nameTooLong);

// --- Organization ----------------------------------------------------------

export const organizationProfileSchema = z.object({
  code: codeField,
  name: nameField,
});
export type OrganizationProfileFormValues = z.infer<
  typeof organizationProfileSchema
>;

// --- Branch ----------------------------------------------------------------

export const branchSchema = z.object({
  code: codeField,
  name: nameField,
});
export type BranchFormValues = z.infer<typeof branchSchema>;

// --- Department ------------------------------------------------------------

export const departmentSchema = z.object({
  code: codeField,
  name: nameField,
  /** `''` = root department (the request then carries `null`/omits it). */
  parentDepartmentId: z.string(),
});
export type DepartmentFormValues = z.infer<typeof departmentSchema>;

// --- Employee --------------------------------------------------------------

export const employeeSchema = z.object({
  employeeCode: z
    .string()
    .trim()
    .min(1, t.orgAdmin.validation.employeeCodeRequired)
    .max(MAX_EMPLOYEE_CODE_LENGTH, t.orgAdmin.validation.employeeCodeTooLong),
  firstName: z
    .string()
    .trim()
    .min(1, t.orgAdmin.validation.firstNameRequired)
    .max(MAX_PERSON_NAME_LENGTH, t.orgAdmin.validation.personNameTooLong),
  lastName: z
    .string()
    .trim()
    .min(1, t.orgAdmin.validation.lastNameRequired)
    .max(MAX_PERSON_NAME_LENGTH, t.orgAdmin.validation.personNameTooLong),
  /** `''` = no assignment. */
  departmentId: z.string(),
  branchId: z.string(),
});
export type EmployeeFormValues = z.infer<typeof employeeSchema>;

// --- Party -----------------------------------------------------------------

/**
 * `isCustomer || isSupplier` is the backend's own domain rule
 * (`hasAnyCapability`, 422). It is mirrored here so the user is told before
 * the round trip; the service still enforces it.
 */
export const partySchema = z
  .object({
    code: codeField,
    displayName: z
      .string()
      .trim()
      .min(1, t.orgAdmin.validation.displayNameRequired)
      .max(MAX_PARTY_NAME_LENGTH, t.orgAdmin.validation.partyNameTooLong),
    legalName: z
      .string()
      .trim()
      .max(MAX_PARTY_NAME_LENGTH, t.orgAdmin.validation.partyNameTooLong),
    partyType: z.enum(PARTY_TYPES, {
      message: t.orgAdmin.validation.partyTypeRequired,
    }),
    isCustomer: z.boolean(),
    isSupplier: z.boolean(),
    email: z
      .string()
      .trim()
      .max(MAX_EMAIL_LENGTH, t.orgAdmin.validation.emailTooLong)
      .refine(
        (value) => value === '' || z.string().email().safeParse(value).success,
        { message: t.orgAdmin.validation.emailInvalid },
      ),
    phone: z
      .string()
      .trim()
      .max(MAX_PHONE_LENGTH, t.orgAdmin.validation.phoneTooLong),
  })
  .refine((values) => values.isCustomer || values.isSupplier, {
    message: t.orgAdmin.validation.capabilityRequired,
    path: ['isCustomer'],
  });
export type PartyFormValues = z.infer<typeof partySchema>;
