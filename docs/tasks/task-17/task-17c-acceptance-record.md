# Task 17C — Review & Acceptance Record

**Status:** ACCEPTED (2026-09-25)  
**Task:** Task 17C — Decision Consolidation (repository canonical title: **Task 17C — Accounting Decision Consolidation**)  
**Acceptance type:** Documentation-only governance acceptance.  
**Consolidation work:** PR **#45** (`docs(accounting): consolidate owner decisions (Task 17C — Q1–Q22 + invariants)`) — **MERGED** into `main` in `2565254`; documentary findings of the final governance review corrected by PR **#48** (`docs(accounting): correct Task 17C factual drift found by governance review`) — **MERGED** into `main` in `7f8e3e8`  
**Acceptance sync branch:** `arena/01a0d8c0-vardena` (branched from `main` @ `7f8e3e8`)  
**Authorization:** explicit Owner authorization of the Task 17C Acceptance Sync (documentation-only; effective 2026-09-25)  
**Record type:** documentation/governance only — this record authors no production, schema, migration, API, permission, dependency, UI or test change

---

## Task

Task 17C — Decision Consolidation (**Task 17C — Accounting Decision Consolidation**): the
documentation-only consolidation of the Owner-approved Accounting decisions **Q1–Q22** and
the three mandatory invariants **I-1…I-3** into the authoritative repository baseline
([`docs/accounting/owner-decision-baseline.md`](../../accounting/owner-decision-baseline.md)),
including the creation of **ADR-0033…0037 (all Proposed)** and the synchronization of
`STATE.md`, `docs/accounting/task-index.md`, `docs/open-questions.md` (OQ-25/OQ-43
annotated, both still OPEN) and the `domain-contract.md` §31 pointer addendum.

## Status

**ACCEPTED** (2026-09-25) — changed from `READY FOR REVIEW — NOT ACCEPTED` by this
documentation-only governance acceptance sync.

## Acceptance type

Documentation-only governance acceptance.

## Scope accepted

The following were accepted **exactly as already recorded** in
[`docs/accounting/owner-decision-baseline.md`](../../accounting/owner-decision-baseline.md)
— none of them is rewritten, reinterpreted, expanded or altered in substantive meaning by
this acceptance:

- **Q1–Q22** — the Owner decision register (baseline §2);
- **Invariants I-1…I-3** — the three mandatory invariants (baseline §3):
  **I-1** `Account.id` is the permanent identity / `code` is a time-scoped business
  identifier with history; **I-2** POSTING **XOR** AGGREGATION per account node;
  **I-3** a code migration never rewrites economic ledger history;
