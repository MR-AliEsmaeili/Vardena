import { z } from 'zod';
import { LICENSE_CODE_MAX_LENGTH } from '@/api/contracts';
import { t } from '@/lib/i18n';

/**
 * License activation form schema (React Hook Form + Zod, standards §9).
 *
 * It mirrors `ActivateLicenseDto`
 * (`backend/src/modules/licensing/api/dto/license.dto.ts`): a required string
 * capped at the same 8192 characters the backend accepts. `trim()` normalizes
 * the copy/paste whitespace around a pasted code — the backend trims the code
 * too (`LicenseActivationService.activate`), so the normalized value is
 * exactly what gets verified.
 *
 * Nothing about the license itself is validated here: no prefix check, no
 * base64/segment parsing and above all NO signature verification. Format,
 * authenticity, installation binding and lifecycle are the backend's
 * verification (`parseLicenseCode`, Ed25519) — this schema only prevents an
 * empty or absurdly long request (AR-21: client validation is UX).
 */
export const licenseActivationSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, t.license.activateCodeRequired)
    .max(LICENSE_CODE_MAX_LENGTH, t.license.activateCodeTooLong),
});

export type LicenseActivationFormValues = z.infer<
  typeof licenseActivationSchema
>;
