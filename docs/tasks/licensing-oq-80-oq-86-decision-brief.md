# Decision brief — OQ-80 (overlapping / gapped versions) and OQ-86 (backdated supersession)

| Field | Value |
| --- | --- |
| Date | 2026-10-11 |
| Status | **Decision brief. No decision is taken here.** OQ-80 **OPEN**; OQ-86 **OPEN**. |
| Decider | Product Owner. The implementation agent does not decide product policy. |
| Related | `docs/tasks/licensing-post-merge-reconciliation.md` (F-3, F-4, F-8); `docs/licensing/version-model-and-file-exchange.md` §3.3–§3.5; ADR-0046 Decisions 4 and 5; PDR-11 §3.2, §3.4, §8.6, §9, §15 PQ-5. |

---

## 1. What the approved texts settle, and what they leave open

| Source | Settles | Leaves open |
| --- | --- | --- |
| PDR-11 §3.2 | A **future-dated renewal** is retained and takes effect on its start date; the current version keeps governing until then. | Nothing about overlap with the governing version. |
| PDR-11 §3.4 | Which version governs at an instant follows the validity dates. | **"How overlapping or gapped versions are resolved is OPEN" (PQ-5 → OQ-80).** |
| PDR-11 §8.6 | Before applying a reducing or changed version: check, explain, preserve, require explicit resolution where capacity is involved, never destroy. | The algorithm (design item, §16); whether a reducing version is applied at once or held. |
| PDR-11 §2.1 | A license is bound to one customer and one installation. | Whether an installation can change customer (F-4 / Q4). |
| ADR-0046 Decision 4 | Governance is decided by `governs_until` (eligibility); `superseded_at` does not influence evaluation; **effective windows are pairwise disjoint after every import.** | Whether a *backdated* document may retire a version from an instant that has already passed (OQ-86). |
| ADR-0046 Decision 5 | Gaps are allowed and report the installation as `expired` until the next version starts. | Whether a gap should be covered by a grace period (depends on OQ-45, undecided). |

**Implemented interim behaviour (technical, fail-closed; not a product decision):** rules 1–6 of `evaluateImportConflicts` (`license-version.ts`), the single conflict authority, evaluated on the read-side pre-check and again under the installation row lock.

## 2. Verified current behaviour, scenario by scenario

Dates are illustrative. "Verified" means executed in this session or in a named suite; "code reading" means derived from the rule and not run separately.

| # | Scenario (candidate `C`, retained `R`, import instant `T`) | Current result | Evidence |
| --- | --- | --- | --- |
| S1 | **Early renewal, overlapping, no supersession.** R = 2026-01-01 → 2027-01-01 (governing at T = 2026-11-15). C = 2026-12-01 → 2028-01-01. | **Refused**: 409 `overlapping-range`, nothing written. | `license-import.service.spec.ts` "rejects an overlap that has no explicit supersession and writes nothing"; live. Verified. |
| S2 | **Early renewal with an explicit signed supersession.** C names R's operation id, C.validFrom = 2026-12-01. | **Accepted.** R's `governs_until` = 2026-12-01; R governs until then, C from then. | "applies a supersession whose hand-over is the import instant itself"; "lets exactly one of two concurrent successors retire a version" (live). Verified. |
| S3 | **Gap.** R ends 2027-01-01; C starts 2027-02-01. | **Accepted.** Between 2027-01-01 and 2027-02-01 the installation reports `expired` (restricted mode is PDR-11 §9; enforcement is not implemented). | "allows a gap and reports the installation as expired until the next version". Verified. |
| S4 | **Backdated supersession.** R governs from 2026-01-01 (open-ended). At T = 2027-01-15 a signed C retires R with C.validFrom = 2026-06-01. | **Refused**: 422 `backdated-supersession`, nothing written, operation id not retained (the document can be re-issued). | "refuses a successor that would hand over before the import instant" (service unit, pinned clock). Verified at unit level. |
| S5 | **Backdated non-superseding document in a period a retired version governed (Gap C).** R = 2026-01-01 → open, superseded by S with hand-over 2026-12-01. At T = 2027-01-15 a signed N = 2026-03-01 → 2026-06-01 is imported without naming a supersession. | **Accepted.** The as-of read for 2026-04-01 reports **`ambiguous`** (R and N both cover it). The API's current-state read uses "now", so the ambiguity is not visible through today's endpoints. | Scratch spec on the unfixed code (deleted): accepted; `resolveEffectiveVersion(2026-04-01)` → `ambiguous`. Code reading: `overlappingVersions` considers only versions still eligible at T, so a document that covers the present or the future is refused. **This contradicts the pairwise-disjoint wording of ADR-0046 D4**, and the unit test "never counts a superseded version as an overlap" pins the implemented rule. |
| S6 | **Legacy `VLIC1` code replacing a still-governing version.** The legacy default window starts in 2020, so the code cannot replace a version that governs now. | **Refused** under the backdated rule (documented in OQ-86 consequence (a)). | "refuses a legacy replacement while the version it overlaps still governs". Verified. |
| S7 | **Document that retires nothing and fills a past gap** (for example a late renewal covering a lapse, dated in the past, with no overlap). | **Accepted** (the gap rule); the period becomes covered retroactively. | Code reading from the gap rule and the "retires nothing" branch (`supersedes: null`). Not run as a separate scenario. |

