# Task 28 — Owner Decision Closure & MVP Implementation Selection Gate

## 0. Task Identity

**Task:** 28
**Title:** Owner Decision Closure & MVP Implementation Selection Gate
**Type:** Governance / Owner Decision / MVP Dependency Gate / Implementation Selection
**Status:** READY FOR IMPLEMENTATION
**Target branch:** `main`

---

# 1. Mission

Task 28 is a **decision and governance gate** following the completion of Task 27.

The purpose is to formally reconcile and record the remaining Owner Decisions identified by Task 27 and determine the exact next implementation gate for the Vardena MVP.

This task MUST NOT implement production capabilities.

The result of Task 28 must be a clear, evidence-backed answer to:

> **What is the next implementation task that is actually authorized and dependency-ready after the current Vardena state?**

The task must distinguish between:

* technical implementation readiness
* domain/accounting decision readiness
* owner acceptance
* roadmap intent
* actual authorization to implement

Do not assume that the next numbered task is automatically the next implementation task.

---

# 2. Mandatory Starting Point

Before doing any work:

1. Fetch latest remote state.
2. Checkout/update `main`.
3. Verify that Task 27 / PR #73 is merged.
4. Record:

   * current `main` HEAD SHA
   * PR #73 merge SHA
   * Task 27 status
5. Read the complete Task 27 output from `main`.

Expected Task 27 source:

```text
docs/tasks/task-27/
├── brief.md
├── prompt.md
├── main-based-reconciliation-report.md
├── task-acceptance-matrix.md
├── adr-reconciliation.md
├── oq-reconciliation.md
├── documentation-drift-report.md
├── owner-decision-pack.md
└── implementation-report.md
```

Also inspect:

```text
STATE.md
docs/roadmap/backend-mvp-roadmap.md
```

Do not work from an old Arena branch.

---

# 3. Hard Scope Boundary

## Allowed

Task 28 may:

* inspect repository state
* inspect Task 27 evidence
* inspect code
* inspect tests
* inspect migrations
* inspect ADRs
* inspect OQs
* inspect roadmap
* inspect STATE.md
* inspect previous task reports
* inspect Git history
* inspect merged PRs
* reconcile Owner Decisions
* document decisions already explicitly supplied by the Owner
* prepare decision records
* prepare implementation-gate specifications
* update governance documentation
* update roadmap documentation where justified
* prepare the next implementation task specification

## Forbidden

Task 28 MUST NOT:

* implement production code
* modify production behavior
* add API endpoints
* add Prisma models
* modify Prisma schema
* add migrations
* seed Base Chart content
* create accounting accounts
* implement accounting posting
* modify permissions
* modify guards
* modify organization isolation
* modify authentication
* modify inventory behavior
* modify document behavior
* modify workflow behavior
* promote ADRs without explicit Owner decision
* close OQs without explicit Owner decision
* accept Task 28 automatically
* implement the selected next task

If an implementation issue is discovered, document it and create a future implementation finding.

---

# 4. Task 27 Owner Decision Pack

Start from the Owner Decision Pack produced by Task 27.

Expected decision areas include:

* OD-27-01 — formal acceptance/reconciliation of merged work
* OD-27-02 — Base Chart Content / OQ-25
* OD-27-03 — next implementation direction
* OD-27-04 — ADR status / promotion decisions

Read the actual Task 27 document and use its exact IDs rather than inventing new ones if they already exist.

---

# 5. Owner Decision Rule

The Agent MUST NOT fabricate Owner decisions.

There are only three valid states:

### DECIDED

An explicit decision already exists in the repository or has been explicitly provided by the Owner.

### PENDING OWNER DECISION

The decision has not been explicitly made.

### NOT APPLICABLE

The decision is no longer required because an explicit later decision superseded it.

Do not transform technical preference into Owner approval.

---

# 6. Required Decision Matrix

Create:

```text
docs/tasks/task-28/owner-decision-matrix.md
```

Use:

| Decision ID | Topic | Current State | Evidence | Decision Required? | Owner Decision | Consequence |
| ----------- | ----- | ------------- | -------- | ------------------ | -------------- | ----------- |

Every decision must have repository evidence.

