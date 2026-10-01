import type { EvaluatedLicense } from '../domain/license.js';

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
}

export function toLicenseStateView(
  license: EvaluatedLicense,
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
  };
}