## 3. OQ-80 — overlapping or gapped subscription windows

**Question (PDR-11 PQ-5):** when a document's window overlaps a version that still governs and the document does not name it, which version governs? And what may the customer do during a gap?

| Option | What happens | Consequences | Needs |
| --- | --- | --- | --- |
| **A. Keep the interim refusal** (status quo, S1). Overlap is refused unless the signed document names the predecessor; gaps are allowed and report `expired`. | No silent change of entitlements or capacity. Every early renewal must be issued with an explicit supersession. | Safe and auditable. Operationally, early renewals need the predecessor's operation id, so the issuing process must track it. A customer with an unexpected overlap gets a refusal, never a silent change. | Nothing new in code. Owner confirmation. |
| **B. Later start governs at the overlap** (implicit hand-over at the new `validFrom`). | The predecessor's entitlements and capacity stop silently on the new start date. | Conflicts with PDR-11 §8.6 (check and explain **before** a reducing version is applied). Would need a preview or a confirmation step. New audit semantics for an implicit retirement. | Owner decision; §8.6 algorithm; likely an ADR addendum. |
| **C. Stacking during overlap** (the union of modules and the maximum of capacities apply while two versions overlap). | Capacity and modules are granted from both windows at once. | Commercial over-grant risk. The Owner must define how user limits add or max. Does not answer which version governs when they disagree. | Owner commercial decision; a precedence or arithmetic rule in `resolveEffectiveVersion`. |
| **D. Retain the overlapping renewal and hand over at the predecessor's end** (`validUntil`, not the successor's start). | The successor's entitlements begin only when the predecessor ends. The successor's `validFrom` is ignored for hand-over. | No early loss of entitlements. The customer may pay for days that do not yet govern. Changes the meaning of `validFrom` for overlapping documents. | Owner decision; a new eligibility rule and tests. |

**Gap sub-question (OQ-80 / PDR-11 §3.4):**

