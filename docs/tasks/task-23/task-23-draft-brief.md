# Task 23 — Base Chart Implementation & Adoption (received task draft, verbatim)

- **Task title:** Task 23 — Base Chart Implementation & Adoption
- **Type:** DOCUMENTATION-ONLY RECORD (received draft, saved verbatim)
- **Received:** 2026-09-26 (repository UTC+03:30 date convention)
- **Recording session:** branch `arena/01a0df43-vardena`, base `b0d9337`
  (merge of PR #62)
- **Draft status as received:** **DRAFT — NOT ADMITTED / NOT IMPLEMENTED**;
  the draft itself records *“Implementation authorization: NOT GRANTED by this
  draft”* (§22).
- **Companion:**
  [`task-23-pre-implementation-report.md`](./task-23-pre-implementation-report.md)
  (the §19 required agent output produced against this draft)

> **Why this file exists.** `STATE.md` §1 makes merged repository files — not
> chat — the official project memory, and the repository convention is to store
> the received task text in the task directory before any implementation (the
> Task 17B / Task 17C precedent:
> [`task-17b-prompt.md`](../task-17/task-17b-prompt.md),
> [`task-17c-prompt.md`](../task-17/task-17c-prompt.md)). Saving the received
> text is what makes the scope, the hard constraints and the non-goals below a
> *recorded input with a repository source* instead of an agent's
> reconstruction.
>
> **This file records the draft. It does not admit it.** Admission into
> `docs/accounting/task-index.md` §2 under the §7 future-task rule remains a
> Repository Owner act, and no registry file was modified by the commit that
> added this document. Nothing here accepts Task 21, promotes an ADR, closes
> OQ-25/OQ-36/OQ-41/OQ-43, or authorizes implementation.

---

The received draft follows verbatim.

---

# Task 23 — Base Chart Implementation & Adoption

**Type:** Backend Implementation
**Status:** DRAFT — NOT ADMITTED / NOT IMPLEMENTED
**Domain:** Accounting
**Depends on:** Accepted Task 19, Accepted Task 20, Accepted Task 21
**Implementation target:** Backend only

---

## 1. Purpose

Implement the repository-backed **Base Chart Template and explicit Adoption foundation** that was governed and accepted by Task 21.

The implementation must convert only the already-accepted governance into production backend capability.

Task 23 MUST NOT invent unresolved accounting-domain content or silently resolve open questions.

---

## 2. Accepted Decision Baseline

Task 23 may rely only on the following accepted decisions:

### Task 19

* **ODR-1 — Explicit Configuration Coherence**
* **ODR-2 — Accounting-owned Chart Tree**
* **ODR-3 — Principal-bound Organization Authorization**

These decisions MUST remain unchanged and MUST NOT be reopened or reinterpreted.

### Task 20

* **OD-20-1 — Base Chart**

  * Base Chart is an Accounting-owned, versioned product/database template.
  * Template identity is never Ledger identity.
  * Adoption produces organization-owned Account rows.
  * Template and organization Account identity remain separate.

* **OD-20-2 — Control Roles**

  * Consumer-first.
  * No speculative generic control-role catalog.

* **OD-20-3 — Control Role Artifact**

  * If/when approved consumer requirements exist, mapping is an independent effective-dated artifact.
  * Never add `Account.control_role`.

* **OD-20-4 — Account Code History**

  * Preserve the pre-use/post-use boundary.
  * Do not invent a speculative history/provenance model.

* **OD-20-5 — Non-leaf Posting**

  * `POSTING = leaf-only`.
  * `AGGREGATION = reporting/read-time roll-up`.
  * No non-leaf posting exception.

* **OD-20-6 — Dimensions**

  * Dimensions remain separate from LedgerEntry identity.
  * No generic dimension/EAV/JSONB implementation.

### Task 21

The accepted Base Chart governance baseline is authoritative for:

* Base Chart content-model boundary.
* Template → explicit adoption → organization-owned Account → Ledger identity.
* Copy-not-reference adoption.
* Immutable published template versions.
* No silent mutation of an adopted chart.
* Explicit upgrade semantics.
* Bounded partial adoption.
* Ancestor closure.
* Mandatory-inclusion semantics as governed.
* Separation of Base Chart mandatory requirements from:

  * organization-required accounts,
  * consumer control-role requirements,
  * statutory/legal requirements.
* Consumer-first control-role governance.
* Per-level posting defaults bounded by leaf-only posting.
* Account customization governance.
* Published lifecycle:

  * Draft
  * Approved
  * Published
  * Superseded
* OQ-36 dependency boundary.

---

## 3. Required Implementation Scope

Task 23 SHOULD implement the smallest complete backend foundation necessary to represent and adopt a governed Base Chart.

### 3.1 Base Chart Template

Provide an Accounting-owned versioned template model capable of representing:

* Template identity.
* Template metadata required by the existing domain conventions.
* Version identity.
* Version lifecycle.
* Account hierarchy/content structure required by the accepted governance.
* Per-account posting capability/default semantics required by Task 21.
* Parent/ancestor relationships needed for hierarchy validation.
* Mandatory marker where the accepted governance requires the concept to exist.

The implementation MUST support configurable chart depth.

It MUST NOT hardcode a four-level accounting hierarchy.

---

### 3.2 Version Lifecycle

Implement the governed lifecycle:

```text
DRAFT
  ↓
APPROVED
  ↓
PUBLISHED
  ↓
SUPERSEDED
```

Rules:

* Published versions are immutable.
* A published version cannot be silently modified.
* Superseding a version does not mutate historical versions.
* There MUST be no implicit synchronization from template versions into already-adopted organization Accounts.
* Explicit upgrade behavior may be represented only to the extent required by the accepted governance and existing repository contracts.

Do not introduce speculative version-management features beyond this scope.

---

### 3.3 Adoption

Implement an explicit organization-scoped adoption operation.

Adoption MUST:

1. Be authorized against the target organization.
2. Reference a specific published Base Chart version.
3. Validate compatibility with the organization's Accounting configuration according to the accepted ODR-1 coherence boundary.
4. Produce organization-owned Account rows.
5. Copy the applicable chart structure rather than maintaining a runtime reference to the template.
6. Preserve the distinction between template identity and Account identity.
7. Establish the resulting Accounts as ordinary organization-owned chart entities.
8. Respect ancestor closure.
9. Respect mandatory-inclusion semantics.
10. Prevent unauthorized cross-organization adoption.

The resulting:

```text
Base Chart Template Version
        ↓
      Adoption
        ↓
Organization-owned Account rows
        ↓
LedgerEntry.accountId
```

MUST remain the identity boundary.

A template account ID MUST NEVER become a `LedgerEntry.accountId`.

---

## 4. Partial Adoption Boundary

Task 21 permits a bounded partial-adoption model but leaves the exact full/subset/staged policy open.

Therefore Task 23 MUST NOT invent an unrestricted partial-adoption policy.

Implementation may support only the minimum selection mechanism necessary to enforce the already-governed constraints:

* ancestor closure;
* mandatory inclusion;
* no orphaned selected descendants;
* no omission of required ancestors.

If the repository cannot implement a complete partial-adoption policy without making a new domain decision, the implementation MUST stop at the smallest explicitly governed capability and report the unresolved boundary.

---

## 5. Account Semantics

The implementation MUST preserve:

```text
POSTING    = leaf-only
AGGREGATION = read-time roll-up
```

Therefore:

* A non-leaf account MUST NOT become postable through Base Chart adoption.
* `is_postable` MUST remain bounded by the leaf-only invariant.
* Template-level defaults MUST NOT create a non-leaf posting exception.
* Task 18 reporting/roll-up semantics MUST remain unchanged.
* No new ledger behavior is introduced by Base Chart adoption.

---

## 6. Account Customization

Adopted Accounts are organization-owned.

Task 23 must preserve the accepted distinction between:

* template definition;
* adopted organization Account;
* Ledger identity.

Do not implement speculative account-history/provenance infrastructure.

Respect the accepted code lifecycle boundary from OD-20-4 and the repository's existing stricter post-use immutability behavior.

Deletion/code-reuse behavior remains governed by **OQ-36** and MUST NOT be newly decided by Task 23.

---

## 7. Control Roles

Task 23 MUST NOT introduce a generic control-role catalog.

Specifically:

* Do NOT add `Account.control_role`.
* Do NOT seed Cash/Bank/AR/AP/Inventory/Tax/Sales roles as a generic catalog.
* Do NOT infer mandatory control roles from accounting conventions.
* Do NOT implement consumer-specific control-role restrictions without an approved consumer requirement.

If the implementation needs an extension point for future approved control-role assignments, it must remain consistent with OD-20-3 and must not pretend that an unresolved catalog has been approved.

If implementation requires a new domain decision, stop and report it rather than inventing the decision.

---

## 8. Dimensions

Task 23 MUST NOT implement dimensions.

Do not add:

* dimension columns to LedgerEntry;
* arbitrary analytical columns;
* EAV structures;
* generic JSONB dimension bags;
* speculative dimension projections.

OQ-41 remains OPEN.

---

## 9. Statutory / Legal Charts

Task 23 MUST NOT implement statutory/legal chart content.

Base Chart MUST remain distinct from the Legal Profile governed by ADR-0036 / OQ-43.

Do not introduce:

* Article 95 content;
* legal-book structures;
* statutory account catalogs;
* compliance claims;
* Iranian statutory chart assumptions.

OQ-43 remains OPEN.

---

## 10. Content Values

Task 23 MUST NOT invent production Base Chart content.

The following remain outside the authority of this admission unless separately approved:

* actual account codes;
* Persian account titles;
* account natures;
* mandatory-account catalog;
* concrete control-role catalog;
* consumer-specific mandatory sets.

If repository tests require deterministic fixture data, use only minimal technical fixtures that are clearly identified as test data and are not represented as approved production accounting content.

---

## 11. OQ-25 Boundary

Task 23 does **not** close OQ-25.

OQ-25 remains OPEN and substantially narrowed.

The implementation may consume the accepted governance resulting from Task 21, but MUST NOT claim that unresolved content decisions have been resolved.

Any implementation requirement that cannot be satisfied without resolving an OQ-25 item MUST be reported as a blocker/decision request rather than guessed.

---

## 12. Architecture Constraints

Implementation MUST follow the existing Vardena architecture:

* Modular Monolith.
* Vertical Slice architecture.
* NestJS + TypeScript.
* PostgreSQL.
* Prisma.
* REST/OpenAPI.
* Existing Accounting module ownership.
* Existing organization/authorization boundaries.

Database changes MUST use Prisma migrations.

Do NOT:

* create a microservice;
* create a universal document/table abstraction;
* introduce EAV;
* introduce giant generic JSONB models;
* add unnecessary Redis;
* bypass existing authorization;
* create hidden wildcard permissions;
* directly couple unrelated modules through database tables;
* perform drive-by refactors.

---

## 13. Existing Accounting Integration

Task 23 must integrate with the existing Accounting Account/Chart infrastructure rather than creating a parallel Account hierarchy.

The implementation MUST preserve:

```text
Base Chart Template
        ≠
Organization Account
        ≠
LedgerEntry identity
```

Existing ledger/reporting/posting behavior must remain compatible.

No rewrite of existing Accounting foundations is authorized.

---

## 14. API / Permission Boundary

Expose only the API surface required for:

* Base Chart template/version management within the accepted lifecycle.
* Published-version inspection where required.
* Explicit organization adoption.
* Adoption validation/errors.
* Reading the resulting organization-owned chart.

Authorization MUST remain organization/principal bound according to ODR-3.

Permissions MUST be explicit and follow the repository's existing RBAC conventions.

Do not create administrative bypasses.

---

## 15. Testing Requirements

Tests must cover the actual governed invariants, including at minimum:

* published-version immutability;
* lifecycle transitions;
* organization authorization;
* adoption of a published version;
* template/account identity separation;
* copy-not-reference behavior;
* ancestor closure;
* mandatory inclusion;
* leaf-only posting;
* organization isolation;
* ODR-1 configuration coherence;
* no mutation of adopted Accounts through later template changes.

Testing MUST NOT become a reason to block the task on an unnecessarily long local live-E2E run.

Use the repository's normal unit/integration checks locally.

Where PostgreSQL/live-E2E verification is expensive, ensure the appropriate CI workflow is the authoritative verification path and report the exact CI requirement/result.

Do not spend the implementation run waiting indefinitely for a heavy local E2E suite.

---

## 16. Frontend

No frontend implementation is included.

Task 23 is **Backend-only**.

The existing frontend vertical slice remains untouched.

---

## 17. Migration / Compatibility

Any schema change must:

* use a Prisma migration;
* preserve existing data;
* avoid destructive changes unless explicitly authorized;
* include appropriate indexes/constraints;
* respect existing organization scoping;
* preserve existing Account/Ledger relationships.

No migration may alter the meaning of existing ledger identity.

---

## 18. Scope-Creep Gate

Before implementing anything not explicitly covered above, classify it:

* CORE
* PLATFORM
* SECURITY
* ACCOUNTING DOMAIN
* INTEGRATION
* DEFERRED
* OPEN QUESTION

If implementation requires a new accounting-domain decision, stop and report the decision request.

Do not silently convert an implementation assumption into an accepted architectural or accounting decision.

---

## 19. Required Agent Output

Before coding, inspect:

* current repository state;
* `docs/accounting/task-index.md`;
* `STATE.md`;
* Task 19/20 accepted decision records;
* Task 21 accepted governance baseline;
* current Accounting Prisma schema;
* existing Account domain/service/repository/API implementation;
* existing authorization/RBAC conventions;
* existing migrations;
* relevant ADRs;
* OQ-25/OQ-36/OQ-41/OQ-43.

Then report:

1. Implementation interpretation.
2. Exact files/modules expected to change.
3. Schema/migration plan.
4. API/permission plan.
5. Adoption transaction/invariant plan.
6. Test plan.
7. Any unresolved decision required before implementation.

If a new decision is required, **do not implement past that boundary**.

---

## 20. Acceptance Gate

Task 23 is not self-accepted by the Agent.

The Agent may report:

```text
READY FOR REVIEW
```

but MUST NOT mark the task:

```text
ACCEPTED
```

Acceptance remains a Repository Owner decision after implementation review and CI verification.

---

## 21. Explicit Non-Goals

Task 23 does NOT include:

* statutory/legal accounting;
* dimensions;
* generic control-role catalog;
* posting rules/mapping;
* Sales integration;
* Purchase integration;
* Treasury;
* AR/AP integration;
* settlement/allocation;
* inventory-to-accounting integration;
* reporting redesign;
* frontend implementation;
* microservice extraction;
* workflow/rules engine;
* generic document engine;
* speculative accounting content.

---

## 22. Admission Result

**Proposed next Backend task:**

> **Task 23 — Base Chart Implementation & Adoption**

**Admission status:** DRAFT — requires Repository Owner admission into `docs/accounting/task-index.md` before implementation.

**Implementation authorization:** NOT GRANTED by this draft.

**Primary dependency:** Accepted Task 21 governance baseline.

**Open boundary:** OQ-25 remains OPEN; unresolved Base Chart content values must not be invented.
