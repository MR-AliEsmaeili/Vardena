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
| Customer / Contract | `licensing.customers` | Customer only (`id`, unique `customer_code`, and `display_name`; [PDR-14](../decisions/product/PDR-14-licensing-customer-code.md) / L-06). Contracts, pricing and billing are out of scope (PDR-11 §4.1/§17.1) and stay Owner-side. |
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
  "customerCode": "CUST-ACME-001",
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
form), `customerId` and `customerCode` must be valid codes and distinct from
each other (`customerCode !== customerId`, [PDR-14](../decisions/product/PDR-14-licensing-customer-code.md)),
`validUntil` is exclusive and `null` means perpetual, limits are
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
- **A reduction is checked against current usage before it is applied (L-04,
  PDR-11 §8.6 — implemented 2026-10-12).** PDR-11 §8.6 requires a version that
  reduces entitlements or capacity to be checked against the resulting state,
  explained, preserved and explicitly resolved *before* it is applied; §8.2
  (module entitlement removed), §8.4 (user capacity reduced) and §8.3 (capacity
  reached) are the Musts behind it. On EVERY path that retires a version — an
  explicit signed supersession (`supersedesOperationId`), the implicit hand-over
  of OQ-80 Option B, and the legacy `VLIC1` replacement — the conflict authority
  compares the shrunk grant with the **counted current usage** (organizations
  and active users, read inside the import transaction under the same advisory
  locks the allocation guards hold; an unavailable count is a conflict that
  fails closed) and with the **retained grant** (a removed entitlement always
  conflicts). A shrink whose current usage stays within the new finite limits
  is not a conflict and applies like any other version; a conflicting one is
  refused with `reduction-requires-resolution` (409, nothing written, no stamp,
  no version, the operation id not retained) and a structured explain payload
  (`reduction.predecessorVersionId` plus one entry per conflict: the kind, the
  new limit, the counted usage, or the removed entitlement). *Naming the
  version to retire is not a resolution*: a signed `supersedesOperationId`
  proves **which** version the document replaces and is verified like every
  other signature fact, but it cannot know how many users or organizations
  exist, so it may not switch §8.6 off. Increases and identical grants are
  unaffected. The ONLY way to apply a conflicting reduction is
  the dedicated `POST /api/v1/license/reduction-resolution` operation (PDR-13
  §5): its own permission (`Licensing.License.ResolveReduction` together with
  `Licensing.License.Activate`), a required operator reason, ONE transaction
  that applies the import and writes the typed
  `license.import.reduction-resolved` audit event with the conflicts the
  transaction recomputed under the locks; a resolution whose document does not
  conflict is refused (`resolution-not-applicable`), and retrying a document or
  naming a version is never a resolution.
- **A contiguous renewal is measured against the deterministic continuation
  baseline (L-05, PDR-11 §8.6 — implemented 2026-10-13).** §8.6's trigger is
  unconditional — it does not require the candidate to retire a version — and
  the F-8 decision of 2026-10-13 adds that a changed `licenseId` must not
  bypass the capacity/entitlement reduction controls. So after the overlap
  rules above have accepted a candidate that retires nothing (a renewal whose
  `validFrom` is exactly the end of the retained coverage — adjacency, not an
  overlap), the same usage-aware check runs against the **continuation
  baseline**: the retained version whose *effective* window ends exactly at
  the candidate's `validFrom` — the grant the installation was actually on.
  Baseline selection is total and identity-independent: prefer the adjacent
  version whose `licenseId` equals the candidate's; otherwise the version of
  the customer the installation is bound to; break any remaining tie by latest
  `importedAt`, then `versionId`. A renewal that lowers capacity below the
  counted usage or removes a granted entitlement is refused
  (`reduction-requires-resolution`, 409, nothing written, the baseline named in
  `reduction.predecessorVersionId`) exactly like a hand-over, and lifts only
  through the same dedicated resolution operation. The resolution subject is
  the BASELINE: the receipt and the typed audit event name it, and it is
  **never stamped** — `superseded_at`, `governs_until` and
  `superseded_by_version_id` stay null, because a resolution authorizes a
  reduction, it does not retire the version it is measured against. Where
  nothing retained ends at the candidate's start there is no baseline and no
  measurement: a first license, a backwards gap fill and a post-gap start keep
  their own flows (the post-gap recovery keeps its dedicated operation). The
  term arm has no continuation case: an open-ended grant has no effective end,
  so it is never adjacent, and a candidate that overlaps a perpetual version
  is the already-guarded hand-over where closing the open end is refused
  (PDR-12). The legacy `VLIC1` adjacency renewal is guarded by the same rule,
  added after its documented L-02 lifecycle rules so no existing refusal
  changes its reason; the legacy transport still can never carry the
  resolution (`resolution-requires-signed-document`), so a conflicting legacy
  adjacency renewal must be re-issued as a signed document.
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
  entitlement reduction. Closing an open end is never operator-resolvable: the
  reduction-resolution operation refuses that arm, and only an explicit signed
  supersession may make the term change (PDR-12).
