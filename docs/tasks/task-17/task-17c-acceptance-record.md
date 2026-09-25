# Task 17C — Review & Acceptance Record

**VERDICT: ACCEPTED**

**Status:** ACCEPTED (2026-09-25)
**Task Title:** Task 17C — Accounting Decision Consolidation
**Acceptance type:** Documentation-only governance acceptance — no production behaviour
**Consolidation PR:** #45 (`docs(accounting): consolidate owner decisions (Task 17C — Q1–Q22 + invariants)`) — Merged into `main` in `256525463fad2436638baad89955be5f9d1fbf5f`
**Governance-review correction PR:** #48 (`docs(accounting): correct Task 17C factual drift found by governance review`) — Merged into `main` in `7f8e3e8ce65bd22acdaaec94f9362797d2bfb5c9` (the acceptance-sync baseline)
**Acceptance authority:** Repository Owner / Reviewer (`MR-AliEsmaeili`) — the authority that records `ACCEPTED` under `STATE.md` §6 and that authorized this acceptance sync
**Acceptance record:** this file (`docs/tasks/task-17/task-17c-acceptance-record.md`)
**Acceptance-sync PR:** **#50** (`docs(accounting): accept Task 17C after governance review`) — documentation-only, head `1c62923605161c0f9177b9278b18c8dd01cc5869`, on `arena/01a0da76-vardena` (base `7f8e3e8`, the merge of PR #48)
**Record type:** documentation/governance only — this record authors no production, schema, migration, API, permission, dependency, UI or test change

---

## Task

**Task 17C — Decision Consolidation** — the consolidation of the Owner-approved
Accounting decisions (**Q1–Q22**), the three mandatory invariants (**I-1…I-3**), the
recorded discrepancies (**D-1…D-13**) and the open implementation details (**O-1…O-12**)
into the repository as the authoritative documentation baseline for future Accounting
work.

Authoritative artifacts:

- Owner-decision register: [`docs/accounting/owner-decision-baseline.md`](../../accounting/owner-decision-baseline.md)
- Received Owner prompt (saved verbatim before any change): [`task-17c-prompt.md`](./task-17c-prompt.md)
- ADRs created by the consolidation: [ADR-0033](../../adr/0033-account-identity-and-code-history.md),
  [ADR-0034](../../adr/0034-posting-versus-aggregation-accounts.md),
  [ADR-0035](../../adr/0035-account-code-structure-migration.md),
  [ADR-0036](../../adr/0036-legal-reporting-architecture.md),
  [ADR-0037](../../adr/0037-accounting-configuration-boundary.md) — **all still `Proposed`** (§ADR status)
- Task-index row / history: [`docs/accounting/task-index.md`](../../accounting/task-index.md) §2/§4/§5/§9
- Contract pointer addendum: [`docs/accounting/domain-contract.md`](../../accounting/domain-contract.md) §31 (pointer only)

## Status

**ACCEPTED** (2026-09-25).

Before this sync the repository recorded Task 17C as **READY FOR REVIEW — NOT
ACCEPTED**; this acceptance record is the formal synchronization that changes that
status. The consolidation itself was merged by PR **#45** (`2565254`), its factual
drift was corrected by PR **#48** (`7f8e3e8`) as directed by the governance review,
and the Owner has now accepted the resulting documentation baseline.

**This acceptance does not change any Owner decision, invariant, discrepancy, open
item or Open Question.** It records the acceptance of the already-established
decision set, exactly as consolidated.

## Acceptance type

**Documentation-only governance acceptance.**

Accepting Task 17C means:

- the Owner decision consolidation is accepted;
- the governance documentation is synchronized;
- the recorded decisions are authoritative;
- the ADR proposals accurately reflect those decisions;
- the task introduces **no production behavior**;
- unresolved OQs remain unresolved;
- future implementation requires separate authorized tasks.

It does **not** authorize, implement, schedule or pre-approve any capability.

---

## Scope accepted

The following were accepted exactly as already recorded — nothing was reinterpreted,
expanded, reduced or silently repaired:

| Accepted scope | Canonical record | Count |
|---|---|---|
| Owner decisions | `owner-decision-baseline.md` §2 (Q1–Q22); source prompt `task-17c-prompt.md` | **Q1–Q22** |
| Mandatory invariants | `owner-decision-baseline.md` §3 (I-1 identity, I-2 POSTING XOR AGGREGATION, I-3 migration never rewrites economic ledger history) | **I-1…I-3** |
| Discrepancies between the decisions and the repository | `owner-decision-baseline.md` §5 | **D-1…D-13** |
| Open implementation details (not new OQ ids) | `owner-decision-baseline.md` §6 | **O-1…O-12** |
| Open Questions annotating the model/content split | `docs/open-questions.md` — **OQ-25 OPEN**, **OQ-43 OPEN** | 2 |

The **substantive meaning** of every item above is preserved by this acceptance and is
not restated, rewritten or reinterpreted here. Where this record summarizes a decision
for readability, `owner-decision-baseline.md` §2/§3 and the Owner prompt remain the
binding text.

---

## Important accepted decisions

The twenty-two accepted Owner decisions, each mapped to its register entry. Full
wording: `owner-decision-baseline.md` §2 (and `task-17c-prompt.md`).

| # | Accepted decision | Register |
|---|---|---|
| 1 | Accounting coding levels are **configurable but finite and bounded** — never hardcoded to four, configured inside a controlled Vardena-supported structure with code-defined caps. | Q1 |
| 2 | **Vardena base structure + organization-configured account structure** (hybrid model); the base structure is a commitment whose content stays expert-gated. | Q2 |
| 3 | **`Account.id` is permanent**; the account **code is a historical/business identifier**, not identity. | Q3/Q8/Q18, I-1 |
| 4 | **Standard control roles are mapped to organization accounts**; the role vocabulary is Vardena-standardized, mandatory only where an active operation consumes it. | Q4 |
| 5 | **Posting vs aggregation role integrity** — one semantic role per node (POSTING XOR AGGREGATION), never both, and never an undifferentiated parent/child total. | Q5, I-2 |
| 6 | **Tree detail accounts plus floating detail** are both supported; which is used is configuration, not a product fork. | Q6 |
| 7 | **Typed, capped configurable dimensions** with per-(account, dimension) `required`/`optional`/`forbidden`; never a giant EAV or JSONB structure. | Q7 |
| 8 | **Configurable code lengths** per level at setup; changing code length after transactions exist only through the controlled migration mechanism. | Q8 |
| 9 | **Legal reporting comes after the Accounting Core**; Iranian statutory requirements never become hardcoded Core dependencies. | Q9 |
| 10 | **Journal Book and General Ledger are independent report/read concepts** over the same immutable ledger rows — never collapsed because they share data. | Q10 |
| 11 | **Configurable base monetary unit** (incl. Rial/Toman) with **legal reporting separated** through the Legal Profile; conversion is presentation-only — one stored amount, one stored unit. | Q11 |
| 12 | **Two correction modes** by lifecycle — controlled edit/delete/recreate for non-final documents under permissions, immutable correction/reversal for Final documents — subject to document state and permissions. | Q12 |
| 13 | **Final/legal documents cannot be deleted**; correction/reversal is required and must preserve historical auditability. | Q13 |
| 14 | **Document Date is the financial-reporting axis; Posting Timestamp is the audit/technical-ordering axis**; Fiscal Year, Accounting Period and both dates stay distinct, never substitutes. | Q14 |
| 15 | **Account Statement is the account performance/turnover concept** (Opening, Debit, Credit, Net, Closing, drill-down data), with no second financial calculation engine. | Q15 |
| 16 | **Account Overview is a presentation layer** over the same source and the same calculations — never a second accounting truth. | Q16 |
| 17 | **Accounting Core is standardized and secure; configuration is flexible but bounded** — a configuration that would violate an invariant is refused, not merely discouraged. | Q17 |
| 18 | **Historical reporting preserves historical code identity/mapping** (report date → `Account.id` → code valid then; current-code rendering is an explicit alternative view). | Q18 |
| 19 | The **Accounting Code Structure Migration Service** is the **only** future controlled mechanism by which a used account's code may change — licensed, permission-gated, Owner-approved, audited, reconciled. | Q19 |
| 20 | **No account-level-count migration in current scope** — no feature, flow, UI or analysis artifact; the architecture must not unnecessarily prevent later analysis. | Q20 |
| 21 | **Account deletion/deactivation follows history/reference constraints** — an unused, unreferenced account may be deleted; an account with historical usage is deactivated, never deleted; **zero balance is not evidence of no usage**. | Q21 |
| 22 | **The Accounting Core is independent of the Legal Adapter / Legal Profile** (`Accounting Core → Legal Adapter / Legal Profile → { Iran profile, future profiles }`); no Core capability may depend on a legal book existing. | Q22 |

