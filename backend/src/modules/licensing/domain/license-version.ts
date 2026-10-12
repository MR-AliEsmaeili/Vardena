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
 *   is the successor's own `validFrom`, which is what makes a future-dated
 *   renewal importable *without* interrupting the license that still governs
 *   today (PDR-11 §3.2).
 *
 * The import rule that bounds this: a hand-over may never remove governance the
 * version has ALREADY exercised before the import. `evaluateImportConflicts`
 * refuses such a supersession (`backdated-supersession`, see
 * `supersessionRewritesPastGovernance`) instead of rewriting which version
 * governed an instant that is already past. When the version had already ended
 * by its own `validUntil`, the recorded `governsUntil` can be earlier than the
 * import while its *effective* window is unchanged — the documented correction
 * of an expired or scheduled version. Whether the Owner may ever issue a
 * document that does change a past answer is not decided by PDR-11 §3.2/§3.4
 * (it is registered as OQ-86); the refusal is the interim fail-closed
 * behaviour, and the only data that can still carry a retroactive hand-over is
 * what the L-02 migration backfilled (design §3.3).
 *
 * A version is therefore superseded at an instant, not forever after an
 * import: `isSupersededAt(version, at)`. Historical instants keep the version
 * that really governed then, which matters for as-of reads.
 *
 * ## What the import path guarantees
 *
 * The rules below implement the Owner decisions of 2026-10-12 for the product
 * questions that were open (PDR-11 PQ-5 → OQ-80 overlap = **Option B**, gap =
 * **G2**; OQ-86 = **Option C**): at most one retained version *governs* any
 * instant, in the past as well as the future — the effective windows
 * `[valid_from, min(valid_until, governs_until))` of an installation are
 * pairwise disjoint after every import, retired history included. A later
 * starting version takes over at its own `validFrom` (nothing is stacked and no
 * previous version is deleted), a renewal may not leave a gap, and a reducing
 * hand-over is refused on **every** path that retires a version — an explicit
 * signed `supersedesOperationId` included — until PDR-11 §8.6's
 * check/explain/preserve/explicit-resolution flow exists (L-04). Naming the
 * version to retire is not that resolution.
 * `evaluateImportConflicts` is the single authority for that guarantee and is
 * evaluated twice — once as a read-side pre-check (fast, informative rejection)
 * and once inside the import transaction, under a per-installation database
 * lock (authoritative; see `LicensesRepository.importVersion`).
 * `resolveEffectiveVersion` rule 7 remains a defensive, deterministic failure
 * mode for corrupted or hand-edited data — it is **not** a precedence policy
 * and grants nothing.
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
 * The cost of that choice is bounded by the import rule that goes with it: a
 * successor whose hand-over would remove governance the predecessor has already
 * exercised *before* the import is refused by `evaluateImportConflicts`
 * (`backdated-supersession`, see `supersessionRewritesPastGovernance`), so no
 * import can re-compute which version governed a past instant by truncating a
 * retained version. A hand-over strictly after the import instant does change
 * which version governs the instants between `validFrom` and the successor's
 * start from the moment it is recorded (the predecessor keeps governing until
 * then), and the append-only audit trail still records that the predecessor was
 * retired at `supersededAt` — a later instant than the hand-over it describes
 * when the successor is future-dated.
 *
 * The only data that can still carry a *retroactive* hand-over is what the
 * L-02 migration backfilled (whose replaced-by pointer was never persisted, so
 * its hand-over is the recorded instant); see §3.3 of the design document.
 */
export function supersessionCeaseInstant(
  candidate: Pick<RetainedLicenseVersion, 'validFrom'>,
): Date {
  return candidate.validFrom;
}

