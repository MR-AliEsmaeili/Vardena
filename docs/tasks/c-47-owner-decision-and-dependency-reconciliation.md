# C-47 — Owner Decision Recording, Status Reconciliation and Inventory Dependency Review

| Field | Value |
|---|---|
| Status | **READY FOR REVIEW — NOT ACCEPTED** |
| Date | 2026-10-02 (UTC) |
| Type | Documentation / governance and dependency reconciliation only |
| Inspection baseline | `main` @ `4cf481efa2de5ca9863d9d434c2ab707de23301a` (merge of PR #107) |
| Production code changed | **NONE** — no code, Prisma schema, migration, API/DTO, generated type, permission or test was modified |
| Scope boundary | No warehouse operational implementation of any kind was started |

> **Governing rules applied.** STATE.md §1 (merged `main` is the source of truth),
> STATE.md §6 (MERGED ≠ ACCEPTED; green CI is not acceptance; READY FOR REVIEW is
> not acceptance), AG-03 (scope discipline), AG-09/AR-31 (no invented business
> rules), `docs/testing/test-execution-policy.md` (heavy suites belong to CI).
> **No heavy E2E, live-PostgreSQL, migration or migration-rehearsal command was
> executed.**

---

## 1. What this task did

1. Recorded four explicit Owner decisions (**OD-C47-01 … OD-C47-04**) in the
   repository's canonical registries: the OQ registry
   (`docs/open-questions.md`) and the product-decision directory
   (`docs/decisions/product/`), with traceable implementation-evidence links and
   explicit follow-up questions.
2. Opened **OQ-65** for the barcode lifecycle detail the barcode decision
   deliberately did not answer.
3. Reconciled the **C-47** candidate status honestly: PR #107 is merged with green
   CI, which is *not* Owner acceptance of the item master.
4. Reviewed the Roadmap and Dependency Matrix for **C-47 … C-54** against the
   code, verified the **actual** scope and status of **OQ-11, OQ-24, OQ-39,
   OQ-42** (and OQ-54, OQ-13/OQ-26, OQ-23, OQ-49) from their canonical wording
   rather than their identifiers, and recorded per-candidate readiness.
5. Evaluated **C-50** as the next investigation candidate and assessed whether a
   bounded **C-47 implementation follow-up** is justified.

Nothing here closes an OQ that remains unanswered, promotes an ADR, accepts a
merged task, or authorizes implementation.

---

## 2. Owner decisions recorded

| Id | Subject | Decision | Canonical records | Registry effect |
|---|---|---|---|---|
| **OD-C47-01** | OQ-29 — quantity precision and conversion | **Option A** | [`PDR-01`](../decisions/product/PDR-01-item-quantity-precision-and-conversions.md); OQ-29 row annotated | OQ-29 **PARTIALLY RESOLVED — stays OPEN** |
| **OD-C47-02** | OQ-33 — item taxonomy and capabilities | **Option D** (governance rule only) | [`PDR-02`](../decisions/product/PDR-02-item-taxonomy-and-capabilities.md); OQ-33 row annotated | OQ-33 **stays OPEN**; Option A explicitly **not** approved |
| **OD-C47-03** | Barcode policy | **Option A — confirmed** | [`PDR-03`](../decisions/product/PDR-03-item-barcode-policy.md); OQ-33 row cross-reference; new OQ-65 | New **OQ-65 OPEN** for the lifecycle detail |
| **OD-C47-04** | OQ-36 — item deletion and code reuse | **Option C** (eligibility only) | [`PDR-04`](../decisions/product/PDR-04-item-deletion-and-code-reuse.md); OQ-36 row annotated | OQ-36 **PARTIALLY RESOLVED — stays OPEN** |

### 2.1 OD-C47-01 — OQ-29, Option A

Decided: fixed quantity precision of **four fractional decimal places**;
**reject** conversion results that cannot be represented exactly at the supported
precision; **no rounding, no silent truncation**; conversion-factor changes must
use **effective-dated versions**; **preserve** historical conversion versions and
the data needed to interpret prior transactions.

Independent sub-questions **left open deliberately** (none closed): per-unit
entry precision, global-vs-item-specific precedence, explicit-vs-derived reverse
pairs, the exactness boundary for future consumers (document line, balance,
report, valuation), valuation/cost precision (OQ-24/OQ-11), and the authority and
audit model for back-dated factor versions.

**Production delta identified: none.** The decided rule and current behavior
coincide (`backend/src/modules/inventory/domain/quantities.ts`,
`backend/prisma/schema/inventory.prisma`,
`backend/src/modules/inventory/{domain/unit-conversion.ts,application/unit-conversions.service.ts,data/unit-conversions.repository.ts}`).
The decision converts interim fail-closed behavior into approved policy.

### 2.2 OD-C47-02 — OQ-33, Option D

Decided: new item kinds or capability flags may be introduced **only** when a
concrete need has been identified and accepted through the project's
decision/governance process.

Recorded with equal force: **Option A is NOT approved.** The Owner has **not**
confirmed that the existing eight item kinds and the current per-item
configurable capability model are accepted without change; that confirmation is
**OPEN**. The item model is *frozen*, not *approved* — the default assumptions in
`backend/src/modules/inventory/domain/item-kind.ts` stay assumptions.

### 2.3 OD-C47-03 — Barcode, Option A (confirmed)

Decided: barcode optional; uniqueness enforced **within an organization**; **two
active items in the same organization must not share a barcode**; different
organizations may use the same barcode; multiple formats supported with **no**
strict symbology validation unless separately approved; **no**
multi-barcode-per-item support.

**Canonical-wording inspection (as instructed).** The decided text constrains
*two active items*. Current `main` enforces **no** barcode uniqueness whatsoever:
`inventory.items.barcode` is a nullable `varchar(64)`, trimmed and stored
verbatim, with the only item unique key being `(organization_id, code)`
(`backend/prisma/schema/inventory.prisma`,
`backend/prisma/migrations/20260911010000_inventory_master_data/migration.sql`,
`backend/src/modules/inventory/application/items.service.ts`). Nothing in the
canonical decision resolves what happens to the barcode of a **deactivated**
item.

Therefore the unresolved lifecycle detail is recorded, not inferred:

> **OQ-65 (OPEN):** may a barcode assigned to a deactivated item be reused by
> another item in the same organization? Plus comparison semantics
> (case/whitespace/leading zeros/Unicode digits), inactive-vs-inactive
> collisions, re-activation conflicts and clear-and-reassign behavior.

This is blocking for implementation because **every candidate constraint shape
answers it silently**: a plain unique index forbids reuse forever; a partial
unique index over active rows permits reuse *and* permits two inactive items to
share a barcode.

No production code or schema was changed under this decision, as instructed.

### 2.4 OD-C47-04 — OQ-36, Option C

Decided: physical deletion permitted **only** for an item that has **never** been
referenced by any operational, ledger or historical record; a referenced item
must **not** be physically deleted; history and organization-scoped identity
constraints are preserved.

Explicitly **not** inferred: the complete item-code reuse policy. Whether the
code of a physically deleted, never-referenced item may be reused is **OPEN**.
The registry sentence "codes … are never reused" remains an interim assumption,
and `docs/architecture/domain/master-data-strategy.md` §7.9's "default: **no
reuse**" is a design default, not an Owner decision.

---

## 3. C-47 status reconciliation

| Dimension | Verified state | Evidence |
|---|---|---|
| Implementation | Item/item-group/unit/global+item-specific conversion master exists, with freeze guards, organization scope and operation-level permissions | `backend/src/modules/inventory/{domain,application,data,api}/…`; `backend/prisma/schema/inventory.prisma`; migration `20260911010000_inventory_master_data` |
| Hardening work | Two production defects fixed (conversion supersession race; `resolveConversion` cross-organization leak) + one generated-type drift fix; hermetic and live-PG regression coverage added | `docs/tasks/c-47-item-master-readiness-hardening-report.md` §3–§5 |
| Merge | **MERGED** — PR #107, merge commit `4cf481efa2de5ca9863d9d434c2ab707de23301a` | `git log`; `gh pr list` |
| CI | Reported green on PR #107 (backend incl. live-DB suites + frontend) | `docs/tasks/c-47-item-master-readiness-hardening-report.md` §8; STATE.md §17 |
| Owner acceptance | **NOT ACCEPTED.** No acceptance record exists for C-47. **Merge + green CI is not Owner acceptance of the item master** (STATE.md §6) | absence of any `*-acceptance-record.md` for C-47 |
| Decision posture after this task | OQ-29 partially resolved; OQ-33 governance rule only (taxonomy confirmation still missing); barcode policy decided with OQ-65 open; OQ-36 eligibility decided with code reuse open | §2 above |
| Candidate status | **MVP REQUIRED — IMPLEMENTED-STYLE RECONNAISSANCE + REGRESSION HARDENING — NOT ACCEPTED — STILL BLOCKED BY OQ**, now by **OQ-33 (taxonomy confirmation)**, **OQ-65 (barcode uniqueness shape)** and **OQ-36 (code reuse)**; OQ-29 is no longer a blocker for the already-shipped behavior | `docs/roadmap/future-task-candidates.md` row C-47 (updated) |

**Explicitly not claimed:** that C-47 is complete, that the item master is
accepted, that OQ-33 or OQ-36 are resolved, or that this task's own PR is
accepted.

---

## 4. Verified scope and status of the named prerequisite OQs

Verified from the canonical registry wording at the inspection baseline — **not**
inferred from identifiers. "Registry text" below is the question as written in
`docs/open-questions.md`.

| OQ | Area (registry) | Actual scope (registry text, condensed) | Status | What it really gates |
|---|---|---|---|---|
| **OQ-11** | **Accounting** (not Inventory) | "Ledger behavior specifics: double-entry chart structure, period close/reopen rules, **opening balance import**, **cost accounting method for inventory** (standard/moving avg/weighted)?" Impact: accounting module design, inventory valuation events. Assumption: double-entry; journals immutable; **cost method undecided — inventory valuation reports deferred** | **OPEN** | The *accounting* opening-balance import and the inventory **costing method**. It does **not** by itself describe an inventory quantity-opening document; its inventory relevance is valuation/cost, not quantity |
| **OQ-24** | Accounting | "Inventory valuation and stock policy: which costing method (moving weighted average / FIFO / standard), how returns, adjustments and negative stock affect cost, and **whether negative stock is permitted at all**". Impact: movement cost columns, valuation state/layers, COGS postings, stock reports, negative-stock policy. Assumption: ledger records quantity and (where known) unit cost; method is configuration; **negative stock defaults to reject** | **OPEN** | Every **rial/valued** inventory flow and report. Its negative-stock half already has an implemented fail-closed default (`backend/src/modules/inventory/domain/negative-stock-policy.ts`: warehouse setting with optional per-item override, default reject) — implemented default ≠ decided policy |
| **OQ-39** | Accounting / Events | Durable integration semantics for **system-generated accounting**: transactional in-process subscription (ADR-0005) vs durable queued/outbox delivery (ADR-0004); what happens to a source document whose posting is rejected; which events must never be lost. Assumption: **no production system-generated posting**; in-memory bus only | **OPEN — the integration gate** | Any automatic accounting effect from an inventory document. It does **not** gate quantity-only inventory behavior |
| **OQ-42** | Accounting | **Posting mode** per (source module, document type): created **directly final** (Mode A) or as a **draft an accounting authority finalizes** (Mode B); who may finalize; segregation of duties; rejection semantics; draft backlog governance. Assumption: nothing system-posted until OQ-39 and mapping rules resolve | **OPEN** | The *shape* of the accounting effect once OQ-39 is answered. Like OQ-39, it is irrelevant to quantity-only flows |
| **OQ-54** | Product / Documents | "**Finalized document** deletion/editing policy: cancel-only vs edit-until-posted vs per-type configuration; visibility of canceled documents; numbering gaps (OQ-12); cancel approval coupling (OQ-13/OQ-26)". Assumption: **cancel-only, visible, audited is a recommendation, not decided** | **OPEN** | The lifecycle (edit/cancel/visibility) of **every** operational document — Material Request, Receipt, Issue and opening documents alike |
| **OQ-13** *(additional, not listed in the register rows)* | Domain | "Approval workflows: do inventory movements / sales documents / journals need approval states? Negative stock allowed per policy?" Assumption: **no approval states in v1**; negative stock disallowed by default | **OPEN** | Whether an inventory operational document (especially a Material Request) has an approval state at all |
| **OQ-26** *(additional)* | Security | Which transitions require approval, single vs multi-level, delegation/escalation, separation of duties, which roles approve which document types | **OPEN** | The content of any approval the above admits |
| **OQ-23** *(additional)* | Accounting | Fiscal calendar: year start/layout, close/reopen policy, **how year-end/opening entries are produced and approved** | **OPEN** | Explicitly cited by the Inventory code as the reason no `opening` movement type exists (`backend/src/modules/inventory/domain/movement-type.ts`) — a real, unlisted prerequisite of the opening flows |
| **OQ-49** *(additional)* | Reporting | Report Builder **depth** (registry-only … full visual builder) | **OPEN** | A **generic builder** only. The dependency matrix §4 already records "**builder NOT required for MVP**; bounded reports only" — so OQ-49 does **not** block bounded, code-defined inventory reports |
| **OQ-12** *(additional)* | Numbering | Numbering policy extensions (year component, gaps) | **OPEN** (mechanism exists) | Nothing blocking: the Document Foundation numbering mechanism is implemented and sufficient (`backend/src/modules/documents/…`) |

**Correction recorded:** the register's C-48/C-49 rows cite "OQ-11/OQ-24" and the
C-54 row cites "OQ-24/OQ-49". Per the verified wording above, OQ-11's inventory
relevance is **costing/valuation and accounting opening import** (not quantity
opening mechanics), and OQ-49 blocks only a report **builder**, not bounded
code-defined reports. OQ-23 and OQ-54 are genuine prerequisites that the rows do
not currently name. These are recorded here and reflected in the updated
dependency matrix; no status is loosened on that basis.

---

## 5. Dependency review — C-47 … C-54

Common verified facts used below:

- **No universal document table exists.** The Documents Foundation provides a
  code-only document **type registry**, numbering series + an append-only
  allocation ledger, and typed document relations
  (`backend/prisma/schema/documents.prisma`: `DocumentTypeConfig`,
  `NumberingSeries`, `NumberingAllocation`, `DocumentRelation`). Each module owns
  its own document tables. **Inventory registers no document type today** — only
  Accounting does (`backend/src/modules/accounting/application/accounting-document-type-registration.ts`).
- **The inventory ledger is quantity-only.** `InventoryMovement` has
  `quantity`, `baseQuantity`, `conversionFactor`, `movementDate`, opaque
  `referenceType`/`referenceId`, and **no cost column of any kind**
  (`backend/prisma/schema/inventory.prisma`).
- **There is no `opening` movement type**, deliberately: the eight types are
  `inbound`, `outbound`, `transfer_in/out`, `adjustment_in/out`,
  `reversal_in/out`, and the code records that an `opening` type and its link to
  accounting opening balances is a designed follow-up gated by OQ-23
  (`backend/src/modules/inventory/domain/movement-type.ts`).
- **Reservations already carry a generic document hook**
  (`referenceType`/`referenceId`, `status`, release path) and obey the same
  negative-stock policy as postings (`backend/prisma/schema/inventory.prisma`,
  `backend/src/modules/inventory/application/inventory-reservations.service.ts`).
- **Idempotency exists** for every mutating inventory operation
  (`inventory.inventory_operations`, `operation_key` + request hash).
- **No reporting module exists**; Accounting owns its bounded read surfaces as
  the established precedent (ADR-0009 Accepted; `docs/current-state-reconciliation.md` §3).

| Candidate | Current status (verified) | Primary evidence paths | Real upstream dependencies | Blocking OQs / ADRs (verified) | Readiness verdict |
|---|---|---|---|---|---|
| **C-47** Product/item master completion | Master surface implemented + hardened; merged (PR #107), CI green, **NOT ACCEPTED** | `backend/src/modules/inventory/{domain,application,data,api}`; `backend/prisma/schema/inventory.prisma`; migration `20260911010000_inventory_master_data`; `backend/test/{master-data,item-master-live}.e2e-spec.ts`; `docs/tasks/c-47-*.md` | Organization scope/membership (implemented); unit/conversion contract (implemented) | **OQ-33** (taxonomy confirmation withheld — OD-C47-02), **OQ-65** (barcode uniqueness shape), **OQ-36** (code reuse — OD-C47-04 left open). OQ-29 is **no longer blocking** the shipped behavior (OD-C47-01). ADR-0022 Accepted; ADR-0017/0020 Proposed | **BLOCKED BY OQ** for "completion"; a bounded follow-up is partly justified — see §7 |
| **C-48** Opening quantity | **NOT PRESENT** as an operational flow. Quantity postings exist, but no opening document, no `opening` movement type, no inventory document type/numbering registration | `backend/src/modules/inventory/application/inventory-movements.service.ts`; `domain/movement-type.ts`; `backend/prisma/schema/documents.prisma` | Item + warehouse master (present); movement ledger (present); Documents Foundation numbering/type registry (present, unused by Inventory); fiscal/period dating semantics | **OQ-24** (may an opening create stock with no cost? how do adjustments/negative stock affect cost?), **OQ-23** (how opening entries are produced — cited by the code), **OQ-54** (lifecycle of a finalized opening), **OQ-13/OQ-26** (approval, if any). **OQ-11** applies to the *accounting* opening import, not to quantity mechanics. ADR-0022 Accepted | **BLOCKED BY OQ** for implementation. An investigation is *possible* but lower value than C-50 because the decisive questions (OQ-24/OQ-23) are Owner/accountant decisions, not reconnaissance gaps |
| **C-49** Opening rial | **NOT PRESENT**; no cost columns exist anywhere in the ledger | `backend/prisma/schema/inventory.prisma` (`InventoryMovement` has no cost field); `docs/roadmap/backend-mvp-dependency-matrix.md` §2 (Inventory→Accounting NOT PRESENT) | C-48; valuation model; accounting posting path | **OQ-24** (costing method / valuation layers), **OQ-11** (accounting opening import + cost method), **OQ-25** (account mapping content), **OQ-39** (durable posting semantics), **OQ-42** (posting mode). ADR-0005 Accepted contract with **no consumer**; ADR-0017 Proposed | **BLOCKED** — hardest of the set; strictly after the OQ-39/OQ-42/C-21/C-13 chain |
| **C-50** Material Request | **NOT PRESENT.** Foundations it would consume are present and unused by Inventory | Documents Foundation (`backend/src/modules/documents/**`), Workflow Foundation (`backend/src/modules/workflow/**`), reservations (`inventory.inventory_reservations`), permissions registry, organization scope | Documents Foundation (**implemented**, ADR-0023 Accepted); Workflow Foundation (**implemented**, ADR-0024 Accepted, no business document wired); Inventory item/warehouse master (**implemented**); new Inventory-owned header/line tables + document-type registration + numbering series (**new work**) | **OQ-54** (finalized-document edit/cancel/visibility — applies at implementation, not to an investigation), **OQ-13/OQ-26** (whether an MR has approval states and who approves). **Undecided product rule with no OQ yet:** does an MR reserve stock, and does it drive a Warehouse Issue? No ADR blocks it | **READY FOR INVESTIGATION (bounded)** — the best-positioned candidate; **NOT ready for implementation** (see §6) |
| **C-51** Warehouse Receipt (quantity/rial) | Quantity **core** present (`inbound` postings, balances, idempotency, reservations); the **document** layer absent; rial absent | `inventory-movements.service.ts`; `inventory-balances.service.ts`; `backend/prisma/schema/inventory.prisma` | C-47/C-46 master (present); movement ledger (present); document layer (new); valuation (absent) | **OQ-24** (rial/valuation), **OQ-39** + **OQ-42** (accounting effect), **OQ-54** (lifecycle of a finalized receipt — unlisted in the register), **OQ-13/OQ-26** (approval). ADR-0022 Accepted; ADR-0017 Proposed | **BLOCKED BY OQ.** Even a quantity-only receipt document needs OQ-54 lifecycle semantics |
| **C-52** Warehouse Issue (quantity/rial) | Same as C-51, with `outbound` postings and the availability rule | same as C-51 | C-50 conceptually upstream (request → issue), not a hard prerequisite | same as C-51, plus the cost-of-issue question inside **OQ-24** (which costing method values an issue) | **BLOCKED BY OQ** |
| **C-53** Inventory stock / settings | **PARTIAL.** Balances exist with organization scope and backend sorting; negative-stock settings exist per warehouse with per-item override; "rial stock" and a settings surface beyond that are absent | `backend/src/modules/inventory/application/inventory-balances.service.ts`; `domain/negative-stock-policy.ts`; `backend/prisma/schema/inventory.prisma` (`InventoryBalance`) | movement → balance projection (present) | **OQ-24** for the rial half and for confirming the negative-stock policy as *decided* rather than *defaulted*. ADR-0022 Accepted | **PARTIAL / quantity half near-ready; rial half BLOCKED BY OQ.** Needs Owner admission of what "settings" means before investigation |
| **C-54** Kardex and inventory reporting | **NOT PRESENT.** No reporting module; no inventory read surfaces beyond balances | `backend/src/modules/inventory/api/inventory-balances.controller.ts`; ADR-0009; `docs/current-state-reconciliation.md` §3 | Immutable movement ledger (present) for a **quantity** Kardex; valuation state for a **rial** Kardex (absent); a read-surface ownership decision (Inventory-owned bounded reads, following the Accounting precedent, vs C-14 reporting foundation) | **OQ-24** for every rial report. **OQ-49 does NOT block bounded code-defined reports** (dependency matrix §4: builder not required for MVP) — the register's OQ-49 citation overstates the gate. ADR-0009 Accepted | **Quantity Kardex: INVESTIGABLE** once the read-surface ownership question is answered (C-14 direction or the Accounting precedent). **Rial Kardex/reports: BLOCKED BY OQ-24** |

---

## 6. C-50 (Material Request) as the next investigation — verification

**Verified, not assumed:**

1. **OQ-54 is OPEN** and its scope is "finalized document deletion/editing
   policy" — cancel-only vs edit-until-posted vs per-type configuration,
   visibility of canceled documents, numbering gaps (OQ-12) and approval coupling
   (OQ-13/OQ-26). Its recommended "cancel-only, visible, audited" posture is
   explicitly a **recommendation, not a decision**
   (`docs/decisions/product/OQ-54-finalized-document-deletion-editing.md`).
   → It gates the **implementation** of an MR lifecycle, not a bounded
   investigation.
2. **The register's dependency list for C-50 is incomplete.** Verified actual
   prerequisites:
   - Documents Foundation — **implemented** (type registry, numbering series +
     allocation ledger, relations). Inventory has **never** registered a document
     type, so C-50 would be the first Inventory document type, numbering series
     and header/line tables → a real migration, not configuration.
   - Workflow Foundation — **implemented**, but **no business document is wired
     to it anywhere**. Whether an MR has approval states is **OQ-13**; what the
     approval means is **OQ-26**. A "material request" with no approval concept
     is a product decision, not an implementation detail.
   - Reservation semantics — `inventory_reservations` already supports
     `referenceType`/`referenceId` and the availability rule, so an MR *could*
     reserve stock. **Whether it should is an undecided product rule with no OQ
     row yet** and must be decided (or a new OQ opened) at investigation time.
   - Fulfillment coupling to C-52 (Warehouse Issue) — C-52 is blocked; an MR must
     therefore be scoped as a standalone request document whose fulfillment link
     is designed but not implemented, or the candidate inherits C-52's blocks.
   - Permissions/organization scope/idempotency patterns — **implemented** and
     reusable.
3. **No ADR blocks C-50.** ADR-0023 (Documents) and ADR-0024 (Workflow) are
   Accepted. A new Inventory document family may need its own design record if it
   changes cross-module patterns (AR-29); that determination belongs to the
   investigation.

**Verdict: C-50 is the next dependency-ready candidate for INVESTIGATION ONLY.**
It is the only C-48…C-54 candidate whose blocking set contains no valuation,
costing or durable-posting question. Its investigation must produce, without
inventing rules: the MR document model over the existing Foundations, the
lifecycle options against OQ-54, the approval question against OQ-13/OQ-26, the
reservation question as an explicit new decision item, and the fulfillment
boundary to C-52. **Implementation remains unauthorized** and requires Owner
admission plus those decisions.

---

## 7. Is a bounded C-47 implementation follow-up justified?

Assessed per decision, after collecting the Owner decisions:

| Follow-up slice | Justified? | Why |
|---|---|---|
| **OD-C47-01 (OQ-29 Option A)** — pin the decided quantity/conversion contract | **No production follow-up needed.** Documentation-only, already done by this task | The decided rule equals shipped behavior; no schema/API/behavior delta was identified. Existing hermetic + live-PG cases already pin "reject, never round" |
| **OD-C47-03 (barcode uniqueness)** — organization-scoped uniqueness among active items | **Justified in principle, BLOCKED today** | The constraint does not exist (`inventory.items` has no barcode index). Implementing it requires choosing an index shape, and every shape silently answers **OQ-65**. Registered as candidate **C-55 — BLOCKED BY OQ-65** |
| **OD-C47-04 (OQ-36 Option C deletion)** — physical deletion of never-referenced items | **Justified in principle, BLOCKED today** | Requires a DELETE route, a new `*.Delete` permission, a race-free "never referenced" proof across referencing modules, and an answer to the code-reuse question that OD-C47-04 explicitly leaves open. Registered as candidate **C-56 — BLOCKED BY OQ-36 (code reuse)** |
| **OD-C47-02 (OQ-33)** — taxonomy/capability work | **Not justified** | Option D forbids introducing kinds/flags without an accepted concrete need, and the Owner withheld confirmation of the current model. There is nothing to implement |
| **Tooling observation from the hardening report** — CI check that committed generated frontend types match the backend OpenAPI document | **Justified as a candidate, not performed here** | Recorded as an open recommendation in `docs/tasks/c-47-item-master-readiness-hardening-report.md` §3; it is a tooling/CI decision for the Owner, and this task changes no CI |

**Conclusion:** a bounded C-47 implementation follow-up is **justified only after
OQ-65 and the OQ-36 code-reuse semantics are decided**. Until then the sole
non-blocked C-47 work is documentation (completed by this task). Collecting the
Owner decisions narrowed C-47's blocking set from "OQ-29 + OQ-33" to
"OQ-33 confirmation + OQ-65 + OQ-36 reuse", but it did not unblock code.

---

## 8. Next dependency-ready candidate

**C-50 — Material Request: READY FOR INVESTIGATION (bounded), implementation not
authorized.** Rationale in §6. Runner-up: the quantity-only half of **C-53/C-54**
(current-stock and quantity-Kardex read surfaces), which is gated by a
read-surface ownership decision rather than by a business-policy OQ — but it
should follow, not precede, the C-14 reporting-foundation direction.

No candidate in C-48…C-54 is ready for **implementation**.

---

## 9. Changed paths

| Path | Change |
|---|---|
| `docs/open-questions.md` | OQ-29/OQ-33/OQ-36 annotated with OD-C47-01/02/04 (all three remain **OPEN**); new **OQ-65** row; status header updated |
| `docs/decisions/product/PDR-01-item-quantity-precision-and-conversions.md` | **New** — OQ-29 Option A decision record |
| `docs/decisions/product/PDR-02-item-taxonomy-and-capabilities.md` | **New** — OQ-33 Option D decision record |
| `docs/decisions/product/PDR-03-item-barcode-policy.md` | **New** — barcode Option A decision record |
| `docs/decisions/product/PDR-04-item-deletion-and-code-reuse.md` | **New** — OQ-36 Option C decision record |
| `docs/decisions/product/OQ-65-barcode-lifecycle-and-reuse.md` | **New** — open question record |
| `docs/decisions/product/README.md` | Index rows for OQ-65 and PDR-01…PDR-04 + numbering note |
| `docs/tasks/c-47-owner-decision-and-dependency-reconciliation.md` | **New** — this report |
| `docs/roadmap/future-task-candidates.md` | C-47…C-54 rows reconciled; new candidates **C-55**, **C-56** (both blocked) |
| `docs/roadmap/backend-mvp-dependency-matrix.md` | 2026-10-02 addendum; item-master/barcode rows; OQ rows for OQ-29/OQ-33/OQ-65 and corrected gates for C-48/C-49/C-54 |
| `docs/roadmap/backend-mvp-roadmap.md` | Dated addendum pointer (no planning body rewritten) |
| `docs/current-state-reconciliation.md` | 2026-10-02 addendum (C-47 merge state, Owner decisions, OQ reconciliation delta) |
| `docs/architecture/domain/master-data-strategy.md` | Dated decision pointers on the barcode attribute, the kind list and lifecycle §7 (no design rule rewritten) |
| `STATE.md` | New §18 addendum recording the decisions, the C-47 status reconciliation and the dependency findings |

No file outside documentation was touched.

---

## 10. Validation

| Check | Classification | Result |
|---|---|---|
| Changed-path audit (documentation only) | fast-local | **PASS** — only `docs/**` and `STATE.md`; no backend/frontend source, Prisma schema/migration, generated OpenAPI type, permission, test, package manifest, lockfile, CI or Compose file changed |
| `git diff --check` (whitespace/conflict markers) | fast-local | **PASS** |
| Relative-link validation for every changed/added Markdown file | fast-local | **PASS** — all relative targets resolve |
| Referenced evidence paths exist in the checkout | fast-local | **PASS** — every `backend/…` path cited in the new records was verified to exist |
| Registry consistency (every OQ id referenced exists; OQ-65 is the next free id) | fast-local | **PASS** |
| Backend/frontend test suites, typecheck, lint, build | — | **Not run** — no code changed; nothing to verify. CI remains the authoritative gate |
| Full E2E / live PostgreSQL / migration / migration-rehearsal commands | — | **Intentionally not run**, per the task scope and `docs/testing/test-execution-policy.md` |

**No heavy E2E/live-DB test was executed locally.** No claim of Owner acceptance
is made for this task or its PR.

---

## 11. Final status

**READY FOR REVIEW** — documentation/governance and dependency reconciliation
only. Four Owner decisions recorded; OQ-29, OQ-33 and OQ-36 remain OPEN with
their unresolved parts stated; OQ-65 opened; C-47 reconciled as merged + CI-green
but **not accepted**; no warehouse operational implementation started.