**No additional decisions are invented by this acceptance.** The register's
classifications (**OWNER DECIDED**, **CONFIRMED BY REPOSITORY**, **IMPLEMENTATION DETAIL
OPEN**, **LEGAL VALIDATION REQUIRED**, **GAP**, **DISCREPANCY**) and its twelve open
implementation details (**O-1…O-12**) remain exactly as recorded.

### Invariant register (accepted, normative)

| Invariant | Statement | Register |
|---|---|---|
| **I-1** | `Account.id` is the permanent Accounting identity; `Account.code` is a time-scoped business/display identifier that cannot be treated as identity. | §3, ADR-0033 |
| **I-2** | A node is POSTING **or** AGGREGATION at a given time, never both; a node's own postings and its descendants' rollup are never read as one undifferentiated number. | §3, ADR-0034 |
| **I-3** | A code migration never rewrites economic ledger history; it preserves `Account.id` and changes only code representation/history, keeping the historical→current mapping reconstructable. | §3, ADR-0035 |

### Discrepancy and open-item register (accepted as recorded)

- **D-1…D-13** are accepted **as recorded, not as resolved**: `D-1` (non-leaf POSTING vs
  AC-D-19/AC-I-09 `postable ⇒ leaf` — today's rule stays in force), `D-2` (pre-use code
  edits vs the shipped immutable code), `D-3` (no code history exists), `D-4` (deletion
  vs freeze-over-delete), `D-5` (no base structure / control roles in code), `D-6`
  (monetary unit / localization), `D-7` (licensed migration vs ADR-0030 Proposed,
  enforcement OFF, no license schema), `D-8` (Task 17B governance synchronization —
  **RESOLVED** by the PR #44 merge in `2892189`), `D-9` (level-count precision), `D-10`
  (only `reversal` implemented), `D-11` (drill-down data exists, no surface), `D-12`
  (dimensions/floating detail contract-only), `D-13` (no statutory/legal report
  definition, no Reporting module, no Legal Profile; Journal Book unimplemented).
- **O-1…O-12** remain open implementation details under their governing OQ/ADR; none is
  closed, downgraded or reinterpreted by this acceptance.

---

## Explicit non-implementation statement

> Task 17C is a governance/documentation acceptance only. It does not implement account
> code history, code migration, posting-vs-aggregation relaxation, legal reporting,
> configurable accounting structure, dimensions, or any other production behavior.

Additionally, and explicitly:

- **no production code changed** (the consolidation PR #45 and the correction PR #48
  touch only `.md` files — verified by path audit, §Validation);
- **no Prisma schema changed**;
- **no migration added**;
- **no API/DTO changed**;
- **no permission implementation changed** (the live Accounting permission registry is
  unchanged at **38 codes**);
- **no UI changed**;
- **no dependency added**;
- **no workflow/rules engine introduced**.

Task 17C creates no scaffold, stub, placeholder, seed, template artifact, table, column,
endpoint, permission or configuration data. Every capability named in ADR-0033…0037 and
in `owner-decision-baseline.md` §4 remains an unimplemented candidate governed by
[`docs/accounting/task-index.md`](../../accounting/task-index.md) §4 and §7.

---

## OQ handling

| OQ | State after this acceptance |
|---|---|
| **OQ-25** — chart of accounts / coding scheme, mandatory control roles, eligibility defaults, report layouts, classification | **OPEN.** The *model* is Owner-decided (Task 17C); the *content* (base-structure content, role list and mandatory set, per-level posting policy, non-leaf POSTING validation, code-history/reuse shape, deletion guards, statutory layouts) remains undecided. |
| **OQ-43** — Iranian statutory / legal reporting requirements and the exact legal-book requirements | **OPEN.** Only the *architecture* is Owner-decided (Q22 → ADR-0036, Proposed); every legal fact remains **LEGAL VALIDATION REQUIRED** and no legal/statutory claim is made. |

> **Acceptance of Task 17C does not resolve OQ-25 or OQ-43.**

Neither OQ is closed, downgraded, reclassified, superseded or reinterpreted by this
acceptance; no new OQ id is invented. `docs/open-questions.md` remains the single source
of truth for OQ text and status, and its Task 17C annotation rows stay in the **Open**
table (their status wording — "OWNER DECIDED, this row stays OPEN" — remains accurate
after acceptance and was therefore **not** edited).

---

## ADR status handling

### Repository convention applied

Per the required status rule, `docs/adr/README.md`, the accepted-ADR examples and the
repository's recorded lifecycle convention were inspected **before** deciding any ADR
status. The governing evidence:

- `docs/adr/README.md` — the format is `Status: Proposed | Accepted | Superseded by ADR-xxxx`,
  ADRs are **immutable once Accepted**, numbering is sequential and "ADRs that resolve
  open questions link the `OQ-xx` ids". The README defines no rule that promotes a
  Proposed ADR merely because a related task was accepted.
- `STATE.md` §3 (**Existing ADR inventory — statuses transcribed, not promoted**): **"An
  accepted ADR does not establish acceptance of the task implementing it. Proposed
  records remain Proposed even where code exists."** This is the repository's recorded
  convention, and it cuts the other way too: no ADR becomes Accepted without its own
  recorded adoption step.
- Accepted ADRs in that inventory carry an explicit adoption annotation — e.g. ADR-0022
  "Accepted (implemented by Task 9.5)", ADR-0023 "Accepted (implemented by Task 8)",
  ADR-0024 "Accepted (implemented by Task 9)", ADR-0025 "Accepted (implemented by Task
  9.6)", ADR-0026 "Accepted (accepted 2026-09-14 … before Task 10.2 writes any
  Accounting schema)". ADR-0031/0032 remain **Proposed despite implementation**
  (`STATE.md` §10 BOOT-R-02) — proof that status promotion is a separate, explicit
  governance act, never an automatic consequence of a task's acceptance.
