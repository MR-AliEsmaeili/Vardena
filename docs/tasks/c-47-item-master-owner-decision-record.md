# C-47 — Inventory Item Master: Owner Decision Record (OD-C47-01…04)

| Field | Value |
|---|---|
| Status | **READY FOR REVIEW — NOT ACCEPTED** (this record states Owner *decisions*; it is not an Owner acceptance of any PR, task or implementation) |
| Date | 2026-10-02 (UTC) |
| Type | Governance / decision record (documentation only) |
| Inspection baseline | `main` @ `4cf481efa2de5ca9863d9d434c2ab707de23301a` (merge of PR #107) |
| Production code changed | **NONE** — no source, Prisma schema, migration, API, generated type, permission or test file is touched by this record |
| Parent candidate | `docs/roadmap/future-task-candidates.md` row **C-47 — Product/item master completion** |
| Companions | [c-47-item-master-preflight-investigation.md](./c-47-item-master-preflight-investigation.md) (PR #106) · [c-47-item-master-readiness-hardening-report.md](./c-47-item-master-readiness-hardening-report.md) (PR #107) · [PDR-01](../decisions/product/PDR-01-item-barcode-policy.md) · [open-questions.md](../open-questions.md) |

> **Reading rule.** Each decision below records *exactly* what the Owner
> decided and *exactly* what it does not decide. Per AG-09/AG-17 and
> `STATE.md` §6, nothing adjacent is inferred: an Open Question stays OPEN
> unless the decision text itself answers it. Implementation evidence is cited
> so the gap between "decided" and "implemented" is visible, never silently
> closed.

---

## 0. Decision index

| ID | Subject | Registry entry | Owner decision | Resulting registry status |
|---|---|---|---|---|
| **OD-C47-01** | Quantity precision and conversion semantics | **OQ-29** | **Option A — DECIDED** | OQ-29 **remains OPEN**, substantially narrowed |
| **OD-C47-02** | Item taxonomy and capability extension governance | **OQ-33** | **Option D — DECIDED** (Option A explicitly **NOT** approved) | OQ-33 **remains OPEN** — taxonomy/capability confirmation not given |
| **OD-C47-03** | Item barcode policy | *(no prior OQ id)* → **[PDR-01](../decisions/product/PDR-01-item-barcode-policy.md)** | **Option A — DECIDED / CONFIRMED** | PDR-01 **Decided**; lifecycle residue registered as **OQ-65 (OPEN)** |
| **OD-C47-04** | Item deletion eligibility | **OQ-36** | **Option C — DECIDED** | OQ-36 **remains OPEN** — code-reuse semantics unanswered |

**None of these decisions authorizes implementation.** Each is a policy input
to a future, separately admitted, bounded task (see §6).

---

## 1. OD-C47-01 — OQ-29 quantity precision and conversion: **Option A**

### 1.1 Decision text (as given by the Owner)

1. Fixed quantity precision: **four fractional decimal places**.
2. Conversion results that cannot be represented **exactly** at the supported
   precision are **rejected**.
3. **No rounding and no silent truncation.**
4. Conversion-factor changes must use **effective-dated versions**.
5. Historical conversion versions **and the data needed to interpret prior
   transactions** must be preserved.

### 1.2 What this closes

| # | Sub-question of OQ-29 | Closed by OD-C47-01 |
|---|---|---|
| S-1 | Is quantity precision fixed, or per unit? | **Closed — fixed.** Four fractional decimals is the single supported quantity precision. A per-unit precision concept (OQ-29 option B in the hardening report §6) is therefore not the decided model. |
| S-2 | What is the rounding rule for a fractional conversion whose exact result does not fit? | **Closed — there is none.** The result is rejected; rounding and truncation are both forbidden. |
| S-3 | May conversion factors change over time, and how? | **Closed — only through effective-dated versions.** |
| S-4 | What happens to history when a factor changes? | **Closed — prior versions and the data needed to interpret prior transactions are preserved.** |

### 1.3 What this explicitly does **not** close (OQ-29 stays OPEN)

These are independent sub-questions of the registry text or direct
consequences that the decision does not speak to. They are **not** inferred
from Option A:

- **U-1 — global vs item-specific scope.** The registry question "which
  conversions are global vs item-specific" is untouched. The current
  implementation also applies an unapproved **precedence rule** (an
  item-specific version wins over a global version for the same pair at the
  same instant) — behaviour, not policy.
- **U-2 — conversion-factor precision.** Quantity precision is fixed at 4
  decimals; the *factor's* own scale (today `numeric(18,6)`) is not decided,
  nor whether a factor may be expressed more precisely than it can be applied.
- **U-3 — magnitude bound.** The 14 integer digits implied by
  `numeric(18,4)` are implementation, not a stated Owner limit.
- **U-4 — derived/reverse pairs.** Whether a reverse pair may ever be derived
  by division is unanswered; division would need a rounding rule that this
  decision explicitly withholds. (Today nothing is derived.)
- **U-5 — where the rejection boundary applies.** Decided for conversion
  results; it is not stated whether the same exactness gate governs document
  entry, import, opening balances, transfers or report aggregation.
- **U-6 — correction of a wrong factor version.** Effective dating forbids
  in-place edits; no corrective producer, retraction or supersession-of-a-
  mistake path is decided or implemented.
- **U-7 — display vs storage.** Whether a UI/report may display fewer
  decimals than are stored is not addressed.
- **U-8 — monetary/valuation rounding.** Out of scope of OQ-29 entirely; it
  remains with **OQ-24** (valuation/costing) and **OQ-30** (tax). This
  decision is quantity-side only and must not be cited for money.

### 1.4 Implementation evidence (verified on the baseline SHA)

| Decision clause | Evidence path | Observed state |
|---|---|---|
| 4 fractional decimals | `backend/src/modules/inventory/domain/quantities.ts` (`QUANTITY_FRACTION_DIGITS = 4`, `QUANTITY_INTEGER_DIGITS = 14`, `ENTERED_QUANTITY_PATTERN`) | **Matches the decision** |
| Storage scale | `backend/prisma/schema/inventory.prisma` — `quantity`/`baseQuantity`/`onHand`/`reservedQuantity` `@db.Decimal(18, 4)`; `factor`/`conversionFactor` `@db.Decimal(18, 6)` | **Matches** for quantity; factor scale is U-2 (undecided) |
| Reject, never round | `quantities.ts` `fitsQuantity` + header note "Rounding policy (OQ-29): there is none"; applied at `backend/src/modules/inventory/application/inventory-posting-support.ts` (`fitsQuantity(baseQuantity)` gate) | **Matches the decision** |
| Effective-dated factor versions | `backend/src/modules/inventory/domain/unit-conversion.ts` (half-open `[validFrom, validTo)`, `resolveVersionAt`); `backend/src/modules/inventory/data/unit-conversions.repository.ts` (advisory-locked plan/close/insert); no edit endpoint — `Inventory.UnitConversion.{View,Create}` only, `backend/src/modules/inventory/domain/inventory-permissions.ts` | **Matches the decision** |
| History preserved / prior transactions interpretable | movement rows snapshot entered `quantity`, `unitId`, `baseUnitId`, `baseQuantity` **and** `conversionFactor` — `backend/prisma/schema/inventory.prisma` `InventoryMovement`; backdated resolution proven by `backend/test/item-master-live.e2e-spec.ts` (live case 5) | **Matches the decision** |

Regression coverage that pins the decided behaviour:
`backend/src/modules/inventory/domain/quantities.spec.ts`,
`backend/src/modules/inventory/domain/unit-conversion.spec.ts`,
`backend/src/modules/inventory/application/inventory-posting-support.spec.ts`,
`backend/src/modules/inventory/application/unit-conversions.service.spec.ts`,
`backend/test/item-master-live.e2e-spec.ts` (live cases 3, 4, 5, 6, 7).

### 1.5 Consequence

The previously *unapproved interim* fail-closed behaviour is now the
**approved rule** for the clauses in §1.2. No code change is required to
comply with §1.2, and therefore **no implementation follow-up is created by
OD-C47-01 alone**. The residual items U-1…U-8 keep OQ-29 OPEN.

---

## 2. OD-C47-02 — OQ-33 item taxonomy and capabilities: **Option D**

### 2.1 Decision text (as given by the Owner)

New item **kinds** or **capability flags** may be introduced **only** when a
concrete need has been identified and accepted through the project's
decision/governance process.

### 2.2 Explicit negatives recorded by the Owner

- **Option A is NOT approved.** It must not be recorded as approved anywhere.
- The Owner **has not confirmed** that the existing **eight item kinds**
  (`goods`, `service`, `consumable`, `asset`, `raw_material`,
  `semi_finished`, `finished_good`, `other`) and the current **per-item
  configurable capability model** are accepted without change.
- That confirmation is **OPEN**.

### 2.3 What this closes

| # | Sub-question | Closed by OD-C47-02 |
|---|---|---|
| S-5 | Under what conditions may the kind list or the capability-flag set be extended? | **Closed — extension governance.** A concrete, identified need accepted through the decision/governance process is a precondition. Speculative, convenience or inference-driven additions are forbidden. |

### 2.4 What stays OPEN under OQ-33

- **Completeness of the eight-kind list** — explicitly unconfirmed (§2.2).
- **The capability model itself** — whether all seven flags
  (`is_stockable`, `is_purchasable`, `is_sellable`, `is_valued`,
  `requires_lot`, `requires_serial`, `requires_expiry`) remain per-item
  overridable, or whether some become kind-mandatory / kind-forbidden /
  organization-level (the hardening report's Option B territory).
- **Per-kind defaults**, including the defaults recorded in code as
  *assumptions* for `raw_material`, `semi_finished`, `finished_good`, `other`
  and the asset/serial tension — `backend/src/modules/inventory/domain/item-kind.ts`
  states these are recorded assumptions under OQ-33, **not** approval.
- **Kind immutability after creation** (current behaviour; unapproved).
- **Item-group cardinality** — one optional group per item today; no
  many-to-many model is authorized or rejected.
- **Downstream lot/serial/expiry semantics** — only the master flags exist;
  no lot/serial/expiry entities, validation or movement behaviour is decided.

### 2.5 Implementation evidence

| Subject | Evidence path | Observed state |
|---|---|---|
| Closed kind list (8 values), code-defined, text column | `backend/src/modules/inventory/domain/item-kind.ts`; `backend/prisma/schema/inventory.prisma` (`itemKind String @db.VarChar(24)`) | Present; **unconfirmed** by the Owner |
| Kind supplies creation defaults only; stored flags authoritative | `item-kind.ts` (`resolveCapabilities`), `backend/src/modules/inventory/application/items.service.ts` (`resolveCapabilities` called once at create) | Present; **unconfirmed** |
| Capability invariants (valued/lot/serial/expiry ⇒ stockable) | `backend/src/modules/inventory/domain/item-capabilities.ts` + `item-capabilities.spec.ts` | Present; **unconfirmed** |
| Extension requires a code change (not data) | `item-kind.ts` header: "Adding or renaming a kind is a deliberate code + migration change, never database-configurable data" | **Consistent with OD-C47-02's governance rule** |

### 2.6 Consequence

OD-C47-02 is a **governance constraint on future change**, not an acceptance
of the current model. **OQ-33 must not be marked resolved.** No kind, flag,
default or validation matrix may be added, removed or constrained on the basis
of this record.

---

## 3. OD-C47-03 — Item barcode policy: **Option A (confirmed)**

Full record: **[PDR-01 — Item barcode policy](../decisions/product/PDR-01-item-barcode-policy.md)**.

### 3.1 Decision text (as given by the Owner)

- A barcode is **optional**.
- Barcode **uniqueness is enforced within an organization**.
- **Two active items in the same organization must not have the same
  barcode.**
- **Different organizations may use the same barcode.**
- **Multiple barcode formats** are supported; **no strict symbology
  validation** unless separately approved.
- **No multi-barcode-per-item support** is introduced under this decision.
- **No production code or schema change** in this documentation task.

### 3.2 The lifecycle question that is deliberately left OPEN → **OQ-65**

The canonical wording constrains **two active items**. It does **not** state
what happens to a barcode that belonged to an item which is subsequently
**deactivated**. Whether that barcode may be reused by another item in the
same organization is **not answered and must not be inferred** from the
uniqueness rule — in either direction:

- reading "active-only" as *permitting* reuse would invent a business rule;
- reading "uniqueness" as *forbidding* reuse would contradict the decision's
  own "two active items" scope.

This and the other unresolved barcode-lifecycle details are registered as
**OQ-65** in `docs/open-questions.md` (see PDR-01 §6 for the full list:
reuse-after-deactivation, reactivation collision, normalization/comparison
semantics, enforcement authority, empty-string vs NULL, applicability to
non-stockable kinds, and any scan/lookup surface).

### 3.3 Implementation evidence — the decision is **NOT implemented**

| Decision clause | Evidence path | Observed state |
|---|---|---|
| Barcode optional, ≤64 chars, trimmed, empty ⇒ NULL | `backend/prisma/schema/inventory.prisma` (`barcode String? @db.VarChar(64)`); `backend/src/modules/inventory/domain/master-data.ts` (`MAX_BARCODE_LENGTH = 64`); `backend/src/modules/inventory/application/items.service.ts` (`normalizeOptional` + `assertOptionalText('Barcode', …)`) | **Matches** |
| Uniqueness within an organization (active items) | `backend/prisma/schema/inventory.prisma` — the only `Item` unique index is `uq_items_organization_id_code`; **no barcode unique index exists**. `items.service.ts` performs **no** barcode uniqueness pre-check and maps no barcode conflict. | **GAP — not enforced anywhere** |
| Different organizations may share a barcode | consequence of the absent constraint; also the intended end state | Trivially true today |
| No symbology validation | `backend/src/modules/inventory/api/dto/item.dto.ts` — only `@MaxLength(MAX_BARCODE_LENGTH)` | **Matches** |
| Single barcode per item | one nullable column; no alias table in `inventory.prisma` or migration `20260911010000_inventory_master_data` | **Matches** |
| Search surface | `backend/src/modules/inventory/data/items.repository.ts` — case-insensitive `contains` over code/name/barcode; `item.dto.ts` documents it | Present (unrelated to uniqueness) |

**Therefore:** PDR-01 creates a *real, bounded* implementation gap
(organization-scoped barcode uniqueness among active items is decided but
unenforced). Closing it needs a database-authoritative constraint and
therefore a migration — explicitly **out of scope here** (§6).

---

## 4. OD-C47-04 — OQ-36 item deletion and code reuse: **Option C**

### 4.1 Decision text (as given by the Owner)

- **Physical deletion is permitted only when the item has never been
  referenced by any operational, ledger or historical record.**
- **An item that has been referenced must not be physically deleted.**
- **Preserve history and organization-scoped identity constraints.**

### 4.2 What this closes

| # | Sub-question of OQ-36 | Closed by OD-C47-04 |
|---|---|---|
| S-6 | Must some master data be genuinely deletable? | **Closed for the Item** — yes, but only in the never-referenced case. |
| S-7 | What is the eligibility rule? | **Closed — "never referenced by any operational, ledger or historical record".** |
| S-8 | Is a referenced item deletable (soft or otherwise)? | **Closed — no.** A referenced item must not be physically deleted; history and organization-scoped identity constraints are preserved. |

### 4.3 What stays OPEN under OQ-36 — in particular **code reuse**

- **Code reuse after physical deletion of a never-referenced item is NOT
  decided.** Option C states a *deletion eligibility* rule; it says nothing
  about whether the freed code may be issued again. Per the Owner's explicit
  instruction this is **not** inferred from Option C and stays **OPEN**.
- **Code reuse after deactivation** (no deletion involved) — unchanged and
  still open; the registry's current posture is "codes … are never reused",
  recorded as the implemented state, not as an Owner rule.
- **Case sensitivity** of business-code comparison (`ABC` vs `abc`) —
  untouched (today case-sensitive by implementation).
- **Soft vs hard mechanics** — whether "physical deletion" means a hard
  `DELETE` or a `deleted_at` tombstone with a partial unique index, and
  whether unique indexes stay plain or become partial, is undecided.
- **Proof of "never referenced"** — which modules' references count, whether
  the check is FK-based, public-service-based or both, how it is made
  race-free, and what happens if a reference appears between check and delete.
- **Surface and authority** — whether a DELETE endpoint and an
  `Inventory.Item.Delete` permission are introduced at all, and who may hold
  them.
- **Scope beyond the Item** — OQ-36 is the repository-wide master-data
  lifecycle question. OD-C47-04 is stated for **the item**. It must **not**
  be read as deciding units, item groups, warehouses, parties, employees,
  accounts or detail items. For accounting dimensions,
  `docs/architecture/domain/master-data-strategy.md` §7.6 ("never delete —
  disable/archive only") is unchanged.

### 4.4 Implementation evidence

| Subject | Evidence path | Observed state |
|---|---|---|
| No deletion exists for Inventory master data | `backend/src/modules/inventory/domain/inventory-permissions.ts` ("No `*.Delete` anywhere: master-data lifecycle is `is_active`"); no `@Delete(` route in any `backend/src/modules/inventory/api/*.controller.ts` | **Decision not implemented** (no regression; the decision permits, it does not require) |
| Lifecycle is enable/disable | `backend/src/modules/inventory/application/items.service.ts` (`enableItem`/`disableItem`) | Present |
| Reference/freeze guards already exist | `items.service.ts` freeze seams (`existsForItem`, `hasBlockingBalanceForItem`), covered by `items.service.spec.ts` "freeze guards (guards firing)" and `backend/test/item-master-live.e2e-spec.ts` (live case 8) | **Relevant prior art** for an eligibility probe; it guards *mutation*, not deletion |
| Organization-scoped identity | `uq_items_organization_id_code` in `backend/prisma/schema/inventory.prisma` | Present; the decision requires preserving it |

---

## 5. Registry outcome (what changed in `docs/open-questions.md`)

| Entry | Before | After this record |
|---|---|---|
| OQ-29 | OPEN, no Owner decision | **OPEN — narrowed.** OD-C47-01 recorded; U-1…U-8 remain |
| OQ-33 | OPEN, no Owner decision | **OPEN.** OD-C47-02 recorded as extension governance only; taxonomy/capability confirmation explicitly withheld |
| OQ-36 | OPEN, no Owner decision | **OPEN — narrowed.** OD-C47-04 recorded; code-reuse semantics explicitly unanswered |
| OQ-65 | did not exist | **NEW — OPEN.** Barcode lifecycle, reuse and comparison semantics (created by PDR-01 §6) |
| PDR-01 | did not exist | **NEW — Decided.** Item barcode policy (Option A) |

No other registry row is altered. No ADR is promoted or demoted. `OQ-64`
remains the only Resolved entry.

---

## 6. Implementation consequences — nothing is authorized here

| Decision | Does it require production work? | If yes, what shape |
|---|---|---|
| OD-C47-01 | **No.** Current code already satisfies §1.2. | — (documentation of the now-approved rule only) |
| OD-C47-02 | **No.** It constrains future change. | — |
| OD-C47-03 | **Yes — a real gap.** Organization-scoped barcode uniqueness among active items is decided and unenforced. | A bounded follow-up: an application pre-check **plus** a database-authoritative constraint (hence a Prisma migration), conflict mapping, OpenAPI/DTO text, and concurrency coverage in the existing live-PG suite. **Blocked until OQ-65 is answered** — the exact index predicate depends on whether a deactivated item's barcode is reusable. |
| OD-C47-04 | **Not yet.** The decision *permits* deletion; it does not require exposing it. | Any deletion surface additionally needs the OQ-36 residue in §4.3 (reuse, mechanics, proof, endpoint/permission) answered first. |

**This record does not create a task number**, does not admit C-47 to
implementation, and does not accept PR #106 or PR #107. Promotion of a
candidate to a numbered task remains governed by
`docs/roadmap/future-task-candidates.md` §Promotion rule and the pending
Owner track selection **OD-27-03**
(`docs/tasks/task-31/governance-state-matrix.md`).

---

## 7. C-47 status reconciliation

| Claim | Verdict | Basis |
|---|---|---|
| "PR #107 is merged and CI passed" | **TRUE** | `main` @ `4cf481e` is the merge of PR #107; CI runs recorded in `docs/tasks/c-47-item-master-readiness-hardening-report.md` §8 |
| "Therefore the item master is Owner-accepted" | **FALSE** | STATE.md §1/§6: merge + green CI ≠ acceptance. No Owner acceptance record exists for C-47, PR #106 or PR #107 |
| "OQ-29 is resolved" | **FALSE** | OD-C47-01 narrows it; U-1…U-8 remain (§1.3) |
| "OQ-33 is resolved" | **FALSE** | OD-C47-02 is extension governance; the taxonomy/capability confirmation is explicitly withheld (§2.2) |
| "OQ-36 is resolved" | **FALSE** | Code-reuse semantics unanswered (§4.3) |
| "Barcode policy is open" | **FALSE as of this record** | PDR-01 is **Decided**; only its lifecycle residue (OQ-65) is open |
| "C-47 is unblocked" | **PARTIALLY** | The OQ-29/OQ-33 blocks are *narrowed*, not removed; a bounded barcode-uniqueness follow-up is now the concrete, evidence-backed next C-47 step and is itself gated by OQ-65 |

Resulting candidate status (transcribed into
`docs/roadmap/future-task-candidates.md`):
**MVP REQUIRED — IMPLEMENTED-STYLE RECONNAISSANCE + REGRESSION HARDENING —
NOT ACCEPTED — OWNER DECISIONS RECORDED (OD-C47-01…04) — REMAINS BLOCKED BY OQ
(OQ-29 residue, OQ-33 taxonomy confirmation, OQ-65 barcode lifecycle).**

---

## 8. Verification

| Category | This record |
|---|---|
| Repository/source inspection | **Executed** at `4cf481e` |
| Production code / schema / migration / API / generated types / permissions / tests | **Not modified** |
| Heavy E2E / live PostgreSQL / migration / migration-rehearsal commands | **Not run** (per `docs/testing/test-execution-policy.md` and the work order) |
| Fast documentation checks | Changed-path audit, `git diff --check`, relative-link resolution for changed Markdown |
| Claims of test pass/fail | **None made**; CI results quoted are transcriptions from the PR #107 report |

**No heavy E2E/live-DB test was executed locally.**
