# Vardena — Backend MVP Dependency Matrix

| | |
|---|---|
| Status | **READY FOR REVIEW — NOT ACCEPTED** |
| Date | 2026-09-27 |
| Type | Roadmap companion (documentation only) |
| Inspection baseline | `main` @ `c654be916fe75e25ff2862900994c86aa1c20892` |
| Parent | [backend-mvp-roadmap.md](./backend-mvp-roadmap.md) |
| Production code changed | **NONE** |

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
| inventory | PARTIAL (master data + movement ledger/balances/reservations/transfers; costing/valuation absent) | organization, documents (numbering), workflow (bindings) | future Accounting integration (Phase 4C) | OQ-24 (valuation), OQ-29 (units/conversions), OQ-33 (item model) | ADR-0022 Accepted; ADR-0017 Proposed (code ahead of governance) | IN MVP — costing decision needed only if integration admitted |
| documents | IMPLEMENTED | organization | inventory (numbering), accounting (serials), future sales | OQ-12 (numbering policy extensions) | ADR-0023 Accepted | IN MVP (done) |
| workflow | IMPLEMENTED | organization | any module using approvals (none wired to business docs yet) | OQ-13, OQ-26 (approval content) | ADR-0024 Accepted | IN MVP (done) |
| accounting | PARTIAL (deepest: foundation → chart/configurations → documents → posting/ledger → projection → reversal → read surfaces → Base Chart mechanism) | organization (scope/memberships), documents (numbering), rbac | future reporting consumers, future source-module integrations | OQ-25/36/41/43 (content), OQ-23 (calendar), OQ-27 (corrections), OQ-39/42 (system posting), OQ-62/63 (pins) | ADR-0026/0028 Accepted; ADR-0031/0032 Proposed (implemented); ADR-0033…0037 Proposed | IN MVP — Phase 1 completion |
| audit | NOT PRESENT | (design: consumes events from all modules) | — | OQ-17 (retention), OQ-14 (auditor role) | none (security.md §4 design is Accepted foundation) | IN MVP scope decision required (Phase 6.2) |
| notifications | NOT PRESENT | events | — | OQ-15 | none | NOT ADMITTED (post-MVP unless Owner decides) |
| sales | NOT PRESENT | organization (parties), documents, inventory (stock effect), workflow (approvals), accounting (integration Phase 4D) | reporting (sales views), accounting | OQ-54, OQ-30, OQ-34, OQ-35, OQ-38; OQ-15 (stock-on-sale) | none | **Owner admission required** (Phase 3B); MVP-SCOPE proposal is not accepted |
| purchasing | NOT PRESENT | same pattern as sales | accounting | OQ-16 | none | POST-MVP (OQ-16 recorded posture) |
| reporting | NOT PRESENT (Accounting owns bounded read surfaces) | module-owned views / read sources | excel (export), print (printing), frontend | OQ-25/OQ-43 (new layouts), OQ-49 (builder), OQ-02 (labels) | ADR-0009 Accepted (architecture) | IN MVP — bounded (Phase 2) |
| excel | NOT PRESENT | reporting pipeline (export), modules (import specs) | — | OQ-46 (recorded posture: XLSX export of reports/lists confirmed channel), OQ-08 (artifacts) | ADR-0011 Accepted (decision) | IN MVP — bounded export (Phase 2C) |
| print | NOT PRESENT | reporting, worker/jobs (PDF) | — | OQ-02 (labels/locale) | ADR-0012 Accepted (decision) | IN MVP — bounded (Phase 2D), depends on Phase 5 evaluation |
| customization | NOT PRESENT | — | frontend (grid persistence) | OQ-09 | ADR-0013 Accepted (decision) | NOT ADMITTED for MVP unless Owner decides |
| integration | NOT PRESENT | sync (outbox), adapters | — | OQ-04 (legacy), OQ-05 (taxpayer), OQ-07 (payments) | ADR-0003 Accepted (boundary) | POST-MVP |
| sync (outbox) | NOT PRESENT | — | integration, external delivery | OQ-39 | ADR-0004 Accepted (decision) | admitted only if Phase 4/5 requires (OQ-39) |
| jobs | NOT PRESENT (JobsRegistry stub) | — | print/PDF, async reports, backups | — | ADR-0010 Accepted (decision) | admitted only if a capability requires (Phase 5) |
| **treasury** | **NOT PRESENT** | — | — | — | — | **DEFERRED — OUT OF MVP** (explicit boundary; not a final-gate dependency) |

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
| Detail dimensions (line-level) | NOT PRESENT | chart | **OQ-41** | ADR-0037 Proposed | Phase 1D — decision-gated |
| Account code history / pre-use correction producer | NOT PRESENT (repo stricter: immutable from creation) | OQ-36 answers | OQ-36, OQ-25 | ADR-0033 Proposed | Phase 1B — decision-gated |
| Corrections (correction/difference, replacement, adjustment) | NOT PRESENT (contract-only) | posting, periods | **OQ-27** | — | Phase 1E — decision-gated |
| Year-transition / opening carry-forward | NOT PRESENT (explicitly excluded from projection) | calendar | **OQ-23** | — | Phase 1F — decision-gated |
| Posting rules / account mapping | NOT PRESENT | chart, roles | OQ-24, OQ-25, OQ-30 (+ OQ-39/42 for activation) | — | Phase 1G — required only if integration admitted |
| Inventory → Accounting integration | NOT PRESENT (no consumer; in-memory bus only) | posting rules + OQ-39 decision | **OQ-39** (+24/25/30, 42) | ADR-0005 Accepted (contract); new ADR likely for delivery semantics | Phase 4C — decision-gated |
| Statutory/legal books (Journal Book etc.) + Legal Profile | NOT PRESENT | read layer (exists) | **OQ-43 — legal validation required** | ADR-0036 Proposed | **POST-MVP** unless Owner admits after legal validation |
| Code Structure Migration Service | NOT PRESENT — explicitly not authorized | code history, licensing, backup | OQ-45, OQ-52/53, OQ-62/63 | ADR-0035 Proposed; ADR-0030 Proposed | **POST-MVP** |
| Settlement / allocation (Task 16) | NOT PRESENT | contract finalized; implementation authorization BLOCKED | Owner confirmation | — | **BLOCKED**; bounded by Treasury deferral |