- The Task 18 acceptance record (§8) records in the same spirit: **"No ADR promoted by
  this acceptance"**, and `STATE.md` §8 repeats it. The Task 17A/17B acceptance records
  promote no ADR either.
- The five consolidation ADRs themselves record `Implements: nothing` and — in their
  Status lines — `not Accepted, no self-acceptance`.

**Conclusion — the repository convention requires a separate adoption/implementation
gate.** Task 17C is documentation-only and implements none of the five ADRs' decisions;
its acceptance is not that gate. Therefore **ADR-0033…0037 keep their `Proposed` status**,
and each records the required sentence:

> Task 17C is accepted, but this ADR remains Proposed pending its separate
> adoption/implementation gate.

No new ADR lifecycle was invented, no ADR was rewritten, and no ADR is presented as an
implemented production capability.

### Per-ADR record

| ADR | Decision accepted as governance baseline | Implementation status | Unresolved questions | Future implementation requirement | Status after this acceptance |
|---|---|---|---|---|---|
| [**ADR-0033** `0033-account-identity-and-code-history.md`](../../adr/0033-account-identity-and-code-history.md) — account identity and code history | Yes — Q3/Q8/Q18/Q21 + Invariant 1 | **Not implemented.** Id-based references exist and are confirmed; **no code-history structure, no as-at resolution, no pre-use code edit, no account deletion** (discrepancy D-2/D-3/D-4). Dimension assignments are **not implemented** and must follow the same id rule once they exist. | O-1 (may a superseded code be re-issued; history vs `uq_accounts_organization_id_code`), O-4 (deactivation guards / blocking references) — under OQ-25/OQ-36. | Its own task via `task-index.md` §7 + additive migration (AR-10/AR-29): code-history rows with validity, as-at resolution in read paths, mapping exposure, pre-use code edit and unused-account deletion with reference checks and permissions. | **Proposed** |
| [**ADR-0034** `0034-posting-versus-aggregation-accounts.md`](../../adr/0034-posting-versus-aggregation-accounts.md) — POSTING XOR AGGREGATION | Yes — Q5 + Invariant 2 | **Not implemented as a configurable model.** Satisfied today only by the stricter `postable ⇒ leaf` rule (AC-D-19 rule 2 / AC-I-09) + §8.5 rollup, which **stays in force**; **non-leaf posting is not a supported configuration** (discrepancy D-1). | O-3 (per-level posting-eligibility policy content; exact validation rules for a non-leaf POSTING node) — under OQ-25. | An **accepted ADR amendment superseding** AC-D-19 rule 2 / AC-I-09 and **amending** §8.5, plus the explicit role attribute, separated own-vs-descendant measures, report disclosure and denial-path tests. | **Proposed** |
| [**ADR-0035** `0035-account-code-structure-migration.md`](../../adr/0035-account-code-structure-migration.md) — code structure migration service | Yes — Q3/Q8/Q19/Q20 + Invariant 3 | **Does not exist and is not authorized** — no service, scaffold or stub; no license foundation (ADR-0030 Proposed, enforcement OFF, no `license` schema/module); no code history (ADR-0033 §3); level-count changes excluded (**Q20**). | O-9 (licensing/expiry, backup/recovery point) under OQ-45/OQ-52/OQ-53; O-11 (pin divergence / legacy fallback shape) under OQ-62/OQ-63. | Its own task via `task-index.md` §7, after ADR-0033 §3, ADR-0030/OQ-45, OQ-52/OQ-53 and OQ-62/OQ-63 are handled; the 11-stage controlled pipeline, license gate, reconciliation gate and audit trail are binding. | **Proposed** |
| [**ADR-0036** `0036-legal-reporting-architecture.md`](../../adr/0036-legal-reporting-architecture.md) — legal reporting architecture | Yes — Q9/Q10/Q11/Q22 | **Nothing implemented.** No Legal Profile model/module/table, no statutory layout or column set, **no legal book**; the **Journal Book** is unimplemented; the existing Accounting read surfaces — Task 17A ledger movement, Task 17B account statement, and (since the accepted Task 18) the General Ledger and Trial Balance read APIs — are **not legal surfaces** (discrepancy D-6/D-13). | **O-12 — every Iranian legal fact** (statutory layouts, taxpayer groups, registration/sealing, entry-timing limits, e-book deletion, Art. 169, retention) stays **LEGAL VALIDATION REQUIRED** under **OQ-43**; O-6 (free "as of" date basis) and O-8 (unit/scale/localization) also remain. | A Legal Profile task through `task-index.md` §7 + ADR-0009/`reporting-strategy.md`, after OQ-43 validation against authoritative current sources; a Legal Profile must consume Core read sources and never contaminate Core semantics. | **Proposed** |
| [**ADR-0037** `0037-accounting-configuration-boundary.md`](../../adr/0037-accounting-configuration-boundary.md) — accounting configuration boundary | Yes — Q1/Q2/Q4/Q6/Q7/Q17 | **Mechanism implemented and unchanged** (configurable levels/digit lengths/postability defaults, versioning + pinning, single ACTIVE, operational freeze); **content and new capability are not implemented** — no base structure or template artifact, no `control_role` column or mapping table, no dimension tables, no floating detail (discrepancies D-5/D-12). | O-2 (role list, mandatory set, base-structure content) under OQ-25; O-5 (dimension count/defaults/binding/governance) under OQ-41; OQ-22/OQ-55 for branch/department as dimensions. | Base structure delivered as **versioned configuration data/template** with an accountant-approved role vocabulary, plus dimensions/floating detail tasks after OQ-41 — each via `task-index.md` §7, never as hardcoded rows or customer-specific code. | **Proposed** |

