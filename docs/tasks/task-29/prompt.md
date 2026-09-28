# Task 29 — VARDENA Base Chart Reconciliation & Accounting Domain Decision Gate

## Prompt Specification

The following is the verbatim prompt received for Task 29:

```markdown
# Task 29 — VARDENA Base Chart Reconciliation & Accounting Domain Decision Gate

## Role

You are Arena Agent operating on the Vardena repository.

Act as:

* Senior Software Architect
* Accounting / Domain Architect
* Backend Architect
* Repository Auditor
* Governance / ADR Reviewer
* Fit-Gap Analyst

This task is a **governance, domain-reconciliation, fit-gap and implementation-readiness task only**.

You are NOT authorized to implement production capabilities in this task.

---

# 1. Objective

Reconcile the real VARDENA Base Chart source artifact with the current Vardena Accounting architecture and determine:

1. What is already supported by the current Vardena architecture.
2. What is a pure data/content mapping.
3. What is a domain-model gap.
4. What requires an explicit Owner Decision.
5. What must be deferred to a later implementation task.
6. Whether the existing Base Chart / Coding Structure architecture can support the VARDENA chart without architectural redesign.
7. Whether the repository is ready for a later controlled Base Chart Content Loading & Adoption task.

The final output must be a **decision gate**, not an implementation.

---

# 2. Critical Scope Rule

This task MUST NOT implement production functionality.

Do NOT modify:

* Prisma schema
* migrations
* database tables
* seed data
* production domain models
* production services
* controllers
* DTOs
* permissions
* guards
* posting behavior
* accounting behavior
* closing behavior
* reporting behavior
* document validation behavior
* Base Chart runtime behavior
* API contracts
* frontend
* tests that change production behavior
* architecture

Documentation and governance artifacts are allowed.

If you discover that production changes are required, document them as:

`IMPLEMENTATION REQUIRED`

Do NOT implement them in Task 29.

---

# 3. Repository Baseline

Start from the latest `main`.

First verify:

* current HEAD
* latest merged Task 27
* latest merged Task 28
* latest Task 28 follow-up / Owner Decision OD-27-02
* current STATE.md
* current roadmap
* current OQ status
* current ADR status

Do not rely on historical branch state if main has moved.

The current governance baseline includes:

* Task 27 Main Governance Reconciliation & MVP Gate
* Task 28 Owner Decision Closure & MVP Implementation Selection Gate
* OD-27-02: Base Chart MVP scope boundary

---

# 4. Existing Owner Decision — MUST PRESERVE

The following decision is already established and MUST NOT be reopened or contradicted:

## OD-27-02

Base Chart MVP requires the **Base Chart mechanism**, not a concrete standard chart-of-accounts content set.

The mechanism includes:

* template identity
* template version
* template levels
* template nodes
* version lifecycle
* Draft → Approved → Published → Superseded
* organization adoption by copy
* immutable published semantics
* no silent mutation
* Template identity ≠ Ledger identity
* Adoption = Copy
* Posting = Leaf-only
* Aggregation = Read-time

Concrete chart content is NOT MVP-required unless separately approved.

Do NOT invent:

* standard account codes
* standard Persian account titles
* statutory account lists
* mandatory control-role catalog
* accounting policies
* regulatory requirements

However, this task is specifically authorized to reconcile the **actual owner-provided VARDENA source artifact** as a real source dataset.

This does NOT make the artifact a universally approved Vardena standard chart.

---

# 5. Source Artifact

Use the owner-provided VARDENA chart artifact:

`Pasted markdown(20260927-203801).md`

The artifact contains approximately 264 account rows and these fields:

* کد حساب
* عنوان حساب
* ماهيت حساب
* نوع حساب
* عنوان انگليسي حساب
* ACLTafsil1
* ACLTafsil2
* ACLTafsil3
* ACLTafsil4
* وضعيت حساب غيرفعال/فعال

Treat the supplied artifact as the source of truth for this reconciliation.

Do NOT invent or modify source rows.

Do NOT silently normalize source values without documenting the transformation.

---

# 6. VARDENA Coding Structure

The owner has clarified the actual coding semantics:

### Level 1 — Group

1 digit

Example:

`1`

### Level 2 — General

2-digit segment appended to Group.

Example:

`1 + 01 = 101`

### Level 3 — Subsidiary

3-digit segment appended to Group + General.

Example:

`1 + 01 + 001 = 101001`

Therefore the visible account code is hierarchical/composite.

For this source artifact:

```text
Group      = 1 digit
General    = 2 digits
Subsidiary = 3 digits
```

Example:

```text
1
101
101001
```

means:

```text
Group      = 1
General    = 01
Subsidiary = 001
```

IMPORTANT:

Do NOT assume Vardena must hard-code 1+2+3.

The Vardena mechanism MUST remain configurable.

The task is to verify whether the existing configurable Coding Structure supports this configuration.

---

# 7. Coding Fit-Gap

Inspect the actual current implementation of:

* Coding Structure
* Coding Structure Level
* Account
* Base Chart Template
* Base Chart Template Version
* Base Chart Template Level
* Base Chart Template Node
* Base Chart Adoption
* compatibility validation
* adoption planning
* account code validation
* parent/child validation
* postability derivation

Determine whether the following are already supported:

### Required checks

* configurable level count
* configurable segment digit lengths
* cumulative code length
* hierarchical parent/child relationship
* prefix validation
* account-code uniqueness
* level validation
* leaf detection based on actual hierarchy
* leaf-only posting
* Base Chart template compatibility
* Base Chart adoption by copy

For the VARDENA artifact, explicitly verify:

```text
1 + 2 + 3
```

is compatible with the existing mechanism.

Do NOT treat code length alone as proof of account level.

Use actual parent/child relationships.

---

# 8. Account Nature vs Balance Nature

This is a critical domain reconciliation.

The VARDENA field:

`ماهیت حساب`

has these source values:

* بدهکار
* بستانکار
* هردو

The owner clarified:

### بدهکار

`DEBIT`

### بستانکار

`CREDIT`

### هردو

`DUAL`

`هردو` means the account is not constrained to one side and may be used as debit in one accounting document and credit in another.

DO NOT map `هردو` to either debit or credit.

DO NOT silently discard it.

DO NOT interpret `DUAL` as automatically allowing every posting scenario. Exact posting rules are a separate domain concern.

---

# 9. Current Vardena Nature Model

Inspect the current Vardena Account model.

The current model historically contains an account nature concept with:

```text
debit
credit
```

Determine exactly where and how this exists.

Report:

* file path
* domain type / enum
* services using it
* validation using it
* tests using it
* API exposure if applicable

Determine the gap between:

```text
DEBIT | CREDIT
```

and the required:

```text
DEBIT | CREDIT | DUAL
```

Classify this as:

`MODEL GAP / IMPLEMENTATION REQUIRED`

if confirmed.

Do NOT implement it in Task 29.

---

# 10. Account Type — Three Fixed Global Types

The VARDENA field:

`نوع حساب`

must be treated as a distinct domain concept.

The owner-defined three types are:

```text
BALANCE_SHEET
INCOME_STATEMENT
MEMORANDUM
```

Persian mapping:

```text
ترازنامه‌ای → BALANCE_SHEET
سود و زیان   → INCOME_STATEMENT
انتظامی      → MEMORANDUM
```

These are the three standard account types for this domain decision.

---

# 11. Account Type Semantics

Use the owner-provided specification as the domain basis.

## BALANCE_SHEET

Permanent accounts representing financial position.

Examples include:

* assets
* liabilities
* equity

Expected domain behavior:

* balance carries forward
* participates in balance-sheet reporting
* does not close as a normal income statement account

## INCOME_STATEMENT

Temporary / performance accounts.

Examples include:

* revenue
* expenses
* cost of sales

Expected domain behavior:

* participates in period performance reporting
* closing process eventually closes these accounts
* period result ultimately flows into equity / retained earnings through the appropriate closing process

## MEMORANDUM

Memorandum / انتظامی accounts.

Expected domain behavior:

* outside the core accounting equation
* separate reporting treatment
* special posting/reporting rules
* should not contaminate ordinary financial statements

IMPORTANT:

The existence of Account Type does NOT authorize implementation of all these behaviors in Task 29.

Closing, carry-forward, financial statements, memorandum posting rules, etc. belong to their respective future capabilities.

---

# 12. Account Type Must NOT Be Confused With Other Concepts

The following concepts MUST remain separate:

```text
Account Type
Balance Nature
Statement Class
System Account
```

The conceptual model is:

```text
Account
├── type
│   ├── BALANCE_SHEET
│   ├── INCOME_STATEMENT
│   └── MEMORANDUM
│
├── balanceNature
│   ├── DEBIT
│   ├── CREDIT
│   └── DUAL
│
├── statementClass
│   └── organization-configurable
│
└── isSystem
    └── boolean
