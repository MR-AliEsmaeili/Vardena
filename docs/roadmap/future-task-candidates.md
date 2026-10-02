# Vardena — Future Task Candidate Register

| | |
|---|---|
| Status | **READY FOR REVIEW — NOT ACCEPTED** |
| Date | 2026-09-27 |
| Type | Roadmap companion (documentation only) |
| Inspection baseline | `main` @ `c654be916fe75e25ff2862900994c86aa1c20892` |
| Parent | [backend-mvp-roadmap.md](./backend-mvp-roadmap.md) |

> This register exists so that future work items are **candidates, not falsely
> authorized tasks**. Per the task-numbering rule, this roadmap creates **no**
> Task 25, 26, 27… — a numbered implementation task is created only when its
> investigation/decision gate is ready, through the governing process
> (`docs/accounting/task-index.md` §7 for Accounting; the equivalent
> Owner-approved brief elsewhere). "Implementation?" records whether any
> implementation exists on `main` today.
>
> Statuses: `CURRENT` (actively awaiting Owner action) · `ACCEPTED` ·
> `IMPLEMENTED — NOT ACCEPTED` · `READY TO INVESTIGATE` · `BLOCKED BY OQ` ·
> `BLOCKED BY ADR` · `BLOCKED BY OWNER ADMISSION` · `BLOCKED BY DEPENDENCY` ·
> `PLANNED` · `POST-MVP` · `DEFERRED`.

