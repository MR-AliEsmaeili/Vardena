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
 * ## Supersession is recorded once and becomes effective later
 *
 * Two instants are deliberately separate facts on a retired version:
 *
 * - `supersededAt` — WHEN the supersession was recorded (the import instant of
 *   the successor). Audit and traceability only; it never decides eligibility.
 * - `governsUntil` — the instant FROM WHICH the version no longer governs. It
 *   is the successor's own `validFrom` (never earlier than the import that
 *   recorded it), which is what makes a future-dated renewal importable
 *   *without* interrupting the license that still governs today (PDR-11 §3.2).
 *
 * A version is therefore superseded at an instant, not forever after an
 * import: `isSupersededAt(version, at)`. Historical instants keep the version
 * that really governed then, which matters for as-of reads.
 *
 * ## What the import path guarantees
 *
 * The rules below are deliberately fail-closed around the product question that
 * is still open (PDR-11 PQ-5 → OQ-80): at most one retained version *governs*
 * any instant at or after the import that created it. `evaluateImportConflicts`
 * is the single authority for that guarantee and is evaluated twice — once as
 * a read-side pre-check (fast, informative rejection) and once inside the
 * import transaction, under a per-installation database lock (authoritative;
 * see `LicensesRepository.importVersion`). `resolveEffectiveVersion` rule 7
 * remains a defensive, deterministic failure mode for corrupted or hand-edited
 * data — it is **not** a precedence policy and grants nothing.
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
  /**
   * When the supersession was RECORDED (the successor's import instant), or
   * null while the version has never been retired. Audit/traceability only.
   */
  supersededAt: Date | null;
  /**
   * The instant FROM which the version no longer governs — the retiring
   * successor's `validFrom`, never earlier than the import that recorded it.
   * null while the version has not been retired. This is the eligibility
   * boundary; `supersededAt` is not.
   */
  governsUntil: Date | null;
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

/** True once a supersession has been recorded, regardless of when it starts. */
export function hasRecordedSupersession(
  version: Pick<RetainedLicenseVersion, 'supersededAt'>,
): boolean {
  return version.supersededAt !== null;
}

/**
 * True when the version no longer governs at `at`: its governance ended at or
 * before the instant. A future-dated supersession leaves the predecessor
 * eligible until the successor's `validFrom`.
 */
export function isSupersededAt(
  version: Pick<RetainedLicenseVersion, 'governsUntil'>,
  at: Date,
): boolean {
  return (
    version.governsUntil !== null &&
    version.governsUntil.getTime() <= at.getTime()
  );
}

/** Retained and still governing at `at` (the eligibility half of rule 1). */
export function isEligibleAt(
  version: Pick<RetainedLicenseVersion, 'governsUntil'>,
  at: Date,
): boolean {
  return !isSupersededAt(version, at);
}

/**
 * The window during which a version can actually govern: its own half-open
 * `[validFrom, validUntil)` truncated at the instant a successor takes over.
 * A retired version never governs past `governsUntil`, and an eligible version
 * is unaffected.
 */
export function effectiveWindow(version: RetainedLicenseVersion): {
  start: Date;
  end: Date | null;
} {
  return {
    start: version.validFrom,
    end: earliestInstant(version.validUntil, version.governsUntil),
  };
}

/**
 * The instant a retiring document makes its predecessor stop governing: the
 * successor's own `validFrom`, whatever that is.
 *
 * The reason it is not clamped to the import instant: the invariant this model
 * protects is *"no two retained versions govern the same instant"*, and
 * clamping would break it. A retroactively-dated successor
 * (`validFrom < recordedAt`) clamped to `recordedAt` would leave the
 * predecessor eligible in `[successor.validFrom, recordedAt)` where the
 * successor already covers — two versions governing one instant. With the
 * candidate's own start the two windows are adjacent by construction: the
 * predecessor governs up to exactly the instant the successor takes over.
 *
 * The cost of that choice is honest and bounded: a retroactive successor
 * re-computes which version governed an instant that is already in the past
 * (as-of reads are recomputed from the retained rows, never materialized), and
 * the append-only audit trail still records that the predecessor was retired
 * at `supersededAt` — a later instant than the hand-over it describes.
 */
