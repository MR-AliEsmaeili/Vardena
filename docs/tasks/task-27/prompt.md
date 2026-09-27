# Task 27 — Prompt (Verbatim)

```markdown
# Task 27 — Main Governance Reconciliation & MVP Gate

## 0. Task Identity

**Task:** 27
**Title:** Main Governance Reconciliation & MVP Gate
**Type:** Governance / Repository Audit / Documentation Reconciliation / MVP Readiness Gate
**Status:** READY FOR IMPLEMENTATION
**Target branch:** `main`

---

# 1. Mission

Perform a **main-based governance reconciliation and MVP readiness audit** after the merge of Task 26 / PR #71.

The objective is to establish an accurate, evidence-backed picture of the repository as it exists **today on `main`**, reconcile documentation with actual implementation, identify remaining governance/security/documentation inconsistencies, and produce an owner decision pack for the next implementation stage.

This task is **NOT a feature implementation task**.

The primary source of truth is the actual repository state on `main`.

Historical task reports, roadmap statements, ADRs, OQ documents, STATE.md, and previous agent reports are claims that must be reconciled against the current repository.

---

# 2. Mandatory Starting Point

Before doing anything else:

1. Fetch the latest remote state.
2. Checkout/update `main`.
3. Verify that `main` contains the merged Task 26 / PR #71.
4. Record:

   * current `main` HEAD SHA
   * Task 26 merge commit SHA
   * PR #71 number
   * relevant parent/base SHA
5. Do NOT audit an old local branch or stale checkout.

Expected Task 26 merge evidence:

* PR: `#71`
* Task: `Task 26 — complete ODR-3 organization read scope`
* Merge commit:
  `e7fe80d04620170733ad9672d991ffd576607a5a`

If the current repository differs from this expected state, report the actual state rather than assuming the expected SHA is present.

---

# 3. Hard Scope Boundary

## 3.1 Allowed

This task may:

* inspect source code
* inspect tests
* inspect migrations
* inspect permissions
* inspect guards
* inspect module registration
* inspect CI configuration
* inspect Git history
* inspect merged PRs
* inspect task documents
* inspect ADRs
* inspect OQs
* inspect STATE.md
* inspect roadmap documents
* inspect security documentation
* create/update governance and documentation artifacts specifically required by Task 27
* correct factually stale documentation
* create reconciliation reports
* create owner decision records/packs
* identify blockers and dependencies
* recommend what the next implementation gate should investigate

## 3.2 Forbidden

Do NOT:

* implement new business capabilities
* add new API endpoints
* modify existing production behavior
* add migrations
* modify Prisma schema
* modify database structure
* add permissions
* change permission semantics
* add/change guards
* change authorization architecture
* add organization-scope behavior
* change authentication
* change accounting behavior
* change inventory behavior
* implement Base Chart content
* seed accounting data
* close OQs
* promote ADRs
* invent Owner Decisions
* accept tasks
* mark tasks as Accepted without an existing explicit owner acceptance record
* introduce new architecture
* perform drive-by refactoring
* modify tests merely to make the repository appear compliant
* add production code under the justification of "cleanup"
* silently rewrite historical records

If an implementation defect is discovered, **do not fix it in Task 27** unless it is strictly a documentation/comment-only factual correction explicitly allowed by this task.

Record the defect and classify it as requiring a future implementation/security task.

---

# 4. Core Question

Answer this question using repository evidence:

> **After Task 26 has been merged, does `main` now represent a coherent, internally consistent, security-aligned, documentation-aligned state from which the next Vardena MVP implementation task can safely be selected?**

The answer must be evidence-based.

Do not infer correctness merely from task reports.

---

# 5. Required Audit Areas

## A. Main / Git State

Verify and document:

* current `main` HEAD
* recent merge history
* Task 23 merge
* Task 24 merge
* Task 25 merge
* Task 26 merge
* Bootstrap System Administrator PR #64
* roadmap/dependency PR #69
* PR #70 / Task 25
* PR #71 / Task 26