```

Do NOT implement this model now.

This is a domain target model for fit-gap analysis.

---

# 13. Statement Class

Treat `Statement Class` as a separate concept.

Its purpose is:

> determining where an account appears within financial-statement presentation/reporting.

Examples may include categories such as:

* current asset
* non-current asset
* current liability
* non-current liability
* equity
* operating income
* non-operating income
* operating expense
* non-operating expense

Do NOT assume these exact values are approved Vardena configuration.

Do NOT create them.

The important decision is:

`Statement Class ≠ Account Type`

and:

`Statement Class` should be organization-configurable.

Determine whether current Vardena has an equivalent concept.

If not, report:

`DOMAIN/MODEL GAP — FUTURE IMPLEMENTATION REQUIRED`

Do not implement it.

---

# 14. System Account

Treat:

```text
isSystem
```

as an independent concept.

It answers:

> Is this account controlled by the system rather than being freely available for ordinary user posting?

Examples may include future system-managed accounts such as closing-related or internal accounting accounts.

However:

* do not invent system accounts
* do not infer system status from account titles
* do not add `isSystem` in Task 29

Determine whether current Vardena already has an equivalent concept.

If not:

`FUTURE MODEL GAP`

Do not implement it.

---

# 15. Important Accounting Separation

Explicitly document that these are NOT interchangeable:

### Account Type

Answers:

> What is the period/reporting behavior of this account?

### Balance Nature

Answers:

> What debit/credit balance orientation is allowed?

### Statement Class

Answers:

> Where should this account appear in financial-statement presentation?

### System Account

Answers:

> Is this account system-controlled?

Do not merge them.

---

# 16. ACLTafsil1..4

The source contains:

```text
ACLTafsil1
ACLTafsil2
ACLTafsil3
ACLTafsil4
```

The owner clarified the semantics:

```text
0 = no relation / no requirement
1 = relation / requirement exists
```

These behave as boolean requirement flags.

Example:

```text
ACLTafsil1 = 1
```

means:

> whenever this account is used in an accounting document / turnover, the corresponding required detail must also be entered.

Therefore these fields are NOT merely descriptive metadata.

They imply future document-line validation.

---

# 17. Detail Requirement Mapping

Inspect the current Vardena architecture for:

* Detail
* Control Role
* dimensions
* accounting dimensions
* account-detail relationships
* document-line validation
* any existing concept that can represent required details

Determine whether ACLTafsil1..4 can conceptually map to an existing generic mechanism.

Do NOT create:

```text
requiresDetail1
requiresDetail2
requiresDetail3
requiresDetail4
```

unless the architecture explicitly requires such a structure — and even then, do not implement it in this task.

Prefer generic domain concepts such as:

```text
account → required control/detail role(s)
```

if such a mechanism already exists.

The output must distinguish:

* source semantics
* current Vardena support
* conceptual mapping
* missing implementation

---

# 18. English Account Title

The source contains:

`عنوان انگليسي حساب`

Owner decision:

English title is NOT required for the current MVP.

Therefore:

* record it as source-only metadata
* do not add it to the MVP Account model
* do not make it a blocker for Base Chart loading
* do not invent an English translation
* do not remove it from the source artifact

Classification:

`DEFERRED / NON-MVP`

---

# 19. Active / Inactive

The source contains:

`وضعيت حساب غيرفعال/فعال`

Inspect the source values.

Determine whether they map directly to the current Vardena:

```text
isActive
```

If compatible, classify as:

`DIRECTLY COMPATIBLE`

Do not change source data.

Do not implement additional lifecycle behavior.

---

# 20. VARDENA Source Validation

Perform a full structural validation of the supplied 264-account artifact.

At minimum check:

### Codes

* duplicate codes
* malformed codes
* invalid segment lengths
* invalid cumulative lengths
* invalid characters
* missing parents
* orphan nodes
* parent/child inconsistencies
* invalid hierarchy
* invalid level assumptions

### Titles

* missing titles
* duplicate titles where relevant
* empty values

### Nature

Check all distinct values of:

`ماهیت حساب`

Expected source values:

* بدهکار
* بستانکار
* هردو

Report any unexpected value.

### Type

Check all distinct values of:

`نوع حساب`

Expected:

* ترازنامه ای
* سود و زیان
* انتظامی

Report any unexpected value.

### Detail flags

Check:

* ACLTafsil1
* ACLTafsil2
* ACLTafsil3
* ACLTafsil4

Expected values:

```text
0 / 1
```

Report any unexpected value.

### Active status

Report all distinct values.

Do not assume semantics beyond the source.

---

# 21. Important Hierarchy Rule

Do NOT determine leaf/non-leaf status only from code length.

For example:

```text
3 digits = General
6 digits = Subsidiary
```

may be common in the artifact, but actual posting eligibility must ultimately derive from hierarchy.

Use actual parent-child relationships.

This must remain consistent with the existing Vardena invariant:

> Posting = Leaf-only.

---

# 22. Base Chart Content vs Mechanism

Explicitly distinguish:

### Already implemented mechanism

Current Vardena already has Base Chart mechanism including:

* templates
* versions
* levels
* nodes
* publication lifecycle
* adoption by copy
* compatibility checks
* leaf-only postability
* template identity ≠ ledger identity

### VARDENA content

The 264 accounts are actual source content.

They are NOT:

* a universal Vardena standard
* automatically an approved statutory chart
* automatically MVP-required content

The task should determine whether this specific owner-provided content is structurally loadable.

Do NOT approve the content as a universal standard.

---

# 23. Required Fit-Gap Classification

For every relevant feature, classify as exactly one of:

### DIRECTLY COMPATIBLE

Current architecture already supports it.

### DATA MAPPING ONLY

No production model change required; source field can map directly.

### DOMAIN DECISION REQUIRED

Architecture needs an explicit owner/domain decision before implementation.

### MODEL GAP

Current model does not represent the required concept.

### IMPLEMENTATION REQUIRED

A future production implementation is required.

### DEFERRED / NON-MVP

Explicitly outside current MVP scope.

### BLOCKED

Cannot safely proceed without missing owner input.

Do not use vague statuses.

---

# 24. Required Final Domain Matrix

Create a table covering at least:

| Concept          | VARDENA source  | Vardena current state | Fit-Gap | Decision | Future Task |
| ---------------- | ----------------- | --------------------- | ------- | -------- | ----------- |
| Coding Structure | 1+2+3             | inspect               |         |          |             |
| Account Type     | 3 values          | inspect               |         |          |             |
| Balance Nature   | debit/credit/both | inspect               |         |          |             |
| Statement Class  | not explicit      | inspect               |         |          |             |
| System Account   | not explicit      | inspect               |         |          |             |
| ACLTafsil1..4    | 0/1               | inspect               |         |          |             |
| English Title    | source only       | inspect               |         |          |             |
| Active/Inactive  | source            | inspect               |         |          |             |
| Parent/Child     | code hierarchy    | inspect               |         |          |             |
| Leaf Posting     | hierarchy         | inspect               |         |          |             |

---

# 25. OQ-25

Do NOT close OQ-25 wholesale.

Reconcile only the portions relevant to this task.

If Task 29 resolves a sub-question, document exactly which sub-question was resolved.

If unresolved:

`REMAINS OPEN`

Do not mark the whole OQ as resolved merely because the mechanism is implemented.

---

# 26. ADR Reconciliation

Inspect all relevant Accounting/Base Chart ADRs.

For each relevant ADR:

* current status
* whether Task 29 confirms it
* whether Task 29 requires amendment
* whether it remains Proposed
* whether Owner Decision is required

Do NOT automatically promote an ADR to Accepted.

Do NOT fabricate Owner approval.

---

# 27. Owner Decisions

Task 29 may identify decisions that are logically required.

It MUST NOT fabricate approval.

Use explicit statuses:

```text
DECIDED
PENDING OWNER DECISION
NOT APPLICABLE
```

The already established OD-27-02 must remain:

```text
DECIDED
```

Any newly identified decisions must be:

```text
PENDING OWNER DECISION
```

unless a prior repository record explicitly proves otherwise.

---

# 28. Important Expected Domain Conclusions

The analysis should explicitly verify these propositions:

### Proposition A

VARDENA:

```text
1 + 2 + 3
```

is compatible with Vardena's configurable coding structure.

### Proposition B

`هردو` must map conceptually to:

```text
DUAL
```

and must NOT be collapsed into debit/credit.

### Proposition C

Account Type has exactly three values for this domain decision:

```text
BALANCE_SHEET
INCOME_STATEMENT
MEMORANDUM
```

### Proposition D

Account Type is independent from Balance Nature.

### Proposition E

Statement Class is independent from Account Type.

### Proposition F

System Account is independent from both.

### Proposition G

ACLTafsil1..4 represent future detail/control requirements, not simple descriptive fields.

### Proposition H

English title is non-MVP.

### Proposition I

No new Base Chart architecture is required merely to support the VARDENA coding structure.

If any proposition is contradicted by repository evidence, report the contradiction rather than forcing the expected conclusion.

---

# 29. No Scope Creep

Do NOT implement:

* fiscal closing
* carry-forward
* financial statements
* trial balance
* memorandum accounting engine
* posting rules
* system-account restrictions
* statement-class engine
* detail validation
* inventory accounting
* sales accounting
* purchasing
* treasury
* reporting engine
* frontend

These may be future tasks.

Task 29 only determines requirements and gaps.

Treasury remains POST-MVP.

Purchasing remains POST-MVP.

Purchasing → Accounting remains POST-MVP.

Purchasing Reports remain POST-MVP.

---

# 30. Required Documentation Artifacts

Create under:

```text
docs/tasks/task-29/
```

At minimum:

```text
brief.md
prompt.md
source-artifact-profile.md
coding-fit-gap.md
account-nature-decision.md
account-type-decision.md
statement-class-analysis.md
system-account-analysis.md
detail-flag-mapping.md
content-validation-report.md
implementation-readiness.md
owner-decision-pack.md
adr-reconciliation.md
oq-reconciliation.md
task-acceptance-matrix.md
implementation-report.md
```

If an artifact is unnecessary, explain why in the implementation report rather than silently omitting it.

---

# 31. Source Artifact Profile

`source-artifact-profile.md` must document:

* source filename
* row count
* field list
* distinct values
* code depth
* code segment structure
* root accounts
* hierarchy statistics
* nature distribution
* account-type distribution
* detail-flag distribution
* active/inactive distribution
* anomalies

Do not alter source content.

---

# 32. Content Validation Report

The validation report must answer:

1. Is every code structurally valid?
2. Is every non-root node connected to a valid parent?
3. Are there duplicate codes?
4. Are there malformed codes?
5. Are there unexpected nature values?
6. Are there unexpected type values?
7. Are detail flags only 0/1?
8. Are status values consistent?
9. Are there orphan accounts?
10. Are there hierarchy anomalies?
11. Which nodes are leaves?
12. Which nodes are non-leaves?

Use actual source evidence.

---

# 33. Implementation Readiness

Produce an explicit readiness matrix:

| Area                | Ready | Blocker | Future Work |
| ------------------- | ----- | ------- | ----------- |
| Coding Structure    |       |         |             |
| Base Chart Template |       |         |             |
| Base Chart Content  |       |         |             |
| Account Type        |       |         |             |
| Balance Nature      |       |         |             |
| Statement Class     |       |         |             |
| Detail Requirements |       |         |             |
| System Accounts     |       |         |             |
| Adoption            |       |         |             |
| Ledger Identity     |       |         |             |

The matrix must distinguish:

> architecture ready

from:

> production implementation ready

---

# 34. Task Acceptance Matrix

Create explicit acceptance criteria.

At minimum:

### AC-01

Latest main inspected.

### AC-02

Task 27 and Task 28 governance state reconciled.

### AC-03

OD-27-02 preserved.

### AC-04

VARDENA source artifact profiled.

### AC-05

264-account dataset structurally validated.

### AC-06

1+2+3 coding structure reconciled with Vardena.

### AC-07

Account Type reconciled as three fixed global types.

### AC-08

Balance Nature reconciled as Debit/Credit/Dual.

### AC-09

Account Type and Balance Nature explicitly separated.

### AC-10

Statement Class analyzed separately.

### AC-11

System Account analyzed separately.

### AC-12

ACLTafsil1..4 semantics reconciled.

### AC-13

English Title classified as non-MVP.

### AC-14

No production implementation performed.

### AC-15

OQ-25 not incorrectly closed.

### AC-16

Relevant ADRs reconciled.

### AC-17

Owner decisions clearly marked.

### AC-18

Future implementation dependencies identified.

### AC-19

No invented chart content.

### AC-20

Task is ready for human review.

---

# 35. Verification

Because this task is governance-only:

Prefer:

* repository inspection
* static analysis
* documentation consistency checks
* existing tests only where lightweight

Do NOT spend significant time running local E2E.

The user has explicitly requested that expensive E2E verification be handled through GitHub CI rather than becoming a local blocking step.

If any CI verification is useful, use GitHub CI.

Do not modify production behavior just to make tests pass.

---

# 36. Git / PR Rules

Create a dedicated branch following the repository's established Arena branch naming convention.

Commit only:

* Task 29 documentation
* governance records
* decision records
* state/roadmap updates that are genuinely justified by the analysis

Do NOT modify production code.

Before opening the PR:

* inspect git diff
* verify no production code/schema/migration changes
* verify no generated noise
* verify documentation references are internally consistent

Open a PR for review.

The PR must NOT self-accept the task.

Final task status must be:

```text
READY FOR REVIEW — NOT ACCEPTED
```

---

# 37. Final Implementation Report

`implementation-report.md` must contain:

## Executive Summary

What was found.

## Repository Baseline

Exact main SHA.

## Source Artifact

Exact source and row count.

## Coding Fit-Gap

Current support and gaps.

## Account Type

Decision and implementation gap.

## Balance Nature

Decision and implementation gap.

## Statement Class

Decision and implementation gap.

## System Account

Decision and implementation gap.

## Detail Flags

Decision and implementation gap.

## Base Chart Compatibility

Whether the existing mechanism can support the artifact.

## Validation Results

Exact anomalies, if any.

## Owner Decisions

DECIDED / PENDING OWNER DECISION / NOT APPLICABLE.

## OQ Reconciliation

Especially OQ-25.

## ADR Reconciliation

Relevant ADRs only.

## Future Implementation Tasks

Concrete proposed follow-up tasks, without implementing them.

## Acceptance

```text
READY FOR REVIEW — NOT ACCEPTED
```

---

# 38. Final Report Must Answer This Question

At the end of Task 29, the report must answer clearly:

> "Can Vardena's existing Base Chart and Coding Structure architecture represent the real VARDENA chart without architectural redesign, and exactly which domain/model gaps must be resolved before loading the 264 accounts?"

The answer must be evidence-based.

Do not answer "yes" merely because the architecture looks reasonable.

Do not answer "no" merely because Account Type or Dual Nature is missing.

Separate:

```text
Architecture Compatibility
        ↓
