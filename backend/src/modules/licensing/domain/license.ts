export type LicenseStatus = 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';
export type EntitlementKind = 'MODULE' | 'FEATURE';

/**
 * Evaluated status. `UNLICENSED` is not a license lifecycle value: it is the
 * absence of any persisted license for this installation (L-02). A fresh
 * installation is therefore `UNLICENSED`, never implicitly `ACTIVE`.
 */
export type EvaluatedStatus = LicenseStatus | 'UNLICENSED';

export type InactiveReason =
  'unlicensed' | 'status' | 'not-yet-valid' | 'expired';

/** null is the only representation of an unlimited licensed quantity. */
export type LicenseLimit = number | null;

export interface LicenseEntitlement {
  kind: EntitlementKind;
  code: string;
}

/** Authoritative provider result for exactly one installation. */
export interface InstallationLicense {
  customerId: string;
  customerCode: string;
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

/**
 * The evaluated, non-secret installation state consumers and the API read.
 *
 * Every license-derived field is nullable because an installation may hold no
 * license at all. `installationId` stays populated whenever the installation
 * identity is known (L-02): identity exists independently of licensing, and an
 * operator needs it to obtain a license for exactly this installation.
 */
export interface EvaluatedLicense {
  /** True when a license is persisted/served for this installation. */
  licensed: boolean;
  customerId: string | null;
  customerCode: string | null;
  installationId: string | null;
  licenseId: string | null;
  status: EvaluatedStatus;
  validFrom: Date | null;
  validUntil: Date | null;
  organizationLimit: LicenseLimit;
  userLimit: LicenseLimit;
  entitlements: readonly LicenseEntitlement[];
  provider: string;
  active: boolean;
  inactiveReason: InactiveReason | null;
}

export function evaluateLicense(
  license: InstallationLicense,
  at: Date,
): EvaluatedLicense {
  let inactiveReason: InactiveReason | null = null;
  if (license.status !== 'ACTIVE') inactiveReason = 'status';
  else if (at.getTime() < license.validFrom.getTime())
    inactiveReason = 'not-yet-valid';
  else if (
    license.validUntil !== null &&
    at.getTime() >= license.validUntil.getTime()
  )
    inactiveReason = 'expired';
  return {
    ...license,
    licensed: true,
    active: inactiveReason === null,
    inactiveReason,
  };
}

/** The evaluation of an installation that holds no license at all. */
export function unlicensedEvaluation(context: {
  installationId: string | null;
  provider: string;
}): EvaluatedLicense {
  return {
    licensed: false,
    customerId: null,
    customerCode: null,
    installationId: context.installationId,
    licenseId: null,
    status: 'UNLICENSED',
    validFrom: null,
    validUntil: null,
    organizationLimit: null,
    userLimit: null,
    entitlements: [],
    provider: context.provider,
    active: false,
    inactiveReason: 'unlicensed',
  };
}

const PERMISSION_PREFIX_TO_MODULE: Readonly<Record<string, string>> = {
  Document: 'documents',
};

export function permissionModuleCode(permissionCode: string): string {
  const prefix = permissionCode.split('.')[0]!;
  return PERMISSION_PREFIX_TO_MODULE[prefix] ?? prefix.toLowerCase();
}

/**
 * Platform modules whose permissions are never gated by an entitlement.
 *
 * Only Licensing qualifies, and only because of an unavoidable bootstrap
 * deadlock: the capability that installs a license cannot itself require a
 * license, or an unlicensed installation could never become licensed. This is
 * NOT an authorization bypass — `Licensing.*` codes are ordinary RBAC
 * permissions that must still be granted to a role and held by the principal.
 * The set is a closed constant: no wildcard, no role name, no username.
 */
const PLATFORM_MODULE_CODES: ReadonlySet<string> = new Set(['licensing']);

export function isPlatformPermission(permissionCode: string): boolean {
  return PLATFORM_MODULE_CODES.has(permissionModuleCode(permissionCode));
}