| Gap option | Consequences |
| --- | --- |
| **G1. Allow gaps; report `expired`** (status quo, S3). | Restricted mode applies in the gap (PDR-11 §9). A late renewal takes effect on arrival. Simple and matches ADR-0046 D5. |
| **G2. Refuse a renewal that leaves a gap** (must start at or before the predecessor's end). | A lapsed customer cannot import a renewal that starts after the lapse; the Owner must issue a new license instead, which conflicts with the continuity of the license (F-8). |
| **G3. Grace across a gap.** | Depends on OQ-45 (Grace duration, undecided). Not decidable now. |

## 4. OQ-86 — may a document retire a version from a past instant?

**Question:** a signed document whose start is before its import instant and that supersedes a version which already governed some of that period: may it rewrite that period? Also: the tolerance at the import instant, and whether as-of reads are a contract.

| Option | What happens | Consequences | Needs |
| --- | --- | --- | --- |
| **A. No retroactive supersession** (status quo for supersession, S4). | A past period cannot be corrected by supersession. The only fixes are a forward-dated supersession or a gap-filling document. | A past mistake (for example, too short a term given to a customer) cannot be corrected in the history; compensation must be handled outside the license. Keeps the history a record of what governed. | Nothing new. |
| **B. Retroactive supersession with a separately recorded retro instant.** | The history records *when* the change was recorded and *from when* it applies retroactively. As-of reads must state which view they answer. | Schema change (a second instant or a correction record) → migration and rehearsal. As-of reads become a contract (OQ-86 consequence (b)). Retroactive changes must be audited as corrections. Largest change. | Owner decision; ADR-0046 addendum; migration; live tests. |
| **C. Conform to ADR-0046 D4: effective windows stay pairwise disjoint after every import, including retired history** (closes Gap C, S5). Gap-filling (S7) stays allowed. | A backdated non-superseding document that overlaps any past governed window is refused (409 `overlapping-range`, or a new reason, to be ratified). Past governance can never be rewritten, and no `ambiguous` as-of answer can arise. | Some documents accepted today would be refused, including those that only *appear* to be corrections. The legacy `VLIC1` default window (2020) would need an explicit start. Smallest change that matches the approved ADR text; no schema change. Behaviour change → Owner ratification, because OQ-86 asks precisely this. | Owner decision; a rule in `evaluateImportConflicts`; tests for S5, S7; the existing test "never counts a superseded version as an overlap" would be changed deliberately. |
| **D. Legacy `VLIC1` path.** Keep refusing replacement of a still-governing version (status quo), or allow it only through an explicitly signed document. | Status quo keeps the legacy path unusable for early replacement. Requiring a signed document moves the legacy path onto the same rules as S2. | Operational: the legacy code cannot replace a governing version at all today. | Owner decision on whether legacy activation must stay usable for early renewals. |

**Tolerance sub-question:** a start a few microseconds before the import instant is refused as backdated (strict). A tolerance window would need a value, which overlaps with clock-rollback thresholds (OQ-76, undecided). Recommend deciding OQ-76 first, or keeping strict.

**As-of sub-question:** `ambiguous` is returned only by the domain function `resolveEffectiveVersion`; no endpoint answers "which version governed then". Decide whether as-of reads are a contract (then Option B or C is needed for a clean answer) or a recomputation (then Option A is sufficient).

## 5. Related questions the Owner must answer with these

**Q3 — Renewal identity (F-8).** Does a renewal keep the same `licenseId` (license continuity, so the customer-binding rule applies to every renewal) or does each renewal get a new license? The issuer CLI always generates a new `licenseId` and cannot target an existing one, so the current tooling already behaves as "new license per renewal".

**Q4 — Installation customer change (F-4).** An applied import overwrites the installation's `customerId`, including when the new license names another customer. Can an installation change customer through a new license (a transfer), and if so, should that require an explicit, audited action?

## 6. Engineering view (not a decision)

- **OQ-80:** keep **Option A + G1** until a commercial early-renewal workflow exists. Choose **D** if early renewals must work without a manual supersession. Choose **C** only with a commercial rule for stacking.
- **OQ-86:** **Option C** is the smallest change that matches the approved ADR text, needs no schema change, and closes the only observed inconsistency (S5). It rejects some documents accepted today, so it needs ratification. **Option B** is the only path to retroactive corrections and is a schema change.
- **Order:** decide OQ-76 (clock thresholds) before any tolerance; decide Q3 before any capacity slice (L-04), because capacity depends on which license governs.

## 7. Decision record (for the Product Owner to complete)

| Item | Decision | Date | Decider |
| --- | --- | --- | --- |
| OQ-80 overlap policy | [ ] A  [ ] B  [ ] C  [ ] D  [ ] other: ______ | | |
| OQ-80 gap policy | [ ] G1  [ ] G2  [ ] G3 (after OQ-45)  [ ] other: ______ | | |
| OQ-86 retroactive supersession | [ ] A  [ ] B  [ ] C  [ ] other: ______ | | |
| OQ-86 legacy `VLIC1` replacement | [ ] status quo  [ ] signed-only  [ ] other: ______ | | |
| OQ-86 tolerance at the import instant | [ ] strict  [ ] tolerance: ____ (after OQ-76) | | |
| OQ-86 as-of reads | [ ] recomputation  [ ] contract (requires B or C) | | |
| Q3 renewal identity | [ ] same `licenseId`  [ ] new license per renewal | | |
| Q4 installation customer change | [ ] not allowed  [ ] allowed, audited  [ ] other: ______ | | |
| Ratify reason `license-binding-conflict` (report §9) | [ ] yes  [ ] rename: ______ | | |

**Consequences of any decision:** each option changes `evaluateImportConflicts` and/or `resolveEffectiveVersion`, and each needs the tests named in §2 to be updated or added. Option B also needs a migration and rehearsal. No option can be implemented before the Owner records it in this table and in `docs/open-questions.md`; the implementation agent will not close either question on its own.