- A supersession is declared for exactly one version, and the hand-over is the
  candidate's own `validFrom`: overlap is allowed only in so far as it is
  replaced, so the predecessor's effective window ends exactly where the
  successor's begins. **Exactly the one named version may be overlapped**: a
  document that names a version and *also* overlaps a different retained
  version is refused (`overlapping-range`, 409, nothing written, the operation
  id unused), because retiring a version the document does not name would be an
  instruction it never gave — and applying it would leave two retained versions
  governing the same instant, the ambiguity this rule exists to prevent
  (corrective slice, 2026-10-14). A supersession declared for a non-overlapping
  version is allowed and simply retires that version at the successor's start
  (a correction of an expired or scheduled version); it never creates ambiguity
  precisely because nothing else may overlap. A legacy code cannot express
  *which* version it replaces, so it may replace at most one still-governing
  version that has no recorded supersession; anything else is refused rather
  than guessed.
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
- A **gap** is allowed, and while it lasts the installation is inactive with
  `inactiveReason: expired` (rule 4 above) — nothing is extended and no policy
  is invented. Leaving the gap is an Owner decision per recovery (**OQ-87
  Option B**, [PDR-13](../decisions/product/PDR-13-post-gap-recovery.md),
  decision **OD-LIC-02**): a NEW identity whose window starts after the
  retained coverage end is a post-gap recovery candidate, and the ORDINARY
  import refuses it (`post-gap-recovery-requires-dedicated-operation`, 409,
  nothing written). The only permitted path is the dedicated
  `POST /api/v1/license/gap-recovery` operation — its own permission
  (`Licensing.Installation.RecoverAfterGap` together with
  `Licensing.License.Activate`), a required operator reason, and ONE
  transaction that applies the version and writes the typed
  `license.import.recovered` audit event carrying the machine-readable
  `previous_license_id` (the license whose coverage had ended) and the lapse
  instant. A recovery is not a special pipeline: the same stages verify the
  document, the same locks and unique indexes arbitrate concurrency, a
  duplicate is a stable 409, a recovery without a lapse is refused
  (`recovery-not-applicable`), the customer binding is never changed by it, and
  a legacy `VLIC1` code cannot carry one
  (`recovery-requires-signed-document`, 422). A candidate carrying a RETAINED
  `licenseId` stays a renewal and keeps the G2 gap rule (§ above); adjacency
  (`validFrom == coverageEnd`) is contiguous, not a lapse.
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

- a document whose `customerId` matches an existing customer with a different
  `customerCode`, or whose `customerCode` is already bound to a different
  `customerId`, is refused as `customer-code-mismatch` (409) by the shared
  evaluation (`evaluateImportConflicts`) and inside the transaction
  ([PDR-14](../decisions/product/PDR-14-licensing-customer-code.md) / L-06);
- a document whose `licenseId` is already retained for this installation under a
  **different customer** is refused as `license-binding-conflict` (409) by the
  shared evaluation (`evaluateImportConflicts`, rule 2a). An explicit supersession
  does not bypass this rule;
- an ordinary import never overwrites an existing customer's stored
  `display_name` in `licensing.customers` ([PDR-14](../decisions/product/PDR-14-licensing-customer-code.md)).
  `licensing.customers` is inserted only when `customerId` is not yet present;
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