> **Current-state addendum (2026-10-02, baseline `main` @ `4cf481e`, merge of PR
> #107).** Rows **C-47 … C-54** were re-verified against code, and **C-55**/**C-56**
> were added as bounded, blocked follow-ups of the Owner decisions recorded that
> day (OD-C47-01…OD-C47-04 — see
> [`../tasks/c-47-owner-decision-and-dependency-reconciliation.md`](../tasks/c-47-owner-decision-and-dependency-reconciliation.md)).
> Verified corrections carried into the rows: OQ-11's inventory relevance is the
> **accounting opening import and the costing method**, not quantity-opening
> mechanics; **OQ-23** and **OQ-54** are genuine, previously unlisted
> prerequisites of the opening and receipt/issue flows; **OQ-49 blocks only a
> generic report builder**, not bounded code-defined inventory reports. **C-50
> (Material Request) is the next dependency-ready candidate — for investigation
> only.** No candidate in C-48…C-54 is ready for implementation, no OQ is closed
> by this addendum, and no status is promoted to `ACCEPTED`.
>
> **C-50 investigation addendum (2026-10-02, `main` @ `0e600689`).** The bounded
> investigation is complete in
> [`../tasks/c-50-material-request-investigation.md`](../tasks/c-50-material-request-investigation.md).
> It confirms that no Material Request artifact or Inventory document-type
> registration exists, the reusable foundations are implemented but do not decide
> the product contract, and implementation remains blocked by OQ-54, OQ-13/OQ-26,
> the unregistered reservation/C-52 rule, the minimum domain contract, and explicit
> Owner admission. No production code, OQ status, ADR status, or Owner decision was
> changed.

---

## Register

| Candidate | Purpose | Depends on | Blocking OQ | Blocking ADR | Implementation? | Status |
|---|---|---|---|---|---|---|
| C-01 Owner acceptance — Bootstrap System Administrator | Accept or reject the merged provisioning command (PR #64, PR #72) | — | OQ-14/OQ-19 remain open regardless | ADR-0038 Proposed | **YES — merged, CI green** | **CURRENT** |
| C-02 Owner acceptance — Task 23 (Base Chart mechanism) | Accept or reject the merged template/adoption mechanism (PR #66) | — | OQ-25/36/41/43 remain open regardless | ADR-0037 Proposed | **YES — merged, CI green** | **CURRENT** |
| C-03 Owner acceptance — Task 24 R-2 | Accept or reject the account-list scope correction (PR #67) | — | — | — | **YES — merged, CI green** | **CURRENT** |
| C-04 Governance backlog — Tasks 13/14/15 + ADR-0017…0021, 0031, 0032, 0038 | Give every merged-but-unaccepted item an explicit Owner verdict (audit recommendations K.1/K.2) | — | — | the nine ADRs themselves | YES (all implemented) | **CURRENT** (governance) |
| C-05 `organization-permissions.ts` stale comment correction | Remove the doc comment contradicting the PR #55 membership-administration rule | — | — | — | **RESOLVED** (Task 25 / PR #70) | **RESOLVED** |
| C-06 ODR-3 list-scope completion (Task 24 F-2 / Task 25 SEC-01) | Assert `assertOrganizationInScope` on all 37 organization-scoped read surfaces | — | — | — | **RESOLVED** (Task 26 / PR #71) | **RESOLVED** |
| C-07 Base Chart content approval + controlled loading | Owner/accountant-approved chart content loaded through the Task 23 mechanism | C-02; OQ-36 prerequisites (reuse policy, deletion eligibility, code-history coexistence) | **OQ-25 (content values), OQ-36** | ADR-0037 Proposed (adoption gate) | mechanism YES; content NO | **BLOCKED BY OQ** |
| C-08 Account code history / pre-use correction producer | Implement OD-20-4 (controlled pre-use correction, post-use immutability), resolving discrepancy D-2 | OQ-36 answers | OQ-36, OQ-25 | ADR-0033 Proposed | NO (code immutable from creation — stricter than decided) | **BLOCKED BY OQ** |
| C-09 Control roles (catalog + effective-dated mapping) | Concrete control-role catalog/mandatory set + account→role mapping per OD-20-2/OD-20-3 | a **consumer** task first (posting rules C-13 or a reporting consumer) | **OQ-25** | ADR-0037 Proposed | NO | **BLOCKED BY OQ + BLOCKED BY DEPENDENCY** (consumer-first) |
| C-10 Detail dimensions (line-level analytical assignments) | Implement OD-20-6 boundary (typed assignment table, no EAV/JSONB/ledger widening) | — | **OQ-41** (count/defaults/binding/governance) | ADR-0037 Proposed | NO | **BLOCKED BY OQ** |
| C-11 Corrections beyond reversal (correction/difference, replacement, adjustment) | Implement contract §15.4's remaining mechanisms + decided windows | — | **OQ-27** (OQ-23 for period dating) | — | NO (only reversal exists) | **BLOCKED BY OQ** |
| C-12 Year-transition operations / opening carry-forward | Year-end closing/opening operations; cross-year opening balances | — | **OQ-23** | — | NO (explicitly excluded from projection) | **BLOCKED BY OQ** |
| C-13 Posting rules / account mapping engine | Accounting-owned mapping from source events to journal entries | control roles (C-09) for role references | OQ-24, OQ-25, OQ-30 (+ OQ-39/42 for activation) | — | NO | **BLOCKED BY OQ** |
| C-14 Reporting foundation (bounded report definitions + pipeline) | Code-defined reports over approved read sources per ADR-0009; permissions, caps, timeouts | — | OQ-25/OQ-43 only for NEW layouts; **OQ-49 blocks any builder** | ADR-0009 Accepted | read layer YES (17A/17B/18/19); definitions NO | **READY TO INVESTIGATE** |
| C-15 XLSX/CSV export (Excel module) | Export of admitted reports/lists (confirmed channel per OQ-46 record) | C-14; jobs evaluation for heavy exports | OQ-46 recorded posture (XLSX confirmed channel; the question stays OPEN only for beyond-Excel export) | ADR-0011 Accepted (decision) | NO | **READY TO INVESTIGATE** |
| C-16 Print/PDF (Print module) | Printable reports/templates per ADR-0012 | C-14; Phase 5 worker/jobs evaluation | OQ-02 (labels/locale) | ADR-0012 Accepted (decision) | NO | **BLOCKED BY DEPENDENCY** |
| C-17 Party completion (contacts/addresses/bank accounts/legal identifiers) | Extend `organization.parties` for statutory-facing documents | — | **OQ-38** | — | flat party only | **BLOCKED BY OQ** |
| C-18 Sales module (MVP-required full admitted scope) | Party/Customer, sales document/invoice, lines, quantities, prices, approved tax fields, numbering, lifecycle/finalization, applicable inventory effect and accounting effect | C-17, Documents, Workflow, Full Inventory (C-46…C-54) | OQ-54, OQ-30, OQ-34, OQ-35, OQ-38; OQ-15 (stock-on-sale) | — | NO | **BLOCKED BY OQ / READY TO INVESTIGATE** (capability admitted; implementation not authorized) |
| C-46 Warehouse coding / master completion | Complete operational warehouse coding and management on Inventory Core | organization scope, Inventory Core | OQ-22/OQ-33 (preserved, not resolved) | ADR-0022 Accepted; ADR-0017 Proposed | **YES — list/get/create/update/enable/disable, organization + branch scope, uniqueness, lifecycle freeze guards all verified against the existing contract; zero production code changed; regression coverage added** (`docs/tasks/task-33/*`, work order titled "Task 33 — Inventory / Warehouse Master Completion"; no separate Owner acceptance record) | **MVP REQUIRED — IMPLEMENTED (reconnaissance + regression-test hardening only) — NOT ACCEPTED — CI VERIFICATION PENDING** |
| C-47 Product/item master completion | Product coding, attributes, units and barcode without inventing unsupported rules | Inventory master, unit/conversion contract | **Updated 2026-10-02:** OQ-33 (taxonomy/capability confirmation still withheld), **OQ-65** (barcode uniqueness shape), OQ-36 (code reuse). **OQ-29 is no longer blocking the shipped behavior** (OD-C47-01 Option A matches it) | ADR-0022 Accepted | **PARTIAL — item/unit/conversion master already implemented and hardened; conversion supersession race + resolve-path org leak fixed; hermetic + live-PG regression coverage added (`docs/tasks/c-47-item-master-readiness-hardening-report.md`, preflight `c-47-item-master-preflight-investigation.md`); barcode policy now DECIDED (OD-C47-03, Option A) but NOT implemented — `inventory.items` still has no barcode uniqueness constraint; no separate Owner acceptance record** | **MVP REQUIRED — IMPLEMENTED-STYLE RECONNAISSANCE + REGRESSION HARDENING — NOT ACCEPTED — REMAINS BLOCKED BY OQ (OQ-33 confirmation, OQ-65, OQ-36 reuse) — CI PASSED (PR #107: backend incl. live-DB suites + frontend green, runs `36992098706`/`36992935996`). Merge + green CI is NOT Owner acceptance of the item master (STATE.md §6). Owner decisions recorded 2026-10-02: `docs/tasks/c-47-owner-decision-and-dependency-reconciliation.md`** |
| C-48 Opening quantity flow | Operational quantity opening balance | product/warehouse master, movement ledger, Documents Foundation numbering/type registry (present but **never used by Inventory**) | **Verified 2026-10-02:** **OQ-24** (may an opening create stock with no cost; how adjustments/negative stock affect cost) · **OQ-23** (how opening entries are produced — the reason `domain/movement-type.ts` deliberately has no `opening` type) · **OQ-54** (lifecycle of a finalized opening document) · **OQ-13/OQ-26** (approval, if any). **OQ-11 applies to the *accounting* opening import and the costing method, not to quantity mechanics** | ADR-0022 Accepted | NO (no opening document, no `opening` movement type, no Inventory document type registered) | **MVP REQUIRED — BLOCKED BY OQ** (investigation possible; the decisive gates are Owner/accountant decisions, not reconnaissance gaps) |
| C-49 Opening rial flow | Separate rial opening balance and accounting relationship | C-48, Accounting posting path, valuation model | **Verified 2026-10-02:** OQ-24 (costing method/valuation layers) · OQ-11 (accounting opening import + cost method) · OQ-25 (mapping content) · **OQ-39** (durable posting semantics) · **OQ-42** (posting mode) | ADR-0022 Accepted; ADR-0005 Accepted contract with **no consumer**; ADR-0017 Proposed | NO — `InventoryMovement` has **no cost column of any kind** (`backend/prisma/schema/inventory.prisma`) | **MVP REQUIRED — BLOCKED BY OQ** (strictly after the OQ-39/OQ-42 → C-21/C-13 chain) |
| C-50 Material Request | Inventory material-request document and lifecycle | **Investigated 2026-10-02:** no Material Request artifact or Inventory document-type registration exists; Documents, Workflow, item/warehouse, and substantive reservation foundations exist but do not supply the product contract. Evidence/decision brief: [`docs/tasks/c-50-material-request-investigation.md`](../tasks/c-50-material-request-investigation.md) (see its **§19 implementation-status addendum**, 2026-10-02 later) | **OQ-54** (finalized-document edit/cancel/visibility) · **OQ-13/OQ-26** (approval applicability/content) · **undecided product rule with no OQ row yet:** whether MR reserves stock/how it drives C-52 · minimum domain contract · explicit Owner admission — **none of these are resolved by the implementation below** | ADR-0023 Accepted; ADR-0024 Accepted; no blocking ADR for a bounded no-effect aggregate; a new seam requires separate acceptance | NO (code now exists on an unmerged PR; `main` is unchanged) | **MVP REQUIRED — INVESTIGATION COMPLETE; PRODUCT-DECISION BLOCKERS NOT RESOLVED.** A non-valued, non-posting vertical slice was nonetheless opened as unmerged [PR #112](https://github.com/MR-AliEsmaeili/Vardena/pull/112) (CI green on its latest commit after two review-fix passes; not merged, no Owner acceptance). **Correction:** this row previously said "no-stock-reservation"; that was inaccurate — the slice DOES reserve stock on approval (optional per-line flag, all-or-nothing, warehouse-exact, released only by approver reversal), which is the "Require" branch the investigation's §11.4 said needed an explicit prior Owner choice, not the "Defer" branch — **this remains unresolved against that cell's own "undecided product rule" entry; this is not a record of authorization**; see the investigation brief §19 (item 2 correction) |
| C-51 Warehouse Receipt quantity/rial | Quantity and rial receipt operational documents; not Purchasing | Inventory movement ledger (`inbound`), balances, idempotency (all present); document layer (new); valuation (absent) | OQ-24 (rial/valuation) · OQ-39 + OQ-42 (accounting effect) · **OQ-54** (lifecycle of a finalized receipt — added 2026-10-02) · OQ-13/OQ-26 (approval) | ADR-0022 Accepted; ADR-0017 Proposed | quantity core YES; document/full flow NO | **MVP REQUIRED — BLOCKED BY OQ** (even a quantity-only receipt document needs OQ-54 lifecycle semantics) |
| C-52 Warehouse Issue quantity/rial | Quantity and rial issue operational documents; not Purchasing | As C-51 (`outbound` postings + availability rule); C-50 is conceptually upstream, not a hard prerequisite | OQ-24 (incl. which costing method values an issue) · OQ-39 + OQ-42 · **OQ-54** (added 2026-10-02) · OQ-13/OQ-26 | ADR-0022 Accepted; ADR-0017 Proposed | quantity core YES; document/full flow NO | **MVP REQUIRED — BLOCKED BY OQ** |
| C-53 Inventory stock/settings management | Stock management, current stock, quantity/rial stock and settings | movement → balance projection (present); organization isolation (present); negative-stock settings per warehouse with per-item override (present) | OQ-24 for the **rial** half and for confirming the negative-stock policy as *decided* rather than *defaulted* (`domain/negative-stock-policy.ts` defaults to reject) | ADR-0022 Accepted | balance core YES; rial stock and a broader settings surface NO | **MVP REQUIRED — PARTIAL; quantity half near-ready, rial half BLOCKED BY OQ-24.** Needs Owner admission of what "settings" covers before investigation |
| C-54 Quantity/rial Kardex and inventory reports | Stock, Kardex, movement, unvalued receipt/issue, analysis and management reports | Immutable movement ledger (present) for a **quantity** Kardex; valuation state (absent) for a **rial** Kardex; a read-surface ownership decision (Inventory-owned bounded reads following the Accounting precedent vs C-14 reporting foundation) | **OQ-24** for every rial report. **Correction 2026-10-02: OQ-49 blocks only a generic report *builder*, not bounded code-defined reports** (dependency matrix §4: "builder NOT required for MVP; bounded reports only") | ADR-0009 Accepted; ADR-0022 Accepted | NO | **MVP REQUIRED — quantity Kardex INVESTIGABLE after the read-surface ownership decision; rial Kardex/reports BLOCKED BY OQ-24** |
| C-55 Item barcode uniqueness enforcement (bounded C-47 follow-up) | Enforce the decided barcode policy: organization-scoped uniqueness with a database-authoritative constraint, conflict mapping, concurrency proof and regression coverage | C-47 item master (present) | **OQ-65** (reuse after deactivation + comparison semantics) — every candidate index shape silently answers it | ADR-0022 Accepted | NO — `inventory.items.barcode` has no unique index and no application uniqueness check | **BLOCKED BY OQ (OQ-65).** Created 2026-10-02 by Owner decision OD-C47-03 (`docs/decisions/product/PDR-03-item-barcode-policy.md`); policy decided, implementation not authorized |
| C-56 Item physical deletion eligibility (bounded C-47 follow-up) | Implement OD-C47-04: physical deletion only for never-referenced items, preserving history and organization-scoped identity | C-47 item master (present); cross-module reference proof via owning public services | **OQ-36** — code reuse after physical deletion is explicitly left OPEN by OD-C47-04; also case-sensitivity policy, soft-vs-hard delete shape, delete permission/audit | ADR-0020/0021 Proposed (master-data lifecycle design context) | NO — no DELETE route, no `*.Delete` permission, no `deleted_at` on `inventory.items` | **BLOCKED BY OQ (OQ-36 reuse semantics).** Created 2026-10-02 by Owner decision OD-C47-04 (`docs/decisions/product/PDR-04-item-deletion-and-code-reuse.md`) |
| C-19 Purchasing Core | Supplier purchasing flow and purchase lifecycle | future phase; no MVP dependency | **OQ-16** (posture: post-v1) | — | NO | **POST-MVP** |
| C-19A Purchase Documents | Purchase orders/invoices and purchasing lifecycle documents | C-19 | OQ-16 | — | NO | **POST-MVP** |
| C-19B Purchasing → Accounting | Purchasing-specific accounting integration | C-19, accounting integration | OQ-16/OQ-39 | — | NO | **POST-MVP** |
| C-19C Purchasing Reports | Supplier/purchasing-specific reports | C-19, reporting | OQ-16/OQ-49 | ADR-0009 Accepted | NO | **POST-MVP** |
| C-20 AR/AP | Receivables/payables tracking and reporting | Sales/Purchasing contracts; parties; accounting integration | — | — | NO | **BLOCKED BY OWNER ADMISSION** (no accepted admission exists) |
| C-21 OQ-39 delivery-semantics decision (+ likely ADR) | Decide transactional in-process subscription vs durable queued/outbox delivery + rejected-posting semantics | — | **OQ-39** | new ADR extending ADR-0005 likely | NO | **BLOCKED BY OQ** — *the* integration gate |
| C-22 Inventory → Accounting integration | Accounting consumes Inventory events per ADR-0005 and maps them | C-21, C-13, posting-mode policy (OQ-42) | OQ-24/25/30, **OQ-39**, OQ-42 | ADR-0005 Accepted (contract exists; no consumer) | NO | **MVP REQUIRED — BLOCKED BY OQ** |
| C-23 Sales → Accounting integration | Required MVP system effect from finalized Sales documents; manual voucher is not final MVP state | C-18 + C-21 + C-13 | OQ-39, OQ-42, OQ-30, OQ-25 | — | NO | **BLOCKED BY OQ / BLOCKED BY DEPENDENCY** |
| C-24 Durable outbox / worker dispatch / jobs | Implement target infrastructure **only when an admitted capability requires it** | an admitted capability (OQ-39 outcome; heavy exports; PDF; audit events) | OQ-39 | ADR-0004/0010 Accepted (decisions) | NO (worker = startup gate) | **BLOCKED BY DEPENDENCY** (demand-driven) |
| C-25 Audit module (MVP audit surface) | Append-only audit store per AR-23/security.md §4 + Owner-decided scope | — | OQ-17 (retention), OQ-14 (auditor role) | — | NO | **READY TO INVESTIGATE** (scope decision first) |
| C-26 Identity session-surface completion | Session list/revoke, self password change, forced-change-on-first-login | — | OQ-06 partially | — | NO (documented surface vs implementation gap) | **READY TO INVESTIGATE** |
| C-27 Administrator-safety protections | Self-disable/self-role-removal/last-admin lockout guards | — | **OQ-19** | — | NO | **BLOCKED BY OQ** |
| C-28 Occupational role baselines | Accountant/Warehouse/Sales/Auditor roles with permission baselines | C-01 decision context | **OQ-14** | — | NO (bootstrap role only) | **BLOCKED BY OQ** |
| C-29 Task 12 P1 — real-PostgreSQL concurrency verification | Independent-connection lock/deadlock assertions for projection maintenance/rebuild (CI-level) | — | — | — | NO (open follow-up of ACCEPTED task) | **READY TO INVESTIGATE** |
| C-30 Operational-freeze rehearsal as a CI step | Add the existing Task 13 rehearsal script to CI (audit K.6) | — | — | — | script exists; not a CI step | **READY TO INVESTIGATE** |
| C-31 Branch-protection / required-checks confirmation | Owner confirms which CI checks are required (BOOT-OQ-04) | — | — | — | n/a | **CURRENT** (Owner confirmation) |
| C-32 Backup/restore MVP surface | Scheduled backup + controlled restore per database-strategy §14 (nothing implemented) | — | OQ-52, OQ-53 | — | NO | **BLOCKED BY OQ** (targets undecided; strategy documented) |
| C-33 Production configuration / secrets / TLS review | Shared-deployment DB auth, secrets posture, session/lockout defaults, OQ-06 | — | OQ-06, OQ-17 | — | `.env.example` exists; review not done | **READY TO INVESTIGATE** (Phase 7) |
| C-34 Customization module (preferences) | User preferences store (ADR-0013) — unlocks frontend grid persistence | — | OQ-09 (org-level scope) | ADR-0013 Accepted (decision) | NO | **PLANNED (not admitted for MVP)** |
| C-35 Notifications module | In-app notifications | events infrastructure evaluation | OQ-15 | — | NO | **PLANNED (not admitted for MVP)** |
| C-36 Settlement / allocation foundation (Task 16) | Bounded settlement/allocation per the finalized contract | Owner confirmation; Treasury boundary respected | — | — | NO (contract-only) | **BLOCKED BY OWNER ADMISSION** |
| C-37 Electronic Books / Tax Accounting / Iranian legal outputs | Required accounting/legal outputs based on validated Owner samples and domain/legal review; no guessed format | Accounting read models, reporting pipeline | **OQ-43** | ADR-0036 Proposed | NO | **BLOCKED BY OQ — MVP REQUIRED** |
| C-38 Code Structure Migration Service | Controlled, licensed, audited re-coding per ADR-0035 | C-08; licensing; backup/restore | OQ-45, OQ-52/53, OQ-62/63 | ADR-0035 Proposed — **not authorized** | NO | **POST-MVP** |
| C-39 Machine/API access keys | Licensed API keys on RBAC (ADR-0029) | ADR-0029 adoption | OQ-50 | **ADR-0029 Proposed** | NO | **POST-MVP** |
| C-40 License foundation record | License record + module enablement read, enforcement OFF | ADR-0030 adoption | OQ-45 | **ADR-0030 Proposed** | NO | **POST-MVP** |
| C-41 Integration adapters (legacy FaraPayam, Taxpayer, payments) | External integrations behind adapters via outbox | C-24 (outbox) | OQ-04, OQ-05, OQ-07, OQ-51 | ADR-0003 Accepted (boundary) | NO | **POST-MVP** |
| C-42 Pin-divergence repair (existing rows) | Repair/flag legacy organizations whose pins disagree (ODR-1 rejects writes only) | — | **OQ-62, OQ-63** | — | NO (deliberately not repaired) | **BLOCKED BY OQ** |
| C-43 Treasury (cash/bank/payment/receipt/cheque/settlement) | Any Treasury capability | explicit future task + Owner Decision | — | — | NO | **DEFERRED — OUT OF MVP** |
| C-44 MVP acceptance thresholds ratification | Ratify/waive the proposed final-gate numbers | — | **OQ-60** | — | n/a | **BLOCKED BY OQ** (needed for Phase 8) |
| C-45 UI language / calendar decision | Persian/Jalali display decision (isolated in frontend `lib/`) | — | **OQ-02** | — | i18n dictionary + formatters exist | **BLOCKED BY OQ** (frontend/print labels) |

---

## Promotion rule

A candidate becomes a numbered implementation task only when, per
`docs/accounting/task-index.md` §7 (or the domain-equivalent Owner-approved
process): objective, scope, non-goals, dependencies, blocking OQs, required
decisions/ADRs and acceptance criteria all exist **in the repository**, and the
task is explicitly added to the authoritative index. Until then, nothing in
this register authorizes code.
