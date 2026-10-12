# Licensing version model, signed documents and file exchange — technical design

| Field | Value |
| --- | --- |
| Status | ACTIVE design record for the first implementation slice (L-03) |
| Authority | [ADR-0046](../adr/0046-signed-license-documents-and-version-lifecycle.md) (decision) · [PDR-11](../decisions/product/PDR-11-vardena-licensing-product-requirements.md) (product source) |
| Date | 2026-10-11 |
| Scope | Server license import: signed document format, retained versions, effective-version resolution, replay protection, audit, migration, API and frontend boundary |
| Out of scope (unchanged, gated) | Owner-side licensing system, CRM/billing, client-device licensing, server replacement, full revocation/reactivation, Grace/Read-Only enforcement, installation identity key, clock-rollback enforcement, test/training entitlements |

This record is the design detail behind ADR-0046. Where PDR-11 leaves a product
question open, this document says so explicitly and fails closed instead of
inventing policy. Registered open items are listed in `docs/open-questions.md`
(OQ-74…OQ-85) and cross-referenced from PDR-11 §19.4.

---

## 1. Terms and the typed model

```text
licensing.customers            commercial party (minimal, not CRM)
licensing.installations        ONE Vardena server installation (is_self, L-02)
licensing.licenses             the commercial License: customer + installation
licensing.license_versions     every retained signed LicenseVersion
licensing.license_version_entitlements
licensing.license_audit_events typed, append-only licensing audit trail
```

PDR-11 §14 conceptual entities → implemented tables (CF-17):

| PDR-11 (§14) | Implemented | Note |
| --- | --- | --- |
| License | `licensing.licenses` | One row per commercial license; bound to one installation (one active installation per license, §5.3). Holds no dates and no entitlements: those belong to a version. It is deliberately minimal — it is also the future home of license-level revocation state (PDR-11 §10, OQ-78). |
| LicenseVersion | `licensing.license_versions` | Retained, never overwritten. Carries validity window, limits, status, entitlements, signing key id, document hash, operation id, source and import facts. Supersession is two facts, not one: `superseded_at` (when it was recorded) and `governs_until` (from when the version stops governing) — §3.1. |
| Customer / Contract | `licensing.customers` | Customer only. Contracts, pricing and billing are out of scope (PDR-11 §4.1/§17.1) and stay Owner-side. |
| ServerInstallation | `licensing.installations` | Unchanged from L-02 (ADR-0045 Decision 1). |
| ReplacementRecord | — | Not implemented; replacement workflow is a later slice (PDR-11 §5.5, U-9). |
| ClientDevice | — | Not implemented; client-device licensing is a later slice (PDR-11 §7). |
| AuditEvent | `licensing.license_audit_events` | Typed columns, append-only. Retention periods are open (PDR-11 U-7 → OQ-77). |

Status vocabulary is **unchanged** from ADR-0030/ADR-0045 —
`ACTIVE | EXPIRED | SUSPENDED` on a version, `UNLICENSED` as the absence of any
version. PDR-11 §3.5's *revoked* and the mapping of `SUSPENDED` (PQ-4) are open
(OQ-79); nothing here re-labels them, and no migration rewrites a status value.

## 2. The signed document

### 2.1 Artifact

```text
VLIC2.<base64url(canonical payload bytes)>.<base64url(Ed25519 signature)>
```

Canonical payload (fixed key order, sorted arrays, ISO-8601 UTC instants):

```json
{
  "v": 2,
  "kind": "SERVER_LICENSE_VERSION",
  "operationId": "01J…",
  "licenseId": "01J…",
  "customerId": "01J…",
  "customerName": "…",
  "installationId": "01J…",
  "status": "ACTIVE",
  "validFrom": "2027-01-01T00:00:00.000Z",
  "validUntil": "2028-01-01T00:00:00.000Z",
  "organizationLimit": 3,
  "userLimit": 25,
  "modules": ["accounting", "organization", "users"],
  "features": [],
  "supersedesOperationId": null,
  "issuedAt": "2026-10-11T00:00:00.000Z"
}
```

Rules: the payload must round-trip to **exactly** the signed bytes (canonical
form), `validUntil` is exclusive and `null` means perpetual, limits are
positive-or-null, module codes must be known to this build, feature codes must
match the code pattern, and no duplicates are allowed.

### 2.2 File envelope (primary transport)

```json
{
  "format": "vardena-license",
  "fileVersion": 1,
  "document": "VLIC2.…"
}
```

The envelope is **not trusted**: it carries no licensing fact and the parse
rejects unknown top-level keys. Its only jobs are (a) to make the file
self-describing and versionable and (b) to mark the transport for the audit
trail. Text transport is the bare artifact; `VLIC1` codes are accepted for
compatibility. All three decode into the same pipeline, so a text code is never
a weaker trust path than a file.

### 2.3 Trusted keys and rotation

