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

> **Dependency addendum (2026-10-02).** C-47…C-54 were re-reviewed against
> `main` @ `4cf481e` with the prerequisite scope of OQ-11, OQ-24, OQ-39, OQ-42
> and OQ-54 read from the registry text rather than inferred from identifiers.
> Per-candidate status, evidence paths, upstream dependencies, blocking
> OQs/ADRs and readiness:
> [`c-47-c-54-dependency-review.md`](./c-47-c-54-dependency-review.md). The
> review closes no OQ, promotes no ADR, admits no candidate and starts no
> warehouse operational implementation.

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
| C-47 Product/item master completion | Product coding, attributes, units and barcode without inventing unsupported rules | Inventory master, unit/conversion contract | **OQ-29 residue** (global-vs-item scope/precedence, factor scale, derived pairs, boundary applicability, factor correction, display rounding), **OQ-33** (eight-kind list + per-item capability model **still unconfirmed**), **OQ-65** (barcode lifecycle/reuse — blocks the barcode-uniqueness follow-up), **OQ-36 residue** (item-code reuse after physical deletion) | ADR-0022 Accepted (ADR-0017/0020 Proposed — not authorization) | **PARTIAL — item/unit/conversion master already implemented and hardened; conversion supersession race + resolve-path org leak fixed; hermetic + live-PG regression coverage added (`docs/tasks/c-47-item-master-readiness-hardening-report.md`, preflight `c-47-item-master-preflight-investigation.md`); Owner decisions now RECORDED (OD-C47-01…04, `docs/tasks/c-47-item-master-owner-decision-record.md`) — OD-C47-01 needs no code, OD-C47-02 constrains future change only, OD-C47-04 permits but does not require a deletion surface, and **PDR-01 barcode uniqueness is DECIDED BUT NOT ENFORCED** (no barcode unique index, no uniqueness pre-check); no separate Owner acceptance record** | **MVP REQUIRED — IMPLEMENTED-STYLE RECONNAISSANCE + REGRESSION HARDENING — NOT ACCEPTED — OWNER DECISIONS RECORDED (OD-C47-01…04, 2026-10-02) — REMAINS BLOCKED BY OQ (OQ-29 residue / OQ-33 taxonomy confirmation / OQ-65) — CI PASSED (PR #107: backend incl. live-DB suites + frontend green, runs `36992098706`/`36992935996`); merge + green CI is NOT Owner acceptance** |
| C-48 Opening quantity flow | Operational quantity opening balance | product/warehouse, movement ledger, Document Foundation (ADR-0023) | **OQ-11 — specifically its *opening balance import* half**; OQ-24 only where an opening carries cost (quantity-only openings inherit the interim reject-negative-stock posture); plus the document-lifecycle set **OQ-54/OQ-12/OQ-13/OQ-26** once an opening is a finalizable/correctable document | ADR-0022 Accepted; ADR-0023 Accepted | NO | **MVP REQUIRED — BLOCKED BY OQ** (see [dependency review](./c-47-c-54-dependency-review.md) §3) |
| C-49 Opening rial flow | Separate rial opening balance and accounting relationship | C-48 opening quantity, Accounting core, **valuation engine (absent)**, **Inventory→Accounting consumer (absent)** | OQ-11/OQ-24/OQ-25, plus **OQ-39 and OQ-42 the moment it produces an accounting effect**; pending Owner decision **OD-28-04** gates valuation flows | ADR-0022 Accepted; ADR-0005 Accepted (contract only, no consumer); a new delivery-semantics ADR is likely (C-21) | NO | **MVP REQUIRED — BLOCKED BY OQ — deepest dependency chain of C-47…C-54** |
| C-50 Material Request | Inventory material-request document and lifecycle | Document Foundation (ADR-0023, implemented), Workflow Foundation (ADR-0024, implemented but **unbound to any business document**), Inventory item + warehouse master, RBAC | **OQ-13 (primary — do inventory documents have approval states at all?)**, OQ-26 (who approves; segregation of duties), **OQ-54** (finalized-document cancel/edit policy — *recommended* cancel-only, **not decided**), OQ-12 (numbering gaps if cancellation is admitted), OQ-15 (requester notification, if any). **Verified NOT blocking** while the request moves no stock and produces no accounting effect: OQ-24/OQ-39/OQ-42 | ADR-0023 Accepted; ADR-0024 Accepted | NO | **MVP REQUIRED — READY TO INVESTIGATE (bounded; policy framing only, no lifecycle choice, no implementation) — ADMISSION STILL REQUIRES OD-27-03** |
| C-51 Warehouse Receipt quantity/rial | Quantity and rial receipt operational documents; not Purchasing | Inventory movement ledger, item + warehouse master, Document Foundation, Workflow (unbound), valuation boundary (absent) | OQ-24 (rial half) / OQ-39 / OQ-42, **plus the document-lifecycle set OQ-54/OQ-13/OQ-26/OQ-12** that the document itself needs | ADR-0022 Accepted; **ADR-0017 Proposed — not authorization** | quantity core YES; full flow NO | **MVP REQUIRED — BLOCKED BY OQ** |
| C-52 Warehouse Issue quantity/rial | Quantity and rial issue operational documents; not Purchasing | as C-51, plus reservations if issues consume them, plus C-50 if an issue may be raised from a material request | OQ-24 (**its negative-stock half bites hardest here** — interim posture is *reject*; per-item/warehouse `allow_negative_stock` is a reserved field, not an approved rule) / OQ-39 / OQ-42, plus **OQ-54/OQ-13/OQ-26/OQ-12** | ADR-0022 Accepted; **ADR-0017 Proposed — not authorization** | quantity core YES; full flow NO | **MVP REQUIRED — BLOCKED BY OQ** |
| C-53 Inventory stock/settings management | Stock management, current stock, quantity/rial stock and settings | movement → balance; org isolation; subordinate to C-51/C-52 (they determine what state there is to manage) | OQ-24 (rial stock; and making negative stock a configurable *approved* rule), OQ-09 only if organization-level settings are in scope. **Additional finding: the "settings" scope itself is undefined in the repository** — no accepted definition of "inventory settings" content exists | ADR-0022 Accepted | balance core YES; full scope NO | **MVP REQUIRED — BLOCKED BY OQ + UNDEFINED SCOPE** |
| C-54 Quantity/rial Kardex and inventory reports | Stock, Kardex, movement, unvalued receipt/issue, analysis and management reports | **C-14 reporting foundation (not implemented; no `reporting` module exists)**, Inventory read models, valued flows from C-49/C-51/C-52 for any rial Kardex | OQ-24 (nothing to value until valuation is decided); **OQ-49 blocks a report *builder*, not a bounded code-defined Kardex** (matrix §4: "builder NOT required for MVP"); OQ-02 only for printed labels/locale | ADR-0009 Accepted; ADR-0022 Accepted | NO | **MVP REQUIRED — BLOCKED BY DEPENDENCY (last in the chain) + BLOCKED BY OQ** |
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