/**
 * True when retiring `target` at `candidate.validFrom` would change what the
 * target governed for an instant that is ALREADY in the past.
 *
 * Retiring a version truncates its effective window at the hand-over
 * (`supersessionCeaseInstant`), so the coverage the pre-import read model
 * reported for the removed interval disappears with it. This predicate is
 * exactly the question "does the stamp take coverage away from a past instant
 * the target really governed?":
 *
 *   removed = [max(target.validFrom, min(candidate.validFrom, currentEnd)),
 *              min(currentEnd, at))            with currentEnd = the target's
 *                                              effective end before the stamp
 *
 * A non-empty `removed` interval is a rewrite of history; an empty one is not,
 * which is why the two neighbouring cases stay allowed and unchanged:
 * a hand-over at or after `at` (nothing past is touched, the target keeps
 * governing), and a target that had already stopped governing before
 * `candidate.validFrom` (its window is pinned by its own `validUntil`, so the
 * stamp records the supersession without shortening anything) — the documented
 * "correction of an expired or scheduled version" case.
 *
 * It deliberately does NOT ask whether the candidate's own window starts in the
 * past: a document that retires nothing may fill a gap backwards, which is the
 * documented gap behaviour (OQ-80) and the state reports `expired` for the
 * instants no retained version covers. Register OQ-86 for the wider question.
 */
