# Task 17C — Accounting Decision Consolidation (received task prompt)

- **Task title:** Task 17C — Accounting Decision Consolidation
- **Type:** DOCUMENTATION-ONLY PROMPT (received handoff, saved verbatim — the
  repository record of the Owner authorization and of the Owner decisions
  Q1–Q22 + the three Accounting invariants it carries)
- **Received:** 2026-09-25 (repository UTC+03:30 date convention)
- **Implementing session:** branch `arena/01a0d7c4-vardena`, base `b10e007`
  (merge of PR #43)
- **Companions:**
  [`docs/accounting/owner-decision-baseline.md`](../../accounting/owner-decision-baseline.md)
  (the consolidation register produced by this task),
  [ADR-0033](../../adr/0033-account-identity-and-code-history.md),
  [ADR-0034](../../adr/0034-posting-versus-aggregation-accounts.md),
  [ADR-0035](../../adr/0035-account-code-structure-migration.md),
  [ADR-0036](../../adr/0036-legal-reporting-architecture.md),
  [ADR-0037](../../adr/0037-accounting-configuration-boundary.md)

> **Why this file exists.** `STATE.md` §1 makes merged repository files — not
> chat — the official project memory, and §4 requires the Arena agent to store
> the received prompt in the task directory before implementation (the Task 17B
> precedent: [`task-17b-prompt.md`](./task-17b-prompt.md)). Saving the received
> text is what makes Q1–Q22 and the three invariants _Owner decisions with a
> repository source_ instead of an agent's interpretation.
>
> **Session note (not part of the received text).** §14 suggests the branch
> `arena/task-17c-accounting-decision-consolidation`. This Arena session is
> pinned to `arena/01a0d7c4-vardena`, which is also the convention every recent
> Accounting task actually used on this repository (PRs #39–#44:
> `arena/01a0d4d0-`, `arena/01a0d54c-`, `arena/01a0d55b-`, `arena/01a0d5a0-`,
> `arena/01a0d76b-vardena`). No other branch was created or pushed.

---

# Task 17C — Accounting Decision Consolidation

## Role

You are the Vardena Arena implementation/governance agent operating under the
repository's established governance rules.

Your role in this task is strictly:

- Repository analysis
- Documentation consolidation
- ADR creation/update
- OQ synchronization
- STATE/task-index synchronization where required
- Consistency validation

You are **NOT authorized to implement production functionality in this task**.

---

# 1. Objective

Consolidate the Owner-approved Accounting decisions Q1–Q22 and the newly approved
Accounting invariants into the Vardena repository as the authoritative
documentation baseline for future Accounting work.

This task exists to prevent future agents/tasks from re-interpreting these
decisions.

The result must establish a clear repository-backed contract for:

- Account identity
- Account hierarchy
- Posting vs Aggregation semantics
- Account code history
- Code migration
- Fiscal-year opening identity
- Historical reporting
- Account Statement / Account Overview
- Correction and immutability
- Configurable Accounting structure
- Dimensions
- Legal reporting architecture

---

# 2. Mandatory Repository-First Rule

Before changing anything:

Read the current `main` branch and inspect at minimum:

- `STATE.md`
- `docs/open-questions.md`
- `docs/accounting/domain-contract.md`
- `docs/accounting/task-index.md`
- `docs/reporting-strategy.md`
- `docs/tasks/task-17/task-17b-brief.md`
- `docs/tasks/task-17/task-17b-implementation-report.md`
- all relevant Accounting ADRs under `docs/adr/`
- `.vardena/agent-rules.md`
- `docs/adr/README.md`

Also inspect existing Account/Accounting implementation only to ensure the
documentation does not contradict the repository.

Repository is the sole source of truth.

If a claimed decision cannot be reconciled with the repository, do NOT silently
invent a resolution. Report it as a discrepancy.

---

# 3. Owner-Approved Decisions Q1–Q22

The following decisions were explicitly approved by the Owner during the
Accounting architecture decision process.

Treat these as Owner Decisions, not suggestions.

## Q1 — Number of Accounting Code Levels

Accounting code levels must NOT be hardcoded to exactly four.

The organization/user must be able to configure the number of levels within a
controlled Vardena-supported structure.

It must be configurable but not an unlimited arbitrary hierarchy.

---

## Q2 — Base Accounting Structure

Vardena provides a standard/base Accounting structure.

The organization can configure it.

Standard Control Roles exist, while organization-owned accounts are mapped to
those roles.

This is a hybrid model:

- Vardena-defined accounting/control semantics
- Organization-configurable account structure

---

## Q3 — Account Code Changes

Before an account is used, code changes may be allowed within the configured
structure.

After use, arbitrary code changes are NOT allowed.

Any structural change after use must follow the controlled migration mechanism
defined below.

Code structure constraints such as level digit lengths remain governed by the
configured Accounting structure.

---

## Q4 — Control Roles

Control Roles are standardized by Vardena.

Only roles required by active Accounting operations need to be mandatory.

Organizations map their own accounts to those standard roles.

---

## Q5 — Posting Eligibility

Default behavior:

- final/last configured level is postable
- higher levels are not postable by default

Accounting configuration may allow posting at another level.

However, posting must preserve Accounting integrity and must not create
parent/child double counting.

This decision must be reconciled with the Posting-vs-Aggregation invariant below.

---

## Q6 — Detail Accounts

Vardena must support both:

- tree-based Detail Accounts
- Floating Detail Accounts

The exact usage must be configurable.

---

## Q7 — Dimensions

Vardena must support a configurable general dimension model.

Examples:

- Cost Center
- Project
- Branch

The model must NOT become a giant EAV system or giant JSONB structure.

An account/dimension relationship may be:

- Required
- Optional
- Forbidden

depending on Accounting configuration.

---

## Q8 — Code Length

Vardena provides default code lengths.

At initial Accounting setup, the organization chooses the digit length for each
configured level.

Changing code length after transactions exist must be possible only through the
controlled licensed migration mechanism described below.

---

## Q9 — Legal Books

Legal books are implemented after Accounting Core.

Do not make Iranian statutory requirements hardcoded dependencies of the
Accounting Core.

---

## Q10 — Journal Book and General Ledger

Journal Book and General Ledger are independent reports.

They must not be collapsed into one report merely because they share underlying
Accounting data.

---

## Q11 — Language and Monetary Unit

Primary system language:

- Persian

Base monetary unit must be configurable, including:

- Rial
- Toman

If appropriate, Rial input may be displayed with Toman conversion.

Legal reporting requires separate handling through the Legal Profile/Adapter
architecture.

---

## Q12 — Correction Model

The Owner wants two correction behaviors depending on document lifecycle/status:

1. Internal/non-final documents may support controlled deletion/recreation
   subject to permissions and lifecycle rules.
2. Final/posted documents must follow immutable Accounting
   correction/reversal semantics.

Do NOT interpret this as permission to physically delete Final/Posted Accounting
history.

---

# 4. Additional Owner Decisions Q13–Q22

## Q13 — Final/Legal Document Deletion

Decision: C.

Final/legal documents must not be physically deleted.

Correction/reversal must preserve historical auditability.

Conceptually:

```text
Draft / non-final
    -> controlled edit/delete/recreate

Final / Posted
    -> immutable
    -> Correction / Reversal
```

Exact lifecycle implementation remains subject to the existing Accounting domain
contract.

---

## Q14 — Reporting Time Axes

Decision: D.

Use:

- `Document Date` for financial reporting
- `Posting Timestamp` for audit/event timing

Existing Accounting concepts such as:

- Fiscal Year
- Accounting Period
- Document Date
- Posting Timestamp

must remain distinct.

Do not replace one with another.

---

## Q15 — Account Performance / Account Statement

Decision: A.

Account Statement is the unified concept for account performance/turnover.

It includes at minimum:

- Opening
- Debit Turnover
- Credit Turnover
- Net
- Closing

It should support drill-down to underlying source documents.

Do not create two independent financial calculation engines for Account
Statement and Account Performance.

---

## Q16 — Account Overview

Decision: D.

Account Overview is:

- a more graphical/easier presentation
- using the same underlying read source
- using the same financial calculations
- not a second independent accounting calculation engine

Conceptually:

```text
Ledger
   |
   v
Accounting Read Source
   |--------------------|
   v                    v
Account Statement   Account Overview
```

Account Overview may provide:

- KPIs
- charts
- summaries
- drill-down

but must derive from the same authoritative Accounting read source.

---

## Q17 — Vardena Flexibility Model

Decision: D.

Vardena Accounting Core must remain standardized, safe, and integrity-preserving.

A Configuration Layer provides high flexibility.

Configuration must NOT be allowed to violate fundamental Accounting invariants,
security, auditability, tenant isolation, or data integrity.

Principle:

> High configurability does not mean unrestricted configurability.

---

## Q18 — Historical Account Codes

Decision: D.

Historical reports must use the account code valid during the relevant
historical period/date.

The system must also retain/display the mapping between historical and current
codes where useful.

Example:

```text
1404:
1000 - زمین

1406:
1100 - زمین
```

A 1404 report should default to:

```text
1000 - زمین
```

while allowing the current-code mapping to be understood.

---

## Q19 — Code Migration

Decision: D.

Changing Accounting code structure after transactions exist must be performed
through a dedicated Vardena-controlled service:

> Accounting Code Structure Migration Service

This service is a controlled/licensed capability.

It must not be implemented as a normal user setting.

Conceptual flow:

```text
Request
  ->
Preflight Analysis
  ->
Impact Report
  ->
Dry Run
  ->
Migration Plan
  ->
Owner Approval
  ->
License Validation
  ->
Recovery/Backup Point
  ->
Migration
  ->
Reconciliation
  ->
Audit Report
```

The migration must be auditable.

---

## Q20 — Changing Number of Levels

Decision: D.

Changing the number of Accounting code levels is NOT part of the current product
capability.

Do not implement it now.

The architecture should not unnecessarily prevent future analysis, but no current
feature, migration flow, or UI for changing level count should be added.

Current supported migration scope is focused on controlled code-length/structure
changes within the approved model.

---

## Q21 — Account Deletion

Decision: D.

If an account has no historical transaction usage and no other blocking
references, deletion may be allowed.

If an account has historical Accounting usage, it must not be physically deleted.

It should be deactivated/inactivated instead.

Important:

Zero current balance does NOT mean the account is safe to delete.

Example:

```text
+100M
-100M
= 0
```

still represents historical usage.

Deletion rules must preserve historical Accounting integrity.

---

## Q22 — Legal Architecture

Decision: B.

Accounting Core must remain independent from jurisdiction-specific legal
requirements.

Use:

```text
Accounting Core
      |
      v
Legal Adapter / Legal Profile
      |
      +--> Iran Legal Profile
      |
      +--> Future jurisdictions/profiles
```

Do not hardcode Iranian statutory report semantics directly into the Accounting
Core.

Actual Iranian legal requirements must later be validated against authoritative
current sources before implementation of statutory/legal features.

---

# 5. Mandatory Accounting Invariants

The following three invariants were explicitly approved after architecture
review.

## Invariant 1 — Account Identity

`Account.id` is the permanent Accounting identity.

`Account.code` is a business/display identifier and is NOT the permanent
identity.

Therefore:

- Ledger references Account identity
- Opening logic references Account identity
- Historical reporting resolves code by historical validity
- integrations must not treat code as permanent identity unless explicitly
  designed as a controlled business reference

Conceptually:

```text
Account.id
   |
   +-- Current Code
   |
   +-- Historical Code(s)
```

---

# 6. Invariant 2 — Posting Account XOR Aggregation Account

An Account Node must have exactly one semantic role at a given time:

```text
POSTING
OR
AGGREGATION
```

Never both simultaneously.

### POSTING

A Posting Account is a valid destination for ledger posting.

### AGGREGATION

An Aggregation Account derives its balance/turnover from its child structure and
is not independently posted to.

The purpose is to prevent ambiguity and double counting.

Example:

```text
Accounts Receivable
   |
   +-- Customer A
   +-- Customer B
   +-- Customer C
```

If the parent is an Aggregation Account, its financial result is derived from
children.

If a higher-level node is explicitly configured as a Posting Account, its
semantics must not simultaneously treat its own postings and child postings as
one undifferentiated aggregation.

The exact validation rules must be made explicit in future implementation
contracts.

---

# 7. Invariant 3 — Code Migration Must Not Rewrite Economic Ledger History

Changing Account Code must NOT rewrite the economic identity of historical
Ledger Entries.

The migration model must preserve:

```text
Account.id
```

and change only the code representation/history.

Conceptually:

```text
Ledger Entry
     |
     +--> Account.id = A123
                     |
                     +--> 1000 [historical]
                     |
                     +--> 1100 [current]
```

Migration must maintain a reconstructable historical mapping.

It must not mutate historical economic meaning merely to make old Ledger rows
display a new code.

---

# 8. Historical and Legal Reporting Rule

Historical reporting should resolve the Account Code using the code valid for the
relevant historical context.

Conceptually:

```text
Report Date
    |
    v
Account.id
    |
    v
Historical Code Resolution
    |
    v
Report
```

Legal reporting must use the same Account identity model.

Legal Profiles must NOT use Account Code as permanent identity.

Do not implement Legal Books in this task.

---

# 9. Required ADR Work

Create or update the minimum necessary ADRs to make the above decisions
repository-authoritative.

Preferred separation:

### ADR A — Account Identity & Code History

Must document:

- Account.id as permanent identity
- code as business identifier
- code history
- historical resolution
- opening implications

### ADR B — Posting vs Aggregation

Must document:

- POSTING XOR AGGREGATION
- double-counting prevention
- default final-level posting
- configurable posting eligibility
- prohibition of simultaneous semantics

### ADR C — Account Code Structure Migration

Must document:

- controlled Vardena service
- licensed operation
- preflight/dry-run/impact analysis
- approval
- reconciliation
- auditability
- no rewriting of economic Ledger history
- current exclusion of level-count changes

### ADR D — Legal Reporting Architecture

Create/update only if the repository does not already have an authoritative
equivalent.

Must document:

```text
Accounting Core
      |
Legal Adapter/Profile
```

and the separation between generic accounting semantics and jurisdiction-specific
legal requirements.

Do NOT duplicate an existing canonical ADR unnecessarily.

---

# 10. OQ-25 / OQ-43 Synchronization

Update `docs/open-questions.md` only to the extent supported by the decisions
above.

Do NOT falsely mark every aspect of OQ-25 or OQ-43 as closed.

Distinguish:

```text
OWNER DECIDED
```

from:

```text
IMPLEMENTATION DETAIL OPEN
```

and:

```text
LEGAL VALIDATION REQUIRED
```

In particular:

### OQ-25

The following are now Owner Decisions:

- configurable level count within supported structure
- base Vardena structure + organization configuration
- Control Role approach
- posting default/configuration
- tree + floating detail
- configurable dimensions
- Account.id identity
- code history
- historical code reporting
- controlled code migration
- current exclusion of level-count migration
- account deletion/deactivation policy

Remaining implementation-level details must stay open where not explicitly
decided.

### OQ-43

The following is decided:

- Legal Adapter/Profile architecture

But legal facts such as current Iranian statutory layouts, tax rules, retention
requirements, electronic-book requirements, etc. remain subject to authoritative
legal/accounting validation.

Do NOT invent or claim legal closure.

---

# 11. Task 17C Scope Restrictions

This task is DOCUMENTATION ONLY.

Absolutely prohibited:

- production code changes
- API changes
- DTO changes
- database schema changes
- Prisma changes
- migrations
- seed changes
- permission implementation
- report implementation
- UI implementation
- new dependencies
- refactoring
- performance work
- changing existing Accounting behavior
- changing Task 17B implementation
- implementing Code Migration Service
- implementing Classification
- implementing Trial Balance
- implementing Legal Books

Do not create placeholder production code.

---

# 12. Required Documentation Validation

After documentation changes:

```bash
git diff --check
```

Run appropriate lightweight documentation validation if available.

Also inspect the final diff and verify:

- no production files changed
- no schema/migration files changed
- no tests changed
- no dependency files changed
- no generated artifacts changed

If any such change appears, revert it before finalizing unless it is explicitly
required by repository governance documentation.

---

# 13. STATE / Task Index

Synchronize `STATE.md` and/or `docs/accounting/task-index.md` only if the current
repository explicitly requires the new decision/ADR state to be reflected there.

Do not rewrite unrelated status.

Do not claim Task 17 itself is complete.

Task 17B remains accepted as previously established.

Task 17 overall remains governed by its existing scope/open questions.

---

# 14. Git / Branch / Commit

Create a dedicated branch according to repository convention.

Suggested branch:

```text
arena/task-17c-accounting-decision-consolidation
```

Suggested commit:

```text
docs(accounting): consolidate owner decisions
```

Create the required PR.

Do NOT self-declare final acceptance.

The implementation/documentation status must remain:

```text
READY FOR REVIEW
```

until Owner/Reviewer acceptance occurs according to Vardena governance.

---

# 15. Final Report

At the end report:

1. Branch name
2. Commit SHA
3. PR number
4. Files changed
5. ADRs created/updated
6. OQ-25 synchronization
7. OQ-43 synchronization
8. STATE/task-index synchronization
9. Validation performed
10. Confirmation that:

- no production code changed
- no schema/migration changed
- no tests changed
- no API changed
- no dependencies changed

11. Any discrepancy discovered between the Owner Decisions and the current
    repository
12. Any remaining implementation-level questions

Explicitly state:

```text
Status: READY FOR REVIEW
Production implementation: NONE
Schema/migration changes: NONE
```

Do not mark the task ACCEPTED yourself.

---

## Version record

- 2026-09-25 — saved before any file change (Task 17C, DOCUMENTATION ONLY) on
  `arena/01a0d7c4-vardena`. This file authorizes exactly the documentation
  consolidation described above. It resolves no registered Open Question by
  itself: OQ-25 and OQ-43 stay in the Open table of
  [`docs/open-questions.md`](../../open-questions.md), with the Owner-decided
  parts annotated there and in
  [`docs/accounting/owner-decision-baseline.md`](../../accounting/owner-decision-baseline.md).