### Future/controlled subjects that must not be read as implemented

Notwithstanding the accepted decisions, the following remain **future/controlled
concepts and not implemented production capabilities**: account code history
implementation; the code migration service; non-leaf posting; legal/statutory
reporting; and any configurable-accounting-configuration implementation beyond the
already-shipped mechanism.

---

## Task 17 overall

**Task 17 overall remains `BLOCKED`** — FORMALIZED / IMPLEMENTATION BLOCKED BY OPEN
QUESTIONS — and is **NOT complete**. **This acceptance does not complete Task 17.**

Task 17 stays blocked because its later implementation/governance prerequisites remain
unresolved, in particular:

- **OQ-25** — classification / account-type semantics and chart, control-role,
  per-level posting-policy, code-history and report-layout content remain undecided;
- **OQ-43** — legal/statutory reporting and the exact legal-book requirements remain
  unvalidated.

Also unchanged: Task 17A **ACCEPTED (2026-09-25)**, Task 17B **ACCEPTED (2026-09-25)**
for its bounded D1–D7 slice, Task 18 **ACCEPTED (2026-09-25)** for its bounded D1–D20
read foundation. Task 17C's acceptance authorizes **no** future Task 17 slice.

---

## Factual consistency (PR #48 corrections preserved)

This acceptance sync was checked against the factual corrections merged in PR #48
(`7f8e3e8`) and **does not reintroduce** any of them:

