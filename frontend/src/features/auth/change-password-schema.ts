import { z } from 'zod';
import { t } from '@/lib/i18n';

export const MIN_NEW_PASSWORD_LENGTH = 8;
export const MAX_NEW_PASSWORD_LENGTH = 128;

export const changePasswordSchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, t.auth.currentPasswordRequired)
      .max(MAX_NEW_PASSWORD_LENGTH, t.auth.newPasswordMaxLength),
    newPassword: z
      .string()
      .min(1, t.auth.newPasswordRequired)
      .min(MIN_NEW_PASSWORD_LENGTH, t.auth.newPasswordMinLength)
      .max(MAX_NEW_PASSWORD_LENGTH, t.auth.newPasswordMaxLength)
      .refine((value) => value.trim().length > 0, {
        message: t.auth.newPasswordMinLength,
      }),
    confirmPassword: z.string().min(1, t.auth.confirmPasswordRequired),
  })
  .superRefine((values, ctx) => {
    if (
      values.currentPassword.length > 0 &&
      values.newPassword.length > 0 &&
      values.newPassword === values.currentPassword
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['newPassword'],
        message: t.auth.newPasswordMustDiffer,
      });
    }
    if (
      values.confirmPassword.length > 0 &&
      values.confirmPassword !== values.newPassword
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['confirmPassword'],
        message: t.auth.passwordConfirmationMismatch,
      });
    }
  });

export type ChangePasswordFormValues = z.infer<typeof changePasswordSchema>;
