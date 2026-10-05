# Vardena — Backend MVP Dependency Matrix

| | |
|---|---|
| Status | **READY FOR REVIEW — NOT ACCEPTED** |
| Date | 2026-09-27 |
| Type | Roadmap companion (documentation only) |
| Inspection baseline | `main` @ `c654be916fe75e25ff2862900994c86aa1c20892` |
| Parent | [backend-mvp-roadmap.md](./backend-mvp-roadmap.md) |
| Production code changed | **NONE** |

> **Governance re-baseline addendum (2026-10-05).** The Owner decided
> platform-wide **OQ-54** (Option B — **edit until Accounting Post, then
> cancel/correct only**, with mandatory side-effect transparency, the
> negative-inventory hard block and never-silent repricing; OD-54-01…11, full
> record `../decisions/product/OQ-54-finalized-document-deletion-editing.md`,
> backend contract **ADR-0040 Proposed**) and **OQ-49** (standard reports +
> controlled customization). Rows below that list OQ-54 as OPEN/blocking are
> superseded on the *policy* dimension only: the lifecycle/edit posture is now
> decided, while OQ-13/OQ-26 (approval coupling), OQ-23, OQ-12 gap policy,
> per-document contracts and normal Owner task gating still apply. **OQ-65's
> reuse question is also decided** (a barcode is never reusable within the
> organization — OD-65-01; comparison semantics still block C-55). MVP
> completion is re-based on the **Initial Usable Product / V1**
> (`../decisions/product/PDR-06-initial-usable-product-v1.md`). This addendum
> closes no other OQ, promotes no ADR and authorizes no implementation.
>
> **Current-state addendum (2026-10-02, baseline `main` @ `4cf481efa2de5ca9863d9d434c2ab707de23301a`, merge of PR #107).**
> Four Owner decisions were recorded for the Inventory item master —
> **OD-C47-01** (OQ-29 Option A: fixed four-decimal quantity precision, reject
> non-representable conversion results, no rounding/truncation, effective-dated
> factor versions, preserved history), **OD-C47-02** (OQ-33 Option D: new kinds
> or capability flags only through an accepted concrete need; **Option A is not
> approved** and the taxonomy/capability confirmation stays OPEN),
> **OD-C47-03** (barcode Option A: optional barcode, organization-scoped
> uniqueness, two active items must not collide, cross-organization reuse
> allowed, multiple formats without strict symbology, no multi-barcode support)
> and **OD-C47-04** (OQ-36 Option C: physical deletion only for never-referenced
> items; **code reuse stays OPEN**). **OQ-29, OQ-33 and OQ-36 all remain OPEN**,
> and the new **OQ-65** records the barcode lifecycle/reuse question. C-47 is
> merged with green CI (PR #107) and **not accepted**. Records:
> [`../decisions/product/README.md`](../decisions/product/README.md) (PDR-01…PDR-04, OQ-65) and
> [`../tasks/c-47-owner-decision-and-dependency-reconciliation.md`](../tasks/c-47-owner-decision-and-dependency-reconciliation.md).
> This addendum closes no OQ, promotes no ADR and authorizes no implementation.
>
> **Post-C-50 addendum (2026-10-03, `main` @ `ca981018`, merge of PR #112).**
> C-50 is **IMPLEMENTED AND MERGED — NOT ACCEPTED**. Its Material
> Request-specific lifecycle and approval-authority decisions do not close
> platform-wide OQ-13/OQ-26/OQ-54; OQ-66 remains RESOLVED. The reconciled next
> dependency-ready step is a bounded **C-54 quantity Kardex investigation**:
> no business-policy OQ blocks quantity, but the investigation must settle its
> ADR-0009/C-14 placement. Rial/valuation remains blocked by OQ-11/OQ-24. *(Superseded in part on 2026-10-04 — see the valuation-foundation addendum below: the valuation half of OQ-24 is partially answered and implemented; OQ-11 and the posting chain are not.)*
> Full evidence:
> [`../tasks/post-c-50-dependency-reconciliation-and-next-slice-readiness.md`](../tasks/post-c-50-dependency-reconciliation-and-next-slice-readiness.md).
> No implementation or acceptance is authorized.
>
> **Valuation-foundation addendum (2026-10-04, branch `arena/01a107dc-vardena`,
> open PR for review — ADR-0039 Proposed, PDR-05 / OD-VAL-01…OD-VAL-19).**
> The statement "the movement ledger has **no cost column of any kind**" is no
> longer true: `inventory_movements` now carries a signed `total_cost` plus
> `valuation_status`/`valuation_source`/`valued_at`/`valuation_run_id`, and three
> valuation tables exist (effective-dated method configuration per organization +
> item, state per organization + warehouse + item, and an audit record per
> repricing run). **Cost is optional on a receipt and never entered on an issue.**
> Rows below are annotated individually. OQ-24 stays **OPEN** — returns costing,
> COGS/journal posting, landed cost and valuation precision were explicitly not
> decided — and OQ-11/OQ-25/OQ-39/OQ-42 are untouched, so every *Accounting*
> dependency in this matrix is unchanged. Merge and green CI are not acceptance.
>
> **Current-state addendum (2026-09-29):** this matrix's original baseline is a
> dated planning snapshot. Current `main` `34dddfd` includes Task 30's bounded
> Account Nature/Type/Detail foundation and Task 32's Dashboard corrected by PR
> #86. The generic multi-dimension model, Reporting module, durable
> Inventory→Accounting integration, Sales, Purchasing and Treasury remain absent.
> See [`../current-state-reconciliation.md`](../current-state-reconciliation.md).
>
> Companion to the Backend MVP Roadmap. Classifies modules, capabilities,
> dependencies, gating OQs/ADRs and MVP posture **as verified on `main`**. It
> authorizes nothing; statuses are transcribed, not promoted. Status
> vocabulary: `ACCEPTED` · `IMPLEMENTED — NOT ACCEPTED` · `IMPLEMENTED (review
> UNKNOWN)` · `PARTIAL` · `NOT PRESENT` · `DOCUMENTED BUT NOT IMPLEMENTED` ·
> `BLOCKED BY OQ` · `BLOCKED BY ADR` · `BLOCKED BY OWNER ADMISSION` ·
> `POST-MVP / DEFERRED`.

---

## 1. Module dependency matrix

| Module | Current state (verified) | Upstream dependencies (exist) | Downstream dependents | Gating OQs | Gating ADRs | MVP posture |
|---|---|---|---|---|---|---|
| health | IMPLEMENTED | kernel | — | — | — | IN MVP (done) |
| identity | PARTIAL (login/logout/me; no session list/revoke, no self password change, no forced change) | users (password verify), rbac (effective permissions at login) | users, rbac, all authenticated surfaces | OQ-06 (TLS/session policy), OQ-19 (admin safety) | ADR-0007 Accepted | IN MVP — completion candidate (Phase 6.3) |
| users | IMPLEMENTED | identity (sessions on disable), rbac | identity, bootstrap | OQ-18 (delete policy), OQ-19 | ADR-0006 Accepted | IN MVP (done) |
| rbac | IMPLEMENTED | users, identity | every module (permissions) | OQ-14 (role baselines), OQ-20 (registry lifecycle), OQ-21 (no wildcards — posture) | ADR-0006/0016 Accepted | IN MVP (done) |
| organization | PARTIAL (structure + party master + memberships + `assertOrganizationInScope`; configuration half absent) | users, rbac | every organization-scoped module | OQ-01/OQ-22 (tenancy/scope), OQ-36 (lifecycle), OQ-37/OQ-38 (party detail) | ADR-0020 Proposed, ADR-0021 Proposed, ADR-0025 Accepted | IN MVP — party completion candidate (Phase 3A, OQ-38) |
| inventory | PARTIAL (master data + movement ledger/balances/reservations/transfers + **C-50 Material Request merged, not accepted**; openings, Receipt/Issue documents, valuation and reports incomplete) | organization, documents (numbering/relations); workflow mechanism if a future document admits it; accounting only for rial effects | Accounting integration, Sales inventory effects, Inventory reports | OQ-11 (accounting opening import + costing method), OQ-24 (valuation/negative stock), OQ-29 (units/conversions — **partially resolved by OD-C47-01, 2026-10-02**), OQ-33 (item model — **governance rule OD-C47-02 only; taxonomy confirmation still withheld**), **OQ-65** (barcode lifecycle/reuse), OQ-36 (deletion/code reuse), OQ-23/OQ-54/OQ-13/OQ-26 for future operational documents. C-50 has narrow own lifecycle/approval decisions; OQ-66 RESOLVED | ADR-0022/0023/0024 Accepted; ADR-0017 Proposed (code ahead of governance) | **IN MVP — Full Inventory/Warehouse required; remaining details are implementation candidates** |
| documents | IMPLEMENTED | organization | inventory (numbering), accounting (serials), future sales | OQ-12 (numbering policy extensions) | ADR-0023 Accepted | IN MVP (done) |
| workflow | IMPLEMENTED | organization | any module using approvals (none wired to business docs yet) | OQ-13, OQ-26 (approval content) | ADR-0024 Accepted | IN MVP (done) |
| accounting | PARTIAL (deepest: foundation → chart/configurations → documents → posting/ledger → projection → reversal → read surfaces → Base Chart mechanism) | organization (scope/memberships), documents (numbering), rbac | future reporting consumers, future source-module integrations | OQ-25/36/41/43 (content), OQ-23 (calendar), OQ-27 (corrections), OQ-39/42 (system posting), OQ-62/63 (pins) | ADR-0026/0028 Accepted; ADR-0031/0032 Proposed (implemented); ADR-0033…0037 Proposed | IN MVP — Phase 1 completion |
| audit | NOT PRESENT | (design: consumes events from all modules) | — | OQ-17 (retention), OQ-14 (auditor role) | none (security.md §4 design is Accepted foundation) | IN MVP scope decision required (Phase 6.2) |
| notifications | NOT PRESENT | events | — | OQ-15 | none | NOT ADMITTED (post-MVP unless Owner decides) |
| sales | NOT PRESENT | organization (parties), documents, inventory (stock effect), workflow (approvals), accounting (integration Phase 4D) | reporting (sales views), accounting | OQ-54, OQ-30, OQ-34, OQ-35, OQ-38; OQ-15 (stock-on-sale) | none | **IN MVP — REQUIRED; implementation/domain contract still gated** |
| purchasing | NOT PRESENT | none for MVP; distinct from Inventory Receipt/Issue | future purchasing reports/accounting | OQ-16 | none | **POST-MVP** |
| reporting | NOT PRESENT (Accounting owns bounded read surfaces) | module-owned views / read sources | excel (export), print (printing), frontend | OQ-25/OQ-43 (new/legal layouts), OQ-49 (builder), OQ-02 (labels) | ADR-0009 Accepted (architecture); ADR-0036 Proposed (legal outputs) | **IN MVP — Accounting, Inventory, Sales and legal/accounting outputs; bounded** |
| excel | NOT PRESENT | reporting pipeline (export), modules (import specs) | — | OQ-46 (recorded posture: XLSX export of reports/lists confirmed channel), OQ-08 (artifacts) | ADR-0011 Accepted (decision) | IN MVP — bounded export (Phase 2C) |
| print | NOT PRESENT | reporting, worker/jobs (PDF) | — | OQ-02 (labels/locale) | ADR-0012 Accepted (decision) | IN MVP — bounded (Phase 2D), depends on Phase 5 evaluation |
| customization | NOT PRESENT | — | frontend (grid persistence) | OQ-09 | ADR-0013 Accepted (decision) | NOT ADMITTED for MVP unless Owner decides |
| integration | NOT PRESENT | sync (outbox), adapters | — | OQ-04 (legacy), OQ-05 (taxpayer), OQ-07 (payments) | ADR-0003 Accepted (boundary) | POST-MVP |
| sync (outbox) | NOT PRESENT | — | integration, external delivery | OQ-39 | ADR-0004 Accepted (decision) | admitted only if Phase 4/5 requires (OQ-39) |
| jobs | NOT PRESENT (JobsRegistry stub) | — | print/PDF, async reports, backups | — | ADR-0010 Accepted (decision) | admitted only if a capability requires (Phase 5) |
| **treasury** | **NOT PRESENT** | — | — | — | — | **DEFERRED — OUT OF MVP** (not a final-gate dependency) |

---

## 2. Capability dependency matrix (Accounting-focused)

Verified against `docs/accounting/task-index.md` §4 (authoritative candidate map), `docs/accounting/domain-contract.md` §28.2 (gates), and code.

| Capability | State on `main` | Depends on | Blocking OQ | Blocking ADR | MVP required? |
|---|---|---|---|---|---|
| Fiscal calendar foundation | IMPLEMENTED — ACCEPTED (Task 11 context; 10.2) | — | OQ-23 for policy only | ADR-0026 Accepted | Yes (done) |
| Chart of accounts + coding structures | IMPLEMENTED (10.3); pin coherence ODR-1 | — | OQ-62/63 (repair policy open) | ADR-0028 Accepted | Yes (done) |
| Accounting configurations + operational freeze | IMPLEMENTED (11 ACCEPTED; 13 merged/not accepted) | chart | OQ-64 RESOLVED | ADR-0028 Accepted | Yes (done; Task 13 acceptance pending) |
| Vouchers + atomic posting + immutable ledger | IMPLEMENTED (10.4–10.8) | calendar, chart, documents numbering | — | ADR-0026 Accepted | Yes (done) |
| Balance projection + rebuild | IMPLEMENTED (12 ACCEPTED WITH FOLLOW-UP) | ledger | — | ADR-0031 Proposed | Yes (done); **P1 real-PG concurrency verification OPEN** |
| Period-close enforcement | IMPLEMENTED (14 merged/not accepted) | calendar, posting | OQ-23 (policy remains) | ADR-0032 Proposed | Yes (behavior live; acceptance pending) |
| Document reversal | IMPLEMENTED (15 merged; review UNKNOWN) | documents, posting | OQ-27 (windows) | — | Yes (done); acceptance record missing |
| Read layer: ledger movements / account statement / GL / TB / chart tree | IMPLEMENTED — ACCEPTED (17A, 17B, 18, 19-ODR2) | ledger | OQ-25/OQ-43 only for NEW layouts | ADR-0009 Accepted | Yes (done) |
| Base Chart template + adoption **mechanism** | IMPLEMENTED — NOT ACCEPTED (23) | chart, configurations | OQ-25 (content), OQ-36 (prerequisites) | ADR-0037 Proposed | Mechanism done (acceptance pending); content is Phase 1A |
| Base Chart **content** (codes, Persian titles, natures, mandatory list) | NOT PRESENT (deliberately not invented) | mechanism + approval | **OQ-25 + OQ-36** | ADR-0037 Proposed | Phase 1A — decision-gated |
| Control roles (catalog + effective-dated mapping) | NOT PRESENT | a consumer (posting rules or reporting) — consumer-first | **OQ-25** | ADR-0037 Proposed | Phase 1C — decision-gated |
| Generic multi-dimension model (beyond Task 30's bounded Detail hierarchy/account-link/one-line-allocation foundation) | PARTIAL — bounded Detail foundation exists; full conceptual model NOT PRESENT | chart | **OQ-41** | ADR-0037 Proposed | Phase 1D — decision-gated |
| Account code history / pre-use correction producer | NOT PRESENT (repo stricter: immutable from creation) | OQ-36 answers | OQ-36, OQ-25 | ADR-0033 Proposed | Phase 1B — decision-gated |
| Corrections (correction/difference, replacement, adjustment) | NOT PRESENT (contract-only) | posting, periods | **OQ-27** | — | Phase 1E — decision-gated |
| Year-transition / opening carry-forward | NOT PRESENT (explicitly excluded from projection) | calendar | **OQ-23** | — | Phase 1F — decision-gated |
| Posting rules / account mapping | NOT PRESENT | chart, roles | OQ-24, OQ-25, OQ-30 (+ OQ-39/42 for activation) | — | Phase 1G — required only if integration admitted |
| Inventory → Accounting integration | NOT PRESENT (no consumer; in-memory bus only) | posting rules + OQ-39 decision | **OQ-39** (+24/25/30, 42) | ADR-0005 Accepted (contract); new ADR likely for delivery semantics | **MVP REQUIRED — Phase 4C decision-gated** |
| Electronic Books / Tax Accounting / Iranian legal outputs | NOT PRESENT | Accounting read models, validated legal/domain samples | reporting, MVP final gate | **OQ-43 — every legal fact/format requires validation** | ADR-0036 Proposed | **IN MVP — REQUIRED capability; implementation gated** |
| Code Structure Migration Service | NOT PRESENT — explicitly not authorized | code history, licensing, backup | OQ-45, OQ-52/53, OQ-62/63 | ADR-0035 Proposed; ADR-0030 Proposed | **POST-MVP** |
| Settlement / allocation (Task 16) | NOT PRESENT | contract finalized; implementation authorization BLOCKED | Owner confirmation | — | **BLOCKED**; bounded by Treasury deferral |

---

## 3. Full Inventory / Warehouse capability matrix

| Capability | State on `main` | Dependency / boundary | Blocking OQ/ADR | MVP posture |
|---|---|---|---|---|
| Warehouse coding/master | VERIFIED COMPLETE as master data (list/get/create/update/enable/disable, organization + branch scope, org-scoped code uniqueness, lifecycle freeze guards) — `docs/tasks/task-33/*`, no separate Owner acceptance record; stock locations/bins, costing, valuation and opening remain future slices | organization scope; Inventory ownership | OQ-22/OQ-33 (preserved, not resolved) | **MVP REQUIRED — master-data candidate hardened; broader Full Inventory/Warehouse operational flow still a candidate** |
| Product/item coding, attributes, units, barcode | **PARTIAL — master implemented + regression-hardened (C-47 hardening slice); barcode policy DECIDED 2026-10-02 (OD-C47-03, Option A) but NOT implemented: `inventory.items.barcode` still has no uniqueness constraint** | item model and unit/conversion contracts | OQ-33 (taxonomy confirmation withheld), **OQ-65** (barcode uniqueness shape — reuse after deactivation), OQ-36 (code reuse). OQ-29 no longer blocks the shipped behavior (OD-C47-01 Option A matches it) | **MVP REQUIRED — candidate (remains blocked by OQ); merge + green CI is not Owner acceptance** |
| Opening quantity | NOT PRESENT — deliberately no `opening` movement type, opening document or opening document-type registration (Inventory now registers only C-50 Material Request) | Inventory master/movement; Documents Foundation (now proven by C-50); opening policy | **OQ-23** production/approval · **OQ-54** lifecycle/correction · OQ-13/OQ-26 approval · explicit OQ-24 boundary allowing quantity before cost. **OQ-11 governs accounting import/costing, not quantity mechanics** | **MVP REQUIRED — BLOCKED / READY FOR OWNER DECISION** |
| Opening rial | NOT PRESENT as complete operational flow. **Corrected 2026-10-04:** the ledger DOES now have a cost column (signed `total_cost`, ADR-0039); what is absent is the opening *document* and the Accounting posting path | Opening quantity + Accounting posting path + valuation model (**valuation model now present**) | OQ-24 (returns/COGS halves still open) · OQ-11 · OQ-25 · **OQ-39** (durable posting) · **OQ-42** (posting mode) | **MVP REQUIRED — candidate; strictly after the OQ-39/OQ-42 chain** |
| Material Request | **IMPLEMENTED AND MERGED — NOT ACCEPTED** (PR #112, `ca981018`): Inventory-owned header/line/event models, two migrations, code-registered document type/numbering, lifecycle/API, 11 permissions, optional exact reservations and invocation traceability/consumption | Documents Foundation (ADR-0023 Accepted); item/warehouse/reservation foundations; narrow Owner decisions in the [C-50 brief](../tasks/c-50-material-request-investigation.md) §§20–23 | No open decision blocks the merged narrow contract. Material Request-specific lifecycle/approval decisions do **not** close platform OQ-54/OQ-13/OQ-26; **OQ-66 RESOLVED**. Generated frontend declaration and Owner acceptance remain absent | **MVP REQUIRED — IMPLEMENTED AND MERGED — NOT ACCEPTED** |
| Receipt quantity / rial | PARTIAL core (`inbound` postings, balances, idempotency); **movement-level rial PRESENT since 2026-10-04 (optional cost, late assignment — ADR-0039)**; Receipt *document* absent | Inventory movement; new Receipt aggregate/contract | **Quantity:** OQ-54 + OQ-13/OQ-26 + minimum contract/authorization. **Rial/Accounting:** valuation decided (OD-VAL-05/06); posting still OQ-11 + OQ-25/OQ-39/OQ-42 | **MVP REQUIRED — quantity READY FOR OWNER DECISION; rial posting BLOCKED (valuation no longer blocking)** |
| Issue quantity / rial | PARTIAL core (`outbound` postings + availability); **cost of issue is derived automatically since 2026-10-04 (never operator-entered — OD-VAL-07/ADR-0039)**; Issue *document* absent | Inventory movement; new Issue aggregate/contract; C-50 optional upstream relation | **Quantity:** OQ-54 + OQ-13/OQ-26 + minimum contract; negative-stock posture **retained as reject by OD-VAL-17**. **Rial/Accounting:** costing decided; posting still OQ-11 + OQ-25/OQ-39/OQ-42. OQ-66 already RESOLVED | **MVP REQUIRED — quantity READY FOR OWNER DECISION with more policy load than Receipt; rial posting BLOCKED (costing no longer blocking)** |
| Stock management/settings | PARTIAL but substantial: organization-scoped sortable balances, availability and cross-warehouse availability; negative-stock warehouse/item policy; `reservationsReduceAvailable`; **valuation state (valued quantity, total value, uncosted quantity, health) readable since 2026-10-04** | movement → balance; configured availability behavior | Owner scope admission for undefined remaining “settings”; OQ-24 for negative-stock policy *changes* (**reject retained by OD-VAL-17**); **OQ-11** for accounting-side rial | **MVP REQUIRED — quantity gaps READY FOR INVESTIGATION; rial state readable, remaining rial scope awaits Owner admission** |
| Quantity/rial stock and Kardex | **Quantity Kardex IMPLEMENTED (C-54, PR #115)**; rial Kardex not built, but **its data now exists** (per-movement signed `total_cost` + `valuation_status`, ADR-0039) | Immutable movement ledger (present); valuation state (**present since 2026-10-04**); ADR-0009/C-14 placement still to settle | **OQ-11** for the accounting side; OQ-24's valuation half no longer blocking. **OQ-49 blocks only a generic builder** (§4) | **MVP REQUIRED — quantity Kardex IMPLEMENTED (not accepted); rial Kardex candidate, gated by OQ-11 + report placement** |
| Unvalued Receipt/Issue reports | NOT PRESENT as a report; **the underlying state is now first-class and queryable** (`valuation_status = 'unvalued'` per movement, `status = 'pending_cost'` per key, `GET /inventory/valuation/states?status=…`) | rial flow (**valuation state present since 2026-10-04**) | Report placement (ADR-0009/C-14); OQ-24 no longer blocks the *concept* of an unvalued document | **MVP REQUIRED — candidate; data dependency satisfied, report not built** |
| Movement/analysis/management reports | NOT PRESENT | bounded module-owned views | **OQ-49 only if a generic builder is proposed**; bounded code-defined reports are not blocked by it (§4) | **MVP REQUIRED — candidate** |

Warehouse Receipt is Inventory/Warehouse MVP; Purchasing is POST-MVP. These are separate capabilities and dependencies.

## 4. OQ dependency matrix

Only OQs load-bearing for Backend MVP, inspected on `main`. **None is closed by the roadmap.**

| OQ | Topic | Current status (registry) | Blocks | Can be deferred? | Required before Backend MVP? |
|---|---|---|---|---|---|
| OQ-01 | Tenancy (single-org deployment vs multi-org instance) | OPEN (ODR-3 invariant implemented; product question open) | deployment posture, cloud path, any multi-org feature | Yes (single-org posture stands) | No — not a blocker; record posture for the final gate |
| OQ-02 | UI language / Jalali / number formats | OPEN | frontend display, report labels, print templates | Yes for backend MVP; blocks frontend polish | Only if print/report labels are admitted (Phase 2D) |
| OQ-11 | Ledger policy: opening balances, costing method | OPEN | opening **accounting** balances, valuation reporting. **Verified 2026-10-02:** the registry text is an *Accounting* question (double-entry chart structure, period close/reopen, opening balance **import**, inventory **cost accounting method**); it does not describe inventory quantity-opening mechanics, which are gated by OQ-24/OQ-23/OQ-54 | Partially (manual vouchers work) | Only if opening-balance flow or valuation reporting admitted |
| OQ-12 | Numbering policy (year component, gaps) | OPEN (mechanism exists via Document Foundation) | numbering extensions | Yes | No — mechanism sufficient |
| OQ-14 | Occupational role set / baselines | OPEN | RBAC seeding beyond bootstrap role, auditor separation | Yes | No — but Phase 6 audit-surface decision references it |
| OQ-16 | Purchasing in initial release? | OPEN (recorded posture: post-v1) | Purchasing module | Yes (manual receipts cover) | No — Purchasing is POST-MVP unless re-admitted |
| OQ-19 | Administrator safety (self-disable, last-admin lockout) | OPEN | users/rbac protections | Recommended no | **Yes for hardening phase (6.4)** — production deployment with a lockable last admin is a real risk |
| OQ-22 | Organizational scope / branches / separate books | OPEN | branch semantics, multi-company | Yes | No — single-entity posture stands |
| OQ-23 | Fiscal calendar policy (close/reopen authority, year-end entries) | OPEN (mechanism enforced by Task 14 behavior) | year-transition ops, opening carry-forward, closed-period policy | Partially | **Yes if Phase 1F admitted**; otherwise no |
| OQ-24 | Inventory valuation / negative stock | **OPEN — partially resolved 2026-10-04 by OD-VAL-01…OD-VAL-19 (PDR-05, ADR-0039).** Decided and implemented: perpetual inventory, Moving Weighted Average as the only active method, effective-dated configuration per organization + item, state per organization + warehouse + item, cost optional on receipts and derived on issues, two-step backdating confirmation, bounded deterministic recalculation, **negative stock retained as reject (OD-VAL-17)**. Still open: returns costing, COGS/journal posting, landed cost, valuation precision/currency (OQ-03/OQ-11), plus new OQ-67/OQ-68/OQ-69 | Remaining: **Inventory → Accounting posting** and any rial *report* presentation; the valuation model itself is no longer a blocker for C-51/C-52/C-53/C-54 | Yes for the remaining accounting mapping, not for capability admission | **Partially — no longer the gate for movement-level valuation; still the gate for returns costing and accounting mapping** |
| OQ-25 | Chart content / control roles / layouts | OPEN — substantially narrowed (Tasks 20/21); content values + role catalog remain. **OD-27-02 (DECIDED 2026-09-27): MVP-scope sub-question decided — Base Chart mechanism in MVP, concrete content set NOT MVP-required** | Base Chart content (Phase 1A loading), control roles, new report layouts | Yes for the MVP boundary (OD-27-02: concrete content not required); Phase 1A loading remains decision-gated | **No for the Base Chart content set (OD-27-02, 2026-09-27)** — the remaining OQ-25 content decisions gate Phase 1A content loading and content-dependent consumers (e.g. C-13 posting-rule mapping), not the MVP mechanism boundary |
| OQ-27 | Correction windows / cross-period corrections | OPEN | corrections beyond reversal | Partially | Only if Phase 1E admitted |
| OQ-29 | Quantity precision / unit conversions | **OPEN — partially resolved by OD-C47-01 (2026-10-02, Option A):** fixed four-decimal precision, reject non-representable conversion results, no rounding/truncation, effective-dated factor versions, preserved history. Still open: per-unit entry precision, global-vs-item-specific precedence, explicit-vs-derived reverse pairs, the exactness boundary for future consumers, valuation precision, back-dated-version authority | Inventory quantity contract inherited by C-48…C-54 and any future document line math | Yes for the remaining sub-questions | **No longer a blocker for the shipped item-master behavior**; the decided rule equals current code |
| OQ-33 | Item taxonomy and capabilities | **OPEN — OD-C47-02 (2026-10-02) decides Option D (governance rule) only; Option A is explicitly NOT approved** and the Owner has not confirmed the eight kinds or the per-item capability model | New kinds/flags; any claim that the item master is complete | Yes — the model is frozen meanwhile | **Yes before C-47 can be called complete**; it does not block C-50 |
| OQ-65 | Barcode lifecycle, reuse and comparison semantics | **OPEN — opened 2026-10-02 by OD-C47-03.** May a deactivated item's barcode be reused? Case/whitespace/digit normalization? Inactive-vs-inactive collisions? Re-activation conflicts? | The shape of any barcode uniqueness constraint (plain vs partial unique index) — candidate C-55 and nothing else | Yes | No — only the barcode-uniqueness candidate waits on it |
| OQ-30 | Tax model | OPEN | Sales tax fields, Sales → Accounting, legal/tax outputs | Yes for rules, not capability admission | **Yes — implementation gate** |
| OQ-36 | Master-data lifecycle (deletion, code reuse) | **OPEN — partially resolved by OD-C47-04 (2026-10-02, Option C):** physical deletion only for never-referenced items; referenced items never physically deleted; history and organization-scoped identity preserved. **Code reuse after physical deletion remains OPEN**, as do case-sensitivity policy, soft-vs-hard delete shape, the race-free reference proof, the delete permission/audit model, and whether the rule extends beyond items. Task 21 §10 Base Chart prerequisites are **not** satisfied | Base Chart content loading, code history producer, candidate C-56 (item deletion) | No — Task 21 §10 lists the three prerequisites | **Yes for Phase 1A/1B and for any delete implementation** |
| OQ-38 | Party detail (contacts/addresses/identifiers) | OPEN | party completion, statutory-facing sales docs | Yes (flat party works for MVP) | Only if Sales with statutory fields admitted |
| OQ-39 | Durable integration semantics | OPEN — **gates all system-generated posting**. **Verified 2026-10-02: it does not gate quantity-only inventory behavior** | Inventory/Sales → Accounting, outbox admission, rejected-posting semantics; the rial halves of C-49/C-51/C-52 | No for required capability; yes for implementation shape | **Yes — implementation gate** |
| OQ-40 | Financial areas (count, grants, default) | OPEN (interim: one area, structural access) | area grants, per-area charts | Yes | No — interim posture stands |
| OQ-41 | Detail dimensions (count/defaults/binding) | OPEN (OD-20-6 decided line-level boundary) | dimensions implementation | Partially (account-tree-only postings work) | Only if Phase 1D admitted |
| OQ-42 | Posting modes (A direct / B review) | OPEN. **Verified 2026-10-02:** it shapes the accounting effect once OQ-39 is answered and is irrelevant to quantity-only flows | system posting activation; rial halves of C-49/C-51/C-52 | Yes (nothing system-posted today) | Only if Phase 4 admitted |
| OQ-43 | Iranian statutory requirements | OPEN (architecture Proposed ADR-0036; every legal fact needs validation) | Electronic Books / Tax Accounting / legal layouts | No for capability admission; yes for legal implementation facts | **Yes — implementation gate** |
| OQ-49 | Report Builder depth | OPEN (no depth committed) | generic builder | Yes (registry reports suffice) | **No — builder NOT required for MVP**; bounded reports only |
| OQ-54 | Finalized document deletion/editing policy | **RESOLVED 2026-10-05 (Owner — Option B, OD-54-01…11):** edit until Accounting Post, then cancel/correct only; side-effect transparency; negative-inventory hard block; never-silent repricing; cancelled visible; numbers never reused. Backend contract ADR-0040 (**Proposed**), `document-architecture.md` §6.1. C-50's narrow Material Request-only lifecycle decision stands unchanged | Sales plus future Inventory opening/Receipt/Issue state machines (C-48/C-49/C-51/C-52) now have the platform policy; each type still needs its own gated contract, and OQ-13/OQ-26 approval coupling remains open | Policy no longer blocks; per-type contracts and approval coupling still gate | **Policy decided — no longer the blocker; normal task gating applies** |
| OQ-60 | MVP acceptance thresholds | OPEN (numbers are proposals) | the final gate's numeric criteria | Recommended no | **Yes for Phase 8** — the Owner should ratify or waive |
| OQ-62 | Account pin compatibility (repair, authoritative pin) | OPEN (ODR-1 enforces on writes; existing divergent rows not repaired) | pin repair, migration preflight | Yes | No — write-time enforcement stands |
| OQ-63 | LEGACY fallback shape | OPEN | legacy org migration correctness | Yes | No |
| OQ-52/53 | Backup RPO/RTO; disaster recovery | OPEN (no targets committed; controlled-restore principle recorded) | backup/restore MVP surface | Yes (documented daily pg_dump strategy stands) | Only if customer-visible backup admitted (Phase 7.4) |

## 5. ADR dependency matrix

Statuses verified from `docs/adr/` on `main`. **None is promoted by the roadmap.**

| ADR | Topic | Current status | Blocks | Can be deferred? | Required before Backend MVP? |
|---|---|---|---|---|---|
| ADR-0001/0002 | Modular monolith; fixed stack | Accepted | — | — | Binding (satisfied) |
| ADR-0003 | Legacy ERP adapter isolation | Accepted | integration module | Yes | No (integration POST-MVP) |
| ADR-0004 | Outbox pattern | Accepted (decision) | sync/outbox implementation | Yes until OQ-39/capability admits | Only if Phase 5 admitted |
| ADR-0005 | Domain events Inventory → Accounting | Accepted (contract) | Inventory → Accounting consumer | OQ-39 gates activation | Only if Phase 4C admitted |
| ADR-0006/0016 | RBAC granular + enforcement | Accepted | — | — | Binding (satisfied) |
| ADR-0007 | Server-side sessions | Accepted | — | — | Binding (satisfied) |
| ADR-0008 | Single DB, schema per module | Accepted | — | — | Binding (satisfied) |
| ADR-0009 | Reporting via module views + scoped raw SQL | Accepted | reporting implementation | No | **Yes for Phase 2** (architecture ready; implementation pending) |
| ADR-0010 | DB-backed job queue | Accepted (decision) | jobs module | Yes until a capability requires | Only if Phase 5 admitted |
| ADR-0011/0012/0013 | Excel import workflow; print templates; preferences | Accepted (decisions) | excel/print/customization modules | Yes | Only the admitted Phase 2 slices |
| ADR-0014 | OpenAPI contract | Accepted | — | — | Binding (satisfied) |
| ADR-0017 | Inventory ledger as source of truth | **Proposed (implemented)** | nothing new (ADR-0022 covers implementation) | — | Owner promotion/rejection decision (Phase 0.4) |
| ADR-0018/0019/0020/0021 | Workflow/document/org-scope ADRs | **Proposed (implemented)** | nothing new functionally | — | Owner promotion/rejection decision (Phase 0.4) |
| ADR-0022/0023/0024/0025 | Inventory core; documents; workflow; deployment pin | Accepted | — | — | Binding (satisfied) |
| ADR-0026/0028 | Accounting bounded context; configuration foundation | Accepted | — | — | Binding (satisfied) |
| ADR-0029 | Machine/API access | Proposed | licensed API keys | Yes | No — POST-MVP |
| ADR-0030 | License foundation (enforcement off) | Proposed | license record | Yes | No — POST-MVP |
| ADR-0031 | Balance projection | **Proposed (implemented; Task 12 accepted with follow-up)** | — | — | Owner promotion decision (Phase 0.4); P1 verification open |
| ADR-0032 | Period close enforcement | **Proposed (implemented; Task 14 not accepted)** | — | — | Owner promotion + Task 14 acceptance (Phase 0.4) |
| ADR-0033 | Account identity & code history | Proposed | code-history producer (Phase 1B) | Yes until producer exists | Only if Phase 1B admitted |
| ADR-0034 | Posting vs aggregation (leaf-only) | Proposed (OD-20-5 resolves D-1 within it) | nothing — product rule already enforced in code | — | Promotion optional; the rule itself is binding via OD-20-5 |
| ADR-0035 | Code structure migration service | Proposed — **explicitly not authorized** | migration service | Yes | **No — POST-MVP** |
| ADR-0036 | Legal reporting architecture | Proposed | Electronic Books / Tax Accounting / Iranian legal outputs | Yes — validation required | **Yes — MVP implementation gate; ADR remains Proposed** |
| ADR-0037 | Accounting configuration boundary | Proposed | control roles / dimensions / Base Chart content implementation | Partially | Adoption gate before Phase 1C/1D implementation |
| ADR-0027 | *(does not exist)* | — | — | — | number gap preserved; do not fill |

---

## 6. Infrastructure dependency matrix (target vs implemented)

| Infrastructure | Architecture target | Verified on `main` | Admitted for MVP when? |
|---|---|---|---|
| In-process domain-event bus | v1 internal events | **EXISTS** (in-memory, non-durable) | already in use |
| Persisted domain events (`core.domain_events`) | durable cross-module effects | **NOT PRESENT** | only if OQ-39/capability requires |
| Transactional outbox (`sync.outbox_events`) + dispatch | external delivery (ADR-0004) | **NOT PRESENT** | only if external integration or durable queueing admitted |
| DB-backed jobs queue + worker loop | async/heavy work (ADR-0010) | **NOT PRESENT** (JobsRegistry stub; worker = startup gate) | only if heavy reports/PDF/backup jobs admitted |
| Audit store (`audit.audit_logs`) | append-only audit (AR-23) | **NOT PRESENT** | Phase 6.2 Owner decision |
| Read-only report execution role | reporting performance rule | **NOT PRESENT** | with Phase 2 (if admitted) |

---

## Final status

**READY FOR REVIEW — NOT ACCEPTED.** This matrix closes no OQ, promotes no ADR, and authorizes no implementation.