| Item | Verified state after this sync |
|---|---|
| **Permission count** | The stale count **36 is not restored**. The live Accounting registry is **38 permission codes** — confirmed by inspection of `backend/src/modules/accounting/domain/accounting-permissions.ts` (38 unique `Accounting.*` codes), i.e. the Task 17A/17B codes plus the Task 18 `Accounting.GeneralLedger.View` and `Accounting.TrialBalance.View`. `owner-decision-baseline.md` §1 keeps its "36 at this baseline; **38 after Task 18**" wording and its post-baseline drift note. |
| **Reporting surfaces** | The existing read surfaces are represented as **existing**: Task 17A Ledger Movement, Task 17B Account Statement, Task 18 General Ledger and Trial Balance. The **Journal Book is not implemented**; **statutory/legal books are not implemented**; **Legal Reporting / Legal Profile is not implemented**. No wording claims "no reporting/read surfaces exist". |
| **ADR-0036** | Its Context still lists the Accounting read surfaces including the Task 18 General Ledger / Trial Balance, states that **none of them is a legal surface**, and keeps the Journal Book and statutory books unimplemented. Task 17A/17B are **not** described as the only Accounting read surfaces. |
| **ADR-0033** | Still states that **dimension assignments are not implemented** and must resolve by id once they exist; no implemented-reference claim is made. |
| **Task index** | No unqualified statement that an independent Journal Book and General Ledger already exist: the General Ledger **read surface** exists (Task 18), the Journal Book does not, and neither do the legal/statutory books. The §4 candidate row keeps its PR #48 qualification. |

Additional consistency checks:

- **Task 18 is not de-accepted or reinterpreted**: its acceptance, its D1–D20 baseline,
  its Ledger-native D5 resolution and its explicit non-legal scope boundary are
  referenced, never modified.
- **Task 17A/17B acceptances are referenced, never modified.**
- **ADR status sentences** (`Proposed`) in `docs/adr/README.md`'s index remain accurate
  — the index was therefore left unchanged.
- **Contract §31** is a pointer-only addendum that states no task status; it stays
  unchanged and its "all Proposed" statement remains true.

---

## Validation performed for this acceptance sync

Documentation-only; no test suite is re-run and no new runtime result is invented.

