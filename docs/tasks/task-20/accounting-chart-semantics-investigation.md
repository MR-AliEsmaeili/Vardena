# Task 20 — Accounting Chart Semantics & Master Structure — Investigation

- **Document type:** investigation + architecture review — **DOCUMENTATION ONLY**
- **Date:** 2026-09-26
- **Status:** **READY FOR REVIEW — NOT ACCEPTED** (the Agent does not self-accept)
- **Branch:** `arena/01a0de02-vardena`
- **Baseline inspected:** `main` @ `1efa3f386e40d7ee1bc0a8f55f11120cd971ddaf` (merge of PR #57), i.e. the repository state after the original Task 20 investigation and before this decision-resolution update
- **Companion:** [`task-20-implementation-gate.md`](./task-20-implementation-gate.md)

> **Boundary.** This task implements nothing. No TypeScript, Prisma schema,
> migration, endpoint, DTO, permission, authorization rule, index, dependency,
> frontend or existing test was changed. It closes **no** Open Question, promotes
> **no** ADR, reopens **no** accepted task and reinterprets **no** Owner decision.
> Where the repository is ambiguous it is recorded; where Task 20 found missing
> Owner decisions, this update records the Owner-provided resolutions without
> implementing production behavior.

**Evidence labels used throughout** (following `STATE.md` §1): _verified
implementation_ = inspected static code/schema at the baseline above, not runtime
validation; _recorded_ = a statement in an existing repository file; _Agent
inference_ = explicitly labelled reasoning that is not itself repository evidence.

---

## 1. Executive Summary

Task 20 first investigated the requested domains (Base Accounting Structure,
Control Roles, POSTING vs AGGREGATION, Account Code History, Detail / Floating
Detail / Dimensions) and escalated six Owner Decisions. The Owner has now
resolved those decisions explicitly. This document therefore records the same
repository evidence **plus** the decision-resolution outcome.

**Decision-resolution outcome:**

1. **OD-20-1 — Base Chart:** resolved as a versioned Accounting-owned
   database/product template asset adopted explicitly into an organization;
   adoption creates organization-owned `Account` identities; template identities
   never become ledger references. Content remains accountant/domain-approved and
   is not invented here.
2. **OD-20-2 — Control Roles:** resolved as **consumer-first**; Vardena does not
   create a speculative broad catalog before a concrete approved consumer needs a
   role.
3. **OD-20-3 — Control Role Artifact Shape:** resolved as an independent
   effective-dated mapping. `Account.control_role` is explicitly rejected as the
   primary architecture.
4. **OD-20-4 — Account Code History:** resolved as `Account.id` permanent
   identity and `Account.code` business-facing address; controlled pre-use code
   correction is permitted, after accounting use code is immutable, and history is
   designed with a real producer.
5. **OD-20-5 — POSTING vs AGGREGATION:** resolved as
   `POSTING = leaf-only` and `AGGREGATION = reporting/read-time roll-up`. The
   existing Task 18 Trial Balance / General Ledger roll-up model is valid under
   this invariant. D-1 is resolved; non-leaf posting is not authorized.
6. **OD-20-6 — Dimensions:** resolved as transaction-line-level analytical
   assignments with aggregation through the Accounting/read layer when a concrete
   reporting consumer requires it; no ledger-entry dimension identity, generic
   JSONB or speculative projection.

**Gate outcome:** **READY FOR REVIEW — NOT ACCEPTED** (see §13 and the gate
document). This remains documentation-only. No production code, schema, migration,
API, DTO, permission, service, repository, frontend, seed or test changed. Task 19
ODR-1/ODR-2/ODR-3 are not reopened or modified.

## 2. Repository Baseline

### 2.1 Governance sources read

`.vardena/agent-rules.md` · `.vardena/architecture-rules.md` (referenced) ·
`STATE.md` (§1–§11) · `docs/accounting/task-index.md` (§1–§9) ·
`docs/accounting/domain-contract.md` (§1.2, §2.3, §8, §9, §10, §11, §12.3/§12.4,
§13.6, §14, §15, §19, §25, §31) · `docs/accounting/owner-decision-baseline.md`
(Q1–Q22, I-1…I-3, D-1…D-13, O-1…O-12, §11 ODR-1…ODR-3) · `docs/open-questions.md`
· `docs/adr/README.md` · ADR-0033 / ADR-0034 / ADR-0035 / ADR-0036 / ADR-0037 ·
`docs/tasks/task-19/{accounting-chart-configuration-investigation.md,
task-19-implementation-gate.md, task-19-implementation-report.md,
task-19-acceptance-record.md}` · `docs/testing/test-execution-policy.md`.

### 2.2 Implementation inspected (read-only)

Paths below are relative to `backend/`; `accounting/…` means
`src/modules/accounting/…`.

| Area                               | Files inspected                                                                                                                                                                                                                           | State at baseline                                                                                                                                                                                                                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account model                      | `prisma/schema/accounting.prisma` (`model Account`, lines 320–403)                                                                                                                                                                        | `id`, `organization_id`, `code VarChar(32)`, `title`, `parent_id`, `level`, `coding_structure_version_id`, `accounting_configuration_id`, `account_nature`, `is_postable`, `is_active`, audit columns. **No** `account_type`, `is_temporary`, `control_role`, dimension or code-history column. |
| Coding structure                   | `prisma/schema/accounting.prisma` (`CodingStructureVersion`, `CodingStructureLevel`), `accounting/domain/coding-structure.ts`                                                                                                             | Versioned `draft→active→superseded`; `max_depth`, per-level `digit_length`, `title`, `default_is_postable`, nullable informational `level_kind`; caps `MAX_CODING_STRUCTURE_DEPTH = 8`, `MAX_ACCOUNT_CODE_LENGTH = 32` (code constants).                                                        |
| Accounting configuration + levels  | `AccountingConfiguration` / `AccountingConfigurationLevel` (Task 11), `accounting/domain/accounting-configuration.ts`, `accounting/application/accounting-configurations.service.ts`, `accounting/data/accounting-configuration-usage.ts` | Versioned root, one ACTIVE per organization, `operationally_used_at` freeze marker (Task 13).                                                                                                                                                                                                   |
| Account repository                 | `accounting/data/accounts.repository.ts`                                                                                                                                                                                                  | Locked write transactions; placement + code + postability + **ODR-1 pin-coherence** re-check (`assertSnapshotCoherence`, lines 300–303, 468).                                                                                                                                                   |
| Accounts service                   | `accounting/application/accounts.service.ts`                                                                                                                                                                                              | Pre-flight validation, permissions, organization chokepoint.                                                                                                                                                                                                                                    |
| Chart Tree (ODR-2)                 | `accounting/application/chart-tree.service.ts`, `accounting/api/chart-tree.controller.ts`, `accounting/api/dto/chart-tree.dto.ts`                                                                                                         | Read-only, organization-scoped, fixed `code ASC` order, explicit `sort` rejected, reuses `AccountsRepository`; no balances, no invented classification.                                                                                                                                         |
| Organization authorization (ODR-3) | `prisma/schema/organization.prisma` (`OrganizationMembership`), `migrations/20260926000000_organization_membership`, organization services                                                                                                | Composite PK `(user_id, organization_id)`; presence **is** the authorization; `assertOrganizationInScope` chokepoint.                                                                                                                                                                           |
| Task 17 read layer                 | `accounting/domain/ledger-movement.ts`, `accounting/application/ledger-movements.service.ts`, `accounting/domain/account-statement.ts`, `accounting/application/account-statements.service.ts`                                            | Read-only movement + statement surfaces over `accounting.ledger_entries`; statement is restricted to a **postable** account (service lines 130–135).                                                                                                                                            |
| Task 18 read layer                 | `accounting/data/accounting-read-query.repository.ts`, `accounting/application/{general-ledger,trial-balance}.service.ts`, `accounting/domain/{general-ledger,trial-balance}.ts`                                                          | Shared read/query repository; GL + TB; TB rows carry an explicit `role: 'POSTING' \| 'AGGREGATION'`.                                                                                                                                                                                            |
| Trial Balance roll-up              | `accounting/data/accounting-read-query.repository.ts` lines ~707–830 (and the twin count query ~882–925)                                                                                                                                  | `posting_accounts` = `is_postable = true`; recursive `account_rollup` maps each posting account to itself and every ancestor; `trial_rows` `SUM`s over that mapping `GROUP BY report_account_id`; `role` = `CASE WHEN "isPostable" THEN 'POSTING' ELSE 'AGGREGATION' END`.                      |
| Ledger entry                       | `prisma/schema/accounting.prisma` (`LedgerEntry`), `accounting/domain/ledger-entry.ts`, `accounting/data/ledger-entries.repository.ts`                                                                                                    | Insert-only; references `account_id`; stores `document_date` + `posting_timestamp` + resolved `fiscal_year_id`/`accounting_period_id`; **stores no account code**; `dimensionAssignments` is a typed domain seam always materialized as `[]` (repository lines 240–242).                        |
| Permissions                        | `accounting/domain/accounting-permissions.ts`                                                                                                                                                                                             | 38 distinct `Accounting.*` codes at this baseline.                                                                                                                                                                                                                                              |
| Seeds / templates                  | `prisma/`                                                                                                                                                                                                                                 | Contains `migrations`, `rehearsal`, `schema` only — **no seed script, no chart template artifact**.                                                                                                                                                                                             |

### 2.3 Negative findings (verified absences)

A repository-wide search for `control_role` / `controlRole`, dimension tables,
cost centre, project and code-history identifiers returns **no production model,
column, table, service or endpoint**. The only hits are comments recording the
deferral (`prisma/schema/accounting.prisma` header lines 30–50;
`accounting/domain/ledger-entry.ts` §"Deferred dimension seam (OQ-41)";
`accounting/data/ledger-entries.repository.ts` lines 240–242;
`accounting/domain/balance-projection.ts` lines 15 and 243). This confirms the
`owner-decision-baseline.md` §1 fact row ("Control roles, dimensions, floating
details, posting rules … are contract-only — not implemented") is still accurate
after Task 19.

---

## 3. Task 19 Boundary

Task 19 is **ACCEPTED (2026-09-26)**
(`docs/tasks/task-19/task-19-acceptance-record.md`). ODR-1 (Explicit
Configuration Coherence), ODR-2 (Accounting-owned Chart Tree) and ODR-3
(Principal-bound Organization Authorization) are **CLOSED** for Task 19 and are
not redesigned, extended or reopened here.

Two forward dependencies are recorded — **dependencies, not defects, and not
changes to Task 19**:

| Id                | Type               | Statement                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T20-T19-DEP-1** | TASK-19 DEPENDENCY | A future Vardena base structure must be delivered as a **coherent pin pair** (`coding_structure_version` and `accounting_configuration` describing the same level count and the same per-level digit lengths). ODR-1's `planPinCoherence` (`accounting/domain/account.ts` lines 440–462) rejects any account write whose two pins disagree. A base chart shipped as one side only would be correctly refused. No change to ODR-1 is implied or requested. |
| **T20-T19-DEP-2** | TASK-19 DEPENDENCY | Any future base-chart adoption operation, control-role mapping surface or dimension administration surface is organization-scoped and therefore must pass the ODR-3 chokepoint `OrganizationsService.assertOrganizationInScope` (membership → permission), preserving the accepted 404 isolation posture. No new bypass, wildcard or bootstrap exception may be introduced for them. No change to ODR-3 is implied or requested.                          |

Neither dependency requires a new ADR by itself. Both are constraints on future
work, recorded so a later implementer cannot "discover" them late and be tempted
to weaken Task 19.

---

## 4. Base Accounting Structure (Domain A)

### 4.1 Current Implementation

**A1 — what the repository represents as Group / General / Subsidiary / Detail.**

_Verified implementation:_ those four names exist in exactly two places, neither
of them a hard-coded database semantic:

1. `accounting/domain/coding-structure.ts` — `ACCOUNT_LEVEL_KINDS = ['group',
'general', 'subsidiary', 'detail']`, stored in the nullable
   `coding_structure_levels.level_kind` column. The schema comment is explicit:
   _"Informational label only … NOTHING derives behaviour from it"_, duplicates
   across levels are allowed and the list may be shorter than `max_depth`.
2. `coding_structure_levels.title` / `accounting_configuration_levels` titles —
   free organization-configured text (contract §8.1: level titles are
   organization configuration).

There are deliberately **no** `groups` / `generals` / `subsidiaries` / `details`
tables (schema header lines 24–27; contract §8.2 AC-D-07). The whole chart is one
`accounts` table using adjacency (`parent_id`) plus a derived integer `level`.

**A2 — supported capabilities.**

| Capability                              | State                                | Evidence                                                                                                                                                                            |
| --------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configurable number of levels           | **IMPLEMENTED**                      | `coding_structure_versions.max_depth` (1..8), `accounting_configuration_levels`; `MAX_CODING_STRUCTURE_DEPTH = 8` is a code constant, not policy                                    |
| Level ordering                          | **IMPLEMENTED**                      | `level_index` (1-based, unique per version); every level `1..maxDepth` must exist before activation                                                                                 |
| Level names                             | **IMPLEMENTED**                      | `coding_structure_levels.title` (VarChar 200, Persian-capable)                                                                                                                      |
| Level codes / digit lengths             | **IMPLEMENTED**                      | `digit_length` per level; total capped by `MAX_ACCOUNT_CODE_LENGTH = 32`; canonical code = concatenation (`accounting/domain/account-code.ts`)                                      |
| Level kind                              | **IMPLEMENTED (informational only)** | nullable `level_kind` from a closed code list; no behaviour derives from it                                                                                                         |
| Per-level posting default               | **IMPLEMENTED**                      | `default_is_postable` (a default, overridable per account — contract §14 rule 4)                                                                                                    |
| Parent/child relationships              | **IMPLEMENTED**                      | `parent_id` self-FK `RESTRICT`; child `level` = parent `level` + 1; child code must extend the parent code by exactly the level's digit length (§9.3), validated on create and move |
| Depth limits                            | **IMPLEMENTED**                      | per-version `max_depth` + the code-constant cap of 8                                                                                                                                |
| Version pinning                         | **IMPLEMENTED**                      | `accounts.coding_structure_version_id` and `accounts.accounting_configuration_id`, both NOT NULL; a new version never reinterprets existing accounts (§9.4)                         |
| Pin coherence                           | **IMPLEMENTED (new writes only)**    | ODR-1 `planPinCoherence`, applied in service and re-applied inside the locked transaction; existing divergent rows are **not** repaired (OQ-62/OQ-63 OPEN)                          |
| Chart Tree read surface                 | **IMPLEMENTED**                      | ODR-2 `GET /api/v1/accounting/chart-tree` and `/:id`                                                                                                                                |
| **Vardena base/standard chart content** | **OWNER-DECIDED / NOT IMPLEMENTED**  | Q2 + ADR-0037 §3; contract §1.2 non-goal 1; no seed script, no template artifact, no adoption endpoint                                                                              |

**A3 — classification of Domain A parts.**

```text
IMPLEMENTED                     : configurable depth/ordering/titles/digit lengths/level kind,
                                  parent-child rules, depth caps, version pinning,
                                  ODR-1 coherence (new writes), ODR-2 chart tree read
IMPLEMENTED-PARTIAL             : pin coherence (writes guarded; pre-existing divergent rows unrepaired)
OWNER-DECIDED / NOT IMPLEMENTED : the Vardena base structure itself (Q2, ADR-0037 §3, D-5)
ADR-PROPOSED                    : ADR-0037 (configuration boundary) — Proposed
OPEN QUESTION                   : base-structure content, level/digit defaults, per-level posting
                                  policy (OQ-25); pin repair/legacy shape (OQ-62/OQ-63)
UNKNOWN                         : none in this domain — every question above resolved to one of
                                  the categories from repository evidence
```

### 4.2 Owner Decisions

**A4 — what "Vardena provides a base structure and the organization configures
it" actually means from repository evidence.**

The decision is **Q2** (`owner-decision-baseline.md` §2), elaborated by
**ADR-0037 §2/§3** (Proposed). From those sources, and from nothing else:

- Vardena owns accounting/control **semantics** — invariants, control roles,
  level mechanics, the shape of posting rules, reporting sources (ADR-0037 §2).
- The organization owns its **account structure** — levels, titles, digit
  lengths, accounts, role mappings — as versioned configuration data inside the
  supported model (ADR-0037 §2).
- The base structure must ship as **versioned configuration data or a template
  artifact** — explicitly **never** as per-customer code branches, **never** as
  hard-coded account rows in domain logic, and **never** as a seed that silently
  creates accounts in an existing organization (ADR-0037 §3).
- Its **content** — codes, Persian titles, level shape, role mappings — is
  **EXPERT-GATED under OQ-25** and is _not_ decided (ADR-0037 §3; baseline D-5).

_Therefore:_ "base structure" is currently a **delivery-shape commitment with no
content**. Nothing in the repository states which accounts, codes, titles, levels
or natures a Vardena base chart contains, and contract §1.2 non-goal 1 explicitly
refuses to define them. **The actual content of the Vardena base structure has
not been decided** → recorded as Owner Decision candidate **OD-20-1** (§13). This
investigation invents no part of it.

### 4.3 ADRs

| ADR          | Status                  | Relevance to Domain A                                                                                                                                             |
| ------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ADR-0037** | **Proposed**            | §1 bounded configurable level count; §2 hybrid model; §3 base structure exists as a commitment, content expert-gated; §8 configuration may not violate invariants |
| ADR-0028     | Proposed (pre-existing) | Versioned configuration, single ACTIVE, operational freeze — the mechanism a base chart must respect                                                              |
| ADR-0035     | Proposed                | Any later **re-coding** of an adopted chart is migration-service territory, not base-chart territory                                                              |
| ADR-0033     | Proposed                | `Account.id` permanence — a base chart must not make a base code an identity                                                                                      |

No ADR is promoted, amended or created by this task.

### 4.4 Gaps

**A5 — would creating a standard/base chart conflict with existing invariants?**
Evaluated one by one; each row is an architectural consequence derived from cited
repository evidence, not a generic ERP assumption:

| Against                             | Conflict?                                   | Reasoning and evidence                                                                                                                                                                                                                                                                                          |
| ----------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Account.id` permanent identity     | **No conflict, with one constraint**        | Adopted accounts get their own organization-scoped ULIDs. The _template_ node id must never leak into ledger references; ledger rows reference `account_id` only (`LedgerEntry`, ADR-0031 §2). Constraint: a template identifier, if kept, is provenance metadata — never an accounting identity (ADR-0033 §1). |
| Code semantics                      | **No conflict, with one constraint**        | Codes are digits-only, unique per organization and composed from the pinned structure (§9.2/§9.3). A base chart's codes must be valid under the organization's chosen digit lengths; a base chart therefore cannot be shape-agnostic — it is bound to a level shape or must be parameterized by one.            |
| Configuration pin coherence (ODR-1) | **Constraint — T20-T19-DEP-1**              | Adoption must produce/consume a coherent `(coding_structure_version, accounting_configuration)` pair, or writes are rejected by `planPinCoherence`.                                                                                                                                                             |
| POSTING / AGGREGATION               | **Constraint**                              | A base chart must not mark a node `is_postable = true` and then give it children: `planPostabilityChange` and the `parent_postable` placement rule refuse both directions (`accounting/domain/account.ts`). Postability in a base chart must be assigned leaf-last or derived from `default_is_postable`.       |
| Organization isolation              | **No conflict, with one constraint**        | Adoption is an organization-scoped write and must pass the ODR-3 chokepoint (T20-T19-DEP-2). A global template table would be deployment-level, not organization-level, data — a new ownership question (part of **OD-20-1**).                                                                                  |
| Task 19 Chart Tree (ODR-2)          | **No conflict**                             | The tree surface reads whatever accounts exist; adopted accounts appear automatically with no surface change.                                                                                                                                                                                                   |
| Existing Account model              | **No conflict for the accounts themselves** | Adoption creates ordinary `accounts` rows. _Provenance_ (which template version produced this account) has **no column today** and AR-29 forbids adding one before a consumer exists. Whether provenance is required is part of **OD-20-1**.                                                                    |
| Operational freeze (Task 13)        | **Constraint**                              | A configuration marked `operationally_used_at` is never mutated in place (ADR-0028 §3). Adoption into an organization that has already posted must therefore create accounts, never rewrite the frozen configuration.                                                                                           |

No **contradiction** was found in Domain A. Every item above is a constraint or a
gap.

**A6 — the minimum future data model (documented, NOT implemented).** _Agent
inference, derived from the repository's own patterns (versioned configuration
per ADR-0028, typed rows per AR-29, no EAV/JSONB per ADR-0037 §7) — this is a
sketch for an Owner decision, not a design authorization:_

```text
Base chart template (Vardena-owned, deployment-level, versioned)
  template_version      : id, code, version_number, status(draft|active|superseded),
                          level_shape reference or parameterization, audit
  template_level        : template_version_id, level_index, title, digit_length,
                          default_is_postable, level_kind?
  template_node         : template_version_id, node_key, parent_node_key?, level,
                          code_segment, title(fa), account_nature, is_postable
  template_role_mapping : template_version_id, node_key, control_role   (Domain B — only if
                          control roles exist; otherwise omitted entirely)

Adoption (organization-scoped, audited, permission-gated, ODR-3 bound)
  adoption_record       : organization_id, template_version_id, adopted_at, actor,
                          resulting coding_structure_version_id + accounting_configuration_id
  (optional) accounts.template_node_key — provenance; ONLY if OD-20-1 decides provenance
                          is required, because AR-29 forbids a speculative column
```

Minimum invariants such a model must satisfy, all derived from existing rules:
adoption never mutates an existing chart (ADR-0037 §3); adoption produces a
coherent pin pair (ODR-1); no adopted node is postable-with-children (§14 rule 2);
adoption is refused or scoped explicitly when the target configuration is
operationally frozen (ADR-0028 §3); re-coding an adopted chart later is ADR-0035
territory, not adoption.

### 4.5 Risks

| Risk                                                 | Consequence                                                                                                                                   | Mitigation recorded                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Inventing base chart content                         | Violates AG-09/AR-31 and OQ-25's expert gate; ships an accounting opinion as product                                                          | Content stays with **OD-20-1**; nothing invented here                |
| Base chart shipped as a Prisma seed                  | Contradicts ADR-0037 §3 ("never a seed that silently creates accounts in an existing organization") and there is no seed infrastructure today | Delivery shape is an explicit option in **OD-20-1**                  |
| Base chart bound to one level shape                  | An organization that configures a different digit shape cannot adopt it; ODR-1 rejects incoherent pins                                        | Parameterization vs fixed shape is an explicit option in **OD-20-1** |
| Adding an `accounts` provenance column speculatively | AR-29 violation (no speculative columns before a consumer)                                                                                    | Provenance made an explicit sub-question of **OD-20-1**              |

---

## 5. Control Roles (Domain B)

### 5.1 Current Implementation

**B1 — does any `control_role` model/field/table/service exist?**
**No.** _Verified implementation:_ zero occurrences in `prisma/schema/*.prisma`
and zero production identifiers in `src/`. The only references are deferral
comments: `prisma/schema/accounting.prisma` header ("`control_role` (§8.7) and
coding-structure `reserved_ranges` (§9.1): both are posting-rule inputs whose
purpose vocabulary is OQ-25 → deferred with the posting task that consumes
them"). Classification: **OWNER-DECIDED / NOT IMPLEMENTED**.

**B2 — does any current code map standard business roles to Accounts?**
**No.** Posting (`accounting/application/posting.service.ts`,
`accounting/domain/posting.ts`) resolves accounts by `account_id` supplied on
document lines; posting readiness (`accounting/domain/posting-readiness.ts`)
checks existence/activity/postability and never a role. There is no
Inventory→Accounting posting rule (task-index §4: "Posting rules / account
mapping" is a Candidate blocked by OQ-24/OQ-25/OQ-30; contract §20.4 activation
gate). No report, DTO or permission names a role.

### 5.2 Owner Decisions

**B3 — which control roles are explicitly Owner-decided?**
**None individually.** What is decided is the _mechanism_:

- **Q4 / ADR-0037 §4:** the role vocabulary is **Vardena-standardized and
  code-defined** (adding a role is a code change, the ADR-0023 §2 pattern);
  organizations map **their own accounts** to those roles once, as
  **effective-dated, permission-gated, audited configuration**; posting rules and
  statutory profiles reference **roles, never free customer codes**.
- **Q4 / ADR-0037 §5:** mandatory-ness is **demand-driven** — a role becomes
  required when a shipped operation consumes it, not because a fixed list says so.

The _catalog_ is explicitly not decided. Contract §8.7 lists `receivable`,
`payable`, `inventory`, `cogs`, `revenue`, `tax_payable`, `cash`, `bank`,
`opening_equity`, `retained_earnings`, `closing_clearing` and then states they are
**"placeholders from `accounting-domain-analysis.md` §2, not a decision"**, with
"the role list itself and which roles are mandatory are expert-gated" (OQ-25).
The example roles named in the Task 20 brief (Receivable, Payable, Cash, Bank,
Inventory, Sales, Expense) are therefore **not approved** by any repository
source, and this investigation does not approve them.

**B4 — mandatory / optional / conditionally required.**
Repository answer (ADR-0037 §5 + Q4): the only decided classification rule is
_conditional on an active operation_. There is **no** repository source declaring
any specific role mandatory, optional or conditional. Producing such a table here
would be invention (AG-09).

**B5 — architectural implications of "standard control roles mapped to
organization accounts; only active-operation-needed roles mandatory".** Derived
strictly from ADR-0037 §4/§5, contract §8.7 and AR-29:

1. **Consumer-first ordering.** OD-20-2 makes the repository inference an Owner
   decision: the first role set arrives with its first concrete approved consumer
   (a posting rule, reconciliation/reporting consumer, settlement flow, etc.), not
   as a standalone speculative catalog.
2. **Two artifacts, not one.** A _role_ (code-defined vocabulary) and a _mapping_
   (organization data: role → account, effective-dated, audited) are different
   artifacts with different lifecycles and different change-control (code change
   vs configuration change).
3. **Validation surface.** "Mandatory when consumed" means the mandatory check
   belongs to the **consuming operation's readiness/validation path**, not to
   account administration — otherwise creating a chart would fail for roles no
   shipped operation uses.
4. **Mapping targets must match the consumer.** _Agent inference:_ a role used by
   an automated posting rule must resolve to an account a line may reference, and
   contract §14 rule 1 restricts lines to postable, active accounts. Whether a
   reporting-only role may target an aggregation node remains a future consumer
   design/content question under OQ-25; OD-20-3 decides the mapping artifact shape,
   not every target policy.
5. **Immutability interaction.** `is_postable` and structure are immutable after
   use (§8.4 rule 4); remapping a role after postings exist changes _future_
   behaviour only and must never rewrite history — effective dating (§8.7 "D-21")
   is the recorded mechanism for that.

**B6 — where role mapping lives.** Candidate analysis from the original
investigation, with OD-20-3 now resolving the choice:

| Candidate                                                         | Repository support                                                                                                            | Tension                                                                                                                                                   |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Nullable `accounts.control_role` column**                       | Historical contract §8.3 wording listed `control_role` as a conceptual account attribute                                      | **Rejected by OD-20-3** as the final architecture; cannot express effective dating or reassignment, and AR-29 blocks speculative schema before a consumer |
| **Separate effective-dated mapping relation**                     | Contract §8.7 + ADR-0037 §4: "a role mapping is configuration data with its own permission, audit trail and effective dating" | **Chosen by OD-20-3**; no table exists and implementation is deferred until a consumer-driven task                                                        |
| **Attribute of the accounting configuration version**             | ADR-0028 versioning + operational freeze already model organization configuration                                             | Freeze semantics would make remapping after first use impossible without a new version — may or may not be desired                                        |
| **Another bounded model (e.g. owned by the consuming operation)** | AR-29 consumer-first posture                                                                                                  | No consumer exists yet                                                                                                                                    |

**Resolved ambiguity — T20-C-1 (documentation level).** Contract §8.3 previously
described `control_role` as a nullable account attribute, while §8.7 and
ADR-0037 §4 described an effective-dated configuration mapping. **OD-20-3 resolves
this conflict:** the future authoritative artifact is an independent
effective-dated Account↔Control Role assignment. `Account.control_role` is not
the chosen final architecture. Implementation remains deferred until a real
consumer requires a role.

### 5.3 Cross-module dependencies

**B7 — interaction check (documentation only; no integration designed here).**

| Module                                      | State at baseline                                                                                                                                                              | Interaction with control roles                                                                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Inventory**                               | Implemented (ledger, master data); Inventory→Accounting integration is a **Candidate blocked by OQ-24/OQ-25/OQ-30/OQ-39** (task-index §4; contract §20, activation gate §20.4) | The canonical first consumer named by the repository: automated inventory postings must resolve accounts by role, never by customer code (contract §8.7, D-12) |
| **Documents**                               | Implemented (Document Foundation, ADR-0019/0023); accounting vouchers use it                                                                                                   | No role interaction today; document _types_ are the ADR-0023 §2 code-defined precedent ADR-0037 §4 points at for role vocabulary                               |
| **Accounting Posting**                      | Implemented (`PostingService`, `finalizeChecked`)                                                                                                                              | Posting resolves `account_id` from lines; role resolution would be an input to a _posting rule_, upstream of posting, never inside ledger materialization      |
| **Future Treasury / Cash Book / Bank Book** | Does not exist                                                                                                                                                                 | Out of scope (§19 of the brief); would be a future consumer of cash/bank-type roles if the Owner defines them                                                  |
| **Future AR / AP**                          | Does not exist                                                                                                                                                                 | Would be a future consumer of receivable/payable-type roles; subledger/reconciliation-account role is listed as a _reserved, deferred_ seam in contract §8.3   |
| **Future Sales / Purchase**                 | Does not exist                                                                                                                                                                 | Same pattern; no repository commitment                                                                                                                         |
| **Legal Adapter / Legal Profile**           | Does not exist; ADR-0036 Proposed                                                                                                                                              | ADR-0037 §4: statutory profiles reference **roles**, never free customer codes — so the role catalog is upstream of any legal book work (OQ-43)                |

### 5.4 Gaps

```text
OWNER-DECIDED / NOT IMPLEMENTED : role vocabulary is code-defined (ADR-0037 §4);
                                  sequencing is consumer-first (OD-20-2);
                                  mapping is independent effective-dated configuration
                                  (OD-20-3); mandatory-ness is demand-driven
OPEN QUESTION                   : the concrete role catalog, mandatory set and
                                  consumer-specific target policies (OQ-25)
RESOLVED                        : T20-C-1 — §8.3 column vs §8.7 mapping resolved
                                  in favor of the effective-dated mapping
ADR-PROPOSED                    : ADR-0037 (§4/§5) — Proposed, not Accepted
```

### 5.5 Risks

| Risk                                                                   | Consequence                                                                                                                 |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Adopting the §8.7 example list as the catalog                          | Ships an unvalidated accounting opinion; contract explicitly calls them placeholders (AG-09 violation)                      |
| Building the role table before a consumer                              | AR-29 speculative-schema violation; a role set with no consumer cannot be validated and cannot be "mandatory when consumed" |
| Implementing `Account.control_role` despite OD-20-3                    | Violates the resolved architecture; loses effective dating and audit semantics                                              |
| Letting an integration hard-code account codes while roles are pending | Exactly the failure mode D-12/§8.7 exists to prevent; recorded as a review rule for any future integration task             |

---

## 6. POSTING vs AGGREGATION (Domain C)

### 6.1 Current invariant

**C1 — the exact current invariant.** _Verified implementation_, three
cooperating rules:

1. **`is_postable` is a validated stored account attribute**, never inferred from
   a level name or a code prefix (`accounts.is_postable`; contract §14 rule 1).
2. **`postable ⇒ leaf`, enforced in both directions:**
   - `planPostabilityChange({isPostable, hasChildren})` returns
     `'postable_with_children'` — setting `is_postable = true` on an account with
     children is refused (`accounting/domain/account.ts` ~line 520);
   - the placement check returns `'parent_postable'` — creating the first child of
     a postable account is refused (`accounting/domain/account.ts` ~line 270,
     message at ~line 491: _"A postable account cannot have children: posting to
     both a parent and its children would double-count its rollup"_).
     Both are re-applied inside the locked repository transaction
     (`accounting/data/accounts.repository.ts`).
3. **Postability is immutable after use** — changing `is_postable` on an account
   with lines is refused (§8.4 rule 4 / §14 rule 5), so a historical rollup cannot
   silently change meaning.

A leaf may still be non-postable (§14 rule 3): the rule is `postable ⇒ leaf`, not
`postable ⇔ leaf`.

### 6.2 Current implementation of the semantic role

**C2 — can an account currently be both POSTING and AGGREGATION?** **No.**
The role is derived, total and mutually exclusive: `is_postable = true` ⇒ POSTING
(and, by rule 2, childless), `false` ⇒ AGGREGATION. Task 18 makes this explicit
in the read model: `accounting/data/accounting-read-query.repository.ts` emits
`CASE WHEN "isPostable" THEN 'POSTING' ELSE 'AGGREGATION' END AS "role"` and
`accounting/domain/trial-balance.ts` types it as
`role: 'POSTING' | 'AGGREGATION'`. Invariant **I-2 holds today** — by a stricter
rule than I-2 itself requires (`owner-decision-baseline.md` §3 I-2 repository
status; ADR-0034 §6).

### 6.3 Owner decision resolution

**OD-20-5 resolves D-1.** Vardena keeps the existing accounting invariant:

```text
POSTING = leaf-only
AGGREGATION = reporting/read-time roll-up
```

Non-leaf accounts such as `کل` and `گروه` are aggregation/reporting nodes and are
not direct posting targets. Accounting movements are recorded at the lowest
posting leaf level. Parent-level values shown by Trial Balance / General Ledger /
future reports are derived upward from descendants.

Critical consequence: the same movement MUST NOT be independently posted to
`معین`, `گروه` and `کل`. That would duplicate accounting amounts. A report may show
the derived aggregate at multiple hierarchy levels, but those rows are views over
the same underlying leaf postings.

### 6.4 Reporting implications

The Task 18 roll-up is a recursive mapping from posting accounts to themselves and
ancestors, followed by `SUM` grouped by the reported account. Under OD-20-5 this
model is valid because `posting_accounts` are leaf accounts. The parent rows are
derived aggregation rows, not additional source movements.

No own-vs-descendant balance measures are required for Task 20, because non-leaf
POSTING is not supported. If a future approved business requirement needs
non-leaf posting, it must become a new explicit architecture decision and reopen
ADR-0034/contract/read-model semantics through a future task.

### 6.5 Risks

| Risk                                                              | Consequence                    | Task 20 resolution                                                        |
| ----------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------- |
| Posting the same movement to leaf and parent levels               | Duplicate accounting amounts   | Forbidden by OD-20-5                                                      |
| Treating parent report totals as additional organization activity | Overstated totals              | Parent values are derived roll-up views only                              |
| Relaxing `postable ⇒ leaf` as a small validation change           | Breaks accepted read semantics | Requires a new explicit future architecture decision; not authorized here |

## 7. Account Code History (Domain D)

### 7.1 Current implementation

| Question                                                                                               | Answer                                  | Evidence                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1** — does an `AccountCodeHistory` model exist?                                                     | **No.**                                 | No model in `prisma/schema/accounting.prisma`; no migration under `prisma/migrations/`; no domain/service file                                                                                                                                                                                                            |
| **D2** — does the repository preserve historical codes?                                                | **No — and it does not need to today.** | One code per account, immutable; no historical row anywhere stores a code (`LedgerEntry`, `AccountingDocumentLine`, `AccountBalanceProjection` all key on `account_id`)                                                                                                                                                   |
| **D3** — can an Account's code currently change?                                                       | **No.**                                 | `accounting/domain/account.ts`: "There is therefore NO code field on the update path"; `UpdateAccountDto` has no `code`; `PATCH /api/v1/accounting/accounts/:id` documents "The code is immutable"; contract §8.3                                                                                                         |
| **D4** — how are historical reports expected to resolve `Account.id` + date → historically valid code? | **Decided as a rule, not implemented.** | `owner-decision-baseline.md` §4: `Report Date → Account.id → Historical Code Resolution → Report`; Q18 (Decision D); ADR-0033 §4. Today every read surface renders the **current** code (`a."code"` in the Task 18 SQL; `accountCode` in TB/GL/statement rows), which is _vacuously_ correct because a code never changes |

Classification: **OWNER-DECIDED / NOT IMPLEMENTED** (baseline discrepancy **D-3**).

### 7.2 ADR-0033

**Status: Proposed.** Alignment with the implementation:

| ADR-0033 clause                                                                 | Implementation alignment                                                                                                                                    |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §1 `Account.id` is the permanent identity                                       | **IMPLEMENTED** — document lines, ledger rows, projection key, opening logic all resolve by id                                                              |
| §2 `code` is a business/display identifier, never a semantic source             | **IMPLEMENTED** — the tree comes from `parent_id`; the code prefix is only its proof (§9.3); no classification is inferred from a code range                |
| §3 a code is a time-scoped fact; retain every code with its validity            | **NOT IMPLEMENTED**                                                                                                                                         |
| §4 historical resolution rule (as-at code, with current-code mapping available) | **NOT IMPLEMENTED**                                                                                                                                         |
| §5 opening identity keys on `Account.id`                                        | **IMPLEMENTED** (ADR-0031 §4; Task 17B D2)                                                                                                                  |
| §6 pre-use code change permitted in principle                                   | **NOT IMPLEMENTED — repository is stricter** (baseline D-2)                                                                                                 |
| §7 deletion vs deactivation                                                     | **PARTIALLY IMPLEMENTED — repository is stricter**: freeze-over-delete for every account, no delete endpoint, no `Accounting.Account.Delete` (baseline D-4) |
| §8 integrations reference accounts by id                                        | **No integration exists** to violate it                                                                                                                     |

### 7.3 Historical reporting implications

**D5 — interactions.**

| Surface                          | Interaction                                                                                                                | Consequence of adding code history                                                                                                                                                             |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ledger history                   | Stores `account_id`, `document_date`, `posting_timestamp`, resolved `fiscal_year_id` / `accounting_period_id`; **no code** | History is purely **additive**; no ledger row is touched (Invariant I-3 already structurally protected: the ledger repository is insert-only)                                                  |
| Trial Balance                    | Joins `accounts` for `a."code"`/`a."title"`                                                                                | Becomes an as-at resolution site; also a _sorting_ site — TB sorts by `accountCode`, so as-at codes change ordering. Requires an explicit decision, not a silent switch                        |
| General Ledger                   | Same join                                                                                                                  | Same                                                                                                                                                                                           |
| Account Statement                | Echoes the account's code in the scope/rows                                                                                | Same                                                                                                                                                                                           |
| Chart Tree (ODR-2)               | Fixed `code ASC` order is part of the contract                                                                             | _Agent inference:_ the chart tree is a **current-structure** surface; as-at rendering there would change an accepted ordering contract. Whether the chart tree ever becomes as-at is undecided |
| Legal Adapter / Legal Profile    | Does not exist; ADR-0036 §5 forbids using `Account.code` as permanent identity                                             | A profile must consume the resolution seam, never cache a code as a key                                                                                                                        |
| Future code migration (ADR-0035) | §4: a migration preserves `Account.id` and changes only the code representation/**history**                                | **Code history is a hard prerequisite of the migration service**, not an optional companion                                                                                                    |

**D6 — where should code history live?** Options derived from repository
evidence only:

| Option                                                                                               | Repository support                                                                                                                                      | Problem                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Additional columns on `Account` (e.g. `previous_code`)                                               | none                                                                                                                                                    | Cannot represent n codes with validity; ADR-0033 §3 requires _every_ code with its validity                                                                                                                                                               |
| **Separate historical relation** (account_id, code, valid-from/valid-to or fiscal-year scope, audit) | ADR-0033 §3's wording ("retain every code an account has carried with its validity"); the repository's typed-table posture (AR-29, no EAV/JSONB)        | Validity granularity (date range vs fiscal-year vs configuration version) is **undecided**; interaction with `uq_accounts_organization_id_code` and the never-reuse rule is **explicitly not decided** (ADR-0033 Consequences; baseline O-1; OQ-25/OQ-36) |
| Derive from an audit/event log                                                                       | Audit module is referenced by ADR-0035 §7 but persistent audit storage is "the Audit module's concern" and no such reporting-grade query surface exists | Not queryable as an as-at resolution source today                                                                                                                                                                                                         |

No option is chosen here.

**D7 — prerequisites for a future Account Code History implementation**
(assembled from ADR-0033, ADR-0035, OQ-25, OQ-36, OQ-62/OQ-63, and OQ-52/OQ-53
via ADR-0035 §3):

1. **A producer must exist.** _Verified implementation:_ no code can change today.
   A history store shipped now would contain exactly one row per account
   permanently. The producer is either (a) the pre-use code edit (baseline D-2,
   ADR-0033 §6 — not implemented, not authorized) or (b) the Code Structure
   Migration Service (ADR-0035 — not implemented, not authorized, and itself
   blocked by ADR-0030/OQ-45 licensing and OQ-52/OQ-53 backup/restore).
2. **ADR-0033 resolved through the repository's ADR lifecycle** (currently
   Proposed).
3. **A decision on whether a pre-use code edit writes history** — ADR-0033 §3
   leaves this open explicitly.
4. **A decision on code reuse of a superseded code** and on how history coexists
   with `uq_accounts_organization_id_code` and the never-reuse rule — baseline
   **O-1**, governed by **OQ-25/OQ-36**, both OPEN.
5. **A decision on which read surfaces resolve as-at, and their default** —
   changing TB/GL/statement rendering or ordering is a public behaviour change to
   accepted Task 17B/18 surfaces and needs its own Owner decision.
6. **OQ-62/OQ-63 posture** — ADR-0035 §2 requires preflight to detect pin
   divergence; both remain OPEN after Task 19 (which guards new writes only).
7. **OQ-52/OQ-53** are relevant only through the migration service (ADR-0035
   §3's Recovery/Backup Point stage), not to a history store itself.

_OQ-52/OQ-53 relevance check:_ relevant **indirectly** (migration-service
dependency), not as a direct prerequisite of a code-history table.

### 7.4 ADR-0035 dependency

ADR-0035 (Proposed) is the **only sanctioned path** for a post-use code change
(§1), binds an 11-stage pipeline (§2), forbids rewriting economic ledger history
(§4), rebuilds rather than edits derived data (§5), makes reconciliation a gate
(§6), and **excludes level-count migration** (§8, Q20). It records its own
unresolved dependencies: ADR-0033 §3 (code history), ADR-0030/OQ-45 (licensing —
no `license` schema/module exists, enforcement OFF), OQ-52/OQ-53, OQ-62/OQ-63,
and the Audit module.

**Net:** OD-20-4 breaks the ordering explicitly: do not ship a speculative
history-only table; design the history mechanism with a real producer (pre-use
code edit and/or ADR-0035 migration service).

### 7.5 Risks

| Risk                                                         | Consequence                                                                                          |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Shipping a history table with no producer                    | Speculative schema (AR-29); an unexercised, untestable store; false impression that Q18 is satisfied |
| Switching read surfaces to as-at rendering silently          | Changes accepted Task 17B/18 output and TB ordering without an Owner decision                        |
| Treating `code` as a join/cache key anywhere                 | ADR-0033 Consequences: "caching 'the account code' as a key becomes a defect"                        |
| Deciding code reuse implicitly through a unique-index choice | Pre-empts OQ-25/OQ-36 (baseline O-1)                                                                 |

---

## 8. Detail / Floating Detail / Dimensions (Domain E)

### 8.1 Current implementation

**E1 — what exists today.**

| Concept                            | State                                                                                                                                                                          | Evidence                                                                                                                                                                                                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Detail dimensions                  | **NOT IMPLEMENTED**                                                                                                                                                            | No `accounting_detail_dimensions` / `_groups` / `_items` / line-assignment table in `prisma/schema/accounting.prisma`; no migration                                                                                                                                                           |
| Account ↔ dimension links          | **NOT IMPLEMENTED**                                                                                                                                                            | none                                                                                                                                                                                                                                                                                          |
| Management fields on accounts      | **NOT IMPLEMENTED**                                                                                                                                                            | `Account` carries no analytical column                                                                                                                                                                                                                                                        |
| Cost centres                       | **NOT IMPLEMENTED**                                                                                                                                                            | no model anywhere in `prisma/schema/*.prisma`                                                                                                                                                                                                                                                 |
| Projects                           | **NOT IMPLEMENTED**                                                                                                                                                            | no model anywhere                                                                                                                                                                                                                                                                             |
| Branches                           | **IMPLEMENTED as Organization master data** (`organization.prisma` `model Branch`) and, per contract §12.4, a **document-header scope column** — _not_ an accounting dimension | `owner-decision-baseline.md`; OQ-22/OQ-55 posture: "Branch is an operational scope dimension only … no ledger presence until decided"                                                                                                                                                         |
| Detail entities / floating details | **NOT IMPLEMENTED**                                                                                                                                                            | contract §11 is contract-only (AC-D-15)                                                                                                                                                                                                                                                       |
| Ledger dimension seam              | **SEAM ONLY**                                                                                                                                                                  | `accounting/domain/ledger-entry.ts` defines an optional `LedgerDimensionAssignment` type and `dimensionAssignments` on the entry input; `accounting/data/ledger-entries.repository.ts` lines 240–242 materialize it as `[]` with the comment "OQ-41 is unresolved: no dimension model exists" |
| Balance projection                 | **Deliberately dimension-free**                                                                                                                                                | `accounting/domain/balance-projection.ts` line 15: "Branch, currency, detail dimensions are NOT part of the base key"; line 243: "already excludes dimensions / branch by construction"                                                                                                       |

**E2 — generic EAV / giant JSONB / universal dimension table?** **None exists.**
_Verified by inspection:_ `prisma/schema/accounting.prisma` contains no
JSON/JSONB column for dimensions and no polymorphic attribute-value table. This
is consistent with ADR-0037 §7, contract §10.6 and
`configurability-architecture.md` §5.2, all of which forbid both shapes. **Recorded
as a fact:** the repository has neither an EAV, nor a giant JSONB dimension blob,
nor a universal dimension table.

### 8.2 Owner decisions

- **Q6:** Vardena must support **both** tree-based Detail Accounts **and**
  Floating Detail Accounts; exact usage configurable (contract §11.2 AC-D-15:
  "the contract does not force an organization to choose"). **Mechanism
  CONFIRMED, implementation GAP** (baseline D-12).
- **Q7:** a configurable **general dimension model** (cost centre, project,
  branch, counterparty, …) with a configured count under a code-defined cap,
  typed item tables, optional logical master-data binding, and a per-(account,
  dimension) `requirement ∈ required | optional | forbidden`; **never** a giant
  EAV and **never** a giant JSONB for ledger dimensions (ADR-0037 §7;
  AC-D-11…AC-D-14, AC-I-18).
- The examples named in the brief (Cost Center, Project, Branch) are **uses** of
  dimensions, explicitly _not_ a finalized list: contract §11.3 states "Cost
  centre and project are **uses** of dimensions. Whether they exist as master
  data in Vardena, and whether they must be bound, is EXPERT-GATED (OQ-41, and
  OQ-22 for departments as dimensions)."

### 8.3 Domain ownership

**E3 — conceptual difference between account hierarchy and management
dimensions, from repository evidence** (contract §10.1, §11.1–§11.3):

|                   | Account hierarchy                                                 | Management dimension                                                                                       |
| ----------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Location          | Nodes of the `accounts` tree                                      | Outside the tree                                                                                           |
| Identity/code     | Part of the account code, prefix-constrained by the parent (§9.3) | Its own code inside its dimension (§10.2)                                                                  |
| Nature            | Each account has `account_nature`                                 | A floating detail has **no nature of its own**; it takes the side of the line it appears on (§11.1 rule 3) |
| Combination       | One account per combination → code explosion (§11.2)              | One item, reusable across any compatible account                                                           |
| Aggregation       | Parent rollup via `parent_id` (§8.5)                              | `GROUP BY` over the typed assignment table (§10.7)                                                         |
| Posting relevance | A line references exactly one account                             | A line may carry ≤ 1 item per dimension, bounded by N (§10.6 rule 3/5)                                     |

**E4 — where does Floating Detail belong?** Repository evidence, not generic ERP
knowledge: contract §11.1 rule 4 defines a floating detail as _"a row in
`accounting_detail_items` with FKs to its dimension (and optional parent item),
an optional master-data binding (§10.5), area applicability (§11.4) and
`is_active`"_. Contract §11.3 excludes it from being the Party, the Branch, the
Employee/Warehouse/Item, a cost centre/project by definition, or an EAV
attribute, and states that a binding "does not transfer ownership".

**Conclusion (repository-derived):** Floating Detail belongs to the
**Accounting-owned dimension model**, not to the Chart structure and not to
Party/master data; master data may be _bound_ logically (module + type + ULID,
never a cross-module FK — §10.5, AR-07/AR-08). Nothing here is decided beyond
what the contract already states.

### 8.4 Data-model implications

**E5 — should dimensions affect …?** Only documented consequences; no decision:

| Surface                | Repository-stated consequence                                                                                                                                                                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ledger entries**     | The domain seam already exists (`dimensionAssignments`), currently always empty. **OD-20-6 resolves the initial boundary:** dimensions are transaction-line-level analytical assignments and are not `LedgerEntry` identity; no ledger-side dimension columns or generic payload are the primary architecture. |
| **Posting**            | Validation at composition **and again at finalization** (§10.6 rules 1–5): only attached dimensions assignable, every `required` present, no `forbidden` present, ≤ 1 item per dimension per line, item active and area-applicable (AC-I-18)                                                                   |
| **Reporting**          | `GROUP BY` over the typed assignment table joined to lines/documents (§10.7) — detail ledger, dimension trial balance, counterparty statement, project cost report                                                                                                                                             |
| **Trial Balance**      | Account-keyed today. A "dimension trial balance" is named in §10.7 as a _future report_, and Task 18's TB has no dimension axis. Extending it is a new surface decision, not an automatic consequence                                                                                                          |
| **Account Statement**  | Account-keyed, one postable account (Task 17B D1). Dimension filtering/grouping would be an extension requiring its own decision                                                                                                                                                                               |
| **Balance projection** | Explicitly excludes dimensions from the key by construction; dimension-level balances would require either ledger-native aggregation (the Task 18 D5 posture: `accounting.ledger_entries` is authoritative) or a **new projection key**, which is a schema + rebuild-semantics decision (ADR-0031 §6)          |

### 8.5 Risks

| Risk                                                                      | Consequence                                                                                                                                                            |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implementing dimensions before OQ-41 answers                              | Count, per-dimension requirement defaults, master-data binding rules, item governance and area applicability would all be invented (AG-09)                             |
| Reaching for JSONB or EAV under schedule pressure                         | Direct violation of ADR-0037 §7, contract §10.6 and `configurability-architecture.md` §5.2                                                                             |
| Adding a dimension axis to the balance projection without a rebuild story | Breaks ADR-0031's rebuildable-projection invariant and AC-I-19 reconciliation                                                                                          |
| Treating Branch as an accounting dimension                                | Contradicts OQ-22/OQ-55's recorded posture (branch is a scope dimension with no ledger presence until decided) and contract §12.4 (branch on the header, not the line) |

### 8.6 Open dimension decisions (E6)

OQ-41 remains open for count; per-dimension requirement defaults; which dimensions
must bind to master data; who may define dimensions and items; item sharing across
accounts of different nature; and per-area item scoping. OQ-22 / OQ-55 still govern
branch/department-as-accounting-dimension questions. OD-20-6 resolves only the
initial persistence/aggregation boundary: line-level analytical assignments and
read-layer aggregation, with no speculative ledger widening or projection.

---

## 9. Cross-Domain Invariants

| Invariant                                                                                               | Verdict                                   | Evidence / qualification                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Identity** — `Account.id` is permanent identity                                                       | **HOLDS — IMPLEMENTED**                   | `LedgerEntry.accountId`, `AccountingDocumentLine.accountId`, `AccountBalanceProjection` key, opening logic; no historical row stores a code                                                                                                                     |
| **Historical code** — `code` is a business/display identifier with historical semantics                 | **PARTIAL**                               | "Business/display identifier, not identity" **holds**; "historical semantics" is **not implemented** (D-3). Vacuously satisfied today because a code can never change                                                                                           |
| **Posting** — POSTING / AGGREGATION                                                                     | **HOLDS — OD-20-5 RESOLVED**              | `postable ⇒ leaf` enforced on both write paths and re-checked in the locked transaction; TB/GL materialize the role explicitly. OD-20-5 makes this the authoritative product rule: POSTING = leaf-only, AGGREGATION = reporting/read-time roll-up.              |
| **Configuration** — coding structure and accounting configuration must remain coherent                  | **HOLDS for new writes; PARTIAL overall** | ODR-1 `planPinCoherence` (level count + per-level digit length) applied at root create, child create and move, re-applied in the locked transaction. Pre-existing divergent rows are **not** repaired; **OQ-62/OQ-63 remain OPEN**                              |
| **Organization isolation** — permission ≠ organization membership; Principal-bound authorization intact | **HOLDS**                                 | `organization_memberships` + `assertOrganizationInScope` chokepoint; 404 isolation preserved; membership administration bound after PR #55, with only the bounded first-grant bootstrap exception. Nothing in Task 20 touches it; OQ-01/OQ-22/OQ-19 remain OPEN |
| **Ledger** — ledger history is never rewritten by chart configuration changes                           | **HOLDS**                                 | Ledger repository is insert-only; accounts pin their configuration version and a new version never reinterprets them (§9.4); `operationally_used_at` freezes a used configuration (Task 13); no code is stored on any historical row                            |
| **Reporting** — Task 18 surfaces consume Accounting truth and are not a second Account master           | **HOLDS**                                 | TB/GL/statement read `accounting.ledger_entries` and join `accounting.accounts`; the ODR-2 Chart Tree reuses `AccountsRepository`; no Reporting module, no duplicated account table, no `/api/v1/reports`                                                       |

---

## 10. OQ Impact

Task 20 resolves the six Owner Decisions, but it does **not** close the broader
Open Questions that still own content/governance.

| OQ                                            | Previous status | New status                             | Reason                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------- | --------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OQ-25**                                     | OPEN            | **OPEN — narrowed by OD-20-1…OD-20-5** | Mechanism/sequencing/shape resolved for Base Chart, control roles, code history trigger and posting/aggregation. Content remains open: Base Chart accounts/codes/titles/natures/postability, concrete role catalog and mandatory set, per-level leaf posting defaults, code reuse/history validity details, deletion guards and statutory layouts. |
| **OQ-41**                                     | OPEN            | **OPEN — narrowed by OD-20-6**         | Initial dimension persistence/aggregation boundary resolved. Dimension count, requirement defaults, master-data binding, item governance and area applicability remain open.                                                                                                                                                                       |
| **OQ-36**                                     | OPEN            | OPEN                                   | Code reuse/deletion policy still affects future code history and unused-account deletion.                                                                                                                                                                                                                                                          |
| **OQ-62/OQ-63**                               | OPEN            | OPEN                                   | Base Chart adoption/migration preflight must still respect pin-divergence and LEGACY fallback questions.                                                                                                                                                                                                                                           |
| **OQ-01/OQ-22/OQ-19/OQ-43/OQ-45/OQ-52/OQ-53** | OPEN            | OPEN                                   | Referenced dependencies remain unchanged. Task 20 does not alter tenancy, bootstrap, legal, licensing or backup/restore questions.                                                                                                                                                                                                                 |

---

## 11. ADR Impact

No ADR is promoted to Accepted by Task 20. The affected Proposed ADRs are amended
to record the Owner decisions and remain pending their separate adoption/implementation
gates.

| ADR                                            | Previous status | New status             | Reason                                                                                                                   |
| ---------------------------------------------- | --------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **ADR-0033** — Account identity & code history | Proposed        | **Proposed — amended** | Records OD-20-4: pre-use code correction permitted, post-use code immutable, history producer-bound and not speculative. |
| **ADR-0034** — POSTING vs AGGREGATION          | Proposed        | **Proposed — amended** | Records OD-20-5 and resolves D-1 as leaf-only posting/read-time aggregation.                                             |
| **ADR-0035** — Code structure migration        | Proposed        | **Proposed — amended** | Records OD-20-4's producer-first constraint for code history dependency.                                                 |
| **ADR-0037** — Configuration boundary          | Proposed        | **Proposed — amended** | Records OD-20-1, OD-20-2, OD-20-3 and OD-20-6.                                                                           |

ADR-0036 is not substantively changed by Task 20.

---

## 12. Resolved Owner Decisions

| Decision    | Original question                                        | Owner decision                                                                                                                                    | Resulting architectural consequence                                                                                                                                      | Implementation status                                                      |
| ----------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| **OD-20-1** | What is the Base Chart artifact and adoption model?      | Versioned Base Accounting Chart template stored as an Accounting-owned database/product asset, adopted explicitly into an organization.           | Template identities never become ledger references; adoption creates organization-owned Account identities and must satisfy ODR-1/ODR-3. Content not invented by agents. | Deferred: no template tables/migrations/adoption service/API/seed/content. |
| **OD-20-2** | Should control roles be catalog-first or consumer-first? | Consumer-first; no speculative broad catalog.                                                                                                     | Each role must be justified by a concrete approved consumer.                                                                                                             | Deferred: no table/enum/catalog/migration/API/service.                     |
| **OD-20-3** | Column or mapping for role association?                  | Independent effective-dated Account↔Control Role mapping.                                                                                         | `Account.control_role` is rejected as the primary architecture; future design must support history, reassignment, auditability and identity preservation.                | Deferred until a real consumer requires roles.                             |
| **OD-20-4** | How do code changes and history work?                    | `Account.id` identity; `Account.code` business address; pre-use correction permitted; after accounting use immutable; history with real producer. | No speculative history table; future producer makes transitions auditable/reconstructable.                                                                               | Deferred: no code-edit producer/history schema/report change.              |
| **OD-20-5** | Leaf-only or non-leaf posting?                           | **POSTING = leaf-only; AGGREGATION = reporting/read-time roll-up.**                                                                               | D-1 resolved; existing read model valid; no parent duplicate postings, no own-vs-descendant workaround.                                                                  | No implementation required; future exception needs new decision.           |
| **OD-20-6** | Where do dimensions live initially?                      | Transaction-line-level analytical assignments; read-layer aggregation for concrete reporting consumers.                                           | Dimensions are not LedgerEntry identity; no arbitrary ledger columns, generic JSONB or speculative projection.                                                           | Deferred: no dimension tables/API/UI/reports/projections.                  |

---

## 13. Final Decision Gate

**Verdict: READY FOR REVIEW — NOT ACCEPTED.**

Measured against the READY criteria after decision resolution:

| #   | Criterion                                         | Met?              | Note                                                           |
| --- | ------------------------------------------------- | ----------------- | -------------------------------------------------------------- |
| 1   | Scope bounded                                     | Yes               | Documentation/decision resolution only.                        |
| 2   | Required Owner decisions exist                    | Yes               | OD-20-1…OD-20-6 recorded as DECIDED.                           |
| 3   | No unresolved architecture contradiction          | Yes               | D-1 resolved by OD-20-5; T20-C-1 resolved by OD-20-3.          |
| 4   | Required ADRs updated consistently                | Yes for review    | ADR-0033/0034/0035/0037 amended, still Proposed.               |
| 5   | No silent change to Task 19                       | Yes               | ODR-1/ODR-2/ODR-3 unchanged.                                   |
| 6   | No unresolved security/tenant boundary introduced | Yes               | Future surfaces reuse ODR-3.                                   |
| 7   | Data ownership clear                              | Yes               | Template/adopted-account/role/dimension boundaries documented. |
| 8   | Migration strategy understood                     | Yes for this task | No migration now; future additive/producer/consumer-driven.    |
| 9   | Historical accounting integrity protected         | Yes               | No ledger change; id and leaf-only invariants preserved.       |
| 10  | Testing strategy defined                          | Yes               | Static documentation checks only.                              |
| 11  | Cross-module ownership explicit                   | Yes               | Control roles/dimensions are consumer-driven.                  |
| 12  | No dangerous invariant left implicit              | Yes               | Leaf-only posting and mapping/dimension boundaries explicit.   |

The gate document records the same result: **READY FOR REVIEW**. The Owner performs
acceptance separately.

---

## 14. Known Limitations

1. **Static inspection only.** Implementation claims are read-only code and
   schema inspection from the original Task 20 investigation, updated with
   documentation-only decision resolution at `main` @ `1efa3f386e40d7ee1bc0a8f55f11120cd971ddaf`.
   No runtime behaviour was exercised.
2. **No heavy tests executed.** Per the brief and
   `docs/testing/test-execution-policy.md`, this documentation-only task ran only
   lightweight static validation (`git diff --check` and documentation/reference
   checks). **No unit, E2E, live-PostgreSQL, migration-rehearsal or CI-equivalent
   run is claimed**, and no existing test was modified.
3. **Two SQL surfaces read, not profiled.** The double-counting analysis in §6.4
   is derived from reading the TB/GL CTEs; it was not demonstrated by execution
   (and cannot be, because `postable ⇒ leaf` makes the shape unrepresentable
   today). It is labelled as an analysis of a _hypothetical_ relaxation.
4. **Shallow local history.** `STATE.md` §2 records the clone as shallow; PR and
   commit references are transcribed from repository records, not re-derived from
   local ancestry.
5. **No legal claim.** Nothing here validates any Iranian statutory requirement;
   OQ-43 remains OPEN and untouched.
6. **Content deliberately absent.** No base-chart account, no concrete control
   role, no dimension catalog and no code-history schema is approved as content.
   The Owner decisions approve mechanisms/boundaries only; future content requires
   explicit accounting/domain approval.
7. **Agent inference is labelled, not authoritative.** The authoritative Task 20
   outcomes are OD-20-1…OD-20-6 as recorded in §12 and in
   `docs/accounting/owner-decision-baseline.md` §12.
