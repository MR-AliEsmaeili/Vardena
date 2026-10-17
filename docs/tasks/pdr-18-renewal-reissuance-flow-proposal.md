# PDR-18 §1 — renewal/reissuance flow compatibility proposal (engineering, for Product Owner decision)

- **Date:** 2026-10-17
- **Author:** engineering (Arena agent session on `arena/195e235b-vardena`)
- **Status:** **PROPOSAL — no Product Owner decision, and no runtime change.** This
  document is the deliverable PDR-18 §1 asks for in its final bullet
  ("engineering must propose a compatible renewal/reissuance flow that does not
  silently weaken overlap/gap and supersession checks"). It deliberately
  implements nothing: PDR-18 §1 also says "Do not implement a workaround or
  infer that a newly issued license can override a currently governing version
  without passing the existing conflict authority."
- **Related:** [PDR-18](../decisions/product/PDR-18-licensing-commercial-dates-and-lifecycle-decisions.md)
  §1 (temporal constraints) and §2 (C11), [PDR-13](../decisions/product/PDR-13-post-gap-recovery.md)
  §9, [ADR-0050](../adr/0050-post-gap-recovery-reduction-guard.md),
  [OQ-88](../open-questions.md), and the PDR-18 §1 Owner-side
  [implementation record](pdr-18-contract-and-activation-dates-implementation.md).

---

## 1. The conflict, stated precisely

PDR-18 §1.2 decides that at issuance the activation-validity start is the
**current issuance day** and that the issuer "cannot edit or backdate/future-date
this start". PDR-18 §1's temporal bullet adds that "a signed artifact that claims
either is rejected".

The currently approved renewal model is built on the opposite shape. In the
version model a successor hands over at **its own `validFrom`**, which is exactly
what lets a renewal be imported _before_ the predecessor expires without
disturbing what governs today
(`backend/src/modules/licensing/domain/license-version.ts:24-29`, and
`docs/licensing-architecture.md:153-157`). The developer CLI documents the
renewal as `--valid-from 2027-01-01 --valid-until 2028-01-01`
(`docs/licensing-architecture.md:311`), and the committed conformance vectors pin
`issuedAt 2026-10-11T00:00:00.000Z` with `validFrom 2027-01-01T00:00:00.000Z`
(`backend/src/tools/generate-licensing-vectors.ts:136-166`).

So the question is not "how do we reject future starts" — it is **what the
renewal flow becomes when a successor may no longer be dated to the
predecessor's end.** That is registered as
[OQ-88](../open-questions.md) and is the subject of this proposal.

## 2. Verified current behaviour (read from the code, not assumed)

These are the facts every option below must respect. Each was verified by
reading the current tree at `main` `7fa9ff3ba460eb023b657db216c6a6488cc2af87`.

| #   | Fact                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Evidence                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| V1  | **The issuance timestamp cannot override the governing version.** `RetainedLicenseVersion` has **no `issuedAt` field at all**; the signed document's issuance instant is not part of the retained version model. Effective-version precedence is `validFrom` → `importedAt` → `versionId`, so the import instant is only a tie-break between two versions with an identical `validFrom`; it never promotes a later-issued version over an earlier-starting one. | `license-version.ts:138-178` (interface), `:1995-2004` (`compareByStartThenImport`), `:811-828` (`resolveEffectiveVersion`) |
| V2  | **Today nothing relates `validFrom` to `issuedAt` in the signed contract.** `assertLicenseVersionPayload` validates only `validUntil > validFrom` (plus identity, limits and self-supersession). A future-dated start is therefore structurally signable and verifiable today.                                                                                                                                                                                  | `license-document.ts:671-700`                                                                                               |
| V3  | **Overlap is refused, not stacked.** The candidate's window may not intersect the _effective_ window of any retained version except the one it retires (`overlapping-range`); retired history counts.                                                                                                                                                                                                                                                           | `license-version.ts` rule 4 (`:1175-1188`), `:1425-1520`                                                                    |
| V4  | **A later start takes over (OQ-80 Option B).** A signed document that starts later than exactly one still-governing version it overlaps takes that version over at its own `validFrom`: the predecessor stops governing there, **nothing is stacked**, and the hand-over is stamped and audited like an explicit supersession.                                                                                                                                  | rule 5, `:1179-1185`                                                                                                        |
| V5  | **A hand-over may not be backdated.** Retiring a target at a `validFrom` in the past, where the target had already governed that past, is refused as `backdated-supersession`. A target that had _already ended_ by its own `validUntil` is still allowed — its window is pinned, so the stamp shortens nothing.                                                                                                                                                | rule 6, `:1186-1196`                                                                                                        |
| V6  | **A renewal may not leave a gap (G2).** When the candidate carries the identity of a retained license, its `validFrom` may not be later than that license's retained coverage end (`renewal-gap`). Adjacency — previous exclusive end equals the new `validFrom` — is contiguous, not a gap.                                                                                                                                                                    | rule 7, `:1247-1253`                                                                                                        |
| V7  | **A post-gap start needs the dedicated recovery operation.** A candidate carrying a **new** license identity whose window starts strictly after the installation's retained coverage end is refused on every ordinary path (`post-gap-recovery-requires-dedicated-operation`); it applies only through the dedicated, permissioned, reasoned, audited recovery operation with its own L-07 measurement.                                                         | rule 7b, `:1254-1266`; `license-gap-recovery.controller.ts`                                                                 |
| V8  | **A reduction is checked and explicitly resolved, never silently applied (§8.6).** A hand-over that shrinks capacity/entitlements is measured per dimension against current usage (rule 6b, `reduction-requires-resolution`); a contiguous renewal that retires nothing is measured against the deterministic continuation baseline — the retained grant whose effective window ends exactly at the candidate's `validFrom` (rule 6c, L-05).                    | rules 6b/6c, `:1197-1246`; `continuationBaselineFor` `:1085+`                                                               |
| V9  | **The issuance CLI always mints a new `licenseId`** (there is no `--license-id` flag, F-8 Decision #4), so a CLI-issued renewal always carries a **new** license identity.                                                                                                                                                                                                                                                                                      | `docs/licensing-architecture.md:322-324`; `backend/src/issue-development-license.ts`                                        |

## 3. What a strict "issue-today" rule would actually change

Applying PDR-18 §1.2 to renewals verbatim — the successor's window starts on the
issuance day — produces three consequences that are easy to miss and that no
record has decided:

### 3.1 An early renewal consumes the term the customer already paid for

Issued 30 days before the predecessor expires, an issue-today successor starts
**inside** the governing window. Rule 5 (V4) then fires immediately: the
predecessor stops governing today and nothing is stacked. The 30 remaining paid
days are not carried forward, not credited and not stacked — they simply stop
existing. Today, the same renewal dated to the predecessor's end hands over at
expiry and loses nothing.

### 3.2 A late renewal becomes a post-gap recovery operation

Under issue-today, a renewal sold **one day after** the predecessor's coverage
end — including inside the 14-day natural-expiry Grace that OQ-45/PDR-18 §4.1
grant — cannot be dated to the coverage end, so it starts strictly after the
retained coverage end. Because the CLI always mints a new `licenseId` (V9),
rule 7b (V7) classifies it as a post-gap candidate: ordinary import is refused
with `post-gap-recovery-requires-dedicated-operation`, and it becomes
recoverable only through the dedicated recovery operation with its own
permission, required reason, typed audit event and L-07 measurement. Today that
same sale is an ordinary contiguous import, because the target "had already
ended" and V5 permits the stamp.

**This is the sharpest consequence:** a rule intended to make issuance dates
honest would reclassify ordinary late renewals — the majority of real renewals —
as incident-style recoveries.

### 3.3 The §8.6 reduction measurement moves to a different rule

A contiguous renewal dated to the predecessor's end retires nothing and is
measured under rule 6c against the continuation baseline (V8). An issue-today
successor that lands inside the governing window _retires_ the predecessor under
rule 5, so the same shrink is measured under rule 6b against the predecessor as
the hand-over target. The two paths differ in which operation may carry the
explicit reduction resolution and in what the audited resolution subject is, so
the change is not cosmetic even where the numeric limits are identical.

## 4. Options

All four keep the invariants of §5. They differ only in **which instant is the
"activation-validity start" that PDR-18 §1.2 pins to the issuance day.**

### Option 1 — Strict: the signed window starts on the issuance day

`validFrom` = issuance day for every newly issued document, renewals included.

- **Satisfies** §1.2 literally, for all documents.
- **Costs:** 3.1 (early renewal consumes paid term), 3.2 (late renewal becomes a
  post-gap recovery), 3.3 (§8.6 moves from 6c to 6b).
- **Also requires:** a PO answer on whether the customer is compensated for the
  truncated term, since "nothing is stacked" is itself an approved rule (V4) and
  cannot be quietly reversed.

### Option 2 — Issue-today on the artifact, deferred effective start

The document is signed with `validFrom` = the issuance day, so **nothing is
backdated or future-dated at issuance** — §1.2 is satisfied on the artifact that
the Owner actually issues. The version's _governing_ window, however, still
begins where the predecessor stops governing (its coverage end), or on the
issuance day when there is no predecessor.

- **Satisfies** §1.2 on the signed artifact; preserves OQ-80 Option B hand-over,
  G2 adjacency and the current reduction measurements.
- **Costs:** the version model gains a second instant. `effectiveWindow`,
  `governsUntil`, `continuationBaselineFor` (adjacency) and `renewal-gap` must be
  redefined against the _effective_ start, and `not-yet-valid` gains a real,
  common case (an issued-but-not-yet-governing renewal). This is the largest
  engineering change of the four options and touches the deterministic
  precedence core.
- **Consistent with the Owner-side slice already implemented:** the Owner app
  records `activationValidFrom` as the issuance day
  ([implementation record](pdr-18-contract-and-activation-dates-implementation.md)),
  which is precisely the artifact-side date this option needs. (The Owner field
  named there is `recordedOn`, the day the observation was recorded — it is
  deliberately **not** presented as the license's issuance date.)

### Option 3 — Renewals are issued at/after expiry only; start = issuance day

No pre-expiry renewal. A renewal is issued on or after the predecessor's
coverage end and starts that day.

- **Satisfies** §1.2 with the smallest model change (no second instant).
- **Costs:** removes the Owner's ability to pre-issue a renewal so it activates
  at expiry — an operational regression against the documented flow — and every
  delay past the expiry instant still becomes a post-gap recovery (3.2), because
  the start is strictly after the coverage end.

### Option 4 — Scope §1.2 to first issuance/activation; renewals keep today's model

Read §1.2 as governing the **first** activation of a license ("At license
issuance, activation validity starts on the current issuance day"), leaving the
approved future-dated successor of OQ-80 Option B intact for renewals.

- **Preserves** the version model, the vectors and the documented CLI flow
  exactly; zero engineering risk to the precedence core.
- **Costs:** §1's temporal bullet ("a signed artifact that claims either is
  rejected") then needs an explicit carve-out for successor documents, or it
  contradicts this reading. That is the ambiguity OQ-88 records, and only the
  Product Owner can resolve which reading is authoritative.

## 5. Invariants that must hold under every option

1. `evaluateImportConflicts` remains the **single** conflict authority, evaluated
   as a read-side pre-check and again inside the import transaction under the
   per-installation lock. No option introduces an import path that bypasses it.
2. `overlapping-range`, `renewal-gap`, `backdated-supersession` and
   `post-gap-recovery-requires-dedicated-operation` remain refusals. Overlap and
   gap controls are not relaxed to make an issuance rule fit.
3. §8.6 reduction-conflict controls (rules 6b/6c, L-04/L-05/L-07) stay in force,
   including the dedicated reduction-resolution operation and the rule that a
   signed `supersedesOperationId` is never a resolution.
4. **Already-signed artifacts keep verifying.** Any new issuance rule must apply
   to _newly issued_ documents only — for example through a format/key marker —
   and must never be introduced as a retroactive condition in VLIC2
   verification. Rejecting a future start at verification would invalidate the
   committed vectors and any license already issued today. This is why no such
   rule was added in the PDR-18 §1 slice.
5. `issuedAt` never becomes an input to precedence. (Already true — V1 — and it
   must stay true: "no override of the governing version by issuance timestamp".)
6. **No C11 path.** No interior/backdated gap-fill mechanism is introduced under
   any option; PDR-18 §2 stands.

## 6. Engineering recommendation (not a decision)

Engineering recommends **Option 2**, because it is the only option that satisfies
§1.2 on the artifact the Owner actually issues without (a) destroying term the
customer already paid for, or (b) reclassifying ordinary late renewals as
post-gap recoveries. Its cost is real and concentrated in the deterministic
precedence core, so it should be designed as its own slice with its own
traceability, not folded into another change.

If the Product Owner prefers the smallest possible change, **Option 4** is the
safe interim: it preserves every approved control and asks only for an explicit
carve-out in §1's temporal bullet. **Option 1 and Option 3 are not recommended**
without an explicit decision about the truncated term and about late renewals
becoming recovery operations.

**This is a recommendation only. No option is implemented, and none may be
treated as decided until the Product Owner answers OQ-88.**

## 7. What this document does not do

- It changes no runtime behaviour, no migration, no vector and no test.
- It does not weaken, add or remove any conflict control.
- It does not close OQ-88 or any other open question; it supplies the proposal
  PDR-18 §1 asks engineering to produce so that the question can be answered.
- It makes no claim that the recommended option is compatible with the
  precedence core beyond the analysis above; a choice must be followed by a
  design slice with its own tests before any code changes.
