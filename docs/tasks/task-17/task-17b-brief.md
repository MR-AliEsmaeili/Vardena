# Task 17B — Brief (proposed future implementation slice)

- **Task title:** Accounting Movement, Balance Read Surface & Reporting Contract
  Investigation
- **Type:** INVESTIGATION + CONTRACT DESIGN ONLY
- **Status:** READY FOR REVIEW (documentation only) — 2026-09-25
- **Companion:** [`task-17b-investigation.md`](./task-17b-investigation.md) is
  the authoritative investigation; this brief derives the **proposed future
  implementation slice, its prerequisites, acceptance criteria, out-of-scope
  list, required Owner decisions, dependencies, and risks** from it.

> **This brief authorizes no implementation.** It is the handoff shape that a
> future gate-cleared task may use. Implementation remains blocked by
> OQ-25/OQ-43 (or an owner-approved bounded interim posture) exactly as
> Task 17 `brief.md` §7 requires. Nothing in this brief resolves an Open
> Question.

---

## 1. Purpose

Given the investigation in `task-17b-investigation.md`, define the smallest
**future** Accounting-owned implementation slice that converts the
investigation's contracts into reviewable code — but only **after** the
prerequisites in §3 are met. The slice stays strictly inside the
Accounting/Reporting boundary established by ADR-0009, the domain contract §19
(AC-D-30/31), the accepted Task 17A read-source precedent, and Task 17's
non-statutory, ledger-native scope.

## 2. Proposed future implementation slice

> PROPOSED DESIGN — a candidate, not an authorization and not a new task number.

**Slice name (proposed):** *Accounting Movement & Balance Read Contract*
(layer 1 only; no report UI, no export, no print, no statements).

1. **Account movement contract** — extend the accepted Task 17A movement source
   contract where traceability requires it (e.g. reversal/correction linkage is
   a document-level concern and stays out of the row itself), and formally
   publish the row as the layer-1 “account movement” source. No running
   balance, no aggregation.
2. **Balance/turnover contract** — publish period turnover
   (`periodDebitAmount`, `periodCreditAmount`), exact `periodNetAmount`, and
   intra-year derived `openingBalanceAmount`/`closingBalanceAmount` with the
   ADR-0031 window semantics (§4/§9), each as exact decimal strings, with the
   same org/area/year/period/account filters and reconciliation expectations as
   Task 12.
3. **Contract metadata** — per source: allow-listed filters and sorts,
   mandatory scope predicates, pagination model, row cap, timeout, decimal/date
   encodings, and the `sourceKind` + reconciliation expectation used by the
   future `ReportResponse<T>` envelope (`task-17b-investigation.md` §8.2).
4. **Nothing else.** No report definition registry, no Reporting module, no
   execution pipeline, no export/print, no statement or trial-balance layout.

## 3. Prerequisites (implementation gate)

All of the following must be evidenced on current `main` before any production
work (mirrors Task 17 `brief.md` §7):

1. **OQ-25** resolved, **or** owner-recorded bounded interim posture approving
   the non-statutory, nature-agnostic layout set (and excluding classification,
   control roles, and statutory layouts).
2. **OQ-43** resolved, **or** accountant/tax-legal-recorded interim posture for
   the exact non-statutory slice, explicitly excluding compliance/e-ledger
   claims.
3. Task 14 re-read: its `READY FOR REVIEW — NOT ACCEPTED` state respected; Task
   12's P1 real-PostgreSQL concurrency follow-up remains separately tracked and
   is **not** absorbed.
4. The scope does **not** need financial-area grants (OQ-40), currency
   (OQ-03/47/48), cross-year opening (OQ-23), dimensions (OQ-41), or
   localization/printing (OQ-02).
5. It is confirmed the work is limited to Accounting's contribution and does
   not require an unapproved generic Reporting module / Report Builder
   (OQ-49).

## 4. Acceptance criteria (future, gate-cleared only)

Correctness:

- movement rows reconcile 1:1 with `accounting.ledger_entries` over the same
  predicate;
- balance/turnover rows reconcile with the Task 12 projection and ledger
  aggregates (AC-I-19); drift is surfaced, never report-edited;
- all money values are exact decimal strings (`numeric(18,2)`); no float, no
  epsilon, no rounding;
- org/area/year/period/account scope is server-enforced (404, never 403;
  AC-I-01/16); no cross-organization result;
- opening/closing are derived intra-year only (ADR-0031 §9); cross-year carry
  is not invented.

Security:

- each authorized source is permission-gated in the backend, twice (guard +
  service), no wildcard;
- filters/sorts are allow-listed; values bound as parameters; no SQL
  identifiers from user input;
- read-only posture; no mutation path.

Performance:

- pagination bounded (`pageSize ≤ 500`); row caps and timeouts per
  reporting-strategy §7;
- deterministic total ordering with a unique tie-breaker;
- query plans measured against a documented dataset expectation and documented
  with the owning source;
- deep-page strategy documented (offset vs keyset) per investigation §7 Q14.

## 5. Out-of-scope list

Out of scope for **any** slice derived from this brief:

