import { z } from 'zod';
import { LICENSE_DOCUMENT_MAX_LENGTH } from '@/api/contracts';
import { t } from '@/lib/i18n';

/**
 * License import form schema (React Hook Form + Zod, standards §9).
 *
 * It mirrors `ImportLicenseDocumentDto`
 * (`backend/src/modules/licensing/api/dto/license.dto.ts`): one required
 * string capped at the same 65536 characters the backend accepts. `trim()`
 * normalizes copy/paste whitespace and the trailing newline every text editor
 * adds; the backend trims the document too
 * (`decodeLicenseTransport`), so the normalized value is exactly what gets
 * verified.
 *
 * Nothing about the license itself is validated here: no format detection, no
 * envelope/key parsing and above all NO signature or installation-binding
 * check. Authenticity, binding, payload validity and the version position are
 * the backend's verification (ADR-0046) — this schema only prevents an empty
 * or absurdly long request (AR-21: client validation is UX).
 */
export const licenseImportSchema = z.object({
  document: z
    .string()
    .trim()
    .min(1, t.license.importDocumentRequired)
    .max(LICENSE_DOCUMENT_MAX_LENGTH, t.license.importDocumentTooLong),
});

export type LicenseImportFormValues = z.infer<typeof licenseImportSchema>;

/** The file types a license document can arrive as. */
export const LICENSE_FILE_ACCEPT =
  '.vlic,.json,.txt,application/json,text/plain';