export function supersessionCeaseInstant(
  candidate: Pick<RetainedLicenseVersion, 'validFrom'>,
): Date {
  return candidate.validFrom;
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
  return windowsIntersect(a.validFrom, a.validUntil, b.validFrom, b.validUntil);
}

/**
 * Retained versions that still govern at `at` (`isEligibleAt`) and whose
 * EFFECTIVE window overlaps the candidate's declared window. A version retired
 * by an earlier import contributes only the window in which it really governed,
 * so its retained tail can never block a legitimate renewal.
 *
 * The import path rejects a non-empty result unless the document explicitly
 * retires exactly one of them — or, for a legacy text code, unless exactly one
 * of them governs the version being replaced (see `evaluateImportConflicts`).
 */
export function overlappingVersions(
  candidate: Pick<RetainedLicenseVersion, 'validFrom' | 'validUntil'>,
  versions: readonly RetainedLicenseVersion[],
  at: Date,
): RetainedLicenseVersion[] {
  return versions.filter((version) => {
    if (!isEligibleAt(version, at)) return false;
    const window = effectiveWindow(version);
    return windowsIntersect(
      candidate.validFrom,
      candidate.validUntil,
      window.start,
      window.end,
    );
  });
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
 * The next version that is not effective yet: the earliest version that still
 * governs at `at` and starts after it. Reported so an operator can see that a
 * future-dated renewal landed without it having taken effect (PDR-11 §3.2).
 */
export function findScheduledVersion(
  versions: readonly RetainedLicenseVersion[],
  at: Date,
): RetainedLicenseVersion | null {
  const future = versions
    .filter(
      (version) =>
        isEligibleAt(version, at) && version.validFrom.getTime() > at.getTime(),
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
 * 1. eligible = retained and still governing at `at`;
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
  const eligible = versions.filter((version) => isEligibleAt(version, at));
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

// ---------------------------------------------------------------------------
// Import conflict evaluation (the ONE authority for the version invariant)
// ---------------------------------------------------------------------------

/**
 * Why an import conflicts with retained state. These are the reasons the API
 * answers 409 with (the document is authentic; the state is the problem).
 */
export type ImportConflictReason =
  'duplicate-operation' | 'unknown-supersession' | 'overlapping-range';

export interface ImportConflict {
  reason: ImportConflictReason;
  /** How many retained versions the candidate collides with (diagnostics). */
  overlapping: number;
}

/**
 * What the document declares about the version it replaces:
 *
 * - `none` — a signed document that retires nothing; it may not overlap any
 *   version that still governs.
 * - `explicit` — a signed document naming its predecessor by operation id
 *   (`supersedesOperationId`); exactly that version may be overlapped.
 * - `implicit` — a legacy `VLIC1` text code, which by documented L-02
 *   semantics replaces the single version governing at the import instant and
 *   cannot express a supersession target.
 *
 * The declared operation id (not a resolved row id) is carried on purpose: the
 * evaluation resolves it against the very rows it was handed, so the
 * authoritative in-transaction check resolves against the committed state
 * inside the lock.
 */
export type ImportSupersessionIntent =
  | { kind: 'none' }
  | { kind: 'explicit'; operationId: string }
  | { kind: 'implicit' };

export interface EvaluateImportConflictsParams {
  candidate: Pick<RetainedLicenseVersion, 'validFrom' | 'validUntil'>;
  operationId: string;
  documentHash: string;
  supersession: ImportSupersessionIntent;
  versions: readonly RetainedLicenseVersion[];
  /** The import instant every time-dependent rule is evaluated at. */
  at: Date;
}

export type ImportConflictEvaluation =
  | { conflict: ImportConflict; supersedes: null }
  | { conflict: null; supersedes: RetainedLicenseVersion | null };

/**
 * Evaluate one import against the retained versions that must be trusted.
 *
 * The same function runs as the read-side pre-check and inside the import
 * transaction under the per-installation lock, so a concurrent writer can never
 * invalidate a decision that was only made before the transaction.
 *
 * Rules (fail closed; nothing is ever silently resolved):
 * 1. an operation id that is already retained is a duplicate;
 * 2. an artifact hash that is already retained is a duplicate;
 * 3. an explicit supersession target (the retained version carrying the
 *    declared operation id) must exist in this installation, must not have a
 *    supersession recorded yet, and must still govern at `at` — a version is
 *    retired once, so two competing successors cannot be booked;
 * 4. a signed document that overlaps any version still governing at `at` other
 *    than its explicit target is refused (unauthorized ambiguity);
 * 5. a legacy code may overlap at most ONE still-governing version, and only
 *    one without a recorded supersession; that version is the one it replaces.
 */
export function evaluateImportConflicts(
  params: EvaluateImportConflictsParams,
): ImportConflictEvaluation {
  const { candidate, operationId, documentHash, supersession, versions, at } =
    params;

  if (findVersionByOperationId(versions, operationId) !== null) {
    return {
      conflict: { reason: 'duplicate-operation', overlapping: 0 },
      supersedes: null,
    };
  }
  if (versions.some((version) => version.documentHash === documentHash)) {
    return {
      conflict: { reason: 'duplicate-operation', overlapping: 0 },
      supersedes: null,
    };
  }

  let target: RetainedLicenseVersion | null = null;
  if (supersession.kind === 'explicit') {
    const found = findVersionByOperationId(versions, supersession.operationId);
    if (
      found === null ||
      hasRecordedSupersession(found) ||
      !isEligibleAt(found, at)
    ) {
      return {
        conflict: { reason: 'unknown-supersession', overlapping: 0 },
        supersedes: null,
      };
    }
    target = found;
  }

  const overlapping = overlappingVersions(candidate, versions, at).filter(
    (version) => version.versionId !== target?.versionId,
  );

  if (supersession.kind === 'implicit') {
    if (overlapping.length > 1) {
      return {
        conflict: {
          reason: 'overlapping-range',
          overlapping: overlapping.length,
        },
        supersedes: null,
      };
    }
    const implicitTarget = overlapping[0] ?? null;
    if (implicitTarget !== null && hasRecordedSupersession(implicitTarget)) {
      // A text code cannot express which successor it would join; refuse rather
      // than rewrite a supersession that an earlier document already recorded.
      return {
        conflict: { reason: 'overlapping-range', overlapping: 1 },
        supersedes: null,
      };
    }
    return { conflict: null, supersedes: implicitTarget };
  }

  if (overlapping.length > 0) {
    return {
      conflict: {
        reason: 'overlapping-range',
        overlapping: overlapping.length,
      },
      supersedes: null,
    };
  }
  return { conflict: null, supersedes: target };
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
 *
 * `supersededAt` is when the supersession was recorded and `governsUntil` is
 * when the version stops governing: for a future-dated renewal they differ, and
 * that difference is exactly what tells an operator "retired, still valid until
 * the successor's start".
 */
export interface LicenseVersionSummary {
  versionId: string;
  licenseId: string;
  status: LicenseStatus;
  validFrom: string;
  validUntil: string | null;
  effective: boolean;
  supersededAt: string | null;
  governsUntil: string | null;
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
    governsUntil: version.governsUntil?.toISOString() ?? null,
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

/** Half-open intersection of two `[start, end)` instants (`null` = open). */
function windowsIntersect(
  aStart: Date,
  aEnd: Date | null,
  bStart: Date,
  bEnd: Date | null,
): boolean {
  const aEndMs = aEnd?.getTime() ?? Number.POSITIVE_INFINITY;
  const bEndMs = bEnd?.getTime() ?? Number.POSITIVE_INFINITY;
  // A window whose declared end precedes its start is EMPTY, not reversed: an
  // effective window can be empty when a later import retired a version before
  // its own `validFrom` (a legacy replacement of a scheduled renewal), and an
  // empty window overlaps nothing.
  if (aStart.getTime() >= aEndMs) return false;
  if (bStart.getTime() >= bEndMs) return false;
  return aStart.getTime() < bEndMs && bStart.getTime() < aEndMs;
}

/** The earlier of two optional instants; null only when both are null. */
function earliestInstant(a: Date | null, b: Date | null): Date | null {
  if (a === null) return b;
  if (b === null) return a;
  return a.getTime() <= b.getTime() ? a : b;
}
