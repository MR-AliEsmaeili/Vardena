import { z } from 'zod';
import { t } from '@/lib/i18n';

/**
 * Login form schema (React Hook Form + Zod, ADR-0002/AR-F).
 *
 * It mirrors the request DTO (`LoginRequestDto`: non-empty username and
 * password) for immediate UX feedback only. Credential verification is
 * server-owned: the API answers one generic 401 for every failure reason
 * (unknown user, wrong password, disabled account) and the form renders that
 * server response as-is — it never guesses why a login failed.
 */
export const loginSchema = z.object({
  username: z.string().trim().min(1, t.auth.usernameRequired),
  password: z.string().min(1, t.auth.passwordRequired),
});

export type LoginFormValues = z.infer<typeof loginSchema>;