- **Discrepancies D-1…D-13** — recorded, never silently resolved (baseline §5;
  **D-8** RESOLVED by the PR #44 merge in `2892189`);
- **Open items O-1…O-12** — open implementation details that stay with their named OQs
  (baseline §6).

This acceptance means:

- the owner decision consolidation is accepted;
- the governance documentation is synchronized;
- the recorded decisions are authoritative;
- the ADR proposals accurately reflect those decisions;
- the task introduces **no production behavior**;
- unresolved OQs remain unresolved;
- future implementation requires separate authorized tasks.

**Task 17 overall is NOT marked complete by this acceptance.** Task 17 overall remains
**BLOCKED** (FORMALIZED / IMPLEMENTATION BLOCKED BY OPEN QUESTIONS), because its later
implementation/governance prerequisites remain unresolved — especially **OQ-25** and
**OQ-43**.

## Important accepted decisions

The following major decisions are preserved explicitly (the authoritative full text is the
Q-register in the baseline; no additional decision is invented here):

1. Configurable finite accounting coding levels (Q1).
2. Vardena base structure with organization-configured account structure (Q2).
3. Permanent `Account.id`; account code is a historical/business identifier (Q3/Q18, I-1).
4. Standard control roles mapped to organization accounts (Q4).
5. Posting vs aggregation role integrity (Q5, I-2).
6. Tree detail plus floating detail (Q6).
7. Typed/capped configurable dimensions (Q7).
8. Configurable code lengths (Q8).
9. Legal reporting after Accounting Core (Q9).
10. Journal and General Ledger as independent report/read concepts (Q10).
11. Configurable base monetary unit with legal reporting separated (Q11).
12. Two correction modes subject to document state and permissions (Q12).
13. Final/legal documents cannot be deleted; correction/reversal is required (Q13).
14. Document Date for financial reporting; Posting Timestamp for audit/technical ordering
    (Q14).
15. Account Statement as the account performance/turnover concept (Q15).
16. Account Overview as a presentation layer over the same source/calculations (Q16).
17. Accounting Core standardized/secure; configuration flexible but bounded (Q17).
18. Historical reporting preserves historical code identity/mapping (Q18).
19. Code Structure Migration Service is the only future controlled migration mechanism
    (Q19).
20. No account-level-count migration in current scope (Q20).
21. Account deletion/deactivation follows history/reference constraints (Q21).
22. Accounting Core is independent from Legal Adapter/Profile (Q22).

## Explicit non-implementation statement

> Task 17C is a governance/documentation acceptance only. It does not implement account
> code history, code migration, posting-vs-aggregation relaxation, legal reporting,
> configurable accounting structure, dimensions, or any other production behavior.

- no production code changed;
- no Prisma schema changed;
- no migration added;
- no API/DTO changed;
- no permission implementation changed;
- no UI changed;
- no dependency added;
- no workflow/rules engine introduced.

## Open questions

### OQ-25 — OPEN

Accounting classification / account-type semantics remain **OPEN** (chart/report-layout
policy, base-structure and control-role content, per-level posting policy,
code-history/reuse shape, deletion guards, dimension defaults — baseline §6).

### OQ-43 — OPEN

Legal/statutory reporting and exact legal-book requirements remain **OPEN** (every Iranian
legal fact stays LEGAL VALIDATION REQUIRED — baseline §6 O-12).

Neither OQ is closed, downgraded or reinterpreted by this acceptance:

> Acceptance of Task 17C does not resolve OQ-25 or OQ-43.

## ADR status handling

**Repository ADR lifecycle convention (inspected first):** `docs/adr/README.md`
(`Status: Proposed | Accepted | Superseded`), the accepted/Proposed ADR corpus, and the
established acceptance precedents:

- **ADR-0026** was Accepted **before** implementation, but by an explicit, separately
  recorded ADR-level adoption (Task index §2 row 10.1: “#15 (**+ #16 accepts ADR-0026**)”;
  the ADR itself carries an explicit `Accepted: 2026-09-14` line);
- **Task 12** was ACCEPTED WITH FOLLOW-UP while **ADR-0031 remained Proposed** (“not
  marked Accepted outside promotion process per governance” — task index §3/§6/§9);
- the **Task 17B** acceptance recorded “no ADR status promoted (ADR-0031/0032 remain
  Proposed)”;
- the **Task 18** acceptance recorded “no ADR status is promoted and no new ADR was
  created”;
- the final governance review of this consolidation (PR #48) recorded “**ADRs
  0033–0037: Proposed. No status promoted; acceptance of the task ≠ acceptance of the
  ADRs**”;
- each of ADR-0033…0037 carries the status annotation “**not Accepted, no
  self-acceptance**”.

Under this convention, an ADR moves `Proposed → Accepted` only by a separate, explicit
adoption step recorded against the ADR itself; **acceptance of the task that records the
decision does not promote the ADR**. Task 17C acceptance does NOT automatically mean any
ADR is implemented, and no ADR here has been formally adopted at ADR level. Therefore:

> Task 17C is accepted, but this ADR remains Proposed pending its separate
> adoption/implementation gate.

applies to **each** of ADR-0033…0037 (per-ADR detail below). The following ADR subjects
remain **future/controlled concepts** and are not represented as implemented production
capabilities anywhere in this record:

- account code history implementation;
- code migration service;
- non-leaf posting;
- legal/statutory reporting;
- configurable accounting configuration implementation.

### ADR-0033 — Account identity and account code history

- **Decision accepted as governance baseline:** yes — Q3/Q8/Q18/Q21 + Invariant I-1 are
  accepted as recorded.
- **Implementation status:** the identity half is CONFIRMED BY REPOSITORY (ledger lines,
  ledger entries and projection keys all reference `Account.id`; no historical row stores
  a code). The **code-history half is a GAP — not implemented** (D-3). **Dimension
  assignments are not implemented** and must resolve by `Account.id` once they exist.
- **Unresolved questions:** OQ-25 (code-reuse policy, deletion guards); O-1
  (re-issuance of a superseded code; coexistence with the org-wide unique index);
  O-4 (deactivation/deletion blocking-reference list).
- **Future implementation requirements:** an additive schema task for code history +
  as-at historical resolution (own task per `docs/accounting/task-index.md` §7);
  separately authorized tasks for a pre-use code edit (D-2) and for deletion of provably
  unused accounts (D-4).
- **Status: Proposed.** Task 17C is accepted, but this ADR remains Proposed pending its
  separate adoption/implementation gate.

### ADR-0034 — Posting Account XOR Aggregation Account

- **Decision accepted as governance baseline:** yes — Q5 + Invariant I-2 are accepted as
  recorded.
- **Implementation status:** **not implemented.** Today's stricter rule —
  `postable ⇒ leaf` (contract §14 rule 2 / AC-D-19, AC-I-09) plus §8.5 rollup — stays in
  force; a non-leaf POSTING node is not representable today. This Task 17C
  acceptance did not decide D-1. **Subsequently, Task 20 OD-20-5 resolved D-1** as
  `POSTING = leaf-only` and `AGGREGATION = reporting/read-time roll-up`; see
  `docs/accounting/owner-decision-baseline.md` §12 and ADR-0034.
- **Open content:** OQ-25 still owns per-level posting-eligibility policy content;
  a future non-leaf-posting exception would require a new explicit decision that
  reopens/supersedes the leaf-only rule.
- **Future implementation requirements:** none for a non-leaf POSTING model under the
  accepted Task 20 rule. Any future exception requires an explicit superseding decision,
  ADR/read-model redesign, report disclosure, and denial-path tests; until then “post at
  a higher level” is not a supported configuration.
- **Status: Proposed.** Task 17C is accepted, but this ADR remains Proposed pending its
  separate adoption/implementation gate.

### ADR-0035 — Accounting code structure migration

- **Decision accepted as governance baseline:** yes — Q3/Q8/Q19/Q20 + Invariant I-3 are
  accepted as recorded.
- **Implementation status:** the **Code Structure Migration Service does NOT exist and is
  not authorized** by this acceptance (D-7). Level-count changes are excluded from
  current capability (Q20).
- **Unresolved questions:** OQ-25 (migration policy content); D-7 prerequisites —
  ADR-0030/OQ-45 (licensing: ADR-0030 Proposed, enforcement OFF, no license schema) and
  OQ-52/OQ-53 (backup/restore); O-9 (licensing mechanism + backup/recovery-point
  semantics); O-11 (pin divergence OQ-62/OQ-63 in preflight).
- **Future implementation requirements:** prerequisite resolution (code history per
  ADR-0033 §3, licensing, backup/restore), then the service task (11-stage
  request → preflight → impact → dry run → plan → owner approval → license validation →
  recovery/backup point → migration → reconciliation → audit report) defined through
  `docs/accounting/task-index.md` §7.
- **Status: Proposed.** Task 17C is accepted, but this ADR remains Proposed pending its
  separate adoption/implementation gate.

### ADR-0036 — Legal reporting architecture

- **Decision accepted as governance baseline:** yes — Q9/Q10/Q11/Q22 (architecture
  only, **no legal fact decided**) are accepted as recorded.
- **Implementation status:** **no legal profile model, module or table exists; no
  statutory/legal report is implemented.** The current accepted Accounting read surfaces
  are Task 17A Ledger Movement, Task 17B Account Statement, and — since Task 18 — the
  General Ledger and Trial Balance read APIs; **none of them is a legal surface**. The
  **Journal Book is not implemented**; every **statutory/legal book is not
  implemented**; **Legal Reporting / Legal Profile is not implemented**.
- **Unresolved questions:** **OQ-43 (every Iranian legal fact — LEGAL VALIDATION
  REQUIRED)**; OQ-02/OQ-03 (language and monetary-unit mechanism); D-6; O-6 (free
  “as of arbitrary date” window); O-8 (base unit set, scale/precision, Rial↔Toman
  display); O-12.
- **Future implementation requirements:** legal books / Legal Profile tasks only after
  OQ-43 validation with authoritative current sources, through
  `docs/accounting/task-index.md` §7 and ADR-0009/`reporting-strategy.md`; the Journal
  Book and the (statutory) General Ledger remain independent report definitions (Q10)
  over the same immutable ledger rows — the existing accounting-owned General Ledger read
  surface is a different, non-statutory surface and does not satisfy them.
- **Status: Proposed.** Task 17C is accepted, but this ADR remains Proposed pending its
  separate adoption/implementation gate.

### ADR-0037 — Accounting configuration boundary

- **Decision accepted as governance baseline:** yes — Q1/Q2/Q4/Q6/Q7/Q17 are accepted as
  recorded.
- **Implementation status:** the **base structure and the control roles are NOT in code**
  (D-5: no template, no `control_role` column, no seed); **dimensions and floating detail
  are not implemented** (D-12, OQ-41). The existing configuration mechanics (ADR-0028
  versioned root, single ACTIVE, operational freeze; depth/code-length caps) are the
  implemented boundary.
- **Unresolved questions:** OQ-25 (base-structure content, control-role list/mandatory
  set); OQ-41 (dimension count/defaults/binding/item governance); O-2; O-5.
- **Future implementation requirements:** an accountant-approved base structure +
  control-role vocabulary delivered as reviewable versioned configuration data with its
  own task (never mutating an existing chart); a dimensions task after OQ-41 answers,
  with AC-I-18 validation and the EAV/JSONB prohibition enforced.
- **Status: Proposed.** Task 17C is accepted, but this ADR remains Proposed pending its
  separate adoption/implementation gate.

## State after this acceptance

| Item                             | State after this acceptance                                                                                                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task 17A**                     | **ACCEPTED (2026-09-25)** — unchanged (`docs/tasks/task-17/task-17a-acceptance-record.md`)                                                                                          |
| **Task 17B**                     | **ACCEPTED (2026-09-25)** for its bounded D1–D7 slice — unchanged (`docs/tasks/task-17/task-17b-acceptance-record.md`)                                                              |
| **Task 17C**                     | **ACCEPTED (2026-09-25)** — this record (documentation-only governance acceptance)                                                                                                  |
| **Task 17 overall**              | **BLOCKED** (FORMALIZED / IMPLEMENTATION BLOCKED BY OPEN QUESTIONS) — **NOT complete**; later implementation/governance prerequisites remain unresolved, especially OQ-25 and OQ-43 |
| **OQ-25**                        | **OPEN** — not resolved, not reclassified                                                                                                                                           |
| **OQ-43**                        | **OPEN** — not resolved, not reclassified                                                                                                                                           |
| **ADR-0033…0037**                | **Proposed** — none promoted by this acceptance; each remains pending its separate adoption/implementation gate                                                                     |
| Live Accounting permission count | **38** (the accepted Task 18 added `Accounting.GeneralLedger.View` and `Accounting.TrialBalance.View`; the stale “36” count is superseded per the PR #48 correction)                |

This acceptance does **not** imply that Task 17C acceptance implements the future
capabilities described by ADR-0033…0037.

## Factual consistency (per the PR #48 correction)

This acceptance sync does not reintroduce the factual drift corrected by PR #48:

- **Permission count:** the current live permission count is **38**, not 36 — verified
  against `backend/src/modules/accounting/domain/accounting-permissions.ts`
  (`Accounting.GeneralLedger.View` and `Accounting.TrialBalance.View` included).
- **Reporting/read surfaces:** the current accepted read surfaces include **Task 17A
  Ledger Movement**, **Task 17B Account Statement**, **Task 18 General Ledger** and
  **Task 18 Trial Balance**. No claim is made that no reporting/read surfaces exist.
- **Not implemented:** the **Journal Book is not implemented**; **statutory/legal books
  are not implemented**; **Legal Reporting / Legal Profile is not implemented**.
- **ADR-0036 consistency:** Task 17A/17B are **not** described as the only Accounting
  read surfaces; the Task 18 General Ledger and Trial Balance remain represented as
  existing read surfaces while explicitly remaining **non-legal/non-statutory**.
- **ADR-0033 consistency:** dimension assignments are **not** described as an existing
  implemented reference — they are not implemented.
- **Task-index consistency:** no unqualified statement that independent Journal Book and
  General Ledger already exist is made: the (accounting-owned) **General Ledger read
  surface exists**; the **Journal Book does not**; the **legal/statutory books do
  not**.

## Recorded observations (out of scope — not fixed here)

1. **Historical snapshot preserved.**
   `docs/tasks/task-18/task-18-acceptance-record.md` §8 (status-impact table) records
   “Task 17C: READY FOR REVIEW — NOT ACCEPTED — unchanged”. That row is a dated
   snapshot of the state at the Task 18 acceptance (before this sync) and is preserved
   as historical evidence per `STATE.md` §11 (“do not erase historical decisions or
   silently change statuses”) — it is not rewritten.
2. **Pre-existing recorded drift, outside this sync.** `STATE.md` §9/§10 already record
   the Task 12 legacy “ACCEPTED WITH FOLLOW-UP” label vs. the §7 “UNKNOWN — REQUIRES
   OWNER CONFIRMATION” (BOOT-OQ-02 / BOOT-R-02) and the `domain-contract.md` header
   status wording (BOOT-R-10). These are separately authorized documentation concerns and
   are untouched here.

## Cross-references

- Task 17C owner-decision baseline (Q1–Q22 §2, I-1…I-3 §3, D-1…D-13 §5, O-1…O-12 §6):
  [`docs/accounting/owner-decision-baseline.md`](../../accounting/owner-decision-baseline.md)
- Received Task 17C prompt (verbatim source of the decisions):
  [`task-17c-prompt.md`](./task-17c-prompt.md)
- OQ-25 / OQ-43 (registry, both OPEN):
  [`docs/open-questions.md`](../../open-questions.md)
- ADR-0033: [`0033-account-identity-and-code-history.md`](../../adr/0033-account-identity-and-code-history.md)
- ADR-0034: [`0034-posting-versus-aggregation-accounts.md`](../../adr/0034-posting-versus-aggregation-accounts.md)
- ADR-0035: [`0035-account-code-structure-migration.md`](../../adr/0035-account-code-structure-migration.md)
- ADR-0036: [`0036-legal-reporting-architecture.md`](../../adr/0036-legal-reporting-architecture.md)
- ADR-0037: [`0037-accounting-configuration-boundary.md`](../../adr/0037-accounting-configuration-boundary.md)
- ADR index (all five rows remain `Proposed`): [`docs/adr/README.md`](../../adr/README.md)
- Task 17A acceptance: [`task-17a-acceptance-record.md`](./task-17a-acceptance-record.md)
- Task 17B acceptance: [`task-17b-acceptance-record.md`](./task-17b-acceptance-record.md)
- Task 18 acceptance (current reporting/read-surface baseline — General Ledger /
  Trial Balance as accepted non-legal read surfaces):
  [`task-18-acceptance-record.md`](../task-18/task-18-acceptance-record.md)
- Factual-drift correction of the baseline (merged before this sync): PR #48,
  merge commit `7f8e3e8`; consolidation PR #45, merge commit `2565254`
- Governance state: `docs/accounting/task-index.md` (header/§2/§4/§5/§9), `STATE.md`
  (§3 ADR inventory, §7 Task History, §8 Current Task, §9 Open Questions, §10 timeline)

---

**Task 17C — Accounting Decision Consolidation: ACCEPTED (2026-09-25)** —
documentation-only governance acceptance; Task 17 overall remains BLOCKED
(FORMALIZED / IMPLEMENTATION BLOCKED BY OPEN QUESTIONS) and NOT complete; OQ-25/OQ-43
remain OPEN; ADR-0033…0037 remain Proposed; no production behavior changed.
