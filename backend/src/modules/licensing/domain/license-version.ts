import type {
  EntitlementKind,
  InactiveReason,
  InstallationLicense,
  LicenseEntitlement,
  LicenseLimit,
  LicenseStatus,
} from './license.js';

/**
 * Retained license versions and deterministic effective-version resolution
 * (L-03, ADR-0046; `docs/licensing/version-model-and-file-exchange.md` §3).
 *
 * A version row is immutable except for its supersession state: validity,
 * limits, entitlements and status are never rewritten once imported. Which
 * version governs at an instant is therefore a pure function of the retained
 * rows and the instant — no background job, no materialization, no restart
 * dependency.
 *
 * The rules below are deliberately fail-closed around the product question that
 * is still open (PDR-11 PQ-5 → OQ-80): the import path guarantees that at most
 * one retained, non-superseded version covers any instant. Rule 7 is a
 * defensive, deterministic failure mode for corrupted or hand-edited data — it
 * is **not** a precedence policy and grants nothing.
 */

/** Where a version came from (audited; never a trust decision). */
export type LicenseVersionSource = 'file' | 'text' | 'legacy-code';

export interface RetainedLicenseVersion {
  versionId: string;
  licenseId: string;
  /** Commercial customer of the version's license (from the license row). */
  customerId: string;
  installationId: string;
  /** Unique operation identity; the replay guard keys on it. */
  operationId: string;
  status: LicenseStatus;
  provider: string;
  /** Payload/document version of the artifact this version was imported from. */
  documentVersion: number;
  /** SHA-256 of the verified artifact; never the artifact itself. */
  documentHash: string;
  /** Trusted key id that verified the signature (null for legacy rows). */
  keyId: string | null;
  validFrom: Date;
  /** null means perpetual; the interval is half-open `[validFrom, validUntil)`. */
  validUntil: Date | null;
  organizationLimit: LicenseLimit;
  userLimit: LicenseLimit;
  entitlements: readonly LicenseEntitlement[];
  /** Non-null on a version that is retained but no longer eligible. */
  supersededAt: Date | null;
  supersededByVersionId: string | null;
  supersedesVersionId: string | null;
  importedAt: Date;
  source: LicenseVersionSource;
}

export type EffectiveVersionResolution =
  | { kind: 'none'; version: null }
  | { kind: 'effective'; version: RetainedLicenseVersion }
  | {
      kind: 'inactive';
      reason: InactiveReason;
      version: RetainedLicenseVersion;
    }
  /**
   * More than one eligible version covers the instant — impossible through the
   * import path. `version` is the deterministic choice; callers log the
   * integrity warning instead of trusting the state blindly.
   */
  | {
      kind: 'ambiguous';
      version: RetainedLicenseVersion;
      covering: readonly RetainedLicenseVersion[];
    };

export function isSuperseded(version: RetainedLicenseVersion): boolean {
  return version.supersededAt !== null;
}

export function isEligible(version: RetainedLicenseVersion): boolean {
  return version.supersededAt === null;
}

/** Half-open containment: `validFrom <= at < validUntil` (null = open end). */
export function covers(
  version: Pick<RetainedLicenseVersion, 'validFrom' | 'validUntil'>,
  at: Date,
): boolean {
  if (at.getTime() < version.validFrom.getTime()) return false;
  return (
    version.validUntil === null || at.getTime() < version.validUntil.getTime()
  );
}

/**
 * Half-open interval overlap. Adjacency (`a.validUntil == b.validFrom`) is NOT
 * an overlap, which is what makes an ordinary renewal — the new version
 * starting exactly when the old one ends — importable without supersession.
 */
export function windowsOverlap(
  a: Pick<RetainedLicenseVersion, 'validFrom' | 'validUntil'>,
  b: Pick<RetainedLicenseVersion, 'validFrom' | 'validUntil'>,
): boolean {
  const aEnd = a.validUntil?.getTime() ?? Number.POSITIVE_INFINITY;
  const bEnd = b.validUntil?.getTime() ?? Number.POSITIVE_INFINITY;
  return a.validFrom.getTime() < bEnd && b.validFrom.getTime() < aEnd;
}

/**
 * Retained, non-superseded versions whose window overlaps the candidate's.
 * The import path rejects a non-empty result unless the document explicitly
 * supersedes a retained version.
 */
export function overlappingVersions(
  candidate: Pick<RetainedLicenseVersion, 'validFrom' | 'validUntil'>,
  versions: readonly RetainedLicenseVersion[],
): RetainedLicenseVersion[] {
  return versions.filter(
    (version) => isEligible(version) && windowsOverlap(candidate, version),
  );
}

export function findVersionByOperationId(
  versions: readonly RetainedLicenseVersion[],
  operationId: string,
): RetainedLicenseVersion | null {
  return (
    versions.find((version) => version.operationId === operationId) ?? null
  );
}

/**
 * The next version that is not effective yet: the earliest eligible version
 * starting after `at`. Reported so an operator can see that a future-dated
 * renewal landed without it having taken effect (PDR-11 §3.2).
 */
