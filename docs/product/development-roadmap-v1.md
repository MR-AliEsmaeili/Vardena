# Vardena — Development Roadmap v1

## Document metadata

| Field | Value |
|---|---|
| Document ID | ROADMAP |
| Version | 1.0 (proposal) |
| Status | **Proposed — pending product-owner approval** |
| Owner | Ali Esmaeili |
| Created | 2026-09-22 |
| Derived from | MVP-SCOPE v1 · PB-BASELINE v1 · OQ-44…OQ-61 · ADR-0029/0030 (proposed) |

> **No calendar dates.** The repository contains no approved estimates; stages
> are ordered strictly by dependency. A stage begins when its dependencies and
> gating decisions exist — not when a date arrives. Stage numbering matches the
> brief (Stage 0…Stage 9); stages may overlap where dependencies allow.

## Dependency spine

```
Stage 0 (decide) ──► Stage 1 (platform) ──► Stage 2 (accounting core)
                                    │                 │
                                    │                 ▼
                                    │        Stage 3 (inventory ⇄ accounting)
                                    │                 │
                                    │                 ▼
                                    │        Stage 4 (sales + taxpayer readiness)
                                    │                 │
                                    │                 ▼
                                    │        Stage 5 (report builder)
                                    │                 │
                                    ▼                 ▼
                              Stage 6 (MVP hardening & pilot readiness)
                                                      │
                     ┌────────────────────────────────┤
                     ▼                                ▼
              Stage 7 (post-MVP modules)      Stage 8 (commercial operations)
                                                      │
                                                      ▼
                              Stage 9 (advanced offline / enterprise / SaaS readiness)
```

Ongoing lanes (not stages): docs-in-sync (AG-07), tests for business rules
(AG-06), no invented business rules (AG-09/AR-31), migration discipline
(AG-08/AR-10), scope discipline (AG-03).

---

## Stage 0 — Decision and Governance Closure

**Objective.** Clear the decision debt that gates scope: ratify the baseline
and MVP proposal, resolve the Stage-0 OQ gates, and adopt the proposed ADRs.

**Included capabilities.** None (governance only): decision sessions with the
owner; ratification/amendment of PB-BASELINE §30 numbers and P0/P1
definitions; Report-Builder depth selection; ADR-0029/0030 ratification (or
amendment); interim answers where an owner "interim choice" unblocks a stage
(e.g. OQ-54 posture, OQ-02 language).

**Dependencies.** This document set (PB-BASELINE, OQ-44…OQ-61, MVP-SCOPE,
ROADMAP).

**Exit criteria.**
1. PB-BASELINE, MVP-SCOPE, ROADMAP marked Accepted by the owner (or amended
   then accepted).
2. OQ-49, OQ-60 resolved (Record → decision). OQ-45, OQ-54, and the remaining OQ-02 localization scope resolved or given recorded interim owner choices where they gate Stage 1–4 builds. The generic BusinessDate calendar and Instant zone/calendar are already accepted by ADR-0042 and must not be reopened under OQ-02.
3. ADR-0029, ADR-0030 status = Accepted (or superseded by amended versions).
4. Accounting task-index §8 follow-ups scheduled as named tasks (not silently
   absorbed).

**Risks.** Decision batching stalls (owner bottleneck, R-12); mitigation:
single consolidated session using the OQ questions sections as the agenda.

**Explicit non-goals.** No implementation tasks authorized by Stage 0 itself;
no re-opening decided matters; no marketplace/SaaS/consolidation decisions.

**Required OQ/ADR decisions.** OQ-49, OQ-60 (gates); OQ-45, OQ-54, and OQ-02's remaining UI-language/numeral/localization scope (interim or full; the accepted calendar/zone contract is not reopened); ADR-0029, ADR-0030 ratification.

---

## Stage 1 — Platform and Core Stabilization

**Objective.** Harden the shipped foundations into a stable platform the
operational stages can stand on; close platform-level gaps.

**Included capabilities.**
- License foundation implementation per ratified ADR-0030 (record + module
  enablement read + admin view; **enforcement-off**).
- Update pipeline: pre-migration automatic backup wired into the controlled
  update flow (PB §24); health checks; compatibility pre-flight.
- Deployment runbook v1 (install → login on clean hardware) as a *documented,
  rehearsed* procedure (feeds G7).
