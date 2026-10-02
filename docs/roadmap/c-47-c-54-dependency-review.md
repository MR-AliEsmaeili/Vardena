# Vardena — C-47…C-54 Inventory/Warehouse Dependency Review

| | |
|---|---|
| Status | **READY FOR REVIEW — NOT ACCEPTED** |
| Date | 2026-10-02 (UTC) |
| Type | Roadmap companion (documentation only) |
| Inspection baseline | `main` @ `4cf481efa2de5ca9863d9d434c2ab707de23301a` (merge of PR #107) |
| Production code changed | **NONE** |
| Parents | [backend-mvp-roadmap.md](./backend-mvp-roadmap.md) · [backend-mvp-dependency-matrix.md](./backend-mvp-dependency-matrix.md) · [future-task-candidates.md](./future-task-candidates.md) |
| Decision input | [c-47-item-master-owner-decision-record.md](../tasks/c-47-item-master-owner-decision-record.md) (OD-C47-01…04) · [PDR-01](../decisions/product/PDR-01-item-barcode-policy.md) |

> **This review authorizes nothing.** It transcribes verified state, names the
> *actual* prerequisites of each candidate (read from the registry text, never
> inferred from an identifier), and reports readiness. **No warehouse
> operational implementation — receipt, issue, opening balances, material
> request or any other operational warehouse document — is started, designed
> or admitted by this document.**

---

## 1. Method and evidence rules

1. Every OQ scope below is quoted/summarised from the **current registry text**
   in [`docs/open-questions.md`](../open-questions.md), not from the number.
2. Every "state on `main`" claim names a file path that exists at the baseline
   SHA.
3. `MERGED` + green CI ≠ `ACCEPTED` (STATE.md §1/§6). No candidate is promoted.
4. A candidate is **READY TO INVESTIGATE** only when a bounded reconnaissance
   can produce value *without* answering a blocking business rule; it is
   **READY TO IMPLEMENT** only when every blocking OQ/ADR for the bounded slice
   is answered **and** the Owner has admitted the task.
5. Owner **track selection OD-27-03 remains PENDING**
   (`docs/tasks/task-31/governance-state-matrix.md`), so *every* candidate
   below additionally needs Owner admission before becoming a numbered task,
   independent of its OQ state.

---

## 2. Verified prerequisite scope (read, not inferred)

### 2.1 OQ-11 — Accounting · ledger behaviour specifics

**Actual registry scope:** "double-entry chart structure, period close/reopen
rules, **opening balance import**, **cost accounting method for inventory
(standard/moving avg/weighted)**". Interim: "Double-entry; journals immutable;
cost method undecided — inventory valuation reports deferred until decided."
Task 10.1 note: the *shape* is fixed by `docs/accounting/domain-contract.md`;
**what remains open here is policy, not structure**.

**Status: OPEN.** Load-bearing for inventory in exactly two ways: the
**opening-balance import** policy and the **costing method**. It is *not* a
generic accounting blocker for quantity-only work.

### 2.2 OQ-24 — Accounting · inventory valuation and stock policy

**Actual registry scope:** "which costing method (moving weighted average /
FIFO / standard), how returns, adjustments and negative stock affect cost, and
**whether negative stock is permitted at all**". Interim: "Ledger records
quantity and (where known) unit cost; the *method* is configuration consuming
the ledger; **negative stock defaults to reject** until decided."

**Status: OPEN.** Matrix classification: **"Yes — implementation gate"**.
Two separable halves: (a) the **valuation/costing** half gates every rial
flow; (b) the **negative-stock** half already has an enforced interim posture
in code (`backend/src/modules/inventory/domain/negative-stock-policy.ts`,
`warehouse`/item `allow_negative_stock`), so quantity-only work is gated by
(a) only where it touches cost.

### 2.3 OQ-39 — Accounting/Events · durable integration semantics

**Actual registry scope:** is system-generated posting a **transactional
in-process subscription** or a **durable queued/outbox delivery**; what happens
to a source document whose posting is rejected; which accounting events must
never be lost. Interim: "**No production system-generated posting.** The event
bus is in-memory only (ADR-0024 §9 accepted gap)."

