import { z } from 'zod';
import { LICENSE_DOCUMENT_MAX_LENGTH } from '@/api/contracts';
import { t } from '@/lib/i18n';

/**
 * Signed revocation import form schema (OD-LIC-17, React Hook Form + Zod,
 * standards §9).
 *
 * It mirrors `ImportLicenseRevocationDto`
 * (`backend/src/modules/licensing/api/dto/license.dto.ts`): one required
 * string capped at the same 65536-character bound the license import uses,
 * because the revocation envelope is the same shape of document.
 *
 * As with the license form, nothing about the document is validated here: no
 * signature, no key trust, no canonical-form check, no installation/customer/
 * license binding and no staleness comparison. Those are the backend's
 * verification and the only reason a revocation can be trusted. This schema
 * exists so an empty or absurdly long body is refused before it is sent.
 */
export const licenseRevocationImportSchema = z.object({
  document: z
    .string()
    .trim()
    .min(1, t.license.revocationDocumentRequired)
    .max(LICENSE_DOCUMENT_MAX_LENGTH, t.license.importDocumentTooLong),
});

export type LicenseRevocationImportFormValues = z.infer<
  typeof licenseRevocationImportSchema
>;
