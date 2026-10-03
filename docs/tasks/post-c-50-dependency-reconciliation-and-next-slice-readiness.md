# Post-C-50 Dependency Reconciliation and Next-Slice Readiness

| Field | Value |
|---|---|
| Status | **READY FOR REVIEW — NOT ACCEPTED** |
| Date | 2026-10-03 (UTC) |
| Type | Documentation / governance and dependency reconciliation only |
| Repository | `MR-AliEsmaeili/Vardena` |
| Inspection baseline | `main` / `origin/main` / working-branch HEAD at `ca981018ddc027306da8f28805ded22c2fbd1d19` (merge of PR #112) |
| Production code changed | **NONE** |
| Test boundary | Static inspection and GitHub evidence only; no local E2E, live-PostgreSQL, migration or migration-rehearsal suite |

> This report recommends the next **investigation**, not a numbered task or an
> implementation authorization. It selects no Owner option, closes no OQ,
> promotes no ADR and accepts no merged implementation. `MERGED`, green CI and
> `READY FOR REVIEW` remain distinct from `ACCEPTED` (`STATE.md` §1, §5 and §6).

---

## 1. Governing sources and method

### 1.1 Governance applied

The applicable tracked rules were read in their required order:

- `.vardena/project-context.md` — onboarding order and current-state caveat;
- `docs/architecture.md` — modular-monolith and module-boundary contract;
- `.vardena/architecture-rules.md` — especially AR-07/08, AR-10/11,
  AR-13/16, AR-21/22, AR-29 and AR-31;
- `.vardena/agent-rules.md` — especially AG-03, AG-07, AG-09, AG-15 and
  AG-17;
- `STATE.md` §1, §5 and §6 — merged `main` as official memory, lifecycle and
  acceptance-status rules;
- `docs/testing/test-execution-policy.md` §§1–5 and Rules 1/4 — static review is
  FAST-LOCAL; E2E, live-DB, migration and concurrency suites belong to CI.

The requested repository-level `standard.md` does **not** exist in tracked
`main`. The only tracked file named `standards.md` is
`docs/frontend/standards.md`, which is frontend-specific and was not treated as
repository-wide governance. This is the same absence recorded by
`docs/tasks/c-50-material-request-investigation.md` §2.1.

### 1.2 Required evidence read

- `STATE.md` §18 and the historical task/status tables;
- `docs/roadmap/future-task-candidates.md`, rows C-48…C-54 and its promotion
  rule;
- `docs/roadmap/backend-mvp-dependency-matrix.md` §§3–5;
- `docs/roadmap/backend-mvp-roadmap.md` §§2.3, 5.3, 5.4 and 7;
- `docs/open-questions.md`, including the exact OQ-11, OQ-13, OQ-23, OQ-24,
  OQ-26, OQ-39, OQ-42, OQ-54 and resolved OQ-66 rows;
- `docs/tasks/c-47-owner-decision-and-dependency-reconciliation.md` §§4–8 —
  the C-47…C-54 dependency review;
- `docs/tasks/c-50-material-request-investigation.md` §§1–22;
- `docs/decisions/product/OQ-54-finalized-document-deletion-editing.md` and
  `docs/decisions/product/README.md`;
- ADR-0005, ADR-0009, ADR-0017, ADR-0022, ADR-0023 and ADR-0024;
- `docs/reporting-strategy.md` §§1–3 and §§7–9;
- `docs/architecture/domain/inventory-domain-analysis.md` §§1–7 and
  `docs/architecture/domain/domain-decisions.md` D-03…D-11;
- current C-50 schema, migrations, domain, application, API and test paths;
- current Inventory movement/balance read paths relevant to a quantity Kardex.

Historical reports and PR descriptions were not treated as proof by themselves.
Current code/schema and GitHub PR/CI metadata were checked independently.

---

## 2. Current `main` and C-50 reconciliation

### 2.1 Merge and CI state

After `git fetch origin main --prune`, all three inspected refs resolved to the
same commit:

| Ref | SHA |
|---|---|
| working-branch HEAD | `ca981018ddc027306da8f28805ded22c2fbd1d19` |
| local `main` | `ca981018ddc027306da8f28805ded22c2fbd1d19` |
| `origin/main` | `ca981018ddc027306da8f28805ded22c2fbd1d19` |

GitHub records [PR #112](https://github.com/MR-AliEsmaeili/Vardena/pull/112),
**C-50: Material Request vertical slice (Inventory)**, as `MERGED` at that SHA
on 2026-10-03. The exact merge commit's push CI run
[`37100066679`](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/37100066679)
completed successfully: backend and frontend jobs were green; the backend job
included Prisma validate/generate, lint, typecheck, formatting, unit tests,
build, migration deployment, bootstrap, migration rehearsal and E2E including
live-DB suites.

**Governance result:** C-50 is **IMPLEMENTED AND MERGED — NOT ACCEPTED**. No
C-50 acceptance record was found, and the GitHub PR metadata has no separate
accepted review decision. Merge and green CI do not create Owner acceptance.

### 2.2 What C-50 now implements on `main`

| Surface | Verified current implementation | Primary evidence |
|---|---|---|
| Ownership and persistence | Inventory-owned `MaterialRequest`, `MaterialRequestLine` and append-only `MaterialRequestEvent` models; two migrations; no universal document row | `backend/prisma/schema/inventory.prisma` models beginning at `MaterialRequest`; migrations `20261004000000_material_request_foundation` and `20261005000000_material_request_lifecycle_decisions` |
| Lifecycle | `draft → submitted`; submitted can be approved, rejected or returned; returned can be edited/resubmitted; approved can be reversed to submitted by the original approver or cancelled if no line has been invoked; rejected/cancelled are terminal | `backend/src/modules/inventory/domain/material-request.ts`; `application/material-requests.service.ts`; `data/material-requests.repository.ts` |
| Approval authority | Dedicated permissions; any in-scope holder of `Inventory.MaterialRequest.Approve` may approve/reject and self-approval is permitted; return-for-correction, reversal and cancellation are separately permissioned | `domain/material-request-permissions.ts`; C-50 investigation §§20.2–20.3 |
| Numbering and relations | Code-registers `inventory_material_request`; uses Documents numbering; invocation is represented by a quantity-aware Document Relation | `domain/material-request-document-type.ts`; `application/material-request-document-type-registration.ts`; `inventory.module.ts`; controller `PUT :id/lines/invoke` |
| Reservations | Optional per line; exact warehouse/item/quantity; all-or-nothing approval; no On Hand effect; cancellation/reversal releases unconsumed claims; each successful invocation consumes the same quantity and closes at zero | C-50 investigation §§20.1 and 21; `data/material-requests.repository.ts`; `domain/inventory-reservation.ts`; `domain/inventory-operation.ts` |
| API and authorization | List/get/events, draft create/edit/delete, submit, approve, reject, return, reverse approval, cancel and invoke routes, each guarded by a dedicated permission | `api/material-requests.controller.ts`; `api/dto/material-request.dto.ts`; `domain/material-request-permissions.ts` |
| Verification assets | Domain/unit coverage plus a real-PostgreSQL Material Request suite covering transaction, organization-isolation and concurrency behavior | `domain/material-request*.spec.ts`; `application/material-requests.service.spec.ts`; `backend/test/material-requests-live.e2e-spec.ts`; CI run `37100066679` |

The merged slice remains deliberately **non-valued and non-posting**: it does
not create a Warehouse Receipt/Issue, Inventory movement, cost/valuation state
or Accounting document. C-52 physical issue posting remains separate.

### 2.3 C-50 decisions made versus questions still open

| Matter | Decided for C-50 | Repository-wide status |
|---|---|---|
| Material Request lifecycle | **Decided and implemented for Material Request only** (§20.2) | **OQ-54 remains OPEN.** No platform-wide Option A/B/C was selected; no rule for openings, receipts, issues or Sales follows from C-50 |
| Approval authority and self-approval | **Decided and implemented for Material Request only** (§20.3) | **OQ-13 and OQ-26 remain OPEN.** C-50 does not define approval applicability, levels, delegation, escalation, role mapping or separation of duties for other document types |
| Reservation shape/release/consumption | **Decided and implemented**; OQ-66 is **RESOLVED** | Do **not** reopen OQ-66. A future C-52 does not need a new Material Request reservation-consumption rule, but still needs its own Issue document/movement/costing contract |
| Valuation/accounting | Explicitly absent from C-50 | OQ-11, OQ-24, OQ-39 and OQ-42 remain OPEN and continue to gate valued/accounting-integrated Inventory work |
| Generic Workflow binding | Not used; C-50 owns its bounded lifecycle | OQ-13/OQ-26 remain open; ADR-0024 supplies a mechanism, not universal business workflow content |
| Numbering extensions | Existing Documents numeric-series mechanism is used | OQ-12 remains OPEN for prefix/year/reset/gap policy beyond the bounded implementation |

This distinction is mandatory: C-50's specific Owner decisions make the merged
C-50 behavior no longer decision-pending in those narrow areas, but they do
**not** resolve platform-wide OQ-13, OQ-26 or OQ-54.

### 2.4 Current documentation/contract caveats

The merge left dated text that still says PR #112 is unmerged or `main` is
unchanged. This reconciliation adds current-state addenda rather than rewriting
those historical sections. Two other factual gaps remain visible and are not
silently repaired here:

1. `docs/modules.md` §Inventory still describes the pre-C-50 32-permission,
   movement/balance/reservation/transfer surface and does not catalogue Material
   Request.
2. `frontend/src/api/generated/vardena-api.d.ts` contains no Material Request
   path or schema. The C-50 investigation §19 item 5 records that regeneration
   was blocked; PR #112 did not change the generated declaration. This does not
   negate the backend merge, but the generated frontend contract and any
   compliant frontend feature remain a follow-up. No generated client is changed
   by this reconciliation.

---

## 3. Exact requested OQ wording and current status

Every row below is still in the **Open** table of `docs/open-questions.md`; the
quoted question is the registry's Question field, not a conclusion inferred
from its identifier.

| OQ | Exact registered question | Current status and actual dependency |
|---|---|---|
| **OQ-11** | “Ledger behavior specifics: double-entry chart structure, period close/reopen rules, opening balance import, cost accounting method for inventory (standard/moving avg/weighted)?” | **OPEN.** Gates accounting opening import and inventory costing/valuation; it does not define quantity-opening mechanics (`docs/open-questions.md`, OQ-11 row; dependency matrix §4) |
| **OQ-13** | “Approval workflows: do inventory movements / sales documents / journals need approval states? Negative stock allowed per policy?” | **OPEN.** Requires a document-type-specific applicability answer for C-48/C-51/C-52. C-50 has a narrow decision only; its answer cannot be generalized |
| **OQ-23** | “Fiscal calendar: fiscal year start (Gregorian vs Jalali-aligned), period layout (12 monthly? plus adjustment period?), close/reopen policy, whether posting into closed periods is ever allowed, and how year-end/opening entries are produced and approved” | **OPEN.** The mechanism exists, but year/opening production and approval policy remain open; `movement-type.ts` cites this as the reason no `opening` type exists |
| **OQ-24** | “Inventory valuation and stock policy: which costing method (moving weighted average / FIFO / standard), how returns, adjustments and negative stock affect cost, and whether negative stock is permitted at all” | **OPEN.** Gates every rial/valued flow and report. Its negative-stock half also affects quantity Issue/settings policy. The implemented default/configuration is not an Owner policy decision |
| **OQ-26** | “Approval policy: which transitions require approval, single vs multi-level, delegation and escalation, and separation-of-duties rules (e.g. creator may not approve their own document); which roles may approve which document types” | **OPEN.** Gates approval content wherever OQ-13 says approval applies. C-50 decides only its own permission/self-approval rule |
| **OQ-39** | “Durable integration semantics for system-generated accounting: is posting a transactional in-process subscription (the accounting effect commits with the source write — ADR-0005) or a durable queued/outbox delivery (AR-14, ADR-0004)? What happens to a source document whose posting is rejected (period closed, unbalanced, mapping missing) — is the source operation blocked, or does it stay posted with an accounting exception queue? Which accounting events must never be lost?” | **OPEN.** Gates system-generated Accounting effects, not quantity-only Inventory behavior |
| **OQ-42** | “System-generated posting policy: for each source module and document type, is the accounting document created directly final (Mode A) or as a temporary/draft that an accounting authority must finalize (Mode B)? What is the default? Who may finalize/approve, may the creator approve their own document (segregation of duties), what does rejection mean for the source document, and how is a backlog of unapproved accounting drafts governed?” | **OPEN.** Shapes an Accounting effect after OQ-39; irrelevant to a quantity-only read or document slice with no Accounting effect |
| **OQ-54** | “Finalized document deletion/editing policy: cancel-only vs edit-until-posted vs per-type configuration; visibility of canceled documents; numbering gaps (OQ-12); cancel approval coupling (OQ-13/OQ-26)” | **OPEN.** Gates the lifecycle of new opening/receipt/issue documents. C-50's own lifecycle is decided narrowly and does not close this row |

Additional dependencies are included only where repository evidence establishes
them:

- **OQ-12 (OPEN):** advanced numbering policy. The accepted Documents mechanism
  is sufficient for a bounded configured numeric series; prefix/year/reset or a
  different gap policy cannot be invented.
- **OQ-25 (OPEN):** account-mapping/control-role content; relevant only when an
  Inventory slice generates an Accounting effect.
- **OQ-49 (OPEN):** generic Report Builder depth only. It does **not** block a
  bounded, code-defined quantity Kardex (`backend-mvp-dependency-matrix.md` §4).
- **OQ-66 (RESOLVED):** Material Request reservation shape, release and
  invocation consumption. It is not a blocker and is not reopened.

---

## 4. Reconciled C-48…C-54 candidate status

| Candidate | Current `main` state | Blocks all implementation of the named operational slice | Blocks only rial/valuation or Accounting-integrated portion | Deferrable without violating an accepted contract | Readiness |
|---|---|---|---|---|---|
| **C-48 Opening quantity** | **NOT PRESENT.** Generic inbound posting exists, but no opening document/type, no `opening` movement type and no opening-specific document registration | **OQ-23** production/approval of opening entries; **OQ-54** lifecycle/correction; **OQ-13/OQ-26** applicability/content; an explicit Owner/accountant answer that an opening-quantity slice may intentionally create quantity before cost is assigned | **OQ-11/OQ-24** costing and valuation beyond the explicit unvalued boundary; OQ-25/OQ-39/OQ-42 if an Accounting effect is added | Advanced OQ-12 numbering extensions; generic Workflow if the Owner says no approval; valuation/posting only after an explicit quantity-only boundary | **BLOCKED — OWNER DECISION REQUIRED** |
| **C-49 Opening rial** | **NOT PRESENT.** `InventoryMovement` has no cost column or valuation state | Inherits C-48; **OQ-11 + OQ-24** are intrinsic because this candidate is valued; OQ-23/opening lifecycle remains inherited | **OQ-25** mapping, **OQ-39** delivery/failure semantics and **OQ-42** posting mode block the Accounting-integrated half. They could be deferred only from a separately admitted Inventory-only valuation sub-slice | Generic builder/export/print | **BLOCKED**; deepest dependency chain in this set |
| **C-50 Material Request** | **IMPLEMENTED AND MERGED** in PR #112; three models, two migrations, document type, API, 11 permissions, local lifecycle, reservations and invocation traceability; no value/posting | None for the already-merged narrow contract: its Material Request-specific lifecycle/approval/reservation decisions are recorded. **Owner acceptance is still absent** | Valuation, Inventory movements and Accounting are not part of C-50 | Platform-wide OQ-13/OQ-26/OQ-54, generic Workflow, notifications, advanced numbering, C-52 physical posting | **IMPLEMENTED — NOT ACCEPTED.** No further C-50 implementation is recommended by this report |
| **C-51 Warehouse Receipt quantity/rial** | **PARTIAL CORE.** Generic `inbound` posting, balances and idempotency exist; no Warehouse Receipt aggregate/document; no rial | Quantity document still needs **OQ-54** receipt-specific lifecycle/correction and **OQ-13/OQ-26** approval applicability/content, plus an accepted minimum Receipt contract and explicit authorization | **OQ-11/OQ-24** valuation/costing; **OQ-25/OQ-39/OQ-42** Accounting mapping/delivery/mode | Purchasing (post-MVP); valued/accounting effect if Owner explicitly authorizes an unvalued quantity slice; advanced OQ-12 numbering | **QUANTITY: READY FOR OWNER DECISION, not implementation. RIAL: BLOCKED** |
| **C-52 Warehouse Issue quantity/rial** | **PARTIAL CORE.** Generic `outbound` posting and availability enforcement exist; no Warehouse Issue aggregate/document; no rial | **OQ-54**, **OQ-13/OQ-26**, accepted minimum Issue contract, and the **negative-stock half of OQ-24** (or an explicit instruction to retain the current fail-closed contract for this document) | **OQ-11/OQ-24** cost-of-issue/valuation; **OQ-25/OQ-39/OQ-42** Accounting effect | C-50 is conceptually upstream, not a hard prerequisite. OQ-66 is already resolved; C-52 must use that invocation-consumption contract rather than redesign it | **QUANTITY: READY FOR OWNER DECISION but has more policy load than C-51. RIAL: BLOCKED** |
| **C-53 Stock/settings** | **PARTIAL.** Organization-scoped balances, availability, cross-warehouse availability, warehouse negative-stock setting, per-item override and `reservationsReduceAvailable` exist | No OQ blocks read-only quantity stock. Any claim that “settings” is complete needs Owner scope admission; changing/expanding negative-stock policy needs OQ-24 | **OQ-11/OQ-24** for rial stock/valuation | Accounting integration and generic reporting; no new policy is needed merely to investigate current quantity-read gaps | **QUANTITY: READY FOR INVESTIGATION but much is already implemented. RIAL: BLOCKED** |
| **C-54 Quantity/rial Kardex and reports** | **PARTIAL READ FOUNDATION.** Movement list and balance APIs exist; no running-balance Kardex contract, report definition/registry or Inventory report view | No business-policy OQ blocks a quantity Kardex. The remaining gate is architectural sequencing: bounded Inventory endpoint versus first C-14 Reporting consumer, under ADR-0009/reporting strategy | **OQ-11/OQ-24** for rial values/costing. OQ-39/OQ-42 are unnecessary unless the report depends on system-generated Accounting | **OQ-49** generic builder, export, print, dashboards and every rial column | **QUANTITY: READY FOR INVESTIGATION. RIAL: BLOCKED** |

### 4.1 Evidence behind the state column

- Quantity ledger/balance/reservation implementation:
  `backend/prisma/schema/inventory.prisma`,
  `application/inventory-movements.service.ts`,
  `application/inventory-balances.service.ts`, ADR-0022.
- No opening type: `domain/movement-type.ts` explicitly excludes it and cites
  OQ-23.
- No cost/valuation field: inventory schema comments above `InventoryMovement`
  and ADR-0022 Consequences (“no costing/valuation fields yet”).
- C-50 implementation: paths in §2.2 above.
- Existing read foundation: `GET /api/v1/inventory/movements` supports
  organization, branch, warehouse, item, type, transfer and date filters, but
  returns paginated movement facts without opening/running/closing quantity;
  `GET /api/v1/inventory/balances` returns current materialized balances.
- Reporting ownership: ADR-0009 and `docs/reporting-strategy.md` require
  module-owned sources and a code-defined Reporting registry/pipeline; the
  Reporting module is still absent (`docs/modules.md` §Reporting).

---

## 5. Decision dependency matrix

Legend:

- **ALL** — decision required before any implementation of the named operational
  document/scope;
- **VALUE** — required only for rial/valuation or Accounting integration;
- **MADE** — narrow candidate-specific decision exists; platform OQ may stay open;
- **DEFER** — may be excluded without contradicting an accepted contract;
- **INVESTIGATE** — architecture/scope investigation needed, not an unanswered
  business-policy option;
- `—` — no established dependency.

| Dependency | C-48 | C-49 | C-50 | C-51 | C-52 | C-53 | C-54 |
|---|---:|---:|---:|---:|---:|---:|---:|
| OQ-11 accounting opening/cost method | DEFER | **ALL** | DEFER | VALUE | VALUE | VALUE | VALUE |
| OQ-13 approval applicability | **ALL** | inherited | **MADE (MR only)** | **ALL** | **ALL** | — | — |
| OQ-23 year/opening production | **ALL** | inherited | — | — | — | — | — |
| OQ-24 valuation/negative stock | **ALL**† | **ALL** | DEFER | VALUE | **ALL**† + VALUE | settings policy + VALUE | VALUE |
| OQ-26 approval content/SoD | **ALL** | inherited | **MADE (MR only)** | **ALL if approval; explicit no-approval answer otherwise** | same | — | — |
| OQ-39 durable Accounting integration | DEFER | VALUE | DEFER | VALUE | VALUE | DEFER | DEFER |
| OQ-42 Accounting posting mode | DEFER | VALUE | DEFER | VALUE | VALUE | DEFER | DEFER |
| OQ-54 finalized document lifecycle | **ALL** | inherited | **MADE (MR only)** | **ALL** | **ALL** | — | — |
| OQ-12 numbering extensions | DEFER | DEFER | DEFER | DEFER | DEFER | — | — |
| OQ-25 account mapping content | DEFER | VALUE | DEFER | VALUE | VALUE | DEFER | DEFER |
| OQ-49 generic Report Builder | — | — | — | — | — | — | **DEFER** |
| OQ-66 MR reservation consumption | — | — | **MADE / RESOLVED** | — | **MADE / inherit; not a new design** | — | — |
| ADR-0009/C-14 read-surface sequencing | — | — | — | — | — | INVESTIGATE | **INVESTIGATE** |

`†` For C-48, the blocking question is whether a quantity opening may be
recorded before cost exists; no costing method need be selected if the Owner
explicitly admits that unvalued boundary. For C-52 quantity, the blocking part
is whether the current fail-closed/configurable negative-stock contract is the
approved Issue behavior; costing remains in the VALUE column.

---

## 6. Minimum Owner decisions for the next operational Inventory slice

The least decision-heavy **operational document** after C-50 is a bounded
**C-51 Warehouse Receipt — quantity-only, explicitly unvalued and
non-accounting** slice. C-48 additionally needs OQ-23/opening policy; C-52 adds
negative-stock and outbound-cost pressure. This report does not authorize C-51
or choose any answer.

Before a C-51 quantity implementation can be prepared, the Owner must record at
least:

1. **Bounded admission:** explicitly authorize a quantity-only/unvalued Receipt
   slice and defer rial valuation and Accounting effects. This is a scope split,
   not a selection of a costing method.
2. **OQ-54, Receipt-specific lifecycle:** define draft/final/posted boundaries;
   whether editing or physical deletion is ever allowed; how a stock-moving
   receipt is cancelled/corrected (counter-movement/reversal rather than editing
   immutable movement facts); canceled visibility; and number-gap treatment.
3. **OQ-13/OQ-26, Receipt-specific approval:** state whether approval applies.
   If yes, identify the transition, approver authority, self-approval rule,
   rejection/return behavior and whether generic Workflow is used. If no, record
   the explicit no-approval posture and direct permission-gated posting point.
4. **Minimum Receipt domain contract:** confirm that this is a manual Inventory
   receipt independent of Purchasing; required header/line facts; the business
   date; exactly when one receipt creates inbound movement(s); partial receipt
   posture if applicable; and correction/replay identity. These are contract
   facts, not implementation details that an agent may invent.
5. **Numbering boundary:** either accept the existing configured numeric
   Documents series/no-reuse behavior for this slice or identify the required
   OQ-12 extension. Prefix/year/reset/recycling must not be inferred.
6. **Task authorization:** approve an unnumbered/domain-equivalent brief through
   the governance process. A roadmap row or this recommendation is not
   authorization.

Not needed for that explicitly bounded quantity-only slice: selection of the
OQ-11/OQ-24 costing method, OQ-25 mappings, OQ-39 delivery semantics or OQ-42
posting mode. Those remain mandatory before adding receipt value or an
Accounting effect.

---

## 7. Recommended next slice

### 7.1 Recommendation

**Next action: investigate a bounded C-54 quantity Kardex as the first concrete
Inventory reporting consumer.**

**Readiness: READY FOR INVESTIGATION — not authorized or ready for production
implementation.**

This is the smallest meaningful candidate that advances Backend MVP without
waiting for an unresolved business-policy OQ:

- the immutable movement ledger and current balances already exist;
- quantity correctness is independent of valuation (D-06);
- OQ-24 blocks only the rial half here;
- OQ-49 blocks only a generic builder;
- no new operational document lifecycle or approval policy is needed;
- the work provides a real consumer to settle C-14/ADR-0009 sequencing rather
  than building a speculative general reporting platform.

C-53 quantity reads are also investigable, but current balances and
cross-warehouse availability already cover much of that surface. A quantity
Kardex adds the missing explainability path from opening quantity through each
immutable movement to a closing quantity.

### 7.2 Objective

Produce an implementation-ready, Owner-reviewable contract for one bounded,
organization-scoped **quantity stock card (Kardex)** over
`inventory.inventory_movements`, with deterministic running quantities and
reconciliation to `inventory_balances`, while preserving ADR-0009 ownership and
excluding all money/cost/accounting behavior.

### 7.3 Investigation scope

1. Compare the existing movement-list API with a true Kardex contract: required
   item/warehouse/date filters, opening quantity before the range, signed
   movement quantity, running quantity, closing quantity and source reference.
2. Resolve the implementation placement from accepted records:
   Inventory-owned view/read source plus the smallest C-14 Reporting
   registry/pipeline consumer, versus a temporary Inventory-owned bounded read
   endpoint following the Accounting precedent. Record why the selected path
   complies with ADR-0009; draft an ADR only if the accepted contract must
   change.
3. Define deterministic ordering for same-timestamp movements without inventing
   chronology; identify the stable tie-break key and pagination semantics.
4. Define organization authorization, one dedicated report/read permission,
   filter and sort whitelists, row/page caps and timeout behavior.
5. Specify fixture-to-expected-row regression tests, denial/IDOR tests,
   movement/balance reconciliation assertions, reversal/transfer handling and
   real-PostgreSQL query/ordering evidence required in CI.
6. Assess whether a view/index migration is necessary; do not presume one.
7. Produce a bounded brief and exact acceptance matrix for later Owner
   authorization.

### 7.4 Non-goals

- rial values, unit cost, total cost, valuation layers, COGS or Accounting
  entries;
- OQ-24/OQ-11 decisions;
- Warehouse Receipt/Issue/Opening implementation;
- changing Material Request or OQ-66 behavior;
- generic visual Report Builder, arbitrary grouping/pivoting or user-authored SQL;
- Excel/PDF/print, Jobs, Notifications, dashboards or frontend UI;
- changes to movement immutability, balance math, negative-stock policy, Prisma
  schema, APIs, permissions or tests during the investigation itself.

### 7.5 Investigation acceptance criteria

- [ ] Current movement/balance read capabilities and exact gaps are evidenced
      from code, DTOs, schema and tests.
- [ ] Ownership/placement is reconciled against ADR-0009,
      `docs/reporting-strategy.md` and the Accounting read precedent; any actual
      conflict is recorded rather than silently selected.
- [ ] Quantity-only response semantics are explicit: opening, signed movement,
      running and closing quantities; units; reversal and transfer treatment;
      date boundary and deterministic order.
- [ ] Authorization, organization isolation, permission name, filter/sort
      whitelist, pagination/caps and timeout posture are specified.
- [ ] Query/view/index plan and fixture/performance/live-PG verification plan are
      reviewable and do not require valuation or a generic builder.
- [ ] OQ analysis explicitly shows OQ-11/OQ-24 as rial-only for this slice,
      OQ-49 as deferred and OQ-13/OQ-26/OQ-54 as irrelevant to a read-only
      immutable-ledger report.
- [ ] Objective, scope, non-goals, dependencies and later production acceptance
      criteria are complete enough for the Owner to authorize or reject a
      subsequent implementation task.
- [ ] No task number, implementation authorization, OQ resolution, ADR promotion
      or acceptance claim is created by the investigation.

---

## 8. Explicit decisions ledger

### Already made and binding for this reconciliation

- ADR-0022: quantity movement ledger/balance/reservation implementation contract,
  including the existing fail-closed/configurable negative-stock mechanism.
- ADR-0023: typed business ownership, code-registered document types, numbering
  and logical relations.
- ADR-0024: reusable Workflow mechanism; no universal business workflow content.
- ADR-0009: module-owned report sources and code-defined Reporting
  registry/pipeline architecture.
- C-50 Material Request-specific lifecycle, approval authority, return,
  cancellation/reversal and reservation rules in investigation §§20–21.
- OQ-66: **RESOLVED**; invocation consumes a Material Request line reservation.

### Still open and not selected here

- OQ-11, OQ-13, OQ-23, OQ-24, OQ-26, OQ-39, OQ-42 and OQ-54;
- OQ-12 extensions, OQ-25 mapping content and OQ-49 generic builder depth;
- every C-48/C-49/C-51/C-52 lifecycle, approval, valuation and Accounting
  policy not explicitly identified above;
- C-53 completion scope and the final C-54 implementation placement;
- Owner acceptance of C-50 and authorization of any next implementation.

---

## 9. Verification record

### Repository and GitHub

- `git fetch origin main --prune`;
- `git rev-parse HEAD origin/main main` — all equal `ca981018...`;
- clean initial `git status --porcelain=v1`;
- `gh pr view 112` — merged state, merge SHA, files and PR checks;
- `gh run view 37100066679` — exact merge-commit push CI successful for backend
  and frontend.

### Static evidence

- Inspected current C-50 schema, both migrations, module wiring, lifecycle,
  permissions, controller, repository and tests;
- inspected current movement and balance controllers/services/repositories/DTOs;
- searched current schema for valuation/cost fields and confirmed none on
  `InventoryMovement`;
- confirmed no `opening` movement type;
- confirmed no Material Request symbol in the committed frontend generated API
  declaration;
- confirmed no C-50 acceptance record;
- reconciled exact OQ registry wording and ADR statuses.

### Tests

No production code changed, so no local application test was run. Per
`docs/testing/test-execution-policy.md`, no heavy E2E/live-DB test was executed
locally. Existing C-50 runtime evidence is the successful exact-main CI run
`37100066679`; it is verification evidence, not acceptance.

---

## 10. Final status

**READY FOR REVIEW**

The recommended next slice is **READY FOR INVESTIGATION**. The next operational
Inventory document slice (C-51 quantity Receipt) is **READY FOR OWNER DECISION**
but not for implementation. C-49 and every rial/valuation/accounting-integrated
portion remain **BLOCKED** by their recorded decisions.