---

# 7. Base Chart / OQ-25 Gate

This is a critical part of Task 28.

Reconcile the current state of:

**OQ-25**

and the Base Chart design.

Verify the following invariants:

### Template identity ≠ Ledger identity

### Adoption = Copy

### Posting = Leaf-only

### Aggregation = Read-time

Then distinguish:

1. Base Chart mechanism
2. Base Chart template
3. Base Chart content
4. Organization adoption
5. Ledger accounts
6. Posting behavior

Do NOT assume that because the Base Chart mechanism exists, the Base Chart content is approved.

---

# 8. Required OQ-25 Decision Space

Prepare a clear Owner decision record for OQ-25.

The record must identify:

* what remains undecided
* why the decision is needed
* what implementation depends on it
* whether the decision affects MVP
* what becomes unblocked after the decision
* whether the decision requires accounting/domain input

Do not invent chart accounts.

Do not create sample accounting content as production data.

Do not close OQ-25 unless explicit Owner acceptance exists.

---

# 9. ADR Reconciliation

Review the ADR status identified by Task 27.

For each relevant ADR determine:

* current status
* implementation evidence
* Owner acceptance
* whether promotion is required
* whether it blocks the next implementation gate

Use:

```text
PROPOSED
ACCEPTED
SUPERSEDED
HISTORICAL
PENDING OWNER DECISION
```

Do not promote an ADR automatically.

If an ADR has already been explicitly accepted, record the existing acceptance evidence.

---

# 10. MVP Dependency Analysis

Now inspect the actual MVP dependency graph.

The purpose is NOT to create a new roadmap.

The purpose is to determine:

> Which implementation capability is currently dependency-ready and authorized after the Owner decisions?

Inspect at minimum:

* Identity
* Users/RBAC
* Organization/Master Data
* Inventory
* Documents
* Workflow
* Accounting
* Base Chart
* Sales
* Inventory → Accounting integration
* Sales → Accounting integration
* Reporting requirements
* Audit/security requirements

Remember:

* Treasury is OUTSIDE MVP.
* Purchasing is OUTSIDE MVP.
* Purchasing → Accounting is OUTSIDE MVP.
* Purchasing reports are OUTSIDE MVP.

Do not reintroduce them.

---

# 11. Capability Readiness Matrix

Create:

```text
docs/tasks/task-28/mvp-implementation-readiness-matrix.md
```

Use:

| Capability | Foundation Exists | Domain Decision Complete | ADR Ready | OQ Blocker | Security Ready | Owner Authorization | Implementation Ready |
| ---------- | ----------------- | ------------------------ | --------- | ---------- | -------------- | ------------------- | -------------------- |

Use factual statuses only.

Allowed values:

* YES
* NO
* PARTIAL
* N/A
* PENDING OWNER DECISION

Do not score or rank capabilities.

---

# 12. Determine the Next Implementation Gate

Identify the next implementation gate using these mandatory conditions:

A candidate may be considered implementation-ready only if:

1. required architecture exists
2. required domain decisions exist
3. required ADRs are accepted or explicitly authorized
4. no blocking OQ remains
5. security dependencies are satisfied
6. MVP scope includes it
7. owner authorization exists
8. implementation boundaries are clear

If any of these are missing:

> The candidate is NOT implementation-ready.

Do not bypass the missing dependency.

---

# 13. Do Not Automatically Choose Base Chart Content

Base Chart is a special case.

If OQ-25 remains unresolved:

Do NOT create:

* account groups
* general accounts
* subsidiary accounts
* detail accounts
* default account codes
* account hierarchy seed
* accounting templates

Instead state:

> Base Chart implementation mechanism exists, but Base Chart content remains decision-blocked by OQ-25.

Only proceed to Base Chart content implementation if explicit Owner decision authorizes the content.

---

# 14. Next Implementation Task Specification

If a next implementation gate is fully authorized, create:

```text
docs/tasks/task-28/next-implementation-gate.md
```

It must contain:

```text
# Next Implementation Gate

## 1. Selected Capability

## 2. Why It Is Dependency-Ready

## 3. Existing Foundation

## 4. Required Owner Decisions

## 5. Accepted ADRs

## 6. Resolved OQs

## 7. Remaining OQs

## 8. Security Constraints

## 9. Architecture Constraints

## 10. Explicit Non-Goals

## 11. Required Implementation Boundaries

## 12. Required Verification

## 13. Definition of Ready

## 14. Definition of Done

## 15. Expected Next Task
```

This is a specification only.

Do NOT implement it.

---

# 15. If No Implementation Gate Is Ready

If Owner decisions are incomplete and no capability is fully authorized, do NOT manufacture an implementation task.

Instead produce:

```text
IMPLEMENTATION BLOCKED — OWNER DECISION REQUIRED
```

and clearly identify:

* blocking decision
* dependency
* evidence
* what decision unlocks it

---

# 16. Expected Candidate Areas

The Agent should investigate, but NOT assume, the following candidate areas:

### Candidate A

Base Chart Content / Governance

### Candidate B

Account Lifecycle / Code History

### Candidate C

Control Roles / Accounting Detail Dimensions

### Candidate D

Accounting corrections / year transition

### Candidate E

Posting Rules / Account Mapping

### Candidate F

Inventory → Accounting integration

### Candidate G

Sales capability required for MVP

### Candidate H

Sales → Accounting integration

These are investigation candidates only.

Do not select one based solely on roadmap order.

---

# 17. Accounting Constraints

Preserve all previously accepted accounting principles:

* System Group benchmark
* Group → General → Subsidiary
* configurable floating Details
* Manual vs System documents
* Temporary / Final
* no generic void
* Fiscal Open / Closed / Sealed
* branch / financial-area M:N
* lowest account level posting
* parent-level read-time turnover aggregation
* Inventory → Accounting through defined integration contract/event/outbox
* FaraPayam only through adapter

Do not modify these decisions.

If an unresolved Owner Decision conflicts with one of these, report it rather than resolving it automatically.

---

# 18. Security Constraints

Task 28 must preserve the Task 26 / ODR-3 result.

No new implementation may be authorized if it would require weakening:

* principal-bound organization scope
* fail-closed behavior
* permission-first authorization
* deployment organization pin behavior
* cross-organization isolation

Do not introduce wildcard permission or hidden administrator bypass.

---

# 19. MVP Scope Constraints

The following remain OUTSIDE MVP:

```text
Treasury
Purchasing
Purchasing → Accounting
Purchasing Reports
```

Do not select these as the next implementation task.

---

# 20. Required Owner Decision Record

Create:

```text
docs/tasks/task-28/owner-decision-record.md
```

Structure:

```text
# Task 28 — Owner Decision Record

## Decision Summary

## Decision 1 — Base Chart / OQ-25

### Current Evidence
### Decision Required
### Owner Decision
### Consequence

## Decision 2 — Next Implementation Direction

### Current Evidence
### Decision Required
### Owner Decision
### Consequence

## Decision 3 — ADR Status

### Current Evidence
### Decision Required
### Owner Decision
### Consequence

## Decision 4 — Other Blocking Decisions

### Current Evidence
### Decision Required
### Owner Decision
### Consequence
```

If no decision has been provided yet, write:

`PENDING OWNER DECISION`

Do not invent the answer.

---

# 21. Required Roadmap Reconciliation

If Task 28 decisions materially affect:

```text
docs/roadmap/backend-mvp-roadmap.md
```

update only the affected sections.

The roadmap must not:

* self-accept tasks
* close OQs
* promote ADRs
* authorize implementation
* claim capability completion without evidence

Roadmap remains dependency/sequence documentation.

---

# 22. Required STATE.md Reconciliation

Update `STATE.md` only for decisions explicitly established by the Owner or existing repository evidence.

Do not add speculative future decisions.

Clearly distinguish:

* historical state
* current state
* pending decision
* selected next gate

---

# 23. Required Output Files

Create:

```text
docs/tasks/task-28/
├── brief.md
├── prompt.md
├── owner-decision-matrix.md
├── owner-decision-record.md
├── mvp-implementation-readiness-matrix.md
├── next-implementation-gate.md
├── adr-reconciliation.md
├── oq-reconciliation.md
└── implementation-report.md
```