export function supersessionRewritesPastGovernance(
  target: Pick<
    RetainedLicenseVersion,
    'validFrom' | 'validUntil' | 'governsUntil'
  >,
  candidate: Pick<RetainedLicenseVersion, 'validFrom'>,
  at: Date,
): boolean {
  const currentEnd =
    earliestInstant(target.validUntil, target.governsUntil)?.getTime() ??
    Number.POSITIVE_INFINITY;
  const handOver = Math.min(candidate.validFrom.getTime(), currentEnd);
  const removedFrom = Math.max(target.validFrom.getTime(), handOver);
  const removedTo = Math.min(currentEnd, at.getTime());
  return removedFrom < removedTo;
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
 * Retained versions whose **effective** window overlaps the candidate's
 * declared window — **the full retained history, retired versions included**
 * (OQ-86 Option C, decided 2026-10-12; ADR-0046 Decision 4's pairwise-disjoint
 * invariant). A retired version contributes only the window in which it really
 * governed (`[validFrom, min(validUntil, governsUntil))`), so its retained tail
 * can never block a legitimate renewal — but a candidate that lands inside a
 * window a version has already governed is an overlap and is refused.
 *
 * Before the decision this function filtered on `isEligibleAt`, so a backdated
 * non-superseding document could cover an interval a retired version had
 * governed (the documented "Gap C"). It does not any more: the historical
 * windows are part of the invariant.
 */
export function overlappingVersions(
  candidate: Pick<RetainedLicenseVersion, 'validFrom' | 'validUntil'>,
  versions: readonly RetainedLicenseVersion[],
): RetainedLicenseVersion[] {
  return versions.filter((version) => {
    const window = effectiveWindow(version);
    return windowsIntersect(
      candidate.validFrom,
      candidate.validUntil,
      window.start,
      window.end,
    );
  });
}

/**
 * The subset of `overlappingVersions` that still governs at `at` — the
 * versions a candidate can implicitly take over from (OQ-80 Option B: the
 * later-starting version governs from its own `validFrom`) or explicitly
 * supersede. A retired version is never in this set: its governance already
 * ended.
 */
export function eligibleOverlappingVersions(
  candidate: Pick<RetainedLicenseVersion, 'validFrom' | 'validUntil'>,
  versions: readonly RetainedLicenseVersion[],
  at: Date,
): RetainedLicenseVersion[] {
  return overlappingVersions(candidate, versions).filter((version) =>
    isEligibleAt(version, at),
  );
}

/**
 * The end of what a license identity has ever covered, as retained: the latest
 * effective end of its versions (`null` end = perpetual = never ends). Used by
 * the OQ-80 G2 rule — a renewal may not leave a gap, so its own `validFrom`
 * must not be later than this instant.
 */
export function retainedCoverageEnd(
  licenseId: string,
  versions: readonly RetainedLicenseVersion[],
): Date | null {
  let end: Date | null = null;
  for (const version of versions) {
    if (version.licenseId !== licenseId) continue;
    const window = effectiveWindow(version);
    if (window.end === null) return null; // perpetual: open-ended coverage
    if (end === null || window.end.getTime() > end.getTime()) {
      end = window.end;
    }
  }
  return end;
}

/**
 * The §8.6 half that needs the capacity-conflict flow: does the candidate take
 * capacity or entitlements away from the version it retires?
 *
 * PDR-11 §8.6 requires a version that **reduces entitlements or capacity** to
 * be checked against the resulting state, explained, preserved and explicitly
 * resolved **before** it is applied; §8.2 (module entitlement removed) and
 * §8.4 (user capacity reduced) are the concrete Musts, and both are conflicts
 * with *current usage* — a document cannot know how many users or
 * organizations exist, so it cannot resolve them by being signed.
 *
 * That is why this predicate applies to **every** path that retires a version:
 * an explicit `supersedesOperationId`, the implicit hand-over of OQ-80 Option
 * B, and the legacy `VLIC1` replacement. Naming the version to retire proves
 * *which* version the document replaces; it is not the resolution §8.6
 * requires, and it may not switch §8.6 off. Until L-04 implements the
 * check/explain/preserve/explicit-resolution flow, a reduction is refused
 * (`reduction-requires-resolution`, 409, nothing written) — when L-04 lands,
 * this predicate becomes the conflict detector of that flow instead.
 *
 * `null` is unlimited, so replacing an unlimited limit with a number is a
 * reduction too. An entitlement the predecessor granted and the candidate does
 * not is a reduction; a different or additional set is not.
 */
export function reducesCapacityOrEntitlements(
  predecessor: Pick<
    RetainedLicenseVersion,
    'organizationLimit' | 'userLimit' | 'entitlements'
  >,
  candidate: Pick<
    RetainedLicenseVersion,
    'organizationLimit' | 'userLimit' | 'entitlements'
  >,
): boolean {
  if (
    limitReduced(predecessor.organizationLimit, candidate.organizationLimit)
  ) {
    return true;
  }
  if (limitReduced(predecessor.userLimit, candidate.userLimit)) {
    return true;
  }
  const granted = new Set(
    candidate.entitlements.map((entry) => `${entry.kind}:${entry.code}`),
  );
  return predecessor.entitlements.some(
    (entry) => !granted.has(`${entry.kind}:${entry.code}`),
  );
}

/**
 * The second half: does the candidate end coverage the predecessor left open
 * (a perpetual version handed over to a time-limited one)?
 *
 * Evaluated only where the retiring instruction does **not** name the version:
 * the implicit hand-over of OQ-80 Option B and the legacy `VLIC1` replacement.
 * This is the Product Owner's final decision of 2026-10-12 (OD-LIC-01,
 * `docs/decisions/product/PDR-12-license-term-supersession.md`): a signed
 * supersession that names the version it retires may change the term — the
 * operator states, in a signed and audited document, until when the license now
 * runs, which is the explicit instruction §12.9 asks for — while naming a
 * version can never resolve a capacity conflict, because a document cannot
 * observe how many users or organizations exist. That is why the two arms
 * differ; see `docs/licensing/version-model-and-file-exchange.md` §3.3.
 */
export function closesOpenEnd(
  predecessor: Pick<RetainedLicenseVersion, 'validUntil'>,
  candidate: Pick<RetainedLicenseVersion, 'validUntil'>,
): boolean {
  return predecessor.validUntil === null && candidate.validUntil !== null;
}

/**
 * The full PDR-11 §8.6 guard used where the retirement is not named by a signed
 * document: capacity/entitlements shrinking (see
 * {@link reducesCapacityOrEntitlements}) **or** an open end being closed (see
 * {@link closesOpenEnd}).
 */
export function reducesRetainedGrant(
  predecessor: Pick<
    RetainedLicenseVersion,
    'validUntil' | 'organizationLimit' | 'userLimit' | 'entitlements'
  >,
  candidate: Pick<
    RetainedLicenseVersion,
    'validUntil' | 'organizationLimit' | 'userLimit' | 'entitlements'
  >,
): boolean {
  return (
    closesOpenEnd(predecessor, candidate) ||
    reducesCapacityOrEntitlements(predecessor, candidate)
  );
}

/** `null` is unlimited: a number where the predecessor had none is a reduction. */
function limitReduced(previous: number | null, next: number | null): boolean {
  if (previous === null) return next !== null;
  if (next === null) return false;
  return next < previous;
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
 * Why an import cannot be applied against the retained state. The document is
 * authentic; the state is the problem.
 *
 * 409 (retained-state conflict, ADR-0046): `duplicate-operation`,
 * `unknown-supersession`, `overlapping-range`, `license-binding-conflict`,
 * `installation-customer-mismatch`, `transfer-not-applicable`, `renewal-gap`
 * and `reduction-requires-resolution`.
 *
 * 422 (the document's own temporal window or capability set can never be
 * applied as issued, so a re-issued document is the fix): the temporal
 * `backdated-supersession`, plus `expired-document`, `not-yet-valid` and the
 * document-level verdicts of the pipeline. No reason here ever writes anything.
 *
 * `installation-customer-mismatch`, `transfer-not-applicable`, `renewal-gap`
 * and `reduction-requires-resolution` were introduced by the Owner decisions of
 * 2026-10-12 (Q4 customer transfer, OQ-80 G2, OQ-80 Option B with PDR-11 §8.6);
 * the reduction guard applies to the explicit supersession path as well, so no
 * precedence path can apply a reduction silently.
 * Like `license-binding-conflict` before them, their *names* and their HTTP
 * class are the implementation's reading of the approved texts and are recorded
 * for Product Owner ratification; the refusals themselves are the decided
 * policy.
 */
export type ImportConflictReason =
  | 'duplicate-operation'
  | 'unknown-supersession'
  | 'overlapping-range'
  | 'backdated-supersession'
  | 'license-binding-conflict'
  | 'installation-customer-mismatch'
  | 'transfer-not-applicable'
  | 'renewal-gap'
  | 'reduction-requires-resolution';

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

/**
 * The document's own content, as the conflict authority needs it: the declared
 * window, its commercial identity, and the grant (limits and entitlements) the
 * PDR-11 §8.6 guard compares against a version an import would implicitly
 * retire.
 */
export interface ImportCandidate {
  validFrom: Date;
  validUntil: Date | null;
  licenseId: string;
  customerId: string;
  organizationLimit: LicenseLimit;
  userLimit: LicenseLimit;
  entitlements: readonly LicenseEntitlement[];
}

/**
 * The explicit customer-transfer operation (Owner decision 2026-10-12, Q4).
 *
 * Its presence — and nothing else — authorizes one import to change the
 * installation's commercial customer. It is produced by the dedicated,
 * permission-gated, audited operation, never inferred from a document that
 * simply names a different `customerId`: a differing customer on the normal
 * import path is refused as `installation-customer-mismatch`.
 */
export interface CustomerTransferIntent {
  /** Mandatory operator reason; carried onto the transfer audit event. */
  reason: string;
}

export interface EvaluateImportConflictsParams {
  candidate: ImportCandidate;
  operationId: string;
  documentHash: string;
  supersession: ImportSupersessionIntent;
  versions: readonly RetainedLicenseVersion[];
  /** The import instant every time-dependent rule is evaluated at. */
  at: Date;
  /** The installation's current commercial customer (null = not bound yet). */
  installationCustomerId?: string | null;
  /** Set only by the explicit transfer operation; null on every other path. */
  customerTransfer?: CustomerTransferIntent | null;
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
 *    2a. a license identifier that this installation already retains under a
 *    different customer is refused (`license-binding-conflict`): a license is
 *    bound to exactly one customer (PDR-11 §2.1 terms, ADR-0046 Decision 2),
 *    so a renewal may not re-bind the commercial identity to another customer
 *    and silently re-attribute every retained version. The cross-installation
 *    half of the binding is enforced by the transaction under the lock
 *    (`LicensesRepository.importVersion`), which can see every installation;
 *    2b. the **installation's** customer binding is never changed by an import
 *    (Owner decision 2026-10-12, Q4): a document whose customer differs from
 *    the installation's current one is refused (`installation-customer-mismatch`)
 *    unless the caller carries an explicit, authorized transfer intent. A
 *    transfer request that names the customer the installation already has is
 *    refused as `transfer-not-applicable` — there is nothing to transfer — so a
 *    repeated or concurrent transfer can never silently re-apply;
 * 3. an explicit supersession target (the retained version carrying the
 *    declared operation id) must exist in this installation, must not have a
 *    supersession recorded yet, and must still govern at `at` — a version is
 *    retired once, so two competing successors cannot be booked;
 * 4. **no overlap with retained history** (OQ-86 Option C, 2026-10-12): the
 *    candidate's window may not intersect the *effective* window of any
 *    retained version unless that version is the one it retires. Retired
 *    versions count: a backdated non-superseding document that lands inside an
 *    interval a version already governed is refused (`overlapping-range`), so
 *    effective windows stay pairwise disjoint including retired history and no
 *    as-of read can become `ambiguous`. Gap-filling backwards stays allowed
 *    where it overlaps nothing and does not leave a gap (rule 7);
 * 5. a signed document that starts later than exactly one still-governing
 *    version it overlaps takes that version over at its own `validFrom`
 *    (OQ-80 **Option B**, 2026-10-12): the later start governs, the predecessor
 *    stops governing exactly there, nothing is stacked and the hand-over is
 *    stamped and audited like an explicit supersession. A document that starts
 *    at or before such a version cannot take precedence and is refused; a
 *    candidate that would leave more than one hand-over is refused rather than
 *    guessed;
 * 6. a supersession (explicit or the implicit one of rule 5) may not hand over
 *    in the past: if retiring the target at the candidate's own `validFrom`
 *    would remove governance it has already exercised before `at`
 *    (`supersessionRewritesPastGovernance`), the import is refused as
 *    `backdated-supersession` instead of rewriting which version governed a
 *    past instant. A hand-over at or after `at`, and a target that had already
 *    ended (its `validUntil` pins its window, so the stamp shortens nothing),
 *    stay allowed;
 * 6b. **a reduction is never applied by precedence** (PDR-11 §8.6, review fix
 *    on PR #141): when the candidate retires a version whose **capacity or
 *    entitlements** it shrinks — the explicit supersession target, the version
 *    an implicit hand-over takes over, or the version a legacy code replaces —
 *    the import is refused as `reduction-requires-resolution` (409, nothing
 *    written) until L-04 implements §8.6's check/explain/preserve/explicit-
 *    resolution flow. A signed `supersedesOperationId` proves which version
 *    the document replaces; it is not a resolution of the capacity or
 *    entitlement conflict, so it may not switch §8.6 off. Closing an open end
 *    (perpetual → time-limited) is the other arm of the same guard, and is
 *    evaluated only where the document does not name the version it retires:
 *    an implicit hand-over or a legacy replacement. An explicit signed
 *    supersession MAY make that term change — the Product Owner's final
 *    decision of 2026-10-12 (OD-LIC-01, PDR-12) — and only that change: every
 *    capacity/entitlement arm above still runs on that path. Increases and
 *    identical grants are unaffected, and so is a document that retires
 *    nothing (`supersedes` null): with no predecessor retired there is no
 *    grant to take away;
 * 7. a **renewal** may not leave a gap (OQ-80 **G2**, 2026-10-12): when the
 *    candidate carries the identity of a retained license, its `validFrom` may
 *    not be later than that license's retained coverage end
 *    (`renewal-gap`). Adjacency — the previous exclusive end equals the new
 *    `validFrom` — is contiguous, not a gap. A candidate that carries a
 *    **new** license identity is not a renewal of a retained license; whether a
 *    new identity may cover a lapse is an Owner question that is still open
 *    (OQ-87) and no rule here grants or refuses it;
 * 8. a legacy `VLIC1` text code keeps its documented L-02 lifecycle rules
 *    unchanged — at most one overlapping version that is still governing and
 *    has no recorded supersession, and never a hand-over in the past (which its
 *    default 2020 window would otherwise be). The historical rule 4, the
 *    reduction guard 6b and the gap rule 7 apply to it as well, added after its
 *    own rules so no existing refusal changes its reason.
 */
export function evaluateImportConflicts(
  params: EvaluateImportConflictsParams,
): ImportConflictEvaluation {
  const { candidate, operationId, documentHash, supersession, versions, at } =
    params;
  const installationCustomerId = params.installationCustomerId ?? null;
  const customerTransfer = params.customerTransfer ?? null;

  if (findVersionByOperationId(versions, operationId) !== null) {
    return conflictOnly({ reason: 'duplicate-operation', overlapping: 0 });
  }
  if (versions.some((version) => version.documentHash === documentHash)) {
    return conflictOnly({ reason: 'duplicate-operation', overlapping: 0 });
  }
  if (
    versions.some(
      (version) =>
        version.licenseId === candidate.licenseId &&
        version.customerId !== candidate.customerId,
    )
  ) {
    return conflictOnly({ reason: 'license-binding-conflict', overlapping: 0 });
  }

  const customerChanges =
    installationCustomerId !== null &&
    installationCustomerId !== candidate.customerId;
  if (customerTransfer === null) {
    if (customerChanges) {
      return conflictOnly({
        reason: 'installation-customer-mismatch',
        overlapping: 0,
      });
    }
  } else if (!customerChanges) {
    return conflictOnly({ reason: 'transfer-not-applicable', overlapping: 0 });
  }

  let target: RetainedLicenseVersion | null = null;
  if (supersession.kind === 'explicit') {
    const found = findVersionByOperationId(versions, supersession.operationId);
    if (
      found === null ||
      hasRecordedSupersession(found) ||
      !isEligibleAt(found, at)
    ) {
      return conflictOnly({ reason: 'unknown-supersession', overlapping: 0 });
    }
    target = found;
  }

  // Everything the candidate overlaps in the FULL retained history, minus the
  // version it retires (a retirement is the one sanctioned overlap).
  const others = overlappingVersions(candidate, versions).filter(
    (version) => version.versionId !== target?.versionId,
  );

  if (supersession.kind === 'implicit') {
    // Legacy `VLIC1`: its documented L-02 rules first, unchanged.
    const eligible = others.filter((version) => isEligibleAt(version, at));
    if (eligible.length > 1) {
      return conflictOnly({
        reason: 'overlapping-range',
        overlapping: eligible.length,
      });
    }
    const implicitTarget = eligible[0] ?? null;
    if (implicitTarget !== null && hasRecordedSupersession(implicitTarget)) {
      // A text code cannot express which successor it would join; refuse rather
      // than rewrite a supersession that an earlier document already recorded.
      return conflictOnly({ reason: 'overlapping-range', overlapping: 1 });
    }
    if (
      implicitTarget !== null &&
      supersessionRewritesPastGovernance(implicitTarget, candidate, at)
    ) {
      return backdatedSupersession();
    }
    // Then the new rules: retained history (rule 4) and the gap rule (rule 7).
    const historic = others.filter(
      (version) =>
        version.versionId !== implicitTarget?.versionId &&
        !isEligibleAt(version, at),
    );
    if (historic.length > 0) {
      return conflictOnly({
        reason: 'overlapping-range',
        overlapping: historic.length,
      });
    }
    if (
      implicitTarget !== null &&
      reducesRetainedGrant(implicitTarget, candidate)
    ) {
      // The same §8.6 guard as the signed paths — capacity, entitlements and
      // the open end — because a text code does not name the version it
      // replaces either. Replacing the governing version with a smaller grant
      // is a reduction this release cannot resolve, whatever transport carried
      // the document.
      return conflictOnly({
        reason: 'reduction-requires-resolution',
        overlapping: 1,
      });
    }
    if (leavesRenewalGap(candidate, versions)) {
      return conflictOnly({ reason: 'renewal-gap', overlapping: 0 });
    }
    return { conflict: null, supersedes: implicitTarget };
  }

  // Rule 4 — retired effective windows are never silently overlapped.
  const retired = others.filter((version) => !isEligibleAt(version, at));
  if (retired.length > 0) {
    return conflictOnly({
      reason: 'overlapping-range',
      overlapping: retired.length,
    });
  }
  if (others.length > 1) {
    return conflictOnly({
      reason: 'overlapping-range',
      overlapping: others.length,
    });
  }

  const overlap = others[0] ?? null;
  let supersedes = target;
  if (target === null && overlap !== null) {
    // Rule 5 (OQ-80 Option B): the later start governs at the overlap.
    if (overlap.validFrom.getTime() >= candidate.validFrom.getTime()) {
      return conflictOnly({ reason: 'overlapping-range', overlapping: 1 });
    }
    supersedes = overlap;
  }
  if (
    supersedes !== null &&
    supersessionRewritesPastGovernance(supersedes, candidate, at)
  ) {
    return backdatedSupersession();
  }
  if (
    supersedes !== null &&
    (target !== null
      ? // An explicitly named predecessor: capacity and entitlements are
        // protected on this path too (the review finding on PR #141). The
        // signed document says WHICH version it retires — it cannot say how
        // many users or organizations exist, so it is not the resolution
        // PDR-11 §8.6 requires, and it may not switch the guard off.
        reducesCapacityOrEntitlements(supersedes, candidate)
      : // Implicit precedence (OQ-80 Option B): the retirement itself is not
        // named by the document, so closing an open end is a reduction here as
        // well.
        reducesRetainedGrant(supersedes, candidate))
  ) {
    return conflictOnly({
      reason: 'reduction-requires-resolution',
      overlapping: 1,
    });
  }
  if (leavesRenewalGap(candidate, versions)) {
    return conflictOnly({ reason: 'renewal-gap', overlapping: 0 });
  }
  return { conflict: null, supersedes };
}

/**
 * OQ-80 G2: does this candidate leave a gap in the coverage of the license
 * identity it carries? Only a **renewal** — a candidate whose `licenseId` is
 * already retained for this installation — is evaluated; a new identity is not
 * a renewal of a retained license and no rule here says what it may cover
 * (OQ-87, open).
 *
 * `retainedCoverageEnd` is the latest effective end of the identity's retained
 * versions, and `null` means either "nothing retained for this identity" (no
 * gap can be left in coverage that never existed) or "perpetual" (coverage
 * never ends) — both mean the candidate leaves no gap.
 */
function leavesRenewalGap(
  candidate: ImportCandidate,
  versions: readonly RetainedLicenseVersion[],
): boolean {
  const coverageEnd = retainedCoverageEnd(candidate.licenseId, versions);
  if (coverageEnd === null) return false;
  return candidate.validFrom.getTime() > coverageEnd.getTime();
}

/** The single shape of a conflict evaluation (no supersession is resolved). */
function conflictOnly(conflict: ImportConflict): ImportConflictEvaluation {
  return { conflict, supersedes: null };
}

/** The single shape of the temporal refusal (rule 6). */
function backdatedSupersession(): ImportConflictEvaluation {
  return conflictOnly({ reason: 'backdated-supersession', overlapping: 0 });
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