For each relevant task/PR, record:

| Item                     | Required Evidence  |
| ------------------------ | ------------------ |
| Task/PR                  | exact ID           |
| Status                   | open/closed/merged |
| Merge SHA                | exact SHA          |
| Current presence on main | yes/no             |
| Relevant files           | exact paths        |
| Acceptance evidence      | exact source       |
| Remaining caveats        | explicit           |

Distinguish:

* implementation merged
* reviewed
* approved
* owner accepted
* documentation recorded

These are NOT interchangeable.

---

# 6. Task 26 / ODR-3 Security Reconciliation

Task 26 was specifically intended to remediate Task 25 SEC-01.

Audit the actual implementation.

## Expected historical issue

Task 25 identified:

**SEC-01 — CRITICAL**

Documentation claimed every organization-scoped read/write passes through:

`OrganizationsService.assertOrganizationInScope`

but the audit found:

* 28 `list*` surfaces
* 9 `get*` surfaces
* total: **37 read surfaces**

that did not satisfy the documented organization-scope invariant.

Task 26 was created to remediate this.

---

## Required verification

Do NOT simply trust the Task 26 report.

Search the current `main` source tree and verify the 37-surface inventory against actual code.

For every one of the 37 surfaces, record:

* module
* file path
* class
* method
* list/get category
* permission check
* organization-scope check
* exact scope mechanism
* test coverage
* current status

Use a table such as:

| # | Module | File | Method | Type | Permission-first | Org scope enforced | Test evidence | Status |
| - | ------ | ---- | ------ | ---- | ---------------- | ------------------ | ------------- | ------ |

The exact implementation evidence must be cited using repository paths and symbols.

---

# 7. Permission-First Ordering

For the audited organization-scoped read surfaces, verify that authorization ordering remains correct.

The intended invariant is:

> Permission must be established before organization-scoped resource access is authorized.

Verify that the implementation does not accidentally turn organization membership into an authorization bypass.

Check for:

* permission checks
* membership checks
* `assertOrganizationInScope`
* principal-bound organization context
* deployment pin behavior
* administrator behavior
* cross-organization behavior
* failure/deny paths

If ordering differs between surfaces, record the exact discrepancy.

Do not redesign authorization in this task.

---

# 8. ODR-3 Principal-Bound Organization Scope

Verify the actual current behavior against the ODR-3 principle:

> Organization isolation is principal-bound and fail-closed.

Audit for:

* organization context
* principal identity
* membership checks
* deployment organization pin
* explicit organization IDs supplied by callers
* list queries
* get queries
* admin paths
* system/bootstrap paths

Specifically verify that there is no hidden path equivalent to:

> "has permission → therefore may read any organization"

Also verify there is no accidental wildcard organization access.

If such a path exists, report it as a finding.

Do NOT fix it in Task 27.

---

# 9. Task 24 / F-3 Documentation Reconciliation

Task 25 identified another documentation mismatch:

**SEC-02 — HIGH**

Task 24 documentation claimed that there was no global `APP_GUARD`, while the repository actually contained:

`organization.module.ts`

with:

`APP_GUARD`

registered for:

`DeploymentOrganizationScopeGuard`

Audit current `main`.

Determine:

1. Does the global guard still exist?
2. Is it actually registered?
3. What is its current role?
4. Does current documentation describe it accurately?
5. Are any roadmap/future-candidate documents still based on the old claim?

Search the repository for stale references.

Do not remove the guard or change its behavior.

Only reconcile documentation.

---

# 10. Task 25 Reconciliation

Audit the Task 25 outputs against current `main`.

Relevant files include:

```text
docs/tasks/task-25/main-based-governance-audit-report.md
docs/tasks/task-25/implementation-acceptance-matrix.md
docs/tasks/task-25/adr-reconciliation.md
docs/tasks/task-25/oq-reconciliation.md
docs/tasks/task-25/documentation-drift-report.md
docs/tasks/task-25/owner-decision-pack.md
docs/tasks/task-25/implementation-report.md
STATE.md
```

