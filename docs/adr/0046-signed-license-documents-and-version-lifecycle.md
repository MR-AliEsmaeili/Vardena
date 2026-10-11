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
    deterministic documented conflict) and unique-index-only protection (an
    index can prove two rows are distinct, never that two windows are
    compatible). The live PostgreSQL suite
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
- `POST /api/v1/license/activate` keeps working for existing automation; the new
  `POST /api/v1/license/import` is the documented path for signed files and text.
- Evaluation becomes date-driven; expiry, suspension and the
  `ACTIVE|EXPIRED|SUSPENDED` vocabulary are unchanged, and full revocation,
  Grace/Read-Only enforcement, replacement and device licensing remain
  unimplemented and gated by their open items (PDR-11 §15).
- The version table is the future home of revocation/reactivation state; adding
  it now avoids a second lossy migration later.
