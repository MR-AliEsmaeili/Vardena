import { z } from 'zod';
import { t } from '@/lib/i18n';

/**
 * Client-side mirror of the user DTOs (`user-request.dto.ts`).
 *
 * The backend enforces only "non-empty" on username and password — there is
 * no password complexity policy (OQ-06) and none is invented here. The
 * username length mirrors MAX_USERNAME_LENGTH = 64.
 */

export const MAX_USERNAME_LENGTH = 64;

export const usernameSchema = z
  .string()
  .trim()
  .min(1, t.usersAdmin.usernameRequired)
  .max(MAX_USERNAME_LENGTH, t.usersAdmin.usernameTooLong);

export const createUserSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1, t.usersAdmin.passwordRequired),
});

export type CreateUserFormValues = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  username: usernameSchema,
});

export type UpdateUserFormValues = z.infer<typeof updateUserSchema>;

export const resetPasswordSchema = z.object({
  newPassword: z.string().min(1, t.usersAdmin.newPasswordRequired),
});

export type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>;