`LICENSE_SIGNING_PUBLIC_KEYS` accepts comma-separated entries, each either bare
PEM/base64-DER (id derived from the key material) or `keyId:<material>`. If the
file's optional `keyId` hint is present, it must name a trusted entry — an
unknown id is rejected with its own reason (`unknown-key`) so the operator knows
to update the trust list — and verification uses that key only. Without a hint,
the document is verified against every trusted key. **Verification happens at
import only**: an already-retained version stays effective without touching the
key list, so retiring or rotating a key cannot invalidate a valid perpetual
license (PDR-11 §3.1, CF-8). Retiring a key therefore restricts *future* imports
signed with it; the retirement policy for revocation-era verification is a later
decision (PDR-11 U-1, U-3).

## 3. Version lifecycle and effectivity

### 3.1 Lifecycle

```text
import ──► retained (not yet effective | effective | expired)
                    │
                    └── supersession RECORDED (superseded_at = import instant of the successor)
                              │
                              └── governance ENDS (governs_until = successor.valid_from)
```

- A version is **retained** the moment it imports successfully; it is never
  overwritten and never deleted.
- **Not yet effective**: `validFrom > now`.
- **Effective**: `validFrom <= now < validUntil` (or `validUntil = null`) and not
  retired at `now` and `status = ACTIVE`.
- **Expired**: `validUntil <= now`. Expiry is derived, never written; the row is
  immutable.
- **Supersession has two instants, on purpose** (corrected 2026-10-11 after the
  Product-Owner review of the first implementation, which used the recorded
  instant for both):
  - `superseded_at` — **when the supersession was recorded** (the successor's
    import instant). Audit and traceability only; it never decides effectivity.
  - `governs_until` — **from when the version stops governing**. It is the
    retiring successor's `validFrom`, so the predecessor governs up to the
    instant the successor takes over and not one instant longer. This is what
    makes a future-dated renewal importable *without* interrupting the license
    that is valid today (PDR-11 §3.2, CF-1). For an ordinary replacement the two
    instants are different facts and are usually not equal. It is bounded by the
    import rule below: a hand-over that would remove governance the predecessor
    already exercised before the import is refused (§3.3, OQ-86).
  - Both are set together or not at all (enforced by a check constraint), and
    `superseded_by_version_id` names the successor.
  - A version is retired **at most once**: a second document naming an already
    retired (or no longer governing) predecessor is refused with
    `unknown-supersession`.
- **Revoked / Grace / Read-Only**: not implemented (PDR-11 §9, §10; OQ-45, OQ-78,
  OQ-79).

### 3.2 Deterministic effective-version resolution (at any instant `at`)

1. **Eligible at `at`** = retained versions that have not stopped governing by
   `at` (`governs_until IS NULL OR governs_until > at`). Note that
   `superseded_at` is *not* part of this rule: a version whose supersession is
   recorded but not yet in force is still eligible.
2. **Covering** = eligible versions whose window contains `at`.
3. Exactly one covering version → it governs; its `status` and dates then decide
   `active` / `inactiveReason` exactly as L-02 did (`status`, `expired`,
   `not-yet-valid`).
4. No covering version, but at least one eligible version **ended** before `at` →
   the one with the latest `validUntil` reports `expired` (a subscription that
   ended, even if a renewal is scheduled).
5. No covering and no ended version, but an eligible version is in the future →
   `not-yet-valid` (the earliest such version).
6. No eligible version at all → `UNLICENSED`. A version whose governance ended
   never becomes governing again: after a successor's window closes, the
   installation reads `expired` rather than resurrecting the retired
   predecessor.
7. More than one covering version — impossible for data written by the import
   path, which enforces the disjoint-window invariant (§3.3, §3.4) — is resolved
   deterministically (latest `validFrom`, then latest `imported_at`, then `id`)
   and logged as a data-integrity warning. This is a defensive failure mode for
   corrupted or manually edited data, **not** a product precedence rule, and it
   does not decide PDR-11 PQ-5 (OQ-80).

### 3.3 Overlap, gaps and supersession

- Half-open intervals (`[validFrom, validUntil)`); adjacency
  (`a.validUntil == b.validFrom`) is not an overlap; a `null` end is open-ended.
- The rule every import must satisfy is the **disjoint-window invariant**: after
  the import, the *effective windows* `[valid_from, min(valid_until,
  governs_until))` of the installation's retained versions are pairwise
  non-overlapping. An eligible version's effective window is simply its validity
  window; a retired version contributes only the window in which it really
  governed. Because the windows are pairwise disjoint, at most one retained
  version can govern any instant — the property the resolution (§3.2) relies on
  and the reason rule 7 is unreachable for data written by this code.
- An import whose window overlaps a version that still governs at the import
  instant is rejected unless the document explicitly supersedes that version by
  `operationId` (fail-closed default for the open PQ-5). Unknown, already-retired
  or already-stopped-governing targets are rejected (`unknown-supersession`).
  A **future-dated** start does not excuse an overlap: the candidate's window is
  compared with the retained windows, not with "now".
