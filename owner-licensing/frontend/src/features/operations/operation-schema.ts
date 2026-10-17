import { z } from 'zod';
import { isBusinessDay } from '@/lib/date-time';
import { o } from '@/lib/owner-i18n';

const ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, o.invalidId);
const installation = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/, o.invalidInstallation);
const reason = z.string().trim().min(1, o.required).max(500);
function unsafeEvidence(value: string) {
  if (/PRIVATE KEY|VLIC1|VLIC2|VDEA1|VDRQ1|VDRP1|-----BEGIN /i.test(value))
    return true;
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}
const evidence = z
  .string()
  .trim()
  .max(200)
  .refine((value) => value === '' || !unsafeEvidence(value), o.evidenceHint);
const acknowledged = z.boolean().refine((value) => value, o.confirmRequired);

/**
 * PDR-18 §1.2: the activation-validity START is the authoritative issuance day
 * and is asserted by the server. There is deliberately no `activationValidFrom`
 * field here — the issuer cannot select, backdate or future-date that start.
 * Only the issuer-supplied, EXCLUSIVE end is collected.
 */
const activationValidUntil = z
  .string()
  .trim()
  .refine((value) => value === '' || isBusinessDay(value), o.invalidDay);

export const licenseObservationSchema = z.object({
  customerId: ulid,
  installationReference: installation,
  reason,
  evidenceReference: evidence,
  activationValidUntil,
  acknowledged,
});
export const activationObservationSchema = z.object({
  reason,
  evidenceReference: evidence,
  acknowledged,
});
export const replacementSchema = z
  .object({
    customerId: ulid,
    oldInstallationReference: installation,
    replacementInstallationReference: installation,
    reason,
    evidenceReference: evidence,
    emergencyOldServerLost: z.boolean(),
    acknowledged,
  })
  .refine(
    (value) =>
      value.oldInstallationReference !== value.replacementInstallationReference,
    {
      path: ['replacementInstallationReference'],
      message: o.invalidInstallation,
    },
  );
export const oldServerSchema = z.object({
  reason,
  evidenceReference: evidence,
  oldServerObservedState: z.literal('DEACTIVATION_OBSERVED'),
  acknowledged,
});
export const installedSchema = z.object({
  reason,
  evidenceReference: evidence,
  replacementObservedState: z.literal('INSTALLATION_OBSERVED'),
  acknowledged,
});

export type LicenseObservationValues = z.infer<typeof licenseObservationSchema>;
export type ActivationObservationValues = z.infer<
  typeof activationObservationSchema
>;
export type ReplacementValues = z.infer<typeof replacementSchema>;
