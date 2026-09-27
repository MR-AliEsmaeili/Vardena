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

---

## Register

| Candidate | Purpose | Depends on | Blocking OQ | Blocking ADR | Implementation? | Status |
|---|---|---|---|---|---|---|
| C-01 Owner acceptance — Bootstrap System Administrator | Accept or reject the merged provisioning command (PR #64) | — | OQ-14/OQ-19 remain open regardless | — | **YES — merged, CI green** | **CURRENT** |
| C-02 Owner acceptance — Task 23 (Base Chart mechanism) | Accept or reject the merged template/adoption mechanism (PR #66) | — | OQ-25/36/41/43 remain open regardless | ADR-0037 Proposed | **YES — merged, CI green** | **CURRENT** |
| C-03 Owner acceptance — Task 24 R-2 | Accept or reject the account-list scope correction (PR #67); decide F-2 disposition | — | — | — | **YES — merged, CI green** | **CURRENT** |
| C-04 Governance backlog — Tasks 13/14/15 + ADR-0017…0021, 0031, 0032 | Give every merged-but-unaccepted item an explicit Owner verdict (audit recommendations K.1/K.2) | — | — | the eight ADRs themselves | YES (all implemented) | **CURRENT** (governance) |
| C-05 `organization-permissions.ts` stale comment correction | Remove the doc comment contradicting the PR #55 membership-administration rule (audit D-7/G-2) | a separately authorized change (production file) | — | — | comment-only | **READY TO INVESTIGATE** |
| C-06 ODR-3 list-scope completion (Task 24 F-2/R-5) | Assert `assertOrganizationInScope` on the `financial-areas`, `fiscal-years`, `accounting-periods`, `coding-structures` list surfaces (+ F-3 stale spec comment) | Task 24 acceptance (C-03); Owner approval of the contract change (200→404), exactly like R-2 | — | — | NO (gap verified by Task 24 gate) | **BLOCKED BY OWNER ADMISSION** (small, concrete, high-value) |
| C-07 Base Chart content approval + controlled loading | Owner/accountant-approved chart content loaded through the Task 23 mechanism | C-02; OQ-36 prerequisites (reuse policy, deletion eligibility, code-history coexistence) | **OQ-25 (content values), OQ-36** | ADR-0037 Proposed (adoption gate) | mechanism YES; content NO | **BLOCKED BY OQ** |
| C-08 Account code history / pre-use correction producer | Implement OD-20-4 (controlled pre-use correction, post-use immutability), resolving discrepancy D-2 | OQ-36 answers | OQ-36, OQ-25 | ADR-0033 Proposed | NO (code immutable from creation — stricter than decided) | **BLOCKED BY OQ** |
| C-09 Control roles (catalog + effective-dated mapping) | Concrete control-role catalog/mandatory set + account→role mapping per OD-20-2/OD-20-3 | a **consumer** task first (posting rules C-15 or a reporting consumer) | **OQ-25** | ADR-0037 Proposed | NO | **BLOCKED BY OQ + BLOCKED BY DEPENDENCY** (consumer-first) |
| C-10 Detail dimensions (line-level analytical assignments) | Implement OD-20-6 boundary (typed assignment table, no EAV/JSONB/ledger widening) | — | **OQ-41** (count/defaults/binding/governance) | ADR-0037 Proposed | NO | **BLOCKED BY OQ** |
| C-11 Corrections beyond reversal (correction/difference, replacement, adjustment) | Implement contract §15.4's remaining mechanisms + decided windows | — | **OQ-27** (OQ-23 for period dating) | — | NO (only reversal exists) | **BLOCKED BY OQ** |
| C-12 Year-transition operations / opening carry-forward | Year-end closing/opening operations; cross-year opening balances | — | **OQ-23** | — | NO (explicitly excluded from projection) | **BLOCKED BY OQ** |
| C-13 Posting rules / account mapping engine | Accounting-owned mapping from source events to journal entries | control roles (C-09) for role references | OQ-24, OQ-25, OQ-30 (+ OQ-39/42 for activation) | — | NO | **BLOCKED BY OQ** |
| C-14 Reporting foundation (bounded report definitions + pipeline) | Code-defined reports over approved read sources per ADR-0009; permissions, caps, timeouts | — | OQ-25/OQ-43 only for NEW layouts; **OQ-49 blocks any builder** | ADR-0009 Accepted | read layer YES (17A/17B/18/19); definitions NO | **READY TO INVESTIGATE** |
| C-15 XLSX/CSV export (Excel module) | Export of admitted reports/lists (confirmed channel per OQ-46 record) | C-14; jobs evaluation for heavy exports | OQ-46 recorded posture (XLSX confirmed channel; the question stays OPEN only for beyond-Excel export) | ADR-0011 Accepted (decision) | NO | **READY TO INVESTIGATE** |
| C-16 Print/PDF (Print module) | Printable reports/templates per ADR-0012 | C-14; Phase 5 worker/jobs evaluation | OQ-02 (labels/locale) | ADR-0012 Accepted (decision) | NO | **BLOCKED BY DEPENDENCY** |
| C-17 Party completion (contacts/addresses/bank accounts/legal identifiers) | Extend `organization.parties` for statutory-facing documents | — | **OQ-38** | — | flat party only | **BLOCKED BY OQ** |
| C-18 Sales module (MVP-required full admitted scope) | Party/Customer, sales document/invoice, lines, quantities, prices, approved tax fields, numbering, lifecycle/finalization, applicable inventory effect and accounting effect | C-17, Documents, Workflow, Full Inventory (C-46…C-55) | OQ-54, OQ-30, OQ-34, OQ-35, OQ-38; OQ-15 (stock-on-sale) | — | NO | **BLOCKED BY OQ / READY TO INVESTIGATE** (capability admitted; implementation not authorized) |
| C-46 Warehouse coding / master completion | Complete operational warehouse coding and management on Inventory Core | organization scope, Inventory Core | OQ-22/OQ-33 | ADR-0022 Accepted; ADR-0017 Proposed | NO | **MVP REQUIRED — READY TO INVESTIGATE** |
| C-47 Product/item master completion | Product coding, attributes, units and barcode without inventing unsupported rules | Inventory master, unit/conversion contract | OQ-29/OQ-33 | ADR-0022 Accepted | NO | **MVP REQUIRED — BLOCKED BY OQ** |
| C-48 Opening quantity flow | Operational quantity opening balance | product/warehouse, movement ledger | OQ-11/OQ-24 | ADR-0022 Accepted | NO | **MVP REQUIRED — BLOCKED BY OQ** |
| C-49 Opening rial flow | Separate rial opening balance and accounting relationship | opening quantity, Accounting, valuation | OQ-11/OQ-24/OQ-25 | ADR-0022 Accepted | NO | **MVP REQUIRED — BLOCKED BY OQ** |
| C-50 Material Request | Inventory material-request document and lifecycle | Documents, permissions, Inventory | OQ-54 as applicable | ADR-0023 Accepted | NO | **MVP REQUIRED — READY TO INVESTIGATE** |
| C-51 Warehouse Receipt quantity/rial | Quantity and rial receipt operational documents; not Purchasing | Inventory movement, valuation boundary | OQ-24/OQ-39/OQ-42 | ADR-0022 Accepted; ADR-0017 Proposed | quantity core YES; full flow NO | **MVP REQUIRED — BLOCKED BY OQ** |
| C-52 Warehouse Issue quantity/rial | Quantity and rial issue operational documents; not Purchasing | Inventory movement, valuation boundary | OQ-24/OQ-39/OQ-42 | ADR-0022 Accepted; ADR-0017 Proposed | quantity core YES; full flow NO | **MVP REQUIRED — BLOCKED BY OQ** |
| C-53 Inventory stock/settings management | Stock management, current stock, quantity/rial stock and settings | movement → balance; org isolation | OQ-24 | ADR-0022 Accepted | balance core YES; full scope NO | **MVP REQUIRED — BLOCKED BY OQ** |
| C-54 Quantity/rial Kardex and inventory reports | Stock, Kardex, movement, unvalued receipt/issue, analysis and management reports | reporting pipeline, Inventory read models | OQ-24/OQ-49 | ADR-0009 Accepted; ADR-0022 Accepted | NO | **MVP REQUIRED — BLOCKED BY OQ** |
| C-55 Inventory → Accounting integration | Required independent source-module accounting effect | C-21, C-13, valuation/mapping | OQ-24/OQ-25/OQ-39/OQ-42 | ADR-0005 Accepted | NO | **MVP REQUIRED — BLOCKED BY OQ** |
| C-19 Purchasing Core | Supplier purchasing flow and purchase lifecycle | future phase; no MVP dependency | **OQ-16** (posture: post-v1) | — | NO | **POST-MVP** |
| C-19A Purchase Documents | Purchase orders/invoices and purchasing lifecycle documents | C-19 | OQ-16 | — | NO | **POST-MVP** |
| C-19B Purchasing → Accounting | Purchasing-specific accounting integration | C-19, accounting integration | OQ-16/OQ-39 | — | NO | **POST-MVP** |
| C-19C Purchasing Reports | Supplier/purchasing-specific reports | C-19, reporting | OQ-16/OQ-49 | ADR-0009 Accepted | NO | **POST-MVP** |
| C-20 AR/AP | Receivables/payables tracking and reporting | Sales/Purchasing contracts; parties; accounting integration | — | — | NO | **BLOCKED BY OWNER ADMISSION** (no accepted admission exists) |
| C-21 OQ-39 delivery-semantics decision (+ likely ADR) | Decide transactional in-process subscription vs durable queued/outbox delivery + rejected-posting semantics | — | **OQ-39** | new ADR extending ADR-0005 likely | NO | **BLOCKED BY OQ** — *the* integration gate |
| C-22 Inventory → Accounting integration | Accounting consumes Inventory events per ADR-0005 and maps them | C-21, C-13, posting-mode policy (OQ-42) | OQ-24/25/30, **OQ-39**, OQ-42 | ADR-0005 Accepted (contract exists; no consumer) | NO | **BLOCKED BY OQ** |
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
