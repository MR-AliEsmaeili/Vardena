# ADR-0046: Signed license documents, retained license versions and deterministic effective-version resolution

- **Status:** Accepted for the first licensing implementation slice (extends ADR-0030 and ADR-0045; does not replace the enforcement chain). Corrected 2026-10-11 (Product-Owner review of PR #137): Decisions 4, 5 and 11 now state the supersession timeline and the import-serialization rule the code and tests implement.
- **Date:** 2026-10-11
- **Product source:** [PDR-11](../decisions/product/PDR-11-vardena-licensing-product-requirements.md) §§3, 5–6, 10–12, 17.2 (guardrails G-3, G-4, G-6, G-9); conflicts resolved or deferred in [PDR-11 §19.4](../decisions/product/PDR-11-vardena-licensing-product-requirements.md) and `docs/tasks/pdr-11-conflict-reconciliation.md`.
- **Design detail:** `docs/licensing/version-model-and-file-exchange.md`
- **Open items preserved:** OQ-45, OQ-53, OQ-74…OQ-85 (`docs/open-questions.md`)

## Context

The implemented foundation (L-01/L-02, ADR-0030, ADR-0045) delivers a license to
an installation as a signed **text code** (`VLIC1.<payload>.<signature>`) and
persists exactly one current license per installation: a new valid code replaces
the old row and marks it `replaced_at`. PDR-11 changes three of those premises —
signed **files** are the primary exchange (§11.3), a future-dated renewal must
coexist with a still-valid version (§3.2), and every operation needs an identity
so a replay cannot change state twice (§10.7, §12.4, G-6). PDR-11 §16 also
requires a design for the version state machine, formats/versioning, replay
protection and migration before any code changes (G-10, AR-29).

## Decision

1. **One signable artifact, two transports, one trust path.** The signed
   artifact is a canonical, versioned document
   `VLIC2.<payload-base64url>.<signature-base64url>` (Ed25519). A **file** is a
   versioned JSON envelope (`format: "vardena-license"`) carrying that artifact;
   pasted text is the same artifact without the envelope. Both decode to the
   exact same signed bytes and pass through one verification pipeline, so the
   text transport is never a weaker trust path (G-8). Legacy `VLIC1` codes keep
   importing through the same pipeline.
2. **License and LicenseVersion are separate, typed facts.** `licensing.licenses`
   becomes the installation-bound commercial license; `licensing.license_versions`
   holds every retained, signed version (dates, limits, status, entitlements,
   signing key id, document hash, source, operation id). Versions are retained,
   never overwritten (PDR-11 §14, CF-17).
3. **A signed document carries its operation.** Each v2 document names a unique
   `operationId`; applying it is a single transaction that inserts the version
   and its audit event. A second application of the same operation is rejected
   with a machine-readable conflict and changes nothing. Legacy `VLIC1` codes
   keep their documented idempotent no-op (`changed: false`) — the asymmetry is
   recorded as OQ-81 (PDR-11 PQ-8, CF-12).
4. **Future-dated documents are importable and take effect by date — including
   a future-dated supersession.** Import validates and retains a version whose
   window starts in the future; the currently effective version keeps governing
   until the instant it is actually replaced (PDR-11 §3.2, CF-1/CF-2). A
   retained version therefore carries **two separate instants**:
   `superseded_at` records *when* a supersession was recorded (the successor's
   import instant) and never influences evaluation, while `governs_until`
   records *from when* the version stops governing — the successor's own
   `validFrom`. Importing a successor that starts in 2027 therefore leaves
   today's license in force and hands over exactly at 2027-01-01, instead of
   retiring the governing version at import time.
   Evaluation resolves the effective version from the retained versions at
   every read, using one rule set: a version governs at an instant when its
   window covers the instant AND it has not been retired by then. At most one
   version governs any instant — after every import the effective windows
   `[valid_from, min(valid_until, governs_until))` of an installation are
   pairwise disjoint.
5. **Ambiguity is rejected, not resolved — and never silently.** Windows
   overlap only through an **explicit, signed** supersession
   (`supersedesOperationId`); otherwise the import is rejected and nothing is
   written (PDR-11 §3.4 leaves overlap resolution open — OQ-80). A legacy
   `VLIC1` text code may replace the single still-governing version it overlaps
   (its documented L-02 lifecycle), and nothing more. A version is retired at
   most once, so two competing successors cannot both be booked. Gaps are
   allowed: the previous version has expired, the next is not yet effective.
   The rule is evaluated by one function (`evaluateImportConflicts`), used both
   as the read-side pre-check and — authoritatively — inside the import
   transaction (Decision 11).
6. **Nothing licenses a customer installation into identity.** Import never
   creates, recreates or adopts an installation identity; the document must name
   the identity that already exists (PDR-11 §5.1, §6.5, CF-5).
7. **Rotation is a trust-list operation.** Trusted public keys may carry key
   ids; a document that names an untrusted key is rejected with a distinct
   reason. Already-imported versions stay effective without re-verification, so
   ordinary rotation cannot invalidate a valid perpetual license (PDR-11 §3.1,
   §4.4, CF-8).
8. **Restore and identity loss stay outside licensing enforcement.** Import adds
   no startup gate, no network call and no check on any backup/restore path
   (PDR-11 §6.7, G-9). The dedicated installation **identity key** required by
   §5.1 is specified but **not implemented** here: its storage depends on the
   backup-encryption design (PDR-11 U-2) and its loss path on the replacement
   workflow (PDR-11 U-9, PQ-3) — both still open. Until then the installation id
   remains the binding identifier (ADR-0045 Decision 1).
9. **Owner-side issuance boundary.** Signing stays outside the product: no
   private key is stored, accepted or served by the application; the development
   CLI is the only issuer in the repository and refuses `NODE_ENV=production`
   (PDR-11 §4.4, G-3, CF-19).
10. **Audit is typed.** Import outcomes (applied / rejected / unchanged /
    superseded) are written to a typed `licensing.license_audit_events` table
    inside the same transaction as the state change (PDR-11 §12.7). A
    supersession audit row names the version the transaction actually retired —
    the transaction refuses the import if that differs from the version the
    read-side pass resolved, so an audit row can never describe a retirement
    that did not happen.
11. **Concurrent imports of one installation are serialized in the database.**
    The import transaction first takes a `SELECT … FOR UPDATE` row lock on the
    installation row, then re-reads the retained versions and re-runs the
    conflict evaluation under that lock (READ COMMITTED, so the post-lock read
    sees the winner's committed rows). Two imports with incompatible windows
    can therefore not both commit: the loser waits, reads the winner's state
    and is refused with the documented `409`, having written **nothing** — no
    version, no entitlement, no supersession stamp, no `applied` audit event.
    The lock is a database row lock, so it holds across processes (API, worker,
    several containers); a process-local mutex is explicitly not the mechanism.
    The wait is bounded by the transaction timeout (`LOCK_WAIT_TIMEOUT_MS`,
    10 s), after which the transaction aborts without writing (an operational
    condition, reported as a server error rather than a license conflict).
    Rejected alternatives: serializable isolation alone (relies on predicate
    locks and answers with retryable serialization failures instead of a
    deterministic documented conflict); unique-index-only protection (an index
    can prove two rows are distinct, never that two windows are compatible); and
    an installation-keyed `pg_advisory_xact_lock` — the pattern the limit
    counters use — which would serialize just as well but needs a derived key
    space and cannot notice that the installation row is gone, whereas the
    import already updates that row in the same transaction, so locking it is
    both the natural mutual exclusion and an existence check. The live PostgreSQL suite
    (`test/licensing-persistence-live.e2e-spec.ts`) drives concurrent imports
    and asserts the invariant directly in SQL.

## Consequences

- The L-02 tables and their consumer (`LicensingService`,
  `PersistentLicenseProvider`) change shape; a committed migration moves existing
  rows into the version model with no loss of validity, history or idempotency,
  and a rehearsal proves it on a populated database. A second, ordered migration
  adds the `governs_until` column, backfills it (the successor's `valid_from`
  when the successor is recorded, else the recorded instant) — which *repairs*
  installations that the pre-correction behaviour retired prematurely — and
  enforces with a check constraint that the recorded instant and the hand-over
  instant are always set together.
- For rows migrated from L-02 the recorded instant and the hand-over instant
  coincide (the replaced-by pointer was never persisted), so an as-of read
  strictly before a recorded supersession can report two covering versions
  (deterministic defensive path, logged). Evaluation at the present and the
  future is exact, and every import after the correction satisfies the
  disjoint-window invariant by construction.
  *Addendum (2026-10-11, Product-Owner temporal directive):* "by construction"
  is now enforced for the past too. An import whose supersession would remove
  governance the retired version already exercised before the import instant is
  refused (`backdated-supersession`, 422, nothing written, operation id not
  retained) by the same conflict authority, on both passes; a hand-over at or
  after the import instant, and a correction of a version that had already ended
  (its `valid_until` pins its window, so the stamp shortens nothing), stay
  allowed. No schema change and therefore no migration: the rule is
  `supersessionRewritesPastGovernance`, evaluated inside
  `evaluateImportConflicts`. Whether the Owner may authorise retroactive
  documents — and what tolerance applies at the import instant — is not decided
  by PDR-11 §3.2/§3.4 and is registered as **OQ-86**; this refusal is the
  interim fail-closed behaviour. The legacy `VLIC1` replacement of a
  still-governing version falls under the same rule and is part of that
  question.
- *Addendum (2026-10-11, post-merge verification of PR #137):* the license
  binding of Decision 2 is enforced for identifiers, not only for documents. A
  `licenseId` retained for this installation under another customer, or owned by
  another installation, is refused as `license-binding-conflict` (409, nothing
  written) — by the shared evaluation for the first case and under the installation
  lock, before any upsert, for the second. Before this addendum a re-bound customer
  was applied silently and a foreign identifier surfaced as an unmapped database
  error. See `docs/licensing/version-model-and-file-exchange.md` §3.5. The
  backdated-overlap case described in the OQ-86 evidence is **not** changed by
  this addendum and remains an Owner decision.
- *Addendum (2026-10-12, PR #138):* the identifier is claimed by a plain `INSERT`,
  not an upsert, so the primary key arbitrates a concurrent claim by a different
  installation (the installation lock serializes only one installation). The
  loser is refused as `license-binding-conflict` inside the transaction. The
  pre-check alone was not a sufficient guard.
- *Addendum (2026-10-12, Owner decisions on OQ-80/OQ-86)*: Decision 4's
  pairwise-disjoint wording is now the implemented rule, not a divergence. The
  overlap check evaluates the **effective window**
  `[valid_from, min(valid_until, governs_until))` of **every** retained version,
  retired versions included (OQ-86 **Option C**), so a document that lands inside
  a window a version has already governed is refused (`overlapping-range`, 409,
  nothing written). Decision 5's gap permission is narrowed by OQ-80 **G2**: a
  candidate carrying the identity of a retained license may not start later than
  that license's retained coverage end (`renewal-gap`, 409, nothing written);
  adjacency is contiguous, not a gap. Decision 3's explicit supersession keeps
  its meaning, and the later-starting version now takes over implicitly at its
  own `validFrom` when it overlaps exactly one still-governing version (OQ-80
  **Option B**), stamped and audited like an explicit retirement; the PDR-11
  §8.6 check/explain/preserve/explicit-resolution flow is still required for a
  reducing change and is not bypassed by the precedence rule: since the review
  fix on PR #141 the capacity/entitlement guard runs on **every** path that
  retires a version — an explicit signed supersession included, naming the
  version to retire being a statement about *which* version is replaced and not
  a resolution — and it refuses with `reduction-requires-resolution` until L-04
  exists. Decision 5's hand-over is therefore *not* a permission to shorten a
  term: closing an open end is a reduction where the document does not name the
  version it retires. **Decision 3's explicit supersession is the one path that
  may change the term**: by the Product Owner's final decision of 2026-10-12
  (**OD-LIC-01**, [PDR-12](../decisions/product/PDR-12-license-term-supersession.md))
  a perpetual grant (`validUntil = null`) may be replaced by a time-limited one
  through an explicit, valid, signed supersession — and *only* that: the
  retired version's `organizationLimit`, `userLimit` and granted entitlements
  may not be reduced on any path, because a signed document cannot observe how
  many users or organizations exist and so cannot resolve a PDR-11 §8.6
  conflict. The legacy `VLIC1` restriction,
  strict import tolerance and as-of recomputation are unchanged. Decisions are
  recorded verbatim, with consequences and the blocked follow-on (OQ-87), in
  `docs/tasks/licensing-oq-80-oq-86-decision-brief.md` §7/§8.
- `POST /api/v1/license/activate` keeps working for existing automation; the new
  `POST /api/v1/license/import` is the documented path for signed files and text.
- Evaluation becomes date-driven; expiry, suspension and the
  `ACTIVE|EXPIRED|SUSPENDED` vocabulary are unchanged, and full revocation,
  Grace/Read-Only enforcement, replacement and device licensing remain
  unimplemented and gated by their open items (PDR-11 §15).
- The version table is the future home of revocation/reactivation state; adding
  it now avoids a second lossy migration later.
- *Addendum (2026-10-14, overlap-authority correction):* Decision 4's
  pairwise-disjoint wording is the rule, without exception for a document that
  names a supersession target. `evaluateImportConflicts` used to keep the named
  target and silently ignore a *second* retained version the candidate also
  overlapped, so a signed document naming one version while overlapping another
  was applied and left two versions governing the same instants — the
  `ambiguous` defensive read this model exists to avoid. The authority now
  refuses that document with `overlapping-range` (409, nothing written, the
  operation id unused): a supersession sanctions exactly the ONE version it
  names, an unnamed overlap is only ever the OQ-80 Option B hand-over, and the
  legacy `VLIC1` arm gains no bypass. No decision, HTTP class or OQ status
  changes; recorded with its tests in
  [the task record](../tasks/licensing-explicit-supersession-overlap-correction.md).
- *Addendum (2026-10-14, L-06 / OD-LIC-03, [PDR-14](../decisions/product/PDR-14-licensing-customer-code.md)):*
  Every licensing customer row in `licensing.customers` carries a stable,
  independent business `customer_code` (`VARCHAR(64) NOT NULL`, unique via
  `uq_customers_customer_code`, validated by `customers_customer_code_check`
  and distinct from `id`) alongside internal database identity `id`
  (`customerId`) and mutable display name `display_name` (`customerName`).
  Signed `VLIC2` and `VLIC1` payloads include `customerCode` in canonical wire
  order (`customerId`, `customerCode`, `customerName`) covered by the Ed25519
  signature; issuance and CLI require explicit valid `customerId` and
  `customerCode`; ordinary license import never overwrites an existing
  customer's stored `display_name`; and `evaluateImportConflicts` /
  `LicensesRepository.importVersion` reject any mismatch between `(customerId,
  customerCode)` and persisted customer records as `customer-code-mismatch`
  (HTTP 409, nothing written).

