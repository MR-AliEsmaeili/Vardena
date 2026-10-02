# Vardena — Backend MVP Dependency Matrix

| | |
|---|---|
| Status | **READY FOR REVIEW — NOT ACCEPTED** |
| Date | 2026-09-27 |
| Type | Roadmap companion (documentation only) |
| Inspection baseline | `main` @ `c654be916fe75e25ff2862900994c86aa1c20892` |
| Parent | [backend-mvp-roadmap.md](./backend-mvp-roadmap.md) |
| Production code changed | **NONE** |

> **Current-state addenda (2026-09-29 and 2026-10-02):** this matrix's original
> baseline is a dated planning snapshot. Current `main` `4cf481e` includes Task
> 30's bounded Account Nature/Type/Detail foundation, Task 32's Dashboard
> corrected by PR #86, and the merged/CI-verified C-47 item-master hardening
> slice from PR #107. PR #107 merge/CI does **not** constitute Owner acceptance.
> OQ-29 Option A, OQ-33 Option D, barcode PDR-01 Option A and OQ-36 Option C
> are now recorded with their remaining open subquestions. The generic
> multi-dimension model, Reporting module, durable Inventory→Accounting
> integration, Sales, Purchasing and Treasury remain absent. See
> [`../current-state-reconciliation.md`](../current-state-reconciliation.md) and
> the detailed C-47–C-54 review below.
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
| inventory | PARTIAL (Inventory Core: master data + movement ledger/balances/reservations/transfers; full operational warehouse scope absent) | organization, documents (numbering), workflow (bindings), accounting for rial/opening effects | Accounting integration, Sales inventory effects, Inventory reports | OQ-11 (opening), OQ-24 (valuation), OQ-29 (units/conversions), OQ-33 (item model) | ADR-0022 Accepted; ADR-0017 Proposed (code ahead of governance) | **IN MVP — Full Inventory/Warehouse required; details are implementation candidates** |
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
| Product/item coding, attributes, units, barcode | **PARTIAL — master implemented + regression-hardened (C-47 hardening slice); barcode policy undecided** | item model and unit/conversion contracts | OQ-29/OQ-33 | **MVP REQUIRED — candidate (remains blocked by OQ)** |
| Opening quantity | NOT PRESENT as complete operational flow | Inventory master/movement and opening policy | OQ-11/OQ-24 | **MVP REQUIRED — candidate** |
| Opening rial | NOT PRESENT as complete operational flow | Inventory + Accounting + valuation | OQ-11/OQ-24 | **MVP REQUIRED — candidate** |
| Material Request | NOT PRESENT | Inventory document/lifecycle/permissions | OQ-54 as applicable | **MVP REQUIRED — candidate** |
| Receipt quantity / rial | PARTIAL core / full operational scope absent | Inventory movement; rial treatment | OQ-24/OQ-39/OQ-42 | **MVP REQUIRED — candidate** |
| Issue quantity / rial | PARTIAL core / full operational scope absent | Inventory movement; rial treatment | OQ-24/OQ-39/OQ-42 | **MVP REQUIRED — candidate** |
| Stock management/settings | PARTIAL balances | movement → balance; Available = Quantity − Reserved where contract applies | ADR-0022; OQ-24 | **MVP REQUIRED — candidate** |
| Quantity/rial stock and Kardex | NOT PRESENT as complete reports | Inventory read models and valuation | OQ-24/OQ-49 | **MVP REQUIRED — candidate** |
| Unvalued Receipt/Issue reports | NOT PRESENT | rial flow and valuation state | OQ-24 | **MVP REQUIRED — candidate** |
| Movement/analysis/management reports | NOT PRESENT | bounded module-owned views | OQ-49 | **MVP REQUIRED — candidate** |

Warehouse Receipt is Inventory/Warehouse MVP; Purchasing is POST-MVP. These are separate capabilities and dependencies.

## 4. C-47–C-54 dependency review (2026-10-02)

The table below separates current implementation evidence from readiness. A
merged change or green CI is not Owner acceptance. `READY TO INVESTIGATE` means
a bounded investigation may define the contract and evidence; it does not mean
production implementation is authorized.