export function findScheduledVersion(
  versions: readonly RetainedLicenseVersion[],
  at: Date,
): RetainedLicenseVersion | null {
  const future = versions
    .filter(
      (version) =>
        isEligible(version) && version.validFrom.getTime() > at.getTime(),
    )
    .sort(compareByStartThenImport);
  return future[0] ?? null;
}

/** Newest first, for the bounded history the state endpoint reports. */
export function sortVersionsNewestFirst(
  versions: readonly RetainedLicenseVersion[],
): RetainedLicenseVersion[] {
  return [...versions].sort((a, b) => compareByStartThenImport(b, a));
}

/**
 * Deterministic effective-version resolution (design §3.2).
 *
 * 1. eligible = retained and not superseded;
 * 2. covering = eligible versions whose window contains `at`;
 * 3. one covering version governs — its status and dates then decide active or
 *    `inactiveReason`;
 * 4. none covering but an eligible version ended before `at` → `expired` (the
 *    latest such version), because a subscription that ended stays ended even
 *    when a renewal is scheduled;
 * 5. none covering and none ended but one starts later → `not-yet-valid`;
 * 6. no eligible version at all → `none` (the caller reports `UNLICENSED`);
 * 7. more than one covering → the deterministic defensive choice, flagged.
 */
export function resolveEffectiveVersion(
  versions: readonly RetainedLicenseVersion[],
  at: Date,
): EffectiveVersionResolution {
  const eligible = versions.filter(isEligible);
  if (eligible.length === 0) return { kind: 'none', version: null };

  const covering = eligible.filter((version) => covers(version, at));
  if (covering.length > 0) {
    const chosen = [...covering].sort(compareByStartThenImport).at(-1)!;
    if (covering.length > 1) {
      return { kind: 'ambiguous', version: chosen, covering };
    }
    if (chosen.status !== 'ACTIVE') {
      return { kind: 'inactive', reason: 'status', version: chosen };
    }
    return { kind: 'effective', version: chosen };
  }

  const ended = eligible
    .filter(
      (version) =>
        version.validUntil !== null &&
        version.validUntil.getTime() <= at.getTime(),
    )
    .sort((a, b) => b.validUntil!.getTime() - a.validUntil!.getTime());
  if (ended.length > 0) {
    return { kind: 'inactive', reason: 'expired', version: ended[0]! };
  }

  const future = eligible
    .filter((version) => version.validFrom.getTime() > at.getTime())
    .sort(compareByStartThenImport);
  if (future.length > 0) {
    return { kind: 'inactive', reason: 'not-yet-valid', version: future[0]! };
  }

  // Unreachable: an eligible version either covers, ended, or starts later.
  return { kind: 'none', version: null };
}

/**
 * Project a retained version onto the evaluated license shape consumers and
 * the API already use (`InstallationLicense` → `evaluateLicense`). The
 * evaluated state stays one code path, so the read endpoint and the import
 * path can never disagree about what "active" means.
 */
export function toInstallationLicense(
  version: RetainedLicenseVersion,
  provider: string,
): InstallationLicense {
  return {
    customerId: version.customerId,
    installationId: version.installationId,
    licenseId: version.licenseId,
    status: version.status,
    validFrom: version.validFrom,
    validUntil: version.validUntil,
    organizationLimit: version.organizationLimit,
    userLimit: version.userLimit,
    entitlements: version.entitlements,
    provider,
  };
}

/**
 * The retained-version projection the state endpoint exposes (no signature, no
 * hash, no key — the operator needs identity, dates and lifecycle only).
 */
export interface LicenseVersionSummary {
  versionId: string;
  licenseId: string;
  status: LicenseStatus;
  validFrom: string;
  validUntil: string | null;
  effective: boolean;
  supersededAt: string | null;
  supersededByVersionId: string | null;
  importedAt: string;
  source: LicenseVersionSource;
}

export function toLicenseVersionSummary(
  version: RetainedLicenseVersion,
  effectiveVersionId: string | null,
): LicenseVersionSummary {
  return {
    versionId: version.versionId,
    licenseId: version.licenseId,
    status: version.status,
    validFrom: version.validFrom.toISOString(),
    validUntil: version.validUntil?.toISOString() ?? null,
    effective: version.versionId === effectiveVersionId,
    supersededAt: version.supersededAt?.toISOString() ?? null,
    supersededByVersionId: version.supersededByVersionId,
    importedAt: version.importedAt.toISOString(),
    source: version.source,
  };
}

export function entitlementsByKind(
  entitlements: readonly LicenseEntitlement[],
  kind: EntitlementKind,
): string[] {
  return entitlements
    .filter((entry) => entry.kind === kind)
    .map((entry) => entry.code);
}

/** Latest start wins; then latest import; then the id — always total. */
function compareByStartThenImport(
  a: RetainedLicenseVersion,
  b: RetainedLicenseVersion,
): number {
  const byStart = a.validFrom.getTime() - b.validFrom.getTime();
  if (byStart !== 0) return byStart;
  const byImport = a.importedAt.getTime() - b.importedAt.getTime();
  if (byImport !== 0) return byImport;
  return a.versionId < b.versionId ? -1 : a.versionId > b.versionId ? 1 : 0;
}
