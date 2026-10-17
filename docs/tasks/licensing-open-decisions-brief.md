# Licensing — open decisions brief (OQ-76, OQ-78, device lifecycle vs Grace)

**Type:** decision brief (decision status is explicit in each section) · **Date:** 2026-10-17 ·
**Original audit baseline:** `main` `c715a64cdfcbc866fe65613a0375a118e0024a8b` (PR #167 merge).
**Current source-of-truth baseline (2026-10-17):** `main` `af68fd8eea5e5163d7827fa7b21d4bea85388e32` (PR #169 merge); PR #170 is **closed without merging** at head `ff2f4df1cc97b9fd974f0d73e197074727829af3` and its work is not assumed to be on `main`.
**Update:** 2026-10-17 — Product Owner expressly accepted OD-LIC-05 Option 1 for C10; OQ-87 and C11 remain open.
**Authority:** only the Product Owner decides. Open questions in §§1–3 and C11 remain **OPEN**; OD-LIC-05 is accepted and recorded in PDR-13 §8 / ADR-0050. This brief is supporting evidence and does not change any registry OQ status.

This brief exists because a licensing audit of the merged OQ-45/device work
found behaviours that the approved documents do not settle. Each section states
the question, the evidence, the options with their consequences, and a
technical recommendation. The independent, non-blocked work (verification
coverage, the read classification guard, the license-gate Instant defect, the
replacement-key lookup defect) was completed separately and does not wait on
these answers.

---

## 1. GRACE and the client-device lifecycle (new question, no OQ row)

### Question

During the 14-day natural-expiry **GRACE** window (OQ-45, ADR-0049), may a
customer **enroll a client device**, **prove a replacement request** and
**complete a replacement** — and when the license lapses, may the installation
**destroy** an already-issued pending replacement request?

### What the code does today (verified, untested)

- The device slice gates on `EvaluatedLicense.active` (strict signed validity),
  never on `accessMode`: `ClientDevicesRepository.lockedLicenseContext`
  (`backend/src/modules/licensing/data/client-devices.repository.ts`) sets
  `active: evaluated?.active ?? false`, and `requireActiveSignedLicense` and the
  replacement operation gates require it. `accessMode` is referenced nowhere in
  the device slice.
- Consequently, from the first millisecond after the signed expiry instant:
  enrollment challenges, enrollment activation and replacement challenges are
  refused with `license-not-active`, and `proveReplacement` /
  `completeReplacement` refuse the same way.
- Deactivation, inventory and history still work during Grace; every other
  licensed capability keeps working, because `LicensingService` preserves
  entitled permissions in `GRACE` (ADR-0049 decision 4) and
  `Org/UserAllocation` accepts `ACTIVE | GRACE`.

### Already corrected (2026-10-16, second corrective slice)

The destructive half of this area was a defect, not a policy question, and is
fixed:

- the sweep that runs before a read no longer treats an inactive license as a
  context change, so a plain `GET` cannot expire a retained challenge or
  replacement request;
- `proveReplacement` and `completeReplacement` refuse with `license-not-active`
  and leave the retained request untouched, so an already accepted
  Owner-signed response survives the lapse and applies after a valid renewal;
- the sweep has exactly two triggers with accurate reasons —
  `challenge-expired` / `request-expired` for the operation's own clock, and
  `license-context-changed` for a real effective-version, binding or
  entitlement change (replacing the inaccurate `license-version-changed`);
- repository-level regression tests pin both directions and fail on the
  pre-change predicate (verified locally).

This means the **implemented** behaviour is now option A2 below. The surviving
product question is narrower: should Grace also *permit* device enrollment,
replacement proof and completion (A1), or is refusing-while-retaining (A2) the
approved policy?

### Options

| # | Option | Effect | Cost / risk |
|---|---|---|---|
| A1 | **Grace permits device operations** (treat `ACTIVE` and `GRACE` as current; `READ_ONLY`/`BLOCKED` still refuse without destroying). | Consistent with "Grace keeps normal operation"; a customer whose server dies in the renewal window can still replace it. | A customer who never renews can register/rotate devices for 14 extra days. Bounded and small; one predicate (`requireActiveSignedLicense`) plus its tests. |
| A2 | **Grace refuses device operations, but never destroys pending state** — *this is what the code does today, documented and tested.* | Keeps "a valid license is required to change the device fleet" while honouring PDR-15 §2.13 and OQ-45's "no manual reconstruction after renewal". | A Grace-window replacement cannot complete until the renewal lands; that is a deliberate, explainable delay. |
| A3 | Keep the pre-2026-10-16 behaviour (a read may void a pending replacement). | n/a | Rejected as a defect: it needs a reason that is factually false and destroys accepted offline evidence. |

### Recommendation

**A2** is implemented and recommended as the settled reading; choose **A1** only
if the Owner prefers operational continuity during Grace, in which case the
change is bounded to one predicate and its tests.

---

## 2. OQ-76 — clock-rollback detection (policy decided, mechanism absent)

### Question

Which persisted time-integrity evidence and which unlock procedure should
implement PDR-11 §12.6? The policy is decided; the detector is not.

### State of the code

- There is **no** clock-rollback watermark, detector, persisted evidence, or
  restriction/unlock path anywhere in the licensing module. The registry row
  (`docs/open-questions.md`, OQ-76) states "POLICY DECIDED; OPEN for
  mechanism/evidence"; PDR-11 §20.5 lists the mechanism as unimplemented.
- Every licence-time comparison is exact epoch arithmetic on signed instants
  (`validFrom`, `validUntil`), so a rollback cannot extend signed validity by
  itself; it can only postpone when the natural expiry is observed.

### Options

| # | Option | Evidence / persistence | Consequence |
|---|---|---|---|
| B1 | **Monotonic high-water mark in the database** (`licensing.time_integrity`: `last_observed_at`, `last_observed_source`, updated in the same transaction as any licence evaluation that persists state). A backward step beyond a *recorded* tolerance raises evidence and applies a **rollback-only** restriction; correction restores, but only through an attributable, audited unlock. | One added table/row, written by existing transaction paths; an operator can read the mark. | Tamperable by anyone with database access, so it is evidence, not proof. A tolerance value is needed — which §12.6 explicitly forbids inventing. |
| B2 | **Evidence without a threshold**: record every observation and every backward step, apply **no** automatic restriction, and expose the evidence for an Owner decision. | Same table, no threshold, no automatic restriction. | Fully honours "do not invent a numeric threshold"; the restriction stays a manual, audited act. |
| B3 | **Cryptographic trusted-time anchor outside the customer installation** (Owner-signed time attestation, refreshed opportunistically). | Owner-side artifact + local retention; offline-safe only within the attestation window. | Strongest evidence, but it adds an internet/Owner dependency that PDR-11 §10.1's offline-first principle resists, and it is a much larger slice. |

### Recommendation

**B2 first**, as the smallest change that is honest about its evidence: it
records the fact and never invents a threshold, and it gives the Owner the data
needed to decide a threshold later. B1 is the natural follow-up once the Owner
supplies a tolerance; B3 only if the Owner accepts a periodic Owner-side
dependency. The unlock path (controlled, attributable, audited, rollback-only)
must be designed with whichever is chosen, per §12.6.

---

## 3. OQ-78 — cancellation, revocation, recovery (policy partly decided)

### Question

The registry records OQ-78 as "POLICY DECIDED in part; implementation/security
details remain OPEN". What is still missing:

1. the **revocation instrument** (how an Owner withdraws a wrongly issued
   license) and how a customer installation accepts it offline;
2. the **emergency stop** semantics versus natural expiry (OQ-45 explicitly
   refuses to equate them);
3. the **restricted recovery path** with independent administrator
   authentication and approved backup access (PDR-11 §§10, 21);
4. what the customer UI shows and what the API returns in each of those states.

### State of the code

- `licensing.licenses` has no revocation state; `LicenseStatus` is
  `ACTIVE | EXPIRED | SUSPENDED` and a signed `SUSPENDED` document already
  results in `BLOCKED` (no Grace) — but there is **no** signed revocation
  artifact, no revocation protocol version, no customer-side acceptance path,
  and therefore no way to stop a wrongly issued perpetual licence.
- Grace/Read-Only (OQ-45) is now implemented and is deliberately **not** an
  emergency stop: a `BLOCKED` license gets no Grace and no read-only
  degradation.
- No login-blocking state exists (read this together with OQ-76).

### Options

| # | Option | Shape | Consequence |
|---|---|---|---|
| C1 | **Signed revocation artifact reusing the VLIC transport** (new signed kind, same key set, offline-verifiable, monotonic by `issuedAt` against a retained revocation record). | Smallest protocol addition; reuses Ed25519 verification, replay handling and the retained-record pattern. | Needs a decision on whether a *later* valid license can lift a revocation (I would say no, except by an explicit signed restoration). |
| C2 | **Revocation only through a new signed version with `status = SUSPENDED` and no Grace** (no new artifact kind). | No protocol change at all; issuance tooling already supports the status. | A single status cannot distinguish "emergency stop" from "suspended by request", and there is no authenticated recovery path or audit receipt; weak evidence for a security action. |
| C3 | **C1 plus a restricted-recovery contract** (independently authenticated administrator, approved backup access, and a signed restoration artifact). | Complete OQ-78, larger slice: protocol + API + UI + audit + operational runbook. | The most faithful to PDR-11 §§10/21; needs its own design record (ADR) before implementation. |

### Recommendation

**C3**, delivered in two slices: first the revocation artifact and its
customer-side acceptance (C1), then the restricted-recovery contract. C2 is
acceptable only as an interim measure if the Owner accepts the evidence gap.
Until either exists, the standing risk in `docs/tasks/licensing-owner-side-phase-0-readiness.md`
(R-7: a wrongly issued perpetual licence cannot be withdrawn) remains.

---

## 4. Reduction-guard findings and accepted C10 decision (updated 2026-10-17)

The renewal/supersession audit re-checked L-05 and the post-gap recovery flow.
This section preserves the original defect evidence and records the accepted
OD-LIC-05 decision and its implementation evidence; it does not change the
status of any OQ.

### 4.1 Rule 6b′ — named target cannot displace the measurement (fixed)

When a document named a `supersedesOperationId` that did **not** overlap it,
the earlier implementation measured only that named version and skipped the
L-05 continuation baseline. Reproduction: `V_low` (org limit 5) → adjacent
`V_high` (org limit 50) → `D` (org limit 6) naming `V_low`, with 40
organizations in use. `D` applied, while the same document without
`supersedesOperationId` was refused `reduction-requires-resolution`. Rule 6b′
measures the deterministic continuation baseline when it exists and differs
from the named target, names that baseline in the refusal, and uses that same
single version as the resolution subject. The expired/scheduled target remains
validated and retired as declared; one confirmation cannot authorize a grant
the operator was not shown.

### 4.2 C10 — post-gap recovery measurement (implemented in PR #171; OD-LIC-05 accepted)

**Evidence.** `continuationBaselineFor` requires an effective retained window to
end exactly at the candidate's `validFrom`. A post-gap candidate starts
strictly *after* all retained coverage, so there is no adjacency baseline and a
reducing recovery was not measured. The old labelled characterisation tests
pinned that bypass. The reduction-resolution route cannot solve it: it carries
only resolution intent and the post-gap guard correctly rejects the candidate
before it can apply. The recovery route carried only recovery intent, so simply
enabling the check would have made a conflicting recovery permanently
inapplicable.

**Accepted OD-LIC-05 (Option 1, combined operation; Product Owner approval
2026-10-17).** Measure a genuine post-gap recovery against the retained version
whose effective coverage ended last, using `lapsedCoverageVersion` (latest
effective end; ties by latest `importedAt`, then `versionId`; `null` if nothing
is retained or any effective window is perpetual). `lapsedLicenseContext`
delegates to that helper and preserves its exact current result semantics,
including perpetual → `null`. The gate runs before rule 4/5. The dedicated
recovery endpoint may carry an optional `reductionResolutionReason` (3–500
chars); if present, all three permissions are required: Activate +
RecoverAfterGap + ResolveReduction. The new version plus both typed audit events
(`license.import.recovered` and `license.import.reduction-resolved`) are
committed in one transaction. The resolution event records actual conflict
objects recomputed under the transaction locks. The lapsed version is the
resolution subject but is never superseded or stamped.

| Request / state | Contract |
|---|---|
| Ordinary import of a post-gap candidate | 409 `post-gap-recovery-requires-dedicated-operation`; unchanged |
| Separate reduction-resolution route with a post-gap candidate | Still refused by the post-gap gate; unchanged |
| Recovery with a non-conflicting grant and no resolution reason | Applies through the existing recovery operation |
| Recovery with a conflicting reduction but no resolution reason | 409 `reduction-requires-resolution`, with the lapsed predecessor and concrete conflicts |
| Same recovery with a resolution reason and all three permissions | Applies; returns resolved predecessor/conflicts; writes both typed events atomically; does not stamp the lapsed version |
| Post-gap recovery document declaring a supersession target | 409 `recovery-not-applicable` (the only deliberate behavior tightening: recovery retires nothing) |

Conflict copy is operation-aware: it tells an operator to resolve the reduction
on the **same recovery operation**, not to submit the post-gap document to the
separate resolution route. The target case likewise does not tell the operator
to use ordinary import, which would reject a genuine post-gap candidate.

OD-LIC-05 is deliberately limited to C10. It does **not** expand the §8.6
baseline to interior/backdated gap-filling candidates, change renewal-gap
precedence, alter non-post-gap recovery behavior, add schema/migrations, or
close OQ-87. C11 remains a separate open decision. PDR-13 §8 and accepted
ADR-0050 record the approval; implementation and CI status remain separate from
product acceptance.

### 4.3 C11 — interior/backdated gap fills (still open)

A retires-nothing candidate that is not exactly adjacent (interior gap fill or
backdated prefix) remains unmeasured. Extending the baseline to the retained
version with the greatest effective end less than or equal to the candidate's
start would cover recovery, gap fill and backdated prefix with one rule, but it
would change which grant a signed document is measured against. No such change
is included here; C11 remains open for an explicit Owner decision.

## 5. What this brief does not do

It does not close OQ-76, OQ-78, OQ-87 or any other OQ. The OQ-87 registry row
records the accepted OD-LIC-05 C10 policy as an evidence/decision note only; its
status is unchanged. ADR-0050 is accepted for OD-LIC-05 Option 1. PR #171 carries
the implementation and remains open/unmerged for review; product acceptance is
not merge authorization. No other decision or OQ status is changed by this brief.