| Candidate | Current status and evidence paths | Upstream dependencies | Blocking OQs / ADRs | Readiness |
|---|---|---|---|---|
| **C-47 Item master** | Item, item group, unit, global/item-specific conversion and ledger-reference foundations exist. C-47 defects/coverage are on `main` via PR #107; evidence: [`C-47 readiness report`](../tasks/c-47-item-master-readiness-hardening-report.md), [`preflight`](../tasks/c-47-item-master-preflight-investigation.md), `backend/src/modules/inventory/{domain,application,data,api}`, `backend/prisma/schema/inventory.prisma`. No Owner acceptance record exists. | Organization scope, Inventory master and movement ledger | OQ-33 remains open for existing taxonomy/capability confirmation; OQ-36 remains open for code reuse. OQ-29 Option A and barcode PDR-01 are recorded, but no production enforcement change is authorized here. ADR-0022 remains the accepted core ledger decision; its item lifecycle addendum points to OQ-36. | **IMPLEMENTED-STYLE / CI-VERIFIED — NOT ACCEPTED; follow-up remains decision-gated** |
| **C-48 Opening quantity** | No operational opening-quantity flow. Evidence: candidate row, roadmap §2.3/§5.3, `backend/src/modules/inventory/application/inventory-movements.service.ts` (movement foundation), and C-47 quantity record. | Product/warehouse master, movement ledger, likely Documents if represented as a business document | OQ-11 opening-balance/accounting treatment; OQ-24 valuation/negative-stock policy; OQ-29 Option A supplies exact quantity arithmetic but does not decide opening treatment; ADR-0022 accepted, ADR-0017 proposed. | **BLOCKED FOR IMPLEMENTATION; investigation should follow opening/valuation contract** |
| **C-49 Opening rial** | No operational opening-rial flow. Evidence: candidate row, roadmap §2.3/§5.3, Accounting ledger/configuration sources, and OQ-11/OQ-24 registry rows. | Opening quantity, Inventory, Accounting ledger/configuration and posting mapping | OQ-11/OQ-24; OQ-25 if account/mapping/content semantics are required; OQ-39/OQ-42 only for any system-generated accounting effect; ADR-0022 accepted, ADR-0017 proposed. | **BLOCKED FOR IMPLEMENTATION** |
| **C-50 Material Request** | No Material Request module, schema, API, permission or UI. Evidence: candidate row, roadmap §2.3/§5.3, `docs/architecture/domain/document-architecture.md`, `docs/adr/0023-document-foundation-implementation.md`. | Documents foundation, Inventory ownership and permissions; Workflow only if approvals are part of the bounded contract | OQ-54 is the actual policy gate for finalized request edit/cancel/delete semantics. OQ-13/OQ-26 are conditional only if approval transitions are included. OQ-12 is conditional only if numbering needs exceed the existing Document Foundation mechanism. | **READY TO INVESTIGATE (bounded); NOT READY FOR IMPLEMENTATION** |
| **C-51 Warehouse Receipt quantity/rial** | Inventory movement/balance core exists, but receipt document/full quantity/rial flow is absent. Evidence: candidate row, roadmap §2.3/§5.3, `backend/src/modules/inventory/application/inventory-movements.service.ts`, `docs/adr/0022-inventory-core-ledger.md`. | Product/warehouse master, Documents, movement/balance ledger; Accounting only through approved cross-module integration | OQ-24 valuation/negative stock; OQ-39 durable integration and rejected-posting semantics; OQ-42 posting mode; OQ-54 finalized receipt lifecycle. OQ-29 Option A governs exact quantity arithmetic. ADR-0022 accepted, ADR-0017 proposed, ADR-0005 is a contract and has no consumer. | **BOUNDED INVESTIGATION POSSIBLE; IMPLEMENTATION BLOCKED BY OQ** |
| **C-52 Warehouse Issue quantity/rial** | Inventory movement/balance core exists, but issue document/full quantity/rial flow is absent. Evidence: candidate row, roadmap §2.3/§5.3, movement service, and ADR-0022. | Product/warehouse master, Documents, movement/balance ledger; Accounting only through approved cross-module integration | OQ-24 valuation/negative stock; OQ-39 durable integration and rejected-posting semantics; OQ-42 posting mode; OQ-54 finalized issue lifecycle. OQ-29 Option A governs exact quantity arithmetic. ADR-0022 accepted, ADR-0017 proposed, ADR-0005 is a contract and has no consumer. | **BOUNDED INVESTIGATION POSSIBLE; IMPLEMENTATION BLOCKED BY OQ** |
| **C-53 Stock/settings** | Balance, reservation and transfer foundations exist; full quantity/rial stock, settings and valuation scope do not. Evidence: candidate row, roadmap §2.3/§5.3, `backend/src/modules/inventory/application/inventory-balances.service.ts`, `inventory-reservations.service.ts`, and ADR-0022. | Movement → balance, warehouse/item master, organization isolation; bounded report reads as needed | OQ-24 for valuation/rial/negative-stock settings. OQ-39/OQ-42 are not prerequisites for quantity-only balance reads, but are relevant if settings activate accounting effects. | **BLOCKED FOR FULL IMPLEMENTATION; quantity-core evidence exists** |
| **C-54 Kardex/inventory reports** | No complete quantity/rial Kardex or inventory reporting surface. Evidence: candidate row, roadmap §2.3/§5.3, `docs/reporting-strategy.md`, ADR-0009 and ADR-0022; existing balance/movement reads are foundations, not the complete report set. | Inventory read models/movement ledger, bounded reporting pipeline and module-owned views | OQ-24 for valuation/unvalued/rial semantics. OQ-49 blocks only a generic Report Builder; it does not block bounded Inventory reports by itself. OQ-43 applies only if a statutory/legal output is claimed. ADR-0009/0022 accepted. | **READY TO INVESTIGATE AS BOUNDED REPORT CONTRACT; IMPLEMENTATION GATED** |

