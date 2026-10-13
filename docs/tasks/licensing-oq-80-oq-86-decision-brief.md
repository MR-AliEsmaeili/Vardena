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
| OQ-80 overlap policy | **[x] B** (the later starting version governs in the overlap) | 2026-10-12 | Product Owner |
| OQ-80 gap policy | **[x] G2** (a renewal that would leave a gap is refused) | 2026-10-12 | Product Owner |
| OQ-86 retroactive supersession | **[x] C** (finite, deliberate tolerance: the candidate is checked against the full retained effective history, retired windows included) | 2026-10-12 | Product Owner |
| OQ-86 legacy `VLIC1` replacement | **[x] status quo** (the L-02 restriction is preserved; no bypass) | 2026-10-12 | Product Owner |
| OQ-86 tolerance at the import instant | **[x] strict** (no tolerance window) | 2026-10-12 | Product Owner |
| OQ-86 as-of reads | **[x] recomputation** from the retained records (no historical-query contract) | 2026-10-12 | Product Owner |
| Q3 renewal identity | **[x] same `licenseId`** (a renewal is the same license) | 2026-10-12 | Product Owner |
| Q4 installation customer change | **[x] allowed, audited** — only as an explicit, authorized operation, never inferred from a document | 2026-10-12 | Product Owner |
| Ratify reason `license-binding-conflict` (report §9) | **[x] yes** — name, HTTP 409, no state written | 2026-10-12 | Product Owner |
| OQ-87 post-gap recovery | **[x] Option B** — a NEW license identity may cover a lapse for the same customer + installation ONLY through a dedicated, explicitly authorized, audited recovery operation with a required reason; ordinary import is never a recovery path (**PDR-13**, decision id **OD-LIC-02**) | 2026-10-12 | Product Owner |

**Consequences of any decision:** each option changes `evaluateImportConflicts` and/or `resolveEffectiveVersion`, and each needs the tests named in §2 to be updated or added. Option B also needs a migration and rehearsal. No option can be implemented before the Owner records it in this table and in `docs/open-questions.md`; the implementation agent will not close either question on its own.

## 8. Recorded decisions — exact choices, consequences and one blocked dependency

**Recorded 2026-10-12 by the Product Owner (this section is the record; the decision-maker is the Product Owner, the recorder is the implementation agent).** Nothing below closes an open question on its own: the statuses stay separate — *decision recorded* · *implementation recorded* · *tests passed locally* · *CI verified on the exact commit* · *Owner acceptance*.

### 8.1 OQ-80 — Option B (overlap) and G2 (gap)

- A signed document that overlaps exactly one retained version **still governing at the import instant** and starts **later** than it takes that version over at its own `validFrom`. The predecessor stops governing exactly there (`governs_until = successor.valid_from`); nothing is stacked, nothing is deleted, no capacity is added, and the hand-over is stamped and audited (`license.version.superseded`, `reason: 'implicit-precedence'`).
- A candidate that starts **at or before** the version it overlaps cannot take precedence and is refused (`overlapping-range`, 409, nothing written). A candidate that would overlap **more than one** still-governing version is refused rather than guessed.
- **G2:** a candidate carrying the identity of a retained license (same `licenseId`) may not start later than that license's retained coverage end (`renewal-gap`, 409, nothing written). Adjacency — `previous.validUntil == next.validFrom` — is contiguous, not a gap, and `validUntil: null` (perpetual) never gaps.
- Commandments preserved: no entitlement, module or capacity is stacked; the installation + customer binding checks are unchanged; no new `licenseId` is minted to dodge a refusal; the legacy `VLIC1` path keeps its documented L-02 lifecycle rules and gains no bypass.

### 8.2 OQ-86 — Option C (retired history counts)

- Overlap is evaluated against the **effective window** `[validFrom, min(validUntil, governsUntil))` of **every** retained version, retired versions included. A document that lands inside a window a version has already governed is refused (`overlapping-range`, 409, nothing written) — this closes the previous Gap C where a retired version was excluded from the overlap check.
- A gap-filling document that overlaps nothing, and a correction of a version that had already ended when it is contiguous with its predecessor, stay allowed.
- The temporal rule is unchanged: a supersession (explicit or the implicit hand-over of §8.1) whose hand-over would remove governance the predecessor already exercised before the import instant is refused (`backdated-supersession`, 422, nothing written, operation id unused). Only a *deliberate* Owner change can lift it.
- As-of reads stay a **recomputation** from the retained records; no historical-query API, no stronger public contract claim. Strict tolerance stays: no window around the import instant.
- No legacy `VLIC1` bypass was introduced; import-time tolerance was not widened.

### 8.3 Q3 — renewal identity is the same `licenseId`

The identity of a license is stable across its renewals, so the license-identifier binding (one license → one installation → one customer) governs every renewal. The issuer tooling must therefore be able to target an existing `licenseId`; today `issue-development-license.ts` parses no `--license-id` and `buildLicensePayload` falls back to a fresh ULID (finding F-8). **The decision is recorded; the tooling change is not part of this slice and remains an open follow-up.**

#### 8.3.1 Superseded (2026-10-13, Product Owner decision — recorded, not amended)

**The Q3 decision above is superseded.** The Product Owner has removed the
requirement to preserve the previous `licenseId` during renewal: a newly issued
license must remain bound to the same intended customer and the same customer
code, and a changed `licenseId` must not bypass customer binding, installation
binding, retained history, version precedence, capacity/entitlement reduction
controls, replay protection, or audit requirements. `--license-id` must **not**
be implemented merely to force reuse of the old identifier, so the tooling
follow-up recorded in §8.3 is **withdrawn, not owed**.