| Check | Command / method | Result |
|---|---|---|
| Whitespace/conflict errors | `git diff --check` | clean |
| Diff scope | `git diff --name-only main…HEAD` path audit | `.md` files only — no `backend/`, `prisma/`, `*.ts`, `*.sql`, `package*.json`, `.github/`, `docker-compose.yml`, `frontend/` path |
| Precondition — PR #48 merged | `gh pr view 48 --json state,mergeCommit`; `git rev-parse main HEAD` | `MERGED`, merge commit `7f8e3e8` = `main` = `origin/main` = branch base |
| Precondition — PR #48 introduced no production change | `gh pr diff 48 --name-only` | 4 files, all `.md` |
| Precondition — Task 18 / 17A / 17B ACCEPTED, Task 17C READY FOR REVIEW — NOT ACCEPTED | `STATE.md` §7/§8, `docs/accounting/task-index.md` header/§2/§9, `owner-decision-baseline.md` header, `docs/tasks/task-18/task-18-acceptance-record.md` | confirmed |
| Precondition — OQ-25 / OQ-43 OPEN | `docs/open-questions.md`; `task-index.md` §5; `STATE.md` §9 | confirmed OPEN, not edited to closed |
| Precondition — ADR-0033…0037 Proposed | `docs/adr/README.md` index + ADR Status lines | confirmed Proposed |
| Permission count | grep/unique-count of `Accounting.*` codes in `accounting-permissions.ts` | **38** |
| Referenced paths exist | every relative link and backticked path in the changed files resolved on the filesystem | all present |
| Referenced ids exist | `Q`/`I-`/`D-`/`O-` ids against `owner-decision-baseline.md`; `OQ-` ids against `docs/open-questions.md`; `ADR-` ids against `docs/adr/`; `AC-` ids against contract §25/§26; `AG-`/`AR-` ids against `.vardena/*` | all resolve |
| Status-string consistency | grep sweep for `Task 17C`, `Task 17A`, `Task 17B`, `Task 18`, `OQ-25`, `OQ-43`, `ADR-0033`…`ADR-0037`, `READY FOR REVIEW`, `ACCEPTED`, `BLOCKED`, `OPEN` across `STATE.md`, `docs/accounting/*`, `docs/adr/*`, `docs/tasks/task-17/*`, `docs/tasks/task-18/*` | Task 17C now `ACCEPTED` everywhere current; historical dated rows preserved; OQ rows stay `OPEN`; Task 17 stays `BLOCKED` |
| Markdown table integrity | column-count check on every edited/created table row | consistent |
| ADR format conformance | `docs/adr/README.md` template (Status/Date/Context/Decision/Consequences) | conforms; status changes limited to the Status line |
| Automated documentation validation | repository CI inspection `.github/workflows/ci.yml` | the workflow runs with `working-directory: backend` (Prisma/lint/typecheck/format/unit/build/migrate/E2E); **no documentation-validation job exists**, and no CI step was weakened or bypassed. CI runs normally on the PR carrying only `.md` changes |

Records deliberately **not** changed (see §Observations below): `docs/tasks/task-18/task-18-acceptance-record.md`,
`docs/tasks/task-18/task-18-implementation-report.md`, `docs/open-questions.md`,
`docs/accounting/domain-contract.md`, `docs/modules.md`, `docs/adr/README.md`.

---

## Observations recorded, not fixed (out of scope)

Per AG-17 — record, do not silently repair. These are **documentation observations**
found during the acceptance sync; none changes the accepted Task 17C state, and none is
a production defect:

1. **Task 18's acceptance record §8** contains a dated cross-task row "**Task 17C** —
   READY FOR REVIEW — NOT ACCEPTED — unchanged". That table is the **state after the
   Task 18 acceptance** and is a historical snapshot; it is **not** modified by this
   sync (rewriting a dated acceptance record's cross-task snapshot would erase
   history). The current Task 17C status is recorded here, in `STATE.md` §7/§8/§10 and
   in `docs/accounting/task-index.md` header/§2/§9. The same applies to
   `docs/tasks/task-18/task-18-implementation-report.md` §10's closing sentence.
2. **`docs/modules.md` Accounting prose** still lags the Task 18 read surfaces (already
   recorded by the Task 18 acceptance record §9 item 2 and the Task 17C governance
   review). Unrelated to Task 17C status; a separate documentation task owns it.
3. **`docs/accounting/domain-contract.md` §22** still has no vocabulary rows for the
   Task 18 `Accounting.GeneralLedger.View` / `Accounting.TrialBalance.View` permissions,
   and §19.1's heading text (already recorded by the Task 18 acceptance record §9 item
   1). Binding-contract edits remain separately authorized work; the contract is not
   edited here.
4. **`docs/accounting/domain-contract.md` §31** and **`docs/open-questions.md`**
   OQ-25/OQ-43 rows state no Task 17C *status*, so they remain accurate; they were left
   unchanged to avoid rewriting OQ annotations or contract text during a status sync.