### C-50 next-investigation assessment

C-50 is the next dependency-ready candidate for **investigation**, not for
implementation. OQ-54's exact scope is finalized operational-document
edit/delete/cancel policy, visibility of canceled documents, numbering gaps,
and approval coupling; it is not a generic "Material Request" decision. The
investigation can therefore define a minimal request lifecycle on the accepted
Documents foundation, explicitly identify whether a request is finalized and
whether it has stock/accounting effects, and isolate any OQ-54/OQ-13/OQ-26
questions. It must not assume the recommended cancel-only policy or invent
approval transitions. No warehouse operational implementation starts in this
task.

## 5. OQ dependency matrix

Only OQs load-bearing for Backend MVP, inspected on `main`. **None is closed by the roadmap.**

| OQ | Topic | Current status (registry) | Blocks | Can be deferred? | Required before Backend MVP? |
|---|---|---|---|---|---|
| OQ-01 | Tenancy (single-org deployment vs multi-org instance) | OPEN (ODR-3 invariant implemented; product question open) | deployment posture, cloud path, any multi-org feature | Yes (single-org posture stands) | No — not a blocker; record posture for the final gate |
| OQ-02 | UI language / Jalali / number formats | OPEN | frontend display, report labels, print templates | Yes for backend MVP; blocks frontend polish | Only if print/report labels are admitted (Phase 2D) |
| OQ-11 | Ledger policy: opening balances, costing method | OPEN | opening accounting balances, valuation reporting | Partially (manual vouchers work) | Only if opening-balance flow or valuation reporting admitted |
| OQ-12 | Numbering policy (year component, gaps) | OPEN (mechanism exists via Document Foundation) | numbering extensions | Yes | No — mechanism sufficient |
| OQ-14 | Occupational role set / baselines | OPEN | RBAC seeding beyond bootstrap role, auditor separation | Yes | No — but Phase 6 audit-surface decision references it |
| OQ-16 | Purchasing in initial release? | OPEN (recorded posture: post-v1) | Purchasing module | Yes (manual receipts cover) | No — Purchasing is POST-MVP unless re-admitted |
| OQ-19 | Administrator safety (self-disable, last-admin lockout) | OPEN | users/rbac protections | Recommended no | **Yes for hardening phase (6.4)** — production deployment with a lockable last admin is a real risk |
| OQ-22 | Organizational scope / branches / separate books | OPEN | branch semantics, multi-company | Yes | No — single-entity posture stands |
| OQ-23 | Fiscal calendar policy (close/reopen authority, year-end entries) | OPEN (mechanism enforced by Task 14 behavior) | year-transition ops, opening carry-forward, closed-period policy | Partially | **Yes if Phase 1F admitted**; otherwise no |
| OQ-24 | Inventory valuation / negative stock | OPEN | Full Inventory rial flows/reports and Inventory → Accounting | Yes for method, not for capability admission | **Yes — implementation gate** |
| OQ-29 | Units and conversions | **OPEN — Option A recorded 2026-10-02:** four fractional decimal places; exact-fit rejection; no rounding/truncation; effective-dated factor versions; historical interpretation preserved. Independent subquestions remain open. | C-47 quantity contract; C-48/C-51/C-52 quantity arithmetic | C-48/C-51/C-52 must inherit this rule; global/item-specific policy and other downstream semantics remain open | **Partially decision-ready; no production change authorized by this record** |
| OQ-33 | Item taxonomy and capabilities | **OPEN — Option D recorded 2026-10-02:** new kinds/flags require concrete need plus accepted governance; Option A is not approved; existing eight kinds/current per-item model remain unconfirmed. | C-47 item-master governance and future taxonomy-dependent documents | C-47 follow-up and any new kind/capability; barcode is separately PDR-01-decided with deactivated-item reuse open | **OPEN / blocks taxonomy-dependent implementation** |
| OQ-25 | Chart content / control roles / layouts | OPEN — substantially narrowed (Tasks 20/21); content values + role catalog remain. **OD-27-02 (DECIDED 2026-09-27): MVP-scope sub-question decided — Base Chart mechanism in MVP, concrete content set NOT MVP-required** | Base Chart content (Phase 1A loading), control roles, new report layouts | Yes for the MVP boundary (OD-27-02: concrete content not required); Phase 1A loading remains decision-gated | **No for the Base Chart content set (OD-27-02, 2026-09-27)** — the remaining OQ-25 content decisions gate Phase 1A content loading and content-dependent consumers (e.g. C-13 posting-rule mapping), not the MVP mechanism boundary |
| OQ-27 | Correction windows / cross-period corrections | OPEN | corrections beyond reversal | Partially | Only if Phase 1E admitted |
| OQ-30 | Tax model | OPEN | Sales tax fields, Sales → Accounting, legal/tax outputs | Yes for rules, not capability admission | **Yes — implementation gate** |
| OQ-36 | Master-data lifecycle (deletion, code reuse) | **OPEN — Option C recorded 2026-10-02:** physical deletion only for never-referenced items; referenced items not physically deleted; preserve history and organization-scoped identity. Code reuse after physical deletion/deactivation remains open. | C-47 lifecycle follow-up; Base Chart/code-history prerequisites | Delete/reuse implementation; barcode deactivated-item reuse remains open via PDR-01 | **Partially decision-ready; implementation remains blocked** |
| OQ-38 | Party detail (contacts/addresses/identifiers) | OPEN | party completion, statutory-facing sales docs | Yes (flat party works for MVP) | Only if Sales with statutory fields admitted |
| OQ-39 | Durable integration semantics | OPEN — **gates all system-generated posting** | Inventory/Sales → Accounting, outbox admission, rejected-posting semantics | No for required capability; yes for implementation shape | **Yes — implementation gate** |
| OQ-40 | Financial areas (count, grants, default) | OPEN (interim: one area, structural access) | area grants, per-area charts | Yes | No — interim posture stands |
| OQ-41 | Detail dimensions (count/defaults/binding) | OPEN (OD-20-6 decided line-level boundary) | dimensions implementation | Partially (account-tree-only postings work) | Only if Phase 1D admitted |
| OQ-42 | Posting modes (A direct / B review) | OPEN | system posting activation | Yes (nothing system-posted today) | Only if Phase 4 admitted |
| OQ-43 | Iranian statutory requirements | OPEN (architecture Proposed ADR-0036; every legal fact needs validation) | Electronic Books / Tax Accounting / legal layouts | No for capability admission; yes for legal implementation facts | **Yes — implementation gate** |
| OQ-49 | Report Builder depth | OPEN (no depth committed) | generic builder | Yes (registry reports suffice) | **No — builder NOT required for MVP**; bounded reports only |
| OQ-54 | Finalized document deletion/editing policy | OPEN — exact scope is cancel-only vs edit-until-posted vs per-type policy, canceled-document visibility, numbering gaps, and cancel approval coupling | C-50 request lifecycle if finalized; C-51/C-52 receipt/issue lifecycle; Sales | OQ-13/OQ-26 only for approval coupling; OQ-12 for numbering gaps; current recommendation is not a decision | **OPEN; C-50 investigation may isolate it, implementation is gated where applicable** |
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