For each major Task 25 finding determine:

* still true
* resolved by Task 26
* documentation-only historical finding
* superseded
* still open
* requires owner decision
* requires future implementation

Do NOT rewrite history.

Historical findings must remain historically accurate.

If a finding has been resolved later, add a clear reconciliation statement rather than pretending it never existed.

---

# 11. Task 23 / Base Chart Reconciliation

Audit the current Base Chart mechanism.

Important invariants:

### Template identity ≠ Ledger identity

### Adoption = Copy

### Posting = Leaf-only

### Aggregation = Read-time

Verify that Task 23 implemented the mechanism corresponding to these invariants.

Then separately verify whether Base Chart **content** has actually been approved/implemented.

Do NOT confuse:

* Base Chart mechanism
* Base Chart template/content
* organization adoption
* ledger accounts

Specifically search for:

* seed data
* default chart entries
* hardcoded account hierarchy
* bootstrap chart content
* migrations inserting Base Chart account content

If Base Chart content has not been explicitly approved, do not create or infer it.

OQ-25 must not be closed by this task.

If OQ-25 remains open, document it explicitly as an owner/accounting decision dependency.

---

# 12. OQ Reconciliation

Audit the current OQ inventory.

Use the repository's actual OQ documents as the source.

For every relevant OQ determine:

* current status
* evidence
* whether implementation depends on it
* whether it is decision-only
* whether it blocks the next implementation gate
* whether documentation is stale

Do NOT close an OQ.

Do NOT change an OQ from OPEN to RESOLVED merely because code exists.

Use explicit existing acceptance/decision evidence only.

Pay special attention to:

* OQ-25
* OQ-39
* OQ-42
* any accounting OQs
* any remaining MVP-gating OQs
* any security/OAuth/identity OQs relevant to the next gate

---

# 13. ADR Reconciliation

Audit ADRs against current implementation.

For every ADR relevant to Tasks 23–26 and the next implementation stage, classify:

* Proposed
* Accepted
* Superseded
* Historical
* Missing evidence
* Documentation drift

Verify:

* implementation matches ADR
* ADR status matches repository evidence
* task acceptance has not been incorrectly converted into ADR acceptance
* proposed ADRs are not silently promoted

Do NOT promote ADRs.

If an ADR is stale, document the mismatch.

---

# 14. STATE.md Reconciliation

Treat `STATE.md` as a current project state document, not as an immutable historical log.

Audit for stale statements concerning:

* Task 19
* Task 23
* Task 24
* Task 25
* Task 26
* ODR-3
* F-2
* F-3
* Base Chart
* Bootstrap System Administrator
* Treasury
* Purchasing
* MVP status
* remaining governance blockers

Especially search for statements implying that the old Task 24 F-2 list-scope issue is still unresolved if Task 26 actually resolved it.

Do not delete historical information.

Update current-state sections only where required to make them accurate.

---

# 15. Roadmap Reconciliation

Audit:

```text
docs/roadmap/backend-mvp-roadmap.md
```

against current `main`.

Verify:

* Task 26 is represented correctly
* Task 25 is represented correctly
* Task 24 is represented correctly
* Task 23/Base Chart mechanism is represented correctly
* Treasury remains outside MVP
* Purchasing remains outside MVP
* roadmap does not claim implementation that does not exist
* roadmap does not claim acceptance without owner acceptance
* roadmap does not close OQs automatically
* roadmap does not authorize implementation by itself
* roadmap dependencies are consistent with actual code and decisions

Preserve the principle:

> Roadmap describes intended sequence/dependencies; acceptance lives in task/owner records and repository evidence.

If roadmap text is stale, update it.

---

# 16. MVP Scope Verification

Audit the current MVP boundary.

Confirm that the repository/documentation does not accidentally reintroduce:

* Treasury
* Purchasing
* microservices
* workflow designer
* scripting/rules engine
* universal document table
* giant EAV model
* unnecessary Redis
* generic cross-module database access
* hidden permission wildcard
* unauthorized cross-organization administration