This note supersedes only the identity-continuity requirement. The audit that
establishes what a new identity may do (ordinary contiguous renewal: allowed,
same customer required, everything else unchanged) and the one exact gap it
found — the §8.6 reduction control does not execute for a successor that retires
nothing — are recorded in
[`docs/tasks/licensing-po-acceptance-audit-2026-10-13.md`](licensing-po-acceptance-audit-2026-10-13.md)
§4. The old text above is preserved as the record of what was decided on
2026-10-12; it is not rewritten.

### 8.4 Q4 — customer transfer is an explicit, audited operation

- An ordinary import may never change the installation's commercial customer: a document naming a different customer is refused (`installation-customer-mismatch`, 409, nothing written).
- A customer change happens **only** through the dedicated, permission-gated, explicitly authorized transfer operation (`Licensing.Installation.TransferCustomer`), which carries the intent, audits the old and new customer, the installation, the operation, the actor/source and the instant as the typed `license.installation.customer-transferred` event, and is atomic with the binding write.
- A transfer request that names the customer the installation already has is refused (`transfer-not-applicable`, 409, nothing written), so a repeat or a concurrent duplicate cannot silently re-apply. The cross-installation conflict protection is unchanged.
- **Contract note for the Owner:** the signed document payload carries no field that could express transfer intent, and none was added; the intent is produced by the dedicated operation, not inferred from the document. A future field would be a signed-payload contract change with its own migration/test consequences and is **not** part of this slice.

### 8.5 `license-binding-conflict` — ratified

The refusal name, its HTTP class (409) and the "nothing is written" guarantee are ratified as recorded (report §9): the identifier belongs to exactly one installation and one customer, claimed by a plain `INSERT` under the installation row lock, so a loser gets the documented conflict instead of a database error or a silent re-application.

### 8.6 ANSWERED (2026-10-12) — post-gap recovery is Option B

The Owner's G2 decision answers *a renewal may not leave a gap*. Q3 answers *a renewal keeps its `licenseId`*. Neither answered the follow-on: **may a NEW license identity be issued for the same customer + installation after a lapse, to cover the gap?** The pre-decision brief assumed a new license could be issued, but that assumption was never decided, and the two decisions above made it visible (a lapsed license cannot be renewed under G2, so the only paths out of a lapse would be a new identity or an explicit Owner exception).

- The question was registered as **OQ-87** in `docs/open-questions.md`.
- The implementation up to PR #141 deliberately **neither granted nor refused** it: a candidate carrying a new `licenseId` is not a renewal, so the gap rule did not evaluate it, and no other rule refused it. That was the pre-decision behaviour preserved, not a new policy.
- ~~**Blocked:** any workflow, documentation or capacity slice that *depends* on post-gap recovery (including describing a lapse as recoverable) must not be implemented or claimed until the Owner answers OQ-87. The L-04 capacity slice is gated on the whole decision set, so it stays behind the gate for this reason too.~~
- **DECIDED (Owner decision, 2026-10-12): Option B.** A new license identity may cover a lapse for the same customer + installation ONLY through a dedicated, explicitly authorized, audited recovery operation capturing a reason with traceable history; the ordinary license import is NOT a permitted post-gap recovery path. Recorded as **[PDR-13](../decisions/product/PDR-13-post-gap-recovery.md)** (decision id **OD-LIC-02**; OQ-87 row and the registry log updated). The same decision unblocks **L-04** (PDR-11 §8.6), which is implemented in the same change: usage-aware reduction conflicts (`reduction-requires-resolution` with a structured explain payload, 409, nothing written) and the dedicated `reduction-resolution` operation. The gate above is lifted for exactly this answer; nothing else in the decision set changed.

### 8.7 PDR-11 §8.6 — precedence is not permission

Option B decides **which version governs** at an overlap. It is not a permission to apply a reduction: PDR-11 §8.6 still requires a reducing or changed version to be checked against current usage, explained to the operator, preserved, and **explicitly resolved** before it is applied. That flow is the L-04 slice and does not exist yet, so the import fails closed while the retained grant shrinks (`reduction-requires-resolution`, 409, nothing written: a smaller organization/user limit, or a removed entitlement).

**Review fix on PR #141 (2026-10-12): an explicit signed supersession is not a bypass.** The guard above was first applied only to the implicit hand-over, so a document carrying `supersedesOperationId` could reduce `organizationLimit`, reduce `userLimit` or remove an entitlement without passing through it. That is closed: the capacity/entitlement guard now runs on **every** path that retires a version — the explicit signed supersession, the implicit hand-over of OQ-80 Option B, and the legacy `VLIC1` replacement. Naming the version to retire proves **which** version the document replaces; a signed document cannot know how many users or organizations exist, so it is not the resolution §8.6 requires and it may not switch the guard off. Increases and identical grants are untouched, and a document that retires nothing (a first license, a gap-filling renewal, a new license identity) is unaffected.

**The term dimension — decided by the Owner (2026-10-12), no longer an interim reading.** Closing an **open end** (a perpetual version handed over to a time-limited one) is refused as a reduction only where the document does **not** name the version it retires (the implicit hand-over of Option B and the legacy `VLIC1` replacement); an explicit signed supersession that names it may make that term change, subject to strict non-reduction of `organizationLimit`, `userLimit` and the granted entitlements. The Product Owner's final decision — *an explicit, valid, signed supersession may convert a perpetual grant into a time-limited one, and that is the only change it authorizes; capacity and entitlement reductions must still be rejected on every path* — is recorded as **[PDR-12](../decisions/product/PDR-12-license-term-supersession.md)** (decision id **OD-LIC-01**) and implemented in PR #141. The capacity/entitlement arms run on the explicit path exactly like the others. L-04 still owes §8.6's check/explain/preserve/explicit-resolution flow to every path; until it exists, a capacity or entitlement reduction is refused rather than resolved.