**Superseded by OQ-86 Option C (Owner decision 2026-10-12, implemented in the
change that records the decision).** This paragraph
recorded the pre-decision behaviour: overlap used to be evaluated only against
versions that still governed at the import instant, so a retired version was
excluded and a backdated non-superseding document could land inside the window
it had already governed. The Owner decided **Option C** (2026-10-12,
`docs/tasks/licensing-oq-80-oq-86-decision-brief.md` §8.2) and the shared
evaluation now counts the *effective window* of **every** retained version,
retired versions included, refusing such a document with `overlapping-range`
(409, nothing written) before anything is applied; the old unit test that pinned
the excluded-retired-version behaviour is gone, and the invariant recorded by
ADR-0046 Decision 4 is what the code enforces. The only remaining source of a
past-instant overlap is the **legacy backfill** (§11): an L-02 row's
replaced-by pointer was never persisted, so a migrated row hands over at its
recorded instant while its successor's window may start earlier. Those
historical instants are the sole remaining case for the defensive §3.2 rule 7
path; nothing written by the current import pipeline can create it (a document
that would overlap a different retained version while naming one — the
explicit-retirement arm — is refused by the same rule, corrective slice
2026-10-14).

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
| 9 | Version conflicts: overlap without explicit supersession, an overlap the named supersession does not retire, unknown/already-retired supersession target, supersession that would hand over before the import instant, a reduction of the retired version's capacity or entitlements (explicit supersession included), closing an open end where the version is not named, a license identifier already bound to another customer (§3.5) | `overlapping-range`, `unknown-supersession`, `license-binding-conflict`, `reduction-requires-resolution`, `renewal-gap` (409, no state change); `backdated-supersession` (422, no state change; OQ-86) |
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
  read licensing.customers + licensing.license_versions              -- committed state under the lock
  evaluate the version invariant  (replay + customer/code consistency + overlap + supersession target)
    -> conflict: raise (409 reason), transaction rolls back, nothing written
  create licensing.customers if absent (id, customer_code, display_name; never overwrite existing display_name)
  insert/update licensing.licenses  (id = payload.licenseId, installation, customer)
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

### 11.1 L-06 `customer_code`: owner-assigned backfill before upgrading

`20261020000000_licensing_customer_code` adds
`licensing.customers.customer_code` and then enforces `NOT NULL`,
`customers_customer_code_check` and `uq_customers_customer_code`. It is
**fail-closed and never derives a code**: if any existing row is missing a
`customer_code`, or carries a blank, malformed, `customer_code = id`, or
duplicate value, the migration aborts with a descriptive `RAISE EXCEPTION`
rather than guessing a business code from `id` or `display_name`
([PDR-14](../decisions/product/PDR-14-licensing-customer-code.md) §3.2). A
`customerCode` is an owner-assigned business identifier, so only the Product
Owner / commercial owner can supply it — no tool in this repository invents one.

An installation whose `licensing.customers` is **empty** (a fresh deployment, or
a test database) needs nothing: the constraints apply immediately. An
installation that already has customer rows must complete the backfill **before**
`prisma migrate deploy` reaches this migration.

**Prerequisites**

1. A current backup (`docs/operations/backup-and-restore.md`). The backfill is a
   data change to `licensing.customers` and must be reversible.
2. The owner-assigned business code for **every** existing customer row, each
   matching `^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$`, distinct from that row's `id`,
   and unique across `licensing.customers`.
3. Application writes to the licensing schema stopped, or the upgrade performed
   in the normal maintenance window (`prisma migrate deploy` before app start —
   `docs/database-strategy.md` §14).

**Execution order**

1. Inspect the population and produce the owner's assignment list:

   ```sql
   SELECT "id", "display_name"
   FROM "licensing"."customers"
   ORDER BY "id";
   ```

2. Add the column if it is not there yet. This is the same idempotent statement
   the migration itself begins with, so running it early is safe and is what
   makes the backfill possible before the constraints exist:

   ```sql
   ALTER TABLE "licensing"."customers"
     ADD COLUMN IF NOT EXISTS "customer_code" VARCHAR(64);
   ```

3. Write the owner-assigned codes — one explicit row per customer, never a
   generated expression:

   ```sql
   UPDATE "licensing"."customers" SET "customer_code" = 'CUST-ACME-001'
    WHERE "id" = '01K7CUSTOMERAAAAAAAAAAAAAA';
   ```

4. Validate before deploying. Every one of these must return zero rows:

   ```sql
   SELECT "id" FROM "licensing"."customers"
    WHERE "customer_code" IS NULL OR BTRIM("customer_code") = '';
   SELECT "id" FROM "licensing"."customers"
    WHERE "customer_code" !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$';
   SELECT "id" FROM "licensing"."customers" WHERE "customer_code" = "id";
   SELECT "customer_code" FROM "licensing"."customers"
    GROUP BY "customer_code" HAVING COUNT(*) > 1;
   ```

5. Run `prisma migrate deploy`. The migration's own preflight re-checks the same
   four conditions inside its transaction and aborts if any row is still wrong,
   so a missed customer is refused rather than silently coded.

**Recovery after a failure**

Do not assume how much of a failed run survived — inspect, then re-run:

1. Read what Prisma recorded:

   ```sql
   SELECT "migration_name", "finished_at", "rolled_back_at", "logs"
   FROM "_prisma_migrations"
   WHERE "migration_name" LIKE '%licensing_customer_code%';
   ```