- **A reduction is never applied by an import.** PDR-11 §8.6 requires a version
  that reduces entitlements or capacity to be checked against the resulting
  state, explained, preserved and explicitly resolved *before* it is applied;
  §8.2 (module entitlement removed), §8.4 (user capacity reduced) and §8.3
  (capacity reached) are the Musts behind it. That flow is the L-04 slice and
  does not exist yet, so every path that retires a version fails closed while
  the retained grant shrinks: an explicit signed supersession
  (`supersedesOperationId`), the implicit hand-over of OQ-80 Option B, and the
  legacy `VLIC1` replacement all refuse a smaller `organizationLimit`, a smaller
  `userLimit` or a removed entitlement with `reduction-requires-resolution`
  (409, nothing written, no stamp, no version, the operation id not retained).
  *Naming the version to retire is not a resolution*: a signed
  `supersedesOperationId` proves **which** version the document replaces and is
  verified like every other signature fact, but it cannot know how many users
  or organizations exist, so it may not switch §8.6 off. Increases and
  identical grants are unaffected, and a document that retires nothing has no
  predecessor whose grant could be taken away.
- The **term** dimension is decided by the Product Owner (2026-10-12,
  [PDR-12](../decisions/product/PDR-12-license-term-supersession.md),
  decision **OD-LIC-01**): an explicit, valid, signed supersession **may**
  convert a perpetual grant into a time-limited one, and that is the only change
  it authorizes — `organizationLimit`, `userLimit` and the granted entitlements
  may not be reduced, on that path or any other (the arms above). Closing an
  open end is therefore refused as a reduction only where the document does
  **not** name the version it retires: the implicit hand-over of OQ-80 Option B
  and the legacy `VLIC1` replacement. A signed document that states, for a
  *named* version, until when the license now runs is the explicit, auditable
  instruction §12.9 asks for and resolves no capacity or entitlement conflict,
  so it is allowed; a signed document cannot observe how many users or
  organizations exist, which is why naming a version never unlocks a capacity or
  entitlement reduction. L-04 still owes §8.6's
  check/explain/preserve/explicit-resolution flow to every path; until it
  exists, those reductions are refused rather than resolved.
- A supersession is declared for exactly one version, and the hand-over is the
  candidate's own `validFrom`: overlap is allowed only in so far as it is
  replaced, so the predecessor's effective window ends exactly where the
  successor's begins. A supersession declared for a non-overlapping version is
  allowed and simply retires that version at the successor's start (a
  correction of an expired or scheduled version); it never creates ambiguity. A
  legacy code cannot express *which* version it replaces, so it may replace at
  most one still-governing version that has no recorded supersession; anything
  else is refused rather than guessed.
- **A supersession may not hand over in the past.** The hand-over is the
  candidate's own `validFrom`, so retiring a version at an instant that is
  already past removes coverage that version really had, and the as-of answer
  for that instant would silently change. `evaluateImportConflicts` therefore
  refuses a supersession whose hand-over would remove governance the target
  already exercised before the import instant: `backdated-supersession`
  (**422**, nothing written, the operation id stays unused so the document can
  be re-issued). The predicate is `supersessionRewritesPastGovernance` — the
  removed interval `[max(target.validFrom, min(candidate.validFrom,
  currentEnd)), min(currentEnd, at))`, with `currentEnd` the target's effective
  end before the stamp. Two neighbours stay allowed and move no recorded window:
  a hand-over **at or after** the import instant (the predecessor keeps
  governing until then), and a target that had **already ended** by its own
  `validUntil` (the stamp records the supersession, the effective window does
  not move) — the correction of an expired or scheduled version described above.
  Consequences of the same rule, to be decided together by the Owner (**OQ-86**):
  a legacy `VLIC1` code can no longer replace a version that still governs (its
  L-02 default window starts in 2020, and the L-02 lifecycle gate refuses a code
  whose window has not started), while a legacy renewal still works as
  *adjacency* — the code starts at or after the end of the version it follows and
  nothing is superseded. Documents that retire nothing are untouched: a past
  start on a first license or a gap-filling renewal stays importable and the gap
  behaviour above is unchanged.
- A **gap** is allowed. During it the installation is inactive with
  `inactiveReason: expired` (rule 4 above) — nothing is extended and no policy is
  invented.
- `superseded_at`, `governs_until` and `superseded_by_version_id` are the only
  fields written on an existing version row; validity, limits, entitlements and
  status of a retained version are immutable.
- The legacy backfill (§11) can leave a *past* instant with two covering versions
  (the replaced-by pointer of L-02 rows was never persisted, so a migrated row
  hands over at its recorded instant while its successor's window may start
  earlier). Evaluation at the present and the future is exact; the defensive
  path of §3.2 rule 7 covers only those historical instants and logs them.

