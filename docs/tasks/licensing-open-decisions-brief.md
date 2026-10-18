# Licensing — open decisions brief (OQ-76, OQ-78, device lifecycle vs Grace)

**Type:** decision brief (no decision is taken here) · **Date:** 2026-10-16 ·
**Baseline:** `main` `c715a64cdfcbc866fe65613a0375a118e0024a8b` (PR #167 merge).
**Authority:** only the Product Owner decides. Every item below is recorded as
**OPEN**; nothing in this document changes a registry status, a PDR or an ADR.

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
  `active: evaluated?.active ?? false`, and `requireActiveSignedLicense`,
  `licenseBindingIsCurrent` and the two inline replacement branches all require
  it. `accessMode` is referenced nowhere in the device slice.
- Consequently, from the first millisecond after the signed expiry instant:
  enrollment challenges, enrollment activation and replacement challenges are
  refused with `license-not-active`; and `proveReplacement`,
  `replacementRequestExport`, `completeReplacement` and `cancelReplacement`
  first transition the pending request to **`EXPIRED`** and then refuse. A
  plain `GET` of the device inventory or history (a **read**, requiring only
  `Licensing.Device.View`) runs the same sweep, so reading the page destroys
  in-flight state.
- The audit reason recorded for that destruction is `license-version-changed`
  (or `license-context-changed` in the sweep), although no version and no
  binding changed — only the natural expiry boundary was crossed.
- Deactivation, inventory and history still work during Grace; every other
  licensed capability keeps working, because `LicensingService` preserves
  entitled permissions in `GRACE` (ADR-0049 decision 4) and
  `Org/UserAllocation` accepts `ACTIVE | GRACE`.
- **No test pins any of this.**

### Why it is a question rather than a bug to fix silently

- ADR-0049 decision 4 and PDR-11 §9.1 ("normal authorized operation continues
  during Grace") say Grace keeps entitled capabilities.
- PDR-15 §2.13 says an offline replacement "may remain pending until a valid
  signed response/evidence is imported" with a 30-day TTL, and
  `docs/licensing/client-device-lifecycle.md` §4.1 makes the terminal
  transition depend on the **effective version or installation binding
  changing** — neither changes at a natural expiry boundary.
- Against that, PDR-15's original decision text describes registration as
  permitted when the "authoritative license is active", which can be read as
  requiring the strictly valid license.
- Whichever way it is decided, the current behaviour is undocumented,
  untested, and reports a reason that is factually wrong.

### Options

| # | Option | Effect | Cost / risk |
|---|---|---|---|
| A1 | **Grace permits device operations** (treat `ACTIVE` and `GRACE` as current; `READ_ONLY`/`BLOCKED` refuse without destroying). | Consistent with "Grace keeps normal operation"; a customer whose server dies in the renewal window can still replace it; renewal restores everything without manual reconstruction. | A customer who never renews can register/rotate devices for 14 extra days. Bounded and small. |
| A2 | **Grace refuses device operations, but never destroys pending state** (refuse with `license-not-active`, leave the request `PENDING` to its own 30-day TTL). | Keeps "a valid license is required to change the device fleet", while honouring PDR-15 §2.13 and OQ-45's "no manual reconstruction after renewal". | A Grace-window replacement cannot complete until the renewal lands; that is a deliberate, explainable delay. |
| A3 | **Keep today's behaviour**, document it in PDR-15/§9 and pin it with tests. | No code change. | Requires accepting that a read can void an Owner-approved replacement and that the audit reason is misleading — I recommend against it unless A1/A2 are rejected. |

### Recommendation

**A2**, with A1 acceptable if the Owner prefers operational continuity during
Grace. In both cases the destructive sweep must stop treating natural expiry as
a context change, and the recorded reason must say what actually happened.

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

## 4. Reduction-guard findings from the renewal audit (one fixed, one to decide)

The renewal/supersession audit re-checked the L-05 downgrade question the Owner
asked about, and confirmed the guard is **not** keyed on `supersedes`:
`evaluateImportConflicts` runs the capacity/entitlement arms on the explicit
supersession path, the implicit hand-over, the legacy `VLIC1` path and the
adjacent renewal path. Two facts came out of it:

1. **A named supersession target could displace the measurement (high) — FIXED
   in this change.** When a document named a `supersedesOperationId` that did
   **not** overlap it, the capacity/entitlement measurement ran only against
   that named version and the L-05 continuation baseline was not computed at all
   (`supersedes !== null` skipped rule 6c). Reproduced with ordinary imports
   only: `V_low` (org limit 5) → adjacent `V_high` (org limit 50) → `D`
   (org limit 6) naming `V_low`, with 40 organizations in use: the document was
   **applied**, while the same document without `supersedesOperationId` was
   refused `reduction-requires-resolution`. This contradicted the in-code §8.6
   text and design §F-8 ("a changed licenseId must not bypass the control"), so
   it was treated as the pure defect it is rather than as policy. Rule **6b′**
   now measures the deterministic continuation baseline as well whenever it
   exists and differs from the named target, refuses with that baseline named as
   `predecessorVersionId`, records it as the resolution subject when an explicit
   resolution authorizes the reduction, and defers an otherwise-unused
   resolution until the baseline has been measured (an operation-level check
   still refuses a resolution nothing authorized). Regression tests construct the
   exact timeline above, including the resolution and the no-conflict
   counter-case; the 71 pre-existing domain cases and the 88 import-service cases
   are unchanged.

2. **No-baseline paths remain unmeasured (high/medium) — product decision
   required.** A post-gap recovery candidate is measured against nothing,
   although PDR-13 §4.2 says the reduction guard "runs on the recovery path
   exactly as on every other path"; a retires-nothing candidate that is not
   exactly adjacent (interior gap fill, backdated prefix) is likewise unmeasured,
   which `docs/licensing/version-model-and-file-exchange.md` records as in scope
   for L-05 while PDR-11 §8.6 states an unconditional trigger. **Recommendation:**
   either extend the baseline to "the retained version with the greatest
   effective end ≤ the candidate's start" (one consistent rule for recovery, gap
   fill and backdated prefix) or record the exemption explicitly in PDR-13 and
   the version-model document. No existing test covers a reduction on a
   no-baseline path, so this change must bring its own timeline.

---

## 5. What this brief does not do

It does not close OQ-76 or OQ-78, does not create or amend an OQ row, does not
promote ADR-0049, and does not authorise any of the changes above. It is the
input for the Owner's decision on sections 1–4.