- Stabilization of shipped platform surfaces flagged by task reports
  (e.g. `.vardena/project-context.md` staleness, scoped-read helper
  duplication — as named tasks per accounting task-index §7/§8).
- RBAC/audit surface completion for platform entities (per OQ-14/OQ-19/OQ-20
  decisions or recorded assumptions).

**Dependencies.** Stage 0 exits; existing shipped foundations.

**Exit criteria.**
1. License record visible in admin UI; module enablement reads it; no
   blocking behavior anywhere (ADR-0030 conformance test).
2. Controlled-update rehearsal performed: backup → migrate → verify → health
   → rollback-by-restore succeeds once end-to-end.
3. Install runbook executes to login on a clean machine within the OQ-60
   target (informal run here; formal gate is Stage 6).
4. All platform endpoints carry permissions + denial tests (AG-13).

**Risks.** License-adjacent scope creep (enforcement temptation — ADR-0030
forbids); update-pipeline edge cases on customer-shaped machines.

**Explicit non-goals.** No enforcement (OQ-45); no API/machine access build
(ADR-0029 is ratified, implementation deferred to Stage 7 unless an MVP
customer requirement emerges); no operational modules.

**Required OQ/ADR decisions.** ADR-0030 Accepted (Stage 0); OQ-45 recorded
interim behavior (warn-only) if full resolution lags; OQ-17 retention values
for log/audit defaults.

---

## Stage 2 — Accounting Core

**Objective.** Complete the accounting core to the point the reference
scenario's accounting steps run on decided policy — the module is already deep
(Tasks 10.1–10.8); this stage finishes *policy-gated* gaps, not architecture.

**Included capabilities.**
- Fiscal calendar policy lands (OQ-23): year-start/layout defaults,
  close/reopen authority; year-transition operations (closing/opening
  documents) if decided in scope, else explicit deferral.
- Chart governance per OQ-25: control roles minimal set, posting-eligibility
  defaults; statutory layouts stay out (OQ-43) except the minimal P&L captions.
- Correction/reversal windows per OQ-27 (mechanisms exist since contract
  §15.4; policy windows land here).
- Detail dimensions per OQ-41 (or explicit MVP deferral with account-tree-only
  postings — MVP-SCOPE D-02).
- Balances projection (rebuildable) to power P&L/trial balance (task-index
  candidate; materialization choice per AC-D-31).
- Numbering policy per OQ-12 if needed beyond Document Foundation defaults.

**Dependencies.** Stage 0 (policy OQs resolved/interim); Stage 1 platform
stability; OQ-39 resolution is *not* required for manual-posting scope.

**Exit criteria.**
1. Scenario steps 4–5, 11–12 run on decided policy: coding structure →
   accounts → manual voucher → finalize → ledger → balances.
2. Correction path demonstrates every decided window rule with tests.
3. Balances rebuildable from ledger (rebuild test green).
4. Accounting permission set complete; denial tests green.

**Risks.** Accountant availability for policy sign-off (OQ-23/25/27); scope
creep into posting rules/system posting (gated to Stage 3).

**Explicit non-goals.** No system-generated posting (Stage 3 gate); no
tax/statutory automation (OQ-30/OQ-43); no multi-currency (OQ-47/48); no
allocation engine.

**Required OQ/ADR decisions.** OQ-23, OQ-25, OQ-27, OQ-41 (full or recorded
interim), OQ-11 (opening balances), OQ-12; OQ-43 validated for the *minimal*
statutory exposure shipped (P&L captions, immutable books posture).

---

## Stage 3 — Inventory and Accounting Integration

**Objective.** Complete inventory operations to scenario depth and — for the
first time — connect modules to Accounting *safely*, under the durable
integration decision.

**Included capabilities.**
- Inventory completion: units/conversions precision per OQ-29; costing method
  per OQ-24; opening inventory entry (A-10); valuation reports on decided
  method.
- **Durable integration decision lands (OQ-39):** transactional in-process
  subscription vs durable queued/outbox delivery for system-generated posting,
  with the rejection semantics (blocked source vs exception queue). Likely
  ADR (extends ADR-0005/0026; AR-14/16 boundary respected).
- Posting-mode policy per OQ-42 (Mode A/B default, approval authority,
  rejection meaning).
