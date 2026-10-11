import type { EvaluatedLicense } from '../domain/license.js';
import type { LicenseVersionSummary } from '../domain/license-version.js';
import type { LicenseVersionSnapshot } from '../application/license-provider.js';

/**
 * How many retained versions one response reports. The history is bounded on
 * purpose: it is an operator aid, not a data export. Nothing is deleted — the
 * rows stay in `licensing.license_versions` (design §10).
 */
export const MAX_LICENSE_VERSION_HISTORY = 20;

/**
 * The non-secret license state the API returns (ADR-0030).
 *
 * Every license-derived field is nullable because an installation may hold
 * no license; `installationId` is reported even then, because an operator
 * needs it to obtain a license bound to this installation. No key, code,
 * signature or secret is ever part of this view.
 */
export interface LicenseStateView {
  licensed: boolean;
  status: string;
  active: boolean;
  inactiveReason: string | null;
  installationId: string | null;
  customerId: string | null;
  licenseId: string | null;
  validFrom: string | null;
  validUntil: string | null;
  organizationLimit: number | null;
  userLimit: number | null;
  entitlements: Array<{ kind: string; code: string }>;
  provider: string;
  /** The version that governs now, resolved deterministically (L-03). */
  effectiveVersionId: string | null;
  /** Earliest retained version that is not effective yet, if any. */
  scheduledVersion: LicenseVersionSummary | null;
  /** Bounded retained-version history, newest first. */
  versions: LicenseVersionSummary[];
}

export function toLicenseStateView(
  license: EvaluatedLicense,
  versions: LicenseVersionSnapshot | null = null,
): LicenseStateView {
  return {
    licensed: license.licensed,
    status: license.status,
    active: license.active,
    inactiveReason: license.inactiveReason,
    installationId: license.installationId,
    customerId: license.customerId,
    licenseId: license.licenseId,
    validFrom: license.validFrom?.toISOString() ?? null,
    validUntil: license.validUntil?.toISOString() ?? null,
    organizationLimit: license.organizationLimit,
    userLimit: license.userLimit,
    entitlements: license.entitlements.map(({ kind, code }) => ({
      kind,
      code,
    })),
    provider: license.provider,
    effectiveVersionId: versions?.effectiveVersionId ?? null,
    scheduledVersion: versions?.scheduled ?? null,
    versions: versions?.versions.slice(0, MAX_LICENSE_VERSION_HISTORY) ?? [],
  };
}