5. **`docs/tasks/task-17/task-17c-prompt.md`** is the received prompt **saved verbatim**
   (its own instruction "Do NOT self-declare final acceptance … until Owner/Reviewer
   acceptance occurs"). It is a historical authorization record, not a status claim, and
   is deliberately unchanged — its `READY FOR REVIEW` instruction governed the
   implementing agent, and the Owner/Reviewer acceptance has now occurred here.
6. **Dated history rows** in `docs/accounting/task-index.md` §9 and
   `docs/accounting/owner-decision-baseline.md` §10 that describe Task 17C as READY FOR
   REVIEW are **preserved as history** (§11 maintenance rules: keep dated evidence, do
   not erase historical records); the new acceptance row/entry records the current
   status and states explicitly that earlier dated statements are historical.

---

## Related records

- Owner-decision register (canonical): [`../../accounting/owner-decision-baseline.md`](../../accounting/owner-decision-baseline.md) — §2 Q1–Q22, §3 I-1…I-3, §5 D-1…D-13, §6 O-1…O-12, §10 version record
- Received Owner prompt (the decision source): [`./task-17c-prompt.md`](./task-17c-prompt.md)
- ADRs: [ADR-0033](../../adr/0033-account-identity-and-code-history.md) · [ADR-0034](../../adr/0034-posting-versus-aggregation-accounts.md) · [ADR-0035](../../adr/0035-account-code-structure-migration.md) · [ADR-0036](../../adr/0036-legal-reporting-architecture.md) · [ADR-0037](../../adr/0037-accounting-configuration-boundary.md) — all **Proposed**
- Open Questions: [OQ-25 and OQ-43](../../open-questions.md) — both **OPEN**
- Predecessor acceptances: [Task 17A acceptance record](./task-17a-acceptance-record.md) · [Task 17B acceptance record](./task-17b-acceptance-record.md) · [Task 18 acceptance record](../task-18/task-18-acceptance-record.md) (accepted reporting/read-surface baseline — General Ledger and Trial Balance, explicitly non-legal)
- Governance index: [`../../accounting/task-index.md`](../../accounting/task-index.md) header/§2/§4/§5/§9; [`STATE.md`](../../../STATE.md) §3/§7/§8/§9/§10
- Contract: [`../../accounting/domain-contract.md`](../../accounting/domain-contract.md) §31 (pointer addendum), §8/§9/§10/§11/§14/§15/§19/§25
- PRs: **#45** consolidation (merged `2565254`) · **#48** factual-drift correction (merged `7f8e3e8`) · **#44** Task 17B acceptance (merged `2892189`) · **#46** Task 18 implementation (merged `e774a1c`) · **#47** Task 18 acceptance (merged `40a3e0a`)

---

## Version record

- 2026-09-25 — **Task 17C — Accounting Decision Consolidation** created
  (DOCUMENTATION ONLY) on `arena/01a0d7c4-vardena`: Q1–Q22, I-1…I-3, D-1…D-13, O-1…O-12,
  ADR-0033…0037 (Proposed). Status **READY FOR REVIEW — NOT ACCEPTED**; merged by PR
  #45 (`2565254`).
- 2026-09-25 — **Governance review (documentation correction only)** on
  `arena/01a0d8b0-vardena`, PR #48 (`7f8e3e8`): six documentary accuracy defects
  corrected (§1 permission count 36 → 38, Q10 row, D-13 row, ADR-0033 §1 clause,
  ADR-0036 Context inventory, `task-index.md` §4 candidate row). No decision,
  invariant, discrepancy, open item, ADR status, OQ status or task status changed. Task
  17C stayed **READY FOR REVIEW — NOT ACCEPTED**.
- 2026-09-25 — **Task 17C acceptance sync (documentation/governance only)** on
  `arena/01a0da76-vardena` (base `7f8e3e8`, the merge of PR #48): Task 17C recorded as
  **ACCEPTED (2026-09-25)** with this acceptance record; `STATE.md` §3/§7/§8/§9/§10,
  `docs/accounting/task-index.md` header/§2/§9 and `owner-decision-baseline.md`
  header/§7/§10 synchronized; ADR-0033…0037 each record "Task 17C is accepted, but this
  ADR remains Proposed pending its separate adoption/implementation gate". **No
  decision, invariant, discrepancy or open item was altered; OQ-25/OQ-43 remain OPEN;
  Task 17 remains BLOCKED and NOT complete; no production code, schema, migration, API,
  permission, dependency, UI or test was touched.** Acceptance-sync PR: **#50**, head
  `1c62923605161c0f9177b9278b18c8dd01cc5869`, documentation-only (9 `.md` files), opened
  against `main` @ `7f8e3e8`; final acceptance/merge remains an owner/repository
  governance step.