Do not implement anything.

This is a governance consistency audit.

---

# 17. Capability vs Task Existence

The MVP gate must evaluate **capabilities**, not simply the existence of task folders or merged PRs.

For each relevant MVP capability, determine:

* implemented?
* tested?
* documented?
* accepted?
* dependency complete?
* security constraints satisfied?
* owner decision complete?

Do not conclude:

> "Task exists → capability is complete."

Use concrete implementation evidence.

---

# 18. Current MVP Implementation Evidence

Produce an updated high-level capability matrix.

At minimum include:

| Capability | Implementation Evidence | Test Evidence | Documentation | Owner Acceptance | Blocking Dependency | Status |
| ---------- | ----------------------- | ------------- | ------------- | ---------------- | ------------------- | ------ |

Do not assign subjective scores.

Use statuses such as:

* IMPLEMENTED
* IMPLEMENTED / ACCEPTANCE PENDING
* PARTIAL
* GOVERNANCE BLOCKED
* DECISION BLOCKED
* NOT IMPLEMENTED
* OUTSIDE MVP
* HISTORICAL / SUPERSEDED

---

# 19. Identify the Next Implementation Gate

Based on actual repository evidence, identify the **next implementation gate**.

Do NOT choose it merely because it is the next numbered task.

Do NOT invent a business capability.

The next gate must be selected based on:

1. dependency completeness
2. current architecture
3. open OQs
4. accepted ADRs
5. current MVP scope
6. security posture
7. actual implemented foundations
8. owner decisions

The report should explain:

* candidate next implementation gate(s)
* prerequisites
* blockers
* owner decisions required
* why each candidate is or is not currently actionable

Do not rank candidates as "best/worst".

If an owner decision is required before implementation, clearly mark the decision gate.

---

# 20. Owner Decision Pack

Create a concise owner decision pack containing only decisions that genuinely require owner input.

For each decision:

```text
Decision ID:
Topic:
Why this matters:
Current repository evidence:
Options / decision space:
Dependency:
What remains blocked:
What becomes actionable after decision:
```

Do not decide on behalf of the owner.

Do not convert technical observations into owner decisions unless an actual product/domain/governance choice is required.

---

# 21. Documentation Drift Audit

Search the repository for stale claims related to:

* Task 24 F-2
* Task 24 F-3
* Task 25 SEC-01
* Task 25 SEC-02
* Task 26 ODR-3
* `assertOrganizationInScope`
* `DeploymentOrganizationScopeGuard`
* `APP_GUARD`
* Base Chart
* OQ-25
* Treasury
* Purchasing
* MVP final gate
* roadmap acceptance
* task acceptance

For every stale claim record:

| Finding | File | Line/Section | Actual Current Fact | Required Action |
| ------- | ---- | ------------ | ------------------- | --------------- |

Correct documentation only where the current fact is unambiguous.

---

# 22. Tests and CI

Do NOT run the full expensive local E2E suite unless there is a very specific reason.

The project has previously experienced long/hanging local:

```bash
npm run test:e2e
```

Therefore:

* prefer repository inspection
* prefer existing GitHub CI evidence
* use targeted lightweight checks only when necessary
* rely on GitHub CI for expensive validation

Record relevant CI:

* workflow
* run ID
* job
* result
* commit SHA

Do not modify tests to make CI green.

If CI evidence is missing, state:

`N/A — no existing CI evidence found`

Do not invent run IDs.

---

# 23. Required Repository Evidence Standard

Every substantive conclusion must be backed by concrete evidence.

Prefer:

* exact file path
* exact class/service
* exact method
* exact line/section when practical
* commit SHA
* PR number
* test name
* CI run ID

Avoid statements such as:

> "Looks correct."

Instead write:

> `apps/backend/src/.../organization.service.ts` — `assertOrganizationInScope()` is called by `...()` before repository access.

Evidence must distinguish:

* observed
* documented
* inferred
* claimed by prior report

---

# 24. Required Output Files

Create:

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

Also update, if required:

```text
STATE.md
docs/roadmap/backend-mvp-roadmap.md
```

Only update existing documents where the audit proves that their current-state statements are stale.

Do not rewrite unrelated documentation.

---

# 25. Required `main-based-reconciliation-report.md` Structure

Use:

```text
# Task 27 — Main-Based Governance Reconciliation Report

## 1. Executive Summary

## 2. Audited Main Commit

## 3. Task / PR Reconciliation

## 4. Task 26 / ODR-3 Verification

## 5. 37 Read-Surface Verification

## 6. Permission-First Verification

## 7. DeploymentOrganizationScopeGuard / APP_GUARD Verification

## 8. Task 25 SEC-01 / SEC-02 Reconciliation

## 9. Task 24 Reconciliation

## 10. Task 23 / Base Chart Reconciliation

## 11. OQ Reconciliation

## 12. ADR Reconciliation

## 13. STATE.md Reconciliation

## 14. Roadmap Reconciliation

## 15. MVP Scope Reconciliation

## 16. Capability Evidence Matrix

## 17. Documentation Drift Findings

## 18. Owner Decision Dependencies

## 19. Next Implementation Gate Analysis

## 20. Risks / Blockers

## 21. Recommended Next Step

## 22. Final Task 27 Status
```

---

# 26. Required Acceptance Matrix

Create:

`docs/tasks/task-27/task-acceptance-matrix.md`

Use:

| AC    | Requirement                                         | Evidence          | Status |
| ----- | --------------------------------------------------- | ----------------- | ------ |
| AC-01 | Current main audited                                | SHA/path          |        |
| AC-02 | Task 26 merge verified                              | PR/SHA            |        |
| AC-03 | ODR-3 implementation re-audited                     | code evidence     |        |
| AC-04 | All 37 Task 25 read surfaces reconciled             | inventory         |        |
| AC-05 | Permission-first ordering verified                  | code/tests        |        |
| AC-06 | APP_GUARD/F-3 documentation reconciled              | paths             |        |
| AC-07 | Task 25 findings reconciled                         | report            |        |
| AC-08 | Task 24 status reconciled                           | report            |        |
| AC-09 | Task 23/Base Chart mechanism reconciled             | report            |        |
| AC-10 | OQs reconciled without unauthorized closure         | OQ report         |        |
| AC-11 | ADRs reconciled without unauthorized promotion      | ADR report        |        |
| AC-12 | STATE.md reconciled                                 | STATE diff        |        |
| AC-13 | Roadmap reconciled                                  | roadmap diff      |        |
| AC-14 | MVP scope verified                                  | capability matrix |        |
| AC-15 | Documentation drift identified/corrected            | drift report      |        |
| AC-16 | Owner decision pack prepared                        | owner pack        |        |
| AC-17 | Next implementation gate identified from evidence   | report            |        |
| AC-18 | No production capability changed                    | git diff          |        |
| AC-19 | No schema/migration/permission architecture changed | git diff          |        |
| AC-20 | Final status is READY FOR REVIEW — NOT ACCEPTED     | report            |        |

All acceptance criteria must have evidence.

---

# 27. Required `implementation-report.md`

Use:

```text
# Task 27 — Implementation / Reconciliation Report

## Status

READY FOR REVIEW — NOT ACCEPTED

## Scope

Governance and documentation reconciliation only.

## Main Audited

<sha>

## Task 26 Verification

<summary>

## Security Verification

<summary>

## Documentation Corrections

<list>

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

## Tests / CI

<evidence>

## Remaining Findings

<list>

## Owner Decisions Required

<list>

## Recommended Next Implementation Gate

<summary>

## Acceptance

Not accepted by this task.
Owner review required.
```

---

# 28. Git Diff Safety Gate

Before finalizing:

Run a complete diff against the starting `main` state.

The final diff must prove that Task 27 did not introduce:

* production capability
* schema changes
* migration changes
* permission changes
* authorization changes
* API behavior
* database behavior
* architectural refactor

If any such change exists:

STOP.

Do not continue silently.

Report it as a scope violation and revert it unless it is explicitly required by this task.

---

# 29. Historical Integrity Rule

Never rewrite history to make the repository appear cleaner.

For example:

If Task 25 correctly reported:

> SEC-01 existed

and Task 26 later fixed it,

do NOT change Task 25 to say:

> SEC-01 never existed.

Instead:

* preserve the historical finding
* record that Task 26 resolved it
* update current-state documentation

Historical accuracy is part of governance integrity.

---

# 30. No Unauthorized Acceptance

Task 27 must NOT:

* accept Task 23
* accept Task 24
* accept Task 25
* accept Task 26
* accept Task 27 itself
* close OQ-25
* promote ADRs
* authorize future implementation

The agent may verify that acceptance already exists.

The agent may record:

> Existing owner acceptance verified.

But it must not manufacture acceptance.

Final Task 27 state:

> **READY FOR REVIEW — NOT ACCEPTED**

---

# 31. No Scope Creep

If you discover something that requires production implementation, create a finding:

```text
Finding ID:
Severity:
Area:
Evidence:
Current behavior:
Expected behavior:
Why it matters:
Required future task:
Blocked by:
```

Then STOP at the governance boundary.

Do not fix it as part of Task 27.

---

# 32. Final Report Must Answer These Questions

The final report must explicitly answer:

### Q1

Is Task 26 actually present in current `main`?

### Q2

Are all 37 Task 25 SEC-01 read surfaces now reconciled?

### Q3

Does current code enforce principal-bound organization isolation?

### Q4

Is permission-first ordering preserved?

### Q5

Is the `APP_GUARD` / `DeploymentOrganizationScopeGuard` documentation now accurate?

### Q6

Are Task 23, 24, 25 and 26 states consistent across code, docs, STATE and roadmap?

### Q7

Is Base Chart mechanism implemented?

### Q8

Is Base Chart content actually approved/implemented, or is it still decision-blocked?

### Q9

Which OQs remain genuinely open?

### Q10

Which ADRs remain Proposed vs Accepted?

### Q11

Does the roadmap reflect current reality?

### Q12

Does STATE.md reflect current reality?

### Q13

Are Treasury and Purchasing still correctly outside MVP?

### Q14

What concrete capabilities are actually implemented today?

### Q15

What is the next implementation gate based on evidence?

### Q16

What owner decisions are required before that gate?

### Q17

Are there any remaining security/documentation inconsistencies that require a separate task?

---

# 33. Final Status Rules

The task may end in one of:

### READY FOR REVIEW — CLEAN

All reconciliation work completed and no unresolved governance-critical discrepancy remains.

### READY FOR REVIEW — FINDINGS REMAIN

Documentation/governance findings remain but are clearly classified and do not justify production implementation within Task 27.

### BLOCKED — OWNER DECISION REQUIRED

A genuine owner/domain decision prevents selecting the next implementation gate.

### BLOCKED — SECURITY FINDING

A security defect exists that must be handled before the next implementation stage.

Do NOT use:

* ACCEPTED
* DONE
* COMPLETE

unless an explicit owner acceptance process separately establishes that state.

---

# 34. Final Response to User

At the end of execution, provide a concise final report containing:

1. Task 27 status
2. audited `main` SHA
3. Task 26 merge evidence
4. number of Task 25 read surfaces verified
5. security findings
6. documentation corrections
7. OQ blockers
8. ADR blockers
9. owner decisions required
10. current MVP capability state
11. recommended next implementation gate
12. exact files created/updated
13. CI evidence
14. confirmation that no production code/schema/permission/architecture changes were made

Do not claim acceptance.

Final wording must include:

> **Task 27 — READY FOR REVIEW — NOT ACCEPTED**
>
> Owner review and explicit acceptance are required before Task 27 is considered accepted.
```
