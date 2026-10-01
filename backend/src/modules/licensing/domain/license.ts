export type LicenseStatus = 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';
export type EntitlementKind = 'MODULE' | 'FEATURE';

/** null is the only representation of an unlimited licensed quantity. */
export type LicenseLimit = number | null;

export interface LicenseEntitlement {
  kind: EntitlementKind;
  code: string;
}

/** Authoritative provider result for exactly one installation. */
export interface InstallationLicense {
  customerId: string;
  installationId: string;
  licenseId: string;
  status: LicenseStatus;
  validFrom: Date;
  /** null means perpetual; magic future dates are forbidden. */
  validUntil: Date | null;
  organizationLimit: LicenseLimit;
  userLimit: LicenseLimit;
  entitlements: readonly LicenseEntitlement[];
  provider: string;
}

export interface EvaluatedLicense extends InstallationLicense {
  active: boolean;
  inactiveReason: 'status' | 'not-yet-valid' | 'expired' | null;
}

export function evaluateLicense(
  license: InstallationLicense,
  at: Date,
): EvaluatedLicense {
  let inactiveReason: EvaluatedLicense['inactiveReason'] = null;
  if (license.status !== 'ACTIVE') inactiveReason = 'status';
  else if (at.getTime() < license.validFrom.getTime())
    inactiveReason = 'not-yet-valid';
  else if (
    license.validUntil !== null &&
    at.getTime() >= license.validUntil.getTime()
  )
    inactiveReason = 'expired';
  return { ...license, active: inactiveReason === null, inactiveReason };
}

export function permissionModuleCode(permissionCode: string): string {
  return permissionCode.split('.')[0]!.toLowerCase();
}
