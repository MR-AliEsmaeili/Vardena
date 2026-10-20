# OD-LIC-07…10 — Owner-side issuance technical design (PDR-19)

- **Date:** 2026-10-19
- **Author:** engineering (design only; Arena session on `arena/59ce3185-vardena`)
- **Status:** **DESIGN — nothing here is implemented.** No signer, key, permission,
  migration, endpoint, artifact, DTO or UI exists as a result of this document.
  It is the technical design the `BLOCKED — TECHNICAL DESIGN REQUIRED` gate of
  [PDR-19 §0](../decisions/product/PDR-19-owner-side-issuance-decisions.md) asks
  for, and it is written to be reviewed before any code is written.
- **Decision source (binding, not reopened):**
  [PDR-19](../decisions/product/PDR-19-owner-side-issuance-decisions.md) —
  **OD-LIC-07** (permission split + per-user operator grants, and §5.1/§5.2
  answering forks F-1/F-2), **OD-LIC-08** (air-gapped offline signer and the
  four-step flow), **OD-LIC-09** (controlled registration of `installationId`),
  **OD-LIC-10** (dedicated durable artifact store).
- **Baseline:** `main` = `8fc52eee9a213872cb6df969cf3d9be187e96b24` (PR #185).
  Work branch base `510aca58ffdc7cb31b5d0b295d561a4db5d330fb` (PR #184); PR #185
  touches only `frontend/src/ui/patterns/data-table.test.tsx` and
  `docs/frontend/loading-system.md`, so every reference below was verified against
  a tree that is identical for all Owner and licensing sources. The local clone is
  shallow, so `git merge-base origin/main HEAD` returns empty; comparisons are made
  against explicit SHAs.
- **Related records:**
  [issuance blocked assessment](./licensing-owner-side-issuance-blocked-assessment.md) ·
  [PDR-14](../decisions/product/PDR-14-licensing-customer-code.md) ·
  [PDR-16](../decisions/product/PDR-16-licensing-protocol-canonical-byte-contract-and-vectors.md) ·
  [PDR-17](../decisions/product/PDR-17-owner-web-application-phase-1.md) ·
  [PDR-18](../decisions/product/PDR-18-licensing-commercial-dates-and-lifecycle-decisions.md) ·
  [ADR-0046](../adr/0046-signed-license-documents-and-version-lifecycle.md) ·
  [ADR-0048](../adr/0048-owner-side-licensing-separation-boundary.md) ·
  [version model and file exchange](../licensing/version-model-and-file-exchange.md) ·
  [protocol vectors](../licensing/licensing-protocol-vectors.md) ·
  [Owner-side architecture](../licensing/owner-side-system-architecture.md) ·
  [Phase 0 readiness](./licensing-owner-side-phase-0-readiness.md)

---

## Implementation status (2026-10-20, branch `arena/34983fce-vardena`)

**Read this before the design body.** The paragraphs below remain the approved
design; this block records what the implementation branch actually contains, so
the design is not mistaken for evidence.

- **Delivered in code:** permission grants and default deny (OD-LIC-12),
  limit-profile storage/lifecycle (OD-LIC-13/14), installation-identity
  registration, `VLSR1` request preparation with both digests, the offline
  signer with the pre-key digest gate (OD-LIC-11), import/verification/archival
  and download, duplicate-import replay (OD-LIC-18), and Owner-side `VREV1`
  revocation preparation/import/download. Owner UI `/app/licenses` covers
  prepare, digest display, request download, artifact import and revocation
  preparation.
- **Tests:** `owner-licensing/backend/test/{protocol,signer,licensing,unit,artifact-store}.test.ts`
  and the Owner UI suites pass locally. The PostgreSQL suites
  (`test/api.test.ts`, `test/licensing-lifecycle.test.ts`) apply migrations
  001–007 to a fresh disposable database in the pull-request `backend` job; a
  stored run id or SHA is deliberately not repeated here, because it is only
  evidence for the head it ran on.
- **Customer runtime (added after this design, OD-LIC-17):** the installation
  now consumes `VREV1` — domain parsing/verification, import service, the
  `POST /api/v1/license/revocations/import` route under a new
  `Licensing.License.Revoke` permission, `licensing.license_revocations` plus
  `licenses.revoked_at`/`revocation_id` and `license_versions.signed_issued_at`
  (migration `20261024000000_licensing_revocations`), `revoked` ranked above
  every status/date reason and above Grace, `license-revoked` refusal on later
  imports (the revocation read runs **before** the duplicate/replay precheck, so
  an exact replay of a revoked license is `license-revoked`, not a duplicate),
  and a committed `VREV1` vector set. This is code in the same branch,
  not a change to the approved design; the customer contract (`VLIC1`/`VLIC2`,
  canonicalization, signatures, vectors) is untouched.
- **Delivered after the first draft:** prepared-request expiry per **OD-LIC-20**
  (fixed 14 × 24-hour maximum age, enforced on import, terminal `ABANDONED`,
  system-origin audit — §9.1) and the **OD-LIC-19** artifact backup/restore
  tooling and drill (§8.4, [`artifacts-backup-restore.md`](../licensing/artifacts-backup-restore.md)).
- **Not delivered:** a dedicated renewal/replacement UI, human Persian RTL smoke,
  and the 14-step acceptance run. The customer live-PostgreSQL revocation case
  passed locally (PostgreSQL 18.4) and is re-run by CI; no customer installation
  has been observed applying a revocation.
  `docs/tasks/owner-side-issuance-traceability.md` is the authoritative
  per-decision status.

---

## 0. Scope

This design covers the Owner-side issuance path end to end: the per-user
permission model, the optional per-customer limit profile, the installation
identity, the signing-request artifact, the offline signer, the import and
validation of the returned artifact, the issuance ledger, the durable artifact
store and download, the transaction and failure behaviour, audit, the API
surface, the Persian RTL UI states, and the test plan.

It does **not** decide anything PDR-19 left open, and it does not change any
signed byte format, canonicalization rule, vector, `VLIC1`/`VLIC2` verification
semantics or customer runtime behaviour.

Two hard constraints shape the whole design and are verified in §1 rather than
assumed:

1. **The Owner cannot import customer code.** So the Owner needs its own
   canonicalizer, signer and verifier, and their conformance must be *proven*,
   not asserted.
2. **Issuance is not synchronous.** OD-LIC-08 inserts a human-mediated offline
   round trip between "the Owner decided" and "an artifact exists", so the design
   must model an intermediate state honestly and must make tampering during
   transport detectable.

**Amended 2026-10-20 after a security and coherence review of this document.**
Three defects were found and are corrected in place; each correction is labelled
**[REVIEW]** at the point it changes.

| # | Finding | Severity | Where |
|---|---|---|---|
| **RV-1** | The request was authenticated only *after* signing. §4.2's checks are all structural, so a well-formed but substituted request passes every one of them and gets signed; and the Owner's import-time digest check cannot protect a customer who receives the artifact directly. Detection had to move **before** the private key is used | **High** | §3.4, §3.6, §4.2, §4.4 |
| **RV-2** | §3.4's single-digest comparison **cannot succeed for an untampered round trip**: the request payload and the `VLIC2` payload have different field sets, so their canonical bytes never match. As written every legitimate import is refused — fail-closed, but it would have been discovered late and invites an implementer to "fix" it by weakening the check | **Blocking defect** | §3.4, §5.1 |
| **RV-3** | Two self-contradictions: `user_permission_grants` claimed intersection semantics while also saying non-issuance access "follows the role", and `customer_limit_profiles` declared `customer_id` **unique** while also declaring a `RETIRED` status whose history "must remain readable" | **High** | §5.2, §5.4, §6 |

One factual error was also corrected: `supersedesOperationId` is **always
present** in the canonical bytes (`null` when absent) and is *not* omitted like
`deviceLimit` — verified against `canonicalizeLicenseVersion`
(`backend/src/modules/licensing/domain/license-document.ts:272-303`) and against a
census of all 23 corpus files (§16). No signed format, canonicalization rule or
vector is changed by any of these corrections.

**Two points raised by the review were not engineering's to settle** and were
recorded as stopped, with options and consequences, in §4.4 and §15.

**Amended again 2026-10-20 — the Product Owner answered them.** The stopped
questions, plus the limit-profile lifecycle the review raised as **RV-3**, are now
decided canonically in
[PDR-19 §6](../decisions/product/PDR-19-owner-side-issuance-decisions.md) as
**OD-LIC-11…OD-LIC-14**, and this document is reconciled to that record:

| Decision | Answer | Effect on this design |
|---|---|---|
| **OD-LIC-11** (OQ-92) | **O-A** — full 64-hex `request_payload_sha256` confirmed over a path independent of the request file, validated **before the key is read or loaded**. **O-B not adopted**; shortening forbidden | §4.2 check 10 and §4.4 are now decided, not proposed. The §15 items on O-B and on shortening are closed |
| **OD-LIC-12** (OQ-93) | **R-1** — a new operator has **zero effective access**; creation writes no grant rows. **R-3 rejected** | §5.4's R-1/R-3 question and §6.2's open row are closed in favour of R-1; the §13.5 matrix test is no longer parameterized |
| **OD-LIC-13** (OQ-94A) | Reactivating the **same** retired profile is allowed, with at most one `ACTIVE` per customer enforced **before** reactivation takes effect | §5.2's "retired rows are terminal" and its retire-plus-create recovery path are corrected; §9 gains a profile state machine; migration `007`'s status trigger must permit `RETIRED → ACTIVE` |
| **OD-LIC-14** (OQ-94B) | An in-flight request completes on its **creation-time snapshot**; new requests use current state | §5.2's snapshot rule is promoted from an engineering analogy to a recorded decision; the §15 item is closed |

No signed byte format, canonicalization rule, vector or separation boundary is
changed by any of these, and **nothing is implemented** — this remains a design
awaiting approval.

**Amended a third time, 2026-10-20 — the lifecycle round.** The Product Owner
answered the five remaining lifecycle questions as **OD-LIC-15…OD-LIC-19**
([PDR-19 §10](../decisions/product/PDR-19-owner-side-issuance-decisions.md)).
None of them changes a signed license byte, a vector or the separation boundary:

| Decision | Answer | Effect on this design |
|---|---|---|
| **OD-LIC-15** | Controlled **manual** key rotation, routine vs emergency, no key in Git/CI, no invented trust bootstrap | §8.3's trust list stays configuration; rotation is a runbook, not a feature. No runtime key-administration surface is built here |
| **OD-LIC-16** | Renewal **and** replacement are `OWNER_ADMIN`-only | §9.1's note that operator authority over `renewsOperationId`/`supersedesOperationId` was undecided is **closed**: an operator may never populate either field, and direct API attempts are refused server-side |
| **OD-LIC-17** | A **separately versioned** signed revocation artifact (`VREV1`) imported by the customer | New phase F, specified in [revocation-artifact-protocol.md](../licensing/revocation-artifact-protocol.md). §9.1's "no revocation state is defined" is superseded for the **separate** artifact only; the issuance state machine is unchanged |
| **OD-LIC-18** | Duplicate import returns the **historical first result** | §7.1/§13 are extended: replay returns the persisted outcome, creates no new row/audit/archive entry, and checks authorization first |
| **OD-LIC-19** | **Indefinite** retention, backup and recovery testing | §8's store becomes a retained archive with explicit staged states, reconciliation and restore verification; no automatic deletion and no WORM claim |

**Consequence for the gate.** No product decision is missing for phases A–E or for
the revocation protocol. Implementation is now blocked only by engineering work and
by the evidence-bound open rows listed in §15.1 (OQ-74's compromise/rollout policy,
OQ-75's vocabulary evidence, OQ-78's justification policy, OQ-81's receipt shape
outside the new route, OQ-85's operational evidence, and OQ-90's
correction-after-issuance question).


---

## 1. Preflight — verified constraints

### 1.1 The separation boundary forbids reusing the customer's crypto module

| Fact | Source |
|---|---|
| "No imports from customer `backend/` or `frontend/`. No shared runtime package." | `owner-licensing/README.md` (Boundaries) |
| Phase 1 acceptance: "no customer imports/runtime/database/replication" | ADR-0048, Phase 1 acceptance addendum |
| PDR-16 **D-2(a)** `VECTORS_ONLY`: "No shared runtime package is created … No dependency is introduced from the customer runtime to an Owner-side application." | PDR-16 |
| The Owner UI image already enforces a source allowlist of exactly seven canonical date files | ADR-0048 date-source addendum; `owner-licensing/frontend/Dockerfile.dockerignore`; `scripts/stage-date-foundation.mjs` |
| `scripts/check-owner-isolation.py` currently fails only on **customer** artifacts/sources referencing Owner; it does not police the reverse direction | read in full |

**Consequence.** The Owner implements its own Ed25519 canonicalize/sign/verify
against the ratified byte contract of
[`version-model-and-file-exchange.md`](../licensing/version-model-and-file-exchange.md)
§2.1. This is precisely the situation PDR-16 D-2(a) and ADR-0048 Decision 6 were
written for: *"Conformance is proven by a published, deterministically regenerated
vector set verified by both sides in CI"*, and the vector design states *"The Owner
implementation later loads the same directory. Same files, both sides, one
contract."*

Reading `docs/licensing/vectors/*.json` as data is **not** a code import and does
not breach the boundary. It is the approved mechanism.

**Recommended CI addition (design proposal, not yet a gate):** extend
`scripts/check-owner-isolation.py` (or add a sibling) to fail when Owner source
imports from `../../backend` or `../../frontend`. Today nothing enforces the
reverse direction, and a future convenience import would otherwise pass silently.

### 1.2 Generated vectors alone cannot prove conformance

[`licensing-protocol-vectors.md`](../licensing/licensing-protocol-vectors.md) §5.1
distinguishes two roles:

| | Generated vector | Independent golden fixture |
|---|---|---|
| Purpose | drift detection | contract proof |
| Committed under | `docs/licensing/vectors/**` | literals in the test tree |
| **Cannot catch** | implementation and generator moving together | — |

A corpus the customer implementation generated cannot refute that implementation.
If the customer canonicalizer and its generator both moved, regeneration would stay
byte-identical, CI would stay green, and an Owner verifier matching those vectors
would be matching a **changed** contract while believing it conforms.

**Consequence — mandatory.** The Owner conformance suite must contain **both**:

1. a corpus run over `docs/licensing/vectors/**` (`canonical/CAN-01…09`,
   `valid/OK-*`, `invalid/BAD-*`, `keys/*`, `rotation/ROT-*`), asserting canonical
   bytes, signatures and the **stable refusal reason strings**; and
2. **independent golden literals pinned in the Owner test tree**, encoding §2.1's
   documented escaping and ordering rules directly — non-ASCII emitted raw,
   `\b\t\n\f\r` for `U+0008/09/0A/0C/0D`, `\u00xx` lowercase hex for the rest of
   `U+0000`–`U+001F`, `\"` and `\\`, declared key order, sorted `modules`/
   `features`, no inter-token whitespace, `toISOString()` instants, conditional
   `deviceLimit` omission.

Neither alone is sufficient. This is the concrete mitigation for risk **R-3**
("a second implementation produces different canonical bytes → all signatures fail
in the field"), which the Phase 0 readiness record rates High-probability without
vectors.

### 1.3 Test key material already exists and must stay quarantined

`docs/licensing/vectors/keys/authority-a.json` and `authority-b.json` contain a
committed Ed25519 key pair labelled *"TEST-ONLY authority A (never signed a real
license)"*. This is an approved fixture (instruction §6: a test key is permitted in
a fixture or isolated test environment with a clear boundary).

**Binding rules for this design:**

- The Owner test suite may use these fixtures, and must assert they are labelled
  TEST-ONLY, so a fixture cannot be silently promoted.
- **No production or staging key is ever generated by code, committed, or read
  from a fixture.** The offline signer takes its key from the operator in the
  offline environment only.
- The key material is not repeated in this document, in any PR description, in
  logs, in audit events or in error messages.
- If a real key is absent, the Owner fails closed with an explicit, secret-free
  error. It never auto-generates or fakes one.

### 1.4 Customer-side temporal refusals constrain the offline delay

Verified in `license-import.service.ts:567-582`: a document with
`validUntil !== null && validUntil <= now` is refused as **`expired-document`**
(422, nothing written). Future-dated documents remain importable and take effect
by date (ADR-0046 Decision 4); `not-yet-valid` is a scheduled-version verdict, not
an import refusal; `backdated-supersession` (422) refuses a supersession that would
rewrite governance already exercised.

**Consequence.** Because OD-LIC-08 puts an unbounded human delay between request
and signature, and another between signature and customer import, a **time-limited
license whose end passes before the customer imports it becomes permanently
unimportable**. The design must therefore surface the request's age and the
artifact's remaining import window, and must treat a stale request as an
operational condition rather than silently re-issuing. **OD-LIC-20 (PDR-19 §11)
later decided the fixed limit:** a prepared request is completable only while
`now < requested_at + 14 × 24 hours`; at or after that instant it is expired and
the first completion attempt refuses and abandons it (§9.1). This design does not
invent any other expiry, and the customer-side `expired-document` refusal remains
the backstop for an artifact whose own term has passed.

### 1.5 Reusable Owner patterns

| Need | Existing pattern to reuse |
|---|---|
| Durable write-once file store | `FilesystemAuditArchiveStore` (`src/archive.ts`): `link`+`unlink`, `chmod 0o444`, file and directory `fsync`, read-back verification, hash-chained `manifest.json` |
| Strict request validation | `object()` rejects unknown fields; `text()`, `customerCode()`, `page()`, `queryText()` in `src/domain.ts` |
| Actor authorization | `assertActiveAuthorizedActor()` — active, valid role, not `must_change_password`, holds the permission, all re-checked under lock in the same transaction as the work |
| Audit | `audit()` in `src/db.ts`, append-only, `clock_timestamp()`, retention and incident metadata enforced by migration `004` triggers |
| Migration discipline | numbered immutable SQL, advisory lock, transaction, SHA-256 ledger (`src/migrate.ts`); refuses known customer schemas |
| IDs | ULID (`ulid` package), 26-char, already the actor/customer id type |
| Route shape | `route(method, path, permission, …)` in `src/app.ts`, with denial audited (e.g. `OPERATION_MUTATION_DENIED`) |
| Jalali dates | staged canonical date foundation; `src/lib/date-time.ts`; `ui/patterns/date-input.tsx` |

---

## 2. Which instant is "the issuance day"?

PDR-18 §1.2 fixes activation start to the issuance day, mandatory, not editable,
from **trusted server-side** time. OD-LIC-08 splits issuance across at least three
instants, so the design must pin one of them.

| Candidate | Verdict |
|---|---|
| The Owner request-creation instant | **Chosen.** It is the moment the Owner decides to issue, it comes from the Owner's own trusted server clock, and it is knowable and recordable before the artifact exists |
| The offline signer's signing instant | Rejected. The Owner cannot know it in advance, so the request digest of §3.4 could not cover the dates; and it would let the transport delay silently move a commercial validity start |
| The Owner import instant | Rejected. That is when the Owner *learns* the artifact exists, not when it decided to issue; it is also unbounded and operator-controlled |

**Rule.** At request creation the Owner pins, from its own server clock:

- `issuedAt` — the issuance instant, `toISOString()` form;
- `validFrom` — the canonical BusinessDate of that same server day, per
  `docs/datetime.md` and ADR-0044's Jalali-first policy, converted to the
  instant the signed contract expects;
- `validUntil` — the issuer's chosen end (or `null` for perpetual), strictly later
  than `validFrom`, matching `assertPayload`'s existing `validity` rule.

The offline signer **may not alter any date**. It validates them (§4) and signs
them as given. Because the request digest covers them (§3.4), an altered date is
detected at import.

**Consequence to surface in the UI, not to hide:** the artifact's `validFrom` will
be in the past by the time the customer imports it. That is normal and already
supported — a license may be imported after its `validFrom` — but the operator must
see the request's age so a stale time-limited request is re-created deliberately
rather than signed and refused as `expired-document` at the customer (§1.4).

Browser time is never a source of truth: the UI sends no date for `validFrom`, and
the server rejects a client-supplied one as an unknown field.

---

## 3. The signing-request artifact (new kind)

OD-LIC-08 step 1 needs a file the operator can carry. PDR-19 records that this is
a **new artifact kind** carrying an *unsigned* payload, so PDR-16's constraints
("no existing signed byte format is changed", "no new canonicalizer", "no
`VLIC3`") are not breached — the signed artifact remains exactly `VLIC2`.

### 3.1 Naming and envelope

Proposed prefix **`VLSR1`** (Vardena License Signing Request), following the
existing vocabulary pattern (`VLIC1`, `VLIC2`, `VDEA1`, `VDRQ1`, `VDRP1`). A
versioned JSON envelope, mirroring the `vardena-license` file envelope's shape so
both sides read it the same way:

```json
{
  "format": "vardena-license-signing-request",
  "fileVersion": 1,
  "request": "VLSR1.<base64url(canonical request payload)>"
}
```

- Unknown top-level keys are **rejected**, exactly as the license file envelope
  rejects them — the envelope carries no authority.
- The envelope is **unsigned**. It is a transport container, not a credential. It
  must never be described in the UI or the API as a license, and no response may
  report `signedArtifactProduced = true` for it.

### 3.2 Request payload

Deliberately flat and typed — the same discipline as `LicenseVersionPayload`, so
every field is validated before it can reach the signer. Field order below is the
canonical order:

| Field | Meaning |
|---|---|
| `v` | `1` — request format version |
| `kind` | `"SERVER_LICENSE_ISSUANCE_REQUEST"` |
| `requestId` | Owner-minted ULID; the Owner-side identity of this attempt |
| `operationId` | The **signed** replay identity that will appear in the `VLIC2` payload. Minted by the Owner at request creation, so the Owner can detect a duplicate before signing |
| `licenseId` | Owner-minted ULID |
| `customerId`, `customerCode`, `customerName` | Canonical wire order per PDR-14 / ADR-0046 L-06 addendum |
| `installationId` | The ULID registered under OD-LIC-09 (§5.3) |
| `status` | `"ACTIVE"` — the import pipeline refuses any non-`ACTIVE` payload (`not-active`), so nothing else is issuable |
| `validFrom`, `validUntil` | Pinned by §2; `validUntil` `null` = perpetual |
| `organizationLimit`, `userLimit` | Positive integer or `null` (unlimited), per `assertPayload` |
| `deviceLimit`, `deviceLimitSpecified` | Omission is **UNSPECIFIED** and grants no capacity, never unlimited (PDR-15 §4) |
| `modules`, `features` | Sorted, drawn only from the real catalog (§3.5) |
| `supersedesOperationId`, `renewsOperationId` | Mutually exclusive. **[REVIEW RV-2]** They are **not** both omitted when absent — the real canonicalizer emits `supersedesOperationId` **always** (`null` when absent) and omits `renewsOperationId` **entirely when null**, placing it between `supersedesOperationId` and `issuedAt`. `deviceLimit` is the only field whose omission is driven by a separate flag. The projection in §3.4 reproduces these three rules exactly |
| `issuedAt` | **[REVIEW RV-2]** The pinned issuance instant of §2, carried **in the request** so the signer cannot supply its own and so the binding projection is computable before signing. The signer copies it verbatim; altering it is forbidden by §4.2 and now also breaks the binding digest |
| `requestedAt` | The Owner server instant the request was created |
| `requestedByUserId` | Attribution only. **Never** an authority: the signer does not trust it and the customer never sees it |

The request's own `v` (`1`) and `kind` (`"SERVER_LICENSE_ISSUANCE_REQUEST"`) are
**not** the signed payload's: `VLIC2` carries `v = 2` and
`kind = "SERVER_LICENSE_VERSION"` (`license-document.ts:47-51`). §3.4's projection
substitutes them, which is one of the reasons a single digest over both cannot
work.

### 3.3 Canonicalization

The request payload is canonicalized by **the same Owner canonicalizer** that
produces the `VLIC2` canonical bytes, under the identical §2.1 rules. This is
deliberate: one implementation, one rule set, one conformance suite (§1.2). A
second, request-only canonicalizer would be exactly the drift PDR-16 forbids.

The request is **not** a signed format and is **not** added to the vector corpus.
Adding it would change the corpus CI regenerates and diff-checks, and PDR-16 says
no signed byte format changes. Request conformance is instead proven by the
round-trip test of §13.2.

### 3.4 Tamper-evidence across the human transport — **[REVIEW RV-1, RV-2] rewritten**

OD-LIC-08 has a human carrying a file between two environments. The design must
detect alteration **before the license private key is used**, because after that
point an artifact with a valid authority signature exists and OQ-78 records that
nothing can revoke it. §3.6 models the threat; this section is the control.

**[REVIEW RV-2] The original single-digest rule was unimplementable.** It said the
Owner extracts the payload from the returned `VLIC2`, recomputes its canonical
bytes and requires that digest to equal the stored `request_payload_sha256`. Those
two digests are over **different field sets** and can never be equal:

| | Request payload (§3.2) | `VLIC2` signed payload |
|---|---|---|
| `v` | `1` | `2` |
| `kind` | `SERVER_LICENSE_ISSUANCE_REQUEST` | `SERVER_LICENSE_VERSION` |
| Request-only | `requestId`, `requestedAt`, `requestedByUserId`, `deviceLimitSpecified` | — |
| Signed-only | — | `issuedAt` |

So the rule as written refuses **every** legitimate import. That is fail-closed and
therefore not a security hole, but it would have surfaced only in integration, and
the obvious "fix" — loosening or dropping the comparison — would have destroyed the
one control standing between the operator's file and the authority key. It is
corrected here rather than left for an implementer.

**Two digests, two jobs, both computed by the Owner at request creation** (when it
still holds no key), both immutable on the issuance row (§5.1):

| Digest | Over | Checked by | When | Catches |
|---|---|---|---|---|
| `request_payload_sha256` | the canonical bytes of the **whole request payload**, `v = 1`, `kind = SERVER_LICENSE_ISSUANCE_REQUEST` | the **offline signer**, against a value the operator brings out-of-band | **before** signing (§4.2 check 10) | any alteration of the file in transport, including of attribution-only fields |
| `request_binding_sha256` | the canonical bytes of the **binding projection** below | the **Owner**, against the returned artifact | at import (§8.3) | any difference between what was authorized and what was signed |

**The binding projection** is exactly the `VLIC2` wire payload this request commits
to, produced by the **same Owner canonicalizer** under the real rules verified in
§16: `v = 2`; `kind = "SERVER_LICENSE_VERSION"`; the 18-field order
`v, kind, operationId, licenseId, customerId, customerCode, customerName,
installationId, status, validFrom, validUntil, organizationLimit, userLimit,
deviceLimit, modules, features, supersedesOperationId, issuedAt`; `deviceLimit`
**omitted entirely** when `deviceLimitSpecified` is false; `supersedesOperationId`
**always present**, `null` when absent; `renewsOperationId` **omitted entirely when
null**, otherwise emitted between `supersedesOperationId` and `issuedAt`;
`validUntil` `null` for perpetual; `modules`/`features` sorted; every date
`toISOString()`; no whitespace.

The projection is a **pure function of the request payload**, so integrity of the
request implies integrity of the binding. That is why one out-of-band value —
`request_payload_sha256` — is enough to cover both links: confirming the file is
intact makes everything derived from it intact. Neither check requires either side
to hold the other's key, so OD-LIC-08's custody decision is untouched.

**Why this satisfies "refusal at import is not enough".** Import refusal protects
the Owner's *ledger*. It does not protect the *customer*: an artifact signed for
tampered terms verifies perfectly against the customer's public trust list, and if
it is handed to the customer directly the Owner's import path never runs at all.
Only a check that runs **before** the private key is used closes that path. The
import check is retained as defence in depth — it is the part that needs no human
cooperation — but it is no longer the primary control.

**What neither digest proves,** stated plainly: neither proves the request was not
*read* in transit. The request carries commercial terms (customer, limits, modules,
dates), so it is confidential business data on removable media. §15 records the
transport-handling question rather than inventing a rule. Nor can either digest
detect tampering performed **inside** the Owner before export — the UI digest is
computed from the stored row, so an actor able to alter the row alters both. That
path is covered by the permission model (§6), the immutable-facts trigger (§5.1)
and audit (§10), not by a hash.

### 3.5 Module and feature catalog

The Owner needs `KNOWN_MODULE_CODES` (`accounting`, `documents`, `inventory`,
`organization`, `rbac`, `users`, `workflow` — `license-code.ts:81-89`) to validate
`modules`. Copying the list into Owner source is risk R-3 in miniature: it can
drift silently.

**Chosen approach.** Do **not** hand-copy. Derive the Owner's accepted catalog from
the **vector corpus**, which is shared data and already CI-regenerated: the Owner
test suite asserts that the set of module codes appearing across
`docs/licensing/vectors/**` equals the set the Owner implementation accepts. If the
customer catalog changes, vector regeneration changes the corpus, and the Owner
assertion fails — turning silent drift into a red build.

The Owner still holds its own literal list (it must, to validate at runtime), but
that list is now **pinned by a cross-check against shared data** rather than by
hope. An unknown module is refused server-side before any request is produced; the
UI never offers a module the catalog does not contain.

### 3.6 Threat model for the transport — **[REVIEW RV-1] new**

The attacker is modelled as able to read and rewrite the request file at any point
between the operator downloading it and the signer reading it (removable media, a
shared folder, a mail hop, a print-and-rescan path). The attacker does **not** hold
the license private key and does **not** control the Owner's own UI or database.

**Every alteration below is well-formed**, so it passes all nine structural checks
of §4.2 as originally written. That is the defect: §4.2 validated *shape*, and the
threat is *substitution of valid content*.

| # | Alteration | Passes §4.2 checks 1–9? | Consequence if signed |
|---|---|---|---|
| T-1 | `customerId`/`customerCode`/`customerName` replaced with **another real customer** | yes — check 3 only tests grammar and internal consistency | a license for terms nobody negotiated, bound to a customer who never asked |
| T-2 | `installationId` replaced with **another valid ULID** | yes — check 4 only tests ULID grammar | artifact bound to the wrong server; the signature cannot detect it (the residual risk PDR-19 §3 already records, here made deliberate rather than accidental) |
| T-3 | `organizationLimit`/`userLimit` raised, or `null` (unlimited) substituted for a real cap | yes — check 5 only tests positivity | capacity beyond the ceiling; over-limit issuance becomes possible again, defeating the whole point of F-1's profile |
| T-4 | `deviceLimitSpecified` flipped false→true, or `deviceLimit` raised | yes — check 5 | device capacity granted that was never authorized; `null`→value and unspecified→specified are *different* signed facts |
| T-5 | extra entries added to `modules`/`features` | yes — check 6 only tests catalog membership | entitlement to modules the customer never bought |
| T-6 | **`validUntil` set to `null`** | yes — check 7 only tests ordering and nullness | **a time-limited request becomes a perpetual license.** This crosses the boundary OD-LIC-07 drew explicitly — perpetual issuance is reserved to `OWNER_ADMIN` — achieved with no key, no credential and no Owner access. Privilege escalation, not merely a wrong date |
| T-7 | `validUntil` pushed years out, or `validFrom` moved earlier | yes — check 7 | term changed without going through PDR-12's supersession, the only authorized term-changing path |
| T-8 | `supersedesOperationId`/`renewsOperationId` inserted | yes — check 8 only tests mutual exclusion and self-reference | an unauthorized supersession or renewal chain entry, silently retiring or extending another license |
| T-9 | `requestedByUserId` rewritten | yes | false attribution in the request record — the signed payload does not carry it, but the audit story does |
| T-10 | a **stale or replayed** request file re-presented for signing | yes | duplicate signing of one authorization |

**Why detection at import is insufficient** (review requirement 4). By the time the
Owner compares digests, three things are already true:

1. **A valid authority signature exists.** OQ-78 is OPEN and PO-78-01 is policy
   only, so a signed artifact is irrevocable in practice. The Owner can refuse to
   *record* it; it cannot un-sign it.
2. **The customer path does not go through the Owner.** The customer runtime
   verifies a `VLIC2` against `LICENSE_SIGNING_PUBLIC_KEYS`. A T-1…T-8 artifact
   handed directly to the customer verifies and is accepted. The Owner's import
   refusal never runs, so it protects the ledger and not the customer.
3. **The offline signer has already consumed the authorization.** The one resource
   that cannot be restored — a use of the authority key — has been spent on terms
   nobody approved.

So the control must sit at the signer, before the key is read. §4.2 check 10 and
§4.4 do that. T-10 is treated separately because it is a *replay* rather than an
alteration: the digest is unchanged and correct, so no digest check can catch it —
see §4.2 check 11 and §15's staleness item.

---

## 4. The offline signer

### 4.1 Packaging and isolation

The signer is a **standalone CLI in the Owner package**, never part of the Owner
HTTP surface and never reachable from it. Constraints it must satisfy:

- **No network path.** It reads a request file and a key from the operator's
  offline environment and writes an artifact file. It makes no call to the Owner
  API, the Owner database, or any customer system — preserving ADR-0048 Decision 3
  and PDR-11 §11.1.
- **Not in any deployable web image.** The Owner API image must not contain it, and
  a CI gate should assert that, mirroring `scripts/check-production-artifacts.py`'s
  existing assertion that the customer image contains no issuer.
- **Refuses to run where it should not.** The existing dev issuer refuses
  `NODE_ENV=production`; this signer is the *production* issuance tool, so the
  guard inverts: it must refuse to run when it detects it is inside the Owner API
  process or a networked service context, and must refuse a key supplied through
  the Owner runtime configuration.
- **Key from the operator, never persisted.** The private key is read from the
  operator's offline environment (a prompt or a path the operator supplies on that
  machine) and is never written to disk by the tool, never logged, never echoed,
  and never included in its output or exit messages.

### 4.2 Validation before signing (OD-LIC-08 step 3)

The signer **validates the request and refuses to sign an invalid one**. Checks 1–9
are **structural** — they prove the request is well-formed. As §3.6 shows, that is
not enough: every substitution attack T-1…T-9 is well-formed. Check 10 is the one
that establishes that this file is the file the Owner produced, and it runs
**before the private key is read**. Checks, all fail-closed:

1. Envelope shape and `fileVersion`; unknown top-level keys rejected.
2. Request payload schema; unknown fields rejected.
3. `customerId`/`customerCode` grammar and consistency per PDR-14 — the code is
   never derived from the name and never defaulted to the id.
4. `installationId` grammar (ULID).
5. Limits: positive integer or `null`; zero and negative refused.
6. Modules/features against the catalog; duplicates refused.
7. Dates: `validUntil === null` or strictly later than `validFrom`; `validFrom`
   not in the future relative to the signer's clock beyond a small documented
   transport tolerance; `requestedAt` not in the future.
8. `supersedesOperationId` and `renewsOperationId` mutually exclusive, and neither
   equal to this request's own `operationId`.
9. `status === "ACTIVE"`.
10. **[REVIEW RV-1; DECIDED — OD-LIC-11, PDR-19 §6.1] Out-of-band request-digest
    confirmation.** The signer computes the canonical bytes of the request payload it
    was given, derives `sha256` over them, and **requires the operator to enter the
    expected digest**. It refuses to sign unless the entered value equals the computed
    one, character-for-character, as **exactly 64 lowercase hex**. The expected value
    comes from the Owner UI (§12) over a channel **independent of the request file
    itself** — the file is what is under attack, so a digest read out of the same
    file, or from anything derived from it, proves nothing and **is not an independent
    path**. An **absent, empty, malformed, shortened or mismatched** value causes
    refusal, a **non-zero exit**, and the private key **not being read or loaded**.
    This is what makes T-1…T-9 detectable *before* a signature exists.

    Now a **decision**, not a proposal. OD-LIC-11 fixes all of: the full 64-hex value
    (shortening or omission **forbidden** — a truncated code is grindable by an
    attacker who can rewrite the file), the independent-path requirement, the
    ordering (validate before reading **or loading** the key), and the failure
    behaviour. `request_binding_sha256` remains a **separate** import-time control and
    is never substituted for this value.
11. **[REVIEW RV-1, T-10] Duplicate-suppression record.** The signer keeps a local,
    append-only record of the `operationId`s it has signed, in the operator's
    offline environment only, and refuses to sign an `operationId` it has already
    signed. This is the only available defence against T-10 at the signer, because a
    replayed file has a *correct* digest. It is **proposed hardening, not a
    guarantee**: the record lives on the offline machine, so it does not survive a
    signer reinstall or a second signing station, and the Owner's own uniqueness
    constraints (§5.1 `operation_id` unique, §9.1 state machine) remain the
    authoritative duplicate control. No network call is made, no Owner state is
    consulted.

Checks run in this order and **the key is read only after all of them pass** — a
refusal must not leave key material in the process at all.

The signer **cannot** validate the commercial facts — whether this customer should
get these limits, or whether this installation identity is really that customer's
server. Those are Owner-record facts and human responsibilities; the signer only
guarantees that what it signs is well-formed **and is byte-for-byte the request the
Owner produced** — which is exactly what check 10 adds and what checks 1–9 could
not.

### 4.3 Output

The signer writes the `VLIC2` artifact and the `vardena-license` file envelope with
the `keyId` of the key used, so the customer's trust-list lookup is addressable
(ADR-0046 Decision 7). It prints a SHA-256 of the artifact for the operator to
compare against what the Owner records at import — an out-of-band integrity check
that costs nothing and catches a corrupted transfer.

**[REVIEW RV-1]** It also prints `request_payload_sha256` (the value check 10
confirmed) and `request_binding_sha256` (recomputed from the projection it actually
signed, per §3.4), so the operator can carry both back and the Owner can compare the
binding digest without waiting for the artifact round trip. Printing a digest is
safe: neither value is secret and neither reveals the key.

It writes **no** log containing the key, the raw private material, or a full payload
dump. A check-10 refusal is recorded locally with both digests and the reason,
**never** with the payload — a tampered payload is commercial data about a real
customer and does not belong in a file on a shared offline machine.

### 4.4 How the signer authenticates the request — options and the stop — **[REVIEW RV-1] new**

The signer has **no channel to the Owner** (no network — that is OD-LIC-08) and the
Owner holds **no key** (also OD-LIC-08). So the signer can only use what is in the
file, what the operator brings separately, and what is pinned in its own offline
environment. Four options exist. One is adopted, one is documented and **stopped**,
two are rejected.

**O-A — out-of-band digest confirmation. ADOPTED and DECIDED (OD-LIC-11, PDR-19 §6.1; §4.2 check 10).**
The Owner displays `request_payload_sha256` in its UI; the operator carries that
value to the offline environment over a channel independent of the file; the signer
refuses to sign on mismatch.

- *Satisfies* the requirement that tampering be detected and refused **before** a
  signature exists, and that the signer establish integrity itself.
- *No new key, no new signed format, no protocol change, no canonicalization
  change, no `VLIC2` change, no customer-side change.* The license private key never
  moves and the Owner still holds no key, so OD-LIC-08 and D-5 are untouched.
- *Air-gap compatible:* a SHA-256 digest is data, not a credential. It can be read
  aloud, printed, or carried on second media.
- *Residual risk, stated plainly:* it fails if the attacker controls **both** the
  file and the out-of-band value — a fully compromised or colluding operator, or an
  attacker who also intercepts the printed slip. That is an insider boundary; no
  option below removes it either, because in every option a human moves the file.
- *The confirmation value must not be shortened.* A truncated code is grindable: an
  attacker who can rewrite the file can search for a tampered payload whose digest
  matches a short code, so shortening converts an infeasible attack into a cheap one.
  **OD-LIC-11 makes 64 hex mandatory and forbids shortening or omission**, so this is
  no longer an open question in §15.
- *Cost:* a manual step per issuance, and a 64-hex transcription. This is the real
  price of an air-gapped signer and is not hidden.

**O-B — Owner-signed request (a separate Owner-held request-signing key). DOCUMENTED AND NOT ADOPTED — the Product Owner chose O-A (OD-LIC-11, 2026-10-20), so this option is closed unless a new decision reopens it.**
The Owner signs the `VLSR1` payload with a key of its own; its public part is pinned
in the offline signer; the signer verifies that signature before using the license
authority key.

- *Would add:* cryptographic **authenticity of origin**, not just integrity — the
  signer would know the request came from the Owner rather than merely matching a
  value a human read aloud. It removes the transcription step and survives operator
  carelessness (though not collusion: a complicit operator still cannot forge a
  request without the Owner key).
- *Would cost:* it places a **new private key inside the Owner web process, its host
  and its configuration**. That is precisely the custody shape readiness D-5
  **rejected** for the license key, now instantiated for a second key. It does not
  breach OD-LIC-08 literally (that decision governs the *license* key), but it
  re-opens U-1/OQ-74 for this key — compromise response, containment, provenance,
  rotation cadence — none of which is decided. It also creates a **second signed
  format**, which needs its own assessment against PDR-16's "no new canonicalizer /
  no signed byte format change" constraints, and it adds an offline key-distribution
  and rotation dependency to an air-gapped tool: pinned public keys must be updated
  by hand, out of band, forever.
- *Why it was stopped, and its disposition:* it needs a new key, a request signature
  and a new protocol element, so the review recorded it with its consequences and did
  **not** adopt it. **On 2026-10-20 the Product Owner chose O-A (OD-LIC-11), which
  authorizes no new key, no new signed format, no canonicalization change, no vector
  change and no customer-side change.** O-B is therefore **not adopted**. It is kept
  here because it is the stronger control and a future decision may want it, but
  building it would require a **new** product decision plus a custody answer for the
  second key while U-1/OQ-74 is OPEN. **O-A is what this design builds.**

**O-C — structural validation only. REJECTED.** This is the design as originally
written (§4.2 checks 1–9). It cannot distinguish a well-formed substitution, so
T-1…T-9 all pass. It must not remain the implicit answer.

**O-D — a digest carried inside the same file. REJECTED.** Self-describing
integrity: the attacker recomputes the digest after editing the payload. It provides
nothing and is recorded so nobody "solves" the problem this way.

**Boundary respected by every option above.** `VLIC2`, the canonicalization rules,
the vector corpus and the Owner/customer separation boundary are **unchanged**.
Neither O-A nor O-B was made simpler by altering the signed format, and the request
artifact stays unsigned in the adopted design.

---

## 5. Data model

All tables in schema `owner`, additive migration `007-owner-license-issuance.sql`,
forward-only, no destructive rollback, safe on both a fresh and a populated
database, no backfill of invented facts.

### 5.1 `owner.license_issuances` — the issuance ledger

One row per issuance attempt, created at **request** time, so an interrupted
transport can never produce an unrecorded signature (Owner-side architecture §3.6
step 7).

| Column | Notes |
|---|---|
| `id` | ULID PK |
| `customer_id` | FK → `owner.customers(id)`, `NOT NULL` |
| `customer_code` | Denormalized snapshot, PDR-14 grammar, immutable — the code cannot change later, so the signed fact stays interpretable |
| `license_id` | ULID, unique — goes into the signed payload |
| `operation_id` | ULID, **unique** — the signed replay identity; the uniqueness constraint is what stops one request being signed and recorded twice |
| `installation_id` | FK → `owner.installation_identities(id)` (§5.3), `NOT NULL` |
| `license_kind` | `'PERPETUAL' | 'TIME_LIMITED'`, derived and checked against `valid_until IS NULL`, never entered independently |
| `valid_from`, `valid_until` | `timestamptz`; `valid_until IS NULL` ⇔ perpetual; CHECK enforces `valid_until > valid_from` when present |
| `organization_limit`, `user_limit` | `integer NULL`; CHECK `> 0` when not null |
| `device_limit`, `device_limit_specified` | The UNSPECIFIED-vs-unlimited distinction must be stored as two columns, exactly as the signed payload carries it — collapsing them into one nullable column would lose a signed fact |
| `module_entitlements`, `feature_entitlements` | `text[]`, CHECK for no duplicates and non-empty modules |
| `limit_profile_id` | FK → §5.2, **nullable** (F-1 hybrid: null means no ceiling was stored) |
| `signing_key_id` | FK → `owner.signing_keys(id)`, nullable until the artifact is imported, because the Owner does not know which key the offline signer used until the envelope says so |
| `protocol_version`, `file_format_version` | `'VLIC2'`, `1` — the format identity, so a future format change is explicit rather than implicit |
| `status` | The state machine of §9.1 |
| `request_payload_sha256` | **[REVIEW RV-2]** The pinned digest of the **whole request payload**, confirmed out-of-band by the signer before signing (§3.4, §4.2 check 10) |
| `request_binding_sha256` | **[REVIEW RV-2] new.** The pinned digest of the **binding projection** — the exact `VLIC2` wire payload this request commits to (§3.4). Compared against the returned artifact at import. A separate column, not a recomputation, because the two digests are over different field sets and confusing them was the original defect |
| `request_file_name` | Safe filename for the request the operator downloaded |
| `requested_at`, `requested_by` | Server clock and actor |
| `signed_at`, `signed_by`, `imported_at`, `imported_by` | Nullable until those steps happen |
| `artifact_sha256`, `artifact_store_key` | Nullable until import; the only pointer to the stored file (§8) — never a client-supplied path |
| `created_at`, `updated_at` | `clock_timestamp()`, matching the existing convention |

**No JSONB column.** Instruction §4 forbids a vague all-purpose structure, and
every field above is a typed domain fact with its own constraint.

Immutability follows the existing pattern: identity, customer, license/operation
ids, dates, limits, entitlements and **both** `request_payload_sha256` and
`request_binding_sha256` are frozen by a `BEFORE UPDATE` trigger, mirroring `owner.immutable_operation_facts`. Only status
and the step timestamps/actors may advance, and only along §9.1's legal path.

### 5.2 `owner.customer_limit_profiles` — the optional ceiling (F-1 hybrid)

Exists because the Product Owner chose the hybrid: when a profile exists for a
customer, the operator is bounded by it.

| Column | Notes |
|---|---|
| `id` | ULID PK |
| `customer_id` | FK → `owner.customers(id)`. **[REVIEW RV-3]** **Not** a column-level `UNIQUE` — see the constraint correction below |
| `organization_limit`, `user_limit` | `integer NULL`, CHECK `> 0` when not null; `NULL` means the profile places **no** ceiling on that dimension, which is different from `0` |
| `allowed_modules` | `text[]`, non-empty, no duplicates, catalog-validated |
| `perpetual_allowed` | `boolean NOT NULL DEFAULT false` — recorded so a profile can state that this customer may never receive a perpetual grant from an operator, which is the natural Owner-side use of the ceiling. `OWNER_ADMIN`-only perpetual issuance (OD-LIC-07) is unaffected and stays enforced by permission |
| `status` | `'ACTIVE' \| 'RETIRED'` — retired profiles never bind a new issuance but must remain readable, because past issuances reference them. **[OD-LIC-13]** The transition `RETIRED → ACTIVE` is **legal** (reactivation), so status is not terminal in the `RETIRED` direction |
| `created_by`, `updated_by`, `created_at`, `updated_at` | `OWNER_ADMIN` only |

**[REVIEW RV-3] Constraint correction — the table contradicted itself.** The column
list declared `customer_id` **unique** while the same table declared a `RETIRED`
status whose rows "must remain readable, because past issuances reference them", and
§5.1 stores `limit_profile_id` per issuance. Those cannot all hold:

- With a column-level `UNIQUE(customer_id)`, only **one row per customer can ever
  exist**. Once retired, the retired row still occupies the unique slot, so a
  replacement profile can never be created.
- Retired rows would then be permanent dead ends, and history would be limited to a
  single row — the "readable history" the table promises cannot accumulate.
- Worst of all, the dead end is a **security** dead end: under F-1 the absence of an
  `ACTIVE` profile is the *more permissive* branch, so retiring the only profile for
  a customer and being unable to replace it leaves every future issuance for that
  customer bounded **only** by the operator's permissions. A mistake in retirement
  would silently widen operator freedom with no in-product recovery.

**Correction.** Enforce uniqueness of the **active** profile only, with a partial
unique index, and preserve history:

```sql
CREATE UNIQUE INDEX customer_limit_profiles_one_active_per_customer
  ON owner.customer_limit_profiles (customer_id)
  WHERE status = 'ACTIVE';
```

This gives exactly the property the design claimed — at most one active ceiling per
customer, so "which profile bound this issuance" is never ambiguous — while allowing
a retired profile to be replaced. It is the same partial-index idiom PostgreSQL
already provides and adds no JSONB, no trigger and no new state.

**Lifecycle (now explicit).**

- **Creating a profile where none exists:** allowed, `OWNER_ADMIN` only.
- **Retiring the active profile:** allowed, `OWNER_ADMIN` only, reasoned and audited.
  The confirmation screen must state the consequence in Persian: after retirement
  **no ceiling is in force** for that customer and issuance falls back to the F-1
  no-profile branch. This is not a new policy — PDR-19 §5.1 records that absence of a
  profile means "no stored ceiling, **not** issuance forbidden", and explicitly says
  no "profile required before issuance" rule may be inferred. Retirement is therefore
  permitted but must be **loud**, never silent.
- **Reactiving the same retired profile: ALLOWED — decided by OD-LIC-13 (PDR-19 §6.3,
  2026-10-20).** `RETIRED → ACTIVE` on the *same row*, as an explicit authorized
  operation. This supersedes the retire-plus-create recovery path this section
  originally proposed, and removes the trap the review found: because F-1's no-profile
  branch is the *more permissive* one, a mistaken retirement widened operator freedom,
  and under the original column-level `UNIQUE` it was unrecoverable inside the product.
  Reactivation restores **exactly** the same ceiling on the same row, so the
  `limit_profile_id` snapshots past issuances hold stay meaningful.

  Constraints OD-LIC-13 makes binding:

  - **At most one `ACTIVE` profile per customer must hold *before* the reactivation
    takes effect.** If another profile for that customer is already `ACTIVE`,
    reactivation must **fail** — it may not bypass, defer, or silently retire the
    other one. The partial unique index above enforces this **at the database level on
    the `UPDATE` itself** (PostgreSQL checks the index when the updated row newly
    satisfies the predicate), so the guarantee does not rest on the service layer
    alone; the service must still refuse first, with a clear reason.
  - **Reactivation is not concurrent multiplicity.** Two `ACTIVE` profiles for one
    customer at any instant remain impossible.
  - **The ceiling columns stay immutable across reactivation.** Reactivation restores
    the identical `organization_limit`, `user_limit`, `allowed_modules` and
    `perpetual_allowed`; it is **not** a way to edit a profile. Changing a ceiling is
    still retire-plus-create.
  - **History is never deleted or rewritten.** Both the retirement and the
    reactivation stay visible, with actor, server time, target profile and outcome
    (§10). Transitions may repeat, so a retire→reactivate→retire sequence remains
    fully legible.
  - **Authorization is `limit_profiles.manage`**, which is `OWNER_ADMIN`-only and
    ineligible for `LICENSE_OPERATOR` (§6.1) — an operator can never reactivate the
    ceiling that bounds them.
  - **Absence semantics unchanged.** "No stored ceiling" still does **not** mean
    "issuance forbidden" (F-1, PDR-19 §5.1), and no "profile required before
    issuance" rule may be inferred.

  **Migration consequence:** whatever status trigger `007` defines must **permit**
  `RETIRED → ACTIVE`. This section originally described retired rows as terminal and
  its trigger wording forbade the transition; that wording is corrected here and must
  not be carried into the migration.
- **Editing a profile:** the ceiling columns of an `ACTIVE` **or `RETIRED`** profile
  are **immutable**. Changing a ceiling is retire-plus-create, so the profile that
  bound a past issuance can never be rewritten underneath it. `updated_by`/`updated_at`
  therefore record **status transitions only**, never value changes.
- **Retired rows are never deleted**, and their ceiling values are never rewritten —
  only their status, actor and timestamp advance. This is the append-only discipline
  the rest of the Owner schema follows, narrowed to the one column OD-LIC-13 makes
  mutable.

**Binding rule.** At request creation, if an `ACTIVE` profile exists for the
customer, every requested limit must be within it: a requested cap must be `NULL`
only where the profile is `NULL`, and `<=` the profile's cap otherwise; requested
modules must be a subset of `allowed_modules`; and a perpetual request is refused
when `perpetual_allowed` is false. Refusal is a distinct, stable reason with the
profile's values in the safe error payload, so the operator sees *which* ceiling
blocked them.

If **no** `ACTIVE` profile exists, no ceiling is applied and the operator's entry
is bounded only by their granted permissions (§5.2 of PDR-19). The UI must show
which case is in force — an operator must not read "no profile" as "profile with no
ceiling".

**Which profile bound an issuance, and what happens mid-flow. [REVIEW RV-3]**

- `license_issuances.limit_profile_id` is a **snapshot reference**: it records the
  profile that was `ACTIVE` at request creation, or `NULL` when none was. It is part
  of the immutable fact set (§5.1), so a later retirement or replacement never
  rewrites which ceiling a past issuance was measured against.
- **The ceiling is evaluated once, at request creation — DECIDED by OD-LIC-14
  (PDR-19 §6.4, 2026-10-20).** A profile retired, replaced or reactivated *after* the
  request exists does **not** invalidate that request, and the returned artifact is
  still imported and recorded. **New** requests are evaluated against the **current**
  profile state. This design originally adopted the rule as an engineering analogy to
  F-2's revocation semantics and flagged it as changeable; the Product Owner has now
  confirmed it, so it is a recorded decision and the §15 item is closed.

  What OD-LIC-14 explicitly does **not** permit, and what this design must not be read
  as allowing: altering a request payload after creation (the §5.1 immutable-facts
  trigger still freezes identity, dates, limits, entitlements and **both** digests);
  bypassing OD-LIC-11's integrity controls (the signer's out-of-band digest check and
  the Owner's `request_binding_sha256` comparison both still apply to an in-flight
  request); or ignoring any other security or state control — permission checks
  including §7.4's revoked-grant rule, actor validity, key trust and `ACTIVE` status,
  the §9.1 state machine, and the artifact store's digest re-verification. In-flight
  behaviour also stays **distinct** from new-request behaviour and from the
  replay/supersession rules of PDR-12 and PDR-18 §9.

  **Accepted consequence, to stay visible:** for a bounded window an issuance can
  complete against a ceiling that no longer applies, and because OQ-78 is OPEN that
  completion is irrevocable in practice. The window cannot be used to smuggle
  *different* terms through, because the snapshot is exactly what the signer confirms
  and what the Owner verifies at import.