- Posting rules / account mapping per OQ-24/25/30 inputs — the Inventory →
  Accounting mapping (AC-D-32 activation gate).
- Inventory reporting views + reports (A-16).

**Dependencies.** Stage 2 accounting core; OQ-39/42/24/25/29/30 resolutions
(or recorded interims for anything not blocking receipts/issues themselves).

**Exit criteria.**
1. Receipt/issue with correct cost capture per decided method; stock = ledger
   replay tests green (G3).
2. Warehouse receipt/issue produces an accounting effect through the decided
   delivery semantics, with idempotency + retry/dead-letter tests green —
   **or** the capability is explicitly deferred with the gate recorded.
3. Opening inventory → stock-on-hand correct on clean install.
4. Inventory report set returns fixture-verified totals.

**Risks.** OQ-39 is the highest-risk architecture decision in the roadmap
(durability vs simplicity); wrong choice here poisons all system posting.
Mitigation: dedicated ADR with rejection-path semantics before any enabling
code.

**Explicit non-goals.** No Sales module; no taxpayer; no purchasing receipts
(C-01); no FX inventory valuation (OQ-47).

**Required OQ/ADR decisions.** OQ-39 (+ its ADR), OQ-42, OQ-24, OQ-29,
OQ-30 (tax model inputs), OQ-25 (control accounts for posting rules).

---

## Stage 4 — Sales and Taxpayer Integration

**Objective.** Deliver the sales module to scenario depth; prepare the
tax-invoice domain for the Taxpayer adapter without shipping the adapter.

**Included capabilities.**
- Sales documents (A-14): invoice (order optional) with lines, prices
  (OQ-34), tax snapshot fields (OQ-30), credit warning (OQ-35), document
  states per the OQ-54 outcome, numbering via Document Foundation.
- Sale → accounting posting through the Stage-3 delivery semantics
  (D-01 resolved) — with Mode B review if OQ-42 chose it.
- Printable invoice template (A-15) via the print system.
- Sales reporting views + reports (A-17).
- **Tax-invoice domain readiness** (PB §19.2 separation): stable ids, tax
  field snapshot, correction links — such that the Taxpayer adapter (later)
  needs no schema change.
- Taxpayer slice 1 *if* OQ-51's trigger (phase-in deadline/demand/sandbox)
  has fired: submission + status + retry + error explanation through the
  outbox adapter (`destination = taxpayer`); else deferred with the gate
  recorded.

**Dependencies.** Stage 3 (posting path, delivery semantics); OQ-54, OQ-30,
OQ-34, OQ-35, OQ-38 (party identifiers when needed); OQ-51 trigger check.

**Exit criteria.**
1. Scenario steps 10–11 end-to-end: sale registered → accounting entry
   generated per decided mode → finalizable.
2. Sales reports reconcile to invoices (fixture tests).
3. Invoice prints from a template; Excel export works (A-22).
4. Tax-invoice readiness review signed (domain fields complete for the
   adapter contract, whatever OQ-51 later decides).

