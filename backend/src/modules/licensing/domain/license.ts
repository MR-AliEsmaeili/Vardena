export type LicenseStatus = 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';
export type EntitlementKind = 'MODULE' | 'FEATURE';

/**
 * Evaluated status. `UNLICENSED` is not a license lifecycle value: it is the
 * absence of any persisted license for this installation (L-02). A fresh
 * installation is therefore `UNLICENSED`, never implicitly `ACTIVE`.
 */
export type EvaluatedStatus = LicenseStatus | 'UNLICENSED';

export type InactiveReason =
  | 'unlicensed'
  | 'status'
  | 'not-yet-valid'
  | 'expired'
  /**
   * An Owner-signed revocation was applied to this license (OD-LIC-17,
   * `docs/licensing/revocation-artifact-protocol.md`). Revocation is its own
   * state: it is never approximated by an expiry date, a status rewrite or
   * version order, and it is **not** eligible for the OQ-45 grace period — a
   * revoked license confers nothing at any instant.
   */
  | 'revoked';

/** OQ-45: exactly 14×24h in UTC milliseconds from the signed expiry instant. */
export const LICENSE_GRACE_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Evaluated runtime access policy (OQ-45, ADR-0049). Distinct from signed
 * validity: `GRACE`/`READ_ONLY` never mutate `validUntil`.
 * - ACTIVE: within signed validity; GRACE: natural expiry before deadline;
 * - READ_ONLY: natural expiry at/after `graceEndsAt`; BLOCKED: every other
 *   inactive state (unlicensed, status, not-yet-valid) — no Grace is granted.
 */
export type LicenseAccessMode = 'ACTIVE' | 'GRACE' | 'READ_ONLY' | 'BLOCKED';

/** Reads are the existing final-segment `View`/`Export` permission codes. */
export function isReadPermissionCode(permissionCode: string): boolean {
  const segment = permissionCode.split('.').at(-1);
  return segment === 'View' || segment === 'Export';
}

export function graceEndsAtFor(validUntil: Date | null): Date | null {
  return validUntil === null
    ? null
    : new Date(validUntil.getTime() + LICENSE_GRACE_DURATION_MS);
}

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
  /** Signed device quota; null is unlimited when explicitly specified. */
  deviceLimit: LicenseLimit;
  /** False when a legacy signed artifact did not contain the device quota. */
  deviceLimitSpecified: boolean;
  entitlements: readonly LicenseEntitlement[];
  provider: string;
  /**
   * When an Owner-signed revocation was applied to this license, or null.
   * Set only by the persistent provider from `licensing.licenses.revoked_at`;
   * a provider that cannot observe revocation reports null.
   */
  revokedAt: Date | null;
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
  /** Signed device quota; null is unlimited only when specified. */
  deviceLimit: LicenseLimit;
  /** False when the governing legacy signed artifact omitted this field. */
  deviceLimitSpecified: boolean;
  entitlements: readonly LicenseEntitlement[];
  provider: string;
  /**
   * When the Owner-signed revocation was applied to the governing license, or
   * null (OD-LIC-17). Reported so an operator can see WHY the installation is
   * blocked without reading the audit trail; it is never secret.
   */
  revokedAt: Date | null;
  active: boolean;
  inactiveReason: InactiveReason | null;
  /** Signed expiry + 14x24h (UTC ms arithmetic); null when perpetual/absent. */
  graceEndsAt: Date | null;
  accessMode: LicenseAccessMode;
}

export function evaluateLicense(
  license: InstallationLicense,
  at: Date,
): EvaluatedLicense {
  let inactiveReason: InactiveReason | null = null;
  // Revocation outranks every other reason: a revoked license is not merely
  // expired or suspended, and no date window can make it confer entitlement.
  if (license.revokedAt !== null) inactiveReason = 'revoked';
  else if (license.status !== 'ACTIVE') inactiveReason = 'status';
  else if (at.getTime() < license.validFrom.getTime())
    inactiveReason = 'not-yet-valid';
  else if (
    license.validUntil !== null &&
    at.getTime() >= license.validUntil.getTime()
  )
    inactiveReason = 'expired';
  // A revoked license never enters Grace and has no deadline: the date window
  // is irrelevant to it (it is not "expired"), so no grace instant is exposed.
  const graceEndsAt =
    inactiveReason === 'revoked' ? null : graceEndsAtFor(license.validUntil);
  let accessMode: LicenseAccessMode = 'BLOCKED';
  if (inactiveReason === null) accessMode = 'ACTIVE';
  else if (
    inactiveReason === 'expired' &&
    graceEndsAt !== null &&
    at.getTime() < graceEndsAt.getTime()
  )
    accessMode = 'GRACE';
  else if (inactiveReason === 'expired') accessMode = 'READ_ONLY';
  return {
    ...license,
    licensed: true,
    active: inactiveReason === null,
    inactiveReason,
    graceEndsAt,
    accessMode,
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
    deviceLimit: null,
    deviceLimitSpecified: false,
    entitlements: [],
    provider: context.provider,
    revokedAt: null,
    active: false,
    inactiveReason: 'unlicensed',
    graceEndsAt: null,
    accessMode: 'BLOCKED',
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
