import { z } from 'zod';
import { t } from '@/lib/i18n';

/**
 * Client-side mirror of the role DTOs (`role-request.dto.ts`):
 * MAX_ROLE_NAME_LENGTH = 120, MAX_ROLE_DESCRIPTION_LENGTH = 500. The
 * description is optional on the wire; an emptied field is sent as `null`
 * (the PATCH DTO accepts a nullable description).
 */

export const MAX_ROLE_NAME_LENGTH = 120;
export const MAX_ROLE_DESCRIPTION_LENGTH = 500;

export const roleNameSchema = z
  .string()
  .trim()
  .min(1, t.rolesAdmin.roleNameRequired)
  .max(MAX_ROLE_NAME_LENGTH, t.rolesAdmin.roleNameTooLong);

export const roleDescriptionSchema = z
  .string()
  .trim()
  .max(MAX_ROLE_DESCRIPTION_LENGTH, t.rolesAdmin.descriptionTooLong);

export const createRoleSchema = z.object({
  name: roleNameSchema,
  description: roleDescriptionSchema,
  permissionCodes: z.array(z.string().min(1)).max(200),
});

export type CreateRoleFormValues = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  name: roleNameSchema,
  description: roleDescriptionSchema,
});

export type UpdateRoleFormValues = z.infer<typeof updateRoleSchema>;