- The binding digest of §3.4 makes this safe: the limits that were checked against
  the profile at creation are the limits the projection pins, so a post-retirement
  attempt to raise them is refused at the signer (check 10) and again at import.
- A `RETIRED` profile must therefore stay **resolvable** for as long as any issuance
  references it — which is why retirement is a status and never a delete, and why the
  partial unique index above is required rather than a plain `UNIQUE`.

The profile is an Owner-side ceiling on what may be signed. It is **not** a
customer entitlement, not a commercial contract record, and not a substitute for
PDR-18 §1's date rules.

### 5.3 `owner.installation_identities` — OD-LIC-09

Separate from `owner.operational_records.installation_reference`, which keeps its
existing meaning as an *observed* reference and must not be silently promoted to
signed identity.

| Column | Notes |
|---|---|
| `id` | ULID PK |
| `customer_id` | FK → `owner.customers(id)` |
| `installation_id` | The customer's server-generated ULID, validated against ULID grammar. Unique per customer |
| `source` | Where the value came from. Initial vocabulary: `'CUSTOMER_VARDENA_SCREEN'` (OD-LIC-09's "read from the customer's Vardena page"). Extensible by migration, never by client input |
| `source_detail` | Bounded free text, optional, control-character and secret-pattern rejected as migration `006` already does |
| `confirmed_by` | FK → `owner.users(id)` — the operator who confirmed it |
| `confirmed_at` | Server clock |
| `confirmation_evidence_ref` | Bounded optional reference, matching the existing `evidence_ref` convention |
| `status` | `'ACTIVE' | 'RETIRED'` |
| `created_by`, `created_at` | Immutable |

**The recorded source is a claim, never a proof.** ADR-0048 Decision 5 stands, so
no API response, UI label or audit event may describe this binding as
cryptographically verified. The residual risk PDR-19 §3 records is **not**
eliminated by this table: a transcription error still yields a validly signed
artifact bound to the wrong server.

**Confirmation flow (design).** Registration is a two-step UI act: enter the
identifier, then an explicit confirmation screen that displays the resolved
customer, the identifier, the source and the consequence of an error, and requires
a deliberate confirm. The confirmation is what `confirmed_by`/`confirmed_at`
record. Whether re-entry (typing it twice) is also required is a UX decision
proposed here as **yes for the first slice**, because it is the cheapest available
mitigation of a transcription error that cannot be undone.

An issuance may only reference an `ACTIVE` identity belonging to the **same
customer** as the license, enforced by a compound FK, so a cross-customer binding
is impossible at the schema level and not merely at the service level.

### 5.4 `owner.user_permission_grants` — F-2

| Column | Notes |
|---|---|
| `user_id` | FK → `owner.users(id)`, part of PK |
| `permission` | `text`, part of PK, CHECK against the exact known vocabulary — **no wildcard, no prefix, no pattern** |
| `granted_by` | FK → `owner.users(id)`, must be an `OWNER_ADMIN` |
| `granted_at` | Server clock |
| `revoked_by`, `revoked_at`, `revocation_reason` | Nullable; set together or not at all, by CHECK |

**[REVIEW RV-3] The three grant states, defined separately.** The original text used
"no grant" and "revoked" interchangeably. They are different facts and resolve
differently:

| State | Row condition | Meaning | Effect on effective set |
|---|---|---|---|
| **No record** | no row for `(user_id, permission)` | the permission was **never** granted to this user | contributes nothing — the permission is **not** in the effective set |
| **Active grant** | a row with `revoked_at IS NULL` | `OWNER_ADMIN` granted it and has not revoked it | contributes the permission, **if** the role is eligible for it |
| **Revoked grant** | a row with `revoked_at` set (plus `revoked_by`, `revocation_reason`) | it was granted and then withdrawn | contributes nothing; the row survives as history and as the audit trail of the withdrawal |

Revocation is a **row update, never a delete**, so the history of who had what
survives — consistent with the append-only discipline elsewhere in the Owner schema.
A revoked row is therefore *not* the same as no row: both deny, but only the revoked
row records that the permission was once held and by whose decision it was taken
away. Re-granting after revocation is an update of the same row back to
`revoked_at IS NULL` with a fresh `granted_by`/`granted_at`, so the sequence of
grant→revoke→re-grant stays visible rather than being collapsed.

Only `LICENSE_OPERATOR` users may hold grants (§5.2 of PDR-19: `OWNER_ADMIN` is not
configurable), enforced by a trigger that also refuses a grant of the
perpetual-issuance permission to any operator.

**Effective permission resolution.** For `OWNER_ADMIN`, the static role set,
unchanged and not configurable (PDR-19 §5.2). For `LICENSE_OPERATOR`:

```
eligible(role)     = the permissions PDR-17 gives LICENSE_OPERATOR, extended by the
                     issuance permissions that role is eligible for (§6)
effective(user)    = eligible(role) ∩ { p : an ACTIVE grant row exists for (user, p) }
```

**Intersection, never union.** Two guarantees follow and both are enforced by schema
trigger **and** service, so neither depends on one layer:

1. **A grant can never widen.** Because the result is intersected with `eligible`,
   a grant of a permission the role is not eligible for contributes nothing even if a
   row is somehow written — and writing it is refused in the first place. No grant can
   reach `licenses.issue.perpetual`, `limit_profiles.manage`, `users.manage`,
   `audit.archive`, `customers.write`, `replacements.authorize`, or any `OWNER_ADMIN`
   capability. That preserves OQ-75's "no new signing, custody, or recovery
   permission is inferred".
2. **A grant can only narrow.** Removing or revoking a grant removes access; there is
   no path by which the grant table adds an ability the role baseline does not
   already contain.

This is the mechanism PDR-19 §5.2 records verbatim ("effective access therefore
becomes the intersection of the role and that user's explicit grants").

Resolution happens **inside the same locked transaction** as the work, using the
existing `assertActiveAuthorizedActor` shape, so no stale decision is taken from a
session, a cookie or the frontend.

**Default for a new operator — DECIDED: R-1 (OD-LIC-12, PDR-19 §6.2, 2026-10-20).**
A newly created `LICENSE_OPERATOR` has an **empty effective permission set**.
Operator creation writes **no** grant rows. Without an active explicit grant the
permission is **denied**; holding the role, or being *eligible* for a permission, is
**not** by itself access.

**This closes the question the review stopped on.** The withdrawn sentence above had
asserted union semantics; the review replaced it with two candidate readings (R-1 no
seeding, R-3 seed the baseline as explicit grant rows) and recommended R-3. **The
Product Owner chose R-1 and rejected R-3.** Nothing here may be read as preserving an
implicit operator baseline.

**Consequence for the four permissions the role holds today.** `customers.view`,
`audit.view`, `operations.view` and `operations.record`
(`owner-licensing/backend/src/domain.ts:33-38`) become **eligible but not effective**.
An `OWNER_ADMIN` must grant each one explicitly before the operator can use it. The
static `permissions(role)` function therefore **must not** be used as the effective
check once this is implemented — it now describes *eligibility*, not access. That is a
real behavioural change for `LICENSE_OPERATOR` and PDR-17's matrix documentation must
be updated with the code (§14).

**Operational consequence, to be surfaced rather than softened.** A newly created
operator can do **nothing at all** — not even open the customer list — until
`OWNER_ADMIN` grants permissions one by one. Provisioning becomes a two-step,
two-person act (create the user, then grant), and a provisioning gap presents as an
operator that *appears broken* rather than as an error. The UI must make this
legible (§12): an operator with no grants needs a visible empty state naming what is
missing, and the admin surface must show which permissions each operator actually
holds. None of this is a reason to weaken R-1; it is the cost of "no permission is
inferred" being literally true for every permission rather than only the issuance
ones.

**What R-1 does not change.**

- `OWNER_ADMIN` is **not** placed under the grant model, appears in no grant table,
  and its access is **unchanged** — OD-LIC-12 forbids changing it without an explicit
  decision. A trigger refuses any grant row naming an `OWNER_ADMIN`.
- Effective access is still `eligible(role) ∩ active grants` — intersection, never
  union — so a grant can narrow but **never widen**.
- `licenses.issue.perpetual` and `limit_profiles.manage` stay **ineligible** for
  operators under OD-LIC-07 and F-2. R-1 does not make them grantable; issuance,
  perpetual issuance and limit-profile management continue to be governed by the §6.1
  matrix and their own separate rules.
- A revoked grant confers nothing, but the revocation history and the revoking actor
  are preserved; revocation stays a row update, never a delete.
- The F-2 revocation trade-off of PDR-19 §5.2 — a revoked user may still complete a
  request already produced — is **unchanged** by R-1, and §7.4 still narrows it as far
  as that decision allows.

---

## 6. Permission vocabulary — **[REVIEW RV-3] now a definitive matrix**

§6 previously listed only the six *new* codes and described the eight existing ones
in prose ("become configurable … where that role is eligible"). That left the
effective set of a real user to be assembled from two places. The review requires one
definitive table covering **both roles and every permission**, so this is it. Codes
follow the existing `noun.verb` convention (`customers.write`,
`operations.record`, `replacements.authorize`).

### 6.1 The complete matrix

`Baseline` = what PDR-17 / `domain.ts:20-39` gives the role **today**.
`Eligible` = whether a per-user grant row may exist for that role at all — the
`eligible(role)` set of §5.4. `Configurable` = whether `OWNER_ADMIN` may grant and
revoke it per user (F-2 scope).

| Permission | Meaning | `OWNER_ADMIN` | `LICENSE_OPERATOR` baseline | `LICENSE_OPERATOR` eligible | `LICENSE_OPERATOR` configurable |
|---|---|---|---|---|---|
| `customers.view` | List and inspect customers | yes (static) | **yes** | yes | **yes** |
| `customers.write` | Create or mutate a customer | yes (static) | no | **no** | no |
| `users.manage` | Manage Owner users and roles | yes (static) | no | **no** | no |
| `audit.view` | Read the audit trail | yes (static) | **yes** | yes | **yes** |
| `audit.archive` | Archive audit batches | yes (static) | no | **no** | no |
| `operations.view` | Read operational records | yes (static) | **yes** | yes | **yes** |
| `operations.record` | Record a routine observation | yes (static) | **yes** | yes | **yes** |
| `replacements.authorize` | Authorize server replacement / old-server loss | yes (static) | no | **no** | no |
| `licenses.issue.time_limited` | Create a signing request for a **time-limited** license | yes (static) | no *(new)* | yes | **yes**, fail-closed default |
| `licenses.issue.perpetual` | Create a signing request for a **perpetual** license | yes (static) | no *(new)* | **no** | **no — outside the configurable set** (OD-LIC-07) |
| `licenses.import` | Import and record a returned signed artifact | yes (static) | no *(new)* | yes | **yes**, fail-closed default |
| `licenses.view` | List and inspect issuances | yes (static) | no *(new)* | yes | **yes** |
| `licenses.download` | Download a stored signed artifact | yes (static) | no *(new)* | yes | **yes** |
| `limit_profiles.manage` | Create or retire a customer limit profile | yes (static) | no *(new)* | **no** | **no** — the profile is the Owner's ceiling on the operator, so an operator must not be able to raise it |

Reading the matrix:

- **`OWNER_ADMIN` is never configurable** and never appears in `user_permission_grants`.
  Its set is the static role set, unchanged (PDR-19 §5.2). A trigger refuses any
  grant row naming an `OWNER_ADMIN`.
- **Perpetual issuance stays `OWNER_ADMIN`-only.** `licenses.issue.perpetual` is
  *ineligible* for `LICENSE_OPERATOR`, so under §5.4's intersection it can never
  enter an operator's effective set even if a row were forced into the table — and
  writing the row is refused first. OD-LIC-07 is enforced by vocabulary, trigger,
  service and the intersection rule, not by one of them.
- **The four existing operator permissions are preserved, not expanded.**
  `customers.view`, `audit.view`, `operations.view` and `operations.record` remain
  the role's baseline and become configurable exactly as F-2's scope decision
  requires. No permission the operator does not hold today is added by this design
  except the four issuance ones, each of which requires an explicit grant.
- **Eligibility is a closed list.** Anything not marked eligible above is
  ineligible; there is no wildcard, no prefix and no pattern, so a future code is
  ineligible until this table is amended by migration and review.
- **`operations.record` is not issuance authority.** It authorizes only observations
  whose responses state `signedArtifactProduced = false`; nothing in this matrix
  changes that, and holding it grants no part of the issuance path.

### 6.2 New-operator defaults

| Permission group | Default for a newly created `LICENSE_OPERATOR` | Decided? |
|---|---|---|
| `licenses.issue.time_limited`, `licenses.import`, `licenses.view`, `licenses.download` | **Denied** — no grant row. Fail-closed | **Yes** (PDR-19 §5.2) |
| `licenses.issue.perpetual`, `limit_profiles.manage` | **Denied** — ineligible, cannot be granted | **Yes** (OD-LIC-07, F-2 scope) |
| `customers.view`, `audit.view`, `operations.view`, `operations.record` | **Denied** — eligible but **not effective**; no grant row is written at creation, so `OWNER_ADMIN` must grant each one explicitly | **Yes — OD-LIC-12 chose R-1** (PDR-19 §6.2); R-3 rejected |
| Everything else | **Denied** — ineligible | Yes |

**Every row of this table is now decided.** Under OD-LIC-12 (R-1) no permission is
effective for a new operator without an explicit active grant, so the four baseline
permissions join the issuance ones in requiring a grant — the difference from R-3 is
that **no rows are seeded at creation**. Implementation of operator creation no longer
waits on a product answer; it waits on the permission-code vocabulary (OQ-75) and on
this design's approval.

### 6.3 Denial rules that do not depend on the matrix

Unknown codes deny. Superseded four-role identifiers continue to deny and receive
`[]`. A grant of an ineligible permission to an operator is refused by the schema
trigger **and** by the service, so the restriction does not depend on one layer. An
inactive user denies everything regardless of grants, and a user under
`must_change_password` is refused on every sensitive action, both reusing the
existing `assertActiveAuthorizedActor` shape rather than adding a second notion of
"allowed".

---

## 7. Transaction, atomicity and failure behaviour

### 7.1 The two-resource problem is real and is not claimed away

Instruction §8 is right that a PostgreSQL transaction cannot make a filesystem
write atomic. This design has **three** stores: the Owner database, the request
file handed to the operator, and the artifact store of §8. They are reconciled by
**ordering plus a recoverable staging state**, not by pretending one transaction
covers them.

**Request creation (step 1)** — one database transaction:
validate actor and permission → lock the customer row → resolve-or-create the
customer (PDR-14 code validation) → resolve the `ACTIVE` installation identity →
apply the limit profile if one exists → mint `operationId`/`licenseId` → pin dates
from the server clock (§2) → compute and store `request_payload_sha256` → insert
the issuance row as `REQUEST_PREPARED` → audit → commit. **Then**, outside the
transaction, serialize the request file and stream it to the operator.

The artifact handed to the operator is **derived entirely from the committed row**,
so it can always be regenerated byte-identically. If streaming fails, the row
exists and the operator re-downloads — no orphan file, no unrecorded request. The
row is not marked complete by a successful download; it stays `REQUEST_PREPARED`
until an artifact returns.

**Import (step 4)** — staged, then one database transaction:

1. Outside any transaction, write the uploaded artifact to a **staging path** in
   the artifact store (a temporary name, not the final write-once name).
2. Verify the signature with the Owner verifier against the trusted public keys
   (§8.3), parse the envelope, and require the payload digest to equal the stored
   `request_payload_sha256` (§3.4).
3. Require the artifact's `operationId` to match the issuance row being completed.
   A signature valid but not matching any prepared row is refused — the Owner does
   not adopt artifacts it did not request.
4. Only now open the transaction: lock the issuance row, re-check status and actor
   permission, promote the staged file to its final write-once name with read-back
   verification, update the row to `SIGNED_RECORDED` with `artifact_sha256`,
   `artifact_store_key`, `signing_key_id`, `signed_at` and `imported_by`, write the
   audit event, commit.
5. On any failure after staging, **delete the staged file** and leave the row
   untouched at `REQUEST_PREPARED`.

Because promotion happens inside the transaction's critical section and staging is
outside it, the failure modes are bounded: a crash before commit leaves a staged
file that a startup sweep and a periodic cleanup remove, and a row still at
`REQUEST_PREPARED` that can be completed by retry. **There is no state in which a
row says issued while no artifact exists, or an artifact exists while no row
records it.**

### 7.2 Failure and retry

| Failure | Result | Retry |
|---|---|---|
| Validation, permission, profile-ceiling or unknown-field refusal at step 1 | Nothing written; refusal audited | Correct and retry; a new `operationId` is minted only if the previous row is explicitly abandoned |
| Request file download fails | Row committed at `REQUEST_PREPARED` | Re-download; byte-identical |
| **First import at/after `requested_at + 14×24 h` (OD-LIC-20)** | Row moves `ABANDONED` in the import transaction, system-origin audit written, then the import is refused `409 InvalidTransition`; **nothing** else is written (no artifact, archive row, success audit) | **Do not retry and do not revive the row.** Prepare a new request with a new operation and license identity; the old row, its snapshot and audit history stay readable |
| Signer refuses on a **structural** check (§4.2 1–9) | No artifact; nothing changes in Owner | The request itself is wrong: fix it via a new issuance row; the old one is abandoned explicitly, never silently reused |
| **[REVIEW RV-1]** Signer refuses on **check 10** (digest mismatch) or **check 11** (duplicate `operationId`) | No artifact; nothing changes in Owner; the row is still correct | **Do not create a new issuance row.** The Owner's request and its pinned digests are untouched, and the request file is byte-identical on re-download (§7.2 above), so a check-10 failure means the **file was altered in transport**, not that the terms are wrong. The remedy is to re-transfer the file and re-confirm the digest against the Owner UI. Minting a new row here would burn a `licenseId`/`operationId`, erase the evidence that a tampering was attempted, and leave an orphan `REQUEST_PREPARED` row. Check 11 means the authorization was already consumed: the operator must confirm with the Owner rather than re-sign |
| Artifact fails verification, digest match or `operationId` match at step 4 | Staged file deleted; row stays `REQUEST_PREPARED`; refusal audited | Re-import the correct artifact |
| Crash between staging and commit | Staged orphan; row unchanged | Sweep removes the orphan; re-import succeeds |
| Re-import of the **same** artifact for the **same** row already `SIGNED_RECORDED` | Idempotent: return the recorded result, change nothing, and say it is a replay | No second row, no second artifact |
| Concurrent imports of one row | Serialized by the row lock; the loser sees the winner's state and returns the recorded result | No duplicate |

**Retry must not mint a second license.** `operation_id` and `license_id` are
unique, so a duplicate insert fails at the database rather than at the service
layer alone — the same lesson ADR-0046's PR #138 addendum records for
`license-binding-conflict`, where a pre-check alone was not a sufficient guard.

A repeated **successful** import returns the historical result with an explicit
replay indicator and the current state separately, following the shape PDR-18 §5
approves. The exact response DTO is OQ-81's open contract and is **not** decided
here; §15 records it.

### 7.3 A new customer must not be orphaned by a failed issuance

Instruction §12.2 item 18. Creating the customer and creating the issuance row
happen in **one** transaction (§7.1), so a refusal leaves no orphan customer. If
the issuance is later abandoned, the customer remains — which is correct, because
a customer is a durable business record, not a by-product of one attempt. Nothing
in this design deletes customers, and no deletion path exists in the Owner API.

### 7.4 Revoked grant mid-flow

Per PDR-19 §5.2, revocation blocks **new** requests only. A prepared request stays
completable. The design narrows that window as far as the decision allows without
exceeding it:

- Only the request's **creator**, or an `OWNER_ADMIN`, may import it — so
  attribution stays exact and a different operator cannot complete someone else's
  in-flight issuance.
- The importer must still be authenticated, active, not under
  `must_change_password`, and hold `licenses.import`.
- If the creator's `licenses.import` grant was revoked between request and import,
  the import is **refused** — the Product Owner's decision preserves the *request*,
  not a permission the actor no longer holds. `OWNER_ADMIN` can still complete it,
  and the refusal is audited.
- Every completion records whether a relevant grant was revoked in between, so the
  accepted trade-off is visible in the audit trail rather than silent.

This is an engineering reading of the decision, flagged as such; it never widens
what the Product Owner approved.

---

## 8. Artifact store and download (OD-LIC-10)

### 8.1 Storage

A dedicated durable file store **outside PostgreSQL**, following the
`FilesystemAuditArchiveStore` pattern: write-once (`link` + `unlink`, `chmod
0o444`, file and directory `fsync`), read-back verification, and a hash-chained
manifest.

**Separate root, not the audit archive's.** Configured as
`OWNER_LICENSE_ARTIFACT_DIR`. License artifacts and audit bundles have different
retention, access and disclosure properties, and sharing one root would couple
their backup lifecycles and let one feature's access rule leak into the other. The
same caveat the README already records for `OWNER_AUDIT_ARCHIVE_DIR` applies: a
distinct filesystem path alone does not guarantee physical independence, and
provisioning a dedicated durable volume remains a deployment-owner requirement.

Fails closed with `503 ArtifactStorageUnavailable` when the directory is not
configured, mirroring `ArchiveStorageUnavailable`. A successful database write is
**never** reported as proof the artifact is durably stored.

Layout: `licenses/<ulid-prefix>/<issuance-id>.vardena-license.json`. The path is
computed **only** from the issuance id held in the database.

### 8.2 Download

- Requires `licenses.download` and the issuance to be `SIGNED_RECORDED`.
- Scoped by **issuance id**. The path is derived server-side from the stored
  `artifact_store_key`; **no part of it comes from client input**, so path
  traversal is impossible by construction rather than by filtering.
- Filename is the safe, stored `vardena-license` name; content type is
  `application/json`.
- Before serving, the stored file's SHA-256 is re-verified against
  `artifact_sha256`; a mismatch fails closed and is audited as a security incident
  under the existing `004` incident rules.
- Every retrieval is audited (instruction §9), without the artifact content.

### 8.3 Verifying the returned artifact — which keys does the Owner trust?

The Owner must verify a signature without holding a private key, and its
`signing_keys` table holds **no key material at all** (§1.3 of the assessment).
Verification therefore needs the **public** trust list.

**Design.** The Owner reads a public trust list from its own configuration,
`OWNER_LICENSE_TRUSTED_PUBLIC_KEYS`, using the **same grammar the customer uses**
(`keyId:<material>` or bare, derived id `sha256-<16 hex>`, duplicate ids rejected)
so a key id means the same thing on both sides and `signing_keys.id` can finally be
bound to something real. Public keys are not secret; storing them in configuration
is consistent with the customer runtime and with ADR-0046 Decision 7's "rotation is
a trust-list operation".

At import:

1. Resolve the envelope's `keyId` against the trust list. An unknown key is
   refused with a distinct reason — the Owner does not record an artifact its own
   trust list cannot explain, even if the signature is mathematically valid.
2. Verify the Ed25519 signature over the canonical payload bytes.
3. Require the resolved key id to reference an `owner.signing_keys` row whose status
   is `ACTIVE`. A key marked `COMPROMISED` or `REVOKED` **fails closed** —
   instruction §6's requirement, and the first thing that gives the OQ-74 metadata
   a real enforcement role instead of a decorative one.
4. **[REVIEW RV-1, RV-2] Compare the binding digest.** Re-canonicalize the decoded
   payload and require its `sha256` to equal the stored `request_binding_sha256`
   (§3.4). A mismatch means the signed terms are not the terms the Owner authorized —
   refused with a distinct reason, nothing recorded as issued, row left at
   `REQUEST_PREPARED`, and the refusal audited as `LICENSE_ARTIFACT_REJECTED`. This
   is the layer that needs no human cooperation; §4.2 check 10 is the layer that runs
   before the key is used. **Both are required** — see §3.6 for why this step alone
   cannot protect a customer who receives the artifact directly.
5. Require the decoded payload's `operationId` to equal the row's `operation_id`, so
   an artifact cannot be recorded against a different issuance than the one that
   requested it.
6. Record `signing_key_id` from the **resolved** key, never from operator input.

Step 4 compares the **binding** digest, never `request_payload_sha256` — the two are
over different field sets and comparing the wrong one refuses every legitimate
import (§3.4). A test asserts both the positive and the negative round trip
(§13.2).

Note the asymmetry this creates with OQ-74's policy: refusing to *record* a
compromised-key artifact on the Owner side does **not** invalidate licenses already
issued and imported by customers, which PDR-11 §4.4 forbids. Both hold: the Owner
stops issuing under a bad key; existing customer licenses are untouched.

The trust list is configuration, so changing it is a deployment act. That is
deliberate: rotation cadence and trust rollout are still U-1/OQ-74 open items, and
building a runtime key-administration surface would pre-empt them.

### 8.4 Backup, restore and integrity verification (OD-LIC-19)

Retention is **indefinite** and there is **no WORM claim and no automatic
deletion**. The archive is two stores with different lifecycles — PostgreSQL
metadata and filesystem bytes — and they are **not one atomic transaction**:
`archiveArtifact` inserts `PENDING`, writes and fsyncs the exact bytes, reads them
back, and only then settles the row `DURABLE`. A crash can leave a `PENDING` row
with (or without) its file; reconciliation, not the backup, resolves that state.

- **Backup:** PostgreSQL is dumped with PostgreSQL's own tooling; the artifact
  root is copied with `npm run artifacts:backup`, which first verifies every
  `DURABLE` row's byte size and SHA-256, refuses to copy an archive it cannot
  verify, skips (and reports) `QUARANTINED` rows since their bytes are already the
  recorded failure, and writes `artifact-manifest.json` (metadata only — no
  connection string, no customer data, no key material). The procedure and the
  honest consistency boundary are in
  [`artifacts-backup-restore.md`](../licensing/artifacts-backup-restore.md).
- **Restore gate:** `npm run artifacts:verify` is read-only and checks every row's
  exact bytes by **size and SHA-256** against `owner.license_artifacts` (or a
  backup manifest with `--backup`), lists unaccounted files, and reports
  `PENDING`/`QUARANTINED` rows as unsettled. It exits non-zero on any difference.
- **Recovery:** restore the original bytes from the backup; never regenerate a
  historical artifact and present it as the original. A missing or damaged file
  makes the affected artifact unavailable (download already fails closed) — the
  remedy is the backup copy, or a new issuance with new identities. An
  unregistered file is reported, never adopted; a `PENDING` row is settled by
  reconciliation when its bytes verify and quarantined otherwise.

The real drill (PostgreSQL 16.2 `pg_dump -Fc` → fresh database → `pg_restore` →
byte copy → verification, plus the missing/truncated/digest/orphan/staged cases)
is recorded in that document with its exact commands and results.

---

## 9. State machine

### 9.1 States

```
REQUEST_PREPARED ──import+verify ok, before the 14×24h boundary──▶ SIGNED_RECORDED  (terminal)
        │
        ├──explicit operator action──▶ ABANDONED                                  (terminal)
        │
        └──first import at/after requested_at+14×24h (OD-LIC-20)──▶ ABANDONED      (terminal,
                                                                    system origin)
```

- `REQUEST_PREPARED` — the Owner decided and produced a request. **No artifact
  exists. This is never presented as an issued license.**
- `SIGNED_RECORDED` — a verified artifact is stored and downloadable. Terminal.
- `ABANDONED` — terminal, and it never deletes the row, because the row is the
  record that a request was made. It has two origins:
  - an explicit, reasoned, audited operator act (`LICENSE_REQUEST_ABANDONED`,
    actor = the operator), or
  - **OD-LIC-20 expiry**, written by the system on the first completion/import at
    or after `requested_at + 14 × 24 h`. The audit row has `actor_id = NULL`
    (system origin) and a reason beginning with the reserved `SYSTEM_EXPIRY`
    marker; `abandoned_by` still names the operator whose attempt triggered the
    enforcement, because the schema requires a user there. `abandonIssuance`
    refuses a reason with that prefix, so a human act can never impersonate the
    system transition.
  The immutable snapshot is never touched by either origin; only the lifecycle
  columns change (§5.1's trigger enforces that).

No `PENDING_APPROVAL` state exists: PDR-17 forbids a pending-approval workflow, and
OD-LIC-08's round trip is a custody mechanism, not an approval step. No
cancellation, renewal, revocation or recovery state is defined, so none is
implemented — consistent with migration `002`'s existing discipline.

Renewal and supersession are **not** statuses. They are the `renewsOperationId` /
`supersedesOperationId` fields of a new issuance row, following PDR-18 §9 and
PDR-12. Whether an operator may create them at all is a permission question
(`licenses.issue.time_limited` plus the field), and the term-changing power of an
explicit supersession stays restricted per PDR-12 — §15 records that this needs an
explicit answer before an operator is given it.

### 9.2 Enforcement

Transitions are enforced by a `BEFORE UPDATE` trigger in the same style as
`owner.enforce_observed_transition`, so a direct SQL update cannot skip a state or
reach a terminal state illegally. Status may only advance along the arrows above;
`signed_at`/`imported_at` must be set together with `SIGNED_RECORDED` and must be
null otherwise; `artifact_sha256` and `artifact_store_key` likewise.

**OD-LIC-20 is enforced in the application, not in the trigger.** The age rule is
product policy, not a row invariant, so the import service holds the row lock and
evaluates `isPreparedRequestExpired(requested_at, now)` before any artifact
parsing, replay shortcut or state write. The clock is injected (`createApp`'s
`dependencies.now`, defaulting to real time) so conformance tests freeze it; the
durable timestamps (`abandoned_at`, audit `occurred_at`) still come from the
database clock. No client-supplied value participates: the anchor is the same
`requested_at` the signed payload's `issuedAt` must equal at import, so a signer
cannot choose a later creation instant.

### 9.3 Limit-profile state machine — **[OD-LIC-13] new**

Profiles have their own, much smaller lifecycle. Unlike the issuance states it is
**not** linear and has **no terminal state**, because OD-LIC-13 makes reactivation
legal:

```
(no row) ──create──▶ ACTIVE ⇄ RETIRED
                       ▲          │
                       └─reactivate┘      (repeatable)
```

- `ACTIVE` — binds new requests for that customer (§5.2). At most one per customer,
  enforced by the partial unique index.
- `RETIRED` — binds nothing, stays readable and referenced, and **may be reactivated**.
- Both transitions are `OWNER_ADMIN`-only (`limit_profiles.manage`), explicit,
  reasoned and audited.
- The trigger must permit **both** directions. The wording this design originally
  implied — retired rows terminal — is corrected; a migration that forbids
  `RETIRED → ACTIVE` would contradict OD-LIC-13.
- **Reactivation must fail if another profile for the same customer is already
  `ACTIVE`.** The partial unique index enforces this on the `UPDATE` itself, and the
  service refuses first with a clear reason, so the constraint holds at two layers.
- The ceiling columns are immutable in **both** states; only `status`,
  `updated_by` and `updated_at` may change (§5.2).

Installation identities keep the `ACTIVE | RETIRED` vocabulary of §5.3 but have **no**
reactivation decision behind them, so none is implemented — OD-LIC-13 is about limit
profiles only, and extending it by analogy would be inferring a decision.

---

## 10. Audit events

All through the existing `audit()`, inside the same transaction as the state
change, append-only, server clock, actor from the locked session — never from
client input. No private key, no password, no session token, no raw signed payload,
no artifact content.

| Event | When | Outcome |
|---|---|---|
| `LICENSE_REQUEST_PREPARED` | step 1 committed | `SUCCESS` |
| `LICENSE_REQUEST_DENIED` | permission, validation, profile-ceiling or unknown-field refusal | `DENIED` → `security_incident` per the existing `004` rules where it is a permission denial |
| `LICENSE_REQUEST_ABANDONED` | explicit abandonment with reason, **or** the OD-LIC-20 expiry transition (`actor_id` null, reason starts with the reserved `SYSTEM_EXPIRY` marker) | `SUCCESS` |
| `LICENSE_ARTIFACT_IMPORTED` | step 4 committed; includes the resolved `signing_key_id` and whether a relevant grant was revoked in between | `SUCCESS` |
| `LICENSE_ARTIFACT_REJECTED` | bad signature, unknown or non-`ACTIVE` key, digest mismatch, `operationId` mismatch, malformed envelope | `FAILED` → security incident |
| `LICENSE_ARTIFACT_DOWNLOADED` | each retrieval | `SUCCESS` |
| `LICENSE_ARTIFACT_INTEGRITY_FAILURE` | stored digest mismatch at download | `FAILED` → security incident |
| `SIGNING_KEY_USED` | the key resolved at import | `SUCCESS` — satisfies instruction §9's "signing-key use at the audit level the project requires" without recording any key material |
| `CUSTOMER_CREATED_DURING_ISSUANCE` | a new customer created inside step 1 | `SUCCESS` |
| `LIMIT_PROFILE_CREATED` / `LIMIT_PROFILE_RETIRED` | §5.2 management. **[REVIEW RV-3]** A retirement that leaves the customer with **no** `ACTIVE` profile is recorded with an explicit `ceiling_removed` marker, so the widening of operator freedom is visible in the trail rather than inferred from absence | `SUCCESS` |
| `LIMIT_PROFILE_REPLACED` | **[REVIEW RV-3] new.** retire-plus-create in one act, naming both profile ids | `SUCCESS` |
| `LIMIT_PROFILE_REACTIVATED` | **[OD-LIC-13] new.** `RETIRED → ACTIVE` on the same row, recording actor, server time, the **target profile id** and the outcome, per the Owner audit pattern | `SUCCESS` |
| `LIMIT_PROFILE_REACTIVATION_DENIED` | **[OD-LIC-13] new.** refused because another profile for that customer is already `ACTIVE`, or because the actor lacks `limit_profiles.manage` | `DENIED` → `security_incident` where it is a permission denial |
| `USER_PERMISSION_GRANT_CHANGED` | grant or revocation, with before/after and reason | `SUCCESS` |
| `USER_PERMISSION_GRANT_SEEDED` | **[REVIEW RV-3] new, conditional on R-3 (§5.4).** The baseline rows written at operator creation, listed explicitly | `SUCCESS` |
| `INSTALLATION_IDENTITY_REGISTERED` | §5.3, with `source` and confirmation actor | `SUCCESS` |

**[OD-LIC-13] Reactivation history is never deleted or rewritten.** A
retire→reactivate→retire sequence stays fully legible: each transition is its own
audit row with its own actor and server time, and the profile row's
`updated_by`/`updated_at` show only the latest. The ceiling values are never restated
as new facts, so an auditor can always tell that the *same* ceiling was restored
rather than a similar one created.

**[REVIEW RV-1] A real audit gap, stated rather than papered over.** The signer's
check-10 and check-11 refusals happen in an **air-gapped** environment with no
channel to the Owner, so they **cannot** be Owner audit events. The Owner never
learns that a tampered request was presented to the signer and refused. What the
Owner *can* and does audit is every refusal on its own side:
`LICENSE_REQUEST_DENIED`, `LICENSE_ARTIFACT_REJECTED` (digest mismatch, bad
signature, unknown or non-`ACTIVE` key, `operationId` mismatch), and
`LICENSE_ARTIFACT_INTEGRITY_FAILURE`. The signer writes its own local refusal record
(§4.3) and that record is the only evidence of a pre-signature refusal. This is a
consequence of OD-LIC-08's air gap, not an omission to fix by adding a network path
— adding one would breach ADR-0048 Decision 3 and PDR-11 §11.1. An issuance whose
request was tampered with and re-presented successfully will still be caught at
import and audited there; a tampering that was caught and abandoned offline leaves
the Owner row at `REQUEST_PREPARED` forever, which §15's staleness item covers.

Target types extend the existing audit filter vocabulary (`Customer`,
`OperationalRecord`, `User`, `AuditArchiveBatch`, `SigningKey`) with
`LicenseIssuance`, `CustomerLimitProfile` and `InstallationIdentity`. The audit
explorer's exact-match filters and its 50-row paging are reused unchanged; no audit
edit or delete endpoint is added, and the retention and archive rules of migration
`004` apply to these events without modification.

---

## 11. API surface

Under `/api/v1`, following the existing `route(method, path, permission, …)` shape,
JSON + `x-owner-request: 1` on mutations, Origin equal to the configured public
origin, no CORS.

| Method | Path | Permission |
|---|---|---|
| GET | `/license-issuances` | `licenses.view` — `page`, literal `search` ≤100 chars, optional `customerId`, `status`, `licenseKind`; 50-row pages with `hasNext` |
| POST | `/license-issuances/requests` | `licenses.issue.time_limited` or `licenses.issue.perpetual` per `licenseKind` |
| GET | `/license-issuances/:id` | `licenses.view` |
| GET | `/license-issuances/:id/request-file` | `licenses.view` — regenerate byte-identically from the committed row |
| POST | `/license-issuances/:id/abandon` | `licenses.view` + creator or `OWNER_ADMIN`; reason required |
| POST | `/license-issuances/:id/artifact` | `licenses.import` — multipart or JSON upload of the signed file |
| GET | `/license-issuances/:id/artifact` | `licenses.download` |
| GET/POST | `/customer-limit-profiles` | `limit_profiles.manage` |
| POST | `/customers/:id/limit-profile/retire` | `limit_profiles.manage` |
| GET/POST | `/installation-identities` | `licenses.view` / `licenses.issue.*` |
| PATCH | `/users/:id/permission-grants` | `users.manage` — explicit allowlist, no wildcard, audited |

Request bodies are validated with the existing `object()` allowlist, so **unknown
fields are rejected** (instruction §10). All queries are parameterized. No endpoint
accepts a file path, a key, a date for `validFrom`, or an actor id. Error responses
carry the existing `code` / bounded safe `message` / `correlationId` shape with
stable codes (`ValidationFailed`, `PermissionDenied`, `EntityNotFound`, `Conflict`,
`InvalidTransition`, plus the new `LimitProfileCeilingExceeded`,
`InstallationIdentityNotFound`, `ArtifactVerificationFailed`,
`RequestDigestMismatch`, `UnknownSigningKey`, `SigningKeyNotActive`,
`ArtifactStorageUnavailable`); technical detail goes to the secure log, never to the
client, and no error may reveal whether a private key exists.

The existing `operational-records/license-observations` path is **unchanged** and
stays what it is: an `OPERATOR_OBSERVED` record whose responses say
`cryptographicVerification = NOT_IMPLEMENTED`. It must not be repurposed to mean a
real issuance, and the two must be visually distinguishable in the UI (§12).

---

## 12. Persian RTL UI

Built on the existing primitives and patterns — `ui/patterns/*`, `owner-states`,
`api-error-alert`, `date-input`, `form-field`, the session/query conventions — with
no parallel design system and no duplicated component.

### 12.1 Issuance list

Columns: license id, customer (code + display name), kind (دائمی / مدت‌دار),
status, `validFrom`/`validUntil` in Jalali with Persian digits, main limits, and a
download control **only** for `SIGNED_RECORDED` rows. Search and pagination on the
existing 50-row pattern; loading and API-error states; no key material and no
artifact content shown. `REQUEST_PREPARED` rows must be labelled as awaiting
signature — never as issued.

### 12.2 Create form

- Existing-customer selection **or** in-flow creation, with PDR-14 code validation
  server-side as well as client-side.
- Installation identity: select an `ACTIVE` identity of the same customer, or
  register one — with the source recorded (`CUSTOMER_VARDENA_SCREEN`), the
  two-step confirmation of §5.3, and explicit copy stating that this is an
  attributed claim, not a verified binding.
- Perpetual vs time-limited; the end-date field is shown **only** for time-limited,
  and is empty and disabled for perpetual. No synthetic default expiry is ever
  pre-filled.
- `validFrom` is **displayed, not entered** — it is the server's issuance day
  (§2). The UI states this and sends no date for it.
- Organization and user caps, device limit with the UNSPECIFIED-vs-unlimited
  distinction made visible as three states rather than two.
- Module selection from the real catalog only (§3.5); the UI cannot offer a module
  the catalog does not contain.
- When an `ACTIVE` limit profile exists for the customer, its ceiling is shown and
  the inputs are constrained by it; when none exists, the UI says so explicitly —
  two visibly different states, never one (§5.2).
- **[REVIEW RV-3]** On the profile-management screen, retiring the only `ACTIVE`
  profile for a customer requires an explicit confirmation naming the consequence in
  Persian: after retirement **no ceiling is in force** and issuance falls back to the
  no-profile branch. Retirement is permitted but never silent (§5.2).
- **[OD-LIC-13]** The same screen offers **reactivation** of a retired profile —
  `OWNER_ADMIN` only, explicit, reasoned, and showing that the *identical* ceiling
  will be restored (the values are immutable, so there is nothing to re-enter). When
  another profile for that customer is already `ACTIVE` the action is **refused with a
  comprehensible Persian error**, not silently disabled and not offered as if it would
  succeed (§9.3). No inert control: the action exists only where the backend can
  really perform it.
- **[OD-LIC-12 / R-1]** The operator-administration surface must make empty effective
  access legible, because under R-1 a newly created operator can do nothing at all
  until granted. That means a visible empty state naming the missing permissions, and
  a per-operator view of the permissions actually held — eligibility and role are
  never shown as if they were access. Grant and revocation stay audited, non-editable
  and non-deletable from the UI (PDR-19 §5.2).
- Perpetual is offered only to a user holding `licenses.issue.perpetual`.
- A summary review step, then an explicit final confirmation that names the
  consequence: the request will be produced for offline signing and **no license
  exists yet**.

### 12.3 Non-synchronous result states

Because issuance is not one click, the UI must not imply otherwise:

1. **Request produced** — download the `VLSR1` file, with operator instructions and
   a clear statement that nothing is issued yet. **[REVIEW RV-1]** This screen also
   displays `request_payload_sha256` as 64 lowercase hex, selectable and printable,
   with Persian copy stating that this value must reach the offline signer **by a
   route other than the file itself** and that the signer will refuse without it. The
   digest is not secret and showing it is the point of the control; the UI must never
   offer to embed it in the file, which would defeat it (§4.4 O-D).
2. **Awaiting signature** — the row's standing state; shows the request's age
   (§1.4) so a stale time-limited request is visible, and keeps the digest readable
   so it can be re-confirmed if the first attempt failed. The age display is
   informational: it is **not** the expiry control, and the UI must not claim to
   enforce it. The server refuses an expired import (OD-LIC-20) and the resulting
   `ABANDONED` row is what the operator sees afterwards.
3. **Import** — upload the signed file; shows the verification result; on success
   offers the real download.
4. **Recorded** — downloadable, with `artifact_sha256` shown for out-of-band
   comparison against what the signer printed (§4.3).

Double-submit prevention, a visible pending state on every mutation, success
messages only after a real successful response, and comprehensible Persian errors
for permission, validation, profile-ceiling, unusable-key, digest-mismatch,
storage-unavailable and server failures. Accessibility, focus management, keyboard
navigation and responsive layout follow the existing Owner standards. No inert or
placeholder control: anything the backend cannot yet do is absent, not disabled
with a fake promise.

Jalali display with Persian digits for user-facing dates; ASCII canonical values at
the API and storage boundary, per the project-wide date contract and ADR-0048's
date-source addendum. The staged seven-file date foundation is reused; no second
calendar implementation and no customer app import.

---

## 13. Test plan

Tests assert the **real contract**, not status codes or the presence of buttons.
No assertion is weakened and no test is skipped to make a build green; where a test
cannot run for lack of infrastructure, that limitation is documented rather than
reported as a pass.

### 13.1 Conformance (the gate that makes a second implementation safe)

- Owner canonicalizer/signer/verifier over the whole `docs/licensing/vectors/**`
  corpus: canonical bytes, signatures, and the **stable refusal reason strings**
  for every `invalid/BAD-*` and `rotation/ROT-*` vector.
- **Independent golden literals pinned in the Owner test tree** covering §2.1's
  documented rules (§1.2). Required — the corpus alone cannot refute the customer
  implementation that generated it.
- Both run in CI. A divergence fails the build rather than surfacing in the field.

### 13.2 Round-trip and runtime compatibility (instruction §12.3)

- Owner request → signer fixture → Owner import → **the customer's real
  `parseLicenseDocument`/verification path** accepts the artifact. This is the
  proof that a customer runtime can read what the Owner produced, and it uses the
  real verifier, not a substitute. It runs as a **customer-side** test (the customer
  suite may read a fixture artifact; nothing is imported from Owner into customer
  runtime code) so the separation boundary holds.
- Digest round-trip: altering any field between request and artifact is detected at
  import. **[REVIEW RV-2]** This test must also assert the **untampered** round trip
  succeeds — `request_binding_sha256` computed at request creation equals the digest
  of the canonical bytes decoded from the artifact the signer produced. Without that
  positive assertion the projection rules of §3.4 are untested, and the original
  single-digest defect (which refused every legitimate import) is exactly the kind of
  error a negative-only test suite hides.
- **[REVIEW RV-2]** Projection golden literals: for each of `deviceLimit`
  specified/unspecified, `renewsOperationId` null/present, `supersedesOperationId`
  null/present, and `validUntil` null (perpetual)/present, the projection's canonical
  bytes are pinned as an independent golden literal in the Owner test tree. These are
  the four omission rules where the original text was wrong, so they are the four
  most likely to regress.
- Envelope `keyId` resolution and the `sha256-<16 hex>` derived-id rule, including
  a bare-key entry.

### 13.3 Positive (instruction §12.1)

Perpetual for an existing customer · time-limited with a valid end · new customer
created in-flow · limits and modules present in the **signed payload**, not only in
the row · artifact download and structure · signature verification with the real
verifier · agreement of `customerCode`, license id, kind and limits between the row
and the artifact · retry without a duplicate license · re-download · audit
attributed to a valid actor · limit-profile ceiling binding · installation identity
provenance recorded.

### 13.4 Negative and security (instruction §12.2)

**[REVIEW RV-1] Transport tampering — each of §3.6's T-1…T-10, asserted at both
ends.** For every one, the test asserts **(a)** the signer refuses and **never reads
the key** (asserted by the key not being loaded, not merely by the exit code), and
**(b)** if a signed artifact is nonetheless forged for the tampered terms, the Owner
refuses to import it, records nothing as issued, leaves the row at
`REQUEST_PREPARED`, and serves nothing for download:

| Test | Tampering | Signer | Owner import |
|---|---|---|---|
| NEG-T1 | request re-targeted to **another real customer** | refuses (digest mismatch) | refuses — binding mismatch, distinct reason |
| NEG-T2 | `installationId` substituted with another valid ULID | refuses | refuses |
| NEG-T3 | `organizationLimit`/`userLimit` raised, or replaced with `null` | refuses | refuses |
| NEG-T4 | `deviceLimitSpecified` flipped, or `deviceLimit` raised | refuses | refuses — and the projection differs by an *omission*, not a value, which is the subtle case |
| NEG-T5 | extra module/feature added | refuses | refuses |
| NEG-T6 | **`validUntil` set to `null`** (time-limited → perpetual) | refuses | refuses; asserted separately as **privilege escalation across OD-LIC-07**, not just a date change |
| NEG-T7 | `validUntil` extended / `validFrom` moved earlier | refuses | refuses |
| NEG-T8 | `supersedesOperationId`/`renewsOperationId` inserted | refuses | refuses |
| NEG-T9 | `requestedByUserId` rewritten | refuses (whole-payload digest covers attribution fields) | n/a — not in the signed payload; the Owner row's attribution is unchanged |
| NEG-T10 | the **same** request file presented twice | second attempt refused by the local `operationId` record (check 11) | second import refused by `operation_id` uniqueness and the §9.1 state machine |

Plus the control's own failure modes: **check-10 mismatch with a correct file is
impossible** (asserted by the positive round trip above); **a shortened or
case-varied digest entry is refused**; **an empty or absent digest entry is refused**;
**a digest read from the request file itself is refused** — the signer must not offer
any path that derives the expected value from the file (§4.4 O-D); and **the signer
leaves no key material in memory, log, exit message or output on any refusal**.

**[OD-LIC-13] Limit-profile lifecycle.** Reactivate a retired profile with no other
active profile → succeeds, **identical** ceiling values, audited · attempt to
reactivate while another profile for that customer is `ACTIVE` → refused by the
service **and** by the partial unique index, nothing changed · attempt to edit a
ceiling column as part of reactivation → refused in both `ACTIVE` and `RETIRED` ·
an issuance created before retirement still references the same `limit_profile_id`
afterwards · a retire→reactivate→retire sequence leaves all three transitions visible
with distinct actors and server times.

**[OD-LIC-14] In-flight requests against a changing profile.** Request created under
a profile → profile retired → import still succeeds and keeps the original
`limit_profile_id` · request created under a profile → profile replaced by a
**stricter** one → the in-flight import still succeeds against the snapshot while a
**new** request for the same terms is refused by the stricter ceiling · request
created with **no** profile → a profile is created afterwards → the in-flight request
still completes unbounded and a new request is bounded · snapshot values never mutated
by any profile operation · replayed import of an already-recorded artifact returns the
recorded result **without** re-evaluating the ceiling · an in-flight request is still
refused by a revoked `licenses.import` grant (§7.4), an unknown or non-`ACTIVE`
signing key, and a binding-digest mismatch — proving OD-LIC-14 overrides no other
control.

**A stale request is not a tampering case.** The expiry is a decided product rule
(OD-LIC-20), so NEG-T10's staleness arm now asserts it directly: just before the
boundary completes; exactly on it and one millisecond after it the import refuses
and abandons with a system-origin audit; the artifact's own `issuedAt` cannot
extend life; concurrency produces one transition; and a time-limited artifact whose
end has passed is still refused **by the customer's real importer** as
`expired-document` (§1.4).

**[OD-LIC-20] Prepared-request maximum age.** Eligibility is `now < requested_at +
14 × 24 h`, expired at `>=`, on a frozen clock: one minute before the boundary the
import succeeds and records the artifact · exactly on the boundary and one
millisecond after it, the import answers `409 InvalidTransition`, the row becomes
`ABANDONED`, the immutable snapshot is unchanged, exactly one
`LICENSE_REQUEST_ABANDONED` event with `actor_id = NULL` and a `SYSTEM_EXPIRY`
reason exists, and there is **no** artifact row, `SIGNED_RECORDED` state,
`LICENSE_ARTIFACT_IMPORTED` event or `signed_at` · a DST-crossing anchor and a
changed process timezone do not move the boundary · an artifact whose own
`issuedAt` claims a fresh instant is still refused · a forced audit-write failure
returns `500` and leaves the row `REQUEST_PREPARED` (no false success) · two
concurrent imports yield two refusals, one transition and one audit · a session
without `licenses.import` is refused **before** any transition · repeated attempts
on the `ABANDONED` row are deterministic and never revive it · a replacement
request gets new operation and license identities · a human abandonment reason
using the reserved system prefix is refused. Executed locally in
`test/licensing.test.ts` and `test/licensing-lifecycle.test.ts` (§2.2 of the
traceability matrix).

Unauthenticated · inactive user · missing permission · `must_change_password` ·
invalid or duplicate `customerCode` · nonexistent customer · invalid dates, end
before start, future start · negative, zero, out-of-range limits · unknown module ·
unknown signing key · key marked `COMPROMISED`/`REVOKED` · invalid signature ·
tampered artifact · digest mismatch · `operationId` mismatch · storage failure
mid-import · crash between staging and commit (orphan swept, row unchanged) ·
concurrent import of one row · double submit · path traversal and cross-issuance
download attempts · **no private key in any response, error, audit event or log** ·
unknown field · malformed JSON · failed operation leaves no false-success row ·
failed issuance leaves no orphan customer · revoked grant mid-flow (§7.4) ·
operator attempt to create a perpetual request · operator attempt to raise a limit
profile · grant of a non-configurable permission to an operator (refused by trigger
**and** service) · **tampered artifact presented through a second path** — the same
bytes offered to the download route, to a re-import, and to the customer's real
verifier, asserting that no path records or serves it as a valid license.

### 13.5 Permission matrix test — **[REVIEW RV-3] new**

One table-driven suite over §6.1's matrix, asserting **effective** access rather than
the presence of a grant row. For every permission in the matrix × every actor state
below, the expected result is derived from §5.4's intersection rule, not written by
hand per case:

| Actor state | Expected |
|---|---|
| `OWNER_ADMIN`, active | every permission in the matrix allowed; no grant row consulted or required |
| `LICENSE_OPERATOR`, active grant present | allowed |
| `LICENSE_OPERATOR`, **no grant row** | denied |
| `LICENSE_OPERATOR`, grant **revoked** | denied — and distinguished from "no row" in the audit history, not in the outcome |
| `LICENSE_OPERATOR`, grant re-issued after revocation | allowed again, with the full grant→revoke→re-grant sequence still visible |
| `LICENSE_OPERATOR`, **inactive user** with an active grant | denied — the grant does not resurrect a disabled account |
| `LICENSE_OPERATOR` under **`must_change_password`** | denied on every sensitive action, allowed only what the existing actor assertion already allows |
| `LICENSE_OPERATOR` with a forced row for an **ineligible** permission | denied by the intersection even if the row exists, **and** the row write itself is refused by trigger and service |
| `LICENSE_OPERATOR` attempting `licenses.issue.perpetual` | denied at vocabulary, trigger, service and intersection — four independent layers, each asserted |
| Unknown code / superseded four-role identifier | denied, `[]` |
| Grant of `limit_profiles.manage` to an operator | refused by trigger **and** service |
| **[OD-LIC-12]** freshly created operator, **zero grant rows** | denied on all four baseline permissions *and* all issuance permissions |
| **[OD-LIC-12]** `OWNER_ADMIN` with no grant rows at all | every permission allowed — the grant model is not consulted |
| **[OD-LIC-13]** operator attempts to reactivate a retired profile | denied — `limit_profiles.manage` is ineligible |

Two assertions guard the guarantees rather than the cases: **no grant ever widens**
(effective ⊆ eligible for every generated combination) and **revocation blocks only
new signing requests** while an already-prepared request stays completable by its
creator or an `OWNER_ADMIN` (§7.4) — the accepted trade-off PDR-19 §5.2 records, so
it is tested rather than trusted.

**[OD-LIC-12] No longer parameterized.** The R-1 vs R-3 question is decided in favour
of **R-1**, so the expectations for `customers.view`, `audit.view`, `operations.view`
and `operations.record` are now fixed: a **freshly created operator is denied all
four**, because creation writes no grant rows. The suite is written against R-1
directly and the previously deferred `todo` cases become real assertions.

Two R-1-specific cases are added, because they are the ones a seeded-default design
would never have exercised:

- **Fresh operator, zero grants:** denied on every permission in §6.1, including the
  four the role is *eligible* for — and the denial reason distinguishes "not granted"
  from "not eligible".
- **Provisioning gap is legible, not silent:** the empty state and the per-operator
  holdings view of §12 are asserted, so R-1's operational consequence is a tested
  behaviour rather than a surprise.

Also asserted, per OD-LIC-12: `OWNER_ADMIN` is **unaffected** by the grant model and
never appears in the grant table, and the static `permissions(role)` result is treated
as **eligibility**, never as effective access.

### 13.6 Environments

Fast static/unit checks locally; the Owner PostgreSQL integration suite
(`npm run test:integration` against a dedicated `owner_test` database), migration
idempotence for `001`–`007`, customer suites, image builds and vector regeneration
in GitHub Actions, per AGENTS.md and instruction §14. Migration safety is rehearsed
on a disposable PostgreSQL, not asserted from a fixture.

---

## 14. Migration and rollout

`007-owner-license-issuance.sql`, following the existing numbered immutable chain:

- Additive only; runs on a fresh **and** a populated `001`–`006` database; no
  backfill of invented facts; no rewrite of an applied file, so the `001`–`006`
  checksums in `public.owner_migrations` stay valid.
- Creates the four tables of §5, their constraints, indexes and triggers; extends
  the audit target-type vocabulary; commits with the ledger entry in one
  transaction under the existing advisory lock.
- **[OD-LIC-13]** `customer_limit_profiles` carries the **partial** unique index
  `UNIQUE (customer_id) WHERE status = 'ACTIVE'` — not a column-level `UNIQUE` — and
  its status trigger must permit **both** `ACTIVE → RETIRED` and `RETIRED → ACTIVE`,
  while forbidding any change to the ceiling columns in either state. A trigger
  written from this document's pre-OD-LIC-13 wording would have made retired rows
  terminal and contradicted the decision.
- **[OD-LIC-12]** No grant rows are seeded for any user, at any point, by the
  migration or by the runtime. `user_permission_grants` is created **empty**; R-1's
  empty-default is a property of the data, not of a backfill.
- **Runtime grants are deployment-specific and are not applied by the migration**,
  matching migration `002`'s closing note. The README's role-grant section must be
  extended with SELECT/INSERT/UPDATE on the new tables and USAGE/SELECT on their
  sequences, and must continue to withhold DDL and any DELETE on audit or on
  immutable facts.
- **Order of delivery.** The order originally proposed here put the conformance suite
  fourth while calling it "the highest-risk piece, so it lands first" — a
  self-contradiction. It is corrected, and the dependency-aware version is tabled in
  **§15.1.14**, which states for each step what blocks it and whether it can start
  today. In brief: **(1)** Owner canonicalizer/signer/verifier with the conformance
  suite of §13.1–13.2, plus the request-integrity control of OD-LIC-11 (§4.2 check 10)
  and the proof that a refusal never reads the key — nothing blocks these and they are
  the highest-risk work; **(2)** permission grants, effective resolution under R-1 and
  their audit, once **OQ-75** fixes the code names; **(3)** the permission matrix and
  grant lifecycle; **(4)** limit profiles with reactivation and the creation-time
  snapshot (OD-LIC-13/14 decide both, so no product decision is outstanding);
  **(5)** installation identities; **(6)** issuance ledger, request creation and the
  signer CLI; **(7)** durable artifact store, import and download; **(8)** endpoints
  and orchestration; **(9)** Persian RTL UI and the full operator round trip; then
  integration and customer tests with full CI and a manual evidence review.

  Two capabilities are blocked by a missing product decision and nothing else: the
  permission vocabulary (**OQ-75**) and whether an operator may set
  `supersedesOperationId`/`renewsOperationId` (§15.1.10).
- Documentation updates land with the code they describe, never ahead of it:
  `owner-licensing/README.md` (API summary, security, role grants, the OD-LIC-10
  supersession note already added, and removal of "no signer … in this phase" only
  when a signer actually exists), PDR-17's matrix, and the OQ-74/75/90/91 rows.
- **[OD-LIC-12]** PDR-17's matrix update is now **mandatory rather than cosmetic**:
  R-1 removes the `LICENSE_OPERATOR` implicit baseline, so a document that still
  describes that role as holding `customers.view`/`audit.view`/`operations.view`/
  `operations.record` outright would contradict the implemented behaviour. The same
  applies to `owner-licensing/README.md`'s role-grant section and to any comment in
  `domain.ts` describing the static set as the operator's access rather than its
  eligibility.

---

## 15. What this design deliberately does **not** decide

Engineering may not settle these, and none may be inferred from silence. The five
struck-through rows below were decided by the Product Owner on 2026-10-20
(**OD-LIC-11…OD-LIC-14**, PDR-19 §6) and are kept visible with their disposition so
the record shows what was stopped and how it was resolved; they are **no longer open**.
The rows that remain genuinely undecided are listed **above** them; the five closed
rows are kept at the **end** of the same table, marked and dated, so a reader can see
both what is still open and what was stopped and then resolved. §15.1 tables every
remaining dependency with its options, owner and whether work can proceed.

| Item | Why it is not decided here |
|---|---|
| **U-1 / OQ-74** compromise policy, containment, provenance for issued-but-not-imported artifacts, rotation cadence, trust rollout | Still OPEN. OD-LIC-08 answers only *where the key lives*. §8.3's trust list is configuration precisely so no runtime key administration pre-empts U-1 |
| **OQ-78** revocation | OPEN. PO-78-01 is policy only. A wrongly issued perpetual license remains irrevocable in practice — risk **B-5**, unchanged and sharpened by OD-LIC-08 |
| **OQ-81** replay/receipt DTO | OPEN. §7.2 follows the shape PDR-18 §5 approves but does not fix the response schema or status code |
| Whether a pending request **expires** | **DECIDED as OD-LIC-20** (PDR-19 §11): fixed 14 × 24 hours from `requested_at`, server-side, terminal `ABANDONED` with a system-origin audit. Implemented; PDR-17's replacement window (1h–7d) remains a separate, unapplied rule |
| Transport handling of the request file | §3.4 proves integrity, not confidentiality. The request carries commercial terms on removable media; the handling rule is an operational/security decision |
| Whether an operator may set `supersedesOperationId` or `renewsOperationId` at all | PDR-12 makes explicit supersession the **only** term-changing path and forbids reducing limits or entitlements on any path. Giving an operator that field is a product decision, not a schema detail |
| Whether `OWNER_ADMIN` is ever configurable | PDR-19 §5.2 records **not** — the Product Owner did not choose the option that would have made it so |
| Exact permission-code names | §6 proposes them following the existing `noun.verb` convention; OQ-75 requires the vocabulary to be explicit and tested before implementation, so the names are a review item |
| **[OD-LIC-11] ~~Whether to adopt O-B — an Owner-held request-signing key~~** | **CLOSED 2026-10-20.** The Product Owner chose **O-A** and did **not** adopt O-B (PDR-19 §6.1). No new key, signed format, canonicalization change, vector change or customer-side change is authorized. O-B stays documented in §4.4 as the stronger option; building it would need a **new** decision plus a custody answer for the second key while U-1/OQ-74 is OPEN |
| **[OD-LIC-11] ~~Whether the confirmation value may ever be shortened~~** | **CLOSED 2026-10-20.** The value is **exactly 64 hex**; shortening or omission is **forbidden** (PDR-19 §6.1). The independent-path requirement is decided at the level of a testable rule — a digest taken from the request file itself does not qualify — so *which* independent medium is used (printed slip, second media, spoken) is operational practice inside that rule, not an open decision |
| **[OD-LIC-12] ~~R-1 vs R-3: default grant state of a new operator~~** | **CLOSED 2026-10-20 — R-1** (PDR-19 §6.2). A new operator has zero effective access and creation writes no grant rows; R-3 is rejected. Operator-creation implementation is unblocked; what remains is OQ-75's vocabulary |
| **[OD-LIC-13] ~~Whether retiring a limit profile may be permanent~~** | **CLOSED 2026-10-20 — reactivation of the same retired profile is allowed** (PDR-19 §6.3), never two `ACTIVE` at once, ceiling columns immutable, history never rewritten |
| **[OD-LIC-14] ~~Whether a profile change should block a request already in flight~~** | **CLOSED 2026-10-20 — it does not** (PDR-19 §6.4). An in-flight request completes on its creation-time snapshot; new requests use current state. Payload alteration, integrity bypass and every other control remain forbidden |

---

## 15.1 Every remaining dependency, re-extracted from the current documents

Re-derived on 2026-10-20 from the live registry and the live documents — not carried
over from any earlier list. Each entry states the real identifier as it exists in the
repository today, the decision that is still missing, what it blocks, the practical
options (without choosing for the Product Owner), a technical recommendation where one
is legitimately engineering's, and who owns the decision.

**Advanceability vocabulary.** `BLOCKED` = no work may start. `INDEPENDENT` = can be
built now, nothing waits on it. `AFTER PREREQ` = can be built once the named
prerequisite exists, which need not be a product decision.

### 15.1.1 **U-1 / OQ-74** — Signing-key compromise, containment, rotation and trust rollout

| Field | Content |
|---|---|
| **Identifier** | **U-1 / OQ-74** |
| **Precise question** | A compromised or retired authority key: how is compromise detected and contained, what happens to artifacts signed by it, what is the rotation cadence, and how is a new public key rolled out to customers? |
| **Decision still required** | A compromise-response and rotation **policy** plus its trust-rollout mechanism. The registry records policy as decided only in the negative direction (already-issued licenses are **not** automatically invalidated solely because of compromise) and explicitly warns not to assume compromised-key signatures are distinguishable or to claim safe rotation. |
| **Impact on development** | **Blocks the production key path entirely, but not this design's code.** No production key may be generated or placed in custody until U-1 is answered (readiness D-5: *"approval required? YES — blocking"*). It also gates §8.3's trust list beyond first use: the list is configuration precisely so nothing pre-empts U-1, but rotating it is a deployment act with no defined procedure. Issuance can be **built and tested** with the quarantined TEST-ONLY vector key without answering this. |
| **Options** | (a) Manual rotation: a documented offline ceremony, `signing_keys` status flipped to `REVOKED`, trust list updated by deployment, customers re-import. (b) Overlap window: two trusted keys valid simultaneously for a bounded period. (c) Out of MVP scope: single key, no rotation procedure, compromise handled as an incident outside the product. |
| **Technical recommendation** | **Engineering may recommend (a) for the first slice**, because it needs no new mechanism and matches §8.3's configuration-based trust list; the risk is that customers on an old trust list refuse a new key, which is exactly why the overlap window (b) exists. **Engineering must not choose** the containment or provenance policy for artifacts already signed by a compromised key — that is the substance of U-1 and is a Product Owner decision. |
| **Depends on** | OD-LIC-08 (custody answered), OQ-78 (revocation), §8.3 trust list, readiness D-5, `docs/tasks/licensing-oq-74-signing-key-compromise-response.md`. |
| **Can work proceed?** | **INDEPENDENT** for building and testing issuance with the TEST-ONLY key. **BLOCKED** for any production key or live rotation. |
| **Document location** | `docs/open-questions.md` OQ-74 row; `docs/tasks/licensing-oq-74-signing-key-compromise-response.md`; PDR-11 §15 U-1; readiness D-5. |
| **Decision owner** | **Product Owner** — compromise containment and rotation cadence are commercial and security policy, and the registry already records the policy as OPEN with an explicit warning against claiming safe rotation. |

### 15.1.2 **OQ-75** — Exact permission-code vocabulary and its audit evidence

| Field | Content |
|---|---|
| **Identifier** | **OQ-75** |
| **Precise question** | What are the **exact** permission-code strings for issuance, and what audit evidence proves each is server-enforced on every request? |
| **Decision still required** | Approval of the code names in §6.1 (`licenses.issue.time_limited`, `licenses.issue.perpetual`, `licenses.import`, `licenses.view`, `licenses.download`, `limit_profiles.manage`) and of the eligibility matrix, plus the implementation evidence the registry demands. |
| **Impact on development** | **Blocks step 1 of the delivery order** (permission grants and effective-permission resolution) and therefore everything downstream: no endpoint can be authorized, no matrix test can be written against fixed strings, and migration `007`'s CHECK constraint on `user_permission_grants.permission` cannot be written. OD-LIC-12 (R-1) fixed the *semantics*; this fixes the *names*. |
| **Options** | (a) Adopt §6.1 as written. (b) Adopt it with different names (e.g. a single `licenses.issue` plus a kind argument, or `issuance.*` instead of `licenses.*`). (c) Defer naming and implement behind an internal enum mapped later. |
| **Technical recommendation** | **Engineering recommends (a)**: it follows the existing `noun.verb` convention already in `domain.ts` (`customers.write`, `operations.record`, `replacements.authorize`), keeps perpetual issuance a distinct code so OD-LIC-07's reservation is enforced by vocabulary rather than by an argument check, and (c) is unsafe because OQ-75 requires the mapping to be **explicit** and unknown actions to deny — an internal enum defers exactly the thing the registry says must not be inferred. Risk of (a): renaming later is a migration plus a data update, so the names should be settled before `007` is written. |
| **Depends on** | OD-LIC-07, OD-LIC-12 (R-1), F-2 scope, PDR-17's superseded static matrix, §6.1 matrix, migration `007`. |
| **Can work proceed?** | **BLOCKED** for step 1 and everything after it. The conformance suite (step 2) does **not** depend on it. |
| **Document location** | `docs/open-questions.md` OQ-75 row; design §6.1; PDR-17 role matrix; PDR-11 §21. |
| **Decision owner** | **Product Owner** — OQ-75 records that *"exact mapping must be explicit"* and that no signing, custody or recovery permission may be inferred; naming the vocabulary is the act that makes it explicit, so it is a decision, not a detail. |

### 15.1.3 **OQ-78** — Revocation and recovery of an issued license

| Field | Content |
|---|---|
| **Identifier** | **OQ-78** |
| **Precise question** | Once a signed artifact exists, what can the Owner actually do about it — is there any revocation instrument, and what does a wrongly issued license cost? |
| **Decision still required** | A revocation/recovery **protocol**, not just policy. PO-78-01 decided only that offline revocation of a perpetual license is *permitted* as policy; the registry records the row as OPEN for protocol and implementation. |
| **Impact on development** | **Does not block building issuance, and must not be allowed to.** It is the reason several accepted trade-offs are accepted rather than solved: OD-LIC-14's in-flight window, F-2's revoked-grant window (PDR-19 §5.2), and risk **B-5**. Every one of them ends in *"irrevocable in practice"* because this row is open. It also gates OQ-90's sub-question about correcting an installation identity after issuance. |
| **Options** | (a) No instrument in MVP: rely on supersession (PDR-12) to replace terms and accept that a bad artifact keeps verifying. (b) Signed revocation artifact the customer imports. (c) Trust-list/key-level revocation, which is U-1 territory and would invalidate far more than intended. |
| **Technical recommendation** | **Engineering recommends (a) for this phase with (b) recorded as the next instrument**, because (b) is a new signed artifact kind and therefore a protocol change requiring its own PDR-16 assessment, and (c) is disproportionate — it is a key-level response to a per-license mistake. Risk of (a): a wrongly issued perpetual license remains valid at the customer until its term ends, which is precisely risk B-5 and is why the design concentrates perpetual issuance in `OWNER_ADMIN` (OD-LIC-07). |
| **Depends on** | U-1/OQ-74, PDR-12 supersession, PDR-18 §11 PO-78-01, OD-LIC-14, F-2 revocation trade-off, OQ-90 correction-after-issuance. |
| **Can work proceed?** | **INDEPENDENT** — issuance may be built and shipped while this stays open, provided every affected UI and audit surface keeps saying *irrevocable in practice* rather than implying recovery. |
| **Document location** | `docs/open-questions.md` OQ-78 row; `docs/tasks/oq-78-revocation-recovery-assessment.md`; PDR-18 §11. |
| **Decision owner** | **Product Owner** — whether a wrong license can be taken back is commercial and legal exposure, not an engineering trade. |

### 15.1.4 **OQ-81** — Replay and receipt contract for the import endpoint

| Field | Content |
|---|---|
| **Identifier** | **OQ-81** |
| **Precise question** | When the same signed artifact is imported twice, what exactly does the Owner return — the persisted historical result, the current state, or both — and with what status code and DTO? |
| **Decision still required** | The response schema and status code for a committed retry. The registry records the *semantics* as decided (a new `operationId` is a new operation; the fingerprint excludes `customerName`/`issuedAt` and includes `supersedesOperationId`; a committed retry re-checks authorization, canonical form, signature, trust and scope, then takes a read-only receipt path) and the **exact replay DTO as open**. |
| **Impact on development** | **Blocks only the final response shape of §11's import endpoint and §7.2's replay row.** Everything else — verification, digest comparison, storage, state transition, audit — is unaffected. PDR-18 §5 approves the shape this design follows but does not fix the schema. |
| **Options** | (a) Reuse the customer side's replay response shape verbatim for consistency across the two apps. (b) Define an Owner-specific DTO naming `status`, `recordedAt`, `replay: true` and the artifact digest. (c) Return the same body as a first-time import plus a replay indicator header. |
| **Technical recommendation** | **Engineering recommends (a) if the customer shape is a published contract, otherwise (b)**, because an operator facing two different vocabularies for the same concept is a training and support cost, and (c) hides the replay signal where the UI cannot show it. Risk of (b): a second vocabulary diverges from the customer side over time. **Engineering must not fix the DTO unilaterally** — the registry explicitly keeps it open. |
| **Depends on** | PDR-18 §5, §7.2 of this design, §11 API surface, OQ-81's technical design document. |
| **Can work proceed?** | **AFTER PREREQ** — implementable as soon as the DTO is fixed; the endpoint's logic can be built against a placeholder internal type in the meantime, but not shipped. |
| **Document location** | `docs/open-questions.md` OQ-81 row; `docs/tasks/oq-81-idempotent-replay-technical-design.md`; PDR-18 §5; design §7.2, §11. |
| **Decision owner** | **Product Owner** for the observable contract (what an operator sees and what a receipt means); **engineering** for the internal shape once that is fixed. |

### 15.1.5 **OQ-85** — Owner infrastructure operational evidence

| Field | Content |
|---|---|
| **Identifier** | **OQ-85** |
| **Precise question** | What operational evidence demonstrates that the Owner-controlled infrastructure and trust boundary actually hold in deployment — now with two new pieces of surface? |
| **Decision still required** | Not a design decision but an **acceptance criterion**: the evidence that the artifact store and the offline signer are deployed, isolated and operated as designed. The registry records the boundary as decided and the row OPEN for implementation/operational evidence. |
| **Impact on development** | **Blocks acceptance, not construction.** OD-LIC-10 adds a durable file store outside PostgreSQL and OD-LIC-08 adds an offline signing station; both are new deployment surface with no evidence yet. Specifically: proof the signer is absent from every deployable web image (§4.1's CI gate), proof the artifact directory is outside the database's backup scope or correctly inside it, and proof the customer needs no continuous Owner connectivity. |
| **Options** | (a) Evidence pack per component: CI assertions, deployment checklist, restore rehearsal. (b) Defer to a single operational-readiness review after all components exist. (c) Treat existing Owner deployment evidence as sufficient and extend it. |
| **Technical recommendation** | **Engineering recommends (a) incrementally, landing each component's evidence with its code** — the signer-image CI assertion is cheap and belongs with step 5, and the artifact store's restore rehearsal belongs with step 6. Risk of (b): deferring evidence until the end is how a store that cannot be restored reaches production. |
| **Depends on** | OD-LIC-08, OD-LIC-10, §4.1 signer packaging, §8.1 artifact store, migration `007`, `scripts/check-production-artifacts.py`. |
| **Can work proceed?** | **INDEPENDENT** — evidence for each component is produced alongside that component; nothing waits. |
| **Document location** | `docs/open-questions.md` OQ-85 row; design §4.1, §8.1; PDR-17; PDR-11 §21. |
| **Decision owner** | **Engineering** to produce the evidence; **Product Owner** to accept it as sufficient. The boundary itself is already decided. |

### 15.1.6 **OQ-90** — Installation identity — correction after issuance, and the confirmation step's shape

| Field | Content |
|---|---|
| **Identifier** | **OQ-90** |
| **Precise question** | Two sub-questions survive OD-LIC-09: may a registered `installationId` be **corrected after** an issuance already names it, and what exactly is the confirmation step that makes a transcription error less likely? |
| **Decision still required** | For correction-after-issuance: a **product** answer, because a signed payload already names the identity and OQ-78 leaves no revocation instrument. For the confirmation shape: an engineering design detail that OD-LIC-09 explicitly delegates (*"its exact shape is design work"*). |
| **Impact on development** | **Correction-after-issuance blocks nothing today but must not be silently assumed away**: §5.3 registers identities and §5.1 snapshots `installation_id`, so the schema already prevents a silent rewrite, and an operator who mistypes an identifier has **no in-product recovery**. The confirmation shape blocks only §5.3's UI slice. |
| **Options** | Correction: (a) never — a wrong binding is permanent, matching the schema as designed. (b) Retire the identity and issue a superseding license (PDR-12), so the signed history stays truthful. (c) Allow an audited correction of the identity row, which would falsify what a past artifact actually names. Confirmation shape: (i) type twice, (ii) type once plus an explicit consequence screen, (iii) show the resolved customer and identifier for a deliberate confirm. |
| **Technical recommendation** | **Engineering recommends (b) for correction** — it keeps every signed fact truthful and reuses the only authorized term-changing path; **(c) must be rejected** because it rewrites the meaning of an artifact that already exists and cannot be revoked. **For the confirmation shape, engineering adopts (i)+(ii)+(iii) together for the first slice** (§5.3 already proposes re-entry), since a transcription error here is the one mistake the signature cannot detect. Risk of (b): the customer must import a second artifact, which costs a round trip. |
| **Depends on** | OD-LIC-09, OQ-78 (no revocation instrument), PDR-12 supersession, ADR-0048 Decision 5 (claims never identity), §5.3, §5.1. |
| **Can work proceed?** | **AFTER PREREQ** for the confirmation UI (engineering may proceed). **BLOCKED** for any correction-after-issuance capability — do not build one. |
| **Document location** | `docs/open-questions.md` OQ-90 row; PDR-19 §3; design §5.3; ADR-0048 Decision 5. |
| **Decision owner** | **Product Owner** for correction-after-issuance (it decides whether a mistake is recoverable and at what commercial cost); **engineering** for the confirmation step's shape. |

### 15.1.7 **OQ-91** — Artifact store retention, backup and restore

| Field | Content |
|---|---|
| **Identifier** | **OQ-91** |
| **Precise question** | OD-LIC-10 decided *where* signed artifacts live; it explicitly did **not** decide how long they are kept, how they are backed up, or how they are restored. |
| **Decision still required** | **DECIDED by OD-LIC-19 (PDR-19 §4):** indefinite retention of the exact original bytes, no WORM and no automatic deletion, a documented backup/restore procedure and integrity verification, with the store kept **outside** the PostgreSQL data directory and backed up as a separate store. Restore proves byte identity against the authoritative metadata; it does not prove database/file atomicity, which is why both stores are backed up and verified together. |
| **Impact on development** | **Blocks the artifact store's operational acceptance (with OQ-85) but not its construction.** §8.1 can be built to the audit-archive pattern now. It also interacts with the disclosure surface OD-LIC-10 recorded: a readable archive of signed customer grants is a disclosure risk even though it cannot be forged, and retention length is directly proportional to that exposure. |
| **Options** | (a) Retain indefinitely, back up with the database, rehearse restore per release. (b) Retain for the license term plus a bounded tail, then purge on a schedule. (c) Retain the digest and metadata indefinitely but the artifact only for a bounded window, re-deriving nothing. |
| **Technical recommendation** | **Engineering recommends (a) for the first slice with (b) recorded as the eventual policy**, because a signed artifact is **not re-derivable** — unlike a row it cannot be recomputed from other data, so purging it before the customer no longer needs it makes a lost file unrecoverable, and PDR-18 §9 / OD-LIC-06 make re-download the recovery path. Risk of (a): the disclosure surface grows without bound, which is why access stays permission-gated and every retrieval audited (§8.2). |
| **Depends on** | OD-LIC-10, OQ-85, §8.1 store, §8.2 download, PDR-18 §9 re-download, migration `004` retention rules. |
| **Can work proceed?** | **RESOLVED** — policy decided, and §8.4's tooling, tests and executed drill are delivered. |
| **Document location** | `docs/open-questions.md` OQ-91 row; PDR-19 §4; design §8.1, §8.2, §8.4; [`artifacts-backup-restore.md`](../licensing/artifacts-backup-restore.md). |
| **Decision owner** | **Product Owner** — retention and backup are commercial, legal and disclosure-exposure decisions; engineering implements whatever is chosen. |

### 15.1.8 **(no OQ id)** — Whether a prepared signing request expires

| Field | Content |
|---|---|
| **Identifier** | **(no OQ id)** |
| **Precise question** | Does a `REQUEST_PREPARED` issuance stop being completable after some period, and if so measured from what — request creation, the signer's clock, or the license's own `validUntil`? |
| **Decision** | **DECIDED 2026-10-20 as OD-LIC-20 (PDR-19 §11), Option B:** a fixed **14 × 24-hour** maximum age from the persisted creation instant (`requested_at`), measured as UTC elapsed time, with the boundary `now < requested_at + 14 × 24 h` eligible and `>=` expired. Server-side, not configurable per customer or deployment. The first completion/import attempt at or after the boundary fails closed and atomically moves the row to `ABANDONED` with a system-origin audit; the request is terminal and a replacement needs new operation and license identities. This design's earlier preference for option (c) was **not** adopted. |
| **Impact on development** | **Now addressed by OD-LIC-20.** Before the decision it left two exposures: §1.4's unbounded offline delay could make a time-limited artifact permanently unimportable (`expired-document`), and OD-LIC-14 kept an in-flight request completable against a ceiling that had since changed. The fixed 14 × 24-hour age bounds the first at the Owner (with the customer's own refusal still the backstop) and bounds the second to a known window; the remaining accepted consequence is a request completing inside that window against an outdated ceiling. |
| **Options** | (a) No expiry: the row stays completable forever; the UI shows request age (§12.3) and the customer-side refusal is the only backstop. (b) Configurable expiry anchored at request creation, mirroring PDR-17's replacement-confirmation window (1h–7d, default 24h). (c) Expiry anchored to `validUntil` for time-limited requests only, so a request dies exactly when its artifact would become unimportable. |
| **Technical recommendation** | **Engineering recommends (c) for time-limited requests plus (a) for perpetual**, because (c) is derived from an existing verified refusal rather than invented, and it makes the failure visible at the Owner instead of at the customer. Risk: PDR-17 explicitly warns that the comparable replacement window's **start/end semantics remain unspecified**, so (b)'s analogy is unsafe and must not be applied by engineering. **This is a product decision** — it determines whether authorized work can be silently discarded. |
| **Depends on** | §1.4, OD-LIC-14, §9.1 state machine (the system-origin `ABANDONED` arrow was added by OD-LIC-20), §12.3 request age, PDR-17's unspecified window semantics. |
| **Can work proceed?** | **RESOLVED and implemented** — see §9.1, §9.2 and the OD-LIC-20 evidence in [`owner-side-issuance-traceability.md`](owner-side-issuance-traceability.md) §2.2. |
| **Document location** | design §15 (this row), §1.4, §9.1, §9.2, §12.3; PDR-19 §11. |
| **Decision owner** | **Product Owner** — the decision is recorded; engineering implemented it without adding configuration. |

### 15.1.9 **(no OQ id)** — Confidentiality and handling of the request file in transport

| Field | Content |
|---|---|
| **Identifier** | **(no OQ id)** |
| **Precise question** | OD-LIC-11 proves the request's **integrity**. Nothing decides its **confidentiality**: the file carries a real customer's commercial terms on removable media. What handling is required? |
| **Decision still required** | A transport-handling rule: permitted media, encryption at rest on the media, whether the file may traverse mail or shared folders, and disposal after signing. |
| **Impact on development** | **Blocks nothing technically and must not be closed by silence.** The request payload contains customer identity, caps, module entitlements and commercial dates — the same class of data OD-LIC-10 recorded as a disclosure surface for the artifact store, but here on media leaving the building with **no** permission gate and **no** audit trail. OD-LIC-11's independent-channel requirement already implies two items in transit, not one. |
| **Options** | (a) Document a handling procedure, no technical control. (b) Encrypt the request file with a pre-shared transport key — note this is a **new key**, which OD-LIC-11 forbids in this phase. (c) Split the payload so the file alone is not commercially meaningful — this changes the request format. (d) Accept the exposure and record it. |
| **Technical recommendation** | **Engineering recommends (a) plus (d) recorded explicitly**, because (b) is excluded by OD-LIC-11's *"no new key"* constraint and (c) would alter the request artifact for a non-integrity reason. Risk of (a): a procedure is only as strong as its enforcement, and the Owner cannot audit what happens offline (§10's recorded audit gap). **Engineering must not choose (b) or (c)** — both need a decision. |
| **Depends on** | OD-LIC-11 (no new key, no format change), §3.4 (integrity not confidentiality), §10 (offline audit gap), OD-LIC-10 disclosure reasoning. |
| **Can work proceed?** | **INDEPENDENT** — a handling procedure can be written and adopted at any time without touching the design. |
| **Document location** | design §3.4, §15 (this row), §10; PDR-19 §6.1. |
| **Decision owner** | **Product Owner** with security — it is a data-handling policy about commercially sensitive customer data leaving the premises. |

### 15.1.10 **(no OQ id)** — Whether an operator may set `supersedesOperationId` or `renewsOperationId`

| Field | Content |
|---|---|
| **Identifier** | **(no OQ id)** |
| **Precise question** | May a `LICENSE_OPERATOR` create a request that supersedes or renews an existing license, or is that reserved to `OWNER_ADMIN`? |
| **Decision still required** | A permission answer, and it is **not** settled by the §6.1 matrix: the matrix makes both fields reachable through `licenses.issue.time_limited`, which an operator may hold. |
| **Impact on development** | **Blocks the request-creation form and its server validation** (§12.2, §11), because whether the fields are offered and accepted depends on it. PDR-12 makes explicit supersession the **only** term-changing path and forbids reducing limits or entitlements on any path, so an operator holding this field holds a term-changing power. |
| **Options** | (a) `OWNER_ADMIN`-only, like perpetual issuance. (b) Operator-allowed for renewal but not supersession. (c) Operator-allowed for both, bounded by the customer's limit profile. |
| **Technical recommendation** | **Engineering recommends (a)**, because supersession changes terms on an existing customer relationship and OD-LIC-07 already established the principle that the irreversible, term-defining act concentrates in `OWNER_ADMIN`; (c) is inconsistent, since a profile bounds *magnitudes* but supersession is a *relationship* change. Risk of (a): renewals become an admin bottleneck, which is the same trade-off OD-LIC-07 already accepted for perpetual grants. **Engineering must not pick (b) or (c)** — both grant a term-changing power the recorded decisions do not. |
| **Depends on** | PDR-12, PDR-18 §9 renewal, OD-LIC-07, §6.1 matrix, §9.1 (renewal and supersession are fields, not statuses), F-1 profiles. |
| **Can work proceed?** | **BLOCKED** for the two fields specifically. Time-limited issuance **without** them is fully buildable now, so this blocks a sub-feature rather than the capability. |
| **Document location** | design §3.2, §9.1, §15 (this row), §12.2; PDR-12; PDR-18 §9. |
| **Decision owner** | **Product Owner** — it allocates a term-changing commercial power between roles. |

### 15.1.11 **(no OQ id)** — PDR-17's static matrix and `domain.ts` comments now contradict OD-LIC-12

| Field | Content |
|---|---|
| **Identifier** | **(no OQ id)** |
| **Precise question** | PDR-17 documents `LICENSE_OPERATOR` as holding four permissions outright, and `domain.ts:14-18,33-38` returns them from `permissions(role)`. Under R-1 those become **eligibility**, not access. Which document is corrected, and when? |
| **Decision still required** | Not a product decision — the decision is made (OD-LIC-12). What remains is the **order**: whether PDR-17 is amended before, with, or after the code. |
| **Impact on development** | **Blocks nothing, but creates a live contradiction that will mislead the next reader.** This is the same class of defect the review found as RV-3: two authoritative documents stating opposite things about the same access rule. |
| **Options** | (a) Amend PDR-17 and the `domain.ts` comment in the same PR that implements R-1. (b) Amend them now, ahead of the code, as a documentation-only change. (c) Leave PDR-17 as historical and record the supersession only in PDR-19. |
| **Technical recommendation** | **Engineering recommends (a)**, matching §14's existing rule that documentation lands with the code it describes and never ahead of it — (b) would make PDR-17 describe behaviour that does not exist yet, which is how the OD-LIC-10 README conflict arose in the first place. (c) is insufficient because PDR-17 is still the document a reader reaches for the role matrix. **This is engineering's to sequence**; no product decision is needed. |
| **Depends on** | OD-LIC-12, OD-LIC-07 (already superseded PDR-17's matrix for this role), §14 documentation rule, `domain.ts:14-18`. |
| **Can work proceed?** | **AFTER PREREQ** — lands with the R-1 implementation (delivery step 1). |
| **Document location** | PDR-17 role matrix; `owner-licensing/backend/src/domain.ts:14-18,33-38`; design §14; PDR-19 §6.2. |
| **Decision owner** | **Engineering** — the policy is decided; only the sequencing of documentation is open, and §14 already states the rule. |

### 15.1.12 **(no OQ id)** — Owner→customer import direction is unpoliced

| Field | Content |
|---|---|
| **Identifier** | **(no OQ id)** |
| **Precise question** | `scripts/check-owner-isolation.py` polices only the customer→Owner direction. Nothing fails a build if Owner code imports customer code, which is exactly how a second canonicalizer could silently become a *copied* one. |
| **Decision still required** | Whether to extend the isolation gate to the Owner→customer direction, and with what exceptions (the vector corpus is shared **data** and must stay readable). |
| **Impact on development** | **Blocks nothing, but it is the cheapest available mitigation of readiness risk R-3** — the risk that the Owner's independent implementation of the canonical byte contract drifts from the customer's. RV-2 in this very review was an instance of that drift, found by a human reading `canonicalizeLicenseVersion` rather than by any gate. |
| **Options** | (a) Extend the script to fail on Owner→customer **source** imports while allowing reads of `docs/licensing/vectors/**` as data. (b) Leave it and rely on §13.1's conformance suite to catch drift at test time. (c) Add both. |
| **Technical recommendation** | **Engineering recommends (c)**: the gate prevents the structural mistake and the conformance suite catches the semantic one; they fail differently and both are cheap. Risk of (a) alone: an import ban does not stop a hand-copied rule, which is what RV-2 was. **No product decision needed.** |
| **Depends on** | §1.1, §1.2, §13.1, readiness R-3, `scripts/check-owner-isolation.py`, `docs/licensing/licensing-protocol-vectors.md` §5 rule 5 and §5.1. |
| **Can work proceed?** | **INDEPENDENT** — can be added at any time, and is cheapest before any Owner licensing code exists. |
| **Document location** | `scripts/check-owner-isolation.py`; design §1.1, §1.2, §13.1. |
| **Decision owner** | **Engineering** — it is a build-gate scope question with no product or commercial content. |

### 15.1.13 **(no OQ id)** — Whether the signer's duplicate-suppression record (§4.2 check 11) is required

| Field | Content |
|---|---|
| **Identifier** | **(no OQ id)** |
| **Precise question** | Check 11 keeps a local append-only record of signed `operationId`s in the offline environment. Is that a **requirement** of the signer, or optional hardening — and what happens when a second signing station exists? |
| **Decision still required** | Whether check 11 is mandatory, and how duplicate suppression works across more than one offline station. |
| **Impact on development** | **Blocks the signer's specification (delivery step 5).** The Owner-side controls are unaffected and remain authoritative: `operation_id` is unique (§5.1) and the §9.1 state machine refuses a second import. But check 11 is the **only** defence against T-10 that runs before the key is used. |
| **Options** | (a) Mandatory single-station record, accepted as best-effort. (b) Mandatory plus a documented rule that only one signing station may exist. (c) Optional, relying on Owner-side uniqueness. |
| **Technical recommendation** | **Engineering recommends (b)**, because (a) silently degrades to nothing when a second station appears and (c) abandons pre-signature detection for the one attack no digest can catch — a replayed file has a *correct* digest. Risk of (b): it constrains operations to one offline station, which may be a real limitation for a growing Owner team and is why the choice is recorded rather than assumed. **Arguably a product/operational decision** if more than one station is ever wanted. |
| **Depends on** | §4.2 check 11, §3.6 T-10, §5.1 uniqueness, §9.1 state machine, OD-LIC-08's offline environment. |
| **Can work proceed?** | **AFTER PREREQ** — implementable as (a) immediately; (b) needs the operational constraint accepted. |
| **Document location** | design §4.2 check 11, §3.6 T-10, §5.1. |
| **Decision owner** | **Engineering** for the mechanism; **Product Owner** if the one-station constraint is unacceptable operationally. |

### 15.1.14 Summary — what can be built today

| Delivery step (§14) | Blocked by | Can start now? |
|---|---|---|
| **1** Permission grants, effective resolution, audit | **OQ-75** (exact code names) | **No** — needs the vocabulary |
| **2** Owner canonicalizer / signer / verifier + conformance suite | nothing | **Yes — INDEPENDENT**, and it is the highest-risk piece, so it should go first |
| **3** Request-integrity control (OD-LIC-11 check 10) and the proof the key is never read on refusal | nothing — **OD-LIC-11 decided it** | **Yes — INDEPENDENT** |
| **4** Permission matrix + grant lifecycle | OQ-75 for names; **OD-LIC-12 decided the semantics** | After step 1 |
| **5** Limit profiles, migration `007`, reactivation, snapshot | **OD-LIC-13 and OD-LIC-14 decided both** | **Yes** once step 1 exists — no product decision outstanding |
| **6** Durable artifact store + recovery at the PostgreSQL/filesystem boundary | nothing for construction; OQ-91 for retention policy | **Yes** for construction |
| **7** Endpoints: request creation, artifact import, secure download | OQ-75 (authorization), OQ-81 (replay DTO) | Partially — logic yes, shipped response no |
| **8** Owner UI and the full operator round trip | steps 1–7; §12.2's supersession/renewal fields blocked by dependency 10 | Partially |
| **9** Integration and customer tests, full CI, manual evidence review | everything above, plus OQ-85 evidence | Last |

**Two capabilities are blocked by a missing product decision and nothing else:**
step 1 (OQ-75's vocabulary) and the supersession/renewal fields of steps 7–8
(dependency 10). Everything else either has its decision or is legitimately
engineering's.

**No step is called complete here.** Nothing is implemented; the table says what may
*start*, not what is done.

---

## 16. Verification performed for this design

| Check | Method | Result |
|---|---|---|
| Owner cannot import customer code | `owner-licensing/README.md`, ADR-0048 Phase 1 addendum, PDR-16 D-2(a), `scripts/check-owner-isolation.py` read in full | Confirmed; §1.1 |
| Vectors consumable as data by a second implementation | `licensing-protocol-vectors.md` §5 rule 5 and §5.1 | Confirmed; §1.2 |
| Test-only key fixtures exist and are labelled | `docs/licensing/vectors/keys/*.json` | Confirmed; §1.3. Material not reproduced here |
| `expired-document` rule | `license-import.service.ts:567-582` | Confirmed; §1.4 |
| Refusal-reason vocabulary and HTTP classes | `license-version.ts:925-968` | Confirmed; §7.2 |
| Reusable Owner patterns | `src/archive.ts`, `src/domain.ts`, `src/db.ts`, `src/migrate.ts`, `src/app.ts`, migrations `002`/`004`/`006` | Confirmed; §1.5 |
| Payload field and limit rules | `license-code.ts:81-89`, `:365-447`; `license-document.ts:47-51`, `:77-118`, `:160-236`, `:307-330` | Confirmed; §3.2, §3.5 |
| **[REVIEW RV-2] Exact canonicalization of the three conditional fields** | `canonicalizeLicenseVersion`, `license-document.ts:272-303` read in full | Confirmed: `deviceLimit` omitted **iff** `!deviceLimitSpecified`; `renewsOperationId` omitted **iff** `null`, else emitted between `supersedesOperationId` and `issuedAt`; `supersedesOperationId` **always present**. The original §3.2 text was wrong about the first and third |
| **[REVIEW RV-2] `v` and `kind` literals** | `license-document.ts:47-51` | Confirmed: `v = 2`, `kind = 'SERVER_LICENSE_VERSION'`, prefix `VLIC2`, envelope `vardena-license` / `fileVersion 1` |
| **[REVIEW RV-2] Corpus census — do the vectors exercise the omission rules?** | All 23 files under `docs/licensing/vectors/**` decoded; 6 carry a `VLIC2` payload | Confirmed and it matters: **all 6 carry all 18 fields**, `supersedesOperationId` is `null` in all 6, `deviceLimit` is present in all 6, and `renewsOperationId` appears in **zero** canonical byte strings. So the corpus alone would **not** have caught the §3.2 error — an independent reason the golden literals of §13.2 are required |
| **[REVIEW RV-2] The two payloads cannot share one digest** | Field-set comparison, §3.4 | Confirmed: request has `v = 1`, `kind = SERVER_LICENSE_ISSUANCE_REQUEST`, `requestId`, `requestedAt`, `requestedByUserId`, `deviceLimitSpecified`; `VLIC2` has `v = 2`, `kind = SERVER_LICENSE_VERSION`, `issuedAt`. A single digest comparison refuses every legitimate import |
| **[REVIEW RV-3] Current role baseline** | `owner-licensing/backend/src/domain.ts:3-39` | Confirmed: `LICENSE_OPERATOR` holds exactly `customers.view`, `audit.view`, `operations.view`, `operations.record`; `OWNER_ADMIN` holds all eight; unknown roles get `[]` |
| **[OD-LIC-11] The adopted control needs no protocol change** | §4.4 O-A against PDR-16 D-2(b), the `VLIC2` format and the corpus | Confirmed: a displayed SHA-256 adds no key, no signed field, no canonicalization rule and no vector |
| **[OD-LIC-13] The partial unique index enforces the constraint on reactivation** | PostgreSQL semantics for a partial unique index under `UPDATE` | Confirmed by construction: when an updated row newly satisfies the predicate its index entry is inserted and uniqueness is checked, so `RETIRED → ACTIVE` fails at the database if another `ACTIVE` row exists for that customer. The service still refuses first |
| **[OD-LIC-12] R-1's effect on the existing role baseline** | `owner-licensing/backend/src/domain.ts:3-39` | Confirmed: the four operator permissions become eligibility, not access, so the static `permissions()` result must not be used as the effective check, and PDR-17's matrix becomes contradictory until updated (§15.1.11) |
| **[OD-LIC-14] The snapshot rule overrides no other control** | §5.1 immutable-facts trigger, §7.4, §8.3, §9.1 | Confirmed: OD-LIC-14's own text forbids payload alteration, integrity bypass and ignoring other controls, and each of those is enforced by a separate mechanism this design already specifies |
| **[2026-10-20] Repository state before amending** | `git fetch origin --prune`; `gh pr view 186`; `gh api …/check-runs` | PR #186 **OPEN**, `MERGEABLE`/`CLEAN`, head `8ac158a`; `origin/main` = `8fc52eee…`; CI run `39327463867` all success. The local branch ref had been reset to the branch base a **third** time; recovered from the pushed head after verifying all seven files byte-identical, with no working-tree loss |
| `docs` link check | `python3 scripts/check-docs-links.py` | PASS, 0 broken |

No test was executed for this design, no code was written, and no capability is
claimed. A green documentation CI run is not evidence of issuance.