2. Read what the schema actually holds — whether `customer_code` exists, and
   whether the constraint and index were applied:

   ```sql
   SELECT "column_name", "is_nullable" FROM "information_schema"."columns"
    WHERE "table_schema" = 'licensing' AND "table_name" = 'customers'
      AND "column_name" = 'customer_code';
   SELECT "indexname" FROM "pg_indexes"
    WHERE "schemaname" = 'licensing' AND "tablename" = 'customers';
   ```

3. Fix the data the failure named (the exception message quotes the offending
   `id` or `customer_code`), then re-run `prisma migrate deploy`. The migration
   is **safe to re-run from any partial state**: every statement in it is
   idempotent — `ADD COLUMN IF NOT EXISTS`, a pure check block, `SET NOT NULL`,
   `DROP CONSTRAINT IF EXISTS` before `ADD CONSTRAINT`, `CREATE UNIQUE INDEX IF
   NOT EXISTS`, and `COMMENT ON`. It contains no destructive DDL and no down
   migration (F-13).
4. If the failure was not data — for example the deploy was interrupted — the
   same re-run applies. If a row in `_prisma_migrations` was left without
   `finished_at` while the DDL did apply, that is a Prisma bookkeeping state to
   resolve with `prisma migrate resolve` against the recorded migration name,
   after step 2 has confirmed what the schema actually contains; never resolve
   it as applied without that confirmation.

**Rehearsal evidence.** `backend/prisma/rehearsal/licensing-version-model/rehearse.mjs`
(`assertCustomerCodeMigration`) exercises exactly this sequence against a
disposable populated database: the migration is refused with the
`without an explicit customer_code` message and writes nothing; the staged
owner-assigned codes are then applied and the migration succeeds and enforces
`NOT NULL`, `CHECK` and `UNIQUE`; and duplicate, empty, whitespace-only and
`customer_code = id` values are each refused. Run it with
`npm run test:licensing-version-rehearsal` (backend). It covers the SQL and the
populated-database case including a successful continuation; it does not exercise
Prisma's own `_prisma_migrations` bookkeeping after an interrupted deploy, which
is why step 1–2 above are inspection steps rather than assumptions.

### 11.2 Pre-L-06 `VLIC1` codes: the compatibility boundary

Since L-06, `customerCode` is part of the **signed** payload of both artifact
versions — `VLIC2` and the legacy `VLIC1` text code — immediately after
`customerId` and before `customerName`
([PDR-14](../decisions/product/PDR-14-licensing-customer-code.md) §3.3). A
`VLIC1` code issued before L-06 has no `customerCode` field in the bytes its
Ed25519 signature covers, so the parser rejects it: `reason: 'payload'`, HTTP
422, nothing written.

This is deliberate and is not worked around:

- A code is **never** accepted with a `customerCode` inferred from its
  `customerId` or `customerName` — PDR-14 §3.4 forbids deriving or generating
  one, and doing so would let a display string become an identity key.
- An unsigned or out-of-band `customerCode` is **never** accepted: the import
  endpoints take only `{ document }` (and `{ document, reason }` on the
  dedicated operations), so nothing outside the signature can supply the field.
- Weakening this to admit old codes would remove `customerCode` from the signed
  surface for exactly the artifacts an attacker would replay.

**What an operator must do.**

| Situation | Action |
| --- | --- |
| Existing retained installations | Nothing. Retained `license_versions` rows are history and are untouched by the upgrade; the installation keeps governing from them. The 422 applies only to *presenting* an old artifact again. |
| Renewal or replacement after upgrading | Issue a **new** artifact from the current authority carrying `customerId`, `customerCode` and `customerName`, and import it through the normal path. Do not re-present the pre-L-06 code. |
| Offline / on-prem deployments | Upgrade the server first, then issue. An operator who cannot reach the issuing authority keeps governing from the retained version until they can; there is no offline path that mints a `customerCode`. |
| A pre-L-06 code presented by mistake | It is refused 422 with `reason: 'payload'` and nothing is written, so the attempt is harmless and retryable with a newly issued artifact. |

Reissuance therefore never requires importing an old artifact through the new
parser: the new artifact is issued for the same installation, the same
`customerId`, and the owner-assigned `customerCode` recorded for that customer in
`licensing.customers` (§11.1), and it renews on the existing `licenseId` or —
with a new `licenseId` — under the L-05 continuation rules. Because the customer
is unchanged, a renewal is not a transfer; moving an installation to a different
customer stays the explicit, authorized, audited
`POST /api/v1/license/customer-transfer` operation (§3.5, PDR-14 §3.5.4).

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