**Status: OPEN — "gates all system-generated posting."** It gates the moment
an inventory document must produce an accounting effect. It does **not** gate
a quantity-only inventory document that produces no accounting effect.

### 2.4 OQ-42 — Accounting · system-generated posting policy

**Actual registry scope:** per source module and document type, is the
accounting document **directly final (Mode A)** or a **draft an accounting
authority finalizes (Mode B)**; default; who may finalize/approve;
segregation of duties; rejection meaning; backlog governance. Mechanism
decided (AC-D-27/AC-D-28: configuration over existing Foundation entry states
plus Workflow approvals — no new engine/state/table). Interim: "nothing is
system-posted at all until OQ-39 and the mapping rules (OQ-24/25/30) are
resolved, so no default is needed yet."

**Status: OPEN, but downstream of OQ-39.** OQ-42 only becomes live once
OQ-39 admits system posting. For a quantity-only document it is inert.

### 2.5 OQ-54 — Product/Documents · finalized document deletion/editing policy

**Actual registry scope (this is the one most often mis-read from its id):**
"cancel-only vs edit-until-posted vs per-type configuration; visibility of
canceled documents; numbering gaps (OQ-12); cancel approval coupling
(OQ-13/OQ-26)". Interim: "**Cancel-only, visible, audited is the recommended
default** (recorded as recommendation, **not decided**); transactional
documents are never soft-deleted (`database-strategy` §7)." Full record:
[`docs/decisions/product/OQ-54-finalized-document-deletion-editing.md`](../decisions/product/OQ-54-finalized-document-deletion-editing.md)
— **Status: Open**, four exact decisions required (unified vs per-type;
allowed transitions for finalized documents; canceled-document visibility and
numbering-gap acceptance; permission model and approval coupling).

**Status: OPEN.** It is a *lifecycle policy* question, not a document-model
question. ADR-0019/ADR-0023 already supply the mechanism — OQ-54's own record
says so explicitly: "Document Foundation capabilities (ADR-0019/0023) — states
and relations already exist; **this is policy, not mechanism**."

### 2.6 Other *actual* prerequisites that the candidate rows under-state

| Prerequisite | Registry scope | Why it is load-bearing here |
|---|---|---|
| **OQ-13** (Domain) | "Approval workflows: do inventory movements / sales documents / journals need approval states? Negative stock allowed per policy?" Interim: "No approval states in v1 (direct create with permission)". **OPEN** | Any operational inventory document (**C-50**, C-51, C-52) must know whether it has approval states before its state machine is designed. C-50's row cites only OQ-54 and therefore under-states its prerequisites. |
| **OQ-26** (Security) | "which transitions require approval, single vs multi-level, delegation and escalation, segregation-of-duties… which roles may approve which document types". **OPEN** | Pairs with OQ-13 the moment a document has an approval transition. |
| **OQ-12** (Numbering) | "per-type sequences? prefix/year scopes? gap policy?" Mechanism exists via Document Foundation (ADR-0023); policy **OPEN** | Cancellation produces numbering gaps — OQ-54 decision 3 depends on OQ-12. Mechanism is sufficient to *number*; policy is needed to decide *gaps*. |
| **OQ-22** (Domain) | branch semantics; warehouse belongs to one branch. **OPEN** (interim posture stands) | Warehouse/branch scoping already implemented; posture stands, not a blocker. |
| **OQ-29 / OQ-33 / OQ-36 / OQ-65 / PDR-01** | see [the C-47 decision record](../tasks/c-47-item-master-owner-decision-record.md) | Item-master semantics every downstream document line inherits. |
| **OD-27-03** | Owner selection of the next implementation track — **PENDING** (`docs/tasks/task-31/governance-state-matrix.md`) | Admission gate for *all* of C-47…C-54. |
| **OD-28-04** | "Decide before valuation flows" (OQ-24/OQ-11) — **PENDING** | Admission gate for every rial/valuation slice (C-49, the rial halves of C-51/C-52/C-53/C-54). |
| **ADR-0017** | Inventory ledger as source of truth — **Proposed** (implemented) | Must not be cited as an accepted override; ADR-0022 (**Accepted**) is the authority for inventory core. |