Update only when necessary:

```text
STATE.md
docs/roadmap/backend-mvp-roadmap.md
```

---

# 24. Required Acceptance Matrix

Create:

```text
docs/tasks/task-28/task-acceptance-matrix.md
```

Use:

| AC    | Requirement                                             | Evidence         | Status |
| ----- | ------------------------------------------------------- | ---------------- | ------ |
| AC-01 | Latest main verified                                    | SHA              |        |
| AC-02 | Task 27 merge verified                                  | PR/SHA           |        |
| AC-03 | Task 27 findings reconciled                             | report           |        |
| AC-04 | Owner decisions identified                              | matrix           |        |
| AC-05 | No Owner decision fabricated                            | evidence         |        |
| AC-06 | OQ-25 explicitly reconciled                             | OQ report        |        |
| AC-07 | ADR statuses reconciled                                 | ADR report       |        |
| AC-08 | MVP dependencies audited                                | readiness matrix |        |
| AC-09 | Treasury/Purchasing remain outside MVP                  | scope evidence   |        |
| AC-10 | Next implementation gate determined from evidence       | gate document    |        |
| AC-11 | Implementation authorization status explicitly recorded | gate             |        |
| AC-12 | No production code changed                              | git diff         |        |
| AC-13 | No schema/migration changed                             | git diff         |        |
| AC-14 | No permission/guard changes                             | git diff         |        |
| AC-15 | STATE/roadmap reconciled where necessary                | diff             |        |
| AC-16 | Owner decision record prepared                          | decision record  |        |
| AC-17 | Task 28 not self-accepted                               | report           |        |

---

# 25. Verification

Do not run expensive local full E2E unless specifically required.

Prefer:

* repository inspection
* targeted checks
* existing GitHub CI

If CI is triggered by the PR, record:

* workflow
* run ID
* commit SHA
* backend result
* frontend result
* relevant test result

Do not invent CI evidence.

---

# 26. Scope Safety Check

Before finalizing:

```bash
git diff main...HEAD
```

or the equivalent repository comparison must demonstrate:

### Allowed

* documentation
* governance
* task reports
* owner decision records
* roadmap/state reconciliation

### Forbidden

* `apps/backend/**` production implementation
* Prisma schema
* migrations
* API behavior
* permission changes
* guard changes
* database behavior
* frontend production behavior

If forbidden changes exist:

STOP and report them.

---

# 27. Final Decision Logic

Task 28 must finish with exactly one of these states:

### READY FOR IMPLEMENTATION

A specific next implementation gate has all required Owner decisions and dependencies.

### OWNER DECISION REQUIRED

A genuine decision remains before implementation can safely begin.

### IMPLEMENTATION BLOCKED

A technical/security/dependency blocker prevents the next implementation gate.

Do not use:

* ACCEPTED
* COMPLETE

unless separately established by explicit Owner acceptance.

---

# 28. Final Report

Create:

```text
docs/tasks/task-28/implementation-report.md
```

Use:

```text
# Task 28 — Implementation Report

## Status

READY FOR REVIEW — NOT ACCEPTED

## Main SHA

<sha>

## Task 27 Verification

<summary>

## Owner Decisions

<summary>

## OQ-25

<status>

## ADR Status

<summary>

## MVP Dependency State

<summary>

## Next Implementation Gate

<summary>

## Authorization State

<summary>

## Remaining Blockers

<summary>

## Files Added

<list>

## Files Updated

<list>

## Production Code Changes

NONE

## Schema / Migration Changes

NONE

## Permission Changes

NONE

## Architecture Changes

NONE

## CI Evidence

<evidence>

## Final Recommendation

<summary>

## Acceptance

Task 28 is READY FOR REVIEW — NOT ACCEPTED.
Owner review and explicit acceptance are required.
```

---

# 29. Critical Final Rule

Do not implement the next task.

Task 28 exists specifically to establish:

> **What should be implemented next, why it is ready, what decisions authorize it, and what constraints must govern its implementation.**

The actual implementation begins only in the next task after explicit Owner acceptance of the Task 28 gate.

Final status:

> **Task 28 — READY FOR REVIEW — NOT ACCEPTED**