Domain Model Gap
        ↓
Implementation Requirement
        ↓
Content Loading Readiness
```

---

# 39. Explicit Prohibitions

DO NOT:

* invent accounts
* invent codes
* invent titles
* translate titles and treat translations as source truth
* approve the VARDENA chart as a universal standard
* close OQ-25 wholesale
* promote ADRs automatically
* fabricate Owner Decisions
* add production fields
* change Prisma
* create migrations
* create seeds
* change permissions
* change guards
* change posting behavior
* implement closing
* implement reporting
* implement financial statements
* implement detail validation
* implement system-account restrictions
* implement frontend
* introduce microservices
* introduce Redis
* refactor unrelated modules
* perform drive-by cleanup

---

# 40. Success Condition

Task 29 is successful when a reviewer can read the produced documentation and answer, without inspecting the entire repository:

1. Is VARDENA's 1+2+3 coding compatible?
2. Is the existing Base Chart mechanism sufficient?
3. What exactly is missing for `Account Type`?
4. What exactly is missing for `DUAL` Balance Nature?
5. What is Statement Class and is it currently supported?
6. What is System Account and is it currently supported?
7. How do ACLTafsil1..4 map conceptually?
8. Can the 264 source accounts be loaded today?
9. If not, what blocks loading?
10. What is the exact next implementation task?
11. Which Owner Decisions remain pending?

Do not leave these questions implicit.

---

# 41. Final Status

Unless repository evidence proves otherwise, finish Task 29 with:

```text
READY FOR REVIEW — NOT ACCEPTED
```

Do not claim acceptance.

Do not claim Owner approval.

Do not start the next implementation task automatically.
```