---

## 3. OQ dependency matrix

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
| OQ-24 | Inventory valuation / negative stock | OPEN | posting rules (inventory), valuation reports | Yes (manual accounting works) | Only if Phase 4C admitted |
| OQ-25 | Chart content / control roles / layouts | OPEN — substantially narrowed (Tasks 20/21); content values + role catalog remain | Base Chart content, control roles, new report layouts | No (content is the core of Phase 1A) | **Yes — the primary Accounting blocker** |
| OQ-27 | Correction windows / cross-period corrections | OPEN | corrections beyond reversal | Partially | Only if Phase 1E admitted |
| OQ-30 | Tax model | OPEN | sales tax fields, posting mappings | Yes | Only if Sales/Phase 4 admitted |
| OQ-36 | Master-data lifecycle (deletion, code reuse) | OPEN (Task 21 records explicit Base Chart prerequisites) | Base Chart content loading, code history producer | No — Task 21 §10 lists the three prerequisites | **Yes for Phase 1A/1B** |
| OQ-38 | Party detail (contacts/addresses/identifiers) | OPEN | party completion, statutory-facing sales docs | Yes (flat party works for MVP) | Only if Sales with statutory fields admitted |
| OQ-39 | Durable integration semantics | OPEN — **gates all system-generated posting** | Inventory/Sales → Accounting, outbox admission, rejected-posting semantics | Yes (manual voucher fallback stands) | **Yes iff any integration is admitted**; otherwise deferrable with the gate recorded |
| OQ-40 | Financial areas (count, grants, default) | OPEN (interim: one area, structural access) | area grants, per-area charts | Yes | No — interim posture stands |
| OQ-41 | Detail dimensions (count/defaults/binding) | OPEN (OD-20-6 decided line-level boundary) | dimensions implementation | Partially (account-tree-only postings work) | Only if Phase 1D admitted |
| OQ-42 | Posting modes (A direct / B review) | OPEN | system posting activation | Yes (nothing system-posted today) | Only if Phase 4 admitted |
| OQ-43 | Iranian statutory requirements | OPEN (architecture Proposed ADR-0036; every legal fact needs validation) | legal books, statutory layouts, e-ledger | Yes — no statutory feature may be built without validation | **No — statutory is POST-MVP**; only the *architecture* is decided |
| OQ-49 | Report Builder depth | OPEN (no depth committed) | generic builder | Yes (registry reports suffice) | **No — builder NOT required for MVP**; bounded reports only |
| OQ-54 | Finalized document deletion/editing policy | OPEN (cancel-only recommended, not decided) | sales/inventory state machines | Yes until those modules admitted | Only if Phase 3B admitted |
| OQ-60 | MVP acceptance thresholds | OPEN (numbers are proposals) | the final gate's numeric criteria | Recommended no | **Yes for Phase 8** — the Owner should ratify or waive |
| OQ-62 | Account pin compatibility (repair, authoritative pin) | OPEN (ODR-1 enforces on writes; existing divergent rows not repaired) | pin repair, migration preflight | Yes | No — write-time enforcement stands |
| OQ-63 | LEGACY fallback shape | OPEN | legacy org migration correctness | Yes | No |
| OQ-52/53 | Backup RPO/RTO; disaster recovery | OPEN (no targets committed; controlled-restore principle recorded) | backup/restore MVP surface | Yes (documented daily pg_dump strategy stands) | Only if customer-visible backup admitted (Phase 7.4) |

## 4. ADR dependency matrix

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
| ADR-0036 | Legal reporting architecture | Proposed | Legal Profile, legal books | Yes | **No — POST-MVP** (OQ-43 validation first) |
| ADR-0037 | Accounting configuration boundary | Proposed | control roles / dimensions / Base Chart content implementation | Partially | Adoption gate before Phase 1C/1D implementation |
| ADR-0027 | *(does not exist)* | — | — | — | number gap preserved; do not fill |

---

## 5. Infrastructure dependency matrix (target vs implemented)

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