---

## 3. Candidate-by-candidate review

### C-47 — Product/item master completion

| Field | Finding |
|---|---|
| **Current status** | **PARTIAL — implemented and regression-hardened; MERGED (PR #106 docs, PR #107 code); CI green; NOT ACCEPTED** |
| **Evidence paths** | `backend/src/modules/inventory/{domain,application,data,api}/` (item, item-group, unit, unit-conversion); `backend/prisma/schema/inventory.prisma`; migration `20260911010000_inventory_master_data`; `backend/src/modules/inventory/domain/inventory-permissions.ts`; tests `items.service.spec.ts`, `units.service.spec.ts`, `item-groups.service.spec.ts`, `unit-conversions.service.spec.ts`, `inventory-posting-support.spec.ts`, `backend/test/master-data.e2e-spec.ts`, `backend/test/item-master-live.e2e-spec.ts`; reports `docs/tasks/c-47-item-master-preflight-investigation.md`, `docs/tasks/c-47-item-master-readiness-hardening-report.md` |
| **Upstream dependencies** | Organization scope/membership (present), Inventory Core (present), ADR-0022 (Accepted) |
| **Blocking OQs** | **OQ-29** — residue U-1…U-8 after OD-C47-01 (global vs item-specific scope and precedence, factor scale, derived pairs, boundary applicability, factor correction, display rounding); **OQ-33** — the eight-kind list and the per-item capability model remain **unconfirmed** (OD-C47-02 decided extension governance only); **OQ-65** — barcode lifecycle/reuse; **OQ-36** residue — item-code reuse after physical deletion |
| **Blocking ADRs** | None. ADR-0022 Accepted. ADR-0017/ADR-0020 are **Proposed** and must not be cited as authorization |
| **Decisions now recorded** | OD-C47-01 (OQ-29 Option A), OD-C47-02 (OQ-33 Option D), OD-C47-03/PDR-01 (barcode Option A), OD-C47-04 (OQ-36 Option C) |
| **Readiness** | **BLOCKED FOR FULL COMPLETION — ONE BOUNDED FOLLOW-UP IS DECISION-BACKED.** See §4 |

### C-48 — Opening quantity flow

| Field | Finding |
|---|---|
| **Current status** | **NOT PRESENT as an operational flow.** No opening document type, no opening endpoint, no opening movement kind |
| **Evidence paths** | Absence verified across `backend/src/modules/inventory/api/*.controller.ts` (balances, movements, reservations, transfers, items, item-groups, units, unit-conversions, warehouses) and `backend/prisma/schema/inventory.prisma`; `backend/src/modules/inventory/domain/movement-type.ts` for the existing movement vocabulary |
| **Upstream dependencies** | Item master (C-47 — present), warehouse master (C-46 — present), movement ledger + balances (present, ADR-0022), Document Foundation numbering/lifecycle (`backend/src/modules/documents/`, ADR-0023 Accepted) |
| **Blocking OQs** | **OQ-11** — specifically the *opening balance import* policy half (not the whole of OQ-11); **OQ-24** — only where an opening carries cost; the quantity-only half is additionally exposed to the negative-stock posture (interim: reject). **OQ-54** if an opening document can be corrected/cancelled after finalization; **OQ-12/OQ-13/OQ-26** for numbering gaps and approval states |
| **Blocking ADRs** | None blocking. ADR-0022 Accepted; ADR-0023 Accepted |
| **Readiness** | **BLOCKED BY OQ.** An opening quantity is a *statement of fact at a date*; whether it is a movement, a separate opening record, re-openable, or correctable are all OQ-11/OQ-54 policy questions. Not ready for investigation as an implementation gate until OD-27-03 selects the track; a *policy* investigation (option framing for OQ-11's opening half) is the only non-blocked activity |

### C-49 — Opening rial flow

| Field | Finding |
|---|---|
| **Current status** | **NOT PRESENT.** No valuation state, cost layer, unit-cost column on movements, or accounting linkage |
| **Evidence paths** | `backend/prisma/schema/inventory.prisma` — `InventoryMovement` carries quantity/unit/factor dimensions and **no cost column**; no Inventory→Accounting consumer anywhere (`docs/current-state-reconciliation.md` §8 "no durable Inventory→Accounting or Sales→Accounting delivery/consumer exists") |
| **Upstream dependencies** | C-48 (opening quantity), Accounting core (present), valuation engine (**absent**), Inventory→Accounting integration (**absent**, C-22) |
| **Blocking OQs** | **OQ-11** (costing method + opening balance import), **OQ-24** (valuation method, returns/adjustments/negative-stock cost effects), **OQ-25** (account mapping targets), and — the moment the opening produces an accounting effect — **OQ-39** (delivery semantics) and **OQ-42** (posting mode). Pending Owner decision **OD-28-04** gates valuation flows |
| **Blocking ADRs** | ADR-0005 Accepted (contract only, no consumer); a **new ADR is likely required** for delivery semantics (candidate C-21) |
| **Readiness** | **BLOCKED — deepest dependency chain of the eight.** Strictly after C-48, the valuation decision, and the integration decision |

### C-50 — Material Request

| Field | Finding |
|---|---|
| **Current status** | **NOT PRESENT.** No material-request model, controller, permission or document type |
| **Evidence paths** | No matching model in `backend/prisma/schema/inventory.prisma`; no controller in `backend/src/modules/inventory/api/`; Document Foundation present and usable — `backend/src/modules/documents/domain/{document-type.ts,document-lifecycle.ts,document-relation.ts,numbering.ts}`, `backend/src/modules/documents/application/document-type-registry.ts`, migration `20260912000000_documents_foundation`; Workflow Foundation present — `backend/src/modules/workflow/**`, migration `20260912010000_workflow_foundation` (no business document is bound to it yet) |
| **Upstream dependencies** | Document Foundation (ADR-0023 **Accepted**, implemented), Workflow Foundation (ADR-0024 **Accepted**, implemented, **unbound**), Inventory item + warehouse master (present), RBAC (present) |
| **Blocking OQs — verified, and broader than the candidate row states** | **OQ-54** (**OPEN**; cancel-only is a *recommendation, not a decision*) governs what may happen to a finalized request. **OQ-13** (**OPEN**) governs whether the request has approval states at all — this is the primary question for a *request* document and is **not listed** in the current C-50 row. **OQ-26** (**OPEN**) governs who approves and segregation of duties. **OQ-12** (**OPEN**) governs numbering gaps if cancellation is admitted. **OQ-15** (**OPEN**) touches notification of requesters, if any |
| **Not blocking (verified)** | **OQ-24/OQ-39/OQ-42 do not gate C-50** provided the material request is strictly a *request* — it moves no stock, allocates no cost and produces no accounting effect. If the admitted scope lets a request **reserve** stock, the existing reservation contract applies (`backend/src/modules/inventory/application/inventory-reservations.service.ts`, `domain/inventory-reservation.ts`, `Available = Quantity − Reserved`) and still needs no valuation decision |
| **Blocking ADRs** | None. ADR-0023/ADR-0024 Accepted |
| **Readiness** | **READY TO INVESTIGATE (bounded), NOT READY TO IMPLEMENT.** It is the only C-48…C-54 candidate whose foundations are all Accepted-and-implemented and whose blockers are lifecycle *policy* rather than valuation/integration. An investigation may map the document type, states, permissions and reservation boundary and frame OQ-13/OQ-26/OQ-54 options; it must not choose a lifecycle policy. Admission still requires **OD-27-03** |

### C-51 — Warehouse Receipt (quantity / rial)

| Field | Finding |
|---|---|
| **Current status** | **PARTIAL — quantity core only.** The movement/posting primitive exists; no receipt document, lifecycle, numbering binding or rial treatment |
| **Evidence paths** | `backend/src/modules/inventory/application/inventory-movements.service.ts`, `inventory-posting-support.ts`, `domain/movement-type.ts`, `data/inventory-movements.repository.ts`, `inventory-operations.repository.ts` (idempotency/operation keys); no receipt controller/model |
| **Upstream dependencies** | Inventory Core movement ledger (present), item + warehouse master (present), Document Foundation (present), Workflow (present, unbound), valuation boundary (**absent**) |
| **Blocking OQs** | **OQ-24** (rial half: cost on receipt, returns/adjustments; quantity half inherits the negative-stock posture), **OQ-39** + **OQ-42** (only once the receipt must post to Accounting), **OQ-54** (finalized-document policy), **OQ-13/OQ-26** (approval states), **OQ-12** (numbering gaps). OD-28-04 pending for the rial half |
| **Blocking ADRs** | ADR-0022 **Accepted** governs the ledger; ADR-0017 is **Proposed** and must not be used as authorization |
| **Readiness** | **BLOCKED BY OQ.** The quantity-side foundation is CI-proven, but the document itself needs the lifecycle policy set (OQ-54/OQ-13/OQ-26) and the rial half needs OQ-24 + OQ-39/OQ-42. **Explicitly not started by this task** |

### C-52 — Warehouse Issue (quantity / rial)

| Field | Finding |
|---|---|
| **Current status** | **PARTIAL — quantity core only**, symmetric to C-51 |
| **Evidence paths** | as C-51, plus `backend/src/modules/inventory/domain/negative-stock-policy.ts` and `inventory-balances.service.ts` (issue is the direction where negative stock actually bites) |
| **Upstream dependencies** | as C-51, plus reservations (`inventory-reservations.service.ts`) if issues consume reservations, and C-50 if an issue may be raised from a material request |
| **Blocking OQs** | as C-51. **OQ-24's negative-stock half is materially more load-bearing here**: the interim posture is *reject*, and per-item/warehouse `allow_negative_stock` overrides exist in code as a reserved policy field, not as an approved rule |
| **Blocking ADRs** | as C-51 |
| **Readiness** | **BLOCKED BY OQ. Explicitly not started by this task** |

### C-53 — Inventory stock / settings management

| Field | Finding |
|---|---|
| **Current status** | **PARTIAL — balance core present; "settings" scope undefined** |
| **Evidence paths** | `backend/src/modules/inventory/application/inventory-balances.service.ts`, `data/inventory-balances.repository.ts`, `domain/inventory-balance.ts`, `api/inventory-balances.controller.ts`; `InventoryBalance` in `backend/prisma/schema/inventory.prisma` (`onHand`, `reservedQuantity`, unique `(organization, warehouse, item)`); negative-stock policy module |
| **Upstream dependencies** | movement → balance maintenance (present), organization isolation (present) |
| **Blocking OQs** | **OQ-24** for the rial-stock half and for making negative-stock configurable as an approved rule; **OQ-09** only if organization-level (vs per-user) settings are in scope. The candidate row's single "OQ-24" is accurate for the rial half but the **"settings" scope itself is undefined in the repository** — no accepted definition of what "inventory settings" contains exists |
| **Blocking ADRs** | None blocking (ADR-0022 Accepted) |
| **Readiness** | **BLOCKED BY OQ + UNDEFINED SCOPE.** A scope-definition investigation is possible but is subordinate to C-51/C-52, which determine what state there is to manage |

### C-54 — Quantity/rial Kardex and inventory reports

| Field | Finding |
|---|---|
| **Current status** | **NOT PRESENT as reports.** No Reporting module exists at all |
| **Evidence paths** | `docs/current-state-reconciliation.md` §2.2 (no `reporting`, `excel`, `print` module); the only inventory read surfaces are the balances/movements controllers listed above |
| **Upstream dependencies** | C-14 reporting foundation (**READY TO INVESTIGATE**, not implemented), inventory read models, the valued flows from C-49/C-51/C-52 for any rial Kardex |
| **Blocking OQs** | **OQ-24** (there is nothing to value until valuation is decided), **OQ-49** (report-builder depth — the matrix records "**No — builder NOT required for MVP**; bounded reports only", so OQ-49 blocks a *builder*, not a bounded code-defined Kardex), **OQ-02** only for labels/locale if printed |
| **Blocking ADRs** | ADR-0009 **Accepted** (reporting architecture) — available; ADR-0022 Accepted |
| **Readiness** | **BLOCKED BY DEPENDENCY (last in the chain).** A *quantity* Kardex is conceptually reachable once a reporting foundation exists, because the immutable movement ledger already holds every row it needs; a *rial* Kardex is strictly after valuation |

---

## 4. Bounded C-47 implementation follow-up — assessment

**Is a bounded C-47 follow-up justified after the Owner decisions above?
Yes — exactly one, and it is not yet unblocked.**

| | |
|---|---|
| **Candidate slice** | Enforce the decided barcode rule: organization-scoped barcode uniqueness for items, per PDR-01 §2 clauses 2–4 |
| **Why justified** | It is the **only** decision in OD-C47-01…04 that creates a verified gap between decided policy and implemented behaviour (PDR-01 §5). OD-C47-01 needs no code (current behaviour already matches); OD-C47-02 constrains future change only; OD-C47-04 permits a deletion capability without requiring one |
| **Why it is NOT yet actionable** | The constraint's **index predicate depends on OQ-65 answer (1)** — "active items only" vs "all items". Implementing either shape before that answer would invent the business rule AG-09 forbids |
| **Shape when unblocked** | application pre-check + database-authoritative partial unique index (⇒ one Prisma migration) + 409 conflict mapping mirroring the item-code path + DTO/OpenAPI text + a concurrency case in `backend/test/item-master-live.e2e-spec.ts`. Small, reviewable, single-concern (AG-19) |
| **Explicitly excluded** | symbology validation, multi-barcode/alias model, scan endpoints, item-code reuse, deletion endpoints/permissions, any kind/flag change |
| **Verdict** | **JUSTIFIED — BLOCKED BY OQ-65 — AND STILL SUBJECT TO OWNER ADMISSION (OD-27-03)** |

---

## 5. Next dependency-ready candidate

| Rank | Candidate | Verdict |
|---|---|---|
| 1 | **C-50 — Material Request (investigation only)** | **The next dependency-ready candidate.** Its foundations (Document Foundation ADR-0023, Workflow Foundation ADR-0024) are Accepted **and** implemented; its blockers are lifecycle *policy* (OQ-13/OQ-26/OQ-54/OQ-12) rather than valuation or durable integration; and it is the only operational inventory document that need not touch cost or Accounting. A bounded **investigation** may map the document type, state set, permissions, reservation boundary and the OQ-13/OQ-26/OQ-54 option space. It may **not** choose a lifecycle policy and may **not** implement anything |
| 2 | **Bounded C-47 barcode-uniqueness follow-up** | Decision-backed and small, but **blocked by OQ-65** (§4) |
| — | C-48/C-49/C-51/C-52/C-53/C-54 | **Blocked** by valuation (OQ-24/OQ-11, OD-28-04 pending) and/or integration (OQ-39/OQ-42) and/or lifecycle policy (OQ-54/OQ-13/OQ-26), and/or the absent reporting foundation |

**Caveats attached to rank 1.** The C-50 row in
`future-task-candidates.md` lists only "OQ-54 as applicable"; this review finds
that under-states the prerequisites — **OQ-13 is the primary question for a
request document** and OQ-26/OQ-12 follow it. The row is corrected
accordingly. "READY TO INVESTIGATE" is also **not** admission: **OD-27-03 is
still PENDING**, so no C-50 task number may be created on the strength of this
review.

---

## 6. Final status

**READY FOR REVIEW — NOT ACCEPTED.** This review closes no Open Question,
promotes no ADR, creates no task number, admits no candidate, and starts no
warehouse operational implementation.