**Risks.** OQ-54 decided too late forces rework of sales state machine
(why it gates Stage 0); tax-field shape churn if OQ-30 lags; taxpayer scope
pull (the adapter is *not* this stage's deliverable unless triggered).

**Explicit non-goals.** No corrective-invoice/reconciliation automation
(OQ-51 slice 2+); no CRM; no pricing engine beyond decided price lists.

**Required OQ/ADR decisions.** OQ-54, OQ-30, OQ-34, OQ-35, OQ-38; OQ-51
(trigger evaluation; slice-1 scope if firing).

---

## Stage 5 — Report Builder

**Objective.** Deliver the MVP report set plus the Report Builder depth
decided in OQ-49 — inside the §17.2 security constraints.

**Included capabilities.**
- Semantic-entity registry over module views (accounting, inventory, sales) —
  the "approved semantic entities" mechanism (small design note; constraints
  already decided).
- Report Builder at the OQ-49 level (recommended B): composition over
  approved entities; saved, versioned, permission-bound definitions; audit.
- Accounting report set on decided layouts (P&L minimal per OQ-25/OQ-43; trial
  balance; ledgers as layouts allow).
- Dashboard default + user configuration (A-20).
- Export determinism tests; async heavy-report path via Jobs where thresholds
  demand.

**Dependencies.** Stages 3–4 views exist; OQ-49 resolved (Stage 0); OQ-10
(grouping scope) alignment; OQ-25/OQ-43 for accounting layouts.

**Exit criteria.**
1. Scenario steps 14–17 green: inventory reports, sales reports, P&L, custom
   report built by a non-developer user in-product.
2. Security constraint tests: no entity outside the registry reachable; every
   definition permission-bound; resource limits enforced (AR-21/24,
   reporting-strategy §7).
3. Excel export of every MVP report byte-deterministic on fixtures.

**Risks.** Builder scope creep toward level D (governed by OQ-49 answer);
accounting layout disputes (OQ-43 expert validation).

**Explicit non-goals.** No user SQL ever; no cross-installation/multi-entity
reporting (OQ-59); no scheduling/delivery (C-14); no PDF batch pipelines
beyond the print system's scope.

**Required OQ/ADR decisions.** OQ-49 (Stage 0), OQ-10 alignment, OQ-25/OQ-43
(minimal layouts), semantic-entity registry design note (docs, not ADR unless
it changes contracts).

---

## Stage 6 — MVP Hardening and Pilot Readiness

**Objective.** Prove the MVP: run the acceptance gates, drill operations,
secure the release, prepare pilot customers.

**Included capabilities.**
- Acceptance-gate execution (G1–G8 from MVP-SCOPE §7): scenario run-through
  by non-specialist users; invariant suites; LAN-only drill (internet
  physically disabled); install timing run.
- Backup/restore drill to the OQ-52/OQ-53 numbers (timed restore on
  replacement hardware; license-state rule verified: restore never blocked).
- Security pass: denial-path coverage completion, session/lockout tests,
  rate-limit configuration review, penetration test (PB §22) and remediation.
- Performance pass: report/query responsiveness on documented dataset sizes
  (reporting-strategy §8 discipline); index additions with view changes.
- Pilot onboarding kit: install runbook final, admin/operator guide,
  license-install procedure (ADR-0030), support process (OQ-61 interim tool
  in place).
- Waiver log: any measure-gate miss (criteria 4/6/9) recorded with owner
  waiver (OQ-60).

**Dependencies.** Stages 1–5 complete or explicitly waived item-by-item;
OQ-52/OQ-53/OQ-60 resolved (numbers exist to drill against).

**Exit criteria.** G1–G8 all green (or owner-waived with record). This stage
ends with **pilot-ready MVP** — the only "done" definition this roadmap
recognizes.

**Risks.** Drill failures forcing late fixes (the point of the stage);
pen-test findings late in the cycle; pilot-customer readiness drift.

**Explicit non-goals.** No new features; no scope additions regardless of
pilot requests (change requests route to Stage 7 planning / §26 governance).

**Required OQ/ADR decisions.** OQ-52, OQ-53, OQ-60 resolved; OQ-45 interim
behavior verified in the license foundation; OQ-46 boundary documented for
pilot contracts.

---

## Stage 7 — Post-MVP Modules

**Objective.** Extend the product on the ratified strategy (OQ-59 direction)
with the highest-demand capabilities, each entering via the task-definition
rule (accounting task-index §7 discipline, generalized).

**Included capability candidates** (each individually scoped, none approved
by this roadmap):
- Purchasing module (C-01) — receipts→payments flow, purchase-side posting.
- Multi-currency activation (OQ-47/OQ-48 outcomes) — seams exist.
- Webhooks / machine-API implementation (ADR-0029 implementation + OQ-50
  outcomes).
- Taxpayer slices 2–3 if OQ-51 sequenced them here (corrective documents,
  reconciliation).
- Branch deep capabilities (OQ-55 outcome); branch-level access scoping.
- Fixed assets; treasury/cash management; costing extensions per demand.
- Report Builder fast-follow level (C) per OQ-49 roadmap note.
- Payroll/HR analysis (OQ-32) — analysis first, module later.

**Dependencies.** MVP acceptance; respective OQ resolutions; demand evidence
from pilots (PB §32 non-goal 7).

**Exit criteria.** Per-capability, defined when each capability is scoped
(objective, domain scope, non-goals, dependencies, blocking OQs, ADRs,
acceptance criteria — the task-index §8 rule generalized).

**Risks.** Post-MVP enthusiasm breaking MVP stability (regression discipline);
module sprawl without owners.

**Explicit non-goals.** Anything OQ-gated without resolution; marketplace;
SaaS (Stage 9); consolidation (OQ-59/OQ-31).

**Required OQ/ADR decisions.** Per capability: OQ-16/32/47/48/50/55 as they
apply; new ADRs per AR-29 for any new module.

---

## Stage 8 — Commercial Operations

**Objective.** Turn a pilot-ready product into a business: enforcement per
decided behavior, commercial tooling, public posture.

**Included capabilities.**
- License enforcement implementation per OQ-45 outcome (grace/read-only/
  extension tokens per the decision; ADR-0030 semantics extended — likely a
  small ADR).
- Commercial registry/CRM+ticketing per OQ-61 outcome (buy at this stage per
  recommendation); renewal tracking; license issuance process.
- Public release posture per OQ-58 (recommended: announcement at the OQ-60
  gate pass); website/brand assets; demo policy per the decision.
- Data-ownership boundary in contracts per OQ-46; support SLAs per §11
  structure; compliance baseline documents published per §18 governance.
- Controlled-update customer calendar; LTS decision (PD-31) if demanded.

**Dependencies.** Stage 6 exit; OQ-45/46/58/61 resolutions; §11 pricing
(owner's commercial process, not this roadmap).

**Exit criteria.**
1. Enforcement behaves exactly per OQ-45 decision with tests (including
   outage behavior — no time bombs).
2. First non-pilot customer onboarded through the documented commercial
   process (quote → license → install → support).
3. Public posture executed per OQ-58 decision.

**Risks.** Enforcement edge cases harming trust (mitigation: OQ-45
recommendation's restore/export never-blocked rule); commercial load
outpacing support staffing.

**Explicit non-goals.** No product-family strategy shifts (OQ-59); no
marketplace; no SaaS.

**Required OQ/ADR decisions.** OQ-45 (hard gate), OQ-46, OQ-58, OQ-61;
ADR-0030 extension for enforcement.

---

## Stage 9 — Advanced Offline Sync / Enterprise / SaaS Readiness

**Objective.** Prepare — deliberately, not by drift — for the three big
expansions; each requires its own decision program and may never fire.

**Included capability candidates.**
- **Multi-device offline sync** — only if OQ-44 re-opened with named demand:
  narrow field-capture first (OQ-44 option B), full ADR program before code.
- **Enterprise capabilities** — consolidation/multi-installation reporting
  only if OQ-59 strategy review selects option C; multi-company ADR program
  (OQ-31/OQ-56/OQ-40 chain).
- **SaaS readiness** — only on explicit owner decision (PB §9): tenancy ADR
  program (OQ-01), storage-port move (OQ-08), billing/metering analysis,
  session/auth re-review for cloud, compliance re-check for hosted data.

**Dependencies.** Owner strategic review (OQ-59 checkpoint); demand evidence;
Stage 8 stability.

**Exit criteria.** Defined per program when/if triggered; each expansion
enters through its own ADR program — none by assumption.

**Risks.** The gravest strategic risk in the roadmap: entering any of these
informally. The guard is that every one of them is ADR-gated and
demand-gated.

**Explicit non-goals.** All three tracks simultaneously; speculative
platform-first rebuilds (PB §32 non-goal 3).

**Required OQ/ADR decisions.** OQ-44 (+ sync ADR program), OQ-59 strategy
review, OQ-56/OQ-31/OQ-40 (consolidation chain), OQ-01 (+ SaaS ADR program),
OQ-57 (ecosystem, if marketplace precedes).

---

## Roadmap-level governance rules

1. **A stage without its gate decisions does not start.** "Blocked by OQ"
   means blocked.
2. **Interim choices are owner-recorded, never agent-assumed** (AG-09/AR-31).
3. **Scope changes route through §26 governance** (core/module/extension/
   custom/fork/reject) — never into an open stage.
4. **Every stage ends with docs in sync** (AG-07) and its OQ/ADR register
   updated.
5. **The trade-off policy (PB §31) governs pressure:** scope cuts before
   architecture damage; deferrals recorded case-by-case; owner strategy
   review on persistent delay.

## Document history

| Date | Version | Change |
|---|---|---|
| 2026-09-22 | 1.0 | Initial staged roadmap proposal. No dates — dependency order only. Pending owner approval. |