### 3.4 Concurrency: one importer per installation, in the database

Two imports of the same installation can arrive at the same time (two operators,
a retry racing the original, two API processes behind a load balancer). The
conflict evaluation of §3.3 therefore cannot be a read-then-write in application
code: the read would be stale by the time the write commits.

- The import transaction takes a **`SELECT … FOR UPDATE` row lock on the
  installation row before it reads anything**, and holds it until commit or
  rollback. That lock is the serialization point: the second importer waits, and
  when it proceeds it reads the first importer's *committed* rows.
- The transaction runs in **READ COMMITTED** (PostgreSQL's default, requested
  explicitly): each statement takes a fresh snapshot, so the re-read *after* the
  lock observes the winner. Under `REPEATABLE READ` the snapshot would predate
  the wait and the re-check would be stale, which is why the level is pinned in
  code.
- **The conflict evaluation is re-run inside the transaction**, by the same
  function the read-side pre-check uses (`evaluateImportConflicts`), so the
  transaction decides and the pre-check is only a fast, informative rejection.
- The transaction must retire **exactly** the version the read-side pass
  resolved (it is named by the pre-built `license.version.superseded` audit row).
  If the committed state moved, the import is refused instead of writing an audit
  row that describes a retirement that did not happen.
- **Cross-installation claim of one license identifier**: two installations may both
  see a `licenseId` as unused, because the installation row lock serializes only one
  installation. The identifier is therefore claimed by a plain `INSERT` whose
  primary key arbitrates the race (not an upsert, which would silently adopt the
  other installation's row); the loser is refused as `license-binding-conflict`
  inside the transaction. The pre-check is not the guard (§3.5).
- **Failure semantics for the loser of a race**: the documented `409` for the
  conflict reason (`duplicate-operation`, `unknown-supersession`,
  `overlapping-range`, `license-binding-conflict`) and **nothing written** — no version, no entitlement, no
  supersession stamp, no `applied` audit event. A rejection audit row is written
  outside the transaction, like every other rejection.
- The lock is a **database** lock and therefore multi-process by construction
  (API and worker share the same row). A process-local mutex is explicitly not
  the mechanism. The unique indexes on
  `(installation_id, operation_id)` / `(installation_id, document_hash)` and the
  guarded supersession stamp remain as defence in depth; they cannot replace the
  lock, because distinct documents with incompatible windows satisfy every unique
  index.
- A loser waits at most `LOCK_WAIT_TIMEOUT_MS` (10 s, the interactive-transaction
  timeout). An import is milliseconds of work, so exceeding it means the database
  is unhealthy rather than the license conflicting: the transaction aborts, writes
  nothing, and the caller sees a server error.
- **Reads stay deterministic during concurrent imports**: each import is one
  transaction, so a reader observes either the state before it or the state after
  it, never a half-applied one, and the invariant of §3.3 holds in both.
- Rejected alternative: relying on `SERIALIZABLE` isolation alone. It answers
  with retryable serialization failures instead of the documented conflict, and it
  would leave the conflict reason to be inferred rather than evaluated.
- Rejected alternative: an installation-keyed `pg_advisory_xact_lock` (the
  pattern the licensed-limit counters use). It would serialize imports just as
  well, but it needs a derived key space and it succeeds even if the installation
  row has disappeared, whereas the import already updates the installation row in
  the same transaction — locking that row is both the natural mutual exclusion and
  an existence check.
- Proven by `test/licensing-persistence-live.e2e-spec.ts` on real PostgreSQL:
  two concurrent imports with the same window (three rounds), two concurrent
  imports of the same document, and two concurrent successors of one version —
  each asserting the SQL-visible invariant (one version, one `applied` event, one
  supersession stamp, no overlap) as well as the read path.


### 3.5 License binding: one customer, one installation (2026-10-11 correction)

A **license** (the commercial identity, `licensing.licenses`) is bound to exactly
one customer and to exactly one installation (PDR-11 §2.1; ADR-0046 Decision 2).
Versions of one license therefore share its customer, and an import may not change
it:

- a document whose `licenseId` is already retained for this installation under a
  **different customer** is refused as `license-binding-conflict` (409) by the
  shared evaluation (`evaluateImportConflicts`, rule 2a). An explicit supersession
  does not bypass this rule;
- a document whose `licenseId` belongs to **another installation** is refused as
  `license-binding-conflict` (409) inside the transaction, under the installation
  lock and before any upsert. Before this correction the foreign identifier reached
  the composite `(license_id, installation_id)` foreign key and surfaced as an
  unmapped database error (HTTP 500). The probe that reproduced it is recorded in
  `docs/tasks/licensing-post-merge-reconciliation.md` §3.

Nothing is written in either case. A same-customer renewal of the same license
remains an ordinary import. Both refusals are covered by the domain suite
(`license-version.spec.ts`) and by the live PostgreSQL suite
(`licensing-persistence-live.e2e-spec.ts`).

**Two installations claiming one unused identifier at the same moment.** The rules
above see only this installation's rows, and the installation lock serializes only
this installation. Two installations can therefore both read the identifier as
unused. The license row is claimed by an `INSERT` whose primary key is the
arbiter: the second claim waits for the first commit and then fails with a unique
violation, which the repository reports as `license-binding-conflict` inside the
transaction (rolled back, audited as a rejection). An upsert is not used for this
claim, because `INSERT … ON CONFLICT DO UPDATE` would silently adopt the other
installation's row and the failure would surface only as a composite foreign-key
error. Covered by the live PostgreSQL cases in `licensing-persistence-live.e2e-spec.ts`
("refuses a license identifier another installation committed while this import was
in flight" and "lets exactly one of two installations keep a license identifier…").

**Known behaviour under OQ-86 (not changed by this correction).** A
non-superseding document whose window lies entirely in the past may overlap the
*effective window* of a version that a later import retired (for example, a
backdated correction that falls inside the period in which a retired version
governed). The shared evaluation counts only versions that still govern at the
import instant, so such a document is currently accepted and an as-of read for
that period reports two covering versions (`ambiguous`). ADR-0046 Decision 4
states that effective windows are pairwise disjoint after every import; that
wording and the implemented rule disagree for this case, and the existing unit
test "never counts a superseded version as an overlap" pins the implemented rule.
Which one the Owner wants is the OQ-86 decision, so it is recorded there and not
changed here.

## 4. Import pipeline (strict order, nothing written until every stage passes)

| # | Stage | Rejection code |
| --- | --- | --- |
| 1 | Authorization: session + `Licensing.License.Activate` (route guard and application service, AR-21) | 401 / 403 |
| 2 | Transport parse: envelope or bare artifact (legacy `VLIC1` supported) | `malformed` |
| 3 | Payload version supported (`v: 1 | 2`, `fileVersion: 1`) | `unsupported-version` |
| 4 | Signature verified against trusted keys; unknown key hint rejected | `signature`, `unknown-key` |
| 5 | Canonical form / typed payload validation | `payload` |
| 6 | Installation binding: `installationId` is this installation's identity | `installation-mismatch` |
| 7 | Document semantics: interval, limits, entitlements, status `ACTIVE`, document not already expired at `now` | `validity`, `limits`, `entitlements`, `not-active`, `expired-document` |
| 8 | Replay: `operationId` (and artifact hash) already applied on this installation | `duplicate-operation` (409, no state change) |
| 9 | Version conflicts: overlap without explicit supersession, unknown/already-retired supersession target, supersession that would hand over before the import instant, a reduction of the retired version's capacity or entitlements (explicit supersession included), closing an open end where the version is not named, a license identifier already bound to another customer (§3.5) | `overlapping-range`, `unknown-supersession`, `license-binding-conflict`, `reduction-requires-resolution`, `renewal-gap` (409, no state change); `backdated-supersession` (422, no state change; OQ-86) |
| 10 | Persist: ONE transaction that **first locks the installation row and re-runs stages 8–9 under the lock** (§3.4), refuses a license identifier that belongs to another installation or customer (§3.5), then customer upsert, license upsert, version + entitlements insert, supersession stamps, audit event | `duplicate-operation`, `overlapping-range`, `unknown-supersession`, `license-binding-conflict` (409, no state change); `backdated-supersession` (422, no state change) |

Stages 8 and 9 share one implementation between the read-side pass and the
in-transaction pass, so the two cannot drift apart: the pre-check is an early,
informative rejection and the transaction's verdict is the one that decides.

Capacity validation in this slice is **shape** validation (positive-or-null
limits, known entitlements). PDR-11 §8.6 conflict detection against existing
users/organizations/devices is a later slice (L-04): it needs the owning
modules' public count contracts, and no destructive or automatic correction is
implemented anywhere. Until that slice exists the import path refuses a version
that would reduce the capacity or entitlements of the version it retires, on
every path (an explicit signed supersession included — see §3.3), so no
reduction is applied silently while the resolution flow is missing. Documented
as a gap in the implementation report.

## 5. Operations, replay and duplicates

- The v2 `operationId` is the operation's identity. Applying it inserts the
  version. The authoritative guard is the in-transaction check under the
  installation lock (§3.4); the unique index `(installation_id, operation_id)` —
  and the one on `(installation_id, document_hash)` — are the database backstop,
  so a double-apply cannot create two versions even if the check were bypassed.
- A duplicate v2 operation is **rejected** (409, `duplicate-operation`) and
  changes nothing (PDR-11 §10.8, G-6). Retry after an ambiguous failure is safe:
  the state is already correct and the second attempt is refused with a message
  that says so.
- A legacy `VLIC1` code has no operation id; its identity is its SHA-256 hash.
  Re-importing the same code keeps the documented L-02 behaviour: an idempotent
  no-op (`changed: false`, `outcome: unchanged`). Re-importing a *different*
  valid legacy code keeps the documented replacement semantics for the version
  that currently governs. PDR-11 PQ-8 asks whether the strict rule should apply
  to every operation type — that is **open** (OQ-81) and this asymmetry is the
  documented interim behaviour, not a product decision.
- A rejected operation is recorded in the audit trail with its outcome; it does
  **not** consume the operation id, so an operator may re-issue a corrected
  document with a new operation id at any time.

## 6. Transaction boundaries and failure recovery

One transaction per import, in the licensing schema only:

```text
BEGIN  (READ COMMITTED, 10 s timeout)
  SELECT ... FROM licensing.installations WHERE id = $1 FOR UPDATE   -- serialize per installation
  read licensing.license_versions                                   -- committed state under the lock
  evaluate the version invariant  (replay + overlap + supersession target)
    -> conflict: raise (409 reason), transaction rolls back, nothing written
  upsert licensing.customers        (id = payload.customerId, display name)
  upsert licensing.licenses         (id = payload.licenseId, installation, customer)
  insert licensing.license_versions (+ entitlements)
  stamp the retired version         (superseded_at = now, governs_until = candidate.valid_from,
                                     superseded_by_version_id = the new version)
  insert licensing.license_audit_events (superseded?, applied)
COMMIT
```

Order inside the transaction is fixed: the successor row is inserted **before**
the stamp, because `superseded_by_version_id` is an immediate foreign key to it,
and the stamp is a guarded update (`WHERE superseded_at IS NULL`).

- A failure at any statement rolls the whole import back: no license, no version,
  no entitlement, no supersession and no `applied` audit event survives. This is
  asserted by the live PostgreSQL suite — a duplicate operation refused inside the
  transaction, a failure *after* the customer/license/installation writes (a
  duplicated entitlement violating its unique index), and the losing side of three
  concurrent-import races.
- The losing side of a race is the same guarantee: it is refused by the
  in-transaction evaluation (or, if it lost earlier, by the read-side pass) and
  writes nothing (see §3.4).
- The current version is never replaced *before* the new one is validated: a
  failed import cannot deactivate a valid installation (ADR-0045 Decision 6 keeps
  its guarantee).
- Rejections are audited through a **separate** insert after the read-only checks
  (they never share the state-change transaction); the audit insert itself is
  best-effort for the request but never masks the rejection.
- No network, no outbox, no worker: import is a local, synchronous, offline-safe
  operation (PDR-11 §11.1).

## 7. Installation identity and its dedicated key (separation, not yet implemented)

- The installation **id** stays the backend-owned ULID in
  `licensing.installations` (ADR-0045 Decision 1). It is what a signed document
  binds to and what an operator quotes to obtain a license.
- The installation **identity key** (PDR-11 §5.1) is a *second*, independent
  fact: a per-installation Ed25519 key pair whose private part never leaves the
  server and whose public part can be included in requests, receipts and
  replacement records. **Design only in this slice.** Implementation is blocked
  by two open items, and the blocker is recorded rather than guessed:
  - storage and backup of the private part depend on the backup-encryption
    design (PDR-11 U-2; §6.1 requires it to be encrypted in the full backup and
    §6.2 forbids escrow);
  - key loss must lead to the replacement workflow (PDR-11 §6.4), which is not
    designed or approved (U-9, PQ-3 → OQ-78; replacement detail OQ-82).
- Therefore: import **never creates, recreates or adopts** an installation row.
  A document for an unknown installation is rejected (`installation-mismatch`)
  and leaves the database without any installation row — an identity is only ever
  created by `InstallationIdentityService` during bootstrap. A restored database
  that lacks identity material can never silently become the previous
  installation: it fails binding; recovery stays an Owner-side, auditable process
  (PDR-11 §6.5, CF-5).

## 8. Restore and recovery access

- Import adds **no** gate to backup, export or restore. Restore is an
  out-of-product, runbook-driven operation performed by the customer's IT/server
  administrator (OQ-53) and is not blocked by license state (G-9) — there is no
  licensing check on any such path, and this slice adds none.
- Full revocation (PDR-11 §10) is not implemented. Its recovery path must not
  depend on an ordinary licensed ERP session (§10.3), so the future slice is
  required to provide an offline, auditable, operator-level reactivation path
  that works while login is blocked. The product-level choice of that process is
  **open** (PQ-3 → OQ-78); only the constraint is recorded here.

## 9. Audit and security-sensitive logging

- `licensing.license_audit_events` rows are typed and append-only:
  `license.import.applied`, `license.import.rejected`, `license.import.unchanged`,
  `license.version.superseded` (event type), outcome, `operation_id` (only when
  the signature verified), license/version ids, actor, transport source,
  `document_hash`, a bounded reason code and a bounded non-sensitive detail.
  Retention periods and sensitive-data policy are open (PDR-11 U-7 → OQ-77); the
  table stores **no** raw document, no signature, no key material and no customer
  payload beyond an id and a display name.
- The `license.version.superseded` row is written inside the state-change
  transaction and names the version the transaction actually retired: the
  transaction refuses the import if that differs from the version the read-side
  pass resolved, so the trail can never record a retirement that did not happen
  (§3.4). Its `occurred_at` is the recorded instant; the version row carries the
  hand-over instant (`governs_until`), and the state response exposes both.
- Logging never includes the document body, the signature, the key or the
  entitlements payload. Rejections log the reason code and non-identifying
  context; the installation id and (for verified documents) the license id are
  the only identifiers logged.
- A rejected attempt never changes state, and a rejected unverified document
  cannot influence persisted data — including its `operationId`, which is not
  trusted until the signature verifies.

## 10. API and frontend boundary

Backend (REST/OpenAPI, ADR-0014, AR-10/AR-21):

| Method | Route | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/api/v1/license/current` | authenticated (bootstrap self-read) | evaluated state + effective version + scheduled version + bounded retained-version history |
| POST | `/api/v1/license/import` | `Licensing.License.Activate` | import a signed document (file envelope or text artifact) |
| POST | `/api/v1/license/activate` | `Licensing.License.Activate` | L-02 compatibility alias for the same pipeline (text code) |

Response DTO classes are declared for OpenAPI. `GET /license/current` documents
`LicenseStateDto`; `POST /license/import` and the L-02 `POST /license/activate`
alias document `LicenseImportResultDto` (evaluated state plus `changed`/`outcome`).
`license-import.e2e-spec.ts` and `license-openapi.contract.spec.ts` compare those
schemas with the generated document; the frontend generated client is regenerated
from a dumped OpenAPI document and gated in CI (F-7). The request body carries
exactly one field (`document`), so a client can never describe the license it wants.

Frontend (`features/licensing/`): the license stage keeps its single source
(`GET /license/current`) and its rule that a successful POST is not an active
license — the mutation invalidates and awaits the canonical query. The form
offers the **file** first (read client-side and posted as text) and the pasted
artifact as the fallback transport. Persian copy comes from the i18n dictionary;
no licensing fact is derived client-side, and no signature, hash or key ever
reaches the browser.

## 11. Migration and compatibility (L-01/L-02 installations)

The migration is additive first and lossy never:

1. create `license_versions`, `license_version_entitlements`,
   `license_audit_events`;
2. backfill one version per existing `licensing.licenses` row — the same `id`,
   its dates, limits, status, provider and entitlements, `document_hash =
   code_hash`, `document_version = 1`, `source = 'legacy-code'`,
   `operation_id = 'legacy-code:' || code_hash || ':' || id` (unique by
   construction), `superseded_at = replaced_at` and `superseded_by_version_id =
   NULL` (the historical successor is not recoverable from old rows);
3. create one `licenses` row per distinct legacy license id (the license
   identity), keeping the customer binding;
4. move entitlements to `license_version_entitlements`;
5. drop the version columns from `licenses` and the L-02 partial unique index
   that encoded "exactly one current license".

Invariants preserved: every currently valid license stays valid and effective
(identical dates, limits, entitlements); every replaced row stays as retained,
ineligible history; `code_hash` idempotency for legacy codes keeps working
(`document_hash` equality); the provider name and status values are copied
verbatim (no lossy status migration — CF-11 stays open, OQ-79).

A second, ordered migration
(`20261015000000_licensing_supersession_governs_until`) adds the two-instant
supersession model, because the first migration had no place for it:

6. add `governs_until` (the instant a version stops governing);
7. backfill it — the successor's `valid_from` when `superseded_by_version_id`
   records one (every row written by the L-03 import path), otherwise the
   recorded `superseded_at` (rows backfilled from L-02 `replaced_at`, whose
   replaced-by pointer was never persisted), NULL when the version was never
   retired;
8. constrain the pair: `superseded_at` and `governs_until` are always set
   together (`CHECK ((superseded_at IS NULL) = (governs_until IS NULL))`).

The backfill **repairs** installations that the first implementation retired
prematurely: a license that lost eligibility the moment a future-dated successor
arrived becomes effective again, because it now hands over at the successor's
start instead of at the import instant. Migrated L-02 rows keep the recorded
instant as their hand-over (their successor is unknown), which is exactly what
the old model meant by `replaced_at`: they are ineligible from then on, so
present and future evaluation is unchanged. An as-of read strictly *before* such
a recorded supersession can see two covering versions (the successor's window
starts earlier than the recorded instant); that historical case is the only one
the defensive resolution of §3.2 rule 7 handles, and it is logged. Nothing is
deleted or rewritten by either migration.

Evidence: `backend/prisma/rehearsal/licensing-version-model/rehearse.mjs`
(disposable databases: the populated pre-migration fixture, a database carrying
the premature-retirement defect that the backfill must repair, and a database the
migration must refuse with a clear message) plus the live PostgreSQL suite.

## 12. Test strategy

| Area | Level | Cases |
| --- | --- | --- |
| Document format | unit (`license-document.spec.ts`) | round-trip; canonical form; tampered payload; foreign signer; unknown/absent key hint; rotation (old key still verifies while trusted, new key accepted); malformed envelope; unknown envelope key; unsupported versions |
| Version resolution | unit (`license-version.spec.ts`) | single covering version; not yet effective; expired; gap; retired versions; the recorded-at / governs-until distinction (before, at and after a hand-over); empty effective windows; ambiguous defensive resolution; effective-version selection across retained history; the disjoint-window invariant over a mixed retained set |
| Import conflicts | unit (`license-version.spec.ts`) | one decision per import: no-overlap accepted; overlap refused; explicit supersession resolved by operation id; unknown / already-retired / already-stopped-governing target refused; legacy implicit replacement; legacy code refused when it would have to choose or rewrite a supersession; replayed operation and replayed artifact refused; a capacity/entitlement reduction refused on **every** path (implicit precedence, explicit supersession, legacy replacement), with the non-reducing controls accepted; an explicit signed supersession may end a perpetual grant (PD **OD-LIC-01**) while the implicit and legacy paths refuse it, and a mixed change that grows capacity but removes an entitlement is refused |
| Import pipeline, supersession timeline | service spec (`license-import.service.spec.ts`, pinned clock via `vi.setSystemTime`, no sleeps) + hermetic e2e | the governing license stays effective while a future-dated successor waits; the exact hand-over instant (half-open); the successor governs after it; the retired predecessor never returns after the successor ends; a failed successor import leaves the current license and its audit trail untouched; a second successor for the same predecessor is refused; an overlapping future-dated document with no supersession is refused |
| Import pipeline, everything else | service spec + e2e (in-memory repositories) | valid import (file, text, legacy code); wrong installation; malformed payload; expired document; not-active status; duplicate operation; overlap; explicit supersession; explicit supersession that reduces capacity/entitlements refused with nothing written; unknown supersession; legacy replacement/idempotency; legacy replacement that reduces the grant refused; authorization denial (401/403) |
| Persistence, transactions and concurrency | live PostgreSQL e2e | real transaction commit; a duplicate operation refused inside the transaction ⇒ nothing written; a **late** failure (duplicated entitlement) ⇒ customer, license, installation, version, entitlement and audit all roll back; two concurrent imports with the same window (three rounds) ⇒ exactly one version, one `applied` event, one 409; two concurrent imports of the same document ⇒ applied exactly once (per operation and per artifact); two concurrent successors of one version ⇒ exactly one supersession stamp, the loser refused, the hand-over exact; the disjoint-window invariant and the supersession pair re-asserted in SQL; every `applied` audit event has its version row and vice versa; legacy fixture migration; effective-version read after restart |
| Migration | rehearsal script | populated pre-migration data → both migrations → assertions on validity, history, ids, hashes, the pair check (both illegal directions refused) and the disjoint-window invariant; a database carrying the premature-retirement defect → the backfill repairs the hand-over and the repaired version governs again; unrepresentable data → the migration refuses with a clear message and writes nothing |
| Frontend | component tests | file path; text path; rejected document keeps the operator on the screen; duplicate conflict message; success releases the gate only after the canonical re-read |

## 13. Explicitly not implemented (and why)

| Not implemented | Blocker |
| --- | --- |
| Full revocation, reactivation file, login-blocking state | PDR-11 §10 needs the external recovery process (PQ-3 → OQ-78) and the `SUSPENDED`/revoked mapping (PQ-4 → OQ-79) |
| Grace / Read-Only enforcement | OQ-45 shape decided, duration and override authority open |
| Installation identity key | PDR-11 U-2 + U-9/PQ-3 (see §7) |
| Server replacement workflow and receipts | PDR-11 §5.5, U-9; product choice open |
| Client-device licensing | PDR-11 §7; separate slice, quota effects open (PQ-6 → OQ-83) |
| Owner-side issuance system and role matrix | PDR-11 §4, U-5 → OQ-75; CRM/billing and OQ-61 out of scope |
| Clock-rollback enforcement | PDR-11 §12.6 thresholds open (U-6 → OQ-76) |
| §8.6 capacity-conflict detection and resolution UI | needs the owning modules' public count contracts; separate slice (L-04). Until it exists, a version that reduces the retired version's capacity or entitlements is refused on every path — the interim fail-closed behaviour, not the flow. The **term** dimension of this section is decided: [PDR-12](../decisions/product/PDR-12-license-term-supersession.md) allows an explicit signed supersession to convert a perpetual grant into a time-limited one under the non-reduction invariants |
| Audit read API and retention | retention open (U-7 → OQ-77) |