- Report Builder / OQ-49 / user-defined SQL / generic query builder;
- shared Reporting module, registry, execution pipeline, or dashboard engine
  (a separate, authorized Reporting task owns these);
- Excel/CSV generation, PDF/print implementation, HTML/CSS templates;
- XLSX/CSV/PDF export engines or e-ledger export;
- Iranian Electronic Books / statutory layouts / journal/ledger 4/6/8-column
  forms / financial statements (P&L, balance sheet);
- AR/AP, cash flow, treasury, inventory/sales reports;
- account classification (`account_type`/`is_temporary`), control roles,
  temporary-account close, cross-year carry-forward;
- multi-currency, revaluation, FX (OQ-03/47/48);
- dimensions (OQ-41), branch-as-cost-center (OQ-55), area access grants (OQ-40);
- schema/migration/index changes; new permissions in code (unless an authorized
  permission decision is separately recorded);
- microservices, second database, Redis, message broker, EAV/JSONB report
  models, universal report tables.

## 6. Required Owner decisions

Derived one-to-one from the investigation's unresolved questions (§15):

| # | Decision | Class |
| --- | --- | --- |
| D1 | Approve the nature-agnostic balance slice — `debitTurnover` / `creditTurnover` / exact `net`, plus intra-year derived opening/closing — as the **only** permitted balance semantics until OQ-25 (asset/liability/equity/revenue/expense presentation is excluded). | REQUIRES OWNER DECISION |
| D2 | Sparse vs dense default for balance/trial-balance surfaces (absence = zero vs LEFT JOIN periods/accounts), per surface. | REQUIRES OWNER DECISION |
| D3 | Offset vs keyset pagination for movement sources, and per-surface row-cap/timeout defaults. | REQUIRES OWNER DECISION |
| D4 | Permission model for surfaced reports: reuse `Accounting.LedgerMovement.View` / `Accounting.Balance.View`, or introduce `Report.<id>.View` codes with the future Reporting module. | REQUIRES OWNER DECISION |
| D5 | Whether any non-statutory report needs a “present net-of-reversal” and/or “include closed/sealed periods” switch, and the approved default. | REQUIRES OWNER DECISION |
| D6 | Adopt the `ReportResponse<T>` envelope and the four-layer boundary (domain read contract / Reporting envelope / export formatting / legal profile) as the contract baseline for the future Reporting module. | REQUIRES OWNER DECISION |
| D7 | Confirm the interim postures for OQ-25 and OQ-43 that allow the bounded non-statutory slice to proceed (Task 17 gate) — without closing either OQ. | BLOCKED BY OQ (until recorded) |

## 7. Dependencies

- Present: Task 10.x foundations; Task 11 (ACCEPTED); Task 12 (ACCEPTED WITH
  FOLLOW-UP; ADR-0031 Proposed); Task 15 reversal foundation; Task 17A
  (ACCEPTED) + `Accounting.LedgerMovement.View`; ADR-0009/reporting-strategy
  (Accepted).
- Absent and NOT created by this brief: Reporting module (registry/execution),
  `Report.<id>.View` registry, Excel/Print pipelines, statutory profile.
- Untouched statuses: Task 13 (IN PROGRESS), Task 14 (READY FOR REVIEW — NOT
  ACCEPTED; ADR-0032 Proposed), Task 16 (BLOCKED — OWNER CONFIRMATION).

## 8. Risks

1. **Scope creep into Reporting/export/print** — the slice must stay layer-1;
   the accepted Reporting architecture owns the pipeline. *(Mitigation: §5
   out-of-scope list + gate re-check.)*
2. **Unscoped/unindexed queries** — no date-leading ledger index today; a
   date-range-heavy source must be measured before enabling. *(Mitigation:
   performance acceptance criterion + documented query plans.)*
3. **Deep-paging external sorts** on tenant-wide scans. *(Mitigation:
   keyset-pagination decision D3.)*
4. **Classification-by-inference** — accounting staff may expect a grouped
   trial balance; without OQ-25 the source must not infer asset/liability
   classes from codes or Persian level names. *(Mitigation: D1 + explicit
   nature-agnostic semantics.)*
5. **Drift between projection and ledger** being silently rendered. *(Mitigation:
   reconciliation expectation in the contract; AC-I-19.)*
6. **Mistaking this brief for authorization** — nothing here is implemented or
   accepted. *(Mitigation: READY FOR REVIEW status and explicit non-goals.)*

---

## Version record

- 2026-09-25 — created together with `task-17b-investigation.md` (Task 17B,
  INVESTIGATION + CONTRACT DESIGN ONLY). No production, schema, migration,
  dependency, permission, ADR, or OQ change.

### Later date/time clarification (2026-10-09)

This brief is a historical Task 17B scope snapshot from before ADR-0042 was
accepted. Its OQ-02 references continue to apply to broader text/numeral and
statutory print/localization questions, but generic BusinessDate input/display
and Instant zone/calendar rendering were later decided by ADR-0042 (Jalali
calendar default and organization-configured valid IANA zone). The decision
does not authorize statutory rendering or widen this task's scope. See ADR-0042
and `docs/datetime.md`.
