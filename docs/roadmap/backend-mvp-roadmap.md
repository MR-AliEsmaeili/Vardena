# Vardena — Backend MVP Roadmap

| | |
|---|---|
| Status | **READY FOR REVIEW — NOT ACCEPTED** |
| Date | 2026-09-27 |
| Type | Roadmap / navigation map (documentation only) |
| Inspection baseline | `main` @ `c654be916fe75e25ff2862900994c86aa1c20892` (merge of PR #68 — *docs: synchronize governance state after Task 24*; the last production-code change on `main` is PR #67 / Task 24, merged in `2aae5fba99671639fec4bffeb8877d3bcad09b6a`) |
| Companion documents | [backend-mvp-dependency-matrix.md](./backend-mvp-dependency-matrix.md) · [future-task-candidates.md](./future-task-candidates.md) |
| Production code changed by this roadmap | **NONE** |

> **Current-state addendum (2026-10-02, `main` @ `4cf481e`, merge of PR #107):**
> the Inventory item master (C-47) is implemented, hardened and merged with green
> CI, and is **not accepted** — merge and CI are not Owner acceptance (§0.1 rule
> 2). Four Owner decisions were recorded that day for Phase 3C's product/item
> master: **OD-C47-01** (OQ-29 Option A — fixed four-decimal quantity precision,
> reject non-representable conversion results, no rounding/truncation,
> effective-dated factor versions, preserved history), **OD-C47-02** (OQ-33
> Option D — new kinds/flags only through an accepted concrete need; Option A
> **not** approved), **OD-C47-03** (barcode Option A), and **OD-C47-04** (OQ-36
> Option C — physical deletion only for never-referenced items). **OQ-29, OQ-33
> and OQ-36 remain OPEN**; the new **OQ-65** records the barcode
> lifecycle/reuse question. Verified prerequisite corrections for §5.3/3C:
> OQ-11's inventory relevance is the accounting opening import and the costing
> method (not quantity-opening mechanics); **OQ-23** and **OQ-54** are genuine
> prerequisites of the opening and receipt/issue flows; **OQ-49 blocks only a
> generic report builder**, not bounded code-defined inventory reports. **C-50
> (Material Request) is the next dependency-ready candidate — investigation
> only.** Records:
> [`../tasks/c-47-owner-decision-and-dependency-reconciliation.md`](../tasks/c-47-owner-decision-and-dependency-reconciliation.md)
> and [`../decisions/product/README.md`](../decisions/product/README.md).
> This addendum closes no OQ, promotes no ADR and authorizes no implementation.
>
> **C-50 investigation addendum (2026-10-02, `main` @ `0e600689`):** the
> Material Request investigation is complete and
> [`../tasks/c-50-material-request-investigation.md`](../tasks/c-50-material-request-investigation.md)
> is the evidence/decision brief. C-50 remains MVP-required but **blocked for
> implementation**; no OQ or ADR was resolved and no implementation was authorized.
>
> **C-50 implementation-status follow-up (2026-10-02, later, unmerged):** a
> non-valued, non-posting Material Request vertical slice was subsequently
> opened as [PR #112](https://github.com/MR-AliEsmaeili/Vardena/pull/112)
> without a recorded Owner answer to the blockers above. **Correction:** an
> earlier version of this line described the slice as "no-stock-reservation";
> that was inaccurate — the shipped code does reserve stock on approval
> (optional per-line flag, all-or-nothing, released only by approver
> reversal), which is §11.4's "Require" branch, not "Defer", and was never
> Owner-ratified either way. See the investigation brief's **§19** (item 2
> correction, item 4) for the full, honestly-caveated record. `main` is
> unchanged; this is not an authorization record and resolves no OQ, and does
> not retroactively bless the reservation shape either.
>
> **Post-merge reconciliation (2026-10-03, `main` @ `ca981018`):** the
> chronological paragraph above is superseded for current state. PR #112 is
> **MERGED**, exact-main CI run `37100066679` is green, and C-50 is
> **IMPLEMENTED — NOT ACCEPTED**. Subsequent explicit Owner decisions in the
> C-50 brief §§20–21 now govern Material Request's own lifecycle, approval
> authority and reservation behavior; OQ-66 is RESOLVED. They do **not** close
> platform-wide OQ-13/OQ-26/OQ-54. The next dependency-ready step is a bounded
> **C-54 quantity Kardex investigation**; C-51 quantity Receipt is the least
> blocked next operational document but needs its own Owner decisions first.
> Full report:
> [`../tasks/post-c-50-dependency-reconciliation-and-next-slice-readiness.md`](../tasks/post-c-50-dependency-reconciliation-and-next-slice-readiness.md).
> This addendum authorizes no implementation and records no acceptance.
>
> **Governance re-baseline addendum (2026-10-05):** the Owner recorded a
> product-decision batch (canonical records: `docs/decisions/product/`, index
> [PDR-06](../decisions/product/PDR-06-initial-usable-product-v1.md)).
> Relevant to this roadmap: **(1) OQ-54 is RESOLVED** — Option B, edit until
> Accounting Post then cancel/correct only, with side-effect transparency and
> the negative-inventory hard block (OD-54-01…11; backend contract ADR-0040
> **Proposed**, `document-architecture.md` §6.1). Rows below naming OQ-54 as a
> blocker should be read as unblocked on the *policy*; the remaining gates
> (OQ-13/OQ-26 approval coupling, per-document contracts, Owner task
> authorization) stand. **(2) OQ-49 is DECIDED** — standard reports +
> controlled customization; no unrestricted designer. **(3) MVP completion is
> re-based (PDR-06):** "MVP complete" means the end-to-end usable **Initial
> Usable Product / V1** (frontend, licensing, installation, deployment,
> backup, export and administration usable), **not** "backend code complete."
> The Backend MVP Final Gate (§7) remains the backend track's milestone
> *inside* V1, not the product completion definition. **(4)** Multi-currency
> ("do nothing for now"), Detail Dimensions, Product Family and taxpayer
> Stage 2 remain deferred; barcode reuse is decided (never reused — OQ-65).
> This addendum closes no other OQ, promotes no ADR, accepts no merged work
> and authorizes no implementation.
>
> **Current-state addendum (2026-09-29):** the original inspection baseline and
> inventory below are a dated planning snapshot. Current `main` is
> `34dddfd60d6ce2f9d4599bd05b440556a80aa847`: Task 30 adds Account Nature/Type
> and the bounded Detail foundation; Task 32 adds a Dashboard, with PR #86 as the
> corrective final implementation. Current counts are 55 Prisma models, 18
> migrations, 48 controllers, 142 permissions, 113 backend unit-spec files and
> 34 E2E-spec files. Dashboard existence does not create a Reporting module or
> make frontend completion a Backend MVP gate. Use
> [`../current-state-reconciliation.md`](../current-state-reconciliation.md) for
> current truth; the roadmap remains the future planning map.
>
> **This roadmap describes the planned path from the current repository state to
> Backend MVP. It does not itself authorize implementation or accept future
> work.** No task number is created, no Open Question is closed, no ADR is
> promoted, and no merged-but-unaccepted work item is converted into an
> accepted one by this document. Future Arena Agents MUST read this roadmap
> before proposing or implementing MVP work. If this roadmap conflicts with the
> actual repository in the future, **the repository wins** and the roadmap must
> be updated through a documentation task.

---

## 0. How to read this roadmap

### 0.1 Governing rules

1. **The merged default branch `main` is the sole source of truth** (STATE.md §1). Chat history, agent memory, PR descriptions and historical reports are not evidence.
2. **MERGED ≠ ACCEPTED. READY FOR REVIEW ≠ ACCEPTED.** Green CI is not acceptance. Only the Repository Owner records acceptance (STATE.md §6).
3. **No invented business rules** (AG-09/AR-31). Where a capability depends on an unresolved business/domain/legal decision, the dependency is recorded, not guessed.
4. **Treasury (خزانه‌داری) is deferred and OUT of MVP scope.** No Treasury capability is a Backend MVP milestone or a dependency of the final gate (§2.2).
5. **This roadmap does not reopen decided matters.** Task 19 (ODR-1/ODR-2/ODR-3), Task 20 (OD-20-1…OD-20-6), Task 21 (Base Chart governance), Task 22 (frontend slice), Task 17A/17B/17C and Task 18 acceptances stand exactly as recorded.
6. **Owner-directed MVP scope correction (2026-09-27):** Full Inventory / Warehouse, Sales, Sales → Accounting, Inventory → Accounting, Reporting, and Electronic Books / Tax Accounting are required MVP capabilities. Purchasing, Purchasing → Accounting, Purchasing Reports, and Treasury are POST-MVP. This changes scope classification only; it closes no OQ, promotes no ADR, and authorizes no implementation.
7. Future work items are **candidates**, not tasks. A numbered implementation task is created only through the governance process of `docs/accounting/task-index.md` §7 (Accounting) or its equivalent Owner-approved gate (other domains).

### 0.2 Evidence vocabulary

`VERIFIED IN MAIN` · `DOCUMENTED BUT NOT IMPLEMENTED` · `IMPLEMENTED BUT NOT ACCEPTED` · `ACCEPTED` · `PARTIAL` · `OPEN QUESTION` · `ADR PROPOSED` · `ADR ACCEPTED` · `DEFERRED` · `POST-MVP` · `UNKNOWN` · `CONTRADICTION`. Where evidence is insufficient, this roadmap writes **UNKNOWN — requires repository/Owner verification** and invents nothing.

---

## 1. Verified current baseline (`main` @ `c654be9`, 2026-09-27)

### 1.1 Architecture facts (VERIFIED IN MAIN)

- **Modular monolith, vertical slices** — NestJS 12 + TypeScript 6, one deployable, modules under `backend/src/modules/` with `api/application/domain/data` layering (ADR-0001 Accepted; `app.module.ts`).
- **PostgreSQL + Prisma** (Prisma 7, schema-per-module: 8 database schemas — `identity, users, rbac, organization, inventory, documents, workflow, accounting`; **no `core`, `sync` or `jobs` schema exists**), ULIDs, `numeric(18,2)` money / `numeric(18,4)` quantities (ADR-0008 Accepted; `backend/prisma/schema/`).
- **REST + OpenAPI** under `/api/v1`, DTO-generated contract served at `/api/docs` (ADR-0014 Accepted).
- **Docker Compose**: `postgres` + `migrate` (runs `prisma migrate deploy` **and** the idempotent `bootstrap:system-admin`) + `api` + `worker` (`docker-compose.yml`).
- **React + TypeScript + Vite + Tailwind + shadcn/ui frontend** — first vertical slice implemented and ACCEPTED (Task 22); not part of `docker-compose.yml`.
- **Microservices are NOT part of MVP.** No generic workflow engine, no rules engine, no scripts/EAV/giant-JSONB/universal-document-table, no unnecessary Redis, no cross-module Prisma access, no wildcard permission bypass (`.vardena/architecture-rules.md`).

### 1.2 Backend module inventory (verified from source)

Application modules registered in `app.module.ts`: 9 — `health` + `users, identity, rbac, organization, inventory, documents, workflow, accounting`. 46 controllers under `/api/v1`; 52 Prisma models; 17 migrations (`20260910000000_init` … `20260926010000_accounting_base_chart`); 134 registered permission codes (Accounting 41, Inventory 32, Organization 28, Workflow 10, Documents 9, RBAC 8, Users 6); 107 unit spec files; 34 E2E spec files.

| Module | Classification | Verified state and evidence |
|---|---|---|
| `health` | **IMPLEMENTED** | Liveness/readiness probes; `/api/v1/health` (`health.controller.ts`) |
| `identity` | **PARTIAL** | Login/logout/`me` with opaque Argon2id/session model (ADR-0007). **Not implemented:** session list/revoke (self/admin), self-service password change, forced-change-on-first-login — documented module surface vs implementation gap (audit §C.8, `modules.md` Identity entry) |
| `users` | **IMPLEMENTED** | User CRUD, enable/disable, admin password-reset; no DELETE (OQ-18); 6 permissions |
| `rbac` | **IMPLEMENTED** | Code registry → DB mirror, roles, user-role evaluation, fail-closed guard, no cache (ADR-0006/0016 Accepted), no wildcards (OQ-21) |
| `organization` | **PARTIAL** | Structure (branches/departments/employees), party master (flat), **memberships + `assertOrganizationInScope` chokepoint (ODR-3, Task 19 ACCEPTED)**, deployment pin (ADR-0025). **Not implemented:** configuration half (tax definitions, custom fields) |
| `inventory` | **PARTIAL** | Master data (items/units/conversions/groups/warehouses), movement ledger, balances, reservations, transfers (ADR-0022 Accepted), Material Request (C-50), quantity Kardex (C-54) **and the valuation foundation (2026-10-04, ADR-0039 Proposed — moving weighted average only, effective-dated method configuration per organization + item, per-(warehouse, item) valuation state, signed `total_cost` on the ledger, cost OPTIONAL on receipts, two-step backdating confirmation, bounded recalculation)**. **Not implemented:** Inventory → Accounting posting, opening documents, and broader Accounting cost policy. PDR-08 records Inventory return-costing conventions; OQ-24 remains open for COGS/journal effects, landed cost, precision/currency and write-down/NRV; OQ-70 gates only Purchase Return agreed-price variance. OQ-39/OQ-42/OQ-72 remain posting semantics/mode/authority gates; ADR-0017 remains Proposed |
| `documents` | **IMPLEMENTED** | Type configuration, numbering series + allocation ledger, typed relations (ADR-0023 Accepted) |
| `workflow` | **IMPLEMENTED** | Versioned definitions/states/transitions, instances, single-level approvals, automation bindings (ADR-0024 Accepted) |
| `accounting` | **PARTIAL** (deepest module) | Fiscal calendar, coding structures, chart of accounts + chart-tree read surface, configurations + operational freeze, vouchers, atomic posting, immutable `ledger_entries`, balance projection, reversal, period-close enforcement, ledger-movement/account-statement/general-ledger/trial-balance read surfaces, pin coherence (ODR-1), Base Chart template + adoption **mechanism** (Task 23, merged not accepted). **Not implemented:** posting rules/mapping, control roles, detail dimensions, cross-year opening carry-forward, statutory/legal books, exports, any source-module posting trigger |
| `audit` | **NOT PRESENT** | No module, no schema, no table (`modules.md` map; audit §E of repository audit) |
| `notifications` | **NOT PRESENT** | No module/schema/table |
| `sales` | **NOT PRESENT** | No module/schema/table; `modules.md` "v1 core — not implemented" |
| `purchasing` | **NOT PRESENT** | OQ-16 recorded posture: planned post-v1; manual receipts cover the gap |
| `reporting` | **NOT PRESENT** | No module; Accounting owns bounded read surfaces instead (Task 18 D1–D20, ADR-0009 module-view policy) |
| `excel` | **NOT PRESENT** | ADR-0011 (import workflow) is an Accepted *decision*; no implementation |
| `print` | **NOT PRESENT** | ADR-0012 (print templates) is an Accepted *decision*; no implementation |
| `customization` | **NOT PRESENT** | ADR-0013 Accepted decision; no implementation (frontend grid persistence therefore not available) |
| `integration` | **NOT PRESENT** | No adapters (OQ-04/OQ-05; ADR-0003 is about the boundary) |
| `sync` | **NOT PRESENT** | No outbox table, no dispatch loop |
| `jobs` | **NOT PRESENT** | Kernel `JobsRegistry` stub only; no jobs table (ADR-0010 Accepted decision, unimplemented) |
| **treasury** | **NOT PRESENT — DEFERRED, OUT OF MVP** | Explicit scope boundary (`.vardena/project-context.md`, `modules.md`, task-index §3; repository audit §E). No module, schema, migration, API, permission, or cash/bank semantics on `accounting.accounts` exists, and none may be added implicitly |

### 1.3 Infrastructure facts (VERIFIED IN MAIN — target ≠ implemented)

- **Worker**: `backend/src/worker.ts` + `worker.service.ts` — DB startup gate only; **no dispatch loop** (explicitly deferred in source).
- **Domain events**: in-memory bus only (`kernel/events/domain-event-bus.ts`); **no `core.domain_events` persistence, no `sync.outbox_events`, no `jobs.job_runs`**. No module subscribes to another module's events; **Accounting consumes no Inventory events** (durable delivery semantics are OQ-39 — OPEN).
- **CI** (`.github/workflows/ci.yml`): two jobs — `backend` (Node 22, PostgreSQL 16 service, prisma validate/generate → lint → typecheck → format → unit → build → `migrate deploy` → `bootstrap:system-admin` → E2E incl. live-DB suites, 20-min timeout) and `frontend` (lint/typecheck/format/test/build, 15-min timeout). Branch-protection requirements: **UNKNOWN — requires Owner confirmation** (BOOT-OQ-04).
- **Testing**: unit specs hermetic; live-DB suites opt-in via `VARDENA_TEST_DATABASE_URL` (CI-only per `docs/testing/test-execution-policy.md`); two rehearsal scripts exist (Task 11 migration rehearsal — in CI; Task 13 operational-freeze rehearsal — **not** a CI step).
- **Bootstrap**: post-migration `bootstrap:system-admin` provisions the real `مدیر` user + ordinary `System Administrator` role with the full permission registry; no endpoint, no wildcard, no organization bypass; **forced password change is not implemented**.

### 1.4 Frontend inventory (VERIFIED IN MAIN — Task 22, ACCEPTED 2026-09-26)

Implemented and accepted: login/session (`/auth/login`, `/auth/me`, `/auth/logout`), effective-permission UX gating (`/permissions/effective`), organization context (`/organizations`, ADR-0025 switcher semantics), responsive RTL shell, permission-aware navigation, and the four read-only Accounting surfaces — Chart Tree (`/accounting/chart-tree`), Account Statement (`/accounting/account-statements`), General Ledger (`/accounting/general-ledger`), Trial Balance (`/accounting/trial-balance`) — plus supporting list reads (`/accounts`, `/financial-areas`, `/fiscal-years`, `/accounting-periods`) for scope pickers. API types are generated from OpenAPI (`src/api/generated/`).

**Current correction:** the Task 32 Dashboard exists, with PR #86 as its corrective final implementation. There are still no create/edit screens, Inventory/Workflow/Documents/RBAC-admin/notifications/Treasury administration UIs, generic Reporting UI, or exports. The frontend is **not** complete and is not a Backend MVP blocker.

### 1.5 Task status ledger (as recorded on `main`)

| Work item | Implementation | Governance status |
|---|---|---|
| Tasks 1–9.6, 10.1–10.8 (foundation, organization, inventory, documents, workflow, accounting foundation/documents/posting/ledger) | MERGED | Mostly UNKNOWN review status (historical); ADR-0022/0023/0024/0025/0026/0028 Accepted |
| Task 11 — Accounting Configuration Foundation | MERGED | **ACCEPTED 2026-09-22** |
| Task 12 — Balance Projection | MERGED | **ACCEPTED WITH FOLLOW-UP 2026-09-23**; **P1 real-PostgreSQL concurrency verification OPEN**; ADR-0031 Proposed |
| Task 13 — Operational Freeze (D4 marker) | MERGED (PR #31) | recorded **IN PROGRESS (self-review)** — NOT accepted |
| Task 14 — Period Close Foundation | MERGED (PR #32) | **READY FOR REVIEW — NOT ACCEPTED**; ADR-0032 Proposed |
| Task 15 — Document Reversal | MERGED (PR #33) | **UNKNOWN — no acceptance record found** |
| Task 16 — Settlement/Allocation foundation | NONE | **Contract finalization READY FOR REVIEW; implementation authorization BLOCKED — Owner confirmation required**; Treasury boundary: no settlement/allocation engine may be built implicitly |
| Task 17 (Reporting Foundation umbrella) | partial | **FORMALIZED / IMPLEMENTATION BLOCKED BY OPEN QUESTIONS (OQ-25/OQ-43) — NOT complete** |
| Task 17A / 17B / 17C | MERGED / MERGED / docs | **ACCEPTED 2026-09-25** (each) — bounded slices; close no OQ |
| Task 18 — Accounting Reporting Read Foundation | MERGED (PR #46) | **ACCEPTED 2026-09-25** |
| Task 19 — ODR-1/ODR-2/ODR-3 | MERGED (PR #54 + #55) | **ACCEPTED 2026-09-26** |
| Task 20 — OD-20-1…OD-20-6 | docs only | **ACCEPTED 2026-09-26** |
| Task 21 — Base Chart Governance & OQ-25 narrowing | docs only | **ACCEPTED 2026-09-26** (governance; OQ-25 stays OPEN, narrowed) |
| Task 22 — Frontend Vertical Slice | MERGED (PR #62) | **ACCEPTED 2026-09-26** |
| Bootstrap System Administrator (unnumbered) | MERGED (PR #64) | **READY FOR REVIEW — NOT ACCEPTED** |
| Task 23 — Base Chart Template + Adoption **mechanism** | MERGED (PR #66) | **READY FOR REVIEW — NOT ACCEPTED**; supplies **no accounting content** |
| Task 24 — R-2 Account-list organization scope | MERGED (PR #67) | **READY FOR REVIEW — NOT ACCEPTED**; records open findings F-2…F-6 / proposals R-1…R-6 |

### 1.6 ADR status summary (verified from `docs/adr/`)

- **Accepted:** ADR-0001…0016 (all sixteen), ADR-0022, 0023, 0024, 0025, 0026, 0028, and **ADR-0041** (synchronous Inventory → Accounting public contract; C-61).
- **Proposed while their subject is implemented (code ahead of governance):** ADR-0017 (inventory ledger), 0018 (workflow), 0019 (documents), 0020/0021 (organization scope/master data), 0031 (balance projection), 0032 (period close).
- **Proposed, not implemented:** ADR-0029 (machine API), 0030 (license), 0033 (account identity/code history), 0034 (posting vs aggregation), 0035 (code-structure migration service — **not authorized**), 0036 (legal reporting architecture), 0037 (configuration boundary).
- **ADR-0027 does not exist**; the gap is recorded and the number must not be filled.

### 1.7 Load-bearing OQs (status from `docs/open-questions.md`)

All remain **OPEN** in the registry: OQ-01 (tenancy — product question; the ODR-3 *invariant* is implemented, the *product* question is not answered), OQ-02 (remaining UI-language, Persian-numeral and broader localization policy; generic BusinessDate calendar and Instant zone/calendar are resolved by ADR-0042), OQ-03 (currency), OQ-11 (opening balances/costing), OQ-12 (numbering policy), OQ-14 (occupational roles), OQ-15 (notification channels), OQ-16 (purchasing posture: post-v1), OQ-19 (administrator safety), OQ-22 (organizational scope/branches), OQ-23 (fiscal calendar policy), OQ-24 (inventory valuation), OQ-25 (chart content/control roles — **substantially narrowed by Tasks 20/21; content values and role catalog remain open**), OQ-27 (correction windows), OQ-30 (tax model), OQ-36 (master-data lifecycle: deletion/code reuse — **Task 21 records explicit prerequisites**), OQ-38 (party detail), OQ-39 (**transaction/atomicity, refusal, retry/durability and failure semantics for the synchronous Inventory → Accounting contract — gates production posting**), OQ-40 (financial areas), OQ-41 (detail dimensions — line-level boundary decided by OD-20-6; count/defaults/binding open), OQ-42 (posting modes), OQ-43 (Iranian statutory — architecture decided as Proposed ADR-0036; **every legal fact requires validation**), OQ-49 (report builder depth), OQ-54 (finalized document policy), OQ-62/OQ-63 (pin divergence/legacy fallback — ODR-1 enforces coherence on writes; repair of existing rows undecided), and others. OQ-64 is RESOLVED (Task 13).

> **C-61 OQ reconciliation (2026-10-07):** OQ-24/25/39/42/69/70/71/72 remain open. OQ-39 now covers transaction ownership/atomicity, refusal, retry/durability and failure semantics for the synchronous Inventory → Accounting contract; PO-02 has already selected the internal mechanism. OQ-70 is narrowed to Purchase Return agreed-price variance (cost-based posting is allowed); OQ-69 auditor sufficiency, OQ-71 Accounting correction behavior, and OQ-72 system-origin authority remain open. No C-61 implementation is authorized.

---

## 2. MVP scope boundary

### 2.1 IN MVP — REQUIRED (Owner-directed scope correction)

The following capabilities are the required Backend MVP path. **Required does not mean implemented or accepted.** Each unimplemented capability remains a separately gated implementation candidate; unresolved implementation details remain OQ/ADR-gated.

1. **Foundation** — identity, users, RBAC, organization, documents, workflow, security and deployment foundations.
2. **Accounting Core + Accounting Completion** — accounting configuration, chart, vouchers, posting/ledger, periods, corrections, dimensions, posting rules, reporting read models and the accepted governance decisions, subject to their recorded gates.
3. **Full Inventory / Warehouse Subsystem** — not merely Inventory Core. Required operational scope is listed in §2.3.
4. **Party / Customer foundation** — preserve the existing party master and complete only the customer-facing foundation required by Sales; Party/Master Data Foundation is not Purchasing.
5. **Sales** — customer sales documents/invoices, line items, quantities, prices, tax-related fields under the approved tax model, numbering, lifecycle/finalization, applicable inventory effects and accounting effects.
6. **Sales → Accounting** — required capability; its implementation shape is gated by OQ-39/OQ-42/OQ-25/OQ-30 and related decisions. A manual voucher is not the final MVP integration state.
7. **Inventory → Accounting** — required independently of Purchasing; valuation, mapping and durable integration rules remain gated.
8. **Reporting** — Accounting, Inventory/Warehouse, Sales and required legal/accounting outputs. Generic Report Builder is not admitted without its own decision.
9. **Electronic Books / Tax Accounting / Iranian legal accounting outputs** — required MVP capability, with legal/tax facts validated from Owner-provided samples and domain/legal review. Formats are not invented.

### 2.2 OUT OF CURRENT MVP / POST-MVP

| Capability | MVP posture and boundary |
|---|---|
| **Purchasing** | **POST-MVP**: supplier purchasing flow, purchase documents/invoices, purchasing lifecycle and purchasing-specific behavior. OQ-16 remains open; no MVP dependency. |
| **Purchasing → Accounting** | **POST-MVP**. It is not a condition of the MVP graph or Final Gate. |
| **Purchasing Reports** | **POST-MVP**. Inventory reports remain MVP and are not purchasing reports. |
| **Treasury** | **POST-MVP / DEFERRED**: cash, bank, Treasury Receipt/Payment, cheque, settlement, bank reconciliation and Treasury-native reports. |
| External Taxpayer System Adapter | Separate integration boundary; not implied by Electronic Books / Tax Accounting. OQ-43 remains open. |

**Terminology boundary:** Warehouse Receipt (quantity or rial) and Warehouse Issue are Inventory/Warehouse MVP documents. Treasury Receipt and Treasury Payment are Treasury capabilities and remain POST-MVP. Warehouse Receipt is not Purchasing; removing Purchasing does not remove Inventory Receipt or Issue.

Other post-MVP items remain as previously classified: payroll/HR, multi-currency activation, offline sync, public API/webhooks, marketplace, two-book accounting, consolidation, advanced customization and unadmitted integrations.

### 2.3 Full Inventory / Warehouse MVP scope

**Inventory Core ≠ Full Inventory / Warehouse.** Inventory Core is the technical/domain foundation already present on `main` (movement ledger, balances, reservations and transfers). The Owner-directed MVP requires the complete operational subsystem built on that foundation, without changing its architecture.

| Required MVP capability | Scope boundary / current classification |
|---|---|
| Warehouse master / coding | Warehouse coding, definition/management and required warehouse master information; implementation candidate, not present as a complete operational flow. |
| Product / Item master | Product/item coding, definition, supported attributes, required units, barcode and required master data; no business rules invented beyond repository/Owner evidence. |
| Opening balances | **Opening quantity** and **opening rial** are separate required capabilities; dependencies on Inventory and Accounting are distinct. |
| Operational documents | Material Request; Warehouse Receipt — quantity and rial; Warehouse Issue — quantity and rial. Receipt/Issue remain Inventory documents, not Purchasing. |
| Valuation / rial flows | Quantity stock and rial stock; unvalued receipts and unvalued issues. **Updated 2026-10-04:** the valuation *method and state* are now decided and implemented (OD-VAL-01…19, ADR-0039 — moving weighted average, cost-optional receipts, explicit bounded repricing), and "unvalued receipt/issue" is a first-class queryable state rather than a missing concept. The *accounting treatment* (COGS/journal posting and mapping) remains gated by OQ-24/OQ-25/OQ-11 plus OQ-39/OQ-42/OQ-72 for posting semantics/mode/authority. Inventory return-costing conventions are in PDR-08; OQ-70 gates only Purchase Return agreed-price variance. |
| Reports | Current stock, quantity stock, rial stock, quantity Kardex, rial Kardex, unvalued receipts, unvalued issues, item movement, inventory analysis, inventory management and inventory settings. |

Preserved architecture: `Inventory Movement → Inventory Balance`; where the existing contract applies, `Available = Quantity - Reserved`; immutable movement semantics, OD-VAL-17's MVP rejection of physical negative inventory, organization isolation, module ownership and no direct cross-module Prisma access remain binding. Legacy Item/Warehouse `allowNegativeStock` overrides conflict with that approved posture and are recorded as an implementation discrepancy in C-61; no code is changed by this roadmap. Generic Report Builder is not admitted merely because Inventory reports are required.

### 2.4 Capability state rule

`NOT PRESENT` or `DOCUMENTED BUT NOT IMPLEMENTED` means **MVP-required implementation candidate** for the capabilities in §2.1/§2.3; it does not mean POST-MVP. Purchasing, Purchasing → Accounting, Purchasing Reports and Treasury are the actual POST-MVP boundaries.

### 2.5 Open decisions remain open

Scope admission does not close OQ-24, OQ-25, OQ-30, OQ-34, OQ-35, OQ-39, OQ-42, OQ-43 or OQ-54, and does not promote any ADR. Capability is required; implementation rule remains OQ/ADR-gated.

### 2.6 Owner-blocked implementation gates

The required path remains blocked where repository evidence says it is blocked: Base Chart content loading (per OD-27-02, DECIDED 2026-09-27: concrete Base Chart content is **not required for MVP** — the block applies only to loading content without a separately approved content artifact) and OQ-36 prerequisites; valuation; tax/pricing/credit/finalization policy; durable integration; posting mode; Iranian legal validation; report-builder depth; security/tenant decisions; and all recorded acceptance backlogs. The roadmap is a navigation map, not permission to code.

## 3. Updated MVP dependency graph

This is a conceptual dependency map; repository evidence and the gates below remain authoritative.

```text
Foundation
    ↓
Accounting Core
    ↓
Accounting Completion
    ↓
Party / Customer foundation
    ↓
FULL INVENTORY / WAREHOUSE
    ├── Warehouse Coding
    ├── Product Coding / Attributes / Units / Barcode
    ├── Opening Quantity / Opening Rial
    ├── Material Request
    ├── Receipt Quantity / Receipt Rial
    ├── Issue Quantity / Issue Rial
    ├── Stock Management / Inventory Settings
    └── Inventory Reports (Stock / Kardex / Movement / Analysis / Unvalued)
    ↓
Sales
    ↓
Inventory Effects
    ↓
Sales → Accounting
    ↓
Accounting / Operational Reporting
    ↓
Electronic Books / Tax Accounting / Iranian legal accounting outputs
    ↓
Backend MVP Final Gate
```

`Inventory → Accounting` is an independent required path and is not downstream of Purchasing. Purchasing, Purchasing → Accounting and Purchasing Reports are outside this graph. Treasury is also outside it. Warehouse Receipt/Issue in the graph mean Inventory documents; Treasury Receipt/Payment is not represented.

**Dependency notes:** opening quantity depends on Inventory master/movement rules; opening rial depends additionally on Accounting and valuation policy; rial receipt/issue and unvalued-document reporting depend on valuation/account mapping decisions; Sales depends on Party, Documents, Inventory effects and tax/pricing/finalization decisions; Sales → Accounting and Inventory → Accounting both depend on durable integration/posting decisions, but neither depends on Purchasing. Electronic Books depends on accounting read models plus Owner-provided/legal validation, not on an external Taxpayer System adapter.

## 4. Phase 0 — Governance / current-state closure

**Objective.** Convert "merged and green" into a decided state before building unrelated functionality, and keep documentation synchronized with `main`. No new implementation.

**Scope.**

| # | Item | Dependencies | Repository evidence | Blocking OQ/ADR | Acceptance criteria |
|---|---|---|---|---|---|
| 0.1 | Owner acceptance decision — **Bootstrap System Administrator** (PR #64) | none | `docs/tasks/bootstrap-system-administrator/implementation-report.md`; STATE.md §7/§8 | OQ-14/OQ-19 remain OPEN regardless | Explicit ACCEPTED or CHANGES REQUIRED record; forced-password-change limitation either accepted or scheduled |
| 0.2 | Owner acceptance decision — **Task 23** (Base Chart mechanism, PR #66) | none | `docs/tasks/task-23/task-23-implementation-report.md`; 5 tables + 3 permissions in `main` | OQ-25/OQ-36/OQ-41/OQ-43 remain OPEN regardless | Explicit acceptance record; the four invariants (Template identity ≠ Ledger identity; Adoption = Copy; Posting = Leaf-only; Aggregation = read-time) confirmed |
| 0.3 | Owner acceptance decision — **Task 24 R-2** (PR #67) | none | `docs/tasks/task-24/task-24-implementation-report.md` | F-2…F-6 / R-1…R-6 remain recorded Owner decisions | Explicit acceptance record; F-2 disposition decided (see 6.1) |
| 0.4 | Historical acceptance backlog: **Tasks 13, 14, 15** and **ADR-0017…0021, 0031, 0032** (Proposed while implemented) | none | STATE.md §7; audit §C.16/§D-3/§D-4; audit recommendations K.1/K.2 | — | Each ADR/task receives an explicit accept/reject/recorded-backlog decision; no silent normalization |
| 0.5 | Comment-only correction of the stale authorization doc comment in `organization-permissions.ts` (contradicts the PR #55 rule) | a separately authorized change (production file) | audit D-7/G-2; recommendation K.3 | — | Comment matches shipped behavior; zero behavior change; CI green |
| 0.6 | Documentation synchronization (continuous) | each merged task | AG-07; STATE.md §11 | — | `STATE.md`, `.vardena/project-context.md`, `docs/modules.md`, task index agree with `main` after every merge |

**Non-goals.** No duplicate implementation task for already-merged work; no reopening of Task 19/20/21 decisions; no OQ closure; no ADR promotion (promotion is the Owner's act, not this roadmap's).

**Why first.** STATE.md §8 records that `main` is "READY FOR NEXT MAIN-BASED AUDIT" with three merged-not-accepted work items; the audit (§H.3) explicitly warns against normalizing code-ahead-of-governance as precedent.

---

## 5. Phases 1–7 (work-stream definitions)

Each item below follows the quality contract: objective, scope, non-goals, dependencies, evidence, blocking OQ/ADRs, expected slices, acceptance criteria, and — for implementation candidates — ownership/impact fields. **None of these items is authorized by this roadmap; each requires its own gate.**

### 5.1 Phase 1 — Accounting completion

**Purpose.** Finish the Accounting capabilities required by MVP without prematurely implementing post-MVP accounting features. The governing separation for every item:

```text
mechanism (exists — Task 23 merged)  ≠  content (OQ-25/OQ-36 — not approved)
                                    ≠  policy (OQ-23/27/41/42 — undecided)
                                    ≠  legal requirements (OQ-43 — expert validation)
```

**1A — Base Chart content approval + controlled content loading.**
- *MVP boundary (OD-27-02, DECIDED 2026-09-27):* the MVP requires the Base Chart **mechanism** but **not** a concrete Base Chart content set. 1A is therefore a decision-gated optional work item, **not** an MVP requirement: no content may be introduced by implementation inference, and no migration or seed may introduce content unless a separately approved content artifact exists.
- *Objective:* an Owner/accountant-approved Base Chart content artifact (codes, Persian titles, level shape, natures, postability defaults, mandatory-account list) loaded **through the Task 23 mechanism** (template → version → publish → explicit organization adoption).
- *Non-goals:* inventing content (Task 23 deliberately supplied none); direct DB seeding that bypasses the adoption mechanism; statutory claims (OQ-43 is separate); upgrading already-adopted organizations silently (Task 21: no silent mutation on template upgrade).
- *Dependencies:* Task 23 acceptance (0.2); **OQ-36 prerequisites recorded by Task 21 §10**: (1) code-reuse policy for superseded codes vs `uq_accounts_organization_id_code`; (2) deletion eligibility for unused adopted accounts; (3) code-history producer coexistence with the never-reuse rule.
- *Blocking OQ/ADR:* OQ-25 (content values, role catalog interplay), OQ-36; ADR-0037 Proposed (configuration boundary) pending its adoption gate.
- *Expected slices:* content decision pack → approval record → controlled loading through template/version/publish APIs → adoption rehearsal on a fixture organization.
- *Acceptance criteria:* approved content artifact recorded in-repo; loading uses only the Task 23 mechanism; leaf-only posting and copy-not-reference invariants hold; live-PG E2E green in CI.
- *Ownership/impact:* Accounting module; DB impact — rows via existing tables only (no new migration expected); API impact — none expected (existing template endpoints); events — none new; security — existing permissions + ODR-3; frontend dependency — chart tree already renders adopted accounts; testing — unit + live-DB E2E.

**1B — Account lifecycle / code history producer (pre-use correction).**
- *Objective:* implement the OD-20-4 boundary — controlled pre-use code correction, post-use immutability — resolving the recorded D-2 discrepancy (repository is stricter today: code immutable from creation).
- *Blocking OQ/ADR:* OQ-36 (reuse/deletion), ADR-0033 Proposed. *Non-goals:* the Code Structure Migration Service (ADR-0035 — explicitly not authorized); post-use code change of any kind.
- *Expected slices:* decision on pre-use editability; history schema only when a real producer exists (no speculative schema — task-index §4).

**1C — Control Roles (consumer-first).**
- *Objective:* the concrete control-role catalog and mandatory set, plus the effective-dated account→role mapping (OD-20-3), built only when a **consumer** exists (posting rules or reporting) — per OD-20-2 no speculative catalog.
- *Blocking OQ/ADR:* OQ-25 (catalog/mandatory set); ADR-0037 Proposed. *Dependencies:* a consumer task (posting rules 1G or a reporting consumer).

**1D — Detail dimensions.**
- *Objective:* line-level analytical dimensions per OD-20-6 (transaction-line assignments; read-layer aggregation when a concrete reporting consumer requires it; no ledger widening, no JSONB/EAV, no speculative projection).
- *Blocking OQ/ADR:* OQ-41 (count, per-dimension requiredness, master-data binding, item governance, area applicability); ADR-0037 Proposed. Interim fail-closed assumption: every attached dimension required on a posting line.

**1E — Corrections beyond reversal.**
- *Objective:* the contract §15.4 correction/difference, replacement-pair and adjustment mechanisms (only reversal is implemented) plus decided correction windows.
- *Blocking OQ/ADR:* OQ-27 (windows, cross-period corrections, uncorrectable documents); OQ-23 (period dating). Final-document immutability is settled (Q12/Q13) and must not be reopened.

**1F — Year-transition / opening carry-forward.**
- *Objective:* year-end closing/opening operations and cross-year opening carry-forward (currently explicitly out of scope: first-period opening = 0, no carry-forward — ADR-0031 §4/§9).
- *Blocking OQ/ADR:* OQ-23 (calendar policy: year start, layout, adjustment period, close/reopen authority, year-end entries). *Non-goals:* automated statutory year-end postings until decided.

**1G — Posting rules / account mapping engine.**
- *Objective:* the Accounting-owned mapping from source-module business events to journal entries (contract §20.2; referenced by roles, never free codes).
- *Blocking OQ/ADR:* OQ-24, OQ-25, OQ-30 (mapping/tax/valuation inputs); activation is additionally gated by OQ-39/OQ-42 (Phase 4). *Non-goals:* any source-module trigger before Phase 4 decisions.

**Also in Phase 1 (decision-only items):** OQ-40 financial-area grants/default area; OQ-42 posting-mode default (needed before any system posting); OQ-62/OQ-63 pin-divergence repair policy (ODR-1 rejects divergence on writes; existing divergent rows are not repaired).

### 5.2 Phase 2 — Reporting foundation

**Purpose.** Turn the existing, accepted Accounting read layer into the MVP reporting capability in bounded slices, per the accepted reporting strategy.

**Verified starting point (ACCEPTED):** `AccountingReadQueryRepository` + `GET /accounting/ledger-movements` (17A), `GET /accounting/account-statements` (17B), `GET /accounting/general-ledger` + `GET /accounting/trial-balance` (18), `GET /accounting/chart-tree` (19 ODR-2), balance projections (12). Pagination, 50,000-row hard bound, 5-second read timeout, allow-listed sorting, exact decimal strings, independent report permissions — all already established patterns.

**2A — Reporting foundation design task (investigation gate).**
- *Objective:* define the bounded MVP report set and the report-definition approach consistent with ADR-0009 (code-defined definitions, module-owned views, one pipeline).
- *Required verification:* MVP reporting candidates verified against the accepted strategy — Account Statement, General Ledger, Trial Balance, ledger movements, balance/movement views (all exist as read APIs); the Journal Book, Iranian legal books and electronic-book outputs are **MVP-required capability**, but their exact legal facts, fields and formats remain blocked by OQ-43 and ADR-0036 Proposed; a minimal P&L is only a *proposed* interpretation (MVP-SCOPE D-04 — proposal, not accepted).
- *Blocking OQ/ADR:* OQ-25/OQ-43 for any NEW layout; **OQ-49 for any builder** — a generic Report Builder is NOT admitted by default.

**2B — Report definition + query pipeline (bounded slices).**
- Report definitions in code registry over approved sources; permissions per report (`Module.Entity.Action`); filter/sort whitelists; row caps; read-only execution; view regression tests (fixture rows → expected output) per reporting-strategy §9.
- *Module impact:* the bounded Reporting capability and its module-view architecture are documented by ADR-0009 (Accepted), but a `reporting` module is **NOT PRESENT** on `main` (§1.2). Under AR-29 a new module is ADR-gated: the implementation task must confirm the architectural decision and supply any required adoption record before creating it. DB impact — module-owned views only where needed (raw SQL scoped per AR-11); API impact — `/api/v1/reports/...` namespace per strategy; frontend dependency — the four read surfaces already have UI; new report screens follow after API/OpenAPI stability.

**2C — XLSX/CSV export.**
- *Objective:* export of admitted reports/lists through the Excel module (ADR-0011/Accepted decision; OQ-46 recorded posture: XLSX export of reports/lists is the confirmed channel).
- *Dependencies:* 2B; heavy export may require the Jobs path (Phase 5 evaluation). *Non-goals:* full-fidelity database export (OQ-46: not promised).

**2D — Print/PDF.**
- *Objective:* printable reports (and later documents) per ADR-0012 (templates + module-owned print data providers).
- *Dependencies:* 2B; PDF rendering is worker/job work → Phase 5 admission; OQ-02 for remaining text/numeral localization (generic BusinessDate calendar and Instant zone/calendar follow ADR-0042). *Non-goals:* batch PDF pipelines beyond admitted scope.

### 5.3 Phase 3 — Operational ERP core

**Rule.** Full Inventory/Warehouse and Sales are required MVP capabilities, but this roadmap still does not authorize implementation. For each candidate the investigation must establish the twelve determinations required by the repository's own gate process: (1) existing repository support; (2) domain ownership; (3) blocking OQs; (4) the Accounting integration contract; (5) Inventory dependency; (6) Documents dependency; (7) Workflow dependency; (8) numbering dependency; (9) permissions; (10) required events; (11) required reports; (12) required frontend later.

**Verified starting point:** `organization.parties` exists as a flat master (code, display_name, legal_name?, party_type, is_customer, is_supplier, email?, phone?) — VERIFIED IN MAIN. Sales, Purchasing, AR/AP: NOT PRESENT.

- **3A — Party completion** (contacts/addresses/bank accounts/legal identifiers): BLOCKED by OQ-38; needed before statutory-facing sales documents; minimal MVP may proceed with the flat party.
- **3B — Sales (MVP REQUIRED)**: implementation investigation and domain contract. Evidence state: `modules.md` "v1 core — not implemented"; the Owner scope correction admits the capability, while MVP-SCOPE A-14 remains proposal documentation. Required scope: Party/Customer, sales document/invoice, line items, quantities, prices, approved tax fields, numbering, lifecycle/finalization, applicable inventory effect and accounting effect. Form-gating OQs: OQ-54 (cancel/edit policy), OQ-30 (tax fields), OQ-34 (pricing), OQ-35 (credit warnings), OQ-38 (identifiers). Reuses: Documents Foundation (numbering/types/relations), Workflow (approvals if admitted), parties, inventory (stock effects — OQ-15 second half).
- **3C — Full Inventory/Warehouse (MVP REQUIRED)**: expand Inventory Core into the complete operational scope in §2.3: warehouse/product coding, attributes, units/barcode, opening quantity and rial, Material Request, quantity/rial Receipt and Issue, stock management/settings, valuation/unvalued flows and reports. Existing Inventory Core architecture is preserved. **Updated 2026-10-04:** Material Request (C-50), the quantity Kardex (C-54) and the **valuation foundation** (ADR-0039) are implemented; valuation is no longer the gate for the Receipt/Issue rial halves — the remaining gates are the document lifecycle (OQ-54) and applicable Accounting policy/posting gates (OQ-11/OQ-24/OQ-25/OQ-39/OQ-42/OQ-72); OQ-70 gates Purchase Return variance only, while cost-based returns are permitted.
- **3D — Purchasing**: POST-MVP per the OQ-16 recorded posture. This does not remove Warehouse Receipt or Warehouse Issue; no purchasing dependency is permitted in the Inventory MVP path.
- **3E — Party / Customer foundation**: preserve the existing flat party master and complete the customer-facing foundation required by Sales; Supplier purchasing flow is not an MVP requirement.
- **3F — AR/AP**: no accepted admission anywhere; not required to admit Sales. If later admitted, it must be separately designed.


### 5.4 Phase 4 — Cross-module Accounting integration

**Architecture (binding):** `module-owned business operation → approved public application/domain contract → Accounting integration` for the source paths that have an explicit Owner decision. No direct cross-module Prisma/table access (AR-07/16). For Inventory → Accounting specifically, PO-02 / ADR-0041 selects a synchronous in-process contract; Inventory owns valuation facts, Accounting owns mapping and journal policy. Independent reactions may use domain events; the internal Inventory posting path is not event/outbox-primary.

**Verified starting point:** the Inventory `accounting_posted` flag creates no Accounting Voucher or posting reference; the in-memory event bus has no Accounting consumer. The internal application-service contract selected by C-61 is not implemented. OQ-39 remains open for transaction ownership/atomicity, refusal, retry/durability and failure semantics; the event bus is not a fallback posting path.

- **4A — OQ-39 transaction/failure semantics**: resolve source/Accounting transaction ownership and atomicity, posting-refusal behavior, retry/durability and failure semantics for the selected synchronous public contract. Do not re-open event/outbox vs sync as the primary internal mechanism. Only after applicable OQs: enabling code.
- **4B — OQ-42 posting-mode policy** (Mode A direct vs Mode B review; approval authority; segregation of duties).
- **4C — Inventory → Accounting (MVP REQUIRED; future C-62)**: implement only the approved Business Document sources and PO-01…PO-12 boundary; no raw ledger/event posting. Gate on applicable valuation/mapping policy (OQ-24/25/30), OQ-39 semantics, OQ-42/OQ-72 mode/authority and OQ-69 audit sufficiency for production traceability. OQ-70 blocks only Purchase Return agreed-price variance posting; OQ-71 applies only if a separate Accounting correction scope is admitted. No implementation is authorized by this roadmap or by C-61.
- **4D — Sales → Accounting (MVP REQUIRED)**: requires a separate Sales Accounting contract and Owner decisions; do not infer Inventory's integration or posting rules. Sales Return Accounting is deferred until that contract exists (PDR-09 / PO-12). OQ-30/OQ-39/OQ-42 and related gates remain open.
- **Treasury → Accounting: NOT MVP.** If a capability (e.g. settlement/allocation) requires Treasury in the future, it is POST-MVP/DEFERRED unless current accepted repository documentation explicitly says otherwise — it does not.

### 5.5 Phase 5 — Durable infrastructure / worker / outbox / jobs

**Verified starting point (target ≠ implemented):** worker = startup gate only, no dispatch loop; no outbox table; no jobs table; no persisted domain events; `docs/architecture.md` §8 carries a dated implementation-status note saying exactly this.

**Admission rule.** Do not build infrastructure merely because an architecture diagram contains a box. Admit a slice only when an admitted MVP capability requires it:

| Capability (if admitted) | Infrastructure it would require |
|---|---|
| An admitted external integration requiring durable delivery | `sync.outbox_events` + worker dispatch + retry/dead-letter (ADR-0004) |
| Heavy/async report exports, PDF rendering | `jobs` DB-backed queue + worker pickup (ADR-0010) |
| Audit consuming domain events durably | persisted `core.domain_events` (ADR-0005 target) |
| Internal Inventory → Accounting posting | The synchronous public contract is selected; OQ-39 still decides transaction/failure semantics. OQ-39 does not by itself require an outbox or worker. |

Each admission carries: idempotency (AR-15), retry, failure recovery, observability. Any new module/schema is ADR-gated where it changes cross-module patterns (AR-29).

### 5.6 Phase 6 — Audit / security / tenant hardening

**Verified starting point:** ODR-3 membership chokepoint implemented and accepted (Task 19 + PR #55 correction); AuthorizationGuard fails closed; no wildcards; denial logging documented but no Audit module exists; Task 24 fixed the Account list; **Task 26 (PR #71) completed ODR-3 read-scope enforcement across all 37 surfaces** (Accounting, Documents, Inventory, Organization, Workflow). The global `DeploymentOrganizationScopeGuard` is verified registered as `APP_GUARD` in `organization.module.ts:81`.

- **6.1 ODR-3 list-scope completion (F-2 / SEC-01)** — **COMPLETED** (Task 26 / PR #71; verified by `organization-read-scope-completion.spec.ts`, 38 tests PASS).
- **6.2 Audit module scope decision** — AR-23 and `docs/security.md` §4 (Accepted foundation) specify append-only `audit.audit_logs`, in-transaction audit port, v1 audited-actions list. The module is NOT PRESENT. The Owner must decide the MVP audit surface (what is audited, retention per OQ-17, auditor role per OQ-14). Sensitive Accounting writes already carry audit columns/events — the persistent, queryable audit store does not exist.
- **6.3 Identity session-surface completion** — session list/revoke (self/admin), self-service password change, forced-change-on-first-login (the bootstrap's known limitation). Documented module surface (security.md §2) vs implementation gap (audit C.8).
- **6.4 Administrator safety (OQ-19)** — self-disable/self-role-removal/last-admin lockout protections; currently no special case is applied.
- **6.5 Verification pass** — denial-path coverage for every MVP endpoint; permission-declared-on-every-endpoint audit; no-wildcard/no-bypass proof; organization-isolation regression suite (pattern exists from Task 24); security logging posture; correlation-ID propagation (exists in kernel).

**Hard rule:** no administrator wildcard bypass may be introduced at any point (OQ-21 posture; ADR-0006).

### 5.7 Phase 7 — Production readiness

Only items required before calling Backend MVP production-ready:

- **7.1 CI verification**: both jobs green on the final head; **branch-protection required checks confirmed by the Owner** (UNKNOWN — BOOT-OQ-04); consider adding the Task 13 operational-freeze rehearsal as a CI step (audit K.6 — recorded recommendation).
- **7.2 Migration deploy rehearsal**: `prisma migrate deploy` on a clean PostgreSQL 16 (CI does this every run); a migration rehearsal for any new migration that transforms data (pattern: Task 11/13 rehearsals).
- **7.3 Task 12 P1 — real-PostgreSQL concurrency verification** (OPEN follow-up of an ACCEPTED task): independent connections, lock-timeout/deadlock assertions for projection maintenance/rebuild. CI-level execution.
- **7.4 Backup/restore posture**: no implementation exists; daily logical `pg_dump` is the documented strategy (database-strategy §14). Decide the MVP-visible surface (scheduled backup, controlled restore) against OQ-52/OQ-53; **the MVP scope proposal's customer-visible backup feature is a proposal, not admitted**.
- **7.5 Concurrency/locking**: canonical lock order documented (`docs/accounting/lock-order-matrix.md`); verify new write paths extend it; deadlock handling evidence for admitted integrations.
- **7.6 Worker lifecycle**: if Phase 5 admits worker loops — graceful shutdown, retry/dead-letter surfacing, observability. Otherwise: document the worker as startup-gated only.
- **7.7 Health/readiness**: exist (`/api/v1/health/live|ready`); verify they cover the admitted infrastructure.
- **7.8 Configuration/secrets**: `.env.example` exists for backend and root; production review — shared-deployment password authentication (README notes the compose default DB is network-private), secrets via env (AR-20), TLS posture (OQ-06), session/lockout defaults.
- **7.9 Observability**: JSON logging + correlation IDs exist; define the MVP baseline for metrics/alerting (currently none — UNKNOWN whether required; Owner decision).
- **7.10 API/OpenAPI consistency**: generated contract; verify error-envelope stability, permission declaration coverage, pagination caps on every list surface.

**Heavy testing rule:** full live-PostgreSQL E2E and integration suites belong to GitHub CI (`docs/testing/test-execution-policy.md`); Arena agents must not block on local heavy E2E.

---

## 6. Backend MVP track vs Frontend track

**Backend MVP Track (authoritative completion path):** Phases 0–8 above. Backend capability definition never waits on frontend work.

**Frontend Track (dependent):**

```text
Backend capability → API/OpenAPI stable → frontend feature slice
```

Currently consumed backend APIs (VERIFIED in `frontend/src/api/`): `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`, `GET /permissions/effective`, `GET /organizations`, `GET /accounting/chart-tree`, `GET /accounting/account-statements`, `GET /accounting/general-ledger`, `GET /accounting/trial-balance`, plus supporting lists `GET /accounts`, `GET /financial-areas`, `GET /fiscal-years`, `GET /accounting-periods`.

| Future frontend slice | Backend dependency | Status |
|---|---|---|
| Voucher create/edit/finalize UI | Accounting write APIs (exist) — needs Owner admission of the UI scope, not new backend rules | candidate |
| Base Chart administration UI | Task 23 endpoints (exist, not accepted) | candidate — after Task 23 acceptance |
| Inventory screens | Inventory APIs (exist) | candidate |
| Report screens beyond the four read surfaces | Phase 2 reporting APIs | blocked by Phase 2 |
| Sales screens | Phase 3 Sales APIs | blocked by Phase 3 implementation/domain gates |
| Login-adjacent UX (password change, session management) | Phase 6 identity completion | blocked by 6.3 |
| Persian-numeral and broader language/number localization | OQ-02 remaining scope; generic BusinessDate calendar and Instant zone/calendar are accepted in ADR-0042 | blocked by OQ-02 only for remaining localization |

**Rules:** frontend implementation must not silently define backend business rules (frontend checks are UX only — AR-21); grid-state persistence waits for the customization module (not admitted); the frontend is **not** required to be complete before declaring Backend MVP.

---

## 7. Phase 8 — Backend MVP Final Gate

The gate verifies **capabilities**, not task existence. Backend MVP may be declared complete only when every item below is verifiably true on a single `main` head:

### Architecture
- [ ] Modular monolith intact; no microservices, no second database, no external broker (AR-01).
- [ ] No cross-module Prisma/table access (AR-07); cross-module effects only via events/public services.
- [ ] All migrations valid and deployable to a clean PostgreSQL 16 (CI `migrate deploy` green); no edited applied migrations.
- [ ] Module boundaries intact (controllers transport-only; kernel technical-only).

### Security
- [ ] Principal-bound organization isolation on **every** organization-scoped surface (ODR-3) — including the F-2 list surfaces.
- [ ] Permission enforcement on every endpoint; fail-closed guard; denial-path tests for every MVP endpoint.
- [ ] No wildcard/superuser bypass anywhere; no permission-only cross-organization administration.
- [ ] Audit/security requirements met per the Owner-decided audit surface (Phase 6.2); sensitive writes auditable; denial/security logging in place.
- [ ] Immutable accounting history intact (ledger insert-only; RESTRICT FKs; correction-by-counter-document only).

### Core ERP
- [ ] Organization/master data, Inventory, Documents, Workflow, Accounting — per the verified inventory (§1.2), plus each Phase 1–5 item the Owner admitted.
- [ ] Chart: Base Chart mechanism (OD-27-02, DECIDED 2026-09-27: mechanism **required for MVP**; concrete content **NOT required for MVP** — content only if a separately approved content artifact is admitted under Phase 1A); leaf-only posting; read-time aggregation.
- [ ] Posting/ledger: atomic, idempotent, period-close-enforced.
- [ ] Reporting: Accounting, Inventory/Warehouse, Sales and required Electronic Books/Tax Accounting outputs served with permissions, bounds and timeouts; exact legal formats validated rather than guessed.
- [ ] Full Inventory/Warehouse operational flow: master/coding, openings (quantity and rial), Material Request, quantity/rial Receipt and Issue, stock, settings, valuation/unvalued flows and inventory reports.
- [ ] Sales and Party/Customer flow per the required scope, including lifecycle/finalization and applicable inventory effect.
- [ ] Inventory → Accounting and Sales → Accounting are operational MVP capabilities, but use separate approved source contracts. Inventory → Accounting follows the synchronous public-contract decision (PDR-09 / ADR-0041); Sales Accounting remains outside C-61 and requires its own contract. Implement neither path until its applicable OQ/ADR gates are resolved.
- [ ] Purchasing, Purchasing → Accounting, Purchasing Reports and Treasury are not required by this gate.

### Required operational qualification flows
- [ ] End-to-end: Master Data → Inventory/Warehouse → Sales → Inventory Effect → Accounting Effect → Reports → Electronic Books/Tax Accounting.
- [ ] Inventory standalone: Warehouse → Product → Opening Quantity/Rial → Material Request → Receipt/Issue → Movement → Stock → Quantity/Rial Kardex and reports.
- [ ] Purchasing is not a qualification prerequisite; Warehouse Receipt is explicitly qualified as Inventory, not Purchasing.

### Reliability
- [ ] Idempotency where required (posting operations — exist; outbox consumers if admitted — AR-15).
- [ ] Transactional consistency (posting transaction, projection maintenance, lock-order matrix respected).
- [ ] Worker/outbox/jobs — implemented **if and only if** an admitted capability requires them; startup-gated worker otherwise documented.
- [ ] Concurrency evidence: Task 12 P1 closed (real-PG verification) or explicitly re-scoped by the Owner; lock/deadlock behavior of admitted integrations proven in CI.
- [ ] PostgreSQL verification: live-DB suites green in CI on the final head.

### API
- [ ] OpenAPI consistent with implementation; generated types consumable (frontend flow works).
- [ ] Permissions declared on every operation; error contract `{code,message,details?,correlationId}` stable; pagination/limits enforced on every list.

### Documentation
- [ ] `docs/`, `STATE.md`, `.vardena/`, task index and ADR/OQ registries synchronized with `main`.
- [ ] Task statuses accurate; ADR statuses accurate; OQ statuses accurate.
- [ ] **No implementation falsely described as accepted** anywhere.

### Frontend dependency record
- [ ] The list of Backend MVP APIs consumed by the current frontend (§6) remains functional (contract stability).
- [ ] Future frontend slices dependent on Backend MVP completion are recorded with their blocking backend capability (§6 table) — frontend completeness itself is NOT a gate.

---

## 8. Rules for maintaining this roadmap

1. Update through a documentation task whenever `main` changes materially (new task accepted, OQ resolved, ADR promoted, module admitted) — the repository wins on conflict.
2. Never convert a candidate into a numbered task here; use the Future Task Candidate Register (`future-task-candidates.md`) and the governing gate process (`docs/accounting/task-index.md` §7 for Accounting; the equivalent Owner-approved brief for other domains).
3. Never record an acceptance in this roadmap; acceptance records live in `docs/tasks/<task>/` and `STATE.md`.
4. The final gate (§7) is the only place where "Backend MVP complete" may be asserted, and only by the Owner.

---

## Final status

**READY FOR REVIEW — NOT ACCEPTED.** This roadmap does not self-accept, closes no Open Question, promotes no ADR, accepts no task, and authorizes no implementation.
